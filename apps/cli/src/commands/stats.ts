import {
  type UsageStatsDimension,
} from "@cchistory/domain";
import type { CCHistoryStorage } from "@cchistory/storage";
import {
  getFlag,
  hasFlag,
  type ParsedArgs,
} from "../args.js";
import {
  formatNumber,
  formatRatio,
  renderBarChart,
  renderKeyValue,
  renderTable,
  colorizeValue,
} from "../renderers.js";
import { type StoreLayout } from "../store.js";
import {
  type CliIo,
  type CommandOutput,
  openReadStore,
} from "../main.js";

export async function handleStats(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const readStore = await openReadStore(parsed, io);
  const showAll = hasFlag(parsed, "showall");

  try {
    const dimension = getFlag(parsed, "by") as UsageStatsDimension | undefined;
    if (dimension) {
      return createStatsUsageOutput(readStore.layout, readStore.storage, dimension, showAll);
    }
    return createStatsOverviewOutput(readStore.layout, readStore.storage, showAll);
  } finally {
    await readStore.close();
  }
}

export function createStatsOverviewOutput(layout: StoreLayout, storage: CCHistoryStorage, showAll: boolean, selectedSourceIds?: string[]): CommandOutput {
  const usageFilters = { include_known_zero_token: showAll, source_ids: selectedSourceIds };
  const overview = storage.getUsageOverview(usageFilters);
  const schema = storage.getSchemaInfo();
  const sources = storage.listSources().filter((source) => !selectedSourceIds || selectedSourceIds.includes(source.id));
  const sessions = storage.listResolvedSessions().filter((session) => !selectedSourceIds || selectedSourceIds.includes(session.source_id));
  const turns = storage.listResolvedTurns().filter((turn) => !selectedSourceIds || selectedSourceIds.includes(turn.source_id));
  const projectIds = new Set(sessions.map((session) => session.primary_project_id).filter((value): value is string => Boolean(value)));
  const projects = storage.listProjects().filter((project) => projectIds.has(project.project_id));
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
        ["Sources", colorizeValue(String(sources.length))],
        ["Projects", colorizeValue(String(projects.length))],
        ["Sessions", colorizeValue(String(sessions.length))],
        ["Turns", colorizeValue(String(turns.length))],
        ["Turns With Tokens", colorizeValue(`${overview.turns_with_token_usage}/${overview.total_turns}`)],
        ["Coverage", colorizeValue(formatRatio(overview.turn_coverage_ratio))],
        ["Input Tokens", colorizeValue(formatNumber(overview.total_input_tokens))],
        ["Cached Input Tokens", colorizeValue(formatNumber(overview.total_cached_input_tokens))],
        ["Output Tokens", colorizeValue(formatNumber(overview.total_output_tokens))],
        ["Reasoning Tokens", colorizeValue(formatNumber(overview.total_reasoning_output_tokens))],
        ["Total Tokens", colorizeValue(formatNumber(overview.total_tokens))],
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

export function createStatsUsageOutput(
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
        { align: ["left", "right", "right", "right", "right", "right", "right"] },
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

function renderUsageCharts(
  rows: Array<{ label: string; total_tokens: number; turn_count: number }>,
  dimension: "day" | "month",
): string {
  const chartTitle = dimension === "day" ? "Daily Token Usage" : "Monthly Token Usage";
  const activityTitle = dimension === "day" ? "Daily Turn Activity" : "Monthly Turn Activity";
  const limit = dimension === "day" ? 14 : 12;
  const chartRows = [...rows].reverse().slice(0, limit);
  return [
    chartTitle,
    renderBarChart(chartRows.map((row) => ({ label: row.label, value: row.total_tokens }))),
    "",
    activityTitle,
    renderBarChart(chartRows.map((row) => ({ label: row.label, value: row.turn_count })), { barChar: "." }),
  ].join("\n");
}

function formatUsageRollupLabel(dimension: UsageStatsDimension, label: string): string {
  if (dimension === "source") {
    return label.replace(/^(.{8}).*@/, "$1@");
  }
  return label;
}

function renderUsageNotes(
  rows: Array<{ label: string; turns_with_token_usage: number; turn_count: number }>,
  dimension: UsageStatsDimension,
): string | undefined {
  if (dimension !== "model") {
    return undefined;
  }
  const unknownTokens = rows.find((row) => row.label === "unknown")?.turn_count ?? 0;
  if (unknownTokens === 0) {
    return undefined;
  }
  return `Note: ${unknownTokens} turn(s) have unknown models (possibly from legacy or unsupported source versions).`;
}
