import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { createApiRuntime } from "../apps/api/dist/app.js";
import { runCli } from "../apps/cli/dist/index.js";
import { runTui } from "../apps/tui/dist/index.js";

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-fixture-sync-"));
  const originalHome = process.env.HOME;

  try {
    await seedMockDataHome(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    await verifySyncAndRecall(storeDir, tempRoot);

    console.log("Fixture-backed sync-to-recall verification passed.");
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function verifySyncAndRecall(storeDir, cwd) {
  const syncResult = await runCliCapture(["sync", "--store", storeDir], cwd);
  assert.equal(syncResult.exitCode, 0, syncResult.stderr);
  assert.match(syncResult.stdout, /Synced 6 source\(s\)/);

  const projectsResult = await runCliJson(["ls", "projects", "--store", storeDir], cwd);
  const historyProject = projectsResult.projects.find(
    (project) =>
      project.display_name === "history-lab" &&
      project.primary_workspace_path === "/Users/mock_user/workspace/history-lab",
  );
  assert.ok(historyProject, "expected committed history-lab project after fixture sync");
  assert.equal(historyProject.linkage_state, "committed");
  assert.deepEqual([...historyProject.source_platforms].sort(), ["amp", "antigravity", "factory_droid"]);
  assert.equal(historyProject.session_count, 3);
  assert.equal(historyProject.committed_turn_count, 3);

  const treeResult = await runCliJson(["tree", "project", historyProject.project_id, "--store", storeDir], cwd);
  assert.equal(treeResult.sessions.length, 3);
  assert.deepEqual(treeResult.sessions.map((session) => session.source_platform).sort(), ["amp", "antigravity", "factory_droid"]);

  const searchResult = await runCliJson(["search", "Factory", "--project", historyProject.project_id, "--store", storeDir], cwd);
  assert.equal(searchResult.kind, "search");
  assert.equal(searchResult.results.length, 1);
  const hit = searchResult.results[0];
  assert.equal(hit.project.project_id, historyProject.project_id);
  assert.equal(hit.session.source_platform, "factory_droid");
  assert.match(hit.turn.canonical_text, /Factory Droid sidecar behavior/);

  const turnDetail = await runCliJson(["show", "turn", hit.turn.id, "--store", storeDir], cwd);
  assert.equal(turnDetail.turn.project_id, historyProject.project_id);
  assert.equal(turnDetail.turn.session_id, hit.session.id);
  assert.ok((turnDetail.context?.assistant_replies.length ?? 0) >= 1);
  assert.ok((turnDetail.context?.tool_calls.length ?? 0) >= 1);

  const sessionDetail = await runCliJson(["show", "session", hit.session.id, "--store", storeDir], cwd);
  assert.equal(sessionDetail.session.primary_project_id, historyProject.project_id);
  assert.ok(sessionDetail.turns.some((turn) => turn.id === hit.turn.id));

  const { io: tuiIo, stdout: tuiStdout, stderr: tuiStderr } = createIo(cwd);
  const tuiExitCode = await runTui(["--store", storeDir, "--search", "Factory"], tuiIo);
  assert.equal(tuiExitCode, 0, tuiStderr.join(""));
  const tuiOutput = tuiStdout.join("");
  assert.match(tuiOutput, /Mode=search/);
  assert.match(tuiOutput, /Factory Droid sidecar behavior/);
  assert.match(tuiOutput, /Project: history-lab/);

  const runtime = await createApiRuntime({ dataDir: storeDir, sources: [] });
  try {
    const projectsResponse = await runtime.app.inject({ method: "GET", url: "/api/projects" });
    assert.equal(projectsResponse.statusCode, 200);
    const projectsBody = JSON.parse(projectsResponse.body);
    const apiProject = projectsBody.projects.find((project) => project.project_id === historyProject.project_id);
    assert.ok(apiProject);
    assert.deepEqual([...apiProject.source_platforms].sort(), ["amp", "antigravity", "factory_droid"]);

    const turnsResponse = await runtime.app.inject({ method: "GET", url: `/api/projects/${historyProject.project_id}/turns` });
    assert.equal(turnsResponse.statusCode, 200);
    const turnsBody = JSON.parse(turnsResponse.body);
    assert.equal(turnsBody.turns.length, 3);

    const searchResponse = await runtime.app.inject({ method: "GET", url: `/api/turns/search?q=${encodeURIComponent("Factory")}&project_id=${encodeURIComponent(historyProject.project_id)}` });
    assert.equal(searchResponse.statusCode, 200);
    const searchBody = JSON.parse(searchResponse.body);
    assert.equal(searchBody.results.length, 1);
    assert.equal(searchBody.results[0].turn.id, hit.turn.id);

    const turnResponse = await runtime.app.inject({ method: "GET", url: `/api/turns/${hit.turn.id}` });
    assert.equal(turnResponse.statusCode, 200);
    const turnBody = JSON.parse(turnResponse.body);
    assert.equal(turnBody.turn.project_id, historyProject.project_id);

    const sessionResponse = await runtime.app.inject({ method: "GET", url: `/api/sessions/${hit.session.id}` });
    assert.equal(sessionResponse.statusCode, 200);
    const sessionBody = JSON.parse(sessionResponse.body);
    assert.equal(sessionBody.session.primary_project_id, historyProject.project_id);
  } finally {
    await runtime.app.close();
    runtime.storage.close();
  }
}

async function seedMockDataHome(tempRoot) {
  const mockDataRoot = path.resolve("mock_data");
  await cp(path.join(mockDataRoot, ".codex"), path.join(tempRoot, ".codex"), { recursive: true });
  await cp(path.join(mockDataRoot, ".claude"), path.join(tempRoot, ".claude"), { recursive: true });
  await cp(path.join(mockDataRoot, ".factory"), path.join(tempRoot, ".factory"), { recursive: true });
  await cp(path.join(mockDataRoot, ".local", "share", "amp"), path.join(tempRoot, ".local", "share", "amp"), { recursive: true });
  await cp(
    path.join(mockDataRoot, "Library", "Application Support", "Cursor"),
    path.join(tempRoot, "Library", "Application Support", "Cursor"),
    { recursive: true },
  );
  await cp(
    path.join(mockDataRoot, "Library", "Application Support", "Cursor"),
    path.join(tempRoot, ".config", "Cursor"),
    { recursive: true },
  );
  await cp(
    path.join(mockDataRoot, "Library", "Application Support", "antigravity"),
    path.join(tempRoot, "Library", "Application Support", "Antigravity"),
    { recursive: true },
  );
  await cp(
    path.join(mockDataRoot, "Library", "Application Support", "antigravity"),
    path.join(tempRoot, ".config", "Antigravity"),
    { recursive: true },
  );
}

function createIo(cwd) {
  const stdout = [];
  const stderr = [];
  return {
    io: {
      cwd,
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
      isInteractiveTerminal: false,
    },
    stdout,
    stderr,
  };
}

async function runCliJson(argv, cwd) {
  const { io, stdout, stderr } = createIo(cwd);
  const exitCode = await runCli([...argv, "--json"], io);
  assert.equal(exitCode, 0, stderr.join(""));
  return JSON.parse(stdout.join(""));
}

async function runCliCapture(argv, cwd) {
  const { io, stdout, stderr } = createIo(cwd);
  const exitCode = await runCli(argv, io);
  return { exitCode, stdout: stdout.join(""), stderr: stderr.join("") };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
