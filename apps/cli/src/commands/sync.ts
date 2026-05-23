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
  listPlatformAdapters,
  type HostDiscoveryEntry,
  type SourceProbeProgressEvent,
} from "@cchistory/source-adapters";
import { type SourceDefinition, type SourceStatus, type SourceSyncPayload } from "@cchistory/domain";
import { STORAGE_SCHEMA_VERSION, isFutureStorageSchemaVersion, type CCHistoryStorage } from "@cchistory/storage";
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

export async function handleSync(context: CommandContext): Promise<CommandOutput> {
  if (context.globals.dryRun) {
    return handleSyncDryRun(context);
  }

  const layout = resolveStoreLayout({
    cwd: context.io.cwd,
    storeArg: context.globals.store,
    dbArg: context.globals.db,
  });
  await mkdir(layout.assetDir, { recursive: true });
  await mkdir(layout.rawDir, { recursive: true });

  const sourceRefs = context.options.source;
  const limitFiles = context.options.limitFiles;
  const storage = await openStorage(layout);
  const progress = createProgressReporter(context);

  try {
    const { host, syncedSources } = await syncSelectedSources({
      layout,
      storage,
      sourceRefs,
      limitFiles,
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
  snapshotRawBlobs: boolean;
  safeMode?: boolean;
  onProgress?: (event: SyncProgressEvent) => void;
}): Promise<{ host: Awaited<ReturnType<typeof runSourceProbe>>["host"]; syncedSources: SyncedSourceSummary[] }> {
  const sourceRoster = input.sourceRefs.length > 0
    ? getDefaultSourcesForHost({ includeMissing: true })
    : getDefaultSources();
  const sources = applySourceSelection(sourceRoster, input.sourceRefs);
  const hostProbe = await runSourceProbe({}, []);
  if (sources.length === 0) {
    return { host: hostProbe.host, syncedSources: [] };
  }

  const syncedSources: SyncedSourceSummary[] = [];
  for (const source of sources) {
    let payload: SourceSyncPayload | undefined;
    try {
      const result = await runSourceProbe(
        {
          source_ids: [source.id],
          limit_files_per_source: input.limitFiles,
          safe_mode: input.safeMode,
          on_progress: (event) => input.onProgress?.(event),
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
    const counts = input.storage.replaceSourcePayload(payload, {
      allow_host_rekey: true,
      onProgress: (event) => {
        input.onProgress?.({
          stage: event.stage,
          source_id: payload.source.id,
          slot_id: payload.source.slot_id,
          platform: payload.source.platform,
          display_name: payload.source.display_name,
          message: formatStorageProgressMessage(event.stage, payload.source.display_name),
        });
      },
    });
    syncedSources.push({
      source: payload.source,
      counts,
    });
  }

  return { host: hostProbe.host, syncedSources };
}

export function applySourceSelection<T extends { id: string; slot_id: string }>(sources: T[], selectedRefs: string[]): T[] {
  if (selectedRefs.length === 0) {
    return sources;
  }
  return sources.filter((source) => selectedRefs.includes(source.id) || selectedRefs.includes(source.slot_id));
}

type SyncProgressEvent = (SourceProbeProgressEvent | {
  stage: "write_store_start" | "write_store_done" | "reindex_start" | "reindex_done" | "source_error";
  source_id: string;
  slot_id: string;
  platform: SourceStatus["platform"];
  display_name: string;
  message?: string;
  file_path?: string;
  file_index?: number;
  file_count?: number;
  count?: number;
  elapsed_ms?: number;
});

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

    const prefix = `[${command}:${event.slot_id}:${event.stage}]`;
    const fileProgress =
      typeof event.file_index === "number" && typeof event.file_count === "number"
        ? ` ${event.file_index}/${event.file_count}`
        : "";
    const elapsed = typeof event.elapsed_ms === "number" ? ` (${event.elapsed_ms}ms)` : "";
    context.io.stderr(`${prefix}${fileProgress} ${event.message ?? event.file_path ?? ""}${elapsed}\n`);
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
    default:
      return sourceName;
  }
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
