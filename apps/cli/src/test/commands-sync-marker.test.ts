import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runCliCapture, runCliJson, seedCliFixtures } from "./helpers.js";

// Auto-resume marker: cchistory sync writes `sync.started_at.<source_id>`
// into schema_meta after each successful per-source commit, and derives the
// next sync's effective --since from it (floored to UTC 00:00 of that day).
// --force-full-resync bypasses the marker read; --since overrides it. Marker
// is rewritten on every successful sync regardless of which path was taken.

async function withSeededHome(
  fn: (tempRoot: string, storeDir: string) => Promise<void>,
  prefix: string,
): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  const originalHome = process.env.HOME;
  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");
    await fn(tempRoot, storeDir);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function readMarker(dbPath: string, sourceId: string): string | undefined {
  const db = new DatabaseSync(dbPath);
  try {
    const row = db
      .prepare("SELECT value_text FROM schema_meta WHERE key = ?")
      .get(`sync.started_at.${sourceId}`) as { value_text: string } | undefined;
    return row?.value_text;
  } finally {
    db.close();
  }
}

function listSyncCompletionMarkers(dbPath: string): Array<{ key: string; value: string }> {
  const db = new DatabaseSync(dbPath);
  try {
    const rows = db
      .prepare("SELECT key, value_text FROM schema_meta WHERE key LIKE 'sync.started_at.%'")
      .all() as Array<{ key: string; value_text: string }>;
    return rows.map((row) => ({ key: row.key, value: row.value_text }));
  } finally {
    db.close();
  }
}

function firstSourceIdFromSync(stdout: string): string {
  const payload = JSON.parse(stdout) as { sources: Array<{ source: { id: string } }> };
  const first = payload.sources[0];
  assert.ok(first, "sync output must include at least one source");
  return first.source.id;
}

function readCaptureStats(dbPath: string): { sync_metadata_only_reuse_batch_count?: number; sync_batch_count?: number } {
  const db = new DatabaseSync(dbPath);
  try {
    const rows = db.prepare("SELECT payload_json FROM stage_runs").all();
    for (const row of rows) {
      const payload = JSON.parse((row as { payload_json: string }).payload_json) as {
        stage_kind?: string;
        stats?: { sync_metadata_only_reuse_batch_count?: number; sync_batch_count?: number };
      };
      if (payload.stage_kind === "capture") {
        return payload.stats ?? {};
      }
    }
    return {};
  } finally {
    db.close();
  }
}

test("sync writes per-source marker into schema_meta on first successful sync", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    const sync = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--json"]);
    assert.equal(sync.exitCode, 0, sync.stderr);
    const sourceId = firstSourceIdFromSync(sync.stdout);

    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const marker = readMarker(dbPath, sourceId);
    assert.ok(marker, `marker for ${sourceId} must exist after successful sync`);
    const parsed = Date.parse(marker!);
    assert.ok(!Number.isNaN(parsed), "marker must be a parseable ISO timestamp");
  }, "cchistory-sync-marker-write-");
});

test("sync --dry-run does not write marker", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    const dryRun = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--dry-run"]);
    assert.equal(dryRun.exitCode, 0, dryRun.stderr);

    const dbPath = path.join(storeDir, "cchistory.sqlite");
    let markers: Array<{ key: string; value: string }> = [];
    try {
      markers = listSyncCompletionMarkers(dbPath);
    } catch {
      markers = [];
    }
    assert.equal(markers.length, 0, "dry-run must not write any sync completion marker");
  }, "cchistory-sync-marker-dryrun-");
});

test("sync --force-full-resync still writes marker on success", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    const sync = await runCliCapture([
      "sync", "--store", storeDir, "--source", "codex", "--force-full-resync", "--json",
    ]);
    assert.equal(sync.exitCode, 0, sync.stderr);
    const sourceId = firstSourceIdFromSync(sync.stdout);

    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const marker = readMarker(dbPath, sourceId);
    assert.ok(marker, "--force-full-resync must still record a marker on success");
  }, "cchistory-sync-marker-force-");
});

test("marker is rewritten with a newer timestamp on subsequent successful sync", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    const first = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--json"]);
    assert.equal(first.exitCode, 0, first.stderr);
    const sourceId = firstSourceIdFromSync(first.stdout);

    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const firstMarker = readMarker(dbPath, sourceId);
    assert.ok(firstMarker);

    // Force a small delay so the second marker's timestamp is observably later.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const second = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--json"]);
    assert.equal(second.exitCode, 0, second.stderr);

    const secondMarker = readMarker(dbPath, sourceId);
    assert.ok(secondMarker);
    assert.notEqual(firstMarker, secondMarker, "marker must be updated on subsequent sync");
    assert.ok(Date.parse(secondMarker!) >= Date.parse(firstMarker!));
  }, "cchistory-sync-marker-rewrite-");
});

test("default second sync auto-resumes from marker (metadata-only fast path activates)", async () => {
  await withSeededHome(async (tempRoot, storeDir) => {
    // Backdate the codex fixture file so its mtime is observably older than
    // today's UTC 00:00 (the marker's floor). Otherwise the file is "fresh"
    // relative to the marker and the metadata-only fast path correctly skips
    // it, which would mask the auto-resume signal we're trying to observe.
    const oldMtime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const codexSessionsDir = path.join(tempRoot, ".codex", "sessions");
    const sessionFiles = await (await import("node:fs/promises")).readdir(codexSessionsDir);
    for (const fileName of sessionFiles) {
      await (await import("node:fs/promises")).utimes(
        path.join(codexSessionsDir, fileName),
        oldMtime,
        oldMtime,
      );
    }

    // First sync establishes the source and writes the marker.
    const first = await runCliCapture([
      "sync", "--store", storeDir, "--source", "codex", "--json", "--detail",
    ]);
    assert.equal(first.exitCode, 0, first.stderr);

    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const firstStats = readCaptureStats(dbPath);
    assert.equal(
      firstStats.sync_metadata_only_reuse_batch_count ?? 0,
      0,
      "first sync has no prior changedSince to activate the metadata-only fast path",
    );

    // Second sync without --since or --force-full-resync must derive changedSince
    // from the marker (floored to today UTC 00:00). With the fixture file now
    // 7 days old, it qualifies as "stable old" and the metadata-only fast path
    // activates for the batch.
    const second = await runCliCapture([
      "sync", "--store", storeDir, "--source", "codex", "--json", "--detail",
    ]);
    assert.equal(second.exitCode, 0, second.stderr);

    const secondStats = readCaptureStats(dbPath);
    assert.ok(
      (secondStats.sync_metadata_only_reuse_batch_count ?? 0) > 0,
      "second sync must activate the metadata-only fast path via the auto-resume marker",
    );
  }, "cchistory-sync-marker-resume-");
});

test("--force-full-resync bypasses marker derivation (no metadata-only fast path)", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    // First sync to establish state and write the marker.
    const first = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"]);
    assert.equal(first.exitCode, 0, first.stderr);

    // Second sync with --force-full-resync must NOT derive changedSince, so the
    // metadata-only fast path stays inactive even though the marker exists.
    const second = await runCliCapture([
      "sync", "--store", storeDir, "--source", "codex", "--force-full-resync", "--json", "--detail",
    ]);
    assert.equal(second.exitCode, 0, second.stderr);

    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const stats = readCaptureStats(dbPath);
    assert.equal(
      stats.sync_metadata_only_reuse_batch_count ?? 0,
      0,
      "--force-full-resync must skip marker-derived changedSince",
    );
  }, "cchistory-sync-marker-force-skip-");
});

test("--since overrides marker value", async () => {
  await withSeededHome(async (_tempRoot, storeDir) => {
    // First sync to write the marker.
    const first = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--json"]);
    assert.equal(first.exitCode, 0, first.stderr);
    const sourceId = firstSourceIdFromSync(first.stdout);

    // Plant a corrupt marker. If the next sync used the marker value as
    // changedSince, Date.parse would yield NaN and the probe would treat it as
    // undefined → full rescan. We instead pass --since=1h and assert the sync
    // succeeds and produces the expected turn count, proving --since took
    // precedence over the corrupt marker.
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const db = new DatabaseSync(dbPath);
    try {
      db.prepare(
        "INSERT OR REPLACE INTO schema_meta (key, value_text, updated_at) VALUES (?, ?, ?)",
      ).run(`sync.started_at.${sourceId}`, "not-a-valid-timestamp", new Date().toISOString());
    } finally {
      db.close();
    }

    const second = await runCliJson<{ sources: Array<{ counts: { turns: number } }> }>(
      ["sync", "--store", storeDir, "--source", "codex", "--since", "1h"],
    );
    const secondSource = second.sources[0];
    assert.ok(secondSource, "sync must report a source payload");
    assert.equal(secondSource.counts.turns, 1, "--since must override the (corrupt) marker");
  }, "cchistory-sync-marker since-override-");
});
