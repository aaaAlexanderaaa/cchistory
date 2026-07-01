import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { materializeBytesStream } from "../evidence-store.js";

async function* chunksFromBuffer(source: Buffer, chunkSize: number): AsyncGenerator<Buffer> {
  for (let offset = 0; offset < source.length; offset += chunkSize) {
    yield source.subarray(offset, Math.min(offset + chunkSize, source.length));
  }
}

test("materializeBytesStream computes sha256 incrementally and writes the blob via atomic rename", async () => {
  const assetDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-materialize-stream-basic-"));
  try {
    const payload = Buffer.from(
      [
        '{"type":"message","timestamp":"2026-03-12T10:00:01.000Z"}',
        '{"type":"message","timestamp":"2026-03-12T10:00:02.000Z"}',
      ].join("\n") + "\n",
      "utf8",
    );
    const result = await materializeBytesStream({
      assetDir,
      chunks: chunksFromBuffer(payload, 16),
      mediaType: "application/jsonl",
      captureKind: "source_blob",
      createdAt: "2026-07-01T00:00:00.000Z",
    });
    const expectedSha = createHash("sha256").update(payload).digest("hex");
    assert.equal(result.sha256, expectedSha);
    assert.equal(result.sizeBytes, payload.byteLength);
    assert.equal(result.bytes, undefined, "streaming variant must not retain bytes in heap");

    const expectedPath = path.join(assetDir, "evidence", "blobs", expectedSha.slice(0, 2), expectedSha);
    assert.ok(existsSync(expectedPath), "blob file must exist after materialization");
    assert.ok(!existsSync(`${expectedPath}.partial`), ".partial file must be cleaned up");
    const written = await readFile(expectedPath);
    assert.equal(written.toString("utf8"), payload.toString("utf8"));
  } finally {
    await rm(assetDir, { recursive: true, force: true });
  }
});

test("materializeBytesStream is idempotent when the target blob already exists", async () => {
  const assetDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-materialize-stream-idempotent-"));
  try {
    const payload = Buffer.from("first-content\n".repeat(64), "utf8");
    const first = await materializeBytesStream({
      assetDir,
      chunks: chunksFromBuffer(payload, 32),
      mediaType: "application/octet-stream",
      captureKind: "source_blob",
      createdAt: "2026-07-01T00:00:00.000Z",
    });
    const expectedPath = path.join(assetDir, first.storagePath);
    const firstBytes = await readFile(expectedPath);

    // Second call with different content but SAME sha256 is not possible;
    // exercise the already-exists branch by re-running with same chunks.
    const second = await materializeBytesStream({
      assetDir,
      chunks: chunksFromBuffer(payload, 32),
      mediaType: "application/octet-stream",
      captureKind: "source_blob",
      createdAt: "2026-07-01T00:00:00.000Z",
    });
    assert.equal(second.sha256, first.sha256);
    const secondBytes = await readFile(expectedPath);
    assert.deepEqual(secondBytes, firstBytes);
  } finally {
    await rm(assetDir, { recursive: true, force: true });
  }
});

test("materializeBytesStream computes sha256 correctly when chunks span boundaries mid-UTF8", async () => {
  const assetDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-materialize-stream-utf8-"));
  try {
    await mkdir(path.join(assetDir, "evidence", "blobs"), { recursive: true });
    // Build content with multi-byte UTF-8 characters (emojis) so chunks
    // split inside a code point. Byte-level sha256 is unaffected (bytes
    // are bytes), but this guards against any future utf8-decode-then-hash
    // regression.
    const emoji = "🚀🔧📊";
    const payload = Buffer.from(JSON.stringify({ msg: emoji.repeat(200) }) + "\n", "utf8");
    const result = await materializeBytesStream({
      assetDir,
      chunks: chunksFromBuffer(payload, 7),
      mediaType: "application/jsonl",
      captureKind: "source_blob",
      createdAt: "2026-07-01T00:00:00.000Z",
    });
    assert.equal(result.sha256, createHash("sha256").update(payload).digest("hex"));
  } finally {
    await rm(assetDir, { recursive: true, force: true });
  }
});
