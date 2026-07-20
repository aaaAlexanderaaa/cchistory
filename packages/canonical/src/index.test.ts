import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import test from "node:test";
import type {
  ProjectIdentity,
  SessionProjection,
  SourceStatus,
  UserTurnProjection,
} from "@cchistory/domain";
import {
  boundSearchCanonicalText,
  buildProjectDisplayList,
  buildSearchPlan,
  compareSessionsByRecency,
  compareTurnsByChronology,
  compareTurnsByRecency,
  computeUsageOverview,
  deriveProjectLinkSnapshot,
  matchesSearchCandidatePlan,
  materializeSearchCandidate,
  SEARCH_CANONICAL_TEXT_SCAN_BYTES,
  SEARCH_TRUNCATION_MARKER,
  searchTurnsInMemory,
  stripSearchTruncationMarker,
} from "./index.js";

test("shared canonical helpers link, search, and aggregate one live turn", () => {
  const source = createSource();
  const session = createSession(source);
  const turn = createTurn(source, session);
  const linked = deriveProjectLinkSnapshot({
    sessions: [session],
    turns: [turn],
    candidates: [
      {
        id: "candidate-project-1",
        source_id: source.id,
        session_ref: session.id,
        candidate_kind: "project_observation",
        input_atom_refs: [],
        started_at: turn.created_at,
        ended_at: turn.created_at,
        rule_version: "test",
        evidence: {
          workspace_path: session.working_directory,
          workspace_path_normalized: session.working_directory,
          repo_root: session.working_directory,
          confidence: 0.9,
        },
      },
    ],
  });

  assert.equal(linked.projects.length, 1);
  assert.equal(linked.turns[0]?.link_state, "committed");

  const results = searchTurnsInMemory({
    turns: linked.turns,
    sessions: linked.sessions,
    projects: linked.projects,
    query: "par",
    limit: 10,
  });
  assert.equal(results.total, 1);
  assert.equal(results.results[0]?.turn.id, turn.id);

  const overview = computeUsageOverview({
    filters: { include_known_zero_token: true },
    listResolvedTurns: () => linked.turns,
    listResolvedSessions: () => linked.sessions,
    listSources: () => [source],
    listProjects: () => linked.projects,
  });
  assert.equal(overview.total_turns, 1);
  assert.equal(overview.total_tokens, 15);
});

test("shared read ordering uses stable IDs to break timestamp ties", () => {
  const source = createSource();
  const session = createSession(source);
  const sessionA = { ...session, id: "session-a" };
  const sessionB = { ...session, id: "session-b" };
  assert.deepEqual([sessionB, sessionA].sort(compareSessionsByRecency).map((entry) => entry.id), ["session-a", "session-b"]);

  const turn = createTurn(source, session);
  const turnA = { ...turn, id: "turn-a", turn_id: "turn-a" };
  const turnB = { ...turn, id: "turn-b", turn_id: "turn-b" };
  assert.deepEqual([turnB, turnA].sort(compareTurnsByRecency).map((entry) => entry.id), ["turn-a", "turn-b"]);
  assert.deepEqual([turnB, turnA].sort(compareTurnsByChronology).map((entry) => entry.id), ["turn-a", "turn-b"]);
});

test("shared search materialization matches the bounded Full candidate surface", () => {
  const truncator = "...[truncated]";
  const utf8CutPrefix = "a".repeat(
    SEARCH_CANONICAL_TEXT_SCAN_BYTES - Buffer.byteLength(truncator, "utf8") - 1,
  );
  assert.equal(
    boundSearchCanonicalText(`${utf8CutPrefix}🙂${"z".repeat(100)}`),
    `${utf8CutPrefix}${truncator}`,
  );

  const source = createSource();
  const session = {
    ...createSession(source),
    resume_working_directory: "/workspace/resumed-parser",
    source_native_project_ref: "native-parser-ref",
  };
  const turn = {
    ...createTurn(source, session),
    canonical_text: `${"a".repeat(SEARCH_CANONICAL_TEXT_SCAN_BYTES)} tail-only-token`,
    path_text: "/turn/path turn-path",
  };
  const projectObservation = {
    id: "candidate-search-project",
    source_id: source.id,
    session_ref: session.id,
    candidate_kind: "project_observation" as const,
    input_atom_refs: [],
    started_at: turn.created_at,
    ended_at: turn.created_at,
    rule_version: "test",
    evidence: {
      workspace_path: "/observed/workspace",
      workspace_path_normalized: "/observed/workspace-normalized",
      repo_root: "/observed/repo-root",
      repo_remote: "https://example.test/search-parity.git",
      repo_fingerprint: "fingerprint-search-parity",
      source_native_project_ref: "observed-native-ref",
    },
  };

  const candidate = materializeSearchCandidate({
    turn,
    session,
    project_observation_candidates: [projectObservation],
  });
  assert.equal(candidate.canonical_text, boundSearchCanonicalText(turn.canonical_text));
  assert.ok(Buffer.byteLength(candidate.canonical_text ?? "", "utf8") <= SEARCH_CANONICAL_TEXT_SCAN_BYTES);
  assert.ok(candidate.canonical_text?.endsWith(truncator));
  assert.doesNotMatch(candidate.canonical_text ?? "", /tail-only-token/u);
  const expectedPathParts = [
    "/turn/path",
    session.working_directory,
    session.resume_working_directory,
    session.source_native_project_ref,
    "/observed/workspace",
    "/observed/workspace-normalized",
    "/observed/repo-root",
    "https://example.test/search-parity.git",
    "fingerprint-search-parity",
    "observed-native-ref",
  ].filter((value): value is string => Boolean(value));
  for (const expectedPathPart of expectedPathParts) {
    assert.ok(candidate.path_text?.includes(expectedPathPart), `missing search path field ${expectedPathPart}`);
  }

  assert.equal(searchTurnsInMemory({
    turns: [turn],
    sessions: [session],
    projects: [],
    candidates: [projectObservation],
    query: "tail-only-token",
  }).total, 0);
  assert.equal(searchTurnsInMemory({
    turns: [turn],
    sessions: [session],
    projects: [],
    candidates: [projectObservation],
    query: "fingerprint-search-parity",
  }).total, 1);
});

test("shared project display projection hides zero-turn projects and orders the most useful projects first", () => {
  const projects = [
    createProject("empty", { committedTurns: 0, candidateTurns: 0, sessions: 4 }),
    createProject("one-turn", { committedTurns: 1, sessions: 1 }),
    createProject("recent-two-turns", {
      committedTurns: 2,
      sessions: 1,
      lastActivityAt: "2026-01-03T00:00:00.000Z",
    }),
    createProject("more-sessions", {
      committedTurns: 2,
      sessions: 2,
      lastActivityAt: "2026-01-01T00:00:00.000Z",
    }),
  ];

  assert.deepEqual(
    buildProjectDisplayList(projects).map((project) => project.project_id),
    ["project-more-sessions", "project-recent-two-turns", "project-one-turn"],
  );
  assert.deepEqual(projects.map((project) => project.project_id), [
    "project-empty",
    "project-one-turn",
    "project-recent-two-turns",
    "project-more-sessions",
  ]);
});

function createProject(
  name: string,
  options: {
    committedTurns: number;
    candidateTurns?: number;
    sessions: number;
    lastActivityAt?: string;
  },
): ProjectIdentity {
  const timestamp = options.lastActivityAt ?? "2026-01-02T00:00:00.000Z";
  return {
    project_id: `project-${name}`,
    project_revision_id: `project-${name}:r1`,
    display_name: name,
    slug: name,
    linkage_state: "committed",
    confidence: 1,
    link_reason: "manual_override",
    manual_override_status: "applied",
    source_platforms: ["codex"],
    host_ids: ["host-test"],
    committed_turn_count: options.committedTurns,
    candidate_turn_count: options.candidateTurns ?? 0,
    session_count: options.sessions,
    project_last_activity_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

test("search plan helpers are exported so Full and Lite interpret one query identically", () => {
  const plan = buildSearchPlan("  Fix BUG-42  ");
  assert.equal(plan.normalizedQuery, "fix bug-42");
  assert.deepEqual(plan.terms, [
    { value: "fix", mode: "prefix" },
    { value: "bug-42", mode: "literal" },
  ]);
  assert.equal(matchesSearchCandidatePlan({ canonical_text: "Fixed bug-42 today" }, plan), true);
  assert.equal(matchesSearchCandidatePlan({ path_text: "/repos/bug-42 fix" }, plan), true);
  assert.equal(matchesSearchCandidatePlan({ canonical_text: "fixed something else" }, plan), false);

  const oversized = `needle ${"x".repeat(SEARCH_CANONICAL_TEXT_SCAN_BYTES)}`;
  const bounded = boundSearchCanonicalText(oversized);
  assert.ok(bounded.endsWith(SEARCH_TRUNCATION_MARKER));
  const stripped = stripSearchTruncationMarker(bounded);
  assert.ok(!stripped.endsWith(SEARCH_TRUNCATION_MARKER));
  assert.ok(stripped.startsWith("needle "));
  assert.equal(stripSearchTruncationMarker("plain text"), "plain text");
});

function createSource(): SourceStatus {
  return {
    id: "src-live-test",
    slot_id: "codex",
    family: "local_runtime_sessions",
    platform: "codex",
    display_name: "Codex",
    base_dir: "/workspace/.codex/sessions",
    host_id: "host-test",
    last_sync: "2026-01-01T00:00:00.000Z",
    sync_status: "healthy",
    total_blobs: 1,
    total_records: 2,
    total_fragments: 2,
    total_atoms: 2,
    total_sessions: 1,
    total_turns: 1,
  };
}

function createSession(source: SourceStatus): SessionProjection {
  return {
    id: "session-live-test",
    source_id: source.id,
    source_platform: source.platform,
    host_id: source.host_id,
    title: "Parser work",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:01:00.000Z",
    turn_count: 1,
    model: "gpt-5",
    working_directory: "/workspace/parser",
    sync_axis: "current",
  };
}

function createTurn(source: SourceStatus, session: SessionProjection): UserTurnProjection {
  return {
    id: "turn-live-test",
    revision_id: "turn-live-test:r1",
    turn_id: "turn-live-test",
    turn_revision_id: "turn-live-test:r1",
    user_messages: [
      {
        id: "message-live-test",
        raw_text: "Review parser behavior",
        canonical_text: "Review parser behavior",
        display_segments: [{ type: "text", content: "Review parser behavior" }],
        sequence: 0,
        is_injected: false,
        created_at: "2026-01-01T00:00:00.000Z",
        atom_refs: ["atom-live-test"],
      },
    ],
    raw_text: "Review parser behavior",
    canonical_text: "Review parser behavior",
    display_segments: [{ type: "text", content: "Review parser behavior" }],
    created_at: "2026-01-01T00:00:00.000Z",
    submission_started_at: "2026-01-01T00:00:00.000Z",
    last_context_activity_at: "2026-01-01T00:01:00.000Z",
    session_id: session.id,
    source_id: source.id,
    link_state: "unlinked",
    sync_axis: "current",
    value_axis: "active",
    retention_axis: "keep_raw_and_derived",
    context_ref: "context-live-test",
    context_summary: {
      assistant_reply_count: 1,
      tool_call_count: 0,
      token_usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      total_tokens: 15,
      primary_model: "gpt-5",
      has_errors: false,
    },
    lineage: {
      atom_refs: ["atom-live-test"],
      candidate_refs: [],
      fragment_refs: [],
      record_refs: [],
      blob_refs: [],
    },
  };
}
