#!/usr/bin/env node

import process from "node:process";
import { pathToFileURL } from "node:url";
import { installRuntimeWarningFilter } from "@cchistory/storage/runtime-warning-filter";
import type { LocalTuiBrowser } from "@cchistory/storage";
import type { BrowserAction, BrowserState } from "./browser.js";
import type { StoreLayout } from "./store.js";


installRuntimeWarningFilter();

const tuiModulePromise = Promise.all([
  import("react"),
  import("ink"),
  import("@cchistory/storage"),
  import("./app.js"),
  import("./browser.js"),
  import("./store.js"),
]);

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string[]>;
}

interface TuiIo {
  cwd: string;
  stdout: (value: string) => void;
  stderr: (value: string) => void;
  isInteractiveTerminal?: boolean;
}

interface SnapshotHelpers {
  createBrowserState: (browser: LocalTuiBrowser) => BrowserState;
  reduceBrowserState: (browser: LocalTuiBrowser, state: BrowserState, action: BrowserAction) => BrowserState;
  renderBrowserSnapshot: (
    browser: LocalTuiBrowser,
    state: BrowserState,
    dims?: { width?: number; height?: number; headerLines?: string[] },
  ) => string;
}

export async function runTui(argv: string[], io: TuiIo = defaultIo()): Promise<number> {
  const parsed = parseArgs(argv);

  if (hasFlag(parsed, "help") || parsed.positionals[0] === "help") {
    io.stdout(`${renderHelp()}\n`);
    return 0;
  }

  const [
    ReactModule,
    inkModule,
    storageModule,
    appModule,
    browserModule,
    storeModule,
  ] = await tuiModulePromise;
  const React = ReactModule.default;
  const { render } = inkModule;
  const { buildLocalTuiBrowser } = storageModule;
  const { TuiApp } = appModule;
  const { createBrowserState, reduceBrowserState, renderBrowserSnapshot } = browserModule;
  const { openReadStorage } = storeModule;

  try {
    const readMode = resolveReadMode(parsed);
    if (readMode === "full" && (io.isInteractiveTerminal ?? false)) {
      throw new Error("Interactive TUI `--full` is not supported yet. Use non-interactive snapshot mode.");
    }

    const opened = await openReadStorage({
      cwd: io.cwd,
      storeArg: getFlag(parsed, "store"),
      dbArg: getFlag(parsed, "db"),
      readMode,
      sourceRefs: getFlagValues(parsed, "source"),
      limitFiles: parseNumberFlag(parsed, "limit-files"),
    });

    try {
      const browser = buildLocalTuiBrowser(opened.storage, { readMode: opened.readMode });
      const entryPoint = readEntryPoint(parsed);

      if (io.isInteractiveTerminal ?? false) {
        // Enter alternate screen + alternate scroll mode BEFORE Ink renders.
        // Alternate screen gives us a clean full-screen canvas and restores
        // the original terminal content on exit.
        // 1007h converts scroll-wheel into arrow key sequences (works only
        // inside alternate screen) — no mouse capture, text selection works.
        process.stdout.write("\x1b[?1049h"); // enter alternate screen
        process.stdout.write("\x1b[?1007h"); // alternate scroll mode

        const leaveAlternateScreen = () => {
          process.stdout.write("\x1b[?1007l");
          process.stdout.write("\x1b[?1049l");
        };

        // Safety: ensure we leave alternate screen even on unexpected exit
        const onSignal = () => { leaveAlternateScreen(); process.exit(); };
        process.on("SIGINT", onSignal);
        process.on("SIGTERM", onSignal);

        try {
          let initialState = createBrowserState(browser);
          if (entryPoint.projectRef) {
            initialState = reduceBrowserState(browser, initialState, { type: "open-project-ref", ref: entryPoint.projectRef });
          }
          if (entryPoint.sessionRef) {
            initialState = reduceBrowserState(browser, initialState, { type: "open-session-ref", ref: entryPoint.sessionRef });
          }
          if (entryPoint.turnRef) {
            initialState = reduceBrowserState(browser, initialState, { type: "open-turn-ref", ref: entryPoint.turnRef });
          }
          const app = render(React.createElement(TuiApp, { browser, initialState }));
          await app.waitUntilExit();
        } finally {
          process.off("SIGINT", onSignal);
          process.off("SIGTERM", onSignal);
          leaveAlternateScreen();
        }
      } else {
        io.stdout(`${renderSnapshot(opened.layout, browser, {
          searchQuery: getFlag(parsed, "search"),
          showSourceHealth: hasFlag(parsed, "source-health"),
          readMode: opened.readMode,
          entryPoint,
        }, {
          createBrowserState,
          reduceBrowserState,
          renderBrowserSnapshot,
        })}
`);
      }

      return 0;
    } finally {
      await opened.close();
    }
  } catch (error) {
    io.stderr(`${formatError(error)}\n`);
    return 1;
  }
}

interface EntryPoint {
  projectRef?: string;
  sessionRef?: string;
  turnRef?: string;
}

function readEntryPoint(parsed: ParsedArgs): EntryPoint {
  const projectRef = getFlag(parsed, "project");
  const sessionRef = getFlag(parsed, "session");
  const turnRef = getFlag(parsed, "turn");
  const defined = [projectRef, sessionRef, turnRef].filter(Boolean);
  if (defined.length > 1) {
    throw new Error("Use at most one of --project / --session / --turn. They select the same initial focus, so combining them is ambiguous.");
  }
  return { projectRef, sessionRef, turnRef };
}

function buildSnapshotState(
  browser: LocalTuiBrowser,
  options: {
    searchQuery?: string;
    showSourceHealth?: boolean;
    readMode: "index" | "full";
    entryPoint?: EntryPoint;
  },
  helpers: SnapshotHelpers,
) {
  let state = helpers.createBrowserState(browser);

  if (options.entryPoint) {
    if (options.entryPoint.projectRef) {
      state = helpers.reduceBrowserState(browser, state, { type: "open-project-ref", ref: options.entryPoint.projectRef });
    }
    if (options.entryPoint.sessionRef) {
      state = helpers.reduceBrowserState(browser, state, { type: "open-session-ref", ref: options.entryPoint.sessionRef });
    }
    if (options.entryPoint.turnRef) {
      state = helpers.reduceBrowserState(browser, state, { type: "open-turn-ref", ref: options.entryPoint.turnRef });
    }
  }

  if (options.showSourceHealth) {
    state = helpers.reduceBrowserState(browser, state, { type: "toggle-source-health" });
  }

  if (!options.searchQuery) {
    return state;
  }

  state = helpers.reduceBrowserState(browser, state, { type: "enter-search-mode" });
  for (const value of options.searchQuery) {
    state = helpers.reduceBrowserState(browser, state, { type: "append-search-char", value });
  }
  if (browser.searchPage(options.searchQuery, { limit: 1 }).total > 0) {
    state = helpers.reduceBrowserState(browser, state, { type: "drill" });
    state = helpers.reduceBrowserState(browser, state, { type: "drill" });
  }

  return state;
}

function renderSnapshot(
  layout: StoreLayout,
  browser: LocalTuiBrowser,
  options: {
    searchQuery?: string;
    showSourceHealth?: boolean;
    readMode: "index" | "full";
    entryPoint?: EntryPoint;
  },
  helpers: SnapshotHelpers,
): string {
  const cols = process.stdout.columns || Number(process.env["COLUMNS"]) || 120;
  const rows = process.stdout.rows || Number(process.env["LINES"]) || 40;
  return helpers.renderBrowserSnapshot(browser, buildSnapshotState(browser, options, helpers), {
    width: cols,
    height: rows,
    headerLines: buildSnapshotProvenanceLines(layout, options.readMode),
  });
}

function renderHelp(): string {
  return [
    "Usage: cchistory tui [options]",
    "",
    "Interactive and snapshot TUI for local project, ask, and detail browsing.",
    "",
    "Options:",
    "  --store <dir>          Local indexed store directory (default: ~/.cchistory)",
    "  --db <path>             Specific SQLite database path",
    "  --search <query>        Initial search query",
    "  --project <id|slug>     Open at a specific project (turns pane focused)",
    "  --session <id>          Open at the first turn of a specific session",
    "  --turn <id>             Open at a specific turn (detail pane focused)",
    "  --full                  Run a live in-memory scan analogous to CLI `--full`",
    "  --source <slot-or-id>   Source slot or id for live scan (when using --full)",
    "  --limit-files <n>       Limit the number of files scanned (when using --full)",
    "  --source-health         Include a source-health summary section (snapshot mode only)",
    "  --help                  Show this help output",
    "",
    "Entry-point flags (--project / --session / --turn) are mutually exclusive.",
    "Refs accept full IDs, slugs, or unique 4+ char prefixes.",
  ].join("\n");
}

function buildSnapshotProvenanceLines(
  layout: StoreLayout,
  readMode: "index" | "full",
): string[] {
  const readCode = readMode === "full" ? "live-full" : "indexed-only";
  const readLabel = readMode === "full" ? "live full scan in memory" : "indexed store only";
  return [
    `Store DB: ${layout.dbPath}`,
    `Read Mode: ${readLabel}`,
    `Read=${readCode}`,
  ];
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === undefined) {
      continue;
    }
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }

    const trimmed = value.slice(2);
    const [name, inlineValue] = trimmed.split("=", 2);
    if (!name) {
      continue;
    }
    if (inlineValue !== undefined) {
      pushFlag(flags, name, inlineValue);
      continue;
    }

    const nextValue = argv[index + 1];
    if (nextValue === undefined || nextValue.startsWith("--")) {
      pushFlag(flags, name, "true");
      continue;
    }

    pushFlag(flags, name, nextValue);
    index += 1;
  }

  return { positionals, flags };
}

function pushFlag(flags: Map<string, string[]>, name: string, value: string): void {
  const existing = flags.get(name) ?? [];
  existing.push(value);
  flags.set(name, existing);
}

function hasFlag(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags.has(name);
}

function getFlag(parsed: ParsedArgs, name: string): string | undefined {
  return parsed.flags.get(name)?.at(-1);
}

function getFlagValues(parsed: ParsedArgs, name: string): string[] {
  return parsed.flags.get(name) ?? [];
}

function parseNumberFlag(parsed: ParsedArgs, name: string): number | undefined {
  const raw = getFlag(parsed, name);
  if (raw === undefined) {
    return undefined;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || Number.isNaN(value) || value < 0) {
    throw new Error(`Expected --${name} to be a non-negative integer.`);
  }
  return value;
}

function resolveReadMode(parsed: ParsedArgs): "index" | "full" {
  const wantsIndex = hasFlag(parsed, "index");
  const wantsFull = hasFlag(parsed, "full");
  if (wantsIndex && wantsFull) {
    throw new Error("Use either --index or --full, not both.");
  }
  return wantsFull ? "full" : "index";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultIo(): TuiIo {
  return {
    cwd: process.cwd(),
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
    isInteractiveTerminal: Boolean(process.stdout.isTTY && process.stdin.isTTY),
  };
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  const exitCode = await runTui(process.argv.slice(2));
  process.exitCode = exitCode;
}
