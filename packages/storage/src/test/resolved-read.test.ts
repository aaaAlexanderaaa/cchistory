import { cp, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import assert from "node:assert/strict";
import { CCHistoryStorage } from "../index.js";
import { createFixturePayload } from "./helpers.js";

test("source writes and resolved reads work without Node's transaction introspection property", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cchistory-resolved-older-node-"));
  const storage = new CCHistoryStorage(root);
  const db = storage.getDatabaseForMigration();
  const internals = storage as unknown as { dbConnection: DatabaseSync };
  // Node 22.13–22.15 expose SQLite without DatabaseSync.isTransaction.
  // Keep the real SQLite engine and hide only that newer accessor.
  internals.dbConnection = new Proxy(db, {
    get(target, key) {
      if (key === "isTransaction") return undefined;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  try {
    storage.replaceSourcePayload(createFixturePayload("src-older-node", "original input", "stage-older-node"));
    db.exec("DELETE FROM resolved_read_index_state");
    assert.equal(storage.listResolvedTurnsPage(0, 1).turns[0]?.canonical_text, "original input");
    storage.mergeSourcePayloadByOriginPath(createFixturePayload("src-older-node", "updated input", "stage-updated-node"));
    assert.equal(storage.getResolvedTurn("turn-1")?.canonical_text, "updated input");
    assert.equal(db.isTransaction, false);

    assert.throws(() => storage.replaceSourcePayload(
      createFixturePayload("src-older-node", "failed replacement", "stage-failed-node"),
      { onProgress: (event) => {
        if (event.stage === "write_store_done") throw new Error("injected older-runtime rollback");
      } },
    ), /injected older-runtime rollback/);
    assert.equal(db.isTransaction, false);
    assert.equal(storage.getResolvedTurn("turn-1")?.canonical_text, "updated input");

    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("UPDATE user_turns_v2 SET canonical_text_full = 'pending input'");
      assert.equal(storage.getResolvedTurn("turn-1")?.canonical_text, "pending input");
      storage.refreshDerivedProjections();
      assert.equal(db.isTransaction, true, "joined helpers cannot commit their caller's transaction");
    } finally { db.exec("ROLLBACK"); }
    assert.equal(storage.getResolvedTurn("turn-1")?.canonical_text, "updated input");
  } finally {
    internals.dbConnection = db;
    storage.close();
    await rm(root, { recursive: true, force: true });
  }
});

for (const includeProjectObservation of [false, true]) {
  test(`live in-memory resolved reads need no archive files (project observation=${includeProjectObservation})`, () => {
    const storage = new CCHistoryStorage({ dbPath: ":memory:" });
    try {
      storage.replaceSourcePayload(createFixturePayload("src-live-memory", "live memory prompt", "stage-live-memory", {
        includeProjectObservation,
      }));
      const expected = storage.listResolvedTurns();
      assert.equal(expected.length, 1);
      assert.equal(expected[0]!.canonical_text, "live memory prompt");
      assert.deepEqual(storage.listResolvedTurnsPage(0, 10), { turns: expected, total: 1 });
      assert.deepEqual(storage.getResolvedTurn("turn-1"), expected[0]);
      assert.equal(storage.getResolvedTurn("missing"), undefined);
    } finally { storage.close(); }
  });
}

test("streaming facade excludes reads and mutations until commit or rollback releases ownership", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cchistory-resolved-stream-owner-"));
  const storage = new CCHistoryStorage(root);
  try {
    for (const fail of [true, false]) {
      const prior = createFixturePayload("src-stream-owner", "committed prior user", "stage-stream-owner");
      const incoming = createFixturePayload("src-stream-owner", "committed new user", "stage-stream-owner");
      storage.replaceSourcePayload(prior);
      storage.listResolvedTurnsPage(0, 1);
      let signalPaused!: () => void;
      let release!: () => void;
      const paused = new Promise<void>((resolve) => { signalPaused = resolve; });
      const resume = new Promise<void>((resolve) => { release = resolve; });
      const input = {
        chunks: (async function* () {
          yield { ...incoming, origin_path: incoming.blobs[0]!.origin_path };
          signalPaused();
          await resume;
          if (fail) throw new Error("injected stream rollback");
        })(),
        preserve_origin_paths: new Set<string>(),
        observed_origin_paths: new Set([incoming.blobs[0]!.origin_path]),
      };
      const writing = storage.mergeSourcePayloadStreaming(incoming.source, input);
      try {
        await paused;
        for (const read of [
          () => storage.listResolvedTurnsPage(0, 1),
          () => storage.getResolvedTurn("turn-1"),
          () => storage.getTurn("turn-1"),
          () => storage.getTurnContext("turn-1"),
          () => storage.listSources(),
          () => storage.purgeTurn("turn-1"),
          () => storage.replaceSourcePayload(prior),
          () => storage.getDatabaseForMigration(),
          () => storage.close(),
        ]) assert.throws(read, /storage busy.*streaming write/i);
        await assert.rejects(storage.mergeSourcePayloadStreaming(incoming.source, input), /storage busy.*streaming write/i);
      } finally { release(); }
      if (fail) await assert.rejects(writing, /injected stream rollback/);
      else await writing;
      assert.equal(storage.getResolvedTurn("turn-1")?.canonical_text, fail ? "committed prior user" : "committed new user");
      assert.equal(storage.listResolvedTurnsPage(0, 1).total, 1);
    }
  } finally { storage.close(); await rm(root, { recursive: true, force: true }); }
});

test("reopened resolved pages and detail hydrate selected turns without a whole snapshot", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cchistory-resolved-page-"));
  let storage = new CCHistoryStorage(root);
  try {
    for (let i = 0; i < 8; i++) {
      storage.replaceSourcePayload(createFixturePayload(`src-page-${i}`, `turn ${i}`, `stage-${i}`, {
        turnId: `turn-${i}`, sessionId: `session-${i}`,
        projectObservation: { workspacePath: `/workspace/project-${i % 2}` },
      }));
    }
    storage.upsertProjectOverride({
      target_kind: "turn", target_ref: "turn-3", project_id: "manual-project", display_name: "Manual", note: "page parity",
    });
    const expected = storage.listResolvedTurns();
    const expectedSession = storage.getResolvedSession("session-3");
    storage.close();
    storage = new CCHistoryStorage(root);
    const internals = storage as unknown as { computeProjectLinkSnapshot(): unknown };
    internals.computeProjectLinkSnapshot = () => { throw new Error("unexpected whole-history hydration"); };
    assert.deepEqual(storage.listResolvedTurnsPage(2, 3), { turns: expected.slice(2, 5), total: 8 });
    assert.deepEqual(storage.listResolvedTurnsPage(8, 2), { turns: [], total: 8 });
    assert.deepEqual(storage.listResolvedTurnsPage(0, 0), { turns: [], total: 8 });
    for (const [offset, limit] of [[-3, 2], [1.8, 2.4], [NaN, 2], [0, Infinity], [-Infinity, undefined], [Infinity, 1], [2, -1]] as const) {
      assert.deepEqual(storage.listResolvedTurnsPage(offset, limit), {
        turns: expected.slice(offset, limit == null ? undefined : offset + limit), total: 8,
      });
    }
    assert.deepEqual(storage.getResolvedTurn("turn-3"), expected.find((turn) => turn.id === "turn-3"));
    assert.deepEqual(storage.getResolvedSession("session-3"), expectedSession);
    assert.equal(storage.getResolvedTurn("missing"), undefined);
  } finally {
    storage.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("resolved index invalidates for every linker input and an obsolete decoration version", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cchistory-resolved-inputs-"));
  const storage = new CCHistoryStorage(root);
  const db = new DatabaseSync(storage.dbPath);
  try {
    const payload = createFixturePayload("src-inputs", "inputs", "stage-inputs", { includeProjectObservation: true });
    storage.replaceSourcePayload(payload);
    const mutations = [
      "UPDATE derived_candidates SET payload_json = json_set(payload_json, '$.confidence', 0.1) WHERE candidate_kind = 'project_observation'",
      "DELETE FROM derived_candidates WHERE candidate_kind = 'project_observation'",
      "UPDATE sessions SET payload_json = json_set(payload_json, '$.working_directory', '/workspace/changed-session')",
      "UPDATE captured_blobs SET origin_path = '/workspace/changed-origin.jsonl', payload_json = json_set(payload_json, '$.origin_path', '/workspace/changed-origin.jsonl')",
      "UPDATE source_instances SET payload_json = json_set(payload_json, '$.base_dir', '/workspace/changed-source')",
    ];
    for (const mutation of mutations) {
      db.exec(mutation);
      assert.equal((db.prepare("SELECT ready FROM resolved_read_index_state").get() as { ready: number }).ready, 0, mutation);
      const expected = storage.listResolvedTurns();
      assert.deepEqual(storage.listResolvedTurnsPage(0, 10).turns, expected, mutation);
    }
    db.exec("UPDATE source_instances SET payload_json = json_set(payload_json, '$.last_sync_at', '2026-10-11T00:00:00Z')");
    assert.equal((db.prepare("SELECT ready FROM resolved_read_index_state").get() as { ready: number }).ready, 1, "operator metadata alone does not invalidate links");
    db.exec("UPDATE resolved_read_index_state SET version = 'obsolete-decoration'");
    assert.equal(storage.listResolvedTurnsPage(0, 10).total, 1);
    assert.notEqual((db.prepare("SELECT version FROM resolved_read_index_state").get() as { version: string }).version, "obsolete-decoration");
  } finally {
    db.close(); storage.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("ready page body hydration holds one coherent snapshot against a concurrent writer", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cchistory-resolved-coherent-"));
  const storage = new CCHistoryStorage(root);
  const writer = new DatabaseSync(storage.dbPath);
  try {
    storage.replaceSourcePayload(createFixturePayload("src-coherent", "before write", "stage-coherent"));
    writer.exec("PRAGMA busy_timeout = 0");
    const readTurn = storage.getTurn.bind(storage);
    storage.getTurn = (id) => {
      assert.throws(() => writer.exec("UPDATE user_turns_v2 SET canonical_text_full = 'concurrent write'"), /locked|busy/i);
      return readTurn(id);
    };
    assert.equal(storage.listResolvedTurnsPage(0, 1).turns[0]?.canonical_text, "before write");
    storage.getTurn = readTurn;
    writer.exec("UPDATE user_turns_v2 SET canonical_text_full = 'after write'");
    assert.equal(storage.getResolvedTurn("turn-1")?.canonical_text, "after write");
  } finally {
    writer.close(); storage.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("resolved reads observe external and direct dependency writes and rebuild a missing index", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cchistory-resolved-dirty-"));
  const first = new CCHistoryStorage(root);
  const second = new CCHistoryStorage(root);
  try {
    first.replaceSourcePayload(createFixturePayload("src-dirty", "input", "stage-dirty", {
      turnId: "dirty-turn", sessionId: "dirty-session", includeProjectObservation: true,
    }));
    assert.equal(second.getResolvedTurn("dirty-turn")?.link_state, "candidate");
    first.upsertProjectOverride({ target_kind: "turn", target_ref: "dirty-turn", project_id: "override-project", display_name: "Override" });
    assert.equal(second.getResolvedTurn("dirty-turn")?.project_id, "override-project");
    assert.equal(second.listResolvedTurns()[0]?.project_id, "override-project");
    const db = new DatabaseSync(first.dbPath);
    try {
      db.prepare("UPDATE user_turns_v2 SET canonical_text_full = ?, sync_axis = ? WHERE turn_id = ?")
        .run("changed externally", "source_absent", "dirty-turn");
      const expected = new CCHistoryStorage(root);
      try {
        assert.deepEqual(second.listResolvedTurnsPage(0, 1).turns, expected.listResolvedTurns());
      } finally { expected.close(); }
      assert.equal(second.getResolvedTurn("dirty-turn")?.canonical_text, "changed externally");
      db.exec("DELETE FROM resolved_read_index_state");
      assert.equal(second.listResolvedTurnsPage(0, 1).total, 1);
    } finally { db.close(); }
  } finally {
    first.close(); second.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("resolved index preparation refuses incomplete V2 migration and missing fallback lineage", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cchistory-resolved-integrity-"));
  const storage = new CCHistoryStorage(root);
  const db = new DatabaseSync(storage.dbPath);
  try {
    db.exec("CREATE TABLE user_turns (id TEXT PRIMARY KEY)");
    db.prepare("INSERT INTO user_turns VALUES (?)").run("unmigrated-turn");
    assert.throws(() => storage.listResolvedTurnsPage(0, 1), /migration.*required|requires.*migration/i);
    db.exec("DROP TABLE user_turns");
    const payload = createFixturePayload("src-fallback-integrity", "fallback", "stage-fallback");
    storage.replaceSourcePayload(payload);
    const row = db.prepare("SELECT lineage_blob_sha256 FROM user_turns_v2").get() as { lineage_blob_sha256: string };
    const evidencePath = path.join(root, "evidence", "blobs", row.lineage_blob_sha256.slice(0, 2), row.lineage_blob_sha256);
    const bytes = await readFile(evidencePath);
    await rm(evidencePath);
    db.exec("DELETE FROM resolved_read_index_state");
    assert.throws(() => storage.listResolvedTurnsPage(0, 1), /lineage|evidence/i);
    await writeFile(evidencePath, Buffer.from("corrupt lineage"));
    assert.throws(() => storage.listResolvedTurnsPage(0, 1), /lineage|evidence/i);
    await writeFile(evidencePath, bytes);
    assert.equal(storage.listResolvedTurnsPage(0, 1).total, 1);
  } finally {
    db.close(); storage.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("ready selected reads reject missing lineage and same-connection project maps observe presentation writes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cchistory-resolved-ready-integrity-"));
  const storage = new CCHistoryStorage(root);
  const db = (storage as unknown as { db: DatabaseSync }).db;
  try {
    storage.replaceSourcePayload(createFixturePayload("src-ready", "ready", "stage-ready", { includeProjectObservation: true }));
    const internals = storage as unknown as { getProjectsById(): Map<string, { display_name: string }> };
    const projectId = storage.listProjects()[0]!.project_id;
    internals.getProjectsById();
    db.prepare("UPDATE project_current SET payload_json = json_set(payload_json, '$.display_name', 'Updated display') WHERE project_id = ?").run(projectId);
    assert.equal(internals.getProjectsById().get(projectId)?.display_name, "Updated display");
    assert.equal((db.prepare("SELECT ready FROM resolved_read_index_state").get() as { ready: number }).ready, 1);
    const row = db.prepare("SELECT lineage_blob_sha256 FROM user_turns_v2 WHERE turn_id = 'turn-1'").get() as { lineage_blob_sha256: string };
    const file = path.join(root, "evidence", "blobs", row.lineage_blob_sha256.slice(0, 2), row.lineage_blob_sha256);
    const bytes = await readFile(file);
    await rm(file);
    assert.throws(() => storage.getResolvedTurn("turn-1"), /lineage evidence unavailable/i);
    assert.throws(() => storage.listResolvedTurnsPage(0, 1), /lineage evidence unavailable/i);
    await writeFile(file, "corrupt after readiness");
    assert.throws(() => storage.getResolvedTurn("turn-1"), /lineage evidence unavailable/i);
    await writeFile(file, bytes);
    assert.equal(storage.getResolvedTurn("turn-1")?.canonical_text, "ready");
  } finally { storage.close(); await rm(root, { recursive: true, force: true }); }
});

test("legacy rows with matching IDs but unfilled full sidecars cannot publish a ready index", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cchistory-resolved-partial-backfill-"));
  const storage = new CCHistoryStorage(root);
  const db = (storage as unknown as { db: DatabaseSync }).db;
  try {
    storage.replaceSourcePayload(createFixturePayload("src-backfill", "complete input", "stage-backfill"));
    const before = storage.getTurn("turn-1")!;
    const originalLineageSha = (db.prepare("SELECT lineage_blob_sha256 FROM user_turns_v2 WHERE turn_id = 'turn-1'").get() as { lineage_blob_sha256: string }).lineage_blob_sha256;
    db.exec("CREATE TABLE user_turns (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL)");
    db.prepare("INSERT INTO user_turns VALUES (?, ?)").run(before.id, JSON.stringify(before));
    db.exec("UPDATE user_turns_v2 SET canonical_text_full = '', raw_text_full = '', user_messages_json = '[]', lineage_blob_sha256 = '', lineage_blob_count = 0");
    assert.throws(() => storage.listResolvedTurnsPage(0, 1), /migration required/i);
    assert.equal((db.prepare("SELECT ready FROM resolved_read_index_state").get() as { ready: number }).ready, 0);
    db.prepare("UPDATE user_turns_v2 SET canonical_text_full = ?, raw_text_full = ?, user_messages_json = ?").run(before.canonical_text, before.raw_text, JSON.stringify(before.user_messages));
    assert.throws(() => storage.listResolvedTurnsPage(0, 1), /migration required/i, "lineage backfill must also be complete");
    db.prepare("UPDATE user_turns_v2 SET lineage_blob_sha256 = ?, lineage_blob_count = ?").run(originalLineageSha, before.lineage.blob_refs.length);
    assert.equal(storage.listResolvedTurnsPage(0, 1).total, 1);
    db.exec("UPDATE user_turns SET payload_json = json_set(payload_json, '$.lineage.blob_refs[0]', 'same-count-different-blob')");
    assert.throws(() => storage.listResolvedTurnsPage(0, 1), /migration.*lineage/i, "same counts cannot hide stale full lineage refs");
    db.prepare("UPDATE user_turns SET payload_json = ?").run(JSON.stringify(before));
    assert.equal(storage.listResolvedTurnsPage(0, 1).total, 1);
  } finally { storage.close(); await rm(root, { recursive: true, force: true }); }
});

test("validated legacy handoff survives V2 replacement and purge without restoring dormant V1 authority", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cchistory-resolved-handoff-"));
  let storage = new CCHistoryStorage(root);
  try {
    const first = createFixturePayload("src-handoff", "first input", "stage-first");
    storage.replaceSourcePayload(first);
    const db = (storage as unknown as { db: DatabaseSync }).db;
    db.exec("CREATE TABLE user_turns (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL)");
    db.prepare("INSERT INTO user_turns VALUES (?, ?)").run("turn-1", JSON.stringify(storage.getTurn("turn-1")));
    // Replace is allowed to be the first operation that validates the handoff.
    storage.replaceSourcePayload(createFixturePayload("src-handoff", "new V2 input", "stage-second"));
    assert.equal(storage.getResolvedTurn("turn-1")?.canonical_text, "new V2 input");
    storage.close(); storage = new CCHistoryStorage(root);
    assert.equal(storage.getResolvedTurn("turn-1")?.canonical_text, "new V2 input");
    assert.equal(storage.purgeTurn("turn-1")?.object_kind, "turn");
    assert.equal(storage.listResolvedTurnsPage(0, 1).total, 0);
    const reopenedDb = (storage as unknown as { db: DatabaseSync }).db;
    reopenedDb.exec("UPDATE user_turns SET payload_json = json_set(payload_json, '$.canonical_text', 'old writer after purge')");
    assert.equal(storage.listResolvedTurnsPage(0, 1).total, 0, "a tombstone cannot be resurrected by dormant legacy rows");
  } finally { storage.close(); await rm(root, { recursive: true, force: true }); }
});

for (const incomplete of [false, true]) {
  test(`first streaming write validates legacy handoff atomically (incomplete=${incomplete})`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cchistory-stream-handoff-"));
    let storage = new CCHistoryStorage(root);
    try {
      const prior = createFixturePayload("src-stream-handoff", "prior input", "stage-prior");
      storage.replaceSourcePayload(prior);
      const db = storage.getDatabaseForMigration();
      db.exec("CREATE TABLE user_turns (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL)");
      db.prepare("INSERT INTO user_turns VALUES (?, ?)").run("turn-1", JSON.stringify(storage.getTurn("turn-1")));
      if (incomplete) db.exec("UPDATE user_turns SET payload_json = json_set(payload_json, '$.canonical_text', 'unmigrated input')");
      storage.close();
      storage = new CCHistoryStorage(root);
      const incoming = createFixturePayload("src-stream-handoff", "new streamed input", "stage-new");
      let consumed = false;
      const write = storage.mergeSourcePayloadStreaming(incoming.source, {
        chunks: (async function* () {
          consumed = true;
          yield { ...incoming, origin_path: incoming.blobs[0]!.origin_path };
        })(),
        preserve_origin_paths: new Set<string>(),
        observed_origin_paths: new Set([incoming.blobs[0]!.origin_path]),
      });
      if (incomplete) {
        await assert.rejects(write, /migration required/i);
        assert.equal(consumed, false, "reject before consuming or mutating incoming data");
        assert.equal(storage.getTurn("turn-1")?.canonical_text, "prior input");
        const currentDb = storage.getDatabaseForMigration();
        assert.equal(currentDb.isTransaction, false);
        currentDb.prepare("UPDATE user_turns SET payload_json = ?").run(JSON.stringify(storage.getTurn("turn-1")));
        assert.equal(storage.getResolvedTurn("turn-1")?.canonical_text, "prior input");
      } else {
        await write;
        assert.equal(storage.getResolvedTurn("turn-1")?.canonical_text, "new streamed input");
        storage.close();
        storage = new CCHistoryStorage(root);
        assert.equal(storage.listResolvedTurnsPage(0, 1).turns[0]?.canonical_text, "new streamed input");
      }
    } finally { storage.close(); await rm(root, { recursive: true, force: true }); }
  });
}

test("pre-upgrade writer invalidation and compatible backup restore survive the additive index upgrade", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cchistory-resolved-upgrade-"));
  const store = path.join(root, "store");
  let storage = new CCHistoryStorage(store);
  try {
    storage.replaceSourcePayload(createFixturePayload("src-upgrade", "upgrade input", "stage-upgrade"));
    const expected = storage.listResolvedTurns();
    storage.close();
    const old = new DatabaseSync(path.join(store, "cchistory.sqlite"));
    try {
      for (const row of old.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND (name LIKE 'invalidate_resolved_%' OR name LIKE 'invalidate_project_presentation_%')").all() as Array<{ name: string }>) {
        old.exec(`DROP TRIGGER ${row.name}`);
      }
      old.exec("DROP TABLE resolved_read_index_state; DROP TABLE resolved_turn_links; DROP TABLE resolved_session_links");
      old.exec("UPDATE schema_meta SET value_text = '2026-07-11.1' WHERE key = 'schema_version'");
      old.prepare("DELETE FROM schema_migrations WHERE id = ?").run("2026-10-11.1/resolved-read-index");
      old.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      await cp(store, path.join(root, "backup"), { recursive: true });
      const write = old.prepare("UPDATE user_turns_v2 SET canonical_text_full = ? WHERE turn_id = 'turn-1'");
      storage = new CCHistoryStorage(store);
      assert.deepEqual(storage.listResolvedTurnsPage(0, 1).turns, expected);
      write.run("pre-opened writer changed input");
      assert.equal(storage.getResolvedTurn("turn-1")?.canonical_text, "pre-opened writer changed input");
      storage.close();
    } finally { old.close(); }
    await cp(path.join(root, "backup"), path.join(root, "restored"), { recursive: true });
    storage = new CCHistoryStorage(path.join(root, "restored"));
    assert.deepEqual(storage.listResolvedTurnsPage(0, 1).turns, expected);
    assert.equal(storage.getSchemaInfo().schema_version, "2026-10-11.1");
  } finally { storage.close(); await rm(root, { recursive: true, force: true }); }
});
