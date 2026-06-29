import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runCliCapture, runCliJson, seedCliFixtures } from "./helpers.js";

// Phase A acceptance: maintenance commands and pragma tuning behave as the
// STORAGE_BOUNDARY_MIGRATION_PLAN documents.
//
// Every test must point HOME at the seeded temp root — otherwise the sync
// command walks the operator's real home and pulls in gigabytes of unrelated
// data. See apps/cli/src/test/commands-query.test.ts for the same pattern.

async function withSeededHome(
  fn: (tempRoot: string, storeDir: string) => Promise<void>,
  prefix: string,
): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  const originalHome = process.env.HOME;
  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");
    await fn(tempRoot, storeDir);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test("A.1: refreshDerivedState no longer writes search_index after sync", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    const sync = await runCliCapture(["sync", "--store", storeDir]);
    assert.equal(sync.exitCode, 0, sync.stderr);

    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    try {
      // searchMode reports fallback until an operator explicitly rebuilds —
      // A.1 removed the FTS5 write from the refreshDerivedState hot path.
      const overview = await runCliJson<{ search_mode: string }>(["stats", "--store", storeDir]);
      assert.equal(overview.search_mode, "fallback");

      // If the SQLite build exposes FTS5, the search_index table exists but
      // holds zero rows after sync (A.1 stopped populating it on the hot path).
      // If FTS5 is unavailable the table is never created — both states
      // satisfy A.1.
      const tableRow = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'search_index'")
        .get() as { 1: number } | undefined;
      if (tableRow) {
        const ftsCount = db.prepare("SELECT COUNT(*) AS n FROM search_index").get() as { n: number };
        assert.equal(ftsCount.n, 0, "search_index must be empty after sync (A.1 removed hot-path writes)");
      }
    } finally {
      db.close();
    }
  }, "cchistory-a1-");
});

test("A.1: maintenance rebuild-search-index populates FTS5 on demand", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);

    const rebuild = await runCliJson<{
      kind: string;
      ready: boolean;
      rows_indexed: number;
    }>(["maintenance", "rebuild-search-index", "--store", storeDir]);
    assert.equal(rebuild.kind, "maintenance-rebuild-search-index");
    if (rebuild.ready) {
      assert.ok(rebuild.rows_indexed > 0, "rebuild should have populated FTS5 rows when FTS5 is available");
      const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
      try {
        const ftsCount = db.prepare("SELECT COUNT(*) AS n FROM search_index").get() as { n: number };
        assert.equal(ftsCount.n, rebuild.rows_indexed);
      } finally {
        db.close();
      }
    }
    // FTS5 unavailable in this build → ready=false, rows_indexed=0. Still ok.
  }, "cchistory-a1-rebuild-");
});

test("A.2: maintenance gc-evidence prunes orphaned evidence_blobs rows and unlinks files", async () => {
  await withSeededHome(async (tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);

    // Inject an orphaned evidence_blobs row directly (simulating the
    // accumulated state from before A.2 landed) plus a placeholder file.
    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    let orphanSha = "";
    let orphanFile = "";
    try {
      orphanSha = "deadbeef".repeat(8); // 64 hex chars
      const sub = orphanSha.slice(0, 2);
      orphanFile = path.join(storeDir, "evidence", "blobs", sub, orphanSha);
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(path.dirname(orphanFile), { recursive: true });
      await writeFile(orphanFile, "orphan");

      db.prepare(
        `INSERT OR REPLACE INTO evidence_blobs (sha256, storage_path, size_bytes, media_type, encoding, compression, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        orphanSha,
        `evidence/blobs/${sub}/${orphanSha}`,
        6,
        "application/octet-stream",
        "binary",
        "none",
        new Date().toISOString(),
      );
    } finally {
      db.close();
    }

    const gc = await runCliJson<{
      kind: string;
      pruned_count: number;
      pruned_shas: string[];
    }>(["maintenance", "gc-evidence", "--store", storeDir]);
    assert.equal(gc.kind, "maintenance-gc-evidence");
    // The injected orphan is always pruned; the sync may have produced
    // additional pre-existing orphans (e.g. blobs whose only referencer was
    // pruned during the same sync). Both outcomes are correct.
    assert.ok(gc.pruned_count >= 1, "at least the injected orphan must be pruned");
    assert.ok(gc.pruned_shas.includes(orphanSha), "injected orphan sha must be in pruned list");

    const { access } = await import("node:fs/promises");
    await assert.rejects(() => access(orphanFile), "orphan evidence file must be unlinked");
    void tempRoot;
  }, "cchistory-a2-");
});

test("A.4: new stores created with 16 KiB page size", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);

    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    try {
      const row = db.prepare("PRAGMA page_size").get() as { page_size: number };
      assert.equal(row.page_size, 16384, "new stores must use 16 KiB pages after A.4");
    } finally {
      db.close();
    }
  }, "cchistory-a4-pagesize-");
});

test("A.4: maintenance checkpoint and vacuum run without error", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);

    const checkpoint = await runCliJson<{ kind: string }>(
      ["maintenance", "checkpoint", "--store", storeDir],
    );
    assert.equal(checkpoint.kind, "maintenance-checkpoint");

    const vacuum = await runCliJson<{
      kind: string;
      page_size_before: number;
      page_size_after: number;
    }>(["maintenance", "vacuum", "--store", storeDir]);
    assert.equal(vacuum.kind, "maintenance-vacuum");
    assert.equal(vacuum.page_size_after, 16384);
  }, "cchistory-a4-maint-");
});

test("A.3: prefix-duplicate session-only indexes are dropped after open", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);

    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    try {
      const dropped = [
        "idx_raw_records_session",
        "idx_source_fragments_session",
        "idx_conversation_atoms_session",
        "idx_atom_edges_session",
        "idx_derived_candidates_session",
        "idx_user_turns_v2_session",
      ];
      for (const name of dropped) {
        const row = db
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?")
          .get(name) as { 1: number } | undefined;
        assert.equal(row, undefined, `${name} must be dropped after open (A.3)`);
      }

      // The surviving compound indexes remain. Note: idx_user_turns_source_session
      // (V1) is gone post-B.6 — V1 user_turns is no longer created at schema
      // apply time, so its indexes don't exist either. Only the V2 compound
      // index survives.
      const survivors = [
        "idx_raw_records_source_session",
        "idx_user_turns_v2_source_session",
      ];
      for (const name of survivors) {
        const row = db
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?")
          .get(name) as { 1: number } | undefined;
        assert.ok(row, `${name} must remain after A.3 dedup`);
      }
    } finally {
      db.close();
    }
  }, "cchistory-a3-drop-");
});

test("refresh-projections: rebuilds stale project_current after manual row deletion", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);

    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const db = new DatabaseSync(dbPath);
    try {
      const beforeRow = db
        .prepare("SELECT COUNT(*) AS n FROM project_current")
        .get() as { n: number };
      assert.ok(beforeRow.n > 0, "seeded sync must produce project_current rows");

      // Simulate the failure mode: sync crashed mid-flight (e.g. OOM) after
      // writing raw rows but before refreshDerivedProjections committed. The
      // operator-visible symptom is `ls projects` showing no projects.
      db.exec("DELETE FROM project_current");
      const empty = db.prepare("SELECT COUNT(*) AS n FROM project_current").get() as { n: number };
      assert.equal(empty.n, 0);
    } finally {
      db.close();
    }

    const result = await runCliJson<{
      kind: string;
      project_rows_before: number;
      project_rows_after: number;
    }>(["maintenance", "refresh-projections", "--store", storeDir]);
    assert.equal(result.kind, "maintenance-refresh-projections");
    assert.equal(result.project_rows_before, 0);
    assert.ok(
      result.project_rows_after > 0,
      "refresh-projections must repopulate project_current from canonical rows",
    );

    const after = new DatabaseSync(dbPath);
    try {
      const afterRow = after
        .prepare("SELECT COUNT(*) AS n FROM project_current")
        .get() as { n: number };
      assert.equal(afterRow.n, result.project_rows_after);
    } finally {
      after.close();
    }
  }, "cchistory-refresh-projections-");
});
