import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
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
