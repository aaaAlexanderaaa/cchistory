/**
 * Journey B — Search → traceability drill-down
 *
 * Validates: System is searchable AND traceable.
 * Pass conditions:
 * - Same turn_id across surfaces (CLI search → show turn → show session)
 * - Detail exposes canonical text + session/source cues
 * - Assistant/tool context attached
 * - CLI and API return consistent data for the same turn
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

describe("Journey B — Search → traceability drill-down", () => {
  let tempRoot;
  let storeDir;
  let seeded;

  before(async () => {
    ensureBuilt();
    tempRoot = await createTempRoot("e2e-journey-b-");
    storeDir = path.join(tempRoot, "seeded-store");
    seeded = await seedAcceptanceStore(storeDir);
  });

  after(async () => {
    if (tempRoot) await removeTempRoot(tempRoot);
  });

  // ---- CLI: Search → drill-down chain ----

  it("CLI search finds the target turn by canonical text", async () => {
    const searchResults = await runCliJson(
      ["search", "Alpha traceability target", "--store", storeDir],
      tempRoot,
    );
    assert.equal(searchResults.kind, "search");
    assert.equal(searchResults.query, "Alpha traceability target");
    assert.equal(searchResults.results.length, 1);

    const hit = searchResults.results[0];
    assert.equal(hit.turn.id, seeded.targetTurn.id);
    assert.equal(hit.turn.project_id, seeded.project.project_id);
    assert.equal(hit.turn.session_id, seeded.targetTurn.session_id);
  });

  it("CLI show turn returns full detail with context", async () => {
    const turnDetail = await runCliJson(
      ["show", "turn", seeded.targetTurn.id, "--store", storeDir],
      tempRoot,
    );
    assert.equal(turnDetail.turn.project_id, seeded.project.project_id);
    assert.equal(turnDetail.turn.session_id, seeded.targetTurn.session_id);
    assert.match(turnDetail.turn.canonical_text, /Alpha traceability target/);

    // Context attached
    assert.equal(turnDetail.context?.assistant_replies.length, 1);
    assert.equal(turnDetail.context?.tool_calls.length, 1);
    assert.equal(turnDetail.context.tool_calls[0].tool_name, "shell");
  });

  it("CLI show session links back to the same project and contains the target turn", async () => {
    const sessionDetail = await runCliJson(
      ["show", "session", seeded.targetTurn.session_id, "--store", storeDir],
      tempRoot,
    );
    assert.equal(sessionDetail.session.id, seeded.targetTurn.session_id);
    assert.equal(sessionDetail.session.primary_project_id, seeded.project.project_id);
    assert.ok(sessionDetail.turns.some((t) => t.id === seeded.targetTurn.id));
  });

  it("CLI text output for show turn includes structured cues", async () => {
    const result = await runCliCapture(
      ["show", "turn", seeded.targetTurn.id, "--store", storeDir],
      tempRoot,
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Alpha traceability target/);
  });

  // ---- API: Parallel drill-down chain ----

  it("API search returns the same turn_id as CLI", async () => {
    const server = await startApiServer(storeDir);
    try {
      const body = await apiGet(
        server.app,
        `/api/turns/search?q=${encodeURIComponent("Alpha traceability target")}`,
      );
      assert.equal(body.results.length, 1);
      const hit = body.results[0];
      assert.equal(hit.turn.id, seeded.targetTurn.id);
      assert.equal(hit.turn.project_id, seeded.project.project_id);
      assert.equal(hit.turn.session_id, seeded.targetTurn.session_id);
    } finally {
      await server.close();
    }
  });

  it("API turn detail returns matching canonical text and context", async () => {
    const server = await startApiServer(storeDir);
    try {
      const turnBody = await apiGet(server.app, `/api/turns/${seeded.targetTurn.id}`);
      assert.equal(turnBody.turn.project_id, seeded.project.project_id);
      assert.equal(turnBody.turn.session_id, seeded.targetTurn.session_id);
      assert.match(turnBody.turn.canonical_text, /Alpha traceability target/);

      const contextBody = await apiGet(server.app, `/api/turns/${seeded.targetTurn.id}/context`);
      assert.equal(contextBody.context.assistant_replies.length, 1);
      assert.equal(contextBody.context.tool_calls.length, 1);
    } finally {
      await server.close();
    }
  });

  it("API session detail links back to the same project", async () => {
    const server = await startApiServer(storeDir);
    try {
      const body = await apiGet(server.app, `/api/sessions/${seeded.targetTurn.session_id}`);
      assert.equal(body.session.primary_project_id, seeded.project.project_id);
    } finally {
      await server.close();
    }
  });

  // ---- Cross-surface consistency ----

  it("CLI and API return the same canonical_text for the target turn", async () => {
    const cliTurn = await runCliJson(
      ["show", "turn", seeded.targetTurn.id, "--store", storeDir],
      tempRoot,
    );

    const server = await startApiServer(storeDir);
    try {
      const apiTurn = await apiGet(server.app, `/api/turns/${seeded.targetTurn.id}`);
      assert.equal(cliTurn.turn.canonical_text, apiTurn.turn.canonical_text);
      assert.equal(cliTurn.turn.project_id, apiTurn.turn.project_id);
      assert.equal(cliTurn.turn.session_id, apiTurn.turn.session_id);
    } finally {
      await server.close();
    }
  });
});
