// Collects the C.1 pre-migration baseline for the storage-boundary migration.
// Reuses the same scale fixture as scripts/verify-scale-recall.mjs (12 sessions
// per source × 100 turns per session × 2 sources = 2400 turns / 24 sessions)
// and records the seven axes the migration plan calls for:
//   - per-table row counts (V1 and V2)
//   - payload_json bytes per V1 table
//   - evidence_blobs row bytes + on-disk evidence/blobs/ bytes
//   - WAL peak size
//   - first-sync, unchanged-sync, append-sync times
//   - context-detail reconstruction time
//   - search time
//
// Output is a markdown table written to docs/design/STORAGE_BOUNDARY_SCALE_BASELINE.md.

import "./install-node-sqlite-warning-filter.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdir, mkdtemp, rm, writeFile, appendFile, stat, readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const execFileP = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const cliEntry = path.join(projectRoot, "apps", "cli", "dist", "index.js");

const SESSIONS_PER_SOURCE = 12;
const TURNS_PER_SESSION = 100;
const EXPECTED_TOTAL_TURNS = SESSIONS_PER_SOURCE * TURNS_PER_SESSION * 2;
const TARGET_CODEX_ANCHOR = "anchorcodex07042";
const TARGET_CLAUDE_ANCHOR = "anchorclaude11099";
const APPEND_TURN_COUNT = 5;

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-scale-baseline-"));
  const childEnv = { ...process.env, HOME: tempRoot };

  console.log(`[baseline] temp root: ${tempRoot}`);
  try {
    await seedScaleHome(tempRoot);
    const storeDir = path.join(tempRoot, "store");

    // --- First sync (initial population) with WAL peak watcher ---
    // close() runs `PRAGMA wal_checkpoint(TRUNCATE)` which folds the WAL back
    // into the main file; to capture the genuine peak we poll the WAL size
    // during the sync instead of measuring it after.
    const walWatch = startWalWatcher(path.join(storeDir, "cchistory.sqlite-wal"));
    const firstSync = await timeCli(["sync", "--store", storeDir, "--source", "codex", "--source", "claude_code"], tempRoot, childEnv);
    const walPeakBytes = walWatch.stop();
    if (firstSync.exitCode !== 0) {
      throw new Error(`first sync failed: ${firstSync.stderr}`);
    }
    console.log(`[baseline] first sync: ${firstSync.ms} ms`);
    console.log(`[baseline] WAL peak during first sync: ${walPeakBytes} bytes`);

    // --- Unchanged sync (everything reused) ---
    const unchangedSync = await timeCli(["sync", "--store", storeDir, "--source", "codex", "--source", "claude_code"], tempRoot, childEnv);
    if (unchangedSync.exitCode !== 0) {
      throw new Error(`unchanged sync failed: ${unchangedSync.stderr}`);
    }
    console.log(`[baseline] unchanged sync: ${unchangedSync.ms} ms`);

    // --- Append sync (add a few turns to one Codex file) ---
    await appendCodexTurns(path.join(tempRoot, ".codex", "sessions", "rollout-scale-codex-00.jsonl"), APPEND_TURN_COUNT);
    const appendSync = await timeCli(["sync", "--store", storeDir, "--source", "codex", "--source", "claude_code"], tempRoot, childEnv);
    if (appendSync.exitCode !== 0) {
      throw new Error(`append sync failed: ${appendSync.stderr}`);
    }
    console.log(`[baseline] append sync (+${APPEND_TURN_COUNT} turns): ${appendSync.ms} ms`);

    // --- Search time (fallback path — A.1 leaves FTS5 inert until rebuild) ---
    const searchRun = await timeCli(["search", TARGET_CODEX_ANCHOR, "--store", storeDir, "--limit", "5", "--json"], tempRoot, childEnv);
    if (searchRun.exitCode !== 0) {
      throw new Error(`search failed: ${searchRun.stderr}`);
    }
    console.log(`[baseline] search (fallback): ${searchRun.ms} ms`);

    // --- Context-detail reconstruction time ---
    const codexDetailTarget = await findCodexAnchorTurnId(storeDir, tempRoot, childEnv);
    const detailRun = await timeCli(["show", "turn", codexDetailTarget, "--store", storeDir, "--json"], tempRoot, childEnv);
    if (detailRun.exitCode !== 0) {
      throw new Error(`show turn failed: ${detailRun.stderr}`);
    }
    console.log(`[baseline] context-detail reconstruction: ${detailRun.ms} ms`);

    // --- Per-table counts + payload bytes ---
    const tableStats = await collectTableStats(storeDir);

    // --- Evidence bytes ---
    const evidenceBytes = await collectEvidenceBytes(storeDir);

    // --- Final WAL + DB size (after all syncs) ---
    const walFinalBytes = await walSizeBytes(storeDir);
    const dbFinalBytes = await fileSize(path.join(storeDir, "cchistory.sqlite"));

    const baseline = {
      generated_at: new Date().toISOString(),
      fixture: {
        sessions_per_source: SESSIONS_PER_SOURCE,
        turns_per_session: TURNS_PER_SESSION,
        sources: 2,
        total_turns: EXPECTED_TOTAL_TURNS,
        total_sessions: SESSIONS_PER_SOURCE * 2,
      },
      timing_ms: {
        first_sync: firstSync.ms,
        unchanged_sync: unchangedSync.ms,
        append_sync: appendSync.ms,
        search: searchRun.ms,
        context_detail_reconstruction: detailRun.ms,
      },
      // M1: peak RSS per CLI invocation. The V1→V2 migration's whole point
      // is to solve OOM and rate issues, so memory is a first-class axis —
      // not an "extra." Captured by sampling /proc/<pid>/status VmRSS while
      // each child process runs. Zero means /proc was unavailable (non-Linux
      // host); treat as "not available" rather than "0 bytes."
      rss_peak_bytes: {
        first_sync: firstSync.rss_peak_bytes ?? 0,
        unchanged_sync: unchangedSync.rss_peak_bytes ?? 0,
        append_sync: appendSync.rss_peak_bytes ?? 0,
        search: searchRun.rss_peak_bytes ?? 0,
        context_detail_reconstruction: detailRun.rss_peak_bytes ?? 0,
      },
      bytes: {
        wal_peak: walPeakBytes,
        wal_final: walFinalBytes,
        db_final: dbFinalBytes,
        evidence_blobs_db: evidenceBytes.db_bytes,
        evidence_blobs_disk: evidenceBytes.disk_bytes,
      },
      tables: tableStats,
    };

    const md = renderMarkdown(baseline);
    const outPath = path.join(projectRoot, "docs", "design", "STORAGE_BOUNDARY_SCALE_BASELINE.md");
    await writeFile(outPath, md, "utf8");
    console.log(`[baseline] wrote ${outPath}`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function timeCli(argv, cwd, env) {
  const t0 = Date.now();
  const result = await runNodeEntry(cliEntry, argv, cwd, env);
  return { ms: Date.now() - t0, ...result };
}

async function runNodeEntry(entry, argv, cwd, env) {
  return await new Promise((resolve, reject) => {
    let child;
    let rssPeak = 0;
    let exited = false;
    try {
      child = execFile(process.execPath, [entry, ...argv], { cwd, env, timeout: 240_000 }, (error, stdout, stderr) => {
        exited = true;
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve({
          exitCode: typeof error?.code === "number" ? Number(error.code) : 0,
          stdout,
          stderr,
          rss_peak_bytes: rssPeak,
        });
      });
    } catch (error) {
      reject(error);
      return;
    }
    // Sample the child's resident set size while it runs. VmHWM would give
    // the kernel-tracked peak in a single read but disappears with the
    // process; sampling VmRSS every ~25 ms captures the same peak in
    // practice. /proc is Linux-only — non-Linux hosts return 0 (memory
    // axis recorded as "not available" rather than blocking the baseline).
    const sampleRss = () => {
      if (exited || !child?.pid) return;
      readFile(`/proc/${child.pid}/status`, "utf8")
        .then((text) => {
          const m = /VmRSS:\s*(\d+) kB/.exec(text);
          if (m) {
            const bytes = Number(m[1]) * 1024;
            if (bytes > rssPeak) rssPeak = bytes;
          }
        })
        .catch(() => {
          // pid exited between samples, or non-Linux host — ignore.
        });
      if (!exited) setTimeout(sampleRss, 25);
    };
    setTimeout(sampleRss, 25);
  });
}

async function walSizeBytes(storeDir) {
  return await fileSize(path.join(storeDir, "cchistory.sqlite-wal"));
}

async function fileSize(p) {
  try {
    const s = await stat(p);
    return s.size;
  } catch {
    return 0;
  }
}

function startWalWatcher(walPath) {
  let peak = 0;
  let stopped = false;
  const sample = () => {
    if (stopped) return;
    stat(walPath)
      .then((s) => {
        if (s.size > peak) peak = s.size;
      })
      .catch(() => {
        // file may not exist yet — that's fine
      });
    setTimeout(sample, 25);
  };
  sample();
  return {
    stop() {
      stopped = true;
      return peak;
    },
  };
}

async function collectTableStats(storeDir) {
  const dbPath = path.join(storeDir, "cchistory.sqlite");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'search_%' ORDER BY name")
      .all()
      .map((row) => row.name);

    const out = {};
    for (const table of tables) {
      const countRow = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
      let payloadBytes = null;
      // V1 tables that store their state in payload_json — sum the byte length
      // of that column for the baseline.
      const payloadColumnTables = new Set([
        "raw_records",
        "source_fragments",
        "conversation_atoms",
        "atom_edges",
        "derived_candidates",
        "sessions",
        "user_turns",
        "loss_audits",
        "knowledge_artifacts",
        "captured_blobs",
        "project_observations",
        "project_overrides",
        "source_file_ledger",
        "stage_runs",
        "project_current",
      ]);
      if (payloadColumnTables.has(table)) {
        try {
          const row = db.prepare(`SELECT COALESCE(SUM(LENGTH(payload_json)), 0) AS s FROM ${table}`).get();
          payloadBytes = row.s;
        } catch {
          payloadBytes = null;
        }
      }
      out[table] = { rows: countRow.n, payload_json_bytes: payloadBytes };
    }
    return out;
  } finally {
    db.close();
  }
}

async function collectEvidenceBytes(storeDir) {
  const dbPath = path.join(storeDir, "cchistory.sqlite");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  let dbBytes = 0;
  try {
    const row = db.prepare("SELECT COALESCE(SUM(size_bytes), 0) AS s FROM evidence_blobs").get();
    dbBytes = row.s;
  } finally {
    db.close();
  }
  // On-disk bytes — walk evidence/blobs/<sub>/<sha>.
  const diskRoot = path.join(storeDir, "evidence", "blobs");
  let diskBytes = 0;
  try {
    diskBytes = await dirSize(diskRoot);
  } catch {
    diskBytes = 0;
  }
  return { db_bytes: dbBytes, disk_bytes: diskBytes };
}

async function dirSize(root) {
  let total = 0;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const p = path.join(root, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(p);
    } else if (entry.isFile()) {
      const s = await stat(p);
      total += s.size;
    }
  }
  return total;
}

async function findCodexAnchorTurnId(storeDir, cwd, env) {
  const result = await runNodeEntry(cliEntry, ["search", TARGET_CODEX_ANCHOR, "--store", storeDir, "--limit", "5", "--json"], cwd, env);
  if (result.exitCode !== 0) {
    throw new Error(`find anchor failed: ${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout);
  return parsed.results[0].turn.id;
}

// === Scale fixture seeders (mirrored from scripts/verify-scale-recall.mjs) ===

async function seedScaleHome(tempRoot) {
  await seedCodexScaleSessions(path.join(tempRoot, ".codex", "sessions"));
  await seedClaudeScaleSessions(path.join(tempRoot, ".claude", "projects", "-workspace-scale-lab"));
}

async function seedCodexScaleSessions(rootDir) {
  await mkdir(rootDir, { recursive: true });
  for (let sessionIndex = 0; sessionIndex < SESSIONS_PER_SOURCE; sessionIndex++) {
    const sessionId = `scale-codex-session-${pad(sessionIndex)}`;
    const projectIndex = sessionIndex % 4;
    const cwd = `/workspace/scale-lab/codex/project-${pad(projectIndex)}`;
    const lines = [
      {
        timestamp: timeFor(sessionIndex, 0, 0),
        type: "session_meta",
        payload: { id: sessionId, cwd, model: "gpt-5.2" },
      },
      {
        timestamp: timeFor(sessionIndex, 0, 1),
        type: "turn_context",
        payload: { cwd, model: "gpt-5.2" },
      },
    ];

    for (let turnIndex = 0; turnIndex < TURNS_PER_SESSION; turnIndex++) {
      const anchor = sessionIndex === 7 && turnIndex === 42 ? TARGET_CODEX_ANCHOR : `codexnoise${pad(sessionIndex)}${pad(turnIndex)}`;
      const userText = `Scale recall ${anchor} inspect Codex project-${pad(projectIndex)} pagination and detail for turn ${turnIndex}.`;
      lines.push({
        timestamp: timeFor(sessionIndex, turnIndex, 2),
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: userText }],
        },
      });

      if (anchor === TARGET_CODEX_ANCHOR) {
        lines.push({
          timestamp: timeFor(sessionIndex, turnIndex, 3),
          type: "response_item",
          payload: {
            type: "function_call",
            call_id: "scale-target-call",
            name: "shell",
            arguments: JSON.stringify({ cmd: "generate-large-scale-diagnostic-output" }),
          },
        });
        lines.push({
          timestamp: timeFor(sessionIndex, turnIndex, 4),
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "scale-target-call",
            output: `large-scale-diagnostic-output ${"0123456789".repeat(450)}`,
          },
        });
      }

      lines.push({
        timestamp: timeFor(sessionIndex, turnIndex, 5),
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: `Recorded scale detail for ${anchor}.` }],
        },
      });
    }

    await writeJsonl(path.join(rootDir, `rollout-scale-codex-${pad(sessionIndex)}.jsonl`), lines);
  }
}

async function seedClaudeScaleSessions(rootDir) {
  await mkdir(rootDir, { recursive: true });
  for (let sessionIndex = 0; sessionIndex < SESSIONS_PER_SOURCE; sessionIndex++) {
    const sessionId = `scale-claude-session-${pad(sessionIndex)}`;
    const projectIndex = sessionIndex % 4;
    const cwd = `/workspace/scale-lab/claude/project-${pad(projectIndex)}`;
    const lines = [];

    for (let turnIndex = 0; turnIndex < TURNS_PER_SESSION; turnIndex++) {
      const anchor = sessionIndex === 11 && turnIndex === 99 ? TARGET_CLAUDE_ANCHOR : `claudenoise${pad(sessionIndex)}${pad(turnIndex)}`;
      lines.push({
        timestamp: timeFor(100 + sessionIndex, turnIndex, 0),
        type: "user",
        sessionId,
        cwd,
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: `Scale recall ${anchor} inspect Claude project-${pad(projectIndex)} pagination and detail for turn ${turnIndex}.`,
            },
          ],
        },
      });
      lines.push({
        timestamp: timeFor(100 + sessionIndex, turnIndex, 1),
        type: "assistant",
        sessionId,
        cwd,
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: `Recorded scale detail for ${anchor}.` }],
        },
      });
    }

    await writeJsonl(path.join(rootDir, `conversation-scale-claude-${pad(sessionIndex)}.jsonl`), lines);
  }
}

async function appendCodexTurns(filePath, turnCount) {
  const sessionIndex = 0;
  const projectIndex = 0;
  const cwd = `/workspace/scale-lab/codex/project-${pad(projectIndex)}`;
  const lines = [];
  for (let turnIndex = TURNS_PER_SESSION; turnIndex < TURNS_PER_SESSION + turnCount; turnIndex++) {
    const anchor = `codexappend${pad(turnIndex)}`;
    const userText = `Append recall ${anchor} added turn ${turnIndex}.`;
    lines.push({
      timestamp: timeFor(sessionIndex, turnIndex, 2),
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: userText }],
      },
    });
    lines.push({
      timestamp: timeFor(sessionIndex, turnIndex, 5),
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: `Appended detail for ${anchor}.` }],
      },
    });
    void cwd;
  }
  await appendFile(filePath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
}

async function writeJsonl(filePath, entries) {
  await writeFile(filePath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
}

function timeFor(sessionIndex, turnIndex, step) {
  const base = Date.UTC(2026, 2, 9, 0, 0, 0);
  const offsetMs = ((sessionIndex * TURNS_PER_SESSION + turnIndex) * 10 + step) * 1000;
  return new Date(base + offsetMs).toISOString();
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function renderMarkdown(baseline) {
  const lines = [];
  lines.push("# Storage Boundary Scale Baseline (C.1)");
  lines.push("");
  lines.push("Reference baseline for the storage-boundary migration defined in");
  lines.push("[STORAGE_BOUNDARY_MIGRATION_PLAN.md](./STORAGE_BOUNDARY_MIGRATION_PLAN.md) § C.1.");
  lines.push("");
  lines.push("Captured with `scripts/collect-scale-baseline.mjs` against the same fixture");
  lines.push("used by `scripts/verify-scale-recall.mjs` (12 sessions × 100 turns × 2 sources");
  lines.push(`= ${baseline.fixture.total_turns} turns across ${baseline.fixture.total_sessions} sessions).`);
  lines.push("");
  lines.push(`Generated: ${baseline.generated_at}`);
  lines.push("");
  lines.push("## Timing (ms)");
  lines.push("");
  lines.push("| Phase | Milliseconds |");
  lines.push("| --- | ---: |");
  lines.push(`| first sync (initial population) | ${baseline.timing_ms.first_sync} |`);
  lines.push(`| unchanged sync (everything reused) | ${baseline.timing_ms.unchanged_sync} |`);
  lines.push(`| append sync (+${APPEND_TURN_COUNT} turns) | ${baseline.timing_ms.append_sync} |`);
  lines.push(`| search (fallback substring — A.1 leaves FTS5 inert until rebuild) | ${baseline.timing_ms.search} |`);
  lines.push(`| context-detail reconstruction | ${baseline.timing_ms.context_detail_reconstruction} |`);
  lines.push("");
  lines.push("## Disk Footprint (bytes)");
  lines.push("");
  lines.push("| Resource | Bytes |");
  lines.push("| --- | ---: |");
  lines.push(`| WAL peak (sampled during first sync) | ${formatNum(baseline.bytes.wal_peak)} |`);
  lines.push(`| WAL final (after all syncs) | ${formatNum(baseline.bytes.wal_final)} |`);
  lines.push(`| main SQLite file | ${formatNum(baseline.bytes.db_final)} |`);
  lines.push(`| evidence_blobs.total_bytes (DB sum) | ${formatNum(baseline.bytes.evidence_blobs_db)} |`);
  lines.push(`| evidence/blobs/ on-disk | ${formatNum(baseline.bytes.evidence_blobs_disk)} |`);
  lines.push("");
  lines.push("## Peak RSS (bytes, sampled via /proc/<pid>/status)");
  lines.push("");
  lines.push("The V1→V2 migration's purpose is to solve OOM and rate issues, so memory");
  lines.push("is a first-class axis. 0 means /proc was unavailable (non-Linux host);");
  lines.push("treat as \"not available\" rather than \"0 bytes.\"");
  lines.push("");
  lines.push("| Phase | Peak RSS |");
  lines.push("| --- | ---: |");
  lines.push(`| first sync (initial population) | ${formatNum(baseline.rss_peak_bytes.first_sync)} |`);
  lines.push(`| unchanged sync (everything reused) | ${formatNum(baseline.rss_peak_bytes.unchanged_sync)} |`);
  lines.push(`| append sync (+${APPEND_TURN_COUNT} turns) | ${formatNum(baseline.rss_peak_bytes.append_sync)} |`);
  lines.push(`| search | ${formatNum(baseline.rss_peak_bytes.search)} |`);
  lines.push(`| context-detail reconstruction | ${formatNum(baseline.rss_peak_bytes.context_detail_reconstruction)} |`);
  lines.push("");
  lines.push("## Per-table Row Counts and payload_json Bytes");
  lines.push("");
  lines.push("| Table | Rows | payload_json bytes |");
  lines.push("| --- | ---: | ---: |");
  for (const [table, stats] of Object.entries(baseline.tables)) {
    lines.push(`| ${table} | ${formatNum(stats.rows)} | ${stats.payload_json_bytes === null ? "—" : formatNum(stats.payload_json_bytes)} |`);
  }
  lines.push("");
  lines.push("## Acceptance");
  lines.push("");
  lines.push("Phase C.2 will compare its post-migration numbers against this file.");
  lines.push("Hard constraint: every metric <= baseline × 1.1 (no regression beyond 10%).");
  lines.push("");
  return lines.join("\n") + "\n";
}

function formatNum(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
