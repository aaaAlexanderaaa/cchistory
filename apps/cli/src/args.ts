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
    "Usage:",
    "  cchistory sync [--store <dir> | --db <file>] [--source <slot-or-id>] [--limit-files <n>] [--dry-run]",
    "  cchistory discover [--showall]",
    "  cchistory health [--store <dir> | --db <file>] [--source <slot-or-id>] [--index | --full] [--store-only] [--limit-files <n>] [--showall]",
    "  cchistory ls projects|sessions|sources [--store <dir> | --db <file>] [--index | --full] [--showall] [--long]",
    "  cchistory tree projects [--store <dir> | --db <file>] [--index | --full] [--showall] [--long]",
    "  cchistory tree project <project-id-or-slug> [--store <dir> | --db <file>] [--index | --full] [--long]",
    "  cchistory tree session <session-ref> [--store <dir> | --db <file>] [--index | --full] [--long]",
    "  cchistory show project|session|turn|source <ref> [--store <dir> | --db <file>] [--index | --full]",
    "    turn refs accept full IDs or unique shown prefixes",
    "  cchistory search <query> [--store <dir> | --db <file>] [--index | --full] [--project <project>] [--source <source>] [--limit <n>]",
    "  cchistory stats [--store <dir> | --db <file>] [--index | --full]",
    "  cchistory stats usage --by model|project|source|host|day|month [--store <dir> | --db <file>] [--index | --full]",
    "  cchistory export --out <bundle-dir> [--store <dir> | --db <file>] [--source <source>] [--no-raw] [--dry-run]",
    "  cchistory backup --out <bundle-dir> [--store <dir> | --db <file>] [--source <source>] [--no-raw] [--dry-run] [--write]",
    "  cchistory restore-check (--store <dir> | --db <file>) [--showall]",
    "  cchistory import <bundle-dir> [--store <dir> | --db <file>] [--on-conflict error|skip|replace] [--dry-run]",
    "  cchistory gc [--store <dir> | --db <file>] [--dry-run]",
    "  cchistory agent pair --server <url> --pair-token <token> [--state-file <path>] [--display-name <name>] [--reported-hostname <name>]",
    "  cchistory agent upload [--state-file <path>] [--source <slot-or-id>] [--limit-files <n>] [--force] [--no-raw] [--retry-attempts <n>] [--retry-delay-ms <n>]",
    "  cchistory agent schedule --interval-seconds <n> [--iterations <n>] [--state-file <path>] [--source <slot-or-id>] [--limit-files <n>] [--force] [--no-raw] [--retry-attempts <n>] [--retry-delay-ms <n>]",
    "  cchistory agent pull [--state-file <path>] [--retry-attempts <n>] [--retry-delay-ms <n>] [--no-raw]",
    "",
    "Global options:",
    "  --store <dir>   Use a store directory (db is <dir>/cchistory.sqlite)",
    "  --db <file>     Use an explicit sqlite file; sidecar data lives beside it",
    "  --index         Read from the existing store only (default for read commands)",
    "  --full          Re-scan default source roots into a temporary store before reading",
    "  --store-only    Suppress host discovery and sync preview; focus on the selected store",
    "  --showall       Include empty projects in listings and missing candidates in discover output",
    "  --long          Expand browse surfaces with richer metadata and hierarchy detail",
    "  --json          Print machine-readable JSON",
    "  --dry-run       Preview sync, import, gc, or backup actions without writing",
    "  --write         Execute the write step for preview-first workflows like backup",
    "  --verbose       Reserved for detailed diagnostics",
    "",
    "Recall output contract:",
    "  query           Always prints structured JSON for scriptable supply-side reads",
    "  search/show     Print operator-readable text by default; add --json for structured output",
    "",
    "Default store resolution:",
    "  nearest existing .cchistory/ in the current or ancestor directories; otherwise ~/.cchistory",
  ].join("\n");
}
