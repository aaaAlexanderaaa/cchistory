import type { DatabaseSync } from "node:sqlite";
import type { SearchHighlight, UserTurnProjection } from "@cchistory/domain";

interface SearchPlan {
  normalizedQuery: string;
  terms: SearchTerm[];
  requiresLiteralScan: boolean;
}

interface SearchTerm {
  value: string;
  mode: "prefix" | "literal";
}

export function replaceSearchIndex(
  db: DatabaseSync,
  searchIndexReady: boolean,
  turns: UserTurnProjection[],
): void {
  if (!searchIndexReady) {
    return;
  }
  db.exec("SAVEPOINT replace_search_index;");
  try {
    const desiredById = new Map<string, UserTurnProjection>();
    for (const turn of turns) {
      desiredById.set(turn.id, turn);
    }

    const currentRows = db
      .prepare("SELECT turn_id, project_id, link_state, value_axis FROM search_index")
      .all() as Array<{ turn_id: string; project_id: string; link_state: string; value_axis: string }>;

    const currentById = new Map<string, { project_id: string; link_state: string; value_axis: string }>();
    for (const row of currentRows) {
      currentById.set(row.turn_id, row);
    }

    const deleteStmt = db.prepare("DELETE FROM search_index WHERE turn_id = ?");
    const insertStmt = db.prepare(
      "INSERT INTO search_index (turn_id, project_id, source_id, link_state, value_axis, canonical_text, raw_text) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );

    for (const turnId of currentById.keys()) {
      if (!desiredById.has(turnId)) {
        deleteStmt.run(turnId);
      }
    }

    for (const turn of turns) {
      const existing = currentById.get(turn.id);
      if (existing) {
        if (
          existing.project_id === (turn.project_id ?? "") &&
          existing.link_state === turn.link_state &&
          existing.value_axis === turn.value_axis
        ) {
          continue;
        }
        deleteStmt.run(turn.id);
      }
      insertStmt.run(
        turn.id,
        turn.project_id ?? "",
        turn.source_id,
        turn.link_state,
        turn.value_axis,
        turn.canonical_text,
        turn.raw_text,
      );
    }

    db.exec("RELEASE replace_search_index;");
  } catch (error) {
    db.exec("ROLLBACK TO replace_search_index;");
    throw error;
  }
}

export function querySearchIndex(input: {
  db: DatabaseSync;
  searchIndexReady: boolean;
  query: string;
  limit: number;
  listResolvedTurns: () => UserTurnProjection[];
}): string[] {
  const plan = buildSearchPlan(input.query);
  if (!input.searchIndexReady) {
    return fallbackTurnIds(input.listResolvedTurns(), input.query, input.limit);
  }

  try {
    const ftsQuery = buildFtsQuery(input.query);
    const rows = input.db
      .prepare("SELECT turn_id FROM search_index WHERE search_index MATCH ? ORDER BY rank LIMIT ?")
      .all(ftsQuery, input.limit) as Array<{ turn_id: string }>;
    const indexedTurnIds = rows.map((row) => row.turn_id);
    if (!plan.requiresLiteralScan) {
      return indexedTurnIds;
    }

    const exactTurnIds = findMatchingTurnIds(input.listResolvedTurns(), input.query);
    if (exactTurnIds.length === 0) {
      return [];
    }

    const exactTurnIdSet = new Set(exactTurnIds);
    const mergedTurnIds = indexedTurnIds.filter((turnId) => exactTurnIdSet.has(turnId));
    const mergedTurnIdSet = new Set(mergedTurnIds);
    for (const turnId of exactTurnIds) {
      if (!mergedTurnIdSet.has(turnId)) {
        mergedTurnIds.push(turnId);
        mergedTurnIdSet.add(turnId);
      }
    }
    return mergedTurnIds.slice(0, input.limit);
  } catch {
    return fallbackTurnIds(input.listResolvedTurns(), input.query, input.limit);
  }
}

export function computeRelevanceScore(turn: UserTurnProjection, highlights: SearchHighlight[]): number {
  const nowMs = Date.now();
  const turnMs = Date.parse(turn.submission_started_at) || 0;
  const TEN_YEARS_MS = 10 * 365.25 * 24 * 60 * 60 * 1000;
  const ageRatio = Math.min(1, Math.max(0, nowMs - turnMs) / TEN_YEARS_MS);
  return highlights.length * 10 + (1 - ageRatio);
}

export function findHighlights(text: string, query: string): SearchHighlight[] {
  const plan = buildSearchPlan(query);
  const terms = plan.terms.length > 0 ? plan.terms.map((term) => term.value) : plan.normalizedQuery ? [plan.normalizedQuery] : [];
  if (terms.length === 0) {
    return [];
  }

  const loweredText = text.toLowerCase();
  const highlights: SearchHighlight[] = [];
  for (const term of terms) {
    let cursor = 0;
    while (cursor < loweredText.length) {
      const foundAt = loweredText.indexOf(term, cursor);
      if (foundAt < 0) {
        break;
      }
      highlights.push({ start: foundAt, end: foundAt + term.length });
      cursor = foundAt + term.length;
    }
  }

  return mergeHighlights(highlights);
}

function fallbackTurnIds(turns: UserTurnProjection[], query: string, limit: number): string[] {
  return findMatchingTurnIds(turns, query).slice(0, limit);
}

function buildFtsQuery(query: string): string {
  const plan = buildSearchPlan(query);
  if (plan.terms.length === 0) {
    return sanitizeFtsPhrase(plan.normalizedQuery);
  }
  return plan.terms
    .map((term) => (term.mode === "prefix" ? `${term.value}*` : sanitizeFtsPhrase(term.value)))
    .join(" AND ");
}

function buildSearchPlan(query: string): SearchPlan {
  const normalizedQuery = query.trim().toLowerCase();
  const seen = new Set<string>();
  const terms: SearchTerm[] = [];
  let requiresLiteralScan = false;
  for (const segment of normalizedQuery.split(/\s+/u)) {
    if (!segment) {
      continue;
    }
    const mode = /^[\p{L}\p{N}]+$/u.test(segment) && segment.length > 1 ? "prefix" : "literal";
    const key = `${mode}:${segment}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    terms.push({ value: segment, mode });
    if (mode === "literal" && /[^\p{L}\p{N}]/u.test(segment)) {
      requiresLiteralScan = true;
    }
  }
  return {
    normalizedQuery,
    terms,
    requiresLiteralScan,
  };
}

function matchesSearchPlan(text: string, plan: SearchPlan): boolean {
  const loweredText = text.toLowerCase();
  if (plan.terms.length > 0) {
    return plan.terms.every((term) => loweredText.includes(term.value));
  }
  return plan.normalizedQuery.length === 0 ? true : loweredText.includes(plan.normalizedQuery);
}

function matchesTurnSearchPlan(
  turn: Pick<UserTurnProjection, "canonical_text" | "raw_text">,
  plan: SearchPlan,
): boolean {
  return matchesSearchPlan(turn.canonical_text ?? "", plan) || matchesSearchPlan(turn.raw_text ?? "", plan);
}

function findMatchingTurnIds(turns: UserTurnProjection[], query: string): string[] {
  const plan = buildSearchPlan(query);
  return turns.filter((turn) => matchesTurnSearchPlan(turn, plan)).map((turn) => turn.id);
}

function mergeHighlights(highlights: SearchHighlight[]): SearchHighlight[] {
  if (highlights.length === 0) {
    return highlights;
  }
  const sorted = [...highlights].sort((left, right) => {
    if (left.start !== right.start) {
      return left.start - right.start;
    }
    return left.end - right.end;
  });

  const merged: SearchHighlight[] = [sorted[0]!];
  for (const highlight of sorted.slice(1)) {
    const previous = merged[merged.length - 1]!;
    if (highlight.start <= previous.end) {
      previous.end = Math.max(previous.end, highlight.end);
      continue;
    }
    merged.push({ ...highlight });
  }
  return merged;
}

function sanitizeFtsPhrase(query: string): string {
  const escaped = query.replace(/"/g, '""');
  return `"${escaped}"`;
}
