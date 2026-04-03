import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runSourceProbe } from "../index.js";
import { 
  createSourceDefinition 
} from "../test-helpers.js";

test("runSourceProbe normalizes Factory delegated session metadata into session_relation fragments", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const factoryDir = path.join(tempRoot, "factory-relation");
    await mkdir(factoryDir, { recursive: true });
    await writeFile(
      path.join(factoryDir, "session.jsonl"),
      [
        {
          timestamp: "2026-03-09T02:00:00.000Z",
          type: "session_start",
          sessionTitle: "Factory delegated session",
          cwd: "/workspace/factory-relation",
        },
        {
          timestamp: "2026-03-09T02:00:01.000Z",
          type: "message",
          message: {
            role: "user",
            content: [{ type: "text", text: "Review the current plan as a delegated agent." }],
          },
        },
        {
          timestamp: "2026-03-09T02:00:02.000Z",
          type: "message",
          callingSessionId: "factory-parent-1",
          callingToolUseId: "factory-tool-parent-1",
          agentId: "reviewer-agent",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Subagent reviewed the current plan." }],
          },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf8",
    );

    const [payload] = (await runSourceProbe(
      { source_ids: ["src-factory-relation"] },
      [createSourceDefinition("src-factory-relation", "factory_droid", factoryDir)],
    )).sources;

    assert.ok(payload);
    assert.equal(payload.sessions.length, 1);
    assert.equal(payload.turns.length, 1);
    const relation = payload.fragments.find((fragment) => fragment.fragment_kind === "session_relation");
    assert.ok(relation);
    assert.equal(relation?.payload.parent_uuid, "factory-parent-1");
    assert.equal(relation?.payload.parent_tool_ref, "factory-tool-parent-1");
    assert.equal(relation?.payload.agent_id, "reviewer-agent");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe uses file mtime as session end when factory_droid records share one timestamp", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const factoryDir = path.join(tempRoot, "factory");
    await mkdir(factoryDir, { recursive: true });

    const sharedTimestamp = "2026-03-09T05:00:00.000Z";
    await writeFile(
      path.join(factoryDir, "session.jsonl"),
      [
        { timestamp: sharedTimestamp, type: "session_start", sessionTitle: "Flat session", cwd: "/workspace/flat" },
        { timestamp: sharedTimestamp, type: "message", message: { role: "user", content: [{ type: "text", text: "Hello" }] } },
        { timestamp: sharedTimestamp, type: "message", message: { role: "assistant", content: [{ type: "text", text: "Hi there!" }] } },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf8",
    );

    const fileMtime = new Date("2026-03-09T05:10:00.000Z");
    await utimes(path.join(factoryDir, "session.jsonl"), fileMtime, fileMtime);

    const [payload] = (
      await runSourceProbe({ limit_files_per_source: 1 }, [
        createSourceDefinition("src-factory-flat", "factory_droid", factoryDir),
      ])
    ).sources;

    assert.ok(payload);
    assert.equal(payload.sessions.length, 1);
    const session = payload.sessions[0]!;
    assert.equal(session.created_at, sharedTimestamp);
    assert.equal(session.updated_at, fileMtime.toISOString());

    assert.ok(payload.blobs[0]?.file_modified_at);
    assert.equal(payload.blobs[0]!.file_modified_at, fileMtime.toISOString());
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

