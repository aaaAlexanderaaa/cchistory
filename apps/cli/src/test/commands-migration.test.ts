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
        schema_version?: string;
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
    assert.ok(preview.preview.schema_version, "migration preview must report the schema version from schema_meta.value_text");

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

// B.4 acceptance: `cchistory migration validate` runs three independent
// validators (bundle byte-diff, inventory diff, read-path parity), writes
// per-validator markers, and surfaces a non-zero exit code on failure.

test("B.4: validate --only inventory passes with complete V2 coverage and writes one marker", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);
    await runCliCapture(["migration", "run", "--store", storeDir]);

    // evidence_captures can legitimately have multiple rows for one current
    // captured blob. Inventory should fail missing coverage, not one-to-one
    // row-count differences for this pair.
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    try {
      db.exec(`
        INSERT INTO evidence_captures (
          id,
          evidence_sha256,
          source_id,
          blob_id,
          origin_path,
          source_checksum,
          size_bytes,
          captured_at,
          capture_run_id,
          host_id,
          captured_path,
          file_modified_at,
          file_changed_at,
          file_identity_stable,
          capture_kind,
          created_at
        )
        SELECT id || '-duplicate',
               evidence_sha256,
               source_id,
               blob_id,
               origin_path,
               source_checksum,
               size_bytes,
               captured_at,
               capture_run_id,
               host_id,
               captured_path,
               file_modified_at,
               file_changed_at,
               file_identity_stable,
               capture_kind,
               created_at
          FROM evidence_captures
         LIMIT 1
      `);
    } finally {
      db.close();
    }

    const result = await runCliJson<{
      result: {
        ran: string[];
        exit_code: number;
        outcomes: Array<{ validator: string; status: string; inventory?: { status: string } }>;
      };
    }>(["migration", "validate", "--only", "inventory", "--store", storeDir]);

    assert.deepEqual(result.result.ran, ["inventory"]);
    assert.equal(result.result.exit_code, 0);
    assert.equal(result.result.outcomes[0]!.validator, "inventory");
    assert.equal(result.result.outcomes[0]!.status, "pass");

    // Marker is written under the validate phase with store-scoped id.
    const status = await runCliJson<{
      states: Array<{ phase: string; scope_kind: string; scope_id: string; status: string }>;
    }>(["migration", "status", "--store", storeDir]);
    const inventoryMarker = status.states.find(
      (s) => s.phase === "storage-boundary.validate" && s.scope_id === "inventory-diff",
    );
    assert.ok(inventoryMarker, "inventory-diff marker must be written");
    assert.equal(inventoryMarker!.status, "completed");
    assert.equal(inventoryMarker!.scope_kind, "store");
  }, "cchistory-b4-inventory-pass-");
});

test("B.4: validate --only read-paths passes on a freshly-synced store", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);
    await runCliCapture(["migration", "run", "--store", storeDir]);

    const result = await runCliJson<{
      result: {
        ran: string[];
        exit_code: number;
        outcomes: Array<{
          validator: string;
          status: string;
          read_paths?: { turns_checked: number; mismatch_count: number };
        }>;
      };
    }>(["migration", "validate", "--only", "read-paths", "--store", storeDir]);

    assert.deepEqual(result.result.ran, ["read-paths"]);
    assert.equal(result.result.exit_code, 0);
    assert.ok(result.result.outcomes[0]!.read_paths!.turns_checked > 0);
    assert.equal(result.result.outcomes[0]!.read_paths!.mismatch_count, 0);
  }, "cchistory-b4-read-paths-pass-");
});

test("B.4: validate --only bundle passes when --pre-bundle was captured from the same store", async () => {
  await withSeededHome(async (tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);
    const preBundleDir = path.join(tempRoot, "pre-bundle");
    await runCliCapture(["export", "--out", preBundleDir, "--store", storeDir]);
    await runCliCapture(["migration", "run", "--store", storeDir]);

    const result = await runCliJson<{
      result: {
        ran: string[];
        exit_code: number;
        outcomes: Array<{
          validator: string;
          status: string;
          bundle?: {
            status: string;
            payload_mismatches: unknown[];
            raw_mismatches: unknown[];
            manifest_field_mismatches: unknown[];
          };
        }>;
      };
    }>(["migration", "validate", "--only", "bundle", "--pre-bundle", preBundleDir, "--store", storeDir]);

    assert.deepEqual(result.result.ran, ["bundle"]);
    assert.equal(result.result.exit_code, 0);
    const bundle = result.result.outcomes[0]!.bundle!;
    assert.equal(bundle.status, "pass");
    assert.equal(bundle.payload_mismatches.length, 0);
    assert.equal(bundle.raw_mismatches.length, 0);
    assert.equal(bundle.manifest_field_mismatches.length, 0);
  }, "cchistory-b4-bundle-pass-");
});

test("B.4: validate --only bundle detects a mutated V2 payload", async () => {
  await withSeededHome(async (tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);
    const preBundleDir = path.join(tempRoot, "pre-bundle");
    await runCliCapture(["export", "--out", preBundleDir, "--store", storeDir]);
    await runCliCapture(["migration", "run", "--store", storeDir]);

    // C1 made the bundle path read V2 (matching buildSourcePayload). A V1
    // payload mutation is no longer visible in bundle bytes; the validator
    // now catches mutations in the V2 sidecar, which is what production
    // reads post-B.5.5. Mutate canonical_text_full (Tier 1 column added by
    // B.5.0e) so the round-tripped turn projection differs.
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    try {
      const row = db.prepare("SELECT turn_id FROM user_turns_v2 LIMIT 1").get() as { turn_id: string };
      db.prepare("UPDATE user_turns_v2 SET canonical_text_full = ? WHERE turn_id = ?").run(
        "mutated canonical text",
        row.turn_id,
      );
    } finally {
      db.close();
    }

    const capture = await runCliCapture([
      "migration", "validate", "--only", "bundle",
      "--pre-bundle", preBundleDir, "--store", storeDir, "--json",
    ]);
    assert.equal(capture.exitCode, 1);
    const result = JSON.parse(capture.stdout) as {
      result: {
        exit_code: number;
        outcomes: Array<{
          validator: string;
          status: string;
          bundle?: { payload_mismatches: Array<{ source_id: string }> };
        }>;
      };
    };
    assert.equal(result.result.exit_code, 1);
    assert.equal(result.result.outcomes[0]!.status, "fail");
    assert.ok(result.result.outcomes[0]!.bundle!.payload_mismatches.length > 0);
  }, "cchistory-b4-bundle-fail-");
});

test("B.4: validate --only inventory detects a deleted V2 sidecar row", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);
    await runCliCapture(["migration", "run", "--store", storeDir]);

    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    try {
      const row = db.prepare("SELECT turn_id FROM user_turns_v2 LIMIT 1").get() as { turn_id: string };
      db.prepare("DELETE FROM user_turns_v2 WHERE turn_id = ?").run(row.turn_id);
    } finally {
      db.close();
    }

    const capture = await runCliCapture([
      "migration", "validate", "--only", "inventory", "--store", storeDir, "--json",
    ]);
    assert.equal(capture.exitCode, 1);
    const result = JSON.parse(capture.stdout) as {
      result: {
        exit_code: number;
        outcomes: Array<{
          validator: string;
          status: string;
          inventory?: { failing_pairs: Array<{ name: string; missing: number }> };
        }>;
      };
    };
    assert.equal(result.result.exit_code, 1);
    assert.equal(result.result.outcomes[0]!.status, "fail");
    const failing = result.result.outcomes[0]!.inventory!.failing_pairs;
    assert.ok(failing.some((p) => p.name === "user_turns" && p.missing > 0));
  }, "cchistory-b4-inventory-fail-");
});

test("B.4: validate --only read-paths detects a corrupted V2 cache file", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);
    await runCliCapture(["migration", "run", "--store", storeDir]);

    const { DatabaseSync } = await import("node:sqlite");
    const { writeFileSync } = await import("node:fs");
    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    let cachePath: string | null = null;
    try {
      const row = db
        .prepare("SELECT cache_storage_path FROM turn_context_refs_v2 WHERE cache_storage_path IS NOT NULL LIMIT 1")
        .get() as { cache_storage_path: string } | undefined;
      cachePath = row?.cache_storage_path ?? null;
    } finally {
      db.close();
    }
    assert.ok(cachePath, "fixture must have at least one V2 turn context cache file");
    writeFileSync(path.join(storeDir, cachePath!), "corrupted-bytes");

    const capture = await runCliCapture([
      "migration", "validate", "--only", "read-paths", "--store", storeDir, "--json",
    ]);
    assert.equal(capture.exitCode, 1);
    const result = JSON.parse(capture.stdout) as {
      result: {
        exit_code: number;
        outcomes: Array<{
          validator: string;
          status: string;
          read_paths?: {
            mismatch_count: number;
            mismatches: Array<{ reason: string }>;
          };
        }>;
      };
    };
    assert.equal(result.result.exit_code, 1);
    assert.equal(result.result.outcomes[0]!.status, "fail");
    assert.ok(result.result.outcomes[0]!.read_paths!.mismatch_count > 0);
    assert.ok(
      result.result.outcomes[0]!.read_paths!.mismatches.some((m) => m.reason === "v2_missing"),
      "corrupted cache must surface as a v2_missing mismatch",
    );
  }, "cchistory-b4-read-paths-fail-");
});

test("B.4 + H2: validate --only read-paths detects a corrupted V2 lineage blob", async () => {
  // Regression (H2): the B.4c read-paths validator must surface a corrupted
  // lineage blob as a real failure. readTurnLineageFromV2Blob silently returns
  // undefined on sha256 mismatch (legitimate backfill case) AND on integrity
  // violation (corrupted blob). Without a positive test exercising the
  // corrupted case, a regression that flipped the validator's mismatch
  // detection off for lineage could pass silently.
  //
  // Post-H1, the corrupted-blob case also emits a CCHistoryEvidenceBlobIntegrity
  // warning. This test asserts the read-paths validator catches the resulting
  // lineage mismatch regardless of the warning.
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);
    await runCliCapture(["migration", "run", "--store", storeDir]);

    const { DatabaseSync } = await import("node:sqlite");
    const { writeFileSync } = await import("node:fs");
    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    let lineageBlobPath: string | null = null;
    let v1HasLineage = false;
    try {
      const row = db
        .prepare(
          `SELECT utv.lineage_blob_sha256 AS sha,
                  json_extract(ut.payload_json, '$.lineage.atom_refs') AS v1_atom_refs
             FROM user_turns_v2 utv
             JOIN user_turns ut ON ut.id = utv.turn_id
            WHERE utv.lineage_blob_sha256 <> ''
            LIMIT 1`,
        )
        .get() as { sha: string; v1_atom_refs: string } | undefined;
      if (row?.sha) {
        lineageBlobPath = path.join(storeDir, "evidence", "blobs", row.sha.slice(0, 2), row.sha);
        v1HasLineage = !!row.v1_atom_refs && row.v1_atom_refs !== "[]";
      }
    } finally {
      db.close();
    }
    assert.ok(lineageBlobPath, "fixture must have at least one V2 lineage blob");
    assert.ok(v1HasLineage, "fixture's V1 payload for the chosen turn must have non-empty lineage.atom_refs");

    // Corrupt the blob's content. The sha256 check will fail on next read.
    writeFileSync(lineageBlobPath!, "corrupted-bytes-that-do-not-match-the-sha");

    const capture = await runCliCapture([
      "migration", "validate", "--only", "read-paths", "--store", storeDir, "--json",
    ]);
    assert.equal(capture.exitCode, 1);
    const result = JSON.parse(capture.stdout) as {
      result: {
        exit_code: number;
        outcomes: Array<{
          validator: string;
          status: string;
          read_paths?: {
            mismatch_count: number;
            user_turn?: { mismatch_count: number };
            mismatches: Array<{ reason: string }>;
          };
        }>;
      };
    };
    assert.equal(result.result.exit_code, 1);
    assert.equal(result.result.outcomes[0]!.status, "fail");
    assert.ok(
      (result.result.outcomes[0]!.read_paths?.user_turn?.mismatch_count ?? 0) > 0,
      "corrupted lineage blob must surface as a user_turn mismatch (otherwise the validator silently passes on a real failure)",
    );
  }, "cchistory-b4-read-paths-lineage-fail-");
});

test("B.4: validate with no --only runs all default validators and writes markers", async () => {
  await withSeededHome(async (tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);
    const preBundleDir = path.join(tempRoot, "pre-bundle");
    await runCliCapture(["export", "--out", preBundleDir, "--store", storeDir]);
    await runCliCapture(["migration", "run", "--store", storeDir]);

    const result = await runCliJson<{
      result: {
        ran: string[];
        exit_code: number;
        outcomes: Array<{ validator: string; status: string }>;
      };
    }>(["migration", "validate", "--pre-bundle", preBundleDir, "--store", storeDir]);

    assert.deepEqual(result.result.ran.sort(), ["bundle", "inventory", "read-paths", "v1-payload-digest"].sort());
    assert.equal(result.result.exit_code, 0);
    assert.ok(result.result.outcomes.every((o) => o.status === "pass"));

    const status = await runCliJson<{
      states: Array<{ phase: string; scope_id: string; status: string }>;
    }>(["migration", "status", "--store", storeDir]);
    const validateScopes = status.states
      .filter((s) => s.phase === "storage-boundary.validate")
      .map((s) => s.scope_id)
      .sort();
    assert.deepEqual(validateScopes, ["bundle-byte-diff", "inventory-diff", "read-path-parity", "v1-payload-digest"]);
  }, "cchistory-b4-all-");
});

test("B.4: validate --only bundle requires --pre-bundle", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);
    await runCliCapture(["migration", "run", "--store", storeDir]);

    const result = await runCliCapture([
      "migration", "validate", "--only", "bundle", "--store", storeDir,
    ]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /--pre-bundle/);
  }, "cchistory-b4-requires-pre-bundle-");
});

test("B.4: validate --only rejects unknown validator names", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);
    const result = await runCliCapture([
      "migration", "validate", "--only", "nonexistent", "--store", storeDir,
    ]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /Invalid --only value/);
  }, "cchistory-b4-bad-only-");
});

// B.5.0 — V2 schema extension. The bounded V2 sidecar grew seven full-content
// columns (user_messages_json, raw_text_full, project_id, project_ref,
// project_link_state, last_context_activity_at, path_text) so V2 can serve
// every read path V1 serves. B.3 populates them on backfill; B.4c (read-path
// parity) deepEquals UserTurnProjection reconstructed from V2 against V1 so a
// cutover cannot ship with drift. `migration reset` clears markers so an
// operator can re-run B.3 against the new schema.

test("B.5.0a: schema migration adds the seven full-content columns to user_turns_v2", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);

    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    try {
      const cols = (
        db.prepare("PRAGMA table_info(user_turns_v2)").all() as Array<{ name: string }>
      ).map((row) => row.name);
      for (const expected of [
        "user_messages_json",
        "raw_text_full",
        "canonical_text_full",
        "project_id",
        "project_ref",
        "project_link_state",
        "last_context_activity_at",
        "path_text",
      ]) {
        assert.ok(cols.includes(expected), `user_turns_v2 must have ${expected}`);
      }
      const schemaVersion = (
        db.prepare("SELECT value_text FROM schema_meta WHERE key = 'schema_version'").get() as
          | { value_text: string }
          | undefined
      )?.value_text;
      assert.equal(schemaVersion, "2026-06-22.1");
    } finally {
      db.close();
    }
  }, "cchistory-b5-0a-schema-");
});

test("B.5.0b: B.3 backfill populates the full-content columns on a fresh store", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);

    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    try {
      const row = db
        .prepare(
          `SELECT length(user_messages_json)  AS um_len,
                  length(raw_text_full)      AS rt_len,
                  length(canonical_text_full) AS ct_len,
                  project_id,
                  last_context_activity_at,
                  path_text
             FROM user_turns_v2
            WHERE user_messages_json <> '[]'
            LIMIT 1`,
        )
        .get() as
        | {
            um_len: number;
            rt_len: number;
            ct_len: number;
            project_id: string;
            last_context_activity_at: string;
            path_text: string;
          }
        | undefined;
      assert.ok(row, "fixture must have at least one populated V2 turn");
      assert.ok(row!.um_len > 2, "user_messages_json must be non-empty array");
      assert.ok(row!.ct_len > 0, "canonical_text_full must be non-empty");
      assert.ok(row!.rt_len > 0, "raw_text_full must be non-empty");
      assert.ok(row!.last_context_activity_at, "last_context_activity_at must be populated");
    } finally {
      db.close();
    }
  }, "cchistory-b5-0b-backfill-");
});

test("B.5.0d: validate --only read-paths catches a mutation in a B.5.0 full-content column", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);
    await runCliCapture(["migration", "run", "--store", storeDir]);

    // Wipe user_messages_json back to the empty default — V1 still has it.
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    try {
      db.prepare("UPDATE user_turns_v2 SET user_messages_json = '[]' WHERE turn_id = (SELECT turn_id FROM user_turns_v2 LIMIT 1)").run();
    } finally {
      db.close();
    }

    const capture = await runCliCapture([
      "migration", "validate", "--only", "read-paths", "--store", storeDir, "--json",
    ]);
    assert.equal(capture.exitCode, 1);
    const result = JSON.parse(capture.stdout) as {
      result: {
        exit_code: number;
        outcomes: Array<{
          validator: string;
          status: string;
          read_paths?: {
            user_turn: { mismatch_count: number; mismatches: Array<{ reason: string }> };
          };
        }>;
      };
    };
    assert.equal(result.result.exit_code, 1);
    assert.equal(result.result.outcomes[0]!.status, "fail");
    assert.ok(
      result.result.outcomes[0]!.read_paths!.user_turn.mismatch_count > 0,
      "UserTurnProjection parity must catch the mutated user_messages_json",
    );
  }, "cchistory-b5-0d-parity-");
});

test("B.5.0e: canonical_text_full preserves canonical text past the 16 KiB scan-hint bound", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);

    // Take an existing V1 turn and rewrite its payload_json to carry a 32 KiB
    // canonical_text — well past the 16 KiB scan-hint bound. This keeps the
    // projection shape intact (all required fields) and only stresses the
    // canonical_text / raw_text length.
    const { DatabaseSync } = await import("node:sqlite");
    const longCanonical = "x".repeat(32 * 1024);
    const longRaw = "y".repeat(32 * 1024);
    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    let turnId: string | null = null;
    try {
      const row = db.prepare("SELECT id, payload_json FROM user_turns LIMIT 1").get() as
        | { id: string; payload_json: string }
        | undefined;
      assert.ok(row, "fixture must have at least one V1 turn");
      turnId = row!.id;
      const payload = JSON.parse(row!.payload_json) as Record<string, unknown>;
      payload.canonical_text = longCanonical;
      payload.raw_text = longRaw;
      // Touch submission_started_at so B.3 sees this source as needing re-backfill
      // after the reset below.
      db.prepare("UPDATE user_turns SET payload_json = ? WHERE id = ?").run(
        JSON.stringify(payload),
        turnId,
      );
    } finally {
      db.close();
    }

    // Reset and re-run B.3 so the new V2 schema (canonical_text_full) is populated
    // from the modified V1 payload.
    await runCliCapture(["migration", "reset", "--phase", "storage-boundary.write", "--store", storeDir]);
    await runCliCapture(["migration", "run", "--store", storeDir]);

    // B.4c must catch any canonical_text truncation as a UserTurnProjection diff.
    // Pass = canonical_text_full preserved the full 32 KiB and the V2 reader
    // reconstructed the projection with full text.
    const capture = await runCliCapture([
      "migration", "validate", "--only", "read-paths", "--store", storeDir, "--json",
    ]);
    assert.equal(
      capture.exitCode,
      0,
      `read-path parity must pass: ${capture.stdout}`,
    );
    const result = JSON.parse(capture.stdout) as {
      result: {
        exit_code: number;
        outcomes: Array<{
          read_paths?: { user_turn: { mismatch_count: number } };
        }>;
      };
    };
    assert.equal(result.result.exit_code, 0);
    assert.equal(
      result.result.outcomes[0]!.read_paths!.user_turn.mismatch_count,
      0,
      "canonical_text_full must round-trip without truncation",
    );

    // Directly verify the V2 row carries the full canonical text.
    const db2 = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    try {
      const row = db2
        .prepare(
          "SELECT length(canonical_text) AS bounded_len, length(canonical_text_full) AS full_len FROM user_turns_v2 WHERE turn_id = ?",
        )
        .get(turnId) as { bounded_len: number; full_len: number } | undefined;
      assert.ok(row, "V2 row must exist for the modified turn");
      // bounded canonical_text is roughly 16 KiB. boundedString (M3) reserves
      // Buffer.byteLength("...[truncated]") = 13 bytes for the truncator, so
      // the bounded column can be exactly maxBytes chars when the body is all
      // ASCII. canonical_text_full carries the full 32 KiB.
      assert.ok(
        row!.bounded_len > 16 * 1024 - 100 && row!.bounded_len <= 16 * 1024,
        `bounded canonical_text should be near 16 KiB, got ${row!.bounded_len}`,
      );
      assert.equal(row!.full_len, 32 * 1024, "canonical_text_full must carry the full 32 KiB");
    } finally {
      db2.close();
    }
  }, "cchistory-b5-0e-canonical-full-");
});

test("B.5.0: migration reset clears markers for the named phase and leaves the others alone", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);
    await runCliCapture(["migration", "run", "--store", storeDir]);

    const before = await runCliJson<{
      states: Array<{ phase: string; status: string }>;
    }>(["migration", "status", "--store", storeDir]);
    const beforePhases = new Set(before.states.map((s) => s.phase));
    assert.ok(beforePhases.has("storage-boundary.write"), "B.3 must have left write markers");

    const reset = await runCliJson<{
      kind: string;
      phase: string | null;
      rows_deleted: number;
    }>(["migration", "reset", "--phase", "storage-boundary.write", "--store", storeDir]);

    assert.equal(reset.kind, "migration-reset");
    assert.equal(reset.phase, "storage-boundary.write");
    assert.ok(reset.rows_deleted > 0, "reset must delete at least one marker");

    const after = await runCliJson<{
      states: Array<{ phase: string; status: string }>;
    }>(["migration", "status", "--store", storeDir]);
    const writeMarkersAfter = after.states.filter((s) => s.phase === "storage-boundary.write");
    assert.equal(writeMarkersAfter.length, 0, "no write markers must remain after reset");
  }, "cchistory-b5-0-reset-phase-");
});

test("B.5.0: migration reset with no --phase clears every marker", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);
    await runCliCapture(["migration", "run", "--store", storeDir]);

    const reset = await runCliJson<{ rows_deleted: number }>([
      "migration", "reset", "--store", storeDir,
    ]);
    assert.ok(reset.rows_deleted > 0, "reset must delete at least one marker");

    const status = await runCliJson<{
      states: Array<{ phase: string }>;
    }>(["migration", "status", "--store", storeDir]);
    assert.equal(status.states.length, 0, "no markers must remain");
  }, "cchistory-b5-0-reset-all-");
});

test("B.5.0: after reset, migration run can re-populate markers (idempotent re-migration)", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);
    await runCliCapture(["migration", "run", "--store", storeDir]);
    await runCliCapture(["migration", "reset", "--phase", "storage-boundary.write", "--store", storeDir]);

    const result = await runCliJson<{
      result: { sources_processed: number; sources_skipped: number };
    }>(["migration", "run", "--store", storeDir]);

    assert.ok(result.result.sources_processed > 0, "re-run must process sources");
    assert.equal(result.result.sources_skipped, 0, "re-run after reset must skip nothing");

    const status = await runCliJson<{
      states: Array<{ phase: string; status: string }>;
    }>(["migration", "status", "--store", storeDir]);
    const writeMarkers = status.states.filter((s) => s.phase === "storage-boundary.write");
    assert.ok(writeMarkers.length > 0);
    assert.ok(writeMarkers.every((s) => s.status === "completed"));
  }, "cchistory-b5-0-reset-rerun-");
});

test("B.5.0: migration reset rejects an unknown --phase name (H6)", async () => {
  // Regression: `--phase` was cast unchecked to MigrationPhase, so a typo
  // like `storage-boundary.wirte` would silently DELETE 0 rows. The operator
  // would then re-run `migration run` expecting the typo'd phase to be
  // re-populated, when in fact nothing was reset.
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);
    await runCliCapture(["migration", "run", "--store", storeDir]);

    const result = await runCliCapture([
      "migration", "reset", "--phase", "storage-boundary.wirte", "--store", storeDir,
    ]);
    assert.notEqual(result.exitCode, 0, "reset with a typo'd phase must fail");
    assert.match(result.stderr, /Unknown migration phase/i);
    assert.match(result.stderr, /storage-boundary\.write/i);

    // No markers must have been deleted despite the typo.
    const status = await runCliJson<{
      states: Array<{ phase: string }>;
    }>(["migration", "status", "--store", storeDir]);
    assert.ok(status.states.length > 0, "markers must be untouched after a rejected reset");
  }, "cchistory-b5-0-reset-unknown-phase-");
});

test("C4: migration reset refuses to clear while a marker is still 'running'", async () => {
  // Regression: `migration reset` unconditionally called clearMigrationStatesByPhase.
  // An operator could wipe a live running marker, defeating the C2 abort-resurrect
  // guard — two processes would then race on BEGIN IMMEDIATE for the same source.
  // Fix: refuse reset while any marker is 'running' (in scope); require --force.
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);

    // Seed a 'running' marker directly. CLI doesn't expose a way to leave a
    // marker mid-flight, so simulate the post-SIGKILL state: started + never
    // completed.
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    try {
      db.prepare(
        `INSERT INTO migration_state (phase, scope_kind, scope_id, status, cursor_json, started_at, completed_at, last_error)
         VALUES (?, 'source', 'src-simulated', 'running', '{}', ?, NULL, '')`,
      ).run(
        "storage-boundary.write",
        new Date(Date.now() - 60_000).toISOString(),
      );
    } finally {
      db.close();
    }

    // Plain reset must refuse.
    const refused = await runCliCapture([
      "migration", "reset", "--phase", "storage-boundary.write", "--store", storeDir,
    ]);
    assert.notEqual(refused.exitCode, 0, "reset must refuse while a marker is running");
    assert.match(refused.stderr, /currently 'running'/i);

    // The running marker must survive the refused reset.
    const statusAfter = await runCliJson<{
      states: Array<{ phase: string; status: string; scope_id: string }>;
    }>(["migration", "status", "--store", storeDir]);
    const stillRunning = statusAfter.states.find(
      (s) => s.phase === "storage-boundary.write" && s.scope_id === "src-simulated",
    );
    assert.ok(stillRunning, "running marker must survive the refused reset");
    assert.equal(stillRunning!.status, "running");

    // --force overrides after the operator confirms the prior PID is dead.
    const forced = await runCliJson<{ rows_deleted: number }>([
      "migration", "reset", "--phase", "storage-boundary.write", "--force", "--store", storeDir,
    ]);
    assert.ok(forced.rows_deleted > 0, "--force must clear the running marker");
  }, "cchistory-c4-reset-running-guard-");
});

test("C5: validate writes 'aborted' (not 'completed') on validator FAIL", async () => {
  // Regression: recordMigrationComplete was called regardless of outcome,
  // so a FAILing validator left a 'completed' marker. Downstream tooling
  // had no way to distinguish "validator ran and passed" from "validator
  // ran and failed". Fix: write 'aborted' on fail with a last_error summary.
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);
    await runCliCapture(["migration", "run", "--store", storeDir]);

    // Mutate V2 to force read-paths to fail.
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    try {
      const row = db.prepare("SELECT turn_id FROM user_turns_v2 LIMIT 1").get() as { turn_id: string };
      db.prepare("UPDATE user_turns_v2 SET canonical_text_full = ? WHERE turn_id = ?").run(
        "mutated by C5 test",
        row.turn_id,
      );
    } finally {
      db.close();
    }

    const capture = await runCliCapture([
      "migration", "validate", "--only", "read-paths", "--store", storeDir, "--json",
    ]);
    assert.equal(capture.exitCode, 1, "validator must fail");

    const status = await runCliJson<{
      states: Array<{ phase: string; status: string; last_error: string; scope_id: string }>;
    }>(["migration", "status", "--store", storeDir]);

    const readPathsMarker = status.states.find(
      (s) => s.phase === "storage-boundary.validate" && s.scope_id === "read-path-parity",
    );
    assert.ok(readPathsMarker, "validator marker must exist after a FAIL");
    assert.equal(
      readPathsMarker!.status,
      "aborted",
      "C5: FAIL must write 'aborted', not 'completed' — downstream tooling distinguishes the two",
    );
    assert.match(
      readPathsMarker!.last_error,
      /read-paths validator failed/i,
      "last_error must carry a human-readable summary of the failure",
    );
  }, "cchistory-c5-validator-fail-aborted-");
});

test("C6: validate --only v1-payload-digest captures a sticky baseline on first run and detects drift", async () => {
  // Regression: after the C1 bundle-cutover, V1 payload_json mutations were
  // no longer visible to the bundle byte-diff validator (the bundle now
  // reads V2). The v1-payload-digest validator replaces that coverage by
  // hashing V1 payload_json tables against a sticky baseline captured at
  // first run. Drift = a V1 table changed after B.3, which B.6a (DROP
  // COLUMN) would propagate into permanent loss.
  await withSeededHome(async (_tempRoot, storeDir) => {
    await runCliCapture(["sync", "--store", storeDir]);
    await runCliCapture(["migration", "run", "--store", storeDir]);

    // First run captures the baseline. Status must be PASS.
    const firstCapture = await runCliCapture([
      "migration", "validate", "--only", "v1-payload-digest", "--store", storeDir, "--json",
    ]);
    assert.equal(firstCapture.exitCode, 0, "first run (baseline capture) must pass");
    const first = JSON.parse(firstCapture.stdout) as {
      result: {
        exit_code: number;
        outcomes: Array<{
          validator: string;
          status: string;
          v1_payload_digest?: {
            baseline_captured: boolean;
            mismatch_count: number;
            row_counts: Record<string, number>;
          };
        }>;
      };
    };
    assert.equal(first.result.outcomes[0]!.status, "pass");
    assert.equal(
      first.result.outcomes[0]!.v1_payload_digest!.baseline_captured,
      true,
      "first run must capture a fresh baseline",
    );

    // A clean repeat must compare against the sticky baseline and preserve it.
    const cleanRepeatCapture = await runCliCapture([
      "migration", "validate", "--only", "v1-payload-digest", "--store", storeDir, "--json",
    ]);
    assert.equal(cleanRepeatCapture.exitCode, 0, "clean repeat must pass against the existing baseline");
    const cleanRepeat = JSON.parse(cleanRepeatCapture.stdout) as {
      result: {
        outcomes: Array<{
          status: string;
          v1_payload_digest?: {
            baseline_captured: boolean;
            mismatch_count: number;
          };
        }>;
      };
    };
    assert.equal(cleanRepeat.result.outcomes[0]!.status, "pass");
    assert.equal(
      cleanRepeat.result.outcomes[0]!.v1_payload_digest!.baseline_captured,
      false,
      "clean repeat must not replace the sticky baseline",
    );
    assert.equal(cleanRepeat.result.outcomes[0]!.v1_payload_digest!.mismatch_count, 0);

    // Mutate V1 to simulate drift.
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    try {
      db.prepare("UPDATE user_turns SET payload_json = ? WHERE id = (SELECT id FROM user_turns LIMIT 1)").run(
        '{"mutated_by_c6_test":true}',
      );
    } finally {
      db.close();
    }

    // Second run compares against the sticky baseline. Must FAIL.
    const secondCapture = await runCliCapture([
      "migration", "validate", "--only", "v1-payload-digest", "--store", storeDir, "--json",
    ]);
    assert.equal(secondCapture.exitCode, 1, "drift must FAIL");
    const second = JSON.parse(secondCapture.stdout) as {
      result: {
        outcomes: Array<{
          validator: string;
          status: string;
          v1_payload_digest?: {
            baseline_captured: boolean;
            mismatch_count: number;
            mismatches: Array<{ table: string }>;
          };
        }>;
      };
    };
    assert.equal(second.result.outcomes[0]!.status, "fail");
    assert.equal(
      second.result.outcomes[0]!.v1_payload_digest!.baseline_captured,
      false,
      "second run must compare against the existing baseline (not re-capture)",
    );
    assert.ok(
      second.result.outcomes[0]!.v1_payload_digest!.mismatch_count > 0,
      "drift must be reported",
    );
    const mismatchedTables = second.result.outcomes[0]!.v1_payload_digest!.mismatches.map((m) => m.table);
    assert.ok(
      mismatchedTables.includes("user_turns"),
      "user_turns drift must be surfaced (we mutated user_turns.payload_json)",
    );

    // Reset clears the baseline; the next run captures a fresh one.
    await runCliCapture([
      "migration", "reset", "--phase", "storage-boundary.validate", "--store", storeDir,
    ]);
    const postReset = await runCliCapture([
      "migration", "validate", "--only", "v1-payload-digest", "--store", storeDir, "--json",
    ]);
    assert.equal(postReset.exitCode, 0, "post-reset run must capture a new baseline");
    const post = JSON.parse(postReset.stdout) as {
      result: { outcomes: Array<{ v1_payload_digest?: { baseline_captured: boolean } }> };
    };
    assert.equal(
      post.result.outcomes[0]!.v1_payload_digest!.baseline_captured,
      true,
      "after reset, the validator captures a new sticky baseline",
    );
  }, "cchistory-c6-v1-payload-digest-");
});
