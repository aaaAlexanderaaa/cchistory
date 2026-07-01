import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { CCHistoryStorage } from "../index.js";
import { pruneUnreferencedEvidenceBlobsInTransaction } from "../internal/gc.js";
import { createFixturePayload } from "./helpers.js";

// Stage 1 commit 1: the force flag on pruneUnreferencedEvidenceBlobsInTransaction.
// force:true (default) preserves the existing end-to-end LEFT JOIN behavior;
// force:false is a no-op used by per-batch merge loops so the sync hot path
// can defer the prune to a single end-of-sync call. See
// CCHistoryStorage.pruneEvidenceBlobsNow (added in the follow-up commit) for
// the orchestrator-side wiring.

async function buildStoreWithOneOrphan(): Promise<{
  dbPath: string;
  orphanSha: string;
  tempRoot: string;
}> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-prune-force-"));
  const storeDir = path.join(tempRoot, "store");
  const dbPath = path.join(storeDir, "cchistory.sqlite");
  const sourceRoot = path.join(tempRoot, "source");
  await mkdir(sourceRoot, { recursive: true });

  const sourceId = "srcinst-codex-prune-force";
  const originPath = path.join(sourceRoot, "session.jsonl");
  const text = "{\"fixture\":true}\n";
  await writeFile(originPath, text, "utf8");

  const storage = new CCHistoryStorage({ dbPath });
  const payload = createFixturePayload(sourceId, "prune force canonical", "stage-prune-force", {
    baseDir: sourceRoot,
  });
  payload.blobs[0]!.origin_path = originPath;
  payload.blobs[0]!.captured_path = undefined;
  payload.blobs[0]!.checksum = "orphan-checksum";
  payload.blobs[0]!.size_bytes = Buffer.byteLength(text, "utf8");
  payload.blobs[0]!.file_identity_stable = true;
  storage.replaceSourcePayload(payload);
  storage.close();

  // Manually insert an evidence_blob with no refs anywhere — guaranteed orphan.
  const orphanSha = "0".repeat(64);
  const probeDb = new DatabaseSync(dbPath);
  try {
    probeDb.exec("BEGIN IMMEDIATE;");
    probeDb
      .prepare(
        "INSERT INTO evidence_blobs (sha256, storage_path, size_bytes, media_type, encoding, compression, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        orphanSha,
        `evidence/blobs/00/${orphanSha}`,
        16,
        "application/octet-stream",
        "identity",
        "none",
        "2026-07-01T00:00:00.000Z",
      );
    probeDb.exec("COMMIT;");
  } finally {
    probeDb.close();
  }

  return { dbPath, orphanSha, tempRoot };
}

test("pruneUnreferencedEvidenceBlobsInTransaction with default options prunes orphaned evidence_blobs", async () => {
  const { dbPath, orphanSha, tempRoot } = await buildStoreWithOneOrphan();
  try {
    const db = new DatabaseSync(dbPath);
    try {
      db.exec("BEGIN IMMEDIATE;");
      const pruned = pruneUnreferencedEvidenceBlobsInTransaction(db);
      db.exec("COMMIT;");
      assert.ok(
        pruned.includes(orphanSha),
        "force:true (default) must prune the orphan inserted by the fixture",
      );
    } finally {
      db.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("pruneUnreferencedEvidenceBlobsInTransaction with explicit force:true prunes the same as default", async () => {
  const { dbPath, orphanSha, tempRoot } = await buildStoreWithOneOrphan();
  try {
    const db = new DatabaseSync(dbPath);
    try {
      db.exec("BEGIN IMMEDIATE;");
      const pruned = pruneUnreferencedEvidenceBlobsInTransaction(db, { force: true });
      db.exec("COMMIT;");
      assert.ok(pruned.includes(orphanSha), "explicit force:true must prune the orphan");
    } finally {
      db.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("pruneUnreferencedEvidenceBlobsInTransaction with force:false is a no-op and leaves orphans in place", async () => {
  const { dbPath, orphanSha, tempRoot } = await buildStoreWithOneOrphan();
  try {
    const db = new DatabaseSync(dbPath);
    try {
      db.exec("BEGIN IMMEDIATE;");
      const pruned = pruneUnreferencedEvidenceBlobsInTransaction(db, { force: false });
      db.exec("COMMIT;");
      assert.deepEqual(pruned, [], "force:false must return an empty list without scanning");

      const remaining = db
        .prepare("SELECT COUNT(*) AS count FROM evidence_blobs WHERE sha256 = ?")
        .get(orphanSha) as { count: number };
      assert.equal(remaining.count, 1, "force:false must leave the orphan row intact");
    } finally {
      db.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

// End-to-end coverage for the sync orchestrator's deferral contract: per-batch
// merge calls with force:false leave orphans in place, then a single
// pruneEvidenceBlobsNow() at end-of-sync reclaims them. Regression guard for
// "if a later refactor removes the end-of-sync call, this test fails."
test("CCHistoryStorage.pruneEvidenceBlobsNow reclaims orphans that per-batch force:false merges left behind", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-prune-defer-e2e-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });

    const sourceId = "srcinst-codex-prune-defer-e2e";
    const originPath = path.join(sourceRoot, "session.jsonl");
    const text = "{\"fixture\":true}\n";
    await writeFile(originPath, text, "utf8");

    const storage = new CCHistoryStorage({ dbPath });
    const payload = createFixturePayload(sourceId, "prune defer e2e", "stage-prune-defer-e2e", {
      baseDir: sourceRoot,
    });
    payload.blobs[0]!.origin_path = originPath;
    payload.blobs[0]!.captured_path = undefined;
    payload.blobs[0]!.checksum = "prune-defer-checksum";
    payload.blobs[0]!.size_bytes = Buffer.byteLength(text, "utf8");
    payload.blobs[0]!.file_identity_stable = true;
    storage.replaceSourcePayload(payload);
    storage.close();

    // Simulate the streaming hot path producing two orphan blobs across two
    // batches. Each "batch" is one force:false prune call (the no-op the
    // streaming merge would do) plus one direct INSERT into evidence_blobs
    // (the orphans the batch supposedly left behind).
    const orphanShas = [`${"a".repeat(63)}1`, `${"a".repeat(63)}2`];
    const rawDb = new DatabaseSync(dbPath);
    try {
      for (const sha of orphanShas) {
        rawDb.exec("BEGIN IMMEDIATE;");
        pruneUnreferencedEvidenceBlobsInTransaction(rawDb, { force: false });
        rawDb
          .prepare(
            "INSERT INTO evidence_blobs (sha256, storage_path, size_bytes, media_type, encoding, compression, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .run(sha, `evidence/blobs/aa/${sha}`, 16, "application/octet-stream", "identity", "none", "2026-07-01T00:00:00.000Z");
        rawDb.exec("COMMIT;");
      }
      const beforePrune = rawDb
        .prepare("SELECT COUNT(*) AS count FROM evidence_blobs WHERE sha256 IN (?, ?)")
        .get(orphanShas[0]!, orphanShas[1]!) as { count: number };
      assert.equal(beforePrune.count, 2, "force:false per-batch prunes must leave orphans intact");
    } finally {
      rawDb.close();
    }

    // End-of-sync hook — this is what the sync orchestrator must call.
    const pruner = new CCHistoryStorage({ dbPath });
    const result = pruner.pruneEvidenceBlobsNow();
    pruner.close();

    assert.equal(
      result.pruned_count,
      2,
      "pruneEvidenceBlobsNow must reclaim both deferred orphans in one pass",
    );
    for (const sha of orphanShas) {
      assert.ok(result.pruned_shas.includes(sha), `pruneEvidenceBlobsNow must drop ${sha}`);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

// Stage 1 follow-up: the sync hot path also runs through
// mergeSourcePayloadByOriginPath → writeStorageBoundaryV2Sidecars, which used
// to prune inline. skipPrune:true must thread the same force:false flag through
// that path so a non-batched source (e.g. claude_code on the operator store,
// observed at 211s for a single merge) doesn't pay the end-to-end LEFT JOIN
// per sync.
test("CCHistoryStorage.mergeSourcePayloadByOriginPath with skipPrune:true leaves orphans for pruneEvidenceBlobsNow", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-prune-defer-merge-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });

    const sourceId = "srcinst-codex-prune-defer-merge";
    const originPath = path.join(sourceRoot, "session.jsonl");
    const text = "{\"fixture\":true}\n";
    await writeFile(originPath, text, "utf8");

    const seed = new CCHistoryStorage({ dbPath });
    const seedPayload = createFixturePayload(sourceId, "prune defer merge", "stage-prune-defer-merge", {
      baseDir: sourceRoot,
    });
    seedPayload.blobs[0]!.origin_path = originPath;
    seedPayload.blobs[0]!.captured_path = undefined;
    seedPayload.blobs[0]!.checksum = "prune-defer-merge-checksum";
    seedPayload.blobs[0]!.size_bytes = Buffer.byteLength(text, "utf8");
    seedPayload.blobs[0]!.file_identity_stable = true;
    seed.replaceSourcePayload(seedPayload);
    seed.close();

    // Inject an orphan row, then re-open and call mergeSourcePayloadByOriginPath
    // with skipPrune:true. The orphan must survive — the merge call must not
    // run the end-to-end LEFT JOIN prune inline.
    const orphanSha = `${"b".repeat(63)}1`;
    const rawDb = new DatabaseSync(dbPath);
    try {
      rawDb.exec("BEGIN IMMEDIATE;");
      rawDb
        .prepare(
          "INSERT INTO evidence_blobs (sha256, storage_path, size_bytes, media_type, encoding, compression, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(orphanSha, `evidence/blobs/bb/${orphanSha}`, 16, "application/octet-stream", "identity", "none", "2026-07-01T00:00:00.000Z");
      rawDb.exec("COMMIT;");
    } finally {
      rawDb.close();
    }

    const storage = new CCHistoryStorage({ dbPath });
    const mergePayload = createFixturePayload(sourceId, "prune defer merge", "stage-prune-defer-merge", {
      baseDir: sourceRoot,
    });
    mergePayload.blobs[0]!.origin_path = originPath;
    mergePayload.blobs[0]!.captured_path = undefined;
    mergePayload.blobs[0]!.checksum = "prune-defer-merge-checksum";
    mergePayload.blobs[0]!.size_bytes = Buffer.byteLength(text, "utf8");
    mergePayload.blobs[0]!.file_identity_stable = true;
    storage.mergeSourcePayloadByOriginPath(mergePayload, {
      observed_origin_paths: [originPath],
      refreshDerived: false,
      skipPrune: true,
    });
    storage.close();

    const probeBefore = new DatabaseSync(dbPath);
    try {
      const beforePrune = probeBefore
        .prepare("SELECT COUNT(*) AS count FROM evidence_blobs WHERE sha256 = ?")
        .get(orphanSha) as { count: number };
      assert.equal(beforePrune.count, 1, "skipPrune:true must leave the orphan intact through writeStorageBoundaryV2Sidecars");
    } finally {
      probeBefore.close();
    }

    const pruner = new CCHistoryStorage({ dbPath });
    const result = pruner.pruneEvidenceBlobsNow();
    pruner.close();
    assert.equal(result.pruned_count, 1, "pruneEvidenceBlobsNow must reclaim the deferred orphan");
    assert.ok(result.pruned_shas.includes(orphanSha), "pruneEvidenceBlobsNow must drop the merge-deferred orphan");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("CCHistoryStorage.replaceSourcePayload with skipPrune:true leaves orphans for pruneEvidenceBlobsNow", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-prune-defer-replace-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });

    const sourceId = "srcinst-codex-prune-defer-replace";
    const originPath = path.join(sourceRoot, "session.jsonl");
    const text = "{\"fixture\":true}\n";
    await writeFile(originPath, text, "utf8");

    const seed = new CCHistoryStorage({ dbPath });
    const seedPayload = createFixturePayload(sourceId, "prune defer replace", "stage-prune-defer-replace", {
      baseDir: sourceRoot,
    });
    seedPayload.blobs[0]!.origin_path = originPath;
    seedPayload.blobs[0]!.captured_path = undefined;
    seedPayload.blobs[0]!.checksum = "prune-defer-replace-checksum";
    seedPayload.blobs[0]!.size_bytes = Buffer.byteLength(text, "utf8");
    seedPayload.blobs[0]!.file_identity_stable = true;
    seed.replaceSourcePayload(seedPayload);
    seed.close();

    const orphanSha = `${"c".repeat(63)}1`;
    const rawDb = new DatabaseSync(dbPath);
    try {
      rawDb.exec("BEGIN IMMEDIATE;");
      rawDb
        .prepare(
          "INSERT INTO evidence_blobs (sha256, storage_path, size_bytes, media_type, encoding, compression, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(orphanSha, `evidence/blobs/cc/${orphanSha}`, 16, "application/octet-stream", "identity", "none", "2026-07-01T00:00:00.000Z");
      rawDb.exec("COMMIT;");
    } finally {
      rawDb.close();
    }

    const storage = new CCHistoryStorage({ dbPath });
    const replacePayload = createFixturePayload(sourceId, "prune defer replace", "stage-prune-defer-replace", {
      baseDir: sourceRoot,
    });
    replacePayload.blobs[0]!.origin_path = originPath;
    replacePayload.blobs[0]!.captured_path = undefined;
    replacePayload.blobs[0]!.checksum = "prune-defer-replace-checksum";
    replacePayload.blobs[0]!.size_bytes = Buffer.byteLength(text, "utf8");
    replacePayload.blobs[0]!.file_identity_stable = true;
    storage.replaceSourcePayload(replacePayload, {
      refreshDerived: false,
      skipPrune: true,
    });
    storage.close();

    const probeBefore = new DatabaseSync(dbPath);
    try {
      const beforePrune = probeBefore
        .prepare("SELECT COUNT(*) AS count FROM evidence_blobs WHERE sha256 = ?")
        .get(orphanSha) as { count: number };
      assert.equal(beforePrune.count, 1, "skipPrune:true must leave the orphan intact through writeStorageBoundaryV2Sidecars on replace");
    } finally {
      probeBefore.close();
    }

    const pruner = new CCHistoryStorage({ dbPath });
    const result = pruner.pruneEvidenceBlobsNow();
    pruner.close();
    assert.equal(result.pruned_count, 1, "pruneEvidenceBlobsNow must reclaim the replace-deferred orphan");
    assert.ok(result.pruned_shas.includes(orphanSha), "pruneEvidenceBlobsNow must drop the replace-deferred orphan");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
