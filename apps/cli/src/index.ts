#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import type { SourceDefinition } from "../../../packages/domain/dist/index.js";
import {
  getDefaultSources,
  getSourceFormatProfiles,
  runSourceProbe,
} from "../../../packages/source-adapters/dist/index.js";
import { CCHistoryStorage } from "../../../packages/storage/dist/index.js";

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string[]>;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const [command, ...restPositionals] = parsed.positionals;

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  switch (command) {
    case "collect":
      await handleCollect({ ...parsed, positionals: restPositionals });
      return;
    case "merge":
      await handleMerge({ ...parsed, positionals: restPositionals });
      return;
    case "query":
      await handleQuery({ ...parsed, positionals: restPositionals });
      return;
    case "templates":
      handleTemplates({ ...parsed, positionals: restPositionals });
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function handleCollect(parsed: ParsedArgs): Promise<void> {
  const dbArg = requireFlag(parsed, "db");
  const limitFiles = parseNumberFlag(parsed, "limit-files");
  const selectedSourceIds = getFlagValues(parsed, "source");
  const baseDirOverrides = parseKeyValueFlags(parsed, "base-dir");

  const sources = applySourceOverrides(getDefaultSources(), selectedSourceIds, baseDirOverrides);
  const result = await runSourceProbe(
    {
      source_ids: selectedSourceIds.length > 0 ? selectedSourceIds : undefined,
      limit_files_per_source: limitFiles,
    },
    sources,
  );
  const storage = new CCHistoryStorage(resolveDataDir(dbArg));
  try {
    for (const payload of result.sources) {
      storage.replaceSourcePayload(payload);
    }
  } finally {
    storage.close();
  }

  printJson({
    command: "collect",
    host: result.host,
    sources: result.sources.map((payload) => ({
      id: payload.source.id,
      platform: payload.source.platform,
      family: payload.source.family,
      sync_status: payload.source.sync_status,
      sessions: payload.sessions.length,
      turns: payload.turns.length,
      contexts: payload.contexts.length,
      records: payload.records.length,
      fragments: payload.fragments.length,
      atoms: payload.atoms.length,
      candidates: payload.candidates.length,
      errors: payload.loss_audits.length,
    })),
    db: path.join(resolveDataDir(dbArg), "cchistory.sqlite"),
  });
}

async function handleMerge(parsed: ParsedArgs): Promise<void> {
  const fromArg = requireFlag(parsed, "from");
  const toArg = requireFlag(parsed, "to");
  const onConflict = (getFlag(parsed, "on-conflict") ?? "replace") as "replace" | "skip";
  if (onConflict !== "replace" && onConflict !== "skip") {
    throw new Error(`Unsupported --on-conflict value: ${onConflict}`);
  }

  const sourceIds = new Set(getFlagValues(parsed, "source"));
  const sourceStorage = new CCHistoryStorage(resolveDataDir(fromArg));
  const targetStorage = new CCHistoryStorage(resolveDataDir(toArg));
  const merged: string[] = [];
  const skipped: string[] = [];

  try {
    const existingSourceIds = new Set(targetStorage.listSources().map((source) => source.id));
    for (const payload of sourceStorage.listSourcePayloads()) {
      if (sourceIds.size > 0 && !sourceIds.has(payload.source.id)) {
        continue;
      }
      if (existingSourceIds.has(payload.source.id) && onConflict === "skip") {
        skipped.push(payload.source.id);
        continue;
      }
      targetStorage.replaceSourcePayload(payload);
      merged.push(payload.source.id);
    }
  } finally {
    sourceStorage.close();
    targetStorage.close();
  }

  printJson({
    command: "merge",
    from: path.join(resolveDataDir(fromArg), "cchistory.sqlite"),
    to: path.join(resolveDataDir(toArg), "cchistory.sqlite"),
    on_conflict: onConflict,
    merged_source_ids: merged,
    skipped_source_ids: skipped,
  });
}

async function handleQuery(parsed: ParsedArgs): Promise<void> {
  const [target] = parsed.positionals;
  const dbArg = requireFlag(parsed, "db");
  const storage = new CCHistoryStorage(resolveDataDir(dbArg));

  try {
    switch (target) {
      case "turns": {
        const query = getFlag(parsed, "search");
        const projectId = getFlag(parsed, "project");
        const sourceIds = getFlagValues(parsed, "source");
        const limit = parseNumberFlag(parsed, "limit") ?? 20;
        if (query) {
          printJson(
            storage.searchTurns({
              query,
              project_id: projectId,
              source_ids: sourceIds.length > 0 ? sourceIds : undefined,
              limit,
            }),
          );
          return;
        }

        const turns = storage
          .listResolvedTurns()
          .filter((turn) => (projectId ? turn.project_id === projectId : true))
          .filter((turn) => (sourceIds.length > 0 ? sourceIds.includes(turn.source_id) : true))
          .slice(0, limit);
        printJson(turns);
        return;
      }
      case "turn": {
        const turnId = requireFlag(parsed, "id");
        printJson({
          turn: storage.getResolvedTurn(turnId) ?? storage.getTurn(turnId),
          context: storage.getTurnContext(turnId),
          lineage: storage.getTurnLineage(turnId),
        });
        return;
      }
      case "sessions": {
        const projectId = getFlag(parsed, "project");
        const sourceIds = getFlagValues(parsed, "source");
        const limit = parseNumberFlag(parsed, "limit") ?? 20;
        const sessions = storage
          .listResolvedSessions()
          .filter((session) => (projectId ? session.primary_project_id === projectId : true))
          .filter((session) => (sourceIds.length > 0 ? sourceIds.includes(session.source_id) : true))
          .slice(0, limit);
        printJson(sessions);
        return;
      }
      case "session": {
        const sessionId = requireFlag(parsed, "id");
        printJson({
          session: storage.getResolvedSession(sessionId) ?? storage.getSession(sessionId),
          turns: storage.listResolvedTurns().filter((turn) => turn.session_id === sessionId),
        });
        return;
      }
      case "projects": {
        printJson(storage.listProjects());
        return;
      }
      case "project": {
        const projectId = requireFlag(parsed, "id");
        const linkState = (getFlag(parsed, "link-state") ?? "all") as "all" | "committed" | "candidate" | "unlinked";
        printJson({
          project: storage.getProject(projectId),
          turns: storage.listProjectTurns(projectId, linkState),
        });
        return;
      }
      default:
        throw new Error("Unsupported query target. Use turns, turn, sessions, session, projects, or project.");
    }
  } finally {
    storage.close();
  }
}

function handleTemplates(parsed: ParsedArgs): void {
  const platform = getFlag(parsed, "platform") ?? parsed.positionals[0];
  const defaultsByPlatform = new Map<string, SourceDefinition[]>();
  for (const source of getDefaultSources()) {
    const current = defaultsByPlatform.get(source.platform) ?? [];
    current.push(source);
    defaultsByPlatform.set(source.platform, current);
  }

  const templates = getSourceFormatProfiles()
    .filter((profile) => (platform ? profile.platform === platform : true))
    .map((profile) => ({
      platform: profile.platform,
      family: profile.family,
      profile_id: profile.id,
      parser_version: profile.parser_version,
      capabilities: profile.capabilities,
      description: profile.description,
      default_sources: (defaultsByPlatform.get(profile.platform) ?? []).map((source) => ({
        id: source.id,
        display_name: source.display_name,
        base_dir: source.base_dir,
      })),
    }));

  printJson(templates);
}

function applySourceOverrides(
  sources: SourceDefinition[],
  selectedSourceIds: string[],
  baseDirOverrides: Map<string, string>,
): SourceDefinition[] {
  const selected = selectedSourceIds.length > 0 ? new Set(selectedSourceIds) : undefined;
  const availableIds = new Set(sources.map((source) => source.id));
  for (const sourceId of baseDirOverrides.keys()) {
    if (!availableIds.has(sourceId)) {
      throw new Error(`Unknown source id in --base-dir: ${sourceId}`);
    }
  }
  return sources
    .filter((source) => (selected ? selected.has(source.id) : true))
    .map((source) => ({
      ...source,
      base_dir: baseDirOverrides.get(source.id) ?? source.base_dir,
    }));
}

function resolveDataDir(input: string): string {
  const resolved = path.resolve(input);
  if (path.extname(resolved) === ".sqlite") {
    if (path.basename(resolved) !== "cchistory.sqlite") {
      throw new Error("DB path must be a data directory or a file named cchistory.sqlite");
    }
    return path.dirname(resolved);
  }
  return resolved;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value) {
      continue;
    }
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const trimmed = value.slice(2);
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex >= 0) {
      const key = trimmed.slice(0, equalsIndex);
      const flagValue = trimmed.slice(equalsIndex + 1);
      pushFlag(flags, key, flagValue);
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      pushFlag(flags, trimmed, "true");
      continue;
    }
    pushFlag(flags, trimmed, next);
    index += 1;
  }

  return { positionals, flags };
}

function pushFlag(target: Map<string, string[]>, key: string, value: string): void {
  const current = target.get(key) ?? [];
  current.push(value);
  target.set(key, current);
}

function getFlag(parsed: ParsedArgs, key: string): string | undefined {
  return parsed.flags.get(key)?.at(-1);
}

function getFlagValues(parsed: ParsedArgs, key: string): string[] {
  return parsed.flags.get(key) ?? [];
}

function requireFlag(parsed: ParsedArgs, key: string): string {
  const value = getFlag(parsed, key);
  if (!value) {
    throw new Error(`Missing required --${key} flag`);
  }
  return value;
}

function parseNumberFlag(parsed: ParsedArgs, key: string): number | undefined {
  const value = getFlag(parsed, key);
  if (!value) {
    return undefined;
  }
  const parsedNumber = Number(value);
  if (!Number.isFinite(parsedNumber)) {
    throw new Error(`Invalid numeric value for --${key}: ${value}`);
  }
  return parsedNumber;
}

function parseKeyValueFlags(parsed: ParsedArgs, key: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const value of getFlagValues(parsed, key)) {
    const separatorIndex = value.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(`Expected --${key} entries in sourceId=/path form, got: ${value}`);
    }
    result.set(value.slice(0, separatorIndex), value.slice(separatorIndex + 1));
  }
  return result;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage:",
      "  cchistory collect --db <data-dir|cchistory.sqlite> [--source <id>] [--base-dir <sourceId=/path>] [--limit-files <n>]",
      "  cchistory merge --from <data-dir|cchistory.sqlite> --to <data-dir|cchistory.sqlite> [--source <id>] [--on-conflict replace|skip]",
      "  cchistory query turns --db <data-dir|cchistory.sqlite> [--search <text>] [--project <id>] [--source <id>] [--limit <n>]",
      "  cchistory query turn --db <data-dir|cchistory.sqlite> --id <turnId>",
      "  cchistory query sessions --db <data-dir|cchistory.sqlite> [--project <id>] [--source <id>] [--limit <n>]",
      "  cchistory query session --db <data-dir|cchistory.sqlite> --id <sessionId>",
      "  cchistory query projects --db <data-dir|cchistory.sqlite>",
      "  cchistory query project --db <data-dir|cchistory.sqlite> --id <projectId> [--link-state all|committed|candidate|unlinked]",
      "  cchistory templates [--platform <platform>]",
      "",
      "Output is JSON so other agents can consume it directly.",
    ].join("\n"),
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
