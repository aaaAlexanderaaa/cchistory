export interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string[]>;
}

export function parseArgs(args: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  let forcePositionals = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }
    if (token === "--") {
      if (index === 0) {
        continue;
      }
      forcePositionals = true;
      continue;
    }
    if (forcePositionals || !token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const body = token.slice(2);
    const separatorIndex = body.indexOf("=");
    const key = separatorIndex >= 0 ? body.slice(0, separatorIndex) : body;
    const inlineValue = separatorIndex >= 0 ? body.slice(separatorIndex + 1) : undefined;
    let value = inlineValue;
    if (value === undefined) {
      const next = args[index + 1];
      if (next && !next.startsWith("--")) {
        value = next;
        index += 1;
      } else {
        value = "true";
      }
    }
    flags.set(key, [...(flags.get(key) ?? []), value]);
  }
  return { positionals, flags };
}

export function getFlag(parsed: ParsedArgs, key: string): string | undefined {
  return parsed.flags.get(key)?.[0];
}

export function getFlagValues(parsed: ParsedArgs, key: string): string[] {
  return parsed.flags.get(key) ?? [];
}

export function hasFlag(parsed: ParsedArgs, key: string): boolean {
  return parsed.flags.has(key);
}

export function requireFlag(parsed: ParsedArgs, key: string): string {
  const value = getFlag(parsed, key);
  if (!value || value === "true") {
    throw new Error(`Missing required --${key} flag.`);
  }
  return value;
}

export function parseNumberFlag(parsed: ParsedArgs, key: string): number | undefined {
  const value = getFlag(parsed, key);
  if (!value || value === "true") {
    return undefined;
  }
  const parsedNumber = Number(value);
  if (!Number.isFinite(parsedNumber)) {
    throw new Error(`Invalid numeric value for --${key}: ${value}`);
  }
  return parsedNumber;
}

export function renderHelp(): string {
  return [
    "Usage: cchistory <command> [options]",
    "",
    "Examples:",
    "  cchistory sync",
    "  cchistory search <query>",
    "",
    "CCHistory — Evidence-preserving history for AI coding assistants",
    "",
    "Browse & Inspect:",
    "  ls projects|sessions|sources       List entities (--long for detail, --all for full list)",
    "  tree projects|project|session <ref> Hierarchical view",
    "  show project|session|turn|source    Detail view of a single entity",
    "  search <query>                      Full-text search across turns",
    "    --limit <n>                        Max results (default 50)",
    "    --offset <n>                       Skip first N results for pagination",
    "    --all                              Return all matches (up to 1000)",
    "  stats [usage --by <dimension>]      Token usage statistics",
    "",
    "Data Management:",
    "  sync             Ingest data from local AI tool directories",
    "  discover         Scan this host for supported AI tools",
    "  health           Source health and store integrity check",
    "  gc               Clean orphaned raw snapshots (--dry-run to preview)",
    "",
    "Backup & Transfer:",
    "  export --out <dir>                  Export store to a portable bundle",
    "  import <bundle-dir>                 Import a previously exported bundle",
    "  backup --out <dir>                  Preview-first export (--write to execute)",
    "  restore-check                       Validate a store can be restored",
    "  merge --from <db> --to <db>         Merge two stores via bundle exchange",
    "",
    "Interactive:",
    "  tui              Launch terminal UI browser (projects → sessions → conversations)",
    "",
    "Advanced (experimental):",
    "  agent pair|upload|schedule|pull     Remote agent synchronization",
    "  query <entity>                      Scriptable JSON-only interface",
    "  templates                           List available query templates",
    "",
    "Global flags:",
    "  --store <dir>    Store directory (db at <dir>/cchistory.sqlite)",
    "  --db <file>      Explicit SQLite path; sidecar data lives beside it",
    "  --json           Machine-readable JSON output",
    "  --long           Expanded metadata and hierarchy detail",
    "  --full           Re-scan source roots into temporary in-memory store",
    "  --dry-run        Preview actions without writing",
    "  --showall        Include empty/missing items in listings",
    "",
    "Store resolution: nearest .cchistory/ in cwd or ancestors; fallback ~/.cchistory",
  ].join("\n");
}
