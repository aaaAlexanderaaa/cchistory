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

test("runSourceProbe classifies Factory lifecycle records as hidden source metadata", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-factory-lifecycle-"));

  try {
    const factoryDir = path.join(tempRoot, "factory-lifecycle");
    await mkdir(factoryDir, { recursive: true });

    await writeFile(
      path.join(factoryDir, "session.jsonl"),
      [
        {
          timestamp: "2026-03-09T06:00:00.000Z",
          type: "session_start",
          sessionTitle: "Factory lifecycle session",
          cwd: "/workspace/factory-lifecycle",
        },
        {
          timestamp: "2026-03-09T06:00:01.000Z",
          type: "message",
          message: {
            role: "user",
            content: [{ type: "text", text: "Keep Factory lifecycle events as evidence." }],
          },
        },
        {
          timestamp: "2026-03-09T06:00:02.000Z",
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Lifecycle events will be preserved as metadata." }],
          },
        },
        {
          timestamp: "2026-03-09T06:00:03.000Z",
          type: "todo_state",
          status: "active",
          id: "todo-event-1",
          messageIndex: 1,
          todos: {
            todos: "\n1. [completed] Preserve Factory todo state as metadata\n2. [in_progress] Verify lifecycle coverage\n",
          },
        },
        {
          timestamp: "2026-03-09T06:00:04.000Z",
          type: "compaction_state",
          compacted: true,
          summaryText: "Context compacted for the next step.",
        },
        {
          timestamp: "2026-03-09T06:00:05.000Z",
          type: "session_end",
          reason: "completed",
          status: "success",
          durationMs: 91628,
          toolCount: 3,
          finalText: "Lifecycle session completed with preserved final text.",
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf8",
    );

    const [payload] = (
      await runSourceProbe({ source_ids: ["src-factory-lifecycle"] }, [
        createSourceDefinition("src-factory-lifecycle", "factory_droid", factoryDir),
      ])
    ).sources;

    assert.ok(payload);
    assert.equal(payload.turns.length, 1);
    assert.equal(
      payload.loss_audits.some((audit) => audit.diagnostic_code === "factory_droid_unhandled_record_type"),
      false,
    );

    const lifecycleFragments = payload.fragments.filter(
      (fragment) =>
        fragment.payload.signal_kind === "todo_state" ||
        fragment.payload.signal_kind === "compaction_state" ||
        fragment.payload.signal_kind === "session_end",
    );
    assert.equal(lifecycleFragments.length, 3);
    assert.ok(lifecycleFragments.every((fragment) => fragment.fragment_kind === "unknown"));
    const todoFragment = lifecycleFragments.find((fragment) => fragment.payload.signal_kind === "todo_state");
    assert.equal(todoFragment?.payload.source_event_id, "todo-event-1");
    assert.equal(todoFragment?.payload.message_index, 1);
    assert.equal(todoFragment?.payload.todo_text_present, true);
    assert.equal(todoFragment?.payload.todo_text_bytes, 97);
    assert.deepEqual(todoFragment?.payload.todo_status_counts, { completed: 1, in_progress: 1 });
    assert.match(String(todoFragment?.payload.lifecycle_text_preview), /Preserve Factory todo state/);
    const compactionFragment = lifecycleFragments.find((fragment) => fragment.payload.signal_kind === "compaction_state");
    assert.equal(compactionFragment?.payload.summary_present, true);
    assert.equal(compactionFragment?.payload.lifecycle_text_preview, "Context compacted for the next step.");
    const sessionEndFragment = lifecycleFragments.find((fragment) => fragment.payload.signal_kind === "session_end");
    assert.equal(sessionEndFragment?.payload.duration_ms, 91628);
    assert.equal(sessionEndFragment?.payload.tool_count, 3);
    assert.equal(sessionEndFragment?.payload.final_text_present, true);
    assert.equal(sessionEndFragment?.payload.lifecycle_text_preview, "Lifecycle session completed with preserved final text.");
    assert.ok(payload.atoms.some((atom) => atom.payload.signal_kind === "todo_state" && atom.display_policy === "hide"));
    assert.ok(payload.atoms.some((atom) => atom.payload.signal_kind === "compaction_state" && atom.display_policy === "hide"));
    assert.ok(payload.atoms.some((atom) => atom.payload.signal_kind === "session_end" && atom.display_policy === "hide"));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
