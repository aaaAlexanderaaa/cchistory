import path from "node:path";
import { promises as fs } from "node:fs";
import type { ExtractedSessionSeed } from "../../core/legacy.js";

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

export async function extractAntigravityBrainSeed(
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

function parseUnknownProtobufBase64(encodedValue: string): UnknownProtobufField[] | undefined {
  try {
    return parseUnknownProtobuf(Buffer.from(encodedValue, "base64"));
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
