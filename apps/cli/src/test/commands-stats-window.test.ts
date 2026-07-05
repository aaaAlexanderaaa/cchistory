import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runCliCapture, seedCliFixtures } from "./helpers.js";
import { startOfMonth, startOfToday, startOfWeek } from "../time-window.js";

async function withSeededStore(
  fn: (storeDir: string, tempRoot: string) => Promise<void>,
): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-stats-window-"));
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

test("stats --today adds a Window line and emits after_date in JSON", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    const textResult = await runCliCapture(["stats", "--today", "--store", storeDir], tempRoot);
    assert.equal(textResult.exitCode, 0, textResult.stderr);
    assert.match(textResult.stdout, /Window\s+:\s+since start of today/);

    const jsonResult = await runCliCapture(["stats", "--today", "--store", storeDir, "--json"], tempRoot);
    assert.equal(jsonResult.exitCode, 0, jsonResult.stderr);
    const payload = JSON.parse(jsonResult.stdout);
    assert.equal(payload.schema_version, 1);
    assert.equal(payload.window.label, "since start of today");
    // after_date is a local-day YYYY-MM-DD so it can be matched against row.day
    // in the storage layer; it must equal startOfToday() exactly.
    assert.match(payload.window.after_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(payload.window.after_date, startOfToday());
  });
});

test("stats --week and --month resolve to the corresponding local-start dates", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    const week = await runCliCapture(["stats", "--week", "--store", storeDir, "--json"], tempRoot);
    assert.equal(week.exitCode, 0, week.stderr);
    const weekPayload = JSON.parse(week.stdout);
    assert.equal(weekPayload.window.label, "since start of week");
    assert.match(weekPayload.window.after_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(weekPayload.window.after_date, startOfWeek());

    const month = await runCliCapture(["stats", "--month", "--store", storeDir, "--json"], tempRoot);
    assert.equal(month.exitCode, 0, month.stderr);
    const monthPayload = JSON.parse(month.stdout);
    assert.equal(monthPayload.window.label, "since start of month");
    assert.match(monthPayload.window.after_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(monthPayload.window.after_date, startOfMonth());
  });
});

test("stats --since 7d accepts relative windows and surfaces them in the Window label", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    const result = await runCliCapture(["stats", "--since", "7d", "--store", storeDir], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Window\s+:\s+since 7d/);
  });
});

test("stats --since accepts ISO timestamps", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    const iso = "2026-01-01T00:00:00Z";
    const result = await runCliCapture(["stats", "--since", iso, "--store", storeDir, "--json"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.window.label, `since ${iso}`);
    // The storage filter is date-granularity, so after_date collapses to the
    // local-day YYYY-MM-DD of the parsed instant.
    assert.match(payload.window.after_date, /^\d{4}-\d{2}-\d{2}$/);
  });
});

test("stats rejects --today combined with --week or --since", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    const both = await runCliCapture(["stats", "--today", "--week", "--store", storeDir], tempRoot);
    assert.equal(both.exitCode, 2, both.stderr);
    assert.match(both.stderr, /Choose at most one of --today \/ --week \/ --month/);

    const withSince = await runCliCapture(["stats", "--today", "--since", "7d", "--store", storeDir], tempRoot);
    assert.equal(withSince.exitCode, 2, withSince.stderr);
    assert.match(withSince.stderr, /Choose either a --since window or one of --today \/ --week \/ --month/);
  });
});

test("stats rejects a malformed --since value with exit code 2", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    const result = await runCliCapture(["stats", "--since", "not-a-time", "--store", storeDir], tempRoot);
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /Invalid --since value/);
  });
});

test("stats usage --by day --since 7d threads the window into the rollup output", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    const result = await runCliCapture(
      ["stats", "usage", "--by", "day", "--since", "7d", "--store", storeDir, "--json"],
      tempRoot,
    );
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.kind, "stats-usage");
    assert.equal(payload.dimension, "day");
    assert.equal(payload.window.label, "since 7d");
    assert.ok(payload.window.after_date, "after_date must be present in window");
  });
});

test("stats --since with a future date filters all sessions and turns out of the overview counts", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    // 7d ahead of any fixture's submission timestamps.
    const future = "2999-01-01T00:00:00Z";
    const result = await runCliCapture(["stats", "--since", future, "--store", storeDir, "--json"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.kind, "stats-overview");
    // Windowed counts must all be zero — every fixture turn predates the cutoff.
    assert.equal(payload.counts.sessions, 0);
    assert.equal(payload.counts.turns, 0);
    assert.equal(payload.counts.projects, 0);
    // Token totals come from the same windowed filter, so they also collapse.
    assert.equal(payload.overview.total_turns, 0);
  });
});

test("stats overview without a window still reports all-time counts", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    const result = await runCliCapture(["stats", "--store", storeDir, "--json"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.kind, "stats-overview");
    assert.ok(payload.counts.turns > 0, "all-time turn count should be non-zero");
  });
});
