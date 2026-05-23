import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileExists, runCliCapture, seedCliFixtures } from "./helpers.js";

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

test("preview and dry-run transfer workflows do not create target artifacts", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-portability-preview-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");
    const realBundleDir = path.join(tempRoot, "real-bundle");
    const exportPreviewDir = path.join(tempRoot, "export-preview");
    const backupPreviewDir = path.join(tempRoot, "backup-preview");
    const importPreviewStore = path.join(tempRoot, "import-preview-store");

    const syncResult = await runCliCapture(["sync", "--store", storeDir], tempRoot);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);

    const exportPreview = await runCliCapture(["export", "--store", storeDir, "--out", exportPreviewDir, "--dry-run"], tempRoot);
    assert.equal(exportPreview.exitCode, 0, exportPreview.stderr);
    assert.match(exportPreview.stdout, /Sources\s+:/);
    assert.equal(await fileExists(exportPreviewDir), false, "export --dry-run should not create the bundle directory");

    const backupPreview = await runCliCapture(["backup", "--store", storeDir, "--out", backupPreviewDir], tempRoot);
    assert.equal(backupPreview.exitCode, 0, backupPreview.stderr);
    assert.match(backupPreview.stdout, /Mode\s+:\s+preview/);
    assert.equal(await fileExists(backupPreviewDir), false, "backup without --write should not create the bundle directory");

    const exportWrite = await runCliCapture(["export", "--store", storeDir, "--out", realBundleDir], tempRoot);
    assert.equal(exportWrite.exitCode, 0, exportWrite.stderr);
    assert.equal(await fileExists(realBundleDir), true, "written export should create the bundle directory");

    const importPreview = await runCliCapture(["import", realBundleDir, "--store", importPreviewStore, "--dry-run"], tempRoot);
    assert.equal(importPreview.exitCode, 0, importPreview.stderr);
    assert.match(importPreview.stdout, /Would Import\s+:/);
    assert.equal(
      await fileExists(path.join(importPreviewStore, "cchistory.sqlite")),
      false,
      "import --dry-run into a missing store should not create sqlite files",
    );
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("merge is preview-first and rejects unsupported conflict modes", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-merge-preview-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const sourceStoreDir = path.join(tempRoot, "source-store");
    const targetStoreDir = path.join(tempRoot, "target-store");
    const targetDb = path.join(targetStoreDir, "cchistory.sqlite");

    const syncResult = await runCliCapture(["sync", "--store", sourceStoreDir, "--source", "codex"], tempRoot);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);

    const unsupportedConflictMode = await runCliCapture(
      [
        "merge",
        "--from", sourceStoreDir,
        "--to", targetStoreDir,
        "--on-conflict", "error",
      ],
      tempRoot,
    );
    assert.equal(unsupportedConflictMode.exitCode, 1);
    assert.equal(unsupportedConflictMode.stdout, "");
    assert.match(unsupportedConflictMode.stderr, /Invalid value for --on-conflict: error\. Expected one of skip, replace\./);
    assert.doesNotMatch(unsupportedConflictMode.stderr, /unable to open database|Store not found/);
    assert.equal(await fileExists(targetDb), false, "invalid merge options should not create the target database");

    const preview = await runCliCapture(
      [
        "merge",
        "--from", sourceStoreDir,
        "--to", targetStoreDir,
      ],
      tempRoot,
    );
    assert.equal(preview.exitCode, 0, preview.stderr);
    assert.match(preview.stdout, /Workflow\s+:\s+merge/);
    assert.match(preview.stdout, /Mode\s+:\s+preview/);
    assert.match(preview.stdout, /Would Import\s+:\s+1/);
    assert.equal(await fileExists(targetDb), false, "merge without --write should not create the target database");

    const writeResult = await runCliCapture(
      [
        "merge",
        "--from", sourceStoreDir,
        "--to", targetStoreDir,
        "--write",
      ],
      tempRoot,
    );
    assert.equal(writeResult.exitCode, 0, writeResult.stderr);
    assert.match(writeResult.stdout, /Mode\s+:\s+write/);
    assert.equal(await fileExists(targetDb), true, "merge --write should create the target database");
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("gc dry-run reports orphan raw files without deleting them", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-gc-preview-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");
    const orphanRaw = path.join(storeDir, "raw", "orphan", "snapshot.json");

    const syncResult = await runCliCapture(["sync", "--store", storeDir], tempRoot);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);
    await mkdir(path.dirname(orphanRaw), { recursive: true });
    await writeFile(orphanRaw, "{\"orphan\":true}\n", "utf8");

    const dryRun = await runCliCapture(["gc", "--store", storeDir, "--dry-run"], tempRoot);
    assert.equal(dryRun.exitCode, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /Dry Run\s+:\s+true/);
    assert.match(dryRun.stdout, /Would Delete Files\s+:\s+1/);
    assert.doesNotMatch(dryRun.stdout, /Deleted Files\s+:/);
    assert.equal(await fileExists(orphanRaw), true, "gc --dry-run should not delete orphan raw files");
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});
