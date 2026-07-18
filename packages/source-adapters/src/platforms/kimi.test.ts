import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { getDefaultSourcesForHost, listSourceFiles, runSourceProbe } from "../index.js";
import { createSourceDefinition } from "../test-helpers.js";

test("[kimi] main wire sessions produce user turns while history and subagent wires stay companion evidence", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-kimi-"));

  try {
    const kimiRoot = path.join(tempRoot, ".kimi-code");
    const sessionId = "session_fixture-1";
    const sessionDir = path.join(kimiRoot, "sessions", "wd_fixture", sessionId);
    const mainAgentDir = path.join(sessionDir, "agents", "main");
    const childAgentDir = path.join(sessionDir, "agents", "agent-0");
    const historyDir = path.join(kimiRoot, "user-history");
    await mkdir(mainAgentDir, { recursive: true });
    await mkdir(childAgentDir, { recursive: true });
    await mkdir(historyDir, { recursive: true });

    const wirePath = path.join(mainAgentDir, "wire.jsonl");
    const lines = [
      { type: "metadata", protocol_version: "1", created_at: 1_773_000_000_000 },
      { type: "config.update", modelAlias: "kimi-code/k3", time: 1_773_000_000_100 },
      {
        type: "turn.prompt",
        input: [{ type: "text", text: "Review the Kimi adapter boundary." }],
        origin: { kind: "user" },
        time: 1_773_000_001_000,
      },
      {
        type: "context.append_message",
        message: {
          role: "user",
          content: [{ type: "text", text: "Review the Kimi adapter boundary." }],
          toolCalls: [],
          origin: { kind: "user" },
        },
        time: 1_773_000_001_000,
      },
      {
        type: "context.append_loop_event",
        event: { type: "content.part", uuid: "think-1", part: { type: "think", think: "Inspecting the source shape." } },
        time: 1_773_000_002_000,
      },
      {
        type: "context.append_loop_event",
        event: { type: "content.part", uuid: "text-1", part: { type: "text", text: "I found the main wire stream." } },
        time: 1_773_000_003_000,
      },
      {
        type: "context.append_loop_event",
        event: { type: "tool.call", uuid: "call-1", toolCallId: "call-1", name: "Read", args: { path: "state.json" } },
        time: 1_773_000_004_000,
      },
      {
        type: "context.append_loop_event",
        event: { type: "tool.result", parentUuid: "call-1", toolCallId: "call-1", result: { output: "state loaded" } },
        time: 1_773_000_005_000,
      },
      {
        type: "usage.record",
        model: "kimi-code/k3",
        usageScope: "turn",
        usage: { inputOther: 100, inputCacheRead: 20, inputCacheCreation: 5, output: 30 },
        time: 1_773_000_006_000,
      },
      {
        type: "turn.steer",
        input: [{ type: "text", text: "Background task finished." }],
        origin: { kind: "background_task", status: "completed" },
        time: 1_773_000_007_000,
      },
      {
        type: "turn.prompt",
        input: [{ type: "text", text: "Now add regression coverage." }],
        origin: { kind: "user" },
        time: 1_773_000_008_000,
      },
      {
        type: "context.append_loop_event",
        event: { type: "content.part", uuid: "text-2", part: { type: "text", text: "Coverage added." } },
        time: 1_773_000_009_000,
      },
    ];
    await writeFile(wirePath, lines.map((line) => JSON.stringify(line)).join("\n"), "utf8");
    await writeFile(
      path.join(sessionDir, "state.json"),
      JSON.stringify({
        createdAt: "2026-03-09T06:00:00.000Z",
        updatedAt: "2026-03-09T06:10:00.000Z",
        title: "Kimi adapter fixture",
        workDir: "/workspace/kimi-fixture",
        lastPrompt: "Now add regression coverage.",
        agents: {
          main: { type: "main", parentAgentId: null, homedir: "/tmp/main" },
          "agent-0": { type: "sub", parentAgentId: "main", homedir: "/tmp/agent-0" },
        },
        custom: {},
      }),
      "utf8",
    );
    await writeFile(
      path.join(childAgentDir, "wire.jsonl"),
      JSON.stringify({
        type: "turn.prompt",
        input: [{ type: "text", text: "Delegated child instruction." }],
        origin: { kind: "system_trigger", name: "subagent" },
        time: 1_773_000_003_500,
      }),
      "utf8",
    );
    await writeFile(
      path.join(kimiRoot, "session_index.jsonl"),
      JSON.stringify({ sessionId, sessionDir, workDir: "/workspace/kimi-fixture" }),
      "utf8",
    );
    await writeFile(path.join(kimiRoot, "workspaces.json"), JSON.stringify({}), "utf8");
    await writeFile(
      path.join(historyDir, "fixture.jsonl"),
      ["Review the Kimi adapter boundary.", "Now add regression coverage."]
        .map((content) => JSON.stringify({ content }))
        .join("\n"),
      "utf8",
    );

    const source = createSourceDefinition("src-kimi", "kimi", kimiRoot);
    const sourceFiles = await listSourceFiles("kimi", kimiRoot);
    assert.deepEqual(sourceFiles, [wirePath]);

    const [payload] = (await runSourceProbe({ source_ids: [source.id] }, [source])).sources;
    assert.ok(payload);
    assert.equal(payload.source.sync_status, "healthy");
    assert.equal(payload.sessions.length, 1);
    assert.equal(payload.sessions[0]?.id, `sess:kimi:${sessionId}`);
    assert.equal(payload.sessions[0]?.source_session_id, sessionId);
    assert.equal(payload.sessions[0]?.title, "Kimi adapter fixture");
    assert.equal(payload.sessions[0]?.working_directory, "/workspace/kimi-fixture");
    assert.equal(payload.sessions[0]?.model, "kimi-code/k3");
    assert.equal(payload.sessions[0]?.created_at, "2026-03-09T06:00:00.000Z");
    assert.equal(payload.sessions[0]?.updated_at, "2026-03-09T06:10:00.000Z");
    assert.equal(payload.turns.length, 2);
    assert.equal(
      payload.turns.filter((turn) => turn.canonical_text.includes("Review the Kimi adapter boundary.")).length,
      1,
    );
    assert.ok(payload.turns.some((turn) => turn.canonical_text.includes("Now add regression coverage.")));
    assert.ok(payload.turns.some((turn) => turn.user_messages.some((message) => message.is_injected)));
    assert.ok(payload.fragments.some((fragment) => fragment.fragment_kind === "tool_call"));
    assert.ok(payload.fragments.some((fragment) => fragment.fragment_kind === "tool_result"));
    assert.ok(payload.fragments.some((fragment) => fragment.fragment_kind === "token_usage_signal"));
    assert.ok(payload.loss_audits.some((audit) => audit.diagnostic_code === "kimi_duplicate_user_context_echo"));
    assert.equal(payload.turns.some((turn) => turn.raw_text.includes("Delegated child instruction.")), false);

    const blobPaths = new Set(payload.blobs.map((blob) => blob.origin_path));
    assert.ok(blobPaths.has(wirePath));
    assert.ok(blobPaths.has(path.join(sessionDir, "state.json")));
    assert.ok(blobPaths.has(path.join(childAgentDir, "wire.jsonl")));
    assert.ok(blobPaths.has(path.join(kimiRoot, "session_index.jsonl")));
    assert.ok(blobPaths.has(path.join(kimiRoot, "workspaces.json")));
    assert.ok(blobPaths.has(path.join(historyDir, "fixture.jsonl")));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("[kimi] default discovery selects ~/.kimi-code when present", () => {
  const homeDir = "/Users/tester";
  const kimiRoot = path.join(homeDir, ".kimi-code");
  const sources = getDefaultSourcesForHost({
    homeDir,
    hostname: "kimi-test-host",
    platform: "darwin",
    pathExists: (targetPath) => targetPath === kimiRoot,
  });

  assert.equal(sources.length, 1);
  assert.equal(sources[0]?.platform, "kimi");
  assert.equal(sources[0]?.family, "local_coding_agent");
  assert.equal(sources[0]?.base_dir, kimiRoot);
});
