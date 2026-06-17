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

test("B.2: recordMigrationStart preserves cursor_json from a previous running row", async () => {
  await withStore(async (storage) => {
    const db = (storage as unknown as { db: import("node:sqlite").DatabaseSync }).db;

    recordMigrationStart(db, SOURCE_SCOPE, { cursorJson: JSON.stringify({ chunk: 7 }) });
    // Simulate a crash mid-batch: row stays at running with the cursor.
    // Next open picks up where it left off.
    recordMigrationStart(db, SOURCE_SCOPE);
    const resumed = readMigrationState(db, SOURCE_SCOPE)!;
    assert.deepEqual(JSON.parse(resumed.cursor_json), { chunk: 7 });
    assert.equal(resumed.status, "running");
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

test("B.2: each (phase, scope_kind, scope_id) tuple is unique", async () => {
  await withStore(async (storage) => {
    const db = (storage as unknown as { db: import("node:sqlite").DatabaseSync }).db;

    recordMigrationStart(db, SOURCE_SCOPE);
    // Same key, second start should UPSERT, not insert a duplicate.
    recordMigrationStart(db, SOURCE_SCOPE);
    const all = listMigrationStates(db);
    assert.equal(all.length, 1);
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
