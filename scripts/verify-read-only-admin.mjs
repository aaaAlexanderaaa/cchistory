import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { buildLocalTuiBrowser, CCHistoryStorage } from "../packages/storage/dist/index.js";
import { createApiRuntime } from "../apps/api/dist/app.js";
import { runTui } from "../apps/tui/dist/index.js";
import { createBrowserState, reduceBrowserState, renderBrowserSnapshot } from "../apps/tui/dist/browser.js";
import { seedAcceptanceStore } from "./verify-v1-seeded-acceptance.mjs";
import { createIo, runCliJson, runCliCapture } from "./lib/test-fixtures.mjs";

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-readonly-admin-"));

  try {
    const storeDir = path.join(tempRoot, "seeded-store");
    const missingStoreDir = path.join(tempRoot, "missing-store");
    const seeded = seedAcceptanceStore(storeDir);

    await verifyCliReadOnlyAdmin(storeDir, tempRoot, missingStoreDir, seeded);
    await verifyTuiReadOnlyAdmin(storeDir, tempRoot, missingStoreDir, seeded);
    await verifyApiReadOnlyAdmin(storeDir, seeded);

    console.log(`Read-only admin verification passed for ${seeded.project.display_name} (${seeded.project.project_id}).`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function verifyCliReadOnlyAdmin(storeDir, cwd, missingStoreDir, seeded) {
  const beforeCounts = snapshotStoreCounts(storeDir);

  const healthOutput = await runCliCapture(["health", "--store", storeDir, "--store-only"], cwd);
  assert.equal(healthOutput.exitCode, 0, healthOutput.stderr);
  assert.match(healthOutput.stdout, /Scope\s+: selected store only/);
  assert.match(healthOutput.stdout, /Indexed Sources/);
  assert.match(healthOutput.stdout, /Store Overview/);
  assert.doesNotMatch(healthOutput.stdout, /Host Discovery/);
  assert.doesNotMatch(healthOutput.stdout, /Sync Preview/);

  const healthJson = await runCliJson(["health", "--store", storeDir, "--store-only"], cwd);
  assert.equal(healthJson.kind, "health");
  assert.equal(healthJson.scope, "store-only");
  assert.equal(healthJson.store_summary.store_exists, true);
  assert.equal(healthJson.store_summary.sources.kind, "sources");
  assert.equal(healthJson.store_summary.stats.kind, "stats-overview");

  const sourcesJson = await runCliJson(["ls", "sources", "--store", storeDir], cwd);
  assert.equal(sourcesJson.kind, "sources");
  assert.equal(sourcesJson.sources.length, 4);
  assert.deepEqual(sourcesJson.sources.map((source) => source.platform).sort(), ["amp", "claude_code", "codex", "factory_droid"]);

  const missingOutput = await runCliCapture(["health", "--store", missingStoreDir, "--store-only"], cwd);
  assert.equal(missingOutput.exitCode, 0, missingOutput.stderr);
  assert.match(missingOutput.stdout, /Indexed Store/);
  assert.match(missingOutput.stdout, /No indexed store found/);
  assert.equal(existsSync(path.join(missingStoreDir, "cchistory.sqlite")), false);

  const afterCounts = snapshotStoreCounts(storeDir);
  assert.deepEqual(afterCounts, beforeCounts);
}

async function verifyTuiReadOnlyAdmin(storeDir, cwd, missingStoreDir, seeded) {
  const browserStorage = new CCHistoryStorage(storeDir);
  try {
    const browser = buildLocalTuiBrowser(browserStorage);
    let state = createBrowserState(browser);
    state = reduceBrowserState(browser, state, { type: "toggle-source-health" });
    const snapshot = renderBrowserSnapshot(browser, state);
    assert.match(snapshot, /Source Health:/);
    assert.match(snapshot, /Healthy=4/);
    assert.match(snapshot, /amp:turn-alpha-amp/);
    assert.match(snapshot, /factory_droid:turn-beta-factory/);
  } finally {
    browserStorage.close();
  }

  const { io, stderr } = createIo(cwd);
  const exitCode = await runTui(["--store", missingStoreDir], io);
  assert.equal(exitCode, 1);
  assert.match(stderr.join(""), /No indexed store found at .*cchistory\.sqlite\. Run `cchistory sync` or `cchistory import` first\./i);
  assert.equal(existsSync(path.join(missingStoreDir, "cchistory.sqlite")), false);
}

async function verifyApiReadOnlyAdmin(storeDir, seeded) {
  const runtime = await createApiRuntime({ dataDir: storeDir, sources: [] });

  try {
    const beforeCounts = snapshotRuntimeCounts(runtime.storage);
    const beforeRawCount = await countFiles(runtime.rawStoreDir);

    const sourcesResponse = await runtime.app.inject({ method: "GET", url: "/api/sources" });
    assert.equal(sourcesResponse.statusCode, 200);
    const sourcesBody = JSON.parse(sourcesResponse.body);
    assert.equal(sourcesBody.sources.length, 4);

    const sourceConfigResponse = await runtime.app.inject({ method: "GET", url: "/api/admin/source-config" });
    assert.equal(sourceConfigResponse.statusCode, 200);
    const sourceConfigBody = JSON.parse(sourceConfigResponse.body);
    assert.ok(Array.isArray(sourceConfigBody.sources));

    const linkingResponse = await runtime.app.inject({ method: "GET", url: "/api/admin/linking" });
    assert.equal(linkingResponse.statusCode, 200);
    const linkingBody = JSON.parse(linkingResponse.body);
    assert.equal(typeof linkingBody, "object");

    const driftResponse = await runtime.app.inject({ method: "GET", url: "/api/admin/drift" });
    assert.equal(driftResponse.statusCode, 200);
    const driftBody = JSON.parse(driftResponse.body);
    assert.equal(typeof driftBody, "object");

    const lineageResponse = await runtime.app.inject({ method: "GET", url: `/api/admin/pipeline/lineage/${seeded.targetTurn.id}` });
    assert.equal(lineageResponse.statusCode, 200);
    const lineageBody = JSON.parse(lineageResponse.body);
    assert.ok(lineageBody.lineage);

    const afterCounts = snapshotRuntimeCounts(runtime.storage);
    const afterRawCount = await countFiles(runtime.rawStoreDir);
    assert.deepEqual(afterCounts, beforeCounts);
    assert.equal(afterRawCount, beforeRawCount);
  } finally {
    await runtime.app.close();
    runtime.storage.close();
  }
}

function snapshotStoreCounts(storeDir) {
  const storage = new CCHistoryStorage(storeDir);
  try {
    return snapshotRuntimeCounts(storage);
  } finally {
    storage.close();
  }
}

function snapshotRuntimeCounts(storage) {
  return {
    sources: storage.listSources().length,
    projects: storage.listProjects().length,
    sessions: storage.listResolvedSessions().length,
    turns: storage.listResolvedTurns().length,
    stage_runs: storage.listStageRuns().length,
    overrides: storage.listProjectOverrides().length,
  };
}

async function countFiles(rootDir) {
  if (!existsSync(rootDir)) {
    return 0;
  }

  let total = 0;
  const entries = await readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const nextPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      total += await countFiles(nextPath);
      continue;
    }
    if (entry.isFile()) {
      const fileStat = await stat(nextPath);
      if (fileStat.size >= 0) {
        total += 1;
      }
    }
  }
  return total;
}

await main();
