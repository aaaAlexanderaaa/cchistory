import { Buffer } from "node:buffer";
import type {
  DerivedCandidate,
  LinkState,
  ProjectIdentity,
  SearchHighlight,
  SessionProjection,
  TurnSearchResult,
  UserTurnProjection,
  ValueAxis,
} from "@cchistory/domain";
import { asOptionalString } from "./utils.js";

export const SEARCH_CANONICAL_TEXT_SCAN_BYTES = 16 * 1024;
export const SEARCH_TRUNCATION_MARKER = "...[truncated]";

export interface SearchCandidateFields {
  canonical_text?: string;
  path_text?: string;
}

export interface SearchCandidateSessionFields {
  working_directory?: string;
  resume_working_directory?: string;
  source_native_project_ref?: string;
}

export type SearchProjectObservationCandidate = Pick<
  DerivedCandidate,
  "candidate_kind" | "evidence"
>;

export interface MaterializeSearchCandidateInput {
  turn: SearchCandidateFields;
  session?: SearchCandidateSessionFields;
  project_observation_candidates?: readonly SearchProjectObservationCandidate[];
}

export interface SearchPlan {
  normalizedQuery: string;
  terms: SearchTerm[];
}

export interface SearchTerm {
  value: string;
  mode: "prefix" | "literal";
}

export interface SearchTurnsInMemoryInput {
  turns: readonly UserTurnProjection[];
  sessions: readonly SessionProjection[];
  projects: readonly ProjectIdentity[];
  candidates?: readonly DerivedCandidate[];
  query?: string;
  project_id?: string;
  source_ids?: readonly string[];
  link_states?: readonly LinkState[];
  value_axes?: readonly ValueAxis[];
  limit?: number;
  offset?: number;
  now_ms?: number;
}

export function searchTurnsInMemory(input: SearchTurnsInMemoryInput): {
  results: TurnSearchResult[];
  total: number;
} {
  const query = input.query?.trim() ?? "";
  const limit = Math.max(0, input.limit ?? 50);
  const offset = Math.max(0, input.offset ?? 0);
  const sourceIds = input.source_ids && input.source_ids.length > 0 ? new Set(input.source_ids) : undefined;
  const linkStates = input.link_states && input.link_states.length > 0 ? new Set(input.link_states) : undefined;
  const valueAxes = input.value_axes && input.value_axes.length > 0 ? new Set(input.value_axes) : undefined;
  const nowMs = input.now_ms ?? Date.now();
  const sessionsById = new Map(input.sessions.map((session) => [session.id, session]));
  const projectsById = new Map(input.projects.map((project) => [project.project_id, project]));
  const projectObservationCandidatesBySessionId = new Map<string, DerivedCandidate[]>();
  for (const candidate of input.candidates ?? []) {
    if (candidate.candidate_kind !== "project_observation") {
      continue;
    }
    const existing = projectObservationCandidatesBySessionId.get(candidate.session_ref);
    if (existing) {
      existing.push(candidate);
    } else {
      projectObservationCandidatesBySessionId.set(candidate.session_ref, [candidate]);
    }
  }

  const ranked = input.turns
    .map((turn) => ({
      turn,
      candidate: materializeSearchCandidate({
        turn,
        session: sessionsById.get(turn.session_id),
        project_observation_candidates: projectObservationCandidatesBySessionId.get(turn.session_id),
      }),
    }))
    .filter(({ candidate }) => matchesSearchCandidateQuery(candidate, query))
    .filter(({ turn }) => (input.project_id ? turn.project_id === input.project_id : true))
    .filter(({ turn }) => (sourceIds ? sourceIds.has(turn.source_id) : true))
    .filter(({ turn }) => (linkStates ? linkStates.has(turn.link_state) : true))
    .filter(({ turn }) => (valueAxes ? valueAxes.has(turn.value_axis) : true))
    .map(({ turn, candidate }) => {
      const highlights = query.length > 0 ? findHighlights(candidate.canonical_text ?? "", query) : [];
      return {
        turn,
        session: sessionsById.get(turn.session_id),
        project: turn.project_id ? projectsById.get(turn.project_id) : undefined,
        highlights,
        relevance_score: computeRelevanceScore(turn, highlights, nowMs),
      } satisfies TurnSearchResult;
    })
    .sort(compareTurnSearchResults);

  return {
    results: ranked.slice(offset, offset + limit),
    total: ranked.length,
  };
}

export function materializeSearchCandidate(input: MaterializeSearchCandidateInput): SearchCandidateFields {
  const pathParts = [
    input.turn.path_text,
    input.session?.working_directory,
    input.session?.resume_working_directory,
    input.session?.source_native_project_ref,
  ];

  for (const candidate of input.project_observation_candidates ?? []) {
    if (candidate.candidate_kind !== "project_observation") {
      continue;
    }
    const evidence = candidate.evidence;
    pathParts.push(
      asOptionalString(evidence.workspace_path),
      asOptionalString(evidence.workspace_path_normalized),
      asOptionalString(evidence.repo_root),
      asOptionalString(evidence.repo_remote),
      asOptionalString(evidence.repo_fingerprint),
      asOptionalString(evidence.source_native_project_ref),
    );
  }

  return {
    canonical_text: boundSearchCanonicalText(input.turn.canonical_text ?? ""),
    path_text: pathParts.filter((value): value is string => Boolean(value)).join(" ") || undefined,
  };
}

export function boundSearchCanonicalText(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= SEARCH_CANONICAL_TEXT_SCAN_BYTES) {
    return value;
  }

  const cut = SEARCH_CANONICAL_TEXT_SCAN_BYTES - Buffer.byteLength(SEARCH_TRUNCATION_MARKER, "utf8");
  const sliced = bytes.subarray(0, cut);
  const decoded = sliced.toString("utf8");
  if (Buffer.from(decoded, "utf8").byteLength === sliced.byteLength) {
    return decoded + SEARCH_TRUNCATION_MARKER;
  }
  return decoded.replace(/\uFFFD$/u, "") + SEARCH_TRUNCATION_MARKER;
}

/** Remove the bound marker so index text does not match searches for "truncated". */
export function stripSearchTruncationMarker(value: string): string {
  return value.endsWith(SEARCH_TRUNCATION_MARKER)
    ? value.slice(0, value.length - SEARCH_TRUNCATION_MARKER.length)
    : value;
}

export function computeRelevanceScore(
  turn: Pick<UserTurnProjection, "submission_started_at">,
  highlights: readonly SearchHighlight[],
  nowMs = Date.now(),
): number {
  const turnMs = Date.parse(turn.submission_started_at) || 0;
  const ageMs = Math.max(0, nowMs - turnMs);
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  const recency = 5 * Math.max(0, 1 - Math.log1p(ageMs / ninetyDaysMs) / Math.log1p(100));
  return highlights.length * 10 + recency;
}

export function findHighlights(text: string, query: string): SearchHighlight[] {
  const plan = buildSearchPlan(query);
  const terms = plan.terms.length > 0
    ? plan.terms.map((term) => term.value)
    : plan.normalizedQuery
      ? [plan.normalizedQuery]
      : [];
  if (terms.length === 0) {
    return [];
  }

  const highlights: SearchHighlight[] = [];
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "gi");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      highlights.push({ start: match.index, end: match.index + match[0].length });
      if (match[0].length === 0) {
        regex.lastIndex += 1;
      }
    }
  }
  return mergeHighlights(highlights);
}

export function matchesSearchCandidateQuery(candidate: SearchCandidateFields, query: string): boolean {
  return matchesSearchCandidatePlan(candidate, buildSearchPlan(query));
}

export function matchesSearchCandidatePlan(candidate: SearchCandidateFields, plan: SearchPlan): boolean {
  return matchesSearchPlan(candidate.canonical_text ?? "", plan) || matchesSearchPlan(candidate.path_text ?? "", plan);
}

export function compareTurnSearchResults(left: TurnSearchResult, right: TurnSearchResult): number {
  if (left.relevance_score !== right.relevance_score) {
    return right.relevance_score - left.relevance_score;
  }
  const timeOrder = right.turn.submission_started_at.localeCompare(left.turn.submission_started_at);
  if (timeOrder !== 0) {
    return timeOrder;
  }
  return left.turn.id.localeCompare(right.turn.id);
}

export function buildSearchPlan(query: string): SearchPlan {
  const normalizedQuery = query.trim().toLowerCase();
  const seen = new Set<string>();
  const terms: SearchTerm[] = [];
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
  }
  return { normalizedQuery, terms };
}

export function matchesSearchPlan(text: string, plan: SearchPlan): boolean {
  const loweredText = text.toLowerCase();
  if (plan.terms.length > 0) {
    return plan.terms.every((term) => loweredText.includes(term.value));
  }
  return plan.normalizedQuery.length === 0 ? true : loweredText.includes(plan.normalizedQuery);
}

function mergeHighlights(highlights: SearchHighlight[]): SearchHighlight[] {
  if (highlights.length <= 1) {
    return highlights;
  }
  const ordered = [...highlights].sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: SearchHighlight[] = [];
  for (const highlight of ordered) {
    const previous = merged.at(-1);
    if (!previous || highlight.start > previous.end) {
      merged.push({ ...highlight });
      continue;
    }
    previous.end = Math.max(previous.end, highlight.end);
  }
  return merged;
}
