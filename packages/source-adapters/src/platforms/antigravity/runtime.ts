import path from "node:path";
import { promises as fs } from "node:fs";
import type { ExtractedSessionSeed } from "../../core/conversation-seeds.js";

interface UnknownProtobufField {
  field_number: number;
  wire_type: 0 | 1 | 2 | 5;
  value: number | Buffer;
}

interface AntigravityRuntimeHelpers {
  readOptionalJsonFile(targetPath: string): Promise<Record<string, unknown> | undefined>;
  extractMarkdownHeading(text: string): string | undefined;
  pathExists(targetPath: string): Promise<boolean>;
  coerceIso(value: unknown): string | undefined;
  asString(value: unknown): string | undefined;
  nowIso(): string;
  normalizeWorkspacePath(value: string): string | undefined;
}

type AntigravityHistoryResourceKind = "task" | "implementation_plan" | "conversation_history";

export async function extractAntigravityBrainSeed(
  filePath: string,
  fileBuffer: Buffer,
  helpers: AntigravityRuntimeHelpers,
): Promise<ExtractedSessionSeed | undefined> {
  const fileName = path.basename(filePath);
  if (fileName === "task.md") {
    return extractAntigravityTaskSeed(filePath, fileBuffer, helpers);
  }
  if (/^Conversation_.*_History\.md$/u.test(fileName)) {
    return extractAntigravityConversationHistorySeed(filePath, fileBuffer, helpers);
  }
  return undefined;
}

async function extractAntigravityTaskSeed(
  filePath: string,
  fileBuffer: Buffer,
  helpers: AntigravityRuntimeHelpers,
): Promise<ExtractedSessionSeed | undefined> {
  const sessionDir = path.dirname(filePath);
  const sessionId = path.basename(sessionDir);
  if (!sessionId) {
    return undefined;
  }

  const taskText = fileBuffer.toString("utf8").trim();
  if (!taskText) {
    return undefined;
  }

  const taskMetadata = await helpers.readOptionalJsonFile(path.join(sessionDir, "task.md.metadata.json"));
  const updatedAt = helpers.coerceIso(taskMetadata?.updatedAt) ?? helpers.nowIso();
  const title = helpers.extractMarkdownHeading(taskText) ?? helpers.asString(taskMetadata?.summary) ?? "Antigravity task";
  const records: ExtractedSessionSeed["records"] = [
    {
      pointer: "task.md",
      observedAt: updatedAt,
      rawJson: JSON.stringify({
        role: "system",
        title,
        updatedAt,
        content: taskText,
      }),
    },
  ];

  for (const companionFile of ["walkthrough.md", "implementation_plan.md", "project_review.md", "research_quality_review.md"]) {
    const companionPath = path.join(sessionDir, companionFile);
    if (!(await helpers.pathExists(companionPath))) {
      continue;
    }
    const companionText = (await fs.readFile(companionPath, "utf8")).trim();
    if (!companionText) {
      continue;
    }
    const companionMetadata = await helpers.readOptionalJsonFile(`${companionPath}.metadata.json`);
    records.push({
      pointer: companionFile,
      observedAt: helpers.coerceIso(companionMetadata?.updatedAt) ?? updatedAt,
      rawJson: JSON.stringify({
        role: "assistant",
        title: helpers.extractMarkdownHeading(companionText) ?? title,
        updatedAt: helpers.coerceIso(companionMetadata?.updatedAt) ?? updatedAt,
        content: companionText,
      }),
    });
  }

  return {
    sessionId: `sess:antigravity:${sessionId}`,
    title,
    createdAt: updatedAt,
    updatedAt,
    records,
  };
}

export async function extractAntigravityHistorySeed(
  filePath: string,
  fileBuffer: Buffer,
  helpers: AntigravityRuntimeHelpers,
): Promise<ExtractedSessionSeed | undefined> {
  const parsed = parseAntigravityHistoryIndex(fileBuffer);
  if (!parsed) {
    return undefined;
  }
  const resource = parsed.resource.replace(/\\/g, "/");
  const resourceInfo = resolveAntigravityHistoryResource(resource);
  if (!resourceInfo) {
    return undefined;
  }

  const records: ExtractedSessionSeed["records"] = [];
  let sessionId = resourceInfo.sessionId;

  for (const entry of parsed.entries) {
    const snapshotPath = path.join(path.dirname(filePath), entry.id);
    let snapshotText: string;
    try {
      snapshotText = (await fs.readFile(snapshotPath, "utf8")).trim();
    } catch {
      continue;
    }
    if (!snapshotText) {
      continue;
    }

    if (resourceInfo.kind === "conversation_history") {
      const conversationId = extractAntigravityConversationId(snapshotText);
      if (!conversationId) {
        continue;
      }
      sessionId = conversationId;
    }

    const prompt = extractAntigravityPromptCandidate(snapshotText, resourceInfo.kind);
    if (!prompt) {
      continue;
    }

    const observedAt = new Date(entry.timestamp).toISOString();
    records.push({
      pointer: `history:${path.basename(resourceInfo.resourcePath)}:${entry.id}`,
      observedAt,
      rawJson: JSON.stringify({
        id: `sess:antigravity:${sessionId}:history:${entry.id}`,
        role: "user",
        content: prompt,
        createdAt: observedAt,
        updatedAt: observedAt,
      }),
    });
  }

  if (records.length === 0) {
    return undefined;
  }

  records.sort((left, right) => (left.observedAt ?? "").localeCompare(right.observedAt ?? ""));
  const title = resourceInfo.kind === "conversation_history"
    ? deriveAntigravityConversationTitleFromRecord(records[0]?.rawJson)
    : undefined;

  return {
    sessionId: `sess:antigravity:${sessionId}`,
    title,
    createdAt: records[0]?.observedAt,
    updatedAt: records[records.length - 1]?.observedAt,
    records,
  };
}

async function extractAntigravityConversationHistorySeed(
  filePath: string,
  fileBuffer: Buffer,
  helpers: AntigravityRuntimeHelpers,
): Promise<ExtractedSessionSeed | undefined> {
  const historyText = fileBuffer.toString("utf8").trim();
  if (!historyText) {
    return undefined;
  }

  const sessionId = extractAntigravityConversationId(historyText);
  if (!sessionId) {
    return undefined;
  }

  const observedAt = await readAntigravityArtifactObservedAt(filePath, helpers);
  const rawTitle = helpers.extractMarkdownHeading(historyText) ?? `Conversation ${sessionId}`;
  const title = rawTitle.replace(/^Conversation History:\s*/u, "").trim() || rawTitle;
  const objective = extractAntigravityPromptCandidate(historyText, "conversation_history");
  const records: ExtractedSessionSeed["records"] = [
    {
      pointer: path.basename(filePath),
      observedAt,
      rawJson: JSON.stringify({
        role: "system",
        title,
        updatedAt: observedAt,
        content: historyText,
      }),
    },
  ];

  if (objective) {
    records.push({
      pointer: `${path.basename(filePath)}:objective`,
      observedAt,
      rawJson: JSON.stringify({
        id: `sess:antigravity:${sessionId}:conversation_history_objective`,
        role: "user",
        content: objective,
        createdAt: observedAt,
        updatedAt: observedAt,
      }),
    });
  }

  return {
    sessionId: `sess:antigravity:${sessionId}`,
    title,
    createdAt: observedAt,
    updatedAt: observedAt,
    records,
  };
}

export function isAntigravityTrajectoryKey(storageKey: string): boolean {
  return (
    storageKey === "antigravityUnifiedStateSync.trajectorySummaries" ||
    storageKey === "unifiedStateSync.trajectorySummaries"
  );
}

export function extractAntigravityTrajectorySeeds(
  storageKey: string,
  encodedValue: string,
  helpers: Pick<AntigravityRuntimeHelpers, "nowIso" | "normalizeWorkspacePath">,
): ExtractedSessionSeed[] {
  const outerFields = parseUnknownProtobufBase64(encodedValue);
  if (!outerFields) {
    return [];
  }

  const seeds: ExtractedSessionSeed[] = [];
  for (const trajectoryMessage of getUnknownProtobufMessages(outerFields, 1)) {
    const trajectoryFields = parseUnknownProtobuf(trajectoryMessage);
    const trajectoryId = getUnknownProtobufString(trajectoryFields, 1);
    const wrapperMessage = getUnknownProtobufMessage(trajectoryFields, 2);
    if (!trajectoryId || !wrapperMessage) {
      continue;
    }

    const wrapperFields = parseUnknownProtobuf(wrapperMessage);
    const innerPayloadBase64 = getUnknownProtobufString(wrapperFields, 1);
    const innerFields = innerPayloadBase64 ? parseUnknownProtobufBase64(innerPayloadBase64) : undefined;
    if (!innerFields) {
      continue;
    }

    const title = getUnknownProtobufString(innerFields, 1) ?? `Antigravity trajectory ${trajectoryId}`;
    const createdAt =
      getUnknownProtobufTimestamp(innerFields, 7) ??
      getUnknownProtobufTimestamp(innerFields, 3);
    const updatedAt =
      getUnknownProtobufTimestamp(innerFields, 10) ??
      getUnknownProtobufTimestamp(innerFields, 3) ??
      createdAt;
    const workspaceMessage = getUnknownProtobufMessage(innerFields, 9);
    const workspacePath = workspaceMessage
      ? helpers.normalizeWorkspacePath(getUnknownProtobufString(parseUnknownProtobuf(workspaceMessage), 1) ?? "")
      : undefined;
    const sessionId = `sess:antigravity:${trajectoryId}`;

    seeds.push({
      sessionId,
      title,
      createdAt,
      updatedAt,
      workingDirectory: workspacePath,
      records: [
        {
          pointer: `${storageKey}:meta`,
          observedAt: createdAt ?? updatedAt ?? helpers.nowIso(),
          rawJson: JSON.stringify({
            id: sessionId,
            title,
            cwd: workspacePath,
          }),
        },
      ],
    });
  }

  return seeds;
}

interface AntigravityHistoryIndexEntry {
  id: string;
  timestamp: number;
}

function parseAntigravityHistoryIndex(
  fileBuffer: Buffer,
): { resource: string; entries: AntigravityHistoryIndexEntry[] } | undefined {
  try {
    const parsed = JSON.parse(fileBuffer.toString("utf8")) as {
      resource?: unknown;
      entries?: Array<{ id?: unknown; timestamp?: unknown }>;
    };
    if (typeof parsed.resource !== "string" || !Array.isArray(parsed.entries)) {
      return undefined;
    }
    const entries = parsed.entries
      .map((entry) => ({
        id: typeof entry?.id === "string" ? entry.id : undefined,
        timestamp: typeof entry?.timestamp === "number" ? entry.timestamp : undefined,
      }))
      .filter((entry): entry is AntigravityHistoryIndexEntry => !!entry.id && typeof entry.timestamp === "number")
      .sort((left, right) => left.timestamp - right.timestamp);
    return entries.length > 0 ? { resource: parsed.resource, entries } : undefined;
  } catch {
    return undefined;
  }
}

function resolveAntigravityHistoryResource(
  resource: string,
): { sessionId: string; kind: AntigravityHistoryResourceKind; resourcePath: string } | undefined {
  const taskMatch = resource.match(/\/brain\/([0-9a-f-]{36})\/task\.md$/iu);
  const taskSessionId = taskMatch?.[1];
  if (taskSessionId) {
    return {
      sessionId: taskSessionId,
      kind: "task",
      resourcePath: resource,
    };
  }
  const implementationPlanMatch = resource.match(/\/brain\/([0-9a-f-]{36})\/implementation_plan\.md$/iu);
  const implementationPlanSessionId = implementationPlanMatch?.[1];
  if (implementationPlanSessionId) {
    return {
      sessionId: implementationPlanSessionId,
      kind: "implementation_plan",
      resourcePath: resource,
    };
  }
  const conversationHistoryMatch = resource.match(/\/brain\/([0-9a-f-]{36})\/Conversation_.*_History\.md$/iu);
  const conversationHistorySessionId = conversationHistoryMatch?.[1];
  if (conversationHistorySessionId) {
    return {
      sessionId: conversationHistorySessionId,
      kind: "conversation_history",
      resourcePath: resource,
    };
  }
  return undefined;
}

function parseUnknownProtobufBase64(encodedValue: string): UnknownProtobufField[] | undefined {
  try {
    return parseUnknownProtobuf(Buffer.from(encodedValue, "base64"));
  } catch {
    return undefined;
  }
}

async function readAntigravityArtifactObservedAt(
  filePath: string,
  helpers: Pick<AntigravityRuntimeHelpers, "readOptionalJsonFile" | "coerceIso" | "nowIso">,
): Promise<string> {
  const metadata = await helpers.readOptionalJsonFile(`${filePath}.metadata.json`);
  const metadataTimestamp =
    helpers.coerceIso(metadata?.updatedAt) ??
    helpers.coerceIso(metadata?.createdAt);
  if (metadataTimestamp) {
    return metadataTimestamp;
  }
  try {
    return (await fs.stat(filePath)).mtime.toISOString();
  } catch {
    return helpers.nowIso();
  }
}

function extractAntigravityMarkdownSection(markdown: string, heading: string): string | undefined {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let sectionStart = -1;
  for (const [index, line] of lines.entries()) {
    if (line.trim() === `## ${heading}`) {
      sectionStart = index + 1;
      break;
    }
  }
  if (sectionStart < 0) {
    return undefined;
  }

  const sectionLines: string[] = [];
  for (let index = sectionStart; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.startsWith("## ")) {
      break;
    }
    sectionLines.push(line);
  }

  const sectionText = sectionLines.join("\n").trim();
  return sectionText || undefined;
}

function extractAntigravityConversationId(markdown: string): string | undefined {
  return markdown.match(/^\*\*Conversation ID\*\*:\s*([0-9a-f-]{36})\s*$/imu)?.[1];
}

function extractAntigravityPromptCandidate(
  markdown: string,
  kind: AntigravityHistoryResourceKind | "task",
): string | undefined {
  const sectionCandidate =
    kind === "conversation_history"
      ? extractAntigravityMarkdownSection(markdown, "Objective")
      : extractAntigravityPreferredSection(markdown, ["Objective", "Goal", "Main Objective", "User Request", "Prompt", "Context", "Overview"]);
  const candidate = normalizeAntigravityPromptText(sectionCandidate ?? extractAntigravityLeadParagraph(markdown));
  if (!candidate || isAntigravityDiscardedPrompt(candidate)) {
    return undefined;
  }
  return candidate;
}

function extractAntigravityPreferredSection(markdown: string, headings: string[]): string | undefined {
  for (const heading of headings) {
    const section = extractAntigravityMarkdownSection(markdown, heading);
    if (section) {
      return section;
    }
  }
  return undefined;
}

function extractAntigravityLeadParagraph(markdown: string): string | undefined {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let seenHeading = false;
  const paragraphLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!seenHeading) {
      if (trimmed.startsWith("# ")) {
        seenHeading = true;
      }
      continue;
    }
    if (!trimmed) {
      if (paragraphLines.length > 0) {
        break;
      }
      continue;
    }
    if (
      trimmed.startsWith("#") ||
      trimmed.startsWith("- ") ||
      /^\d+\./u.test(trimmed) ||
      trimmed.startsWith("|")
    ) {
      if (paragraphLines.length > 0) {
        break;
      }
      continue;
    }
    paragraphLines.push(trimmed);
  }

  return paragraphLines.length > 0 ? paragraphLines.join(" ") : undefined;
}

function normalizeAntigravityPromptText(text: string | undefined): string | undefined {
  const normalized = text
    ?.replace(/^>\s*/gmu, "")
    .replace(/\*\*/gu, "")
    .replace(/`/gu, "")
    .replace(/\n---[\s\S]*$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized ? normalized.replace(/^(Goal|Objective|Main Objective|User Request|Prompt|Context|Overview)\s*:\s*/iu, "").trim() : undefined;
}

function isAntigravityDiscardedPrompt(text: string): boolean {
  return [
    /^---$/iu,
    /^\[!IMPORTANT\]/iu,
    /^Review Date:/iu,
    /^Date:/iu,
    /^Scope:/iu,
    /^Status:/iu,
    /^Note:/iu,
    /^All tasks completed/iu,
    /^Progress:/iu,
    /^Key Changes/iu,
    /^Root cause:/iu,
    /^This walkthrough/iu,
    /^I have /iu,
    /^I've /iu,
    /^Successfully /iu,
    /^Completed /iu,
    /^Created /iu,
    /^Implemented /iu,
    /^Enhanced /iu,
    /^Expanded /iu,
    /^Fixed /iu,
    /^Restructured /iu,
    /^Analyzed /iu,
    /^Built /iu,
    /^Research Method:/iu,
    /^Purpose:/iu,
    /^The honest answer/iu,
    /^Previous research /iu,
    /^Additional files /iu,
  ].some((pattern) => pattern.test(text));
}

function deriveAntigravityConversationTitleFromRecord(rawJson: string | undefined): string | undefined {
  if (!rawJson) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(rawJson) as { content?: unknown };
    const content = typeof parsed.content === "string" ? parsed.content : undefined;
    return content ? content.slice(0, 72) : undefined;
  } catch {
    return undefined;
  }
}

function parseUnknownProtobuf(buffer: Buffer): UnknownProtobufField[] {
  const fields: UnknownProtobufField[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const key = readUnknownProtobufVarint(buffer, offset);
    const fieldNumber = key.value >>> 3;
    const wireType = key.value & 0x07;
    offset = key.offset;

    if (wireType === 0) {
      const value = readUnknownProtobufVarint(buffer, offset);
      fields.push({ field_number: fieldNumber, wire_type: 0, value: value.value });
      offset = value.offset;
      continue;
    }

    if (wireType === 1) {
      if (offset + 8 > buffer.length) {
        throw new Error("Invalid fixed64 protobuf field");
      }
      fields.push({ field_number: fieldNumber, wire_type: 1, value: buffer.subarray(offset, offset + 8) });
      offset += 8;
      continue;
    }

    if (wireType === 2) {
      const length = readUnknownProtobufVarint(buffer, offset);
      offset = length.offset;
      if (offset + length.value > buffer.length) {
        throw new Error("Invalid length-delimited protobuf field");
      }
      fields.push({
        field_number: fieldNumber,
        wire_type: 2,
        value: buffer.subarray(offset, offset + length.value),
      });
      offset += length.value;
      continue;
    }

    if (wireType === 5) {
      if (offset + 4 > buffer.length) {
        throw new Error("Invalid fixed32 protobuf field");
      }
      fields.push({ field_number: fieldNumber, wire_type: 5, value: buffer.subarray(offset, offset + 4) });
      offset += 4;
      continue;
    }

    throw new Error(`Unsupported protobuf wire type ${wireType}`);
  }

  return fields;
}

function readUnknownProtobufVarint(
  buffer: Buffer,
  initialOffset: number,
): { value: number; offset: number } {
  let value = 0;
  let shift = 0;
  let offset = initialOffset;

  while (offset < buffer.length) {
    const byte = buffer[offset];
    if (byte === undefined) {
      break;
    }
    value |= (byte & 0x7f) << shift;
    offset += 1;
    if ((byte & 0x80) === 0) {
      return { value, offset };
    }
    shift += 7;
    if (shift > 49) {
      throw new Error("Unsupported large protobuf varint");
    }
  }

  throw new Error("Unexpected end of protobuf varint");
}

function getUnknownProtobufMessage(fields: UnknownProtobufField[], fieldNumber: number): Buffer | undefined {
  const field = fields.find((candidate) => candidate.field_number === fieldNumber && candidate.wire_type === 2);
  return field && Buffer.isBuffer(field.value) ? field.value : undefined;
}

function getUnknownProtobufMessages(fields: UnknownProtobufField[], fieldNumber: number): Buffer[] {
  return fields
    .filter((candidate) => candidate.field_number === fieldNumber && candidate.wire_type === 2)
    .map((candidate) => candidate.value)
    .filter((value): value is Buffer => Buffer.isBuffer(value));
}

function getUnknownProtobufString(fields: UnknownProtobufField[], fieldNumber: number): string | undefined {
  const value = getUnknownProtobufMessage(fields, fieldNumber);
  if (!value) {
    return undefined;
  }
  const text = value.toString("utf8").trim();
  return text || undefined;
}

function getUnknownProtobufTimestamp(fields: UnknownProtobufField[], fieldNumber: number): string | undefined {
  const timestampBuffer = getUnknownProtobufMessage(fields, fieldNumber);
  if (!timestampBuffer) {
    return undefined;
  }
  const timestampFields = parseUnknownProtobuf(timestampBuffer);
  const seconds = timestampFields.find(
    (candidate): candidate is UnknownProtobufField & { value: number } =>
      candidate.field_number === 1 && candidate.wire_type === 0 && typeof candidate.value === "number",
  )?.value;
  const nanos = timestampFields.find(
    (candidate): candidate is UnknownProtobufField & { value: number } =>
      candidate.field_number === 2 && candidate.wire_type === 0 && typeof candidate.value === "number",
  )?.value;
  if (typeof seconds !== "number") {
    return undefined;
  }
  return new Date(seconds * 1000 + Math.floor((nanos ?? 0) / 1_000_000)).toISOString();
}
