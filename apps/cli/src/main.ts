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
  commandName,
  parseCliArgs,
  renderHelp,
  type ParsedCommand,
} from "./args.js";
import { configureColorPolicy, dim, red, yellow } from "./colors.js";

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
import { handleContext } from "./commands/context.js";
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

export interface CommandContext {
  commandPath: string[];
  positionals: string[];
  options: ParsedCommand["options"];
  globals: ParsedCommand["globals"];
  io: CliIo;
}

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
  try {
    const parsed = parseCliArgs(argv);
    configureColorPolicy({ color: parsed.globals.color });

    if (parsed.version) {
      const _require = createRequire(import.meta.url);
      const pkg = _require("../package.json") as { version: string };
      const version = pkg.version;
      printOutput({ text: `cchistory ${version}`, json: { version } }, parsed.globals.json, io);
      return 0;
    }

    if (parsed.help) {
      printOutput(
        {
          text: renderHelp(parsed.helpTarget),
          json: { help: true },
        },
        parsed.globals.json,
        io,
      );
      return 0;
    }

    const context: CommandContext = {
      commandPath: parsed.commandPath,
      positionals: parsed.positionals,
      options: parsed.options,
      globals: parsed.globals,
      io,
    };
    const output = await dispatchCommand(context);
    const topCommand = context.commandPath[0];
    printOutput(output, parsed.globals.json || topCommand === "query" || topCommand === "templates", io);
    return 0;
  } catch (error) {
    configureColorPolicy({ color: !argv.includes("--no-color") });
    printError(error, io, shouldPrintDebug(argv));
    return 1;
  }
}

async function dispatchCommand(context: CommandContext): Promise<CommandOutput> {
  const command = context.commandPath[0];
  switch (command) {
    case "sync":
      return handleSync(context);
    case "discover":
      return handleDiscover(context);
    case "health":
      return handleHealth(context);
    case "ls":
      return handleLs(context);
    case "tree":
      return handleTree(context);
    case "show":
      return handleShow(context);
    case "search":
      return handleSearch(context);
    case "context":
      return handleContext(context);
    case "stats":
      return handleStats(context);
    case "export":
      return handleExport(context);
    case "backup":
      return handleBackup(context);
    case "restore-check":
      return handleRestoreCheck(context);
    case "import":
      return handleImport(context);
    case "merge":
      return handleMergeAlias(context);
    case "gc":
      return handleGc(context);
    case "query":
      return handleQueryAlias(context);
    case "templates":
      return handleTemplates();
    case "agent":
      return handleAgent(context);
    case "tui":
      return handleTui(context);
    default:
      throw new Error(`Unknown command: ${commandName(context.commandPath)}`);
  }
}

async function handleTui(context: CommandContext): Promise<CommandOutput> {
  const { runTui } = await import("@cchistory/tui");
  const forwardedArgs = rebuildTuiArgs(context);
  const exitCode = await runTui(forwardedArgs, {
    cwd: context.io.cwd,
    stdout: context.io.stdout,
    stderr: context.io.stderr,
    isInteractiveTerminal: Boolean(process.stdout.isTTY && process.stdin.isTTY),
  });
  if (exitCode !== 0) {
    throw new Error(`TUI exited with code ${exitCode}`);
  }
  return { text: "", json: null };
}

function rebuildTuiArgs(context: CommandContext): string[] {
  const args: string[] = [];
  for (const pos of context.positionals) {
    args.push(pos);
  }
  pushOptionalArg(args, "store", context.globals.store);
  pushOptionalArg(args, "db", context.globals.db);
  if (context.globals.full) args.push("--full");
  if (context.globals.index) args.push("--index");
  for (const source of context.options.source) {
    pushOptionalArg(args, "source", source);
  }
  pushOptionalArg(args, "limit-files", context.options.limitFiles);
  pushOptionalArg(args, "search", context.options.search);
  if (context.options.sourceHealth) args.push("--source-health");
  return args;
}

function pushOptionalArg(args: string[], key: string, value: string | number | undefined): void {
  if (value === undefined) return;
  args.push(`--${key}`, String(value));
}

type ReadStoreFactory = (context: CommandContext) => Promise<OpenedReadStore>;

let readStoreFactory: ReadStoreFactory = openReadStoreDefault;

export function interceptReadStoreFactoryForTests(wrapper: (next: ReadStoreFactory) => ReadStoreFactory): () => void {
  const previousFactory = readStoreFactory;
  readStoreFactory = wrapper(previousFactory);
  return () => {
    readStoreFactory = previousFactory;
  };
}

export async function openReadStore(context: CommandContext): Promise<OpenedReadStore> {
  return readStoreFactory(context);
}

async function openReadStoreDefault(context: CommandContext): Promise<OpenedReadStore> {
  const baseLayout = resolveStoreLayout({
    cwd: context.io.cwd,
    storeArg: context.globals.store,
    dbArg: context.globals.db,
  });
  const readMode = resolveReadMode(context);
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
      sourceRefs: context.options.source,
      limitFiles: context.options.limitFiles,
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

export async function openExistingStore(context: CommandContext): Promise<{ layout: StoreLayout; storage: CCHistoryStorage }> {
  const layout = resolveStoreLayout({
    cwd: context.io.cwd,
    storeArg: context.globals.store,
    dbArg: context.globals.db,
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

export function resolveReadMode(context: CommandContext): ReadMode {
  if (context.globals.full) {
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

function printError(error: unknown, io: CliIo, debug: boolean): void {
  const message = formatError(error);
  io.stderr(`${errorStyle(`Error: ${message}`)}\n`);
  if (message.includes("Store not found")) {
    io.stderr(`\n${hintStyle("Hint:")} Run \`cchistory sync\` first to ingest data from AI coding tools on this machine.\n`);
    io.stderr(`${hintStyle("     ")} Run \`cchistory discover\` to see what sources are available.\n`);
  }
  const hint = getErrorHint(error);
  if (hint) {
    io.stderr(`${hintStyle("Hint:")} ${hint}\n`);
  }
  if (debug && error instanceof Error && error.stack) {
    const stackLines = error.stack.split("\n").slice(1);
    if (stackLines.length > 0) {
      io.stderr(`\n${dim(stackLines.join("\n"))}\n`);
    }
  }
}

function shouldPrintDebug(argv: string[]): boolean {
  return argv.includes("--debug") || process.env.CCHISTORY_DEBUG === "1";
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
