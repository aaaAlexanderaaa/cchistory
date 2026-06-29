import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFileBatchesByRecency } from "../commands/sync.js";

// Recency-bucketed batching: when a changedSince cutoff is in effect, files
// are grouped into recent / week / month / old buckets by mtime, with smaller
// batch targets for newer files (to limit slow-path blast radius) and larger
// targets for old files (since they hit the metadata-only fast path anyway).

async function makeFile(dir: string, name: string, sizeBytes: number, mtime: Date): Promise<string> {
  const filePath = path.join(dir, name);
  await writeFile(filePath, Buffer.alloc(sizeBytes, 0));
  await utimes(filePath, mtime, mtime);
  return filePath;
}

const DAY = 24 * 60 * 60 * 1000;

test("no cutoff falls back to flat byte-accumulation at the standard target", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "recency-nocutoff-"));
  try {
    // Three 10 MiB files. With 24 MiB target and no bucketing, this should
    // produce 2 batches: [file-0, file-1] then [file-2].
    const files = await Promise.all([
      makeFile(dir, "f0", 10 * 1024 * 1024, new Date()),
      makeFile(dir, "f1", 10 * 1024 * 1024, new Date()),
      makeFile(dir, "f2", 10 * 1024 * 1024, new Date()),
    ]);

    const batches = await buildFileBatchesByRecency(files, undefined);
    assert.equal(batches.length, 2, "10+10 MiB exceeds 24 MiB target after 2 files, 3rd file starts a new batch");
    assert.ok(batches[0] && batches[0].length === 2);
    assert.ok(batches[1] && batches[1].length === 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("invalid cutoff string falls back to flat byte-accumulation", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "recency-badts-"));
  try {
    const files = await Promise.all([
      makeFile(dir, "f0", 1024, new Date()),
      makeFile(dir, "f1", 1024, new Date()),
    ]);
    const batches = await buildFileBatchesByRecency(files, "not-a-timestamp");
    assert.equal(batches.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("recent files get smaller batches than old files at the same total size", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "recency-mixed-"));
  try {
    const cutoff = new Date("2026-06-25T00:00:00.000Z");
    const recentTime = new Date(cutoff.getTime() - 6 * 60 * 60 * 1000); // 6h before cutoff → "recent"
    const oldTime = new Date(cutoff.getTime() - 400 * DAY); // 400d before cutoff → "old"

    // 4 files at 5 MiB each. With recent target ~4 MiB, each recent file is its own batch (4 batches).
    // With old target ~48 MiB, all 4 old files fit in one batch (1 batch).
    const recentFiles = await Promise.all([
      makeFile(dir, "recent-0", 5 * 1024 * 1024, recentTime),
      makeFile(dir, "recent-1", 5 * 1024 * 1024, recentTime),
      makeFile(dir, "recent-2", 5 * 1024 * 1024, recentTime),
      makeFile(dir, "recent-3", 5 * 1024 * 1024, recentTime),
    ]);
    const oldFiles = await Promise.all([
      makeFile(dir, "old-0", 5 * 1024 * 1024, oldTime),
      makeFile(dir, "old-1", 5 * 1024 * 1024, oldTime),
      makeFile(dir, "old-2", 5 * 1024 * 1024, oldTime),
      makeFile(dir, "old-3", 5 * 1024 * 1024, oldTime),
    ]);

    const batches = await buildFileBatchesByRecency([...recentFiles, ...oldFiles], cutoff.toISOString());

    // Recent: 4 files × 5 MiB = 20 MiB, target 4 MiB → 4 batches of 1 file each
    const recentBatches = batches.filter((b) => b.every((f) => f.includes("recent-")));
    assert.equal(recentBatches.length, 4, "each 5 MiB recent file should be its own batch (target ~4 MiB)");

    // Old: 4 files × 5 MiB = 20 MiB, target 48 MiB → 1 batch
    const oldBatches = batches.filter((b) => b.every((f) => f.includes("old-")));
    assert.equal(oldBatches.length, 1, "all 4 old files (20 MiB) fit in one batch (target ~48 MiB)");
    assert.ok(oldBatches[0] && oldBatches[0].length === 4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bucket boundaries: week, month, old are correctly separated", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "recency-boundaries-"));
  try {
    const cutoff = new Date("2026-06-25T00:00:00.000Z");
    const times = {
      recent: new Date(cutoff.getTime() - 12 * 60 * 60 * 1000), // 0.5d before
      week: new Date(cutoff.getTime() - 3 * DAY), // 3d before
      month: new Date(cutoff.getTime() - 14 * DAY), // 14d before
      old: new Date(cutoff.getTime() - 60 * DAY), // 60d before
    };

    // 1 MiB each. Each bucket's target (≥4 MiB) accommodates multiple files.
    // Goal: verify each file lands in its expected bucket, observable via
    // batch grouping (files in different buckets can NEVER share a batch).
    const files = await Promise.all([
      makeFile(dir, "recent", 1 * 1024 * 1024, times.recent),
      makeFile(dir, "week", 1 * 1024 * 1024, times.week),
      makeFile(dir, "month", 1 * 1024 * 1024, times.month),
      makeFile(dir, "old", 1 * 1024 * 1024, times.old),
    ]);

    const batches = await buildFileBatchesByRecency(files, cutoff.toISOString());

    // Each file is in a different recency bucket, so no two should share a batch.
    assert.equal(batches.length, 4, "each file in its own bucket → 4 batches");
    const bucketNames = new Set(
      batches.map((b) => b[0]).filter((p): p is string => Boolean(p)).map((p) => path.basename(p)),
    );
    assert.equal(bucketNames.size, 4);
    for (const name of ["recent", "week", "month", "old"]) {
      assert.ok(bucketNames.has(name), `bucket ${name} must be present`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bucket ordering: recent batches appear before old batches in output", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "recency-order-"));
  try {
    const cutoff = new Date("2026-06-25T00:00:00.000Z");
    const recent = await makeFile(dir, "recent", 1 * 1024 * 1024, new Date(cutoff.getTime() - 12 * 60 * 60 * 1000));
    const old = await makeFile(dir, "old", 1 * 1024 * 1024, new Date(cutoff.getTime() - 100 * DAY));

    // Pass them in reverse order to verify the function re-orders by bucket.
    const batches = await buildFileBatchesByRecency([old, recent], cutoff.toISOString());
    assert.equal(batches.length, 2);
    assert.ok(batches[0]?.[0]?.includes("recent"), "recent batch must come first");
    assert.ok(batches[1]?.[0]?.includes("old"), "old batch must come last");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing files are treated as zero-size and grouped by mtime=0 (old bucket)", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "recency-missing-"));
  try {
    const cutoff = new Date("2026-06-25T00:00:00.000Z");
    const present = await makeFile(dir, "present", 1 * 1024 * 1024, new Date(cutoff.getTime() - 12 * 60 * 60 * 1000));
    const missing = path.join(dir, "does-not-exist");

    const batches = await buildFileBatchesByRecency([present, missing], cutoff.toISOString());
    // Both land in some bucket (present→recent, missing→old since mtimeMs=0).
    // They CANNOT share a batch because they're in different buckets.
    assert.equal(batches.length, 2);
    assert.ok(batches.flat().includes(present));
    assert.ok(batches.flat().includes(missing));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("empty file list returns no batches regardless of cutoff", async () => {
  const batches = await buildFileBatchesByRecency([], "2026-06-25T00:00:00.000Z");
  assert.equal(batches.length, 0);
});
