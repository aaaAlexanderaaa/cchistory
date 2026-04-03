import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { runBuiltCliCapture, runBuiltCliJson } from "./lib/test-fixtures.mjs";

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-skeptical-browse-"));
  const childEnv = { ...process.env, HOME: tempRoot };

  try {
    await seedBrowseSearchHome(tempRoot);

    const storeDir = path.join(tempRoot, "store");
    const missingStoreDir = path.join(tempRoot, "missing-store");

    for (const source of ["claude_code", "openclaw"]) {
      const syncResult = await runBuiltCliCapture(["sync", "--store", storeDir, "--source", source], tempRoot, childEnv);
      assert.equal(syncResult.exitCode, 0, syncResult.stderr);
      assert.equal(syncResult.stderr.trim(), "");
    }

    const projectsLong = await runBuiltCliCapture(["ls", "projects", "--store", storeDir, "--long"], tempRoot, childEnv);
    assert.equal(projectsLong.exitCode, 0, projectsLong.stderr);
    assert.match(projectsLong.stdout, /Source Mix/);
    assert.match(projectsLong.stdout, /Related Work/);
    assert.match(projectsLong.stdout, /chat-ui-kit/);
    assert.equal(projectsLong.stderr.trim(), "");

    const sessionsLong = await runBuiltCliCapture(["ls", "sessions", "--store", storeDir, "--long"], tempRoot, childEnv);
    assert.equal(sessionsLong.exitCode, 0, sessionsLong.stderr);
    assert.doesNotMatch(sessionsLong.stdout, /Platform/);
    assert.match(sessionsLong.stdout, /Source/);
    assert.match(sessionsLong.stdout, /claude_code@host-/);
    assert.match(sessionsLong.stdout, /Related Work/);
    assert.match(sessionsLong.stdout, /\d+ delegated/);
    assert.match(sessionsLong.stdout, /1 automation/);
    assert.equal(sessionsLong.stderr.trim(), "");

    const searchText = await runBuiltCliCapture(["search", "expert code reviewer", "--store", storeDir], tempRoot, childEnv);
    assert.equal(searchText.exitCode, 0, searchText.stderr);
    assert.match(searchText.stdout, /Use `cchistory show turn <shown-id>` to inspect a full turn\./);
    assert.match(searchText.stdout, /tree session .* --long/);
    assert.match(searchText.stdout, /related=\d+ delegated/);
    assert.match(searchText.stdout, /source=Claude Code \(claude_code\)/);
    assert.match(searchText.stdout, /\/clear \/review|\/review You are an expert code reviewer/i);
    assert.doesNotMatch(searchText.stdout, /<command-name>|<command-message>|<local-command-caveat>/);
    assert.doesNotMatch(searchText.stdout, /\/clear clear|review \/review/);
    assert.equal(searchText.stderr.trim(), "");

    const searchJson = await runBuiltCliJson(["search", "expert code reviewer", "--store", storeDir], tempRoot, childEnv);
    assert.equal(searchJson.kind, "search");
    const chosenHit = searchJson.results.find(
      (result) => result.session.source_platform === "claude_code" && /expert code reviewer/i.test(result.turn.canonical_text),
    );
    assert.ok(chosenHit, "expected a Claude review hit for skeptical browse/search verification");

    const scopedProjectSearch = await runBuiltCliJson(
      ["search", "expert code reviewer", "--store", storeDir, "--project", chosenHit.turn.project_id],
      tempRoot,
      childEnv,
    );
    assert.ok(scopedProjectSearch.results.length >= 1);
    assert.ok(scopedProjectSearch.results.some((result) => result.turn.id === chosenHit.turn.id));
    assert.ok(scopedProjectSearch.results.every((result) => result.turn.project_id === chosenHit.turn.project_id));

    const scopedSourceSearch = await runBuiltCliJson(
      ["search", "expert code reviewer", "--store", storeDir, "--source", "claude_code"],
      tempRoot,
      childEnv,
    );
    assert.ok(scopedSourceSearch.results.length >= 1);
    assert.ok(scopedSourceSearch.results.every((result) => result.session.source_platform === "claude_code"));

    const limitedSearch = await runBuiltCliJson(
      ["search", "expert code reviewer", "--store", storeDir, "--source", "claude_code", "--limit", "1"],
      tempRoot,
      childEnv,
    );
    assert.equal(limitedSearch.results.length, 1);
    assert.equal(limitedSearch.results[0]?.session.source_platform, "claude_code");

    const projectTreeLong = await runBuiltCliCapture(
      ["tree", "project", chosenHit.turn.project_id, "--store", storeDir, "--long"],
      tempRoot,
      childEnv,
    );
    assert.equal(projectTreeLong.exitCode, 0, projectTreeLong.stderr);
    assert.match(projectTreeLong.stdout, /chat-ui-kit \[ready\]/);
    assert.ok(projectTreeLong.stdout.includes(chosenHit.session.id));
    assert.match(projectTreeLong.stdout, /related=\d+ delegated/);
    assert.match(projectTreeLong.stdout, /Claude Code \(claude_code\)/);
    assert.match(projectTreeLong.stdout, /\/clear \/review|\/review You are an expert code reviewer/i);
    assert.doesNotMatch(projectTreeLong.stdout, /<command-name>|<command-message>|<local-command-caveat>/);
    assert.equal(projectTreeLong.stderr.trim(), "");

    const showTurn = await runBuiltCliCapture(["show", "turn", chosenHit.turn.id, "--store", storeDir], tempRoot, childEnv);
    assert.equal(showTurn.exitCode, 0, showTurn.stderr);
    assert.match(showTurn.stdout, /Project\s*:\s*chat-ui-kit/);
    assert.match(showTurn.stdout, /Source\s*:\s*Claude Code \(claude_code\)/);
    assert.match(showTurn.stdout, /\nPrompt\n[-]+/);
    assert.equal(showTurn.stderr.trim(), "");

    const sessionTree = await runBuiltCliCapture(["tree", "session", chosenHit.session.id, "--store", storeDir, "--long"], tempRoot, childEnv);
    assert.equal(sessionTree.exitCode, 0, sessionTree.stderr);
    assert.match(sessionTree.stdout, /Related Work/);
    assert.match(sessionTree.stdout, /transcript-primary/);
    assert.match(sessionTree.stdout, /Claude Code \(claude_code\)/);
    assert.match(sessionTree.stdout, /\/clear \/review|\/review You are an expert code reviewer/i);
    assert.doesNotMatch(sessionTree.stdout, /<command-name>|<command-message>|<local-command-caveat>/);
    assert.equal(sessionTree.stderr.trim(), "");

    const showSession = await runBuiltCliCapture(["show", "session", chosenHit.session.id, "--store", storeDir], tempRoot, childEnv);
    assert.equal(showSession.exitCode, 0, showSession.stderr);
    assert.match(showSession.stdout, /Related Work/);
    assert.match(showSession.stdout, /delegated_session/);
    assert.equal(showSession.stderr.trim(), "");

    const missingSession = await runBuiltCliCapture(["tree", "session", "missing-session", "--store", storeDir], tempRoot, childEnv);
    assert.equal(missingSession.exitCode, 1);
    assert.match(missingSession.stderr, /Unknown session reference: missing-session/);
    assert.doesNotMatch(missingSession.stderr, /ExperimentalWarning/);

    const missingTurn = await runBuiltCliCapture(["show", "turn", "missing-turn", "--store", storeDir], tempRoot, childEnv);
    assert.equal(missingTurn.exitCode, 1);
    assert.match(missingTurn.stderr, /Unknown turn reference: missing-turn/);
    assert.doesNotMatch(missingTurn.stderr, /ExperimentalWarning/);

    const tuiBrowse = await runBuiltTuiCapture(["--store", storeDir], tempRoot, childEnv);
    assert.equal(tuiBrowse.exitCode, 0, tuiBrowse.stderr);
    assert.match(tuiBrowse.stdout, /Mode=browse/);
    assert.match(tuiBrowse.stdout, /Projects(?: \[active\])?:/);
    assert.match(tuiBrowse.stdout, /chat-ui-kit/);
    assert.doesNotMatch(tuiBrowse.stderr, /ExperimentalWarning/);

    const tuiSearch = await runBuiltTuiCapture(["--store", storeDir, "--search", "expert code reviewer"], tempRoot, childEnv);
    assert.equal(tuiSearch.exitCode, 0, tuiSearch.stderr);
    assert.match(tuiSearch.stdout, /Mode=search/);
    assert.match(tuiSearch.stdout, /Project: chat-ui-kit/);
    assert.match(tuiSearch.stdout, /Source: Claude Code \(claude_code\)/);
    assert.match(tuiSearch.stdout, /Related Work: \d+ child sessions, 0 automation runs/);
    assert.doesNotMatch(tuiSearch.stdout, /<command-name>|<command-message>|<local-command-caveat>/);
    assert.doesNotMatch(tuiSearch.stderr, /ExperimentalWarning/);

    const tuiMissing = await runBuiltTuiCapture(["--store", missingStoreDir], tempRoot, childEnv);
    assert.equal(tuiMissing.exitCode, 1);
    assert.match(tuiMissing.stderr, /No indexed store found at .*cchistory\.sqlite/);
    assert.doesNotMatch(tuiMissing.stderr, /ExperimentalWarning/);

    console.log("Skeptical CLI/TUI browse/search verification passed.");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function runBuiltTuiCapture(argv, cwd, env = process.env) {
  const tuiEntry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../apps/tui/dist/index.js");
  return await new Promise((resolve, reject) => {
    execFile(process.execPath, [tuiEntry, ...argv], { cwd, env }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") {
        reject(error);
        return;
      }
      resolve({
        exitCode: typeof error?.code === "number" ? Number(error.code) : 0,
        stdout,
        stderr,
      });
    });
  });
}

async function seedBrowseSearchHome(tempRoot) {
  const mockDataRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../mock_data");
  await cp(path.join(mockDataRoot, ".claude"), path.join(tempRoot, ".claude"), { recursive: true });
  await cp(path.join(mockDataRoot, ".openclaw"), path.join(tempRoot, ".openclaw"), { recursive: true });
}

await main();
