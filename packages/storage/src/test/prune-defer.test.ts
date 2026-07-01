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
