import { mkdir } from "node:fs/promises";
import {
  getDefaultSources,
  discoverDefaultSourcesForHost,
  discoverHostToolsForHost,
  runSourceProbe,
  type HostDiscoveryEntry,
} from "@cchistory/source-adapters";
import { type SourceDefinition, type SourceStatus } from "@cchistory/domain";
import type { CCHistoryStorage } from "@cchistory/storage";
import {
  getFlag,
  getFlagValues,
  hasFlag,
  parseNumberFlag,
  type ParsedArgs,
} from "../args.js";
import {
  renderTable,
  renderKeyValue,
  renderSection,
  shortId,
} from "../renderers.js";
import {
  openStorage,
  resolveStoreLayout,
  type StoreLayout,
} from "../store.js";
import {
  type CliIo,
  type CommandOutput,
  type SyncedSourceSummary,
  resolveReadMode,
  pathExists,
  openReadStore,
  formatError,
} from "../main.js";
import { formatSourceHandle, resolveSourceRef } from "../resolvers.js";
import { createStatsOverviewOutput } from "./stats.js";

export async function handleSync(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  if (hasFlag(parsed, "dry-run")) {
    return handleSyncDryRun(parsed);
  }

  const layout = resolveStoreLayout({
    cwd: io.cwd,
    storeArg: getFlag(parsed, "store"),
    dbArg: getFlag(parsed, "db"),
  });
  await mkdir(layout.assetDir, { recursive: true });
  await mkdir(layout.rawDir, { recursive: true });

  const sourceRefs = getFlagValues(parsed, "source");
  const limitFiles = parseNumberFlag(parsed, "limit-files");
  const storage = await openStorage(layout);

  try {
    const { host, syncedSources } = await syncSelectedSources({
      layout,
      storage,
      sourceRefs,
      limitFiles,
      snapshotRawBlobs: true,
    });

    const rows = syncedSources.map((entry) => [
      `${entry.source.display_name} (${entry.source.slot_id})`,
      shortId(entry.source.host_id),
      String(entry.counts.sessions),
      String(entry.counts.turns),
      entry.source.sync_status,
    ]);
    return {
      text: [
        `Synced ${syncedSources.length} source(s) into ${layout.dbPath}`,
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
      },
    };
  } finally {
    storage.close();
  }
}

export async function handleSyncDryRun(parsed: ParsedArgs): Promise<CommandOutput> {
  const sourceRefs = getFlagValues(parsed, "source");
  const discoveries = applySourceDiscoverySelection(
    discoverDefaultSourcesForHost({ includeMissing: true }),
    sourceRefs,
  );
  const availableCount = discoveries.filter((entry) => entry.selected_exists).length;

  return {
    text: [
      `Dry run: ${availableCount}/${discoveries.length} supported source(s) currently available`,
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
      sources: discoveries,
    },
  };
}

export async function handleDiscover(parsed: ParsedArgs): Promise<CommandOutput> {
  const showAll = hasFlag(parsed, "showall");
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

export async function handleHealth(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const sourceRefs = getFlagValues(parsed, "source");
  const showAll = hasFlag(parsed, "showall");
  const readMode = resolveReadMode(parsed);
  const explicitStoreSelection = Boolean(getFlag(parsed, "store") || getFlag(parsed, "db"));
  const storeOnly = hasFlag(parsed, "store-only");
  const layout = resolveStoreLayout({
    cwd: io.cwd,
    storeArg: getFlag(parsed, "store"),
    dbArg: getFlag(parsed, "db"),
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

    syncPreviewOutput = await handleSyncDryRun(parsed);
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
    const readStore = await openReadStore(parsed, io);
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

export function createSourcesListOutput(layout: StoreLayout, storage: CCHistoryStorage, selectedSourceIds?: string[]): CommandOutput {
  const sources = storage
    .listSources()
    .filter((source) => !selectedSourceIds || selectedSourceIds.includes(source.id))
    .sort((left, right) => (right.last_sync ?? "").localeCompare(left.last_sync ?? ""));
  return {
    text: renderTable(
      ["Source", "Handle", "Platform", "Sessions", "Turns", "Last Sync", "Status"],
      sources.map((source) => [
        source.display_name,
        formatSourceHandle(source),
        source.platform,
        String(source.total_sessions),
        String(source.total_turns),
        source.last_sync ?? "never",
        source.sync_status,
      ]),
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
}): Promise<{ host: Awaited<ReturnType<typeof runSourceProbe>>["host"]; syncedSources: SyncedSourceSummary[] }> {
  const sources = applySourceSelection(getDefaultSources(), input.sourceRefs);
  if (sources.length === 0) {
    const result = await runSourceProbe(
      {
        source_ids: input.sourceRefs.length > 0 ? input.sourceRefs : undefined,
        limit_files_per_source: input.limitFiles,
      },
      [],
    );
    return { host: result.host, syncedSources: [] };
  }

  const result = await runSourceProbe(
    {
      source_ids: sources.map((source) => source.id),
      limit_files_per_source: input.limitFiles,
    },
    sources,
  );

  const syncedSources: SyncedSourceSummary[] = [];
  for (const payload of result.sources) {
    const counts = input.storage.replaceSourcePayload(payload, { allow_host_rekey: true });
    syncedSources.push({
      source: payload.source,
      counts,
    });
  }

  return { host: result.host, syncedSources };
}

export function applySourceSelection<T extends { id: string; slot_id: string }>(sources: T[], selectedRefs: string[]): T[] {
  if (selectedRefs.length === 0) {
    return sources;
  }
  return sources.filter((source) => selectedRefs.includes(source.id) || selectedRefs.includes(source.slot_id));
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
