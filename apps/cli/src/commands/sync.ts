import { constants as fsConstants } from "node:fs";
import { access, mkdir, readdir, stat, statfs } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  getDefaultSources,
  getDefaultSourcesForHost,
  discoverDefaultSourcesForHost,
  discoverHostToolsForHost,
  runSourceProbe,
  streamSourceProbe,
  projectFileSessionInputs,
  listSourceFiles,
  listPlatformAdapters,
  buildStageRuns,
  selectTailBlob,
  type HostDiscoveryEntry,
  type SourceProbeProgressEvent,
  type SourceProbeEvent,
} from "@cchistory/source-adapters";
import {
  type CapturedBlob,
  type LossAuditRecord,
  type SourceDefinition,
  type SourceStatus,
  type SourceSyncPayload,
  type StageKind,
  nowIso,
} from "@cchistory/domain";
import {
  STORAGE_SCHEMA_VERSION,
  isFutureStorageSchemaVersion,
  type CCHistoryStorage,
  type SourcePayloadStreamingChunk,
} from "@cchistory/storage";
import {
  renderTable,
  renderKeyValue,
  renderSection,
  shortId,
  formatCompactDate,
  colorizeStatus,
} from "../renderers.js";
import {
  openStorage,
  resolveStoreLayout,
  type StoreLayout,
} from "../store.js";
import {
  type CommandContext,
  type CommandOutput,
  type SyncedSourceSummary,
  resolveReadMode,
  pathExists,
  openReadStore,
  formatError,
} from "../main.js";
import { formatSourceHandle, resolveSourceRef } from "../resolvers.js";
import { createStatsOverviewOutput } from "./stats.js";

const DEFAULT_CODEX_SYNC_BATCH_TARGET_BYTES = 24 * 1024 * 1024;

// Stage 2: above this blob count, the non-batch reuse preload drops to a
// metadata-only payload (no records/fragments/atoms) to avoid OOM on operator-
// scale stores. Tuned for a 4 GB host where ~1000 blobs * ~600 KiB parsed
// records each (~600 MiB) is the practical ceiling before the preload
// competes with the streaming probe for heap. Override via env for tuning.
const DEFAULT_MINIMAL_PRELOAD_BLOB_THRESHOLD = 1000;
function resolveMinimalPreloadBlobThreshold(): number {
  const override = process.env.CCHISTORY_MINIMAL_PRELOAD_BLOB_THRESHOLD;
  if (!override) {
    return DEFAULT_MINIMAL_PRELOAD_BLOB_THRESHOLD;
  }
  const parsed = Number(override);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : DEFAULT_MINIMAL_PRELOAD_BLOB_THRESHOLD;
}
const MINIMAL_PRELOAD_BLOB_THRESHOLD = resolveMinimalPreloadBlobThreshold();

export async function handleSync(context: CommandContext): Promise<CommandOutput> {
  if (context.globals.dryRun) {
    return handleSyncDryRun(context);
  }

  const progress = createProgressReporter(context);
  const layout = resolveStoreLayout({
    cwd: context.io.cwd,
    storeArg: context.globals.store,
    dbArg: context.globals.db,
  });
  const storeOpenStartedAt = Date.now();
  progress?.({
    stage: "store_open_start",
    message: `Opening SQLite store ${layout.dbPath}`,
  });
  await mkdir(layout.assetDir, { recursive: true });
  await mkdir(layout.rawDir, { recursive: true });

  const sourceRefs = context.options.source;
  const limitFiles = context.options.limitFiles;
  const changedSince = normalizeChangedSince(context.options.since);
  const storage = await openStorage(layout);
  progress?.({
    stage: "store_open_done",
    message: `Opened SQLite store ${layout.dbPath}`,
    elapsed_ms: Date.now() - storeOpenStartedAt,
  });

  try {
    const { host, syncedSources } = await syncSelectedSources({
      layout,
      storage,
      sourceRefs,
      limitFiles,
      changedSince,
      forceFullResync: context.options.forceFullResync,
      snapshotRawBlobs: true,
      safeMode: context.options.safe,
      onProgress: progress,
    });

    const failedCount = syncedSources.filter((entry) => entry.source.sync_status === "error").length;
    const rows = syncedSources.map((entry) => [
      `${entry.source.display_name} (${entry.source.slot_id})`,
      shortId(entry.source.host_id),
      String(entry.counts.sessions),
      String(entry.counts.turns),
      colorizeStatus(entry.source.sync_status),
    ]);
    return {
      text: [
        failedCount > 0
          ? `Processed ${syncedSources.length} source(s) into ${layout.dbPath} (${failedCount} error)`
          : `Synced ${syncedSources.length} source(s) into ${layout.dbPath}`,
        "",
        renderTable(["Source", "Host", "Sessions", "Turns", "Status"], rows),
      ].join("\n"),
      json: {
        command: "sync",
        db_path: layout.dbPath,
        host,
        sources: syncedSources.map((entry) => ({
          source: entry.source,
          counts: entry.counts,
        })),
        failures: syncedSources
          .filter((entry) => entry.source.sync_status === "error")
          .map((entry) => ({
            source_id: entry.source.id,
            slot_id: entry.source.slot_id,
            error_message: entry.source.error_message,
          })),
      },
    };
  } finally {
    storage.close();
  }
}

export async function handleSyncDryRun(context: CommandContext): Promise<CommandOutput> {
  const sourceRefs = context.options.source;
  const discoveries = applySourceDiscoverySelection(
    discoverDefaultSourcesForHost({ includeMissing: true }),
    sourceRefs,
  );
  const availableCount = discoveries.filter((entry) => entry.selected_exists).length;

  const layout = resolveStoreLayout({
    cwd: context.io.cwd,
    storeArg: context.globals.store,
    dbArg: context.globals.db,
  });

  return {
    text: [
      `Dry run: ${availableCount}/${discoveries.length} supported source(s) currently available`,
      `Store: ${layout.dbPath}`,
      "",
      renderTable(
        ["Source", "Slot", "Platform", "Selected Path", "Exists", "Discovered Paths"],
        discoveries.map((entry) => [
          entry.display_name,
          entry.slot_id ?? entry.key,
          entry.platform,
          entry.selected_path ?? "(none)",
          entry.selected_exists ? "yes" : "no",
          String(entry.discovered_paths.length),
        ]),
      ),
    ].join("\n"),
    json: {
      kind: "sync-dry-run",
      store: layout.dbPath,
      sources: discoveries,
    },
  };
}

export async function handleDiscover(context: CommandContext): Promise<CommandOutput> {
  const showAll = context.globals.showAll;
  const discoveries = discoverHostToolsForHost({ includeMissing: true });
  const visibleEntries = showAll ? discoveries : discoveries.filter((entry) => entry.discovered_paths.length > 0);
  const rows = visibleEntries.flatMap((entry) =>
    entry.candidates
      .filter((candidate) => showAll || candidate.exists)
      .map((candidate) => [
        entry.display_name,
        entry.kind,
        formatDiscoveryCapability(entry.capability),
        entry.platform,
        `${candidate.kind} (${candidate.label})`,
        candidate.path,
        candidate.exists ? "yes" : "no",
        candidate.selected ? "yes" : "",
      ]),
  );

  return {
    text:
      rows.length > 0
        ? [
            `Discovered ${visibleEntries.length} item(s) on this host`,
            "",
            renderTable(["Name", "Kind", "Capability", "Platform", "Path Type", "Path", "Exists", "Selected"], rows),
          ].join("\n")
        : "(no discovered items)",
    json: {
      kind: "discover",
      entries: visibleEntries,
      tools: visibleEntries,
    },
  };
}

export async function handleHealth(context: CommandContext): Promise<CommandOutput> {
  const sourceRefs = context.options.source;
  const showAll = context.globals.showAll;
  const readMode = resolveReadMode(context);
  const explicitStoreSelection = Boolean(context.globals.store || context.globals.db);
  const storeOnly = context.options.storeOnly;
  const layout = resolveStoreLayout({
    cwd: context.io.cwd,
    storeArg: context.globals.store,
    dbArg: context.globals.db,
  });

  let discoveryOutput: CommandOutput | undefined;
  let syncPreviewOutput: CommandOutput | undefined;
  let visibleDiscoveryEntriesCount = 0;
  let availableSyncSources: number | undefined;
  let syncPreviewSourceCount: number | undefined;

  if (!storeOnly) {
    const discoveryEntries = applySourceDiscoverySelection(discoverHostToolsForHost({ includeMissing: true }), sourceRefs);
    const visibleDiscoveryEntries = showAll
      ? discoveryEntries
      : discoveryEntries.filter((entry) => entry.discovered_paths.length > 0);
    const discoveryRows = visibleDiscoveryEntries.flatMap((entry) =>
      entry.candidates
        .filter((candidate) => showAll || candidate.exists)
        .map((candidate) => [
          entry.display_name,
          entry.kind,
          formatDiscoveryCapability(entry.capability),
          entry.platform,
          `${candidate.kind} (${candidate.label})`,
          candidate.path,
          candidate.exists ? "yes" : "no",
          candidate.selected ? "yes" : "",
        ]),
    );
    discoveryOutput = {
      text:
        discoveryRows.length > 0
          ? [
              `Discovered ${visibleDiscoveryEntries.length} item(s) on this host`,
              "",
              renderTable(["Name", "Kind", "Capability", "Platform", "Path Type", "Path", "Exists", "Selected"], discoveryRows),
            ].join("\n")
          : "(no discovered items)",
      json: {
        kind: "discover",
        entries: visibleDiscoveryEntries,
        tools: visibleDiscoveryEntries,
      },
    };

    syncPreviewOutput = await handleSyncDryRun(context);
    const syncPreviewJson = syncPreviewOutput.json as {
      kind: "sync-dry-run";
      sources: Array<{ selected_exists: boolean }>;
    };
    visibleDiscoveryEntriesCount = visibleDiscoveryEntries.length;
    availableSyncSources = syncPreviewJson.sources.filter((entry) => entry.selected_exists).length;
    syncPreviewSourceCount = syncPreviewJson.sources.length;
  }

  const storeExists = await pathExists(layout.dbPath);
  let storeSourcesOutput: CommandOutput | undefined;
  let storeStatsOutput: CommandOutput | undefined;
  let missingStoreNote: string | undefined;

  if (readMode === "full" || storeExists) {
    const readStore = await openReadStore(context);
    try {
      const selectedSourceIds = sourceRefs.length > 0 ? sourceRefs.map((ref) => resolveSourceRef(readStore.storage, ref).id) : undefined;
      storeSourcesOutput = createSourcesListOutput(readStore.layout, readStore.storage, selectedSourceIds);
      storeStatsOutput = createStatsOverviewOutput(readStore.layout, readStore.storage, showAll, selectedSourceIds);
    } finally {
      await readStore.close();
    }
  } else {
    missingStoreNote = [
      `No indexed store found at ${layout.dbPath}.`,
      "Run `cchistory sync` or `cchistory import` first, or use `cchistory health --full` for a live read-only scan.",
    ].join("\n");
  }

  const overviewText = renderKeyValue([
    ["Store Path", layout.dbPath],
    ["Read Mode", readMode],
    [
      "Scope",
      storeOnly
        ? "selected store only"
        : explicitStoreSelection
          ? "selected store + current-host discovery"
          : "resolved store + current-host discovery",
    ],
    ["Selected Sources", sourceRefs.length > 0 ? sourceRefs.join(", ") : "(all supported)"],
    ["Discovered Items", storeOnly ? "(suppressed by --store-only)" : String(visibleDiscoveryEntriesCount)],
    [
      "Sync-Ready Sources",
      storeOnly ? "(suppressed by --store-only)" : `${availableSyncSources}/${syncPreviewSourceCount}`,
    ],
    ["Store Summary", readMode === "full" ? "live full scan" : storeExists ? "indexed store available" : "indexed store missing"],
  ]);

  const sections = [renderSection("Overview", overviewText)];

  if (storeSourcesOutput && storeStatsOutput) {
    sections.push(renderSection(readMode === "full" ? "Live Sources" : "Indexed Sources", storeSourcesOutput.text));
    sections.push(renderSection(readMode === "full" ? "Live Store Overview" : "Store Overview", storeStatsOutput.text));
  } else if (missingStoreNote) {
    sections.push(renderSection("Indexed Store", missingStoreNote));
  }

  if (discoveryOutput && syncPreviewOutput) {
    sections.push(renderSection("Host Discovery", discoveryOutput.text));
    sections.push(renderSection("Sync Preview", syncPreviewOutput.text));
  }

  return {
    text: sections.join("\n\n"),
    json: {
      kind: "health",
      db_path: layout.dbPath,
      read_mode: readMode,
      scope: storeOnly ? "store-only" : explicitStoreSelection ? "explicit-store+host" : "resolved-store+host",
      selected_sources: sourceRefs,
      discovery: discoveryOutput?.json ?? null,
      sync_preview: syncPreviewOutput?.json ?? null,
      store_summary:
        storeSourcesOutput && storeStatsOutput
          ? {
              read_mode: readMode,
              store_exists: storeExists,
              sources: storeSourcesOutput.json,
              stats: storeStatsOutput.json,
            }
          : {
              read_mode: readMode,
              store_exists: false,
              note: missingStoreNote,
            },
    },
  };
}

export async function handleDoctor(context: CommandContext): Promise<CommandOutput> {
  const sourceRefs = context.options.source;
  const storeOnly = context.options.storeOnly;
  const layout = resolveStoreLayout({
    cwd: context.io.cwd,
    storeArg: context.globals.store,
    dbArg: context.globals.db,
  });
  const progress = createProgressReporter(context);

  const pkg = createRequire(import.meta.url)("../../package.json") as { version: string };
  const store = await inspectStore(layout.dbPath);
  const discoveries = storeOnly
    ? []
    : applySourceDiscoverySelection(discoverDefaultSourcesForHost({ includeMissing: true }), sourceRefs);
  const sourceInspections = storeOnly
    ? []
    : await Promise.all(discoveries.map((entry) => inspectDiscoveryEntry(entry)));
  const adapters = listPlatformAdapters().map((adapter) => ({
    platform: adapter.platform,
    display_name: adapter.platform,
    support_tier: adapter.supportTier,
  }));
  const probeLimit = context.options.limitFiles ?? 1;
  const probes = storeOnly
    ? []
    : await runDoctorProbes(sourceRefs, probeLimit, progress);

  const overview = renderKeyValue([
    ["CLI Version", pkg.version],
    ["Storage Schema Supported", STORAGE_SCHEMA_VERSION],
    ["Store Path", layout.dbPath],
    ["Store Status", store.status],
    ["Store Schema", store.schema_version ?? "(unknown)"],
    ["Future Schema", store.future_schema ? "yes" : "no"],
    ["Store Directory Access", store.directory_access],
    ["Available Disk", typeof store.disk_available_bytes === "number" ? formatBytes(store.disk_available_bytes) : "(unknown)"],
    ["Scope", storeOnly ? "store only" : "store + source roots + capped probes"],
  ]);

  const sections = [renderSection("Overview", overview)];
  if (store.recent_stage_runs.length > 0) {
    sections.push(renderSection("Recent Stage Runs", renderTable(
      ["Source", "Stage", "Status", "Finished"],
      store.recent_stage_runs.map((run) => [run.source_id, run.stage_kind, run.status, run.finished_at ?? ""]),
    )));
  }
  if (store.recent_loss_audits.length > 0) {
    sections.push(renderSection("Recent Loss Audits", renderTable(
      ["Source", "Stage", "Severity", "Diagnostic"],
      store.recent_loss_audits.map((audit) => [audit.source_id, audit.stage_kind, audit.severity, audit.diagnostic_code]),
    )));
  }
  if (!storeOnly) {
    sections.push(renderSection("Source Roots", renderTable(
      ["Source", "Platform", "Path", "Exists", "Files", "Largest", "Recent"],
      sourceInspections.map((entry) => [
        entry.display_name,
        entry.platform,
        entry.path ?? "(none)",
        entry.exists ? "yes" : "no",
        entry.file_count_label,
        entry.largest_file_label,
        entry.most_recent_file_label,
      ]),
    )));
    sections.push(renderSection("Adapter Roster", renderTable(
      ["Platform", "Name", "Support"],
      adapters.map((adapter) => [adapter.platform, adapter.display_name, adapter.support_tier]),
    )));
    sections.push(renderSection("Capped Source Probe", renderTable(
      ["Source", "Status", "Sessions", "Turns", "Error"],
      probes.map((probe) => [
        probe.display_name,
        probe.status,
        String(probe.sessions),
        String(probe.turns),
        probe.error_message ?? "",
      ]),
    )));
  }

  return {
    text: sections.join("\n\n"),
    json: {
      kind: "doctor",
      cli_version: pkg.version,
      supported_storage_schema: STORAGE_SCHEMA_VERSION,
      store,
      sources: sourceInspections,
      adapters,
      capped_probes: probes,
    },
  };
}

export function createSourcesListOutput(layout: StoreLayout, storage: CCHistoryStorage, selectedSourceIds?: string[]): CommandOutput {
  const sources = storage
    .listSources()
    .filter((source) => !selectedSourceIds || selectedSourceIds.includes(source.id))
    .sort((left, right) => (right.last_sync ?? "").localeCompare(left.last_sync ?? ""));
  return {
    text: renderTable(
      ["Source", "Platform", "Sessions", "Turns", "Last Sync", "Status"],
      sources.map((source) => [
        source.display_name,
        source.platform,
        String(source.total_sessions),
        String(source.total_turns),
        source.last_sync ? formatCompactDate(source.last_sync) : "never",
        colorizeStatus(source.sync_status),
      ]),
      { align: ["left", "left", "right", "right", "left", "left"] },
    ),
    json: { kind: "sources", db_path: layout.dbPath, sources },
  };
}

export async function syncSelectedSources(input: {
  layout: StoreLayout;
  storage: CCHistoryStorage;
  sourceRefs: string[];
  limitFiles?: number;
  changedSince?: string;
  forceFullResync?: boolean;
  snapshotRawBlobs: boolean;
  safeMode?: boolean;
  onProgress?: (event: SyncProgressEvent) => void;
}): Promise<{ host: Awaited<ReturnType<typeof runSourceProbe>>["host"]; syncedSources: SyncedSourceSummary[] }> {
  const rosterStartedAt = Date.now();
  input.onProgress?.({
    stage: "source_resolution_start",
    message: input.sourceRefs.length > 0
      ? `Resolving selected source(s): ${input.sourceRefs.join(", ")}`
      : "Resolving available default source(s)",
  });
  const sourceRoster = input.sourceRefs.length > 0
    ? getDefaultSourcesForHost({ includeMissing: true })
    : getDefaultSources();
  const sources = applySourceSelection(sourceRoster, input.sourceRefs);
  input.onProgress?.({
    stage: "source_resolution_done",
    message: `Resolved ${sources.length} source(s) to scan`,
    count: sources.length,
    elapsed_ms: Date.now() - rosterStartedAt,
  });

  const hostProbeStartedAt = Date.now();
  input.onProgress?.({
    stage: "host_probe_start",
    message: "Reading local host identity",
  });
  const hostProbe = await runSourceProbe({}, []);
  input.onProgress?.({
    stage: "host_probe_done",
    message: `Host identity ${hostProbe.host.hostname}`,
    elapsed_ms: Date.now() - hostProbeStartedAt,
  });
  if (sources.length === 0) {
    return { host: hostProbe.host, syncedSources: [] };
  }

  const syncedSources: TimedSyncedSourceSummary[] = [];
  for (const source of sources) {
    // Capture sync start time for this source BEFORE any work begins. The
    // marker records "this sync started at T" (not completion) so the next
    // sync's auto-resume cutoff covers files modified during this run that
    // may have been captured mid-write.
    const sourceSyncStartedAt = new Date();
    const effectiveChangedSince = deriveEffectiveChangedSince(input, source.id);
    const perSourceInput = effectiveChangedSince === input.changedSince
      ? input
      : { ...input, changedSince: effectiveChangedSince };

    if (shouldUseBatchedCodexSync(source, perSourceInput)) {
      const summary = await syncCodexSourceInBatches(source, hostProbe.host.id, perSourceInput);
      if (summary && summary.source.sync_status !== "error") {
        input.storage.recordSourceSyncStartedAt(source.id, sourceSyncStartedAt);
      }
      if (summary) {
        syncedSources.push(summary);
        continue;
      }
    }

    let payload: SourceSyncPayload | undefined;
    let useMergeByOriginPath = shouldUseMergeByOriginPath(source, input);
    const timing = createSourceTiming();
    const preservedOriginPaths = new Set<string>();
    const observedOriginPaths = new Set<string>();
    let selectedFilePaths: string[] | undefined;
    try {
      input.onProgress?.({
        stage: "source_prepare_start",
        source_id: source.id,
        slot_id: source.slot_id,
        platform: source.platform,
        display_name: source.display_name,
        message: `Preparing ${source.display_name} (${source.slot_id})`,
      });
      const reuseLoadStartedAt = Date.now();
      let previousPayload: SourceSyncPayload | undefined;
      if (useMergeByOriginPath) {
        input.onProgress?.({
          stage: "incremental_reuse_load_start",
          source_id: source.id,
          slot_id: source.slot_id,
          platform: source.platform,
          display_name: source.display_name,
          message: `Loading previous ${source.display_name} reuse inputs for listed source files`,
        });
        const listStartedAt = Date.now();
        selectedFilePaths = await listSourceFiles(source.platform, source.base_dir, input.limitFiles);
        timing.scanMs += Date.now() - listStartedAt;
        // Stage 2: adaptive reuse preload. The heavy preload
        // (getSourceIncrementalPayloadForOriginPaths) materializes every
        // record/fragment/atom/edge/session for the requested files into a
        // single SourceSyncPayload — needed for processAppendedJsonlBlob's
        // sessionInputs.length === 1 check, but it blows the heap on
        // operator-scale stores (~800 MiB / 1319 files for claude_code on a
        // 4 GB host). For sources above the blob threshold we drop down to a
        // metadata-only preload (source + stage_runs + per-originPath tail
        // blobs). That preserves L0 stats-reuse and L2 checksum-reuse but
        // loses append detection — append-sized re-parses become full parses.
        // Below the threshold, keep the heavy preload so append detection
        // still kicks in for typical dev syncs.
        const metadataPayload = input.storage.getSourceIncrementalMetadataPayload(source.id);
        if (!metadataPayload) {
          useMergeByOriginPath = false;
        } else if (selectedFilePaths.length > 0) {
          previousPayload = metadataPayload.source.total_blobs > MINIMAL_PRELOAD_BLOB_THRESHOLD
            ? buildTailBlobPayloadFromMetadata(metadataPayload, selectedFilePaths)
            : input.storage.getSourceIncrementalPayloadForOriginPaths(source.id, selectedFilePaths);
        }
        const reuseLoadElapsedMs = Date.now() - reuseLoadStartedAt;
        timing.reuseLoadMs += reuseLoadElapsedMs;
        input.onProgress?.({
          stage: "incremental_reuse_load_done",
          source_id: source.id,
          slot_id: source.slot_id,
          platform: source.platform,
          display_name: source.display_name,
          message: previousPayload
            ? `Loaded previous ${source.display_name} reuse inputs (${previousPayload.blobs.length} blob(s))`
            : `No previous ${source.display_name} reuse inputs found for listed source files`,
          count: previousPayload?.blobs.length ?? 0,
          elapsed_ms: reuseLoadElapsedMs,
        });
      }
      input.onProgress?.({
        stage: "source_prepare_done",
        source_id: source.id,
        slot_id: source.slot_id,
        platform: source.platform,
        display_name: source.display_name,
        message: `Prepared ${source.display_name} (${source.slot_id})`,
      });
      const result = await runSourceProbe(
        {
          source_ids: [source.id],
          limit_files_per_source: input.limitFiles,
          safe_mode: input.safeMode,
          changed_since: effectiveChangedSince,
          source_file_paths: selectedFilePaths ? { [source.id]: selectedFilePaths } : undefined,
          previous_payloads: previousPayload ? { [source.id]: previousPayload } : undefined,
          on_progress: (event) => {
            recordProbeTiming(timing, event);
            if (useMergeByOriginPath && event.file_path) {
              observedOriginPaths.add(event.file_path);
              if (event.stage === "file_skip") {
                preservedOriginPaths.add(event.file_path);
              }
            }
            input.onProgress?.(event);
          },
        },
        [source],
      );
      payload = result.sources[0];
    } catch (error) {
      payload = createFailedSourcePayload(source, hostProbe.host.id, formatError(error));
      input.onProgress?.({
        stage: "source_error",
        source_id: source.id,
        slot_id: source.slot_id,
        platform: source.platform,
        display_name: source.display_name,
        message: formatError(error),
      });
    }
    if (!payload) {
      continue;
    }
    input.onProgress?.({
      stage: "write_store_start",
      source_id: payload.source.id,
      slot_id: payload.source.slot_id,
      platform: payload.source.platform,
      display_name: payload.source.display_name,
      message: `Writing ${payload.source.display_name} payload to SQLite`,
    });
    const writeStartedAt = Date.now();
    let projectionChanged = true;
    let metadataOnlyPayload = false;
    const onStorageProgress = (event: StorageProgressEvent) => {
      const elapsedMs =
        event.stage === "write_store_done"
          ? Date.now() - writeStartedAt
          : undefined;
      if (event.stage === "write_store_done" && typeof elapsedMs === "number") {
        projectionChanged = event.projection_changed !== false;
        timing.sqliteWriteMs += elapsedMs;
        if (metadataOnlyPayload) {
          timing.sqliteMetadataMs += elapsedMs;
          timing.metadataOnlyWriteBatchCount += 1;
        } else if (useMergeByOriginPath) {
          timing.sqliteMergeMs += elapsedMs;
        } else {
          timing.sqliteReplaceMs += elapsedMs;
        }
      }
      input.onProgress?.({
        stage: event.stage,
        source_id: payload.source.id,
        slot_id: payload.source.slot_id,
        platform: payload.source.platform,
        display_name: payload.source.display_name,
        message: formatStorageProgressMessage(event.stage, payload.source.display_name),
        elapsed_ms: elapsedMs,
      });
    };
    metadataOnlyPayload = isMetadataOnlySyncPayload(payload);
    const counts = metadataOnlyPayload
      ? input.storage.updateSourceSyncMetadata(payload, {
          onProgress: onStorageProgress,
        })
      : useMergeByOriginPath
        ? input.storage.mergeSourcePayloadByOriginPath(payload, {
            preserve_origin_paths: [...preservedOriginPaths],
            observed_origin_paths: [...observedOriginPaths],
            refreshDerived: false,
            skipGlobalScopes: true,
            skipPrune: true,
            onProgress: onStorageProgress,
          })
        : input.storage.replaceSourcePayload(payload, {
            allow_host_rekey: true,
            refreshDerived: false,
            skipGlobalScopes: true,
            skipPrune: true,
            onProgress: onStorageProgress,
          });
    // The merge/replace calls above pass skipGlobalScopes=true to avoid
    // re-running the expensive COUNT+SUM(LENGTH) aggregation on operator-scale
    // sources (claude_code: ~1300 files, 100k+ rows per cache table — observed
    // at 178s for a single merge). Refresh the source- and parser_profile-
    // scoped cache refs once here instead. Skipped for metadata-only writes
    // (they don't touch the underlying tables).
    if (!metadataOnlyPayload) {
      input.storage.refreshGlobalDerivedCacheRefs(payload.source.id);
    }
    const storedSource = useMergeByOriginPath
      ? input.storage.listSources().find((entry) => entry.id === payload.source.id) ?? payload.source
      : payload.source;
    if (storedSource.sync_status !== "error") {
      input.storage.recordSourceSyncStartedAt(source.id, sourceSyncStartedAt);
    }
    syncedSources.push({
      source: storedSource,
      counts,
      timing,
      projectionChanged,
    });
  }

  refreshDerivedProjectionsForSyncedSources(input.storage, syncedSources, input.onProgress);
  // Stage 1: prune deferred-orphan evidence blobs once at end-of-sync. The
  // per-batch merge path passes force:false to keep the end-to-end LEFT JOIN
  // out of the batch loop; this single call catches every orphan produced
  // during the run. Skipped when no source produced a payload — nothing was
  // written, so no new orphans exist.
  if (syncedSources.length > 0) {
    input.storage.pruneEvidenceBlobsNow();
  }
  return { host: hostProbe.host, syncedSources };
}

function refreshDerivedProjectionsForSyncedSources(
  storage: CCHistoryStorage,
  syncedSources: TimedSyncedSourceSummary[],
  onProgress?: (event: SyncProgressEvent) => void,
): void {
  if (syncedSources.length === 0) {
    return;
  }

  const shouldRefresh = syncedSources.some((summary) => summary.projectionChanged);
  let refreshElapsedMs = 0;
  if (shouldRefresh) {
    const refreshStartedAt = Date.now();
    storage.refreshDerivedProjections({
      source_id: "all",
      onProgress: (event) => {
        onProgress?.({
          stage: event.stage,
          source_id: event.source_id,
          slot_id: "all",
          display_name: "All sources",
          message: formatStorageProgressMessage(event.stage, "All sources"),
          elapsed_ms: event.stage === "reindex_done" ? Date.now() - refreshStartedAt : undefined,
        });
      },
    });
    refreshElapsedMs = Date.now() - refreshStartedAt;
  } else {
    onProgress?.({
      stage: "reindex_skip",
      source_id: "all",
      slot_id: "all",
      display_name: "All sources",
      message: formatStorageProgressMessage("reindex_skip", "All sources"),
      elapsed_ms: 0,
    });
  }

  for (const summary of syncedSources) {
    summary.timing.projectionRefreshMs += refreshElapsedMs;
    summary.timing.projectionRefreshSkipped = !shouldRefresh;
    summary.timing.totalMs = Date.now() - summary.timing.startedAtMs;
    storage.annotateSourceStageRunStats(
      summary.source.id,
      buildSourceAggregateStageStats(
        summary.source,
        summary.timing,
        storage.countSourceLossAuditsByStage(summary.source.id),
      ),
    );
  }
}

interface StreamMergeBatchInput {
  storage: CCHistoryStorage;
  source: SourceDefinition;
  hostId: string;
  fileBatch: readonly string[];
  observedOriginPaths: readonly string[];
  outsideBatchOriginPaths: readonly string[];
  previousPayload: SourceSyncPayload | undefined;
  preSyncStageRuns: SourceSyncPayload["stage_runs"] | undefined;
  changedSince: string | undefined;
  safeMode: boolean | undefined;
  onProgress: ((event: SyncProgressEvent) => void) | undefined;
  timing: SourceTiming;
  batchIndex: number;
  batchCount: number;
}

async function streamCodexMergeBatch(
  input: StreamMergeBatchInput,
): Promise<{ counts: SyncedSourceSummary["counts"]; projectionChanged: boolean }> {
  const { storage, source, hostId } = input;
  const preservedOriginPaths = new Set<string>(input.outsideBatchOriginPaths);
  const observedOriginPaths = new Set(input.observedOriginPaths);

  const sourceStatus: SourceStatus = {
    id: source.id,
    slot_id: source.slot_id,
    family: source.family,
    platform: source.platform,
    display_name: source.display_name,
    base_dir: source.base_dir,
    host_id: hostId,
    last_sync: new Date().toISOString(),
    sync_status: "healthy",
    total_blobs: 0,
    total_records: 0,
    total_fragments: 0,
    total_atoms: 0,
    total_sessions: 0,
    total_turns: 0,
  };

  const previousPayloads = input.previousPayload
    ? { [source.id]: input.previousPayload }
    : undefined;
  const stageRunsForFirstChunk = input.preSyncStageRuns ?? [];
  let stageRunsEmitted = stageRunsForFirstChunk.length === 0;

  let projectionChanged = false;
  // Track file-level outcomes so the sourceStatus mutation below produces a
  // correct sync_status before the merge reads it. The merge only preserves
  // error_message when source.sync_status === "error" — a hardcoded "healthy"
  // would silently mask an all-files-failed batch.
  let encounteredFileError = false;
  let firstFileErrorMessage: string | undefined;
  let filesObserved = 0;
  let writeStartedAt = 0;

  const onStorageProgress = (event: StorageProgressEvent) => {
    const elapsedMs = Date.now() - writeStartedAt;
    if (event.stage === "write_store_done") {
      if (event.projection_changed !== false) {
        projectionChanged = true;
      }
      input.timing.sqliteWriteMs += elapsedMs;
      input.timing.sqliteMergeMs += elapsedMs;
    }
    input.onProgress?.({
      stage: event.stage,
      source_id: source.id,
      slot_id: source.slot_id,
      platform: source.platform,
      display_name: source.display_name,
      message: formatStorageProgressMessage(event.stage, source.display_name),
      elapsed_ms: elapsedMs,
      // Surface the cumulative per-source merge cost on every batch so the
      // operator can spot slow batches without instrumenting the binary —
      // this is the metric that surfaced the original 266s/0-record hang.
      sqlite_merge_ms: input.timing.sqliteMergeMs,
    });
  };

  input.onProgress?.({
    stage: "write_store_start",
    source_id: source.id,
    slot_id: source.slot_id,
    platform: source.platform,
    display_name: source.display_name,
    message: `Writing ${source.display_name} batch ${input.batchIndex + 1}/${input.batchCount} to SQLite (streaming)`,
    count: input.fileBatch.length,
  });
  writeStartedAt = Date.now();

  // Pipe probe events directly into the merge as chunks. The merge does
  // per-chunk replace pre-pass using chunk.preserved, so we don't need to
  // know preserve_origin_paths up front — this avoids buffering all chunks
  // and keeps peak memory bounded by ~one file's worth of derived structures.
  const probeOptions: Parameters<typeof streamSourceProbe>[0] = {
    source_ids: [source.id],
    safe_mode: input.safeMode,
    changed_since: input.changedSince,
    source_file_paths: { [source.id]: [...input.fileBatch] },
    previous_payloads: previousPayloads,
    on_progress: (progressEvent: SourceProbeProgressEvent) => {
      recordProbeTiming(input.timing, progressEvent);
      input.onProgress?.(progressEvent);
    },
  };

  const mergeResult = await storage.mergeSourcePayloadStreaming(sourceStatus, {
    chunks: (async function* (): AsyncGenerator<SourcePayloadStreamingChunk> {
      const accumulatedLossAudits: LossAuditRecord[] = [];
      let accumulatedBlobs = 0;
      let accumulatedRecords = 0;
      let accumulatedFragments = 0;
      let accumulatedAtoms = 0;
      let accumulatedSessions = 0;
      let accumulatedTurns = 0;
      const streamStartedAt = nowIso();
      const deriveStartedAt = Date.now();
      input.onProgress?.({
        stage: "derive_start",
        source_id: source.id,
        slot_id: source.slot_id,
        platform: source.platform,
        display_name: source.display_name,
        message: `Deriving projections for ${source.display_name} (streaming)`,
      });
      for await (const event of streamSourceProbe(probeOptions, [source])) {
        if (
          event.kind === "source_done" ||
          event.kind === "source_start" ||
          event.kind === "source_missing"
        ) {
          continue;
        }
        const eventChunk = event.kind === "file_error" || event.kind === "file_skip" || event.kind === "file_chunk"
          ? event.chunk
          : undefined;
        if (!eventChunk) {
          continue;
        }
        filesObserved += 1;
        if (event.kind === "file_error") {
          encounteredFileError = true;
          if (firstFileErrorMessage === undefined) {
            firstFileErrorMessage = event.detail;
          }
        } else if (
          event.kind === "file_skip" &&
          (event.reason === "oversized" || event.reason === "capture_failed")
        ) {
          encounteredFileError = true;
          if (firstFileErrorMessage === undefined) {
            // Oversized/capture_failed carries the detail in the chunk's loss audit,
            // not on the event itself.
            const detailAudit = eventChunk.loss_audits.find(
              (audit) =>
                audit.diagnostic_code === "blob_too_large" ||
                audit.diagnostic_code === "blob_capture_failed",
            );
            firstFileErrorMessage = detailAudit?.detail ?? `Skipped ${eventChunk.origin_path}: ${event.reason}`;
          }
        }
        const projected = await projectFileSessionInputs(
          source,
          eventChunk.session_inputs,
          eventChunk.orphan_blobs,
          eventChunk.loss_audits,
          { safeMode: input.safeMode ?? false },
        );
        accumulatedBlobs += projected.blobs.length;
        accumulatedRecords += projected.records.length;
        accumulatedFragments += projected.fragments.length;
        accumulatedAtoms += projected.atoms.length;
        accumulatedSessions += projected.sessions.length;
        accumulatedTurns += projected.turns.length;
        accumulatedLossAudits.push(...projected.lossAudits);
        // "unchanged"/"metadata_only" skips preserve the file's existing data.
        // "oversized"/"capture_failed" skips mean the file is broken — its
        // existing data should be removed (treated as a normal replace with
        // no incoming records, so the per-chunk pre-pass deletes old rows).
        const isPreservingSkip =
          event.kind === "file_skip" &&
          (event.reason === "unchanged" || event.reason === "metadata_only");
        yield {
          origin_path: eventChunk.origin_path,
          stage_runs: stageRunsEmitted ? [] : stageRunsForFirstChunk,
          loss_audits: projected.lossAudits,
          blobs: projected.blobs,
          records: projected.records,
          fragments: projected.fragments,
          atoms: projected.atoms,
          edges: projected.edges,
          candidates: projected.candidates,
          sessions: projected.sessions,
          turns: projected.turns,
          contexts: projected.contexts,
          trusted_bytes_by_blob_id: eventChunk.trusted_bytes_by_blob_id,
          preserved: isPreservingSkip,
        };
        stageRunsEmitted = true;
      }
      input.onProgress?.({
        stage: "derive_done",
        source_id: source.id,
        slot_id: source.slot_id,
        platform: source.platform,
        display_name: source.display_name,
        message: `Derived ${accumulatedSessions} session(s), ${accumulatedTurns} turn(s)`,
        count: accumulatedTurns,
        elapsed_ms: Date.now() - deriveStartedAt,
      });
      // Mutate sourceStatus in place so the merge (which reads source.sync_status
      // after consuming the chunks iterator) sees the corrected status. Mirrors
      // the monolithic finalizeSourcePayload logic: error if all files failed,
      // stale if no projections were derived, otherwise healthy.
      if (encounteredFileError && accumulatedSessions === 0 && accumulatedTurns === 0) {
        sourceStatus.sync_status = "error";
        sourceStatus.error_message = firstFileErrorMessage;
      } else if (
        accumulatedSessions === 0 &&
        accumulatedTurns === 0 &&
        filesObserved === 0
      ) {
        sourceStatus.sync_status = "stale";
      }
      // After the stream completes, emit a final chunk carrying freshly-built
      // stage_runs for this sync. The streaming probe doesn't produce a
      // source-level StageRun array (it's a per-source aggregate), so we
      // build one here from accumulated counts. Without this, a fresh source
      // would have no stage_runs, and the next sync's previousIndex check
      // (previousPayloadMatchesProfile) would fail — breaking append
      // detection and metadata-only reuse.
      const finalStageRuns = buildStageRuns(
        source.id,
        source.platform,
        streamStartedAt,
        nowIso(),
        {
          blobs: accumulatedBlobs,
          records: accumulatedRecords,
          fragments: accumulatedFragments,
          atoms: accumulatedAtoms,
          sessions: accumulatedSessions,
          turns: accumulatedTurns,
        },
        accumulatedLossAudits,
      );
      yield {
        origin_path: "",
        stage_runs: finalStageRuns,
        loss_audits: [],
        blobs: [],
        records: [],
        fragments: [],
        atoms: [],
        edges: [],
        candidates: [],
        sessions: [],
        turns: [],
        contexts: [],
      };
    })(),
    preserve_origin_paths: preservedOriginPaths,
    observed_origin_paths: observedOriginPaths,
    onProgress: onStorageProgress,
  });

  return {
    counts: {
      sessions: mergeResult.sessions,
      turns: mergeResult.turns,
      records: mergeResult.records,
      fragments: mergeResult.fragments,
      atoms: mergeResult.atoms,
      blobs: mergeResult.blobs,
    },
    projectionChanged,
  };
}

async function syncCodexSourceInBatches(
  source: SourceDefinition,
  hostId: string,
  input: {
    storage: CCHistoryStorage;
    changedSince?: string;
    safeMode?: boolean;
    onProgress?: (event: SyncProgressEvent) => void;
  },
): Promise<TimedSyncedSourceSummary | undefined> {
  if (!(await pathExists(source.base_dir))) {
    return undefined;
  }

  // Defensive guard: the streaming merge path does not preserve cross-file
  // session merging (see mergeSourcePayloadStreaming doc comment). Routing
  // cursor/antigravity through here would silently regress their derived
  // projections. shouldUseBatchedCodexSync already gates entry, but this
  // assertion catches future routing changes that widen the gate without
  // widening the streaming merge's session-merging support.
  if (source.platform !== "codex") {
    throw new Error(
      `syncCodexSourceInBatches is codex-only (got platform ${source.platform}); ` +
        `use syncSource for sources with cross-file sessions.`,
    );
  }

  const timing = createSourceTiming();
  input.onProgress?.({
    stage: "source_prepare_start",
    source_id: source.id,
    slot_id: source.slot_id,
    platform: source.platform,
    display_name: source.display_name,
    message: `Preparing ${source.display_name} (${source.slot_id})`,
  });
  const listStartedAt = Date.now();
  const files = await listSourceFiles(source.platform, source.base_dir);
  const fileBatches = await buildFileBatchesByRecency(files, input.changedSince);
  timing.scanMs += Date.now() - listStartedAt;
  input.onProgress?.({
    stage: "source_prepare_done",
    source_id: source.id,
    slot_id: source.slot_id,
    platform: source.platform,
    display_name: source.display_name,
    message: `Prepared ${source.display_name} in ${fileBatches.length} bounded batch(es)`,
    count: files.length,
    elapsed_ms: Date.now() - listStartedAt,
  });

  const reuseLoadStartedAt = Date.now();
  input.onProgress?.({
    stage: "incremental_reuse_load_start",
    source_id: source.id,
    slot_id: source.slot_id,
    platform: source.platform,
    display_name: source.display_name,
    message: `Loading previous ${source.display_name} metadata for incremental reuse`,
  });
  const previousMetadataPayload = input.storage.getSourceIncrementalMetadataPayload(source.id);
  const preSyncStageRuns = previousMetadataPayload?.stage_runs;
  const metadataReuseLoadElapsedMs = Date.now() - reuseLoadStartedAt;
  timing.reuseLoadMs += metadataReuseLoadElapsedMs;
  input.onProgress?.({
    stage: "incremental_reuse_load_done",
    source_id: source.id,
    slot_id: source.slot_id,
    platform: source.platform,
    display_name: source.display_name,
    message: previousMetadataPayload
      ? `Loaded previous ${source.display_name} reuse metadata (${previousMetadataPayload.blobs.length} blob(s))`
      : `No previous ${source.display_name} metadata found for incremental reuse`,
    count: previousMetadataPayload?.blobs.length ?? 0,
    elapsed_ms: metadataReuseLoadElapsedMs,
  });

  let counts: SyncedSourceSummary["counts"] = {
    sessions: 0,
    turns: 0,
    records: 0,
    fragments: 0,
    atoms: 0,
    blobs: 0,
  };
  const replaceFirstBatch = !input.storage.listSources().some((entry) => entry.id === source.id);
  let lastPayload: SourceSyncPayload | undefined;
  let projectionChanged = replaceFirstBatch;
  let pendingMetadataWrite: {
    payload: SourceSyncPayload;
    batchIndex: number;
    fileCount: number;
  } | undefined;

  const writeBatchPayload = (
    payload: SourceSyncPayload,
    writeKind: CodexBatchWriteKind,
    batchIndex: number,
    fileCount: number,
    preservedOriginPaths: readonly string[] = [],
    observedOriginPaths: readonly string[] = [],
  ): SyncedSourceSummary["counts"] => {
    input.onProgress?.({
      stage: "write_store_start",
      source_id: payload.source.id,
      slot_id: payload.source.slot_id,
      platform: payload.source.platform,
      display_name: payload.source.display_name,
      message: `Writing ${payload.source.display_name} batch ${batchIndex + 1}/${batches.length} to SQLite`,
      count: fileCount,
    });
    const writeStartedAt = Date.now();
    const onBatchStorageProgress = (event: StorageProgressEvent) => {
      const elapsedMs = Date.now() - writeStartedAt;
      if (event.stage === "write_store_done") {
        if (event.projection_changed !== false) {
          projectionChanged = true;
        }
        timing.sqliteWriteMs += elapsedMs;
        if (writeKind === "replace") {
          timing.sqliteReplaceMs += elapsedMs;
        } else if (writeKind === "merge") {
          timing.sqliteMergeMs += elapsedMs;
        } else {
          timing.sqliteMetadataMs += elapsedMs;
          timing.metadataOnlyWriteBatchCount += 1;
        }
      }
      input.onProgress?.({
        stage: event.stage,
        source_id: payload.source.id,
        slot_id: payload.source.slot_id,
        platform: payload.source.platform,
        display_name: payload.source.display_name,
        message: formatStorageProgressMessage(event.stage, payload.source.display_name),
        elapsed_ms: elapsedMs,
        // Cumulative per-source merge cost — see streamCodexMergeBatch for
        // rationale (surfaces slow batches in operator logs).
        sqlite_merge_ms: timing.sqliteMergeMs,
      });
    };
    return writeKind === "replace"
      ? input.storage.replaceSourcePayload(payload, {
          allow_host_rekey: true,
          refreshDerived: false,
          onProgress: onBatchStorageProgress,
        })
      : writeKind === "metadata"
        ? input.storage.updateSourceSyncMetadata(payload, {
            onProgress: onBatchStorageProgress,
          })
      : input.storage.mergeSourcePayloadByOriginPath(payload, {
          preserve_origin_paths: [...preservedOriginPaths],
          observed_origin_paths: [...observedOriginPaths],
          refreshDerived: false,
          skipGlobalScopes: true,
          onProgress: onBatchStorageProgress,
        });
  };

  const batches = fileBatches.length > 0 ? fileBatches : [[]];
  timing.batchCount += batches.length;
  for (const [batchIndex, fileBatch] of batches.entries()) {
    const preservedOriginPaths = new Set<string>();
    const batchOriginPaths = new Set(fileBatch.map((entry) => path.normalize(entry)));
    const outsideBatchOriginPaths = files.filter((entry) => !batchOriginPaths.has(path.normalize(entry)));
    const batchStartedAt = Date.now();
    const batchReuseLoadStartedAt = Date.now();
    const metadataOnlyPreviousPayload = await buildCodexMetadataOnlyReusePayloadForStableOldBatch(
      previousMetadataPayload,
      fileBatch,
      input.changedSince,
    );
    if (metadataOnlyPreviousPayload) {
      timing.metadataOnlyReuseBatchCount += 1;
    }
    const filePreviousPayload = fileBatch.length > 0
      ? metadataOnlyPreviousPayload ?? input.storage.getSourceIncrementalPayloadForOriginPaths(source.id, fileBatch)
      : undefined;
    timing.reuseLoadMs += Date.now() - batchReuseLoadStartedAt;
    const previousPayload = filePreviousPayload && preSyncStageRuns
      ? { ...filePreviousPayload, stage_runs: preSyncStageRuns }
      : filePreviousPayload;
    const upfrontWriteKind: CodexBatchWriteKind = replaceFirstBatch && batchIndex === 0
      ? "replace"
      : metadataOnlyPreviousPayload !== undefined
        ? "metadata"
        : "merge";

    // Route both "replace" (fresh source) and "merge" (subsequent batch)
    // through the streaming path. For a fresh source, streaming merge is
    // equivalent to replace (no existing data to preserve). This bounds
    // memory at one file's worth of derived structures even for the first
    // sync of a large source — the original OOM scenario.
    if (upfrontWriteKind === "merge" || upfrontWriteKind === "replace") {
      pendingMetadataWrite = undefined;
      const streamResult = await streamCodexMergeBatch({
        storage: input.storage,
        source,
        hostId,
        fileBatch,
        observedOriginPaths: files,
        outsideBatchOriginPaths,
        previousPayload,
        preSyncStageRuns,
        changedSince: input.changedSince,
        safeMode: input.safeMode,
        onProgress: input.onProgress,
        timing,
        batchIndex,
        batchCount: batches.length,
      });
      counts = streamResult.counts;
      if (streamResult.projectionChanged) {
        projectionChanged = true;
      }
      input.onProgress?.({
        stage: "source_prepare_done",
        source_id: source.id,
        slot_id: source.slot_id,
        platform: source.platform,
        display_name: source.display_name,
        message: `Finished ${source.display_name} batch ${batchIndex + 1}/${batches.length}`,
        count: fileBatch.length,
        elapsed_ms: Date.now() - batchStartedAt,
      });
      continue;
    }

    const result = await runSourceProbe(
      {
        source_ids: [source.id],
        safe_mode: input.safeMode,
        changed_since: input.changedSince,
        source_file_paths: { [source.id]: fileBatch },
        previous_payloads: previousPayload ? { [source.id]: previousPayload } : undefined,
        on_progress: (event) => {
          recordProbeTiming(timing, event);
          if (event.file_path && event.stage === "file_skip") {
            preservedOriginPaths.add(event.file_path);
          }
          input.onProgress?.(event);
        },
      },
      [source],
    );
    const payload = result.sources[0];
    if (!payload) {
      continue;
    }
    lastPayload = payload;

    const writeKind = upfrontWriteKind;

    if (writeKind === "metadata") {
      pendingMetadataWrite = { payload, batchIndex, fileCount: fileBatch.length };
    } else {
      pendingMetadataWrite = undefined;
      counts = writeBatchPayload(
        payload,
        writeKind,
        batchIndex,
        fileBatch.length,
        [...preservedOriginPaths, ...outsideBatchOriginPaths],
        files,
      );
    }
    input.onProgress?.({
      stage: "source_prepare_done",
      source_id: source.id,
      slot_id: source.slot_id,
      platform: source.platform,
      display_name: source.display_name,
      message: `Finished ${source.display_name} batch ${batchIndex + 1}/${batches.length}`,
      count: fileBatch.length,
      elapsed_ms: Date.now() - batchStartedAt,
    });
  }

  if (pendingMetadataWrite) {
    counts = writeBatchPayload(
      pendingMetadataWrite.payload,
      "metadata",
      pendingMetadataWrite.batchIndex,
      pendingMetadataWrite.fileCount,
    );
  }

  const pruneStartedAt = Date.now();
  counts = input.storage.pruneSourcePayloadByObservedOriginPaths(source.id, files, {
    refreshDerived: false,
    onProgress: (event) => {
      if (event.stage === "write_store_done" && event.projection_changed !== false) {
        projectionChanged = true;
      }
    },
  });
  timing.sqlitePruneMs += Date.now() - pruneStartedAt;

  // Per-batch merges passed skipGlobalScopes=true to avoid re-running the
  // expensive COUNT+SUM(LENGTH) aggregation on operator-scale sources ~30
  // times per sync. Refresh the source- and parser_profile-scoped cache refs
  // once here instead. Only needed when at least one batch actually merged
  // (metadata-only batches don't touch the underlying tables).
  if (timing.sqliteMergeMs > 0 || timing.sqliteReplaceMs > 0) {
    const refreshStartedAt = Date.now();
    input.storage.refreshGlobalDerivedCacheRefs(source.id);
    timing.sqlitePruneMs += Date.now() - refreshStartedAt;
  }

  const storedSource = input.storage.listSources().find((entry) => entry.id === source.id) ??
    lastPayload?.source ??
    createFailedSourcePayload(source, hostId, "No source payload was produced").source;
  return { source: storedSource, counts, timing, projectionChanged };
}

async function buildFileBatches(files: readonly string[], targetBytes: number): Promise<string[][]> {
  const batches: string[][] = [];
  let currentBatch: string[] = [];
  let currentBytes = 0;

  for (const filePath of files) {
    const fileBytes = await fileSizeOrZero(filePath);
    if (currentBatch.length > 0 && currentBytes + fileBytes > targetBytes) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBytes = 0;
    }
    currentBatch.push(filePath);
    currentBytes += fileBytes;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }
  return batches;
}

// Recency-bucketed batching: when a changedSince cutoff is in effect, group
// files by mtime-recency relative to that cutoff before applying
// byte-accumulation. Recent files get small batches (so the slow path — which
// triggers whenever ANY file in a batch has mtime >= cutoff — has a tiny blast
// radius); old files get large batches (since they all hit the metadata-only
// fast path anyway, batch size is nearly free).
//
// Without a cutoff (force-full-resync), every batch is slow regardless of size,
// so we fall back to flat byte-accumulation at the standard target.
const RECENCY_BUCKETS = [
  { key: "recent", maxAgeDays: 1, targetMultiplier: 1 / 6 },
  { key: "week", maxAgeDays: 7, targetMultiplier: 1 / 2 },
  { key: "month", maxAgeDays: 30, targetMultiplier: 1 },
  { key: "old", maxAgeDays: Number.POSITIVE_INFINITY, targetMultiplier: 2 },
] as const;

export async function buildFileBatchesByRecency(
  files: readonly string[],
  changedSince: string | undefined,
): Promise<string[][]> {
  const baseTarget = resolveCodexSyncBatchTargetBytes();
  if (!changedSince || files.length === 0) {
    return buildFileBatches(files, baseTarget);
  }
  const cutoffMs = Date.parse(changedSince);
  if (Number.isNaN(cutoffMs)) {
    return buildFileBatches(files, baseTarget);
  }
  const dayMs = 24 * 60 * 60 * 1000;

  type Bucket = { key: string; targetBytes: number; files: Array<{ path: string; bytes: number }> };
  const buckets = new Map<string, Bucket>();
  for (const bucket of RECENCY_BUCKETS) {
    buckets.set(bucket.key, { key: bucket.key, targetBytes: Math.max(1, Math.floor(baseTarget * bucket.targetMultiplier)), files: [] });
  }

  for (const filePath of files) {
    const stats = await statOrNull(filePath);
    const fileBytes = stats?.size ?? 0;
    const mtimeMs = stats?.mtimeMs ?? 0;
    const ageDays = (cutoffMs - mtimeMs) / dayMs;
    const matched = RECENCY_BUCKETS.find((bucket) => ageDays <= bucket.maxAgeDays) ?? RECENCY_BUCKETS[RECENCY_BUCKETS.length - 1]!;
    buckets.get(matched.key)!.files.push({ path: filePath, bytes: fileBytes });
  }

  const allBatches: string[][] = [];
  for (const bucketDef of RECENCY_BUCKETS) {
    const bucket = buckets.get(bucketDef.key);
    if (!bucket || bucket.files.length === 0) {
      continue;
    }
    // Byte-accumulation within the bucket using pre-computed sizes (no re-stat).
    let currentBatch: string[] = [];
    let currentBytes = 0;
    for (const entry of bucket.files) {
      if (currentBatch.length > 0 && currentBytes + entry.bytes > bucket.targetBytes) {
        allBatches.push(currentBatch);
        currentBatch = [];
        currentBytes = 0;
      }
      currentBatch.push(entry.path);
      currentBytes += entry.bytes;
    }
    if (currentBatch.length > 0) {
      allBatches.push(currentBatch);
    }
  }
  return allBatches;
}

async function statOrNull(filePath: string): Promise<{ size: number; mtimeMs: number } | undefined> {
  try {
    const stats = await stat(filePath);
    return { size: stats.size, mtimeMs: stats.mtime.getTime() };
  } catch {
    return undefined;
  }
}

// Stage 2: reduce a metadata-only payload (source + stage_runs + blobs) to a
// minimal reuse payload whose blobs are the per-originPath tail blobs for the
// requested file paths. The metadata payload already excludes the heavy
// records/fragments/atoms/edges/sessions tables; this filter drops blobs the
// caller doesn't need (e.g. batches that touch a subset of source files).
function buildTailBlobPayloadFromMetadata(
  metadataPayload: SourceSyncPayload,
  filePaths: readonly string[],
): SourceSyncPayload {
  const grouped = new Map<string, CapturedBlob[]>();
  for (const blob of metadataPayload.blobs) {
    const key = path.normalize(blob.origin_path);
    const list = grouped.get(key) ?? [];
    list.push(blob);
    grouped.set(key, list);
  }
  const tailBlobs: CapturedBlob[] = [];
  const seen = new Set<string>();
  for (const filePath of filePaths) {
    const tail = selectTailBlob(grouped.get(path.normalize(filePath)) ?? []);
    if (tail && !seen.has(tail.id)) {
      seen.add(tail.id);
      tailBlobs.push(tail);
    }
  }
  return {
    source: metadataPayload.source,
    stage_runs: metadataPayload.stage_runs,
    loss_audits: [],
    blobs: tailBlobs,
    records: [],
    fragments: [],
    atoms: [],
    edges: [],
    candidates: [],
    sessions: [],
    turns: [],
    contexts: [],
  };
}

async function buildCodexMetadataOnlyReusePayloadForStableOldBatch(
  previousMetadataPayload: SourceSyncPayload | undefined,
  fileBatch: readonly string[],
  changedSince: string | undefined,
): Promise<SourceSyncPayload | undefined> {
  // Fast negative gate for the metadata-only batch path. This runs BEFORE
  // captureBlob and avoids file I/O entirely; its purpose is to skip the
  // streaming probe for batches of files that are obviously old and stable
  // (mtime+ctime+size+identity all match the ledger). When external touches
  // bump mtime forward (backup tools, `touch`, rsync), this gate fails and
  // the batch falls through to streamCodexMergeBatch → streamSourceProbe,
  // where captureBlob + canReuseCapturedBlob (the L2 size+checksum+watermark
  // path in probe.ts) catches the reuse correctly. So an external touch
  // costs one extra file read per file but does NOT force reparse.
  if (!previousMetadataPayload || fileBatch.length === 0 || !changedSince) {
    return undefined;
  }
  const changedSinceMs = Date.parse(changedSince);
  if (Number.isNaN(changedSinceMs)) {
    return undefined;
  }

  const blobsByOriginPath = new Map<string, CapturedBlob[]>();
  for (const blob of previousMetadataPayload.blobs) {
    const originPath = path.normalize(blob.origin_path);
    const blobs = blobsByOriginPath.get(originPath) ?? [];
    blobs.push(blob);
    blobsByOriginPath.set(originPath, blobs);
  }

  const batchBlobs: CapturedBlob[] = [];
  const seenBlobIds = new Set<string>();
  for (const filePath of fileBatch) {
    const originPath = path.normalize(filePath);
    const tailBlob = selectTailBlob(blobsByOriginPath.get(originPath) ?? []);
    if (!tailBlob) {
      return undefined;
    }
    let fileStats: Awaited<ReturnType<typeof stat>>;
    try {
      fileStats = await stat(filePath);
    } catch {
      return undefined;
    }
    if (fileStats.mtime.getTime() >= changedSinceMs || !canReuseBlobFromStats(tailBlob, fileStats)) {
      return undefined;
    }
    if (!seenBlobIds.has(tailBlob.id)) {
      seenBlobIds.add(tailBlob.id);
      batchBlobs.push(tailBlob);
    }
  }

  return {
    source: previousMetadataPayload.source,
    stage_runs: previousMetadataPayload.stage_runs,
    loss_audits: [],
    blobs: batchBlobs,
    records: [],
    fragments: [],
    atoms: [],
    edges: [],
    candidates: [],
    sessions: [],
    turns: [],
    contexts: [],
  };
}

function canReuseBlobFromStats(
  blob: CapturedBlob,
  stats: { size: number; mtime: Date; ctime: Date },
): boolean {
  return blob.size_bytes === stats.size &&
    blob.file_modified_at === stats.mtime.toISOString() &&
    blob.file_identity_stable === true &&
    blob.file_changed_at !== undefined &&
    blob.file_changed_at === stats.ctime.toISOString();
}

function isMetadataOnlySyncPayload(payload: SourceSyncPayload): boolean {
  return payload.loss_audits.length === 0 &&
    payload.blobs.length === 0 &&
    payload.records.length === 0 &&
    payload.fragments.length === 0 &&
    payload.atoms.length === 0 &&
    payload.edges.length === 0 &&
    payload.candidates.length === 0 &&
    payload.sessions.length === 0 &&
    payload.turns.length === 0 &&
    payload.contexts.length === 0;
}

async function fileSizeOrZero(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
}

export function applySourceSelection<T extends { id: string; slot_id: string }>(sources: T[], selectedRefs: string[]): T[] {
  if (selectedRefs.length === 0) {
    return sources;
  }
  return sources.filter((source) => selectedRefs.includes(source.id) || selectedRefs.includes(source.slot_id));
}

interface TimedSyncedSourceSummary extends SyncedSourceSummary {
  timing: SourceTiming;
  projectionChanged: boolean;
}

type CodexBatchWriteKind = "replace" | "merge" | "metadata";

interface SourceTiming {
  startedAtMs: number;
  scanMs: number;
  parseMs: number;
  deriveMs: number;
  sqliteWriteMs: number;
  sqliteReplaceMs: number;
  sqliteMergeMs: number;
  sqliteMetadataMs: number;
  sqlitePruneMs: number;
  projectionRefreshMs: number;
  projectionRefreshSkipped: boolean;
  reuseLoadMs: number;
  totalMs: number;
  fileCount: number;
  batchCount: number;
  metadataOnlyReuseBatchCount: number;
  metadataOnlyWriteBatchCount: number;
}

function createSourceTiming(): SourceTiming {
  return {
    startedAtMs: Date.now(),
    scanMs: 0,
    parseMs: 0,
    deriveMs: 0,
    sqliteWriteMs: 0,
    sqliteReplaceMs: 0,
    sqliteMergeMs: 0,
    sqliteMetadataMs: 0,
    sqlitePruneMs: 0,
    projectionRefreshMs: 0,
    projectionRefreshSkipped: false,
    reuseLoadMs: 0,
    totalMs: 0,
    fileCount: 0,
    batchCount: 0,
    metadataOnlyReuseBatchCount: 0,
    metadataOnlyWriteBatchCount: 0,
  };
}

function recordProbeTiming(timing: SourceTiming, event: SourceProbeProgressEvent): void {
  const elapsedMs = typeof event.elapsed_ms === "number" ? event.elapsed_ms : undefined;
  if (event.stage === "list_files_done" && typeof event.count === "number") {
    timing.fileCount += event.count;
  }
  if (elapsedMs === undefined) {
    return;
  }

  switch (event.stage) {
    case "live_probe_done":
    case "list_files_done":
    case "file_capture_done":
    case "file_reuse":
    case "file_skip":
      timing.scanMs += elapsedMs;
      break;
    case "file_parse_done":
    case "file_append_done":
      timing.parseMs += elapsedMs;
      break;
    case "derive_done":
      timing.deriveMs += elapsedMs;
      break;
  }
}

function buildSourceTimingStageStats(
  timing: SourceTiming,
): Partial<Record<StageKind, Record<string, number>>> {
  return {
    capture: {
      sync_scan_ms: timing.scanMs,
      sync_file_count: timing.fileCount,
      sync_batch_count: timing.batchCount,
      sync_metadata_only_reuse_batch_count: timing.metadataOnlyReuseBatchCount,
      sync_reuse_load_ms: timing.reuseLoadMs,
    },
    parse_source_fragments: {
      sync_parse_ms: timing.parseMs,
    },
    derive_candidates: {
      sync_derive_ms: timing.deriveMs,
    },
    finalize_projections: {
      sqlite_write_ms: timing.sqliteWriteMs,
      sqlite_replace_ms: timing.sqliteReplaceMs,
      sqlite_merge_ms: timing.sqliteMergeMs,
      sqlite_metadata_ms: timing.sqliteMetadataMs,
      sqlite_metadata_write_count: timing.metadataOnlyWriteBatchCount,
      sqlite_prune_ms: timing.sqlitePruneMs,
    },
    index_projections: {
      projection_refresh_ms: timing.projectionRefreshMs,
      projection_refresh_skipped: timing.projectionRefreshSkipped ? 1 : 0,
      sync_reindex_ms: timing.projectionRefreshMs,
      sync_total_ms: timing.totalMs,
    },
  };
}

function buildSourceAggregateStageStats(
  source: SourceStatus,
  timing: SourceTiming,
  failureCounts: Partial<Record<StageKind, number>>,
): Partial<Record<StageKind, Record<string, number>>> {
  const stageCounts: Partial<Record<StageKind, Record<string, number>>> = {
    capture: {
      input_count: timing.fileCount || source.total_blobs,
      output_count: source.total_blobs,
      success_count: source.total_blobs,
      failure_count: failureCounts.capture ?? 0,
      skipped_count: 0,
      unparseable_count: 0,
    },
    extract_records: {
      input_count: source.total_blobs,
      output_count: source.total_records,
      success_count: source.total_records,
      failure_count: failureCounts.extract_records ?? 0,
      skipped_count: 0,
      unparseable_count: failureCounts.extract_records ?? 0,
    },
    parse_source_fragments: {
      input_count: source.total_records,
      output_count: source.total_fragments,
      success_count: source.total_fragments,
      failure_count: failureCounts.parse_source_fragments ?? 0,
      skipped_count: 0,
      unparseable_count: failureCounts.parse_source_fragments ?? 0,
    },
    atomize: {
      input_count: source.total_fragments,
      output_count: source.total_atoms,
      success_count: source.total_atoms,
      failure_count: failureCounts.atomize ?? 0,
      skipped_count: 0,
      unparseable_count: 0,
    },
    derive_candidates: {
      input_count: source.total_atoms,
      output_count: source.total_sessions + source.total_turns,
      success_count: source.total_sessions + source.total_turns,
      failure_count: failureCounts.derive_candidates ?? 0,
      skipped_count: 0,
      unparseable_count: 0,
    },
    finalize_projections: {
      input_count: source.total_sessions + source.total_turns,
      output_count: source.total_sessions + source.total_turns,
      success_count: source.total_sessions + source.total_turns,
      failure_count: failureCounts.finalize_projections ?? 0,
      skipped_count: 0,
      unparseable_count: 0,
      sessions: source.total_sessions,
      turns: source.total_turns,
    },
    apply_masks: {
      input_count: source.total_turns,
      output_count: source.total_turns,
      success_count: source.total_turns,
      failure_count: failureCounts.apply_masks ?? 0,
      skipped_count: 0,
      unparseable_count: 0,
      turns: source.total_turns,
    },
    index_projections: {
      input_count: source.total_turns,
      output_count: source.total_turns,
      success_count: source.total_turns,
      failure_count: failureCounts.index_projections ?? 0,
      skipped_count: 0,
      unparseable_count: 0,
      turns: source.total_turns,
    },
  };
  const timingStats = buildSourceTimingStageStats(timing);
  const mergedStats: Partial<Record<StageKind, Record<string, number>>> = {};
  for (const stage of Object.keys(stageCounts) as StageKind[]) {
    mergedStats[stage] = {
      ...stageCounts[stage],
      ...timingStats[stage],
    };
  }
  return mergedStats;
}

type SyncProgressEvent = (SourceProbeProgressEvent | {
  stage:
    | "store_open_start"
    | "store_open_done"
    | "source_resolution_start"
    | "source_resolution_done"
    | "host_probe_start"
    | "host_probe_done"
    | "source_prepare_start"
    | "source_prepare_done"
    | "incremental_reuse_load_start"
    | "incremental_reuse_load_done"
    | "write_store_start"
    | "write_store_done"
    | "reindex_start"
    | "reindex_done"
    | "reindex_skip"
    | "source_error";
  source_id?: string;
  slot_id?: string;
  platform?: SourceStatus["platform"];
  display_name?: string;
  message?: string;
  file_path?: string;
  file_index?: number;
  file_count?: number;
  size_bytes?: number;
  count?: number;
  elapsed_ms?: number;
  sqlite_merge_ms?: number;
});

type StorageProgressEvent = {
  stage: "write_store_done";
  source_id: string;
  projection_changed: boolean;
} | {
  stage: "reindex_start" | "reindex_done";
  source_id: string;
};

function createProgressReporter(context: CommandContext): ((event: SyncProgressEvent) => void) | undefined {
  const mode = context.options.progress ?? (context.options.detail || context.globals.verbose ? "text" : "none");
  if (mode === "none") {
    return undefined;
  }
  const command = context.commandPath[0] ?? "sync";

  return (event) => {
    if (mode === "jsonl") {
      context.io.stderr(`${JSON.stringify({ kind: `${command}-progress`, at: new Date().toISOString(), ...event })}\n`);
      return;
    }

    const prefix = `[${command}:${event.slot_id ?? "cli"}:${event.stage}]`;
    const fileProgress =
      typeof event.file_index === "number" && typeof event.file_count === "number"
        ? ` ${event.file_index}/${event.file_count}`
        : "";
    const elapsed = typeof event.elapsed_ms === "number" ? ` (${event.elapsed_ms}ms)` : "";
    const size = typeof event.size_bytes === "number" ? ` ${formatBytes(event.size_bytes)}` : "";
    context.io.stderr(`${prefix}${fileProgress}${size} ${event.message ?? event.file_path ?? ""}${elapsed}\n`);
  };
}

function createFailedSourcePayload(source: SourceDefinition, hostId: string, errorMessage: string): SourceSyncPayload {
  const now = new Date().toISOString();
  return {
    source: {
      id: source.id,
      slot_id: source.slot_id,
      family: source.family,
      platform: source.platform,
      display_name: source.display_name,
      base_dir: source.base_dir,
      host_id: hostId,
      last_sync: now,
      sync_status: "error",
      error_message: errorMessage,
      total_blobs: 0,
      total_records: 0,
      total_fragments: 0,
      total_atoms: 0,
      total_sessions: 0,
      total_turns: 0,
    },
    stage_runs: [],
    loss_audits: [],
    blobs: [],
    records: [],
    fragments: [],
    atoms: [],
    edges: [],
    candidates: [],
    sessions: [],
    turns: [],
    contexts: [],
  };
}

function formatStorageProgressMessage(stage: SyncProgressEvent["stage"], sourceName: string): string {
  switch (stage) {
    case "write_store_done":
      return `Wrote ${sourceName} payload to SQLite`;
    case "reindex_start":
      return "Rebuilding project links and search index";
    case "reindex_done":
      return "Rebuilt project links and search index";
    case "reindex_skip":
      return "Skipped project links and search index rebuild; canonical projections were unchanged";
    default:
      return sourceName;
  }
}

function normalizeChangedSince(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  const relative = trimmed.match(/^(\d+)(m|h|d|w)$/iu);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2]!.toLowerCase();
    const multiplier =
      unit === "m" ? 60 * 1000 :
      unit === "h" ? 60 * 60 * 1000 :
      unit === "d" ? 24 * 60 * 60 * 1000 :
      7 * 24 * 60 * 60 * 1000;
    return new Date(Date.now() - amount * multiplier).toISOString();
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString();
  }
  throw new Error(`Invalid --since value: ${value}. Use an ISO timestamp or a relative window such as 30m, 12h, 7d, or 2w.`);
}

function deriveEffectiveChangedSince(
  input: {
    changedSince?: string;
    forceFullResync?: boolean;
    storage: CCHistoryStorage;
  },
  sourceId: string,
): string | undefined {
  if (input.forceFullResync) {
    return undefined;
  }
  if (input.changedSince) {
    return input.changedSince;
  }
  const startedAt = input.storage.getSourceSyncStartedAt(sourceId);
  if (!startedAt) {
    return undefined;
  }
  // Floor to UTC 00:00 of that day. Safety margin: any file written during
  // the prior sync (mtime > prior sync start) gets re-read, even if it was
  // captured mid-write. UTC matches the on-disk timestamp convention.
  return new Date(
    Date.UTC(
      startedAt.getUTCFullYear(),
      startedAt.getUTCMonth(),
      startedAt.getUTCDate(),
    ),
  ).toISOString();
}

function supportsIncrementalReuse(platform: SourceDefinition["platform"]): boolean {
  return platform === "codex" || platform === "claude_code" || platform === "factory_droid";
}

function shouldUseMergeByOriginPath(
  source: SourceDefinition,
  input: { limitFiles?: number },
): boolean {
  return supportsIncrementalReuse(source.platform) && input.limitFiles === undefined;
}

function shouldUseBatchedCodexSync(
  source: SourceDefinition,
  input: { limitFiles?: number },
): boolean {
  return source.platform === "codex" && input.limitFiles === undefined;
}

function resolveCodexSyncBatchTargetBytes(): number {
  const override = process.env.CCHISTORY_CODEX_SYNC_BATCH_TARGET_BYTES;
  if (!override) {
    return DEFAULT_CODEX_SYNC_BATCH_TARGET_BYTES;
  }
  const parsed = Number(override);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_CODEX_SYNC_BATCH_TARGET_BYTES;
}

async function inspectStore(dbPath: string): Promise<{
  path: string;
  status: "missing" | "ok" | "future_schema" | "error";
  schema_version?: string;
  future_schema: boolean;
  error_message?: string;
  wal_exists: boolean;
  shm_exists: boolean;
  directory_access: "ok" | "missing" | "not_readable_or_writable";
  disk_available_bytes?: number;
  recent_stage_runs: Array<{ source_id: string; stage_kind: string; status: string; finished_at?: string }>;
  recent_loss_audits: Array<{ source_id: string; stage_kind: string; severity: string; diagnostic_code: string }>;
}> {
  const walExists = await pathExists(`${dbPath}-wal`);
  const shmExists = await pathExists(`${dbPath}-shm`);
  const environment = await inspectStoreEnvironment(dbPath);
  if (!(await pathExists(dbPath))) {
    return {
      path: dbPath,
      status: "missing",
      future_schema: false,
      wal_exists: walExists,
      shm_exists: shmExists,
      directory_access: environment.directory_access,
      disk_available_bytes: environment.disk_available_bytes,
      recent_stage_runs: [],
      recent_loss_audits: [],
    };
  }

  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const schemaVersion = readSchemaVersionReadonly(db);
    const futureSchema = schemaVersion ? isFutureStorageSchemaVersion(schemaVersion) : false;
    return {
      path: dbPath,
      status: futureSchema ? "future_schema" : "ok",
      schema_version: schemaVersion,
      future_schema: futureSchema,
      wal_exists: walExists,
      shm_exists: shmExists,
      directory_access: environment.directory_access,
      disk_available_bytes: environment.disk_available_bytes,
      recent_stage_runs: readRecentPayloads(db, "stage_runs", 5).map((payload) => ({
        source_id: asDoctorString(payload.source_id),
        stage_kind: asDoctorString(payload.stage_kind),
        status: asDoctorString(payload.status),
        finished_at: asDoctorOptionalString(payload.finished_at),
      })),
      recent_loss_audits: readRecentPayloads(db, "loss_audits", 5).map((payload) => ({
        source_id: asDoctorString(payload.source_id),
        stage_kind: asDoctorString(payload.stage_kind),
        severity: asDoctorString(payload.severity),
        diagnostic_code: asDoctorString(payload.diagnostic_code),
      })),
    };
  } catch (error) {
    return {
      path: dbPath,
      status: "error",
      future_schema: false,
      error_message: formatError(error),
      wal_exists: walExists,
      shm_exists: shmExists,
      directory_access: environment.directory_access,
      disk_available_bytes: environment.disk_available_bytes,
      recent_stage_runs: [],
      recent_loss_audits: [],
    };
  } finally {
    db?.close();
  }
}

function readSchemaVersionReadonly(db: DatabaseSync): string | undefined {
  if (!sqliteTableExists(db, "schema_meta")) {
    return undefined;
  }
  const row = db.prepare("SELECT value_text FROM schema_meta WHERE key = ?").get("schema_version") as
    | { value_text: string }
    | undefined;
  return row?.value_text;
}

async function inspectStoreEnvironment(dbPath: string): Promise<{
  directory_access: "ok" | "missing" | "not_readable_or_writable";
  disk_available_bytes?: number;
}> {
  const dir = path.dirname(dbPath);
  let directory_access: "ok" | "missing" | "not_readable_or_writable" = "ok";
  try {
    await access(dir, fsConstants.R_OK | fsConstants.W_OK);
  } catch (error) {
    directory_access = (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "not_readable_or_writable";
  }

  try {
    const stats = await statfs(dir);
    return {
      directory_access,
      disk_available_bytes: Number(stats.bavail) * Number(stats.bsize),
    };
  } catch {
    return { directory_access };
  }
}

function readRecentPayloads(db: DatabaseSync, table: string, limit: number): Record<string, unknown>[] {
  if (!sqliteTableExists(db, table)) {
    return [];
  }
  const rows = db.prepare(`SELECT payload_json FROM ${table} ORDER BY rowid DESC LIMIT ?`).all(limit) as Array<{ payload_json: string }>;
  return rows.flatMap((row) => {
    try {
      const parsed = JSON.parse(row.payload_json) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? [parsed as Record<string, unknown>] : [];
    } catch {
      return [];
    }
  });
}

function sqliteTableExists(db: DatabaseSync, table: string): boolean {
  const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as
    | { 1: number }
    | undefined;
  return Boolean(row);
}

async function inspectDiscoveryEntry(entry: HostDiscoveryEntry): Promise<{
  display_name: string;
  platform: string;
  path?: string;
  exists: boolean;
  file_count: number;
  file_count_label: string;
  largest_file_label: string;
  most_recent_file_label: string;
}> {
  const selectedPath = entry.selected_path;
  if (!selectedPath || !entry.selected_exists) {
    return {
      display_name: entry.display_name,
      platform: entry.platform,
      path: selectedPath,
      exists: false,
      file_count: 0,
      file_count_label: "0",
      largest_file_label: "",
      most_recent_file_label: "",
    };
  }

  const stats = await inspectFileTree(selectedPath, 1_000);
  return {
    display_name: entry.display_name,
    platform: entry.platform,
    path: selectedPath,
    exists: true,
    file_count: stats.fileCount,
    file_count_label: stats.truncated ? `>=${stats.fileCount}` : String(stats.fileCount),
    largest_file_label: stats.largestFile ? `${formatBytes(stats.largestFile.size)} ${stats.largestFile.path}` : "",
    most_recent_file_label: stats.mostRecentFile ? `${stats.mostRecentFile.mtime.toISOString()} ${stats.mostRecentFile.path}` : "",
  };
}

async function inspectFileTree(root: string, cap: number): Promise<{
  fileCount: number;
  truncated: boolean;
  largestFile?: { path: string; size: number };
  mostRecentFile?: { path: string; mtime: Date };
}> {
  const result: {
    fileCount: number;
    truncated: boolean;
    largestFile?: { path: string; size: number };
    mostRecentFile?: { path: string; mtime: Date };
  } = { fileCount: 0, truncated: false };
  const pending = [root];

  while (pending.length > 0) {
    const current = pending.pop()!;
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const fileStat = await stat(fullPath);
      result.fileCount += 1;
      if (!result.largestFile || fileStat.size > result.largestFile.size) {
        result.largestFile = { path: fullPath, size: fileStat.size };
      }
      if (!result.mostRecentFile || fileStat.mtime > result.mostRecentFile.mtime) {
        result.mostRecentFile = { path: fullPath, mtime: fileStat.mtime };
      }
      if (result.fileCount >= cap) {
        result.truncated = true;
        return result;
      }
    }
  }

  return result;
}

async function runDoctorProbes(
  sourceRefs: string[],
  limitFiles: number,
  progress: ((event: SyncProgressEvent) => void) | undefined,
): Promise<Array<{ source_id: string; slot_id: string; display_name: string; status: string; sessions: number; turns: number; error_message?: string }>> {
  const sourceRoster = sourceRefs.length > 0
    ? getDefaultSourcesForHost({ includeMissing: true })
    : getDefaultSources();
  const sources = applySourceSelection(sourceRoster, sourceRefs);
  const rows: Array<{ source_id: string; slot_id: string; display_name: string; status: string; sessions: number; turns: number; error_message?: string }> = [];
  for (const source of sources) {
    try {
      const result = await runSourceProbe(
        {
          source_ids: [source.id],
          limit_files_per_source: limitFiles,
          safe_mode: true,
          max_file_bytes: 1024 * 1024,
          on_progress: (event) => progress?.(event),
        },
        [source],
      );
      const payload = result.sources[0];
      rows.push({
        source_id: source.id,
        slot_id: source.slot_id,
        display_name: source.display_name,
        status: payload?.source.sync_status ?? "missing",
        sessions: payload?.sessions.length ?? 0,
        turns: payload?.turns.length ?? 0,
        error_message: payload?.source.error_message,
      });
    } catch (error) {
      rows.push({
        source_id: source.id,
        slot_id: source.slot_id,
        display_name: source.display_name,
        status: "error",
        sessions: 0,
        turns: 0,
        error_message: formatError(error),
      });
    }
  }
  return rows;
}

function asDoctorString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asDoctorOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KiB`;
  return `${Math.round(bytes / (1024 * 1024))}MiB`;
}

export function applySourceDiscoverySelection(entries: HostDiscoveryEntry[], selectedRefs: string[]): HostDiscoveryEntry[] {
  if (selectedRefs.length === 0) {
    return entries;
  }
  return entries.filter(
    (entry) =>
      selectedRefs.includes(entry.key) ||
      (entry.slot_id && selectedRefs.includes(entry.slot_id)) ||
      (entry.selected_path && selectedRefs.includes(entry.selected_path)),
  );
}

export function formatDiscoveryCapability(value: HostDiscoveryEntry["capability"]): string {
  return value;
}
