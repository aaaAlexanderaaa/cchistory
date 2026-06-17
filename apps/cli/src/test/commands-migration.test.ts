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
