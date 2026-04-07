#!/usr/bin/env node

import { access, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import process from "node:process";
import { type SourceStatus } from "@cchistory/domain";
import {
  type CCHistoryStorage,
  installRuntimeWarningFilter,
} from "@cchistory/storage";
import {
  getFlag,
  getFlagValues,
  hasFlag,
  parseArgs,
  parseNumberFlag,
  renderHelp,
  type ParsedArgs,
} from "./args.js";
import { dim, red, yellow } from "./colors.js";

const errorStyle = red;
const hintStyle = yellow;
import {
  createStorage,
  openStorage,
  resolveStoreLayout,
  type StoreLayout,
} from "./store.js";
import { handleAgent } from "./commands/agent.js";
import { handleLs, handleSearch, handleShow, handleTree } from "./commands/browse.js";
import { handleBackup, handleExport, handleGc, handleImport, handleMergeAlias, handleRestoreCheck } from "./commands/maintenance.js";
import { handleQueryAlias, handleTemplates } from "./commands/query.js";
import { handleStats } from "./commands/stats.js";
import { handleDiscover, handleHealth, handleSync, syncSelectedSources } from "./commands/sync.js";

installRuntimeWarningFilter();

export interface CliIo {
  cwd: string;
  stdout: (value: string) => void;
  stderr: (value: string) => void;
}

export interface CommandOutput {
  text: string;
  json: unknown;
}

export type ReadMode = "index" | "full";

export interface OpenedReadStore {
  layout: StoreLayout;
  storage: CCHistoryStorage;
  close: () => Promise<void>;
}

export interface SyncedSourceSummary {
  source: SourceStatus;
  counts: {
    sessions: number;
    turns: number;
    records: number;
    fragments: number;
    atoms: number;
    blobs: number;
  };
}

export async function runCli(argv: string[], io: CliIo = defaultIo()): Promise<number> {
  const parsed = parseArgs(argv);
  const jsonMode = hasFlag(parsed, "json");

  // --version / -v
  if (hasFlag(parsed, "version") || parsed.positionals.includes("-v")) {
    const _require = createRequire(import.meta.url);
    const pkg = _require("../package.json") as { version: string };
    const version = pkg.version;
    printOutput({ text: `cchistory ${version}`, json: { version } }, jsonMode, io);
    return 0;
  }

  // Strip leading "--" (pnpm-style separator) before extracting the command
  const effectivePositionals = parsed.positionals[0] === "--" ? parsed.positionals.slice(1) : parsed.positionals;
  const [rawCommand, ...restPositionals] = effectivePositionals;
  const command = normalizeCommand(rawCommand);

  if (!command) {
    printOutput(
      {
        text: renderHelp(),
        json: { help: true },
      },
      jsonMode,
      io,
    );
    return 0;
  }

  try {
    const commandArgs = { ...parsed, positionals: restPositionals };
    const output = await dispatchCommand(command, commandArgs, io);
    printOutput(output, jsonMode || command === "query" || command === "templates", io);
    return 0;
  } catch (error) {
    const message = formatError(error);
    io.stderr(`${errorStyle(`Error: ${message}`)}\n`);
    // If the store wasn't found, add a helpful hint
    if (message.includes("Store not found")) {
      io.stderr(`\n${hintStyle("Hint:")} Run \`cchistory sync\` first to ingest data from AI coding tools on this machine.\n`);
      io.stderr(`${hintStyle("     ")} Run \`cchistory discover\` to see what sources are available.\n`);
    }
    const hint = getErrorHint(error);
    if (hint) {
      io.stderr(`${hintStyle("Hint:")} ${hint}\n`);
    }
    if (error instanceof Error && error.stack) {
      const stackLines = error.stack.split("\n").slice(1);
      if (stackLines.length > 0) {
        io.stderr(`\n${dim(stackLines.join("\n"))}\n`);
      }
    }
    return 1;
  }
}

async function dispatchCommand(command: string, parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  switch (command) {
    case "sync":
      return handleSync(parsed, io);
    case "discover":
      return handleDiscover(parsed);
    case "health":
      return handleHealth(parsed, io);
    case "ls":
      return handleLs(parsed, io);
    case "tree":
      return handleTree(parsed, io);
    case "show":
      return handleShow(parsed, io);
    case "search":
      return handleSearch(parsed, io);
    case "stats":
      return handleStats(parsed, io);
    case "export":
      return handleExport(parsed, io);
    case "backup":
      return handleBackup(parsed, io);
    case "restore-check":
      return handleRestoreCheck(parsed, io);
    case "import":
      return handleImport(parsed, io);
    case "merge":
      return handleMergeAlias(parsed, io);
    case "gc":
      return handleGc(parsed, io);
    case "query":
      return handleQueryAlias(parsed, io);
    case "templates":
      return handleTemplates();
    case "agent":
      return handleAgent(parsed, io);
    case "tui":
      return handleTui(parsed, io);
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function handleTui(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const { runTui } = await import("@cchistory/tui");
  const forwardedArgs = rebuildArgs(parsed);
  const exitCode = await runTui(forwardedArgs, {
    cwd: io.cwd,
    stdout: io.stdout,
    stderr: io.stderr,
    isInteractiveTerminal: Boolean(process.stdout.isTTY && process.stdin.isTTY),
  });
  if (exitCode !== 0) {
    throw new Error(`TUI exited with code ${exitCode}`);
  }
  return { text: "", json: null };
}

function rebuildArgs(parsed: ParsedArgs): string[] {
  const args: string[] = [];
  for (const pos of parsed.positionals) {
    args.push(pos);
  }
  for (const [key, values] of parsed.flags) {
    for (const value of values) {
      if (value === "true") {
        args.push(`--${key}`);
      } else {
        args.push(`--${key}`, value);
      }
    }
  }
  return args;
}

function normalizeCommand(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.toLowerCase().trim();
  if (normalized === "restore") {
    return "restore-check";
  }
  if (normalized === "help" || normalized === "-h" || normalized === "--help") {
    return undefined; // triggers help output
  }
  return normalized;
}

type ReadStoreFactory = (parsed: ParsedArgs, io: CliIo) => Promise<OpenedReadStore>;

let readStoreFactory: ReadStoreFactory = openReadStoreDefault;

export function interceptReadStoreFactoryForTests(wrapper: (next: ReadStoreFactory) => ReadStoreFactory): () => void {
  const previousFactory = readStoreFactory;
  readStoreFactory = wrapper(previousFactory);
  return () => {
    readStoreFactory = previousFactory;
  };
}

export async function openReadStore(parsed: ParsedArgs, io: CliIo): Promise<OpenedReadStore> {
  return readStoreFactory(parsed, io);
}

async function openReadStoreDefault(parsed: ParsedArgs, io: CliIo): Promise<OpenedReadStore> {
  const baseLayout = resolveStoreLayout({
    cwd: io.cwd,
    storeArg: getFlag(parsed, "store"),
    dbArg: getFlag(parsed, "db"),
  });
  const readMode = resolveReadMode(parsed);
  if (readMode === "index") {
    await requireStoreDatabase(baseLayout.dbPath);
    const storage = await openStorage(baseLayout);
    return {
      layout: baseLayout,
      storage,
      close: async () => {
        storage.close();
      },
    };
  }

  const storage = await createStorage({ dbPath: ":memory:" });
  const layout: StoreLayout = {
    ...baseLayout,
    dbPath: `${baseLayout.dbPath} (full scan in memory)`,
  };

  try {
    await syncSelectedSources({
      layout,
      storage,
      sourceRefs: getFlagValues(parsed, "source"),
      limitFiles: parseNumberFlag(parsed, "limit-files"),
      snapshotRawBlobs: false,
    });
    return {
      layout,
      storage,
      close: async () => {
        storage.close();
      },
    };
  } catch (error) {
    storage.close();
    throw error;
  }
}

export async function openExistingStore(parsed: ParsedArgs, io: CliIo): Promise<{ layout: StoreLayout; storage: CCHistoryStorage }> {
  const layout = resolveStoreLayout({
    cwd: io.cwd,
    storeArg: getFlag(parsed, "store"),
    dbArg: getFlag(parsed, "db"),
  });
  return {
    layout,
    storage: await openStorage(layout),
  };
}

export async function requireStoreDatabase(dbPath: string): Promise<void> {
  try {
    await access(dbPath);
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new Error(`Store not found: ${dbPath}. Run \`cchistory sync\` or \`cchistory import\` first.`);
    }
    throw error;
  }
}

export function resolveReadMode(parsed: ParsedArgs): ReadMode {
  if (hasFlag(parsed, "full")) {
    return "full";
  }
  return "index";
}

export function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function defaultIo(): CliIo {
  return {
    cwd: process.cwd(),
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  };
}

function printOutput(output: CommandOutput, jsonMode: boolean, io: CliIo): void {
  const value = jsonMode ? JSON.stringify(output.json, null, 2) : output.text;
  io.stdout(`${value}\n`);
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getErrorHint(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const msg = error.message;
  if (msg === "Invalid string length" || msg.includes("heap out of memory") || msg.includes("Allocation failed")) {
    return "Data too large for a single operation. Try exporting fewer sources with --source.";
  }
  if (msg.includes("ENOSPC")) {
    return "Disk full. Free up space and retry.";
  }
  if (msg.includes("EACCES") || msg.includes("EPERM")) {
    return "Permission denied. Check file/directory permissions.";
  }
  return undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
