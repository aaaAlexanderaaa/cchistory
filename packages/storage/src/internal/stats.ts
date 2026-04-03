import type {
  DriftReport,
  ProjectIdentity,
  SessionProjection,
  SourceStatus,
  UsageStatsDimension,
  UsageStatsOverview,
  UsageStatsRollup,
  UsageStatsRollupRow,
  UserTurnProjection,
} from "@cchistory/domain";
import { clamp01, buildDriftTimeline } from "../queries/drift.js";
import { nowIso } from "./utils.js";

export interface UsageFilters {
  project_id?: string;
  source_ids?: string[];
  host_ids?: string[];
  include_known_zero_token?: boolean;
}

export interface UsageAggregationRow {
  turn_id: string;
  source_id: string;
  source_label: string;
  host_id: string;
  project_id?: string;
  project_label: string;
  model: string;
  day: string;
  month: string;
  has_token_usage: boolean;
  zero_token_reason?: string;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

export function hasAnyTokenUsage(turn: UserTurnProjection): boolean {
  const usage = turn.context_summary.token_usage;
  if (!usage) {
    return typeof turn.context_summary.total_tokens === "number";
  }
  return [
    usage.input_tokens,
    usage.cache_read_input_tokens,
    usage.cache_creation_input_tokens,
    usage.cached_input_tokens,
    usage.output_tokens,
    usage.reasoning_output_tokens,
    usage.total_tokens,
  ].some((value) => typeof value === "number");
}

export function sumUsageRows(
  rows: UsageAggregationRow[],
  key: keyof Pick<
    UsageAggregationRow,
    "input_tokens" | "cached_input_tokens" | "output_tokens" | "reasoning_output_tokens" | "total_tokens"
  >,
): number {
  return rows.reduce((total, row) => total + row[key], 0);
}

export function usageDimensionKey(row: UsageAggregationRow, dimension: UsageStatsDimension): string {
  switch (dimension) {
    case "model":
      return row.model;
    case "project":
      return row.project_id ?? "unassigned";
    case "source":
      return row.source_id;
    case "host":
      return row.host_id;
    case "day":
      return row.day;
    case "month":
      return row.month;
  }
}

export function usageDimensionLabel(row: UsageAggregationRow, dimension: UsageStatsDimension): string {
  switch (dimension) {
    case "model":
      return row.model;
    case "project":
      return row.project_label;
    case "source":
      return row.source_label;
    case "host":
      return row.host_id;
    case "day":
      return row.day;
    case "month":
      return row.month;
  }
}

export function compareUsageRollupRows(
  dimension: UsageStatsDimension,
  left: UsageStatsRollupRow,
  right: UsageStatsRollupRow,
): number {
  if (dimension === "day" || dimension === "month") {
    return left.key.localeCompare(right.key);
  }
  if (left.total_tokens !== right.total_tokens) {
    return right.total_tokens - left.total_tokens;
  }
  if (left.turn_count !== right.turn_count) {
    return right.turn_count - left.turn_count;
  }
  return left.label.localeCompare(right.label);
}

export function buildUsageRows(params: {
  filters: UsageFilters;
  listResolvedTurns: () => UserTurnProjection[];
  listResolvedSessions: () => SessionProjection[];
  listSources: () => SourceStatus[];
  listProjects: () => ProjectIdentity[];
}): UsageAggregationRow[] {
  const { filters, listResolvedTurns, listResolvedSessions, listSources, listProjects } = params;
  const turns = listResolvedTurns();
  const sessionsById = new Map(listResolvedSessions().map((session) => [session.id, session]));
  const sourcesById = new Map(listSources().map((source) => [source.id, source]));
  const projectsById = new Map(listProjects().map((project) => [project.project_id, project]));

  return turns
    .filter((turn) => (filters.project_id ? turn.project_id === filters.project_id : true))
    .filter((turn) =>
      filters.source_ids && filters.source_ids.length > 0 ? filters.source_ids.includes(turn.source_id) : true,
    )
    .map((turn) => {
      const session = sessionsById.get(turn.session_id);
      const source = sourcesById.get(turn.source_id);
      const project = turn.project_id ? projectsById.get(turn.project_id) : undefined;
      const hasTokUsage = hasAnyTokenUsage(turn);
      const zeroTokenReason =
        turn.context_summary.zero_token_reason ??
        (turn.context_summary.assistant_reply_count === 0 && !hasTokUsage ? "no_assistant_reply" : undefined);
      return {
        turn_id: turn.id,
        source_id: turn.source_id,
        source_label: source ? `${source.display_name} (${source.slot_id})` : turn.source_id,
        host_id: session?.host_id ?? source?.host_id ?? "unknown",
        project_id: turn.project_id,
        project_label: project?.display_name ?? "Unassigned",
        model: turn.context_summary.primary_model ?? session?.model ?? "unknown",
        day: turn.submission_started_at.slice(0, 10),
        month: turn.submission_started_at.slice(0, 7),
        has_token_usage: hasTokUsage,
        zero_token_reason: zeroTokenReason,
        input_tokens: turn.context_summary.token_usage?.input_tokens ?? 0,
        cached_input_tokens:
          turn.context_summary.token_usage?.cached_input_tokens ??
          (turn.context_summary.token_usage?.cache_read_input_tokens ?? 0) +
            (turn.context_summary.token_usage?.cache_creation_input_tokens ?? 0),
        output_tokens: turn.context_summary.token_usage?.output_tokens ?? 0,
        reasoning_output_tokens: turn.context_summary.token_usage?.reasoning_output_tokens ?? 0,
        total_tokens: turn.context_summary.token_usage?.total_tokens ?? turn.context_summary.total_tokens ?? 0,
      };
    })
    .filter((row) => (filters.host_ids && filters.host_ids.length > 0 ? filters.host_ids.includes(row.host_id) : true))
    .filter((row) => (filters.include_known_zero_token ? true : !row.zero_token_reason || row.has_token_usage));
}

export function countExcludedZeroTokenTurns(params: {
  filters: UsageFilters;
  listResolvedTurns: () => UserTurnProjection[];
  listResolvedSessions: () => SessionProjection[];
  listSources: () => SourceStatus[];
  listProjects: () => ProjectIdentity[];
}): number {
  const allRows = buildUsageRows({ ...params, filters: { ...params.filters, include_known_zero_token: true } });
  return allRows.filter((row) => row.zero_token_reason && !row.has_token_usage).length;
}

export function computeUsageOverview(params: {
  filters: UsageFilters;
  listResolvedTurns: () => UserTurnProjection[];
  listResolvedSessions: () => SessionProjection[];
  listSources: () => SourceStatus[];
  listProjects: () => ProjectIdentity[];
}): UsageStatsOverview {
  const rows = buildUsageRows(params);
  const turnCount = rows.length;
  const turnsWithTokenUsage = rows.filter((row) => row.has_token_usage).length;
  const turnsWithPrimaryModel = rows.filter((row) => row.model !== "unknown").length;

  const excludedCount = params.filters.include_known_zero_token ? 0 : countExcludedZeroTokenTurns(params);

  return {
    generated_at: nowIso(),
    total_turns: turnCount,
    turns_with_token_usage: turnsWithTokenUsage,
    turn_coverage_ratio: turnCount === 0 ? 0 : turnsWithTokenUsage / turnCount,
    turns_with_primary_model: turnsWithPrimaryModel,
    total_input_tokens: sumUsageRows(rows, "input_tokens"),
    total_cached_input_tokens: sumUsageRows(rows, "cached_input_tokens"),
    total_output_tokens: sumUsageRows(rows, "output_tokens"),
    total_reasoning_output_tokens: sumUsageRows(rows, "reasoning_output_tokens"),
    total_tokens: sumUsageRows(rows, "total_tokens"),
    excluded_zero_token_turns: excludedCount > 0 ? excludedCount : undefined,
  };
}

export function computeUsageRollup(params: {
  dimension: UsageStatsDimension;
  filters: UsageFilters;
  listResolvedTurns: () => UserTurnProjection[];
  listResolvedSessions: () => SessionProjection[];
  listSources: () => SourceStatus[];
  listProjects: () => ProjectIdentity[];
}): UsageStatsRollup {
  const { dimension, filters } = params;
  const rows = buildUsageRows(params);
  const groups = new Map<string, UsageStatsRollupRow>();

  for (const row of rows) {
    const key = usageDimensionKey(row, dimension);
    const label = usageDimensionLabel(row, dimension);
    const current = groups.get(key) ?? {
      key,
      label,
      dimension,
      turn_count: 0,
      turns_with_token_usage: 0,
      turn_coverage_ratio: 0,
      turns_with_primary_model: 0,
      total_input_tokens: 0,
      total_cached_input_tokens: 0,
      total_output_tokens: 0,
      total_reasoning_output_tokens: 0,
      total_tokens: 0,
    };
    current.turn_count += 1;
    current.turns_with_token_usage += row.has_token_usage ? 1 : 0;
    current.turns_with_primary_model += row.model !== "unknown" ? 1 : 0;
    current.total_input_tokens += row.input_tokens;
    current.total_cached_input_tokens += row.cached_input_tokens;
    current.total_output_tokens += row.output_tokens;
    current.total_reasoning_output_tokens += row.reasoning_output_tokens;
    current.total_tokens += row.total_tokens;
    groups.set(key, current);
  }

  const rollupRows = [...groups.values()]
    .map((row) => ({
      ...row,
      turn_coverage_ratio: row.turn_count === 0 ? 0 : row.turns_with_token_usage / row.turn_count,
    }))
    .sort((left, right) => compareUsageRollupRows(dimension, left, right));

  const excludedCount = filters.include_known_zero_token ? 0 : countExcludedZeroTokenTurns(params);

  return {
    generated_at: nowIso(),
    dimension,
    rows: rollupRows,
    excluded_zero_token_turns: excludedCount > 0 ? excludedCount : undefined,
  };
}

export function computeDriftReport(params: {
  listResolvedTurns: () => UserTurnProjection[];
  listSources: () => SourceStatus[];
}): DriftReport {
  const { listResolvedTurns, listSources } = params;
  const turns = listResolvedTurns();
  const sources = listSources();
  const unlinkedTurns = turns.filter((turn) => turn.link_state === "unlinked").length;
  const candidateTurns = turns.filter((turn) => turn.link_state === "candidate").length;
  const staleOrErrorSources = sources.filter((source) => source.sync_status !== "healthy").length;
  const orphanedTurns = turns.filter((turn) => !turn.project_id).length;
  const activeSources = sources.filter((source) => source.sync_status === "healthy").length;
  const totalTurns = Math.max(turns.length, 1);
  const consistencyPenalty = unlinkedTurns / totalTurns + staleOrErrorSources / Math.max(sources.length || 1, 1) / 2;
  const consistencyScore = clamp01(1 - consistencyPenalty);
  const globalDriftIndex = clamp01(
    candidateTurns / totalTurns / 2 +
      orphanedTurns / totalTurns / 2 +
      staleOrErrorSources / Math.max(sources.length || 1, 1) / 2,
  );
  const timeline = buildDriftTimeline(turns, consistencyScore, globalDriftIndex);

  return {
    generated_at: nowIso(),
    global_drift_index: globalDriftIndex,
    active_sources: activeSources,
    sources_awaiting_sync: staleOrErrorSources,
    orphaned_turns: orphanedTurns,
    unlinked_turns: unlinkedTurns,
    candidate_turns: candidateTurns,
    consistency_score: consistencyScore,
    timeline,
  };
}
