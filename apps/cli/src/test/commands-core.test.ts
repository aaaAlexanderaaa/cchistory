import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runCliCapture, seedCliFixtures } from "./helpers.js";

test("sync, ls, search, and stats usage render human-readable output for real source shapes", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    const syncResult = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--source", "claude_code"], tempRoot);
    assert.equal(syncResult.exitCode, 0);
    assert.match(syncResult.stdout, /Synced 2 source\(s\)/);

    const listResult = await runCliCapture(["ls", "sources", "--store", storeDir], tempRoot);
    assert.equal(listResult.exitCode, 0);
    assert.match(listResult.stdout, /Source/);
    assert.match(listResult.stdout, /Codex/);
    assert.match(listResult.stdout, /Claude Code/);

    const longProjectsResult = await runCliCapture(["ls", "projects", "--store", storeDir, "--long"], tempRoot);
    assert.equal(longProjectsResult.exitCode, 0, longProjectsResult.stderr);
    assert.match(longProjectsResult.stdout, /Source Mix/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("pnpm-style leading -- is ignored before the command name", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  try {
    const result = await runCliCapture(["--", "discover", "--showall"], tempRoot);
    // Should not fail or complain about unknown option '--'
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Codex|Claude|Cursor/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("default store falls back to one home-anchored path across working directories", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-store-fallback-"));
  const originalHome = process.env.HOME;
  try {
    process.env.HOME = tempRoot;
    const workDirA = path.join(tempRoot, "work-a");
    const workDirB = path.join(tempRoot, "work-b");

    // Both should refer to the same default store in HOME
    const resA = await runCliCapture(["sync", "--dry-run"], workDirA);
    const resB = await runCliCapture(["sync", "--dry-run"], workDirB);

    assert.match(resA.stdout, new RegExp(path.join(tempRoot, ".cchistory", "cchistory.sqlite").replace(/\\/g, "\\\\")));
    assert.match(resB.stdout, new RegExp(path.join(tempRoot, ".cchistory", "cchistory.sqlite").replace(/\\/g, "\\\\")));
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("ls sources includes sync healthy/stale indicators", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-ls-sources-"));
  const originalHome = process.env.HOME;
  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");

    await runCliCapture(["sync", "--store", storeDir], tempRoot);
    const result = await runCliCapture(["ls", "sources", "--store", storeDir], tempRoot);

    assert.match(result.stdout, /healthy/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});
