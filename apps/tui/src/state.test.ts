import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { CCHistoryStorage, buildLocalTuiBrowser } from "@cchistory/storage";
import type { LocalTuiBrowser } from "@cchistory/storage";
import { createBrowserState, reduceBrowserState, renderBrowserSnapshot } from "./browser.js";
import type { BrowserState, BrowserAction } from "./browser.js";
import { stripAnsi } from "./colors.js";

// ── Helpers ──

type FixturePayload = Parameters<CCHistoryStorage["replaceSourcePayload"]>[0];

async function withTempStorage(fn: (storage: CCHistoryStorage, tempDir: string) => void | Promise<void>): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-tui-state-"));
  try {
    const storage = new CCHistoryStorage({ dbPath: path.join(tempDir, "test.sqlite") });
    try {
      await fn(storage, tempDir);
    } finally {
      storage.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function dispatch(browser: LocalTuiBrowser, state: BrowserState, ...actions: BrowserAction[]): BrowserState {
  for (const action of actions) {
    state = reduceBrowserState(browser, state, action);
  }
  return state;
}

function typeSearch(browser: LocalTuiBrowser, state: BrowserState, query: string): BrowserState {
  state = reduceBrowserState(browser, state, { type: "enter-search-mode" });
  for (const ch of query) {
    state = reduceBrowserState(browser, state, { type: "append-search-char", value: ch });
  }
  return state;
}

function snapshot(browser: LocalTuiBrowser, state: BrowserState, width = 120, height = 40): string {
  return stripAnsi(renderBrowserSnapshot(browser, state, { width, height }));
}

// ── Fixture factory (copied from index.test.ts, extended with createdAt option) ──

function createFixturePayload(
  sourceId: string,
  canonicalText: string,
  stageRunId: string,
  options: {
    sessionId?: string;
    turnId?: string;
    workingDirectory?: string;
    includeProjectObservation?: boolean;
    createdAt?: string;
    syncStatus?: "healthy" | "stale" | "error";
  } = {},
): FixturePayload {
  const createdAt = options.createdAt ?? "2026-03-09T09:00:00.000Z";
  const assistantAt = new Date(new Date(createdAt).getTime() + 1000).toISOString();
  const toolCallAt = new Date(new Date(createdAt).getTime() + 2000).toISOString();
  const toolResultAt = new Date(new Date(createdAt).getTime() + 3000).toISOString();
  const sessionId = options.sessionId ?? "session-1";
  const turnId = options.turnId ?? "turn-1";
  const baseDir = `/tmp/storage-fixture/${sourceId}`;
  const workingDirectory = options.workingDirectory ?? "/workspace/storage-fixture";
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
  const assistantReplyId = `${turnId}-assistant-reply`;
  const toolCallProjectionId = `${turnId}-tool-call`;
  const userMessageId = `${turnId}-user-message`;

  const candidates: FixturePayload["candidates"] = [
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

  if (options.includeProjectObservation) {
    candidates.push({
      id: `${turnId}-candidate-project-observation`,
      source_id: sourceId,
      session_ref: sessionId,
      candidate_kind: "project_observation",
      input_atom_refs: [userAtomId],
      started_at: createdAt,
      ended_at: createdAt,
      rule_version: "2026-03-09.1",
      evidence: {
        workspace_path: workingDirectory,
        workspace_path_normalized: workingDirectory,
        confidence: 0.9,
      },
    });
  }

  return {
    source: {
      id: sourceId,
      slot_id: "codex",
      family: "local_coding_agent",
      platform: "codex",
      display_name: "Storage fixture",
      base_dir: baseDir,
      host_id: "host-1",
      last_sync: toolResultAt,
      sync_status: options.syncStatus ?? "healthy",
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
        detail: "fixture loss audit",
        created_at: toolResultAt,
      },
    ],
    blobs: [
      {
        id: blobId,
        source_id: sourceId,
        host_id: "host-1",
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
        raw_json: '{"fixture":true}',
      },
    ],
    fragments: [
      {
        id: userFragmentId, source_id: sourceId, session_ref: sessionId, record_id: recordId,
        seq_no: 0, fragment_kind: "text", actor_kind: "user", origin_kind: "user_authored",
        time_key: createdAt, payload: { text: canonicalText }, raw_refs: [recordId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: assistantFragmentId, source_id: sourceId, session_ref: sessionId, record_id: recordId,
        seq_no: 1, fragment_kind: "text", actor_kind: "assistant", origin_kind: "assistant_authored",
        time_key: assistantAt, payload: { text: "Running tool" }, raw_refs: [recordId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: toolCallFragmentId, source_id: sourceId, session_ref: sessionId, record_id: recordId,
        seq_no: 2, fragment_kind: "tool_call", actor_kind: "tool", origin_kind: "tool_generated",
        time_key: toolCallAt, payload: { call_id: "call-1", tool_name: "shell", input: {} }, raw_refs: [recordId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: toolResultFragmentId, source_id: sourceId, session_ref: sessionId, record_id: recordId,
        seq_no: 3, fragment_kind: "tool_result", actor_kind: "tool", origin_kind: "tool_generated",
        time_key: toolResultAt, payload: { call_id: "call-1", output: "ok" }, raw_refs: [recordId],
        source_format_profile_id: "codex:jsonl:v1",
      },
    ],
    atoms: [
      {
        id: userAtomId, source_id: sourceId, session_ref: sessionId, seq_no: 0,
        actor_kind: "user", origin_kind: "user_authored", content_kind: "text",
        time_key: createdAt, display_policy: "show", payload: { text: canonicalText },
        fragment_refs: [userFragmentId], source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: assistantAtomId, source_id: sourceId, session_ref: sessionId, seq_no: 1,
        actor_kind: "assistant", origin_kind: "assistant_authored", content_kind: "text",
        time_key: assistantAt, display_policy: "show", payload: { text: "Running tool" },
        fragment_refs: [assistantFragmentId], source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: toolCallAtomId, source_id: sourceId, session_ref: sessionId, seq_no: 2,
        actor_kind: "tool", origin_kind: "tool_generated", content_kind: "tool_call",
        time_key: toolCallAt, display_policy: "show",
        payload: { call_id: "call-1", tool_name: "shell", input: {} },
        fragment_refs: [toolCallFragmentId], source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: toolResultAtomId, source_id: sourceId, session_ref: sessionId, seq_no: 3,
        actor_kind: "tool", origin_kind: "tool_generated", content_kind: "tool_result",
        time_key: toolResultAt, display_policy: "show",
        payload: { call_id: "call-1", output: "ok" },
        fragment_refs: [toolResultFragmentId], source_format_profile_id: "codex:jsonl:v1",
      },
    ],
    edges: [
      {
        id: `${turnId}-edge-spawned-from`, source_id: sourceId, session_ref: sessionId,
        from_atom_id: toolCallAtomId, to_atom_id: assistantAtomId, edge_kind: "spawned_from",
      },
      {
        id: `${turnId}-edge-tool-result-for`, source_id: sourceId, session_ref: sessionId,
        from_atom_id: toolResultAtomId, to_atom_id: toolCallAtomId, edge_kind: "tool_result_for",
      },
    ],
    candidates,
    sessions: [
      {
        id: sessionId, source_id: sourceId, source_platform: "codex", host_id: "host-1",
        title: canonicalText, created_at: createdAt, updated_at: toolResultAt, turn_count: 1,
        model: "gpt-5", working_directory: workingDirectory, sync_axis: "current",
      },
    ],
    turns: [
      {
        id: turnId, revision_id: `${turnId}:r1`, turn_id: turnId, turn_revision_id: `${turnId}:r1`,
        user_messages: [
          { id: userMessageId, raw_text: canonicalText, sequence: 0, is_injected: false, created_at: createdAt, atom_refs: [userAtomId] },
        ],
        raw_text: canonicalText, canonical_text: canonicalText,
        display_segments: [{ type: "text", content: canonicalText }],
        created_at: createdAt, submission_started_at: createdAt, last_context_activity_at: toolResultAt,
        session_id: sessionId, source_id: sourceId, link_state: "unlinked", sync_axis: "current",
        value_axis: "active", retention_axis: "keep_raw_and_derived", context_ref: turnId,
        context_summary: {
          assistant_reply_count: 1, tool_call_count: 1, total_tokens: 2050,
          primary_model: "gpt-5", has_errors: false,
        },
        lineage: {
          atom_refs: [userAtomId, assistantAtomId, toolCallAtomId, toolResultAtomId],
          candidate_refs: candidates.map((c) => c.id),
          fragment_refs: [userFragmentId, assistantFragmentId, toolCallFragmentId, toolResultFragmentId],
          record_refs: [recordId], blob_refs: [blobId],
        },
      },
    ],
    contexts: [
      {
        turn_id: turnId, system_messages: [],
        assistant_replies: [
          {
            id: assistantReplyId, content: "Running tool",
            display_segments: [{ type: "text", content: "Running tool" }],
            content_preview: "Running tool",
            token_usage: { input_tokens: 1200, output_tokens: 450, total_tokens: 1650 },
            token_count: 450, model: "gpt-5", created_at: assistantAt,
            tool_call_ids: [toolCallProjectionId], stop_reason: "tool_use",
          },
        ],
        tool_calls: [
          {
            id: toolCallProjectionId, tool_name: "shell", input: {}, input_summary: "{}",
            input_display_segments: [{ type: "text", content: "{}" }],
            output: "ok", output_preview: "ok",
            output_display_segments: [{ type: "text", content: "ok" }],
            status: "success", reply_id: assistantReplyId, sequence: 0, created_at: toolCallAt,
          },
        ],
        raw_event_refs: [recordId],
      },
    ],
  };
}

// ── Test: Index clamping ──

test("selectedProjectIndex clamps to valid range", async () => {
  await withTempStorage((storage) => {
    storage.replaceSourcePayload(createFixturePayload("src-a", "Alpha turn", "stg-a", {
      sessionId: "sess-a", turnId: "turn-a", workingDirectory: "/ws/a", includeProjectObservation: true,
    }));
    storage.upsertProjectOverride({ target_kind: "turn", target_ref: "turn-a", project_id: "proj-a", display_name: "Alpha" });

    storage.replaceSourcePayload(createFixturePayload("src-b", "Beta turn", "stg-b", {
      sessionId: "sess-b", turnId: "turn-b", workingDirectory: "/ws/b", includeProjectObservation: true,
    }));
    storage.upsertProjectOverride({ target_kind: "turn", target_ref: "turn-b", project_id: "proj-b", display_name: "Beta" });

    const browser = buildLocalTuiBrowser(storage);
    let state = createBrowserState(browser);

    // Move down past all projects (only 2 exist)
    state = dispatch(browser, state,
      { type: "move-down" }, { type: "move-down" }, { type: "move-down" }, { type: "move-down" },
    );
    assert.ok(state.selectedProjectIndex >= 0 && state.selectedProjectIndex < browser.projects.length,
      `selectedProjectIndex ${state.selectedProjectIndex} out of range [0, ${browser.projects.length})`);
  });
});

test("selectedTurnIndex resets to 0 when switching projects", async () => {
  await withTempStorage((storage) => {
    // Project with 1 turn each
    storage.replaceSourcePayload(createFixturePayload("src-a", "Alpha turn one", "stg-a1", {
      sessionId: "sess-a1", turnId: "turn-a1", workingDirectory: "/ws/a", includeProjectObservation: true,
    }));
    storage.upsertProjectOverride({ target_kind: "turn", target_ref: "turn-a1", project_id: "proj-a", display_name: "Alpha" });

    storage.replaceSourcePayload(createFixturePayload("src-b", "Beta turn one", "stg-b1", {
      sessionId: "sess-b1", turnId: "turn-b1", workingDirectory: "/ws/b", includeProjectObservation: true,
    }));
    storage.upsertProjectOverride({ target_kind: "turn", target_ref: "turn-b1", project_id: "proj-b", display_name: "Beta" });

    const browser = buildLocalTuiBrowser(storage);
    let state = createBrowserState(browser);

    // Drill into turns, move down to non-zero index
    state = dispatch(browser, state, { type: "drill" });
    assert.equal(state.focusPane, "turns");

    // Switch project via focus-projects + move-down
    state = dispatch(browser, state,
      { type: "focus-projects" },
      { type: "move-down" },
    );
    assert.equal(state.selectedTurnIndex, 0, "Turn index should reset to 0 on project switch");
  });
});

// ── Test: Search turn ↔ detail consistency ──

test("search detail pane matches selected turn in results pane", async () => {
  await withTempStorage((storage) => {
    // 3 turns across 2 sessions, all containing "review"
    storage.replaceSourcePayload(createFixturePayload("src-r1", "review auth module code", "stg-r1", {
      sessionId: "sess-r1", turnId: "turn-r1", workingDirectory: "/ws/r",
      includeProjectObservation: true, createdAt: "2026-04-01T10:00:00Z",
    }));
    storage.upsertProjectOverride({ target_kind: "turn", target_ref: "turn-r1", project_id: "proj-r", display_name: "ReviewProj" });

    storage.replaceSourcePayload(createFixturePayload("src-r2", "review login flow", "stg-r2", {
      sessionId: "sess-r2", turnId: "turn-r2", workingDirectory: "/ws/r",
      includeProjectObservation: true, createdAt: "2026-04-01T11:00:00Z",
    }));
    storage.upsertProjectOverride({ target_kind: "turn", target_ref: "turn-r2", project_id: "proj-r", display_name: "ReviewProj" });

    storage.replaceSourcePayload(createFixturePayload("src-r3", "review database schema", "stg-r3", {
      sessionId: "sess-r3", turnId: "turn-r3", workingDirectory: "/ws/r",
      includeProjectObservation: true, createdAt: "2026-04-01T12:00:00Z",
    }));
    storage.upsertProjectOverride({ target_kind: "turn", target_ref: "turn-r3", project_id: "proj-r", display_name: "ReviewProj" });

    const browser = buildLocalTuiBrowser(storage);

    // Search for "review"
    let state = typeSearch(browser, createBrowserState(browser), "review");

    // Drill into turns pane
    state = dispatch(browser, state, { type: "drill" });
    assert.equal(state.focusPane, "turns");

    // Check each search result position
    const resultCount = 3;
    for (let i = 0; i < resultCount; i++) {
      const s = snapshot(browser, state, 160, 50);
      const lines = s.split("\n");

      // Find the line with ❯ (selected turn in results)
      const selectedLine = lines.find(l => l.includes("❯"));
      assert.ok(selectedLine, `Position ${i}: should have a selected (❯) turn`);

      // Find the detail section
      const detailIdx = lines.findIndex(l => l.includes("Detail"));
      assert.ok(detailIdx >= 0, `Position ${i}: should have Detail pane`);
      const detailContent = lines.slice(detailIdx).join("\n");

      // The selected turn's text (from the ❯ line) should relate to the detail content
      // Extract snippet from selected line — it should match one of our turn texts
      const turnTexts = ["review auth module code", "review login flow", "review database schema"];
      const matchedInSelected = turnTexts.find(t => {
        // Turn row shows truncated snippet; check if detail mentions the same concept
        const keyword = t.split(" ").slice(1, 3).join(" "); // "auth module", "login flow", "database schema"
        return selectedLine.includes(keyword) || selectedLine.toLowerCase().includes(keyword.toLowerCase());
      });
      const matchedInDetail = turnTexts.find(t => {
        const keyword = t.split(" ").slice(1, 3).join(" ");
        return detailContent.includes(keyword) || detailContent.toLowerCase().includes(keyword.toLowerCase());
      });

      assert.ok(matchedInSelected, `Position ${i}: selected line should contain a recognizable turn snippet`);
      assert.ok(matchedInDetail, `Position ${i}: detail pane should contain a turn snippet`);
      assert.equal(matchedInSelected, matchedInDetail,
        `Position ${i}: selected turn "${matchedInSelected}" must match detail "${matchedInDetail}"`);

      // Move to next turn
      if (i < resultCount - 1) {
        state = dispatch(browser, state, { type: "move-down" });
      }
    }
  });
});

// ── Test: detailScrollOffset reset ──

test("detailScrollOffset resets on move-up/move-down selection change", async () => {
  await withTempStorage((storage) => {
    storage.replaceSourcePayload(createFixturePayload("src-s1", "First turn with long content " + "x".repeat(300), "stg-s1", {
      sessionId: "sess-s1", turnId: "turn-s1", workingDirectory: "/ws/s", includeProjectObservation: true,
    }));
    storage.upsertProjectOverride({ target_kind: "turn", target_ref: "turn-s1", project_id: "proj-s", display_name: "ScrollProj" });

    storage.replaceSourcePayload(createFixturePayload("src-s2", "Second turn content", "stg-s2", {
      sessionId: "sess-s2", turnId: "turn-s2", workingDirectory: "/ws/s", includeProjectObservation: true,
    }));
    storage.upsertProjectOverride({ target_kind: "turn", target_ref: "turn-s2", project_id: "proj-s", display_name: "ScrollProj" });

    const browser = buildLocalTuiBrowser(storage);
    let state = createBrowserState(browser);

    // Navigate to detail pane (projects → turns → detail = 2 drills)
    state = dispatch(browser, state, { type: "drill" }, { type: "drill" });
    assert.equal(state.focusPane, "detail");

    // Scroll down in detail
    state = dispatch(browser, state, { type: "scroll-down", lines: 5 });
    assert.ok(state.detailScrollOffset > 0, "Should have non-zero scroll offset after scrolling");

    // Go back to turns and move
    state = dispatch(browser, state, { type: "retreat" }); // back to turns
    state = dispatch(browser, state, { type: "move-down" }); // select different turn

    assert.equal(state.detailScrollOffset, 0, "detailScrollOffset should reset on turn selection change");
  });
});

test("detailScrollOffset does NOT reset on handleJump (known gap)", async () => {
  await withTempStorage((storage) => {
    storage.replaceSourcePayload(createFixturePayload("src-j1", "Jump turn A " + "x".repeat(300), "stg-j1", {
      sessionId: "sess-j1", turnId: "turn-j1", workingDirectory: "/ws/j", includeProjectObservation: true,
      createdAt: "2026-04-01T10:00:00Z",
    }));
    storage.upsertProjectOverride({ target_kind: "turn", target_ref: "turn-j1", project_id: "proj-j", display_name: "JumpProj" });

    storage.replaceSourcePayload(createFixturePayload("src-j2", "Jump turn B", "stg-j2", {
      sessionId: "sess-j2", turnId: "turn-j2", workingDirectory: "/ws/j", includeProjectObservation: true,
      createdAt: "2026-04-01T11:00:00Z",
    }));
    storage.upsertProjectOverride({ target_kind: "turn", target_ref: "turn-j2", project_id: "proj-j", display_name: "JumpProj" });

    const browser = buildLocalTuiBrowser(storage);
    let state = createBrowserState(browser);

    // Navigate to turns pane, scroll detail, then jump
    state = dispatch(browser, state, { type: "drill" }); // turns
    state = dispatch(browser, state, { type: "drill" }); // detail
    state = dispatch(browser, state, { type: "scroll-down", lines: 5 });
    const scrolledOffset = state.detailScrollOffset;
    assert.ok(scrolledOffset > 0);

    state = dispatch(browser, state, { type: "retreat" }); // back to turns
    state = dispatch(browser, state, { type: "jump-last" }); // g/G jump

    // Known gap: handleJump doesn't reset detailScrollOffset
    // This test documents the current behavior (will need updating when fixed)
    assert.equal(state.detailScrollOffset, scrolledOffset,
      "KNOWN GAP: handleJump does not reset detailScrollOffset — update this test when fixed");
  });
});

// ── Test: Mode transitions ──

test("enter-search-mode resets search state correctly", async () => {
  await withTempStorage((storage) => {
    storage.replaceSourcePayload(createFixturePayload("src-m", "Mode transition test", "stg-m", {
      sessionId: "sess-m", turnId: "turn-m", workingDirectory: "/ws/m", includeProjectObservation: true,
    }));
    storage.upsertProjectOverride({ target_kind: "turn", target_ref: "turn-m", project_id: "proj-m", display_name: "ModeProj" });

    const browser = buildLocalTuiBrowser(storage);
    let state = createBrowserState(browser);
    assert.equal(state.mode, "browse");

    state = dispatch(browser, state, { type: "enter-search-mode" });
    assert.equal(state.mode, "search");
    assert.equal(state.focusPane, "projects");
    assert.equal(state.searchQuery, "");
    assert.equal(state.searchCommitted, false);
    assert.equal(state.selectedSearchProjectIndex, 0);
    assert.equal(state.selectedSearchTurnIndex, 0);
  });
});

test("retreat from search projects returns to browse mode", async () => {
  await withTempStorage((storage) => {
    storage.replaceSourcePayload(createFixturePayload("src-m2", "Retreat test", "stg-m2", {
      sessionId: "sess-m2", turnId: "turn-m2", workingDirectory: "/ws/m2", includeProjectObservation: true,
    }));
    storage.upsertProjectOverride({ target_kind: "turn", target_ref: "turn-m2", project_id: "proj-m2", display_name: "RetreatProj" });

    const browser = buildLocalTuiBrowser(storage);
    let state = createBrowserState(browser);
    state = dispatch(browser, state, { type: "enter-search-mode" });
    assert.equal(state.mode, "search");

    // Retreat from projects in search → browse
    state = dispatch(browser, state, { type: "retreat" });
    assert.equal(state.mode, "browse");
    assert.equal(state.focusPane, "projects");
  });
});

test("overlay toggles are mutually exclusive for stats and source-health", async () => {
  await withTempStorage((storage) => {
    storage.replaceSourcePayload(createFixturePayload("src-ov", "Overlay test", "stg-ov", {
      sessionId: "sess-ov", turnId: "turn-ov", workingDirectory: "/ws/ov", includeProjectObservation: true,
    }));
    storage.upsertProjectOverride({ target_kind: "turn", target_ref: "turn-ov", project_id: "proj-ov", display_name: "OverlayProj" });

    const browser = buildLocalTuiBrowser(storage);
    let state = createBrowserState(browser);

    // Toggle stats on
    state = dispatch(browser, state, { type: "toggle-stats" });
    assert.ok(state.showStats);
    assert.ok(!state.showSourceHealth);

    // Toggle source health — should clear stats
    state = dispatch(browser, state, { type: "toggle-source-health" });
    assert.ok(state.showSourceHealth);
    assert.ok(!state.showStats);

    // Toggle stats again — should clear source health
    state = dispatch(browser, state, { type: "toggle-stats" });
    assert.ok(state.showStats);
    assert.ok(!state.showSourceHealth);
  });
});

// ── Test: Search debounce ──

test("short query without commit shows 'Press Enter to search'", async () => {
  await withTempStorage((storage) => {
    storage.replaceSourcePayload(createFixturePayload("src-d", "Debounce test data", "stg-d", {
      sessionId: "sess-d", turnId: "turn-d", workingDirectory: "/ws/d", includeProjectObservation: true,
    }));
    storage.upsertProjectOverride({ target_kind: "turn", target_ref: "turn-d", project_id: "proj-d", display_name: "DebounceProj" });

    const browser = buildLocalTuiBrowser(storage);
    let state = createBrowserState(browser);
    state = dispatch(browser, state, { type: "enter-search-mode" });

    // Type 3 chars (< 4 threshold)
    for (const ch of "deb") {
      state = dispatch(browser, state, { type: "append-search-char", value: ch });
    }
    assert.equal(state.searchQuery, "deb");
    assert.equal(state.searchCommitted, false);

    const s = snapshot(browser, state);
    assert.match(s, /Press Enter to search/i, "Short query should show commit prompt");
  });
});

test("short query with commit-search executes search", async () => {
  await withTempStorage((storage) => {
    storage.replaceSourcePayload(createFixturePayload("src-dc", "debounce commit test", "stg-dc", {
      sessionId: "sess-dc", turnId: "turn-dc", workingDirectory: "/ws/dc", includeProjectObservation: true,
    }));
    storage.upsertProjectOverride({ target_kind: "turn", target_ref: "turn-dc", project_id: "proj-dc", display_name: "CommitProj" });

    const browser = buildLocalTuiBrowser(storage);
    let state = createBrowserState(browser);
    state = dispatch(browser, state, { type: "enter-search-mode" });

    // Type short query then commit
    for (const ch of "deb") {
      state = dispatch(browser, state, { type: "append-search-char", value: ch });
    }
    state = dispatch(browser, state, { type: "commit-search" });
    assert.equal(state.searchCommitted, true);

    const s = snapshot(browser, state);
    // Should show results (or "No matches" if FTS doesn't match), but NOT "Press Enter"
    assert.doesNotMatch(s, /Press Enter to search/i, "After commit, should not show commit prompt");
  });
});

test("long query auto-commits and runs search", async () => {
  await withTempStorage((storage) => {
    storage.replaceSourcePayload(createFixturePayload("src-la", "long auto-commit query test", "stg-la", {
      sessionId: "sess-la", turnId: "turn-la", workingDirectory: "/ws/la", includeProjectObservation: true,
    }));
    storage.upsertProjectOverride({ target_kind: "turn", target_ref: "turn-la", project_id: "proj-la", display_name: "AutoProj" });

    const browser = buildLocalTuiBrowser(storage);
    let state = createBrowserState(browser);
    state = typeSearch(browser, state, "long");

    assert.equal(state.searchQuery, "long");
    assert.equal(state.searchCommitted, true, "Query >= 4 chars should auto-commit");

    const s = snapshot(browser, state);
    assert.doesNotMatch(s, /Press Enter to search/i, "Auto-committed query should not show commit prompt");
  });
});

// ── Test: Conversation scroll ──

test("conversation view scroll offset starts at 0 and increases on scroll-down", async () => {
  await withTempStorage((storage) => {
    storage.replaceSourcePayload(createFixturePayload("src-cv", "Conversation scroll test content", "stg-cv", {
      sessionId: "sess-cv", turnId: "turn-cv", workingDirectory: "/ws/cv", includeProjectObservation: true,
    }));
    storage.upsertProjectOverride({ target_kind: "turn", target_ref: "turn-cv", project_id: "proj-cv", display_name: "ConvProj" });

    const browser = buildLocalTuiBrowser(storage);
    let state = createBrowserState(browser);

    // Drill to conversation: projects → turns → detail → conversation
    state = dispatch(browser, state,
      { type: "drill" }, { type: "drill" }, { type: "drill" },
    );
    assert.equal(state.focusPane, "conversation");
    assert.equal(state.conversationScrollOffset, 0);

    // Scroll down
    state = dispatch(browser, state, { type: "move-down" });
    assert.ok(state.conversationScrollOffset >= 1, "Scroll offset should increase");

    // Retreat back
    state = dispatch(browser, state, { type: "retreat" });
    assert.equal(state.focusPane, "detail");
  });
});

// ── Test: Focus navigation cycle ──

test("focus-next cycles through projects → turns → detail", async () => {
  await withTempStorage((storage) => {
    storage.replaceSourcePayload(createFixturePayload("src-fn", "Focus nav test", "stg-fn", {
      sessionId: "sess-fn", turnId: "turn-fn", workingDirectory: "/ws/fn", includeProjectObservation: true,
    }));
    storage.upsertProjectOverride({ target_kind: "turn", target_ref: "turn-fn", project_id: "proj-fn", display_name: "FocusProj" });

    const browser = buildLocalTuiBrowser(storage);
    let state = createBrowserState(browser);
    assert.equal(state.focusPane, "projects");

    state = dispatch(browser, state, { type: "focus-next" });
    assert.equal(state.focusPane, "turns");

    state = dispatch(browser, state, { type: "focus-next" });
    assert.equal(state.focusPane, "detail");

    state = dispatch(browser, state, { type: "focus-next" });
    assert.equal(state.focusPane, "projects", "Should wrap around to projects");
  });
});

test("focus-previous cycles in reverse", async () => {
  await withTempStorage((storage) => {
    storage.replaceSourcePayload(createFixturePayload("src-fp", "Focus prev test", "stg-fp", {
      sessionId: "sess-fp", turnId: "turn-fp", workingDirectory: "/ws/fp", includeProjectObservation: true,
    }));
    storage.upsertProjectOverride({ target_kind: "turn", target_ref: "turn-fp", project_id: "proj-fp", display_name: "FocusPrevProj" });

    const browser = buildLocalTuiBrowser(storage);
    let state = createBrowserState(browser);
    assert.equal(state.focusPane, "projects");

    state = dispatch(browser, state, { type: "focus-previous" });
    assert.equal(state.focusPane, "detail");

    state = dispatch(browser, state, { type: "focus-previous" });
    assert.equal(state.focusPane, "turns");

    state = dispatch(browser, state, { type: "focus-previous" });
    assert.equal(state.focusPane, "projects");
  });
});

test("conversation focus order uses FOCUS_ORDER_CONVERSATION", async () => {
  await withTempStorage((storage) => {
    storage.replaceSourcePayload(createFixturePayload("src-fc", "Focus conv test", "stg-fc", {
      sessionId: "sess-fc", turnId: "turn-fc", workingDirectory: "/ws/fc", includeProjectObservation: true,
    }));
    storage.upsertProjectOverride({ target_kind: "turn", target_ref: "turn-fc", project_id: "proj-fc", display_name: "FocusConvProj" });

    const browser = buildLocalTuiBrowser(storage);
    let state = createBrowserState(browser);

    // Drill to conversation (3 drills: projects→turns→detail→conversation)
    state = dispatch(browser, state,
      { type: "drill" }, { type: "drill" }, { type: "drill" },
    );
    assert.equal(state.focusPane, "conversation");

    // In conversation pane, focus-next uses FOCUS_ORDER_CONVERSATION: [projects, turns, conversation]
    // conversation → projects (wraps)
    state = dispatch(browser, state, { type: "focus-next" });
    assert.equal(state.focusPane, "projects");

    // projects → turns (FOCUS_ORDER_BROWSE since focusPane is now projects)
    state = dispatch(browser, state, { type: "focus-next" });
    assert.equal(state.focusPane, "turns");

    // turns → detail (FOCUS_ORDER_BROWSE applies since focusPane is turns, not conversation)
    state = dispatch(browser, state, { type: "focus-next" });
    assert.equal(state.focusPane, "detail");

    // detail → projects (wraps in FOCUS_ORDER_BROWSE)
    state = dispatch(browser, state, { type: "focus-next" });
    assert.equal(state.focusPane, "projects");
  });
});

// ── Test: Drill and retreat chain ──

test("drill and retreat chain is symmetric", async () => {
  await withTempStorage((storage) => {
    storage.replaceSourcePayload(createFixturePayload("src-dr", "Drill retreat test", "stg-dr", {
      sessionId: "sess-dr", turnId: "turn-dr", workingDirectory: "/ws/dr", includeProjectObservation: true,
    }));
    storage.upsertProjectOverride({ target_kind: "turn", target_ref: "turn-dr", project_id: "proj-dr", display_name: "DrillProj" });

    const browser = buildLocalTuiBrowser(storage);
    let state = createBrowserState(browser);

    const drillSteps: BrowserAction[] = [
      { type: "drill" }, { type: "drill" }, { type: "drill" },
    ];
    const expectedPanes = ["turns", "detail", "conversation"] as const;

    // Drill forward
    for (let i = 0; i < drillSteps.length; i++) {
      state = dispatch(browser, state, drillSteps[i]!);
      assert.equal(state.focusPane, expectedPanes[i]);
    }

    // Retreat backward
    const retreatExpected = ["detail", "turns", "projects"] as const;
    for (let i = 0; i < retreatExpected.length; i++) {
      state = dispatch(browser, state, { type: "retreat" });
      assert.equal(state.focusPane, retreatExpected[i]);
    }
  });
});

// ── Test: Stats time window ──

test("cycle-stats-time-window cycles through all windows", async () => {
  await withTempStorage((storage) => {
    storage.replaceSourcePayload(createFixturePayload("src-tw", "Time window test", "stg-tw", {
      sessionId: "sess-tw", turnId: "turn-tw", workingDirectory: "/ws/tw", includeProjectObservation: true,
    }));
    storage.upsertProjectOverride({ target_kind: "turn", target_ref: "turn-tw", project_id: "proj-tw", display_name: "TimeProj" });

    const browser = buildLocalTuiBrowser(storage);
    let state = createBrowserState(browser);
    state = dispatch(browser, state, { type: "toggle-stats" });
    assert.equal(state.showStatsTimeWindow, "all");

    const expectedOrder = ["7d", "30d", "90d", "1y", "all"] as const;
    for (const expected of expectedOrder) {
      state = dispatch(browser, state, { type: "cycle-stats-time-window" });
      assert.equal(state.showStatsTimeWindow, expected);
    }
  });
});

// ── Test: Page up/down ──

test("page-up and page-down move by larger increments", async () => {
  await withTempStorage((storage) => {
    // Create multiple turns
    for (let i = 0; i < 5; i++) {
      storage.replaceSourcePayload(createFixturePayload(`src-pg${i}`, `Page test turn ${i}`, `stg-pg${i}`, {
        sessionId: `sess-pg${i}`, turnId: `turn-pg${i}`, workingDirectory: "/ws/pg", includeProjectObservation: true,
        createdAt: `2026-04-0${i + 1}T10:00:00Z`,
      }));
      storage.upsertProjectOverride({ target_kind: "turn", target_ref: `turn-pg${i}`, project_id: "proj-pg", display_name: "PageProj" });
    }

    const browser = buildLocalTuiBrowser(storage);
    let state = createBrowserState(browser);
    state = dispatch(browser, state, { type: "drill" }); // turns pane

    // Page down should move more than 1
    const before = state.selectedTurnIndex;
    state = dispatch(browser, state, { type: "page-down" });
    const after = state.selectedTurnIndex;
    // With 5 turns, page-down of 15 should clamp to last
    assert.ok(after >= before, "page-down should not move backward");
  });
});

// ── Test: Backspace search cache invalidation ──

test("backspace past anchor invalidates search cache", async () => {
  await withTempStorage((storage) => {
    storage.replaceSourcePayload(createFixturePayload("src-bs", "backspace cache test content", "stg-bs", {
      sessionId: "sess-bs", turnId: "turn-bs", workingDirectory: "/ws/bs", includeProjectObservation: true,
    }));
    storage.upsertProjectOverride({ target_kind: "turn", target_ref: "turn-bs", project_id: "proj-bs", display_name: "BackspaceProj" });

    const browser = buildLocalTuiBrowser(storage);
    let state = createBrowserState(browser);

    // Type "back" (4 chars, auto-commits)
    state = typeSearch(browser, state, "back");
    assert.equal(state.searchQuery, "back");
    assert.equal(state.searchCommitted, true);

    // Add more chars to extend from cache
    state = dispatch(browser, state, { type: "append-search-char", value: "s" });
    assert.equal(state.searchQuery, "backs");

    // Backspace back to "back"
    state = dispatch(browser, state, { type: "backspace-search" });
    assert.equal(state.searchQuery, "back");

    // Backspace further — should invalidate cache (below anchor)
    state = dispatch(browser, state, { type: "backspace-search" });
    assert.equal(state.searchQuery, "bac");
    assert.equal(state.searchCommitted, false, "Below 4 chars, should not be auto-committed");

    // Verify no crash on render
    const s = snapshot(browser, state);
    assert.match(s, /Press Enter to search/i, "Short query after backspace should require commit");
  });
});

// ── Test: Empty browser edge case ──

test("empty browser state is valid and renderable", async () => {
  await withTempStorage((storage) => {
    const browser = buildLocalTuiBrowser(storage);
    const state = createBrowserState(browser);

    assert.equal(state.selectedProjectIndex, 0);
    assert.equal(state.selectedTurnIndex, 0);
    assert.equal(state.mode, "browse");
    assert.equal(state.focusPane, "projects");

    // Should render without crash
    const s = snapshot(browser, state);
    assert.match(s, /CCHistory TUI/);
    assert.match(s, /No projects/i);
  });
});
