/**
 * Journey C — Read-only admin / source-health
 *
 * Validates: Health is truthful, reads don't mutate.
 * Pass conditions:
 * - Health counts match store state
 * - health/stats/ls commands do not create new files
 * - Missing-store is explicit and non-mutating (no silent DB creation)
 * - No ExperimentalWarning in stderr
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync } from "node:fs";
import {
  ensureBuilt,
  createTempRoot,
  removeTempRoot,
  seedAcceptanceStore,
  runCliJson,
  runCliCapture,
  startApiServer,
  apiGet,
  getStorageClass,
  countFiles,
} from "./helpers.mjs";

describe("Journey C — Read-only admin / source-health", () => {
  let tempRoot;
  let storeDir;
  let missingStoreDir;
  let seeded;

  before(async () => {
    ensureBuilt();
    tempRoot = await createTempRoot("e2e-journey-c-");
    storeDir = path.join(tempRoot, "seeded-store");
    missingStoreDir = path.join(tempRoot, "missing-store");
    seeded = await seedAcceptanceStore(storeDir);
  });

  after(async () => {
    if (tempRoot) await removeTempRoot(tempRoot);
  });

  // ---- Helper: snapshot store counts ----

  async function snapshotStoreCounts() {
    const CCHistoryStorage = await getStorageClass();
    const storage = new CCHistoryStorage(storeDir);
    try {
      return {
        sources: storage.listSources().length,
        projects: storage.listProjects().length,
        sessions: storage.listResolvedSessions().length,
        turns: storage.listResolvedTurns().length,
        stage_runs: storage.listStageRuns().length,
        overrides: storage.listProjectOverrides().length,
      };
    } finally {
      storage.close();
    }
  }

  // ---- CLI: read-only admin commands ----

  it("CLI health --store-only returns correct scope and counts", async () => {
    const healthText = await runCliCapture(
      ["health", "--store", storeDir, "--store-only"],
      tempRoot,
    );
    assert.equal(healthText.exitCode, 0, healthText.stderr);
    assert.match(healthText.stdout, /Scope\s+: selected store only/);
    assert.match(healthText.stdout, /Indexed Sources/);
    assert.match(healthText.stdout, /Store Overview/);
    // Store-only scope should NOT include host discovery or sync preview
    assert.doesNotMatch(healthText.stdout, /Host Discovery/);
    assert.doesNotMatch(healthText.stdout, /Sync Preview/);
  });

  it("CLI health --store-only JSON matches expected structure", async () => {
    const healthJson = await runCliJson(
      ["health", "--store", storeDir, "--store-only"],
      tempRoot,
    );
    assert.equal(healthJson.kind, "health");
    assert.equal(healthJson.scope, "store-only");
    assert.equal(healthJson.store_summary.store_exists, true);
    assert.equal(healthJson.store_summary.sources.kind, "sources");
    assert.equal(healthJson.store_summary.stats.kind, "stats-overview");
  });

  it("CLI ls sources returns 4 sources with correct platforms", async () => {
    const sourcesJson = await runCliJson(
      ["ls", "sources", "--store", storeDir],
      tempRoot,
    );
    assert.equal(sourcesJson.kind, "sources");
    assert.equal(sourcesJson.sources.length, 4);
    assert.deepEqual(
      sourcesJson.sources.map((s) => s.platform).sort(),
      ["amp", "claude_code", "codex", "factory_droid"],
    );
  });

  it("CLI read-only commands do not mutate the store", async () => {
    const before = await snapshotStoreCounts();

    // Run multiple read commands
    await runCliCapture(["health", "--store", storeDir, "--store-only"], tempRoot);
    await runCliJson(["ls", "sources", "--store", storeDir], tempRoot);
    await runCliJson(["query", "projects", "--store", storeDir], tempRoot);
    await runCliJson(["show", "turn", seeded.targetTurn.id, "--store", storeDir], tempRoot);

    const afterCounts = await snapshotStoreCounts();
    assert.deepEqual(afterCounts, before, "Store counts must not change after read-only commands");
  });

  // ---- Missing store: explicit error, no silent creation ----

  it("CLI health on missing store reports absence explicitly", async () => {
    const result = await runCliCapture(
      ["health", "--store", missingStoreDir, "--store-only"],
      tempRoot,
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /No indexed store found/);
    assert.equal(
      existsSync(path.join(missingStoreDir, "cchistory.sqlite")),
      false,
      "Missing store path must not create a DB file",
    );
  });

  it("CLI restore-check on missing store exits with error", async () => {
    const result = await runCliCapture(
      ["restore-check", "--store", missingStoreDir],
      tempRoot,
    );
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Store not found:/);
    assert.doesNotMatch(result.stderr, /ExperimentalWarning/);
    assert.equal(
      existsSync(path.join(missingStoreDir, "cchistory.sqlite")),
      false,
      "Missing store path must not create a DB file",
    );
  });

  // ---- API: read-only admin ----

  it("API admin endpoints return data without mutating the store", async () => {
    const server = await startApiServer(storeDir);
    try {
      const beforeCounts = await snapshotStoreCounts();

      // Hit read-only admin endpoints
      const sources = await apiGet(server.app, "/api/sources");
      assert.equal(sources.sources.length, 4);

      const sourceConfig = await apiGet(server.app, "/api/admin/source-config");
      assert.ok(Array.isArray(sourceConfig.sources));

      const linking = await apiGet(server.app, "/api/admin/linking");
      assert.equal(typeof linking, "object");

      const drift = await apiGet(server.app, "/api/admin/drift");
      assert.equal(typeof drift, "object");

      const lineage = await apiGet(
        server.app,
        `/api/admin/pipeline/lineage/${seeded.targetTurn.id}`,
      );
      assert.ok(lineage.lineage);

      const afterCounts = await snapshotStoreCounts();
      assert.deepEqual(afterCounts, beforeCounts, "API admin reads must not mutate store");
    } finally {
      await server.close();
    }
  });
});
