import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { createApiRuntime } from "../apps/api/dist/app.js";
import { runTui } from "../apps/tui/dist/index.js";
import { createIo, runCliJson, runCliCapture } from "./lib/test-fixtures.mjs";

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-real-layout-sync-"));
  const originalHome = process.env.HOME;

  try {
    await seedRealLayoutHome(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    await verifyRealLayoutSyncAndRead(storeDir, tempRoot);

    console.log("Real-layout fixture sync-to-read verification passed.");
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function verifyRealLayoutSyncAndRead(storeDir, cwd) {
  const syncResult = await runCliCapture(
    ["sync", "--store", storeDir, "--source", "gemini", "--source", "opencode", "--source", "openclaw", "--source", "codebuddy", "--source", "cursor"],
    cwd,
  );
  assert.equal(syncResult.exitCode, 0, syncResult.stderr);
  assert.match(syncResult.stdout, /Synced 5 source\(s\)/);

  const cliSources = await runCliJson(["ls", "sources", "--store", storeDir], cwd);
  assert.equal(cliSources.kind, "sources");
  assert.equal(cliSources.sources.length, 5);
  assert.deepEqual(
    cliSources.sources.map((source) => source.platform).sort(),
    ["codebuddy", "cursor", "gemini", "openclaw", "opencode"],
  );
  assert.ok(cliSources.sources.some((source) => source.platform === "openclaw" && source.total_sessions === 2 && source.total_turns === 0));
  assert.ok(cliSources.sources.some((source) => source.platform === "cursor" && source.total_sessions === 3 && source.total_turns === 3));

  const projectsResult = await runCliJson(["ls", "projects", "--store", storeDir], cwd);
  const opencodeProject = projectsResult.projects.find((project) => project.display_name === "esql-lab");
  const geminiProject = projectsResult.projects.find((project) => project.display_name === "agentresearch");
  const codebuddyProject = projectsResult.projects.find((project) => project.display_name === "config-workspace-ai_learning");
  assert.ok(opencodeProject, "expected committed OpenCode project after real-layout sync");
  assert.ok(geminiProject, "expected Gemini candidate project after real-layout sync");
  assert.ok(codebuddyProject, "expected CodeBuddy candidate project after real-layout sync");
  assert.equal(opencodeProject.linkage_state, "committed");
  assert.equal(geminiProject.linkage_state, "candidate");
  assert.equal(codebuddyProject.linkage_state, "candidate");

  const sessionsResult = await runCliJson(["ls", "sessions", "--store", storeDir], cwd);
  const cursorSession = sessionsResult.sessions.find((session) => session.source_platform === "cursor" && session.title === "MCP Service Guide");
  const openclawCronSession = sessionsResult.sessions.find((session) => session.source_platform === "openclaw" && session.title === "cron:mock-openclaw-hourly");
  const openclawMainSession = sessionsResult.sessions.find(
    (session) => session.source_platform === "openclaw" && session.working_directory === "/Users/mock_user/workspace/openclaw-automation",
  );
  assert.ok(cursorSession, "expected Cursor chat-store session in synced session list");
  assert.ok(openclawCronSession, "expected OpenClaw cron session in synced session list");
  assert.ok(openclawMainSession, "expected OpenClaw main session in synced session list");

  const opencodeSearch = await runCliJson(["search", "Requirement Review", "--store", storeDir], cwd);
  const opencodeHit = opencodeSearch.results.find((result) => result.session.source_platform === "opencode");
  assert.ok(opencodeHit, "expected OpenCode search hit from real-layout fixture sync");
  assert.equal(opencodeHit.project.display_name, "esql-lab");

  const geminiSearch = await runCliJson(["search", "agentresearch", "--store", storeDir], cwd);
  const geminiHit = geminiSearch.results.find((result) => result.session.source_platform === "gemini");
  assert.ok(geminiHit, "expected Gemini search hit from real-layout fixture sync");
  assert.equal(geminiHit.project.display_name, "agentresearch");

  const codebuddySearch = await runCliJson(["search", "AI learning", "--store", storeDir], cwd);
  const codebuddyHit = codebuddySearch.results.find((result) => result.session.source_platform === "codebuddy");
  assert.ok(codebuddyHit, "expected CodeBuddy search hit from real-layout fixture sync");
  assert.equal(codebuddyHit.project.display_name, "config-workspace-ai_learning");

  const cursorSearch = await runCliJson(["search", "MCP Service Guide", "--store", storeDir], cwd);
  const cursorHit = cursorSearch.results.find((result) => result.session.source_platform === "cursor");
  assert.ok(cursorHit, "expected Cursor chat-store search hit from real-layout fixture sync");
  assert.equal(cursorHit.session.title, "MCP Service Guide");

  const opencodeTurn = await runCliJson(["show", "turn", opencodeHit.turn.id, "--store", storeDir], cwd);
  assert.equal(opencodeTurn.turn.project_id, opencodeProject.project_id);
  assert.equal(opencodeTurn.turn.session_id, opencodeHit.session.id);
  assert.match(opencodeTurn.turn.canonical_text, /Review the task requirements/);

  const geminiTurn = await runCliJson(["show", "turn", geminiHit.turn.id, "--store", storeDir], cwd);
  assert.equal(geminiTurn.turn.project_id, geminiProject.project_id);
  assert.equal(geminiTurn.turn.session_id, geminiHit.session.id);
  assert.match(geminiTurn.turn.canonical_text, /Summarize noteworthy AI agent frameworks/);

  const cursorTurn = await runCliJson(["show", "turn", cursorHit.turn.id, "--store", storeDir], cwd);
  assert.equal(cursorTurn.turn.session_id, cursorHit.session.id);
  assert.match(cursorTurn.turn.canonical_text, /MCP/);

  const openclawSessionDetail = await runCliJson(["show", "session", openclawCronSession.id, "--store", storeDir], cwd);
  assert.equal(openclawSessionDetail.session.id, openclawCronSession.id);
  assert.equal(openclawSessionDetail.session.source_platform, "openclaw");
  assert.equal(openclawSessionDetail.turns.length, 0);

  const tui = createIo(cwd);
  const tuiExitCode = await runTui(["--store", storeDir, "--search", "Requirement Review"], tui.io);
  assert.equal(tuiExitCode, 0, tui.stderr.join(""));
  const tuiOutput = tui.stdout.join("");
  assert.match(tuiOutput, /Mode=search/);
  assert.match(tuiOutput, /esql-lab/);
  assert.match(tuiOutput, /opencode/);
  assert.match(tuiOutput, /cursor/);

  const runtime = await createApiRuntime({ dataDir: storeDir, sources: [] });
  try {
    const projectsResponse = await runtime.app.inject({ method: "GET", url: "/api/projects" });
    assert.equal(projectsResponse.statusCode, 200);
    const projectsBody = JSON.parse(projectsResponse.body);
    assert.ok(projectsBody.projects.some((project) => project.display_name === "esql-lab"));
    assert.ok(projectsBody.projects.some((project) => project.display_name === "agentresearch"));
    assert.ok(projectsBody.projects.some((project) => project.display_name === "config-workspace-ai_learning"));

    const opencodeSearchResponse = await runtime.app.inject({ method: "GET", url: `/api/turns/search?q=${encodeURIComponent("Requirement Review")}` });
    assert.equal(opencodeSearchResponse.statusCode, 200);
    const opencodeSearchBody = JSON.parse(opencodeSearchResponse.body);
    assert.ok(opencodeSearchBody.results.some((result) => result.session.source_platform === "opencode"));

    const geminiSearchResponse = await runtime.app.inject({ method: "GET", url: `/api/turns/search?q=${encodeURIComponent("agentresearch")}` });
    assert.equal(geminiSearchResponse.statusCode, 200);
    const geminiSearchBody = JSON.parse(geminiSearchResponse.body);
    assert.ok(geminiSearchBody.results.some((result) => result.session.source_platform === "gemini"));

    const codebuddySearchResponse = await runtime.app.inject({ method: "GET", url: `/api/turns/search?q=${encodeURIComponent("AI learning")}` });
    assert.equal(codebuddySearchResponse.statusCode, 200);
    const codebuddySearchBody = JSON.parse(codebuddySearchResponse.body);
    assert.ok(codebuddySearchBody.results.some((result) => result.session.source_platform === "codebuddy"));

    const cursorSearchResponse = await runtime.app.inject({ method: "GET", url: `/api/turns/search?q=${encodeURIComponent("MCP Service Guide")}` });
    assert.equal(cursorSearchResponse.statusCode, 200);
    const cursorSearchBody = JSON.parse(cursorSearchResponse.body);
    assert.ok(cursorSearchBody.results.some((result) => result.session.source_platform === "cursor"));

    const openclawSessionResponse = await runtime.app.inject({ method: "GET", url: `/api/sessions/${encodeURIComponent(openclawCronSession.id)}` });
    assert.equal(openclawSessionResponse.statusCode, 200);
    const openclawSessionBody = JSON.parse(openclawSessionResponse.body);
    assert.equal(openclawSessionBody.session.source_platform, "openclaw");
    assert.equal(openclawSessionBody.session.title, "cron:mock-openclaw-hourly");

    const cursorSessionResponse = await runtime.app.inject({ method: "GET", url: `/api/sessions/${encodeURIComponent(cursorSession.id)}` });
    assert.equal(cursorSessionResponse.statusCode, 200);
    const cursorSessionBody = JSON.parse(cursorSessionResponse.body);
    assert.equal(cursorSessionBody.session.source_platform, "cursor");
    assert.equal(cursorSessionBody.session.title, "MCP Service Guide");
  } finally {
    await runtime.app.close();
    runtime.storage.close();
  }
}

async function seedRealLayoutHome(tempRoot) {
  const mockDataRoot = path.resolve("mock_data");
  await cp(path.join(mockDataRoot, ".gemini"), path.join(tempRoot, ".gemini"), { recursive: true });
  await cp(path.join(mockDataRoot, ".codebuddy"), path.join(tempRoot, ".codebuddy"), { recursive: true });
  await cp(path.join(mockDataRoot, ".openclaw"), path.join(tempRoot, ".openclaw"), { recursive: true });
  await cp(path.join(mockDataRoot, ".local", "share", "opencode"), path.join(tempRoot, ".local", "share", "opencode"), {
    recursive: true,
  });
  await cp(path.join(mockDataRoot, ".cursor", "chats"), path.join(tempRoot, ".config", "Cursor", "chats"), {
    recursive: true,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
