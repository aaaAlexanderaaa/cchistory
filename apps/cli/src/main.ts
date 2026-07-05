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
  renderNoArgsHelp,
  type ParsedCommand,
} from "./args.js";
import { CliError, storeNotFoundError, usageError } from "./errors.js";
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
import { handleCompletions } from "./commands/completions.js";
import { handleContext } from "./commands/context.js";
import { handleInventory } from "./commands/inventory.js";
import { handleMaintenance, handleBackup, handleExport, handleGc, handleImport, handleMergeAlias, handleRestoreCheck } from "./commands/maintenance.js";
import { handleMigration } from "./commands/migration.js";
import { handleQueryAlias, handleTemplates } from "./commands/query.js";
import { handleLast, handleResume } from "./commands/resume.js";
import { handleStats, handleToday } from "./commands/stats.js";
import { handleStatus } from "./commands/status.js";
import { handleDiscover, handleDoctor, handleHealth, handleSync, syncSelectedSources } from "./commands/sync.js";

installRuntimeWarningFilter();

export interface CliIo {
  cwd: string;
  stdout: (value: string) => void;
  stderr: (value: string) => void;
  isTTY?: boolean;
}

export {
  CliError,
  declinedError,
  isCliError,
  issuesFoundError,
  storeNotFoundError,
  usageError,
  verificationError,
} from "./errors.js";

export interface CommandOutput {
  text: string;
  json: unknown;
  exitCode?: number;
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
    // F15: support `-` as a stdin placeholder for any positional or option
    // value. Reads stdin once and substitutes the trimmed content into every
    // placeholder site. Lets operators pipe long refs/queries/IDs without
    // fighting shell quoting: `echo $ref | cchistory show turn -`.
    await substituteStdinPlaceholders(parsed);
    configureColorPolicy({ color: parsed.globals.color });

    if (parsed.version) {
      const _require = createRequire(import.meta.url);
      const pkg = _require("../package.json") as { version: string };
      const version = pkg.version;
      printOutput({ text: `cchistory ${version}`, json: { version } }, parsed.globals.json, io);
      return 0;
    }

    if (parsed.help) {
      const text = parsed.noArgs
        ? renderNoArgsHelp(await hasStoreResolved(io, parsed.globals))
        : renderHelp(parsed.helpTarget);
      printOutput(
        {
          text,
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
    return output.exitCode ?? 0;
  } catch (error) {
    configureColorPolicy({ color: !argv.includes("--no-color") && !argv.includes("--agent") });
    printError(error, io, shouldPrintDebug(argv));
    if (error instanceof CliError) {
      return error.exitCode;
    }
    if (error instanceof Error && error.message.includes("Store not found")) {
      return 3;
    }
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
    case "doctor":
      return handleDoctor(context);
    case "inventory":
      return handleInventory(context);
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
    case "today":
      return handleToday(context);
    case "status":
      return handleStatus(context);
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
    case "maintenance":
      return handleMaintenance(context);
    case "migration":
      return handleMigration(context);
    case "query":
      return handleQueryAlias(context);
    case "templates":
      return handleTemplates();
    case "agent":
      return handleAgent(context);
    case "completions":
      return handleCompletions(context);
    case "resume":
      return handleResume(context);
    case "last":
      return handleLast(context);
    case "tui":
      return handleTui(context);
    default: {
      // args.ts should normally have caught unknown commands before dispatch.
      // Fall back to a plain hint-free error to avoid masking an upstream bug.
      throw new Error(`Unknown command: ${commandName(context.commandPath)}`);
    }
  }
}

export async function handleTui(context: CommandContext): Promise<CommandOutput> {
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

export function rebuildTuiArgs(context: CommandContext): string[] {
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
  pushOptionalArg(args, "project", context.options.project);
  pushOptionalArg(args, "session", context.options.session);
  pushOptionalArg(args, "turn", context.options.turn);
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
      throw storeNotFoundError(formatStoreNotFoundMessage(dbPath));
    }
    throw error;
  }
}

function formatStoreNotFoundMessage(dbPath: string): string {
  return [
    `Store not found: ${dbPath}`,
    "",
    "CCHistory probed the following locations in order:",
    `  - ${dbPath}`,
    "Hints:",
    "  - Run `cchistory sync` to ingest from local AI coding tools on this machine.",
    "  - Run `cchistory import <bundle>` to restore from a previously exported bundle.",
    "  - Use `--store <dir>` or `--db <path>` to point at a non-default store location.",
  ].join("\n");
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

async function hasStoreResolved(io: CliIo, globals: ParsedCommand["globals"]): Promise<boolean> {
  const layout = resolveStoreLayout({
    cwd: io.cwd,
    storeArg: globals.store,
    dbArg: globals.db,
  });
  return pathExists(layout.dbPath);
}

/**
 * Replace `-` placeholders in positionals and string-valued options with the
 * trimmed content of stdin. Reads stdin at most once per invocation. Returns
 * silently if no placeholder is present OR if stdin is a TTY (so an
 * interactive `cchistory show turn -` doesn't hang waiting for input).
 */
async function substituteStdinPlaceholders(parsed: ParsedCommand): Promise<void> {
  const hasPlaceholder = parsed.positionals.includes("-")
    || Object.values(parsed.options).some((value) => value === "-" || (Array.isArray(value) && value.includes("-")));
  if (!hasPlaceholder) return;
  // Skip when stdin is a TTY — operator almost certainly forgot to pipe.
  if (process.stdin.isTTY) {
    throw usageError(
      "Argument `-` means read from stdin, but stdin is a terminal. Pipe content via `... | cchistory <cmd> -`, or replace `-` with the literal value.",
    );
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const stdinText = Buffer.concat(chunks).toString("utf8").trim();
  if (stdinText.length === 0) {
    throw usageError("Argument `-` expected stdin input, but stdin was empty.");
  }

  parsed.positionals = parsed.positionals.map((value) => (value === "-" ? stdinText : value));
  const options = parsed.options as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(options)) {
    if (value === "-") {
      options[key] = stdinText;
    } else if (Array.isArray(value)) {
      options[key] = value.map((entry) => (entry === "-" ? stdinText : entry));
    }
  }
}

function defaultIo(): CliIo {
  return {
    cwd: process.cwd(),
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
    isTTY: Boolean(process.stdout.isTTY),
  };
}

/**
 * Bumped whenever the shape of a CLI JSON payload changes in a way that would
 * break a consumer (renamed field, removed field, changed type). Adds are
 * forward-compatible and do NOT bump — consumers must already ignore unknown
 * fields per the schema-stability rules. AI agents parsing the stream can
 * switch on this field to choose a parser.
 */
const CLI_JSON_SCHEMA_VERSION = 1;

function printOutput(output: CommandOutput, jsonMode: boolean, io: CliIo): void {
  if (jsonMode) {
    // Stabilize the JSON envelope: every payload gets schema_version so
    // consumers can route on (kind, schema_version) without parsing drift.
    // We only inject when the payload is a plain object; raw arrays or
    // primitives (rare — used by `query`) pass through untouched.
    const payload =
      output.json && typeof output.json === "object" && !Array.isArray(output.json)
        ? { schema_version: CLI_JSON_SCHEMA_VERSION, ...(output.json as Record<string, unknown>) }
        : output.json;
    io.stdout(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  io.stdout(`${output.text}\n`);
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function printError(error: unknown, io: CliIo, debug: boolean): void {
  const message = formatError(error);
  io.stderr(`${errorStyle(`Error: ${message}`)}\n`);
  // The store-not-found message from formatStoreNotFoundMessage already embeds
  // the relevant hints inline; appending a separate Hint block here would
  // duplicate them on every store-missing invocation.
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
