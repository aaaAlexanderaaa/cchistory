import "./install-node-sqlite-warning-filter.mjs";
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
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-related-work-"));
  const originalHome = process.env.HOME;

  try {
    await seedRelatedWorkHome(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    await verifyRelatedWorkRecall(storeDir, tempRoot);

    console.log("Related-work recall verification passed.");
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function verifyRelatedWorkRecall(storeDir, cwd) {
  for (const source of ["claude_code", "openclaw"]) {
    const syncResult = await runCliCapture(["sync", "--store", storeDir, "--source", source], cwd);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);
  }

  const projectsResult = await runCliJson(["ls", "projects", "--store", storeDir], cwd);
  const chatProject = projectsResult.projects.find(
    (project) =>
      project.display_name === "chat-ui-kit" &&
      project.primary_workspace_path === "/Users/mock_user/workspace/chat-ui-kit",
  );
  assert.ok(chatProject, "expected committed chat-ui-kit project after related-work sync");
  assert.equal(chatProject.linkage_state, "committed");

  const repeatedSearchText = await runCliCapture(["search", "expert code reviewer", "--store", storeDir], cwd);
  assert.equal(repeatedSearchText.exitCode, 0, repeatedSearchText.stderr);
  assert.match(repeatedSearchText.stdout, /chat-ui-kit \([^)]+\) \(\d+\)/);
  assert.match(repeatedSearchText.stdout, /related=\d+ delegated/);
  assert.match(repeatedSearchText.stdout, /tree session .* --long/);

  const repeatedSearchJson = await runCliJson(["search", "expert code reviewer", "--store", storeDir], cwd);
  assert.equal(repeatedSearchJson.kind, "search");
  const delegatedHits = repeatedSearchJson.results.filter(
    (result) =>
      result.project.project_id === chatProject.project_id &&
      result.session.source_platform === "claude_code" &&
      /expert code reviewer/i.test(result.turn.canonical_text),
  );
  assert.ok(delegatedHits.length >= 2, "expected at least two Claude review hits with delegated related-work context");
  assert.ok(new Set(delegatedHits.map((result) => result.turn.id)).size >= 2, "expected distinct turn ids for repeated review hits");
  assert.ok(new Set(delegatedHits.map((result) => result.session.id)).size >= 2, "expected distinct session ids for repeated review hits");

  const chosenHit = delegatedHits[0];
  const turnDetail = await runCliJson(["show", "turn", chosenHit.turn.id, "--store", storeDir], cwd);
  assert.equal(turnDetail.turn.project_id, chatProject.project_id);
  assert.equal(turnDetail.turn.session_id, chosenHit.session.id);
  assert.match(turnDetail.turn.canonical_text, /expert code reviewer/i);
  assert.ok((turnDetail.context?.assistant_replies.length ?? 0) >= 1);

  const sessionQuery = await runCliJson(["query", "session", "--id", chosenHit.session.id, "--store", storeDir], cwd);
  assert.equal(sessionQuery.session.id, chosenHit.session.id);
  assert.equal(sessionQuery.session.primary_project_id, chatProject.project_id);
  assert.ok(
    sessionQuery.related_work.some(
      (entry) => entry.relation_kind === "delegated_session" && entry.target_kind === "session" && entry.transcript_primary === true,
    ),
    "expected delegated child-session related work on the Claude review session",
  );

  const sessionTreeText = await runCliCapture(["tree", "session", chosenHit.session.id, "--store", storeDir, "--long"], cwd);
  assert.equal(sessionTreeText.exitCode, 0, sessionTreeText.stderr);
  assert.match(sessionTreeText.stdout, /Related Work/);
  assert.match(sessionTreeText.stdout, /delegated session /);
  assert.match(sessionTreeText.stdout, /transcript-primary/);

  const sessionsLongText = await runCliCapture(["ls", "sessions", "--store", storeDir, "--long"], cwd);
  assert.equal(sessionsLongText.exitCode, 0, sessionsLongText.stderr);
  assert.match(sessionsLongText.stdout, /Related Work/);
  assert.match(sessionsLongText.stdout, /\d+ delegated/);
  assert.match(sessionsLongText.stdout, /1 automation/);

  const openclawTreeJson = await runCliJson(["tree", "session", "cron:mock-openclaw-hourly", "--store", storeDir], cwd);
  assert.equal(openclawTreeJson.session.source_platform, "openclaw");
  assert.equal(openclawTreeJson.related_work.length, 1);
  assert.equal(openclawTreeJson.related_work[0]?.relation_kind, "automation_run");
  assert.equal(openclawTreeJson.related_work[0]?.target_kind, "automation_run");
  assert.equal(openclawTreeJson.related_work[0]?.automation_job_ref, "mock-openclaw-hourly");
  assert.equal(openclawTreeJson.related_work[0]?.status, "success");

  const openclawTreeText = await runCliCapture(["tree", "session", "cron:mock-openclaw-hourly", "--store", storeDir, "--long"], cwd);
  assert.equal(openclawTreeText.exitCode, 0, openclawTreeText.stderr);
  assert.match(openclawTreeText.stdout, /related=1 automation/);
  assert.match(openclawTreeText.stdout, /automation run .*job=mock-openclaw-hourly/);

  const tui = createIo(cwd);
  const tuiExitCode = await runTui(["--store", storeDir, "--search", "expert code reviewer"], tui.io);
  assert.equal(tuiExitCode, 0, tui.stderr.join(""));
  const tuiOutput = tui.stdout.join("");
  assert.match(tuiOutput, /Mode=search/);
  assert.match(tuiOutput, /Project: chat-ui-kit/);
  assert.match(tuiOutput, /Related Work: \d+ child sessions, 0 automation runs/);
  assert.match(tuiOutput, /Related Trail 1: -> child session /);

  const runtime = await createApiRuntime({ dataDir: storeDir, sources: [] });
  try {
    const projectsResponse = await runtime.app.inject({ method: "GET", url: "/api/projects" });
    assert.equal(projectsResponse.statusCode, 200);
    const projectsBody = JSON.parse(projectsResponse.body);
    assert.ok(projectsBody.projects.some((project) => project.project_id === chatProject.project_id));

    const searchResponse = await runtime.app.inject({ method: "GET", url: `/api/turns/search?q=${encodeURIComponent("expert code reviewer")}` });
    assert.equal(searchResponse.statusCode, 200);
    const searchBody = JSON.parse(searchResponse.body);
    const apiDelegatedHits = searchBody.results.filter(
      (result) => result.project.project_id === chatProject.project_id && result.session.source_platform === "claude_code",
    );
    assert.ok(apiDelegatedHits.length >= 2, "expected API search to surface the repeated Claude review hits");

    const delegatedRelatedResponse = await runtime.app.inject({
      method: "GET",
      url: `/api/admin/sessions/${encodeURIComponent(chosenHit.session.id)}/related-work`,
    });
    assert.equal(delegatedRelatedResponse.statusCode, 200);
    const delegatedRelatedBody = JSON.parse(delegatedRelatedResponse.body);
    assert.ok(
      delegatedRelatedBody.related_work.some(
        (entry) => entry.relation_kind === "delegated_session" && entry.target_kind === "session" && entry.transcript_primary === true,
      ),
      "expected API delegated related-work visibility for the Claude review session",
    );

    const automationRelatedResponse = await runtime.app.inject({
      method: "GET",
      url: `/api/admin/sessions/${encodeURIComponent(openclawTreeJson.session.id)}/related-work`,
    });
    assert.equal(automationRelatedResponse.statusCode, 200);
    const automationRelatedBody = JSON.parse(automationRelatedResponse.body);
    assert.equal(automationRelatedBody.related_work[0]?.relation_kind, "automation_run");
    assert.equal(automationRelatedBody.related_work[0]?.target_kind, "automation_run");
    assert.equal(automationRelatedBody.related_work[0]?.automation_job_ref, "mock-openclaw-hourly");
  } finally {
    await runtime.app.close();
    runtime.storage.close();
  }
}

async function seedRelatedWorkHome(tempRoot) {
  const mockDataRoot = path.resolve("mock_data");
  await cp(path.join(mockDataRoot, ".claude"), path.join(tempRoot, ".claude"), { recursive: true });
  await cp(path.join(mockDataRoot, ".openclaw"), path.join(tempRoot, ".openclaw"), { recursive: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
