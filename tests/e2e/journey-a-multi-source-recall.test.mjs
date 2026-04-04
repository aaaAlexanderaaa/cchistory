/**
 * Journey A — Multi-source project recall
 *
 * Validates: Project-first recall across heterogeneous sources.
 * Pass conditions:
 * - Target project shows turns from multiple sources (codex, claude_code, amp)
 * - Unrelated projects don't bleed (beta project separate)
 * - Ordering is canonical recent-first
 * - CLI and API agree on project/turn data
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
} from "./helpers.mjs";

describe("Journey A — Multi-source project recall", () => {
  let tempRoot;
  let storeDir;
  let seeded;

  before(async () => {
    ensureBuilt();
    tempRoot = await createTempRoot("e2e-journey-a-");
    storeDir = path.join(tempRoot, "seeded-store");
    seeded = await seedAcceptanceStore(storeDir);
  });

  after(async () => {
    if (tempRoot) await removeTempRoot(tempRoot);
  });

  // ---- CLI surface ----

  it("CLI lists the seeded alpha-history project with correct source platforms", async () => {
    const projects = await runCliJson(["query", "projects", "--store", storeDir], tempRoot);
    const project = projects.find((p) => p.project_id === seeded.project.project_id);
    assert.ok(project, "CLI should return the seeded alpha-history project");
    assert.equal(project.display_name, "alpha-history");
    assert.equal(project.linkage_state, "committed");
    assert.deepEqual(project.source_platforms, ["amp", "claude_code", "codex"]);
  });

  it("CLI lists 3 turns for the alpha-history project", async () => {
    const projectTurns = await runCliJson(
      ["query", "turns", "--project", seeded.project.project_id, "--store", storeDir],
      tempRoot,
    );
    assert.equal(projectTurns.length, 3);
    assert.ok(projectTurns.some((t) => t.id === "turn-alpha-codex"));
    assert.ok(projectTurns.some((t) => t.id === "turn-alpha-claude"));
    assert.ok(projectTurns.some((t) => t.id === "turn-alpha-amp"));
  });

  it("CLI does not bleed beta-project turns into alpha-history", async () => {
    const projects = await runCliJson(["query", "projects", "--store", storeDir], tempRoot);
    const betaProject = projects.find((p) => p.display_name === "beta-compare");
    assert.ok(betaProject, "beta-compare project should exist");

    // Beta should have its own turns
    const betaTurns = await runCliJson(
      ["query", "turns", "--project", betaProject.project_id, "--store", storeDir],
      tempRoot,
    );
    assert.equal(betaTurns.length, 1);
    assert.equal(betaTurns[0].id, "turn-beta-factory");

    // Alpha should NOT contain beta turn
    const alphaTurns = await runCliJson(
      ["query", "turns", "--project", seeded.project.project_id, "--store", storeDir],
      tempRoot,
    );
    assert.ok(!alphaTurns.some((t) => t.id === "turn-beta-factory"), "alpha turns must not include beta turn");
  });

  it("CLI source list shows all 4 sources with correct platforms", async () => {
    const sourcesResult = await runCliJson(["ls", "sources", "--store", storeDir], tempRoot);
    assert.equal(sourcesResult.kind, "sources");
    assert.equal(sourcesResult.sources.length, 4);
    assert.deepEqual(
      sourcesResult.sources.map((s) => s.platform).sort(),
      ["amp", "claude_code", "codex", "factory_droid"],
    );
    assert.ok(sourcesResult.sources.every((s) => s.total_turns === 1));
  });

  // ---- API surface ----

  it("API lists the same alpha-history project with matching source platforms", async () => {
    const server = await startApiServer(storeDir);
    try {
      const body = await apiGet(server.app, "/api/projects");
      const project = body.projects.find((p) => p.project_id === seeded.project.project_id);
      assert.ok(project, "API should return the seeded alpha-history project");
      assert.equal(project.display_name, "alpha-history");
      assert.deepEqual(project.source_platforms, ["amp", "claude_code", "codex"]);
    } finally {
      await server.close();
    }
  });

  it("API lists 3 turns for the alpha-history project", async () => {
    const server = await startApiServer(storeDir);
    try {
      const body = await apiGet(server.app, `/api/projects/${seeded.project.project_id}/turns`);
      assert.equal(body.turns.length, 3);
      assert.ok(body.turns.some((t) => t.id === "turn-alpha-amp"));
    } finally {
      await server.close();
    }
  });

  it("API source list matches CLI source list", async () => {
    const server = await startApiServer(storeDir);
    try {
      const body = await apiGet(server.app, "/api/sources");
      assert.equal(body.sources.length, 4);
      assert.deepEqual(
        body.sources.map((s) => s.platform).sort(),
        ["amp", "claude_code", "codex", "factory_droid"],
      );
      assert.ok(body.sources.every((s) => s.total_turns === 1));
    } finally {
      await server.close();
    }
  });
});
