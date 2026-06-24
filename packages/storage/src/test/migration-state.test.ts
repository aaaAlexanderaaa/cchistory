import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { CCHistoryStorage } from "../index.js";
import {
  clearMigrationState,
  isMigrationScopeCompleted,
  listMigrationStates,
  parseStaleRunningThreshold,
  readMigrationState,
  recordMigrationAbort,
  recordMigrationComplete,
  recordMigrationProgress,
  recordMigrationStart,
  type MigrationScope,
} from "../migration-state.js";

async function withStore(fn: (storage: CCHistoryStorage) => Promise<void>): Promise<void> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-migration-state-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    await fn(storage);
    storage.close();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

const STORE_SCOPE: MigrationScope = {
  phase: "storage-boundary.write",
  scopeKind: "store",
  scopeId: "default",
};

const SOURCE_SCOPE: MigrationScope = {
  phase: "storage-boundary.write",
  scopeKind: "source",
  scopeId: "src-1",
};

test("B.2: migration_state starts absent and round-trips through running → completed", async () => {
  await withStore(async (storage) => {
    const db = (storage as unknown as { db: import("node:sqlite").DatabaseSync }).db;

    assert.equal(readMigrationState(db, STORE_SCOPE), undefined);
    assert.equal(isMigrationScopeCompleted(db, STORE_SCOPE), false);

    recordMigrationStart(db, STORE_SCOPE);
    const running = readMigrationState(db, STORE_SCOPE)!;
    assert.equal(running.status, "running");
    assert.equal(running.cursor_json, "{}");
    assert.equal(running.completed_at, null);

    recordMigrationProgress(db, STORE_SCOPE, JSON.stringify({ last_chunk: 42 }));
    assert.deepEqual(
      JSON.parse(readMigrationState(db, STORE_SCOPE)!.cursor_json),
      { last_chunk: 42 },
    );

    recordMigrationComplete(db, STORE_SCOPE, { cursorJson: JSON.stringify({ last_chunk: 100 }) });
    const done = readMigrationState(db, STORE_SCOPE)!;
    assert.equal(done.status, "completed");
    assert.ok(done.completed_at);
    assert.equal(done.last_error, "");
    assert.equal(isMigrationScopeCompleted(db, STORE_SCOPE), true);
  });
});

test("B.2: recordMigrationStart refuses an already-running scope without clearing cursor_json", async () => {
  await withStore(async (storage) => {
    const db = (storage as unknown as { db: import("node:sqlite").DatabaseSync }).db;

    recordMigrationStart(db, SOURCE_SCOPE, { cursorJson: JSON.stringify({ chunk: 7 }) });
    assert.throws(
      () => recordMigrationStart(db, SOURCE_SCOPE),
      /already marked 'running'/,
      "a second direct start must not race a possibly live writer",
    );
    const stillRunning = readMigrationState(db, SOURCE_SCOPE)!;
    assert.deepEqual(JSON.parse(stillRunning.cursor_json), { chunk: 7 });
    assert.equal(stillRunning.status, "running");
  });
});

test("B.2: recordMigrationStart refuses to resurrect an aborted scope without explicit reset", async () => {
  await withStore(async (storage) => {
    const db = (storage as unknown as { db: import("node:sqlite").DatabaseSync }).db;

    recordMigrationStart(db, SOURCE_SCOPE);
    recordMigrationAbort(db, SOURCE_SCOPE, new Error("backfill source missing"));

    const aborted = readMigrationState(db, SOURCE_SCOPE)!;
    assert.equal(aborted.status, "aborted");
    assert.match(aborted.last_error, /backfill source missing/);

    assert.throws(
      () => recordMigrationStart(db, SOURCE_SCOPE),
      /previous run aborted/,
    );

    clearMigrationState(db, SOURCE_SCOPE);
    // After explicit reset, start succeeds.
    recordMigrationStart(db, SOURCE_SCOPE);
    assert.equal(readMigrationState(db, SOURCE_SCOPE)!.status, "running");
  });
});

test("B.2: listMigrationStates returns all rows for a phase in started_at order", async () => {
  await withStore(async (storage) => {
    const db = (storage as unknown as { db: import("node:sqlite").DatabaseSync }).db;

    recordMigrationStart(db, { phase: "storage-boundary.write", scopeKind: "source", scopeId: "src-1" });
    recordMigrationStart(db, { phase: "storage-boundary.write", scopeKind: "source", scopeId: "src-2" });
    recordMigrationStart(db, { phase: "storage-boundary.validate", scopeKind: "store", scopeId: "default" });

    const writes = listMigrationStates(db, "storage-boundary.write");
    assert.equal(writes.length, 2);
    assert.ok(writes.every((row) => row.phase === "storage-boundary.write"));

    const all = listMigrationStates(db);
    assert.equal(all.length, 3);
  });
});

test("B.2: each (phase, scope_kind, scope_id) tuple is unique across completed reruns", async () => {
  await withStore(async (storage) => {
    const db = (storage as unknown as { db: import("node:sqlite").DatabaseSync }).db;

    recordMigrationStart(db, SOURCE_SCOPE);
    recordMigrationComplete(db, SOURCE_SCOPE);
    // Same key after completion should UPSERT, not insert a duplicate.
    recordMigrationStart(db, SOURCE_SCOPE);
    const all = listMigrationStates(db);
    assert.equal(all.length, 1);
    assert.equal(all[0]!.status, "running");
  });
});

test("B.2: fresh store has the migration_state table after initialization", async () => {
  await withStore(async (storage) => {
    const db = (storage as unknown as { db: import("node:sqlite").DatabaseSync }).db;
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_state'")
      .get() as { name: string } | undefined;
    assert.ok(row, "migration_state table must exist after schema init");
    // No rows in a fresh store.
    assert.equal(listMigrationStates(db).length, 0);
  });
});

test("C2/I4: parseStaleRunningThreshold accepts non-negative numbers and rejects garbage", () => {
  // Default when unset.
  assert.equal(parseStaleRunningThreshold(undefined), 30 * 60 * 1000);
  assert.equal(parseStaleRunningThreshold(""), 30 * 60 * 1000);
  // Explicit values.
  assert.equal(parseStaleRunningThreshold("0"), 0);
  assert.equal(parseStaleRunningThreshold("60000"), 60_000);
  assert.equal(parseStaleRunningThreshold("1.5"), 1); // floor; reject fractional silently
  assert.equal(parseStaleRunningThreshold("  120000  "), 120_000); // trim whitespace
  // Reject negatives — I4 regression: previously `Number.parseInt("-1") || DEFAULT`
  // returned -1 (truthy), making every running marker stale.
  assert.throws(() => parseStaleRunningThreshold("-1"), /invalid/i);
  assert.throws(() => parseStaleRunningThreshold("abc"), /invalid/i);
  assert.throws(() => parseStaleRunningThreshold("Infinity"), /invalid/i);
  assert.throws(() => parseStaleRunningThreshold("NaN"), /invalid/i);
});

test("C2/I4: recordMigrationStart treats unparseable started_at as stale (fail-closed)", async () => {
  await withStore(async (storage) => {
    const db = (storage as unknown as { db: import("node:sqlite").DatabaseSync }).db;
    // Seed a running marker with garbage started_at — simulates a corrupted
    // row from a partial write or schema drift.
    recordMigrationStart(db, SOURCE_SCOPE);
    db.prepare("UPDATE migration_state SET started_at = ? WHERE phase = ? AND scope_kind = ? AND scope_id = ?")
      .run("not-a-timestamp", SOURCE_SCOPE.phase, SOURCE_SCOPE.scopeKind, SOURCE_SCOPE.scopeId);

    // I4 fix: previously `Number.isFinite(startedMs)` returned false and the
    // guard was silently skipped — the running marker resurrected, exactly
    // the failure mode C2 was designed to prevent. Now unparseable → stale.
    assert.throws(
      () => recordMigrationStart(db, SOURCE_SCOPE),
      /already marked 'running'(.*)unparseable/s,
    );
  });
});

test("C2: recordMigrationStart refuses resurrection of a stale running marker", async () => {
  await withStore(async (storage) => {
    const db = (storage as unknown as { db: import("node:sqlite").DatabaseSync }).db;
    recordMigrationStart(db, SOURCE_SCOPE);
    // Move started_at back past the 30-min default threshold.
    const stale = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    db.prepare("UPDATE migration_state SET started_at = ? WHERE phase = ? AND scope_kind = ? AND scope_id = ?")
      .run(stale, SOURCE_SCOPE.phase, SOURCE_SCOPE.scopeKind, SOURCE_SCOPE.scopeId);

    assert.throws(
      () => recordMigrationStart(db, SOURCE_SCOPE),
      /older than 30000ms|older than \d+ms/,
    );

    // After explicit clear, start succeeds.
    clearMigrationState(db, SOURCE_SCOPE);
    recordMigrationStart(db, SOURCE_SCOPE);
    assert.equal(readMigrationState(db, SOURCE_SCOPE)!.status, "running");
  });
});
