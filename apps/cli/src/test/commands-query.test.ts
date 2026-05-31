import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { overwriteCodexPrompt, runCliCapture, seedCliFixtures, writeCodexSessionFixture } from "./helpers.js";

function findAmbiguousPrefix(values: string[]): string {
  for (let left = 0; left < values.length; left++) {
    for (let right = left + 1; right < values.length; right++) {
      let prefix = commonPrefix(values[left]!, values[right]!);
      while (prefix.length > 0 && values.includes(prefix)) {
        prefix = prefix.slice(0, -1);
      }
      if (prefix.length > 0) {
        return prefix;
      }
    }
  }
  throw new Error(`Could not find ambiguous prefix for values: ${values.join(", ")}`);
}

function commonPrefix(left: string, right: string): string {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index++;
  }
  return left.slice(0, index);
}

test("search matches partial keywords without requiring an exact phrase", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-search-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");

    await runCliCapture(["sync", "--store", storeDir], tempRoot);
    const result = await runCliCapture(["search", "probe output", "--store", storeDir], tempRoot);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Review the probe output/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("query source filters accept human source slots, not only source IDs", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-query-source-filter-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");

    const syncResult = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--source", "claude_code"], tempRoot);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);

    const turnsResult = await runCliCapture(["query", "turns", "--store", storeDir, "--source", "codex", "--limit", "10"], tempRoot);
    assert.equal(turnsResult.exitCode, 0, turnsResult.stderr);
    const turns = JSON.parse(turnsResult.stdout);
    assert.ok(turns.length > 0);
    assert.ok(turns.every((turn: { source_id: string }) => turn.source_id.includes("codex")));

    const sessionsResult = await runCliCapture(["query", "sessions", "--store", storeDir, "--source", "claude_code", "--limit", "10"], tempRoot);
    assert.equal(sessionsResult.exitCode, 0, sessionsResult.stderr);
    const sessions = JSON.parse(sessionsResult.stdout);
    assert.ok(sessions.length > 0);
    assert.ok(sessions.every((session: { source_platform: string }) => session.source_platform === "claude_code"));

    const projectsResult = await runCliCapture(["query", "projects", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(projectsResult.exitCode, 0, projectsResult.stderr);
    const projects = JSON.parse(projectsResult.stdout);
    assert.ok(projects.length > 0);
    assert.ok(projects.every((project: { display_name: string }) => project.display_name === "cchistory"));

    const projectResult = await runCliCapture(["query", "project", "--store", storeDir, "--id", "cchistory", "--source", "codex"], tempRoot);
    assert.equal(projectResult.exitCode, 0, projectResult.stderr);
    const projectPayload = JSON.parse(projectResult.stdout);
    assert.ok(projectPayload.turns.length > 0);
    assert.ok(projectPayload.turns.every((turn: { source_id: string }) => turn.source_id.includes("codex")));
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("show session and query session accept human-friendly session references", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-session-refs-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");

    await runCliCapture(["sync", "--store", storeDir], tempRoot);

    // Use full session ID to avoid ambiguity (short prefixes like "sess" match multiple sessions)
    const sessionList = await runCliCapture(["ls", "sessions", "--store", storeDir, "--json"], tempRoot);
    const sessionsPayload = JSON.parse(sessionList.stdout);
    const sessions = sessionsPayload.sessions ?? sessionsPayload;
    const firstSessionId = sessions[0].id;

    const showResult = await runCliCapture(["show", "session", firstSessionId, "--store", storeDir], tempRoot);
    assert.equal(showResult.exitCode, 0);
    assert.match(showResult.stdout, /Title/);
    assert.match(showResult.stdout, /Asks/);
    assert.doesNotMatch(showResult.stdout, /Session ID\s+:/);
    assert.doesNotMatch(showResult.stdout, /Source ID\s+:/);

    const showLongResult = await runCliCapture(["show", "session", firstSessionId, "--store", storeDir, "--long"], tempRoot);
    assert.equal(showLongResult.exitCode, 0, showLongResult.stderr);
    assert.match(showLongResult.stdout, /Session ID\s+:/);
    assert.match(showLongResult.stdout, /Source ID\s+:/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("show session and turn reject ambiguous prefixes with actionable errors", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-ambiguous-refs-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    for (let index = 2; index <= 20; index++) {
      await writeCodexSessionFixture(tempRoot, `rollout-codex-session-${index}.jsonl`, {
        sessionId: `codex-session-${index}`,
        cwd: "/workspace/cchistory",
        model: "gpt-5",
        prompt: `Review probe output ${index}.`,
        reply: `Probe output ${index} looks healthy.`,
        startAt: `2026-03-09T${String(index).padStart(2, "0")}:00:00.000Z`,
      });
    }
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");

    await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);

    const sessionPrefix = "/workspace/cchistory";

    const sessionResult = await runCliCapture(["show", "session", sessionPrefix, "--store", storeDir], tempRoot);
    assert.equal(sessionResult.exitCode, 1);
    assert.match(sessionResult.stderr, new RegExp(`Ambiguous session reference: ${escapeRegExp(sessionPrefix)}`));
    assert.match(sessionResult.stderr, /Matched workspace/);

    const turnsResult = await runCliCapture(["query", "turns", "--store", storeDir, "--limit", "30"], tempRoot);
    assert.equal(turnsResult.exitCode, 0, turnsResult.stderr);
    const turns = JSON.parse(turnsResult.stdout);
    const turnPrefix = findAmbiguousPrefix(turns.map((turn: { id: string }) => turn.id));

    const turnResult = await runCliCapture(["show", "turn", turnPrefix, "--store", storeDir], tempRoot);
    assert.equal(turnResult.exitCode, 1);
    assert.match(turnResult.stderr, new RegExp(`Ambiguous turn reference: ${escapeRegExp(turnPrefix)}`));
    assert.match(turnResult.stderr, /Matched ID prefix/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("ls sessions has compact default output and richer long output", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-session-listing-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");

    await runCliCapture(["sync", "--store", storeDir], tempRoot);

    const compactResult = await runCliCapture(["ls", "sessions", "--store", storeDir], tempRoot);
    assert.equal(compactResult.exitCode, 0, compactResult.stderr);
    assert.match(compactResult.stdout, /ID\s+Title\s+Project\s+Model\s+Updated/);
    assert.doesNotMatch(compactResult.stdout, /Related Work/);
    assert.doesNotMatch(compactResult.stdout, /Source\s+Model\s+Turns/);

    const longResult = await runCliCapture(["ls", "sessions", "--store", storeDir, "--long"], tempRoot);
    assert.equal(longResult.exitCode, 0, longResult.stderr);
    assert.match(longResult.stdout, /ID\s+Title\s+Project\s+Source\s+Model\s+Turns\s+Related Work\s+Updated/);
    assert.match(longResult.stdout, /codex@|claude_code@/);

    const jsonResult = await runCliCapture(["ls", "sessions", "--store", storeDir, "--json"], tempRoot);
    assert.equal(jsonResult.exitCode, 0, jsonResult.stderr);
    const payload = JSON.parse(jsonResult.stdout);
    assert.equal(payload.kind, "sessions");
    assert.ok(payload.sessions.some((session: { id?: string }) => typeof session.id === "string" && session.id.length > 12));
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("show project default output leads with asks while long/json preserve trace fields", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-show-project-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");

    await runCliCapture(["sync", "--store", storeDir], tempRoot);
    const projectsResult = await runCliCapture(["ls", "projects", "--store", storeDir, "--json"], tempRoot);
    assert.equal(projectsResult.exitCode, 0, projectsResult.stderr);
    const projectsPayload = JSON.parse(projectsResult.stdout);
    const projectId = projectsPayload.projects[0]?.project_id;
    assert.equal(typeof projectId, "string");

    const showResult = await runCliCapture(["show", "project", projectId, "--store", storeDir], tempRoot);
    assert.equal(showResult.exitCode, 0, showResult.stderr);
    assert.match(showResult.stdout, /Asks\s+:/);
    assert.match(showResult.stdout, /Recent Asks/);
    assert.doesNotMatch(showResult.stdout, /Project ID\s+:/);
    assert.doesNotMatch(showResult.stdout, /Hosts\s+:/);
    assert.doesNotMatch(showResult.stdout, /Recent Turns/);

    const showLongResult = await runCliCapture(["show", "project", projectId, "--store", storeDir, "--long"], tempRoot);
    assert.equal(showLongResult.exitCode, 0, showLongResult.stderr);
    assert.match(showLongResult.stdout, /Project ID\s+:/);
    assert.match(showLongResult.stdout, /Hosts\s+:/);

    const showJsonResult = await runCliCapture(["show", "project", projectId, "--store", storeDir, "--json"], tempRoot);
    assert.equal(showJsonResult.exitCode, 0, showJsonResult.stderr);
    const showPayload = JSON.parse(showJsonResult.stdout);
    assert.equal(showPayload.project.project_id, projectId);
    assert.ok(Array.isArray(showPayload.turns));
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("tree project default leads with session threads while long preserves trace metadata", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-tree-project-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");

    await runCliCapture(["sync", "--store", storeDir], tempRoot);
    const projectsResult = await runCliCapture(["ls", "projects", "--store", storeDir, "--json"], tempRoot);
    assert.equal(projectsResult.exitCode, 0, projectsResult.stderr);
    const projectsPayload = JSON.parse(projectsResult.stdout);
    const projectId = projectsPayload.projects[0]?.project_id;
    assert.equal(typeof projectId, "string");

    const treeResult = await runCliCapture(["tree", "project", projectId, "--store", storeDir], tempRoot);
    assert.equal(treeResult.exitCode, 0, treeResult.stderr);
    assert.match(treeResult.stdout, /Session Threads/);
    assert.match(treeResult.stdout, /Asks\s+:/);
    assert.doesNotMatch(treeResult.stdout, /hosts=/);
    assert.doesNotMatch(treeResult.stdout, /source_mix=/);
    assert.doesNotMatch(treeResult.stdout, /host=/);
    assert.doesNotMatch(treeResult.stdout, /session_id=/);

    const longResult = await runCliCapture(["tree", "project", projectId, "--store", storeDir, "--long"], tempRoot);
    assert.equal(longResult.exitCode, 0, longResult.stderr);
    assert.match(longResult.stdout, /Project ID\s+:/);
    assert.match(longResult.stdout, /Hosts\s+:/);
    assert.match(longResult.stdout, /Source Mix\s+:/);
    assert.match(longResult.stdout, /session_id=/);
    assert.match(longResult.stdout, /source=/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("tree session renders turn hierarchy for a specific session", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-tree-session-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");

    await runCliCapture(["sync", "--store", storeDir], tempRoot);
    const sessionList = await runCliCapture(["ls", "sessions", "--store", storeDir, "--json"], tempRoot);
    const sessionsPayload = JSON.parse(sessionList.stdout);
    const sessions = sessionsPayload.sessions ?? sessionsPayload;
    const firstSessionId = sessions[0].id;

    const treeResult = await runCliCapture(["tree", "session", firstSessionId, "--store", storeDir], tempRoot);
    assert.equal(treeResult.exitCode, 0);
    assert.match(treeResult.stdout, /Asks/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("show turn human output summarizes prompt while json preserves full text", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-show-turn-"));
  const originalHome = process.env.HOME;
  const longPrompt = [
    "You are an expert code reviewer.",
    "Boilerplate review instruction ".repeat(90),
    "",
    "## My request",
    "Please review the auth module for missing permission checks.",
  ].join("\n");

  try {
    await seedCliFixtures(tempRoot);
    await overwriteCodexPrompt(tempRoot, longPrompt);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");

    await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    const searchResult = await runCliCapture(["search", "auth module permission", "--store", storeDir, "--json"], tempRoot);
    assert.equal(searchResult.exitCode, 0, searchResult.stderr);
    const searchPayload = JSON.parse(searchResult.stdout);
    const turnId = searchPayload.results[0]?.turn?.id;
    assert.equal(typeof turnId, "string");

    const showResult = await runCliCapture(["show", "turn", turnId, "--store", storeDir], tempRoot);
    assert.equal(showResult.exitCode, 0, showResult.stderr);
    assert.match(showResult.stdout, /\nPrompt\n[-]+/);
    assert.match(showResult.stdout, /Please review the auth module for missing permission checks\./);
    assert.doesNotMatch(showResult.stdout, /Boilerplate review instruction/);
    assert.doesNotMatch(showResult.stdout, /Session ID\s+:/);
    assert.doesNotMatch(showResult.stdout, /Turn ID\s+:/);
    assert.doesNotMatch(showResult.stdout, /Revision ID\s+:/);

    const showLongResult = await runCliCapture(["show", "turn", turnId, "--store", storeDir, "--long"], tempRoot);
    assert.equal(showLongResult.exitCode, 0, showLongResult.stderr);
    assert.match(showLongResult.stdout, /Boilerplate review instruction/);
    assert.match(showLongResult.stdout, /Traceability/);
    assert.match(showLongResult.stdout, /Session ID\s+:/);
    assert.match(showLongResult.stdout, /Turn ID\s+:/);
    assert.match(showLongResult.stdout, /Revision ID\s+:/);

    const showJsonResult = await runCliCapture(["show", "turn", turnId, "--store", storeDir, "--json"], tempRoot);
    assert.equal(showJsonResult.exitCode, 0, showJsonResult.stderr);
    const showPayload = JSON.parse(showJsonResult.stdout);
    assert.match(showPayload.turn.canonical_text, /Boilerplate review instruction/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});
