import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { DerivedCandidate, LinkState, UserTurnProjection, ValueAxis } from "@cchistory/domain";
import {
  buildSearchPlan as buildBaseSearchPlan,
  computeRelevanceScore,
  findHighlights,
  materializeSearchCandidate,
  matchesSearchCandidatePlan,
  matchesSearchCandidateQuery,
  stripSearchTruncationMarker,
  type SearchCandidateFields,
  type SearchPlan as BaseSearchPlan,
} from "@cchistory/canonical";
import { setSearchIndexStatus } from "../db/schema.js";

export { computeRelevanceScore, findHighlights, matchesSearchCandidateQuery, type SearchCandidateFields };

export interface SearchScanCandidate extends SearchCandidateFields {
  id: string;
  source_id: string;
  session_id: string;
  submission_started_at: string;
  link_state: LinkState;
  value_axis: ValueAxis;
  project_id?: string;
}

interface SearchPlan extends BaseSearchPlan {
  requiresLiteralScan: boolean;
}

/**
 * Compute a lightweight hash of the exact text written into the FTS index so
 * we can detect changes without reading the full FTS content back from SQLite.
 */
function turnIndexHash(
  turn: UserTurnProjection,
  indexedCanonicalText: string,
  indexedPathText: string,
): string {
  return createHash("sha1")
    .update(
      `canonical-search-v3\0${turn.project_id ?? ""}\0${turn.source_id}\0${turn.link_state}\0${turn.value_axis}\0${indexedCanonicalText}\0${indexedPathText}`,
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
      const candidate = materializeSearchCandidate({ turn });
      // Keep the truncation marker out of the index: without this, FTS prefix
      // matching on "truncated"/"truncat" would hit every >16KiB turn.
      const indexedCanonicalText = stripSearchTruncationMarker(candidate.canonical_text ?? "");
      const indexedPathText = candidate.path_text ?? "";
      const hash = turnIndexHash(turn, indexedCanonicalText, indexedPathText);
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
        indexedCanonicalText,
        indexedPathText,
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
      .prepare("SELECT turn_id FROM search_index WHERE search_index MATCH ? ORDER BY rank, turn_id ASC LIMIT ?")
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
      .prepare("SELECT turn_id FROM search_index WHERE search_index MATCH ? ORDER BY rank, turn_id ASC LIMIT ?")
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
  const observationCandidatesFor = makeObservationCandidateLookup(input.db);
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
             ut.path_text AS path_text,
             json_extract(s.payload_json, '$.working_directory') AS session_working_directory,
             json_extract(s.payload_json, '$.resume_working_directory') AS session_resume_working_directory,
             json_extract(s.payload_json, '$.source_native_project_ref') AS session_source_native_project_ref,
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
        if (row) {
          const candidate = hydrateSearchCandidateRow(
            row,
            observationCandidatesFor(row.source_id, row.session_id),
          );
          if (matchesSearchCandidatePlan(candidate, plan)) {
            yield candidate;
          }
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
           ut.path_text AS path_text,
           json_extract(s.payload_json, '$.working_directory') AS session_working_directory,
           json_extract(s.payload_json, '$.resume_working_directory') AS session_resume_working_directory,
           json_extract(s.payload_json, '$.source_native_project_ref') AS session_source_native_project_ref,
           ut.link_state AS link_state,
           ut.value_axis AS value_axis,
           ut.project_id AS project_id
      FROM user_turns_v2 ut
      LEFT JOIN sessions s ON s.id = ut.session_id
     ORDER BY ut.submission_started_at DESC, ut.created_at DESC, ut.turn_id ASC
  `);
  return (function* (): Generator<SearchScanCandidate> {
    for (const row of statement.iterate() as Iterable<SearchCandidateRow>) {
      const candidate = hydrateSearchCandidateRow(
        row,
        observationCandidatesFor(row.source_id, row.session_id),
      );
      if (matchesSearchCandidatePlan(candidate, plan)) {
        yield candidate;
      }
    }
  })();
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
  const plan = buildBaseSearchPlan(query);
  // FTS5 cannot express arbitrary literal substrings, so terms that contain
  // non-alphanumeric characters need a verifying scan over the real text.
  let requiresLiteralScan = false;
  for (const term of plan.terms) {
    if (term.mode === "literal" && /[^\p{L}\p{N}]/u.test(term.value)) {
      requiresLiteralScan = true;
      break;
    }
  }
  return { ...plan, requiresLiteralScan };
}

function findMatchingTurnIds(turns: UserTurnProjection[], query: string): string[] {
  return turns
    .filter((turn) => matchesSearchCandidateQuery(materializeSearchCandidate({ turn }), query))
    .map((turn) => turn.id);
}

interface SearchCandidateRow {
  id: string;
  source_id: string;
  session_id: string;
  submission_started_at: string;
  canonical_text: unknown;
  path_text: unknown;
  session_working_directory: unknown;
  session_resume_working_directory: unknown;
  session_source_native_project_ref: unknown;
  link_state: unknown;
  value_axis: unknown;
  project_id: unknown;
}

function hydrateSearchCandidateRow(
  row: SearchCandidateRow,
  projectObservationCandidates: readonly DerivedCandidate[],
): SearchScanCandidate {
  const candidate = materializeSearchCandidate({
    turn: {
      canonical_text: asString(row.canonical_text),
      path_text: asString(row.path_text),
    },
    session: {
      working_directory: asString(row.session_working_directory),
      resume_working_directory: asString(row.session_resume_working_directory),
      source_native_project_ref: asString(row.session_source_native_project_ref),
    },
    project_observation_candidates: projectObservationCandidates,
  });
  return {
    id: row.id,
    source_id: row.source_id,
    session_id: row.session_id,
    submission_started_at: row.submission_started_at,
    canonical_text: candidate.canonical_text,
    path_text: candidate.path_text,
    link_state: asLinkState(row.link_state),
    value_axis: asValueAxis(row.value_axis),
    project_id: asString(row.project_id),
  };
}

/**
 * Look up project_observation candidates per (source, session) on demand,
 * memoized for the lifetime of one scan. Uses the (source_id, session_ref)
 * index, so FTS-narrowed searches only touch the sessions they actually scan
 * instead of parsing the whole derived_candidates table per keystroke.
 */
function makeObservationCandidateLookup(
  db: DatabaseSync,
): (sourceId: string, sessionId: string) => readonly DerivedCandidate[] {
  const statement = db.prepare(`
    SELECT payload_json
      FROM derived_candidates
     WHERE source_id = ? AND session_ref = ? AND candidate_kind = 'project_observation'
     ORDER BY id ASC
  `);
  const cache = new Map<string, readonly DerivedCandidate[]>();
  let warnedCorruptPayload = false;
  return (sourceId, sessionId) => {
    const cacheKey = `${sourceId}\0${sessionId}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const parsed: DerivedCandidate[] = [];
    for (const row of statement.iterate(sourceId, sessionId) as Iterable<{ payload_json: string }>) {
      try {
        parsed.push(JSON.parse(row.payload_json) as DerivedCandidate);
      } catch {
        // One corrupt row must not break every search; skip it and report once.
        if (!warnedCorruptPayload) {
          warnedCorruptPayload = true;
          console.warn("[cchistory] skipping corrupt project_observation payload_json in derived_candidates");
        }
      }
    }
    cache.set(cacheKey, parsed);
    return parsed;
  };
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

function sanitizeFtsPhrase(query: string): string {
  const escaped = query.replace(/"/g, '""');
  return `"${escaped}"`;
}
