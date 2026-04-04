/**
 * Journey E — Real-layout truthfulness
 *
 * Validates: Truthful about adopted experimental slices.
 * Pass conditions:
 * - Fixtures reflect observed real layouts (gemini, opencode, openclaw, codebuddy, cursor)
 * - Sync from real-layout mock_data produces expected sources/sessions/projects
 * - Adapter-specific expectations:
 *   - OpenCode → committed "esql-lab" project
 *   - Gemini → candidate "agentresearch" project
 *   - CodeBuddy → candidate project
 *   - Cursor chat-store → sessions with titles
 *   - OpenClaw → cron sessions with zero turns
 * - Search returns hits from real-layout sources
 * - CLI and API agree
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  ensureBuilt,
  createTempRoot,
  removeTempRoot,
  seedRealLayoutHome,
  runCliJson,
  runCliCapture,
  startApiServer,
  apiGet,
} from "./helpers.mjs";

describe("Journey E — Real-layout truthfulness", () => {
  let tempRoot;
  let storeDir;
  let childEnv;

  before(async () => {
    ensureBuilt();
    tempRoot = await createTempRoot("e2e-journey-e-");
    storeDir = path.join(tempRoot, "store");
    childEnv = { ...process.env, HOME: tempRoot };
    await seedRealLayoutHome(tempRoot);
  });

  after(async () => {
    if (tempRoot) await removeTempRoot(tempRoot);
  });

  // ---- Sync ----

  it("CLI sync ingests 5 real-layout sources", async () => {
    const syncResult = await runCliCapture(
      [
        "sync", "--store", storeDir,
        "--source", "gemini",
        "--source", "opencode",
        "--source", "openclaw",
        "--source", "codebuddy",
        "--source", "cursor",
      ],
      tempRoot,
      childEnv,
    );
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);
    assert.match(syncResult.stdout, /Synced 5 source\(s\)/);
  });

  // ---- Source verification ----

  it("CLI ls sources shows all 5 platforms", async () => {
    const sources = await runCliJson(["ls", "sources", "--store", storeDir], tempRoot, childEnv);
    assert.equal(sources.kind, "sources");
    assert.equal(sources.sources.length, 5);
    assert.deepEqual(
      sources.sources.map((s) => s.platform).sort(),
      ["codebuddy", "cursor", "gemini", "openclaw", "opencode"],
    );
  });

  it("OpenClaw source has 2 sessions and 0 turns", async () => {
    const sources = await runCliJson(["ls", "sources", "--store", storeDir], tempRoot, childEnv);
    const openclaw = sources.sources.find((s) => s.platform === "openclaw");
    assert.ok(openclaw);
    assert.equal(openclaw.total_sessions, 2);
    assert.equal(openclaw.total_turns, 0);
  });

  it("Cursor source has 3 sessions and 3 turns", async () => {
    const sources = await runCliJson(["ls", "sources", "--store", storeDir], tempRoot, childEnv);
    const cursor = sources.sources.find((s) => s.platform === "cursor");
    assert.ok(cursor);
    assert.equal(cursor.total_sessions, 3);
    assert.equal(cursor.total_turns, 3);
  });

  // ---- Project verification ----

  it("OpenCode produces committed esql-lab project", async () => {
    const projects = await runCliJson(["ls", "projects", "--store", storeDir], tempRoot, childEnv);
    const opencodeProject = projects.projects.find((p) => p.display_name === "esql-lab");
    assert.ok(opencodeProject, "expected committed OpenCode project");
    assert.equal(opencodeProject.linkage_state, "committed");
  });

  it("Gemini produces candidate agentresearch project", async () => {
    const projects = await runCliJson(["ls", "projects", "--store", storeDir], tempRoot, childEnv);
    const geminiProject = projects.projects.find((p) => p.display_name === "agentresearch");
    assert.ok(geminiProject, "expected Gemini candidate project");
    assert.equal(geminiProject.linkage_state, "candidate");
  });

  it("CodeBuddy produces candidate project", async () => {
    const projects = await runCliJson(["ls", "projects", "--store", storeDir], tempRoot, childEnv);
    const codebuddyProject = projects.projects.find(
      (p) => p.display_name === "config-workspace-ai_learning",
    );
    assert.ok(codebuddyProject, "expected CodeBuddy candidate project");
    assert.equal(codebuddyProject.linkage_state, "candidate");
  });

  // ---- Session verification ----

  it("Cursor chat-store session has expected title", async () => {
    const sessions = await runCliJson(["ls", "sessions", "--store", storeDir], tempRoot, childEnv);
    const cursorSession = sessions.sessions.find(
      (s) => s.source_platform === "cursor" && s.title === "MCP Service Guide",
    );
    assert.ok(cursorSession, "expected Cursor session with title 'MCP Service Guide'");
  });

  it("OpenClaw cron session exists with correct title", async () => {
    const sessions = await runCliJson(["ls", "sessions", "--store", storeDir], tempRoot, childEnv);
    const cronSession = sessions.sessions.find(
      (s) => s.source_platform === "openclaw" && s.title === "cron:mock-openclaw-hourly",
    );
    assert.ok(cronSession, "expected OpenClaw cron session");
  });

  it("OpenClaw cron session has zero turns", async () => {
    const sessions = await runCliJson(["ls", "sessions", "--store", storeDir], tempRoot, childEnv);
    const cronSession = sessions.sessions.find(
      (s) => s.source_platform === "openclaw" && s.title === "cron:mock-openclaw-hourly",
    );
    const sessionDetail = await runCliJson(
      ["show", "session", cronSession.id, "--store", storeDir],
      tempRoot,
      childEnv,
    );
    assert.equal(sessionDetail.turns.length, 0);
  });

  // ---- Search across real-layout sources ----

  it("search finds OpenCode turn via Requirement Review", async () => {
    const results = await runCliJson(
      ["search", "Requirement Review", "--store", storeDir],
      tempRoot,
      childEnv,
    );
    const hit = results.results.find((r) => r.session.source_platform === "opencode");
    assert.ok(hit, "expected OpenCode search hit");
    assert.equal(hit.project.display_name, "esql-lab");
  });

  it("search finds Gemini turn via agentresearch", async () => {
    const results = await runCliJson(
      ["search", "agentresearch", "--store", storeDir],
      tempRoot,
      childEnv,
    );
    const hit = results.results.find((r) => r.session.source_platform === "gemini");
    assert.ok(hit, "expected Gemini search hit");
    assert.equal(hit.project.display_name, "agentresearch");
  });

  it("search finds CodeBuddy turn via AI learning", async () => {
    const results = await runCliJson(
      ["search", "AI learning", "--store", storeDir],
      tempRoot,
      childEnv,
    );
    const hit = results.results.find((r) => r.session.source_platform === "codebuddy");
    assert.ok(hit, "expected CodeBuddy search hit");
    assert.equal(hit.project.display_name, "config-workspace-ai_learning");
  });

  it("search finds Cursor turn via MCP Service Guide", async () => {
    const results = await runCliJson(
      ["search", "MCP Service Guide", "--store", storeDir],
      tempRoot,
      childEnv,
    );
    const hit = results.results.find((r) => r.session.source_platform === "cursor");
    assert.ok(hit, "expected Cursor search hit");
    assert.equal(hit.session.title, "MCP Service Guide");
  });

  // ---- Turn drill-down ----

  it("show turn on OpenCode hit returns correct project and session", async () => {
    const results = await runCliJson(
      ["search", "Requirement Review", "--store", storeDir],
      tempRoot,
      childEnv,
    );
    const hit = results.results.find((r) => r.session.source_platform === "opencode");
    const turn = await runCliJson(
      ["show", "turn", hit.turn.id, "--store", storeDir],
      tempRoot,
      childEnv,
    );
    assert.equal(turn.turn.session_id, hit.session.id);
    assert.match(turn.turn.canonical_text, /Review the task requirements/);
  });

  // ---- API agreement ----

  it("API lists matching projects from real-layout sync", async () => {
    const server = await startApiServer(storeDir);
    try {
      const body = await apiGet(server.app, "/api/projects");
      assert.ok(body.projects.some((p) => p.display_name === "esql-lab"));
      assert.ok(body.projects.some((p) => p.display_name === "agentresearch"));
      assert.ok(body.projects.some((p) => p.display_name === "config-workspace-ai_learning"));
    } finally {
      await server.close();
    }
  });

  it("API search finds OpenCode and Gemini hits", async () => {
    const server = await startApiServer(storeDir);
    try {
      const opencodeBody = await apiGet(
        server.app,
        `/api/turns/search?q=${encodeURIComponent("Requirement Review")}`,
      );
      assert.ok(opencodeBody.results.some((r) => r.session.source_platform === "opencode"));

      const geminiBody = await apiGet(
        server.app,
        `/api/turns/search?q=${encodeURIComponent("agentresearch")}`,
      );
      assert.ok(geminiBody.results.some((r) => r.session.source_platform === "gemini"));
    } finally {
      await server.close();
    }
  });
});
