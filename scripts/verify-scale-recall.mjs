import "./install-node-sqlite-warning-filter.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const cliEntry = path.join(projectRoot, "apps", "cli", "dist", "index.js");
const tuiEntry = path.join(projectRoot, "apps", "tui", "dist", "index.js");

const SESSIONS_PER_SOURCE = 12;
const TURNS_PER_SESSION = 100;
const EXPECTED_TOTAL_TURNS = SESSIONS_PER_SOURCE * TURNS_PER_SESSION * 2;
const TARGET_CODEX_ANCHOR = "anchorcodex07042";
const TARGET_CLAUDE_ANCHOR = "anchorclaude11099";

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-scale-recall-"));
  const childEnv = { ...process.env, HOME: tempRoot };

  try {
    await seedScaleHome(tempRoot);
    const storeDir = path.join(tempRoot, "store");

    const syncResult = await runBuiltCliCapture(
      ["sync", "--store", storeDir, "--source", "codex", "--source", "claude_code"],
      tempRoot,
      childEnv,
    );
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);
    assert.match(syncResult.stdout, /Synced 2 source\(s\)/);

    await verifyBrowse(storeDir, tempRoot, childEnv);
    await verifySearchAndDetail(storeDir, tempRoot, childEnv);
    await verifyTuiSearch(storeDir, tempRoot, childEnv);

    console.log(
      `Scale recall verification passed: ${EXPECTED_TOTAL_TURNS} turns across ${SESSIONS_PER_SOURCE * 2} sessions and 2 sources.`,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function verifyBrowse(storeDir, cwd, env) {
  const sources = await runBuiltCliJson(["ls", "sources", "--store", storeDir], cwd, env);
  assert.equal(sources.kind, "sources");
  assert.equal(sources.sources.length, 2);

  const codexSource = sources.sources.find((source) => source.platform === "codex");
  const claudeSource = sources.sources.find((source) => source.platform === "claude_code");
  assert.ok(codexSource, "expected generated Codex source");
  assert.ok(claudeSource, "expected generated Claude Code source");
  assert.equal(codexSource.total_turns, SESSIONS_PER_SOURCE * TURNS_PER_SESSION);
  assert.equal(claudeSource.total_turns, SESSIONS_PER_SOURCE * TURNS_PER_SESSION);

  const sessions = await runBuiltCliJson(["ls", "sessions", "--store", storeDir], cwd, env);
  assert.equal(sessions.kind, "sessions");
  assert.equal(sessions.sessions.length, SESSIONS_PER_SOURCE * 2);
  assert.ok(sessions.sessions.every((session) => session.turn_count === TURNS_PER_SESSION));
  assert.ok(sessions.sessions.some((session) => session.source_platform === "codex"));
  assert.ok(sessions.sessions.some((session) => session.source_platform === "claude_code"));

  const projects = await runBuiltCliJson(["ls", "projects", "--store", storeDir], cwd, env);
  assert.equal(projects.kind, "projects");
  assert.ok(projects.projects.length >= 8, `expected generated scale projects, got ${projects.projects.length}`);
  assert.ok(projects.projects.some((project) => project.primary_workspace_path?.includes("/workspace/scale-lab/codex/")));
  assert.ok(projects.projects.some((project) => project.primary_workspace_path?.includes("/workspace/scale-lab/claude/")));

  const browseText = await runBuiltCliCapture(["ls", "projects", "--store", storeDir, "--limit", "8"], cwd, env);
  assert.equal(browseText.exitCode, 0, browseText.stderr);
  assert.match(browseText.stdout, /Name\s+Sessions\s+Turns\s+Last Active/);
  assert.match(browseText.stdout, /project-/);
}

async function verifySearchAndDetail(storeDir, cwd, env) {
  const codexSearch = await runBuiltCliJson(["search", TARGET_CODEX_ANCHOR, "--store", storeDir, "--limit", "5"], cwd, env);
  assert.equal(codexSearch.kind, "search");
  assert.equal(codexSearch.results.length, 1);
  const codexHit = codexSearch.results[0];
  assert.equal(codexHit.session.source_platform, "codex");
  assert.match(codexHit.turn.canonical_text, new RegExp(TARGET_CODEX_ANCHOR));

  const codexDetail = await runBuiltCliJson(["show", "turn", codexHit.turn.id, "--store", storeDir], cwd, env);
  assert.equal(codexDetail.turn.id, codexHit.turn.id);
  assert.match(codexDetail.turn.canonical_text, new RegExp(TARGET_CODEX_ANCHOR));
  assert.ok((codexDetail.context?.assistant_replies.length ?? 0) >= 1);
  assert.ok((codexDetail.context?.tool_calls.length ?? 0) >= 1);
  assert.match(JSON.stringify(codexDetail.context), /large-scale-diagnostic-output/);

  const claudeSearch = await runBuiltCliJson(["search", TARGET_CLAUDE_ANCHOR, "--store", storeDir, "--limit", "5"], cwd, env);
  assert.equal(claudeSearch.kind, "search");
  assert.equal(claudeSearch.results.length, 1);
  const claudeHit = claudeSearch.results[0];
  assert.equal(claudeHit.session.source_platform, "claude_code");
  assert.match(claudeHit.turn.canonical_text, new RegExp(TARGET_CLAUDE_ANCHOR));

  const claudeDetail = await runBuiltCliJson(["show", "turn", claudeHit.turn.id, "--store", storeDir], cwd, env);
  assert.equal(claudeDetail.turn.id, claudeHit.turn.id);
  assert.match(claudeDetail.turn.canonical_text, new RegExp(TARGET_CLAUDE_ANCHOR));
  assert.ok((claudeDetail.context?.assistant_replies.length ?? 0) >= 1);
}

async function verifyTuiSearch(storeDir, cwd, env) {
  const tuiSearch = await runBuiltTuiCapture(["--store", storeDir, "--search", TARGET_CLAUDE_ANCHOR], cwd, env);
  assert.equal(tuiSearch.exitCode, 0, tuiSearch.stderr);
  assert.match(tuiSearch.stdout, new RegExp(`Search: ${TARGET_CLAUDE_ANCHOR}`));
  assert.match(tuiSearch.stdout, /Claude Code|claude_code/);
  assert.match(tuiSearch.stdout, new RegExp(TARGET_CLAUDE_ANCHOR));

  const tuiBrowse = await runBuiltTuiCapture(["--store", storeDir], cwd, env);
  assert.equal(tuiBrowse.exitCode, 0, tuiBrowse.stderr);
  assert.match(tuiBrowse.stdout, /Browse projects and asks/);
  assert.match(tuiBrowse.stdout, /project-/);
}

async function seedScaleHome(tempRoot) {
  await seedCodexScaleSessions(path.join(tempRoot, ".codex", "sessions"));
  await seedClaudeScaleSessions(path.join(tempRoot, ".claude", "projects", "-workspace-scale-lab"));
}

async function seedCodexScaleSessions(rootDir) {
  await mkdir(rootDir, { recursive: true });
  for (let sessionIndex = 0; sessionIndex < SESSIONS_PER_SOURCE; sessionIndex++) {
    const sessionId = `scale-codex-session-${pad(sessionIndex)}`;
    const projectIndex = sessionIndex % 4;
    const cwd = `/workspace/scale-lab/codex/project-${pad(projectIndex)}`;
    const lines = [
      {
        timestamp: timeFor(sessionIndex, 0, 0),
        type: "session_meta",
        payload: { id: sessionId, cwd, model: "gpt-5.2" },
      },
      {
        timestamp: timeFor(sessionIndex, 0, 1),
        type: "turn_context",
        payload: { cwd, model: "gpt-5.2" },
      },
    ];

    for (let turnIndex = 0; turnIndex < TURNS_PER_SESSION; turnIndex++) {
      const anchor = sessionIndex === 7 && turnIndex === 42 ? TARGET_CODEX_ANCHOR : `codexnoise${pad(sessionIndex)}${pad(turnIndex)}`;
      const userText = `Scale recall ${anchor} inspect Codex project-${pad(projectIndex)} pagination and detail for turn ${turnIndex}.`;
      lines.push({
        timestamp: timeFor(sessionIndex, turnIndex, 2),
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: userText }],
        },
      });

      if (anchor === TARGET_CODEX_ANCHOR) {
        lines.push({
          timestamp: timeFor(sessionIndex, turnIndex, 3),
          type: "response_item",
          payload: {
            type: "function_call",
            call_id: "scale-target-call",
            name: "shell",
            arguments: JSON.stringify({ cmd: "generate-large-scale-diagnostic-output" }),
          },
        });
        lines.push({
          timestamp: timeFor(sessionIndex, turnIndex, 4),
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "scale-target-call",
            output: `large-scale-diagnostic-output ${"0123456789".repeat(450)}`,
          },
        });
      }

      lines.push({
        timestamp: timeFor(sessionIndex, turnIndex, 5),
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: `Recorded scale detail for ${anchor}.` }],
        },
      });
    }

    await writeJsonl(path.join(rootDir, `rollout-scale-codex-${pad(sessionIndex)}.jsonl`), lines);
  }
}

async function seedClaudeScaleSessions(rootDir) {
  await mkdir(rootDir, { recursive: true });
  for (let sessionIndex = 0; sessionIndex < SESSIONS_PER_SOURCE; sessionIndex++) {
    const sessionId = `scale-claude-session-${pad(sessionIndex)}`;
    const projectIndex = sessionIndex % 4;
    const cwd = `/workspace/scale-lab/claude/project-${pad(projectIndex)}`;
    const lines = [];

    for (let turnIndex = 0; turnIndex < TURNS_PER_SESSION; turnIndex++) {
      const anchor = sessionIndex === 11 && turnIndex === 99 ? TARGET_CLAUDE_ANCHOR : `claudenoise${pad(sessionIndex)}${pad(turnIndex)}`;
      lines.push({
        timestamp: timeFor(100 + sessionIndex, turnIndex, 0),
        type: "user",
        sessionId,
        cwd,
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: `Scale recall ${anchor} inspect Claude project-${pad(projectIndex)} pagination and detail for turn ${turnIndex}.`,
            },
          ],
        },
      });
      lines.push({
        timestamp: timeFor(100 + sessionIndex, turnIndex, 1),
        type: "assistant",
        sessionId,
        cwd,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: `Recorded scale detail for ${anchor}.` }],
        },
      });
    }

    await writeJsonl(path.join(rootDir, `conversation-scale-claude-${pad(sessionIndex)}.jsonl`), lines);
  }
}

async function writeJsonl(filePath, entries) {
  await writeFile(filePath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
}

function timeFor(sessionIndex, turnIndex, step) {
  const base = Date.UTC(2026, 2, 9, 0, 0, 0);
  const offsetMs = ((sessionIndex * TURNS_PER_SESSION + turnIndex) * 10 + step) * 1000;
  return new Date(base + offsetMs).toISOString();
}

function pad(value) {
  return String(value).padStart(2, "0");
}

async function runBuiltCliJson(argv, cwd, env) {
  const result = await runBuiltCliCapture([...argv, "--json"], cwd, env);
  assert.equal(result.exitCode, 0, result.stderr);
  return JSON.parse(result.stdout);
}

async function runBuiltCliCapture(argv, cwd, env) {
  return await runNodeEntry(cliEntry, argv, cwd, env);
}

async function runBuiltTuiCapture(argv, cwd, env) {
  return await runNodeEntry(tuiEntry, argv, cwd, env);
}

async function runNodeEntry(entry, argv, cwd, env) {
  return await new Promise((resolve, reject) => {
    execFile(process.execPath, [entry, ...argv], { cwd, env, timeout: 120_000 }, (error, stdout, stderr) => {
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
