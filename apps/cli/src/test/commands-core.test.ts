import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runCliCapture, seedCliFixtures } from "./helpers.js";

test("help groups search pagination flags under search, not project context", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-help-"));

  try {
    const result = await runCliCapture([], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    const searchIndex = result.stdout.indexOf("search <query>");
    const contextIndex = result.stdout.indexOf("context project <ref>");
    const limitIndex = result.stdout.indexOf("--limit <n>");
    const offsetIndex = result.stdout.indexOf("--offset <n>");
    const allIndex = result.stdout.indexOf("--all");
    const statsIndex = result.stdout.indexOf("stats");
    const statsByIndex = result.stdout.indexOf("--by <dimension>");

    assert.ok(searchIndex >= 0, "help should include search row");
    assert.ok(contextIndex > searchIndex, "context row should appear after search row");
    assert.ok(limitIndex > searchIndex && limitIndex < contextIndex, "search --limit should be grouped under search");
    assert.ok(offsetIndex > searchIndex && offsetIndex < contextIndex, "search --offset should be grouped under search");
    assert.ok(allIndex > searchIndex && allIndex < contextIndex, "search --all should be grouped under search");
    assert.match(result.stdout.slice(contextIndex), /Max recent asks\/sessions for context/);
    assert.ok(statsByIndex > statsIndex, "stats --by dimensions should be visible from global help");
    assert.match(result.stdout, /Run `cchistory help <command>` for command-specific options and examples\./);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

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

    const allStatsResult = await runCliCapture(["stats", "--store", storeDir, "--json"], tempRoot);
    assert.equal(allStatsResult.exitCode, 0, allStatsResult.stderr);
    const allStats = JSON.parse(allStatsResult.stdout);
    const codexStatsResult = await runCliCapture(["stats", "--store", storeDir, "--source", "codex", "--json"], tempRoot);
    assert.equal(codexStatsResult.exitCode, 0, codexStatsResult.stderr);
    const codexStats = JSON.parse(codexStatsResult.stdout);
    assert.ok(allStats.counts.sources > codexStats.counts.sources, "source-filtered stats should narrow source counts");
    assert.equal(codexStats.counts.sources, 1);
    assert.equal(codexStats.source_scope.length, 1);
    assert.match(codexStats.source_scope[0], /codex/);
    const codexStatsText = await runCliCapture(["stats", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(codexStatsText.exitCode, 0, codexStatsText.stderr);
    assert.match(codexStatsText.stdout, /Source Scope\s+:\s+Codex \(codex\)/);

    const codexUsageResult = await runCliCapture(["stats", "--store", storeDir, "--source", "codex", "--by", "source", "--json"], tempRoot);
    assert.equal(codexUsageResult.exitCode, 0, codexUsageResult.stderr);
    const codexUsage = JSON.parse(codexUsageResult.stdout);
    assert.equal(codexUsage.rollup.rows.length, 1);
    assert.deepEqual(codexUsage.source_scope, codexStats.source_scope);
    assert.match(codexUsage.rollup.rows[0].label, /Codex/);
    const codexUsageText = await runCliCapture(["stats", "--store", storeDir, "--source", "codex", "--by", "model"], tempRoot);
    assert.equal(codexUsageText.exitCode, 0, codexUsageText.stderr);
    assert.match(codexUsageText.stdout, /Source Scope\s+:\s+Codex \(codex\)/);
    assert.match(codexUsageText.stdout, /Cached/);
    assert.match(codexUsageText.stdout, /Input\s+Cached\s+Output/);
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

test("default store uses one home-anchored path across working directories", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-store-fallback-"));
  const originalHome = process.env.HOME;
  try {
    const homeDir = path.join(tempRoot, "home");
    const projectRoot = path.join(tempRoot, "workspace");
    process.env.HOME = homeDir;
    const workDirA = path.join(projectRoot, "work-a");
    const workDirB = path.join(projectRoot, "work-b");
    await mkdir(path.join(projectRoot, ".cchistory"), { recursive: true });
    await mkdir(workDirA, { recursive: true });
    await mkdir(workDirB, { recursive: true });

    const resA = await runCliCapture(["sync", "--dry-run"], workDirA);
    const resB = await runCliCapture(["sync", "--dry-run"], workDirB);

    assert.match(resA.stdout, new RegExp(path.join(homeDir, ".cchistory", "cchistory.sqlite").replace(/\\/g, "\\\\")));
    assert.match(resB.stdout, new RegExp(path.join(homeDir, ".cchistory", "cchistory.sqlite").replace(/\\/g, "\\\\")));
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("default store sync remains readable across working directories", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-store-readable-"));
  const originalHome = process.env.HOME;
  try {
    const homeDir = path.join(tempRoot, "home");
    await seedCliFixtures(homeDir);
    process.env.HOME = homeDir;
    const workDirA = path.join(tempRoot, "work-a");
    const workDirB = path.join(tempRoot, "work-b");
    await mkdir(workDirA, { recursive: true });
    await mkdir(workDirB, { recursive: true });

    const syncResult = await runCliCapture(["sync", "--source", "codex"], workDirA);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);
    assert.match(syncResult.stdout, /Synced 1 source\(s\)/);

    const sourcesResult = await runCliCapture(["ls", "sources", "--json"], workDirB);
    assert.equal(sourcesResult.exitCode, 0, sourcesResult.stderr);
    const sourcesPayload = JSON.parse(sourcesResult.stdout);
    assert.equal(sourcesPayload.kind, "sources");
    assert.match(sourcesPayload.db_path, new RegExp(path.join(homeDir, ".cchistory", "cchistory.sqlite").replace(/\\/g, "\\\\")));
    assert.equal(sourcesPayload.sources.length, 1);
    assert.equal(sourcesPayload.sources[0].platform, "codex");
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

    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /healthy/);

    const sourcesJsonResult = await runCliCapture(["ls", "sources", "--store", storeDir, "--json"], tempRoot);
    assert.equal(sourcesJsonResult.exitCode, 0, sourcesJsonResult.stderr);
    const sourcesPayload = JSON.parse(sourcesJsonResult.stdout);
    assert.equal(sourcesPayload.kind, "sources");
    assert.ok(sourcesPayload.sources.every((source: { sync_status?: string }) => source.sync_status === "healthy"));

    const healthJsonResult = await runCliCapture(["health", "--store", storeDir, "--store-only", "--json"], tempRoot);
    assert.equal(healthJsonResult.exitCode, 0, healthJsonResult.stderr);
    const healthPayload = JSON.parse(healthJsonResult.stdout);
    assert.equal(healthPayload.kind, "health");
    assert.equal(healthPayload.scope, "store-only");
    assert.equal(healthPayload.discovery, null);
    assert.equal(healthPayload.sync_preview, null);
    assert.equal(healthPayload.store_summary.sources.kind, "sources");
    assert.equal(healthPayload.store_summary.stats.kind, "stats-overview");
    assert.equal(healthPayload.store_summary.stats.counts.sources, sourcesPayload.sources.length);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});
