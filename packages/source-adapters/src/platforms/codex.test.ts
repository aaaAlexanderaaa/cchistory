import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { SourceSyncPayload } from "@cchistory/domain";
import { runSourceProbe } from "../index.js";
import { 
  createSourceDefinition,
  seedSupportedSourceFixtures 
} from "../test-helpers.js";

test("[codex] turn with only tool calls (no assistant text) gets model from turn_context", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-codex-model-fallback-"));

  try {
    const codexDir = path.join(tempRoot, "codex-toolcall-only");
    await mkdir(codexDir, { recursive: true });

    await writeFile(
      path.join(codexDir, "rollout-2026-03-09T00-00-00-toolcall.jsonl"),
      [
        {
          timestamp: "2026-03-09T01:00:00.000Z",
          type: "session_meta",
          payload: { id: "codex-toolcall-session", cwd: "/workspace" },
        },
        {
          timestamp: "2026-03-09T01:00:00.500Z",
          type: "turn_context",
          payload: { cwd: "/workspace", model: "gpt-5.2" },
        },
        // Real user message (Codex uses response_item/message/user for user input)
        {
          timestamp: "2026-03-09T01:00:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Generate AGENTS.md for this project." }],
          },
        },
        // Assistant does tool calls only — no text response
        {
          timestamp: "2026-03-09T01:00:02.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            call_id: "call-1",
            name: "read_file",
            arguments: '{"path":"README.md"}',
          },
        },
        {
          timestamp: "2026-03-09T01:00:03.000Z",
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "call-1",
            output: "# My Project\nA demo project.",
          },
        },
        {
          timestamp: "2026-03-09T01:00:04.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            call_id: "call-2",
            name: "write_file",
            arguments: '{"path":"AGENTS.md","content":"# Agents guide"}',
          },
        },
        {
          timestamp: "2026-03-09T01:00:05.000Z",
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "call-2",
            output: "AGENTS.md written",
          },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf8",
    );

    const source = createSourceDefinition("src-codex-toolcall-only", "codex", codexDir);
    const result = await runSourceProbe({ source_ids: [source.id] }, [source]);
    const payload = result.sources[0];

    assert.ok(payload);
    assert.equal(payload.sessions.length, 1);
    assert.equal(payload.turns.length, 1);

    // Model should be populated from turn_context even without assistant text
    assert.equal(
      payload.turns[0]?.context_summary?.primary_model,
      "gpt-5.2",
      "primary_model should fall back to turn_context model when no assistant text reply exists",
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("[codex] preserves source session UUID and resume command provenance", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-codex-resume-"));

  try {
    const codexDir = path.join(tempRoot, "codex-resume");
    await mkdir(codexDir, { recursive: true });
    const sourceSessionId = "7f0fbe2e-0e5e-4eaf-a184-23fe9b0db001";

    await writeFile(
      path.join(codexDir, "rollout-2026-03-09T00-00-00-resume.jsonl"),
      [
        {
          timestamp: "2026-03-09T01:00:00.000Z",
          type: "session_meta",
          payload: { id: sourceSessionId, cwd: "/workspace/codex-resume", model: "gpt-5.2" },
        },
        {
          timestamp: "2026-03-09T01:00:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Recover resume command." }],
          },
        },
        {
          timestamp: "2026-03-09T01:00:02.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Done." }],
          },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf8",
    );

    const source = createSourceDefinition("src-codex-resume", "codex", codexDir);
    const result = await runSourceProbe({ source_ids: [source.id] }, [source]);
    const payload = result.sources[0];
    const session = payload?.sessions[0];

    assert.ok(session);
    assert.equal(session.id, `sess:codex:${sourceSessionId}`);
    assert.equal(session.source_session_id, sourceSessionId);
    assert.equal(session.resume_working_directory, "/workspace/codex-resume");
    assert.equal(session.resume_command, `cd /workspace/codex-resume && codex resume ${sourceSessionId}`);
    assert.equal(session.resume_command_confidence, 1);
    assert.match(payload?.turns[0]?.path_text ?? "", /\/workspace\/codex-resume/u);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("[codex] models encrypted reasoning as opaque evidence without warning", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-codex-reasoning-opaque-"));

  try {
    const codexDir = path.join(tempRoot, "codex-reasoning-opaque");
    await mkdir(codexDir, { recursive: true });

    await writeFile(
      path.join(codexDir, "rollout-2026-03-09T00-00-00-reasoning.jsonl"),
      [
        {
          timestamp: "2026-03-09T01:00:00.000Z",
          type: "session_meta",
          payload: { id: "codex-reasoning-session", cwd: "/workspace/codex-reasoning", model: "gpt-5.2" },
        },
        {
          timestamp: "2026-03-09T01:00:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Explain the opaque reasoning evidence." }],
          },
        },
        {
          timestamp: "2026-03-09T01:00:02.000Z",
          type: "response_item",
          payload: {
            type: "reasoning",
            encrypted_content: "encrypted-reasoning-payload",
            summary: [],
          },
        },
        {
          timestamp: "2026-03-09T01:00:03.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [
              { type: "reasoning", encrypted_content: "encrypted-message-reasoning" },
              { type: "output_text", text: "The reasoning payload is present but unreadable." },
            ],
          },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf8",
    );

    const source = createSourceDefinition("src-codex-reasoning-opaque", "codex", codexDir);
    const result = await runSourceProbe({ source_ids: [source.id] }, [source]);
    const payload = result.sources[0];

    assert.ok(payload);
    const opaqueFragments = payload.fragments.filter((fragment) => fragment.payload.signal_kind === "reasoning_opaque");
    assert.equal(opaqueFragments.length, 2);
    assert.ok(opaqueFragments.every((fragment) => fragment.fragment_kind === "unknown"));
    assert.ok(opaqueFragments.every((fragment) => fragment.payload.opaque_reasoning === true));
    assert.ok(opaqueFragments.every((fragment) => fragment.payload.encrypted_content_present === true));
    assert.equal(
      payload.loss_audits.some((audit) =>
        audit.diagnostic_code === "codex_unhandled_record_type" ||
        audit.diagnostic_code === "codex_unsupported_content_item"
      ),
      false,
    );
    assert.equal(payload.turns.length, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("[codex] event user, agent, and reasoning messages are classified without false loss audits", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-codex-event-messages-"));

  try {
    const codexDir = path.join(tempRoot, "codex-event-messages");
    await mkdir(codexDir, { recursive: true });

    await writeFile(
      path.join(codexDir, "rollout-2026-03-09T00-00-00-event-messages.jsonl"),
      [
        {
          timestamp: "2026-03-09T01:00:00.000Z",
          type: "session_meta",
          payload: { id: "codex-event-message-session", cwd: "/workspace/codex-event-messages", model: "gpt-5.2" },
        },
        {
          timestamp: "2026-03-09T01:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message:
              "<environment_context>\n  <cwd>/workspace/codex-event-messages</cwd>\n</environment_context>\n\nClassify Codex event messages.",
          },
        },
        {
          timestamp: "2026-03-09T01:00:02.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            phase: "commentary",
            message: "Classifying event messages.",
          },
        },
        {
          timestamp: "2026-03-09T01:00:03.000Z",
          type: "event_msg",
          payload: {
            type: "agent_reasoning",
            text: "Reasoning trace exists here.",
          },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf8",
    );

    const source = createSourceDefinition("src-codex-event-messages", "codex", codexDir);
    const result = await runSourceProbe({ source_ids: [source.id] }, [source]);
    const payload = result.sources[0];

    assert.ok(payload);
    assert.equal(payload.turns.length, 1);
    const turn = payload.turns[0];
    assert.ok(turn);
    assert.equal(turn.user_messages.length, 2);
    assert.equal(turn.user_messages[0]?.is_injected, true);
    assert.equal(turn.user_messages[1]?.is_injected, false);
    assert.equal(turn.user_messages[1]?.raw_text, "Classify Codex event messages.");

    const context = payload.contexts[0];
    assert.ok(context);
    assert.equal(context.assistant_replies.length, 1);
    assert.equal(context.assistant_replies[0]?.content, "Classifying event messages.");
    assert.equal(payload.fragments.some((fragment) => fragment.payload.signal_kind === "agent_reasoning"), true);
    assert.equal(
      payload.loss_audits.some((audit) => audit.diagnostic_code === "codex_unhandled_record_type"),
      false,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("[codex] search, tool, mcp, and patch event messages become evidence without unhandled warnings", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-codex-event-tools-"));

  try {
    const codexDir = path.join(tempRoot, "codex-event-tools");
    await mkdir(codexDir, { recursive: true });

    await writeFile(
      path.join(codexDir, "rollout-2026-03-09T00-00-00-event-tools.jsonl"),
      [
        {
          timestamp: "2026-03-09T01:00:00.000Z",
          type: "session_meta",
          payload: { id: "codex-event-tool-session", cwd: "/workspace/codex-event-tools", model: "gpt-5.2" },
        },
        {
          timestamp: "2026-03-09T01:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "Preserve Codex event tool evidence.",
          },
        },
        {
          timestamp: "2026-03-09T01:00:02.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "Inspecting event tool evidence.",
          },
        },
        {
          timestamp: "2026-03-09T01:00:03.000Z",
          type: "event_msg",
          payload: {
            type: "web_search_call",
            status: "running",
            action: { type: "search", query: "Codex event_msg parser" },
          },
        },
        {
          timestamp: "2026-03-09T01:00:04.000Z",
          type: "event_msg",
          payload: {
            type: "web_search_end",
            call_id: "web-search-1",
            query: "Codex event_msg parser",
            action: { type: "search" },
          },
        },
        {
          timestamp: "2026-03-09T01:00:05.000Z",
          type: "event_msg",
          payload: {
            type: "tool_search_call",
            call_id: "tool-search-1",
            execution: "local",
            status: "running",
            arguments: { query: "fragment parser", limit: 3 },
          },
        },
        {
          timestamp: "2026-03-09T01:00:06.000Z",
          type: "event_msg",
          payload: {
            type: "tool_search_output",
            call_id: "tool-search-1",
            execution: "local",
            status: "success",
            tools: [{ name: "tool_search" }],
          },
        },
        {
          timestamp: "2026-03-09T01:00:07.000Z",
          type: "event_msg",
          payload: {
            type: "mcp_tool_call_end",
            call_id: "mcp-1",
            invocation: { server: "docs", tool: "read_doc", arguments: { uri: "doc://codex" } },
            duration: { secs: 1, nanos: 500000000 },
            result: { Ok: { content: "ok" } },
          },
        },
        {
          timestamp: "2026-03-09T01:00:08.000Z",
          type: "event_msg",
          payload: {
            type: "patch_apply_end",
            call_id: "patch-1",
            status: "success",
            success: true,
            turn_id: "turn-1",
            changes: [{ path: "README.md", kind: "update" }],
            stdout: "applied",
            stderr: "",
          },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf8",
    );

    const source = createSourceDefinition("src-codex-event-tools", "codex", codexDir);
    const result = await runSourceProbe({ source_ids: [source.id] }, [source]);
    const payload = result.sources[0];

    assert.ok(payload);
    assert.equal(payload.turns.length, 1);
    assert.equal(
      payload.loss_audits.some((audit) => audit.diagnostic_code === "codex_unhandled_record_type"),
      false,
    );

    const sourceEventTypes = new Set(payload.fragments.map((fragment) => fragment.payload.source_event_type));
    assert.equal(sourceEventTypes.has("web_search_call"), true);
    assert.equal(sourceEventTypes.has("web_search_end"), true);
    assert.equal(sourceEventTypes.has("tool_search_call"), true);
    assert.equal(sourceEventTypes.has("tool_search_output"), true);
    assert.equal(sourceEventTypes.has("mcp_tool_call_end"), true);
    assert.equal(sourceEventTypes.has("patch_apply_end"), true);

    const toolCallFragments = payload.fragments.filter((fragment) => fragment.fragment_kind === "tool_call");
    const toolResultFragments = payload.fragments.filter((fragment) => fragment.fragment_kind === "tool_result");
    assert.equal(toolCallFragments.length, 4);
    assert.equal(toolResultFragments.length, 4);

    const context = payload.contexts[0];
    assert.ok(context);
    assert.equal(context.tool_calls.length, 4);
    assert.deepEqual(
      context.tool_calls.map((toolCall) => toolCall.tool_name).sort(),
      ["apply_patch", "read_doc", "tool_search", "web_search"],
    );
    assert.ok(context.tool_calls.some((toolCall) => toolCall.tool_name === "tool_search" && toolCall.output?.includes("tool_count")));
    assert.ok(context.tool_calls.some((toolCall) => toolCall.tool_name === "apply_patch" && toolCall.output?.includes("success")));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("[codex] top-level response search and tool-search calls become evidence without warnings", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-codex-response-search-"));

  try {
    const codexDir = path.join(tempRoot, "codex-response-search");
    await mkdir(codexDir, { recursive: true });

    await writeFile(
      path.join(codexDir, "rollout-2026-03-09T00-00-00-response-search.jsonl"),
      [
        {
          timestamp: "2026-03-09T01:00:00.000Z",
          type: "session_meta",
          payload: { id: "codex-response-search-session", cwd: "/workspace/codex-response-search", model: "gpt-5.2" },
        },
        {
          timestamp: "2026-03-09T01:00:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Search from a top-level response item." }],
          },
        },
        {
          timestamp: "2026-03-09T01:00:02.000Z",
          type: "response_item",
          payload: {
            type: "web_search_call",
            status: "completed",
            action: { type: "search", query: "Codex response web_search_call" },
          },
        },
        {
          timestamp: "2026-03-09T01:00:03.000Z",
          type: "response_item",
          payload: {
            type: "tool_search_call",
            call_id: "tool-search-response-1",
            execution: "local",
            status: "running",
            arguments: { query: "Codex response tool_search_call", limit: 3 },
          },
        },
        {
          timestamp: "2026-03-09T01:00:04.000Z",
          type: "response_item",
          payload: {
            type: "tool_search_output",
            call_id: "tool-search-response-1",
            execution: "local",
            status: "success",
            tools: [{ name: "tool_search" }],
          },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf8",
    );

    const source = createSourceDefinition("src-codex-response-search", "codex", codexDir);
    const result = await runSourceProbe({ source_ids: [source.id] }, [source]);
    const payload = result.sources[0];

    assert.ok(payload);
    assert.equal(payload.turns.length, 1);
    assert.equal(
      payload.loss_audits.some((audit) => audit.diagnostic_code === "codex_unhandled_record_type"),
      false,
    );
    const webSearchFragment = payload.fragments.find((fragment) =>
      fragment.fragment_kind === "tool_call" && fragment.payload.source_event_type === "web_search_call"
    );
    assert.ok(webSearchFragment);
    assert.equal(webSearchFragment.payload.tool_name, "web_search");
    const toolSearchCallFragment = payload.fragments.find((fragment) =>
      fragment.fragment_kind === "tool_call" && fragment.payload.source_event_type === "tool_search_call"
    );
    const toolSearchResultFragment = payload.fragments.find((fragment) =>
      fragment.fragment_kind === "tool_result" && fragment.payload.source_event_type === "tool_search_output"
    );
    assert.ok(toolSearchCallFragment);
    assert.ok(toolSearchResultFragment);
    assert.equal(toolSearchCallFragment.payload.tool_name, "tool_search");
    assert.equal(toolSearchCallFragment.payload.call_id, "tool-search-response-1");
    assert.equal(toolSearchResultFragment.payload.call_id, "tool-search-response-1");
    assert.equal(payload.contexts[0]?.tool_calls.some((toolCall) => toolCall.tool_name === "web_search"), true);
    assert.equal(payload.contexts[0]?.tool_calls.some((toolCall) => toolCall.tool_name === "tool_search"), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("[codex] lifecycle and replacement-history events stay hidden and do not create turns", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-codex-lifecycle-"));

  try {
    const codexDir = path.join(tempRoot, "codex-lifecycle");
    await mkdir(codexDir, { recursive: true });

    await writeFile(
      path.join(codexDir, "rollout-2026-03-09T00-00-00-lifecycle.jsonl"),
      [
        {
          timestamp: "2026-03-09T01:00:00.000Z",
          type: "session_meta",
          payload: { id: "codex-lifecycle-session", cwd: "/workspace/codex-lifecycle", model: "gpt-5.2" },
        },
        {
          timestamp: "2026-03-09T01:00:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Keep lifecycle events out of recall anchors." }],
          },
        },
        {
          timestamp: "2026-03-09T01:00:02.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Lifecycle events will stay as metadata." }],
          },
        },
        {
          timestamp: "2026-03-09T01:00:03.000Z",
          type: "compacted",
          payload: {
            type: "context_compacted",
            replacement_history: [
              { type: "message", role: "user", content: "This replacement-history user text is not a new turn." },
              { type: "message", role: "assistant", content: "This replacement-history assistant text is metadata." },
            ],
          },
        },
        {
          timestamp: "2026-03-09T01:00:04.000Z",
          type: "event_msg",
          payload: {
            type: "thread_goal_updated",
            turnId: "turn-goal-1",
            status: "active",
          },
        },
        {
          timestamp: "2026-03-09T01:00:05.000Z",
          type: "event_msg",
          payload: {
            type: "task_started",
            turn_id: "turn-task-1",
            source: { type: "subagent", subagent: { thread_spawn: { parent_thread_id: "parent-thread-1" } } },
          },
        },
        {
          timestamp: "2026-03-09T01:00:06.000Z",
          type: "event_msg",
          payload: {
            type: "task_complete",
            turn_id: "turn-task-1",
            status: "success",
          },
        },
        {
          timestamp: "2026-03-09T01:00:07.000Z",
          type: "event_msg",
          payload: {
            type: "turn_aborted",
            reason: "user_cancelled",
          },
        },
        {
          timestamp: "2026-03-09T01:00:08.000Z",
          type: "event_msg",
          payload: {
            type: "thread_rolled_back",
            num_turns: 1,
          },
        },
        {
          timestamp: "2026-03-09T01:00:09.000Z",
          type: "event_msg",
          payload: {
            type: "entered_review_mode",
            status: "active",
          },
        },
        {
          timestamp: "2026-03-09T01:00:10.000Z",
          type: "event_msg",
          payload: {
            type: "exited_review_mode",
            reason: "accepted",
          },
        },
        {
          timestamp: "2026-03-09T01:00:11.000Z",
          type: "event_msg",
          payload: {
            type: "item_completed",
            status: "done",
            target: { branch: "main" },
          },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf8",
    );

    const source = createSourceDefinition("src-codex-lifecycle", "codex", codexDir);
    const result = await runSourceProbe({ source_ids: [source.id] }, [source]);
    const payload = result.sources[0];

    assert.ok(payload);
    assert.equal(payload.turns.length, 1);
    assert.equal(payload.turns[0]?.canonical_text, "Keep lifecycle events out of recall anchors.");
    assert.equal(
      payload.turns.some((turn) => turn.canonical_text.includes("replacement-history user text")),
      false,
    );
    assert.equal(
      payload.loss_audits.some((audit) => audit.diagnostic_code === "codex_unhandled_record_type"),
      false,
    );

    const lifecycleFragments = payload.fragments.filter((fragment) =>
      fragment.payload.source_event_type === "context_compacted" ||
      fragment.payload.source_event_type === "thread_goal_updated" ||
      fragment.payload.source_event_type === "task_started" ||
      fragment.payload.source_event_type === "task_complete" ||
      fragment.payload.source_event_type === "turn_aborted" ||
      fragment.payload.source_event_type === "thread_rolled_back" ||
      fragment.payload.source_event_type === "entered_review_mode" ||
      fragment.payload.source_event_type === "exited_review_mode" ||
      fragment.payload.source_event_type === "item_completed"
    );
    assert.equal(lifecycleFragments.length, 9);
    assert.ok(lifecycleFragments.every((fragment) => fragment.fragment_kind === "unknown"));
    assert.ok(lifecycleFragments.every((fragment) => fragment.payload.replacement_history === undefined));
    assert.equal(
      lifecycleFragments.some((fragment) => fragment.payload.replacement_history_item_count === 2),
      true,
    );
    assert.equal(
      payload.atoms.some((atom) => atom.payload.signal_kind === "context_compacted" && atom.display_policy === "hide"),
      true,
    );
    assert.equal(
      payload.atoms.some((atom) => atom.payload.parent_thread_id === "parent-thread-1" && atom.display_policy === "hide"),
      true,
    );
    assert.equal(
      payload.atoms.some((atom) => atom.payload.signal_kind === "entered_review_mode" && atom.display_policy === "hide"),
      true,
    );
    assert.equal(
      payload.atoms.some((atom) => atom.payload.signal_kind === "exited_review_mode" && atom.display_policy === "hide"),
      true,
    );
    assert.equal(
      payload.atoms.some((atom) => atom.payload.signal_kind === "item_completed" && atom.payload.target_branch === "main"),
      true,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("[codex] reuse backfills resume provenance from upgraded previous payloads", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-codex-resume-reuse-"));

  try {
    const codexDir = path.join(tempRoot, "codex-resume-reuse");
    await mkdir(codexDir, { recursive: true });
    const sourceSessionId = "3d0e1719-a13b-4d1e-a340-5a11e901bdb1";
    const sessionPath = path.join(codexDir, "rollout-2026-03-09T00-00-00-resume-reuse.jsonl");

    await writeFile(
      sessionPath,
      [
        {
          timestamp: "2026-03-09T01:00:00.000Z",
          type: "session_meta",
          payload: { id: sourceSessionId, cwd: "/workspace/codex-resume-reuse", model: "gpt-5.2" },
        },
        {
          timestamp: "2026-03-09T01:00:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Backfill reused resume command." }],
          },
        },
        {
          timestamp: "2026-03-09T01:00:02.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Done." }],
          },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf8",
    );
    const oldDate = new Date("2020-01-01T00:00:00.000Z");
    await utimes(sessionPath, oldDate, oldDate);

    const source = createSourceDefinition("src-codex-resume-reuse", "codex", codexDir);
    const firstPayload = (await runSourceProbe({ source_ids: [source.id] }, [source])).sources[0];
    assert.ok(firstPayload);
    const previousPayload = JSON.parse(JSON.stringify(firstPayload)) as typeof firstPayload;
    const previousSession = previousPayload.sessions[0];
    assert.ok(previousSession);
    delete previousSession.source_session_id;
    delete previousSession.resume_command;
    delete previousSession.resume_working_directory;
    delete previousSession.resume_command_confidence;

    const progressStages: string[] = [];
    const reusedPayload = (await runSourceProbe({
      source_ids: [source.id],
      changed_since: "1h",
      previous_payloads: { [source.id]: previousPayload },
      on_progress: (event) => progressStages.push(event.stage),
    }, [source])).sources[0];
    const session = reusedPayload?.sessions[0];

    assert.ok(progressStages.includes("file_skip"), "unchanged old file should be reused");
    assert.ok(session);
    assert.equal(session.source_session_id, sourceSessionId);
    assert.equal(session.resume_working_directory, "/workspace/codex-resume-reuse");
    assert.equal(session.resume_command, `cd /workspace/codex-resume-reuse && codex resume ${sourceSessionId}`);
    assert.equal(session.resume_command_confidence, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("[codex] stale previous parser diagnostics are not reused after parser version changes", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-codex-parser-version-reuse-"));

  try {
    const codexDir = path.join(tempRoot, "codex-parser-version-reuse");
    await mkdir(codexDir, { recursive: true });
    const sessionPath = path.join(codexDir, "rollout-2026-03-09T00-00-00-event-reparse.jsonl");

    await writeFile(
      sessionPath,
      [
        {
          timestamp: "2026-03-09T01:00:00.000Z",
          type: "session_meta",
          payload: { id: "codex-parser-version-session", cwd: "/workspace/codex-parser-version", model: "gpt-5.2" },
        },
        {
          timestamp: "2026-03-09T01:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "Reparse clean Codex event messages after parser upgrade.",
          },
        },
        {
          timestamp: "2026-03-09T01:00:02.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "This is now a supported event message.",
          },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf8",
    );
    const oldDate = new Date("2020-01-01T00:00:00.000Z");
    await utimes(sessionPath, oldDate, oldDate);

    const source = createSourceDefinition("src-codex-parser-version-reuse", "codex", codexDir);
    const firstPayload = (await runSourceProbe({ source_ids: [source.id] }, [source])).sources[0];
    assert.ok(firstPayload);
    assert.equal(
      firstPayload.loss_audits.some((audit) => audit.diagnostic_code === "codex_unhandled_record_type"),
      false,
    );

    const stalePayload = JSON.parse(JSON.stringify(firstPayload)) as SourceSyncPayload;
    for (const stageRun of stalePayload.stage_runs) {
      stageRun.parser_version = "codex-parser@2026-03-11.1";
    }
    stalePayload.loss_audits.push({
      id: "loss-audit:stale-codex-unhandled-record-type",
      source_id: source.id,
      stage_run_id: "stage-run:stale-parse-source-fragments",
      stage_kind: "parse_source_fragments",
      diagnostic_code: "codex_unhandled_record_type",
      severity: "warning",
      scope_ref: firstPayload.records[1]?.id ?? firstPayload.records[0]?.id ?? "record:stale",
      session_ref: firstPayload.sessions[0]?.id,
      blob_ref: firstPayload.blobs[0]?.id,
      record_ref: firstPayload.records[1]?.id ?? firstPayload.records[0]?.id,
      source_format_profile_id: "codex:jsonl:v1",
      loss_kind: "unknown_fragment",
      detail: "Stale diagnostic from an older Codex parser.",
      created_at: "2026-03-09T01:00:03.000Z",
    });

    const progressStages: string[] = [];
    const reparsedPayload = (await runSourceProbe({
      source_ids: [source.id],
      changed_since: "1h",
      previous_payloads: { [source.id]: stalePayload },
      on_progress: (event) => progressStages.push(event.stage),
    }, [source])).sources[0];

    assert.ok(reparsedPayload);
    assert.equal(progressStages.includes("file_skip"), false, "old parser payload should not reuse unchanged file");
    assert.equal(progressStages.includes("file_parse_done"), true, "old parser payload should be parsed with current semantics");
    assert.equal(
      reparsedPayload.loss_audits.some((audit) => audit.diagnostic_code === "codex_unhandled_record_type"),
      false,
    );
    assert.equal(reparsedPayload.turns.length, 1);
    assert.equal(reparsedPayload.contexts[0]?.assistant_replies[0]?.content, "This is now a supported event message.");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("[codex] root history jsonl stays out of default capture when scanning the source root", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const sources = await seedSupportedSourceFixtures(tempRoot);
    const codexSource = sources.find((source) => source.platform === "codex");
    assert.ok(codexSource);

    const result = await runSourceProbe({ source_ids: [codexSource.id] }, [codexSource]);
    const payload = result.sources[0];
    assert.ok(payload);
    assert.equal(payload.source.sync_status, "healthy");
    assert.equal(payload.blobs.some((blob) => path.basename(blob.origin_path) === "session.jsonl"), false);
    assert.equal(payload.sessions.length, 1);
    assert.equal(payload.turns.length, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
