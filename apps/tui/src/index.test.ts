import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getDefaultSources, runSourceProbe } from "@cchistory/source-adapters";
import { CCHistoryStorage, buildLocalTuiBrowser } from "@cchistory/storage";

type FixturePayload = Parameters<CCHistoryStorage["replaceSourcePayload"]>[0];
import { createBrowserState, reduceBrowserState, renderBrowserSnapshot } from "./browser.js";
import { stripAnsi } from "./colors.js";
import { runTui } from "./index.js";

function createIo(cwd: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      cwd,
      stdout: (value: string) => stdout.push(value),
      stderr: (value: string) => stderr.push(value),
      isInteractiveTerminal: false,
    },
    stdout,
    stderr,
  };
}

test("help output describes the local TUI browser", async () => {
  const { io, stdout, stderr } = createIo(process.cwd());
  const exitCode = await runTui(["--help"], io);

  assert.equal(exitCode, 0);
  assert.match(stdout.join(""), /project, turn, and detail browsing/i);
  assert.match(stdout.join(""), /--store/i);
  assert.match(stdout.join(""), /--full/);
  assert.match(stdout.join(""), /analogous to CLI `--full`/i);
  assert.match(stdout.join(""), /--source-health/);
  assert.equal(stderr.join(""), "");
});

test("built entrypoint suppresses runtime SQLite experimental warnings for help and missing-store flows", async () => {
  const builtEntry = fileURLToPath(new URL("./index.js", import.meta.url));
  const helpResult = spawnSync(process.execPath, [builtEntry, "--help"], { encoding: "utf8" });

  assert.equal(helpResult.status, 0);
  assert.match(helpResult.stdout, /Usage: cchistory tui/);
  assert.doesNotMatch(helpResult.stderr, /ExperimentalWarning/);

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-tui-built-missing-store-"));
  try {
    const missingStore = path.join(tempDir, "missing-store");
    const missingResult = spawnSync(process.execPath, [builtEntry, "--store", missingStore], { encoding: "utf8" });

    assert.equal(missingResult.status, 1);
    assert.match(missingResult.stderr, /No indexed store found at .*missing-store.*cchistory\.sqlite/);
    assert.doesNotMatch(missingResult.stderr, /ExperimentalWarning/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});


test("interactive full mode is rejected clearly", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runTui(["--full"], {
    cwd: process.cwd(),
    stdout: (value: string) => stdout.push(value),
    stderr: (value: string) => stderr.push(value),
    isInteractiveTerminal: true,
  });

  assert.equal(exitCode, 1);
  assert.equal(stdout.join(""), "");
  assert.match(stderr.join(""), /Interactive TUI `--full` is not supported yet/);
  assert.match(stderr.join(""), /non-interactive snapshot mode/);
});

test("entrypoint renders pane-based browser snapshot without requiring an API service", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-tui-"));

  try {
    const dbPath = path.join(tempDir, "custom.sqlite");
    const seedStorage = new CCHistoryStorage({ dbPath });
    seedStorage.close();

    const { io, stdout, stderr } = createIo(tempDir);
    const exitCode = await runTui(["--db", dbPath], io);
    const output = stdout.join("");

    const stripped = stripAnsi(output);
    assert.equal(exitCode, 0);
    assert.match(stripped, /CCHistory TUI/);
    assert.match(stripped, new RegExp(dbPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(stripped, /Projects/);
    assert.match(stripped, /Turns/);
    assert.match(stripped, /Detail/);
    assert.equal(stderr.join(""), "");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("entrypoint rejects a missing explicit SQLite path without creating a store", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-tui-missing-db-"));

  try {
    const dbPath = path.join(tempDir, "missing.sqlite");
    const { io, stdout, stderr } = createIo(tempDir);
    const exitCode = await runTui(["--db", dbPath], io);

    assert.equal(exitCode, 1);
    assert.equal(stdout.join(""), "");
    assert.match(stderr.join(""), /No indexed store found at .*missing\.sqlite/);
    await assert.rejects(access(dbPath));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("entrypoint rejects a missing explicit store directory without creating a store", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-tui-missing-store-"));

  try {
    const storeDir = path.join(tempDir, "missing-store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const { io, stdout, stderr } = createIo(tempDir);
    const exitCode = await runTui(["--store", storeDir], io);

    assert.equal(exitCode, 1);
    assert.equal(stdout.join(""), "");
    assert.match(stderr.join(""), /No indexed store found at .*missing-store.*cchistory\.sqlite/);
    await assert.rejects(access(dbPath));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
test("browser reducer moves focus and drill-down state predictably", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-tui-model-"));

  try {
    const storage = new CCHistoryStorage({ dbPath: path.join(tempDir, "browser.sqlite") });
    storage.replaceSourcePayload(
      createFixturePayload("src-tui", "First project turn", "stage-tui-1", {
        sessionId: "session-a",
        turnId: "turn-a",
        workingDirectory: "/workspace/alpha",
        includeProjectObservation: true,
      }),
    );
    storage.upsertProjectOverride({
      target_kind: "turn",
      target_ref: "turn-a",
      project_id: "project-a",
      display_name: "Alpha Project",
    });

    storage.replaceSourcePayload(
      createFixturePayload("src-tui-2", "Second project turn", "stage-tui-2", {
        sessionId: "session-b",
        turnId: "turn-b",
        workingDirectory: "/workspace/beta",
        includeProjectObservation: true,
      }),
    );
    storage.upsertProjectOverride({
      target_kind: "turn",
      target_ref: "turn-b",
      project_id: "project-b",
      display_name: "Beta Project",
    });

    const browser = buildLocalTuiBrowser(storage);
    let state = createBrowserState(browser);

    assert.equal(browser.projects[0]?.project.display_name, "Beta Project");
    assert.equal(state.focusPane, "projects");

    state = reduceBrowserState(browser, state, { type: "move-down" });
    assert.equal(browser.projects[state.selectedProjectIndex]?.project.display_name, "Alpha Project");

    state = reduceBrowserState(browser, state, { type: "drill" });
    assert.equal(state.focusPane, "turns");

    state = reduceBrowserState(browser, state, { type: "drill" });
    assert.equal(state.focusPane, "detail");

    const snapshot = stripAnsi(renderBrowserSnapshot(browser, state));
    assert.match(snapshot, /Alpha Project/);
    assert.match(snapshot, /First project turn/);

    storage.close();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("browser search/detail snapshots tame command-style markup in display-only snippets", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-tui-markup-"));

  try {
    const storage = new CCHistoryStorage({ dbPath: path.join(tempDir, "markup.sqlite") });
    storage.replaceSourcePayload(
      createFixturePayload(
        "src-markup",
        "<command-name>/review</command-name> <command-message>review</command-message> <local-command-caveat>Ignore this caveat in snippet output.</local-command-caveat> You are an expert code reviewer.",
        "stage-markup",
        {
          sessionId: "session-markup",
          turnId: "turn-markup",
          workingDirectory: "/workspace/markup",
          includeProjectObservation: true,
        },
      ),
    );
    storage.upsertProjectOverride({
      target_kind: "turn",
      target_ref: "turn-markup",
      project_id: "project-markup",
      display_name: "Markup Project",
    });

    const browser = buildLocalTuiBrowser(storage);
    let state = createBrowserState(browser);
    state = reduceBrowserState(browser, state, { type: "enter-search-mode" });
    for (const value of "expert code reviewer") {
      state = reduceBrowserState(browser, state, { type: "append-search-char", value });
    }
    state = reduceBrowserState(browser, state, { type: "drill" });
    state = reduceBrowserState(browser, state, { type: "drill" });

    const snapshot = stripAnsi(renderBrowserSnapshot(browser, state));
    assert.match(snapshot, /expert code reviewer/i);
    assert.match(snapshot, /Source: Storage fixture \(codex\)/);
    assert.match(snapshot, /\/review You are an expert code reviewer/i);
    assert.doesNotMatch(snapshot, /<command-name>|<command-message>|<local-command-caveat>/);
    assert.doesNotMatch(snapshot, /\/review review/);

    storage.close();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("browser snapshot marks active pane and preserves turn detail cues", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-tui-detail-"));

  try {
    const storage = new CCHistoryStorage({ dbPath: path.join(tempDir, "detail.sqlite") });
    storage.replaceSourcePayload(
      createFixturePayload("src-detail", "Investigate failing adapter test", "stage-detail", {
        sessionId: "session-detail",
        turnId: "turn-detail",
        workingDirectory: "/workspace/detail",
        includeProjectObservation: true,
      }),
    );
    storage.upsertProjectOverride({
      target_kind: "turn",
      target_ref: "turn-detail",
      project_id: "project-detail",
      display_name: "Detail Project",
    });

    const browser = buildLocalTuiBrowser(storage);
    let state = createBrowserState(browser);
    state = reduceBrowserState(browser, state, { type: "drill" });
    state = reduceBrowserState(browser, state, { type: "drill" });

    const snapshot = stripAnsi(renderBrowserSnapshot(browser, state));
    assert.match(snapshot, /Projects/);
    assert.match(snapshot, /Turns/);
    assert.match(snapshot, /Detail/);
    assert.match(snapshot, /Project: Detail Project/);
    assert.match(snapshot, /Source: Storage fixture \(codex\)/);
    assert.match(snapshot, /Session: session-detail/);
    assert.match(snapshot, /Workspace: \/workspace\/detail/);
    assert.match(snapshot, /Breadcrumbs: Detail Project . session-detail . turn-detail/);
    assert.match(snapshot, /Prompt: Investigate failing adapter test/);
    assert.match(snapshot, /Related: 0 child, 0 automation/);
    assert.match(snapshot, /Trail: \(none\)/);

    storage.close();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("browser snapshot can surface delegated child-session breadcrumbs and related-work trail cues", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-tui-related-"));

  try {
    const storage = new CCHistoryStorage({ dbPath: path.join(tempDir, "related.sqlite") });
    const payload = createFixturePayload("src-related", "Inspect delegated child session", "stage-related", {
      sessionId: "session-related",
      turnId: "turn-related",
      workingDirectory: "/workspace/related",
      includeProjectObservation: true,
    });
    appendDelegatedSessionRelation(payload, "session-related", "child-session-1");
    appendDelegatedSessionRelation(payload, "session-related", "child-session-1");
    storage.replaceSourcePayload(payload);
    storage.upsertProjectOverride({
      target_kind: "turn",
      target_ref: "turn-related",
      project_id: "project-related",
      display_name: "Related Project",
    });

    const browser = buildLocalTuiBrowser(storage);
    let state = createBrowserState(browser);
    state = reduceBrowserState(browser, state, { type: "drill" });
    state = reduceBrowserState(browser, state, { type: "drill" });

    const snapshot = stripAnsi(renderBrowserSnapshot(browser, state));
    assert.match(snapshot, /Breadcrumbs: Related Project . session-related . turn-related/);
    assert.match(snapshot, /Related: 1 child, 0 automation/);
    assert.match(snapshot, /Trail 1: . child session child-session-1 \(transcript-primary\)/);
    assert.equal((snapshot.match(/child session child-session-1/g) ?? []).length, 1);
    assert.match(snapshot, /1 child/);

    storage.close();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("browser reducer retreat walks detail back to projects and help closes independently", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-tui-retreat-"));

  try {
    const storage = new CCHistoryStorage({ dbPath: path.join(tempDir, "retreat.sqlite") });
    storage.replaceSourcePayload(
      createFixturePayload("src-retreat", "Retreat navigation", "stage-retreat", {
        sessionId: "session-retreat",
        turnId: "turn-retreat",
        workingDirectory: "/workspace/retreat",
        includeProjectObservation: true,
      }),
    );
    storage.upsertProjectOverride({
      target_kind: "turn",
      target_ref: "turn-retreat",
      project_id: "project-retreat",
      display_name: "Retreat Project",
    });

    const browser = buildLocalTuiBrowser(storage);
    let state = createBrowserState(browser);

    state = reduceBrowserState(browser, state, { type: "drill" });
    state = reduceBrowserState(browser, state, { type: "drill" });
    assert.equal(state.focusPane, "detail");

    state = reduceBrowserState(browser, state, { type: "toggle-help" });
    assert.equal(state.showHelp, true);

    state = reduceBrowserState(browser, state, { type: "close-help" });
    assert.equal(state.focusPane, "detail");
    assert.equal(state.showHelp, false);

    state = reduceBrowserState(browser, state, { type: "retreat" });
    assert.equal(state.focusPane, "turns");

    state = reduceBrowserState(browser, state, { type: "retreat" });
    assert.equal(state.focusPane, "projects");

    storage.close();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("entrypoint can render non-interactive source-health snapshot", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-tui-entry-source-health-"));

  try {
    const dbPath = path.join(tempDir, "entry-source-health.sqlite");
    const storage = new CCHistoryStorage({ dbPath });
    storage.replaceSourcePayload(
      createFixturePayload("src-entry-source-health", "Source health fixture turn", "stage-entry-source-health", {
        sessionId: "session-entry-source-health",
        turnId: "turn-entry-source-health",
        workingDirectory: "/workspace/entry-source-health",
        includeProjectObservation: true,
      }),
    );
    storage.close();

    const { io, stdout, stderr } = createIo(process.cwd());
    const exitCode = await runTui(["--db", dbPath, "--source-health"], io);
    const output = stdout.join("");

    const stripped = stripAnsi(output);
    assert.equal(exitCode, 0, stderr.join(""));
    assert.match(stripped, /Read=indexed/);
    assert.match(stripped, /Source Health/);
    assert.match(stripped, /Storage fixture \(codex\)/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("entrypoint can render combined search and source-health snapshot", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-tui-entry-search-source-health-"));

  try {
    const dbPath = path.join(tempDir, "entry-search-source-health.sqlite");
    const storage = new CCHistoryStorage({ dbPath });
    storage.replaceSourcePayload(
      createFixturePayload("src-entry-search-source-health", "Find alpha regression", "stage-entry-search-source-health", {
        sessionId: "session-entry-search-source-health",
        turnId: "turn-entry-search-source-health",
        workingDirectory: "/workspace/entry-search-source-health",
        includeProjectObservation: true,
      }),
    );
    storage.upsertProjectOverride({
      target_kind: "turn",
      target_ref: "turn-entry-search-source-health",
      project_id: "project-entry-search-source-health",
      display_name: "Entry Search Source Health",
    });
    storage.close();

    const { io, stdout, stderr } = createIo(process.cwd());
    const exitCode = await runTui(["--db", dbPath, "--search", "alpha", "--source-health"], io);
    const output = stdout.join("");

    const stripped = stripAnsi(output);
    assert.equal(exitCode, 0, stderr.join(""));
    assert.match(stripped, /Mode=search/);
    assert.match(stripped, /Read=indexed/);
    assert.match(stripped, /Query: alpha/);
    assert.match(stripped, /Find alpha regression/);
    assert.match(stripped, /Project: Entry Search Source Health/);
    assert.match(stripped, /Source Health/);
    assert.match(stripped, /Storage fixture \(codex\)/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("entrypoint can render empty combined search and source-health snapshot", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-tui-entry-empty-search-source-health-"));

  try {
    const dbPath = path.join(tempDir, "entry-empty-search-source-health.sqlite");
    const storage = new CCHistoryStorage({ dbPath });
    storage.replaceSourcePayload(
      createFixturePayload("src-entry-empty-search-source-health", "Find alpha regression", "stage-entry-empty-search-source-health", {
        sessionId: "session-entry-empty-search-source-health",
        turnId: "turn-entry-empty-search-source-health",
        workingDirectory: "/workspace/entry-empty-search-source-health",
        includeProjectObservation: true,
      }),
    );
    storage.upsertProjectOverride({
      target_kind: "turn",
      target_ref: "turn-entry-empty-search-source-health",
      project_id: "project-entry-empty-search-source-health",
      display_name: "Entry Empty Search Source Health",
    });
    storage.close();

    const { io, stdout, stderr } = createIo(process.cwd());
    const exitCode = await runTui(["--db", dbPath, "--search", "missing phrase", "--source-health"], io);
    const output = stdout.join("");

    const stripped = stripAnsi(output);
    assert.equal(exitCode, 0, stderr.join(""));
    assert.match(stripped, /Mode=search/);
    assert.match(stripped, /0 match\(es\)/);
    assert.match(stripped, /No search results/);
    assert.match(stripped, /No project selected\./);
    assert.match(stripped, /Project=none/);
    assert.match(stripped, /Turn=none/);
    assert.match(stripped, /Source Health/);
    assert.match(stripped, /Storage fixture \(codex\)/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("entrypoint can render non-interactive search drill-down snapshot", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-tui-entry-search-"));

  try {
    const storage = new CCHistoryStorage({ dbPath: path.join(tempDir, "entry-search.sqlite") });
    storage.replaceSourcePayload(
      createFixturePayload("src-entry-search-a", "Find alpha regression", "stage-entry-search-a", {
        sessionId: "session-entry-search-a",
        turnId: "turn-entry-search-a",
        workingDirectory: "/workspace/entry-search-a",
        includeProjectObservation: true,
      }),
    );
    storage.upsertProjectOverride({
      target_kind: "turn",
      target_ref: "turn-entry-search-a",
      project_id: "project-entry-search-a",
      display_name: "Entry Search Alpha",
    });
    storage.close();

    const { io, stdout, stderr } = createIo(process.cwd());
    const exitCode = await runTui(["--db", path.join(tempDir, "entry-search.sqlite"), "--search", "alpha"], io);
    const output = stdout.join("");

    assert.equal(exitCode, 0, stderr.join(""));
    assert.match(output, /Mode=search/);
    assert.match(output, /Search:/);
    assert.match(output, /Results:/);
    assert.match(output, /Query: alpha/);
    assert.match(output, /Find alpha regression/);
    assert.match(output, /Project: Entry Search Alpha/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});


test("entrypoint can render non-interactive full snapshot without mutating the indexed store", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-tui-entry-full-"));
  const originalHome = process.env.HOME;

  try {
    await writeCodexSessionFixture(tempDir, "rollout-codex-tui-full-session-1.jsonl", {
      sessionId: "codex-tui-full-session-1",
      cwd: "/workspace/tui-full",
      model: "gpt-5",
      prompt: "Baseline indexed prompt",
      reply: "Baseline indexed reply.",
      startAt: "2026-03-09T00:00:00.000Z",
    });
    process.env.HOME = tempDir;

    const storeDir = path.join(tempDir, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    await seedIndexedCodexStoreFromProbe(tempDir, dbPath);

    await writeCodexSessionFixture(tempDir, "rollout-codex-tui-full-session-2.jsonl", {
      sessionId: "codex-tui-full-session-2",
      cwd: "/workspace/tui-full",
      model: "gpt-5",
      prompt: "Live-only full snapshot prompt",
      reply: "Live-only full snapshot reply.",
      startAt: "2026-03-09T02:00:00.000Z",
    });

    const indexed = createIo(process.cwd());
    const indexedExit = await runTui(["--store", storeDir, "--search", "Live-only full snapshot prompt"], indexed.io);
    const indexedOutput = indexed.stdout.join("");
    assert.equal(indexedExit, 0, indexed.stderr.join(""));
    assert.match(indexedOutput, /Read Mode: indexed store only/);
    assert.match(indexedOutput, /Read=indexed-only/);
    assert.match(indexedOutput, /No search results/);

    const full = createIo(process.cwd());
    const fullExit = await runTui(["--store", storeDir, "--full", "--source", "codex", "--search", "Live-only full snapshot prompt"], full.io);
    const fullOutput = full.stdout.join("");
    assert.equal(fullExit, 0, full.stderr.join(""));
    assert.match(fullOutput, /Read Mode: live full scan in memory/);
    assert.match(fullOutput, /Read=live-full/);
    assert.match(fullOutput, /Live-only full snapshot prompt/);
    assert.match(fullOutput, /Project: tui-full/);

    const storage = new CCHistoryStorage({ dbPath });
    try {
      assert.equal(storage.listResolvedSessions().length, 1);
      assert.equal(storage.listResolvedTurns().length, 1);
    } finally {
      storage.close();
    }
  } finally {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  }
});


test("entrypoint can render non-interactive full snapshot against a missing store without creating it", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-tui-entry-full-missing-store-"));
  const originalHome = process.env.HOME;

  try {
    await writeCodexSessionFixture(tempDir, "rollout-codex-tui-full-missing-store-session-1.jsonl", {
      sessionId: "codex-tui-full-missing-store-session-1",
      cwd: "/workspace/tui-full-missing-store",
      model: "gpt-5",
      prompt: "Missing store full snapshot prompt",
      reply: "Missing store full snapshot reply.",
      startAt: "2026-03-09T00:00:00.000Z",
    });
    process.env.HOME = tempDir;

    const storeDir = path.join(tempDir, "missing-store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const { io, stdout, stderr } = createIo(process.cwd());
    const exitCode = await runTui(["--store", storeDir, "--full", "--source", "codex", "--search", "Missing store full snapshot prompt"], io);
    const output = stdout.join("");

    assert.equal(exitCode, 0, stderr.join(""));
    assert.match(output, /Store DB: .*missing-store.*full scan in memory/);
    assert.match(output, /Read Mode: live full scan in memory/);
    assert.match(output, /Read=live-full/);
    assert.match(output, /Missing store full snapshot prompt/);
    await assert.rejects(access(dbPath));
  } finally {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  }
});


test("entrypoint can render combined full search and source-health snapshot without mutating the indexed store", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-tui-entry-full-source-health-"));
  const originalHome = process.env.HOME;

  try {
    await writeCodexSessionFixture(tempDir, "rollout-codex-tui-full-health-session-1.jsonl", {
      sessionId: "codex-tui-full-health-session-1",
      cwd: "/workspace/tui-full-health",
      model: "gpt-5",
      prompt: "Baseline indexed health prompt",
      reply: "Baseline indexed health reply.",
      startAt: "2026-03-09T00:00:00.000Z",
    });
    process.env.HOME = tempDir;

    const storeDir = path.join(tempDir, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    await seedIndexedCodexStoreFromProbe(tempDir, dbPath);

    await writeCodexSessionFixture(tempDir, "rollout-codex-tui-full-health-session-2.jsonl", {
      sessionId: "codex-tui-full-health-session-2",
      cwd: "/workspace/tui-full-health",
      model: "gpt-5",
      prompt: "Live-only combined full prompt",
      reply: "Live-only combined full reply.",
      startAt: "2026-03-09T02:00:00.000Z",
    });

    const full = createIo(process.cwd());
    const exitCode = await runTui([
      "--store", storeDir,
      "--full",
      "--source", "codex",
      "--search", "Live-only combined full prompt",
      "--source-health",
    ], full.io);
    const output = full.stdout.join("");
    assert.equal(exitCode, 0, full.stderr.join(""));
    assert.match(output, /Read Mode: live full scan in memory/);
    assert.match(output, /Read=live-full/);
    assert.match(output, /Mode=search/);
    assert.match(output, /Live-only combined full prompt/);
    assert.match(output, /SourceHealth=open/);
    assert.match(output, /Source Health:/);
    assert.match(output, /Codex/);

    const storage = new CCHistoryStorage({ dbPath });
    try {
      assert.equal(storage.listResolvedSessions().length, 1);
      assert.equal(storage.listResolvedTurns().length, 1);
    } finally {
      storage.close();
    }
  } finally {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("empty search snapshot keeps detail pane and status line coherent", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-tui-empty-search-"));

  try {
    const dbPath = path.join(tempDir, "empty-search.sqlite");
    const storage = new CCHistoryStorage({ dbPath });
    storage.replaceSourcePayload(
      createFixturePayload("src-empty-search", "Find alpha regression", "stage-empty-search", {
        sessionId: "session-empty-search",
        turnId: "turn-empty-search",
        workingDirectory: "/workspace/empty-search",
        includeProjectObservation: true,
      }),
    );
    storage.upsertProjectOverride({
      target_kind: "turn",
      target_ref: "turn-empty-search",
      project_id: "project-empty-search",
      display_name: "Empty Search Project",
    });

    const browser = buildLocalTuiBrowser(storage);
    let state = createBrowserState(browser);
    state = reduceBrowserState(browser, state, { type: "enter-search-mode" });
    for (const value of "missing phrase") {
      state = value === " "
        ? reduceBrowserState(browser, state, { type: "append-search-char", value })
        : reduceBrowserState(browser, state, { type: "append-search-char", value });
    }

    const snapshot = renderBrowserSnapshot(browser, state);
    assert.match(snapshot, /Results: 0 match\(es\)/);
    assert.match(snapshot, /No search results/);
    assert.match(snapshot, /No project selected\./);
    assert.match(snapshot, /SelectedProject=none/);
    assert.match(snapshot, /SelectedTurn=none/);

    storage.close();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("search snapshot prefers committed project hits before unlinked fallback matches", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-tui-search-priority-"));

  try {
    const dbPath = path.join(tempDir, "search-priority.sqlite");
    const storage = new CCHistoryStorage({ dbPath });
    storage.replaceSourcePayload(
      createFixturePayload("src-search-priority-unlinked", "code reviewer fallback note", "stage-search-priority-unlinked", {
        sessionId: "session-search-priority-unlinked",
        turnId: "turn-search-priority-unlinked",
        workingDirectory: "/workspace/unlinked-review",
        includeProjectObservation: false,
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-search-priority-committed", "code reviewer committed task", "stage-search-priority-committed", {
        sessionId: "session-search-priority-committed",
        turnId: "turn-search-priority-committed",
        workingDirectory: "/workspace/committed-review",
        includeProjectObservation: true,
      }),
    );
    storage.upsertProjectOverride({
      target_kind: "turn",
      target_ref: "turn-search-priority-committed",
      project_id: "project-search-priority-committed",
      display_name: "Committed Review",
    });
    storage.close();

    const { io, stdout, stderr } = createIo(process.cwd());
    const exitCode = await runTui(["--db", dbPath, "--search", "code reviewer"], io);
    const output = stdout.join("");

    const stripped = stripAnsi(output);

    assert.equal(exitCode, 0, stderr.join(""));
    assert.match(stripped, /Results/);
    assert.match(stripped, /code reviewer committed task .* Committed Review/);
    assert.match(stripped, /Project: Committed Review/);
    assert.match(stripped, /code reviewer fallback note .* Unlinked/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("browser search mode preserves result drill-down", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-tui-search-"));

  try {
    const storage = new CCHistoryStorage({ dbPath: path.join(tempDir, "search.sqlite") });
    storage.replaceSourcePayload(
      createFixturePayload("src-search-a", "Find alpha regression", "stage-search-a", {
        sessionId: "session-search-a",
        turnId: "turn-search-a",
        workingDirectory: "/workspace/search-a",
        includeProjectObservation: true,
      }),
    );
    storage.upsertProjectOverride({
      target_kind: "turn",
      target_ref: "turn-search-a",
      project_id: "project-search-a",
      display_name: "Search Alpha",
    });

    storage.replaceSourcePayload(
      createFixturePayload("src-search-b", "Investigate beta release", "stage-search-b", {
        sessionId: "session-search-b",
        turnId: "turn-search-b",
        workingDirectory: "/workspace/search-b",
        includeProjectObservation: true,
      }),
    );
    storage.upsertProjectOverride({
      target_kind: "turn",
      target_ref: "turn-search-b",
      project_id: "project-search-b",
      display_name: "Search Beta",
    });

    const browser = buildLocalTuiBrowser(storage);
    let state = createBrowserState(browser);
    state = reduceBrowserState(browser, state, { type: "enter-search-mode" });
    state = reduceBrowserState(browser, state, { type: "append-search-char", value: "a" });
    state = reduceBrowserState(browser, state, { type: "append-search-char", value: "l" });
    state = reduceBrowserState(browser, state, { type: "append-search-char", value: "p" });
    state = reduceBrowserState(browser, state, { type: "append-search-char", value: "h" });
    state = reduceBrowserState(browser, state, { type: "append-search-char", value: "a" });
    state = reduceBrowserState(browser, state, { type: "drill" });
    state = reduceBrowserState(browser, state, { type: "drill" });

    const snapshot = renderBrowserSnapshot(browser, state);
    assert.match(snapshot, /Mode=search/);
    assert.match(snapshot, /Search:/);
    assert.match(snapshot, /Results:/);
    assert.match(snapshot, /Query: alpha/);
    assert.match(snapshot, /Find alpha regression/);
    assert.match(snapshot, /Project: Search Alpha/);

    storage.close();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("browser snapshot can show lightweight source health summary", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-tui-health-"));

  try {
    const storage = new CCHistoryStorage({ dbPath: path.join(tempDir, "health.sqlite") });
    storage.replaceSourcePayload(
      createFixturePayload("src-health-healthy", "Healthy source turn", "stage-health-healthy", {
        sessionId: "session-health-healthy",
        turnId: "turn-health-healthy",
        workingDirectory: "/workspace/healthy",
        includeProjectObservation: true,
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-health-stale", "Stale source turn", "stage-health-stale", {
        sessionId: "session-health-stale",
        turnId: "turn-health-stale",
        workingDirectory: "/workspace/stale",
        includeProjectObservation: true,
        syncStatus: "stale",
      }),
    );

    const browser = buildLocalTuiBrowser(storage);
    let state = createBrowserState(browser);
    state = reduceBrowserState(browser, state, { type: "toggle-source-health" });

    const snapshot = renderBrowserSnapshot(browser, state);
    assert.match(snapshot, /Source Health:/);
    assert.match(snapshot, /Healthy=1 · Stale=1 · Error=0/);
    assert.match(snapshot, /Storage fixture \(codex\) · stale/);
    assert.match(snapshot, /stale/);

    storage.close();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function seedIndexedCodexStoreFromProbe(tempRoot: string, dbPath: string): Promise<void> {
  const storage = new CCHistoryStorage({ dbPath });
  try {
    const source = getDefaultSources().find((entry) => entry.id === "codex" || entry.slot_id === "codex");
    assert.ok(source, "Expected codex source definition to be available");
    const result = await runSourceProbe({ source_ids: [source.id] }, [source]);
    for (const payload of result.sources) {
      storage.replaceSourcePayload(payload, { allow_host_rekey: true });
    }
  } finally {
    storage.close();
  }
}

async function writeCodexSessionFixture(
  tempRoot: string,
  fileName: string,
  input: {
    sessionId: string;
    cwd: string;
    model: string;
    prompt: string;
    reply: string;
    startAt: string;
  },
): Promise<void> {
  const startAt = new Date(input.startAt);
  const userAt = new Date(startAt.getTime() + 1000).toISOString();
  const assistantAt = new Date(startAt.getTime() + 2000).toISOString();
  const sessionsDir = path.join(tempRoot, ".codex", "sessions");
  await import("node:fs/promises").then(({ mkdir, writeFile }) =>
    mkdir(sessionsDir, { recursive: true }).then(() =>
      writeFile(
        path.join(sessionsDir, fileName),
        [
          {
            timestamp: input.startAt,
            type: "session_meta",
            payload: { id: input.sessionId, cwd: input.cwd, model: input.model },
          },
          {
            timestamp: userAt,
            type: "response_item",
            payload: {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: input.prompt }],
            },
          },
          {
            timestamp: assistantAt,
            type: "response_item",
            payload: {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: input.reply }],
            },
          },
        ].map((entry) => JSON.stringify(entry)).join("\n"),
        "utf8",
      ),
    ),
  );
}

function appendDelegatedSessionRelation(payload: FixturePayload, sessionId: string, targetSessionRef: string): void {
  const lastFragment = payload.fragments[payload.fragments.length - 1];
  const relationIndex = payload.fragments.filter((fragment) => fragment.session_ref === sessionId && fragment.fragment_kind === "session_relation").length + 1;
  payload.fragments.push({
    id: `${sessionId}-fragment-related-${relationIndex}`,
    source_id: payload.source.id,
    session_ref: sessionId,
    record_id: lastFragment?.record_id ?? `${sessionId}-record-related`,
    seq_no: (lastFragment?.seq_no ?? 0) + 1,
    fragment_kind: "session_relation",
    actor_kind: "system",
    origin_kind: "source_meta",
    time_key: payload.sessions.find((session) => session.id === sessionId)?.updated_at ?? payload.sessions[0]?.updated_at ?? "2026-03-09T09:00:03.000Z",
    payload: {
      parent_uuid: targetSessionRef,
      is_sidechain: true,
    },
    raw_refs: [],
    source_format_profile_id: lastFragment?.source_format_profile_id ?? "codex:jsonl:v1",
  });
}

function createFixturePayload(
  sourceId: string,
  canonicalText: string,
  stageRunId: string,
  options: {
    sessionId?: string;
    turnId?: string;
    workingDirectory?: string;
    includeProjectObservation?: boolean;
    syncStatus?: "healthy" | "stale" | "error";
  } = {},
): FixturePayload {
  const createdAt = "2026-03-09T09:00:00.000Z";
  const assistantAt = "2026-03-09T09:00:01.000Z";
  const toolCallAt = "2026-03-09T09:00:02.000Z";
  const toolResultAt = "2026-03-09T09:00:03.000Z";
  const sessionId = options.sessionId ?? "session-1";
  const turnId = options.turnId ?? "turn-1";
  const baseDir = `/tmp/storage-fixture/${sourceId}`;
  const workingDirectory = options.workingDirectory ?? "/workspace/storage-fixture";
  const blobId = `${turnId}-blob`;
  const recordId = `${turnId}-record`;
  const userFragmentId = `${turnId}-fragment-user`;
  const assistantFragmentId = `${turnId}-fragment-assistant`;
  const toolCallFragmentId = `${turnId}-fragment-tool-call`;
  const toolResultFragmentId = `${turnId}-fragment-tool-result`;
  const userAtomId = `${turnId}-atom-user`;
  const assistantAtomId = `${turnId}-atom-assistant`;
  const toolCallAtomId = `${turnId}-atom-tool-call`;
  const toolResultAtomId = `${turnId}-atom-tool-result`;
  const submissionCandidateId = `${turnId}-candidate-submission`;
  const turnCandidateId = `${turnId}-candidate-turn`;
  const contextCandidateId = `${turnId}-candidate-context`;
  const assistantReplyId = `${turnId}-assistant-reply`;
  const toolCallProjectionId = `${turnId}-tool-call`;
  const userMessageId = `${turnId}-user-message`;

  const candidates: FixturePayload["candidates"] = [
    {
      id: submissionCandidateId,
      source_id: sourceId,
      session_ref: sessionId,
      candidate_kind: "submission_group",
      input_atom_refs: [userAtomId],
      started_at: createdAt,
      ended_at: createdAt,
      rule_version: "2026-03-09.1",
      evidence: { assistant_seen_after_group_start: true },
    },
    {
      id: turnCandidateId,
      source_id: sourceId,
      session_ref: sessionId,
      candidate_kind: "turn",
      input_atom_refs: [userAtomId],
      started_at: createdAt,
      ended_at: toolResultAt,
      rule_version: "2026-03-09.1",
      evidence: { submission_group_id: submissionCandidateId },
    },
    {
      id: contextCandidateId,
      source_id: sourceId,
      session_ref: sessionId,
      candidate_kind: "context_span",
      input_atom_refs: [assistantAtomId, toolCallAtomId, toolResultAtomId],
      started_at: createdAt,
      ended_at: toolResultAt,
      rule_version: "2026-03-09.1",
      evidence: { turn_candidate_id: turnCandidateId },
    },
  ];

  if (options.includeProjectObservation) {
    candidates.push({
      id: `${turnId}-candidate-project-observation`,
      source_id: sourceId,
      session_ref: sessionId,
      candidate_kind: "project_observation",
      input_atom_refs: [userAtomId],
      started_at: createdAt,
      ended_at: createdAt,
      rule_version: "2026-03-09.1",
      evidence: {
        workspace_path: workingDirectory,
        workspace_path_normalized: workingDirectory,
        confidence: 0.9,
      },
    });
  }

  return {
    source: {
      id: sourceId,
      slot_id: "codex",
      family: "local_coding_agent",
      platform: "codex",
      display_name: "Storage fixture",
      base_dir: baseDir,
      host_id: "host-1",
      last_sync: toolResultAt,
      sync_status: options.syncStatus ?? "healthy",
      total_blobs: 1,
      total_records: 1,
      total_fragments: 4,
      total_atoms: 4,
      total_sessions: 1,
      total_turns: 1,
    },
    stage_runs: [
      {
        id: stageRunId,
        source_id: sourceId,
        stage_kind: "finalize_projections",
        parser_version: "codex-parser@2026-03-09.1",
        parser_capabilities: ["turn_projections", "turn_context_projections", "loss_audits"],
        source_format_profile_ids: ["codex:jsonl:v1"],
        started_at: createdAt,
        finished_at: toolResultAt,
        status: "success",
        stats: { turns: 1, sessions: 1 },
      },
    ],
    loss_audits: [
      {
        id: `${turnId}-loss-audit`,
        source_id: sourceId,
        stage_run_id: stageRunId,
        stage_kind: "finalize_projections",
        diagnostic_code: "fixture_projection_gap",
        severity: "warning",
        scope_ref: toolResultFragmentId,
        session_ref: sessionId,
        blob_ref: blobId,
        record_ref: recordId,
        fragment_ref: toolResultFragmentId,
        source_format_profile_id: "codex:jsonl:v1",
        loss_kind: "unknown_fragment",
        detail: "fixture loss audit",
        created_at: toolResultAt,
      },
    ],
    blobs: [
      {
        id: blobId,
        source_id: sourceId,
        host_id: "host-1",
        origin_path: path.join(baseDir, "session.jsonl"),
        captured_path: path.join(baseDir, ".cache", "session.jsonl"),
        checksum: "checksum-1",
        size_bytes: 128,
        captured_at: createdAt,
        capture_run_id: "capture-run-1",
      },
    ],
    records: [
      {
        id: recordId,
        source_id: sourceId,
        blob_id: blobId,
        session_ref: sessionId,
        ordinal: 0,
        record_path_or_offset: "0",
        observed_at: createdAt,
        parseable: true,
        raw_json: '{"fixture":true}',
      },
    ],
    fragments: [
      {
        id: userFragmentId,
        source_id: sourceId,
        session_ref: sessionId,
        record_id: recordId,
        seq_no: 0,
        fragment_kind: "text",
        actor_kind: "user",
        origin_kind: "user_authored",
        time_key: createdAt,
        payload: { text: canonicalText },
        raw_refs: [recordId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: assistantFragmentId,
        source_id: sourceId,
        session_ref: sessionId,
        record_id: recordId,
        seq_no: 1,
        fragment_kind: "text",
        actor_kind: "assistant",
        origin_kind: "assistant_authored",
        time_key: assistantAt,
        payload: { text: "Running tool" },
        raw_refs: [recordId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: toolCallFragmentId,
        source_id: sourceId,
        session_ref: sessionId,
        record_id: recordId,
        seq_no: 2,
        fragment_kind: "tool_call",
        actor_kind: "tool",
        origin_kind: "tool_generated",
        time_key: toolCallAt,
        payload: { call_id: "call-1", tool_name: "shell", input: {} },
        raw_refs: [recordId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: toolResultFragmentId,
        source_id: sourceId,
        session_ref: sessionId,
        record_id: recordId,
        seq_no: 3,
        fragment_kind: "tool_result",
        actor_kind: "tool",
        origin_kind: "tool_generated",
        time_key: toolResultAt,
        payload: { call_id: "call-1", output: "ok" },
        raw_refs: [recordId],
        source_format_profile_id: "codex:jsonl:v1",
      },
    ],
    atoms: [
      {
        id: userAtomId,
        source_id: sourceId,
        session_ref: sessionId,
        seq_no: 0,
        actor_kind: "user",
        origin_kind: "user_authored",
        content_kind: "text",
        time_key: createdAt,
        display_policy: "show",
        payload: { text: canonicalText },
        fragment_refs: [userFragmentId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: assistantAtomId,
        source_id: sourceId,
        session_ref: sessionId,
        seq_no: 1,
        actor_kind: "assistant",
        origin_kind: "assistant_authored",
        content_kind: "text",
        time_key: assistantAt,
        display_policy: "show",
        payload: { text: "Running tool" },
        fragment_refs: [assistantFragmentId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: toolCallAtomId,
        source_id: sourceId,
        session_ref: sessionId,
        seq_no: 2,
        actor_kind: "tool",
        origin_kind: "tool_generated",
        content_kind: "tool_call",
        time_key: toolCallAt,
        display_policy: "show",
        payload: { call_id: "call-1", tool_name: "shell", input: {} },
        fragment_refs: [toolCallFragmentId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: toolResultAtomId,
        source_id: sourceId,
        session_ref: sessionId,
        seq_no: 3,
        actor_kind: "tool",
        origin_kind: "tool_generated",
        content_kind: "tool_result",
        time_key: toolResultAt,
        display_policy: "show",
        payload: { call_id: "call-1", output: "ok" },
        fragment_refs: [toolResultFragmentId],
        source_format_profile_id: "codex:jsonl:v1",
      },
    ],
    edges: [
      {
        id: `${turnId}-edge-spawned-from`,
        source_id: sourceId,
        session_ref: sessionId,
        from_atom_id: toolCallAtomId,
        to_atom_id: assistantAtomId,
        edge_kind: "spawned_from",
      },
      {
        id: `${turnId}-edge-tool-result-for`,
        source_id: sourceId,
        session_ref: sessionId,
        from_atom_id: toolResultAtomId,
        to_atom_id: toolCallAtomId,
        edge_kind: "tool_result_for",
      },
    ],
    candidates,
    sessions: [
      {
        id: sessionId,
        source_id: sourceId,
        source_platform: "codex",
        host_id: "host-1",
        title: canonicalText,
        created_at: createdAt,
        updated_at: toolResultAt,
        turn_count: 1,
        model: "gpt-5",
        working_directory: workingDirectory,
        sync_axis: "current",
      },
    ],
    turns: [
      {
        id: turnId,
        revision_id: `${turnId}:r1`,
        turn_id: turnId,
        turn_revision_id: `${turnId}:r1`,
        user_messages: [
          {
            id: userMessageId,
            raw_text: canonicalText,
            sequence: 0,
            is_injected: false,
            created_at: createdAt,
            atom_refs: [userAtomId],
          },
        ],
        raw_text: canonicalText,
        canonical_text: canonicalText,
        display_segments: [{ type: "text", content: canonicalText }],
        created_at: createdAt,
        submission_started_at: createdAt,
        last_context_activity_at: toolResultAt,
        session_id: sessionId,
        source_id: sourceId,
        link_state: "unlinked",
        sync_axis: "current",
        value_axis: "active",
        retention_axis: "keep_raw_and_derived",
        context_ref: turnId,
        context_summary: {
          assistant_reply_count: 1,
          tool_call_count: 1,
          total_tokens: 2050,
          primary_model: "gpt-5",
          has_errors: false,
        },
        lineage: {
          atom_refs: [userAtomId, assistantAtomId, toolCallAtomId, toolResultAtomId],
          candidate_refs: candidates.map((candidate) => candidate.id),
          fragment_refs: [userFragmentId, assistantFragmentId, toolCallFragmentId, toolResultFragmentId],
          record_refs: [recordId],
          blob_refs: [blobId],
        },
      },
    ],
    contexts: [
      {
        turn_id: turnId,
        system_messages: [],
        assistant_replies: [
          {
            id: assistantReplyId,
            content: "Running tool",
            display_segments: [{ type: "text", content: "Running tool" }],
            content_preview: "Running tool",
            token_usage: {
              input_tokens: 1200,
              output_tokens: 450,
              total_tokens: 1650,
            },
            token_count: 450,
            model: "gpt-5",
            created_at: assistantAt,
            tool_call_ids: [toolCallProjectionId],
            stop_reason: "tool_use",
          },
        ],
        tool_calls: [
          {
            id: toolCallProjectionId,
            tool_name: "shell",
            input: {},
            input_summary: "{}",
            input_display_segments: [{ type: "text", content: "{}" }],
            output: "ok",
            output_preview: "ok",
            output_display_segments: [{ type: "text", content: "ok" }],
            status: "success",
            reply_id: assistantReplyId,
            sequence: 0,
            created_at: toolCallAt,
          },
        ],
        raw_event_refs: [recordId],
      },
    ],
  };
}
