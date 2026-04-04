import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runCliCapture, seedCliFixtures } from "./helpers.js";

test("export project produces a standalone JSON bundle", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-export-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");
    const exportDir = path.join(tempRoot, "export");

    await runCliCapture(["sync", "--store", storeDir], tempRoot);
    const result = await runCliCapture(["export", "project", "all", "--store", storeDir, "--out", exportDir], tempRoot);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Bundle/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("backup/restore creates and recovers full sqlite database dumps", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-backup-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");
    const backupFile = path.join(tempRoot, "backup.sqlite");

    await runCliCapture(["sync", "--store", storeDir], tempRoot);
    const backupResult = await runCliCapture(["backup", "--store", storeDir, "--write", "--out", backupFile], tempRoot);

    assert.equal(backupResult.exitCode, 0);
    assert.match(backupResult.stdout, /Bundle/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});
