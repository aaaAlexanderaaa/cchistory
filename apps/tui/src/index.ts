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
  renderBrowserSnapshot: (browser: LocalTuiBrowser, state: BrowserState) => string;
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

      if (io.isInteractiveTerminal ?? false) {
        const app = render(React.createElement(TuiApp, { browser }));
        await app.waitUntilExit();
      } else {
        io.stdout(`${renderSnapshot(opened.layout, browser, {
          searchQuery: getFlag(parsed, "search"),
          showSourceHealth: hasFlag(parsed, "source-health"),
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

function renderSnapshot(
  layout: StoreLayout,
  browser: LocalTuiBrowser,
  options: {
    searchQuery?: string;
    showSourceHealth?: boolean;
  },
  helpers: SnapshotHelpers,
): string {
  return [
    "CCHistory TUI entrypoint",
    "",
    `Store DB: ${layout.dbPath}`,
    `Asset Dir: ${layout.assetDir}`,
    `Raw Dir: ${layout.rawDir}`,
    `Schema: ${browser.overview.schema.schema_version} (${browser.overview.schema.migrations.length} migration record(s))`,
    `Read Mode: ${browser.overview.read_mode === "full" ? "live full scan in memory" : "indexed store only (no live `--full` scan)"}`,
    `Search Mode: ${browser.overview.search_mode}`,
    `Counts: ${browser.overview.counts.projects} project(s), ${browser.overview.counts.sessions} session(s), ${browser.overview.counts.turns} turn(s), ${browser.overview.counts.sources} source(s)`,
    "",
    helpers.renderBrowserSnapshot(browser, buildSnapshotState(browser, options, helpers)),
  ].join("\n");
}

function buildSnapshotState(
  browser: LocalTuiBrowser,
  options: {
    searchQuery?: string;
    showSourceHealth?: boolean;
  },
  helpers: SnapshotHelpers,
) {
  let state = helpers.createBrowserState(browser);

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
  if (browser.search(options.searchQuery).length > 0) {
    state = helpers.reduceBrowserState(browser, state, { type: "drill" });
    state = helpers.reduceBrowserState(browser, state, { type: "drill" });
  }

  return state;
}

function renderHelp(): string {
  return [
    "Usage: cchistory-tui [--store <dir> | --db <path>] [--search <query>] [--source-health] [--full] [--source <slot-or-id>] [--limit-files <n>] [--help]",
    "",
    "Starts the canonical local TUI entrypoint for project, turn, and detail browsing, search drill-down, and source-health summary.",
    "The current TUI reads the indexed store only and does not yet expose a CLI-style live `--full` scan mode.",
    "Interactive mode runs on a TTY and does not require a managed API service.",
    "Non-interactive mode can accept `--search <query>` to render a search drill-down snapshot.",
    "Use `--source-health` in non-interactive mode to include the source-health summary section.",
    "Use `--full` in non-interactive mode to perform a live in-memory scan analogous to CLI `--full`.",
  ].join("\n");
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
