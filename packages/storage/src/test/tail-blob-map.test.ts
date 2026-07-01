import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { CCHistoryStorage } from "../index.js";
import { createFixturePayload } from "./helpers.js";

// Stage 2 commit 2: getTailBlobsByOriginPaths returns a Map<originPath,
// CapturedBlob> without materializing records/fragments/atoms/edges/sessions.
// This is the regression guard against re-introducing the
// SourceSyncPayload preload that caused the incremental_reuse_load_start
// OOM on operator-scale stores (~800 MiB / 1319 files for claude_code).

async function seedStoreWithTwoBlobVersions(
  sourceId: string,
  originPath: string,
  text: string,
  dbPath: string,
): Promise<void> {
  const storage = new CCHistoryStorage({ dbPath });
  const payload = createFixturePayload(sourceId, "tail blob canonical", "stage-tail", {
    baseDir: path.dirname(originPath),
  });
  payload.blobs[0]!.origin_path = originPath;
  payload.blobs[0]!.captured_path = undefined;
  payload.blobs[0]!.checksum = "checksum-v1-tail";
  payload.blobs[0]!.size_bytes = Buffer.byteLength(text, "utf8");
  payload.blobs[0]!.file_identity_stable = true;
  storage.replaceSourcePayload(payload);
  storage.close();
}

test("getTailBlobsByOriginPaths returns the largest blob per origin path keyed by normalized originPath", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-tail-blob-map-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });

    const sourceId = "srcinst-codex-tail-blob-map";
    const originPath = path.join(sourceRoot, "session.jsonl");
    const text = "{\"fixture\":true}\n";
    await writeFile(originPath, text, "utf8");
    await seedStoreWithTwoBlobVersions(sourceId, originPath, text, dbPath);

    const storage = new CCHistoryStorage({ dbPath });
    const result = storage.getTailBlobsByOriginPaths(sourceId, [originPath]);
    storage.close();

    assert.ok(result, "must return a Map for an existing source");
    assert.equal(result.size, 1, "one originPath in, one entry out");
    const entry = [...result.entries()][0]!;
    const key = entry[0];
    const blob = entry[1];
    assert.equal(key, path.normalize(originPath), "key must be the normalized originPath");
    assert.equal(blob.source_id, sourceId, "tail blob belongs to the requested source");
    assert.equal(blob.size_bytes, Buffer.byteLength(text, "utf8"), "size_bytes preserved");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("getTailBlobsByOriginPaths returns empty Map for an existing source with no matching originPaths", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-tail-blob-empty-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });

    const sourceId = "srcinst-codex-tail-blob-empty";
    const originPath = path.join(sourceRoot, "session.jsonl");
    const text = "{\"fixture\":true}\n";
    await writeFile(originPath, text, "utf8");
    await seedStoreWithTwoBlobVersions(sourceId, originPath, text, dbPath);

    const storage = new CCHistoryStorage({ dbPath });
    const result = storage.getTailBlobsByOriginPaths(sourceId, []);
    storage.close();

    assert.ok(result);
    assert.equal(result.size, 0, "no paths in, no entries out");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("getTailBlobsByOriginPaths returns undefined for an unknown source id", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-tail-blob-unknown-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });

    const sourceId = "srcinst-codex-real";
    const originPath = path.join(sourceRoot, "session.jsonl");
    const text = "{\"fixture\":true}\n";
    await writeFile(originPath, text, "utf8");
    await seedStoreWithTwoBlobVersions(sourceId, originPath, text, dbPath);

    const storage = new CCHistoryStorage({ dbPath });
    const result = storage.getTailBlobsByOriginPaths("srcinst-codex-nonexistent", [originPath]);
    storage.close();

    assert.equal(result, undefined, "unknown source must yield undefined (matches prior API)");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
