#!/usr/bin/env node

import { access, mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import {
  getLocalPathBasename,
  normalizeLocalPathIdentity,
  type SourcePlatform,
  type ProjectIdentity,
  type SourceDefinition,
  type SourceSyncPayload,
  type SessionProjection,
  type SourceStatus,
  type TurnSearchResult,
  type UsageStatsDimension,
  type UserTurnProjection,
} from "@cchistory/domain";
import {
  discoverDefaultSourcesForHost,
  discoverHostToolsForHost,
  getDefaultSources,
  getDefaultSourcesForHost,
  getSourceFormatProfiles,
  runSourceProbe,
} from "@cchistory/source-adapters";
import type { HostDiscoveryEntry } from "@cchistory/source-adapters";
import type { CCHistoryStorage, RawSnapshotGcResult } from "@cchistory/storage";
import {
  computePayloadChecksum,
  exportBundle,
  importBundleIntoStore,
  planBundleImport,
  snapshotPayloadRawBlobs,
} from "./bundle.js";
import {
  formatNumber,
  formatRatio,
  indentBlock,
  renderBarChart,
  renderKeyValue,
  renderSection,
  renderTable,
  shortId,
  truncateText,
} from "./renderers.js";
import { createStorage, openStorage, pruneOrphanRawSnapshotsSafe, resolveStoreLayout, type StoreLayout } from "./store.js";

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string[]>;
}

interface CliIo {
  cwd: string;
  stdout: (value: string) => void;
  stderr: (value: string) => void;
}

interface CommandOutput {
  text: string;
  json: unknown;
}

type ReadMode = "index" | "full";

interface OpenedReadStore {
  layout: StoreLayout;
  storage: CCHistoryStorage;
  close: () => Promise<void>;
}

interface SyncedSourceSummary {
  source: SourceStatus;
  counts: {
    sessions: number;
    turns: number;
    records: number;
    fragments: number;
    atoms: number;
    blobs: number;
  };
}

export async function runCli(argv: string[], io: CliIo = defaultIo()): Promise<number> {
  const parsed = parseArgs(argv);
  const jsonMode = hasFlag(parsed, "json");
  const [rawCommand, ...restPositionals] = parsed.positionals;
  const command = normalizeCommand(rawCommand);

  if (!command) {
    printOutput(
      {
        text: renderHelp(),
        json: { help: true },
      },
      jsonMode,
      io,
    );
    return 0;
  }

  try {
    const commandArgs = { ...parsed, positionals: restPositionals };
    const output = await dispatchCommand(command, commandArgs, io);
    printOutput(output, jsonMode || command === "query" || command === "templates", io);
    return 0;
  } catch (error) {
    io.stderr(`${formatError(error)}\n`);
    return 1;
  }
}

async function dispatchCommand(command: string, parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  switch (command) {
    case "sync":
      return handleSync(parsed, io);
    case "discover":
      return handleDiscover(parsed);
    case "health":
      return handleHealth(parsed, io);
    case "ls":
      return handleLs(parsed, io);
    case "tree":
      return handleTree(parsed, io);
    case "show":
      return handleShow(parsed, io);
    case "search":
      return handleSearch(parsed, io);
    case "stats":
      return handleStats(parsed, io);
    case "export":
      return handleExport(parsed, io);
    case "backup":
      return handleBackup(parsed, io);
    case "restore-check":
      return handleRestoreCheck(parsed, io);
    case "import":
      return handleImport(parsed, io);
    case "merge":
      return handleMergeAlias(parsed, io);
    case "gc":
      return handleGc(parsed, io);
    case "query":
      return handleQueryAlias(parsed, io);
    case "templates":
      return handleTemplates();
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function handleSync(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
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

async function handleSyncDryRun(parsed: ParsedArgs): Promise<CommandOutput> {
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

async function handleDiscover(parsed: ParsedArgs): Promise<CommandOutput> {
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

async function handleHealth(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const sourceRefs = getFlagValues(parsed, "source");
  const showAll = hasFlag(parsed, "showall");
  const readMode = resolveReadMode(parsed);
  const layout = resolveStoreLayout({
    cwd: io.cwd,
    storeArg: getFlag(parsed, "store"),
    dbArg: getFlag(parsed, "db"),
  });

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
  const discoveryOutput: CommandOutput = {
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

  const syncPreviewOutput = await handleSyncDryRun(parsed);
  const syncPreviewJson = syncPreviewOutput.json as {
    kind: "sync-dry-run";
    sources: Array<{ selected_exists: boolean }>;
  };
  const availableSyncSources = syncPreviewJson.sources.filter((entry) => entry.selected_exists).length;

  const storeExists = await pathExists(layout.dbPath);
  let storeSourcesOutput: CommandOutput | undefined;
  let storeStatsOutput: CommandOutput | undefined;
  let missingStoreNote: string | undefined;

  if (readMode === "full" || storeExists) {
    const readStore = await openReadStore(parsed, io);
    try {
      storeSourcesOutput = createSourcesListOutput(readStore.layout, readStore.storage);
      storeStatsOutput = createStatsOverviewOutput(readStore.layout, readStore.storage, showAll);
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
    ["Selected Sources", sourceRefs.length > 0 ? sourceRefs.join(", ") : "(all supported)"],
    ["Discovered Items", String(visibleDiscoveryEntries.length)],
    ["Sync-Ready Sources", `${availableSyncSources}/${syncPreviewJson.sources.length}`],
    ["Store Summary", readMode === "full" ? "live full scan" : storeExists ? "indexed store available" : "indexed store missing"],
  ]);

  const sections = [
    renderSection("Overview", overviewText),
    renderSection("Host Discovery", discoveryOutput.text),
    renderSection("Sync Preview", syncPreviewOutput.text),
  ];

  if (storeSourcesOutput && storeStatsOutput) {
    sections.push(renderSection(readMode === "full" ? "Live Sources" : "Indexed Sources", storeSourcesOutput.text));
    sections.push(renderSection(readMode === "full" ? "Live Store Overview" : "Store Overview", storeStatsOutput.text));
  } else if (missingStoreNote) {
    sections.push(renderSection("Indexed Store", missingStoreNote));
  }

  return {
    text: sections.join("\n\n"),
    json: {
      kind: "health",
      db_path: layout.dbPath,
      read_mode: readMode,
      selected_sources: sourceRefs,
      discovery: discoveryOutput.json,
      sync_preview: syncPreviewOutput.json,
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

function createSourcesListOutput(layout: StoreLayout, storage: CCHistoryStorage): CommandOutput {
  const sources = storage.listSources().sort((left, right) => (right.last_sync ?? "").localeCompare(left.last_sync ?? ""));
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

function createStatsOverviewOutput(layout: StoreLayout, storage: CCHistoryStorage, showAll: boolean): CommandOutput {
  const usageFilters = { include_known_zero_token: showAll };
  const overview = storage.getUsageOverview(usageFilters);
  const schema = storage.getSchemaInfo();
  const sources = storage.listSources();
  const projects = storage.listProjects();
  const sessions = storage.listResolvedSessions();
  const turns = storage.listResolvedTurns();
  const excludedNote = overview.excluded_zero_token_turns
    ? `${overview.excluded_zero_token_turns} non-API turns excluded (slash commands, cancellations). Use --showall to include.`
    : undefined;
  return {
    text: [
      renderKeyValue([
        ["DB", layout.dbPath],
        ["Schema Version", schema.schema_version],
        ["Schema Migrations", String(schema.migrations.length)],
        ["Search Mode", storage.searchMode],
        ["Sources", String(sources.length)],
        ["Projects", String(projects.length)],
        ["Sessions", String(sessions.length)],
        ["Turns", String(turns.length)],
        ["Turns With Tokens", `${overview.turns_with_token_usage}/${overview.total_turns}`],
        ["Coverage", formatRatio(overview.turn_coverage_ratio)],
        ["Input Tokens", formatNumber(overview.total_input_tokens)],
        ["Cached Input Tokens", formatNumber(overview.total_cached_input_tokens)],
        ["Output Tokens", formatNumber(overview.total_output_tokens)],
        ["Reasoning Tokens", formatNumber(overview.total_reasoning_output_tokens)],
        ["Total Tokens", formatNumber(overview.total_tokens)],
      ]),
      excludedNote,
    ]
      .filter((value): value is string => Boolean(value))
      .join("\n\n"),
    json: {
      kind: "stats-overview",
      db_path: layout.dbPath,
      counts: {
        sources: sources.length,
        projects: projects.length,
        sessions: sessions.length,
        turns: turns.length,
      },
      schema,
      search_mode: storage.searchMode,
      overview,
    },
  };
}

function createStatsUsageOutput(
  layout: StoreLayout,
  storage: CCHistoryStorage,
  dimension: UsageStatsDimension,
  showAll: boolean,
): CommandOutput {
  if (!["model", "project", "source", "host", "day", "month"].includes(dimension)) {
    throw new Error("`stats usage --by` must be one of model, project, source, host, day, or month.");
  }

  const usageFilters = { include_known_zero_token: showAll };
  const rollup = storage.listUsageRollup(dimension, usageFilters);
  const notesText = renderUsageNotes(rollup.rows, dimension);
  const excludedNote = rollup.excluded_zero_token_turns
    ? `${rollup.excluded_zero_token_turns} non-API turns excluded (slash commands, cancellations). Use --showall to include.`
    : undefined;
  const chartText = dimension === "day" || dimension === "month" ? renderUsageCharts(rollup.rows, dimension) : undefined;
  return {
    text: [
      renderTable(
        ["Label", "Turns", "Covered", "Coverage", "Total Tokens", "Input", "Output"],
        rollup.rows.map((row) => [
          formatUsageRollupLabel(dimension, row.label),
          String(row.turn_count),
          String(row.turns_with_token_usage),
          formatRatio(row.turn_coverage_ratio),
          formatNumber(row.total_tokens),
          formatNumber(row.total_input_tokens),
          formatNumber(row.total_output_tokens),
        ]),
      ),
      chartText,
      notesText,
      excludedNote,
    ]
      .filter((value): value is string => Boolean(value))
      .join("\n\n"),
    json: {
      kind: "stats-usage",
      db_path: layout.dbPath,
      dimension,
      overview: storage.getUsageOverview(usageFilters),
      rollup,
    },
  };
}

async function handleLs(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const [target] = parsed.positionals;
  if (!target || !["projects", "sessions", "sources"].includes(target)) {
    throw new Error("Use `ls projects`, `ls sessions`, or `ls sources`.");
  }

  const readStore = await openReadStore(parsed, io);
  try {
    const { layout, storage } = readStore;
    if (target === "projects") {
      const projects = listVisibleProjects(storage, parsed);
      return {
        text: renderTable(
          ["Name", "Status", "Hosts", "Sessions", "Turns", "Last Activity"],
          projects.map((project) => [
            `${project.display_name} (${project.slug})`,
            projectStatusLabel(project),
            String(project.host_ids.length),
            String(project.session_count),
            String(project.committed_turn_count + project.candidate_turn_count),
            project.project_last_activity_at ?? project.updated_at,
          ]),
        ),
        json: { kind: "projects", db_path: layout.dbPath, projects },
      };
    }

    if (target === "sessions") {
      const projectsById = new Map(storage.listProjects().map((project) => [project.project_id, project]));
      const sessions = storage.listResolvedSessions();
      return {
        text: renderTable(
          ["Session", "Title", "Workspace", "Project", "Source", "Host", "Model", "Updated"],
          sessions.map((session) => [
            session.id,
            session.title ?? "",
            session.working_directory ?? "",
            projectLabel(projectsById.get(session.primary_project_id ?? "")),
            session.source_id,
            shortId(session.host_id),
            session.model ?? "unknown",
            session.updated_at,
          ]),
        ),
        json: { kind: "sessions", db_path: layout.dbPath, sessions },
      };
    }

    return createSourcesListOutput(layout, storage);
  } finally {
    await readStore.close();
  }
}

async function handleTree(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const [target, ref] = parsed.positionals;
  const readStore = await openReadStore(parsed, io);
  try {
    const { layout, storage } = readStore;
    const projects = storage.listProjects();
    const sessions = storage.listResolvedSessions();
    const turns = storage.listResolvedTurns();
    const sourcesById = new Map(storage.listSources().map((source) => [source.id, source]));
    if (target === "projects") {
      const visibleProjects = sortProjectsForDisplay(filterProjectsForDisplay(projects, parsed));
      const lines: string[] = [];
      for (const project of visibleProjects) {
        lines.push(
          `${project.display_name} [${projectStatusLabel(project)}] sessions=${project.session_count} turns=${project.committed_turn_count + project.candidate_turn_count}`,
        );
        const grouped = new Map<string, { label: string; count: number }>();
        for (const session of sessions.filter((entry) => entry.primary_project_id === project.project_id)) {
          const source = sourcesById.get(session.source_id);
          const label = `${session.host_id} / ${source?.slot_id ?? session.source_id}`;
          const current = grouped.get(label) ?? { label, count: 0 };
          current.count += 1;
          grouped.set(label, current);
        }
        for (const group of [...grouped.values()].sort((left, right) => left.label.localeCompare(right.label))) {
          lines.push(`  ${group.label}: ${group.count} session(s)`);
        }
      }

      const unassignedSessions = sessions.filter((session) => !session.primary_project_id);
      if (unassignedSessions.length > 0) {
        lines.push(`Unassigned sessions=${unassignedSessions.length}`);
      }

      return {
        text: lines.length > 0 ? lines.join("\n") : "(no projects)",
        json: {
          kind: "projects-tree",
          db_path: layout.dbPath,
          projects: visibleProjects,
          unassigned_sessions: unassignedSessions.length,
        },
      };
    }

    if (target === "project" && ref) {
      const project = resolveProjectRef(storage, ref);
      const projectSessions = sessions.filter((session) => session.primary_project_id === project.project_id);
      const lines: string[] = [
        `${project.display_name} [${projectStatusLabel(project)}]`,
        `hosts=${project.host_ids.join(", ") || "none"} sessions=${project.session_count} turns=${project.committed_turn_count + project.candidate_turn_count}`,
      ];

      for (const session of projectSessions) {
        const source = sourcesById.get(session.source_id);
        lines.push(`  ${session.id} (${source?.slot_id ?? session.source_id}, ${shortId(session.host_id)}) ${session.updated_at}`);
        for (const turn of turns.filter((entry) => entry.session_id === session.id).slice(0, 3)) {
          lines.push(`    - ${turn.submission_started_at} ${truncateText(turn.canonical_text, 80)}`);
        }
      }

      return {
        text: lines.join("\n"),
        json: { kind: "project-tree", db_path: layout.dbPath, project, sessions: projectSessions },
      };
    }

    throw new Error("Use `tree projects` or `tree project <project-id-or-slug>`.");
  } finally {
    await readStore.close();
  }
}

async function handleShow(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const [target, ref] = parsed.positionals;
  if (!target || !ref) {
    throw new Error("Use `show project|session|turn|source <ref>`.");
  }

  const readStore = await openReadStore(parsed, io);
  try {
    const { layout, storage } = readStore;
    if (target === "project") {
      const project = resolveProjectRef(storage, ref);
      const turns = storage.listProjectTurns(project.project_id);
      const usage = storage.getUsageOverview({ project_id: project.project_id });
      return {
        text: [
          renderSection(
            project.display_name,
            renderKeyValue([
              ["Project ID", project.project_id],
              ["Slug", project.slug],
              ["Status", projectStatusLabel(project)],
              ["Hosts", project.host_ids.join(", ") || "none"],
              ["Sessions", String(project.session_count)],
              ["Turns", String(project.committed_turn_count + project.candidate_turn_count)],
              ["Last Activity", project.project_last_activity_at ?? project.updated_at],
              ["Total Tokens", formatNumber(usage.total_tokens)],
              ["Coverage", formatRatio(usage.turn_coverage_ratio)],
            ]),
          ),
          "",
          renderSection(
            "Recent Turns",
            turns.length === 0
              ? "(no turns)"
              : turns
                  .slice(0, 10)
                  .map((turn) => `${turn.submission_started_at} ${truncateText(turn.canonical_text, 96)}`)
                  .join("\n"),
          ),
        ].join("\n"),
        json: { kind: "project", db_path: layout.dbPath, project, turns, usage },
      };
    }

    if (target === "session") {
      const session = resolveSessionRef(storage, ref);
      const turns = storage.listResolvedTurns().filter((turn) => turn.session_id === session.id);
      return {
        text: [
          renderSection(
            `Session ${session.id}`,
            renderKeyValue([
              ["Title", session.title ?? "(untitled)"],
              ["Workspace", session.working_directory ?? "unknown"],
              ["Project", session.primary_project_id ?? "Unassigned"],
              ["Source", session.source_id],
              ["Host", session.host_id],
              ["Model", session.model ?? "unknown"],
              ["Turns", String(session.turn_count)],
              ["Updated", session.updated_at],
            ]),
          ),
          "",
          renderSection(
            "Turns",
            turns.length === 0
              ? "(no turns)"
              : turns.map((turn) => `${turn.id} ${turn.submission_started_at} ${truncateText(turn.canonical_text, 96)}`).join("\n"),
          ),
        ].join("\n"),
        json: { kind: "session", db_path: layout.dbPath, session, turns },
      };
    }

    if (target === "turn") {
      const turn = resolveTurnRef(storage, ref);
      const context = storage.getTurnContext(turn.id);
      return {
        text: [
          renderSection(
            `Turn ${turn.id}`,
            renderKeyValue([
              ["Project", turn.project_id ?? "Unassigned"],
              ["Source", turn.source_id],
              ["Session", turn.session_id],
              ["Submitted", turn.submission_started_at],
              ["Model", turn.context_summary.primary_model ?? "unknown"],
              ["Tokens", formatNumber(turn.context_summary.total_tokens ?? turn.context_summary.token_usage?.total_tokens ?? 0)],
              ["Assistant Replies", String(turn.context_summary.assistant_reply_count)],
              ["Tool Calls", String(turn.context_summary.tool_call_count)],
            ]),
          ),
          "",
          renderSection("Prompt", turn.canonical_text || "(empty)"),
          "",
          renderSection(
            "Context",
            context
              ? [
                  `assistant replies: ${context.assistant_replies.length}`,
                  `tool calls: ${context.tool_calls.length}`,
                  `system messages: ${context.system_messages.length}`,
                ].join("\n")
              : "(no context)",
          ),
        ].join("\n"),
        json: { kind: "turn", db_path: layout.dbPath, turn, context, lineage: storage.getTurnLineage(turn.id) },
      };
    }

    if (target === "source") {
      const source = resolveSourceRef(storage, ref);
      const usage = storage.getUsageOverview({ source_ids: [source.id] });
      const sessions = storage.listResolvedSessions().filter((session) => session.source_id === source.id);
      return {
        text: renderSection(
          `${source.display_name} (${source.slot_id})`,
          renderKeyValue([
            ["Source ID", source.id],
            ["Handle", formatSourceHandle(source)],
            ["Platform", source.platform],
            ["Base Dir", source.base_dir],
            ["Sessions", String(source.total_sessions)],
            ["Turns", String(source.total_turns)],
            ["Last Sync", source.last_sync ?? "never"],
            ["Status", source.sync_status],
            ["Total Tokens", formatNumber(usage.total_tokens)],
            ["Coverage", formatRatio(usage.turn_coverage_ratio)],
            ["Resolved Sessions", String(sessions.length)],
          ]),
        ),
        json: { kind: "source", db_path: layout.dbPath, source, sessions, usage },
      };
    }

    throw new Error("Use `show project|session|turn|source <ref>`.");
  } finally {
    await readStore.close();
  }
}

async function handleSearch(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const query = parsed.positionals.join(" ").trim();
  if (!query) {
    throw new Error("Search requires a query string.");
  }

  const readStore = await openReadStore(parsed, io);
  try {
    const { layout, storage } = readStore;
    const projectRef = getFlag(parsed, "project");
    const sourceRefs = getFlagValues(parsed, "source");
    const limit = parseNumberFlag(parsed, "limit") ?? 20;
    const project = projectRef ? resolveProjectRef(storage, projectRef) : undefined;
    const sourceIds = sourceRefs.length > 0 ? sourceRefs.map((ref) => resolveSourceRef(storage, ref).id) : undefined;
    const results = storage.searchTurns({
      query,
      project_id: project?.project_id,
      source_ids: sourceIds,
      limit,
    });
    const groups = groupSearchResults(results);
    const lines: string[] = [];
    for (const group of groups) {
      lines.push(`${group.label} (${group.results.length})`);
      for (const result of group.results) {
        lines.push(
          `  ${result.turn.submission_started_at} ${shortId(result.turn.id)} ${truncateText(result.turn.canonical_text, 92)}`,
        );
      }
    }
    if (lines.length > 0) {
      lines.push("");
      lines.push("Use `cchistory show turn <shown-id>` to inspect a full turn.");
    }
    return {
      text: lines.length > 0 ? lines.join("\n") : "(no matches)",
      json: { kind: "search", db_path: layout.dbPath, query, results },
    };
  } finally {
    await readStore.close();
  }
}

async function handleStats(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const [target] = parsed.positionals;
  const readStore = await openReadStore(parsed, io);
  try {
    const { layout, storage } = readStore;
    const showAll = hasFlag(parsed, "showall");
    if (!target) {
      return createStatsOverviewOutput(layout, storage, showAll);
    }

    if (target === "usage") {
      const dimension = (getFlag(parsed, "by") ?? "model") as UsageStatsDimension;
      return createStatsUsageOutput(layout, storage, dimension, showAll);
    }

    throw new Error("Use `stats` or `stats usage --by <dimension>`.");
  } finally {
    await readStore.close();
  }
}

function renderUsageCharts(
  rows: Array<{
    label: string;
    total_input_tokens: number;
    total_cached_input_tokens: number;
    total_output_tokens: number;
    total_tokens: number;
  }>,
  dimension: "day" | "month",
): string {
  const metrics = [
    {
      title: "Input Tokens",
      values: rows.map((row) => ({ label: row.label, value: row.total_input_tokens })),
    },
    {
      title: "Cached Input Tokens",
      values: rows.map((row) => ({ label: row.label, value: row.total_cached_input_tokens })),
    },
    {
      title: "Output Tokens",
      values: rows.map((row) => ({ label: row.label, value: row.total_output_tokens })),
    },
    {
      title: "Total Tokens",
      values: rows.map((row) => ({ label: row.label, value: row.total_tokens })),
    },
  ];

  return renderSection(
    `${dimension === "day" ? "Daily" : "Monthly"} Token Charts`,
    metrics
      .map((metric) => renderSection(metric.title, renderBarChart(metric.values)))
      .map((section) => indentBlock(section, 2))
      .join("\n\n"),
  );
}

function formatUsageRollupLabel(dimension: UsageStatsDimension, label: string): string {
  if (dimension === "model" && label === "<synthetic>") {
    return "Synthetic Error Reply";
  }
  return label;
}

function renderUsageNotes(
  rows: Array<{
    label: string;
  }>,
  dimension: UsageStatsDimension,
): string | undefined {
  if (dimension !== "model" || !rows.some((row) => row.label === "<synthetic>")) {
    return undefined;
  }

  return renderSection(
    "Notes",
    "Synthetic Error Reply rows are system-generated local/API error messages preserved as evidence, not provider model calls.",
  );
}

async function handleExport(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  return executeExportCommand(parsed, io);
}

async function handleBackup(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const dryRun = hasFlag(parsed, "dry-run");
  const shouldWrite = hasFlag(parsed, "write") && !dryRun;
  const mode = shouldWrite ? "write" : "preview";
  const exportOutput = await executeExportCommand(parsed, io, {
    dryRun: !shouldWrite,
  });
  return {
    text: [
      renderKeyValue([
        ["Workflow", "backup"],
        ["Mode", mode],
      ]),
      "",
      exportOutput.text,
    ].join("\n"),
    json: {
      kind: "backup",
      mode,
      export: exportOutput.json,
    },
  };
}

async function handleRestoreCheck(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  if (parsed.positionals.length > 0) {
    throw new Error("`restore-check` does not take positional arguments.");
  }
  if (!hasFlag(parsed, "store") && !hasFlag(parsed, "db")) {
    throw new Error("`restore-check` requires an explicit --store or --db target.");
  }
  if (hasFlag(parsed, "full")) {
    throw new Error("`restore-check` does not support --full; it verifies the indexed restored store only.");
  }
  if (getFlagValues(parsed, "source").length > 0) {
    throw new Error("`restore-check` does not support --source filters; it verifies all restored sources together.");
  }

  const layout = resolveStoreLayout({
    cwd: io.cwd,
    storeArg: getFlag(parsed, "store"),
    dbArg: getFlag(parsed, "db"),
  });
  await requireStoreDatabase(layout.dbPath);
  const storage = await openStorage(layout);

  try {
    const showAll = hasFlag(parsed, "showall");
    const statsOutput = createStatsOverviewOutput(layout, storage, showAll);
    const sourcesOutput = createSourcesListOutput(layout, storage);
    return {
      text: [
        renderSection(
          "Restore Check",
          renderKeyValue([
            ["Target", layout.dbPath],
            ["Read Mode", "index"],
          ]),
        ),
        "",
        renderSection("Store Overview", statsOutput.text),
        "",
        renderSection("Source Presence", sourcesOutput.text),
      ].join("\n"),
      json: {
        kind: "restore-check",
        db_path: layout.dbPath,
        read_mode: "index",
        stats: statsOutput.json,
        sources: sourcesOutput.json,
      },
    };
  } finally {
    storage.close();
  }
}

async function executeExportCommand(
  parsed: ParsedArgs,
  io: CliIo,
  options: {
    dryRun?: boolean;
  } = {},
): Promise<CommandOutput> {
  const outDir = requireFlag(parsed, "out");
  const includeRawBlobs = !hasFlag(parsed, "no-raw");
  const sourceRefs = getFlagValues(parsed, "source");
  const dryRun = options.dryRun ?? hasFlag(parsed, "dry-run");
  const { layout, storage } = await openExistingStore(parsed, io);
  try {
    const selectedSourceIds = sourceRefs.length > 0 ? sourceRefs.map((ref) => resolveSourceRef(storage, ref).id) : undefined;
    const selectedPayloads = storage
      .listSourcePayloads()
      .filter((payload) => (selectedSourceIds && selectedSourceIds.length > 0 ? selectedSourceIds.includes(payload.source.id) : true));

    if (dryRun) {
      const counts = selectedPayloads.reduce(
        (totals, payload) => ({
          sources: totals.sources + 1,
          sessions: totals.sessions + payload.sessions.length,
          turns: totals.turns + payload.turns.length,
          blobs: totals.blobs + payload.blobs.length,
        }),
        { sources: 0, sessions: 0, turns: 0, blobs: 0 },
      );
      return {
        text: [
          renderKeyValue([
            ["DB", layout.dbPath],
            ["Bundle", path.resolve(io.cwd, outDir)],
            ["Sources", String(counts.sources)],
            ["Sessions", String(counts.sessions)],
            ["Turns", String(counts.turns)],
            ["Blobs", String(counts.blobs)],
            ["Includes Raw", String(includeRawBlobs)],
          ]),
          "",
          renderExportPlanTable(selectedPayloads),
        ].join("\n"),
        json: {
          kind: "export-dry-run",
          db_path: layout.dbPath,
          bundle_dir: path.resolve(io.cwd, outDir),
          includes_raw_blobs: includeRawBlobs,
          counts,
          sources: selectedPayloads.map((payload) => payload.source),
        },
      };
    }

    const result = await exportBundle({
      storage,
      bundleDir: path.resolve(io.cwd, outDir),
      sourceIds: selectedSourceIds,
      includeRawBlobs,
    });
    return {
      text: renderKeyValue([
        ["Bundle", path.resolve(io.cwd, outDir)],
        ["Bundle ID", result.manifest.bundle_id],
        ["Sources", String(result.manifest.counts.sources)],
        ["Sessions", String(result.manifest.counts.sessions)],
        ["Turns", String(result.manifest.counts.turns)],
        ["Blobs", String(result.manifest.counts.blobs)],
        ["Includes Raw", String(result.manifest.includes_raw_blobs)],
      ]),
      json: {
        kind: "export",
        db_path: layout.dbPath,
        manifest: result.manifest,
        checksums: result.checksums,
      },
    };
  } finally {
    storage.close();
  }
}

async function handleImport(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const [bundleDir] = parsed.positionals;
  if (!bundleDir) {
    throw new Error("Import requires a bundle directory.");
  }
  const mode = (getFlag(parsed, "on-conflict") ?? "error") as "error" | "skip" | "replace";
  if (!["error", "skip", "replace"].includes(mode)) {
    throw new Error("`import --on-conflict` must be one of error, skip, replace.");
  }

  const layout = resolveStoreLayout({
    cwd: io.cwd,
    storeArg: getFlag(parsed, "store"),
    dbArg: getFlag(parsed, "db"),
  });
  const resolvedBundleDir = path.resolve(io.cwd, bundleDir);
  const dryRun = hasFlag(parsed, "dry-run");
  const targetStoreExists = await pathExists(layout.dbPath);
  let storage: CCHistoryStorage;
  if (dryRun && !targetStoreExists) {
    storage = await createStorage({ dbPath: ":memory:" });
  } else {
    if (!dryRun) {
      await mkdir(layout.assetDir, { recursive: true });
      await mkdir(layout.rawDir, { recursive: true });
    }
    storage = await openStorage(layout);
  }

  try {
    if (dryRun) {
      const plan = await planBundleImport({
        storage,
        bundleDir: resolvedBundleDir,
        onConflict: mode,
      });
      return {
        text: [
          renderKeyValue([
            ["Target DB", layout.dbPath],
            ["Target Exists", String(targetStoreExists)],
            ["Bundle", resolvedBundleDir],
            ["Bundle ID", plan.manifest.bundle_id],
            ["Conflict Mode", mode],
            ["Would Import", String(plan.imported_source_ids.length)],
            ["Would Replace", String(plan.replaced_source_ids.length)],
            ["Would Skip", String(plan.skipped_source_ids.length)],
            ["Would Conflict", String(plan.conflicting_source_ids.length)],
            ["Would Fail", String(plan.would_fail)],
          ]),
          "",
          renderImportPlanTable(plan),
        ].join("\n"),
        json: {
          kind: "import-dry-run",
          db_path: layout.dbPath,
          target_exists: targetStoreExists,
          ...plan,
        },
      };
    }

    const result = await importBundleIntoStore({
      storage,
      bundleDir: resolvedBundleDir,
      rawDir: layout.rawDir,
      onConflict: mode,
    });
    const rawGc = await pruneOrphanRawSnapshotsSafe({
      storage,
      rawDir: layout.rawDir,
    });
    return {
      text: renderKeyValue([
        ["DB", layout.dbPath],
        ["Bundle ID", result.manifest.bundle_id],
        ["Imported Sources", String(result.imported_source_ids.length)],
        ["Replaced Sources", String(result.replaced_source_ids.length)],
        ["Skipped Sources", String(result.skipped_source_ids.length)],
        ["Projects Before", String(result.project_count_before)],
        ["Projects After", String(result.project_count_after)],
        ["Raw GC Deleted Files", formatNumber(rawGc.deleted_files)],
        ["Raw GC Deleted Bytes", formatBytes(rawGc.deleted_bytes)],
      ]),
      json: {
        kind: "import",
        db_path: layout.dbPath,
        raw_gc: rawGc,
        ...result,
      },
    };
  } finally {
    storage.close();
  }
}

async function handleMergeAlias(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const fromPath = requireFlag(parsed, "from");
  const toPath = requireFlag(parsed, "to");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-merge-"));
  const fromLayout = resolveStoreLayout({ cwd: io.cwd, dbArg: fromPath });
  const toLayout = resolveStoreLayout({ cwd: io.cwd, dbArg: toPath });
  const sourceRefs = getFlagValues(parsed, "source");
  const conflictMode = (getFlag(parsed, "on-conflict") ?? "replace") as "skip" | "replace";

  const sourceStorage = await openStorage(fromLayout);
  const targetStorage = await openStorage(toLayout);
  try {
    const selectedSourceIds = sourceRefs.length > 0 ? sourceRefs.map((ref) => resolveSourceRef(sourceStorage, ref).id) : undefined;
    await exportBundle({
      storage: sourceStorage,
      bundleDir: tempDir,
      sourceIds: selectedSourceIds,
      includeRawBlobs: true,
    });
    const imported = await importBundleIntoStore({
      storage: targetStorage,
      bundleDir: tempDir,
      rawDir: toLayout.rawDir,
      onConflict: conflictMode === "replace" ? "replace" : "skip",
    });
    const rawGc = await pruneOrphanRawSnapshotsSafe({
      storage: targetStorage,
      rawDir: toLayout.rawDir,
    });
    return {
      text: [
        `Merged via bundle compatibility path: imported=${imported.imported_source_ids.length} replaced=${imported.replaced_source_ids.length} skipped=${imported.skipped_source_ids.length}`,
        "",
        renderSection("Raw GC", renderRawGcSummary(rawGc)),
      ].join("\n"),
      json: {
        ...imported,
        raw_gc: rawGc,
      },
    };
  } finally {
    sourceStorage.close();
    targetStorage.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function handleGc(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const dryRun = hasFlag(parsed, "dry-run");
  const layout = resolveStoreLayout({
    cwd: io.cwd,
    storeArg: getFlag(parsed, "store"),
    dbArg: getFlag(parsed, "db"),
  });
  await requireStoreDatabase(layout.dbPath);
  const storage = await openStorage(layout);
  try {
    const result = await pruneOrphanRawSnapshotsSafe({
      storage,
      rawDir: layout.rawDir,
      dryRun,
    });
    return {
      text: renderKeyValue([
        ["DB", layout.dbPath],
        ["Raw Dir", layout.rawDir],
        ["Dry Run", String(dryRun)],
        ["Scanned Files", formatNumber(result.scanned_files)],
        ["Referenced Files", formatNumber(result.referenced_files)],
        ["Deleted Files", formatNumber(result.deleted_files)],
        ["Deleted Bytes", formatBytes(result.deleted_bytes)],
        ["Removed Dirs", formatNumber(result.removed_dirs)],
      ]),
      json: {
        kind: "gc",
        db_path: layout.dbPath,
        raw_dir: layout.rawDir,
        dry_run: dryRun,
        result,
      },
    };
  } finally {
    storage.close();
  }
}

async function handleQueryAlias(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const [target] = parsed.positionals;
  const readStore = await openReadStore(parsed, io);
  try {
    const { storage } = readStore;
    switch (target) {
      case "turns": {
        const query = getFlag(parsed, "search");
        const projectId = getFlag(parsed, "project");
        const sourceIds = getFlagValues(parsed, "source");
        const limit = parseNumberFlag(parsed, "limit") ?? 20;
        const json = query
          ? storage.searchTurns({
              query,
              project_id: projectId,
              source_ids: sourceIds.length > 0 ? sourceIds : undefined,
              limit,
            })
          : storage
              .listResolvedTurns()
              .filter((turn) => (projectId ? turn.project_id === projectId : true))
              .filter((turn) => (sourceIds.length > 0 ? sourceIds.includes(turn.source_id) : true))
              .slice(0, limit);
        return {
          text: JSON.stringify(json, null, 2),
          json,
        };
      }
      case "turn": {
        const turnRef = requireFlag(parsed, "id");
        const turn = resolveTurnRef(storage, turnRef);
        const json = {
          turn,
          context: storage.getTurnContext(turn.id),
          lineage: storage.getTurnLineage(turn.id),
        };
        return { text: JSON.stringify(json, null, 2), json };
      }
      case "sessions": {
        const projectId = getFlag(parsed, "project");
        const sourceIds = getFlagValues(parsed, "source");
        const limit = parseNumberFlag(parsed, "limit") ?? 20;
        const json = storage
          .listResolvedSessions()
          .filter((session) => (projectId ? session.primary_project_id === projectId : true))
          .filter((session) => (sourceIds.length > 0 ? sourceIds.includes(session.source_id) : true))
          .slice(0, limit);
        return { text: JSON.stringify(json, null, 2), json };
      }
      case "session": {
        const sessionRef = requireFlag(parsed, "id");
        const session = resolveSessionRef(storage, sessionRef);
        const json = {
          session,
          turns: storage.listResolvedTurns().filter((turn) => turn.session_id === session.id),
        };
        return { text: JSON.stringify(json, null, 2), json };
      }
      case "projects": {
        const json = listVisibleProjects(storage, parsed);
        return { text: JSON.stringify(json, null, 2), json };
      }
      case "project": {
        const projectId = requireFlag(parsed, "id");
        const json = {
          project: storage.getProject(projectId),
          turns: storage.listProjectTurns(projectId, (getFlag(parsed, "link-state") as "all" | "committed" | "candidate" | "unlinked" | undefined) ?? "all"),
        };
        return { text: JSON.stringify(json, null, 2), json };
      }
      default:
        throw new Error("Unsupported query target.");
    }
  } finally {
    await readStore.close();
  }
}

async function handleTemplates(): Promise<CommandOutput> {
  const json = getSourceFormatProfiles();
  return {
    text: JSON.stringify(json, null, 2),
    json,
  };
}

function renderExportPlanTable(payloads: SourceSyncPayload[]): string {
  if (payloads.length === 0) {
    return "(no sources selected)";
  }
  return renderTable(
    ["Source", "Handle", "Host", "Sessions", "Turns", "Blobs"],
    payloads.map((payload) => [
      payload.source.display_name,
      payload.source.slot_id,
      shortId(payload.source.host_id),
      String(payload.sessions.length),
      String(payload.turns.length),
      String(payload.blobs.length),
    ]),
  );
}

function renderImportPlanTable(plan: {
  source_plans: Array<{
    display_name: string;
    slot_id: string;
    host_id: string;
    counts: { sessions: number; turns: number; blobs: number };
    action: string;
    reason: string;
  }>;
}): string {
  if (plan.source_plans.length === 0) {
    return "(bundle has no sources)";
  }
  return renderTable(
    ["Source", "Handle", "Host", "Sessions", "Turns", "Blobs", "Action", "Reason"],
    plan.source_plans.map((entry) => [
      entry.display_name,
      entry.slot_id,
      shortId(entry.host_id),
      String(entry.counts.sessions),
      String(entry.counts.turns),
      String(entry.counts.blobs),
      entry.action,
      entry.reason,
    ]),
  );
}

function groupSearchResults(results: TurnSearchResult[]): Array<{ label: string; results: TurnSearchResult[] }> {
  const groups = new Map<string, TurnSearchResult[]>();
  for (const result of results) {
    const label =
      result.project && result.project.linkage_state === "committed" ? result.project.display_name : "Unassigned";
    const current = groups.get(label) ?? [];
    current.push(result);
    groups.set(label, current);
  }
  return [...groups.entries()]
    .map(([label, groupedResults]) => ({ label, results: groupedResults }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function resolveProjectRef(storage: CCHistoryStorage, ref: string): ProjectIdentity {
  const projects = storage.listProjects();
  const direct = projects.find((project) => project.project_id === ref);
  if (direct) {
    return direct;
  }
  const slugMatches = projects.filter((project) => project.slug === ref);
  if (slugMatches.length === 1) {
    return slugMatches[0]!;
  }
  throw new Error(`Unknown project reference: ${ref}`);
}

function resolveSessionRef(storage: CCHistoryStorage, ref: string): SessionProjection {
  const direct = storage.getResolvedSession(ref) ?? storage.getSession(ref);
  if (direct) {
    return direct;
  }

  const sessions = storage.listResolvedSessions();
  const normalizedRef = normalizeSessionRefToken(ref);

  const prefixMatch = resolveUniqueSessionMatch(ref, sessions.filter((session) => session.id.startsWith(ref)), "ID prefix");
  if (prefixMatch) {
    return prefixMatch;
  }

  const titleMatch = resolveUniqueSessionMatch(
    ref,
    sessions.filter((session) => normalizeSessionRefToken(session.title) === normalizedRef),
    "title",
  );
  if (titleMatch) {
    return titleMatch;
  }

  const normalizedWorkspaceRef = normalizeSessionPathRefToken(ref);
  const workspaceMatch = resolveUniqueSessionMatch(
    ref,
    sessions.filter((session) => {
      if (!session.working_directory || !normalizedWorkspaceRef) {
        return false;
      }
      const normalizedWorkspace = normalizeSessionPathRefToken(session.working_directory);
      const normalizedBasename = normalizeSessionPathRefToken(getLocalPathBasename(session.working_directory));
      return normalizedWorkspace === normalizedWorkspaceRef || normalizedBasename === normalizedWorkspaceRef;
    }),
    "workspace",
  );
  if (workspaceMatch) {
    return workspaceMatch;
  }

  throw new Error(`Unknown session reference: ${ref}`);
}

function resolveTurnRef(storage: CCHistoryStorage, ref: string): UserTurnProjection {
  const direct = storage.getResolvedTurn(ref) ?? storage.getTurn(ref);
  if (direct) {
    return direct;
  }

  const turns = storage.listResolvedTurns();

  const exactAliasMatch = resolveUniqueTurnMatch(
    ref,
    turns.filter(
      (turn) =>
        turn.turn_id === ref ||
        turn.revision_id === ref ||
        turn.turn_revision_id === ref,
    ),
    "ID",
  );
  if (exactAliasMatch) {
    return exactAliasMatch;
  }

  const prefixMatch = resolveUniqueTurnMatch(
    ref,
    turns.filter(
      (turn) =>
        turn.id.startsWith(ref) ||
        turn.turn_id?.startsWith(ref) ||
        turn.revision_id.startsWith(ref) ||
        turn.turn_revision_id?.startsWith(ref),
    ),
    "ID prefix",
  );
  if (prefixMatch) {
    return prefixMatch;
  }

  throw new Error(`Unknown turn reference: ${ref}`);
}

function resolveUniqueSessionMatch(
  ref: string,
  matches: SessionProjection[],
  matchKind: string,
): SessionProjection | undefined {
  if (matches.length === 0) {
    return undefined;
  }
  if (matches.length === 1) {
    return matches[0]!;
  }
  const preview = matches.slice(0, 3).map(formatSessionRefPreview).join(", ");
  const remainder = matches.length > 3 ? ` (+${matches.length - 3} more)` : "";
  throw new Error(`Ambiguous session reference: ${ref}. Matched ${matchKind} ${preview}${remainder}`);
}

function resolveUniqueTurnMatch(
  ref: string,
  matches: UserTurnProjection[],
  matchKind: string,
): UserTurnProjection | undefined {
  if (matches.length === 0) {
    return undefined;
  }
  if (matches.length === 1) {
    return matches[0]!;
  }
  const preview = matches.slice(0, 3).map(formatTurnRefPreview).join(", ");
  const remainder = matches.length > 3 ? ` (+${matches.length - 3} more)` : "";
  throw new Error(`Ambiguous turn reference: ${ref}. Matched ${matchKind} ${preview}${remainder}`);
}

function formatSessionRefPreview(session: SessionProjection): string {
  const parts = [session.id];
  if (session.title) {
    parts.push(`title=${JSON.stringify(session.title)}`);
  }
  if (session.working_directory) {
    parts.push(`workspace=${JSON.stringify(session.working_directory)}`);
  }
  return parts.join(" ");
}

function formatTurnRefPreview(turn: UserTurnProjection): string {
  return `${turn.id} submitted=${turn.submission_started_at} prompt=${JSON.stringify(truncateText(turn.canonical_text, 48))}`;
}

function normalizeSessionRefToken(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeSessionPathRefToken(value: string | undefined): string {
  const normalizedPath = normalizeLocalPathIdentity(value);
  return (normalizedPath ?? value)?.trim().toLowerCase() ?? "";
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function resolveSourceRef(storage: CCHistoryStorage, ref: string): SourceStatus {
  const sources = storage.listSources();
  const direct = sources.find((source) => source.id === ref);
  if (direct) {
    return direct;
  }
  const handleMatches = sources.filter((source) => formatSourceHandle(source) === ref);
  if (handleMatches.length === 1) {
    return handleMatches[0]!;
  }
  const slotMatches = sources.filter((source) => source.slot_id === ref);
  if (slotMatches.length === 1) {
    return slotMatches[0]!;
  }
  throw new Error(`Unknown source reference: ${ref}`);
}

type ReadStoreFactory = (parsed: ParsedArgs, io: CliIo) => Promise<OpenedReadStore>;

let readStoreFactory: ReadStoreFactory = openReadStoreDefault;

export function interceptReadStoreFactoryForTests(wrapper: (next: ReadStoreFactory) => ReadStoreFactory): () => void {
  const previousFactory = readStoreFactory;
  readStoreFactory = wrapper(previousFactory);
  return () => {
    readStoreFactory = previousFactory;
  };
}

async function openReadStore(parsed: ParsedArgs, io: CliIo): Promise<OpenedReadStore> {
  return readStoreFactory(parsed, io);
}

async function openReadStoreDefault(parsed: ParsedArgs, io: CliIo): Promise<OpenedReadStore> {
  const baseLayout = resolveStoreLayout({
    cwd: io.cwd,
    storeArg: getFlag(parsed, "store"),
    dbArg: getFlag(parsed, "db"),
  });
  const readMode = resolveReadMode(parsed);
  if (readMode === "index") {
    const storage = await openStorage(baseLayout);
    return {
      layout: baseLayout,
      storage,
      close: async () => {
        storage.close();
      },
    };
  }

  const storage = await createStorage({ dbPath: ":memory:" });
  const layout: StoreLayout = {
    ...baseLayout,
    dbPath: `${baseLayout.dbPath} (full scan in memory)`,
  };

  try {
    await syncSelectedSources({
      layout,
      storage,
      sourceRefs: getFlagValues(parsed, "source"),
      limitFiles: parseNumberFlag(parsed, "limit-files"),
      snapshotRawBlobs: false,
    });
    return {
      layout,
      storage,
      close: async () => {
        storage.close();
      },
    };
  } catch (error) {
    storage.close();
    throw error;
  }
}

async function openExistingStore(parsed: ParsedArgs, io: CliIo): Promise<{ layout: StoreLayout; storage: CCHistoryStorage }> {
  const layout = resolveStoreLayout({
    cwd: io.cwd,
    storeArg: getFlag(parsed, "store"),
    dbArg: getFlag(parsed, "db"),
  });
  return {
    layout,
    storage: await openStorage(layout),
  };
}

async function requireStoreDatabase(dbPath: string): Promise<void> {
  try {
    await access(dbPath);
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new Error(`Store not found: ${dbPath}. Run \`cchistory sync\` or \`cchistory import\` first.`);
    }
    throw error;
  }
}

function renderRawGcSummary(result: RawSnapshotGcResult): string {
  return renderKeyValue([
    ["Scanned Files", formatNumber(result.scanned_files)],
    ["Referenced Files", formatNumber(result.referenced_files)],
    ["Deleted Files", formatNumber(result.deleted_files)],
    ["Deleted Bytes", formatBytes(result.deleted_bytes)],
    ["Removed Dirs", formatNumber(result.removed_dirs)],
  ]);
}

function formatBytes(value: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const decimals = unitIndex === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(decimals)} ${units[unitIndex]}`;
}

async function syncSelectedSources(input: {
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
    return {
      host: result.host,
      syncedSources: [],
    };
  }

  let host: Awaited<ReturnType<typeof runSourceProbe>>["host"] | undefined;
  const syncedSources: SyncedSourceSummary[] = [];
  for (const source of sources) {
    // Probe one source at a time so sync does not retain every source payload in memory at once.
    const result = await runSourceProbe(
      {
        source_ids: [source.id],
        limit_files_per_source: input.limitFiles,
      },
      [source],
    );
    host ??= result.host;
    for (const payload of result.sources) {
      const persistedPayload = input.snapshotRawBlobs ? await snapshotPayloadRawBlobs(input.layout.rawDir, payload) : payload;
      input.storage.replaceSourcePayload(persistedPayload, { allow_host_rekey: true });
      syncedSources.push(summarizeSyncedSource(persistedPayload));
    }
  }

  return {
    host: host!,
    syncedSources,
  };
}

function summarizeSyncedSource(payload: SourceSyncPayload): SyncedSourceSummary {
  return {
    source: payload.source,
    counts: {
      sessions: payload.sessions.length,
      turns: payload.turns.length,
      records: payload.records.length,
      fragments: payload.fragments.length,
      atoms: payload.atoms.length,
      blobs: payload.blobs.length,
    },
  };
}

function applySourceSelection(sources: SourceDefinition[], selectedRefs: string[]): SourceDefinition[] {
  if (selectedRefs.length === 0) {
    return sources;
  }
  return sources.filter((source) => selectedRefs.includes(source.id) || selectedRefs.includes(source.slot_id));
}

function applySourceDiscoverySelection(entries: HostDiscoveryEntry[], selectedRefs: string[]): HostDiscoveryEntry[] {
  if (selectedRefs.length === 0) {
    return entries;
  }
  const sourceIdsBySlot = new Map(
    getDefaultSourcesForHost({ includeMissing: true }).map((source) => [source.slot_id, source.id] as const),
  );
  return entries.filter((entry) => {
    const sourceId = entry.slot_id ? sourceIdsBySlot.get(entry.slot_id) : undefined;
    return selectedRefs.includes(entry.key) || (entry.slot_id ? selectedRefs.includes(entry.slot_id) : false) || (sourceId ? selectedRefs.includes(sourceId) : false);
  });
}

function resolveReadMode(parsed: ParsedArgs): ReadMode {
  const wantsIndex = hasFlag(parsed, "index");
  const wantsFull = hasFlag(parsed, "full");
  if (wantsIndex && wantsFull) {
    throw new Error("Use either --index or --full, not both.");
  }
  return wantsFull ? "full" : "index";
}

function normalizeCommand(command: string | undefined): string | undefined {
  if (!command || command === "help" || command === "--help") {
    return undefined;
  }
  if (command === "collect") {
    return "sync";
  }
  return command;
}

function formatDiscoveryCapability(value: HostDiscoveryEntry["capability"]): string {
  return value === "sync" ? "sync" : "discover-only";
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function projectStatusLabel(project: ProjectIdentity): string {
  return project.linkage_state === "committed" ? "ready" : "tentative";
}

function projectLabel(project: ProjectIdentity | undefined): string {
  return project ? `${project.display_name} [${projectStatusLabel(project)}]` : "Unassigned";
}

function listVisibleProjects(storage: CCHistoryStorage, parsed: ParsedArgs): ProjectIdentity[] {
  return sortProjectsForDisplay(filterProjectsForDisplay(storage.listProjects(), parsed));
}

function filterProjectsForDisplay(projects: ProjectIdentity[], parsed: ParsedArgs): ProjectIdentity[] {
  if (hasFlag(parsed, "showall")) {
    return projects;
  }
  return projects.filter((project) => !isEmptyProject(project));
}

function isEmptyProject(project: ProjectIdentity): boolean {
  return project.session_count === 0 && project.committed_turn_count === 0 && project.candidate_turn_count === 0;
}

function sortProjectsForDisplay(projects: ProjectIdentity[]): ProjectIdentity[] {
  return [...projects].sort((left, right) => {
    const leftTurns = left.committed_turn_count + left.candidate_turn_count;
    const rightTurns = right.committed_turn_count + right.candidate_turn_count;
    if (leftTurns !== rightTurns) {
      return rightTurns - leftTurns;
    }
    if (left.session_count !== right.session_count) {
      return right.session_count - left.session_count;
    }
    const activityCompare = (right.project_last_activity_at ?? right.updated_at).localeCompare(
      left.project_last_activity_at ?? left.updated_at,
    );
    if (activityCompare !== 0) {
      return activityCompare;
    }
    return left.display_name.localeCompare(right.display_name);
  });
}

function formatSourceHandle(source: SourceStatus): string {
  return `${source.slot_id}@${source.host_id}`;
}

function defaultIo(): CliIo {
  return {
    cwd: process.cwd(),
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  };
}

function printOutput(output: CommandOutput, jsonMode: boolean, io: CliIo): void {
  const value = jsonMode ? JSON.stringify(output.json, null, 2) : output.text;
  io.stdout(`${value}\n`);
}

function parseArgs(args: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  let forcePositionals = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }
    if (token === "--") {
      if (index === 0) {
        continue;
      }
      forcePositionals = true;
      continue;
    }
    if (forcePositionals || !token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const body = token.slice(2);
    const separatorIndex = body.indexOf("=");
    const key = separatorIndex >= 0 ? body.slice(0, separatorIndex) : body;
    const inlineValue = separatorIndex >= 0 ? body.slice(separatorIndex + 1) : undefined;
    let value = inlineValue;
    if (value === undefined) {
      const next = args[index + 1];
      if (next && !next.startsWith("--")) {
        value = next;
        index += 1;
      } else {
        value = "true";
      }
    }
    flags.set(key, [...(flags.get(key) ?? []), value]);
  }
  return { positionals, flags };
}

function getFlag(parsed: ParsedArgs, key: string): string | undefined {
  return parsed.flags.get(key)?.[0];
}

function getFlagValues(parsed: ParsedArgs, key: string): string[] {
  return parsed.flags.get(key) ?? [];
}

function hasFlag(parsed: ParsedArgs, key: string): boolean {
  return parsed.flags.has(key);
}

function requireFlag(parsed: ParsedArgs, key: string): string {
  const value = getFlag(parsed, key);
  if (!value || value === "true") {
    throw new Error(`Missing required --${key} flag.`);
  }
  return value;
}

function parseNumberFlag(parsed: ParsedArgs, key: string): number | undefined {
  const value = getFlag(parsed, key);
  if (!value || value === "true") {
    return undefined;
  }
  const parsedNumber = Number(value);
  if (!Number.isFinite(parsedNumber)) {
    throw new Error(`Invalid numeric value for --${key}: ${value}`);
  }
  return parsedNumber;
}

function renderHelp(): string {
  return [
    "Usage:",
    "  cchistory sync [--store <dir> | --db <file>] [--source <slot-or-id>] [--limit-files <n>] [--dry-run]",
    "  cchistory discover [--showall]",
    "  cchistory health [--store <dir> | --db <file>] [--source <slot-or-id>] [--index | --full] [--limit-files <n>] [--showall]",
    "  cchistory ls projects|sessions|sources [--store <dir> | --db <file>] [--index | --full] [--showall]",
    "  cchistory tree projects [--store <dir> | --db <file>] [--index | --full] [--showall]",
    "  cchistory tree project <project-id-or-slug> [--store <dir> | --db <file>] [--index | --full]",
    "  cchistory show project|session|turn|source <ref> [--store <dir> | --db <file>] [--index | --full]",
    "    turn refs accept full IDs or unique shown prefixes",
    "  cchistory search <query> [--store <dir> | --db <file>] [--index | --full] [--project <project>] [--source <source>] [--limit <n>]",
    "  cchistory stats [--store <dir> | --db <file>] [--index | --full]",
    "  cchistory stats usage --by model|project|source|host|day|month [--store <dir> | --db <file>] [--index | --full]",
    "  cchistory export --out <bundle-dir> [--store <dir> | --db <file>] [--source <source>] [--no-raw] [--dry-run]",
    "  cchistory backup --out <bundle-dir> [--store <dir> | --db <file>] [--source <source>] [--no-raw] [--dry-run] [--write]",
    "  cchistory restore-check (--store <dir> | --db <file>) [--showall]",
    "  cchistory import <bundle-dir> [--store <dir> | --db <file>] [--on-conflict error|skip|replace] [--dry-run]",
    "  cchistory gc [--store <dir> | --db <file>] [--dry-run]",
    "",
    "Global options:",
    "  --store <dir>   Use a store directory (db is <dir>/cchistory.sqlite)",
    "  --db <file>     Use an explicit sqlite file; sidecar data lives beside it",
    "  --index         Read from the existing store only (default for read commands)",
    "  --full          Re-scan default source roots into a temporary store before reading",
    "  --showall       Include empty projects in listings and missing candidates in discover output",
    "  --json          Print machine-readable JSON",
    "  --dry-run       Preview sync, import, gc, or backup actions without writing",
    "  --write         Execute the write step for preview-first workflows like backup",
    "  --verbose       Reserved for detailed diagnostics",
    "",
    "Default store resolution:",
    "  nearest existing .cchistory/ in the current or ancestor directories; otherwise ~/.cchistory",
  ].join("\n");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
