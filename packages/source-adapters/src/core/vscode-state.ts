import { promises as fs } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  SourceDefinition,
  SourcePlatform,
} from "@cchistory/domain";
import type { ExtractedSessionSeed } from "./legacy.js";

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

interface ConversationSeedOptions {
  defaultSessionId?: string;
  defaultTitle?: string;
  defaultWorkingDirectory?: string;
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
  minIso(left: string | undefined, right: string | undefined): string | undefined;
  maxIso(left: string | undefined, right: string | undefined): string | undefined;
  buildCursorComposerSeed(
    platform: SourcePlatform,
    storageKey: string,
    composer: Record<string, unknown>,
    rowMap: Map<string, string>,
    defaultWorkingDirectory: string | undefined,
    helpers: {
      asString(value: unknown): string | undefined;
      asNumber(value: unknown): number | undefined;
      asArray(value: unknown): unknown[];
      isObject(value: unknown): value is Record<string, any>;
      safeJsonParse(value: string | undefined): unknown;
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
    },
  ): ExtractedSessionSeed | undefined;
  buildCursorPromptHistorySeed(
    platform: SourcePlatform,
    filePath: string,
    rowMap: Map<string, string>,
    defaultWorkingDirectory: string | undefined,
    fallbackObservedAtBase: string,
    helpers: {
      asString(value: unknown): string | undefined;
      asNumber(value: unknown): number | undefined;
      asArray(value: unknown): unknown[];
      isObject(value: unknown): value is Record<string, any>;
      safeJsonParse(value: string | undefined): unknown;
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
    },
  ): ExtractedSessionSeed | undefined;
  isAntigravityTrajectoryKey(storageKey: string): boolean;
  extractAntigravityTrajectorySeeds(
    storageKey: string,
    encodedValue: string,
    helpers: Pick<VscodeStateHelpers, "nowIso" | "normalizeWorkspacePath">,
  ): ExtractedSessionSeed[];
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
      if (source.platform === "antigravity" && helpers.isAntigravityTrajectoryKey(row.storage_key)) {
        antigravityTrajectoryRows.set(row.storage_key, row.storage_value);
        continue;
      }

      if (row.storage_key.startsWith("composerData:")) {
        const parsed = helpers.safeJsonParse(row.storage_value);
        if (!helpers.isObject(parsed)) {
          continue;
        }
        const seed = helpers.buildCursorComposerSeed(
          source.platform,
          row.storage_key,
          parsed,
          rowMap,
          workspacePath,
          cursorRuntimeHelpers,
        );
        if (seed) {
          upsertExtractedSeed(seedsById, seed, helpers);
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
            const seed = helpers.buildCursorComposerSeed(
              source.platform,
              row.storage_key,
              composer,
              rowMap,
              workspacePath,
              cursorRuntimeHelpers,
            );
            if (seed) {
              upsertExtractedSeed(seedsById, seed, helpers);
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
          upsertExtractedSeed(seedsById, seed, helpers);
        }
      }
    }

    if (source.platform === "cursor" && seedsById.size === 0) {
      const promptHistorySeed = helpers.buildCursorPromptHistorySeed(
        source.platform,
        filePath,
        rowMap,
        workspacePath,
        fallbackObservedAtBase,
        cursorRuntimeHelpers,
      );
      if (promptHistorySeed) {
        upsertExtractedSeed(seedsById, promptHistorySeed, helpers);
      }
    }

    if (source.platform === "antigravity" && seedsById.size === 0) {
      for (const [storageKey, storageValue] of antigravityTrajectoryRows) {
        for (const seed of helpers.extractAntigravityTrajectorySeeds(storageKey, storageValue, {
          nowIso: helpers.nowIso,
          normalizeWorkspacePath: helpers.normalizeWorkspacePath,
        })) {
          upsertExtractedSeed(seedsById, seed, helpers);
        }
      }
    }

    if (seedsById.size === 0) {
      for (const row of rows) {
        if (source.platform === "antigravity" && helpers.isAntigravityTrajectoryKey(row.storage_key)) {
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
          upsertExtractedSeed(seedsById, seed, helpers);
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
      ? ["%chat%", "%aichat%", "%prompt%", "%generation%", "%trajectory%", "%jetski%"]
      : ["%composer%", "%chat%", "%aichat%", "%bubble%", "%prompt%", "%generation%"];

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
  helpers: Pick<VscodeStateHelpers, "minIso" | "maxIso">,
): void {
  const existing = target.get(seed.sessionId);
  if (!existing) {
    target.set(seed.sessionId, seed);
    return;
  }
  target.set(seed.sessionId, {
    sessionId: seed.sessionId,
    title: existing.title ?? seed.title,
    createdAt: helpers.minIso(existing.createdAt, seed.createdAt),
    updatedAt: helpers.maxIso(existing.updatedAt, seed.updatedAt),
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

function escapeSqliteIdentifier(value: string): string {
  return `"${value.replace(/"/gu, "\"\"")}"`;
}
