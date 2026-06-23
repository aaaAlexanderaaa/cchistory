import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { LinkState, SearchHighlight, UserTurnProjection, ValueAxis } from "@cchistory/domain";
import { setSearchIndexStatus } from "../db/schema.js";

export interface SearchCandidateFields {
  canonical_text?: string;
  path_text?: string;
}

export interface SearchScanCandidate extends SearchCandidateFields {
  id: string;
  source_id: string;
  session_id: string;
  submission_started_at: string;
  link_state: LinkState;
  value_axis: ValueAxis;
  project_id?: string;
}

interface SearchPlan {
  normalizedQuery: string;
  terms: SearchTerm[];
  requiresLiteralScan: boolean;
}

interface SearchTerm {
  value: string;
  mode: "prefix" | "literal";
}

/**
 * Compute a lightweight hash of the indexable fields for a turn so we can
 * detect changes without reading the full FTS content back from SQLite.
 */
function turnIndexHash(turn: UserTurnProjection): string {
  return createHash("sha1")
    .update(
      `canonical-search-v3\0${turn.project_id ?? ""}\0${turn.source_id}\0${turn.link_state}\0${turn.value_axis}\0${turn.canonical_text ?? ""}\0${turn.path_text ?? ""}`,
    )
    .digest("hex");
}

export function replaceSearchIndex(
  db: DatabaseSync,
  searchIndexReady: boolean,
  turns: UserTurnProjection[],
): void {
  if (!searchIndexReady) {
    return;
  }

  // Ensure the lightweight hash-tracking table exists (idempotent).
  db.exec(
    "CREATE TABLE IF NOT EXISTS search_index_hashes (turn_id TEXT PRIMARY KEY, hash TEXT NOT NULL);",
  );

  db.exec("SAVEPOINT replace_search_index;");
  try {
    // Build the desired set keyed by turn id.
    const desiredById = new Map<string, UserTurnProjection>();
    for (const turn of turns) {
      desiredById.set(turn.id, turn);
    }

    // Only load the lightweight hash table — NOT the full FTS content.
    const currentHashes = new Map<string, string>();
    for (const row of db
      .prepare("SELECT turn_id, hash FROM search_index_hashes")
      .all() as Array<{ turn_id: string; hash: string }>) {
      currentHashes.set(row.turn_id, row.hash);
    }

    const deleteIdx = db.prepare("DELETE FROM search_index WHERE turn_id = ?");
    const deleteHash = db.prepare("DELETE FROM search_index_hashes WHERE turn_id = ?");
    const insertIdx = db.prepare(
      "INSERT INTO search_index (turn_id, project_id, source_id, link_state, value_axis, canonical_text, path_text, raw_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const upsertHash = db.prepare(
      "INSERT OR REPLACE INTO search_index_hashes (turn_id, hash) VALUES (?, ?)",
    );

    // Remove rows that no longer exist in the desired set.
    for (const turnId of currentHashes.keys()) {
      if (!desiredById.has(turnId)) {
        deleteIdx.run(turnId);
        deleteHash.run(turnId);
      }
    }

    // Upsert rows whose content changed or are new.
    // Always delete-before-insert: FTS5 tables do not enforce uniqueness on
    // turn_id, so we must remove any pre-existing row to avoid duplicates.
    // This is especially important on stores upgraded from before the hash
    // table existed — currentHashes will be empty while search_index already
    // contains rows.
    for (const turn of turns) {
      const hash = turnIndexHash(turn);
      const existingHash = currentHashes.get(turn.id);
      if (existingHash === hash) {
        continue;
      }
      deleteIdx.run(turn.id);
      insertIdx.run(
        turn.id,
        turn.project_id ?? "",
        turn.source_id,
        turn.link_state,
        turn.value_axis,
        turn.canonical_text,
        turn.path_text ?? "",
        "",
      );
      upsertHash.run(turn.id, hash);
    }

    setSearchIndexStatus(db, "ready");
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
  } catch (err) {
    console.warn(`[cchistory] FTS5 search failed, falling back to substring scan:`, err instanceof Error ? err.message : err);
    return fallbackTurnIds(input.listResolvedTurns(), input.query, input.limit);
  }
}

export function querySearchIndexPage(input: {
  db: DatabaseSync;
  searchIndexReady: boolean;
  query: string;
  candidateLimit: number;
}): string[] | undefined {
  if (!input.searchIndexReady) {
    return undefined;
  }

  const plan = buildSearchPlan(input.query);
  if (plan.requiresLiteralScan) {
    return undefined;
  }

  try {
    const ftsQuery = buildFtsQuery(input.query);
    const rows = input.db
      .prepare("SELECT turn_id FROM search_index WHERE search_index MATCH ? ORDER BY rank LIMIT ?")
      .all(ftsQuery, input.candidateLimit) as Array<{ turn_id: string }>;
    return rows.map((row) => row.turn_id);
  } catch {
    return undefined;
  }
}

export function scanSearchCandidateRows(input: {
  db: DatabaseSync;
  query: string;
  candidateTurnIds?: readonly string[];
}): Generator<SearchScanCandidate> {
  const plan = buildSearchPlan(input.query);
  // B.5.1: V2 read path. canonical_text reads the bounded 16 KiB scan hint
  // (per V2 contract — that is the column's purpose). Searches for terms
  // that appear only past 16 KiB in canonical_text will not match; this is
  // the accepted tradeoff for keeping the scan fast. link_state, value_axis,
  // project_id come from native V2 columns; path_text from V2.path_text plus
  // the session/candidate joins (sessions remain V1 payload_json until B.6).
  if (input.candidateTurnIds) {
    const select = input.db.prepare(`
      SELECT ut.turn_id AS id,
             ut.source_id,
             ut.session_id,
             ut.submission_started_at,
             ut.canonical_text AS canonical_text,
             ${searchPathTextSql()} AS path_text,
             ut.link_state AS link_state,
             ut.value_axis AS value_axis,
             ut.project_id AS project_id
        FROM user_turns_v2 ut
        LEFT JOIN sessions s ON s.id = ut.session_id
       WHERE ut.turn_id = ?
    `);
    return (function* (): Generator<SearchScanCandidate> {
      for (const turnId of input.candidateTurnIds ?? []) {
        const row = select.get(turnId) as SearchCandidateRow | undefined;
        if (row && matchesSearchCandidateRow(row, plan)) {
          yield hydrateSearchCandidateRow(row);
        }
      }
    })();
  }

  const statement = input.db.prepare(`
    SELECT ut.turn_id AS id,
           ut.source_id,
           ut.session_id,
           ut.submission_started_at,
           ut.canonical_text AS canonical_text,
           ${searchPathTextSql()} AS path_text,
           ut.link_state AS link_state,
           ut.value_axis AS value_axis,
           ut.project_id AS project_id
      FROM user_turns_v2 ut
      LEFT JOIN sessions s ON s.id = ut.session_id
     ORDER BY ut.submission_started_at DESC, ut.created_at DESC
  `);
  return (function* (): Generator<SearchScanCandidate> {
    for (const row of statement.iterate() as Iterable<SearchCandidateRow>) {
      if (matchesSearchCandidateRow(row, plan)) {
        yield hydrateSearchCandidateRow(row);
      }
    }
  })();
}

export function computeRelevanceScore(
  turn: Pick<UserTurnProjection, "submission_started_at">,
  highlights: SearchHighlight[],
): number {
  const nowMs = Date.now();
  const turnMs = Date.parse(turn.submission_started_at) || 0;
  const ageMs = Math.max(0, nowMs - turnMs);
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  // Logarithmic decay: recent turns get a meaningful boost that tapers off.
  // recency ranges from 0 (very old) to 5 (just now).
  const recency = 5 * Math.max(0, 1 - Math.log1p(ageMs / NINETY_DAYS_MS) / Math.log1p(100));
  return highlights.length * 10 + recency;
}

export function findHighlights(text: string, query: string): SearchHighlight[] {
  const plan = buildSearchPlan(query);
  const terms = plan.terms.length > 0 ? plan.terms.map((term) => term.value) : plan.normalizedQuery ? [plan.normalizedQuery] : [];
  if (terms.length === 0) {
    return [];
  }

  // Use regex with the 'ig' flags to find matches in the original text.
  // This avoids the offset mismatch caused by toLowerCase() changing
  // string length for certain Unicode characters (e.g. İ → i̇).
  const highlights: SearchHighlight[] = [];
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "gi");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      highlights.push({ start: match.index, end: match.index + match[0].length });
      if (match[0].length === 0) {
        regex.lastIndex++;
      }
    }
  }

  return mergeHighlights(highlights);
}

function fallbackTurnIds(turns: UserTurnProjection[], query: string, limit: number): string[] {
  return findMatchingTurnIds(turns, query).slice(0, limit);
}

function buildFtsQuery(query: string): string {
  const plan = buildSearchPlan(query);
  const queryText = buildFtsQueryText(plan);
  return `(canonical_text : (${queryText}) OR path_text : (${queryText}))`;
}

function buildFtsQueryText(plan: SearchPlan): string {
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
  turn: Pick<SearchCandidateFields, "canonical_text" | "path_text">,
  plan: SearchPlan,
): boolean {
  return matchesSearchPlan(turn.canonical_text ?? "", plan) || matchesSearchPlan(turn.path_text ?? "", plan);
}

export function matchesSearchCandidateQuery(candidate: SearchCandidateFields, query: string): boolean {
  const plan = buildSearchPlan(query);
  return matchesTurnSearchPlan(candidate, plan);
}

function findMatchingTurnIds(turns: UserTurnProjection[], query: string): string[] {
  return turns.filter((turn) => matchesSearchCandidateQuery(turn, query)).map((turn) => turn.id);
}

interface SearchCandidateRow {
  id: string;
  source_id: string;
  session_id: string;
  submission_started_at: string;
  canonical_text: unknown;
  path_text: unknown;
  link_state: unknown;
  value_axis: unknown;
  project_id: unknown;
}

function matchesSearchCandidateRow(row: SearchCandidateRow, plan: SearchPlan): boolean {
  return matchesTurnSearchPlan(
    {
      canonical_text: asString(row.canonical_text),
      path_text: asString(row.path_text),
    },
    plan,
  );
}

function hydrateSearchCandidateRow(row: SearchCandidateRow): SearchScanCandidate {
  return {
    id: row.id,
    source_id: row.source_id,
    session_id: row.session_id,
    submission_started_at: row.submission_started_at,
    canonical_text: asString(row.canonical_text),
    path_text: asString(row.path_text),
    link_state: asLinkState(row.link_state),
    value_axis: asValueAxis(row.value_axis),
    project_id: asString(row.project_id),
  };
}

function searchPathTextSql(): string {
  return `
    COALESCE(ut.path_text, '') || ' ' ||
    COALESCE(json_extract(s.payload_json, '$.working_directory'), '') || ' ' ||
    COALESCE(json_extract(s.payload_json, '$.resume_working_directory'), '') || ' ' ||
    COALESCE(json_extract(s.payload_json, '$.source_native_project_ref'), '') || ' ' ||
    COALESCE((
      SELECT GROUP_CONCAT(
        COALESCE(json_extract(dc.payload_json, '$.evidence.workspace_path'), '') || ' ' ||
        COALESCE(json_extract(dc.payload_json, '$.evidence.workspace_path_normalized'), '') || ' ' ||
        COALESCE(json_extract(dc.payload_json, '$.evidence.repo_root'), '') || ' ' ||
        COALESCE(json_extract(dc.payload_json, '$.evidence.repo_remote'), '') || ' ' ||
        COALESCE(json_extract(dc.payload_json, '$.evidence.repo_fingerprint'), '') || ' ' ||
        COALESCE(json_extract(dc.payload_json, '$.evidence.source_native_project_ref'), ''),
        ' '
      )
      FROM derived_candidates dc
      WHERE dc.session_ref = ut.session_id
        AND dc.candidate_kind = 'project_observation'
    ), '')
  `;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asLinkState(value: unknown): LinkState {
  return value === "committed" || value === "candidate" || value === "unlinked" ? value : "unlinked";
}

function asValueAxis(value: unknown): ValueAxis {
  return value === "covered" || value === "archived" || value === "suppressed" ? value : "active";
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
