import { DatabaseSync } from "node:sqlite";
import { maxIso } from "@cchistory/domain";
import type { SourcePlatform } from "@cchistory/domain";
import type { ExtractedSessionSeed } from "../../core/conversation-seeds.js";

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

interface ZcodeRuntimeHelpers {
  asString(value: unknown): string | undefined;
  asNumber(value: unknown): number | undefined;
  isObject(value: unknown): value is Record<string, any>;
  safeJsonParse(value: string | undefined): unknown;
  epochMillisToIso(value: number | undefined): string | undefined;
  nowIso(): string;
  normalizeWorkspacePath(value: string): string | undefined;
}

interface ZcodeSessionRow {
  id: unknown;
  parent_id: unknown;
  directory: unknown;
  path: unknown;
  title: unknown;
  task_type: unknown;
  time_created: unknown;
  time_updated: unknown;
  time_archived: unknown;
  trace_id: unknown;
}

interface ZcodeMessageRow {
  id: unknown;
  session_id: unknown;
  time_created: unknown;
  time_updated: unknown;
  data: unknown;
}

interface ZcodePartRow {
  id: unknown;
  message_id: unknown;
  session_id: unknown;
  time_created: unknown;
  time_updated: unknown;
  data: unknown;
}

interface ZcodeSessionTaskLinkRow {
  parent_session_id: unknown;
  child_session_id: unknown;
  role: unknown;
  label: unknown;
  agent_type: unknown;
  model: unknown;
  status: unknown;
}

export function extractZcodeSqliteSeeds(
  platform: SourcePlatform,
  filePath: string,
  helpers: ZcodeRuntimeHelpers,
): ExtractedSessionSeed[] | undefined {
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    if (!tableExists(db, "session") || !tableExists(db, "message") || !tableExists(db, "part")) {
      return undefined;
    }

    const sessionRows = db.prepare(`
      SELECT id, parent_id, directory, path, title, task_type, time_created, time_updated, time_archived, trace_id
      FROM session
      ORDER BY time_created, id
    `).all() as unknown as ZcodeSessionRow[];
    const messageRows = db.prepare(`
      SELECT id, session_id, time_created, time_updated, data
      FROM message
      ORDER BY session_id, time_created, id
    `).all() as unknown as ZcodeMessageRow[];
    const partRows = db.prepare(`
      SELECT id, message_id, session_id, time_created, time_updated, data
      FROM part
      ORDER BY session_id, time_created, id
    `).all() as unknown as ZcodePartRow[];
    const taskLinkRows = tableExists(db, "session_task_link")
      ? db.prepare(`
          SELECT parent_session_id, child_session_id, role, label, agent_type, model, status
          FROM session_task_link
          ORDER BY time_created, child_session_id
        `).all() as unknown as ZcodeSessionTaskLinkRow[]
      : [];

    const partsByMessageId = groupRows(partRows, (row) => helpers.asString(row.message_id));
    const messagesBySessionId = groupRows(messageRows, (row) => helpers.asString(row.session_id));
    const relationByChildSessionId = new Map(
      taskLinkRows
        .map((row) => [helpers.asString(row.child_session_id), row] as const)
        .filter((entry): entry is readonly [string, ZcodeSessionTaskLinkRow] => Boolean(entry[0])),
    );

    const seeds = sessionRows
      .map((session) =>
        buildZcodeSessionSeed(platform, session, messagesBySessionId, partsByMessageId, relationByChildSessionId, helpers),
      )
      .filter((seed): seed is ExtractedSessionSeed => seed !== undefined);
    return seeds.length > 0 ? seeds : undefined;
  } finally {
    db.close();
  }
}

function buildZcodeSessionSeed(
  platform: SourcePlatform,
  session: ZcodeSessionRow,
  messagesBySessionId: Map<string, ZcodeMessageRow[]>,
  partsByMessageId: Map<string, ZcodePartRow[]>,
  relationByChildSessionId: Map<string, ZcodeSessionTaskLinkRow>,
  helpers: ZcodeRuntimeHelpers,
): ExtractedSessionSeed | undefined {
  const sourceSessionId = helpers.asString(session.id);
  if (!sourceSessionId) {
    return undefined;
  }

  const sessionId = `sess:${platform}:${sourceSessionId}`;
  const title = helpers.asString(session.title);
  const workingDirectory =
    normalizeZcodePath(helpers.asString(session.directory), helpers) ??
    normalizeZcodePath(helpers.asString(session.path), helpers);
  const createdAt = epochMillisToIso(session.time_created, helpers);
  const updatedAt = epochMillisToIso(session.time_updated, helpers) ?? createdAt;
  const relation = relationByChildSessionId.get(sourceSessionId);
  const model = helpers.asString(relation?.model);
  const parentUuid = helpers.asString(session.parent_id) ?? helpers.asString(relation?.parent_session_id);
  const agentId = helpers.asString(relation?.agent_type) ?? helpers.asString(relation?.role);
  const records: ExtractedSessionSeed["records"] = [
    {
      pointer: "meta",
      observedAt: createdAt ?? helpers.nowIso(),
      rawJson: JSON.stringify({
        id: sessionId,
        title,
        cwd: workingDirectory,
        model,
        parentId: parentUuid,
        agentId,
        isSidechain: Boolean(parentUuid),
        zcode: {
          source_session_id: sourceSessionId,
          task_type: helpers.asString(session.task_type),
          trace_id: helpers.asString(session.trace_id),
          relation_label: helpers.asString(relation?.label),
          relation_status: helpers.asString(relation?.status),
          archived_at: epochMillisToIso(session.time_archived, helpers),
        },
      }),
    },
  ];

  const messages = messagesBySessionId.get(sourceSessionId) ?? [];
  let latestActivityAt = updatedAt;
  for (const message of messages) {
    const messageParts = partsByMessageId.get(helpers.asString(message.id) ?? "") ?? [];
    const messageRecord = buildZcodeMessageRecord(message, messageParts, workingDirectory, helpers);
    if (!messageRecord) {
      continue;
    }
    latestActivityAt = maxIso(latestActivityAt, messageRecord.observedAt);
    latestActivityAt = maxIso(latestActivityAt, latestZcodeRowTimestamp(message, helpers));
    for (const part of messageParts) {
      latestActivityAt = maxIso(latestActivityAt, latestZcodeRowTimestamp(part, helpers));
    }
    records.push(messageRecord);
  }

  if (records.length <= 1) {
    return undefined;
  }

  return {
    sessionId,
    title,
    createdAt,
    updatedAt: latestActivityAt ?? records.at(-1)?.observedAt ?? updatedAt,
    model,
    workingDirectory,
    records,
  };
}

function buildZcodeMessageRecord(
  message: ZcodeMessageRow,
  parts: ZcodePartRow[],
  defaultWorkingDirectory: string | undefined,
  helpers: ZcodeRuntimeHelpers,
): ExtractedSessionSeed["records"][number] | undefined {
  const messageId = helpers.asString(message.id);
  const parsedMessage = parseJsonObject(helpers.asString(message.data), helpers);
  const role = helpers.asString(parsedMessage.role);
  const content: Record<string, unknown>[] = [];
  let usage: TokenUsageLike | undefined = normalizeZcodeTokenUsage(parsedMessage.tokens, parsedMessage, helpers);
  let stopReason = helpers.asString(parsedMessage.finish);

  for (const part of parts) {
    const parsedPart = parseJsonObject(helpers.asString(part.data), helpers);
    const partType = helpers.asString(parsedPart.type)?.trim();
    if (partType === "text") {
      const text = helpers.asString(parsedPart.text);
      if (text?.trim()) {
        content.push({ type: "text", text });
      }
      continue;
    }
    if (partType === "file") {
      const text = helpers.asString(parsedPart.text) ?? helpers.asString(parsedPart.name) ?? helpers.asString(parsedPart.path);
      if (text?.trim()) {
        content.push({ type: "text", text });
      }
      continue;
    }
    if (partType === "tool") {
      const toolContent = normalizeZcodeToolPart(parsedPart, helpers);
      content.push(...toolContent);
      continue;
    }
    if (partType === "step-finish") {
      usage = normalizeZcodeTokenUsage(parsedPart.tokens, parsedMessage, helpers) ?? usage;
      stopReason = helpers.asString(parsedPart.reason) ?? stopReason;
    }
  }

  if (!role && content.length === 0 && !usage) {
    return undefined;
  }

  const observedAt =
    epochMillisToIso(message.time_created, helpers) ??
    epochMillisToIso(parsedMessage.time && helpers.isObject(parsedMessage.time) ? parsedMessage.time.created : undefined, helpers) ??
    helpers.nowIso();
  const pathInfo = helpers.isObject(parsedMessage.path) ? parsedMessage.path : undefined;
  const contextSnapshot = helpers.isObject(parsedMessage.contextSnapshot) ? parsedMessage.contextSnapshot : undefined;
  const envInfo = helpers.isObject(contextSnapshot?.envInfo) ? contextSnapshot.envInfo : undefined;
  const cwd =
    normalizeZcodePath(helpers.asString(pathInfo?.cwd), helpers) ??
    normalizeZcodePath(helpers.asString(envInfo?.cwd), helpers) ??
    defaultWorkingDirectory;
  const model =
    helpers.asString(parsedMessage.modelID) ??
    (helpers.isObject(parsedMessage.model) ? helpers.asString(parsedMessage.model.modelID) : undefined);

  return {
    pointer: `message:${messageId ?? observedAt}`,
    observedAt,
    rawJson: JSON.stringify({
      id: messageId,
      role: role ?? "assistant",
      timestamp: observedAt,
      updatedAt: epochMillisToIso(message.time_updated, helpers),
      content,
      usage,
      stopReason,
      model,
      cwd,
      zcode: {
        parent_message_id: helpers.asString(parsedMessage.parentID),
        provider_id: helpers.asString(parsedMessage.providerID) ??
          (helpers.isObject(parsedMessage.model) ? helpers.asString(parsedMessage.model.providerID) : undefined),
        mode: helpers.asString(parsedMessage.mode),
        agent: helpers.asString(parsedMessage.agent),
      },
    }),
  };
}

function normalizeZcodeToolPart(
  parsedPart: Record<string, unknown>,
  helpers: ZcodeRuntimeHelpers,
): Record<string, unknown>[] {
  const state = helpers.isObject(parsedPart.state) ? parsedPart.state : undefined;
  const callId = helpers.asString(parsedPart.callID) ?? helpers.asString(parsedPart.callId) ?? helpers.asString(parsedPart.id);
  const toolName = helpers.asString(parsedPart.tool) ?? helpers.asString(parsedPart.name) ?? "tool";
  const status = helpers.asString(state?.status);
  const entries: Record<string, unknown>[] = [
    {
      type: "tool_call",
      id: callId,
      name: toolName,
      input: state?.input ?? parsedPart.input ?? {},
    },
  ];
  const output = state?.output ?? parsedPart.output ?? state?.error ?? parsedPart.error;
  if (status || output !== undefined) {
    entries.push({
      type: "tool_result",
      tool_use_id: callId,
      content: output ?? { status },
    });
  }
  return entries;
}

function normalizeZcodeTokenUsage(
  rawTokens: unknown,
  parsedMessage: Record<string, unknown>,
  helpers: ZcodeRuntimeHelpers,
): TokenUsageLike | undefined {
  if (!helpers.isObject(rawTokens)) {
    return undefined;
  }
  const cache = helpers.isObject(rawTokens.cache) ? rawTokens.cache : undefined;
  const usage: TokenUsageLike = {
    input_tokens: helpers.asNumber(rawTokens.input),
    output_tokens: helpers.asNumber(rawTokens.output),
    reasoning_output_tokens: helpers.asNumber(rawTokens.reasoning),
    total_tokens: helpers.asNumber(rawTokens.total),
    cache_read_input_tokens: helpers.asNumber(cache?.read),
    cache_creation_input_tokens: helpers.asNumber(cache?.write),
    model:
      helpers.asString(parsedMessage.modelID) ??
      (helpers.isObject(parsedMessage.model) ? helpers.asString(parsedMessage.model.modelID) : undefined),
  };
  const hasUsage = Object.entries(usage).some(([key, value]) => key !== "model" && typeof value === "number");
  return hasUsage ? usage : undefined;
}

function parseJsonObject(rawJson: string | undefined, helpers: ZcodeRuntimeHelpers): Record<string, unknown> {
  const parsed = helpers.safeJsonParse(rawJson);
  return helpers.isObject(parsed) ? parsed : {};
}

function epochMillisToIso(value: unknown, helpers: ZcodeRuntimeHelpers): string | undefined {
  return helpers.epochMillisToIso(helpers.asNumber(value));
}

function latestZcodeRowTimestamp(
  row: { time_created: unknown; time_updated: unknown },
  helpers: ZcodeRuntimeHelpers,
): string | undefined {
  return maxIso(epochMillisToIso(row.time_created, helpers), epochMillisToIso(row.time_updated, helpers));
}

function normalizeZcodePath(value: string | undefined, helpers: ZcodeRuntimeHelpers): string | undefined {
  return value ? helpers.normalizeWorkspacePath(value) : undefined;
}

function groupRows<T>(rows: T[], getKey: (row: T) => string | undefined): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = getKey(row);
    if (!key) {
      continue;
    }
    const existing = grouped.get(key) ?? [];
    existing.push(row);
    grouped.set(key, existing);
  }
  return grouped;
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?").get(tableName) as
    | { name?: unknown }
    | undefined;
  return typeof row?.name === "string";
}
