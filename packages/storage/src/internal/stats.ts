import type {
  DriftReport,
  SourceStatus,
  UserTurnProjection,
} from "@cchistory/domain";
import { nowIso } from "@cchistory/domain";
import { clamp01, buildDriftTimeline } from "../queries/drift.js";

export {
  buildUsageRows,
  compareUsageRollupRows,
  computeUsageOverview,
  computeUsageRollup,
  countExcludedZeroTokenTurns,
  hasAnyTokenUsage,
  sumUsageRows,
  usageDimensionKey,
  usageDimensionLabel,
  type UsageAggregationRow,
  type UsageFilters,
} from "@cchistory/canonical";

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
