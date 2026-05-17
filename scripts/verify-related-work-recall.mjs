import "./install-node-sqlite-warning-filter.mjs";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

  const repeatedSearchText = await runCliCapture(["search", "expert code reviewer", "--store", storeDir, "--long"], cwd);
  assert.equal(repeatedSearchText.exitCode, 0, repeatedSearchText.stderr);
  assert.match(repeatedSearchText.stdout, /chat-ui-kit \(\d+\)/);
  assert.match(repeatedSearchText.stdout, /\d+ delegated/);
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
  assert.match(tuiOutput, /Search: expert code reviewer/);
  assert.match(tuiOutput, /Project: chat-ui-kit/);
  assert.match(tuiOutput, /Related: \d+ parent/);

  const fanoutParentSearch = await runCliJson(["search", "generated relation fanout parent", "--store", storeDir], cwd);
  const fanoutParentHit = fanoutParentSearch.results.find((result) =>
    /generated relation fanout parent/i.test(result.turn.canonical_text),
  );
  assert.ok(fanoutParentHit, "expected generated parent fanout search hit");

  const fanoutAlphaSearch = await runCliJson(["search", "generated relation child alpha", "--store", storeDir], cwd);
  const fanoutAlphaHit = fanoutAlphaSearch.results.find((result) =>
    /generated relation child alpha/i.test(result.turn.canonical_text),
  );
  assert.ok(fanoutAlphaHit, "expected generated child alpha search hit");

  const fanoutBetaSearch = await runCliJson(["search", "generated relation child beta", "--store", storeDir], cwd);
  const fanoutBetaHit = fanoutBetaSearch.results.find((result) =>
    /generated relation child beta/i.test(result.turn.canonical_text),
  );
  assert.ok(fanoutBetaHit, "expected generated child beta search hit");

  const parentRelatedQuery = await runCliJson(["query", "session", "--id", fanoutParentHit.session.id, "--store", storeDir], cwd);
  const outboundChildren = parentRelatedQuery.related_work.filter(
    (entry) => entry.relation_kind === "delegated_session" && entry.direction === "outbound",
  );
  assert.equal(outboundChildren.length, 2);
  assert.deepEqual(
    outboundChildren.map((entry) => entry.target_session_ref).sort(),
    [fanoutAlphaHit.session.id, fanoutBetaHit.session.id].sort(),
  );

  const childTraceQuery = await runCliJson(["query", "session", "--id", fanoutAlphaHit.session.id, "--store", storeDir], cwd);
  assert.ok(
    childTraceQuery.related_work.some(
      (entry) =>
        entry.relation_kind === "delegated_session" &&
        entry.direction === "inbound" &&
        entry.target_session_ref === fanoutParentHit.session.id,
    ),
    "expected generated child session to trace back to parent",
  );

  const parentTreeText = await runCliCapture(["tree", "session", fanoutParentHit.session.id, "--store", storeDir, "--long"], cwd);
  assert.equal(parentTreeText.exitCode, 0, parentTreeText.stderr);
  assert.match(parentTreeText.stdout, /Related Work/);
  assert.match(parentTreeText.stdout, /delegated session .*generated-relation-child-alpha/);
  assert.match(parentTreeText.stdout, /delegated session .*generated-relation-child-beta/);

  const parentTurnDetail = await runCliJson(["show", "turn", fanoutParentHit.turn.id, "--store", storeDir], cwd);
  assert.doesNotMatch(JSON.stringify(parentTurnDetail), /generated relation child alpha/i);
  assert.doesNotMatch(JSON.stringify(parentTurnDetail), /generated relation child beta/i);

  const fanoutTui = createIo(cwd);
  const fanoutTuiExitCode = await runTui(["--store", storeDir, "--search", "generated relation fanout parent"], fanoutTui.io);
  assert.equal(fanoutTuiExitCode, 0, fanoutTui.stderr.join(""));
  const fanoutTuiOutput = fanoutTui.stdout.join("");
  assert.match(fanoutTuiOutput, /Search: generated relation fanout parent/);
  assert.match(fanoutTuiOutput, /Related: 2 child/);

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

    const fanoutParentRelatedResponse = await runtime.app.inject({
      method: "GET",
      url: `/api/admin/sessions/${encodeURIComponent(fanoutParentHit.session.id)}/related-work`,
    });
    assert.equal(fanoutParentRelatedResponse.statusCode, 200);
    const fanoutParentRelatedBody = JSON.parse(fanoutParentRelatedResponse.body);
    const apiFanoutChildren = fanoutParentRelatedBody.related_work.filter(
      (entry) => entry.relation_kind === "delegated_session" && entry.direction === "outbound",
    );
    assert.equal(apiFanoutChildren.length, 2);
    assert.deepEqual(
      apiFanoutChildren.map((entry) => entry.target_session_ref).sort(),
      [fanoutAlphaHit.session.id, fanoutBetaHit.session.id].sort(),
    );
  } finally {
    await runtime.app.close();
    runtime.storage.close();
  }
}

async function seedRelatedWorkHome(tempRoot) {
  const mockDataRoot = path.resolve("mock_data");
  await cp(path.join(mockDataRoot, ".claude"), path.join(tempRoot, ".claude"), { recursive: true });
  await cp(path.join(mockDataRoot, ".openclaw"), path.join(tempRoot, ".openclaw"), { recursive: true });
  await seedGeneratedDelegationFanout(tempRoot);
}

async function seedGeneratedDelegationFanout(tempRoot) {
  const projectDir = path.join(tempRoot, ".claude", "projects", "-Users-mock-user-workspace-generated-relation-fanout");
  await mkdir(projectDir, { recursive: true });

  const parentSessionId = "generated-relation-parent";
  const childAlphaSessionId = "generated-relation-child-alpha";
  const childBetaSessionId = "generated-relation-child-beta";
  const cwd = "/Users/mock_user/workspace/generated-relation-fanout";

  await writeJsonl(path.join(projectDir, "generated-relation-parent.jsonl"), [
    {
      timestamp: "2026-03-09T10:00:00.000Z",
      type: "user",
      sessionId: parentSessionId,
      cwd,
      message: {
        role: "user",
        content: [{ type: "text", text: "generated relation fanout parent launch two review agents" }],
      },
    },
    {
      timestamp: "2026-03-09T10:00:01.000Z",
      type: "assistant",
      sessionId: parentSessionId,
      cwd,
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "Launching two reviewers." }],
      },
    },
  ]);

  await writeJsonl(path.join(projectDir, "generated-relation-child-alpha.jsonl"), [
    {
      timestamp: "2026-03-09T10:01:00.000Z",
      type: "user",
      sessionId: childAlphaSessionId,
      parentUuid: parentSessionId,
      cwd,
      message: {
        role: "user",
        content: [{ type: "text", text: "generated relation child alpha inspect parser evidence" }],
      },
    },
    {
      timestamp: "2026-03-09T10:01:01.000Z",
      type: "assistant",
      sessionId: childAlphaSessionId,
      parentUuid: parentSessionId,
      cwd,
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "Alpha reviewed parser evidence." }],
      },
    },
  ]);

  await writeJsonl(path.join(projectDir, "generated-relation-child-beta.jsonl"), [
    {
      timestamp: "2026-03-09T10:02:00.000Z",
      type: "user",
      sessionId: childBetaSessionId,
      parentUuid: parentSessionId,
      cwd,
      message: {
        role: "user",
        content: [{ type: "text", text: "generated relation child beta inspect storage evidence" }],
      },
    },
    {
      timestamp: "2026-03-09T10:02:01.000Z",
      type: "assistant",
      sessionId: childBetaSessionId,
      parentUuid: parentSessionId,
      cwd,
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "Beta reviewed storage evidence." }],
      },
    },
  ]);
}

async function writeJsonl(filePath, entries) {
  await writeFile(filePath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
