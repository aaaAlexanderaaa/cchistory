import type { SourcePlatform } from "@cchistory/domain";
import { minIso, maxIso } from "@cchistory/domain";

export interface ExtractedSessionSeed {
  sessionId: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  model?: string;
  workingDirectory?: string;
  records: Array<{
    pointer: string;
    observedAt?: string;
    rawJson: string;
  }>;
}

export interface ConversationSeedOptions {
  defaultSessionId?: string;
  defaultTitle?: string;
  defaultWorkingDirectory?: string;
}

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

export interface ConversationSeedHelpers {
  asString(value: unknown): string | undefined;
  asNumber(value: unknown): number | undefined;
  asArray(value: unknown): unknown[];
  isObject(value: unknown): value is Record<string, any>;
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
  stringifyToolContent(value: unknown): string;
}

export function collectConversationSeedsFromValue(
  platform: SourcePlatform,
  value: unknown,
  originHint: string,
  helpers: ConversationSeedHelpers,
  options: ConversationSeedOptions = {},
): ExtractedSessionSeed[] {
  const seedsById = new Map<string, ExtractedSessionSeed>();
  const seen = new Set<unknown>();

  const visit = (candidate: unknown, pathHint: string, depth: number, root = false) => {
    if (depth > 8 || candidate === null || candidate === undefined) {
      return;
    }
    if (typeof candidate === "object") {
      if (seen.has(candidate)) {
        return;
      }
      seen.add(candidate);
    }

    const seed = buildSeedFromCandidateValue(platform, candidate, pathHint, helpers, {
      defaultSessionId: root ? options.defaultSessionId : undefined,
      defaultTitle: root ? options.defaultTitle : undefined,
      defaultWorkingDirectory: options.defaultWorkingDirectory,
    });
    if (seed) {
      upsertExtractedSeed(seedsById, seed);
      return;
    }

    if (Array.isArray(candidate)) {
      for (const [index, entry] of candidate.entries()) {
        visit(entry, `${pathHint}[${index}]`, depth + 1);
      }
      return;
    }

    if (!helpers.isObject(candidate)) {
      return;
    }

    for (const [key, entry] of Object.entries(candidate)) {
      if (entry && typeof entry === "object") {
        visit(entry, `${pathHint}.${key}`, depth + 1);
      }
    }
  };

  visit(value, originHint, 0, true);
  return [...seedsById.values()];
}

export function normalizeMessageCandidate(
  value: unknown,
  helpers: ConversationSeedHelpers,
  defaultWorkingDirectory?: string,
): { observedAt?: string; record: Record<string, unknown> } | undefined {
  if (!helpers.isObject(value)) {
    return undefined;
  }

  const info = helpers.isObject(value.info) ? value.info : undefined;
  const message = helpers.isObject(value.message) ? value.message : undefined;
  const base = message ?? info ?? value;
  let content = helpers.extractGenericContentItems(base);
  if (content.length === 0 && Array.isArray(value.parts)) {
    content = helpers.extractGenericContentItems({ parts: value.parts });
  }
  if (content.length === 0) {
    const richText = helpers.asString(base.richText) ?? helpers.asString(value.richText);
    const extractedText = richText ? helpers.extractRichTextText(richText) : undefined;
    if (extractedText) {
      content = [{ type: "text", text: extractedText }];
    }
  }

  const role =
    helpers.extractGenericRole(base) ?? helpers.extractGenericRole(value) ?? helpers.extractGenericRole(info ?? {});
  if (!role && content.length === 0) {
    return undefined;
  }

  const observedAt =
    helpers.coerceIso(base.timestamp) ??
    helpers.coerceIso(base.createdAt) ??
    helpers.coerceIso(base.updatedAt) ??
    helpers.coerceIso(value.timestamp) ??
    helpers.coerceIso(info?.createdAt) ??
    helpers.epochMillisToIso(helpers.asNumber(base.timestamp)) ??
    helpers.epochMillisToIso(helpers.asNumber(base.createdAt)) ??
    helpers.epochMillisToIso(helpers.asNumber(base.created)) ??
    helpers.epochMillisToIso(helpers.asNumber(info?.createdAt)) ??
    helpers.epochMillisToIso(helpers.asNumber(info?.created)) ??
    helpers.epochMillisToIso(helpers.asNumber(value.createdAt));
  const meta = helpers.extractGenericSessionMetadata(value);
  const usage = helpers.extractTokenUsage(value) ?? helpers.extractTokenUsage(info) ?? helpers.extractTokenUsage(base);
  const stopReason =
    helpers.normalizeStopReason(base.stop_reason) ??
    helpers.normalizeStopReason(base.stopReason) ??
    helpers.normalizeStopReason(info?.stopReason) ??
    helpers.normalizeStopReason(value.stopReason);

  return {
    observedAt,
    record: {
      id: helpers.asString(base.id) ?? helpers.asString(value.id),
      role: role ?? "assistant",
      content,
      usage,
      stopReason,
      model: helpers.asString(base.model) ?? helpers.asString(info?.model) ?? helpers.asString(value.model),
      cwd: meta.workspacePath ?? defaultWorkingDirectory,
    },
  };
}

function buildSeedFromCandidateValue(
  platform: SourcePlatform,
  candidate: unknown,
  originHint: string,
  helpers: ConversationSeedHelpers,
  options: ConversationSeedOptions,
): ExtractedSessionSeed | undefined {
  const messageEntries = extractCandidateMessageEntries(candidate, helpers);
  if (!messageEntries || messageEntries.length === 0) {
    return undefined;
  }

  const normalizedMessages = messageEntries
    .map((entry) => normalizeMessageCandidate(entry, helpers, options.defaultWorkingDirectory))
    .filter((entry): entry is { observedAt?: string; record: Record<string, unknown> } => entry !== undefined);
  if (normalizedMessages.length === 0) {
    return undefined;
  }

  const meta = helpers.isObject(candidate) ? helpers.extractGenericSessionMetadata(candidate) : {};
  const sessionRefRaw =
    options.defaultSessionId ??
    (helpers.isObject(candidate)
      ? helpers.asString(candidate.id) ??
        helpers.asString(candidate.sessionId) ??
        helpers.asString(candidate.session_id) ??
        helpers.asString(candidate.conversationId) ??
        helpers.asString(candidate.conversation_id) ??
        helpers.asString(candidate.chatId) ??
        helpers.asString(candidate.chat_id) ??
        helpers.asString(candidate.composerId)
      : undefined) ??
    helpers.sha1(originHint);
  const sessionId = options.defaultSessionId ?? `sess:${platform}:${sessionRefRaw}`;
  const firstUserMessage = normalizedMessages.find((message) => helpers.asString(message.record.role) === "user");
  const title =
    options.defaultTitle ??
    meta.title ??
    (Array.isArray(firstUserMessage?.record.content)
      ? helpers.truncate(helpers.stringifyToolContent(firstUserMessage.record.content), 72)
      : undefined);
  const workingDirectory = meta.workspacePath ?? options.defaultWorkingDirectory;
  const model = meta.model ?? normalizedMessages.map((message) => helpers.asString(message.record.model)).find(Boolean);
  const createdAt =
    helpers.coerceIso(helpers.isObject(candidate) ? candidate.createdAt : undefined) ??
    helpers.coerceIso(helpers.isObject(candidate) ? candidate.created_at : undefined) ??
    helpers.epochMillisToIso(helpers.isObject(candidate) ? helpers.asNumber(candidate.createdAt) : undefined) ??
    normalizedMessages[0]?.observedAt;
  const updatedAt =
    helpers.coerceIso(helpers.isObject(candidate) ? candidate.updatedAt : undefined) ??
    helpers.coerceIso(helpers.isObject(candidate) ? candidate.updated_at : undefined) ??
    helpers.epochMillisToIso(helpers.isObject(candidate) ? helpers.asNumber(candidate.updatedAt) : undefined) ??
    normalizedMessages.at(-1)?.observedAt ??
    createdAt;

  const records: ExtractedSessionSeed["records"] = [];
  if (title || model || workingDirectory || meta.parentUuid || meta.isSidechain) {
    records.push({
      pointer: "meta",
      observedAt: createdAt ?? helpers.nowIso(),
      rawJson: JSON.stringify({
        id: sessionId,
        title,
        model,
        cwd: workingDirectory,
        parentUuid: meta.parentUuid,
        isSidechain: meta.isSidechain,
      }),
    });
  }

  normalizedMessages
    .sort((left, right) => (left.observedAt ?? "").localeCompare(right.observedAt ?? ""))
    .forEach((message, index) => {
      records.push({
        pointer: `messages[${index}]`,
        observedAt: message.observedAt ?? helpers.nowIso(),
        rawJson: JSON.stringify(message.record),
      });
    });

  const hasUserOrAssistant = normalizedMessages.some((message) => {
    const role = helpers.asString(message.record.role);
    return role === "user" || role === "assistant";
  });
  if (!hasUserOrAssistant) {
    return undefined;
  }

  return {
    sessionId,
    title,
    createdAt,
    updatedAt,
    model,
    workingDirectory,
    records,
  };
}

function extractCandidateMessageEntries(
  candidate: unknown,
  helpers: ConversationSeedHelpers,
): unknown[] | undefined {
  if (Array.isArray(candidate)) {
    return candidate.some((entry) => normalizeMessageCandidate(entry, helpers)) ? candidate : undefined;
  }
  if (!helpers.isObject(candidate)) {
    return undefined;
  }

  const directArrays = [
    candidate.messages,
    candidate.items,
    candidate.turns,
    candidate.history,
    candidate.entries,
    candidate.parts,
  ];
  for (const entry of directArrays) {
    if (Array.isArray(entry) && entry.some((item) => normalizeMessageCandidate(item, helpers))) {
      return entry;
    }
  }

  for (const mapping of [candidate.messageMap, candidate.mapping]) {
    if (!helpers.isObject(mapping)) {
      continue;
    }
    const values = Object.values(mapping).map((value) =>
      helpers.isObject(value) && helpers.isObject(value.message) ? value.message : value,
    );
    if (values.some((value) => normalizeMessageCandidate(value, helpers))) {
      return values;
    }
  }

  return undefined;
}

function upsertExtractedSeed(target: Map<string, ExtractedSessionSeed>, seed: ExtractedSessionSeed): void {
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


