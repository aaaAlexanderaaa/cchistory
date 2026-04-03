import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type SourceSyncPayload, type UserTurnProjection } from "@cchistory/domain";

export interface FixturePayloadOptions {
  sessionId?: string;
  turnId?: string;
  hostId?: string;
  platform?: "codex" | "claude_code" | "factory_droid" | "amp" | "cursor" | "antigravity" | "gemini";
  baseDir?: string;
  workingDirectory?: string;
  includeProjectObservation?: boolean;
  projectObservation?: {
    workspacePath?: string;
    repoRoot?: string;
    repoRemote?: string;
    repoFingerprint?: string;
    sourceNativeProjectRef?: string;
    confidence?: number;
  };
}

export function createFixturePayload(
  sourceId: string,
  canonicalText: string,
  stageRunId: string,
  options: FixturePayloadOptions = {},
): SourceSyncPayload {
  const createdAt = "2026-03-09T09:00:00.000Z";
  const assistantAt = "2026-03-09T09:00:01.000Z";
  const toolCallAt = "2026-03-09T09:00:02.000Z";
  const toolResultAt = "2026-03-09T09:00:03.000Z";
  const sessionId = options.sessionId ?? "session-1";
  const turnId = options.turnId ?? "turn-1";
  const hostId = options.hostId ?? "host-1";
  const platform = options.platform ?? "codex";
  const baseDir = options.baseDir ?? `/tmp/storage-fixture/${sourceId}`;
  const workingDirectory = options.workingDirectory ?? "/workspace/storage-fixture";
  const projectObservation = options.projectObservation;
  const includeProjectObservation = options.includeProjectObservation ?? Boolean(projectObservation);
  const blobId = `${turnId}-blob`;
  const recordId = `${turnId}-record`;
  const userFragmentId = `${turnId}-fragment-user`;
  const assistantFragmentId = `${turnId}-fragment-assistant`;
  const toolCallFragmentId = `${turnId}-fragment-tool-call`;
  const toolResultFragmentId = `${turnId}-fragment-tool-result`;
  const userAtomId = `${turnId}-atom-user`;
  const assistantAtomId = `${turnId}-atom-assistant`;
  const toolCallAtomId = `${turnId}-atom-tool-call`;
  const toolResultAtomId = `${turnId}-atom-tool-result`;
  const submissionCandidateId = `${turnId}-candidate-submission`;
  const turnCandidateId = `${turnId}-candidate-turn`;
  const contextCandidateId = `${turnId}-candidate-context`;
  const projectObservationCandidateId = `${turnId}-candidate-project-observation`;
  const assistantReplyId = `${turnId}-assistant-reply`;
  const toolCallProjectionId = `${turnId}-tool-call`;
  const userMessageId = `${turnId}-user-message`;

  const candidates: SourceSyncPayload["candidates"] = [
    {
      id: submissionCandidateId,
      source_id: sourceId,
      session_ref: sessionId,
      candidate_kind: "submission_group",
      input_atom_refs: [userAtomId],
      started_at: createdAt,
      ended_at: createdAt,
      rule_version: "2026-03-09.1",
      evidence: { assistant_seen_after_group_start: true },
    },
    {
      id: turnCandidateId,
      source_id: sourceId,
      session_ref: sessionId,
      candidate_kind: "turn",
      input_atom_refs: [userAtomId],
      started_at: createdAt,
      ended_at: toolResultAt,
      rule_version: "2026-03-09.1",
      evidence: { submission_group_id: submissionCandidateId },
    },
    {
      id: contextCandidateId,
      source_id: sourceId,
      session_ref: sessionId,
      candidate_kind: "context_span",
      input_atom_refs: [assistantAtomId, toolCallAtomId, toolResultAtomId],
      started_at: createdAt,
      ended_at: toolResultAt,
      rule_version: "2026-03-09.1",
      evidence: { turn_candidate_id: turnCandidateId },
    },
  ];

  if (includeProjectObservation) {
    candidates.push({
      id: projectObservationCandidateId,
      source_id: sourceId,
      session_ref: sessionId,
      candidate_kind: "project_observation",
      input_atom_refs: [userAtomId],
      started_at: createdAt,
      ended_at: createdAt,
      rule_version: "2026-03-09.1",
      evidence: {
        workspace_path: projectObservation?.workspacePath ?? workingDirectory,
        workspace_path_normalized: projectObservation?.workspacePath ?? workingDirectory,
        repo_root: projectObservation?.repoRoot,
        repo_remote: projectObservation?.repoRemote,
        repo_fingerprint: projectObservation?.repoFingerprint,
        source_native_project_ref: projectObservation?.sourceNativeProjectRef,
        confidence: projectObservation?.confidence ?? 0.5,
      },
    });
  }

  return {
    source: {
      id: sourceId,
      slot_id: platform,
      family: "local_coding_agent",
      platform,
      display_name: "Storage fixture",
      base_dir: baseDir,
      host_id: hostId,
      last_sync: toolResultAt,
      sync_status: "healthy",
      total_blobs: 1,
      total_records: 1,
      total_fragments: 4,
      total_atoms: 4,
      total_sessions: 1,
      total_turns: 1,
    },
    stage_runs: [
      {
        id: stageRunId,
        source_id: sourceId,
        stage_kind: "finalize_projections",
        parser_version: "codex-parser@2026-03-09.1",
        parser_capabilities: ["turn_projections", "turn_context_projections", "loss_audits"],
        source_format_profile_ids: ["codex:jsonl:v1"],
        started_at: createdAt,
        finished_at: toolResultAt,
        status: "success",
        stats: { turns: 1, sessions: 1 },
      },
    ],
    loss_audits: [
      {
        id: `${turnId}-loss-audit`,
        source_id: sourceId,
        stage_run_id: stageRunId,
        stage_kind: "finalize_projections",
        diagnostic_code: "fixture_projection_gap",
        severity: "warning",
        scope_ref: toolResultFragmentId,
        session_ref: sessionId,
        blob_ref: blobId,
        record_ref: recordId,
        fragment_ref: toolResultFragmentId,
        source_format_profile_id: "codex:jsonl:v1",
        loss_kind: "unknown_fragment",
        detail: canonicalText === "New text" ? "updated fixture loss audit" : "fixture loss audit",
        created_at: toolResultAt,
      },
    ],
    blobs: [
      {
        id: blobId,
        source_id: sourceId,
        host_id: hostId,
        origin_path: path.join(baseDir, "session.jsonl"),
        captured_path: path.join(baseDir, ".cache", "session.jsonl"),
        checksum: "checksum-1",
        size_bytes: 128,
        captured_at: createdAt,
        capture_run_id: "capture-run-1",
      },
    ],
    records: [
      {
        id: recordId,
        source_id: sourceId,
        blob_id: blobId,
        session_ref: sessionId,
        ordinal: 0,
        record_path_or_offset: "0",
        observed_at: createdAt,
        parseable: true,
        raw_json: "{\"fixture\":true}",
      },
    ],
    fragments: [
      {
        id: userFragmentId,
        source_id: sourceId,
        session_ref: sessionId,
        record_id: recordId,
        seq_no: 0,
        fragment_kind: "text",
        actor_kind: "user",
        origin_kind: "user_authored",
        time_key: createdAt,
        payload: { text: canonicalText },
        raw_refs: [recordId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: assistantFragmentId,
        source_id: sourceId,
        session_ref: sessionId,
        record_id: recordId,
        seq_no: 1,
        fragment_kind: "text",
        actor_kind: "assistant",
        origin_kind: "assistant_authored",
        time_key: assistantAt,
        payload: { text: "Running tool" },
        raw_refs: [recordId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: toolCallFragmentId,
        source_id: sourceId,
        session_ref: sessionId,
        record_id: recordId,
        seq_no: 2,
        fragment_kind: "tool_call",
        actor_kind: "tool",
        origin_kind: "tool_generated",
        time_key: toolCallAt,
        payload: { call_id: "call-1", tool_name: "shell", input: {} },
        raw_refs: [recordId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: toolResultFragmentId,
        source_id: sourceId,
        session_ref: sessionId,
        record_id: recordId,
        seq_no: 3,
        fragment_kind: "tool_result",
        actor_kind: "tool",
        origin_kind: "tool_generated",
        time_key: toolResultAt,
        payload: { call_id: "call-1", output: "ok" },
        raw_refs: [recordId],
        source_format_profile_id: "codex:jsonl:v1",
      },
    ],
    atoms: [
      {
        id: userAtomId,
        source_id: sourceId,
        session_ref: sessionId,
        seq_no: 0,
        actor_kind: "user",
        origin_kind: "user_authored",
        content_kind: "text",
        time_key: createdAt,
        display_policy: "show",
        payload: { text: canonicalText },
        fragment_refs: [userFragmentId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: assistantAtomId,
        source_id: sourceId,
        session_ref: sessionId,
        seq_no: 1,
        actor_kind: "assistant",
        origin_kind: "assistant_authored",
        content_kind: "text",
        time_key: assistantAt,
        display_policy: "show",
        payload: { text: "Running tool" },
        fragment_refs: [assistantFragmentId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: toolCallAtomId,
        source_id: sourceId,
        session_ref: sessionId,
        seq_no: 2,
        actor_kind: "tool",
        origin_kind: "tool_generated",
        content_kind: "tool_call",
        time_key: toolCallAt,
        display_policy: "show",
        payload: { call_id: "call-1", tool_name: "shell", input: {} },
        fragment_refs: [toolCallFragmentId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: toolResultAtomId,
        source_id: sourceId,
        session_ref: sessionId,
        seq_no: 3,
        actor_kind: "tool",
        origin_kind: "tool_generated",
        content_kind: "tool_result",
        time_key: toolResultAt,
        display_policy: "show",
        payload: { call_id: "call-1", output: "ok" },
        fragment_refs: [toolResultFragmentId],
        source_format_profile_id: "codex:jsonl:v1",
      },
    ],
    edges: [
      {
        id: `${turnId}-edge-spawned-from`,
        source_id: sourceId,
        session_ref: sessionId,
        from_atom_id: toolCallAtomId,
        to_atom_id: assistantAtomId,
        edge_kind: "spawned_from",
      },
      {
        id: `${turnId}-edge-tool-result-for`,
        source_id: sourceId,
        session_ref: sessionId,
        from_atom_id: toolResultAtomId,
        to_atom_id: toolCallAtomId,
        edge_kind: "tool_result_for",
      },
    ],
    candidates,
    sessions: [
      {
        id: sessionId,
        source_id: sourceId,
        source_platform: platform,
        host_id: hostId,
        title: canonicalText,
        created_at: createdAt,
        updated_at: toolResultAt,
        turn_count: 1,
        model: "gpt-5",
        working_directory: workingDirectory,
        sync_axis: "current",
      },
    ],
    turns: [
      {
        id: turnId,
        revision_id: `${turnId}:r1`,
        user_messages: [
          {
            id: userMessageId,
            raw_text: canonicalText,
            sequence: 0,
            is_injected: false,
            created_at: createdAt,
            atom_refs: [userAtomId],
          },
        ],
        raw_text: canonicalText,
        canonical_text: canonicalText,
        display_segments: [{ type: "text", content: canonicalText }],
        created_at: createdAt,
        submission_started_at: createdAt,
        last_context_activity_at: toolResultAt,
        session_id: sessionId,
        source_id: sourceId,
        link_state: "unlinked",
        sync_axis: "current",
        value_axis: "active",
        retention_axis: "keep_raw_and_derived",
        context_ref: turnId,
        context_summary: {
          assistant_reply_count: 1,
          tool_call_count: 1,
          token_usage: {
            input_tokens: 1200,
            cache_read_input_tokens: 300,
            cache_creation_input_tokens: 100,
            output_tokens: 450,
            total_tokens: 2050,
          },
          total_tokens: 2050,
          primary_model: "gpt-5",
          has_errors: false,
        },
        lineage: {
          atom_refs: [userAtomId, assistantAtomId, toolCallAtomId, toolResultAtomId],
          candidate_refs: candidates.map((candidate) => candidate.id),
          fragment_refs: [userFragmentId, assistantFragmentId, toolCallFragmentId, toolResultFragmentId],
          record_refs: [recordId],
          blob_refs: [blobId],
        },
      },
    ],
    contexts: [
      {
        turn_id: turnId,
        system_messages: [],
        assistant_replies: [
          {
            id: assistantReplyId,
            content: "Running tool",
            display_segments: [{ type: "text", content: "Running tool" }],
            content_preview: "Running tool",
            token_usage: {
              input_tokens: 1200,
              output_tokens: 450,
              total_tokens: 1650,
            },
            token_count: 450,
            model: "gpt-5",
            created_at: assistantAt,
            tool_call_ids: [toolCallProjectionId],
            stop_reason: "tool_use",
          },
        ],
        tool_calls: [
          {
            id: toolCallProjectionId,
            tool_name: "shell",
            input: {},
            input_summary: "{}",
            input_display_segments: [{ type: "text", content: "{}" }],
            output: "ok",
            output_preview: "ok",
            output_display_segments: [{ type: "text", content: "ok" }],
            status: "success",
            reply_id: assistantReplyId,
            sequence: 0,
            created_at: toolCallAt,
          },
        ],
        raw_event_refs: [recordId],
      },
    ],
  };
}

export function rewriteFixtureTimestamps(
  payload: SourceSyncPayload,
  replacements: Record<string, string>,
): SourceSyncPayload {
  let json = JSON.stringify(payload);
  for (const [from, to] of Object.entries(replacements)) {
    json = json.replaceAll(from, to);
  }
  return JSON.parse(json) as SourceSyncPayload;
}

export function combineFixturePayloads(
  left: SourceSyncPayload,
  right: SourceSyncPayload,
  options: { sessionId: string; title: string },
): SourceSyncPayload {
  const leftSession = left.sessions.find((session) => session.id === options.sessionId);
  const rightSession = right.sessions.find((session) => session.id === options.sessionId);
  assert.ok(leftSession);
  assert.ok(rightSession);

  return {
    source: {
      ...left.source,
      total_blobs: left.blobs.length + right.blobs.length,
      total_records: left.records.length + right.records.length,
      total_fragments: left.fragments.length + right.fragments.length,
      total_atoms: left.atoms.length + right.atoms.length,
      total_sessions: 1,
      total_turns: left.turns.length + right.turns.length,
    },
    stage_runs: [...left.stage_runs, ...right.stage_runs],
    loss_audits: [...left.loss_audits, ...right.loss_audits],
    blobs: [...left.blobs, ...right.blobs],
    records: [...left.records, ...right.records],
    fragments: [...left.fragments, ...right.fragments],
    atoms: [...left.atoms, ...right.atoms],
    edges: [...left.edges, ...right.edges],
    candidates: [...left.candidates, ...right.candidates],
    sessions: [
      {
        ...leftSession,
        title: options.title,
        updated_at: rightSession.updated_at > leftSession.updated_at ? rightSession.updated_at : leftSession.updated_at,
        turn_count: left.turns.length + right.turns.length,
      },
    ],
    turns: [...left.turns, ...right.turns].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    contexts: [...left.contexts, ...right.contexts],
  };
}

export function rewriteAtomEdgesAsLegacyTable(dbPath: string): void {
  const db = new DatabaseSync(dbPath);

  try {
    db.exec("DROP INDEX IF EXISTS idx_atom_edges_from");
    db.exec("DROP INDEX IF EXISTS idx_atom_edges_to");
    db.exec(`
      CREATE TABLE atom_edges_legacy (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        session_ref TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
    `);
    db.exec(`
      INSERT INTO atom_edges_legacy (id, source_id, session_ref, payload_json)
      SELECT id, source_id, session_ref, payload_json FROM atom_edges;
    `);
    db.exec("DROP TABLE atom_edges");
    db.exec("ALTER TABLE atom_edges_legacy RENAME TO atom_edges");
  } finally {
    db.close();
  }
}

export function dropSchemaMetadataTables(dbPath: string): void {
  const db = new DatabaseSync(dbPath);

  try {
    db.exec("DROP TABLE schema_migrations;");
    db.exec("DROP TABLE schema_meta;");
  } finally {
    db.close();
  }
}
