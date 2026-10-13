// Task-scoped Full storage assessment. Never opens an operator store.
// Build the CLI first; see docs/evidence/2026-10-11-storage-cost-assessment.md.
// No new package.json command: this investigation is not an operator workflow.
import "../install-node-sqlite-warning-filter.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, stat, statfs, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(entry), "../..");
const MiB = 1024 * 1024;
const anchor = "storagecostanchor";
const tailAnchor = "storagecosttailmarker";
const profiles = {
  smoke: { sessions: 2, turns: 6, toolBytes: 1024, platforms: ["codex", "claude_code"] },
  recall1000: { sessions: 20, turns: 50, toolBytes: 0, platforms: ["codex", "claude_code"] },
  recall4000: { sessions: 80, turns: 50, toolBytes: 0, platforms: ["codex", "claude_code"] },
  oldhistory4000: { sessions: 80, turns: 50, toolBytes: 0, platforms: ["codex", "claude_code"], fileTime: "2026-01-01T00:00:00Z" },
  toolmany: { sessions: 20, turns: 20, toolBytes: 64 * 1024, platforms: ["codex"] },
  toollong: { sessions: 1, turns: 400, toolBytes: 64 * 1024, platforms: ["codex"] },
  longuser: { sessions: 1, turns: 2, toolBytes: 0, userBytes: 64 * 1024, platforms: ["codex"] },
};

if (process.argv[2] === "--worker") {
  await worker(process.argv[3], process.argv[4], JSON.parse(process.argv[5]), JSON.parse(process.argv[6]));
} else {
  await main();
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
  const selected = value("--profiles", "recall1000,recall4000,oldhistory4000,toolmany,toollong,longuser").split(",");
  const repeats = Number(value("--repeats", "3"));
  assert.ok(Number.isInteger(repeats) && repeats >= 1 && repeats <= 5);
  assert.ok(selected.every((name) => Object.hasOwn(profiles, name)), "unknown fixture profile");
  const report = {
    generated_at: new Date().toISOString(), node: process.version, platform: process.platform,
    arch: process.arch, heap_limit_mib: 768, repeats, profiles: {},
    method: "Sequential fresh workers; kernel maxRSS in KiB; sampled WAL peak, not cumulative write bytes. Source roots isolated through a worker-local os.homedir stub. No OS cache flush.",
  };
  for (const name of selected) {
    const spec = profiles[name];
    const estimate = (spec.sessions * spec.turns * (spec.toolBytes + 2000) + (spec.userBytes ?? 0)) * 30 + 64 * MiB;
    const fs = await statfs(os.tmpdir());
    assert.ok(Number(fs.bavail) * Number(fs.bsize) >= 2 * estimate, "insufficient temp disk headroom");
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-cost-"));
    try {
      const sources = await seed(fixtureRoot, spec);
      const result = { fixture: spec, phases: {} };
      // Sources are under fake-home native layouts, separate from the store.
      result.source_bytes_initial = (await Promise.all(sources.map(async (file) => (await stat(file)).size))).reduce((a, b) => a + b, 0);
      const run = async (phase, count = repeats, targets = {}) => {
        const runs = [];
        for (let n = 0; n < count; n++) runs.push(await child(phase, fixtureRoot, spec, targets));
        result.phases[phase] = runs;
        process.stdout.write(`${name} ${phase}: ${runs.map((r) => `${r.process_ms.toFixed(0)} ms / ${(r.max_rss_bytes / MiB).toFixed(1)} MiB`).join(", ")}\n`);
        return runs;
      };
      await run("sync_first", 1);
      result.first_footprint = await footprint(fixtureRoot, sources);
      await run("sync_unchanged");
      await run("sync_reuse_full_scan");
      await appendFile(sources[0], serializeTurns(spec.platforms[0], 0, spec.turns, 5, spec));
      await run("sync_append", 1);
      result.final_footprint = await footprint(fixtureRoot, sources);
      result.source_bytes_final = (await Promise.all(sources.map(async (file) => (await stat(file)).size))).reduce((a, b) => a + b, 0);
      const db = new DatabaseSync(path.join(fixtureRoot, "store/cchistory.sqlite"), { readOnly: true });
      try {
        for (const previous of result.first_footprint.verified_input_captures) {
          const blob = db.prepare("SELECT storage_path FROM evidence_blobs WHERE sha256=?").get(previous.evidence_sha256);
          assert.ok(blob, "superseded parser input was pruned after append");
          assert.equal(createHash("sha256").update(await readFile(path.resolve(fixtureRoot, "store", blob.storage_path))).digest("hex"), previous.evidence_sha256);
        }
        result.superseded_input_integrity = "all initial capture hashes retained and verified after append and end-of-sync GC";
      } finally { db.close(); }
      const targets = (await child("targets", fixtureRoot, spec, {})).result;
      for (const phase of ["page", "session", "search", "search_project", "detail", "detail_targeted_diagnostic", "sql_page_diagnostic", "page_cold_index_diagnostic"]) await run(phase, repeats, targets);
      if (spec.userBytes) {
        await run("search_tail", 1, targets);
        await run("search_tail_project", 1, targets);
      }
      report.profiles[name] = result;
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  }
  const output = value("--output", undefined);
  if (output) await writeFile(path.resolve(output), `${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function child(phase, fixtureRoot, spec, targets) {
  const started = performance.now();
  let walPeak = 0;
  const timer = setInterval(() => {
    stat(path.join(fixtureRoot, "store/cchistory.sqlite-wal")).then((s) => { walPeak = Math.max(walPeak, s.size); }).catch(() => {});
  }, 10);
  try {
    const output = await new Promise((resolve, reject) => {
      const task = spawn(process.execPath, ["--max-old-space-size=768", entry, "--worker", phase, fixtureRoot, JSON.stringify(spec), JSON.stringify(targets)], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => task.kill("SIGTERM"), 120_000);
      task.stdout.on("data", (chunk) => { stdout += chunk; });
      task.stderr.on("data", (chunk) => { stderr += chunk; });
      task.on("error", reject);
      task.on("close", (code, signal) => {
        clearTimeout(timeout);
        if (code !== 0) reject(new Error(`${phase} failed (${code ?? signal}): ${stderr.slice(-4000)}`));
        else {
          try { resolve(JSON.parse(stdout)); }
          catch (error) { reject(error); }
        }
      });
    });
    return { ...output, process_ms: performance.now() - started, sampled_wal_peak_bytes: walPeak };
  } finally {
    clearInterval(timer);
  }
}

async function worker(phase, fixtureRoot, spec, targets) {
  assert.equal(path.basename(fixtureRoot).startsWith("cchistory-storage-cost-"), true);
  const store = path.join(fixtureRoot, "store");
  const originalHomedir = os.homedir;
  os.homedir = () => fixtureRoot;
  const { CCHistoryStorage } = await import("../../packages/storage/dist/index.js");
  const { getDefaultSourcesForHost } = await import("../../packages/source-adapters/dist/index.js");
  for (const source of getDefaultSourcesForHost({ includeMissing: true }).filter((s) => spec.platforms.includes(s.platform))) {
    assert.ok(source.base_dir.startsWith(`${fixtureRoot}${path.sep}`), "source isolation failed");
  }
  // Inspection of existing implementation methods; no production code changes.
  // Timings are inclusive and overlap. Do not add them together.
  const calls = {};
  for (const name of ["computeProjectLinkSnapshot", "refreshDerivedState", "getSourceIncrementalPayloadForOriginPaths", "getSourceIncrementalMetadataPayload", "replaceSourcePayload", "mergeSourcePayloadByOriginPath", "mergeSourcePayloadStreaming", "refreshGlobalDerivedCacheRefs", "pruneEvidenceBlobsNow"]) {
    const original = CCHistoryStorage.prototype[name];
    if (typeof original !== "function") continue;
    CCHistoryStorage.prototype[name] = function (...args) {
      const started = performance.now();
      const before = this.db.prepare("SELECT total_changes() AS n").get().n;
      const done = () => {
        const item = calls[name] ??= { calls: 0, ms: 0, sql_row_changes: 0 };
        item.calls++;
        item.ms += performance.now() - started;
        item.sql_row_changes += this.db.prepare("SELECT total_changes() AS n").get().n - before;
      };
      try {
        const out = original.apply(this, args);
        if (out instanceof Promise) return out.finally(done);
        done();
        return out;
      } catch (error) { done(); throw error; }
    };
  }
  const started = performance.now();
  const before = process.resourceUsage();
  let result;
  let storage;
  try {
    if (phase.startsWith("sync_")) {
      const { runCli } = await import("../../apps/cli/dist/index.js");
      const stdout = [];
      const stderr = [];
      const argv = ["sync", "--store", store, ...spec.platforms.flatMap((p) => ["--source", p]), "--json"];
      if (phase === "sync_reuse_full_scan") argv.push("--force-full-resync");
      const exitCode = await runCli(argv, { cwd: fixtureRoot, stdout: (s) => stdout.push(s), stderr: (s) => stderr.push(s), isInteractiveTerminal: false });
      assert.equal(exitCode, 0, stderr.join(""));
      const parsed = JSON.parse(stdout.join(""));
      assert.deepEqual(parsed.failures, []);
      assert.equal(parsed.sources.length, spec.platforms.length);
      result = { sources: parsed.sources.map((s) => ({ platform: s.source.platform, total_turns: s.source.total_turns, counts: s.counts })) };
    } else if (phase === "sql_page_diagnostic") {
      const db = new DatabaseSync(path.join(store, "cchistory.sqlite"), { readOnly: true });
      try {
        const rows = db.prepare("SELECT turn_id, session_id, source_id, submission_started_at, canonical_text FROM user_turns_v2 ORDER BY submission_started_at DESC, turn_id ASC LIMIT 20").all();
        result = { rows: rows.length, sql_plan: db.prepare("EXPLAIN QUERY PLAN SELECT turn_id, session_id, source_id, submission_started_at, canonical_text FROM user_turns_v2 ORDER BY submission_started_at DESC, turn_id ASC LIMIT 20").all() };
      } finally { db.close(); }
    } else {
      storage = new CCHistoryStorage(store);
      if (phase === "targets") {
        const db = new DatabaseSync(path.join(store, "cchistory.sqlite"), { readOnly: true });
        let row;
        try { row = db.prepare("SELECT turn_id FROM user_turns_v2 WHERE canonical_text LIKE ? LIMIT 1").get(`%${anchor}%`); }
        finally { db.close(); }
        assert.ok(row);
        const turn = storage.getResolvedTurn(row.turn_id);
        result = { turn_id: turn.id, session_id: turn.session_id, project_id: turn.project_id };
        assert.ok(result.project_id);
      } else if (phase === "page" || phase === "page_cold_index_diagnostic") {
        if (phase === "page_cold_index_diagnostic") storage.db.exec("DELETE FROM resolved_read_index_state");
        const times = [];
        let page;
        for (let n = 0; n < 6; n++) {
          const t = performance.now();
          page = storage.listResolvedTurnsPage(0, 20);
          times.push(performance.now() - t);
        }
        assert.equal(page.total, spec.sessions * spec.turns + 5);
        assert.equal(page.turns.length, Math.min(20, page.total));
        result = { total: page.total, rows: page.turns.length, first_page_ms: times[0], warm_page_ms: times.slice(1) };
      } else if (phase === "session") {
        const turns = storage.listSessionTurnsForReadSurface(targets.session_id);
        assert.equal(turns.length, spec.turns + 5);
        result = { rows: turns.length };
      } else if (phase === "detail" || phase === "detail_targeted_diagnostic") {
        const turn = phase === "detail" ? storage.getResolvedTurn(targets.turn_id) : storage.getTurn(targets.turn_id);
        const context = storage.getTurnContext(targets.turn_id);
        assert.ok(turn.raw_text.includes(anchor));
        if (spec.userBytes) assert.ok(turn.raw_text.includes(tailAnchor) && turn.canonical_text.includes(tailAnchor));
        if (spec.toolBytes) assert.ok(JSON.stringify(context).includes("storage-cost-tool-payload"));
        result = { raw_user_bytes: Buffer.byteLength(turn.raw_text), context_json_bytes: Buffer.byteLength(JSON.stringify(context)) };
      } else {
        const tailSearch = phase.startsWith("search_tail");
        const search = storage.searchTurnsPaginated({ query: tailSearch ? tailAnchor : anchor, project_id: phase === "search_project" || phase === "search_tail_project" ? targets.project_id : undefined, limit: 5 });
        if (!tailSearch) assert.equal(search.total, 1);
        result = { rows: search.results.length, total: search.total, expected_matches: 1, search_mode: storage.searchMode };
      }
    }
  } finally {
    storage?.close();
    os.homedir = originalHomedir;
  }
  const usage = process.resourceUsage();
  process.stdout.write(JSON.stringify({ operation_ms: performance.now() - started, max_rss_bytes: usage.maxRSS * 1024, cpu_user_ms: (usage.userCPUTime - before.userCPUTime) / 1000, cpu_system_ms: (usage.systemCPUTime - before.systemCPUTime) / 1000, fs_read_operations: usage.fsRead - before.fsRead, fs_write_operations: usage.fsWrite - before.fsWrite, calls, result }));
}

async function seed(fixtureRoot, spec) {
  const files = [];
  for (let session = 0; session < spec.sessions; session++) {
    const platform = spec.platforms[session % spec.platforms.length];
    const base = platform === "codex" ? path.join(fixtureRoot, ".codex/sessions") : path.join(fixtureRoot, ".claude/projects/-workspace-storage-cost");
    await mkdir(base, { recursive: true });
    const file = path.join(base, `${platform}-session-${session}.jsonl`);
    const header = platform === "codex" ? `${JSON.stringify({ type: "session_meta", timestamp: timestamp(session, 0, 0), payload: { id: `cost-${platform}-${session}`, cwd: `/workspace/storage-cost/project-${session % 4}`, model: "fixture-model" } })}\n` : "";
    await writeFile(file, header + serializeTurns(platform, session, 0, spec.turns, spec));
    if (spec.fileTime) await utimes(file, new Date(spec.fileTime), new Date(spec.fileTime));
    files.push(file);
  }
  return files;
}

function serializeTurns(platform, session, start, count, spec) {
  const lines = [];
  const nativeSession = `cost-${platform}-${session}`;
  const cwd = `/workspace/storage-cost/project-${session % 4}`;
  const add = (turn, step, record) => lines.push(JSON.stringify({ timestamp: timestamp(session, turn, step), ...record }));
  for (let turn = start; turn < start + count; turn++) {
    const target = session === 0 && turn === 0;
    const prompt = `${target ? anchor : `noise-${session}-${turn}`} inspect project-${session % 4} turn ${turn}.` + (target && spec.userBytes ? ` ${"long user input ".repeat(Math.ceil(spec.userBytes / 16))}${tailAnchor}` : "");
    if (platform === "codex") {
      add(turn, 1, { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: prompt }] } });
      if (spec.toolBytes) {
        add(turn, 2, { type: "response_item", payload: { type: "function_call", call_id: `call-${turn}`, name: "shell", arguments: '{"cmd":"fixture diagnostic"}' } });
        add(turn, 3, { type: "response_item", payload: { type: "function_call_output", call_id: `call-${turn}`, output: `storage-cost-tool-payload-${session}-${turn} ${"x".repeat(spec.toolBytes)}` } });
      }
      add(turn, 4, { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: `Recorded fixture turn ${session}-${turn}.` }] } });
    } else {
      add(turn, 1, { type: "user", sessionId: nativeSession, cwd, message: { role: "user", content: [{ type: "text", text: prompt }] } });
      add(turn, 4, { type: "assistant", sessionId: nativeSession, cwd, message: { role: "assistant", model: "fixture-model", content: [{ type: "text", text: `Recorded fixture turn ${session}-${turn}.` }] } });
    }
  }
  return `${lines.join("\n")}\n`;
}

function timestamp(session, turn, step) {
  return new Date(Date.UTC(2026, 9, 1) + (session * 10000 + turn * 10 + step) * 1000).toISOString();
}

async function footprint(fixtureRoot, sources) {
  const store = path.join(fixtureRoot, "store");
  const db = new DatabaseSync(path.join(store, "cchistory.sqlite"), { readOnly: true });
  try {
    const tables = {};
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'search_%'").all()) {
      const columns = db.prepare(`PRAGMA table_info("${name}")`).all();
      tables[name] = { rows: db.prepare(`SELECT count(*) AS n FROM "${name}"`).get().n };
      if (columns.some((c) => c.name === "payload_json")) tables[name].payload_bytes = db.prepare(`SELECT coalesce(sum(length(cast(payload_json AS BLOB))),0) AS n FROM "${name}"`).get().n;
    }
    const pages = db.prepare("SELECT name, sum(pgsize) AS page_bytes FROM dbstat GROUP BY name ORDER BY page_bytes DESC").all();
    const captures = db.prepare("SELECT capture_kind, count(*) AS n FROM evidence_captures GROUP BY capture_kind").all();
    // Roles may overlap: these reference sets are not additive.
    const evidenceBytesByRole = {};
    for (const [role, table, column, where] of [
      ["source_blob", "evidence_captures", "evidence_sha256", "WHERE capture_kind='source_blob'"],
      ["record_snapshot", "evidence_captures", "evidence_sha256", "WHERE capture_kind='record_snapshot'"],
      ["context_cache", "turn_context_refs_v2", "context_evidence_sha256", ""],
      ["lineage", "user_turns_v2", "lineage_blob_sha256", ""],
    ]) evidenceBytesByRole[role] = db.prepare(`SELECT coalesce(sum(size_bytes),0) AS n FROM evidence_blobs WHERE sha256 IN (SELECT ${column} FROM ${table} ${where})`).get().n;
    const verified = [];
    for (const file of sources) {
      const bytes = await readFile(file);
      const sha = createHash("sha256").update(bytes).digest("hex");
      const blob = db.prepare("SELECT storage_path FROM evidence_blobs WHERE sha256=?").get(sha);
      assert.ok(blob, "original parser input is not retained by content hash");
      assert.equal(createHash("sha256").update(await readFile(path.resolve(store, blob.storage_path))).digest("hex"), sha);
      verified.push({ source_basename: path.basename(file), bytes: bytes.length, evidence_sha256: sha });
    }
    return { sqlite_bytes: (await stat(path.join(store, "cchistory.sqlite"))).size, evidence_disk_bytes: await treeBytes(path.join(store, "evidence")), evidence_bytes_by_role: evidenceBytesByRole, raw_snapshot_disk_bytes: await treeBytes(path.join(store, "raw")), page_size: db.prepare("PRAGMA page_size").get().page_size, free_pages: db.prepare("PRAGMA freelist_count").get().freelist_count, tables, pages, captures, verified_input_captures: verified };
  } finally { db.close(); }
}

async function treeBytes(dir) {
  let bytes = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch((e) => { if (e.code === "ENOENT") return []; throw e; });
  for (const item of entries) {
    const p = path.join(dir, item.name);
    if (item.isDirectory()) bytes += await treeBytes(p);
    else if (item.isFile()) bytes += (await stat(p)).size;
  }
  return bytes;
}
