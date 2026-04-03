import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { CCHistoryStorage } from "../index.js";
import { createFixturePayload } from "./helpers.js";

test("deleteProject removes project data and leaves a tombstone", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-delete-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const payload = createFixturePayload("src-1", "Delete me", "sr-1", {
      projectObservation: {
        workspacePath: "/workspace/delete-me",
        repoFingerprint: "fp-delete",
      },
    });
    storage.replaceSourcePayload(payload);

    const project = storage.listProjects()[0]!;
    const projectId = project.project_id;

    storage.deleteProject(projectId, "cleanup");

    assert.equal(storage.getProject(projectId), undefined);
    assert.equal(storage.getTombstone(projectId)?.purge_reason, "cleanup");
    assert.equal(storage.listTurns().length, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("fresh storage is empty", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-fresh-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    assert.equal(storage.isEmpty(), true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("garbageCollectCandidateTurns with purge mode creates tombstones", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-gc-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(createFixturePayload("src-1", "GC test", "sr-1"));
    const turnId = "turn-1";

    const result = (storage as any).garbageCollectCandidateTurns({
      mode: "purge",
      reason: "gc_test",
    });

    assert.equal(result.purged_count, 1);
    assert.equal(storage.getTurn(turnId), undefined);
    assert.equal(storage.getTombstone(turnId)?.purge_reason, "gc_test");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("purgeTurn is idempotent - second purge returns existing tombstone", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-purge-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(createFixturePayload("src-1", "Purge test", "sr-1"));
    const turnId = "turn-1";

    storage.purgeTurn(turnId, "test_purge_1");
    const t1 = storage.getTombstone(turnId);
    assert.equal(t1?.purge_reason, "test_purge_1");

    storage.purgeTurn(turnId, "test_purge_2");
    const t2 = storage.getTombstone(turnId);
    assert.equal(t2?.purge_reason, "test_purge_1", "Original tombstone should be preserved");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
