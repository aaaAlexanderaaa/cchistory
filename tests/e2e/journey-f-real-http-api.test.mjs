/**
 * Journey F — Short-lived real HTTP API parity
 *
 * Validates: CLI/API read parity over a real ephemeral TCP listener, without
 * requiring user-started persistent services.
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
  startApiHttpServer,
  apiFetchJson,
} from "./helpers.mjs";

describe("Journey F — real HTTP API parity", () => {
  let tempRoot;
  let storeDir;
  let seeded;
  let childEnv;

  before(async () => {
    ensureBuilt();
    tempRoot = await createTempRoot("e2e-journey-f-");
    storeDir = path.join(tempRoot, "store");
    childEnv = { ...process.env, HOME: tempRoot };
    seeded = await seedAcceptanceStore(storeDir);
  });

  after(async () => {
    if (tempRoot) await removeTempRoot(tempRoot);
  });

  it("short-lived HTTP listener agrees with built CLI search and project reads", async () => {
    const cliSearch = await runCliJson(["search", "Alpha traceability target", "--store", storeDir], tempRoot, childEnv);
    const cliHit = cliSearch.results.find((result) => result.turn.id === seeded.targetTurn.id);
    assert.ok(cliHit, "expected built CLI to find seeded target turn");

    const server = await startApiHttpServer(storeDir);
    try {
      const projectsBody = await apiFetchJson(server.baseUrl, "/api/projects");
      assert.ok(projectsBody.projects.some((project) => project.project_id === seeded.project.project_id));

      const searchBody = await apiFetchJson(
        server.baseUrl,
        `/api/turns/search?q=${encodeURIComponent("Alpha traceability target")}`,
      );
      const apiHit = searchBody.results.find((result) => result.turn.id === seeded.targetTurn.id);
      assert.ok(apiHit, "expected HTTP API to find seeded target turn");
      assert.equal(apiHit.turn.id, cliHit.turn.id);
      assert.equal(apiHit.project.project_id, cliHit.project.project_id);
      assert.equal(apiHit.session.id, cliHit.session.id);
    } finally {
      await server.close();
    }
  });
});
