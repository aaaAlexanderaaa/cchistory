import path from "node:path";
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
