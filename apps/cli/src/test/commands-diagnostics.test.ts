import { appendFile, mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CapturedBlob, LossAuditRecord, RawRecord, StageRun } from "@cchistory/domain";
import {
  fileExists,
  runCliCapture,
  runCliJson,
  seedCliDiscoveryFixtures,
  seedCliFixtures,
  writeCodexSessionFixture,
} from "./helpers.js";

test("discover lists Gemini CLI sync roots alongside discovery-only auxiliary paths", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-discover-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliDiscoveryFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const result = await runCliJson<{
      tools: Array<{
        display_name: string;
        platform: string;
        capability: string;
        selected_path?: string;
        candidates: Array<{ path: string; exists: boolean }>;
      }>;
    }>(["discover"], tempRoot);

    const openclaw = result.tools.find((tool) => tool.platform === "openclaw");
    const opencode = result.tools.find((tool) => tool.platform === "opencode");

    assert.ok(openclaw, "OpenClaw should be discovered");
    assert.ok(opencode, "OpenCode should be discovered");
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("health combines discovery, sync preview, and indexed store summary in one command", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-health-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliDiscoveryFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");

    const result = await runCliCapture(["health", "--store", storeDir], tempRoot);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Host Discovery/);
    assert.match(result.stdout, /Sync Preview/);
    assert.match(result.stdout, /Indexed Store/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("inventory reports a missing store without creating SQLite files", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-inventory-missing-"));
  try {
    const storeDir = path.join(tempRoot, "missing-store");
    const result = await runCliCapture(["inventory", "--store", storeDir, "--json"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout) as {
      kind: string;
      inventory: {
        status: string;
        evidence_store: { status: string; file_count: number; total_bytes: number };
        sqlite_files: { main: { exists: boolean } };
        totals: { row_count: number; payload_json_bytes: number; evidence_store_files: number; evidence_store_bytes: number };
      };
    };

    assert.equal(payload.kind, "storage-footprint-inventory");
    assert.equal(payload.inventory.status, "missing");
    assert.equal(payload.inventory.evidence_store.status, "missing");
    assert.equal(payload.inventory.evidence_store.file_count, 0);
    assert.equal(payload.inventory.evidence_store.total_bytes, 0);
    assert.equal(payload.inventory.sqlite_files.main.exists, false);
    assert.equal(payload.inventory.totals.row_count, 0);
    assert.equal(payload.inventory.totals.payload_json_bytes, 0);
    assert.equal(payload.inventory.totals.evidence_store_files, 0);
    assert.equal(payload.inventory.totals.evidence_store_bytes, 0);
    assert.equal(await fileExists(path.join(storeDir, "cchistory.sqlite")), false);
    assert.equal(await fileExists(storeDir), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("inventory reports table footprint, largest payload rows, search index, and source-root bytes", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-inventory-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");

    const syncResult = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);

    const human = await runCliCapture(["inventory", "--store", storeDir], tempRoot);
    assert.equal(human.exitCode, 0, human.stderr);
    assert.match(human.stdout, /Storage Inventory/);
    assert.match(human.stdout, /Payload Tables/);
    assert.match(human.stdout, /Largest Payload Rows/);
    assert.match(human.stdout, /Evidence Store/);
    assert.match(human.stdout, /Source Roots/);
    assert.match(human.stdout, /Search Index/);
    assert.match(human.stdout, /user_turns/);

    const json = await runCliCapture(["inventory", "--store", storeDir, "--json"], tempRoot);
    assert.equal(json.exitCode, 0, json.stderr);
    const payload = JSON.parse(json.stdout) as {
      kind: string;
      inventory: {
        status: string;
        evidence_store: { status: string; file_count: number; total_bytes: number };
        sqlite_files: { main: { exists: boolean; size_bytes: number }; wal: { size_bytes: number }; shm: { size_bytes: number } };
        search_index: { table_exists: boolean; shadow_tables: string[] };
        tables: Array<{ name: string; row_count: number; payload_json_bytes: number; largest_payload_rows: Array<{ payload_json_bytes: number }> }>;
        source_roots: Array<{ source_id: string; status: string; file_count: number; total_bytes: number }>;
        totals: { row_count: number; payload_json_bytes: number; sqlite_file_bytes: number; evidence_store_files: number; evidence_store_bytes: number; source_root_files: number; source_root_bytes: number };
      };
    };

    assert.equal(payload.kind, "storage-footprint-inventory");
    assert.equal(payload.inventory.status, "ok");
    assert.equal(payload.inventory.sqlite_files.main.exists, true);
    assert.ok(payload.inventory.sqlite_files.main.size_bytes > 0);
    assert.ok(payload.inventory.totals.sqlite_file_bytes >= payload.inventory.sqlite_files.main.size_bytes);
    assert.ok(payload.inventory.totals.row_count > 0);
    assert.ok(payload.inventory.totals.payload_json_bytes > 0);
    assert.equal(payload.inventory.evidence_store.status, "ok");
    assert.ok(payload.inventory.evidence_store.file_count > 0);
    assert.ok(payload.inventory.evidence_store.total_bytes > 0);
    assert.equal(payload.inventory.totals.evidence_store_files, payload.inventory.evidence_store.file_count);
    assert.equal(payload.inventory.totals.evidence_store_bytes, payload.inventory.evidence_store.total_bytes);
    assert.equal(typeof payload.inventory.search_index.table_exists, "boolean");
    assert.ok(Array.isArray(payload.inventory.search_index.shadow_tables));

    const turnsTable = payload.inventory.tables.find((table) => table.name === "user_turns_v2");
    assert.ok(turnsTable, "inventory should include user_turns_v2");
    assert.ok(turnsTable.row_count > 0);
    // V2 stores full-content in typed columns (canonical_text_full, etc.), not
    // a payload_json blob — so payload_json_bytes is 0 by design. Sanity-check
    // that some payload-bearing V1 table is still reporting bytes so the
    // totals are non-trivial.
    assert.ok(payload.inventory.totals.payload_json_bytes > 0);

    const codexRoot = payload.inventory.source_roots.find((source) => source.source_id.includes("codex"));
    assert.ok(codexRoot, "inventory should include Codex source root");
    assert.equal(codexRoot.status, "ok");
    assert.ok(codexRoot.file_count > 0);
    assert.ok(codexRoot.total_bytes > 0);
    assert.ok(payload.inventory.totals.source_root_files >= codexRoot.file_count);
    assert.ok(payload.inventory.totals.source_root_bytes >= codexRoot.total_bytes);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync --detail reports source, file, write, and reindex progress on stderr", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-detail-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");

    const result = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--detail"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Synced 1 source\(s\)/);
    assert.match(result.stderr, /\[sync:cli:store_open_start\]/);
    assert.match(result.stderr, /\[sync:cli:source_resolution_start\]/);
    assert.match(result.stderr, /\[sync:codex:incremental_reuse_load_start\]/);
    assert.match(result.stderr, /\[sync:codex:source_start\]/);
    assert.match(result.stderr, /\[sync:codex:file_start\]/);
    assert.match(result.stderr, /\[sync:codex:file_capture_done\].*\(\d+ms\)/);
    assert.match(result.stderr, /\[sync:codex:file_parse_done\].*\(\d+ms\)/);
    assert.match(result.stderr, /\[sync:codex:derive_done\].*\(\d+ms\)/);
    assert.match(result.stderr, /\[sync:codex:write_store_start\]/);
    assert.match(result.stderr, /\[sync:codex:write_store_done\].*\(\d+ms\)/);
    assert.match(result.stderr, /\[sync:all:reindex_done\].*\(\d+ms\)/);

    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    try {
      const stageRuns = db.prepare("SELECT payload_json FROM stage_runs").all()
        .map((row) => JSON.parse((row as { payload_json: string }).payload_json) as {
          stage_kind: string;
          stats: Record<string, number>;
        });
      const captureRun = stageRuns.find((run) => run.stage_kind === "capture");
      const parseRun = stageRuns.find((run) => run.stage_kind === "parse_source_fragments");
      const finalizeRun = stageRuns.find((run) => run.stage_kind === "finalize_projections");
      const indexRun = stageRuns.find((run) => run.stage_kind === "index_projections");
      assert.equal(typeof captureRun?.stats.sync_scan_ms, "number");
      assert.equal(typeof parseRun?.stats.sync_parse_ms, "number");
      assert.equal(typeof finalizeRun?.stats.sqlite_write_ms, "number");
      assert.equal(typeof indexRun?.stats.projection_refresh_ms, "number");
      assert.ok((indexRun?.stats.sync_total_ms ?? 0) >= (finalizeRun?.stats.sqlite_write_ms ?? 0));
    } finally {
      db.close();
    }
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync refreshes derived projections once after all selected sources are written", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-single-refresh-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");

    const result = await runCliCapture([
      "sync",
      "--store",
      storeDir,
      "--source",
      "codex",
      "--source",
      "claude_code",
      "--detail",
    ], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Synced 2 source\(s\)/);
    assert.deepEqual(result.stderr.match(/\[sync:[^\]]+:reindex_done\]/g) ?? [], ["[sync:all:reindex_done]"]);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync writes Codex full scans in bounded batches without dropping turns", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-codex-batches-"));
  const originalHome = process.env.HOME;
  const originalBatchTarget = process.env.CCHISTORY_CODEX_SYNC_BATCH_TARGET_BYTES;

  try {
    process.env.HOME = tempRoot;
    process.env.CCHISTORY_CODEX_SYNC_BATCH_TARGET_BYTES = "1";
    await mkdir(path.join(tempRoot, ".codex", "sessions"), { recursive: true });
    await writeCodexSessionFixture(tempRoot, "rollout-codex-batch-a.jsonl", {
      sessionId: "codex-batch-a",
      cwd: "/workspace/cchistory",
      model: "gpt-5",
      prompt: "Batch one prompt should remain searchable.",
      reply: "Batch one reply.",
      startAt: "2026-03-09T00:00:00.000Z",
    });
    await writeCodexSessionFixture(tempRoot, "rollout-codex-batch-b.jsonl", {
      sessionId: "codex-batch-b",
      cwd: "/workspace/cchistory",
      model: "gpt-5",
      prompt: "Batch two prompt should remain searchable.",
      reply: "Batch two reply.",
      startAt: "2026-03-09T01:00:00.000Z",
    });

    const storeDir = path.join(tempRoot, "store");
    const result = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--json", "--detail"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.sources[0].counts.turns, 2);
    assert.match(result.stderr, /Prepared Codex in 2 bounded batch\(es\)/);
    assert.match(result.stderr, /Writing Codex batch 1\/2 to SQLite/);
    assert.match(result.stderr, /Writing Codex batch 2\/2 to SQLite/);

    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    try {
      const stageRuns = db.prepare("SELECT payload_json FROM stage_runs").all()
        .map((row) => JSON.parse((row as { payload_json: string }).payload_json) as StageRun);
      const captureRun = stageRuns.find((run) => run.stage_kind === "capture");
      const parseRun = stageRuns.find((run) => run.stage_kind === "parse_source_fragments");
      const finalizeRun = stageRuns.find((run) => run.stage_kind === "finalize_projections");
      const indexRun = stageRuns.find((run) => run.stage_kind === "index_projections");
      assert.equal(captureRun?.stats.output_count, 2);
      assert.equal(captureRun?.stats.sync_file_count, 2);
      assert.equal(parseRun?.stats.input_count, 6);
      assert.equal(finalizeRun?.stats.sessions, 2);
      assert.equal(finalizeRun?.stats.turns, 2);
      assert.equal(indexRun?.stats.turns, 2);
      assert.equal(typeof indexRun?.stats.sync_total_ms, "number");
    } finally {
      db.close();
    }

    const search = await runCliJson<{ results: Array<{ turn: { canonical_text: string } }> }>(
      ["search", "Batch two prompt", "--store", storeDir],
      tempRoot,
    );
    assert.ok(search.results.some((entry) => entry.turn.canonical_text.includes("Batch two prompt")));
  } finally {
    process.env.HOME = originalHome;
    if (originalBatchTarget === undefined) {
      delete process.env.CCHISTORY_CODEX_SYNC_BATCH_TARGET_BYTES;
    } else {
      process.env.CCHISTORY_CODEX_SYNC_BATCH_TARGET_BYTES = originalBatchTarget;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync removes stale Codex rows for observed batch files that produce no blob", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-codex-batch-blobless-"));
  const originalHome = process.env.HOME;
  const originalBatchTarget = process.env.CCHISTORY_CODEX_SYNC_BATCH_TARGET_BYTES;

  try {
    process.env.HOME = tempRoot;
    process.env.CCHISTORY_CODEX_SYNC_BATCH_TARGET_BYTES = "1";
    await mkdir(path.join(tempRoot, ".codex", "sessions"), { recursive: true });
    await writeCodexSessionFixture(tempRoot, "rollout-codex-batch-a.jsonl", {
      sessionId: "codex-batch-a",
      cwd: "/workspace/cchistory",
      model: "gpt-5",
      prompt: "Batch keep prompt should remain searchable.",
      reply: "Batch keep reply.",
      startAt: "2026-03-09T00:00:00.000Z",
    });
    const failedPath = path.join(tempRoot, ".codex", "sessions", "rollout-codex-batch-z.jsonl");
    await writeCodexSessionFixture(tempRoot, "rollout-codex-batch-z.jsonl", {
      sessionId: "codex-batch-z",
      cwd: "/workspace/cchistory",
      model: "gpt-5",
      prompt: "Batch failed prompt should disappear.",
      reply: "Batch failed reply.",
      startAt: "2026-03-09T01:00:00.000Z",
    });

    const storeDir = path.join(tempRoot, "store");
    const firstSync = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--json"], tempRoot);
    assert.equal(firstSync.exitCode, 0, firstSync.stderr);
    const firstPayload = JSON.parse(firstSync.stdout);
    assert.equal(firstPayload.sources[0].counts.turns, 2);

    // Stage 3: oversized JSONL files now stream through captureBlobStreaming
    // instead of being skipped, so truncating to >64 MiB no longer produces
    // a blobless batch for codex. Deleting the file is the remaining way to
    // make the second batch "produce no blob" for the stale-row cleanup
    // assertion below.
    await rm(failedPath);

    const secondSync = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--json", "--detail"], tempRoot);
    assert.equal(secondSync.exitCode, 0, secondSync.stderr);
    const secondPayload = JSON.parse(secondSync.stdout);
    assert.equal(secondPayload.sources[0].counts.turns, 1);

    const keepSearch = await runCliJson<{ results: Array<{ turn: { canonical_text: string } }> }>(
      ["search", "Batch keep prompt", "--store", storeDir],
      tempRoot,
    );
    assert.ok(keepSearch.results.some((entry) => entry.turn.canonical_text.includes("Batch keep prompt")));

    const staleSearch = await runCliJson<{ results: Array<{ turn: { canonical_text: string } }> }>(
      ["search", "Batch failed prompt", "--store", storeDir],
      tempRoot,
    );
    assert.equal(staleSearch.results.length, 0);
  } finally {
    process.env.HOME = originalHome;
    if (originalBatchTarget === undefined) {
      delete process.env.CCHISTORY_CODEX_SYNC_BATCH_TARGET_BYTES;
    } else {
      process.env.CCHISTORY_CODEX_SYNC_BATCH_TARGET_BYTES = originalBatchTarget;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync streams oversized Codex JSONL files instead of skipping them (Stage 3 streaming cap)", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-codex-oversized-stream-"));
  const originalHome = process.env.HOME;

  try {
    process.env.HOME = tempRoot;
    await mkdir(path.join(tempRoot, ".codex", "sessions"), { recursive: true });
    // Stage 3 routes incremental-JSONL platforms through captureBlobStreaming,
    // so this file should be ingested (not loss-audited as oversized).
    await writeCodexSessionFixture(tempRoot, "rollout-codex-oversized.jsonl", {
      sessionId: "codex-oversized-stream",
      cwd: "/workspace/cchistory",
      model: "gpt-5",
      prompt: "Oversized stream prompt should remain searchable.",
      reply: "Oversized stream reply.",
      startAt: "2026-03-09T00:00:00.000Z",
    });
    // Pad the file beyond the 64 MiB streaming threshold with blank lines.
    // forEachNonEmptyTrimmedLineStreaming filters them out, so the parser
    // still only sees the three real records from the fixture — but the
    // file on disk is oversized, exercising the captureBlobStreaming path.
    const filePath = path.join(tempRoot, ".codex", "sessions", "rollout-codex-oversized.jsonl");
    const targetBytes = 65 * 1024 * 1024;
    const blankLine = "   \n";
    const padRepeats = Math.ceil(targetBytes / blankLine.length);
    await appendFile(filePath, blankLine.repeat(padRepeats), "utf8");

    const storeDir = path.join(tempRoot, "store");
    const result = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--json", "--detail"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.sources[0].counts.turns, 1, "oversized codex JSONL must produce a turn via streaming");
    // The file must NOT be reported as skipped oversized — that's the
    // whole point of Stage 3 commit 5.
    assert.doesNotMatch(result.stderr, /Skipped oversized source file/);

    const search = await runCliJson<{ results: Array<{ turn: { canonical_text: string } }> }>(
      ["search", "Oversized stream prompt", "--store", storeDir],
      tempRoot,
    );
    assert.ok(
      search.results.some((entry) => entry.turn.canonical_text.includes("Oversized stream prompt")),
      "oversized streamed codex turn must be searchable",
    );
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync invalidates stale Codex parser diagnostics across every bounded batch", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-codex-batch-parser-"));
  const originalHome = process.env.HOME;
  const originalBatchTarget = process.env.CCHISTORY_CODEX_SYNC_BATCH_TARGET_BYTES;

  try {
    process.env.HOME = tempRoot;
    process.env.CCHISTORY_CODEX_SYNC_BATCH_TARGET_BYTES = "1";
    await mkdir(path.join(tempRoot, ".codex", "sessions"), { recursive: true });
    await writeCodexSessionFixture(tempRoot, "rollout-codex-parser-a.jsonl", {
      sessionId: "codex-parser-a",
      cwd: "/workspace/cchistory",
      model: "gpt-5",
      prompt: "Batch parser one prompt.",
      reply: "Batch parser one reply.",
      startAt: "2026-03-09T00:00:00.000Z",
    });
    await writeCodexSessionFixture(tempRoot, "rollout-codex-parser-b.jsonl", {
      sessionId: "codex-parser-b",
      cwd: "/workspace/cchistory",
      model: "gpt-5",
      prompt: "Batch parser two prompt.",
      reply: "Batch parser two reply.",
      startAt: "2026-03-09T01:00:00.000Z",
    });

    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const firstSync = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(firstSync.exitCode, 0, firstSync.stderr);

    rewriteCodexStageRunParserVersion(dbPath, "codex-parser@2026-03-11.1");
    insertStaleCodexUnhandledAuditForOrigin(dbPath, "rollout-codex-parser-b.jsonl");
    assert.equal(countCodexUnhandledAudits(dbPath), 1);

    const result = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--json", "--detail"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.sources[0].counts.turns, 2);
    assert.equal(countCodexUnhandledAudits(dbPath), 0);
    assert.equal(result.stderr.match(/\[sync:codex:file_parse_done\]/g)?.length, 2);
    assert.doesNotMatch(result.stderr, /\[sync:codex:file_skip\]/);
  } finally {
    process.env.HOME = originalHome;
    if (originalBatchTarget === undefined) {
      delete process.env.CCHISTORY_CODEX_SYNC_BATCH_TARGET_BYTES;
    } else {
      process.env.CCHISTORY_CODEX_SYNC_BATCH_TARGET_BYTES = originalBatchTarget;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync --since reuses older unchanged Codex files from the existing store without losing turns", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-since-"));
  const originalHome = process.env.HOME;

  try {
    process.env.HOME = tempRoot;
    await mkdir(path.join(tempRoot, ".codex", "sessions"), { recursive: true });
    const oldFile = path.join(tempRoot, ".codex", "sessions", "rollout-codex-old.jsonl");
    await writeCodexSessionFixture(tempRoot, "rollout-codex-old.jsonl", {
      sessionId: "codex-old-session",
      cwd: "/workspace/cchistory",
      model: "gpt-5",
      prompt: "Old prompt should remain searchable.",
      reply: "Old reply remains indexed.",
      startAt: "2026-03-09T00:00:00.000Z",
    });
    const oldDate = new Date("2020-01-01T00:00:00.000Z");
    await utimes(oldFile, oldDate, oldDate);

    const storeDir = path.join(tempRoot, "store");
    const firstSync = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(firstSync.exitCode, 0, firstSync.stderr);

    await writeCodexSessionFixture(tempRoot, "rollout-codex-new.jsonl", {
      sessionId: "codex-new-session",
      cwd: "/workspace/cchistory",
      model: "gpt-5",
      prompt: "New prompt should be added.",
      reply: "New reply is indexed.",
      startAt: "2026-03-09T01:00:00.000Z",
    });

    const result = await runCliCapture([
      "sync",
      "--store",
      storeDir,
      "--source",
      "codex",
      "--since",
      "1h",
      "--json",
      "--detail",
    ], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.sources[0].counts.turns, 2);
    assert.match(result.stderr, /\[sync:codex:file_skip\]/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync --since skips unchanged old Codex files before content capture when file identity matches", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-since-fast-"));
  const originalHome = process.env.HOME;

  try {
    process.env.HOME = tempRoot;
    await mkdir(path.join(tempRoot, ".codex", "sessions"), { recursive: true });
    const oldFile = path.join(tempRoot, ".codex", "sessions", "rollout-codex-old.jsonl");
    await writeCodexSessionFixture(tempRoot, "rollout-codex-old.jsonl", {
      sessionId: "codex-old-session",
      cwd: "/workspace/cchistory",
      model: "gpt-5",
      prompt: "Old prompt should remain searchable.",
      reply: "Old reply remains indexed.",
      startAt: "2026-03-09T00:00:00.000Z",
    });
    const oldDate = new Date("2020-01-01T00:00:00.000Z");
    await utimes(oldFile, oldDate, oldDate);

    const storeDir = path.join(tempRoot, "store");
    const firstSync = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(firstSync.exitCode, 0, firstSync.stderr);

    const result = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--since", "1h", "--detail"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stderr, /Reused unchanged file without reading content/);
    assert.match(result.stderr, /\[sync:codex:file_skip\]/);
    assert.doesNotMatch(result.stderr, /\[sync:codex:file_capture_done\]/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync --since uses metadata-only reuse for stable old Codex batches", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-since-metadata-batch-"));
  const originalHome = process.env.HOME;
  const originalBatchTarget = process.env.CCHISTORY_CODEX_SYNC_BATCH_TARGET_BYTES;

  try {
    process.env.HOME = tempRoot;
    process.env.CCHISTORY_CODEX_SYNC_BATCH_TARGET_BYTES = "1";
    await mkdir(path.join(tempRoot, ".codex", "sessions"), { recursive: true });
    const oldFile = path.join(tempRoot, ".codex", "sessions", "rollout-codex-old.jsonl");
    const recentFile = path.join(tempRoot, ".codex", "sessions", "rollout-codex-recent.jsonl");
    await writeCodexSessionFixture(tempRoot, "rollout-codex-old.jsonl", {
      sessionId: "codex-old-session",
      cwd: "/workspace/cchistory",
      model: "gpt-5",
      prompt: "Old metadata-only prompt should remain searchable.",
      reply: "Old metadata-only reply remains indexed.",
      startAt: "2026-03-09T00:00:00.000Z",
    });
    await writeCodexSessionFixture(tempRoot, "rollout-codex-recent.jsonl", {
      sessionId: "codex-recent-session",
      cwd: "/workspace/cchistory",
      model: "gpt-5",
      prompt: "Recent prompt before append.",
      reply: "Recent reply before append.",
      startAt: "2026-03-09T01:00:00.000Z",
    });
    const oldDate = new Date("2020-01-01T00:00:00.000Z");
    await utimes(oldFile, oldDate, oldDate);

    const storeDir = path.join(tempRoot, "store");
    const firstSync = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(firstSync.exitCode, 0, firstSync.stderr);

    await appendFile(
      recentFile,
      `\n${[
        {
          timestamp: "2026-03-09T01:10:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Recent appended prompt should be indexed." }],
          },
        },
        {
          timestamp: "2026-03-09T01:10:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Recent appended reply." }],
          },
        },
      ].map((line) => JSON.stringify(line)).join("\n")}`,
      "utf8",
    );

    const result = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--since", "1h", "--json", "--detail"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.sources[0].counts.turns, 3);
    assert.match(result.stderr, /\[sync:codex:file_skip\]/);
    assert.match(result.stderr, /\[sync:codex:file_append_done\]/);
    assert.match(result.stderr, /\[sync:all:reindex_done\]/);

    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    try {
      const stageRuns = db.prepare("SELECT payload_json FROM stage_runs").all()
        .map((row) => JSON.parse((row as { payload_json: string }).payload_json) as StageRun);
      const captureRun = stageRuns.find((run) => run.stage_kind === "capture");
      assert.equal(captureRun?.stats.sync_batch_count, 2);
      assert.equal(captureRun?.stats.sync_metadata_only_reuse_batch_count, 1);
      const finalizeRun = stageRuns.find((run) => run.stage_kind === "finalize_projections");
      assert.equal(typeof finalizeRun?.stats.sqlite_metadata_ms, "number");
    } finally {
      db.close();
    }

    const search = await runCliJson<{ results: Array<{ turn: { canonical_text: string } }> }>(
      ["search", "Recent appended prompt", "--store", storeDir],
      tempRoot,
    );
    assert.ok(search.results.some((entry) => entry.turn.canonical_text.includes("Recent appended prompt")));
  } finally {
    process.env.HOME = originalHome;
    if (originalBatchTarget === undefined) {
      delete process.env.CCHISTORY_CODEX_SYNC_BATCH_TARGET_BYTES;
    } else {
      process.env.CCHISTORY_CODEX_SYNC_BATCH_TARGET_BYTES = originalBatchTarget;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync --since skips projection refresh when stable old Codex batches are unchanged", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-since-refresh-noop-"));
  const originalHome = process.env.HOME;
  const originalBatchTarget = process.env.CCHISTORY_CODEX_SYNC_BATCH_TARGET_BYTES;

  try {
    process.env.HOME = tempRoot;
    process.env.CCHISTORY_CODEX_SYNC_BATCH_TARGET_BYTES = "1";
    await mkdir(path.join(tempRoot, ".codex", "sessions"), { recursive: true });
    const oldFile = path.join(tempRoot, ".codex", "sessions", "rollout-codex-old.jsonl");
    const olderFile = path.join(tempRoot, ".codex", "sessions", "rollout-codex-older.jsonl");
    await writeCodexSessionFixture(tempRoot, "rollout-codex-old.jsonl", {
      sessionId: "codex-old-session",
      cwd: "/workspace/cchistory",
      model: "gpt-5",
      prompt: "Old no-op prompt should remain searchable.",
      reply: "Old no-op reply remains indexed.",
      startAt: "2026-03-09T00:00:00.000Z",
    });
    await writeCodexSessionFixture(tempRoot, "rollout-codex-older.jsonl", {
      sessionId: "codex-older-session",
      cwd: "/workspace/cchistory",
      model: "gpt-5",
      prompt: "Older no-op prompt should remain searchable.",
      reply: "Older no-op reply remains indexed.",
      startAt: "2026-03-08T00:00:00.000Z",
    });
    const oldDate = new Date("2020-01-01T00:00:00.000Z");
    await utimes(oldFile, oldDate, oldDate);
    await utimes(olderFile, oldDate, oldDate);

    const storeDir = path.join(tempRoot, "store");
    const firstSync = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(firstSync.exitCode, 0, firstSync.stderr);

    const secondSync = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--since", "1h", "--json", "--detail"], tempRoot);
    assert.equal(secondSync.exitCode, 0, secondSync.stderr);
    const payload = JSON.parse(secondSync.stdout);
    assert.equal(payload.sources[0].counts.turns, 2);
    assert.match(secondSync.stderr, /\[sync:codex:file_skip\]/);
    assert.match(secondSync.stderr, /\[sync:all:reindex_skip\]/);
    assert.doesNotMatch(secondSync.stderr, /\[sync:all:reindex_done\]/);

    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    try {
      const stageRuns = db.prepare("SELECT payload_json FROM stage_runs").all()
        .map((row) => JSON.parse((row as { payload_json: string }).payload_json) as StageRun);
      const indexRun = stageRuns.find((run) => run.stage_kind === "index_projections");
      assert.equal(indexRun?.stats.projection_refresh_skipped, 1);
      assert.equal(indexRun?.stats.projection_refresh_ms, 0);
      assert.equal(indexRun?.stats.sync_reindex_ms, 0);
      const captureRun = stageRuns.find((run) => run.stage_kind === "capture");
      assert.equal(captureRun?.stats.sync_metadata_only_reuse_batch_count, 2);
      const finalizeRun = stageRuns.find((run) => run.stage_kind === "finalize_projections");
      assert.equal(typeof finalizeRun?.stats.sqlite_metadata_ms, "number");
      assert.equal(finalizeRun?.stats.sqlite_metadata_write_count, 1);
      assert.equal(finalizeRun?.stats.sqlite_merge_ms, 0);
    } finally {
      db.close();
    }

    const search = await runCliJson<{ results: Array<{ turn: { canonical_text: string } }> }>(
      ["search", "Old no-op prompt", "--store", storeDir],
      tempRoot,
    );
    assert.ok(search.results.some((entry) => entry.turn.canonical_text.includes("Old no-op prompt")));
  } finally {
    process.env.HOME = originalHome;
    if (originalBatchTarget === undefined) {
      delete process.env.CCHISTORY_CODEX_SYNC_BATCH_TARGET_BYTES;
    } else {
      process.env.CCHISTORY_CODEX_SYNC_BATCH_TARGET_BYTES = originalBatchTarget;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync --since skips projection refresh for unchanged old Factory Droid files", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-since-factory-noop-"));
  const originalHome = process.env.HOME;

  try {
    process.env.HOME = tempRoot;
    await mkdir(path.join(tempRoot, ".factory", "sessions"), { recursive: true });
    const factoryFile = path.join(tempRoot, ".factory", "sessions", "factory-old-session.jsonl");
    await writeFile(
      factoryFile,
      [
        {
          timestamp: "2026-03-09T06:00:00.000Z",
          type: "session_start",
          sessionTitle: "Factory no-op session",
          cwd: "/workspace/cchistory",
        },
        {
          timestamp: "2026-03-09T06:00:01.000Z",
          type: "message",
          message: {
            role: "user",
            content: [{ type: "text", text: "Factory no-op prompt should remain searchable." }],
          },
        },
        {
          timestamp: "2026-03-09T06:00:02.000Z",
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Factory no-op reply remains indexed." }],
          },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf8",
    );
    const oldDate = new Date("2020-01-01T00:00:00.000Z");
    await utimes(factoryFile, oldDate, oldDate);

    const storeDir = path.join(tempRoot, "store");
    const firstSync = await runCliCapture(["sync", "--store", storeDir, "--source", "factory_droid"], tempRoot);
    assert.equal(firstSync.exitCode, 0, firstSync.stderr);

    const secondSync = await runCliCapture([
      "sync",
      "--store",
      storeDir,
      "--source",
      "factory_droid",
      "--since",
      "1h",
      "--json",
      "--detail",
    ], tempRoot);
    assert.equal(secondSync.exitCode, 0, secondSync.stderr);
    const payload = JSON.parse(secondSync.stdout);
    assert.equal(payload.sources[0].counts.turns, 1);
    assert.match(secondSync.stderr, /\[sync:factory_droid:file_skip\]/);
    assert.doesNotMatch(secondSync.stderr, /\[sync:factory_droid:file_parse_done\]/);
    assert.match(secondSync.stderr, /\[sync:all:reindex_skip\]/);
    assert.doesNotMatch(secondSync.stderr, /\[sync:all:reindex_done\]/);

    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    try {
      const stageRuns = db.prepare("SELECT payload_json FROM stage_runs").all()
        .map((row) => JSON.parse((row as { payload_json: string }).payload_json) as StageRun);
      const parseRun = stageRuns.find((run) => run.stage_kind === "parse_source_fragments");
      assert.equal(parseRun?.stats.sync_parse_ms, 0);
      const finalizeRun = stageRuns.find((run) => run.stage_kind === "finalize_projections");
      assert.equal(finalizeRun?.stats.sqlite_replace_ms, 0);
      assert.equal(finalizeRun?.stats.sqlite_metadata_write_count, 0);
      const indexRun = stageRuns.find((run) => run.stage_kind === "index_projections");
      assert.equal(indexRun?.stats.projection_refresh_skipped, 1);
      assert.equal(indexRun?.stats.projection_refresh_ms, 0);
      assert.equal(indexRun?.stats.sync_reindex_ms, 0);
    } finally {
      db.close();
    }

    const search = await runCliJson<{ results: Array<{ turn: { canonical_text: string } }> }>(
      ["search", "Factory no-op prompt", "--store", storeDir],
      tempRoot,
    );
    assert.ok(search.results.some((entry) => entry.turn.canonical_text.includes("Factory no-op prompt")));
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync --since backfills file identity metadata for upgraded unchanged Codex blobs", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-since-backfill-"));
  const originalHome = process.env.HOME;

  try {
    process.env.HOME = tempRoot;
    await mkdir(path.join(tempRoot, ".codex", "sessions"), { recursive: true });
    const oldFile = path.join(tempRoot, ".codex", "sessions", "rollout-codex-old.jsonl");
    await writeCodexSessionFixture(tempRoot, "rollout-codex-old.jsonl", {
      sessionId: "codex-old-session",
      cwd: "/workspace/cchistory",
      model: "gpt-5",
      prompt: "Old prompt should backfill metadata.",
      reply: "Old reply remains indexed.",
      startAt: "2026-03-09T00:00:00.000Z",
    });
    const oldDate = new Date("2020-01-01T00:00:00.000Z");
    await utimes(oldFile, oldDate, oldDate);

    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const firstSync = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(firstSync.exitCode, 0, firstSync.stderr);

    updateFirstCapturedBlob(dbPath, (blob) => {
      delete blob.file_changed_at;
      delete blob.file_identity_stable;
    });

    const backfillSync = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--since", "1h", "--detail"], tempRoot);
    assert.equal(backfillSync.exitCode, 0, backfillSync.stderr);
    assert.match(backfillSync.stderr, /\[sync:codex:file_capture_done\]/);
    assert.doesNotMatch(backfillSync.stderr, /without reading content/);
    const backfilledBlob = readFirstCapturedBlob(dbPath);
    assert.equal(backfilledBlob.file_identity_stable, true);
    assert.equal(typeof backfilledBlob.file_changed_at, "string");

    const fastSync = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--since", "1h", "--detail"], tempRoot);
    assert.equal(fastSync.exitCode, 0, fastSync.stderr);
    assert.match(fastSync.stderr, /Reused unchanged file without reading content/);
    assert.doesNotMatch(fastSync.stderr, /\[sync:codex:file_capture_done\]/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync --since repairs old racy Codex captures instead of trusting stat-only metadata", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-since-racy-"));
  const originalHome = process.env.HOME;

  try {
    process.env.HOME = tempRoot;
    await mkdir(path.join(tempRoot, ".codex", "sessions"), { recursive: true });
    const filePath = path.join(tempRoot, ".codex", "sessions", "rollout-codex-session-1.jsonl");
    const oldDate = new Date("2020-01-01T00:00:00.000Z");
    await writeCodexSessionFixture(tempRoot, "rollout-codex-session-1.jsonl", {
      sessionId: "codex-session-1",
      cwd: "/workspace/cchistory",
      model: "gpt-5",
      prompt: "Initial prompt before racy append.",
      reply: "Initial reply before racy append.",
      startAt: "2026-03-09T00:00:00.000Z",
    });
    await utimes(filePath, oldDate, oldDate);

    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const firstSync = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(firstSync.exitCode, 0, firstSync.stderr);

    await appendFile(
      filePath,
      `\n${[
        {
          timestamp: "2026-03-09T00:10:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Appended prompt after racy capture." }],
          },
        },
        {
          timestamp: "2026-03-09T00:10:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Appended reply after racy capture." }],
          },
        },
      ].map((line) => JSON.stringify(line)).join("\n")}`,
      "utf8",
    );
    await utimes(filePath, oldDate, oldDate);
    const appendedStats = await stat(filePath);

    updateFirstCapturedBlob(dbPath, (blob) => {
      blob.size_bytes = appendedStats.size;
      blob.file_modified_at = appendedStats.mtime.toISOString();
      blob.file_changed_at = appendedStats.ctime.toISOString();
      delete blob.file_identity_stable;
    });

    const result = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--since", "1h", "--json", "--detail"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.sources[0].counts.turns, 2);
    assert.match(result.stderr, /\[sync:codex:file_capture_done\]/);
    assert.match(result.stderr, /\[sync:codex:file_parse_done\]/);
    assert.doesNotMatch(result.stderr, /without reading content/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync reuses unchanged Codex projections on a repeated run", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-reuse-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");
    const firstSync = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(firstSync.exitCode, 0, firstSync.stderr);

    const secondSync = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--detail"], tempRoot);
    assert.equal(secondSync.exitCode, 0, secondSync.stderr);
    const reuseLoadIndex = secondSync.stderr.indexOf("[sync:codex:incremental_reuse_load_start]");
    const sourceStartIndex = secondSync.stderr.indexOf("[sync:codex:source_start]");
    assert.ok(reuseLoadIndex >= 0, "incremental reuse load should be visible before source scanning");
    assert.ok(sourceStartIndex > reuseLoadIndex, "source scanning should start after incremental reuse is loaded");
    assert.match(secondSync.stderr, /\[sync:codex:file_skip\]/);
    assert.match(secondSync.stderr, /\[sync:codex:file_done\]/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync reparses same-size same-mtime Codex rewrites instead of trusting stat-only reuse", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-rewrite-"));
  const originalHome = process.env.HOME;

  try {
    process.env.HOME = tempRoot;
    await mkdir(path.join(tempRoot, ".codex", "sessions"), { recursive: true });
    const filePath = path.join(tempRoot, ".codex", "sessions", "rollout-codex-session-1.jsonl");
    const oldDate = new Date("2020-01-01T00:00:00.000Z");
    await writeCodexSessionFixture(tempRoot, "rollout-codex-session-1.jsonl", {
      sessionId: "codex-session-1",
      cwd: "/workspace/cchistory",
      model: "gpt-5",
      prompt: "Alpha prompt.",
      reply: "Alpha reply.",
      startAt: "2026-03-09T00:00:00.000Z",
    });
    await utimes(filePath, oldDate, oldDate);
    const firstSize = (await stat(filePath)).size;

    const storeDir = path.join(tempRoot, "store");
    const firstSync = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(firstSync.exitCode, 0, firstSync.stderr);

    await writeCodexSessionFixture(tempRoot, "rollout-codex-session-1.jsonl", {
      sessionId: "codex-session-1",
      cwd: "/workspace/cchistory",
      model: "gpt-5",
      prompt: "Bravo prompt.",
      reply: "Bravo reply.",
      startAt: "2026-03-09T00:00:00.000Z",
    });
    await utimes(filePath, oldDate, oldDate);
    assert.equal((await stat(filePath)).size, firstSize);

    const result = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--since", "1h", "--detail"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stderr, /\[sync:codex:file_parse_done\]/);
    assert.doesNotMatch(result.stderr, /\[sync:codex:file_reuse\]|\[sync:codex:file_skip\]/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync preserves empty unchanged Codex file evidence across reuse", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-empty-reuse-"));
  const originalHome = process.env.HOME;

  try {
    process.env.HOME = tempRoot;
    await mkdir(path.join(tempRoot, ".codex", "sessions"), { recursive: true });
    await writeFile(path.join(tempRoot, ".codex", "sessions", "empty.jsonl"), "", "utf8");
    const storeDir = path.join(tempRoot, "store");

    const firstSync = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--json"], tempRoot);
    assert.equal(firstSync.exitCode, 0, firstSync.stderr);
    const firstPayload = JSON.parse(firstSync.stdout);
    assert.equal(firstPayload.sources[0].counts.blobs, 1);
    assert.equal(firstPayload.sources[0].counts.records, 0);

    const secondSync = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--json", "--detail"], tempRoot);
    assert.equal(secondSync.exitCode, 0, secondSync.stderr);
    const secondPayload = JSON.parse(secondSync.stdout);
    assert.equal(secondPayload.sources[0].counts.blobs, 1);
    assert.equal(secondPayload.sources[0].counts.records, 0);
    assert.match(secondSync.stderr, /\[sync:codex:file_skip\]/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync reuses unchanged Claude Code files that share one session without duplicating rows", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-claude-multifile-"));
  const originalHome = process.env.HOME;

  try {
    process.env.HOME = tempRoot;
    const claudeDir = path.join(tempRoot, ".claude", "projects");
    await mkdir(claudeDir, { recursive: true });
    const makeClaudeLine = (timestamp: string, type: "user" | "assistant", text: string) => JSON.stringify({
      sessionId: "claude-shared-session",
      timestamp,
      type,
      cwd: "/workspace/claude-project",
      message: {
        role: type,
        content: [{ type: "text", text }],
      },
    });
    await writeFile(
      path.join(claudeDir, "parent.jsonl"),
      [
        makeClaudeLine("2026-03-09T01:00:00.000Z", "user", "Parent asks for review."),
        makeClaudeLine("2026-03-09T01:00:01.000Z", "assistant", "Parent review complete."),
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(claudeDir, "child.jsonl"),
      [
        makeClaudeLine("2026-03-09T01:10:00.000Z", "user", "Child asks for detail."),
        makeClaudeLine("2026-03-09T01:10:01.000Z", "assistant", "Child detail complete."),
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(claudeDir, "stale.jsonl"),
      [
        makeClaudeLine("2026-03-09T01:20:00.000Z", "user", "Stale asks should disappear."),
        makeClaudeLine("2026-03-09T01:20:01.000Z", "assistant", "Stale detail complete."),
      ].join("\n"),
      "utf8",
    );

    const storeDir = path.join(tempRoot, "store");
    const firstSync = await runCliCapture(["sync", "--store", storeDir, "--source", "claude_code", "--json"], tempRoot);
    assert.equal(firstSync.exitCode, 0, firstSync.stderr);
    const firstPayload = JSON.parse(firstSync.stdout);
    assert.equal(firstPayload.sources[0].counts.turns, 3);

    await rm(path.join(claudeDir, "stale.jsonl"));
    const secondSync = await runCliCapture(["sync", "--store", storeDir, "--source", "claude_code", "--json", "--detail"], tempRoot);
    assert.equal(secondSync.exitCode, 0, secondSync.stderr);
    const secondPayload = JSON.parse(secondSync.stdout);
    assert.equal(secondPayload.sources[0].counts.turns, 2);
    assert.match(secondSync.stderr, /Loaded previous Claude Code reuse inputs \(2 blob\(s\)\)/);
    assert.match(secondSync.stderr, /\[sync:claude_code:file_skip\]/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync mixed Claude Code reuse and reparse preserves skipped shared-session turns", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-claude-mixed-"));
  const originalHome = process.env.HOME;

  try {
    process.env.HOME = tempRoot;
    const claudeDir = path.join(tempRoot, ".claude", "projects");
    await mkdir(claudeDir, { recursive: true });
    const makeClaudeLine = (input: {
      sessionId: string;
      timestamp: string;
      type: "user" | "assistant";
      text?: string;
      toolId?: string;
      toolName?: string;
      toolResult?: string;
    }) => JSON.stringify({
      sessionId: input.sessionId,
      timestamp: input.timestamp,
      type: input.type,
      cwd: "/workspace/claude-project",
      message: {
        role: input.type,
        content: input.toolName
          ? [
              { type: "text", text: input.text ?? "Using a tool." },
              { type: "tool_use", id: input.toolId, name: input.toolName, input: { cmd: "pwd" } },
            ]
          : input.toolResult
            ? [{ type: "tool_result", tool_use_id: input.toolId, content: [{ type: "text", text: input.toolResult }] }]
            : [{ type: "text", text: input.text }],
      },
    });
    const parentPath = path.join(claudeDir, "parent.jsonl");
    const childPath = path.join(claudeDir, "child.jsonl");
    await writeFile(
      parentPath,
      [
        makeClaudeLine({ sessionId: "claude-shared-session", timestamp: "2026-03-09T01:00:00.000Z", type: "user", text: "Parent asks for review." }),
        makeClaudeLine({ sessionId: "claude-shared-session", timestamp: "2026-03-09T01:00:01.000Z", type: "assistant", text: "Parent starts tool.", toolId: "tool-a", toolName: "shell" }),
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      childPath,
      [
        makeClaudeLine({ sessionId: "claude-shared-session", timestamp: "2026-03-09T01:00:02.000Z", type: "assistant", toolId: "tool-a", toolResult: "/workspace/claude-project" }),
      ].join("\n"),
      "utf8",
    );

    const storeDir = path.join(tempRoot, "store");
    const firstSync = await runCliCapture(["sync", "--store", storeDir, "--source", "claude_code"], tempRoot);
    assert.equal(firstSync.exitCode, 0, firstSync.stderr);

    await writeFile(
      childPath,
      [
        makeClaudeLine({ sessionId: "claude-shared-session", timestamp: "2026-03-09T01:00:02.000Z", type: "assistant", text: "Child file rewritten without old tool result." }),
      ].join("\n"),
      "utf8",
    );
    const result = await runCliCapture(["sync", "--store", storeDir, "--source", "claude_code", "--json", "--detail"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.sources[0].counts.turns, 1);
    assert.match(result.stderr, /\[sync:claude_code:file_skip\]/);
    assert.match(result.stderr, /\[sync:claude_code:file_parse_done\]/);

    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    try {
      // B.6: V1 user_turns is gone. Read canonical_text_full directly from V2.
      const turns = db
        .prepare("SELECT canonical_text_full FROM user_turns_v2 ORDER BY submission_started_at")
        .all()
        .map((row) => (row as { canonical_text_full: string }).canonical_text_full);
      assert.deepEqual(turns, ["Parent asks for review."]);

      const dangling = db.prepare(`
        SELECT COUNT(*) AS count
        FROM atom_edges e
        LEFT JOIN conversation_atoms from_atom ON from_atom.id = e.from_atom_id
        LEFT JOIN conversation_atoms to_atom ON to_atom.id = e.to_atom_id
        WHERE from_atom.id IS NULL OR to_atom.id IS NULL
      `).get() as { count: number };
      assert.equal(dangling.count, 0);
    } finally {
      db.close();
    }
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync incrementally parses appended Codex and Claude Code JSONL records", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-append-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");
    const firstSync = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--source", "claude_code"], tempRoot);
    assert.equal(firstSync.exitCode, 0, firstSync.stderr);

    await appendFile(
      path.join(tempRoot, ".codex", "sessions", "rollout-codex-session-1.jsonl"),
      `\n${[
        {
          timestamp: "2026-03-09T00:10:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Append a Codex follow-up." }],
          },
        },
        {
          timestamp: "2026-03-09T00:10:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Codex follow-up appended." }],
          },
        },
      ].map((line) => JSON.stringify(line)).join("\n")}`,
      "utf8",
    );
    await appendFile(
      path.join(tempRoot, ".claude", "projects", "conversation.jsonl"),
      `\n${[
        {
          timestamp: "2026-03-09T01:10:00.000Z",
          type: "user",
          cwd: "/workspace/claude-project",
          message: {
            role: "user",
            content: [{ type: "text", text: "Append a Claude follow-up." }],
          },
        },
        {
          timestamp: "2026-03-09T01:10:01.000Z",
          type: "assistant",
          cwd: "/workspace/claude-project",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Claude follow-up appended." }],
          },
        },
      ].map((line) => JSON.stringify(line)).join("\n")}`,
      "utf8",
    );

    const result = await runCliCapture([
      "sync",
      "--store",
      storeDir,
      "--source",
      "codex",
      "--source",
      "claude_code",
      "--json",
      "--detail",
    ], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.sources.find((entry: { source: { slot_id: string } }) => entry.source.slot_id === "codex").counts.turns, 2);
    assert.equal(payload.sources.find((entry: { source: { slot_id: string } }) => entry.source.slot_id === "claude_code").counts.turns, 2);
    assert.match(result.stderr, /\[sync:codex:file_append_done\]/);
    assert.match(result.stderr, /\[sync:claude_code:file_append_done\]/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync falls back to full parse when append completes a previously invalid Codex line", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-partial-line-"));
  const originalHome = process.env.HOME;

  try {
    process.env.HOME = tempRoot;
    await mkdir(path.join(tempRoot, ".codex", "sessions"), { recursive: true });
    const filePath = path.join(tempRoot, ".codex", "sessions", "rollout-codex-partial.jsonl");
    await writeFile(
      filePath,
      [
        JSON.stringify({
          timestamp: "2026-03-09T00:00:00.000Z",
          type: "session_meta",
          payload: { id: "codex-partial-session", cwd: "/workspace/cchistory", model: "gpt-5" },
        }),
        `{"timestamp":"2026-03-09T00:00:01.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Partial`,
      ].join("\n"),
      "utf8",
    );

    const storeDir = path.join(tempRoot, "store");
    const firstSync = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(firstSync.exitCode, 0, firstSync.stderr);

    await appendFile(filePath, ` prompt."}]}}\n`, "utf8");
    const result = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--json", "--detail"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.sources[0].counts.turns, 1);
    assert.match(result.stderr, /\[sync:codex:file_parse_done\]/);
    assert.doesNotMatch(result.stderr, /\[sync:codex:file_append_done\]/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync falls back to full parse when a Codex append does not start on a JSONL line boundary", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-append-boundary-"));
  const originalHome = process.env.HOME;

  try {
    process.env.HOME = tempRoot;
    await mkdir(path.join(tempRoot, ".codex", "sessions"), { recursive: true });
    const filePath = path.join(tempRoot, ".codex", "sessions", "rollout-codex-no-newline.jsonl");
    await writeFile(
      filePath,
      [
        JSON.stringify({
          timestamp: "2026-03-09T00:00:00.000Z",
          type: "session_meta",
          payload: { id: "codex-no-newline-session", cwd: "/workspace/cchistory", model: "gpt-5" },
        }),
        JSON.stringify({
          timestamp: "2026-03-09T00:00:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Initial prompt without trailing newline." }],
          },
        }),
      ].join("\n"),
      "utf8",
    );

    const storeDir = path.join(tempRoot, "store");
    const firstSync = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(firstSync.exitCode, 0, firstSync.stderr);

    await appendFile(
      filePath,
      JSON.stringify({
        timestamp: "2026-03-09T00:00:02.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "This write continues the same physical line." }],
        },
      }),
      "utf8",
    );
    const result = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--detail"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stderr, /\[sync:codex:file_parse_done\]/);
    assert.doesNotMatch(result.stderr, /\[sync:codex:file_append_done\]/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync does not reuse stale append snapshots after a Codex file is truncated", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-truncate-"));
  const originalHome = process.env.HOME;

  try {
    process.env.HOME = tempRoot;
    await mkdir(path.join(tempRoot, ".codex", "sessions"), { recursive: true });
    const filePath = path.join(tempRoot, ".codex", "sessions", "rollout-codex-session-1.jsonl");
    const oldDate = new Date("2020-01-01T00:00:00.000Z");
    const writeOriginal = async () => {
      await writeCodexSessionFixture(tempRoot, "rollout-codex-session-1.jsonl", {
        sessionId: "codex-session-1",
        cwd: "/workspace/cchistory",
        model: "gpt-5",
        prompt: "Original prompt only.",
        reply: "Original reply only.",
        startAt: "2026-03-09T00:00:00.000Z",
      });
      await utimes(filePath, oldDate, oldDate);
    };

    await writeOriginal();
    const storeDir = path.join(tempRoot, "store");
    const firstSync = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(firstSync.exitCode, 0, firstSync.stderr);

    await appendFile(
      filePath,
      `\n${JSON.stringify({
        timestamp: "2026-03-09T00:10:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Temporary appended prompt." }],
        },
      })}\n${JSON.stringify({
        timestamp: "2026-03-09T00:10:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Temporary appended reply." }],
        },
      })}`,
      "utf8",
    );
    const appendSync = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(appendSync.exitCode, 0, appendSync.stderr);

    await writeOriginal();
    const result = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--json", "--detail"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.sources[0].counts.turns, 1);
    assert.match(result.stderr, /\[sync:codex:file_parse_done\]/);
    assert.doesNotMatch(result.stderr, /\[sync:codex:file_reuse\]/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync --progress jsonl emits machine-readable progress without corrupting stdout JSON", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-jsonl-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");

    const result = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--json", "--progress", "jsonl"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.command, "sync");
    const progress = result.stderr.trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(progress.some((entry) => entry.kind === "sync-progress" && entry.stage === "store_open_start"));
    assert.ok(progress.some((entry) => entry.kind === "sync-progress" && entry.stage === "incremental_reuse_load_start"));
    assert.ok(progress.some((entry) => entry.kind === "sync-progress" && entry.stage === "source_start"));
    assert.ok(progress.some((entry) => entry.kind === "sync-progress" && entry.stage === "reindex_done"));
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync records an unavailable selected source as an error and continues with healthy sources", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-partial-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");
    await rm(path.join(tempRoot, ".claude"), { recursive: true, force: true });

    const result = await runCliCapture([
      "sync",
      "--store",
      storeDir,
      "--source",
      "codex",
      "--source",
      "claude_code",
      "--json",
    ], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.command, "sync");
    assert.equal(payload.sources.length, 2);
    assert.ok(payload.sources.some((entry: { source: { slot_id: string; sync_status: string } }) =>
      entry.source.slot_id === "codex" && entry.source.sync_status === "healthy"));
    assert.ok(payload.failures.some((failure: { slot_id: string; error_message: string }) =>
      failure.slot_id === "claude_code" && /Source path not found/.test(failure.error_message)));
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("doctor reports store compatibility and source diagnostics without creating a store", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-doctor-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");
    const payload = await runCliJson<{
      kind: string;
      store: { status: string; future_schema: boolean };
      adapters: Array<{ platform: string; support_tier: string }>;
      capped_probes: Array<{ slot_id: string; status: string }>;
    }>(["doctor", "--store", storeDir, "--source", "codex"], tempRoot);

    assert.equal(payload.kind, "doctor");
    assert.equal(payload.store.status, "missing");
    assert.equal(payload.store.future_schema, false);
    assert.ok(payload.adapters.some((adapter) => adapter.platform === "codex" && adapter.support_tier === "stable"));
    assert.ok(payload.capped_probes.some((probe) => probe.slot_id === "codex"));
    assert.equal(await fileExists(path.join(storeDir, "cchistory.sqlite")), false);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("doctor reports future store schemas read-only instead of migrating them", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-doctor-future-"));

  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    await mkdir(storeDir, { recursive: true });
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`
        CREATE TABLE schema_meta (
          key TEXT PRIMARY KEY,
          value_text TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      db.prepare("INSERT INTO schema_meta (key, value_text, updated_at) VALUES (?, ?, ?)")
        .run("schema_version", "2999-01-01.1", "2999-01-01T00:00:00.000Z");
    } finally {
      db.close();
    }

    const payload = await runCliJson<{
      store: { status: string; schema_version: string; future_schema: boolean };
    }>(["doctor", "--store", storeDir, "--store-only"], tempRoot);

    assert.equal(payload.store.status, "future_schema");
    assert.equal(payload.store.schema_version, "2999-01-01.1");
    assert.equal(payload.store.future_schema, true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("templates prints format profiles without opening a store", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-templates-"));

  try {
    const profiles = await runCliJson<Array<{ id: string; family: string }>>(["templates"], tempRoot);
    assert.ok(profiles.length > 0);
    assert.ok(profiles.some((profile) => profile.family === "local_runtime_sessions"));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("--help renders usage without touching storage-backed commands", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-help-"));

  try {
    const result = await runCliCapture(["--help"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /^Usage:/);
    assert.match(result.stdout, /cchistory sync/);
    assert.match(result.stdout, /--index\s+Read from existing store only/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("command help renders from the registry without opening a store", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-command-help-"));

  try {
    const searchHelp = await runCliCapture(["search", "--help"], tempRoot);
    assert.equal(searchHelp.exitCode, 0, searchHelp.stderr);
    assert.match(searchHelp.stdout, /Usage: cchistory search <query>/);
    assert.match(searchHelp.stdout, /--project <ref>/);
    assert.match(searchHelp.stdout, /--index\s+Read from existing store only/);
    assert.doesNotMatch(searchHelp.stderr, /Store not found|unable to open database/);

    const agentHelp = await runCliCapture(["help", "agent", "pull"], tempRoot);
    assert.equal(agentHelp.exitCode, 0, agentHelp.stderr);
    assert.match(agentHelp.stdout, /Usage: cchistory agent pull/);
    assert.match(agentHelp.stdout, /--state-file <file>/);
    assert.doesNotMatch(agentHelp.stderr, /Store not found|unable to open database/);

    const statsHelp = await runCliCapture(["help", "stats"], tempRoot);
    assert.equal(statsHelp.exitCode, 0, statsHelp.stderr);
    assert.match(statsHelp.stdout, /Usage: cchistory stats \[--by model\|project\|source\|host\|day\|month\]/);
    assert.match(statsHelp.stdout, /--by <dimension>\s+Group token usage by this dimension\. One of: model, project, source, host, day, month\./);
    assert.match(statsHelp.stdout, /cchistory stats --by model/);

    const statsUsageHelp = await runCliCapture(["stats", "usage", "--help"], tempRoot);
    assert.equal(statsUsageHelp.exitCode, 0, statsUsageHelp.stderr);
    assert.match(statsUsageHelp.stdout, /Usage: cchistory stats usage --by model\|project\|source\|host\|day\|month/);
    assert.match(statsUsageHelp.stdout, /--by <dimension>\s+Group token usage by this dimension\. One of: model, project, source, host, day, month\./);
    assert.doesNotMatch(statsUsageHelp.stderr, /Store not found|unable to open database/);

    const mergeHelp = await runCliCapture(["help", "merge"], tempRoot);
    assert.equal(mergeHelp.exitCode, 0, mergeHelp.stderr);
    assert.match(mergeHelp.stdout, /--on-conflict <mode>\s+Conflict behavior\. One of: skip, replace\./);
    assert.doesNotMatch(mergeHelp.stdout, /One of: error, skip, replace/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("parser accepts global and command flags before or after positionals", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-parse-order-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");
    const syncResult = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);

    const globalFirst = await runCliCapture(["--json", "search", "probe", "--store", storeDir], tempRoot);
    assert.equal(globalFirst.exitCode, 0, globalFirst.stderr);
    assert.equal(JSON.parse(globalFirst.stdout).kind, "search");

    const globalLast = await runCliCapture(["search", "probe", "--store", storeDir, "--json"], tempRoot);
    assert.equal(globalLast.exitCode, 0, globalLast.stderr);
    assert.equal(JSON.parse(globalLast.stdout).kind, "search");

    const commandOptionBeforeQuery = await runCliCapture(["search", "--limit", "1", "probe", "--store", storeDir, "--json"], tempRoot);
    assert.equal(commandOptionBeforeQuery.exitCode, 0, commandOptionBeforeQuery.stderr);
    const payload = JSON.parse(commandOptionBeforeQuery.stdout);
    assert.equal(payload.kind, "search");
    assert.ok(payload.results.length <= 1);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("parser rejects unknown, invalid, and duplicate command options", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-strict-"));

  try {
    const unknown = await runCliCapture(["search", "probe", "--unknown"], tempRoot);
    assert.equal(unknown.exitCode, 1);
    assert.match(unknown.stderr, /Unknown option '--unknown'/);

    const wrongCommand = await runCliCapture(["search", "probe", "--out", "bundle"], tempRoot);
    assert.equal(wrongCommand.exitCode, 1);
    assert.match(wrongCommand.stderr, /Unknown option for `search`: --out/);

    const invalidNumber = await runCliCapture(["search", "--limit", "nope", "probe"], tempRoot);
    assert.equal(invalidNumber.exitCode, 1);
    assert.match(invalidNumber.stderr, /Invalid numeric value for --limit: nope/);

    const duplicate = await runCliCapture(["search", "--limit", "1", "--limit", "2", "probe"], tempRoot);
    assert.equal(duplicate.exitCode, 1);
    assert.match(duplicate.stderr, /Option --limit can only be provided once/);

    const invalidStatsDimension = await runCliCapture(["stats", "--by", "workspace"], tempRoot);
    assert.equal(invalidStatsDimension.exitCode, 1);
    assert.match(invalidStatsDimension.stderr, /Invalid value for --by: workspace\. Expected one of model, project, source, host, day, month\./);

    const invalidMergeConflict = await runCliCapture(["merge", "--from", "a.sqlite", "--to", "b.sqlite", "--on-conflict", "abort"], tempRoot);
    assert.equal(invalidMergeConflict.exitCode, 1);
    assert.match(invalidMergeConflict.stderr, /Invalid value for --on-conflict: abort\. Expected one of skip, replace\./);
    assert.doesNotMatch(invalidMergeConflict.stderr, /error, skip, replace/);

    const missingStatsDimension = await runCliCapture(["stats", "usage"], tempRoot);
    assert.equal(missingStatsDimension.exitCode, 1);
    assert.match(missingStatsDimension.stderr, /`stats usage` requires --by <dimension>/);
    assert.match(missingStatsDimension.stderr, /Example: cchistory stats usage --by model/);
    assert.doesNotMatch(missingStatsDimension.stderr, /Store not found|unable to open database/);

    const negativeLimit = await runCliCapture(["search", "--limit=-1", "probe"], tempRoot);
    assert.equal(negativeLimit.exitCode, 1);
    assert.match(negativeLimit.stderr, /Invalid value for --limit: -1\. Expected a positive integer\./);
    assert.doesNotMatch(negativeLimit.stderr, /Store not found|unable to open database/);

    const fractionalOffset = await runCliCapture(["search", "--offset", "1.5", "probe"], tempRoot);
    assert.equal(fractionalOffset.exitCode, 1);
    assert.match(fractionalOffset.stderr, /Invalid value for --offset: 1\.5\. Expected a non-negative integer\./);

    const conflictingReadModes = await runCliCapture(["--full", "--index", "stats"], tempRoot);
    assert.equal(conflictingReadModes.exitCode, 1);
    assert.match(conflictingReadModes.stderr, /Choose either --full or --index, not both\./);
    assert.doesNotMatch(conflictingReadModes.stderr, /Store not found|unable to open database/);

    const zeroInterval = await runCliCapture(["agent", "schedule", "--interval-seconds", "0"], tempRoot);
    assert.equal(zeroInterval.exitCode, 1);
    assert.match(zeroInterval.stderr, /Invalid value for --interval-seconds: 0\. Expected a positive integer\./);
    assert.doesNotMatch(zeroInterval.stderr, /Remote agent state file not found|fetch failed/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("usage errors for incomplete commands happen before store or remote access", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-usage-errors-"));

  try {
    const cases: Array<{ argv: string[]; pattern: RegExp }> = [
      { argv: ["tree", "project"], pattern: /Use `tree projects`, `tree project <project-id-or-slug>`, or `tree session <session-ref>`\./ },
      { argv: ["tree", "projects", "extra"], pattern: /Use `tree projects`, `tree project <project-id-or-slug>`, or `tree session <session-ref>`\./ },
      { argv: ["show", "banana", "x"], pattern: /Use `show project\|session\|turn\|source <ref>`\./ },
      { argv: ["show", "project", "cchistory", "extra"], pattern: /Use `show project\|session\|turn\|source <ref>`\./ },
      { argv: ["query"], pattern: /Use `query turns\|turn\|sessions\|session\|projects\|project \.\.\.`\./ },
      { argv: ["query", "turns", "extra"], pattern: /Use `query turns\|turn\|sessions\|session\|projects\|project \.\.\.`\./ },
      { argv: ["query", "turn"], pattern: /Missing required --id flag\./ },
      { argv: ["agent", "pair"], pattern: /Missing required --server flag\./ },
      { argv: ["agent", "schedule"], pattern: /Missing required --interval-seconds flag\./ },
      { argv: ["restore-check"], pattern: /`restore-check` requires an explicit --store or --db target\./ },
      { argv: ["export"], pattern: /Missing required --out flag\./ },
      { argv: ["merge", "--from", "a.sqlite"], pattern: /Missing required --to flag\./ },
    ];

    for (const { argv, pattern } of cases) {
      const result = await runCliCapture(argv, tempRoot);
      assert.equal(result.exitCode, 1, argv.join(" "));
      assert.match(result.stderr, pattern, argv.join(" "));
      assert.doesNotMatch(result.stderr, /Store not found|unable to open database|ENOENT|fetch failed/, argv.join(" "));
      assert.equal(result.stdout, "", argv.join(" "));
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("errors hide stack traces unless debug is enabled", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-debug-"));
  const originalDebug = process.env.CCHISTORY_DEBUG;

  try {
    delete process.env.CCHISTORY_DEBUG;
    const normal = await runCliCapture(["unknown"], tempRoot);
    assert.equal(normal.exitCode, 1);
    assert.doesNotMatch(normal.stderr, /\n\s+at /);

    const flagDebug = await runCliCapture(["--debug", "unknown"], tempRoot);
    assert.equal(flagDebug.exitCode, 1);
    assert.match(flagDebug.stderr, /\n\s+at /);

    process.env.CCHISTORY_DEBUG = "1";
    const envDebug = await runCliCapture(["unknown"], tempRoot);
    assert.equal(envDebug.exitCode, 1);
    assert.match(envDebug.stderr, /\n\s+at /);
  } finally {
    if (originalDebug === undefined) {
      delete process.env.CCHISTORY_DEBUG;
    } else {
      process.env.CCHISTORY_DEBUG = originalDebug;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("--json failures keep stdout empty and print actionable text to stderr", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-json-error-"));

  try {
    const result = await runCliCapture(["--json", "search"], tempRoot);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Search requires a query string\./);
    assert.doesNotMatch(result.stderr, /\n\s+at /);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("--no-color disables ANSI even when FORCE_COLOR is set", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-no-color-"));
  const originalForceColor = process.env.FORCE_COLOR;
  const originalNoColor = process.env.NO_COLOR;

  try {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;

    const colored = await runCliCapture(["unknown"], tempRoot);
    assert.equal(colored.exitCode, 1);
    assert.match(colored.stderr, /\x1b\[/);

    const plain = await runCliCapture(["--no-color", "unknown"], tempRoot);
    assert.equal(plain.exitCode, 1);
    assert.doesNotMatch(plain.stderr, /\x1b\[/);
  } finally {
    if (originalForceColor === undefined) {
      delete process.env.FORCE_COLOR;
    } else {
      process.env.FORCE_COLOR = originalForceColor;
    }
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function rewriteCodexStageRunParserVersion(dbPath: string, parserVersion: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    const rows = db.prepare("SELECT id, payload_json FROM stage_runs").all() as Array<{
      id: string;
      payload_json: string;
    }>;
    const update = db.prepare("UPDATE stage_runs SET payload_json = ? WHERE id = ?");
    for (const row of rows) {
      const stageRun = JSON.parse(row.payload_json) as StageRun;
      if (stageRun.parser_version?.startsWith("codex-parser@")) {
        update.run(JSON.stringify({ ...stageRun, parser_version: parserVersion }), row.id);
      }
    }
  } finally {
    db.close();
  }
}

function insertStaleCodexUnhandledAuditForOrigin(dbPath: string, originBasename: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    const blobRows = db.prepare("SELECT payload_json FROM captured_blobs").all() as Array<{
      payload_json: string;
    }>;
    const blob = blobRows
      .map((row) => JSON.parse(row.payload_json) as CapturedBlob)
      .find((entry) => path.basename(entry.origin_path) === originBasename);
    assert.ok(blob, `expected captured blob for ${originBasename}`);

    const recordRow = db
      .prepare("SELECT payload_json FROM raw_records WHERE source_id = ? AND blob_id = ? ORDER BY ordinal LIMIT 1")
      .get(blob.source_id, blob.id) as { payload_json: string } | undefined;
    assert.ok(recordRow, `expected raw record for ${originBasename}`);
    const record = JSON.parse(recordRow.payload_json) as RawRecord;
    const stageRunRow = db
      .prepare("SELECT payload_json FROM stage_runs WHERE source_id = ? LIMIT 1")
      .get(blob.source_id) as { payload_json: string } | undefined;
    assert.ok(stageRunRow, `expected stage run for ${originBasename}`);
    const stageRun = JSON.parse(stageRunRow.payload_json) as StageRun;
    const audit: LossAuditRecord = {
      id: `loss-audit:stale:${record.id}`,
      source_id: blob.source_id,
      stage_run_id: stageRun.id,
      stage_kind: "parse_source_fragments",
      diagnostic_code: "codex_unhandled_record_type",
      severity: "warning",
      scope_ref: record.id,
      session_ref: record.session_ref,
      blob_ref: blob.id,
      record_ref: record.id,
      source_format_profile_id: "codex:jsonl:v1",
      loss_kind: "unknown_fragment",
      detail: "Stale diagnostic from an older Codex parser.",
      created_at: "2026-03-09T01:00:03.000Z",
    };
    db.prepare(`
      INSERT OR REPLACE INTO loss_audits (
        id,
        source_id,
        stage_kind,
        diagnostic_code,
        session_ref,
        blob_ref,
        record_ref,
        fragment_ref,
        atom_ref,
        candidate_ref,
        payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      audit.id,
      audit.source_id,
      audit.stage_kind,
      audit.diagnostic_code,
      audit.session_ref ?? "",
      audit.blob_ref ?? "",
      audit.record_ref ?? "",
      audit.fragment_ref ?? "",
      audit.atom_ref ?? "",
      audit.candidate_ref ?? "",
      JSON.stringify(audit),
    );
  } finally {
    db.close();
  }
}

function countCodexUnhandledAudits(dbPath: string): number {
  const db = new DatabaseSync(dbPath);
  try {
    return (db.prepare("SELECT payload_json FROM loss_audits").all() as Array<{ payload_json: string }>)
      .map((row) => JSON.parse(row.payload_json) as LossAuditRecord)
      .filter((audit) => audit.diagnostic_code === "codex_unhandled_record_type")
      .length;
  } finally {
    db.close();
  }
}

function readFirstCapturedBlob(dbPath: string): CapturedBlob {
  const db = new DatabaseSync(dbPath);
  try {
    const row = db
      .prepare("SELECT id, payload_json FROM captured_blobs ORDER BY id LIMIT 1")
      .get() as { id: string; payload_json: string } | undefined;
    assert.ok(row, "expected at least one captured blob");
    return JSON.parse(row.payload_json) as CapturedBlob;
  } finally {
    db.close();
  }
}

function updateFirstCapturedBlob(dbPath: string, mutate: (blob: CapturedBlob) => void): CapturedBlob {
  const db = new DatabaseSync(dbPath);
  try {
    const row = db
      .prepare("SELECT id, payload_json FROM captured_blobs ORDER BY id LIMIT 1")
      .get() as { id: string; payload_json: string } | undefined;
    assert.ok(row, "expected at least one captured blob");
    const blob = JSON.parse(row.payload_json) as CapturedBlob;
    mutate(blob);
    db.prepare("UPDATE captured_blobs SET payload_json = ? WHERE id = ?").run(JSON.stringify(blob), row.id);
    return blob;
  } finally {
    db.close();
  }
}
