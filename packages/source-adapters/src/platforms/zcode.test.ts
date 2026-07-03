import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { getDefaultSourcesForHost, runSourceProbe } from "../index.js";
import { extractMultiSessionSeeds } from "../core/parser.js";
import { assertFragmentKinds } from "../test-helpers.js";

test("[zcode] reads ~/.zcode CLI SQLite messages, parts, tools, and token usage", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-zcode-"));

  try {
    const zcodeRoot = path.join(tempRoot, ".zcode");
    const dbDir = path.join(zcodeRoot, "cli", "db");
    await mkdir(dbDir, { recursive: true });
    await mkdir(path.join(zcodeRoot, "cli", "debug"), { recursive: true });
    await writeFile(path.join(zcodeRoot, "cli", "debug", "model-io-sess_zcode_fixture.jsonl"), "{}\n", "utf8");

    createZcodeFixtureDb(path.join(dbDir, "db.sqlite"));

    const zcodeSource = getDefaultSourcesForHost({ homeDir: tempRoot, includeMissing: true }).find(
      (source) => source.platform === "zcode",
    );
    assert.ok(zcodeSource);
    assert.equal(zcodeSource.base_dir, zcodeRoot);

    const [payload] = (await runSourceProbe({ source_ids: [zcodeSource.id] }, [zcodeSource])).sources;
    assert.ok(payload);
    assert.equal(payload.source.sync_status, "healthy");
    assert.equal(payload.blobs.length, 1);
    assert.equal(payload.sessions.length, 2);
    assert.equal(payload.turns.length, 2);
    assert.equal(payload.contexts.length, 2);
    assertFragmentKinds(payload, ["title_signal", "workspace_signal", "model_signal", "text", "tool_call", "tool_result", "session_relation"]);

    const mainSession = payload.sessions.find((session) => session.id === "sess:zcode:sess_zcode_main");
    assert.ok(mainSession);
    assert.equal(mainSession.title, "ZCode fixture session");
    assert.equal(mainSession.working_directory, "/Users/mock/workspace/zcode-fixture");
    assert.equal(mainSession.updated_at, "2026-05-28T20:26:46.000Z");

    const mainTurn = payload.turns.find((turn) => turn.session_id === "sess:zcode:sess_zcode_main");
    assert.ok(mainTurn);
    assert.equal(mainTurn.canonical_text, "Review the ZCode adapter shape.");
    const mainContext = payload.contexts.find((context) => context.turn_id === mainTurn.turn_id);
    assert.ok(mainContext);
    assert.equal(mainContext.assistant_replies[0]?.content, "The ZCode adapter can use SQLite rows.");
    assert.equal(mainContext.tool_calls[0]?.tool_name, "Read");
    assert.equal(mainContext.assistant_replies[0]?.token_usage?.total_tokens, 18);

    const relation = payload.fragments.find(
      (fragment) =>
        fragment.fragment_kind === "session_relation" &&
        fragment.session_ref === "sess:zcode:sess_zcode_child",
    );
    assert.ok(relation);
    assert.equal(relation.payload.parent_uuid, "sess_zcode_main");
    assert.equal(relation.payload.agent_id, "reviewer");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("[zcode] lets empty SQLite stores fall back to raw evidence preservation", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-zcode-empty-"));

  try {
    const zcodeRoot = path.join(tempRoot, ".zcode");
    const dbDir = path.join(zcodeRoot, "cli", "db");
    await mkdir(dbDir, { recursive: true });
    const dbPath = path.join(dbDir, "db.sqlite");
    createEmptyZcodeFixtureDb(dbPath);

    const zcodeSource = getDefaultSourcesForHost({ homeDir: tempRoot, includeMissing: true }).find(
      (source) => source.platform === "zcode",
    );
    assert.ok(zcodeSource);

    const seeds = await extractMultiSessionSeeds(zcodeSource, dbPath, await readFile(dbPath), "blob-empty");
    assert.equal(seeds, undefined);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function createZcodeFixtureDb(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE session (
        id text primary key,
        project_id text not null,
        workspace_id text,
        parent_id text,
        slug text not null,
        directory text not null,
        path text,
        title text not null,
        version text not null,
        time_created integer not null,
        time_updated integer not null,
        time_archived integer,
        task_type text not null default 'interactive',
        trace_id text
      );
      CREATE TABLE message (
        id text primary key,
        session_id text not null,
        time_created integer not null,
        time_updated integer not null,
        data text not null
      );
      CREATE TABLE part (
        id text primary key,
        message_id text not null,
        session_id text not null,
        time_created integer not null,
        time_updated integer not null,
        data text not null
      );
      CREATE TABLE session_task_link (
        parent_session_id text,
        child_session_id text not null,
        role text not null,
        label text,
        agent_type text,
        model text,
        status text not null,
        time_created integer not null
      );
    `);

    const insertSession = db.prepare(`
      INSERT INTO session (
        id, project_id, workspace_id, parent_id, slug, directory, path, title, version,
        time_created, time_updated, time_archived, task_type, trace_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertSession.run(
      "sess_zcode_main",
      "project-zcode",
      null,
      null,
      "zcode-main",
      "/Users/mock/workspace/zcode-fixture",
      null,
      "ZCode fixture session",
      "3.0.0",
      1780000000000,
      1780000006000,
      null,
      "interactive",
      "trace-zcode-main",
    );
    insertSession.run(
      "sess_zcode_child",
      "project-zcode",
      null,
      "sess_zcode_main",
      "zcode-child",
      "/Users/mock/workspace/zcode-fixture",
      null,
      "ZCode delegated fixture",
      "3.0.0",
      1780000010000,
      1780000014000,
      null,
      "subagent",
      "trace-zcode-child",
    );

    const insertMessage = db.prepare(`
      INSERT INTO message (id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertMessage.run(
      "msg_zcode_user",
      "sess_zcode_main",
      1780000001000,
      1780000001000,
      JSON.stringify({
        role: "user",
        time: { created: 1780000001000 },
        model: { providerID: "builtin:test", modelID: "zcode-test-model" },
        path: { cwd: "/Users/mock/workspace/zcode-fixture", root: "/Users/mock/workspace/zcode-fixture" },
      }),
    );
    insertMessage.run(
      "msg_zcode_assistant",
      "sess_zcode_main",
      1780000002000,
      1780000006000,
      JSON.stringify({
        role: "assistant",
        parentID: "msg_zcode_user",
        modelID: "zcode-test-model",
        providerID: "builtin:test",
        finish: "stop",
        path: { cwd: "/Users/mock/workspace/zcode-fixture", root: "/Users/mock/workspace/zcode-fixture" },
      }),
    );
    insertMessage.run(
      "msg_zcode_child_user",
      "sess_zcode_child",
      1780000011000,
      1780000011000,
      JSON.stringify({
        role: "user",
        time: { created: 1780000011000 },
        model: { providerID: "builtin:test", modelID: "zcode-test-model" },
        path: { cwd: "/Users/mock/workspace/zcode-fixture", root: "/Users/mock/workspace/zcode-fixture" },
      }),
    );
    insertMessage.run(
      "msg_zcode_child_assistant",
      "sess_zcode_child",
      1780000012000,
      1780000014000,
      JSON.stringify({
        role: "assistant",
        parentID: "msg_zcode_child_user",
        modelID: "zcode-test-model",
        providerID: "builtin:test",
        finish: "stop",
        path: { cwd: "/Users/mock/workspace/zcode-fixture", root: "/Users/mock/workspace/zcode-fixture" },
      }),
    );

    const insertPart = db.prepare(`
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertPart.run(
      "part_zcode_user_text",
      "msg_zcode_user",
      "sess_zcode_main",
      1780000001000,
      1780000001000,
      JSON.stringify({ type: "text", text: "Review the ZCode adapter shape." }),
    );
    insertPart.run(
      "part_zcode_assistant_text",
      "msg_zcode_assistant",
      "sess_zcode_main",
      1780000002000,
      1780000002000,
      JSON.stringify({ type: "text", text: "The ZCode adapter can use SQLite rows." }),
    );
    insertPart.run(
      "part_zcode_assistant_tool",
      "msg_zcode_assistant",
      "sess_zcode_main",
      1780000003000,
      1780000003000,
      JSON.stringify({
        type: "tool",
        callID: "call_zcode_read",
        tool: "Read",
        state: {
          status: "completed",
          input: { file_path: "/Users/mock/workspace/zcode-fixture/README.md" },
          output: "README loaded",
        },
      }),
    );
    insertPart.run(
      "part_zcode_assistant_finish",
      "msg_zcode_assistant",
      "sess_zcode_main",
      1780000006000,
      1780000006000,
      JSON.stringify({
        type: "step-finish",
        reason: "stop",
        tokens: { input: 10, output: 4, reasoning: 1, total: 18, cache: { read: 3, write: 0 } },
      }),
    );
    insertPart.run(
      "part_zcode_child_user_text",
      "msg_zcode_child_user",
      "sess_zcode_child",
      1780000011000,
      1780000011000,
      JSON.stringify({ type: "text", text: "Check this as a delegated reviewer." }),
    );
    insertPart.run(
      "part_zcode_child_assistant_text",
      "msg_zcode_child_assistant",
      "sess_zcode_child",
      1780000012000,
      1780000012000,
      JSON.stringify({ type: "text", text: "Delegated review complete." }),
    );

    db.prepare(`
      INSERT INTO session_task_link (
        parent_session_id, child_session_id, role, label, agent_type, model, status, time_created
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "sess_zcode_main",
      "sess_zcode_child",
      "reviewer",
      "Review child session",
      "reviewer",
      "zcode-test-model",
      "completed",
      1780000010000,
    );
  } finally {
    db.close();
  }
}

function createEmptyZcodeFixtureDb(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE session (
        id text primary key,
        parent_id text,
        directory text,
        path text,
        title text,
        task_type text,
        time_created integer,
        time_updated integer,
        time_archived integer,
        trace_id text
      );
      CREATE TABLE message (
        id text primary key,
        session_id text,
        time_created integer,
        time_updated integer,
        data text
      );
      CREATE TABLE part (
        id text primary key,
        message_id text,
        session_id text,
        time_created integer,
        time_updated integer,
        data text
      );
    `);
  } finally {
    db.close();
  }
}
