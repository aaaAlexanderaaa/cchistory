import type { RawRecord } from "@cchistory/domain";

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
