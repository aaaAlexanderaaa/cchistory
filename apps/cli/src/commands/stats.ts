import {
  type UsageStatsDimension,
} from "@cchistory/domain";
import type { CCHistoryStorage } from "@cchistory/storage";
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
  type CommandContext,
  type CommandOutput,
  openReadStore,
} from "../main.js";
import { resolveSourceRef } from "../resolvers.js";

const USAGE_STATS_DIMENSIONS = ["model", "project", "source", "host", "day", "month"] as const satisfies readonly UsageStatsDimension[];

export async function handleStats(context: CommandContext): Promise<CommandOutput> {
  const showAll = context.globals.showAll;
  const dimension = context.options.by;
  const wantsUsageRollup = context.commandPath[1] === "usage" || Boolean(dimension);

  if (wantsUsageRollup && !isUsageStatsDimension(dimension)) {
    throw new Error(
      "`stats usage` requires --by <dimension>. Expected one of model, project, source, host, day, or month.\nExample: cchistory stats usage --by model\nRun `cchistory help stats usage` for details.",
    );
  }
  const usageDimension = isUsageStatsDimension(dimension) ? dimension : undefined;

  const readStore = await openReadStore(context);
  try {
    const selectedSourceIds = context.options.source.length > 0
      ? context.options.source.map((ref) => resolveSourceRef(readStore.storage, ref).id)
      : undefined;
    if (usageDimension) {
      return createStatsUsageOutput(readStore.layout, readStore.storage, usageDimension, showAll, selectedSourceIds);
    }
    return createStatsOverviewOutput(readStore.layout, readStore.storage, showAll, selectedSourceIds);
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
  const sourceScope = renderSourceScopeFromIds(storage, selectedSourceIds);
  const excludedNote = overview.excluded_zero_token_turns
    ? `${overview.excluded_zero_token_turns} non-API turns excluded (slash commands, cancellations). Use --showall to include.`
    : undefined;
  return {
    text: [
      renderKeyValue([
        ["DB", layout.dbPath],
        ...(sourceScope ? [["Source Scope", sourceScope] as [string, string]] : []),
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
      source_scope: selectedSourceIds ?? null,
      overview,
    },
  };
}

export function createStatsUsageOutput(
  layout: StoreLayout,
  storage: CCHistoryStorage,
  dimension: UsageStatsDimension,
  showAll: boolean,
  selectedSourceIds?: string[],
): CommandOutput {
  if (!isUsageStatsDimension(dimension)) {
    throw new Error("`stats usage --by` must be one of model, project, source, host, day, or month.");
  }

  const usageFilters = { include_known_zero_token: showAll, source_ids: selectedSourceIds };
  const rollup = storage.listUsageRollup(dimension, usageFilters);
  const sourceScope = renderSourceScopeFromIds(storage, selectedSourceIds);
  const notesText = renderUsageNotes(rollup.rows, dimension);
  const excludedNote = rollup.excluded_zero_token_turns
    ? `${rollup.excluded_zero_token_turns} non-API turns excluded (slash commands, cancellations). Use --showall to include.`
    : undefined;
  const chartText = dimension === "day" || dimension === "month" ? renderUsageCharts(rollup.rows, dimension) : undefined;
  return {
    text: [
      sourceScope ? renderKeyValue([["Source Scope", sourceScope]]) : undefined,
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
      source_scope: selectedSourceIds ?? null,
      overview: storage.getUsageOverview(usageFilters),
      rollup,
    },
  };
}

function isUsageStatsDimension(value: string | undefined): value is UsageStatsDimension {
  return USAGE_STATS_DIMENSIONS.includes(value as UsageStatsDimension);
}

function renderSourceScopeFromIds(storage: CCHistoryStorage, sourceIds: string[] | undefined): string | undefined {
  if (!sourceIds || sourceIds.length === 0) {
    return undefined;
  }
  const sourcesById = new Map(storage.listSources().map((source) => [source.id, source]));
  return sourceIds
    .map((id) => {
      const source = sourcesById.get(id);
      return source ? `${source.display_name} (${source.slot_id})` : id;
    })
    .join(", ");
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
