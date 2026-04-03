import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SourcePlatform } from "@cchistory/domain";
import type { ExtractedSessionSeed } from "../../core/conversation-seeds.js";

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

interface CursorRuntimeHelpers {
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
    options?: {
      defaultSessionId?: string;
      defaultTitle?: string;
      defaultWorkingDirectory?: string;
    },
  ): ExtractedSessionSeed[];
  firstDefinedNumber(...values: Array<number | undefined>): number | undefined;
}

export function buildCursorComposerSeed(
  platform: SourcePlatform,
  storageKey: string,
  composer: Record<string, unknown>,
  rowMap: Map<string, string>,
  defaultWorkingDirectory: string | undefined,
  helpers: CursorRuntimeHelpers,
): ExtractedSessionSeed | undefined {
  const composerId =
    (helpers.asString(composer.composerId) ??
      helpers.asString(composer.id) ??
      storageKey.split(":").slice(1).join(":")) ||
    helpers.sha1(storageKey);
  const sessionId = `sess:${platform}:${composerId}`;
  const meta = helpers.extractGenericSessionMetadata(composer);
  const workingDirectory = meta.workspacePath ?? defaultWorkingDirectory;
  const bubbleRefs = extractBubbleRefsFromComposer(composer, helpers);
  const messageRecords = bubbleRefs
    .map((bubbleRef) => {
      const rawBubble = rowMap.get(bubbleRef) ?? rowMap.get(`bubbleId:${bubbleRef}`);
      if (!rawBubble) {
        return undefined;
      }
      const parsedBubble = helpers.safeJsonParse(rawBubble);
      if (!helpers.isObject(parsedBubble)) {
        return undefined;
      }
      return normalizeCursorBubbleRecord(parsedBubble, workingDirectory, helpers);
    })
    .filter((record): record is { observedAt?: string; record: Record<string, unknown> } => record !== undefined);

  if (messageRecords.length === 0) {
    const fallback = helpers.collectConversationSeedsFromValue(platform, composer, storageKey, {
      defaultSessionId: sessionId,
      defaultWorkingDirectory: workingDirectory,
      defaultTitle: meta.title,
    });
    return fallback[0];
  }

  const records: ExtractedSessionSeed["records"] = [];
  if (meta.title || meta.model || workingDirectory) {
    records.push({
      pointer: "meta",
      observedAt: messageRecords[0]?.observedAt ?? helpers.nowIso(),
      rawJson: JSON.stringify({
        id: sessionId,
        title: meta.title,
        model: meta.model,
        cwd: workingDirectory,
      }),
    });
  }
  messageRecords
    .sort((left, right) => (left.observedAt ?? "").localeCompare(right.observedAt ?? ""))
    .forEach((message, index) => {
      records.push({
        pointer: `bubble[${index}]`,
        observedAt: message.observedAt ?? helpers.nowIso(),
        rawJson: JSON.stringify(message.record),
      });
    });

  return {
    sessionId,
    title: meta.title,
    createdAt: messageRecords[0]?.observedAt,
    updatedAt: messageRecords.at(-1)?.observedAt,
    model: meta.model,
    workingDirectory,
    records,
  };
}

export interface CursorChatStoreSeedResult {
  seed: ExtractedSessionSeed;
  diagnostics: Array<{
    code: string;
    detail: string;
    severity: "info" | "warning";
  }>;
}

export function buildCursorPromptHistorySeed(
  platform: SourcePlatform,
  filePath: string,
  rowMap: Map<string, string>,
  defaultWorkingDirectory: string | undefined,
  fallbackObservedAtBase: string,
  helpers: CursorRuntimeHelpers,
): ExtractedSessionSeed | undefined {
  const generationEntries = parseCursorPromptHistoryEntries(
    rowMap.get("aiService.generations"),
    fallbackObservedAtBase,
    helpers,
  );
  const promptEntries =
    generationEntries.length === 0
      ? parseCursorPromptHistoryEntries(rowMap.get("aiService.prompts"), fallbackObservedAtBase, helpers)
      : [];
  const entries = generationEntries.length > 0 ? generationEntries : promptEntries;
  if (entries.length === 0) {
    return undefined;
  }

  const sessionScope = helpers.normalizeWorkspacePath(defaultWorkingDirectory ?? "") ?? path.dirname(filePath);
  const sessionId = `sess:${platform}:prompt-history:${helpers.sha1(sessionScope)}`;
  const title =
    extractCursorWorkspaceTitle(rowMap, helpers) ?? helpers.truncate(entries[0]?.text ?? "Cursor prompt history", 72);
  const createdAt = entries[0]?.observedAt ?? fallbackObservedAtBase;
  const updatedAt = entries.at(-1)?.observedAt ?? createdAt;
  const records: ExtractedSessionSeed["records"] = [
    {
      pointer: "meta",
      observedAt: createdAt,
      rawJson: JSON.stringify({
        id: sessionId,
        title,
        cwd: defaultWorkingDirectory,
      }),
    },
  ];

  entries.forEach((entry, index) => {
    records.push({
      pointer: `prompt[${index}]`,
      observedAt: entry.observedAt,
      rawJson: JSON.stringify({
        id: entry.id,
        role: "user",
        content: entry.text,
        cwd: defaultWorkingDirectory,
      }),
    });
  });

  return {
    sessionId,
    title,
    createdAt,
    updatedAt,
    workingDirectory: defaultWorkingDirectory,
    records,
  };
}

export function extractCursorChatStoreSeed(
  platform: SourcePlatform,
  filePath: string,
  fallbackObservedAtBase: string,
  helpers: CursorRuntimeHelpers,
): CursorChatStoreSeedResult | undefined {
  const db = new DatabaseSync(filePath, { readOnly: true });

  try {
    const metaRow = db.prepare("SELECT value FROM meta ORDER BY key LIMIT 1").get() as { value: unknown } | undefined;
    const meta = decodeCursorChatStoreMeta(metaRow?.value, helpers);
    const blobRows = db.prepare("SELECT rowid AS rowid, id, data FROM blobs ORDER BY rowid").all() as Array<{
      rowid: unknown;
      id: unknown;
      data: unknown;
    }>;

    const createdAt = meta?.createdAt ?? fallbackObservedAtBase;
    const baseTime = Date.parse(createdAt);
    const decodedRows = blobRows
      .map((row, index) => decodeCursorChatStoreBlobRow(row, baseTime, index, helpers))
      .filter((row): row is CursorChatStoreBlobRow => row !== undefined);

    const sessionId = `sess:${platform}:chat-store:${meta?.agentId ?? path.basename(path.dirname(filePath))}`;
    const promptRow = decodedRows.find((row) => row.kind === "text");
    const structuredRows = decodedRows.filter(
      (row): row is Extract<CursorChatStoreBlobRow, { kind: "structured" }> => row.kind === "structured",
    );
    const structuredAssistant =
      (meta?.latestRootBlobId
        ? structuredRows.find((row) => row.blobId === meta.latestRootBlobId)
        : undefined) ?? structuredRows.at(-1);
    const fallbackAssistant = structuredAssistant ? undefined : decodedRows.filter((row) => row.kind === "text").at(1);

    const records: ExtractedSessionSeed["records"] = [
      {
        pointer: "meta",
        observedAt: createdAt,
        rawJson: JSON.stringify({
          id: sessionId,
          title: meta?.name ?? `Cursor chat store ${meta?.agentId ?? path.basename(path.dirname(filePath))}`,
          model: meta?.lastUsedModel,
          cursor_chat_store: {
            agentId: meta?.agentId,
            latestRootBlobId: meta?.latestRootBlobId,
            mode: meta?.mode,
          },
        }),
      },
    ];

    if (promptRow?.kind === "text") {
      records.push({
        pointer: `blob:${promptRow.blobId}`,
        observedAt: promptRow.observedAt,
        rawJson: JSON.stringify({
          id: `prompt:${promptRow.blobId}`,
          role: "user",
          content: [{ type: "input_text", text: promptRow.text }],
        }),
      });
    }

    if (structuredAssistant?.kind === "structured") {
      records.push({
        pointer: `blob:${structuredAssistant.blobId}`,
        observedAt: structuredAssistant.observedAt,
        rawJson: JSON.stringify(structuredAssistant.record),
      });
    } else if (fallbackAssistant?.kind === "text") {
      records.push({
        pointer: `blob:${fallbackAssistant.blobId}`,
        observedAt: fallbackAssistant.observedAt,
        rawJson: JSON.stringify({
          id: `assistant:${fallbackAssistant.blobId}`,
          role: "assistant",
          content: [{ type: "output_text", text: fallbackAssistant.text }],
        }),
      });
    }

    if (records.length <= 1) {
      return undefined;
    }

    return {
      seed: {
        sessionId,
        title: meta?.name,
        createdAt,
        updatedAt: records.at(-1)?.observedAt ?? createdAt,
        model: meta?.lastUsedModel,
        records,
      },
      diagnostics: [
        {
          code: "cursor_chat_store_blob_graph_opaque",
          detail:
            "Cursor chat-store blob graph remains opaque; projected only the first directly readable prompt fragment plus latestRootBlobId or fallback assistant evidence.",
          severity: "info",
        },
      ],
    };
  } finally {
    db.close();
  }
}

interface CursorChatStoreMeta {
  agentId?: string;
  latestRootBlobId?: string;
  name?: string;
  mode?: string;
  createdAt?: string;
  lastUsedModel?: string;
}

type CursorChatStoreBlobRow =
  | {
      kind: "text";
      blobId: string;
      observedAt: string;
      text: string;
    }
  | {
      kind: "structured";
      blobId: string;
      observedAt: string;
      record: Record<string, unknown>;
    };

function decodeCursorChatStoreMeta(
  rawValue: unknown,
  helpers: Pick<CursorRuntimeHelpers, "asString" | "safeJsonParse" | "isObject" | "coerceIso" | "epochMillisToIso">,
): CursorChatStoreMeta | undefined {
  const hexValue = helpers.asString(rawValue)?.trim();
  if (!hexValue) {
    return undefined;
  }

  let decodedText: string;
  try {
    decodedText = Buffer.from(hexValue, "hex").toString("utf8");
  } catch {
    return undefined;
  }

  const parsed = helpers.safeJsonParse(decodedText);
  if (!helpers.isObject(parsed)) {
    return undefined;
  }

  return {
    agentId: helpers.asString(parsed.agentId),
    latestRootBlobId: helpers.asString(parsed.latestRootBlobId),
    name: helpers.asString(parsed.name),
    mode: helpers.asString(parsed.mode),
    createdAt: helpers.coerceIso(parsed.createdAt) ?? helpers.epochMillisToIso(typeof parsed.createdAt === "number" ? parsed.createdAt : undefined),
    lastUsedModel: helpers.asString(parsed.lastUsedModel),
  };
}

function decodeCursorChatStoreBlobRow(
  row: { rowid: unknown; id: unknown; data: unknown },
  baseTime: number,
  index: number,
  helpers: Pick<
    CursorRuntimeHelpers,
    | "asString"
    | "safeJsonParse"
    | "isObject"
    | "extractGenericRole"
    | "extractGenericContentItems"
    | "extractRichTextText"
    | "extractTokenUsage"
    | "normalizeStopReason"
    | "epochMillisToIso"
    | "asNumber"
    | "coerceIso"
  >,
): CursorChatStoreBlobRow | undefined {
  const blobId = helpers.asString(row.id);
  const dataBuffer = coerceBlobBuffer(row.data);
  if (!blobId || !dataBuffer) {
    return undefined;
  }

  const observedAt = helpers.epochMillisToIso(baseTime + index * 1000) ?? new Date(baseTime + index * 1000).toISOString();
  const decodedText = extractReadableCursorBlobText(dataBuffer);
  if (!decodedText) {
    return undefined;
  }

  const structuredRecord = decodeStructuredCursorBlobRecord(blobId, decodedText, helpers);
  if (structuredRecord) {
    return {
      kind: "structured",
      blobId,
      observedAt,
      record: structuredRecord,
    };
  }

  return {
    kind: "text",
    blobId,
    observedAt,
    text: decodedText,
  };
}

function decodeStructuredCursorBlobRecord(
  blobId: string,
  decodedText: string,
  helpers: Pick<
    CursorRuntimeHelpers,
    | "safeJsonParse"
    | "isObject"
    | "extractGenericRole"
    | "extractGenericContentItems"
    | "extractRichTextText"
    | "extractTokenUsage"
    | "normalizeStopReason"
    | "asString"
    | "asNumber"
    | "coerceIso"
    | "epochMillisToIso"
  >,
): Record<string, unknown> | undefined {
  const jsonStart = decodedText.indexOf("{");
  const jsonEnd = decodedText.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd <= jsonStart) {
    return undefined;
  }

  const parsed = helpers.safeJsonParse(decodedText.slice(jsonStart, jsonEnd + 1));
  if (!helpers.isObject(parsed)) {
    return undefined;
  }

  const normalized = normalizeCursorBubbleRecord(parsed, undefined, helpers as CursorRuntimeHelpers);
  if (!normalized) {
    return undefined;
  }
  return {
    id: helpers.asString(normalized.record.id) ?? blobId,
    ...normalized.record,
  };
}

function extractReadableCursorBlobText(value: Buffer): string | undefined {
  const cleaned = value
    .toString("utf8")
    .replace(/[ --]/gu, "")
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function coerceBlobBuffer(value: unknown): Buffer | undefined {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  if (typeof value === "string") {
    return Buffer.from(value, "utf8");
  }
  return undefined;
}


function extractBubbleRefsFromComposer(value: unknown, helpers: CursorRuntimeHelpers): string[] {
  const refs = new Set<string>();

  const visit = (candidate: unknown, fieldHint?: string, depth = 0) => {
    if (depth > 6 || candidate === null || candidate === undefined) {
      return;
    }
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed.startsWith("bubbleId:")) {
        refs.add(trimmed);
      } else if (fieldHint?.includes("bubble") && trimmed) {
        refs.add(`bubbleId:${trimmed}`);
      }
      return;
    }
    if (Array.isArray(candidate)) {
      for (const entry of candidate) {
        visit(entry, fieldHint, depth + 1);
      }
      return;
    }
    if (!helpers.isObject(candidate)) {
      return;
    }

    const bubbleId = helpers.asString(candidate.bubbleId) ?? helpers.asString(candidate.id);
    if (bubbleId && fieldHint?.includes("bubble")) {
      refs.add(bubbleId.startsWith("bubbleId:") ? bubbleId : `bubbleId:${bubbleId}`);
    }

    for (const [key, entry] of Object.entries(candidate)) {
      visit(entry, key.toLowerCase(), depth + 1);
    }
  };

  visit(value);
  return [...refs];
}

function normalizeCursorBubbleRecord(
  value: Record<string, unknown>,
  defaultWorkingDirectory: string | undefined,
  helpers: CursorRuntimeHelpers,
): { observedAt?: string; record: Record<string, unknown> } | undefined {
  const role =
    helpers.extractGenericRole(value) ??
    (helpers.asNumber(value.type) === 1 ? "user" : helpers.asNumber(value.type) === 2 ? "assistant" : undefined);
  let content = helpers.extractGenericContentItems(value);
  if (content.length === 0) {
    const richText = helpers.asString(value.richText);
    const extractedText = richText ? helpers.extractRichTextText(richText) : undefined;
    if (extractedText) {
      content = [{ type: "text", text: extractedText }];
    }
  }
  if (!role && content.length === 0) {
    return undefined;
  }

  return {
    observedAt:
      helpers.coerceIso(value.createdAt) ??
      helpers.coerceIso(value.updatedAt) ??
      helpers.epochMillisToIso(helpers.asNumber(value.createdAt)) ??
      helpers.epochMillisToIso(helpers.asNumber(value.created)),
    record: {
      id: helpers.asString(value.bubbleId) ?? helpers.asString(value.id),
      role: role ?? "assistant",
      content,
      usage: helpers.extractTokenUsage(value),
      stopReason: helpers.normalizeStopReason(value.stopReason),
      cwd: defaultWorkingDirectory,
    },
  };
}

function parseCursorPromptHistoryEntries(
  rawValue: string | undefined,
  fallbackObservedAtBase: string,
  helpers: CursorRuntimeHelpers,
): Array<{ id: string; text: string; observedAt?: string }> {
  const parsed = helpers.safeJsonParse(rawValue);
  if (!Array.isArray(parsed)) {
    return [];
  }

  const baseTime = Date.parse(fallbackObservedAtBase);
  const entries: Array<{ id: string; text: string; observedAt?: string }> = [];

  parsed.forEach((entry, index) => {
    if (!helpers.isObject(entry)) {
      return;
    }
    const text =
      helpers.asString(entry.textDescription) ??
      helpers.asString(entry.text) ??
      helpers.asString(entry.prompt);
    if (!text?.trim()) {
      return;
    }
    entries.push({
      id: helpers.asString(entry.generationUUID) ?? helpers.asString(entry.id) ?? helpers.sha1(`${text}:${index}`),
      text,
      observedAt:
        helpers.epochMillisToIso(helpers.asNumber(entry.unixMs)) ??
        helpers.epochMillisToIso(baseTime + index * 1000),
    });
  });

  entries.sort((left, right) => (left.observedAt ?? "").localeCompare(right.observedAt ?? ""));
  return entries;
}

function extractCursorWorkspaceTitle(
  rowMap: Map<string, string>,
  helpers: CursorRuntimeHelpers,
): string | undefined {
  const parsed = helpers.safeJsonParse(rowMap.get("composer.composerData"));
  if (!helpers.isObject(parsed)) {
    return undefined;
  }

  return helpers
    .asArray(parsed.allComposers)
    .filter((composer): composer is Record<string, unknown> => helpers.isObject(composer))
    .map((composer) => ({
      title: helpers.asString(composer.name) ?? helpers.asString(composer.title),
      sortKey: helpers.firstDefinedNumber(
        helpers.asNumber(composer.lastUpdatedAt),
        helpers.asNumber(composer.createdAt),
      ) ?? 0,
    }))
    .filter((composer) => composer.title)
    .sort((left, right) => right.sortKey - left.sortKey)[0]?.title;
}
