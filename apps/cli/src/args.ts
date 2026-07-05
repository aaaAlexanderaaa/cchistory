import { parseArgs as parseNodeArgs } from "node:util";
import { usageError } from "./errors.js";

type OptionKind = "boolean" | "string" | "number" | "enum";

interface OptionSpec {
  kind: OptionKind;
  description: string;
  valueName?: string;
  multiple?: boolean;
  short?: string;
  choices?: string[];
}

interface CommandSpec {
  path: string[];
  usage: string;
  description: string;
  category?: string;
  summary?: string;
  examples?: string[];
  options?: string[];
  children?: string[];
  /** When set, overrides the implicit role derived from category/path. */
  role?: CommandRole;
  /**
   * When set, marks this command as a thin wrapper around the canonical
   * command(s). Renders an `(alias of <target>)` tag in help and surfaces
   * the canonical form to operators who want the underlying primitive.
   */
  aliasOf?: string;
  /**
   * Per-command defaults for shared options (e.g. `{ limit: 50 }`). Used by
   * `renderCommandHelp` to surface the actual default value next to the
   * option description instead of a misleading global number.
   */
  optionDefaults?: Record<string, number>;
}

export type CommandRole = "read" | "write" | "diagnostic" | "interactive";

const WRITE_TOP_LEVEL_COMMANDS = new Set([
  "sync",
  "gc",
  "import",
  "export",
  "backup",
  "merge",
  "maintenance",
  "migration",
  "agent",
]);

const DIAGNOSTIC_TOP_LEVEL_COMMANDS = new Set([
  "status",
  "discover",
  "health",
  "doctor",
  "inventory",
]);

const INTERACTIVE_TOP_LEVEL_COMMANDS = new Set(["tui"]);

/** Subcommand-level role overrides for parent commands that mix read/write. */
const COMMAND_ROLE_OVERRIDES: Record<string, CommandRole> = {
  // migration: `run`/`reset`/`compact` mutate; `preview`/`status`/`validate` only read state
  // (validate writes a marker but its user-visible intent is read-only verification)
  "migration preview": "read",
  "migration status": "read",
  "migration validate": "read",
  "migration run": "write",
  "migration reset": "write",
  "migration compact": "write",
};

export function commandRole(path: string[]): CommandRole {
  if (path.length === 0) return "read";
  const overrideKey = commandName(path);
  if (COMMAND_ROLE_OVERRIDES[overrideKey]) return COMMAND_ROLE_OVERRIDES[overrideKey]!;
  const top = path[0]!;
  const sub = path[1];
  if (top === "maintenance" && sub) return "write";
  if (top === "agent" && sub) return "write";
  if (top === "backup") return "write";
  if (top === "export") return "write";
  if (top === "import") return "write";
  if (top === "merge") return "write";
  if (INTERACTIVE_TOP_LEVEL_COMMANDS.has(top)) return "interactive";
  if (DIAGNOSTIC_TOP_LEVEL_COMMANDS.has(top)) return "diagnostic";
  if (WRITE_TOP_LEVEL_COMMANDS.has(top)) return "write";
  return "read";
}

/**
 * Pick the subset of global flags relevant to a command.
 *
 * Write commands don't need --long/--full/--index/--showall (they would be
 * silently ignored today, and the help noise hides the flags that actually
 * matter). Diagnostic commands don't need --long (their output is already
 * summary-style). Interactive commands only need the common subset.
 */
type GlobalOptionName = (typeof GLOBAL_OPTION_NAMES)[number];

function globalFlagsForCommand(path: string[]): readonly GlobalOptionName[] {
  const common: readonly GlobalOptionName[] = ["store", "db", "json", "debug", "color", "non-interactive", "agent"];
  switch (commandRole(path)) {
    case "write":
      return ["store", "db", "json", "dry-run", "debug", "color", "non-interactive", "agent"];
    case "diagnostic":
      return ["store", "db", "json", "full", "index", "showall", "debug", "color", "non-interactive", "agent"];
    case "interactive":
      return common;
    case "read":
    default:
      return ["store", "db", "json", "long", "full", "index", "dry-run", "showall", "debug", "color", "non-interactive", "agent"];
  }
}

export interface CliGlobals {
  store?: string;
  db?: string;
  json: boolean;
  long: boolean;
  full: boolean;
  index: boolean;
  dryRun: boolean;
  showAll: boolean;
  debug: boolean;
  color: boolean;
  verbose: boolean;
  nonInteractive: boolean;
  agent: boolean;
}

export interface CommandOptions {
  source: string[];
  limit?: number;
  offset?: number;
  cursor?: string;
  all: boolean;
  limitFiles?: number;
  since?: string;
  storeOnly: boolean;
  project?: string;
  by?: string;
  out?: string;
  write: boolean;
  noRaw: boolean;
  onConflict?: string;
  from?: string;
  to?: string;
  id?: string;
  search?: string;
  linkState?: string;
  server?: string;
  pairToken?: string;
  stateFile?: string;
  displayName?: string;
  reportedHostname?: string;
  intervalSeconds?: number;
  iterations?: number;
  force: boolean;
  retryAttempts?: number;
  retryDelayMs?: number;
  sourceHealth: boolean;
  detail: boolean;
  progress?: string;
  safe: boolean;
  forceFullResync: boolean;
  only: string[];
  preBundle?: string;
  phase?: string;
  step?: string;
  confirmNoBackup: boolean;
  tui: boolean;
  session?: string;
  turn?: string;
  today: boolean;
  week: boolean;
  month: boolean;
  merge: boolean;
}

export interface ParsedCommand {
  rawArgs: string[];
  commandPath: string[];
  positionals: string[];
  globals: CliGlobals;
  options: CommandOptions;
  help: boolean;
  helpTarget: string[];
  version: boolean;
  /** True when the user invoked the CLI with no arguments at all. */
  noArgs: boolean;
}

const GLOBAL_OPTION_NAMES = [
  "store",
  "db",
  "json",
  "long",
  "full",
  "index",
  "dry-run",
  "showall",
  "debug",
  "verbose",
  "color",
  "non-interactive",
  "agent",
  "help",
  "version",
] as const;

const globalOptions: Record<(typeof GLOBAL_OPTION_NAMES)[number], OptionSpec> = {
  store: {
    kind: "string",
    valueName: "dir",
    description: "Store directory (db at <dir>/cchistory.sqlite)",
  },
  db: {
    kind: "string",
    valueName: "file",
    description: "Explicit SQLite path; sidecar data lives beside it",
  },
  json: {
    kind: "boolean",
    description: "Machine-readable JSON output",
  },
  long: {
    kind: "boolean",
    description: "Expanded metadata and hierarchy detail",
  },
  full: {
    kind: "boolean",
    description: "Re-scan source roots into temporary in-memory store",
  },
  index: {
    kind: "boolean",
    description: "Read from existing store only",
  },
  "dry-run": {
    kind: "boolean",
    description: "Preview actions without writing",
  },
  showall: {
    kind: "boolean",
    description: "Include empty/missing items in listings",
  },
  debug: {
    kind: "boolean",
    description: "Print stack traces for troubleshooting",
  },
  verbose: {
    kind: "boolean",
    description: "Print operator progress for long-running commands",
  },
  color: {
    kind: "boolean",
    description: "Control ANSI color output; use --no-color to disable",
  },
  "non-interactive": {
    kind: "boolean",
    description: "Refuse any interactive surface (TUI, prompts). For CI/automation.",
  },
  agent: {
    kind: "boolean",
    description: "AI-agent mode: implies --non-interactive, --no-color, --json. Stable machine-readable output.",
  },
  help: {
    kind: "boolean",
    short: "h",
    description: "Show help",
  },
  version: {
    kind: "boolean",
    short: "v",
    description: "Show version",
  },
};

const commandOptions: Record<string, OptionSpec> = {
  source: {
    kind: "string",
    valueName: "slot-or-id",
    multiple: true,
    description: "Limit to a source slot or source ID",
  },
  phase: {
    kind: "string",
    valueName: "name",
    description: "Migration phase name (e.g. storage-boundary.write, storage-boundary.validate)",
  },
  step: {
    kind: "string",
    valueName: "drop-v1-tables|vacuum|both",
    description: "B.6 compact step (defaults to both)",
  },
  "confirm-no-backup": {
    kind: "boolean",
    description: "Skip the B.6 pre-run backup confirmation prompt",
  },
  "limit-files": {
    kind: "number",
    valueName: "n",
    description: "Limit files per source",
  },
  since: {
    kind: "string",
    valueName: "time",
    description: "Mark unchanged reused files older than an ISO time or relative window such as 7d or 12h as skipped",
  },
  "store-only": {
    kind: "boolean",
    description: "Suppress host discovery and inspect only the selected store",
  },
  all: {
    kind: "boolean",
    description: "Return all matches or rows allowed by the command",
  },
  limit: {
    kind: "number",
    valueName: "n",
    description: "Maximum result count",
  },
  offset: {
    kind: "number",
    valueName: "n",
    description: "Skip the first N results",
  },
  cursor: {
    kind: "string",
    valueName: "opaque",
    description: "Pagination cursor from a previous response's next_cursor; overrides --offset",
  },
  project: {
    kind: "string",
    valueName: "ref",
    description: "Project ID, Ref, display name, or workspace path",
  },
  by: {
    kind: "enum",
    valueName: "dimension",
    choices: ["model", "project", "source", "host", "day", "month"],
    description: "Group token usage by this dimension.",
  },
  out: {
    kind: "string",
    valueName: "dir",
    description: "Output bundle directory",
  },
  write: {
    kind: "boolean",
    description: "Execute a preview-first write workflow",
  },
  raw: {
    kind: "boolean",
    description: "Include raw blobs; use --no-raw to omit them",
  },
  "on-conflict": {
    kind: "enum",
    valueName: "mode",
    choices: ["error", "skip", "replace"],
    description: "Conflict behavior",
  },
  only: {
    kind: "string",
    valueName: "kind",
    multiple: true,
    description: "Run only the named migration validator (bundle, inventory, read-paths). Repeatable.",
  },
  "pre-bundle": {
    kind: "string",
    valueName: "dir",
    description: "Pre-migration bundle directory captured via `cchistory export` before B.3. Required for the bundle validator.",
  },
  from: {
    kind: "string",
    valueName: "path",
    description: "Source store or database",
  },
  to: {
    kind: "string",
    valueName: "path",
    description: "Target store or database",
  },
  id: {
    kind: "string",
    valueName: "id-or-ref",
    description: "Entity ID or accepted entity reference",
  },
  search: {
    kind: "string",
    valueName: "query",
    description: "Structured query search text or initial TUI search",
  },
  session: {
    kind: "string",
    valueName: "ref",
    description: "TUI entry point: open at the first turn of the named session. Mutually exclusive with --project and --turn.",
  },
  turn: {
    kind: "string",
    valueName: "ref",
    description: "TUI entry point: open at the named turn with the detail pane focused. Mutually exclusive with --project and --session.",
  },
  tui: {
    kind: "boolean",
    description: "resume: launch the TUI at the project's latest turn instead of printing a card",
  },
  today: {
    kind: "boolean",
    description: "stats: filter to turns submitted since the start of the local day (mutually exclusive with --week / --month / --since)",
  },
  week: {
    kind: "boolean",
    description: "stats: filter to turns submitted since the start of the current ISO week (Monday local)",
  },
  month: {
    kind: "boolean",
    description: "stats: filter to turns submitted since the first of the current month",
  },
  "link-state": {
    kind: "enum",
    valueName: "state",
    choices: ["all", "committed", "candidate", "unlinked"],
    description: "Project turn link-state filter",
  },
  server: {
    kind: "string",
    valueName: "url",
    description: "Remote CCHistory server URL",
  },
  "pair-token": {
    kind: "string",
    valueName: "token",
    description: "Server-issued remote-agent pairing token",
  },
  "state-file": {
    kind: "string",
    valueName: "file",
    description: "Remote-agent local state file",
  },
  "display-name": {
    kind: "string",
    valueName: "name",
    description: "Operator-facing remote-agent display name",
  },
  "reported-hostname": {
    kind: "string",
    valueName: "host",
    description: "Hostname reported to the remote service",
  },
  "interval-seconds": {
    kind: "number",
    valueName: "n",
    description: "Delay between scheduled remote-agent cycles",
  },
  iterations: {
    kind: "number",
    valueName: "n",
    description: "Number of scheduled remote-agent cycles",
  },
  force: {
    kind: "boolean",
    description: "Force upload even when the source fingerprint is unchanged",
  },
  "retry-attempts": {
    kind: "number",
    valueName: "n",
    description: "Remote upload retry attempts",
  },
  "retry-delay-ms": {
    kind: "number",
    valueName: "ms",
    description: "Delay between remote upload retries",
  },
  "source-health": {
    kind: "boolean",
    description: "Include source-health summary in TUI snapshot output",
  },
  detail: {
    kind: "boolean",
    description: "Print sync/doctor progress details to stderr",
  },
  progress: {
    kind: "enum",
    valueName: "mode",
    choices: ["text", "jsonl", "none"],
    description: "Progress output mode for long-running diagnostics.",
  },
  safe: {
    kind: "boolean",
    description: "Use conservative source probing without live probes or companion evidence.",
  },
  "force-full-resync": {
    kind: "boolean",
    description: "Bypass the per-source auto-resume marker and rescan all source files. The marker is still rewritten on success.",
  },
  merge: {
    kind: "boolean",
    description: "stats <path>: aggregate token usage across all matched projects into a single block (default: per-project blocks).",
  },
};

const readOptions = ["source", "limit-files"];
const remoteUploadOptions = ["state-file", "source", "limit-files", "raw", "force", "retry-attempts", "retry-delay-ms"];

const commandSpecs: CommandSpec[] = [
  {
    path: ["status"],
    category: "Start Here",
    usage: "cchistory status [--store <dir>|--db <file>] [--json]",
    summary: "Show store presence, counts, source health, and next actions",
    description:
      "Single-call operator overview. Reports store path, schema version, source/project/session/turn counts, source health (healthy/stale/error), latest sync timestamp, and a recommended Next Actions list. Use this as the entry point when you do not yet know what state the store is in — it routes you to sync, doctor, or stats as appropriate.",
    examples: ["cchistory status", "cchistory status --json"],
  },
  {
    path: ["sync"],
    category: "Data Management",
    usage: "cchistory sync [--source <slot-or-id>] [--limit-files <n>] [--since <time>] [--force-full-resync] [--detail] [--safe] [--dry-run]",
    summary: "Ingest data from local AI tool directories",
    description: "Ingest local source files into the selected store. By default each source auto-resumes from its last successful sync (recorded in schema_meta; floored to UTC 00:00 of that day). Pass --force-full-resync to bypass the marker, or --since to override it with an explicit cutoff.",
    options: ["source", "limit-files", "since", "detail", "progress", "safe", "force-full-resync"],
    examples: ["cchistory sync", "cchistory sync --source codex --detail", "cchistory sync --source claude_code --since 7d", "cchistory sync --force-full-resync"],
  },
  {
    path: ["discover"],
    category: "Data Management",
    usage: "cchistory discover [--showall]",
    summary: "Scan this host for supported AI tools",
    description: "Inspect host-level source and tool discovery without touching the store.",
    examples: ["cchistory discover", "cchistory discover --showall"],
  },
  {
    path: ["health"],
    category: "Data Management",
    usage: "cchistory health [--source <slot-or-id>] [--full] [--store-only]",
    summary: "Source health and store integrity check",
    description: "Read-only operator overview combining host discovery, sync preview, and store summary.",
    options: ["source", "store-only"],
    examples: ["cchistory health", "cchistory health --store ./.cchistory --store-only"],
  },
  {
    path: ["doctor"],
    category: "Data Management",
    usage: "cchistory doctor [--source <slot-or-id>] [--limit-files <n>] [--store-only] [--json]",
    summary: "Read-only sync and store diagnostics",
    description: "Inspect store compatibility, source roots, adapters, recent pipeline diagnostics, and capped source probes without writing.",
    options: ["source", "limit-files", "store-only", "detail", "progress"],
    examples: ["cchistory doctor", "cchistory doctor --source codex --json", "cchistory doctor --store ./.cchistory --store-only"],
  },
  {
    path: ["inventory"],
    category: "Data Management",
    usage: "cchistory inventory [--store <dir>|--db <file>] [--json]",
    summary: "Read-only storage footprint inventory",
    description: "Inspect table rows, payload bytes, SQLite file sizes, search-index state, and source-root bytes without writing.",
    examples: ["cchistory inventory", "cchistory inventory --store ./.cchistory --json"],
  },
  {
    path: ["ls"],
    category: "Browse & Inspect",
    usage: "cchistory ls [path] | projects|sessions|sources [--long] [--all] [--limit <n>]",
    summary: "List projects at a path (default: cwd) or list entities by keyword",
    description:
      "Default form (`ls` or `ls <path>`) treats the directory as a project: shows the project whose workspace matches the path plus any nested sub-projects. Keyword form (`ls projects|sessions|sources`) lists across the whole store.",
    children: ["projects", "sessions", "sources"],
    options: ["all", "limit", ...readOptions],
    examples: [
      "cchistory ls",
      "cchistory ls ./apps/cli",
      "cchistory ls projects",
      "cchistory ls sessions --long",
      "cchistory ls sources",
    ],
  },
  {
    path: ["ls", "projects"],
    usage: "cchistory ls projects [--long] [--showall]",
    description: "List projects with copyable refs.",
    options: readOptions,
    examples: ["cchistory ls projects", "cchistory ls projects --long", "cchistory ls projects --source codex"],
  },
  {
    path: ["ls", "sessions"],
    usage: "cchistory ls sessions [--long] [--all] [--limit <n>]",
    description: "List sessions with compact default output.",
    options: ["all", "limit", ...readOptions],
    optionDefaults: { limit: 30 },
    examples: ["cchistory ls sessions", "cchistory ls sessions --limit 50", "cchistory ls sessions --long --source codex"],
  },
  {
    path: ["ls", "sources"],
    usage: "cchistory ls sources",
    description: "List configured sources.",
    options: readOptions,
    examples: ["cchistory ls sources"],
  },
  {
    path: ["tree"],
    category: "Browse & Inspect",
    usage: "cchistory tree [path] | projects|project <ref>|session <ref> [--long]",
    summary: "Hierarchical view from a path or by keyword",
    description:
      "Default form (`tree` or `tree <path>`) resolves the project at the path and renders its session threads plus a compact sub-project summary. Keyword form keeps the legacy `tree projects|project|session <ref>` dispatch.",
    children: ["projects", "project", "session"],
    options: readOptions,
    examples: [
      "cchistory tree",
      "cchistory tree ./apps/cli",
      "cchistory tree projects",
      "cchistory tree project chat-ui-kit",
      "cchistory tree session <session-ref> --long",
    ],
  },
  { path: ["tree", "projects"], usage: "cchistory tree projects [--long]", description: "Show all projects as a hierarchy.", options: readOptions, examples: ["cchistory tree projects", "cchistory tree projects --long"] },
  { path: ["tree", "project"], usage: "cchistory tree project <project-ref> [--long]", description: "Show one project with session threads.", options: readOptions, examples: ["cchistory tree project chat-ui-kit"] },
  { path: ["tree", "session"], usage: "cchistory tree session <session-ref> [--long]", description: "Show one session hierarchy.", options: readOptions, examples: ["cchistory tree session <session-ref>", "cchistory tree session <session-ref> --long"] },
  {
    path: ["show"],
    category: "Browse & Inspect",
    usage: "cchistory show <path> | project|session|turn|source <ref> [--long]",
    summary: "Detail view of a single entity (path defaults to project)",
    description:
      "Show a project, session, turn, or source. Path-form (`show <path>`) is shorthand for `show project <path>` and resolves via the project workspace.",
    children: ["project", "session", "turn", "source"],
    options: readOptions,
    examples: [
      "cchistory show ./apps/cli",
      "cchistory show project chat-ui-kit",
      "cchistory show turn <turn-id-or-prefix> --long",
    ],
  },
  { path: ["show", "project"], usage: "cchistory show project <project-ref> [--long]", description: "Show project detail.", options: readOptions, examples: ["cchistory show project chat-ui-kit", "cchistory show project chat-ui-kit --long"] },
  { path: ["show", "session"], usage: "cchistory show session <session-ref> [--long]", description: "Show session detail.", options: readOptions, examples: ["cchistory show session <session-ref>", "cchistory show session <session-ref> --long"] },
  { path: ["show", "turn"], usage: "cchistory show turn <turn-id-or-prefix> [--long]", description: "Show ask and response detail.", options: readOptions, examples: ["cchistory show turn <turn-id-or-prefix>", "cchistory show turn abc123 --long"] },
  { path: ["show", "source"], usage: "cchistory show source <source-ref>", description: "Show source detail.", options: readOptions, examples: ["cchistory show source codex", "cchistory show source src-1"] },
  {
    path: ["search"],
    category: "Browse & Inspect",
    usage: "cchistory search <query> [--project <ref>] [--source <slot-or-id>] [--limit <n>] [--offset <n>|--cursor <opaque>] [--all]",
    summary: "Full-text search across asks",
    description: "Search canonical ask text and print drill-down pivots. The JSON response includes next_cursor when more results are available; pass it back via --cursor to fetch the next page.",
    options: ["project", "source", "limit", "offset", "cursor", "all", "limit-files"],
    optionDefaults: { limit: 50 },
    examples: ["cchistory search \"data security\"", "cchistory search refactor --project chat-ui-kit", "cchistory search refactor --limit 10 --json | jq -r .next_cursor"],
  },
  {
    path: ["context"],
    category: "Browse & Inspect",
    usage: "cchistory context project <ref> [--limit <n>] [--json]",
    summary: "AI-ready project context packet (ref/name/path)",
    description: "Build a project-scoped context packet for operators and AI agents.",
    children: ["project"],
    options: ["limit", ...readOptions],
    optionDefaults: { limit: 12 },
    examples: ["cchistory context project chat-ui-kit", "cchistory context project chat-ui-kit --json"],
  },
  { path: ["context", "project"], usage: "cchistory context project <ref> [--limit <n>] [--json]", description: "Show project context.", options: ["limit", ...readOptions], optionDefaults: { limit: 12 }, examples: ["cchistory context project chat-ui-kit", "cchistory context project chat-ui-kit --json"] },
  {
    path: ["stats"],
    category: "Data Management",
    usage: "cchistory stats [<path>] [--by model|project|source|host|day|month] [--merge] [--since <time>|--today|--week|--month]",
    summary: "Token usage statistics, optionally scoped to a path",
    description:
      "Show the store overview; add --by to roll up token usage. Pass a path positional to scope to a project (and its sub-projects): default renders one block per matched project; pass --merge to aggregate. Keyword `usage` keeps the legacy subcommand form. Pass --since (ISO or relative like 7d/12h), --today, --week, or --month to filter to a recent window.",
    children: ["usage"],
    options: ["by", "since", "today", "week", "month", "merge", ...readOptions],
    examples: [
      "cchistory stats",
      "cchistory stats --by model",
      "cchistory stats --today",
      "cchistory stats --week --by model",
      "cchistory stats usage --by day --since 7d",
      "cchistory stats ./apps/cli",
      "cchistory stats . --by model --merge",
    ],
  },
  {
    path: ["stats", "usage"],
    usage: "cchistory stats usage --by model|project|source|host|day|month [--since <time>|--today|--week|--month]",
    description: "Show token usage grouped by model, project, source, host, day, or month. Honors the same --since / --today / --week / --month window as `stats`.",
    options: ["by", "since", "today", "week", "month", ...readOptions],
    examples: [
      "cchistory stats usage --by model",
      "cchistory stats usage --by source",
      "cchistory stats usage --by month",
      "cchistory stats usage --by day --since 7d",
    ],
  },
  {
    path: ["export"],
    category: "Backup & Transfer",
    usage: "cchistory export --out <dir> [--source <slot-or-id>] [--no-raw] [--dry-run]",
    summary: "Export store to a portable bundle",
    description: "Export the store to a portable bundle.",
    options: ["out", "source", "raw"],
    examples: ["cchistory export --out ./my-backup", "cchistory export --out ./my-backup --dry-run"],
  },
  {
    path: ["backup"],
    category: "Backup & Transfer",
    usage: "cchistory backup --out <dir> [--write] [--source <slot-or-id>] [--no-raw]",
    summary: "Preview-first export (--write to execute)",
    description: "Preview-first portable backup shortcut.",
    options: ["out", "source", "raw", "write"],
    aliasOf: "export --write",
    examples: ["cchistory backup --out ./my-backup", "cchistory backup --out ./my-backup --write"],
  },
  {
    path: ["restore-check"],
    category: "Backup & Transfer",
    usage: "cchistory restore-check --store <dir>|--db <file>",
    summary: "Validate a store can be restored",
    description: "Read-only post-restore verification.",
    aliasOf: "stats + ls sources",
    examples: ["cchistory restore-check --store ./restored-store"],
  },
  {
    path: ["import"],
    category: "Backup & Transfer",
    usage: "cchistory import <bundle-dir> [--dry-run] [--on-conflict error|skip|replace]",
    summary: "Import a previously exported bundle",
    description: "Import a bundle into the selected store.",
    options: ["on-conflict"],
    examples: ["cchistory import ./my-backup", "cchistory import ./my-backup --dry-run"],
  },
  {
    path: ["merge"],
    category: "Backup & Transfer",
    usage: "cchistory merge --from <store-or-db> --to <store-or-db> [--source <slot-or-id>] [--on-conflict skip|replace] [--write]",
    summary: "Preview-first merge via bundle exchange",
    description: "Preview or execute a merge between two stores through the bundle compatibility path.",
    options: ["from", "to", "source", "on-conflict", "write"],
    aliasOf: "export (from) | import (to)",
    examples: ["cchistory merge --from /host-a/.cchistory --to /host-b/.cchistory", "cchistory merge --from /host-a/.cchistory --to /host-b/.cchistory --write"],
  },
  {
    path: ["gc"],
    category: "Data Management",
    usage: "cchistory gc [--write] [--dry-run]",
    summary: "Clean orphaned raw snapshots (preview-first; --write to execute)",
    description: "Prune raw snapshot files no longer referenced by the current SQLite index. Defaults to preview; pass --write to actually delete.",
    options: ["write"],
    examples: ["cchistory gc", "cchistory gc --write", "cchistory gc --dry-run"],
  },
  {
    path: ["maintenance"],
    category: "Data Management",
    usage: "cchistory maintenance rebuild-search-index|gc-evidence|checkpoint|vacuum|refresh-projections [--write]",
    summary: "Operator maintenance commands (preview-first; --write to execute)",
    description:
      "Low-frequency operator commands for the V1+V2 storage boundary. Use these to reclaim space after Phase A landed: rebuild the FTS5 search index (A.1), prune orphaned V2 evidence blobs (A.2), checkpoint the WAL (A.4), or VACUUM the SQLite file into the new 16 KiB page size (A.4). All subcommands default to preview; pass --write to actually mutate.",
    children: ["rebuild-search-index", "gc-evidence", "checkpoint", "vacuum", "refresh-projections"],
    options: ["write"],
    examples: [
      "cchistory maintenance rebuild-search-index",
      "cchistory maintenance rebuild-search-index --write",
      "cchistory maintenance gc-evidence --write",
      "cchistory maintenance checkpoint --write",
      "cchistory maintenance vacuum --write",
      "cchistory maintenance refresh-projections --write",
    ],
  },
  {
    path: ["maintenance", "rebuild-search-index"],
    usage: "cchistory maintenance rebuild-search-index [--write] [--dry-run]",
    description:
      "Repopulate the FTS5 search_index table from current user_turns rows. After Phase A.1 the refresh hot path no longer maintains FTS5; this is the explicit operator hook. Has no effect on the scan-path search, which reads user_turns directly. Defaults to preview; pass --write to actually index.",
    options: ["write"],
    examples: ["cchistory maintenance rebuild-search-index", "cchistory maintenance rebuild-search-index --write"],
  },
  {
    path: ["maintenance", "gc-evidence"],
    usage: "cchistory maintenance gc-evidence [--write] [--dry-run]",
    description:
      "Drop evidence_blobs rows whose sha is no longer referenced from evidence_captures or parsed_record_spans, and unlink the corresponding content-addressed files. Use this to reclaim space accumulated before Phase A.2 wired evidence GC into the purge paths. Defaults to preview; pass --write to delete.",
    options: ["write"],
    examples: ["cchistory maintenance gc-evidence", "cchistory maintenance gc-evidence --write"],
  },
  {
    path: ["maintenance", "checkpoint"],
    usage: "cchistory maintenance checkpoint [--write] [--dry-run]",
    description:
      "Run PRAGMA wal_checkpoint(TRUNCATE) to fold the WAL into the main SQLite file and truncate the WAL. Useful between long-running sync batches to bound on-disk footprint. Defaults to preview; pass --write to actually truncate.",
    options: ["write"],
    examples: ["cchistory maintenance checkpoint", "cchistory maintenance checkpoint --write"],
  },
  {
    path: ["maintenance", "vacuum"],
    usage: "cchistory maintenance vacuum [--write] [--dry-run]",
    description:
      "Run VACUUM to rebuild the SQLite file. Required once per store to materialize the new 16 KiB page size from Phase A.4; otherwise the pragma is silently ignored on existing databases. Blocks writes for the duration. Defaults to preview; pass --write to VACUUM.",
    options: ["write"],
    examples: ["cchistory maintenance vacuum", "cchistory maintenance vacuum --write"],
  },
  {
    path: ["maintenance", "refresh-projections"],
    usage: "cchistory maintenance refresh-projections [--write] [--dry-run]",
    description:
      "Rebuild project_current (and the project link revision lineage) from the canonical session/turn rows. Use this when sync crashed mid-flight (e.g. OOM) and left project_current pointing at stale data — `ls projects` will show old `Last Active` even though the raw rows are fresh. Idempotent. Defaults to preview; pass --write to rebuild.",
    options: ["write"],
    examples: ["cchistory maintenance refresh-projections", "cchistory maintenance refresh-projections --write"],
  },
  {
    path: ["migration"],
    category: "Data Management",
    usage: "cchistory migration preview|run|status|validate|reset|compact",
    summary: "Storage boundary V1→V2 migration (B.1-B.6)",
    description:
      "Phase B storage-boundary migration tooling. `preview` is read-only and reports the V1→V2 backfill gap, removable bytes, and VACUUM disk requirement. `run` performs the per-source V2 backfill (B.3) — V1 payloads are not touched. `status` prints migration_state markers. `validate` runs the B.4/B.6 validators (bundle byte-diff, inventory diff, read-path parity, V1 payload digest). `reset` clears migration_state markers so an aborted or stale migration can be re-run. `compact` runs B.6 (drop V1 user_turns/turn_contexts tables and VACUUM) — irreversible, requires a pre-run backup.",
    children: ["preview", "run", "status", "validate", "reset", "compact"],
    examples: [
      "cchistory migration preview",
      "cchistory migration run --dry-run",
      "cchistory migration run --source src-1",
      "cchistory migration status",
      "cchistory migration validate --pre-bundle ./pre-migration-bundle",
      "cchistory migration validate --only inventory",
      "cchistory migration reset --phase storage-boundary.write",
    ],
  },
  {
    path: ["migration", "preview"],
    usage: "cchistory migration preview [--store <dir>|--db <file>] [--json]",
    description:
      "Read-only. Inspect V1→V2 row mapping, backfill gap, removable V1 payload_json bytes, and the VACUUM disk-space requirement.",
    examples: ["cchistory migration preview", "cchistory migration preview --json"],
  },
  {
    path: ["migration", "run"],
    usage: "cchistory migration run [--source <slot-or-id>] [--write] [--dry-run] [--store <dir>|--db <file>]",
    description:
      "B.3: per-source V1→V2 backfill. Reads the V1 view of each source and re-runs the canonical V2 write path so missing V2 sidecars are filled. Idempotent: sources already marked completed in migration_state are skipped. V1 payloads are never touched. Defaults to preview; pass --write to actually backfill. Halts at the first source that aborts; clear with `cchistory migration reset` after auditing.",
    options: ["source", "write"],
    examples: ["cchistory migration run", "cchistory migration run --write", "cchistory migration run --write --source codex"],
  },
  {
    path: ["migration", "status"],
    usage: "cchistory migration status [--store <dir>|--db <file>] [--json]",
    description:
      "Print migration_state markers: per-source status (running/completed/aborted) for the storage-boundary.write phase.",
    examples: ["cchistory migration status", "cchistory migration status --json"],
  },
  {
    path: ["migration", "validate"],
    usage:
      "cchistory migration validate [--only bundle|inventory|read-paths|v1-payload-digest]... [--pre-bundle <dir>] [--store <dir>|--db <file>]",
    description:
      "B.4/B.6: post-B.3 validators. Four independent checks prove the V2 sidecars B.3 wrote are equivalent to V1 and that V1 has not drifted before B.6: (a) bundle byte-diff against a pre-migration bundle (--pre-bundle, required when --only bundle is selected); (b) inventory row-count parity across the four V1↔V2 pairs; (c) read-path parity — deepEqual getTurnContext V1 vs V2 cache across every turn, plus UserTurnProjection V1 vs V2 full-content columns (B.5.0d); (d) V1 payload digest drift detection. All four run by default; each writes its own migration_state marker.",
    options: ["only", "pre-bundle"],
    examples: ["cchistory migration validate", "cchistory migration validate --only inventory", "cchistory migration validate --only bundle --pre-bundle ./pre-bundle"],
  },
  {
    path: ["migration", "reset"],
    usage: "cchistory migration reset [--phase <name>] [--force] [--write] [--dry-run] [--store <dir>|--db <file>] [--json]",
    description:
      "B.5.0: clear migration_state marker rows so an aborted or stale migration can be re-run. Default clears every phase; --phase storage-boundary.write clears just B.3 markers; --phase storage-boundary.validate clears just B.4 markers. Refuses to clear while any marker is still 'running' (would defeat the C2 abort-resurrect guard); pass --force to override after confirming the prior PID is dead. Defaults to preview; pass --write to actually clear markers.",
    options: ["phase", "force", "write"],
    examples: ["cchistory migration reset", "cchistory migration reset --write", "cchistory migration reset --write --phase storage-boundary.write", "cchistory migration reset --write --force"],
  },
  {
    path: ["migration", "compact"],
    usage: "cchistory migration compact [--step <drop-v1-tables|vacuum|both>] [--write] [--dry-run] [--confirm-no-backup] [--store <dir>|--db <file>] [--json]",
    description:
      "B.6: drop V1 user_turns and turn_contexts tables (step=drop-v1-tables) and/or VACUUM to reclaim pages (step=vacuum). Default step is `both`. IRREVERSIBLE — there is no rollback path; a pre-run backup is mandatory. Pre-flight gates refuse if any validator has drifted, if any marker is still 'running', or if free disk < current DB size (VACUUM needs the room). Pass --confirm-no-backup to skip the backup confirmation prompt. Defaults to preview; pass --write to apply. --dry-run is still honored as an explicit preview flag (and wins over --write if both are given).",
    options: ["step", "confirm-no-backup", "write"],
    examples: ["cchistory migration compact", "cchistory migration compact --write", "cchistory migration compact --write --step vacuum", "cchistory migration compact --write --confirm-no-backup"],
  },
  {
    path: ["query"],
    category: "Advanced (experimental)",
    usage: "cchistory query turns|turn|sessions|session|projects|project ...",
    summary: "Scriptable JSON-only interface",
    description: "Structured JSON output for programmatic consumption.",
    children: ["turns", "turn", "sessions", "session", "projects", "project"],
    options: readOptions,
    examples: ["cchistory query turns --search refactor --limit 5", "cchistory query turn --id <turn-id>"],
  },
  { path: ["query", "turns"], usage: "cchistory query turns [--search <query>] [--project <ref>] [--source <slot-or-id>] [--limit <n>]", description: "Query turns.", options: ["search", "project", "source", "limit", "limit-files"], optionDefaults: { limit: 20 }, examples: ["cchistory query turns --search refactor --limit 5", "cchistory query turns --project chat-ui-kit"] },
  { path: ["query", "turn"], usage: "cchistory query turn --id <turn-id-or-prefix>", description: "Query one turn.", options: ["id", ...readOptions], examples: ["cchistory query turn --id abc123"] },
  { path: ["query", "sessions"], usage: "cchistory query sessions [--project <ref>] [--source <slot-or-id>] [--limit <n>]", description: "Query sessions.", options: ["project", "source", "limit", "limit-files"], optionDefaults: { limit: 20 }, examples: ["cchistory query sessions --limit 10", "cchistory query sessions --source codex"] },
  { path: ["query", "session"], usage: "cchistory query session --id <session-ref>", description: "Query one session.", options: ["id", ...readOptions], examples: ["cchistory query session --id <session-ref>"] },
  { path: ["query", "projects"], usage: "cchistory query projects [--source <slot-or-id>]", description: "Query projects.", options: readOptions, examples: ["cchistory query projects", "cchistory query projects --source codex"] },
  { path: ["query", "project"], usage: "cchistory query project --id <project-ref> [--source <slot-or-id>] [--link-state all|committed|candidate|unlinked]", description: "Query one project.", options: ["id", "link-state", ...readOptions], examples: ["cchistory query project --id chat-ui-kit", "cchistory query project --id chat-ui-kit --link-state committed"] },
  {
    path: ["templates"],
    category: "Advanced (experimental)",
    usage: "cchistory templates",
    summary: "List available query templates",
    description: "List source format profiles as JSON.",
    examples: ["cchistory templates", "cchistory templates > /tmp/profiles.json"],
  },
  {
    path: ["agent"],
    category: "Advanced (experimental)",
    usage: "cchistory agent pair|upload|schedule|pull ...",
    summary: "Remote agent synchronization",
    description: "Remote-agent workflows using canonical source probe and bundle upload paths.",
    children: ["pair", "upload", "schedule", "pull"],
    examples: ["cchistory agent pair --server https://history.example --pair-token <token>", "cchistory agent pull --state-file ~/.cchistory-agent/agent-state.json"],
  },
  { path: ["agent", "pair"], usage: "cchistory agent pair --server <url> --pair-token <token> [--state-file <file>]", description: "Pair this host with a remote service.", options: ["server", "pair-token", "state-file", "display-name", "reported-hostname"], examples: ["cchistory agent pair --server https://history.example --pair-token <token>", "cchistory agent pair --server https://history.example --pair-token <token> --display-name \"work-laptop\""] },
  { path: ["agent", "upload"], usage: "cchistory agent upload [--state-file <file>] [--source <slot-or-id>] [--force]", description: "Upload changed source payloads.", options: remoteUploadOptions, examples: ["cchistory agent upload", "cchistory agent upload --source codex --force"] },
  { path: ["agent", "schedule"], usage: "cchistory agent schedule --interval-seconds <n> [--iterations <n>]", description: "Run repeated local upload cycles.", options: [...remoteUploadOptions, "interval-seconds", "iterations"], examples: ["cchistory agent schedule --interval-seconds 300 --iterations 10"] },
  { path: ["agent", "pull"], usage: "cchistory agent pull [--state-file <file>]", description: "Lease one typed collection job and upload the result.", options: remoteUploadOptions, examples: ["cchistory agent pull", "cchistory agent pull --state-file ~/.cchistory-agent/agent-state.json"] },
  {
    path: ["tui"],
    category: "Interactive",
    usage: "cchistory tui [--store <dir>|--db <file>] [--search <query>] [--project <ref>|--session <ref>|--turn <ref>] [--full] [--source-health]",
    summary: "Launch terminal UI browser (projects -> sessions -> conversations)",
    description: "Launch the local terminal UI browser. Pass --project, --session, or --turn to land directly on a specific entity; the three flags are mutually exclusive.",
    options: ["search", "project", "session", "turn", "source", "limit-files", "source-health"],
    examples: [
      "cchistory tui",
      "cchistory tui --search refactor",
      "cchistory tui --project my-app",
      "cchistory tui --session 01H.../",
      "cchistory tui --turn 01H...",
      "cchistory tui --source-health",
    ],
  },
  {
    path: ["completions"],
    category: "Setup",
    usage: "cchistory completions <bash|zsh|fish>",
    summary: "Print a shell completion script for installation",
    description:
      "Print a completion script for the requested shell. Install by eval-ing the output (e.g. eval \"$(cchistory completions bash)\") or by saving the script to your shell's completion directory. The script encodes the full command tree, subcommand chains, and option flags known to this CLI build.",
    examples: [
      'eval "$(cchistory completions bash)"',
      'eval "$(cchistory completions zsh)"',
      "cchistory completions fish > ~/.config/fish/completions/cchistory.fish",
    ],
  },
  {
    path: ["resume"],
    category: "Start Here",
    usage: "cchistory resume <project-ref> [--tui]",
    summary: "Print a 'where was I' card for a project (optionally open it in the TUI)",
    description:
      "Resolve a project reference (id, slug, name, or workspace) and surface its latest session and turn. Pass --tui to launch the TUI directly at the latest turn — equivalent to `cchistory tui --turn <id>` but resolved from the project ref.",
    options: ["tui"],
    examples: [
      "cchistory resume my-app",
      "cchistory resume my-app --tui",
      "cchistory resume 01H...",
    ],
  },
  {
    path: ["last"],
    category: "Start Here",
    usage: "cchistory last [project-ref] [--tui]",
    summary: "Shortcut: resume the most recently active project (or the named one)",
    description:
      "Without a ref, picks the project with the most recent activity and runs `cchistory resume <ref>`. With a ref, equivalent to `cchistory resume <ref>`.",
    options: ["tui"],
    examples: [
      "cchistory last",
      "cchistory last my-app",
      "cchistory last --tui",
    ],
  },
  {
    path: ["today"],
    category: "Start Here",
    usage: "cchistory today [--by model|project|source|host|day|month]",
    summary: "Shortcut: stats filtered to today (or another window)",
    description:
      "Equivalent to `cchistory stats --today`. Pass --week, --month, or --since to override the window — the explicit flag wins.",
    options: ["by", "since", "week", "month", ...readOptions],
    examples: [
      "cchistory today",
      "cchistory today --by model",
      "cchistory today --week",
    ],
  },
];

const commandSpecsByKey = new Map(commandSpecs.map((spec) => [commandKey(spec.path), spec]));
const commandChildren = new Map<string, Set<string>>();
for (const spec of commandSpecs) {
  if (spec.path.length <= 1) continue;
  const parent = commandKey(spec.path.slice(0, -1));
  const entries = commandChildren.get(parent) ?? new Set<string>();
  entries.add(spec.path[spec.path.length - 1]!);
  commandChildren.set(parent, entries);
}

const allOptionSpecs: Record<string, OptionSpec> = { ...globalOptions, ...commandOptions };

export function parseCliArgs(args: string[]): ParsedCommand {
  const rawArgs = args[0] === "--" ? args.slice(1) : [...args];
  const nodeOptions = buildNodeOptionConfig();
  let parsed: ReturnType<typeof parseNodeArgs>;
  try {
    parsed = parseNodeArgs({
      args: rawArgs,
      options: nodeOptions,
      allowPositionals: true,
      allowNegative: true,
      strict: true,
      tokens: true,
    });
  } catch (error) {
    // node:util's parseArgs throws on unknown options, missing values, and
    // malformed tokens. All of these are usage errors from the operator's
    // perspective — surface them with exit code 2, not the default 1.
    throw usageError(error instanceof Error ? error.message : String(error));
  }
  const tokens = parsed.tokens ?? [];
  assertNoDuplicateSingletonOptions(tokens);
  const values = parsed.values as Record<string, string | string[] | boolean | undefined>;
  const positionals = [...parsed.positionals];

  const version = readBoolean(values, "version");
  const wantsHelp = readBoolean(values, "help") || positionals[0] === "help";
  const helpTarget = positionals[0] === "help" ? normalizeHelpTarget(positionals.slice(1)) : [];
  const commandPositionals = positionals[0] === "help" ? [] : positionals;
  const { commandPath, restPositionals } = resolveCommandPath(commandPositionals, wantsHelp ? helpTarget : undefined);
  const globals = normalizeGlobals(values);
  const options = normalizeCommandOptions(values);

  if (!wantsHelp && !version) {
    validateCommand(commandPath, tokens);
    validateGlobalCombinations(globals);
    assertNonInteractive(commandPath, globals, options);
    validateOptionChoices(commandPath, options);
    validateNumericRanges(options);
  } else if (wantsHelp && helpTarget.length > 0) {
    validateHelpTarget(helpTarget);
  }

  return {
    rawArgs,
    commandPath,
    positionals: restPositionals,
    globals,
    options,
    help: wantsHelp || commandPath.length === 0,
    helpTarget: wantsHelp ? (helpTarget.length > 0 ? helpTarget : commandPath) : [],
    version,
    noArgs: rawArgs.length === 0,
  };
}

export function renderHelp(targetPath: string[] = []): string {
  if (targetPath.length > 0) {
    return renderCommandHelp(targetPath);
  }
  return renderGlobalHelp();
}

/**
 * First-run-aware wrapper for the no-args case. If the store is missing,
 * prepend a welcome banner pointing the operator at `cchistory status` and
 * `cchistory sync`. Otherwise, prepend a one-line tip suggesting `status`.
 */
export function renderNoArgsHelp(storePresent: boolean): string {
  const banner = storePresent
    ? "Tip: run `cchistory status` for a quick snapshot of this store.\n"
    : [
        "Welcome to CCHistory. No store found yet.",
        "",
        "Get started:",
        "  1. Run `cchistory status` for an overview.",
        "  2. Run `cchistory sync` to ingest history from local AI coding tools (Claude Code, Codex, Cursor, AMP, ...).",
        "  3. Run `cchistory discover` to see which sources are detectable on this machine.",
        "",
      ].join("\n");
  return `${banner}\n${renderGlobalHelp()}`;
}

export function commandName(path: string[]): string {
  return path.join(" ");
}

function getCommandSpec(path: string[]): CommandSpec | undefined {
  return commandSpecsByKey.get(commandKey(path));
}

function buildNodeOptionConfig(): Record<string, { type: "boolean" | "string"; multiple?: boolean; short?: string; default?: boolean }> {
  const config: Record<string, { type: "boolean" | "string"; multiple?: boolean; short?: string; default?: boolean }> = {};
  for (const [name, spec] of Object.entries(allOptionSpecs)) {
    const entry: { type: "boolean" | "string"; multiple?: boolean; short?: string; default?: boolean } = {
      type: spec.kind === "boolean" ? "boolean" : "string",
    };
    if (spec.multiple) {
      entry.multiple = true;
    }
    if (spec.short) {
      entry.short = spec.short;
    }
    if (name === "color" || name === "raw") {
      entry.default = true;
    }
    config[name] = entry;
  }
  return config;
}

function normalizeGlobals(values: Record<string, string | string[] | boolean | undefined>): CliGlobals {
  const rawColor = values.color !== false;
  const agent = readBoolean(values, "agent");
  const nonInteractive = readBoolean(values, "non-interactive") || agent;
  // --agent forces JSON output and suppresses color so AI consumers get a
  // stable, parseable stream. --non-interactive on its own keeps the human
  // rendering — it only gates interactive surfaces.
  return {
    store: readString(values, "store"),
    db: readString(values, "db"),
    json: readBoolean(values, "json") || agent,
    long: readBoolean(values, "long"),
    full: readBoolean(values, "full"),
    index: readBoolean(values, "index"),
    dryRun: readBoolean(values, "dry-run"),
    showAll: readBoolean(values, "showall"),
    debug: readBoolean(values, "debug"),
    color: rawColor && !agent,
    verbose: readBoolean(values, "verbose"),
    nonInteractive,
    agent,
  };
}

function normalizeCommandOptions(values: Record<string, string | string[] | boolean | undefined>): CommandOptions {
  return {
    source: readStringArray(values, "source"),
    limit: readNumber(values, "limit"),
    offset: readNumber(values, "offset"),
    cursor: readString(values, "cursor"),
    all: readBoolean(values, "all"),
    limitFiles: readNumber(values, "limit-files"),
    since: readString(values, "since"),
    storeOnly: readBoolean(values, "store-only"),
    project: readString(values, "project"),
    by: readString(values, "by"),
    out: readString(values, "out"),
    write: readBoolean(values, "write"),
    noRaw: values.raw === false,
    onConflict: readString(values, "on-conflict"),
    from: readString(values, "from"),
    to: readString(values, "to"),
    id: readString(values, "id"),
    search: readString(values, "search"),
    linkState: readString(values, "link-state"),
    server: readString(values, "server"),
    pairToken: readString(values, "pair-token"),
    stateFile: readString(values, "state-file"),
    displayName: readString(values, "display-name"),
    reportedHostname: readString(values, "reported-hostname"),
    intervalSeconds: readNumber(values, "interval-seconds"),
    iterations: readNumber(values, "iterations"),
    force: readBoolean(values, "force"),
    retryAttempts: readNumber(values, "retry-attempts"),
    retryDelayMs: readNumber(values, "retry-delay-ms"),
    sourceHealth: readBoolean(values, "source-health"),
    detail: readBoolean(values, "detail"),
    progress: readString(values, "progress"),
    safe: readBoolean(values, "safe"),
    forceFullResync: readBoolean(values, "force-full-resync"),
    only: readStringArray(values, "only"),
    preBundle: readString(values, "pre-bundle"),
    phase: readString(values, "phase"),
    step: readString(values, "step"),
    confirmNoBackup: readBoolean(values, "confirm-no-backup"),
    tui: readBoolean(values, "tui"),
    session: readString(values, "session"),
    turn: readString(values, "turn"),
    today: readBoolean(values, "today"),
    week: readBoolean(values, "week"),
    month: readBoolean(values, "month"),
    merge: readBoolean(values, "merge"),
  };
}

function resolveCommandPath(
  positionals: string[],
  explicitHelpTarget?: string[],
): { commandPath: string[]; restPositionals: string[] } {
  if (explicitHelpTarget && explicitHelpTarget.length > 0) {
    return { commandPath: explicitHelpTarget, restPositionals: [] };
  }
  const [rawCommand, ...rest] = positionals;
  const command = normalizeCommand(rawCommand);
  if (!command) {
    return { commandPath: [], restPositionals: [] };
  }
  const basePath = [command];
  const children = commandChildren.get(commandKey(basePath));
  if (children && rest[0] && children.has(rest[0])) {
    return { commandPath: [command, rest[0]], restPositionals: rest.slice(1) };
  }
  return { commandPath: basePath, restPositionals: rest };
}

function normalizeCommand(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.toLowerCase().trim();
  if (normalized === "restore") {
    return "restore-check";
  }
  return normalized;
}

function normalizeHelpTarget(values: string[]): string[] {
  const [first, ...rest] = values;
  const normalized = normalizeCommand(first);
  return normalized ? [normalized, ...rest] : [];
}

function validateCommand(commandPath: string[], tokens: Array<{ kind: string; name?: string }>): void {
  if (commandPath.length === 0) {
    return;
  }
  const spec = getCommandSpec(commandPath);
  if (!spec) {
    throw usageError(unknownCommandMessage(commandPath));
  }
  const allowed = allowedOptionNamesForCommand(commandPath);
  for (const token of tokens) {
    if (token.kind !== "option" || !token.name) continue;
    if (GLOBAL_OPTION_NAMES.includes(token.name as (typeof GLOBAL_OPTION_NAMES)[number])) continue;
    if (!allowed.has(token.name)) {
      throw usageError(`Unknown option for \`${commandName(commandPath)}\`: --${token.name}`);
    }
  }
}

function unknownCommandMessage(commandPath: string[]): string {
  const typed = commandName(commandPath);
  const suggestion = suggestCommandHint(commandPath);
  return suggestion ? `Unknown command: ${typed}\n${suggestion}` : `Unknown command: ${typed}`;
}

/**
 * Build a "Did you mean" hint by Levenshtein distance against the relevant
 * candidate set: top-level command names if the typo is at position 0, or
 * the matching parent's children if the typo is at a deeper position.
 */
function suggestCommandHint(commandPath: string[]): string | null {
  if (commandPath.length === 0) return null;
  if (commandPath.length === 1) {
    const typed = commandPath[0]!;
    const candidates = commandSpecs
      .filter((spec) => spec.path.length === 1)
      .map((spec) => spec.path[0]!);
    const matches = closestMatches(typed, candidates);
    return formatSuggestions(matches);
  }
  // Multi-segment: the typo is likely the last segment. Find the parent's
  // known children and suggest from there.
  const parentPath = commandPath.slice(0, -1);
  const parent = getCommandSpec(parentPath);
  const typed = commandPath[commandPath.length - 1]!;
  const candidates = parent?.children ?? [];
  const matches = closestMatches(typed, candidates);
  return formatSuggestions(matches);
}

function formatSuggestions(matches: string[]): string | null {
  if (matches.length === 0) return null;
  return `Did you mean: ${matches.map((m) => `\`${m}\``).join(", ")}?`;
}

function closestMatches(target: string, candidates: string[], limit = 3): string[] {
  const lowerTarget = target.toLowerCase();
  return candidates
    .map((candidate) => {
      const lower = candidate.toLowerCase();
      const distance = levenshtein(lowerTarget, lower);
      const prefixMatch = lower.startsWith(lowerTarget) && lowerTarget.length > 0;
      return { candidate, distance, prefixMatch };
    })
    .filter((entry) => entry.distance <= 2 || (entry.prefixMatch && entry.distance <= 3))
    .sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      // Prefer prefix matches when distance ties
      return Number(b.prefixMatch) - Number(a.prefixMatch);
    })
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

/** Iterative Levenshtein with two rolling rows. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) previous[j] = j;
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      current[j] = Math.min(
        previous[j]! + 1,        // deletion
        current[j - 1]! + 1,     // insertion
        previous[j - 1]! + cost, // substitution
      );
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length]!;
}

function validateHelpTarget(path: string[]): void {
  if (path.length === 0) {
    return;
  }
  if (!getCommandSpec(path)) {
    const suggestion = suggestCommandHint(path);
    const base = `Unknown help topic: ${commandName(path)}`;
    throw usageError(suggestion ? `${base}\n${suggestion}` : base);
  }
}

function allowedOptionNamesForCommand(path: string[]): Set<string> {
  const names = new Set<string>();
  for (let index = 1; index <= path.length; index += 1) {
    const spec = getCommandSpec(path.slice(0, index));
    for (const name of spec?.options ?? []) {
      names.add(name);
    }
  }
  return names;
}

function validateOptionChoices(path: string[], options: CommandOptions): void {
  validateChoice("by", options.by);
  validateChoice("on-conflict", options.onConflict, commandOptionsForValidation(path));
  validateChoice("link-state", options.linkState);
  validateChoice("progress", options.progress);
}

function commandOptionsForValidation(path: string[]): Record<string, OptionSpec> {
  return commandOptionsForHelp(path);
}

function validateGlobalCombinations(globals: CliGlobals): void {
  if (globals.full && globals.index) {
    throw usageError("Choose either --full or --index, not both.");
  }
}

/**
 * Command-specific gate run after the global validation pass. Used by the
 * TUI launch path to refuse entry under --non-interactive / --agent so an
 * automation context can never accidentally hang on a fullscreen prompt.
 *
 * Also guards the indirect TUI launch paths: `resume --tui` and `last --tui`
 * synthesize a `["tui"]` context and re-dispatch through `handleTui`, so they
 * must be refused at parse time for the same reason.
 */
export function assertNonInteractive(
  commandPath: string[],
  globals: CliGlobals,
  options: { tui?: boolean },
): void {
  if (!globals.nonInteractive) return;
  const root = commandPath[0];
  const launchesTui = root === "tui"
    || ((root === "resume" || root === "last") && options.tui === true);
  if (launchesTui) {
    throw usageError(
      "Refusing to launch the TUI under --non-interactive. Run without the flag, or use a read command (`ls`, `show`, `query`, `search`) for non-interactive inspection.",
    );
  }
}

/**
 * Public read-only view of the command tree, for shell completion generators.
 * Returns a deep-frozen snapshot so callers can iterate without fearing
 * mutation. Each entry includes the path, the option names declared on the
 * spec (option-level metadata stays internal), and the spec's category.
 */
export interface CompletionCommandInfo {
  path: string[];
  options: string[];
  category?: string;
}

export function listCommandsForCompletion(): CompletionCommandInfo[] {
  return commandSpecs.map((spec) => ({
    path: [...spec.path],
    options: [...(spec.options ?? [])],
    category: spec.category,
  }));
}

export function listGlobalOptionNamesForCompletion(): string[] {
  return [...GLOBAL_OPTION_NAMES];
}

function validateNumericRanges(options: CommandOptions): void {
  validatePositiveInteger("limit", options.limit);
  validateNonNegativeInteger("offset", options.offset);
  validatePositiveInteger("limit-files", options.limitFiles);
  validatePositiveInteger("interval-seconds", options.intervalSeconds);
  validatePositiveInteger("iterations", options.iterations);
  validateNonNegativeInteger("retry-attempts", options.retryAttempts);
  validateNonNegativeInteger("retry-delay-ms", options.retryDelayMs);
}

function validatePositiveInteger(name: string, value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 1) {
    throw usageError(`Invalid value for --${name}: ${value}. Expected a positive integer.`);
  }
}

function validateNonNegativeInteger(name: string, value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0) {
    throw usageError(`Invalid value for --${name}: ${value}. Expected a non-negative integer.`);
  }
}

function validateChoice(name: string, value: string | undefined, specs: Record<string, OptionSpec> = commandOptions): void {
  if (!value) return;
  const spec = specs[name];
  if (!spec?.choices) return;
  if (!spec.choices.includes(value)) {
    throw usageError(`Invalid value for --${name}: ${value}. Expected one of ${spec.choices.join(", ")}.`);
  }
}

function assertNoDuplicateSingletonOptions(tokens: Array<{ kind: string; name?: string }>): void {
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== "option" || !token.name) continue;
    const spec = allOptionSpecs[token.name];
    if (!spec || spec.multiple) continue;
    if (seen.has(token.name)) {
      throw usageError(`Option --${token.name} can only be provided once.`);
    }
    seen.add(token.name);
  }
}

function renderGlobalHelp(): string {
  const commandGroups = groupTopLevelCommands();
  const lines = [
    "Usage: cchistory <command> [options]",
    "",
    "Examples:",
    "  cchistory sync",
    "  cchistory search <query>",
    "",
    "CCHistory - Evidence-preserving history for AI coding assistants",
    "",
  ];
  for (const [category, specs] of commandGroups) {
    lines.push(`${category}:`);
    for (const spec of specs) {
      lines.push(`  ${formatCommandSummary(spec)}`);
      if (spec.path[0] === "search") {
        lines.push("    --limit <n>                        Max results (default 50)");
        lines.push("    --offset <n>                       Skip first N results for pagination");
        lines.push("    --all                              Return all matches (up to 1000)");
      }
      if (spec.path[0] === "context") {
        lines.push("    --limit <n>                        Max recent asks/sessions for context (default 12)");
      }
      if (spec.path[0] === "stats") {
        lines.push("    --by <dimension>                   Roll up token usage by model, project, source, host, day, or month");
      }
    }
    lines.push("");
  }
  lines.push("Global flags:");
  const globalFlagNames = ["store", "db", "json", "long", "full", "index", "dry-run", "showall", "non-interactive", "agent"] as const;
  const globalFlagWidth = optionUsageWidth(globalFlagNames, globalOptions);
  for (const name of globalFlagNames) {
    lines.push(`  ${formatOptionUsage(name, globalOptions[name], globalFlagWidth)}`);
  }
  lines.push("");
  lines.push("Automation: pass --non-interactive (CI) or --agent (AI agents; implies --json + --no-color + --non-interactive).");
  lines.push("Stdin: use `-` as a string positional or string option value to read from stdin — e.g. `echo $ref | cchistory show turn -`. (Numeric options like --limit reject `-`; their parse runs before stdin substitution.)");
  lines.push("Store resolution: ~/.cchistory by default; use --store or --db to pin another location");
  lines.push("Run `cchistory help <command>` for command-specific options and examples.");
  return lines.join("\n");
}

function renderCommandHelp(path: string[]): string {
  const spec = getCommandSpec(path);
  if (!spec) {
    throw usageError(`Unknown help topic: ${commandName(path)}`);
  }
  const descriptionSuffix = spec.aliasOf ? ` (alias of ${spec.aliasOf})` : "";
  const lines = [
    `Usage: ${spec.usage}`,
    "",
    `${spec.description}${descriptionSuffix}`,
  ];
  const childNames = spec.children ?? [];
  if (childNames.length > 0) {
    lines.push("", "Commands:");
    for (const childName of childNames) {
      const child = getCommandSpec([...path, childName]);
      if (!child) continue;
      lines.push(`  ${childName.padEnd(12)} ${child.description}`);
    }
  }
  const localOptions = [...allowedOptionNamesForCommand(path)]
    .filter((name) => commandOptions[name])
    .sort((left, right) => left.localeCompare(right));
  if (localOptions.length > 0) {
    lines.push("", "Command options:");
    const commandOptionSpecs = commandOptionsForHelp(path);
    const localOptionWidth = optionUsageWidth(localOptions, commandOptionSpecs);
    for (const name of localOptions) {
      const specForName = commandOptionSpecs[name]!;
      const overridden =
        spec.optionDefaults && spec.optionDefaults[name] !== undefined
          ? { ...specForName, description: `${specForName.description} (default ${spec.optionDefaults[name]})` }
          : specForName;
      lines.push(`  ${formatOptionUsage(name, overridden, localOptionWidth)}`);
    }
  }
  lines.push("", "Global flags:");
  const globalFlagNames = globalFlagsForCommand(path);
  const globalFlagWidth = optionUsageWidth(globalFlagNames, globalOptions);
  for (const name of globalFlagNames) {
    lines.push(`  ${formatOptionUsage(name, globalOptions[name]!, globalFlagWidth)}`);
  }
  if (spec.examples && spec.examples.length > 0) {
    lines.push("", "Examples:");
    for (const example of spec.examples) {
      lines.push(`  ${example}`);
    }
  }
  return lines.join("\n");
}

function groupTopLevelCommands(): Map<string, CommandSpec[]> {
  const groups = new Map<string, CommandSpec[]>();
  for (const spec of commandSpecs.filter((entry) => entry.path.length === 1 && entry.category)) {
    const entries = groups.get(spec.category!) ?? [];
    entries.push(spec);
    groups.set(spec.category!, entries);
  }
  return groups;
}

function formatCommandSummary(spec: CommandSpec): string {
  const command = spec.usage.replace(/^cchistory\s+/u, "").replace(/\s+\[.*$/u, "");
  const aliasTag = spec.aliasOf ? ` (alias of ${spec.aliasOf})` : "";
  return `${command.padEnd(36)} ${spec.summary ?? spec.description}${aliasTag}`;
}

function commandOptionsForHelp(path: string[]): Record<string, OptionSpec> {
  if (commandName(path) !== "merge") {
    return commandOptions;
  }
  return {
    ...commandOptions,
    "on-conflict": {
      ...commandOptions["on-conflict"]!,
      choices: ["skip", "replace"],
    },
  };
}

function formatOptionUsage(name: string, spec: OptionSpec, labelWidth = 18): string {
  const label = formatOptionLabel(name, spec);
  return `${label.padEnd(labelWidth)} ${formatOptionDescription(spec)}`;
}

function formatOptionLabel(name: string, spec: OptionSpec): string {
  const renderedName = name === "raw" ? "--no-raw" : name === "color" ? "--no-color" : `--${name}`;
  const value = spec.kind === "boolean" ? "" : ` <${spec.valueName ?? "value"}>`;
  return `${renderedName}${value}`;
}

function formatOptionDescription(spec: OptionSpec): string {
  const choices = spec.choices && spec.choices.length > 0 ? ` One of: ${spec.choices.join(", ")}.` : "";
  const description = choices.length > 0 && !/[.!?]$/u.test(spec.description)
    ? `${spec.description}.`
    : spec.description;
  return `${description}${choices}`;
}

function optionUsageWidth<T extends string>(names: readonly T[], specs: Record<T, OptionSpec>): number {
  return Math.max(18, ...names.map((name) => formatOptionLabel(name, specs[name]).length));
}

function readBoolean(values: Record<string, string | string[] | boolean | undefined>, key: string): boolean {
  return values[key] === true;
}

function readString(values: Record<string, string | string[] | boolean | undefined>, key: string): string | undefined {
  const value = values[key];
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function readStringArray(values: Record<string, string | string[] | boolean | undefined>, key: string): string[] {
  const value = values[key];
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    return [value];
  }
  return [];
}

function readNumber(values: Record<string, string | string[] | boolean | undefined>, key: string): number | undefined {
  const value = readString(values, key);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw usageError(`Invalid numeric value for --${key}: ${value}`);
  }
  return parsed;
}

function commandKey(path: string[]): string {
  return path.join(" ");
}
