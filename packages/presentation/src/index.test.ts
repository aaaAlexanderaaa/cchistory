import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  DriftReportDto,
  LinkingReviewResponse,
  MaskTemplateDto,
  PipelineLineageDto,
  ProjectLineageEventDto,
  ProjectLinkRevisionDto,
  ProjectManualOverrideDto,
  ProjectSummaryDto,
  SessionProjectionDto,
  SourceStatusDto,
  TurnContextProjectionDto,
  TurnSearchResultDto,
  UserTurnProjectionDto,
} from "../../api-client/dist/index.js";
import {
  mapDriftReport,
  mapLinkingObservation,
  mapLinkingReview,
  mapMaskTemplate,
  mapProject,
  mapProjectLineageEvent,
  mapProjectManualOverride,
  mapProjectRevision,
  mapSearchResult,
  mapSearchResults,
  mapSession,
  mapSessionRelatedWork,
  mapSourceStatus,
  mapTurnContext,
  mapTurnLineage,
  mapUserTurns,
  projectColor,
} from "./index.js";

function createTurn(overrides: Partial<UserTurnProjectionDto> & Pick<UserTurnProjectionDto, "id" | "canonical_text" | "session_id" | "source_id">): UserTurnProjectionDto {
  const createdAt = overrides.created_at ?? "2026-03-10T00:00:00.000Z";
  const submissionStartedAt = overrides.submission_started_at ?? createdAt;
  const lastContextActivityAt = overrides.last_context_activity_at ?? "2026-03-10T00:00:02.000Z";
  return {
    id: overrides.id,
    revision_id: overrides.revision_id ?? `${overrides.id}:r1`,
    user_messages: overrides.user_messages ?? [
      {
        id: `${overrides.id}-message-1`,
        raw_text: overrides.canonical_text,
        sequence: 0,
        is_injected: false,
        created_at: createdAt,
        canonical_text: overrides.canonical_text,
        display_segments: [{ type: "text", content: overrides.canonical_text }],
      },
    ],
    raw_text: overrides.raw_text ?? overrides.canonical_text,
    canonical_text: overrides.canonical_text,
    display_segments: overrides.display_segments ?? [{ type: "text", content: overrides.canonical_text }],
    created_at: createdAt,
    submission_started_at: submissionStartedAt,
    last_context_activity_at: lastContextActivityAt,
    session_id: overrides.session_id,
    source_id: overrides.source_id,
    project_id: overrides.project_id,
    link_state: overrides.link_state ?? "candidate",
    project_confidence: overrides.project_confidence,
    candidate_project_ids: overrides.candidate_project_ids,
    sync_axis: overrides.sync_axis ?? "current",
    value_axis: overrides.value_axis ?? "active",
    retention_axis: overrides.retention_axis ?? "keep_raw_and_derived",
    context_ref: overrides.context_ref ?? overrides.id,
    context_summary: overrides.context_summary ?? {
      assistant_reply_count: 0,
      tool_call_count: 0,
      has_errors: false,
    },
  };
}

function createSearchResult(turn: UserTurnProjectionDto): TurnSearchResultDto {
  return {
    turn,
    highlights: [{ start: 0, end: Math.min(turn.canonical_text.length, 8) }],
    relevance_score: 0.9,
  };
}

test("projectColor stays deterministic per project id", () => {
  assert.equal(projectColor("project-alpha"), projectColor("project-alpha"));
  assert.notEqual(projectColor("project-alpha"), projectColor("project-beta"));
});

test("mapUserTurns annotates operator-control loops and demotes collapsed middle turns", () => {
  const turns = mapUserTurns([
    createTurn({ id: "turn-1", canonical_text: "continue", session_id: "session-1", source_id: "src-1" }),
    createTurn({ id: "turn-2", canonical_text: "continue", session_id: "session-1", source_id: "src-1" }),
    createTurn({ id: "turn-3", canonical_text: "continue", session_id: "session-1", source_id: "src-1" }),
    createTurn({ id: "turn-4", canonical_text: "real user question", session_id: "session-1", source_id: "src-1" }),
  ]);

  assert.deepEqual(turns.map((turn) => turn.id), ["turn-1", "turn-3", "turn-4", "turn-2"]);

  const turnById = new Map(turns.map((turn) => [turn.id, turn]));
  assert.equal(turnById.get("turn-1")?.loop?.loop_family, "operator_control");
  assert.equal(turnById.get("turn-1")?.loop?.loop_position, 1);
  assert.equal(turnById.get("turn-1")?.loop?.loop_visibility, "leading");
  assert.equal(turnById.get("turn-2")?.loop?.loop_position, 2);
  assert.equal(turnById.get("turn-2")?.loop?.loop_visibility, "middle_collapsed");
  assert.equal(turnById.get("turn-3")?.loop?.loop_position, 3);
  assert.equal(turnById.get("turn-3")?.loop?.loop_visibility, "trailing");
  assert.equal(turnById.get("turn-4")?.loop, undefined);
  assert.equal(turnById.get("turn-1")?.loop?.loop_group_id, turnById.get("turn-2")?.loop?.loop_group_id);
  assert.equal(turnById.get("turn-2")?.loop?.loop_group_id, turnById.get("turn-3")?.loop?.loop_group_id);
});

test("mapUserTurns does not group repeated control phrases across sessions", () => {
  const turns = mapUserTurns([
    createTurn({ id: "turn-1", canonical_text: "continue", session_id: "session-1", source_id: "src-1" }),
    createTurn({ id: "turn-2", canonical_text: "continue", session_id: "session-1", source_id: "src-1" }),
    createTurn({ id: "turn-3", canonical_text: "continue", session_id: "session-2", source_id: "src-1" }),
    createTurn({ id: "turn-4", canonical_text: "continue", session_id: "session-1", source_id: "src-1" }),
  ]);

  for (const turn of turns) {
    assert.equal(turn.loop, undefined);
  }
});

test("mapSearchResults marks injected-repeat loops and de-emphasizes middle hits", () => {
  const injectedMessage = (turnId: string): UserTurnProjectionDto["user_messages"][number] => ({
    id: `${turnId}-message-1`,
    raw_text: "continue",
    sequence: 0,
    is_injected: true,
    created_at: "2026-03-10T00:00:00.000Z",
    canonical_text: "continue",
    display_segments: [{ type: "injected", content: "continue" }],
  });

  const results = mapSearchResults([
    createSearchResult(createTurn({
      id: "turn-1",
      canonical_text: "continue",
      session_id: "session-1",
      source_id: "src-1",
      user_messages: [injectedMessage("turn-1")],
    })),
    createSearchResult(createTurn({
      id: "turn-2",
      canonical_text: "continue",
      session_id: "session-1",
      source_id: "src-1",
      user_messages: [injectedMessage("turn-2")],
    })),
    createSearchResult(createTurn({
      id: "turn-3",
      canonical_text: "continue",
      session_id: "session-1",
      source_id: "src-1",
      user_messages: [injectedMessage("turn-3")],
    })),
    createSearchResult(createTurn({
      id: "turn-4",
      canonical_text: "human intent survives nearby",
      session_id: "session-1",
      source_id: "src-1",
    })),
  ]);

  assert.deepEqual(results.map((result) => result.turn.id), ["turn-1", "turn-3", "turn-4", "turn-2"]);
  assert.equal(results[0]?.turn.loop?.loop_family, "injected_repeat");
  assert.equal(results[1]?.turn.loop?.loop_visibility, "trailing");
  assert.equal(results[3]?.turn.loop?.loop_visibility, "middle_collapsed");
  assert.equal(results[2]?.turn.loop, undefined);
});



test("admin and project mapping helpers preserve fields and normalize dates", () => {
  const session = mapSession({
    id: "session-1",
    source_id: "src-1",
    source_platform: "codex",
    host_id: "host-1",
    title: "Review Session",
    created_at: "2026-03-10T00:00:00.000Z",
    updated_at: "2026-03-10T00:00:02.000Z",
    turn_count: 3,
    model: "gpt-5",
    working_directory: "/workspace/cchistory",
    sync_axis: "current",
  } satisfies SessionProjectionDto);
  assert.ok(session.created_at instanceof Date);
  assert.ok(session.updated_at instanceof Date);
  assert.equal(session.working_directory, "/workspace/cchistory");

  const project = mapProject({
    project_id: "project-1",
    project_revision_id: "project-1:r1",
    display_name: "CCHistory",
    slug: "cchistory",
    linkage_state: "committed",
    confidence: 0.95,
    link_reason: "repo_fingerprint_match",
    manual_override_status: "none",
    primary_workspace_path: "/workspace/cchistory",
    repo_root: "/workspace/cchistory",
    repo_remote: "https://example.com/openai/cchistory",
    repo_fingerprint: "repo-fingerprint-1",
    committed_turn_count: 4,
    candidate_turn_count: 1,
    session_count: 2,
    source_platforms: ["codex", "claude_code"],
    host_ids: ["host-1", "host-2"],
    created_at: "2026-03-10T00:00:00.000Z",
    updated_at: "2026-03-10T00:00:03.000Z",
    project_last_activity_at: "2026-03-10T00:00:04.000Z",
  } satisfies ProjectSummaryDto);
  assert.equal(project.id, "project-1");
  assert.ok(project.created_at instanceof Date);
  assert.ok(project.last_activity instanceof Date);
  assert.equal(project.primary_repo_remote, "https://example.com/openai/cchistory");

  const source = mapSourceStatus({
    id: "src-1",
    family: "local_coding_agent",
    platform: "codex",
    display_name: "Codex",
    base_dir: "/tmp/codex",
    default_base_dir: "/tmp/codex",
    is_overridden: false,
    is_default_source: true,
    path_exists: true,
    host_id: "host-1",
    last_sync: "2026-03-10T00:00:05.000Z",
    sync_status: "healthy",
    total_blobs: 1,
    total_records: 1,
    total_fragments: 1,
    total_atoms: 1,
    total_sessions: 1,
    total_turns: 1,
  } satisfies SourceStatusDto);
  assert.ok(source.last_sync instanceof Date);
  assert.equal(source.sync_status, "healthy");

  const mask = mapMaskTemplate({
    id: "mask-1",
    name: "Secrets",
    description: "Collapse secret values",
    match_type: "contains",
    match_pattern: "sk-",
    action: "collapse",
    collapse_label: "secret",
    priority: 10,
    applies_to: ["user_message", "tool_output"],
    is_builtin: true,
    is_active: true,
    created_at: "2026-03-10T00:00:00.000Z",
    updated_at: "2026-03-10T00:00:02.000Z",
  } satisfies MaskTemplateDto);
  assert.ok(mask.created_at instanceof Date);
  assert.equal(mask.collapse_label, "secret");

  const revision = mapProjectRevision({
    id: "revision-1",
    project_revision_id: "project-1:r2",
    project_id: "project-1",
    linkage_state: "committed",
    confidence: 1,
    link_reason: "manual_override",
    manual_override_status: "applied",
    observation_refs: ["obs-1"],
    created_at: "2026-03-10T00:00:06.000Z",
  } satisfies ProjectLinkRevisionDto);
  assert.ok(revision.created_at instanceof Date);
  assert.equal(revision.link_reason, "manual_override");

  const event = mapProjectLineageEvent({
    id: "evt-1",
    project_id: "project-1",
    project_revision_id: "project-1:r2",
    event_kind: "manual_override",
    created_at: "2026-03-10T00:00:07.000Z",
    detail: { summary: "Manual project override applied" },
  } satisfies ProjectLineageEventDto);
  assert.ok(event.created_at instanceof Date);
  assert.equal(event.event_kind, "manual_override");

  const override = mapProjectManualOverride({
    id: "override-1",
    target_kind: "turn",
    target_ref: "turn-1",
    project_id: "project-1",
    display_name: "Manual Project",
    created_at: "2026-03-10T00:00:08.000Z",
    updated_at: "2026-03-10T00:00:09.000Z",
  } satisfies ProjectManualOverrideDto);
  assert.ok(override.created_at instanceof Date);
  assert.ok(override.updated_at instanceof Date);
  assert.equal(override.target_ref, "turn-1");
});

test("mapLinkingReview composes mapped projects, turns, and observations", () => {
  const review = mapLinkingReview({
    committed_projects: [
      {
        project_id: "project-1",
        project_revision_id: "project-1:r1",
        display_name: "Committed Project",
        slug: "committed-project",
        linkage_state: "committed",
        confidence: 1,
        link_reason: "repo_fingerprint_match",
        manual_override_status: "none",
        committed_turn_count: 2,
        candidate_turn_count: 0,
        session_count: 1,
        source_platforms: ["codex"],
        host_ids: ["host-1"],
        created_at: "2026-03-10T00:00:00.000Z",
        updated_at: "2026-03-10T00:00:01.000Z",
      },
    ],
    candidate_projects: [],
    unlinked_turns: [createTurn({ id: "turn-u", canonical_text: "Unlinked turn", session_id: "session-u", source_id: "src-u" })],
    candidate_turns: [createTurn({ id: "turn-c", canonical_text: "Candidate turn", session_id: "session-c", source_id: "src-c" })],
    project_observations: [
      {
        id: "obs-1",
        source_id: "src-1",
        session_ref: "session-1",
        observed_at: "2026-03-10T00:00:02.000Z",
        confidence: 0.7,
        workspace_path: "/workspace/cchistory",
        host_id: "host-1",
        source_platform: "codex",
      },
    ],
  } satisfies LinkingReviewResponse);

  assert.equal(review.committed_projects.length, 1);
  assert.equal(review.committed_projects[0]?.name, "Committed Project");
  assert.ok(review.committed_projects[0]?.created_at instanceof Date);
  assert.equal(review.unlinked_turns[0]?.id, "turn-u");
  assert.equal(review.candidate_turns[0]?.id, "turn-c");
  assert.ok(review.project_observations[0]?.observed_at instanceof Date);
});

test("mapTurnContext converts nested temporal fields and preserves detail ordering", () => {
  const context = mapTurnContext({
    turn_id: "turn-ctx-1",
    system_messages: [
      {
        id: "sys-1",
        content: "System guidance",
        display_segments: [{ type: "text", content: "System guidance" }],
        position: "before_user",
        sequence: 0,
        created_at: "2026-03-10T00:00:00.000Z",
      },
    ],
    assistant_replies: [
      {
        id: "reply-1",
        content: "Assistant reply",
        display_segments: [{ type: "text", content: "Assistant reply" }],
        content_preview: "Assistant reply",
        token_usage: {
          input_tokens: 12,
          output_tokens: 34,
          total_tokens: 46,
        },
        token_count: 34,
        model: "gpt-5",
        created_at: "2026-03-10T00:00:01.000Z",
        tool_call_ids: ["tool-1"],
        stop_reason: "tool_use",
      },
    ],
    tool_calls: [
      {
        id: "tool-1",
        tool_name: "search_repo",
        input: { query: "alpha" },
        input_summary: "search_repo(alpha)",
        input_display_segments: [{ type: "code", content: 'search_repo("alpha")' }],
        output: "found alpha",
        output_preview: "found alpha",
        output_display_segments: [{ type: "text", content: "found alpha" }],
        status: "success",
        duration_ms: 42,
        reply_id: "reply-1",
        sequence: 1,
        created_at: "2026-03-10T00:00:02.000Z",
      },
    ],
    raw_event_refs: ["evt-1", "evt-2"],
  } satisfies TurnContextProjectionDto);

  assert.equal(context.turn_id, "turn-ctx-1");
  assert.equal(context.system_messages.length, 1);
  assert.equal(context.assistant_replies.length, 1);
  assert.equal(context.tool_calls.length, 1);
  assert.ok(context.system_messages[0]?.created_at instanceof Date);
  assert.ok(context.assistant_replies[0]?.created_at instanceof Date);
  assert.ok(context.tool_calls[0]?.created_at instanceof Date);
  assert.equal(context.system_messages[0]?.position, "before_user");
  assert.equal(context.assistant_replies[0]?.tool_call_ids[0], "tool-1");
  assert.equal(context.assistant_replies[0]?.token_usage?.total_tokens, 46);
  assert.equal(context.tool_calls[0]?.reply_id, "reply-1");
  assert.equal(context.tool_calls[0]?.duration_ms, 42);
  assert.deepEqual(context.raw_event_refs, ["evt-1", "evt-2"]);
});

test("mapSessionRelatedWork converts temporal fields and preserves raw detail", () => {
  const relatedWork = mapSessionRelatedWork({
    id: "related-1",
    source_id: "src-1",
    source_platform: "claude_code",
    source_session_ref: "session-1",
    relation_kind: "delegated_session",
    target_kind: "session",
    target_session_ref: "session-1",
    transcript_primary: true,
    evidence_confidence: 0.95,
    child_agent_key: "agent-1",
    title: "Subagent review",
    created_at: "2026-03-10T00:00:00.000Z",
    updated_at: "2026-03-10T00:00:02.000Z",
    fragment_refs: ["fragment-1"],
    raw_detail: { is_sidechain: true, parent_uuid: "parent-1" },
  });

  assert.ok(relatedWork.created_at instanceof Date);
  assert.ok(relatedWork.updated_at instanceof Date);
  assert.equal(relatedWork.relation_kind, "delegated_session");
  assert.equal(relatedWork.raw_detail.parent_uuid, "parent-1");
});

test("mapSearchResult creates a fallback session when DTO omits one", () => {
  const result = mapSearchResult({
    turn: {
      id: "turn-1",
      revision_id: "turn-1:r1",
      user_messages: [],
      raw_text: "raw",
      canonical_text: "Search me",
      display_segments: [{ type: "text", content: "Search me" }],
      created_at: "2026-03-10T00:00:00.000Z",
      submission_started_at: "2026-03-10T00:00:01.000Z",
      last_context_activity_at: "2026-03-10T00:00:02.000Z",
      session_id: "session-fallback",
      source_id: "src-1",
      link_state: "candidate",
      sync_axis: "current",
      value_axis: "active",
      retention_axis: "keep_raw_and_derived",
      context_ref: "turn-1",
      context_summary: {
        assistant_reply_count: 0,
        tool_call_count: 0,
        has_errors: false,
      },
    },
    highlights: [{ start: 0, end: 6 }],
    relevance_score: 0.9,
  } satisfies TurnSearchResultDto);

  assert.equal(result.session.id, "session-fallback");
  assert.equal(result.session.source_platform, "other");
  assert.equal(result.session.turn_count, 1);
  assert.ok(result.session.created_at instanceof Date);
});

test("mapDriftReport normalizes report and timeline dates", () => {
  const report = mapDriftReport({
    generated_at: "2026-03-12T05:00:00.000Z",
    global_drift_index: 0.2,
    active_sources: 2,
    sources_awaiting_sync: 1,
    orphaned_turns: 0,
    unlinked_turns: 3,
    candidate_turns: 4,
    consistency_score: 0.8,
    timeline: [
      {
        date: "2026-03-11",
        global_drift_index: 0.3,
        consistency_score: 0.7,
        total_turns: 10,
      },
    ],
  } satisfies DriftReportDto);

  assert.ok(report.generated_at instanceof Date);
  assert.ok(report.timeline[0]?.date instanceof Date);
  assert.equal(report.timeline[0]?.date.toISOString(), "2026-03-11T00:00:00.000Z");
});

test("mapLinkingObservation preserves identity and converts observed_at", () => {
  const observation = mapLinkingObservation({
    id: "obs-1",
    source_id: "src-1",
    session_ref: "session-1",
    observed_at: "2026-03-10T10:00:00.000Z",
    confidence: 0.6,
    workspace_path: "/workspace/cchistory",
    host_id: "host-1",
    source_platform: "codex",
  });

  assert.equal(observation.id, "obs-1");
  assert.ok(observation.observed_at instanceof Date);
});

test("mapTurnLineage converts nested temporal fields", () => {
  const lineage = mapTurnLineage({
    turn: {
      id: "turn-1",
      revision_id: "turn-1:r1",
      user_messages: [],
      raw_text: "raw",
      canonical_text: "Need lineage",
      display_segments: [{ type: "text", content: "Need lineage" }],
      created_at: "2026-03-10T00:00:00.000Z",
      submission_started_at: "2026-03-10T00:00:01.000Z",
      last_context_activity_at: "2026-03-10T00:00:02.000Z",
      session_id: "session-1",
      source_id: "src-1",
      link_state: "candidate",
      sync_axis: "current",
      value_axis: "active",
      retention_axis: "keep_raw_and_derived",
      context_ref: "turn-1",
      context_summary: {
        assistant_reply_count: 1,
        tool_call_count: 1,
        has_errors: false,
      },
    },
    session: {
      id: "session-1",
      source_id: "src-1",
      source_platform: "codex",
      host_id: "host-1",
      created_at: "2026-03-10T00:00:00.000Z",
      updated_at: "2026-03-10T00:00:02.000Z",
      turn_count: 1,
      sync_axis: "current",
    },
    candidate_chain: [
      {
        id: "candidate-1",
        source_id: "src-1",
        session_ref: "session-1",
        candidate_kind: "turn",
        input_atom_refs: ["atom-1"],
        started_at: "2026-03-10T00:00:01.000Z",
        ended_at: "2026-03-10T00:00:02.000Z",
        rule_version: "2026-03-10.1",
        evidence: { turn_candidate_id: "candidate-1" },
      },
    ],
    atoms: [
      {
        id: "atom-1",
        source_id: "src-1",
        session_ref: "session-1",
        seq_no: 0,
        actor_kind: "user",
        origin_kind: "user_authored",
        content_kind: "text",
        time_key: "2026-03-10T00:00:01.000Z",
        display_policy: "show",
        payload: { text: "Need lineage" },
        fragment_refs: ["fragment-1"],
        source_format_profile_id: "codex:jsonl:v1",
      },
    ],
    edges: [],
    fragments: [
      {
        id: "fragment-1",
        source_id: "src-1",
        session_ref: "session-1",
        record_id: "record-1",
        seq_no: 0,
        fragment_kind: "text",
        actor_kind: "user",
        origin_kind: "user_authored",
        time_key: "2026-03-10T00:00:01.000Z",
        payload: { text: "Need lineage" },
        raw_refs: ["record-1"],
        source_format_profile_id: "codex:jsonl:v1",
      },
    ],
    records: [
      {
        id: "record-1",
        source_id: "src-1",
        blob_id: "blob-1",
        session_ref: "session-1",
        ordinal: 0,
        record_path_or_offset: "0",
        observed_at: "2026-03-10T00:00:01.000Z",
        parseable: true,
        raw_json: "{}",
      },
    ],
    blobs: [
      {
        id: "blob-1",
        source_id: "src-1",
        host_id: "host-1",
        origin_path: "/tmp/blob.jsonl",
        checksum: "checksum",
        size_bytes: 10,
        captured_at: "2026-03-10T00:00:00.000Z",
        capture_run_id: "capture-1",
      },
    ],
  } satisfies PipelineLineageDto);

  assert.ok(lineage.turn.created_at instanceof Date);
  assert.ok(lineage.session?.updated_at instanceof Date);
  assert.ok(lineage.candidate_chain[0]?.started_at instanceof Date);
  assert.ok(lineage.atoms[0]?.time_key instanceof Date);
  assert.ok(lineage.fragments[0]?.time_key instanceof Date);
  assert.ok(lineage.records[0]?.observed_at instanceof Date);
  assert.ok(lineage.blobs[0]?.captured_at instanceof Date);
});
