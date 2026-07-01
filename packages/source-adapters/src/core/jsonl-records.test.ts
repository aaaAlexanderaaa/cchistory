import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { RawRecord, SourceDefinition } from "@cchistory/domain";
import { captureBlob, captureBlobStreaming } from "./parser.js";
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

test("captureBlobStreaming computes checksum, size_bytes, and content_max_timestamp without materializing the file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-capturestream-basic-"));
  try {
    const filePath = path.join(tempDir, "session.jsonl");
    const content = [
      '{"type":"message","timestamp":"2026-03-12T10:00:01.000Z"}',
      '{"type":"message","timestamp":"2026-03-12T10:00:02.000Z"}',
      '{"type":"message","timestamp":"2026-03-12T10:00:03.000Z"}',
    ].join("\n") + "\n";
    await writeFile(filePath, content, "utf8");
    const source: SourceDefinition = {
      id: "src-test-stream",
      slot_id: "test",
      family: "local_coding_agent",
      platform: "codex",
      display_name: "test stream",
      base_dir: tempDir,
    };
    const result = await captureBlobStreaming(source, "host-test", filePath, "run-stream-1");
    assert.equal(result.blob.checksum, createHash("sha1").update(content, "utf8").digest("hex"));
    assert.equal(result.blob.size_bytes, Buffer.byteLength(content, "utf8"));
    assert.equal(result.blob.content_max_timestamp, "2026-03-12T10:00:03.000Z");
    assert.ok(!("fileBuffer" in result), "streaming variant must not materialize fileBuffer");
    assert.ok(result.streamingLineReader, "streamingLineReader factory must be present");
    assert.ok(result.prefixReader, "prefixReader factory must be present");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("captureBlobStreaming: streamingLineReader yields the full file content across chunks", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-capturestream-yield-"));
  try {
    const filePath = path.join(tempDir, "session.jsonl");
    // ~12 MiB so the 4 MiB backing block forces multi-chunk iteration.
    const line = '{"type":"message","timestamp":"2026-03-12T10:00:01.000Z"}\n';
    const repeats = Math.ceil((12 * 1024 * 1024) / line.length);
    const content = line.repeat(repeats);
    await writeFile(filePath, content, "utf8");
    const source: SourceDefinition = {
      id: "src-test-stream-yield",
      slot_id: "test",
      family: "local_coding_agent",
      platform: "codex",
      display_name: "test stream yield",
      base_dir: tempDir,
    };
    const result = await captureBlobStreaming(source, "host-test", filePath, "run-stream-2");
    assert.equal(result.blob.size_bytes, Buffer.byteLength(content, "utf8"));

    const collected = Buffer.concat(await collectAllChunks(result.streamingLineReader!()));
    assert.equal(collected.toString("utf8"), content);
    assert.equal(createHash("sha1").update(collected).digest("hex"), result.blob.checksum);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("captureBlobStreaming: prefixReader returns the leading N bytes for append detection", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-capturestream-prefix-"));
  try {
    const filePath = path.join(tempDir, "session.jsonl");
    const line = '{"type":"message","timestamp":"2026-03-12T10:00:01.000Z"}\n';
    const repeats = Math.ceil((8 * 1024 * 1024) / line.length);
    const content = line.repeat(repeats);
    await writeFile(filePath, content, "utf8");
    const source: SourceDefinition = {
      id: "src-test-stream-prefix",
      slot_id: "test",
      family: "local_coding_agent",
      platform: "codex",
      display_name: "test stream prefix",
      base_dir: tempDir,
    };
    const result = await captureBlobStreaming(source, "host-test", filePath, "run-stream-3");
    const prefix = await result.prefixReader!(1024);
    assert.equal(prefix.toString("utf8"), content.slice(0, 1024));
    assert.equal(createHash("sha1").update(prefix).digest("hex"), createHash("sha1").update(content.slice(0, 1024)).digest("hex"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("captureBlobStreaming: hashPrefix returns incremental sha1 and the last byte of the prefix without allocating the whole prefix", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-capturestream-hashprefix-"));
  try {
    const filePath = path.join(tempDir, "session.jsonl");
    const line = '{"type":"message","timestamp":"2026-03-12T10:00:01.000Z"}\n';
    const repeats = Math.ceil((12 * 1024 * 1024) / line.length);
    const content = line.repeat(repeats);
    await writeFile(filePath, content, "utf8");
    const source: SourceDefinition = {
      id: "src-test-stream-hashprefix",
      slot_id: "test",
      family: "local_coding_agent",
      platform: "codex",
      display_name: "test stream hashprefix",
      base_dir: tempDir,
    };
    const result = await captureBlobStreaming(source, "host-test", filePath, "run-stream-hash");
    // Pick a prefix size that spans multiple 4 MiB backing blocks (5 MiB).
    const prefixBytes = 5 * 1024 * 1024;
    const { sha1: hashed, lastByte } = await result.hashPrefix(prefixBytes);
    const expectedPrefix = Buffer.from(content.slice(0, prefixBytes), "utf8");
    assert.equal(hashed, createHash("sha1").update(expectedPrefix).digest("hex"));
    assert.equal(lastByte, expectedPrefix[expectedPrefix.length - 1]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("captureBlobStreaming: hashPrefix returns null lastByte and the empty-buffer sha1 when bytes=0", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-capturestream-hashprefix-zero-"));
  try {
    const filePath = path.join(tempDir, "session.jsonl");
    const content = '{"type":"message","timestamp":"2026-03-12T10:00:01.000Z"}\n';
    await writeFile(filePath, content, "utf8");
    const source: SourceDefinition = {
      id: "src-test-stream-hashprefix-zero",
      slot_id: "test",
      family: "local_coding_agent",
      platform: "codex",
      display_name: "test stream hashprefix zero",
      base_dir: tempDir,
    };
    const result = await captureBlobStreaming(source, "host-test", filePath, "run-stream-hash-zero");
    const { sha1: hashed, lastByte } = await result.hashPrefix(0);
    assert.equal(hashed, createHash("sha1").update(Buffer.alloc(0)).digest("hex"));
    assert.equal(lastByte, null);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("captureBlobStreaming: readSuffix returns the bytes from offset to end-of-file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-capturestream-suffix-"));
  try {
    const filePath = path.join(tempDir, "session.jsonl");
    const line = '{"type":"message","timestamp":"2026-03-12T10:00:01.000Z"}\n';
    const repeats = Math.ceil((8 * 1024 * 1024) / line.length);
    const content = line.repeat(repeats);
    await writeFile(filePath, content, "utf8");
    const source: SourceDefinition = {
      id: "src-test-stream-suffix",
      slot_id: "test",
      family: "local_coding_agent",
      platform: "codex",
      display_name: "test stream suffix",
      base_dir: tempDir,
    };
    const result = await captureBlobStreaming(source, "host-test", filePath, "run-stream-suffix");
    const offset = Math.floor(content.length / 2);
    const suffix = await result.readSuffix(offset);
    assert.equal(suffix.toString("utf8"), content.slice(offset));
    // Offset at end-of-file yields empty Buffer.
    const empty = await result.readSuffix(content.length);
    assert.equal(empty.length, 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function collectAllChunks(chunks: AsyncGenerator<Buffer>): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for await (const chunk of chunks) {
    out.push(chunk);
  }
  return out;
}
