import type { RawRecord, SourcePlatform } from "@cchistory/domain";

export interface JsonlRecordIdentity {
  sourceId: string;
  blobId: string;
  sessionId: string;
}

export interface JsonlSidecarSource {
  filePath: string;
  pointer: string;
  observedAt?: string;
}

export interface JsonlRecordCollectionOptions {
  observedAt?: string;
  sidecars?: readonly JsonlSidecarSource[];
}

export interface JsonlRecordHelpers {
  createRecordId(ordinal: number, pointer: string): string;
  pathExists(targetPath: string): Promise<boolean>;
  readTextFile(targetPath: string): Promise<string>;
  nowIso(): string;
}

export async function collectJsonlRecords(
  text: string,
  identity: JsonlRecordIdentity,
  options: JsonlRecordCollectionOptions,
  helpers: JsonlRecordHelpers,
): Promise<RawRecord[]> {
  const records: RawRecord[] = [];
  const observedAt = options.observedAt ?? helpers.nowIso();

  forEachNonEmptyTrimmedLine(text, (line, ordinal) => {
    records.push({
      id: helpers.createRecordId(ordinal, `${ordinal}`),
      source_id: identity.sourceId,
      blob_id: identity.blobId,
      session_ref: identity.sessionId,
      ordinal,
      record_path_or_offset: `${ordinal}`,
      observed_at: observedAt,
      parseable: true,
      raw_json: line,
    });
  });

  for (const sidecar of options.sidecars ?? []) {
    if (!(await helpers.pathExists(sidecar.filePath))) {
      continue;
    }
    records.push({
      id: helpers.createRecordId(records.length, sidecar.pointer),
      source_id: identity.sourceId,
      blob_id: identity.blobId,
      session_ref: identity.sessionId,
      ordinal: records.length,
      record_path_or_offset: sidecar.pointer,
      observed_at: sidecar.observedAt ?? helpers.nowIso(),
      parseable: true,
      raw_json: await helpers.readTextFile(sidecar.filePath),
    });
  }

  return records;
}

// Stage 3: streaming variant of collectJsonlRecords. Reads the file as
// Buffer chunks (line-boundary aware) instead of one big string, so the
// oversized JSONL capture path can collect records without materializing
// the whole file. \n and \r never appear inside a multi-byte UTF-8 sequence,
// so byte-level splitting is safe and we only decode at line granularity.
// Sidecars are not supported here — they are small enough to read in full
// after streaming the primary file, and the oversized capture path doesn't
// use them.
export async function collectJsonlRecordsStreaming(
  chunks: AsyncIterable<Buffer>,
  identity: JsonlRecordIdentity,
  options: JsonlRecordCollectionOptions,
  helpers: JsonlRecordHelpers,
): Promise<RawRecord[]> {
  const records: RawRecord[] = [];
  const observedAt = options.observedAt ?? helpers.nowIso();

  await forEachNonEmptyTrimmedLineStreaming(chunks, (line, ordinal) => {
    records.push({
      id: helpers.createRecordId(ordinal, `${ordinal}`),
      source_id: identity.sourceId,
      blob_id: identity.blobId,
      session_ref: identity.sessionId,
      ordinal,
      record_path_or_offset: `${ordinal}`,
      observed_at: observedAt,
      parseable: true,
      raw_json: line,
    });
  });

  for (const sidecar of options.sidecars ?? []) {
    if (!(await helpers.pathExists(sidecar.filePath))) {
      continue;
    }
    records.push({
      id: helpers.createRecordId(records.length, sidecar.pointer),
      source_id: identity.sourceId,
      blob_id: identity.blobId,
      session_ref: identity.sessionId,
      ordinal: records.length,
      record_path_or_offset: sidecar.pointer,
      observed_at: sidecar.observedAt ?? helpers.nowIso(),
      parseable: true,
      raw_json: await helpers.readTextFile(sidecar.filePath),
    });
  }

  return records;
}

export function firstNonEmptyTrimmedLineFromBuffer(fileBuffer: Buffer): string | undefined {
  let start = 0;

  for (let index = 0; index <= fileBuffer.length; index += 1) {
    const isEnd = index === fileBuffer.length;
    const byte = isEnd ? -1 : fileBuffer[index] ?? -1;
    if (!isEnd && byte !== 10 && byte !== 13) {
      continue;
    }

    let lineBuffer = fileBuffer.subarray(start, index);
    if (lineBuffer.length > 0 && lineBuffer[lineBuffer.length - 1] === 13) {
      lineBuffer = lineBuffer.subarray(0, lineBuffer.length - 1);
    }
    const line = lineBuffer.toString("utf8").trim();
    if (line) {
      return line;
    }

    if (byte === 13 && index + 1 < fileBuffer.length && fileBuffer[index + 1] === 10) {
      index += 1;
    }
    start = index + 1;
  }

  return undefined;
}

export function isIncrementalJsonlPlatform(platform: SourcePlatform): boolean {
  return platform === "codex" || platform === "claude_code" || platform === "factory_droid";
}

export function extractContentMaxTimestamp(
  fileBuffer: Buffer,
  options?: { maxLookback?: number; tailBytes?: number },
): string | undefined {
  const maxLookback = options?.maxLookback ?? 5;
  const tailBytes = options?.tailBytes ?? 65536;
  if (fileBuffer.length === 0) {
    return undefined;
  }
  const tailStart = Math.max(0, fileBuffer.length - tailBytes);
  const tail = fileBuffer.subarray(tailStart);
  let text = tail.toString("utf8");
  if (tailStart > 0) {
    const firstNewline = text.indexOf("\n");
    if (firstNewline === -1) {
      return undefined;
    }
    text = text.slice(firstNewline + 1);
  }
  const lines = text.split(/\r?\n/u);
  let bestMs: number | undefined;
  let bestIso: string | undefined;
  let consumed = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const trimmed = lines[index]!.trim();
    if (!trimmed) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (consumed < maxLookback) {
      consumed += 1;
    } else {
      break;
    }
    const candidate = typeof parsed === "object" && parsed !== null
      ? (parsed as { timestamp?: unknown }).timestamp
      : undefined;
    if (typeof candidate !== "string" || candidate.length === 0) {
      continue;
    }
    const ms = Date.parse(candidate);
    if (Number.isNaN(ms)) {
      continue;
    }
    if (bestMs === undefined || ms > bestMs) {
      bestMs = ms;
      bestIso = candidate;
    }
  }
  return bestIso;
}

function forEachNonEmptyTrimmedLine(
  value: string,
  visitor: (line: string, ordinal: number) => void,
): void {
  let start = 0;
  let ordinal = 0;

  for (let index = 0; index <= value.length; index += 1) {
    const isEnd = index === value.length;
    const charCode = isEnd ? -1 : value.charCodeAt(index);
    if (!isEnd && charCode !== 10 && charCode !== 13) {
      continue;
    }

    const line = value.slice(start, index).trim();
    if (line) {
      visitor(line, ordinal);
      ordinal += 1;
    }

    if (charCode === 13 && index + 1 < value.length && value.charCodeAt(index + 1) === 10) {
      index += 1;
    }
    start = index + 1;
  }
}

// Stage 3: streaming counterpart of forEachNonEmptyTrimmedLine. Iterates
// Buffer chunks, accumulates partial lines across chunk boundaries, and
// invokes the visitor once per non-empty trimmed line. \n and \r are
// single-byte ASCII separators that never appear inside multi-byte UTF-8
// sequences, so byte-level scanning is safe; UTF-8 decoding happens only on
// complete line buffers via .toString("utf8").
export async function forEachNonEmptyTrimmedLineStreaming(
  chunks: AsyncIterable<Buffer>,
  visitor: (line: string, ordinal: number) => void,
): Promise<void> {
  let pending: Uint8Array = new Uint8Array(0);
  let ordinal = 0;

  for await (const chunk of chunks) {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);

    let lineStart = 0;
    for (let index = 0; index < pending.length; index += 1) {
      const byte = pending[index]!;
      if (byte !== 10 && byte !== 13) {
        continue;
      }
      const lineBuffer = Buffer.from(pending.subarray(lineStart, index));
      const line = lineBuffer.toString("utf8").trim();
      if (line) {
        visitor(line, ordinal);
        ordinal += 1;
      }
      // Treat \r\n as a single separator by skipping the trailing \n.
      if (byte === 13 && index + 1 < pending.length && pending[index + 1] === 10) {
        index += 1;
      }
      lineStart = index + 1;
    }

    pending = pending.subarray(lineStart);
  }

  if (pending.length > 0) {
    const line = Buffer.from(pending).toString("utf8").trim();
    if (line) {
      visitor(line, ordinal);
    }
  }
}
