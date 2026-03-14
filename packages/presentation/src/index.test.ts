import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  DriftReportDto,
  PipelineLineageDto,
  TurnSearchResultDto,
} from "../../api-client/dist/index.js";
import {
  mapDriftReport,
  mapLinkingObservation,
  mapSearchResult,
  mapTurnLineage,
  projectColor,
} from "./index.js";

test("projectColor stays deterministic per project id", () => {
  assert.equal(projectColor("project-alpha"), projectColor("project-alpha"));
  assert.notEqual(projectColor("project-alpha"), projectColor("project-beta"));
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
