/**
 * E2E test helpers for CCHistory.
 *
 * Provides:
 * - CLI runner (out-of-process, captures stdout/stderr/exit code)
 * - API server lifecycle (programmatic Fastify start/stop)
 * - Temp store setup/teardown
 * - Mock data seeding utilities
 * - Storage seeding via replaceSourcePayload (in-process)
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, rm, readdir, stat, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const CLI_ENTRY = path.join(PROJECT_ROOT, "apps/cli/dist/index.js");
const TUI_ENTRY = path.join(PROJECT_ROOT, "apps/tui/dist/index.js");
const MOCK_DATA_ROOT = path.join(PROJECT_ROOT, "mock_data");

// ---------------------------------------------------------------------------
// Pre-flight check: ensure the project is built
// ---------------------------------------------------------------------------

export function ensureBuilt() {
  for (const entry of [CLI_ENTRY]) {
    if (!existsSync(entry)) {
      throw new Error(
        `Build artifact not found: ${entry}\n` +
          `Run "pnpm run build" from the project root before running E2E tests.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Temp directory lifecycle
// ---------------------------------------------------------------------------

export async function createTempRoot(prefix = "cchistory-e2e-") {
  return await mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function removeTempRoot(tempRoot) {
  await rm(tempRoot, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// CLI runner (out-of-process, skeptical — true E2E)
// ---------------------------------------------------------------------------

/**
 * Spawn the built CLI as a child process.
 * Returns { exitCode, stdout, stderr }.
 */
export function runCli(argv, cwd, env = undefined) {
  const childEnv = env ?? { ...process.env, HOME: cwd };
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [CLI_ENTRY, ...argv],
      { cwd, env: childEnv, timeout: 30_000 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          // Real spawn failure (not a non-zero exit)
          reject(error);
          return;
        }
        resolve({
          exitCode: typeof error?.code === "number" ? Number(error.code) : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

/**
 * Run CLI with --json flag and parse the output.
 * Asserts exit code 0.
 */
export async function runCliJson(argv, cwd, env = undefined) {
  const result = await runCli([...argv, "--json"], cwd, env);
  assert.equal(result.exitCode, 0, `CLI failed (exit ${result.exitCode}): ${result.stderr}`);
  return JSON.parse(result.stdout);
}

/**
 * Run CLI and return raw captured output.
 */
export async function runCliCapture(argv, cwd, env = undefined) {
  return await runCli(argv, cwd, env);
}

// ---------------------------------------------------------------------------
// TUI runner (out-of-process)
// ---------------------------------------------------------------------------

export function runTuiCapture(argv, cwd, env = undefined) {
  const childEnv = env ?? { ...process.env, HOME: cwd };
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [TUI_ENTRY, ...argv],
      { cwd, env: childEnv, timeout: 30_000 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve({
          exitCode: typeof error?.code === "number" ? Number(error.code) : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

// ---------------------------------------------------------------------------
// API server lifecycle (programmatic)
// ---------------------------------------------------------------------------

let _createApiRuntime;

/**
 * Start a Fastify API server backed by the given store directory.
 * Returns { app, storage, rawStoreDir, close() }.
 */
export async function startApiServer(storeDir) {
  if (!_createApiRuntime) {
    const apiModule = await import(
      path.join(PROJECT_ROOT, "apps/api/dist/app.js")
    );
    _createApiRuntime = apiModule.createApiRuntime;
  }
  const runtime = await _createApiRuntime({ dataDir: storeDir, sources: [] });
  return {
    app: runtime.app,
    storage: runtime.storage,
    rawStoreDir: runtime.rawStoreDir,
    async close() {
      await runtime.app.close();
      runtime.storage.close();
    },
  };
}

/**
 * Inject an API request and return parsed JSON body.
 */
export async function apiGet(app, url) {
  const response = await app.inject({ method: "GET", url });
  assert.equal(response.statusCode, 200, `API ${url} returned ${response.statusCode}: ${response.body}`);
  return JSON.parse(response.body);
}

// ---------------------------------------------------------------------------
// Storage seeding (in-process, for creating acceptance fixtures)
// ---------------------------------------------------------------------------

let _CCHistoryStorage;

export async function getStorageClass() {
  if (!_CCHistoryStorage) {
    const storageModule = await import(
      path.join(PROJECT_ROOT, "packages/storage/dist/index.js")
    );
    _CCHistoryStorage = storageModule.CCHistoryStorage;
  }
  return _CCHistoryStorage;
}

/**
 * Create a seeded store with multi-source acceptance data.
 * Returns { storeDir, project, targetTurn, targetContext }.
 */
export async function seedAcceptanceStore(storeDir) {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const CCHistoryStorage = await getStorageClass();
  const storage = new CCHistoryStorage(storeDir);
  const fixtureRoot = path.join(path.dirname(storeDir), "source-fixtures");

  try {
    const alphaProject = {
      workspacePath: "/workspace/alpha-history",
      repoRoot: "/workspace/alpha-history",
      repoFingerprint: "repo-fingerprint-alpha-history",
    };
    const betaProject = {
      workspacePath: "/workspace/beta-compare",
      repoRoot: "/workspace/beta-compare",
      repoFingerprint: "repo-fingerprint-beta-compare",
    };

    const sources = [
      { id: "src-alpha-codex", text: "Alpha kickoff regression note", platform: "codex", sessionId: "session-alpha-codex", turnId: "turn-alpha-codex", project: alphaProject, createdAt: "2026-04-01T08:00:00.000Z" },
      { id: "src-alpha-claude", text: "Alpha API parity review", platform: "claude_code", sessionId: "session-alpha-claude", turnId: "turn-alpha-claude", project: alphaProject, createdAt: "2026-04-01T08:10:00.000Z" },
      { id: "src-alpha-amp", text: "Alpha traceability target", platform: "amp", sessionId: "session-alpha-amp", turnId: "turn-alpha-amp", project: alphaProject, createdAt: "2026-04-01T08:20:00.000Z" },
      { id: "src-beta-factory", text: "Beta comparison turn", platform: "factory_droid", sessionId: "session-beta-factory", turnId: "turn-beta-factory", project: betaProject, createdAt: "2026-04-01T07:30:00.000Z" },
    ];

    for (const src of sources) {
      const sourceDir = path.join(fixtureRoot, src.id);
      const cacheDir = path.join(sourceDir, ".cache");
      mkdirSync(cacheDir, { recursive: true });
      const contents = JSON.stringify({ fixture: src.id }) + "\n";
      writeFileSync(path.join(sourceDir, "session.jsonl"), contents, "utf8");
      writeFileSync(path.join(cacheDir, "session.jsonl"), contents, "utf8");

      storage.replaceSourcePayload(
        buildAcceptancePayload(src.id, src.text, {
          sourceBaseDir: sourceDir,
          sessionId: src.sessionId,
          turnId: src.turnId,
          hostId: "host-acceptance",
          platform: src.platform,
          workingDirectory: src.project.workspacePath,
          projectObservation: src.project,
          createdAt: src.createdAt,
        }),
      );
    }

    const project = storage.listProjects().find((p) => p.display_name === "alpha-history");
    assert.ok(project, "expected committed alpha-history project in seeded store");
    assert.equal(project.linkage_state, "committed");

    const turns = storage.listProjectTurns(project.project_id, "all");
    assert.equal(turns.length, 3);
    const targetTurn = turns.find((t) => t.id === "turn-alpha-amp");
    assert.ok(targetTurn, "expected seeded target turn in alpha-history project");

    const targetContext = storage.getTurnContext(targetTurn.id);
    assert.ok(targetContext, "expected seeded target context");

    return { storeDir, project, targetTurn, targetContext };
  } finally {
    storage.close();
  }
}

// ---------------------------------------------------------------------------
// Mock data seeding for sync tests (copy fixture dirs into temp HOME)
// ---------------------------------------------------------------------------

/**
 * Seed a temp HOME with the default mock_data sources
 * (codex, claude, factory, amp, cursor, antigravity).
 */
export async function seedDefaultMockDataHome(tempRoot) {
  await cp(path.join(MOCK_DATA_ROOT, ".codex"), path.join(tempRoot, ".codex"), { recursive: true });
  await cp(path.join(MOCK_DATA_ROOT, ".claude"), path.join(tempRoot, ".claude"), { recursive: true });
  await cp(path.join(MOCK_DATA_ROOT, ".factory"), path.join(tempRoot, ".factory"), { recursive: true });
  await cp(path.join(MOCK_DATA_ROOT, ".local", "share", "amp"), path.join(tempRoot, ".local", "share", "amp"), { recursive: true });
  await cp(
    path.join(MOCK_DATA_ROOT, "Library", "Application Support", "Cursor"),
    path.join(tempRoot, "Library", "Application Support", "Cursor"),
    { recursive: true },
  );
  await cp(
    path.join(MOCK_DATA_ROOT, "Library", "Application Support", "Cursor"),
    path.join(tempRoot, ".config", "Cursor"),
    { recursive: true },
  );
  await cp(
    path.join(MOCK_DATA_ROOT, "Library", "Application Support", "antigravity"),
    path.join(tempRoot, "Library", "Application Support", "Antigravity"),
    { recursive: true },
  );
  await cp(
    path.join(MOCK_DATA_ROOT, "Library", "Application Support", "antigravity"),
    path.join(tempRoot, ".config", "Antigravity"),
    { recursive: true },
  );
}

/**
 * Seed a temp HOME with real-layout sources
 * (gemini, opencode, openclaw, codebuddy, cursor).
 */
export async function seedRealLayoutHome(tempRoot) {
  await cp(path.join(MOCK_DATA_ROOT, ".gemini"), path.join(tempRoot, ".gemini"), { recursive: true });
  await cp(path.join(MOCK_DATA_ROOT, ".codebuddy"), path.join(tempRoot, ".codebuddy"), { recursive: true });
  await cp(path.join(MOCK_DATA_ROOT, ".openclaw"), path.join(tempRoot, ".openclaw"), { recursive: true });
  await cp(path.join(MOCK_DATA_ROOT, ".local", "share", "opencode"), path.join(tempRoot, ".local", "share", "opencode"), {
    recursive: true,
  });
  // Cursor chat-store: seed both macOS and Linux paths so tests pass on either platform
  await cp(
    path.join(MOCK_DATA_ROOT, ".cursor", "chats"),
    path.join(tempRoot, "Library", "Application Support", "Cursor", "User", "chats"),
    { recursive: true },
  );
  await cp(
    path.join(MOCK_DATA_ROOT, ".cursor", "chats"),
    path.join(tempRoot, ".config", "Cursor", "User", "chats"),
    { recursive: true },
  );
}

/**
 * Seed a temp HOME with claude + openclaw (for browse/search tests).
 */
export async function seedBrowseSearchHome(tempRoot) {
  await cp(path.join(MOCK_DATA_ROOT, ".claude"), path.join(tempRoot, ".claude"), { recursive: true });
  await cp(path.join(MOCK_DATA_ROOT, ".openclaw"), path.join(tempRoot, ".openclaw"), { recursive: true });
}

// ---------------------------------------------------------------------------
// File system utilities
// ---------------------------------------------------------------------------

export async function fileExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function countFiles(rootDir) {
  if (!existsSync(rootDir)) return 0;
  let total = 0;
  const entries = await readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const nextPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      total += await countFiles(nextPath);
    } else if (entry.isFile()) {
      total += 1;
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Acceptance payload builder
// ---------------------------------------------------------------------------

function shiftIso(iso, seconds) {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

function buildAcceptancePayload(sourceId, canonicalText, options) {
  const createdAt = options.createdAt;
  const assistantAt = shiftIso(createdAt, 1);
  const toolCallAt = shiftIso(createdAt, 2);
  const toolResultAt = shiftIso(createdAt, 3);
  const blobId = `${options.turnId}-blob`;
  const recordId = `${options.turnId}-record`;
  const userFragmentId = `${options.turnId}-fragment-user`;
  const assistantFragmentId = `${options.turnId}-fragment-assistant`;
  const toolCallFragmentId = `${options.turnId}-fragment-tool-call`;
  const toolResultFragmentId = `${options.turnId}-fragment-tool-result`;
  const userAtomId = `${options.turnId}-atom-user`;
  const assistantAtomId = `${options.turnId}-atom-assistant`;
  const toolCallAtomId = `${options.turnId}-atom-tool-call`;
  const toolResultAtomId = `${options.turnId}-atom-tool-result`;
  const projectObservationCandidateId = `${options.turnId}-candidate-project-observation`;

  return {
    source: {
      id: sourceId,
      slot_id: options.platform,
      family: "local_coding_agent",
      platform: options.platform,
      display_name: `${options.platform}:${options.turnId}`,
      base_dir: options.sourceBaseDir,
      host_id: options.hostId,
      last_sync: toolResultAt,
      sync_status: "healthy",
      total_blobs: 1,
      total_records: 1,
      total_fragments: 4,
      total_atoms: 4,
      total_sessions: 1,
      total_turns: 1,
    },
    stage_runs: [
      {
        id: `${options.turnId}-stage-run`,
        source_id: sourceId,
        stage_kind: "finalize_projections",
        parser_version: "fixture-parser@2026-04-01.1",
        parser_capabilities: ["turn_projections", "turn_context_projections", "project_observation_candidates"],
        source_format_profile_ids: [`${options.platform}:fixture:v1`],
        started_at: createdAt,
        finished_at: toolResultAt,
        status: "success",
        stats: { turns: 1, sessions: 1 },
      },
    ],
    loss_audits: [],
    blobs: [
      {
        id: blobId,
        source_id: sourceId,
        host_id: options.hostId,
        origin_path: path.join(options.sourceBaseDir, "session.jsonl"),
        captured_path: path.join(options.sourceBaseDir, ".cache", "session.jsonl"),
        checksum: `${sourceId}-checksum`,
        size_bytes: 128,
        captured_at: createdAt,
        capture_run_id: `${options.turnId}-capture-run`,
      },
    ],
    records: [
      {
        id: recordId,
        source_id: sourceId,
        blob_id: blobId,
        session_ref: options.sessionId,
        ordinal: 0,
        record_path_or_offset: "0",
        observed_at: createdAt,
        parseable: true,
        raw_json: '{"fixture":true}',
      },
    ],
    fragments: [
      { id: userFragmentId, source_id: sourceId, session_ref: options.sessionId, record_id: recordId, seq_no: 0, fragment_kind: "text", actor_kind: "user", origin_kind: "user_authored", time_key: createdAt, payload: { text: canonicalText }, raw_refs: [recordId], source_format_profile_id: `${options.platform}:fixture:v1` },
      { id: assistantFragmentId, source_id: sourceId, session_ref: options.sessionId, record_id: recordId, seq_no: 1, fragment_kind: "text", actor_kind: "assistant", origin_kind: "assistant_authored", time_key: assistantAt, payload: { text: "Processing." }, raw_refs: [recordId], source_format_profile_id: `${options.platform}:fixture:v1` },
      { id: toolCallFragmentId, source_id: sourceId, session_ref: options.sessionId, record_id: recordId, seq_no: 2, fragment_kind: "tool_call", actor_kind: "tool", origin_kind: "tool_generated", time_key: toolCallAt, payload: { call_id: "call-1", tool_name: "shell", input: {} }, raw_refs: [recordId], source_format_profile_id: `${options.platform}:fixture:v1` },
      { id: toolResultFragmentId, source_id: sourceId, session_ref: options.sessionId, record_id: recordId, seq_no: 3, fragment_kind: "tool_result", actor_kind: "tool", origin_kind: "tool_generated", time_key: toolResultAt, payload: { call_id: "call-1", output: "ok" }, raw_refs: [recordId], source_format_profile_id: `${options.platform}:fixture:v1` },
    ],
    atoms: [
      { id: userAtomId, source_id: sourceId, session_ref: options.sessionId, seq_no: 0, actor_kind: "user", origin_kind: "user_authored", content_kind: "text", time_key: createdAt, display_policy: "show", payload: { text: canonicalText }, fragment_refs: [userFragmentId], source_format_profile_id: `${options.platform}:fixture:v1` },
      { id: assistantAtomId, source_id: sourceId, session_ref: options.sessionId, seq_no: 1, actor_kind: "assistant", origin_kind: "assistant_authored", content_kind: "text", time_key: assistantAt, display_policy: "show", payload: { text: "Processing." }, fragment_refs: [assistantFragmentId], source_format_profile_id: `${options.platform}:fixture:v1` },
      { id: toolCallAtomId, source_id: sourceId, session_ref: options.sessionId, seq_no: 2, actor_kind: "tool", origin_kind: "tool_generated", content_kind: "tool_call", time_key: toolCallAt, display_policy: "show", payload: { call_id: "call-1", tool_name: "shell", input: {} }, fragment_refs: [toolCallFragmentId], source_format_profile_id: `${options.platform}:fixture:v1` },
      { id: toolResultAtomId, source_id: sourceId, session_ref: options.sessionId, seq_no: 3, actor_kind: "tool", origin_kind: "tool_generated", content_kind: "tool_result", time_key: toolResultAt, display_policy: "show", payload: { call_id: "call-1", output: "ok" }, fragment_refs: [toolResultFragmentId], source_format_profile_id: `${options.platform}:fixture:v1` },
    ],
    edges: [],
    candidates: [
      { id: `${options.turnId}-candidate-submission`, source_id: sourceId, session_ref: options.sessionId, candidate_kind: "submission_group", input_atom_refs: [userAtomId], started_at: createdAt, ended_at: createdAt, rule_version: "2026-04-01.1", evidence: {} },
      { id: `${options.turnId}-candidate-turn`, source_id: sourceId, session_ref: options.sessionId, candidate_kind: "turn", input_atom_refs: [userAtomId], started_at: createdAt, ended_at: toolResultAt, rule_version: "2026-04-01.1", evidence: {} },
      { id: `${options.turnId}-candidate-context`, source_id: sourceId, session_ref: options.sessionId, candidate_kind: "context_span", input_atom_refs: [assistantAtomId, toolCallAtomId, toolResultAtomId], started_at: createdAt, ended_at: toolResultAt, rule_version: "2026-04-01.1", evidence: {} },
      {
        id: projectObservationCandidateId, source_id: sourceId, session_ref: options.sessionId, candidate_kind: "project_observation", input_atom_refs: [userAtomId], started_at: createdAt, ended_at: createdAt, rule_version: "2026-04-01.1",
        evidence: {
          workspace_path: options.projectObservation.workspacePath ?? options.workingDirectory,
          workspace_path_normalized: options.projectObservation.workspacePath ?? options.workingDirectory,
          repo_root: options.projectObservation.repoRoot,
          repo_fingerprint: options.projectObservation.repoFingerprint,
          confidence: 0.9,
        },
      },
    ],
    sessions: [
      {
        id: options.sessionId,
        source_id: sourceId,
        source_platform: options.platform,
        host_id: options.hostId,
        title: canonicalText,
        created_at: createdAt,
        updated_at: toolResultAt,
        turn_count: 1,
        model: "gpt-5",
        working_directory: options.workingDirectory,
        sync_axis: "current",
      },
    ],
    turns: [
      {
        id: options.turnId,
        revision_id: `${options.turnId}:r1`,
        user_messages: [
          {
            id: `${options.turnId}-user-message`,
            raw_text: canonicalText,
            sequence: 0,
            is_injected: false,
            created_at: createdAt,
            atom_refs: [userAtomId],
          },
        ],
        raw_text: canonicalText,
        canonical_text: canonicalText,
        display_segments: [{ type: "text", content: canonicalText }],
        created_at: createdAt,
        submission_started_at: createdAt,
        last_context_activity_at: toolResultAt,
        session_id: options.sessionId,
        source_id: sourceId,
        link_state: "unlinked",
        sync_axis: "current",
        value_axis: "active",
        retention_axis: "keep_raw_and_derived",
        context_ref: options.turnId,
        context_summary: {
          assistant_reply_count: 1,
          tool_call_count: 1,
          primary_model: "gpt-5",
          has_errors: false,
        },
        lineage: {
          atom_refs: [userAtomId, assistantAtomId, toolCallAtomId, toolResultAtomId],
          candidate_refs: [
            `${options.turnId}-candidate-submission`,
            `${options.turnId}-candidate-turn`,
            `${options.turnId}-candidate-context`,
            projectObservationCandidateId,
          ],
          fragment_refs: [userFragmentId, assistantFragmentId, toolCallFragmentId, toolResultFragmentId],
          record_refs: [recordId],
          blob_refs: [blobId],
        },
      },
    ],
    contexts: [
      {
        turn_id: options.turnId,
        system_messages: [],
        assistant_replies: [
          {
            id: `${options.turnId}-assistant-reply`,
            content: "Processing.",
            display_segments: [{ type: "text", content: "Processing." }],
            content_preview: "Processing.",
            model: "gpt-5",
            created_at: assistantAt,
            tool_call_ids: [`${options.turnId}-tool-call-projection`],
          },
        ],
        tool_calls: [
          {
            id: `${options.turnId}-tool-call-projection`,
            tool_name: "shell",
            input: {},
            input_summary: "{}",
            input_display_segments: [{ type: "text", content: "{}" }],
            output: "ok",
            output_preview: "ok",
            output_display_segments: [{ type: "text", content: "ok" }],
            status: "success",
            reply_id: `${options.turnId}-assistant-reply`,
            sequence: 0,
            created_at: toolCallAt,
          },
        ],
        raw_event_refs: [recordId],
      },
    ],
  };
}

export { PROJECT_ROOT, CLI_ENTRY, TUI_ENTRY, MOCK_DATA_ROOT };
