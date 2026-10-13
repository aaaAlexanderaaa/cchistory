import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, appendFile, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { CCHistoryStorage } from "@cchistory/storage";
import { getDefaultSourcesForHost, runSourceProbe } from "@cchistory/source-adapters";
import { fileExists, runCliCapture } from "./helpers.js";

test("live Full turn detail reads native input without creating an evidence archive", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cchistory-full-turn-read-"));
  const originalHomedir = os.homedir;
  try {
    os.homedir = () => root;
    const sourceRoot = path.join(root, ".claude", "projects", "live");
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(path.join(sourceRoot, "session.jsonl"), `${JSON.stringify({
      type: "user", uuid: "live-user", sessionId: "live-session", cwd: "/workspace/live",
      timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: "live Full detail prompt" },
    })}\n`);
    const source = getDefaultSourcesForHost({ includeMissing: true }).find((entry) => entry.slot_id === "claude_code");
    assert.ok(source);
    const probe = await runSourceProbe({}, [source]);
    const turn = probe.sources[0]?.turns[0];
    assert.ok(turn);
    const store = path.join(root, "store");
    const result = await runCliCapture(["show", "turn", turn.id, "--full", "--source", "claude_code", "--store", store], root);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /live Full detail prompt/);
    assert.equal(await fileExists(store), false, "live reads must not create a durable store");
  } finally {
    os.homedir = originalHomedir;
    await rm(root, { recursive: true, force: true });
  }
});

test("stable mixed-source files use thin reuse without rewriting retained rows; changed files still append", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cchistory-thin-reuse-"));
  const originalHomedir = os.homedir;
  const originalLoad = CCHistoryStorage.prototype.getSourceIncrementalPayloadForOriginPaths;
  const loadedPaths: string[][] = [];
  try {
    os.homedir = () => root;
    const sourceRoot = path.join(root, ".claude", "projects", "-workspace-reuse");
    await mkdir(sourceRoot, { recursive: true });
    const files = [path.join(sourceRoot, "stable.jsonl"), path.join(sourceRoot, "changing.jsonl")];
    for (const [i, file] of files.entries()) {
      await writeFile(file, `${JSON.stringify({ type: "user", uuid: `user-${i}`, sessionId: `reuse-${i}`,
        timestamp: "2026-01-01T00:00:00Z", cwd: "/workspace/reuse",
        message: { role: "user", content: `original prompt ${i}` } })}\n`);
    }
    const store = path.join(root, "store");
    assert.equal((await runCliCapture(["sync", "--source", "claude_code", "--store", store], root)).exitCode, 0);
    const db = new DatabaseSync(path.join(store, "cchistory.sqlite"));
    try {
      db.exec("CREATE TABLE test_content_writes (table_name TEXT)");
      for (const table of ["raw_records", "source_fragments", "conversation_atoms", "user_turns_v2", "turn_context_refs_v2"]) {
        db.exec(`CREATE TRIGGER test_write_${table} AFTER INSERT ON ${table} BEGIN INSERT INTO test_content_writes VALUES ('${table}'); END`);
      }
      CCHistoryStorage.prototype.getSourceIncrementalPayloadForOriginPaths = function(sourceId, paths) {
        loadedPaths.push([...paths]);
        return originalLoad.call(this, sourceId, paths);
      };
      const second = await runCliCapture(["sync", "--source", "claude_code", "--store", store, "--detail"], root);
      assert.equal(second.exitCode, 0, second.stderr);
      assert.deepEqual(loadedPaths, [], "stable files must not load old parser bodies");
      assert.equal((db.prepare("SELECT COUNT(*) AS n FROM test_content_writes").get() as { n: number }).n, 0);
      await appendFile(files[1]!, `${JSON.stringify({ type: "user", uuid: "appended", sessionId: "reuse-1",
        timestamp: "2026-01-01T00:00:02Z", cwd: "/workspace/reuse", message: { role: "user", content: "new appended prompt" } })}\n`);
      const third = await runCliCapture(["sync", "--source", "claude_code", "--store", store], root);
      assert.equal(third.exitCode, 0, third.stderr);
      assert.deepEqual(loadedPaths, [[files[1]!]], "only changed origins need heavy append inputs");
      const storage = new CCHistoryStorage(store);
      try {
        assert.equal(storage.searchTurns({ query: "original prompt", limit: 10 }).length, 2);
        assert.equal(storage.searchTurns({ query: "new appended prompt" }).length, 1);
      } finally { storage.close(); }
    } finally { db.close(); }
  } finally {
    os.homedir = originalHomedir;
    CCHistoryStorage.prototype.getSourceIncrementalPayloadForOriginPaths = originalLoad;
    await rm(root, { recursive: true, force: true });
  }
});

test("unchanged source health follows current reused sessions rather than retained absent sessions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cchistory-reuse-health-"));
  const originalHomedir = os.homedir;
  try {
    os.homedir = () => root;
    const sourceRoot = path.join(root, ".claude", "projects", "health");
    await mkdir(sourceRoot, { recursive: true });
    const userFile = path.join(sourceRoot, "user.jsonl");
    await writeFile(userFile, JSON.stringify({
      type: "user", uuid: "health-user", sessionId: "health-session", cwd: "/workspace/health",
      timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: "health prompt" },
    }) + "\n");
    await writeFile(path.join(sourceRoot, "empty.jsonl"), "");
    const store = path.join(root, "store");
    const sync = async (expectedHealth: string) => {
      const result = await runCliCapture(["sync", "--source", "claude_code", "--store", store, "--detail"], root);
      assert.equal(result.exitCode, 0, result.stderr);
      const storage = new CCHistoryStorage(store);
      try {
        assert.equal(storage.listSources()[0]?.sync_status, expectedHealth);
        assert.equal(storage.listResolvedTurns().length, 1, "health updates preserve retained history");
      } finally { storage.close(); }
    };
    await sync("healthy");
    await sync("healthy");
    await rm(userFile);
    await sync("stale");
  } finally { os.homedir = originalHomedir; await rm(root, { recursive: true, force: true }); }
});

for (const scenario of [
  { name: "one recent batch", emptyBatch: false, change: false },
  { name: "multiple reused batches ending in an empty file", emptyBatch: true, change: false },
  { name: "changed batch followed by a reused empty file", emptyBatch: true, change: true },
]) test(`Codex metadata sync preserves current session health (${scenario.name})`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cchistory-codex-reuse-health-"));
  const originalHomedir = os.homedir;
  const originalBatchBytes = process.env.CCHISTORY_CODEX_SYNC_BATCH_TARGET_BYTES;
  try {
    os.homedir = () => root;
    process.env.CCHISTORY_CODEX_SYNC_BATCH_TARGET_BYTES = "1";
    const sourceRoot = path.join(root, ".codex", "sessions");
    await mkdir(sourceRoot, { recursive: true });
    const userFile = path.join(sourceRoot, "rollout-a-user.jsonl");
    const userLine = (text: string, second: number) => JSON.stringify({
      type: "response_item", timestamp: `2026-01-01T00:00:0${second}Z`,
      payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
    }) + "\n";
    await writeFile(userFile, JSON.stringify({ type: "session_meta", timestamp: "2026-01-01T00:00:00Z",
      payload: { id: "health-session", cwd: "/workspace/health" } }) + "\n" + userLine("health prompt", 1) +
      JSON.stringify({ type: "response_item", timestamp: "2026-01-01T00:00:02Z", payload: {
        type: "message", role: "assistant", content: [{ type: "output_text", text: "health reply" }],
      } }) + "\n");
    if (scenario.emptyBatch) await writeFile(path.join(sourceRoot, "rollout-z-empty.jsonl"), "");
    const store = path.join(root, "store");
    const sync = async (expectedHealth: string, turnCount: number, flags: string[] = []) => {
      const result = await runCliCapture(["sync", "--source", "codex", "--store", store, ...flags], root);
      assert.equal(result.exitCode, 0, result.stderr);
      const storage = new CCHistoryStorage(store);
      try {
        assert.equal(storage.listSources()[0]?.sync_status, expectedHealth);
        assert.equal(storage.listResolvedTurns().length, turnCount, "health must preserve retained history");
      } finally { storage.close(); }
    };
    await sync("healthy", 1);
    if (scenario.change) await appendFile(userFile, userLine("appended health prompt", 3));
    const turns = scenario.change ? 2 : 1;
    await sync("healthy", turns);
    await sync("healthy", turns, ["--force-full-resync"]);
    // A retained absent session cannot make an empty current inventory healthy.
    await rm(userFile);
    await sync("stale", turns);
  } finally {
    os.homedir = originalHomedir;
    if (originalBatchBytes === undefined) delete process.env.CCHISTORY_CODEX_SYNC_BATCH_TARGET_BYTES;
    else process.env.CCHISTORY_CODEX_SYNC_BATCH_TARGET_BYTES = originalBatchBytes;
    await rm(root, { recursive: true, force: true });
  }
});

test("stable Codex files with an obsolete parser profile persist reparsed evidence rather than metadata only", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cchistory-reuse-profile-"));
  const originalHomedir = os.homedir;
  const originalMetadataWrite = CCHistoryStorage.prototype.updateSourceSyncMetadata;
  try {
    os.homedir = () => root;
    const sourceRoot = path.join(root, ".codex", "sessions");
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(path.join(sourceRoot, "rollout-profile.jsonl"), [
      { type: "session_meta", timestamp: "2026-01-01T00:00:00Z", payload: { id: "profile-session", cwd: "/workspace/profile" } },
      { type: "response_item", timestamp: "2026-01-01T00:00:01Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "profile prompt" }] } },
    ].map((item) => JSON.stringify(item)).join("\n") + "\n");
    await utimes(path.join(sourceRoot, "rollout-profile.jsonl"), new Date("2020-01-01"), new Date("2020-01-01"));
    const store = path.join(root, "store");
    assert.equal((await runCliCapture(["sync", "--source", "codex", "--store", store], root)).exitCode, 0);
    const db = new DatabaseSync(path.join(store, "cchistory.sqlite"));
    try {
      db.exec("UPDATE stage_runs SET payload_json = json_set(payload_json, '$.parser_version', 'obsolete')");
    } finally { db.close(); }
    CCHistoryStorage.prototype.updateSourceSyncMetadata = function(payload, options) {
      assert.equal(payload.records.length, 0, "metadata write cannot discard newly parsed records");
      assert.equal(payload.turns.length, 0, "metadata write cannot discard new turns");
      return originalMetadataWrite.call(this, payload, options);
    };
    const result = await runCliCapture(["sync", "--source", "codex", "--store", store, "--since", "1h"], root);
    assert.equal(result.exitCode, 0, result.stderr);
    const storage = new CCHistoryStorage(store);
    try { assert.equal(storage.searchTurns({ query: "profile prompt" }).length, 1); }
    finally { storage.close(); }
  } finally {
    os.homedir = originalHomedir;
    CCHistoryStorage.prototype.updateSourceSyncMetadata = originalMetadataWrite;
    await rm(root, { recursive: true, force: true });
  }
});

test("new and rewritten origins joining an existing session retain every available contributor", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cchistory-shared-reuse-"));
  const originalHomedir = os.homedir;
  try {
    os.homedir = () => root;
    const sourceRoot = path.join(root, ".claude", "projects", "shared");
    await mkdir(sourceRoot, { recursive: true });
    const line = (sessionId: string, uuid: string, text: string, type = "user") => JSON.stringify({
      type, uuid, sessionId, cwd: "/workspace/shared", timestamp: `2026-01-01T00:00:0${uuid === "parent" ? 0 : 2}Z`,
      message: { role: type, content: text },
    }) + "\n";
    const parent = path.join(sourceRoot, "parent.jsonl");
    const other = path.join(sourceRoot, "other.jsonl");
    await writeFile(parent, line("shared", "parent", "retained parent prompt"));
    await writeFile(other, line("independent", "other", "old independent prompt"));
    const store = path.join(root, "store");
    const sync = async () => {
      const result = await runCliCapture(["sync", "--source", "claude_code", "--store", store], root);
      assert.equal(result.exitCode, 0, result.stderr);
    };
    await sync();
    await writeFile(path.join(sourceRoot, "new-child.jsonl"), line("shared", "child", "joined assistant response", "assistant"));
    await sync();
    let storage = new CCHistoryStorage(store);
    try {
      assert.equal(storage.searchTurns({ query: "retained parent prompt" }).length, 1);
      assert.equal(storage.listResolvedTurns().length, 2);
    } finally { storage.close(); }
    await writeFile(other, line("shared", "rewritten", "new shared prompt"));
    await sync();
    storage = new CCHistoryStorage(store);
    try {
      assert.equal(storage.searchTurns({ query: "retained parent prompt" }).length, 1);
      assert.equal(storage.searchTurns({ query: "new shared prompt" }).length, 1);
      assert.equal(storage.searchTurns({ query: "old independent prompt" }).length, 0);
    } finally { storage.close(); }
  } finally {
    os.homedir = originalHomedir;
    await rm(root, { recursive: true, force: true });
  }
});

for (const scenario of [
  { name: "complete", thin: false, limited: false, absent: false, obsolete: false },
  { name: "thin complete", thin: true, limited: false, absent: false, obsolete: false },
  { name: "partial", thin: false, limited: true, absent: false, obsolete: false },
  { name: "obsolete partial", thin: true, limited: true, absent: false, obsolete: true },
  { name: "absent sibling", thin: false, limited: false, absent: true, obsolete: false },
  { name: "obsolete absent sibling", thin: true, limited: false, absent: true, obsolete: true },
]) test(`an origin leaving a shared session preserves its former sibling (${scenario.name})`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cchistory-session-move-"));
  const originalHomedir = os.homedir;
  const originalThreshold = process.env.CCHISTORY_MINIMAL_PRELOAD_BLOB_THRESHOLD;
  try {
    os.homedir = () => root;
    if (scenario.thin) process.env.CCHISTORY_MINIMAL_PRELOAD_BLOB_THRESHOLD = "0";
    const sourceRoot = path.join(root, ".claude", "projects", "shared");
    await mkdir(sourceRoot, { recursive: true });
    const changed = path.join(sourceRoot, "changed.jsonl");
    const sibling = path.join(sourceRoot, "sibling.jsonl");
    const line = (sessionId: string, uuid: string, text: string) => JSON.stringify({
      type: "user", uuid, sessionId, cwd: "/workspace/shared",
      timestamp: uuid === "changed" ? "2026-01-01T00:00:00Z" : "2026-01-01T00:00:02Z",
      message: { role: "user", content: text },
    }) + "\n";
    await writeFile(changed, line("old-session", "changed", "former contributor prompt"));
    await writeFile(sibling, line("old-session", "sibling", "retained sibling prompt"));
    await utimes(sibling, new Date("2020-01-01"), new Date("2020-01-01"));
    const store = path.join(root, "store");
    const sync = (extra: string[] = []) => runCliCapture(["sync", "--source", "claude_code", "--store", store, ...extra], root);
    const first = await sync();
    assert.equal(first.exitCode, 0, first.stderr);
    if (scenario.obsolete) {
      const db = new DatabaseSync(path.join(store, "cchistory.sqlite"));
      try { db.exec("UPDATE stage_runs SET payload_json = json_set(payload_json, '$.parser_version', 'obsolete-profile')"); }
      finally { db.close(); }
    }
    if (scenario.absent) await rm(sibling);
    await writeFile(changed, line("new-session", "replacement", "replacement session prompt"));
    const attempt = await sync(scenario.limited ? ["--limit-files", "1"] : []);
    assert.equal(attempt.exitCode, 0, attempt.stderr);
    const blocked = scenario.limited || (scenario.absent && scenario.obsolete);
    let storage = new CCHistoryStorage(store);
    try {
      assert.equal(storage.searchTurns({ query: "retained sibling prompt" }).length, 1);
      assert.equal(storage.searchTurns({ query: "replacement session prompt" }).length, blocked ? 0 : 1);
      assert.equal(storage.searchTurns({ query: "former contributor prompt" }).length, blocked ? 1 : 0);
      assert.equal(storage.listSources()[0]?.sync_status, blocked ? "error" : "healthy");
      const payload = storage.getSourcePayload(storage.listSources()[0]!.id)!;
      const siblingBlobIds = new Set(payload.blobs.filter((blob) => blob.origin_path === sibling).map((blob) => blob.id));
      assert.ok(payload.records.some((record) => siblingBlobIds.has(record.blob_id)), "the sibling's parser rows survive");
      assert.equal(payload.sessions.some((session) => session.id === "sess:claude_code:new-session"), !blocked);
      assert.equal(payload.turns.some((turn) => turn.canonical_text.includes("replacement session prompt")), !blocked,
        "a vetoed origin cannot publish a turn under a different session ID");
      assert.ok(payload.contexts.every((context) => payload.turns.some((turn) => turn.id === context.turn_id)),
        "a vetoed origin cannot publish an orphan context");
    } finally { storage.close(); }
    if (blocked) {
      if (scenario.absent) await writeFile(sibling, line("old-session", "sibling", "retained sibling prompt"));
      const recovered = await sync(["--force-full-resync"]);
      assert.equal(recovered.exitCode, 0, recovered.stderr);
      storage = new CCHistoryStorage(store);
      try {
        assert.equal(storage.searchTurns({ query: "retained sibling prompt" }).length, 1);
        assert.equal(storage.searchTurns({ query: "replacement session prompt" }).length, 1);
        assert.equal(storage.searchTurns({ query: "former contributor prompt" }).length, 0);
        assert.equal(storage.listSources()[0]?.sync_status, "healthy");
      } finally { storage.close(); }
    }
  } finally {
    os.homedir = originalHomedir;
    if (originalThreshold === undefined) delete process.env.CCHISTORY_MINIMAL_PRELOAD_BLOB_THRESHOLD;
    else process.env.CCHISTORY_MINIMAL_PRELOAD_BLOB_THRESHOLD = originalThreshold;
    await rm(root, { recursive: true, force: true });
  }
});

for (const obsoleteProfile of [false, true]) test(`limited shared-session scans preserve unvisited input and recover on full scan (obsolete profile=${obsoleteProfile})`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cchistory-partial-shared-"));
  const originalHomedir = os.homedir;
  try {
    os.homedir = () => root;
    const sourceRoot = path.join(root, ".claude", "projects", "shared");
    await mkdir(sourceRoot, { recursive: true });
    const parent = path.join(sourceRoot, "z-parent.jsonl");
    const child = path.join(sourceRoot, "a-child.jsonl");
    const line = (uuid: string, type: string, text: string) => JSON.stringify({ uuid, type, sessionId: "shared-limited",
      cwd: "/workspace/shared", timestamp: `2026-01-01T00:00:0${uuid === "parent" ? 0 : 2}Z`, message: { role: type, content: text } }) + "\n";
    await writeFile(parent, line("parent", "user", "unvisited sibling prompt"));
    await writeFile(child, line("child", "assistant", "old response"));
    const store = path.join(root, "store");
    assert.equal((await runCliCapture(["sync", "--source", "claude_code", "--store", store], root)).exitCode, 0);
    await utimes(parent, new Date("2020-01-01"), new Date("2020-01-01"));
    if (obsoleteProfile) {
      const db = new DatabaseSync(path.join(store, "cchistory.sqlite"));
      try { db.exec("UPDATE stage_runs SET payload_json = json_set(payload_json, '$.parser_version', 'obsolete-profile')"); }
      finally { db.close(); }
    }
    await writeFile(child, line("new-child", "user", "selected child prompt"));
    const result = await runCliCapture(["sync", "--source", "claude_code", "--store", store, "--limit-files", "1", "--detail"], root);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stderr, /a-child\.jsonl/);
    assert.match(result.stderr, /last coherent projection/);
    const storage = new CCHistoryStorage(store);
    try {
      assert.equal(storage.searchTurns({ query: "unvisited sibling prompt" }).length, 1);
      assert.equal(storage.searchTurns({ query: "selected child prompt" }).length, 0, "partial shared interpretation retains the last coherent projection");
      const payload = storage.getSourcePayload(storage.listSources()[0]!.id)!;
      const parentBlobIds = new Set(payload.blobs.filter((blob) => blob.origin_path === parent).map((blob) => blob.id));
      assert.ok(payload.records.some((record) => parentBlobIds.has(record.blob_id)), "unvisited parser input rows remain live");
    } finally { storage.close(); }
    const retry = await runCliCapture(["sync", "--source", "claude_code", "--store", store, "--force-full-resync"], root);
    assert.equal(retry.exitCode, 0, retry.stderr);
    const recovered = new CCHistoryStorage(store);
    try {
      assert.equal(recovered.searchTurns({ query: "unvisited sibling prompt" }).length, 1);
      assert.equal(recovered.searchTurns({ query: "selected child prompt" }).length, 1);
    } finally { recovered.close(); }
  } finally { os.homedir = originalHomedir; await rm(root, { recursive: true, force: true }); }
});

test("complete inventory with an absent shared sibling still accepts current-origin updates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cchistory-absent-shared-"));
  const originalHomedir = os.homedir;
  try {
    os.homedir = () => root;
    const sourceRoot = path.join(root, ".claude", "projects", "shared");
    await mkdir(sourceRoot, { recursive: true });
    const parent = path.join(sourceRoot, "parent.jsonl");
    const child = path.join(sourceRoot, "child.jsonl");
    const line = (uuid: string, type: string, text: string) => JSON.stringify({ uuid, type, sessionId: "shared-absent",
      cwd: "/workspace/shared", timestamp: `2026-01-01T00:00:0${uuid === "parent" ? 0 : 2}Z`, message: { role: type, content: text } }) + "\n";
    await writeFile(parent, line("parent", "user", "retained absent prompt"));
    await writeFile(child, line("child", "assistant", "old current response"));
    const store = path.join(root, "store");
    assert.equal((await runCliCapture(["sync", "--source", "claude_code", "--store", store], root)).exitCode, 0);
    await rm(parent);
    await writeFile(child, line("new-child", "user", "current origin new prompt"));
    const result = await runCliCapture(["sync", "--source", "claude_code", "--store", store], root);
    assert.equal(result.exitCode, 0, result.stderr);
    const storage = new CCHistoryStorage(store);
    try {
      assert.equal(storage.searchTurns({ query: "current origin new prompt" }).length, 1);
      assert.equal(storage.searchTurns({ query: "retained absent prompt" }).length, 1, "the coherent turn retains absent contributor input");
      const db = new DatabaseSync(storage.dbPath);
      try {
        assert.equal((db.prepare("SELECT sync_axis FROM source_file_ledger WHERE origin_path = ?").get(parent) as { sync_axis: string }).sync_axis, "source_absent");
        assert.ok(db.prepare("SELECT 1 FROM evidence_captures WHERE origin_path = ?").get(parent));
      } finally { db.close(); }
    } finally { storage.close(); }
    const staleDb = new DatabaseSync(path.join(store, "cchistory.sqlite"));
    try { staleDb.exec("UPDATE stage_runs SET payload_json = json_set(payload_json, '$.parser_version', 'obsolete-profile')"); }
    finally { staleDb.close(); }
    await writeFile(child, line("obsolete-child", "user", "requires changed-profile replay"));
    const blocked = await runCliCapture(["sync", "--source", "claude_code", "--store", store, "--detail"], root);
    assert.match(blocked.stderr, /last coherent projection.*requires replay/);
    const retained = new CCHistoryStorage(store);
    try {
      assert.equal(retained.listSources()[0]?.sync_status, "error");
      assert.equal(retained.searchTurns({ query: "current origin new prompt" }).length, 1);
      assert.equal(retained.searchTurns({ query: "requires changed-profile replay" }).length, 0);
    } finally { retained.close(); }
    for (const changed of [false, true]) {
      if (changed) await writeFile(child, line("obsolete-child-retry", "user", "requires changed-profile replay again"));
      const retry = await runCliCapture(["sync", "--source", "claude_code", "--store", store, "--detail"], root);
      assert.match(retry.stderr, /last coherent projection.*requires replay/);
      const reopened = new CCHistoryStorage(store);
      try {
        assert.equal(reopened.listSources()[0]?.sync_status, "error");
        assert.equal(reopened.searchTurns({ query: "current origin new prompt" }).length, 1);
        assert.equal(reopened.searchTurns({ query: "requires changed-profile replay" }).length, 0,
          "reopening/retrying an unapplied attempt cannot certify obsolete retained inputs");
      } finally { reopened.close(); }
    }
    const unrelated = path.join(sourceRoot, "00-independent.jsonl");
    await writeFile(unrelated, JSON.stringify({ type: "user", uuid: "independent-new", sessionId: "independent-session",
      cwd: "/workspace/independent", timestamp: "2026-01-01T00:00:03Z", message: { role: "user", content: "independent valid input" } }) + "\n");
    await utimes(unrelated, new Date("2099-01-01"), new Date("2099-01-01"));
    const partialOther = await runCliCapture(["sync", "--source", "claude_code", "--store", store, "--limit-files", "1", "--detail"], root);
    assert.match(partialOther.stderr, /00-independent\.jsonl/);
    assert.match(partialOther.stderr, /last coherent projection.*requires replay/);
    const afterOther = await runCliCapture(["sync", "--source", "claude_code", "--store", store, "--detail"], root);
    assert.match(afterOther.stderr, /last coherent projection.*requires replay/);
    const stillBlocked = new CCHistoryStorage(store);
    try {
      assert.equal(stillBlocked.listSources()[0]?.sync_status, "error");
      assert.equal(stillBlocked.searchTurns({ query: "requires changed-profile replay" }).length, 0,
        "an independent successful partial scan cannot certify the pending shared interpretation");
    } finally { stillBlocked.close(); }
    await writeFile(parent, line("parent", "user", "retained absent prompt"));
    const recovered = await runCliCapture(["sync", "--source", "claude_code", "--store", store, "--force-full-resync"], root);
    assert.equal(recovered.exitCode, 0, recovered.stderr);
    const restored = new CCHistoryStorage(store);
    try {
      assert.equal(restored.listSources()[0]?.sync_status, "healthy");
      assert.equal(restored.searchTurns({ query: "retained absent prompt" }).length, 1);
      assert.equal(restored.searchTurns({ query: "requires changed-profile replay again" }).length, 1);
    } finally { restored.close(); }
  } finally { os.homedir = originalHomedir; await rm(root, { recursive: true, force: true }); }
});

test("a mixed successful and failed parse cannot certify retained obsolete interpretation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cchistory-mixed-profile-failure-"));
  const originalHomedir = os.homedir;
  try {
    os.homedir = () => root;
    const sourceRoot = path.join(root, ".claude", "projects", "mixed");
    await mkdir(sourceRoot, { recursive: true });
    const first = path.join(sourceRoot, "first.jsonl"), second = path.join(sourceRoot, "second.jsonl");
    const line = (id: string, text: string) => JSON.stringify({ type: "user", uuid: id, sessionId: id,
      cwd: "/workspace/mixed", timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: text } }) + "\n";
    await writeFile(first, line("first", "old first input"));
    await writeFile(second, line("second", "retained second input"));
    const store = path.join(root, "store");
    assert.equal((await runCliCapture(["sync", "--source", "claude_code", "--store", store], root)).exitCode, 0);
    const db = new DatabaseSync(path.join(store, "cchistory.sqlite"));
    try { db.exec("UPDATE stage_runs SET payload_json = json_set(payload_json, '$.parser_version', 'obsolete-profile')"); }
    finally { db.close(); }
    await writeFile(first, line("first", "new first input"));
    await writeFile(second, "{invalid-json\n");
    const result = await runCliCapture(["sync", "--source", "claude_code", "--store", store], root);
    assert.equal(result.exitCode, 0, result.stderr);
    const storage = new CCHistoryStorage(store);
    try {
      const metadata = storage.getSourceIncrementalMetadataPayload(storage.listSources()[0]!.id)!;
      assert.ok(metadata.stage_runs.every((stage) => stage.parser_version === "obsolete-profile"));
      assert.equal(storage.searchTurns({ query: "retained second input" }).length, 1);
      assert.equal(storage.searchTurns({ query: "new first input" }).length, 1);
    } finally { storage.close(); }
    await writeFile(second, line("second", "repaired second input"));
    assert.equal((await runCliCapture(["sync", "--source", "claude_code", "--store", store], root)).exitCode, 0);
    const recovered = new CCHistoryStorage(store);
    try {
      assert.ok(recovered.getSourceIncrementalMetadataPayload(recovered.listSources()[0]!.id)!.stage_runs.every((stage) => stage.parser_version !== "obsolete-profile"));
      assert.equal(recovered.searchTurns({ query: "repaired second input" }).length, 1);
    } finally { recovered.close(); }
  } finally { os.homedir = originalHomedir; await rm(root, { recursive: true, force: true }); }
});

test("high-roster stat changes with unchanged checksums never preload old parser bodies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cchistory-roster-fallback-"));
  const originalHomedir = os.homedir;
  const originalThreshold = process.env.CCHISTORY_MINIMAL_PRELOAD_BLOB_THRESHOLD;
  const originalLoad = CCHistoryStorage.prototype.getSourceIncrementalPayloadForOriginPaths;
  try {
    os.homedir = () => root;
    process.env.CCHISTORY_MINIMAL_PRELOAD_BLOB_THRESHOLD = "1";
    const sourceRoot = path.join(root, ".claude", "projects", "roster");
    await mkdir(sourceRoot, { recursive: true });
    const files = [path.join(sourceRoot, "first.jsonl"), path.join(sourceRoot, "second.jsonl")];
    for (const [i, file] of files.entries()) {
      await writeFile(file, JSON.stringify({ type: "user", uuid: `roster-${i}`, sessionId: `independent-${i}`,
        timestamp: "2026-01-01T00:00:00Z", cwd: "/workspace/roster", message: { role: "user", content: `roster prompt ${i}` } }) + "\n");
    }
    const store = path.join(root, "store");
    assert.equal((await runCliCapture(["sync", "--source", "claude_code", "--store", store], root)).exitCode, 0);
    for (const file of files) await utimes(file, new Date("2020-01-01"), new Date("2020-01-01"));
    CCHistoryStorage.prototype.getSourceIncrementalPayloadForOriginPaths = () => { throw new Error("old parser preload exceeds high-roster budget"); };
    const result = await runCliCapture(["sync", "--source", "claude_code", "--store", store], root);
    assert.equal(result.exitCode, 0, result.stderr);
    const storage = new CCHistoryStorage(store);
    try { assert.equal(storage.searchTurns({ query: "roster prompt", limit: 10 }).length, 2); }
    finally { storage.close(); }
  } finally {
    os.homedir = originalHomedir;
    if (originalThreshold === undefined) delete process.env.CCHISTORY_MINIMAL_PRELOAD_BLOB_THRESHOLD;
    else process.env.CCHISTORY_MINIMAL_PRELOAD_BLOB_THRESHOLD = originalThreshold;
    CCHistoryStorage.prototype.getSourceIncrementalPayloadForOriginPaths = originalLoad;
    await rm(root, { recursive: true, force: true });
  }
});
