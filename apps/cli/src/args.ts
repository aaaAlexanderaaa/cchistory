import { parseArgs as parseNodeArgs } from "node:util";

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
}

export interface CommandOptions {
  source: string[];
  limit?: number;
  offset?: number;
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
  only: string[];
  preBundle?: string;
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
};

const readOptions = ["source", "limit-files"];
const remoteUploadOptions = ["state-file", "source", "limit-files", "raw", "force", "retry-attempts", "retry-delay-ms"];

const commandSpecs: CommandSpec[] = [
  {
    path: ["sync"],
    category: "Data Management",
    usage: "cchistory sync [--source <slot-or-id>] [--limit-files <n>] [--since <time>] [--detail] [--safe] [--dry-run]",
    summary: "Ingest data from local AI tool directories",
    description: "Ingest local source files into the selected store.",
    options: ["source", "limit-files", "since", "detail", "progress", "safe"],
    examples: ["cchistory sync", "cchistory sync --source codex --detail", "cchistory sync --source claude_code --since 7d"],
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
    usage: "cchistory ls projects|sessions|sources [--long] [--all] [--limit <n>]",
    summary: "List entities; projects include copyable Ref",
    description: "Browse projects, sessions, or sources.",
    children: ["projects", "sessions", "sources"],
    options: ["all", "limit", ...readOptions],
    examples: ["cchistory ls projects", "cchistory ls sessions --long", "cchistory ls sources"],
  },
  {
    path: ["ls", "projects"],
    usage: "cchistory ls projects [--long] [--showall]",
    description: "List projects with copyable refs.",
    options: readOptions,
  },
  {
    path: ["ls", "sessions"],
    usage: "cchistory ls sessions [--long] [--all] [--limit <n>]",
    description: "List sessions with compact default output.",
    options: ["all", "limit", ...readOptions],
  },
  {
    path: ["ls", "sources"],
    usage: "cchistory ls sources",
    description: "List configured sources.",
    options: readOptions,
  },
  {
    path: ["tree"],
    category: "Browse & Inspect",
    usage: "cchistory tree projects|project|session <ref> [--long]",
    summary: "Hierarchical view",
    description: "Show project or session hierarchy.",
    children: ["projects", "project", "session"],
    options: readOptions,
    examples: ["cchistory tree projects", "cchistory tree project chat-ui-kit", "cchistory tree session <session-ref> --long"],
  },
  { path: ["tree", "projects"], usage: "cchistory tree projects [--long]", description: "Show all projects as a hierarchy.", options: readOptions },
  { path: ["tree", "project"], usage: "cchistory tree project <project-ref> [--long]", description: "Show one project with session threads.", options: readOptions },
  { path: ["tree", "session"], usage: "cchistory tree session <session-ref> [--long]", description: "Show one session hierarchy.", options: readOptions },
  {
    path: ["show"],
    category: "Browse & Inspect",
    usage: "cchistory show project|session|turn|source <ref> [--long]",
    summary: "Detail view of a single entity",
    description: "Show a project, session, turn, or source.",
    children: ["project", "session", "turn", "source"],
    options: readOptions,
    examples: ["cchistory show project chat-ui-kit", "cchistory show turn <turn-id-or-prefix> --long"],
  },
  { path: ["show", "project"], usage: "cchistory show project <project-ref> [--long]", description: "Show project detail.", options: readOptions },
  { path: ["show", "session"], usage: "cchistory show session <session-ref> [--long]", description: "Show session detail.", options: readOptions },
  { path: ["show", "turn"], usage: "cchistory show turn <turn-id-or-prefix> [--long]", description: "Show ask and response detail.", options: readOptions },
  { path: ["show", "source"], usage: "cchistory show source <source-ref>", description: "Show source detail.", options: readOptions },
  {
    path: ["search"],
    category: "Browse & Inspect",
    usage: "cchistory search <query> [--project <ref>] [--source <slot-or-id>] [--limit <n>] [--offset <n>] [--all]",
    summary: "Full-text search across asks",
    description: "Search canonical ask text and print drill-down pivots.",
    options: ["project", "source", "limit", "offset", "all", "limit-files"],
    examples: ["cchistory search \"data security\"", "cchistory search refactor --project chat-ui-kit"],
  },
  {
    path: ["context"],
    category: "Browse & Inspect",
    usage: "cchistory context project <ref> [--limit <n>] [--json]",
    summary: "AI-ready project context packet (ref/name/path)",
    description: "Build a project-scoped context packet for operators and AI agents.",
    children: ["project"],
    options: ["limit", ...readOptions],
    examples: ["cchistory context project chat-ui-kit", "cchistory context project chat-ui-kit --json"],
  },
  { path: ["context", "project"], usage: "cchistory context project <ref> [--limit <n>] [--json]", description: "Show project context.", options: ["limit", ...readOptions] },
  {
    path: ["stats"],
    category: "Browse & Inspect",
    usage: "cchistory stats [--by model|project|source|host|day|month]",
    summary: "Token usage statistics",
    description: "Show the store overview; add --by to roll up token usage.",
    children: ["usage"],
    options: ["by", ...readOptions],
    examples: ["cchistory stats", "cchistory stats --by model", "cchistory stats --by project", "cchistory stats usage --by day"],
  },
  {
    path: ["stats", "usage"],
    usage: "cchistory stats usage --by model|project|source|host|day|month",
    description: "Show token usage grouped by model, project, source, host, day, or month.",
    options: ["by", ...readOptions],
    examples: ["cchistory stats usage --by model", "cchistory stats usage --by source", "cchistory stats usage --by month"],
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
    examples: ["cchistory backup --out ./my-backup", "cchistory backup --out ./my-backup --write"],
  },
  {
    path: ["restore-check"],
    category: "Backup & Transfer",
    usage: "cchistory restore-check --store <dir>|--db <file>",
    summary: "Validate a store can be restored",
    description: "Read-only post-restore verification.",
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
    examples: ["cchistory merge --from /host-a/.cchistory --to /host-b/.cchistory", "cchistory merge --from /host-a/.cchistory --to /host-b/.cchistory --write"],
  },
  {
    path: ["gc"],
    category: "Data Management",
    usage: "cchistory gc [--dry-run]",
    summary: "Clean orphaned raw snapshots (--dry-run to preview)",
    description: "Prune raw snapshot files no longer referenced by the current SQLite index.",
    examples: ["cchistory gc --dry-run"],
  },
  {
    path: ["maintenance"],
    category: "Data Management",
    usage: "cchistory maintenance rebuild-search-index|gc-evidence|checkpoint|vacuum",
    summary: "Operator maintenance commands",
    description:
      "Low-frequency operator commands for the V1+V2 storage boundary. Use these to reclaim space after Phase A landed: rebuild the FTS5 search index (A.1), prune orphaned V2 evidence blobs (A.2), checkpoint the WAL (A.4), or VACUUM the SQLite file into the new 16 KiB page size (A.4).",
    children: ["rebuild-search-index", "gc-evidence", "checkpoint", "vacuum"],
    examples: [
      "cchistory maintenance rebuild-search-index",
      "cchistory maintenance gc-evidence",
      "cchistory maintenance checkpoint",
      "cchistory maintenance vacuum",
    ],
  },
  {
    path: ["maintenance", "rebuild-search-index"],
    usage: "cchistory maintenance rebuild-search-index",
    description:
      "Repopulate the FTS5 search_index table from current user_turns rows. After Phase A.1 the refresh hot path no longer maintains FTS5; this is the explicit operator hook. Has no effect on the scan-path search, which reads user_turns directly.",
  },
  {
    path: ["maintenance", "gc-evidence"],
    usage: "cchistory maintenance gc-evidence",
    description:
      "Drop evidence_blobs rows whose sha is no longer referenced from evidence_captures or parsed_record_spans, and unlink the corresponding content-addressed files. Use this to reclaim space accumulated before Phase A.2 wired evidence GC into the purge paths.",
  },
  {
    path: ["maintenance", "checkpoint"],
    usage: "cchistory maintenance checkpoint",
    description:
      "Run PRAGMA wal_checkpoint(TRUNCATE) to fold the WAL into the main SQLite file and truncate the WAL. Useful between long-running sync batches to bound on-disk footprint.",
  },
  {
    path: ["maintenance", "vacuum"],
    usage: "cchistory maintenance vacuum",
    description:
      "Run VACUUM to rebuild the SQLite file. Required once per store to materialize the new 16 KiB page size from Phase A.4; otherwise the pragma is silently ignored on existing databases. Blocks writes for the duration.",
  },
  {
    path: ["migration"],
    category: "Data Management",
    usage: "cchistory migration preview|run|status|validate",
    summary: "Storage boundary V1→V2 migration (B.1-B.6)",
    description:
      "Phase B storage-boundary migration tooling. `preview` is read-only and reports the V1→V2 backfill gap, removable bytes, and VACUUM disk requirement. `run` performs the per-source V2 backfill (B.3) — V1 payloads are not touched. `status` prints migration_state markers. `validate` runs the three B.4 validators (bundle byte-diff, inventory diff, read-path parity).",
    children: ["preview", "run", "status", "validate"],
    examples: [
      "cchistory migration preview",
      "cchistory migration run --dry-run",
      "cchistory migration run --source src-1",
      "cchistory migration status",
      "cchistory migration validate --pre-bundle ./pre-migration-bundle",
      "cchistory migration validate --only inventory",
    ],
  },
  {
    path: ["migration", "preview"],
    usage: "cchistory migration preview [--store <dir>|--db <file>] [--json]",
    description:
      "Read-only. Inspect V1→V2 row mapping, backfill gap, removable V1 payload_json bytes, and the VACUUM disk-space requirement.",
  },
  {
    path: ["migration", "run"],
    usage: "cchistory migration run [--source <slot-or-id>] [--dry-run] [--store <dir>|--db <file>]",
    description:
      "B.3: per-source V1→V2 backfill. Reads the V1 view of each source and re-runs the canonical V2 write path so missing V2 sidecars are filled. Idempotent: sources already marked completed in migration_state are skipped. V1 payloads are never touched. Halts at the first source that aborts; clear with `cchistory migration reset` after auditing.",
    options: ["source"],
  },
  {
    path: ["migration", "status"],
    usage: "cchistory migration status [--store <dir>|--db <file>] [--json]",
    description:
      "Print migration_state markers: per-source status (running/completed/aborted) for the storage-boundary.write phase.",
  },
  {
    path: ["migration", "validate"],
    usage:
      "cchistory migration validate [--only bundle|inventory|read-paths]... [--pre-bundle <dir>] [--store <dir>|--db <file>]",
    description:
      "B.4: post-B.3 validators. Three independent checks prove the V2 sidecars B.3 wrote are equivalent to V1: (a) bundle byte-diff against a pre-migration bundle (--pre-bundle, required when --only bundle is selected); (b) inventory row-count parity across the four V1↔V2 pairs; (c) read-path parity — deepEqual getTurnContext V1 vs V2 cache across every turn. All three run by default; each writes its own migration_state marker.",
    options: ["only", "pre-bundle"],
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
  { path: ["query", "turns"], usage: "cchistory query turns [--search <query>] [--project <ref>] [--source <slot-or-id>] [--limit <n>]", description: "Query turns.", options: ["search", "project", "source", "limit", "limit-files"] },
  { path: ["query", "turn"], usage: "cchistory query turn --id <turn-id-or-prefix>", description: "Query one turn.", options: ["id", ...readOptions] },
  { path: ["query", "sessions"], usage: "cchistory query sessions [--project <ref>] [--source <slot-or-id>] [--limit <n>]", description: "Query sessions.", options: ["project", "source", "limit", "limit-files"] },
  { path: ["query", "session"], usage: "cchistory query session --id <session-ref>", description: "Query one session.", options: ["id", ...readOptions] },
  { path: ["query", "projects"], usage: "cchistory query projects [--source <slot-or-id>]", description: "Query projects.", options: readOptions },
  { path: ["query", "project"], usage: "cchistory query project --id <project-ref> [--source <slot-or-id>] [--link-state all|committed|candidate|unlinked]", description: "Query one project.", options: ["id", "link-state", ...readOptions] },
  {
    path: ["templates"],
    category: "Advanced (experimental)",
    usage: "cchistory templates",
    summary: "List available query templates",
    description: "List source format profiles as JSON.",
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
  { path: ["agent", "pair"], usage: "cchistory agent pair --server <url> --pair-token <token> [--state-file <file>]", description: "Pair this host with a remote service.", options: ["server", "pair-token", "state-file", "display-name", "reported-hostname"] },
  { path: ["agent", "upload"], usage: "cchistory agent upload [--state-file <file>] [--source <slot-or-id>] [--force]", description: "Upload changed source payloads.", options: remoteUploadOptions },
  { path: ["agent", "schedule"], usage: "cchistory agent schedule --interval-seconds <n> [--iterations <n>]", description: "Run repeated local upload cycles.", options: [...remoteUploadOptions, "interval-seconds", "iterations"] },
  { path: ["agent", "pull"], usage: "cchistory agent pull [--state-file <file>]", description: "Lease one typed collection job and upload the result.", options: remoteUploadOptions },
  {
    path: ["tui"],
    category: "Interactive",
    usage: "cchistory tui [--store <dir>|--db <file>] [--search <query>] [--full] [--source-health]",
    summary: "Launch terminal UI browser (projects -> sessions -> conversations)",
    description: "Launch the local terminal UI browser.",
    options: ["search", "source", "limit-files", "source-health"],
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
  const parsed = parseNodeArgs({
    args: rawArgs,
    options: nodeOptions,
    allowPositionals: true,
    allowNegative: true,
    strict: true,
    tokens: true,
  });
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
  };
}

export function renderHelp(targetPath: string[] = []): string {
  if (targetPath.length > 0) {
    return renderCommandHelp(targetPath);
  }
  return renderGlobalHelp();
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
  return {
    store: readString(values, "store"),
    db: readString(values, "db"),
    json: readBoolean(values, "json"),
    long: readBoolean(values, "long"),
    full: readBoolean(values, "full"),
    index: readBoolean(values, "index"),
    dryRun: readBoolean(values, "dry-run"),
    showAll: readBoolean(values, "showall"),
    debug: readBoolean(values, "debug"),
    color: values.color !== false,
    verbose: readBoolean(values, "verbose"),
  };
}

function normalizeCommandOptions(values: Record<string, string | string[] | boolean | undefined>): CommandOptions {
  return {
    source: readStringArray(values, "source"),
    limit: readNumber(values, "limit"),
    offset: readNumber(values, "offset"),
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
    only: readStringArray(values, "only"),
    preBundle: readString(values, "pre-bundle"),
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
    throw new Error(`Unknown command: ${commandName(commandPath)}`);
  }
  const allowed = allowedOptionNamesForCommand(commandPath);
  for (const token of tokens) {
    if (token.kind !== "option" || !token.name) continue;
    if (GLOBAL_OPTION_NAMES.includes(token.name as (typeof GLOBAL_OPTION_NAMES)[number])) continue;
    if (!allowed.has(token.name)) {
      throw new Error(`Unknown option for \`${commandName(commandPath)}\`: --${token.name}`);
    }
  }
}

function validateHelpTarget(path: string[]): void {
  if (path.length === 0) {
    return;
  }
  if (!getCommandSpec(path)) {
    throw new Error(`Unknown help topic: ${commandName(path)}`);
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
    throw new Error("Choose either --full or --index, not both.");
  }
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
    throw new Error(`Invalid value for --${name}: ${value}. Expected a positive integer.`);
  }
}

function validateNonNegativeInteger(name: string, value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid value for --${name}: ${value}. Expected a non-negative integer.`);
  }
}

function validateChoice(name: string, value: string | undefined, specs: Record<string, OptionSpec> = commandOptions): void {
  if (!value) return;
  const spec = specs[name];
  if (!spec?.choices) return;
  if (!spec.choices.includes(value)) {
    throw new Error(`Invalid value for --${name}: ${value}. Expected one of ${spec.choices.join(", ")}.`);
  }
}

function assertNoDuplicateSingletonOptions(tokens: Array<{ kind: string; name?: string }>): void {
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== "option" || !token.name) continue;
    const spec = allOptionSpecs[token.name];
    if (!spec || spec.multiple) continue;
    if (seen.has(token.name)) {
      throw new Error(`Option --${token.name} can only be provided once.`);
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
        lines.push("    --limit <n>                        Max recent asks/sessions for context");
      }
      if (spec.path[0] === "stats") {
        lines.push("    --by <dimension>                   Roll up token usage by model, project, source, host, day, or month");
      }
    }
    lines.push("");
  }
  lines.push("Global flags:");
  const globalFlagNames = ["store", "db", "json", "long", "full", "index", "dry-run", "showall"] as const;
  const globalFlagWidth = optionUsageWidth(globalFlagNames, globalOptions);
  for (const name of globalFlagNames) {
    lines.push(`  ${formatOptionUsage(name, globalOptions[name], globalFlagWidth)}`);
  }
  lines.push("");
  lines.push("Store resolution: ~/.cchistory by default; use --store or --db to pin another location");
  lines.push("Run `cchistory help <command>` for command-specific options and examples.");
  return lines.join("\n");
}

function renderCommandHelp(path: string[]): string {
  const spec = getCommandSpec(path);
  if (!spec) {
    throw new Error(`Unknown help topic: ${commandName(path)}`);
  }
  const lines = [
    `Usage: ${spec.usage}`,
    "",
    spec.description,
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
      lines.push(`  ${formatOptionUsage(name, commandOptionSpecs[name]!, localOptionWidth)}`);
    }
  }
  lines.push("", "Global flags:");
  const globalFlagNames = ["store", "db", "json", "long", "full", "index", "dry-run", "showall", "debug", "color"] as const;
  const globalFlagWidth = optionUsageWidth(globalFlagNames, globalOptions);
  for (const name of globalFlagNames) {
    lines.push(`  ${formatOptionUsage(name, globalOptions[name], globalFlagWidth)}`);
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
  return `${command.padEnd(36)} ${spec.summary ?? spec.description}`;
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
    throw new Error(`Invalid numeric value for --${key}: ${value}`);
  }
  return parsed;
}

function commandKey(path: string[]): string {
  return path.join(" ");
}
