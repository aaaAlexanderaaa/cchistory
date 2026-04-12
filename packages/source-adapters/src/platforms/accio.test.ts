import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runSourceProbe } from "../index.js";
import { createSourceDefinition } from "../test-helpers.js";

test("runSourceProbe ingests Accio agent session JSONL with user/assistant turns, tool calls, and token usage", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-accio-"));

  try {
    const agentDir = path.join(tempRoot, "agents", "DID-TEST01-AABB", "sessions");
    await mkdir(agentDir, { recursive: true });

    await writeFile(
      path.join(agentDir, "DID-TEST01-AABB_CID-TEST-CONV-001.messages.jsonl"),
      [
        {
          id: "m1",
          timestamp: 1775400000000,
          role: "user",
          content: "Refactor the database module.",
          messageType: "normal",
        },
        {
          id: "m2",
          timestamp: 1775400005000,
          role: "assistant",
          content: "I'll analyze the module now.",
          messageType: "tool_call",
          toolCalls: [
            { id: "tc-1", name: "read", arguments: { file_path: "/app/db.ts" } },
          ],
          metadata: {
            usage: { prompt_tokens: 1200, completion_tokens: 85, total_tokens: 1285, reasoning_tokens: 0 },
            agentType: "build",
            agentId: "DID-TEST01-AABB",
          },
        },
        {
          id: "m3",
          timestamp: 1775400008000,
          role: "tool",
          content: "export function getDb() { return createConnection(); }",
          toolCallId: "tc-1",
          messageType: "tool_result",
        },
        {
          id: "m4",
          timestamp: 1775400012000,
          role: "assistant",
          content: "Done. The database module now uses connection pooling.",
          messageType: "normal",
          metadata: {
            usage: { prompt_tokens: 2400, completion_tokens: 150, total_tokens: 2550, reasoning_tokens: 0 },
            agentType: "build",
            agentId: "DID-TEST01-AABB",
          },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf8",
    );

    // Session meta sidecar
    await writeFile(
      path.join(agentDir, "DID-TEST01-AABB_CID-TEST-CONV-001.meta.jsonc"),
      JSON.stringify({
        sessionId: "agent:DID-TEST01-AABB:main:cid:CID-TEST-CONV-001",
        title: "DB refactoring",
        agentId: "DID-TEST01-AABB",
        updatedAt: "2026-04-06T12:01:15.000Z",
      }),
      "utf8",
    );

    const [payload] = (
      await runSourceProbe(
        { source_ids: ["src-accio"] },
        [createSourceDefinition("src-accio", "accio", path.join(tempRoot, "agents"))],
      )
    ).sources;

    assert.ok(payload, "Expected source payload");
    assert.ok(payload.sessions.length >= 1, "Expected at least 1 session");

    const session = payload.sessions[0];
    assert.ok(session);

    // Should have at least 1 user turn
    assert.ok(payload.turns.length >= 1, `Expected at least 1 turn, got ${payload.turns.length}`);
    const firstTurn = payload.turns[0];
    assert.ok(firstTurn);
    assert.equal(firstTurn.canonical_text, "Refactor the database module.");

    // Check fragments for tool_call, tool_result, text, and token_usage
    const fragKinds = new Set(payload.fragments.map((f) => f.fragment_kind));
    assert.ok(fragKinds.has("text"), "Expected text fragments");
    assert.ok(fragKinds.has("tool_call"), "Expected tool_call fragments");
    assert.ok(fragKinds.has("tool_result"), "Expected tool_result fragments");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe ingests Accio subagent session with parent linkage via meta file", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-accio-sub-"));

  try {
    // Main agent session (minimal)
    const agentDir = path.join(tempRoot, "agents", "DID-TEST01-AABB", "sessions");
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      path.join(agentDir, "DID-TEST01-AABB_CID-TEST-CONV-002.messages.jsonl"),
      [
        { id: "m1", timestamp: 1775400000000, role: "user", content: "Search for patterns.", messageType: "normal" },
        {
          id: "m2", timestamp: 1775400003000, role: "assistant", content: "Searching now.",
          messageType: "normal",
          metadata: { usage: { prompt_tokens: 500, completion_tokens: 30, total_tokens: 530, reasoning_tokens: 0 } },
        },
      ].map((l) => JSON.stringify(l)).join("\n"),
      "utf8",
    );

    // Subagent session
    const subagentDir = path.join(tempRoot, "subagent-sessions");
    await mkdir(subagentDir, { recursive: true });

    await writeFile(
      path.join(subagentDir, "agent_agent_DID-TEST01-AABB_main_cid_CID-TEST-CONV-002_sub_explore_ff001122.messages.jsonl"),
      [
        { id: "s1", timestamp: 1775400001000, role: "user", content: "Find all connection patterns.", messageType: "normal" },
        {
          id: "s2", timestamp: 1775400002000, role: "assistant", content: "Found 3 patterns in the codebase.",
          messageType: "normal",
          metadata: { usage: { prompt_tokens: 400, completion_tokens: 50, total_tokens: 450, reasoning_tokens: 0 } },
        },
      ].map((l) => JSON.stringify(l)).join("\n"),
      "utf8",
    );

    await writeFile(
      path.join(subagentDir, "agent_agent_DID-TEST01-AABB_main_cid_CID-TEST-CONV-002_sub_explore_ff001122.meta.jsonc"),
      JSON.stringify({
        sessionKey: "agent:agent:DID-TEST01-AABB:main:cid:CID-TEST-CONV-002:sub:explore:ff001122",
        agentId: "explore",
        parentSessionKey: "agent:DID-TEST01-AABB:main:cid:CID-TEST-CONV-002",
        status: "completed",
        label: "Search patterns",
      }),
      "utf8",
    );

    const [payload] = (
      await runSourceProbe(
        { source_ids: ["src-accio-sub"] },
        [createSourceDefinition("src-accio-sub", "accio", path.join(tempRoot, "agents"))],
      )
    ).sources;

    assert.ok(payload, "Expected source payload");

    // Should have both main session and subagent session
    assert.ok(payload.sessions.length >= 2, `Expected at least 2 sessions, got ${payload.sessions.length}`);

    // Check that subagent session has session_relation fragment
    const relationFrags = payload.fragments.filter((f) => f.fragment_kind === "session_relation");
    assert.ok(relationFrags.length >= 1, "Expected at least 1 session_relation fragment");

    // Verify the relation references the parent
    const relationPayload = relationFrags[0]?.payload;
    assert.ok(relationPayload);
    assert.equal(
      (relationPayload as Record<string, unknown>).parent_uuid,
      "agent:DID-TEST01-AABB:main:cid:CID-TEST-CONV-002",
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe reads Accio conversation metadata for model, title, and workspace path", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-accio-convmeta-"));

  try {
    const agentDir = path.join(tempRoot, "agents", "DID-TEST01-AABB", "sessions");
    await mkdir(agentDir, { recursive: true });

    // Main session file
    await writeFile(
      path.join(agentDir, "DID-TEST01-AABB_CID-CONV-META-001.messages.jsonl"),
      [
        { id: "m1", timestamp: 1775400000000, role: "user", content: "Fix the bug.", messageType: "normal" },
        {
          id: "m2",
          timestamp: 1775400005000,
          role: "assistant",
          content: "Fixed.",
          messageType: "normal",
          metadata: { usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } },
        },
      ]
        .map((l) => JSON.stringify(l))
        .join("\n"),
      "utf8",
    );

    // Conversation metadata (conversations/dm/CID-xxx.jsonc)
    const convDir = path.join(tempRoot, "conversations", "dm");
    await mkdir(convDir, { recursive: true });
    await writeFile(
      path.join(convDir, "CID-CONV-META-001.jsonc"),
      JSON.stringify({
        id: "CID-CONV-META-001",
        path: "/workspace/my-project",
        title: "Fix critical bug in parser",
        sessionModel: "claude-opus-4-6",
        agentId: "DID-TEST01-AABB",
        createdAt: 1775400000000,
      }),
      "utf8",
    );

    const [payload] = (
      await runSourceProbe(
        { source_ids: ["src-accio-convmeta"] },
        [createSourceDefinition("src-accio-convmeta", "accio", path.join(tempRoot, "agents"))],
      )
    ).sources;

    assert.ok(payload, "Expected source payload");
    assert.equal(payload.sessions.length, 1);

    const session = payload.sessions[0]!;
    assert.equal(session.title, "Fix critical bug in parser", "Title should come from conversation metadata");
    assert.equal(session.model, "claude-opus-4-6", "Model should come from conversation metadata sessionModel");
    assert.equal(
      session.working_directory,
      "/workspace/my-project",
      "Working directory should come from conversation metadata path",
    );

    // Turn should have model from session
    assert.equal(payload.turns.length, 1);
    assert.equal(
      payload.turns[0]?.context_summary?.primary_model,
      "claude-opus-4-6",
      "Turn primary_model should fall back to session model from conversation metadata",
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe handles empty Accio messages gracefully", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-accio-empty-"));

  try {
    const agentDir = path.join(tempRoot, "agents", "DID-TEST01-AABB", "sessions");
    await mkdir(agentDir, { recursive: true });

    await writeFile(
      path.join(agentDir, "DID-TEST01-AABB_CID-TEST-CONV-003.messages.jsonl"),
      [
        { id: "m1", timestamp: 1775400000000, role: "system", messageType: "normal" },
        { id: "m2", timestamp: 1775400001000, role: "user", content: "Hello", messageType: "normal" },
      ]
        .map((l) => JSON.stringify(l))
        .join("\n"),
      "utf8",
    );

    const [payload] = (
      await runSourceProbe(
        { source_ids: ["src-accio-empty"] },
        [createSourceDefinition("src-accio-empty", "accio", path.join(tempRoot, "agents"))],
      )
    ).sources;

    assert.ok(payload, "Expected source payload");
    // Empty system message should produce a loss audit
    const emptyAudits = payload.loss_audits.filter((a) => a.diagnostic_code === "accio_empty_record");
    assert.ok(emptyAudits.length >= 1, "Expected loss audit for empty system record");

    // User turn should still be present
    assert.ok(payload.turns.length >= 1, "Expected at least 1 turn");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
