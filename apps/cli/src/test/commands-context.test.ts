import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runCliCapture, seedCliFixtures, writeCodexSessionFixture } from "./helpers.js";

test("context project returns an AI-ready cross-session project packet", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-context-"));
  const originalHome = process.env.HOME;
  const longPrompt = [
    "Map the CLI context completeness contract across project recall commands.",
    "This sentence must survive past the old one hundred ten column clipping boundary.",
    "This sentence must also survive past the old one hundred eighty column long-mode clipping boundary.",
    "FINAL_UNTRUNCATED_CONTEXT_SENTINEL",
  ].join("\n");

  try {
    await seedCliFixtures(tempRoot);
    await writeCodexSessionFixture(tempRoot, "rollout-codex-session-2.jsonl", {
      sessionId: "codex-session-2",
      cwd: "/workspace/cchistory",
      model: "gpt-5",
      prompt: longPrompt,
      reply: "The AI agent should start from project-scoped asks.",
      startAt: "2026-03-09T02:00:00.000Z",
    });
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");

    const syncResult = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);

    const projectsResult = await runCliCapture(["ls", "projects", "--store", storeDir, "--json"], tempRoot);
    assert.equal(projectsResult.exitCode, 0, projectsResult.stderr);
    const projectsPayload = JSON.parse(projectsResult.stdout);
    const project = projectsPayload.projects.find((entry: { display_name?: string }) => entry.display_name === "cchistory")
      ?? projectsPayload.projects[0];
    assert.equal(typeof project.slug, "string");

    const listProjectsResult = await runCliCapture(["ls", "projects", "--store", storeDir], tempRoot);
    assert.equal(listProjectsResult.exitCode, 0, listProjectsResult.stderr);
    assert.match(listProjectsResult.stdout, /Name\s+Ref\s+Sessions\s+Turns\s+Last Active/);
    assert.match(listProjectsResult.stdout, new RegExp(escapeRegExp(project.slug)));

    const result = await runCliCapture(["context", "project", project.display_name, "--store", storeDir, "--limit", "2"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Project Context: cchistory/);
    assert.match(result.stdout, /Recent Asks/);
    assert.match(result.stdout, /Session Threads/);
    assert.match(result.stdout, /Open Next/);
    assert.match(result.stdout, /Map the CLI context completeness contract/);
    assert.match(result.stdout, /FINAL_UNTRUNCATED_CONTEXT_SENTINEL/);
    assert.match(result.stdout, /Review the probe output/);
    assert.match(result.stdout, /cchistory show turn/);
    assert.doesNotMatch(result.stdout, /canonical_text/);
    assert.doesNotMatch(result.stdout, /payload_json/);
    assert.doesNotMatch(result.stdout, /revision_id/);

    const jsonResult = await runCliCapture(["context", "project", "cchistory", "--store", storeDir, "--limit", "2", "--json"], tempRoot);
    assert.equal(jsonResult.exitCode, 0, jsonResult.stderr);
    const payload = JSON.parse(jsonResult.stdout);
    assert.equal(payload.kind, "project-context");
    assert.equal(payload.project.name, "cchistory");
    assert.equal(payload.recent_asks.length, 2);
    assert.equal(payload.recent_asks[0].prompt, longPrompt);
    assert.equal(payload.session_threads[0].latest_prompt, longPrompt);
    assert.match(result.stdout, new RegExp(escapeRegExp(payload.session_threads[0].title)));
    assert.ok(payload.recent_asks.every((ask: { prompt?: string; inspect?: { show_turn?: string } }) => ask.prompt && ask.inspect?.show_turn?.startsWith("cchistory show turn ")));
    assert.equal(Object.hasOwn(payload.recent_asks[0], "canonical_text"), false);
    assert.equal(Object.hasOwn(payload.recent_asks[0], "payload_json"), false);
    assert.match(payload.next.search_project, /cchistory search <query> --project/);

    const queryProjectResult = await runCliCapture(["query", "project", "--id", "cchistory", "--store", storeDir], tempRoot);
    assert.equal(queryProjectResult.exitCode, 0, queryProjectResult.stderr);
    const queryProjectPayload = JSON.parse(queryProjectResult.stdout);
    assert.equal(queryProjectPayload.project.project_id, project.project_id);
    assert.ok(queryProjectPayload.turns.length >= 2);

    const queryTurnsResult = await runCliCapture(["query", "turns", "--project", "cchistory", "--store", storeDir, "--limit", "10"], tempRoot);
    assert.equal(queryTurnsResult.exitCode, 0, queryTurnsResult.stderr);
    const queryTurnsPayload = JSON.parse(queryTurnsResult.stdout);
    assert.ok(queryTurnsPayload.every((turn: { project_id?: string }) => turn.project_id === project.project_id));
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
