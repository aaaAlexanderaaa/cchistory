import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LiveHistorySnapshot, scanLiteHistory } from "@cchistory/live-runtime";
import { runLiteTui } from "./index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const codexRoot = path.join(repoRoot, "mock_data", ".codex", "sessions");

test("Lite TUI renders a non-interactive ephemeral snapshot", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runLiteTui(
    ["--source-root", `codex=${codexRoot}`, "--safe"],
    {
      cwd: repoRoot,
      homeDir: repoRoot,
      hostname: "cchistory-lite-tui-test-host",
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
      isInteractiveTerminal: false,
    },
  );
  assert.equal(exitCode, 0, stderr.join(""));
  assert.match(stdout.join(""), /CC History Lite TUI/);
  assert.match(stdout.join(""), /Projects/);
  assert.match(stdout.join(""), /Turns/);
});

test("Lite TUI reuses one snapshot for browse and replaces it only after refresh succeeds", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "cchistory-lite-tui-interactive-"));
  const stdout: string[] = [];
  const stderr: string[] = [];
  const commands = ["projects", "/mock", "stats source", "sources", "refresh", "q"];
  try {
    const exitCode = await runLiteTui(
      ["--source-root", `codex=${codexRoot}`, "--safe"],
      {
        cwd: repoRoot,
        homeDir: tempHome,
        hostname: "cchistory-lite-tui-interactive-test-host",
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value),
        isInteractiveTerminal: true,
        readLine: async () => commands.shift(),
      },
    );
    assert.equal(exitCode, 0, stderr.join(""));
    const output = stdout.join("");
    assert.match(output, /Search "mock"/);
    assert.match(output, /By source/);
    assert.match(output, /Sources/);
    assert.match(output, /Refreshing from native source data/);
    assert.match(output, /snapshot released/);
    await assert.rejects(access(path.join(tempHome, ".cchistory")));
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test("Lite TUI exits cleanly when input closes instead of hanging on a pending prompt", { timeout: 15_000 }, async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const input = new PassThrough();
  const output = new PassThrough();
  const runPromise = runLiteTui(
    ["--source-root", `codex=${codexRoot}`, "--safe"],
    {
      cwd: repoRoot,
      homeDir: repoRoot,
      hostname: "cchistory-lite-tui-eof-test-host",
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
      isInteractiveTerminal: true,
      input,
      output,
    },
  );
  input.end();
  const exitCode = await runPromise;
  assert.equal(exitCode, 0, stderr.join(""));
  assert.match(stdout.join(""), /snapshot released/);
});

test("Lite TUI interrupts gracefully on Ctrl+C mid-prompt without hanging", { timeout: 15_000 }, async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const input = new PassThrough();
  const output = new PassThrough();
  const runPromise = runLiteTui(
    ["--source-root", `codex=${codexRoot}`, "--safe"],
    {
      cwd: repoRoot,
      homeDir: repoRoot,
      hostname: "cchistory-lite-tui-sigint-test-host",
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
      isInteractiveTerminal: true,
      input,
      output,
    },
  );
  // Wait for the prompt to become active by watching output for the prompt
  // string, then emit a Ctrl+C keypress on the input stream. readline emits
  // 'SIGINT' but its pending question() promise never settles, so this also
  // exercises the readlineClose sentinel + Promise.race escape hatch.
  await new Promise<void>((resolve) => {
    const watcher = new PassThrough();
    let buffered = "";
    watcher.on("data", (chunk) => {
      buffered += chunk.toString();
      if (buffered.includes("lite> ")) {
        resolve();
      }
    });
    output.pipe(watcher);
  });
  input.emit("keypress", null, { ctrl: true, name: "c" });
  const exitCode = await runPromise;
  assert.equal(exitCode, 0, stderr.join(""));
  assert.match(stdout.join(""), /Interrupted; releasing snapshot/);
  assert.match(stdout.join(""), /snapshot released/);
});

test("Lite TUI pages every capped browse, search, and nested detail collection", async () => {
  const base = await scanLiteHistory({
    homeDir: repoRoot,
    hostname: "cchistory-lite-tui-pagination-fixture-host",
    sourceRoots: [{ sourceRef: "codex", baseDir: codexRoot }],
    safeMode: true,
  });
  const projectTemplate = base.data.projects[0];
  const sessionTemplate = base.data.sessions[0];
  const turnTemplate = base.data.turns[0];
  const source = base.data.sources[0];
  assert.ok(projectTemplate);
  assert.ok(sessionTemplate);
  assert.ok(turnTemplate);
  assert.ok(source);

  const projects = Array.from({ length: 51 }, (_, index) => ({
    ...projectTemplate,
    project_id: `pagination-project-${index}`,
    project_revision_id: `pagination-project-revision-${index}`,
    slug: `pagination-project-${index}`,
    display_name: `Pagination Project ${index}`,
    committed_turn_count: index === 0 ? 202 : 1,
    candidate_turn_count: 0,
  }));
  const sessions = Array.from({ length: 101 }, (_, index) => ({
    ...sessionTemplate,
    id: `pagination-session-${index}`,
    source_session_id: `pagination-native-session-${index}`,
    title: `Pagination Session ${index}`,
    source_id: source.id,
    turn_count: index === 0 ? 102 : 1,
  }));
  const turns = Array.from({ length: 202 }, (_, index) => {
    const sessionIndex = index <= 100 ? index : 0;
    const text = `pagination needle ${String(index).padStart(3, "0")}`;
    return {
      ...turnTemplate,
      id: `pagination-turn-${index}`,
      turn_revision_id: `pagination-turn-revision-${index}`,
      session_id: sessions[sessionIndex]!.id,
      project_id: projects[0]!.project_id,
      project_revision_id: projects[0]!.project_revision_id,
      raw_text: text,
      canonical_text: text,
    };
  });
  const snapshot = new LiveHistorySnapshot({
    ...base.data,
    projects,
    sessions,
    turns,
    contexts: [],
  });
  const stdout: string[] = [];
  const stderr: string[] = [];
  const commands = [
    "projects",
    "next",
    "prev",
    "sessions",
    "next",
    "turns",
    "page 2",
    "/pagination needle",
    "next",
    `project ${projects[0]!.project_id}`,
    "next",
    `session ${sessions[0]!.id}`,
    "next",
    `source ${source.id}`,
    "next",
    "q",
  ];

  const exitCode = await runLiteTui([], {
    cwd: repoRoot,
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
    isInteractiveTerminal: true,
    readLine: async () => commands.shift(),
    scan: async () => snapshot,
  });

  assert.equal(exitCode, 0, stderr.join(""));
  assert.equal(stderr.join(""), "");
  const projectPages = stdout.filter((value) => value.startsWith("Projects ("));
  assert.match(projectPages[0] ?? "", /Projects \(1-50 of 51\)/);
  assert.match(projectPages[0] ?? "", /Page 1\/2 · next: n \| next · jump: page <n>/);
  assert.match(projectPages[1] ?? "", /Projects \(51-51 of 51\)/);
  assert.match(projectPages[1] ?? "", /previous: b \| prev/);
  assert.match(projectPages[2] ?? "", /Projects \(1-50 of 51\)/);

  const sessionPages = stdout.filter((value) => value.startsWith("Sessions ("));
  assert.match(sessionPages[1] ?? "", /Sessions \(101-101 of 101\)/);
  const turnPages = stdout.filter((value) => value.startsWith("Turns ("));
  assert.match(turnPages[1] ?? "", /Turns \(101-200 of 202\)/);
  const searchPages = stdout.filter((value) => value.startsWith('Search "pagination needle"'));
  assert.match(searchPages[1] ?? "", /51-100 of 202 matches/);

  const projectDetailPages = stdout.filter((value) => value.startsWith("Project · Pagination Project 0"));
  assert.match(projectDetailPages[1] ?? "", /Sessions \(101-101 of 101\)/);
  assert.match(projectDetailPages[1] ?? "", /Turns \(101-200 of 202\)/);
  const sessionDetailPages = stdout.filter((value) => value.startsWith("Session · Pagination Session 0"));
  assert.match(sessionDetailPages[1] ?? "", /Turns \(101-102 of 102\)/);
  const sourceDetailPages = stdout.filter((value) => value.startsWith(`Source · ${source.display_name}`));
  assert.match(sourceDetailPages[1] ?? "", /Sessions \(101-101 of 101\)/);
  assert.doesNotMatch(stdout.join(""), /… \d+ more/);
});

test("Lite TUI retains the previous complete snapshot when refresh fails", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "cchistory-lite-tui-refresh-failure-"));
  const stdout: string[] = [];
  const stderr: string[] = [];
  const commands = ["refresh", "turns", "q"];
  let scanCount = 0;
  try {
    const exitCode = await runLiteTui(
      ["--source-root", `codex=${codexRoot}`, "--safe"],
      {
        cwd: repoRoot,
        homeDir: tempHome,
        hostname: "cchistory-lite-tui-refresh-failure-host",
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value),
        isInteractiveTerminal: true,
        readLine: async () => commands.shift(),
        scan: async (options) => {
          scanCount += 1;
          if (scanCount === 2) throw new Error("synthetic refresh failure");
          return scanLiteHistory(options);
        },
      },
    );
    assert.equal(exitCode, 0);
    assert.equal(scanCount, 2);
    assert.match(stderr.join(""), /previous snapshot retained: synthetic refresh failure/);
    assert.match(stdout.join(""), /Turns \(/);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test("Lite TUI rejects Full store flags before scanning", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let scanned = false;
  const exitCode = await runLiteTui(
    ["--store", "/tmp/full-store"],
    {
      cwd: repoRoot,
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
      isInteractiveTerminal: false,
      scan: async () => {
        scanned = true;
        throw new Error("must not scan");
      },
    },
  );
  assert.equal(exitCode, 2);
  assert.equal(scanned, false);
  assert.match(stderr.join(""), /does not accept --store or --db/);
});
