import type { DatabaseSync } from "node:sqlite";
import type { SearchHighlight, UserTurnProjection } from "@cchistory/domain";

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
    // Build a map of what the index should contain
    const desiredById = new Map<string, UserTurnProjection>();
    for (const turn of turns) {
      desiredById.set(turn.id, turn);
    }

    // Read current index entries (turn_id + a hash of the indexed fields)
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

    // Delete turns no longer in the resolved set
    for (const turnId of currentById.keys()) {
      if (!desiredById.has(turnId)) {
        deleteStmt.run(turnId);
      }
    }

    // Insert or update turns
    for (const turn of turns) {
      const existing = currentById.get(turn.id);
      if (existing) {
        // Only re-index if metadata fields changed (project link, state changes)
        if (
          existing.project_id === (turn.project_id ?? "") &&
          existing.link_state === turn.link_state &&
          existing.value_axis === turn.value_axis
        ) {
          continue; // No change, skip
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
  if (!input.searchIndexReady) {
    return fallbackTurnIds(input.listResolvedTurns(), input.query, input.limit);
  }

  try {
    const sanitized = sanitizeFtsQuery(input.query);
    const rows = input.db
      .prepare("SELECT turn_id FROM search_index WHERE search_index MATCH ? ORDER BY rank LIMIT ?")
      .all(sanitized, input.limit) as Array<{ turn_id: string }>;
    return rows.map((row) => row.turn_id);
  } catch {
    return fallbackTurnIds(input.listResolvedTurns(), input.query, input.limit);
  }
}

export function computeRelevanceScore(turn: UserTurnProjection, highlights: SearchHighlight[]): number {
  // Highlight count is the primary signal (each match = 10 points).
  // Recency is the tiebreaker: newer turns get a small boost (0-1 point)
  // based on how recent they are within a ~10-year window.
  const nowMs = Date.now();
  const turnMs = Date.parse(turn.submission_started_at) || 0;
  const TEN_YEARS_MS = 10 * 365.25 * 24 * 60 * 60 * 1000;
  const ageRatio = Math.min(1, Math.max(0, nowMs - turnMs) / TEN_YEARS_MS);
  return highlights.length * 10 + (1 - ageRatio);
}

export function findHighlights(text: string, loweredQuery: string): SearchHighlight[] {
  if (loweredQuery.length === 0) {
    return [];
  }
  const loweredText = text.toLowerCase();
  const highlights: SearchHighlight[] = [];
  let cursor = 0;
  while (cursor < loweredText.length) {
    const foundAt = loweredText.indexOf(loweredQuery, cursor);
    if (foundAt < 0) {
      break;
    }
    highlights.push({ start: foundAt, end: foundAt + loweredQuery.length });
    cursor = foundAt + loweredQuery.length;
  }
  return highlights;
}

function fallbackTurnIds(turns: UserTurnProjection[], query: string, limit: number): string[] {
  const loweredQuery = query.toLowerCase();
  return turns
    .filter((turn) => turn.canonical_text.toLowerCase().includes(loweredQuery))
    .map((turn) => turn.id)
    .slice(0, limit);
}

function sanitizeFtsQuery(query: string): string {
  const escaped = query.replace(/"/g, '""');
  return `"${escaped}"`;
}
