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
  db.exec("DELETE FROM search_index");
  const insert = db.prepare(
    "INSERT INTO search_index (turn_id, project_id, source_id, link_state, value_axis, canonical_text, raw_text) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  for (const turn of turns) {
    insert.run(
      turn.id,
      turn.project_id ?? "",
      turn.source_id,
      turn.link_state,
      turn.value_axis,
      turn.canonical_text,
      turn.raw_text,
    );
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
    const rows = input.db
      .prepare("SELECT turn_id FROM search_index WHERE search_index MATCH ? ORDER BY rank LIMIT ?")
      .all(input.query, input.limit) as Array<{ turn_id: string }>;
    return rows.map((row) => row.turn_id);
  } catch {
    return fallbackTurnIds(input.listResolvedTurns(), input.query, input.limit);
  }
}

export function computeRelevanceScore(turn: UserTurnProjection, highlights: SearchHighlight[]): number {
  return highlights.length * 10 + Math.max(0, 1_000_000_000 - Date.parse(turn.submission_started_at)) / 1_000_000_000;
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
