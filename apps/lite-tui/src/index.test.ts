import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  LiveHistorySnapshot,
  scanLiteHistory,
  type ScanLiteHistoryOptions,
} from "@cchistory/live-runtime";
import { stripAnsi } from "./colors.js";
import { runLiteTui, renderHelp, VERSION, type LiteTuiIo } from "./index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const codexRoot = path.join(repoRoot, "mock_data", ".codex", "sessions");
const openclawRoot = path.join(repoRoot, "mock_data", ".openclaw", "agents");
const FIXED_NOW = Date.UTC(2026, 6, 27, 12, 0, 0);

const ENTER_ALTERNATE_SCREEN = "\x1b[?1049h";
const LEAVE_ALTERNATE_SCREEN = "\x1b[?1049l";
const SHOW_CURSOR = "\x1b[?25h";

function codexArgs(...extra: string[]): string[] {
  return ["--source-root", `codex=${codexRoot}`, "--source", "codex", "--safe", "--no-color", ...extra];
}

function captureIo(overrides: Partial<LiteTuiIo> = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: LiteTuiIo = {
    cwd: repoRoot,
    homeDir: repoRoot,
    hostname: "cchistory-lite-tui-test-host",
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
    isInteractiveTerminal: false,
    now: () => FIXED_NOW,
    ...overrides,
  };
  return { stdout, stderr, io };
}

// ── Interactive driver ──

interface TuiSession {
  stdout: string[];
  stderr: string[];
  screen(): string;
  press(sequence: string | Buffer): Promise<void>;
  waitFor(pattern: RegExp, label: string): Promise<void>;
  end(): Promise<number>;
  exitCode: Promise<number>;
}

function startTui(argv: string[], overrides: Partial<LiteTuiIo> = {}): TuiSession {
  const input = new PassThrough();
  const output = new PassThrough();
  const { stdout, stderr, io } = captureIo({
    isInteractiveTerminal: true,
    input,
    output,
    columns: 110,
    rows: 34,
    ...overrides,
  });
  // A PassThrough is not a libuv handle, so unlike a real TTY it does not hold
  // the event loop open while the session waits for keys. Keep the loop alive
  // for the lifetime of the driven session.
  const keepAlive = setInterval(() => {}, 20);
  const exitCode = runLiteTui(argv, io).finally(() => clearInterval(keepAlive));
  const screen = () => stripAnsi(stdout.join(""));

  const settle = async (ticks = 4) => {
    for (let index = 0; index < ticks; index += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  };

  return {
    stdout,
    stderr,
    screen,
    exitCode,
    async press(sequence: string | Buffer) {
      input.write(sequence);
      await settle();
      if (typeof sequence === "string" && sequence.endsWith("\x1b")) {
        // A trailing lone ESC is held until the decoder knows it is not the
        // start of a cursor sequence; wait out that window.
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    },
    async waitFor(pattern: RegExp, label: string) {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (pattern.test(screen())) return;
        await settle(2);
      }
      assert.fail(`timed out waiting for ${label}; last screen:\n${screen().slice(-2000)}`);
    },
    async end() {
      input.end();
      return exitCode;
    },
  };
}

/** The most recently painted frame, i.e. the last cursor-home write. */
function lastFrame(session: TuiSession): string {
  const painted = session.stdout.filter((chunk) => chunk.startsWith("\x1b[H"));
  return stripAnsi(painted.at(-1) ?? "");
}

// ── Argument handling ──

test("Lite TUI rejects Full store flags before scanning", async () => {
  let scanned = false;
  const { stderr, io } = captureIo({
    scan: async () => {
      scanned = true;
      throw new Error("must not scan");
    },
  });
  assert.equal(await runLiteTui(["--store", "/tmp/full-store"], io), 2);
  assert.equal(scanned, false);
  assert.match(stderr.join(""), /does not accept --store or --db/);
});

test("Lite TUI rejects unknown flags and conflicting entry points before scanning", async () => {
  let scanned = false;
  const scan = async () => {
    scanned = true;
    throw new Error("must not scan");
  };

  const unknown = captureIo({ scan });
  assert.equal(await runLiteTui(["--nope"], unknown.io), 2);
  assert.match(unknown.stderr.join(""), /Unknown Lite TUI argument: --nope/);

  const conflicting = captureIo({ scan });
  assert.equal(await runLiteTui(["--project", "a", "--turn", "b"], conflicting.io), 2);
  assert.match(conflicting.stderr.join(""), /at most one of --project \/ --session \/ --turn/);

  const missingValue = captureIo({ scan });
  assert.equal(await runLiteTui(["--source-root"], missingValue.io), 2);
  assert.match(missingValue.stderr.join(""), /--source-root requires a value/);

  assert.equal(scanned, false);
});

test("help and version are answered without scanning and stay contract-compatible", async () => {
  let scanned = false;
  const scan = async () => {
    scanned = true;
    throw new Error("must not scan");
  };

  const help = captureIo({ scan });
  assert.equal(await runLiteTui(["--help"], help.io), 0);
  const helpText = help.stdout.join("");
  // The standalone-artifact verifier greps this exact phrase.
  assert.match(helpText, /CC History Lite TUI/);
  assert.match(helpText, /--source-root <slot-or-id>=<path>/);
  assert.match(helpText, /Keys:/);
  assert.equal(helpText, renderHelp());

  const version = captureIo({ scan });
  assert.equal(await runLiteTui(["--version"], version.io), 0);
  assert.equal(version.stdout.join(""), `${VERSION}\n`);
  assert.equal(scanned, false);
});

test("the banner version matches the package manifest", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
  ) as { version: string };
  assert.equal(VERSION, manifest.version);
});

// ── Non-interactive snapshot ──

test("Lite TUI renders a non-interactive ephemeral snapshot and exits", async () => {
  const { stdout, stderr, io } = captureIo({ columns: 110, rows: 30 });
  const exitCode = await runLiteTui(codexArgs(), io);
  assert.equal(exitCode, 0, stderr.join(""));
  const output = stdout.join("");
  assert.match(output, /CC History Lite TUI/);
  assert.match(output, /Ephemeral live snapshot/);
  assert.match(output, /Projects/);
  assert.match(output, /Turns/);
  // Piped output is plain text: no alternate screen, no styling, no raw mode.
  assert.equal(output, stripAnsi(output));
  assert.ok(!output.includes(ENTER_ALTERNATE_SCREEN));
  assert.equal(output.trimEnd().split("\n").length, 30);
});

test("the non-interactive snapshot stays well inside the artifact verifier's output buffer", async () => {
  const { stdout, io } = captureIo({ columns: 200, rows: 60 });
  assert.equal(await runLiteTui(codexArgs(), io), 0);
  assert.ok(Buffer.byteLength(stdout.join(""), "utf8") < 256 * 1024);
});

test("Lite TUI never creates a Full store", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "cchistory-lite-tui-zero-store-"));
  try {
    const { io } = captureIo({ homeDir: tempHome });
    assert.equal(await runLiteTui(codexArgs(), io), 0);
    await assert.rejects(access(path.join(tempHome, ".cchistory")));
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

// ── Interactive session ──

test("search preserves UTF-8 characters split across stdin buffers", async () => {
  const session = startTui(codexArgs());
  try {
    await session.waitFor(/▸ Projects/, "projects pane");
    await session.press("/");
    const query = "中文🧭";
    for (const byte of Buffer.from(query)) await session.press(Buffer.from([byte]));
    assert.ok(lastFrame(session).includes(`search "${query}"`));
    assert.doesNotMatch(lastFrame(session), /�/);
    await session.press("\x03");
    assert.equal(await session.exitCode, 0);
  } finally { await session.end(); }
});

test("an interactive session enters the alternate screen and restores the terminal on quit", async () => {
  const session = startTui(codexArgs());
  await session.waitFor(/CC History Lite TUI/, "first frame");

  const raw = session.stdout.join("");
  assert.ok(raw.startsWith(ENTER_ALTERNATE_SCREEN), "expected the alternate screen before the first paint");
  assert.match(raw, /\x1b\[\?25l/, "expected the cursor to be hidden");

  await session.press("q");
  assert.equal(await session.exitCode, 0);

  const final = session.stdout.join("");
  assert.ok(final.includes(LEAVE_ALTERNATE_SCREEN), "expected the alternate screen to be released");
  assert.ok(final.includes(SHOW_CURSOR), "expected the cursor to be restored");
  assert.ok(final.lastIndexOf(LEAVE_ALTERNATE_SCREEN) > final.indexOf(ENTER_ALTERNATE_SCREEN));
  assert.match(session.screen(), /CC History Lite snapshot released/);
});

for (const pane of ["help", "detail", "conversation"] as const) {
  test(`End then Up and PageUp can leave the ${pane} tail without scroll debt`, async () => {
    const base = await scanLiteHistory({
      homeDir: repoRoot, hostname: "lite-scroll-recovery-host",
      sourceRoots: [{ sourceRef: "codex", baseDir: codexRoot }], sourceRefs: ["codex"],
      safeMode: true, contextMode: "full",
    });
    const context = base.data.contexts.find((entry) => entry.assistant_replies.length > 0);
    assert.ok(context);
    const turn = base.getTurn(context.turn_id);
    assert.ok(turn);
    const snapshot = new LiveHistorySnapshot({
      ...base.data,
      turns: [{ ...turn, canonical_text: Array.from({ length: 50 }, (_, i) => `prompt line ${i}`).join("\n") }],
      contexts: [{ ...context, assistant_replies: [{
        ...context.assistant_replies[0]!, content: Array.from({ length: 50 }, (_, i) => `reply line ${i}`).join("\n"),
      }], tool_calls: [] }],
    });
    const session = startTui(codexArgs("--turn", turn.id), { rows: 14, columns: 80, scan: async () => snapshot });
    try {
      await session.waitFor(/▸ Detail/, "initial detail");
      if (pane === "help") await session.press("?");
      if (pane === "conversation") await session.press("\r");
      await session.press("\x1b[F");
      const tail = lastFrame(session);
      await session.press("k");
      assert.notEqual(lastFrame(session), tail, "one Up must move away from End");
      await session.press("G");
      assert.equal(lastFrame(session), tail);
      await session.press("j".repeat(30));
      assert.equal(lastFrame(session), tail, "Down at the boundary stays at the tail");
      await session.press("\x1b[5~");
      assert.notEqual(lastFrame(session), tail, "PageUp must not pay down invisible overscroll");
    } finally { await session.end(); }
  });
}

for (const columns of [46, 110]) {
  test(`keyboard navigation moves the cursor and switches panes at ${columns} columns`, async () => {
    const session = startTui(codexArgs(), { columns });
    await session.waitFor(/▸ Projects/, "projects pane");

    await session.press("j");
    assert.match(lastFrame(session), /▸ Projects/);

    await session.press("\t");
    assert.match(lastFrame(session), /▸ Turns/);

    await session.press("\t");
    assert.match(lastFrame(session), /▸ Detail/);

    await session.press("\x1b[Z");
    assert.match(lastFrame(session), /▸ Turns/);

    await session.press("p");
    assert.match(lastFrame(session), /▸ Projects/);

    await session.press("q");
    assert.equal(await session.exitCode, 0);
  });
}

test("arrow keys and jumps drive the same selection model as j/k", async () => {
  const session = startTui(codexArgs());
  await session.waitFor(/▸ Projects/, "projects pane");
  const cursorRow = () => lastFrame(session).split("\n").findIndex((line) => line.includes("❯"));

  const first = cursorRow();
  assert.ok(first >= 0, "expected a selection cursor");
  await session.press("\x1b[B");
  assert.equal(cursorRow(), first + 1, "down arrow moves the cursor");
  await session.press("\x1b[A");
  assert.equal(cursorRow(), first, "up arrow moves it back");
  await session.press("G");
  assert.ok(cursorRow() >= first);
  await session.press("g");
  assert.equal(cursorRow(), first);

  await session.press("q");
  assert.equal(await session.exitCode, 0);
});

test("typing after / runs an incremental search and Esc returns to browse", async () => {
  const session = startTui(codexArgs());
  await session.waitFor(/▸ Projects/, "projects pane");

  await session.press("/");
  assert.match(lastFrame(session), /Type to search/);

  await session.press("mock");
  await session.waitFor(/matches/, "search results");
  const searching = lastFrame(session);
  assert.match(searching, /\/ mock/);
  assert.match(searching, /search "mock"/);

  await session.press("\x1b");
  await session.waitFor(/▸ Projects/, "browse mode");

  await session.press("q");
  assert.equal(await session.exitCode, 0);
});

test("overlays open and close from the keyboard", async () => {
  const session = startTui(codexArgs());
  await session.waitFor(/▸ Projects/, "projects pane");

  await session.press("?");
  assert.match(lastFrame(session), /▸ Help/);
  await session.press("?");
  assert.doesNotMatch(lastFrame(session), /▸ Help/);

  await session.press("i");
  assert.match(lastFrame(session), /▸ Statistics/);
  assert.match(lastFrame(session), /By source/);
  await session.press("\t");
  assert.match(lastFrame(session), /By project/);
  await session.press("\x1b");
  assert.doesNotMatch(lastFrame(session), /▸ Statistics/);

  await session.press("s");
  assert.match(lastFrame(session), /▸ Sources/);
  assert.match(lastFrame(session), /Healthy: \d+/);

  await session.press("q");
  assert.equal(await session.exitCode, 0);
});

test("refresh replaces the snapshot only after a successful rescan", async () => {
  let scans = 0;
  const session = startTui(codexArgs(), {
    scan: async (options: ScanLiteHistoryOptions) => {
      scans += 1;
      return scanLiteHistory(options);
    },
  });
  await session.waitFor(/▸ Projects/, "projects pane");
  await session.press("r");
  await session.waitFor(/Snapshot refreshed/, "refresh completion");
  assert.equal(scans, 2);
  await session.press("q");
  assert.equal(await session.exitCode, 0);
});

test("a failed refresh keeps the previous complete snapshot and reports it in the frame", async () => {
  let scans = 0;
  const session = startTui(codexArgs(), {
    scan: async (options: ScanLiteHistoryOptions) => {
      scans += 1;
      if (scans === 2) throw new Error("synthetic refresh failure");
      return scanLiteHistory(options);
    },
  });
  await session.waitFor(/▸ Projects/, "projects pane");
  const before = lastFrame(session);
  await session.press("r");
  await session.waitFor(/previous snapshot retained: synthetic refresh failure/, "refresh failure notice");

  const after = lastFrame(session);
  assert.match(after, /▸ Projects/);
  // The counts line proves the previous snapshot is still the one being browsed.
  const counts = (frame: string) => frame.split("\n")[2];
  assert.equal(counts(after), counts(before));

  await session.press("q");
  assert.equal(await session.exitCode, 0);
});

test("Enter on the detail pane loads one session's full context on demand", async () => {
  const light = await scanLiteHistory({
    homeDir: repoRoot,
    hostname: "cchistory-lite-tui-test-host",
    sourceRoots: [{ sourceRef: "codex", baseDir: codexRoot }],
    sourceRefs: ["codex"],
    safeMode: true,
    contextMode: "none",
  });
  const calls: ScanLiteHistoryOptions[] = [];
  const session = startTui(codexArgs("--limit-files", "5"), {
    scan: async (options: ScanLiteHistoryOptions) => {
      calls.push(options);
      return calls.length === 1 ? light : scanLiteHistory(options);
    },
  });

  await session.waitFor(/▸ Projects/, "projects pane");
  await session.press("\r"); // projects → turns
  await session.press("\r"); // turns → detail
  assert.match(lastFrame(session), /▸ Detail/);
  await session.press("\r"); // detail → conversation, loading context first
  await session.waitFor(/▸ Conversation/, "conversation view");

  assert.equal(calls[0]?.contextMode, "none");
  assert.equal(calls[0]?.limitFiles, 5);
  const targeted = calls[1];
  assert.ok(targeted, "expected a targeted context rescan");
  assert.equal(targeted.contextMode, "full");
  assert.equal(targeted.sourceRefs?.length, 1);
  assert.equal(targeted.sessionRefs?.length, 1);
  // --limit-files must not narrow a scan that is already scoped to one session.
  assert.equal(targeted.limitFiles, undefined);

  const conversation = lastFrame(session);
  assert.match(conversation, /Assistant replies: [1-9]/);
  assert.doesNotMatch(conversation, /context not loaded/);

  await session.press("q");
  assert.equal(await session.exitCode, 0);
});

for (const navigation of ["retreat", "another-turn"] as const) {
  test(`a pending context load preserves later ${navigation} navigation and caches its result`, async () => {
    const detailed = await scanLiteHistory({
      homeDir: repoRoot,
      hostname: "cchistory-lite-tui-pending-context-host",
      sourceRoots: [{ sourceRef: "codex", baseDir: codexRoot }],
      sourceRefs: ["codex"], safeMode: true, contextMode: "full",
    });
    const turn = detailed.listResolvedTurns().find((entry) => entry.project_id);
    assert.ok(turn?.project_id);
    const sourceSession = detailed.getSession(turn.session_id);
    const project = detailed.getProject(turn.project_id);
    assert.ok(sourceSession && project && detailed.getTurnContext(turn.id));
    const light = new LiveHistorySnapshot({
      ...detailed.data,
      projects: [project],
      sessions: [sourceSession, { ...sourceSession, id: "other-session" }],
      turns: [turn, {
        ...turn, id: "other-turn", session_id: "other-session", canonical_text: "other turn prompt",
        submission_started_at: "2099-01-01T00:00:00Z",
      }],
      contexts: [],
    });
    let releaseScan!: () => void;
    const pending = new Promise<void>((resolve) => { releaseScan = resolve; });
    let scans = 0;
    const session = startTui(codexArgs("--turn", turn.id), {
      scan: async () => {
        if (++scans === 1) return light;
        await pending;
        return detailed;
      },
    });
    try {
      await session.waitFor(/▸ Detail/, "initial turn detail");
      await session.press("\r");
      assert.match(lastFrame(session), /Loading full session context/);
      await session.press("\x1b");
      if (navigation === "another-turn") await session.press("j\r");
      releaseScan();
      await session.press("");
      assert.match(lastFrame(session), navigation === "retreat" ? /▸ Turns/ : /▸ Detail/);
      assert.doesNotMatch(lastFrame(session), /▸ Conversation/);
      assert.doesNotMatch(lastFrame(session), /Loading full session context/);
      if (navigation === "another-turn") {
        assert.match(lastFrame(session), /other turn prompt/);
        await session.press("\x1bk\r");
      } else {
        await session.press("\r");
      }
      await session.press("\r");
      assert.match(lastFrame(session), /▸ Conversation/);
      assert.doesNotMatch(lastFrame(session), /context not loaded/);
      assert.equal(scans, 2, "returning to the original turn must reuse the completed context load");
    } finally {
      releaseScan();
      await session.end();
    }
  });
}

test("Ctrl+C releases the snapshot without hanging", { timeout: 15_000 }, async () => {
  const session = startTui(codexArgs());
  await session.waitFor(/CC History Lite TUI/, "first frame");
  await session.press("\x03");
  assert.equal(await session.exitCode, 0);
  assert.match(session.screen(), /CC History Lite snapshot released/);
  assert.ok(session.stdout.join("").includes(LEAVE_ALTERNATE_SCREEN));
});

for (const [name, key] of [["quit", "q"], ["Ctrl+C", "\x03"]] as const) {
  test(`${name} exits with an open kernel stdin pipe`, { timeout: 15_000 }, async () => {
    // Unlike PassThrough, an open kernel pipe keeps Node alive while reading.
    // Leave the parent write end open to expose leaked interactive input reads.
    const child = spawn(process.execPath, ["--input-type=module", "--eval", `
      import { runLiteTui } from ${JSON.stringify(new URL("./index.js", import.meta.url).href)};
      process.exitCode = await runLiteTui(${JSON.stringify(codexArgs())}, {
        cwd: ${JSON.stringify(repoRoot)}, homeDir: ${JSON.stringify(repoRoot)},
        hostname: "cchistory-lite-tui-exit-test-host",
        isInteractiveTerminal: true, input: process.stdin, output: process.stdout,
        stdout: value => process.stdout.write(value),
        stderr: value => process.stderr.write(value), columns: 80, rows: 24,
      });
    `], { stdio: ["pipe", "pipe", "pipe"] });
    const exited = once(child, "close");
    let stdout = "";
    let stderr = "";
    let sentKey = false;
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (!sentKey && stdout.includes("\x1b[H")) {
        sentKey = true;
        child.stdin.write(key);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    const watchdog = setTimeout(() => child.kill("SIGKILL"), 10_000);
    try {
      const [code, signal] = await exited;
      assert.ok(sentKey, `never reached the interactive frame: ${stderr}`);
      assert.equal(signal, null, `process did not exit after ${name}: ${stderr}`);
      assert.equal(code, 0, stderr);
      assert.ok(stdout.includes(LEAVE_ALTERNATE_SCREEN));
      assert.match(stdout, /CC History Lite snapshot released/);
    } finally {
      clearTimeout(watchdog);
      child.stdin.destroy();
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await exited;
      }
    }
  });
}

test("closing stdin exits cleanly instead of blocking forever", { timeout: 15_000 }, async () => {
  const session = startTui(codexArgs());
  await session.waitFor(/CC History Lite TUI/, "first frame");
  assert.equal(await session.end(), 0);
  assert.match(session.screen(), /CC History Lite snapshot released/);
});

test("entry-point flags seed the initial view", async () => {
  const snapshot = await scanLiteHistory({
    homeDir: repoRoot,
    hostname: "cchistory-lite-tui-test-host",
    sourceRoots: [{ sourceRef: "codex", baseDir: codexRoot }],
    sourceRefs: ["codex"],
    safeMode: true,
    contextMode: "none",
  });
  const turn = snapshot.listResolvedTurns()[0];
  assert.ok(turn);

  const byTurn = captureIo({ columns: 110, rows: 30, scan: async () => snapshot });
  assert.equal(await runLiteTui([...codexArgs(), "--turn", turn.id], byTurn.io), 0);
  assert.match(byTurn.stdout.join(""), /▸ Detail/);

  const bySearch = captureIo({ columns: 110, rows: 30, scan: async () => snapshot });
  assert.equal(await runLiteTui([...codexArgs(), "--search", "mock"], bySearch.io), 0);
  assert.match(bySearch.stdout.join(""), /search "mock"/);

  const unresolved = captureIo({ columns: 110, rows: 30, scan: async () => snapshot });
  assert.equal(await runLiteTui([...codexArgs(), "--project", "no-such-project"], unresolved.io), 0);
  assert.match(unresolved.stdout.join(""), /Project not found: no-such-project/);
});

test("sessions that derived no UserTurn stay reachable with their related work", async () => {
  const snapshot = await scanLiteHistory({
    homeDir: repoRoot,
    hostname: "cchistory-lite-tui-related-work-host",
    sourceRoots: [{ sourceRef: "openclaw", baseDir: openclawRoot }],
    sourceRefs: ["openclaw"],
    safeMode: true,
    contextMode: "none",
  });
  const { stdout, io } = captureIo({ columns: 140, rows: 40, scan: async () => snapshot });
  const exitCode = await runLiteTui(
    ["--no-color", "--session", "sess:openclaw:44444444-5555-4666-8777-888888888888"],
    io,
  );
  assert.equal(exitCode, 0);
  const output = stdout.join("");
  assert.match(output, /sessions\/detail/);
  assert.match(output, /▸ Detail/);
  assert.match(output, /Related work \(1\)/);
  assert.match(output, /automation run · self/);
  assert.match(output, /derived no UserTurn/);
});

test("every project and turn of a large snapshot is reachable by keyboard", async () => {
  const base = await scanLiteHistory({
    homeDir: repoRoot,
    hostname: "cchistory-lite-tui-reachability-host",
    sourceRoots: [{ sourceRef: "codex", baseDir: codexRoot }],
    safeMode: true,
    contextMode: "none",
  });
  const projectTemplate = base.data.projects[0];
  const sessionTemplate = base.data.sessions[0];
  const turnTemplate = base.data.turns[0];
  assert.ok(projectTemplate && sessionTemplate && turnTemplate);

  const projects = Array.from({ length: 51 }, (_, index) => ({
    ...projectTemplate,
    project_id: `reach-project-${index}`,
    project_revision_id: `reach-project-revision-${index}`,
    slug: `reach-project-${index}`,
    display_name: `Reach Project ${index}`,
    committed_turn_count: index === 0 ? 120 : 1,
    candidate_turn_count: 0,
    session_count: 1,
  }));
  const sessions = Array.from({ length: 51 }, (_, index) => ({
    ...sessionTemplate,
    id: `reach-session-${index}`,
    source_session_id: `reach-native-session-${index}`,
    title: `Reach Session ${index}`,
    turn_count: index === 0 ? 120 : 1,
  }));
  const turns = Array.from({ length: 170 }, (_, index) => {
    const bucket = index < 120 ? 0 : index - 119;
    const text = `reach needle ${String(index).padStart(3, "0")}`;
    return {
      ...turnTemplate,
      id: `reach-turn-${index}`,
      turn_revision_id: `reach-turn-revision-${index}`,
      session_id: sessions[bucket]!.id,
      project_id: projects[bucket]!.project_id,
      project_revision_id: projects[bucket]!.project_revision_id,
      raw_text: text,
      canonical_text: text,
    };
  });
  const snapshot = new LiveHistorySnapshot({ ...base.data, projects, sessions, turns, contexts: [] });

  const session = startTui(["--no-color"], { scan: async () => snapshot, rows: 24, columns: 100 });
  await session.waitFor(/▸ Projects/, "projects pane");

  // Walk the project list to the end; every project must scroll into view.
  const seenProjects = new Set<string>();
  for (let step = 0; step < projects.length + 2; step += 1) {
    for (const line of lastFrame(session).split("\n")) {
      const match = /Reach Project (\d+)/.exec(line);
      if (match) seenProjects.add(match[1]!);
    }
    await session.press("j");
  }
  assert.equal(seenProjects.size, projects.length, "every project should scroll into view");

  // The largest project's turns must all be reachable from the turn pane.
  await session.press("g");
  await session.press("t");
  const seenTurns = new Set<string>();
  for (let step = 0; step < 130; step += 1) {
    for (const line of lastFrame(session).split("\n")) {
      const match = /reach needle (\d+)/.exec(line);
      if (match) seenTurns.add(match[1]!);
    }
    await session.press("j");
  }
  assert.equal(seenTurns.size, 120, "every turn of the selected project should scroll into view");

  await session.press("q");
  assert.equal(await session.exitCode, 0);
});
