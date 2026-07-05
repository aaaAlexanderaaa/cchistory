import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runCliCapture, seedCliFixtures } from "./helpers.js";

async function withSeededStore(
  fn: (storeDir: string, tempRoot: string) => Promise<void>,
): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-shortcuts-"));
  const originalHome = process.env.HOME;
  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");
    const syncResult = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);
    await fn(storeDir, tempRoot);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test("today is a shortcut for stats --today", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    const result = await runCliCapture(["today", "--store", storeDir], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Window\s+:\s+since start of today/);
  });
});

test("today --week overrides the default --today window", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    const result = await runCliCapture(["today", "--week", "--store", storeDir], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Window\s+:\s+since start of week/);
  });
});

test("today --by model returns a stats-usage payload keyed on dimension", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    const result = await runCliCapture(["today", "--by", "model", "--store", storeDir, "--json"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.kind, "stats-usage");
    assert.equal(payload.dimension, "model");
    assert.equal(payload.window.label, "since start of today");
  });
});

test("last without a ref resumes the most recently active project", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    const result = await runCliCapture(["last", "--store", storeDir], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Resume:/);
    assert.match(result.stdout, /Latest turn/);
    assert.match(result.stdout, /cchistory tui --turn/);
  });
});

test("last with a ref behaves like resume <ref>", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    const lsResult = await runCliCapture(["ls", "projects", "--store", storeDir, "--json"], tempRoot);
    const lsPayload = JSON.parse(lsResult.stdout) as { projects: Array<{ slug?: string }> };
    const slug = lsPayload.projects[0]!.slug!;

    const result = await runCliCapture(["last", slug, "--store", storeDir], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Resume:/);
  });
});

test("last surfaces a non-zero exit when there is no store to read", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-last-empty-"));
  try {
    // No fixtures seeded; storage will report store-not-found.
    const result = await runCliCapture(["last", "--store", tempRoot], tempRoot);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /(No projects are indexed yet|Store not found|Hint:)/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("resume --tui and last --tui are refused under --non-interactive", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    const lsResult = await runCliCapture(["ls", "projects", "--store", storeDir, "--json"], tempRoot);
    const lsPayload = JSON.parse(lsResult.stdout) as { projects: Array<{ slug?: string }> };
    const slug = lsPayload.projects[0]!.slug!;

    const resumeResult = await runCliCapture(
      ["resume", slug, "--tui", "--non-interactive", "--store", storeDir],
      tempRoot,
    );
    assert.equal(resumeResult.exitCode, 2, resumeResult.stderr);
    assert.match(resumeResult.stderr, /Refusing to launch the TUI under --non-interactive/);

    const lastResult = await runCliCapture(
      ["last", "--tui", "--agent", "--store", storeDir],
      tempRoot,
    );
    assert.equal(lastResult.exitCode, 2, lastResult.stderr);
    assert.match(lastResult.stderr, /Refusing to launch the TUI under --non-interactive/);
  });
});
