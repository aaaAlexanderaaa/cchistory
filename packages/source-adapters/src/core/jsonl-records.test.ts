import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { RawRecord, SourceDefinition } from "@cchistory/domain";
import { captureBlob } from "./parser.js";
import {
  collectJsonlRecordsStreaming,
  extractContentMaxTimestamp,
  forEachNonEmptyTrimmedLineStreaming,
  firstNonEmptyTrimmedLineFromBuffer,
  isIncrementalJsonlPlatform,
} from "./jsonl-records.js";

async function* chunksFromBuffers(buffers: readonly Buffer[]): AsyncGenerator<Buffer> {
  for (const buffer of buffers) {
    yield buffer;
  }
}

function recordRawLines(records: readonly RawRecord[]): string[] {
  return records.map((record) => record.raw_json);
}

test("isIncrementalJsonlPlatform returns true for codex, claude_code, and factory_droid", () => {
  assert.equal(isIncrementalJsonlPlatform("codex"), true);
  assert.equal(isIncrementalJsonlPlatform("claude_code"), true);
  assert.equal(isIncrementalJsonlPlatform("factory_droid"), true);
  assert.equal(isIncrementalJsonlPlatform("amp"), false);
  assert.equal(isIncrementalJsonlPlatform("gemini"), false);
  assert.equal(isIncrementalJsonlPlatform("opencode"), false);
});

test("extractContentMaxTimestamp returns the last record's .timestamp for monotonic input", () => {
  const buffer = Buffer.from(
    [
      '{"type":"message","timestamp":"2026-03-12T10:00:01.000Z"}',
      '{"type":"message","timestamp":"2026-03-12T10:00:02.000Z"}',
      '{"type":"message","timestamp":"2026-03-12T10:00:03.000Z"}',
    ].join("\n") + "\n",
    "utf8",
  );
  assert.equal(extractContentMaxTimestamp(buffer), "2026-03-12T10:00:03.000Z");
});

test("extractContentMaxTimestamp takes MAX across last records when timestamps are non-monotonic", () => {
  const buffer = Buffer.from(
    [
      '{"timestamp":"2026-03-12T10:00:05.000Z"}',
      '{"timestamp":"2026-03-12T10:00:01.000Z"}',
      '{"timestamp":"2026-03-12T10:00:03.000Z"}',
      '{"timestamp":"2026-03-12T10:00:02.000Z"}',
      '{"timestamp":"2026-03-12T10:00:04.000Z"}',
    ].join("\n") + "\n",
    "utf8",
  );
  assert.equal(extractContentMaxTimestamp(buffer), "2026-03-12T10:00:05.000Z");
});

test("extractContentMaxTimestamp skips records lacking .timestamp", () => {
  const buffer = Buffer.from(
    [
      '{"type":"session_start"}',
      '{"type":"message","timestamp":"2026-03-12T10:00:01.000Z"}',
      '{"type":"summary"}',
      '{"type":"message","timestamp":"2026-03-12T10:00:05.000Z"}',
      '{"type":"end"}',
    ].join("\n") + "\n",
    "utf8",
  );
  assert.equal(extractContentMaxTimestamp(buffer), "2026-03-12T10:00:05.000Z");
});

test("extractContentMaxTimestamp skips malformed JSON lines", () => {
  const buffer = Buffer.from(
    [
      '{"timestamp":"2026-03-12T10:00:01.000Z"}',
      'this is not json',
      '{"timestamp":"2026-03-12T10:00:09.000Z"}',
    ].join("\n") + "\n",
    "utf8",
  );
  assert.equal(extractContentMaxTimestamp(buffer), "2026-03-12T10:00:09.000Z");
});

test("extractContentMaxTimestamp skips records with unparseable .timestamp", () => {
  const buffer = Buffer.from(
    [
      '{"timestamp":"not-a-date"}',
      '{"timestamp":"2026-03-12T10:00:01.000Z"}',
    ].join("\n") + "\n",
    "utf8",
  );
  assert.equal(extractContentMaxTimestamp(buffer), "2026-03-12T10:00:01.000Z");
});

test("extractContentMaxTimestamp returns undefined on empty buffer", () => {
  assert.equal(extractContentMaxTimestamp(Buffer.alloc(0)), undefined);
});

test("extractContentMaxTimestamp returns undefined when no qualifying records exist", () => {
  const buffer = Buffer.from(
    [
      '{"type":"session_start"}',
      '{"type":"summary"}',
      'not json',
    ].join("\n") + "\n",
    "utf8",
  );
  assert.equal(extractContentMaxTimestamp(buffer), undefined);
});

test("extractContentMaxTimestamp ignores records older than the cut when reading only the tail", () => {
  const headLine = '{"timestamp":"2020-01-01T00:00:00.000Z"}\n';
  const tailLines = [
    '{"timestamp":"2026-03-12T10:00:01.000Z"}',
    '{"timestamp":"2026-03-12T10:00:02.000Z"}',
  ].join("\n") + "\n";
  const buffer = Buffer.concat([
    Buffer.from(headLine.repeat(5000), "utf8"),
    Buffer.from(tailLines, "utf8"),
  ]);
  assert.equal(extractContentMaxTimestamp(buffer), "2026-03-12T10:00:02.000Z");
});

test("captureBlob populates content_max_timestamp for codex JSONL append-only files", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-captureblob-codex-"));
  try {
    const filePath = path.join(tempDir, "session.jsonl");
    const content = [
      '{"type":"message","timestamp":"2026-03-12T10:00:01.000Z"}',
      '{"type":"message","timestamp":"2026-03-12T10:00:02.000Z"}',
      '{"type":"message","timestamp":"2026-03-12T10:00:03.000Z"}',
    ].join("\n") + "\n";
    await writeFile(filePath, content, "utf8");
    const source: SourceDefinition = {
      id: "src-test-codex",
      slot_id: "test",
      family: "local_coding_agent",
      platform: "codex",
      display_name: "test codex",
      base_dir: tempDir,
    };
    const result = await captureBlob(source, "host-test", filePath, "run-1");
    assert.equal(result.blob.content_max_timestamp, "2026-03-12T10:00:03.000Z");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("captureBlob leaves content_max_timestamp undefined for non-incremental platforms", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-captureblob-amp-"));
  try {
    const filePath = path.join(tempDir, "history.jsonl");
    await writeFile(filePath, '{"timestamp":"2026-03-12T10:00:01.000Z"}\n', "utf8");
    const source: SourceDefinition = {
      id: "src-test-amp",
      slot_id: "test",
      family: "local_coding_agent",
      platform: "amp",
      display_name: "test amp",
      base_dir: tempDir,
    };
    const result = await captureBlob(source, "host-test", filePath, "run-1");
    assert.equal(result.blob.content_max_timestamp, undefined);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("firstNonEmptyTrimmedLineFromBuffer still works as the head-peek helper", () => {
  assert.equal(
    firstNonEmptyTrimmedLineFromBuffer(Buffer.from('{"head":true}\n{"tail":true}\n', "utf8")),
    '{"head":true}',
  );
});

test("forEachNonEmptyTrimmedLineStreaming emits one entry per non-empty trimmed line", async () => {
  const buffer = Buffer.from('  {"a":1}\n\n  {"b":2}\r\n{"c":3}\n  \n', "utf8");
  const lines: string[] = [];
  await forEachNonEmptyTrimmedLineStreaming(chunksFromBuffers([buffer]), (line) => lines.push(line));
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);
});

test("forEachNonEmptyTrimmedLineStreaming accumulates lines that span chunk boundaries", async () => {
  const full = '{"a":1}\n{"b":2}\n{"c":3}\n';
  const buffer = Buffer.from(full, "utf8");
  const halves = [buffer.subarray(0, 5), buffer.subarray(5, 11), buffer.subarray(11)];
  const lines: string[] = [];
  await forEachNonEmptyTrimmedLineStreaming(chunksFromBuffers(halves), (line) => lines.push(line));
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);
});

test("forEachNonEmptyTrimmedLineStreaming emits the trailing partial line at end-of-stream", async () => {
  const buffer = Buffer.from('{"a":1}\n{"b":2}', "utf8");
  const lines: string[] = [];
  await forEachNonEmptyTrimmedLineStreaming(chunksFromBuffers([buffer]), (line) => lines.push(line));
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
});

test("forEachNonEmptyTrimmedLineStreaming handles a single record larger than the backing block size", async () => {
  const huge = "{".concat("x".repeat(64 * 1024), "}");
  const buffer = Buffer.concat([Buffer.from(huge, "utf8"), Buffer.from("\n", "utf8")]);
  const pieces: Buffer[] = [];
  for (let offset = 0; offset < buffer.length; offset += 4096) {
    pieces.push(buffer.subarray(offset, Math.min(offset + 4096, buffer.length)));
  }
  const lines: string[] = [];
  await forEachNonEmptyTrimmedLineStreaming(chunksFromBuffers(pieces), (line) => lines.push(line));
  assert.deepEqual(lines, [huge]);
});

test("forEachNonEmptyTrimmedLineStreaming treats CRLF as a single separator", async () => {
  const buffer = Buffer.from('{"a":1}\r\n{"b":2}\r\n', "utf8");
  const lines: string[] = [];
  await forEachNonEmptyTrimmedLineStreaming(chunksFromBuffers([buffer]), (line) => lines.push(line));
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
});

test("collectJsonlRecordsStreaming mirrors collectJsonlRecords for a simple JSONL payload", async () => {
  const text = '{"a":1}\n{"b":2}\n{"c":3}\n';
  const chunks = chunksFromBuffers([Buffer.from(text, "utf8")]);
  const records = await collectJsonlRecordsStreaming(
    chunks,
    { sourceId: "src-1", blobId: "blob-1", sessionId: "session-1" },
    { observedAt: "2026-07-01T00:00:00.000Z" },
    {
      createRecordId: (ordinal, pointer) => `rec-${ordinal}-${pointer}`,
      pathExists: async () => false,
      readTextFile: async () => "",
      nowIso: () => "2026-07-01T00:00:00.000Z",
    },
  );
  assert.deepEqual(recordRawLines(records), ['{"a":1}', '{"b":2}', '{"c":3}']);
  assert.equal(records[0]!.ordinal, 0);
  assert.equal(records[2]!.ordinal, 2);
  assert.equal(records[0]!.session_ref, "session-1");
});
