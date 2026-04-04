/**
 * Journey D — Supply / restore readability
 *
 * Validates: Canonical objects survive export/import.
 * Pass conditions:
 * - Export produces a valid bundle directory with manifest.json
 * - Import into a clean store succeeds
 * - Sources, sessions, turns readable after restore
 * - Known recall path survives intact (search → turn detail → context)
 * - restore-check confirms readability
 * - CLI and API agree on restored data
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  ensureBuilt,
  createTempRoot,
  removeTempRoot,
  seedAcceptanceStore,
  runCliJson,
  runCliCapture,
  startApiServer,
  apiGet,
  fileExists,
} from "./helpers.mjs";

describe("Journey D — Supply / restore readability", () => {
  let tempRoot;
  let storeDir;
  let seeded;
  let bundleDir;
  let restoredStoreDir;

  before(async () => {
    ensureBuilt();
    tempRoot = await createTempRoot("e2e-journey-d-");
    storeDir = path.join(tempRoot, "seeded-store");
    bundleDir = path.join(tempRoot, "acceptance-bundle");
    restoredStoreDir = path.join(tempRoot, "restored-store");
    seeded = await seedAcceptanceStore(storeDir);
  });

  after(async () => {
    if (tempRoot) await removeTempRoot(tempRoot);
  });

  // ---- Export ----

  it("CLI export creates a valid bundle with manifest", async () => {
    const result = await runCliCapture(
      ["export", "--store", storeDir, "--out", bundleDir],
      tempRoot,
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(
      await fileExists(path.join(bundleDir, "manifest.json")),
      "Bundle must contain manifest.json",
    );
  });

  // ---- Import into clean store ----

  it("CLI import into clean store succeeds", async () => {
    // Ensure export has run (depends on test ordering within describe)
    if (!(await fileExists(path.join(bundleDir, "manifest.json")))) {
      await runCliCapture(["export", "--store", storeDir, "--out", bundleDir], tempRoot);
    }

    const result = await runCliCapture(
      ["import", bundleDir, "--store", restoredStoreDir],
      tempRoot,
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Imported Sources\s*:\s*\d+/);
  });

  // ---- Restored data readability (CLI) ----

  it("CLI restore-check confirms restored store is readable", async () => {
    const result = await runCliCapture(
      ["restore-check", "--store", restoredStoreDir],
      tempRoot,
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Restore Check/);
  });

  it("CLI restore-check JSON reports correct source count", async () => {
    const restoreCheck = await runCliJson(
      ["restore-check", "--store", restoredStoreDir],
      tempRoot,
    );
    assert.equal(restoreCheck.kind, "restore-check");
    assert.equal(restoreCheck.read_mode, "index");
    assert.equal(restoreCheck.stats.counts.sources, 4);
    assert.equal(restoreCheck.sources.sources.length, 4);
  });

  it("CLI can search and find the original target turn in restored store", async () => {
    const searchResults = await runCliJson(
      ["search", "Alpha traceability target", "--store", restoredStoreDir],
      tempRoot,
    );
    assert.equal(searchResults.kind, "search");
    assert.equal(searchResults.results.length, 1);
    assert.equal(searchResults.results[0].turn.id, seeded.targetTurn.id);
  });

  it("CLI show turn on restored store returns context intact", async () => {
    const turnDetail = await runCliJson(
      ["show", "turn", seeded.targetTurn.id, "--store", restoredStoreDir],
      tempRoot,
    );
    assert.equal(turnDetail.turn.project_id, seeded.project.project_id);
    assert.match(turnDetail.turn.canonical_text, /Alpha traceability target/);
    assert.equal(turnDetail.context?.assistant_replies.length, 1);
    assert.equal(turnDetail.context?.tool_calls.length, 1);
  });

  // ---- Restored data readability (API) ----

  it("API finds the same project in restored store", async () => {
    const server = await startApiServer(restoredStoreDir);
    try {
      const body = await apiGet(server.app, "/api/projects");
      assert.ok(
        body.projects.some((p) => p.project_id === seeded.project.project_id),
        "API should find the original project in restored store",
      );
    } finally {
      await server.close();
    }
  });

  it("API turn detail in restored store matches original", async () => {
    const server = await startApiServer(restoredStoreDir);
    try {
      const turnBody = await apiGet(server.app, `/api/turns/${seeded.targetTurn.id}`);
      assert.equal(turnBody.turn.project_id, seeded.project.project_id);
      assert.match(turnBody.turn.canonical_text, /Alpha traceability target/);

      const contextBody = await apiGet(server.app, `/api/turns/${seeded.targetTurn.id}/context`);
      assert.equal(contextBody.context.assistant_replies.length, 1);
      assert.equal(contextBody.context.tool_calls.length, 1);
    } finally {
      await server.close();
    }
  });

  // ---- Cross-surface consistency on restored data ----

  it("CLI and API return the same canonical_text from restored store", async () => {
    const cliTurn = await runCliJson(
      ["show", "turn", seeded.targetTurn.id, "--store", restoredStoreDir],
      tempRoot,
    );

    const server = await startApiServer(restoredStoreDir);
    try {
      const apiTurn = await apiGet(server.app, `/api/turns/${seeded.targetTurn.id}`);
      assert.equal(cliTurn.turn.canonical_text, apiTurn.turn.canonical_text);
      assert.equal(cliTurn.turn.project_id, apiTurn.turn.project_id);
    } finally {
      await server.close();
    }
  });
});
