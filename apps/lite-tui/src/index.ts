#!/usr/bin/env node

import { realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { StringDecoder } from "node:string_decoder";
import { pathToFileURL } from "node:url";
import {
  runWithAdaptiveNodeMemory,
  scanLiteHistory,
  type LiteSourceRoot,
  type LiveHistorySnapshot,
  type ScanLiteHistoryOptions,
} from "@cchistory/live-runtime";
import { configureColorPolicy } from "./colors.js";
import { KeyDecoder, type LiteKey } from "./keys.js";
import { resolveLiteInputEffect } from "./input.js";
import { LiteBrowserModel } from "./model.js";
import { BANNER_TITLE, DEFAULT_HEIGHT, DEFAULT_WIDTH, renderLiteFrame, renderLiteFrameLayout } from "./render.js";
import {
  createLiteBrowserState,
  clampLiteScrollState,
  getSelectedTurn,
  reduceLiteBrowserState,
  type LiteBrowserAction,
  type LiteBrowserState,
  type LiteScrollLimits,
} from "./state.js";
import { VERSION } from "./version.js";

export { VERSION } from "./version.js";

/** How long a lone `ESC` waits before it stops looking like a cursor sequence. */
const ESCAPE_FLUSH_MS = 40;

const ENTER_ALTERNATE_SCREEN = "\x1b[?1049h";
const LEAVE_ALTERNATE_SCREEN = "\x1b[?1049l";
const ENTER_ALTERNATE_SCROLL = "\x1b[?1007h";
const LEAVE_ALTERNATE_SCROLL = "\x1b[?1007l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CURSOR_HOME = "\x1b[H";
const ERASE_LINE_RIGHT = "\x1b[K";
const ERASE_BELOW = "\x1b[J";
const ERASE_SCREEN = "\x1b[2J";

export interface LiteTuiIo {
  cwd: string;
  homeDir?: string;
  hostname?: string;
  stdout: (value: string) => void;
  stderr: (value: string) => void;
  isInteractiveTerminal: boolean;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /** Terminal size overrides; used by tests and by non-TTY snapshot rendering. */
  columns?: number;
  rows?: number;
  now?: () => number;
  scan?: (options: ScanLiteHistoryOptions) => Promise<LiveHistorySnapshot>;
}

interface ParsedArgs {
  sourceRoots: LiteSourceRoot[];
  sourceRefs: string[];
  safeMode: boolean;
  limitFiles?: number;
  projectRef?: string;
  sessionRef?: string;
  turnRef?: string;
  searchQuery?: string;
  color?: boolean;
  help: boolean;
  version: boolean;
}

class TuiUsageError extends Error {}

export async function runLiteTui(argv: string[], io: LiteTuiIo = defaultIo()): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv, io.cwd);
  } catch (error) {
    io.stderr(`${errorMessage(error)}\n`);
    return error instanceof TuiUsageError ? 2 : 1;
  }

  if (parsed.help) {
    io.stdout(renderHelp());
    return 0;
  }
  if (parsed.version) {
    io.stdout(`${VERSION}\n`);
    return 0;
  }

  // Piped output never gets escape codes; an interactive terminal does unless
  // NO_COLOR or --no-color says otherwise.
  configureColorPolicy({ color: parsed.color ?? io.isInteractiveTerminal });

  try {
    const scan = io.scan ?? scanLiteHistory;
    const scanOptions: ScanLiteHistoryOptions = {
      homeDir: io.homeDir,
      hostname: io.hostname,
      sourceRoots: parsed.sourceRoots,
      sourceRefs: parsed.sourceRefs,
      safeMode: parsed.safeMode,
      limitFiles: parsed.limitFiles,
      contextMode: "none",
      onProgress: io.isInteractiveTerminal
        ? (event) => {
            const line = formatProgress(event);
            if (line) io.stderr(line);
          }
        : undefined,
    };

    const snapshot = await scan(scanOptions);
    const model = new LiteBrowserModel(snapshot);
    const state = applyEntryPoints(model, createLiteBrowserState(model), parsed);

    if (!io.isInteractiveTerminal) {
      io.stdout(`${renderLiteFrame(model, state, resolveDimensions(io))}\n`);
      return 0;
    }

    return await runInteractive({ io, scan, scanOptions, model, state });
  } catch (error) {
    io.stderr(`${errorMessage(error)}\n`);
    return error instanceof TuiUsageError ? 2 : 1;
  }
}

// ── Interactive session ──

interface InteractiveOptions {
  io: LiteTuiIo;
  scan: (options: ScanLiteHistoryOptions) => Promise<LiveHistorySnapshot>;
  scanOptions: ScanLiteHistoryOptions;
  model: LiteBrowserModel;
  state: LiteBrowserState;
}

async function runInteractive(options: InteractiveOptions): Promise<number> {
  const { io, scan, scanOptions } = options;
  let model = options.model;
  let state = options.state;

  const input = io.input ?? process.stdin;
  const output = io.output ?? process.stdout;
  const rawInput = input as NodeJS.ReadableStream & {
    isRaw?: boolean;
    setRawMode?(mode: boolean): void;
  };
  const resizable = output as NodeJS.WritableStream & {
    on?(event: "resize", listener: () => void): unknown;
    off?(event: "resize", listener: () => void): unknown;
  };

  let previousFrame = "";
  let scrollLimits: LiteScrollLimits = { overlay: 0, detail: 0, conversation: 0 };
  let interrupted = false;
  let finished = false;
  let resolveExit: (() => void) | undefined;
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });

  const paint = (force = false) => {
    if (finished) return;
    const rendered = renderLiteFrameLayout(model, state, resolveDimensions(io));
    scrollLimits = rendered.scrollLimits;
    state = clampLiteScrollState(state, scrollLimits);
    const frame = rendered.frame;
    if (!force && frame === previousFrame) return;
    previousFrame = frame;
    const painted = frame
      .split("\n")
      .map((line) => `${line}${ERASE_LINE_RIGHT}`)
      .join("\r\n");
    io.stdout(`${CURSOR_HOME}${painted}${ERASE_BELOW}`);
  };

  const dispatch = (action: LiteBrowserAction) => {
    state = reduceLiteBrowserState(model, state, action, scrollLimits);
    paint();
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    resolveExit?.();
  };

  // ── Async work: refresh and on-demand context ──

  let busy = false;

  const refresh = async () => {
    if (busy) return;
    busy = true;
    dispatch({ type: "set-status", status: { kind: "busy", text: "Refreshing from native source data…" } });
    try {
      const replacement = await scan({ ...scanOptions, onProgress: undefined });
      // Assign only after the rescan resolves: a failed refresh must leave the
      // previous complete snapshot in place.
      model = new LiteBrowserModel(replacement);
      state = createLiteBrowserState(model);
      dispatch({ type: "set-status", status: { kind: "info", text: "Snapshot refreshed." } });
    } catch (error) {
      dispatch({
        type: "set-status",
        status: { kind: "error", text: `Refresh failed; previous snapshot retained: ${errorMessage(error)}` },
      });
    } finally {
      busy = false;
    }
  };

  const loadContext = async () => {
    const entry = getSelectedTurn(model, state);
    if (!entry) return;
    if (model.hasContext(entry.turn.id)) {
      dispatch({ type: "drill" });
      return;
    }
    if (busy) return;
    busy = true;
    dispatch({ type: "set-status", status: { kind: "busy", text: "Loading full session context…" } });
    try {
      const session = model.getSession(entry.turn.session_id);
      const source = model.snapshot.getSource(entry.turn.source_id);
      if (!session || !source) {
        dispatch({ type: "set-status", status: { kind: "error", text: "Context unavailable for this turn." } });
        return;
      }
      const detailed = await scan({
        ...scanOptions,
        // A targeted rescan is already narrowed by source and session; keeping
        // --limit-files here would truncate the very files it needs.
        limitFiles: undefined,
        sourceRoots: [{ sourceRef: source.slot_id, baseDir: source.base_dir }],
        sourceRefs: [source.slot_id],
        contextMode: "full",
        sessionRefs: [session.source_session_id ?? session.id],
        onProgress: undefined,
      });
      if (finished) return;
      model.putContexts(detailed.data.contexts);
      dispatch({ type: "clear-status" });
      // The user can navigate while the scan is pending. Keep the completed
      // context in the cache, but only open the view that requested it.
      if (state.focusPane === "detail" && state.overlay === "none" &&
        getSelectedTurn(model, state)?.turn.id === entry.turn.id) {
        dispatch({ type: "drill" });
      }
    } catch (error) {
      dispatch({ type: "set-status", status: { kind: "error", text: `Context load failed: ${errorMessage(error)}` } });
    } finally {
      busy = false;
    }
  };

  // ── Terminal setup ──

  const setRawMode = (enabled: boolean) => {
    if (typeof rawInput.setRawMode === "function") rawInput.setRawMode(enabled);
  };

  const restoreTerminal = () => {
    setRawMode(false);
    io.stdout(`${LEAVE_ALTERNATE_SCROLL}${SHOW_CURSOR}${LEAVE_ALTERNATE_SCREEN}`);
  };

  const decoder = new KeyDecoder();
  const inputDecoder = new StringDecoder("utf8");
  let escapeTimer: NodeJS.Timeout | undefined;

  const handleKey = (key: LiteKey) => {
    const effect = resolveLiteInputEffect(state, key);
    if (effect.type === "exit") {
      finish();
      return;
    }
    if (effect.type === "action") {
      dispatch(effect.action);
      return;
    }
    if (effect.type === "refresh") {
      void refresh();
      return;
    }
    if (effect.type === "load-context") {
      void loadContext();
    }
  };

  const onData = (chunk: Buffer | string) => {
    if (escapeTimer) {
      clearTimeout(escapeTimer);
      escapeTimer = undefined;
    }
    for (const key of decoder.push(typeof chunk === "string" ? chunk : inputDecoder.write(chunk))) {
      handleKey(key);
      if (finished) return;
    }
    if (decoder.pending === "\x1b") {
      escapeTimer = setTimeout(() => {
        const pending = decoder.flushPendingEscape();
        if (pending) handleKey(pending);
      }, ESCAPE_FLUSH_MS);
      escapeTimer.unref?.();
    }
  };

  const onResize = () => {
    io.stdout(ERASE_SCREEN);
    paint(true);
  };

  const onSignal = (signal: NodeJS.Signals) => {
    if (signal === "SIGINT") interrupted = true;
    finish();
  };
  const onSigint = () => onSignal("SIGINT");
  const onSigterm = () => onSignal("SIGTERM");
  const onSighup = () => onSignal("SIGHUP");
  // Last-resort restore: an unexpected exit must not leave the user staring at
  // the alternate screen with echo disabled.
  const onProcessExit = () => restoreTerminal();

  io.stdout(`${ENTER_ALTERNATE_SCREEN}${ENTER_ALTERNATE_SCROLL}${HIDE_CURSOR}${ERASE_SCREEN}`);
  setRawMode(true);
  input.on("data", onData);
  input.once("end", finish);
  input.once("close", finish);
  resizable.on?.("resize", onResize);
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  process.on("SIGHUP", onSighup);
  process.once("exit", onProcessExit);

  try {
    paint(true);
    await exited;
  } finally {
    if (escapeTimer) clearTimeout(escapeTimer);
    input.off?.("data", onData);
    input.off?.("end", finish);
    input.off?.("close", finish);
    // Removing listeners leaves a terminal/pipe read handle active. Stop the
    // session's input read so Node can exit with stdin still open.
    input.pause();
    resizable.off?.("resize", onResize);
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    process.off("SIGHUP", onSighup);
    process.off("exit", onProcessExit);
    restoreTerminal();
  }

  if (interrupted) io.stdout("Interrupted; releasing snapshot.\n");
  io.stdout("CC History Lite snapshot released.\n");
  return 0;
}

// ── Entry points and helpers ──

function applyEntryPoints(
  model: LiteBrowserModel,
  initial: LiteBrowserState,
  parsed: ParsedArgs,
): LiteBrowserState {
  let state = initial;
  if (parsed.projectRef) state = reduceLiteBrowserState(model, state, { type: "open-project-ref", ref: parsed.projectRef });
  if (parsed.sessionRef) state = reduceLiteBrowserState(model, state, { type: "open-session-ref", ref: parsed.sessionRef });
  if (parsed.turnRef) state = reduceLiteBrowserState(model, state, { type: "open-turn-ref", ref: parsed.turnRef });
  if (parsed.searchQuery) state = reduceLiteBrowserState(model, state, { type: "open-search", query: parsed.searchQuery });
  return state;
}

function resolveDimensions(io: LiteTuiIo): { width: number; height: number; now: number } {
  const output = (io.output ?? process.stdout) as NodeJS.WritableStream & {
    columns?: number;
    rows?: number;
  };
  const width = io.columns ?? output.columns ?? numericEnv("COLUMNS") ?? DEFAULT_WIDTH;
  const height = io.rows ?? output.rows ?? numericEnv("LINES") ?? DEFAULT_HEIGHT;
  return { width, height, now: io.now?.() ?? Date.now() };
}

function numericEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function formatProgress(event: {
  stage: string;
  display_name?: string;
  slot_id?: string;
  message?: string;
  file_path?: string;
}): string {
  if (event.stage === "source_start") return `Scanning ${event.display_name} (${event.slot_id})…\n`;
  if (event.stage === "source_missing") return `Source missing: ${event.display_name} (${event.slot_id})\n`;
  if (event.stage === "file_error") {
    return `Read error in ${event.display_name}: ${event.message ?? event.file_path ?? "unknown file"}\n`;
  }
  return "";
}

// ── Argument parsing ──

const REF_FLAGS = new Set(["project", "session", "turn", "search"]);

function parseArgs(argv: string[], cwd: string): ParsedArgs {
  const parsed: ParsedArgs = {
    sourceRoots: [],
    sourceRefs: [],
    safeMode: false,
    help: false,
    version: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--safe") {
      parsed.safeMode = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      parsed.help = true;
      continue;
    }
    if (argument === "--version" || argument === "-V") {
      parsed.version = true;
      continue;
    }
    if (argument === "--no-color") {
      parsed.color = false;
      continue;
    }
    if (argument === "--color") {
      parsed.color = true;
      continue;
    }
    if (argument === "--store" || argument.startsWith("--store=") || argument === "--db" || argument.startsWith("--db=")) {
      throw new TuiUsageError("CC History Lite TUI does not accept --store or --db and never reads the Full store.");
    }
    if (argument === "--source-root" || argument.startsWith("--source-root=")) {
      const raw = readOptionValue(argv, index, argument, "source-root");
      if (argument === "--source-root") index += 1;
      parsed.sourceRoots.push(parseSourceRoot(raw, cwd));
      continue;
    }
    if (argument === "--source" || argument.startsWith("--source=")) {
      const raw = readOptionValue(argv, index, argument, "source");
      if (argument === "--source") index += 1;
      parsed.sourceRefs.push(raw);
      continue;
    }
    if (argument === "--limit-files" || argument.startsWith("--limit-files=")) {
      const raw = readOptionValue(argv, index, argument, "limit-files");
      if (argument === "--limit-files") index += 1;
      const value = Number(raw);
      if (!Number.isSafeInteger(value) || value < 1) throw new TuiUsageError("--limit-files must be an integer >= 1.");
      parsed.limitFiles = value;
      continue;
    }
    const refFlag = matchRefFlag(argument);
    if (refFlag) {
      const raw = readOptionValue(argv, index, argument, refFlag);
      if (argument === `--${refFlag}`) index += 1;
      if (refFlag === "project") parsed.projectRef = raw;
      else if (refFlag === "session") parsed.sessionRef = raw;
      else if (refFlag === "turn") parsed.turnRef = raw;
      else parsed.searchQuery = raw;
      continue;
    }
    throw new TuiUsageError(`Unknown Lite TUI argument: ${argument}. Run cchistory-lite-tui --help.`);
  }

  const entryPoints = [parsed.projectRef, parsed.sessionRef, parsed.turnRef].filter(Boolean);
  if (entryPoints.length > 1) {
    throw new TuiUsageError("Use at most one of --project / --session / --turn; they select the same initial focus.");
  }
  return parsed;
}

function matchRefFlag(argument: string): string | undefined {
  for (const name of REF_FLAGS) {
    if (argument === `--${name}` || argument.startsWith(`--${name}=`)) return name;
  }
  return undefined;
}

function readOptionValue(argv: string[], index: number, argument: string, name: string): string {
  const inlineIndex = argument.indexOf("=");
  const value = inlineIndex === -1 ? argv[index + 1] : argument.slice(inlineIndex + 1);
  if (!value || (inlineIndex === -1 && value.startsWith("--"))) {
    throw new TuiUsageError(`--${name} requires a value.`);
  }
  return value;
}

function parseSourceRoot(value: string, cwd: string): LiteSourceRoot {
  const equalsIndex = value.indexOf("=");
  if (equalsIndex <= 0 || equalsIndex === value.length - 1) {
    throw new TuiUsageError(`--source-root must use <slot-or-id>=<path>; received ${JSON.stringify(value)}.`);
  }
  return {
    sourceRef: value.slice(0, equalsIndex),
    baseDir: path.resolve(cwd, value.slice(equalsIndex + 1)),
  };
}

export function renderHelp(): string {
  return `${BANNER_TITLE}

A full-screen, keyboard-driven browser over one ephemeral snapshot of the AI
coding history already on this machine. It never reads or creates a CC History
Full store, and it writes no files.

Usage:
  cchistory-lite-tui [options]

Source options:
  --source-root <slot-or-id>=<path>  Override one registered adapter root; repeatable
  --source <slot-or-id>              Scan only the named adapters; repeatable
  --limit-files <n>                  Limit source files scanned per adapter
  --safe                             Enable adapter safe mode

Entry points (at most one of --project/--session/--turn):
  --project <ref>                    Open focused on a project's turns
  --session <ref>                    Open at the first turn of a session
  --turn <ref>                       Open at a turn's detail
  --search <query>                   Open in search mode with this query

Output options:
  --color / --no-color               Force or suppress ANSI styling
  -h, --help                         Show this help
  -V, --version                      Show version

Keys:
  ↑/↓ or j/k   move          Tab / Shift+Tab   next / previous pane
  PgUp/PgDn    page          Enter             drill in
  g / G        first / last  Esc               back or close overlay
  p / S        browse by project / by session
  t / d        focus turns / detail pane
  /            search        i  stats    s  sources    ? help
  r            refresh the snapshot from disk
  q            quit and release the snapshot

Refs accept a full id, a slug or display name, a workspace path, or a unique
id prefix. Piping the TUI renders one non-interactive snapshot frame and exits.
`;
}

function defaultIo(): LiteTuiIo {
  return {
    cwd: process.cwd(),
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
    isInteractiveTerminal: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    input: process.stdin,
    output: process.stdout,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDirectEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  let resolved: string;
  try {
    resolved = realpathSync(entry);
  } catch {
    return false;
  }
  return import.meta.url === pathToFileURL(resolved).href;
}

if (isDirectEntry()) {
  runWithAdaptiveNodeMemory(() => runLiteTui(process.argv.slice(2))).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      // The main catch already reports errors; the only throws that escape are
      // io failures (broken pipe, closed stderr). Keep the nonzero exit code
      // instead of crashing with an unhandled rejection.
      process.exitCode = 1;
    },
  );
}
