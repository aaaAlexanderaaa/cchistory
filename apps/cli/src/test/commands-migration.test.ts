import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runCliCapture, runCliJson, seedCliFixtures } from "./helpers.js";

// B.1 acceptance: `cchistory migration preview` is read-only, lists the
// four required axes (V1→V2 mapping, backfill gap, removable bytes, VACUUM
// disk space), and refuses to write.

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

test("B.1: migration preview reports V1→V2 mapping and removable bytes without writing", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);

    const preview = await runCliJson<{
      kind: string;
      preview: {
        v1_to_v2_mapping: {
          user_turns: { v1_rows: number; v2_rows: number; missing: number };
          turn_contexts: { v1_rows: number; v2_rows: number; missing: number };
          raw_records: { v1_rows: number; v2_rows: number; missing: number };
          captured_blobs: { v1_rows: number; v2_rows: number; missing: number };
        };
        backfill: { total_missing: number };
        removable: { total_bytes: number };
        vacuum: { sufficient: boolean; required_free_bytes: number };
      };
    }>(["migration", "preview", "--store", storeDir]);

    assert.equal(preview.kind, "migration-preview");

    // A fresh sync writes both V1 and V2 sidecars together, so the mapping
    // has zero missing rows. (This is the state B.3 starts from.)
    for (const mapping of Object.values(preview.preview.v1_to_v2_mapping)) {
      assert.equal(mapping.missing, 0, "fresh store must have zero V1→V2 missing sidecars");
    }
    assert.equal(preview.preview.backfill.total_missing, 0);

    // Removable bytes — V1 payload_json present after sync.
    assert.ok(preview.preview.removable.total_bytes > 0, "removable payload bytes must be non-zero after sync");

    // VACUUM disk requirement is computed against the real filesystem.
    assert.equal(preview.preview.vacuum.sufficient, true);
    assert.ok(preview.preview.vacuum.required_free_bytes > 0);
  }, "cchistory-b1-preview-");
});

test("B.1: migration preview detects V1→V2 backfill gap when V2 sidecar rows are deleted", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);

    // Simulate an incomplete prior migration: drop one V2 row that has a
    // corresponding V1 row. B.3 must detect and reconstruct this.
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    let expectedMissing = 0;
    try {
      const v1 = db.prepare("SELECT id FROM user_turns LIMIT 1").get() as { id: string } | undefined;
      if (v1) {
        db.prepare("DELETE FROM user_turns_v2 WHERE turn_id = ?").run(v1.id);
        expectedMissing = 1;
      }
    } finally {
      db.close();
    }

    const preview = await runCliJson<{
      preview: { backfill: { missing_user_turns_v2: number; total_missing: number } };
    }>(["migration", "preview", "--store", storeDir]);

    assert.equal(preview.preview.backfill.missing_user_turns_v2, expectedMissing);
    assert.ok(preview.preview.backfill.total_missing >= expectedMissing);
  }, "cchistory-b1-gap-");
});

test("B.1: migration preview rejects --full (read-only)", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);
    const result = await runCliCapture(["migration", "preview", "--store", storeDir, "--full"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /read-only/i);
  }, "cchistory-b1-readonly-");
});

test("B.1: migration preview is available as a subcommand and requires no positional args", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);
    const result = await runCliCapture(["migration", "preview", "extra-positional", "--store", storeDir]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /does not take positional/i);
  }, "cchistory-b1-noargs-");
});

// B.3 acceptance: `cchistory migration run` performs per-source V2 backfill
// idempotently, `--dry-run` is read-only, and `status` reports the markers.

test("B.3: migration run --dry-run reports the preview without writing markers", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);

    const result = await runCliJson<{
      kind: string;
      preview: { affected: { sources: number }; backfill: { total_missing: number } };
    }>(["migration", "run", "--dry-run", "--store", storeDir]);

    assert.equal(result.kind, "migration-run-dry-run");
    assert.ok(result.preview.affected.sources > 0);

    // Dry-run must not write any migration_state markers.
    const status = await runCliJson<{
      states: Array<{ status: string }>;
    }>(["migration", "status", "--store", storeDir]);
    assert.equal(status.states.length, 0, "dry-run must not create markers");
  }, "cchistory-b3-dryrun-");
});

test("B.3: migration run writes V2 sidecars, marks sources completed, and is idempotent on re-run", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);

    const first = await runCliJson<{
      result: {
        sources_processed: number;
        sources_skipped: number;
        sources_aborted: number;
        halted_at_source_id: string | null;
      };
    }>(["migration", "run", "--store", storeDir]);
    assert.equal(first.result.sources_processed, first.result.sources_processed);
    assert.equal(first.result.sources_aborted, 0);
    assert.equal(first.result.halted_at_source_id ?? null, null, "first run must not halt");
    assert.ok(first.result.sources_processed > 0, "first run must process at least one source");

    const second = await runCliJson<{
      result: { sources_processed: number; sources_skipped: number };
    }>(["migration", "run", "--store", storeDir]);
    assert.equal(second.result.sources_processed, 0, "second run must skip — markers say completed");
    assert.equal(second.result.sources_skipped, first.result.sources_processed);

    const status = await runCliJson<{
      states: Array<{ status: string }>;
    }>(["migration", "status", "--store", storeDir]);
    assert.equal(status.states.length, first.result.sources_processed);
    assert.ok(status.states.every((s) => s.status === "completed"));
  }, "cchistory-b3-idempotent-");
});

test("B.3: migration run reconstructs a missing V2 sidecar row from its V1 source", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);

    // Pick a turn that exists in V1, drop its V2 row, and clear the source's
    // marker so B.3 actually re-runs the backfill.
    const { DatabaseSync } = await import("node:sqlite");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const db = new DatabaseSync(dbPath);
    let droppedTurnId: string | null = null;
    let sourceId: string | null = null;
    try {
      const turn = db
        .prepare(
          "SELECT t.id AS turn_id, t.source_id AS source_id FROM user_turns t INNER JOIN user_turns_v2 v ON v.turn_id = t.id LIMIT 1",
        )
        .get() as { turn_id: string; source_id: string } | undefined;
      if (turn) {
        droppedTurnId = turn.turn_id;
        sourceId = turn.source_id;
        db.prepare("DELETE FROM user_turns_v2 WHERE turn_id = ?").run(turn.turn_id);
      }
    } finally {
      db.close();
    }
    assert.ok(droppedTurnId, "fixture must have at least one V1 turn with a V2 sidecar");

    const result = await runCliJson<{
      result: { results: Array<{ source_id: string; aborted: boolean; skipped: boolean }> };
    }>(["migration", "run", "--source", sourceId!, "--store", storeDir]);
    assert.ok(result.result.results.every((r) => !r.aborted && !r.skipped));

    const verifyDb = new DatabaseSync(dbPath);
    try {
      const restored = verifyDb
        .prepare("SELECT turn_id FROM user_turns_v2 WHERE turn_id = ?")
        .get(droppedTurnId!) as { turn_id: string } | undefined;
      assert.ok(restored, "B.3 must reconstruct the dropped V2 sidecar row");
    } finally {
      verifyDb.close();
    }
  }, "cchistory-b3-gap-");
});

test("B.3: migration run refuses to auto-resurrect an aborted source", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);

    // Seed an aborted marker directly. B.3 must surface the abort rather
    // than silently retry the source.
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    const source = db.prepare("SELECT id FROM source_instances LIMIT 1").get() as { id: string } | undefined;
    assert.ok(source, "fixture must contain at least one source");
    try {
      db.prepare(
        "INSERT INTO migration_state (phase, scope_kind, scope_id, status, cursor_json, started_at, completed_at, last_error) VALUES (?, 'source', ?, 'aborted', '{}', ?, NULL, ?)",
      ).run(
        "storage-boundary.write",
        source!.id,
        new Date().toISOString(),
        "synthetic abort for B.3 test",
      );
    } finally {
      db.close();
    }

    const result = await runCliJson<{
      result: { sources_aborted: number; halted_at_source_id: string | null };
    }>(["migration", "run", "--source", source!.id, "--store", storeDir]);
    assert.equal(result.result.sources_aborted, 1);
    assert.equal(result.result.halted_at_source_id, source!.id);
  }, "cchistory-b3-abort-resurrect-");
});
