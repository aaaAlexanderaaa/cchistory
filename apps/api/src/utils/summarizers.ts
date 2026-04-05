import { createHash } from "node:crypto";
import {
  normalizeLocalPathIdentity,
  type SourceSyncPayload,
  type TurnSearchResult,
  type UserTurnProjection,
} from "@cchistory/domain";
import type { CCHistoryStorage } from "@cchistory/storage";

export function summarizeTurn(turn: UserTurnProjection) {
  const { lineage, ...summary } = turn;
  return summary;
}

export function summarizeSearchResult(result: TurnSearchResult) {
  return {
    ...result,
    turn: summarizeTurn(result.turn),
  };
}

export function summarizeLinkingReview(review: ReturnType<CCHistoryStorage["getLinkingReview"]>): {
  committed_projects: typeof review.committed_projects;
  candidate_projects: typeof review.candidate_projects;
  candidate_turns: ReturnType<typeof summarizeTurn>[];
  unlinked_turns: ReturnType<typeof summarizeTurn>[];
  project_observations: typeof review.project_observations;
} {
  return {
    ...review,
    candidate_turns: review.candidate_turns.map(summarizeTurn),
    unlinked_turns: review.unlinked_turns.map(summarizeTurn),
  };
}

export function summarizeRun(
  result: { host: { id: string }; sources: SourceSyncPayload[] },
  options: { storage?: CCHistoryStorage; includeDiff?: boolean } = {},
) {
  return {
    host_id: result.host.id,
    sources: result.sources.map((payload) => ({
      source: payload.source,
      counts: {
        blobs: payload.blobs.length,
        records: payload.records.length,
        fragments: payload.fragments.length,
        atoms: payload.atoms.length,
        candidates: payload.candidates.length,
        sessions: payload.sessions.length,
        turns: payload.turns.length,
      },
      latest_stage_runs: payload.stage_runs,
      diff:
        options.includeDiff && options.storage
          ? buildReplayDiff(options.storage.getSourceReplayBaseline(payload.source.id), payload)
          : undefined,
    })),
  };
}

export function buildReplayDiff(
  baseline: ReturnType<CCHistoryStorage["getSourceReplayBaseline"]>,
  payload: SourceSyncPayload,
) {
  const nextCounts = {
    blobs: payload.blobs.length,
    records: payload.records.length,
    fragments: payload.fragments.length,
    atoms: payload.atoms.length,
    candidates: payload.candidates.length,
    sessions: payload.sessions.length,
    turns: payload.turns.length,
  };
  const nextTurnTextById = Object.fromEntries(payload.turns.map((turn) => [turn.id, turn.canonical_text]));
  const previousTurnIds = new Set(Object.keys(baseline.turn_text_by_id));
  const nextTurnIds = new Set(Object.keys(nextTurnTextById));

  return {
    count_deltas: Object.fromEntries(
      Object.entries(nextCounts).map(([key, value]) => [key, value - (baseline.counts[key] ?? 0)]),
    ),
    added_turn_ids: [...nextTurnIds].filter((turnId) => !previousTurnIds.has(turnId)),
    removed_turn_ids: [...previousTurnIds].filter((turnId) => !nextTurnIds.has(turnId)),
    changed_turn_ids: [...nextTurnIds].filter((turnId) => baseline.turn_text_by_id[turnId] !== nextTurnTextById[turnId]),
    previous_project_ids: baseline.project_ids,
    next_project_ids: uniqueStrings(
      payload.turns.map((turn) => turn.project_id).filter((projectId): projectId is string => Boolean(projectId)),
    ),
  };
}

export function uniqueStrings<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

export function splitCsv(value: string | number | undefined): string[] | undefined {
  if (!value && value !== 0) {
    return undefined;
  }
  const str = String(value);
  const parts = str
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return parts.length > 0 ? parts : undefined;
}

export function asOptionalNumber(value: string | number | undefined): number | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Parse a pagination limit (must be >= 1), returning undefined if absent or invalid. */
export function asLimit(value: string | number | undefined): number | undefined {
  const parsed = asOptionalNumber(value);
  return parsed != null && parsed >= 1 ? Math.floor(parsed) : undefined;
}

/** Parse a pagination offset (must be >= 0), defaulting to 0 if absent or invalid. */
export function asOffset(value: string | number | undefined): number {
  const parsed = asOptionalNumber(value);
  return parsed != null && parsed >= 0 ? Math.floor(parsed) : 0;
}

export function stableManualProjectId(displayName: string, targetKind: string, targetRef: string): string {
  const digest = createHash("sha1").update(`${displayName}:${targetKind}:${targetRef}`).digest("hex").slice(0, 12);
  return `project-manual-${digest}`;
}

export function inferOverrideDisplayName(
  storage: CCHistoryStorage,
  targetKind: "turn" | "session" | "observation",
  targetRef: string,
): string {
  if (targetKind === "turn") {
    return storage.getResolvedTurn(targetRef)?.canonical_text.slice(0, 48) || "Manual Project";
  }
  if (targetKind === "session") {
    return storage.getResolvedSession(targetRef)?.title || "Manual Project";
  }
  return `Manual Project ${targetRef.slice(0, 8)}`;
}

export function normalizePathKey(value: string): string {
  return normalizeLocalPathIdentity(value) ?? value;
}
