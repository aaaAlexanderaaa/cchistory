import { promises as fs } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type {
  SourceDefinition,
  SourcePlatform,
} from "@cchistory/domain";
import { minIso, maxIso } from "@cchistory/domain";
import { extractAntigravityTrajectorySeeds, isAntigravityTrajectoryKey } from "../platforms/antigravity/runtime.js";
import { buildCursorComposerSeed, buildCursorPromptHistorySeed } from "../platforms/cursor/runtime.js";
import type { ConversationSeedOptions, ExtractedSessionSeed } from "./conversation-seeds.js";

interface GenericSessionMetadataLike {
  workspacePath?: string;
  model?: string;
  title?: string;
  parentUuid?: string;
  isSidechain?: boolean;
}

interface TokenUsageLike {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
  model?: string;
}


interface VscodeStateHelpers {
  safeJsonParse(value: string | undefined): unknown;
  isObject(value: unknown): value is Record<string, any>;
  asArray(value: unknown): unknown[];
  asString(value: unknown): string | undefined;
  asNumber(value: unknown): number | undefined;
  coerceIso(value: unknown): string | undefined;
  epochMillisToIso(value: number | undefined): string | undefined;
  nowIso(): string;
  truncate(value: string, length: number): string;
  sha1(value: string | Buffer): string;
  normalizeWorkspacePath(value: string): string | undefined;
  extractGenericSessionMetadata(parsed: Record<string, unknown>): GenericSessionMetadataLike;
  extractGenericRole(message: Record<string, unknown>): string | undefined;
  extractGenericContentItems(message: Record<string, unknown>): Record<string, unknown>[];
  extractTokenUsage(value: unknown): TokenUsageLike | undefined;
  normalizeStopReason(value: unknown): string | undefined;
  extractRichTextText(value: string): string | undefined;
  collectConversationSeedsFromValue(
    platform: SourcePlatform,
    value: unknown,
    originHint: string,
    options?: ConversationSeedOptions,
  ): ExtractedSessionSeed[];
  firstDefinedNumber(...values: Array<number | undefined>): number | undefined;
}

export async function extractVscodeStateSeeds(
  source: SourceDefinition,
  filePath: string,
  helpers: VscodeStateHelpers,
): Promise<ExtractedSessionSeed[] | undefined> {
  const workspacePath = await extractWorkspacePathFromWorkspaceState(filePath, helpers);
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    const rows = selectVscodeKeyValueRows(db, source.platform, helpers);
    const rowMap = new Map(rows.map((row) => [row.storage_key, row.storage_value]));
    const seedsById = new Map<string, ExtractedSessionSeed>();
    const fallbackObservedAtBase = (await fs.stat(filePath)).mtime.toISOString();
    const antigravityTrajectoryRows = new Map<string, string>();
    const antigravityHistoryRows: string[] = [];
    const cursorRuntimeHelpers = {
      asString: helpers.asString,
      asNumber: helpers.asNumber,
      asArray: helpers.asArray,
      isObject: helpers.isObject,
      safeJsonParse: helpers.safeJsonParse,
      coerceIso: helpers.coerceIso,
      epochMillisToIso: helpers.epochMillisToIso,
      nowIso: helpers.nowIso,
      truncate: helpers.truncate,
      sha1: helpers.sha1,
      normalizeWorkspacePath: helpers.normalizeWorkspacePath,
      extractGenericSessionMetadata: helpers.extractGenericSessionMetadata,
      extractGenericRole: helpers.extractGenericRole,
      extractGenericContentItems: helpers.extractGenericContentItems,
      extractTokenUsage: helpers.extractTokenUsage,
      normalizeStopReason: helpers.normalizeStopReason,
      extractRichTextText: helpers.extractRichTextText,
      collectConversationSeedsFromValue: helpers.collectConversationSeedsFromValue,
      firstDefinedNumber: helpers.firstDefinedNumber,
    };

    for (const row of rows) {
      if (source.platform === "antigravity" && isAntigravityTrajectoryKey(row.storage_key)) {
        antigravityTrajectoryRows.set(row.storage_key, row.storage_value);
        continue;
      }

      if (source.platform === "antigravity" && row.storage_key === "history.entries") {
        antigravityHistoryRows.push(row.storage_value);
        continue;
      }

      if (row.storage_key.startsWith("composerData:")) {
        const parsed = helpers.safeJsonParse(row.storage_value);
        if (!helpers.isObject(parsed)) {
          continue;
        }
        const seed = buildCursorComposerSeed(
          source.platform,
          row.storage_key,
          parsed,
          rowMap,
          workspacePath,
          cursorRuntimeHelpers,
        );
        if (seed) {
          upsertExtractedSeed(seedsById, seed);
        }
        continue;
      }

      if (row.storage_key === "composer.composerData") {
        const parsed = helpers.safeJsonParse(row.storage_value);
        if (helpers.isObject(parsed)) {
          for (const composer of helpers.asArray(parsed.allComposers)) {
            if (!helpers.isObject(composer)) {
              continue;
            }
            const seed = buildCursorComposerSeed(
              source.platform,
              row.storage_key,
              composer,
              rowMap,
              workspacePath,
              cursorRuntimeHelpers,
            );
            if (seed) {
              upsertExtractedSeed(seedsById, seed);
            }
          }
        }
      }

      if (row.storage_key.includes("chatdata") || row.storage_key.includes("aichat")) {
        const parsed = helpers.safeJsonParse(row.storage_value);
        const seeds = helpers.collectConversationSeedsFromValue(
          source.platform,
          parsed,
          `${path.basename(filePath)}:${row.storage_key}`,
          { defaultWorkingDirectory: workspacePath },
        );
        for (const seed of seeds) {
          upsertExtractedSeed(seedsById, seed);
        }
      }
    }

    if (source.platform === "cursor" && seedsById.size === 0) {
      const promptHistorySeed = buildCursorPromptHistorySeed(
        source.platform,
        filePath,
        rowMap,
        workspacePath,
        fallbackObservedAtBase,
        cursorRuntimeHelpers,
      );
      if (promptHistorySeed) {
        upsertExtractedSeed(seedsById, promptHistorySeed);
      }
    }

    if (source.platform === "antigravity") {
      for (const [storageKey, storageValue] of antigravityTrajectoryRows) {
        for (const seed of extractAntigravityTrajectorySeeds(storageKey, storageValue, {
          nowIso: helpers.nowIso,
          normalizeWorkspacePath: helpers.normalizeWorkspacePath,
        })) {
          upsertExtractedSeed(seedsById, seed);
        }
      }

      const mergedAntigravityHistoryEntries: unknown[] = [];
      for (const storageValue of antigravityHistoryRows) {
        appendAntigravityHistoryEntries(mergedAntigravityHistoryEntries, storageValue, helpers);
      }
      for (const row of await selectAntigravityBackupHistoryRows(filePath, helpers)) {
        appendAntigravityHistoryEntries(mergedAntigravityHistoryEntries, row.storage_value, helpers);
      }
      if (mergedAntigravityHistoryEntries.length > 0) {
        for (const seed of await extractAntigravityHistorySeeds(mergedAntigravityHistoryEntries, workspacePath, helpers)) {
          upsertExtractedSeed(seedsById, seed);
        }
      }
    }

    if (seedsById.size === 0) {
      for (const row of rows) {
        if (source.platform === "antigravity" && isAntigravityTrajectoryKey(row.storage_key)) {
          continue;
        }
        const parsed = helpers.safeJsonParse(row.storage_value);
        const seeds = helpers.collectConversationSeedsFromValue(
          source.platform,
          parsed,
          `${path.basename(filePath)}:${row.storage_key}`,
          { defaultWorkingDirectory: workspacePath },
        );
        for (const seed of seeds) {
          upsertExtractedSeed(seedsById, seed);
        }
      }
    }

    return seedsById.size > 0 ? [...seedsById.values()] : undefined;
  } finally {
    db.close();
  }
}

function selectVscodeKeyValueRows(
  db: DatabaseSync,
  platform: SourcePlatform,
  helpers: Pick<VscodeStateHelpers, "asString">,
): Array<{ storage_key: string; storage_value: string }> {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  const rows: Array<{ storage_key: string; storage_value: string }> = [];
  const filterPatterns =
    platform === "antigravity"
      ? ["%chat%", "%aichat%", "%prompt%", "%generation%", "%trajectory%", "%jetski%", "%history%"]
      : ["%composer%", "%chat%", "%aichat%", "%bubble%", "%prompt%", "%generation%"];

  return selectSqliteKeyValueRows(db, tables, filterPatterns, helpers);
}

async function extractWorkspacePathFromWorkspaceState(
  filePath: string,
  helpers: Pick<VscodeStateHelpers, "safeJsonParse" | "isObject" | "asString" | "normalizeWorkspacePath">,
): Promise<string | undefined> {
  const workspaceJsonPath = path.join(path.dirname(filePath), "workspace.json");
  let raw: string;
  try {
    raw = await fs.readFile(workspaceJsonPath, "utf8");
  } catch {
    return undefined;
  }

  const parsed = helpers.safeJsonParse(raw);
  if (!helpers.isObject(parsed)) {
    return undefined;
  }
  const workspaceCandidate =
    helpers.asString(parsed.folder) ??
    helpers.asString(parsed.path) ??
    helpers.asString(parsed.uri) ??
    (helpers.isObject(parsed.workspace)
      ? helpers.asString(parsed.workspace.path) ?? helpers.asString(parsed.workspace.uri)
      : undefined);
  return workspaceCandidate ? helpers.normalizeWorkspacePath(workspaceCandidate) : undefined;
}

function upsertExtractedSeed(
  target: Map<string, ExtractedSessionSeed>,
  seed: ExtractedSessionSeed,
): void {
  const existing = target.get(seed.sessionId);
  if (!existing) {
    target.set(seed.sessionId, seed);
    return;
  }
  target.set(seed.sessionId, {
    sessionId: seed.sessionId,
    title: existing.title ?? seed.title,
    createdAt: minIso(existing.createdAt, seed.createdAt),
    updatedAt: maxIso(existing.updatedAt, seed.updatedAt),
    model: existing.model ?? seed.model,
    workingDirectory: existing.workingDirectory ?? seed.workingDirectory,
    records: [...existing.records, ...seed.records].sort((left, right) =>
      (left.observedAt ?? "").localeCompare(right.observedAt ?? ""),
    ),
  });
}

function coerceDbText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("utf8");
  }
  return undefined;
}

async function selectAntigravityBackupHistoryRows(
  filePath: string,
  helpers: Pick<VscodeStateHelpers, "asString">,
): Promise<Array<{ storage_key: string; storage_value: string }>> {
  const backupPath = `${filePath}.backup`;
  try {
    await fs.access(backupPath);
  } catch {
    return [];
  }

  const db = new DatabaseSync(backupPath, { readOnly: true });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>;
    return selectSqliteKeyValueRows(db, tables, ["%history%"], helpers);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

function selectSqliteKeyValueRows(
  db: DatabaseSync,
  tables: Array<{ name: string }>,
  filterPatterns: string[],
  helpers: Pick<VscodeStateHelpers, "asString">,
): Array<{ storage_key: string; storage_value: string }> {
  const rows: Array<{ storage_key: string; storage_value: string }> = [];

  for (const table of tables) {
    const tableName = table.name;
    const tableInfo = db.prepare(`PRAGMA table_info(${escapeSqliteIdentifier(tableName)})`).all() as Array<{
      name: string;
    }>;
    const columnNames = new Set(tableInfo.map((column) => column.name));
    const keyColumn = ["key", "storage_key", "itemKey"].find((column) => columnNames.has(column));
    const valueColumn = ["value", "storage_value", "itemValue", "data"].find((column) => columnNames.has(column));
    if (!keyColumn || !valueColumn) {
      continue;
    }

    const query = `
      SELECT ${escapeSqliteIdentifier(keyColumn)} AS storage_key, ${escapeSqliteIdentifier(valueColumn)} AS storage_value
      FROM ${escapeSqliteIdentifier(tableName)}
      WHERE ${filterPatterns.map(() => `lower(${escapeSqliteIdentifier(keyColumn)}) LIKE ?`).join(" OR ")}
    `;
    const selectedRows = db.prepare(query).all(...filterPatterns) as Array<{ storage_key: unknown; storage_value: unknown }>;

    for (const row of selectedRows) {
      const storageKey = helpers.asString(row.storage_key);
      const storageValue = coerceDbText(row.storage_value);
      if (!storageKey || !storageValue) {
        continue;
      }
      rows.push({ storage_key: storageKey, storage_value: storageValue });
    }
  }

  return rows;
}

function appendAntigravityHistoryEntries(
  target: unknown[],
  rawValue: string,
  helpers: Pick<VscodeStateHelpers, "safeJsonParse">,
): void {
  const parsed = helpers.safeJsonParse(rawValue);
  if (!Array.isArray(parsed)) {
    return;
  }
  target.push(...parsed);
}

async function extractAntigravityHistorySeeds(
  entries: unknown[],
  defaultWorkingDirectory: string | undefined,
  helpers: Pick<
    VscodeStateHelpers,
    "safeJsonParse" | "isObject" | "asString" | "asNumber" | "coerceIso" | "epochMillisToIso" | "nowIso" | "truncate"
  >,
): Promise<ExtractedSessionSeed[]> {
  if (!Array.isArray(entries)) {
    return [];
  }

  const seedsById = new Map<
    string,
    {
      title?: string;
      titleObservedAt?: string;
      prompt?: { text: string; observedAt: string; pointer: string };
    }
  >();

  for (const [index, entry] of entries.entries()) {
    if (!helpers.isObject(entry) || !helpers.isObject(entry.editor)) {
      continue;
    }

    const resource = helpers.asString(entry.editor.resource);
    if (!resource) {
      continue;
    }
    const normalizedResource = resource.replace(/\\/g, "/");
    const sessionMatch = normalizedResource.match(/\/brain\/([0-9a-f-]{36})\//i);
    if (!sessionMatch) {
      continue;
    }

    const description = normalizeAntigravityHistoryDescription(helpers.asString(entry.editor.description));
    if (!description) {
      continue;
    }

    const sessionId = `sess:antigravity:${sessionMatch[1]}`;
    const existing = seedsById.get(sessionId);
    const seed = existing ?? {};
    if (!existing) {
      seedsById.set(sessionId, seed);
    }

    const isPrompt = isLikelyAntigravityPrompt(description);
    const observedAt =
      helpers.epochMillisToIso(helpers.asNumber(entry.timestamp)) ??
      helpers.coerceIso(entry.timestamp) ??
      (await inferAntigravityHistoryObservedAt(resource, { preferBeforeArtifact: isPrompt }, helpers)) ??
      helpers.nowIso();
    if (isPrompt) {
      if (!seed.prompt || compareAntigravityPromptCandidates(description, seed.prompt.text) > 0) {
        seed.prompt = {
          text: description,
          observedAt,
          pointer: `history.entries[${index}].description`,
        };
      }
      continue;
    }

    if (!seed.title || compareAntigravityTitleCandidates(description, seed.title) > 0) {
      seed.title = helpers.truncate(description, 72);
      seed.titleObservedAt = observedAt;
    }
  }

  const seeds: ExtractedSessionSeed[] = [];
  for (const [sessionId, seed] of seedsById) {
    const records: ExtractedSessionSeed["records"] = [];
    const metaObservedAt = seed.prompt?.observedAt ?? seed.titleObservedAt ?? helpers.nowIso();
    if (seed.title || defaultWorkingDirectory) {
      records.push({
        pointer: "history.meta",
        observedAt: metaObservedAt,
        rawJson: JSON.stringify({
          id: sessionId,
          title: seed.title,
          createdAt: metaObservedAt,
          updatedAt: metaObservedAt,
          cwd: defaultWorkingDirectory,
        }),
      });
    }
    if (seed.prompt) {
      records.push({
        pointer: seed.prompt.pointer,
        observedAt: seed.prompt.observedAt,
        rawJson: JSON.stringify({
          id: `${sessionId}:${seed.prompt.pointer}`,
          role: "user",
          content: seed.prompt.text,
          createdAt: seed.prompt.observedAt,
          updatedAt: seed.prompt.observedAt,
          cwd: defaultWorkingDirectory,
        }),
      });
    }
    if (records.length === 0) {
      continue;
    }
    seeds.push({
      sessionId,
      title: seed.title,
      createdAt: seed.prompt?.observedAt ?? seed.titleObservedAt,
      updatedAt: seed.prompt?.observedAt ?? seed.titleObservedAt,
      workingDirectory: defaultWorkingDirectory,
      records,
    });
  }

  return seeds;
}

async function inferAntigravityHistoryObservedAt(
  resource: string,
  options: { preferBeforeArtifact: boolean },
  helpers: Pick<VscodeStateHelpers, "safeJsonParse" | "isObject" | "asString" | "coerceIso">,
): Promise<string | undefined> {
  const artifactPath = resolveAntigravityHistoryResourcePath(resource);
  if (!artifactPath) {
    return undefined;
  }

  const sourceArtifactPath = stripAntigravityResolvedSuffix(artifactPath);
  const metadataUpdatedAt = await readAntigravityArtifactMetadataUpdatedAt(sourceArtifactPath, helpers);
  if (metadataUpdatedAt) {
    return options.preferBeforeArtifact ? shiftIso(metadataUpdatedAt, -1) : metadataUpdatedAt;
  }

  const inferredFromFile = await readAntigravityArtifactMtime(sourceArtifactPath) ?? await readAntigravityArtifactMtime(artifactPath);
  if (inferredFromFile) {
    return options.preferBeforeArtifact ? shiftIso(inferredFromFile, -1) : inferredFromFile;
  }

  return undefined;
}

function resolveAntigravityHistoryResourcePath(resource: string): string | undefined {
  try {
    if (resource.startsWith("file://")) {
      return fileURLToPath(resource);
    }
  } catch {
    return undefined;
  }

  return resource.trim() || undefined;
}

function stripAntigravityResolvedSuffix(filePath: string): string {
  return filePath.replace(/\.resolved(?:\.\d+)?$/u, "");
}

async function readAntigravityArtifactMetadataUpdatedAt(
  sourceArtifactPath: string,
  helpers: Pick<VscodeStateHelpers, "safeJsonParse" | "isObject" | "asString" | "coerceIso">,
): Promise<string | undefined> {
  const metadataPath = `${sourceArtifactPath}.metadata.json`;
  try {
    const raw = await fs.readFile(metadataPath, "utf8");
    const parsed = helpers.safeJsonParse(raw);
    if (!helpers.isObject(parsed)) {
      return undefined;
    }
    return (
      helpers.coerceIso(parsed.updatedAt) ??
      helpers.coerceIso(parsed.createdAt) ??
      helpers.coerceIso(helpers.asString(parsed.updatedAt)) ??
      helpers.coerceIso(helpers.asString(parsed.createdAt))
    );
  } catch {
    return undefined;
  }
}

async function readAntigravityArtifactMtime(filePath: string): Promise<string | undefined> {
  try {
    return (await fs.stat(filePath)).mtime.toISOString();
  } catch {
    return undefined;
  }
}

function shiftIso(value: string, deltaMs: number): string | undefined {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return undefined;
  }
  return new Date(timestamp + deltaMs).toISOString();
}

function normalizeAntigravityHistoryDescription(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) {
    return undefined;
  }
  const normalized = text.toLowerCase();
  if (
    normalized === "artifact" ||
    normalized === "task" ||
    normalized === "walkthrough" ||
    normalized === "implementation plan" ||
    normalized === "scratchpad"
  ) {
    return undefined;
  }
  return text;
}

function isLikelyAntigravityPrompt(value: string): boolean {
  const wordCount = value.split(/\s+/).filter(Boolean).length;
  if (/^(continue|go on|carry on|next|more|继续|继续吧|继续一下|接着|接着做|继续做)$/iu.test(value.trim())) {
    return true;
  }
  return (
    value.length >= 48 ||
    wordCount >= 8 ||
    /[`"'“”‘’]/.test(value) ||
    /[，。！？；、,:;()]/.test(value)
  );
}

function compareAntigravityPromptCandidates(left: string, right: string): number {
  return antigravityPromptScore(left) - antigravityPromptScore(right);
}

function antigravityPromptScore(value: string): number {
  return value.length + (/[，。！？；、,:;()]/.test(value) ? 40 : 0) + (/[`"'“”‘’]/.test(value) ? 20 : 0);
}

function compareAntigravityTitleCandidates(left: string, right: string): number {
  return left.length - right.length;
}

function escapeSqliteIdentifier(value: string): string {
  return `"${value.replace(/"/gu, "\"\"")}"`;
}
