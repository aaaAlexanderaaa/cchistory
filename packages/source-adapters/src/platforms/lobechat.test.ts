import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runSourceProbe } from "../index.js";
import { createSourceDefinition } from "../test-helpers.js";
import { lobechatAdapter } from "./lobechat.js";

test("lobechat adapter has correct platform and support tier", () => {
  assert.equal(lobechatAdapter.platform, "lobechat");
  assert.equal(lobechatAdapter.supportTier, "experimental");
});

test("lobechat adapter matchesSourceFile accepts .json files only", () => {
  assert.equal(lobechatAdapter.matchesSourceFile("export.json"), true);
  assert.equal(lobechatAdapter.matchesSourceFile("conversations.json"), true);
  assert.equal(lobechatAdapter.matchesSourceFile("history.jsonl"), false);
  assert.equal(lobechatAdapter.matchesSourceFile("history.txt"), false);
  assert.equal(lobechatAdapter.matchesSourceFile("data.db"), false);
});

test("lobechat adapter getDefaultBaseDirCandidates returns expected path under homeDir", () => {
  const candidates = lobechatAdapter.getDefaultBaseDirCandidates({ homeDir: "/home/user" });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0], path.join("/home/user", ".config", "lobehub-storage"));
});

test("lobechat adapter getDefaultBaseDirCandidates handles missing homeDir gracefully", () => {
  const candidates = lobechatAdapter.getDefaultBaseDirCandidates({});
  assert.equal(candidates.length, 1);
  assert.equal(typeof candidates[0], "string");
});

test("runSourceProbe ingests LobeChat export JSON and emits one session and one user turn", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-lobechat-"));

  try {
    const lobechatDir = path.join(tempRoot, "lobechat");
    await mkdir(lobechatDir, { recursive: true });

    await writeFile(
      path.join(lobechatDir, "lobechat-export.json"),
      JSON.stringify({
        id: "lobechat-test-session-1",
        title: "LobeChat test conversation",
        model: "gpt-4.1",
        messages: [
          {
            id: "msg-user-1",
            role: "user",
            createdAt: "2026-03-10T06:00:00.000Z",
            content: "How do I use LobeChat?",
          },
          {
            id: "msg-assistant-1",
            role: "assistant",
            createdAt: "2026-03-10T06:00:01.000Z",
            content: "You can use LobeChat by opening the web app.",
            usage: {
              inputTokens: 10,
              outputTokens: 12,
              totalTokens: 22,
            },
            stopReason: "end_turn",
          },
        ],
      }),
      "utf8",
    );

    const [payload] = (
      await runSourceProbe(
        { source_ids: ["src-lobechat-test"] },
        [createSourceDefinition("src-lobechat-test", "lobechat", lobechatDir, "conversational_export")],
      )
    ).sources;

    assert.ok(payload, "should produce a payload");
    assert.equal(payload.source.sync_status, "healthy");
    assert.equal(payload.source.platform, "lobechat");
    assert.equal(payload.source.family, "conversational_export");
    assert.equal(payload.sessions.length, 1, "should have exactly one session");
    assert.equal(payload.turns.length, 1, "should have exactly one user turn");
    assert.ok(
      payload.turns[0]?.canonical_text.includes("LobeChat"),
      "canonical_text should include the user message content",
    );
    assert.equal(payload.contexts.length, 1, "should have one turn context with assistant reply");
    assert.ok(
      payload.contexts[0]?.assistant_replies[0]?.content.length,
      "assistant reply content should be non-empty",
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe handles LobeChat export with multiple conversations in a single file", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-lobechat-multi-"));

  try {
    const lobechatDir = path.join(tempRoot, "lobechat");
    await mkdir(lobechatDir, { recursive: true });

    // LobeChat exports can be an array of conversation objects
    await writeFile(
      path.join(lobechatDir, "multi-export.json"),
      JSON.stringify([
        {
          id: "lobechat-conv-a",
          title: "Conversation A",
          model: "gpt-4.1",
          messages: [
            {
              id: "msg-a-user",
              role: "user",
              createdAt: "2026-03-10T07:00:00.000Z",
              content: "First conversation question.",
            },
            {
              id: "msg-a-assistant",
              role: "assistant",
              createdAt: "2026-03-10T07:00:01.000Z",
              content: "First conversation answer.",
            },
          ],
        },
        {
          id: "lobechat-conv-b",
          title: "Conversation B",
          model: "gpt-4.1",
          messages: [
            {
              id: "msg-b-user",
              role: "user",
              createdAt: "2026-03-10T08:00:00.000Z",
              content: "Second conversation question.",
            },
            {
              id: "msg-b-assistant",
              role: "assistant",
              createdAt: "2026-03-10T08:00:01.000Z",
              content: "Second conversation answer.",
            },
          ],
        },
      ]),
      "utf8",
    );

    const [payload] = (
      await runSourceProbe(
        { source_ids: ["src-lobechat-multi"] },
        [createSourceDefinition("src-lobechat-multi", "lobechat", lobechatDir, "conversational_export")],
      )
    ).sources;

    assert.ok(payload, "should produce a payload");
    assert.equal(payload.source.sync_status, "healthy");
    assert.ok(payload.sessions.length >= 1, "should produce at least one session from a multi-conversation export");
    assert.ok(payload.turns.length >= 1, "should produce at least one turn from a multi-conversation export");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
