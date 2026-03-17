import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { SourceSyncPayload } from "@cchistory/domain";
import { CCHistoryStorage } from "@cchistory/storage";
import { runCli } from "./index.js";

test("sync, ls, search, and stats usage render human-readable output for real source shapes", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    const syncResult = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--source", "claude_code"], tempRoot);
    assert.equal(syncResult.exitCode, 0);
    assert.match(syncResult.stdout, /Synced 2 source\(s\)/);

    const listResult = await runCliCapture(["ls", "sources", "--store", storeDir], tempRoot);
    assert.equal(listResult.exitCode, 0);
    assert.match(listResult.stdout, /Source/);
    assert.match(listResult.stdout, /Codex/);
    assert.match(listResult.stdout, /Claude Code/);

    const searchResult = await runCliCapture(["search", "probe", "--store", storeDir], tempRoot);
    assert.equal(searchResult.exitCode, 0);
    assert.match(searchResult.stdout, /Unassigned|workspace/);
    assert.match(searchResult.stdout, /Review the probe output/);

    const statsResult = await runCliCapture(["stats", "usage", "--by", "model", "--store", storeDir], tempRoot);
    assert.equal(statsResult.exitCode, 0);
    assert.match(statsResult.stdout, /Label/);
    assert.match(statsResult.stdout, /gpt-5/);
    assert.match(statsResult.stdout, /claude-sonnet-4-6/);

    const dayStatsResult = await runCliCapture(["stats", "usage", "--by", "day", "--store", storeDir], tempRoot);
    assert.equal(dayStatsResult.exitCode, 0);
    assert.match(dayStatsResult.stdout, /Daily Token Charts/);
    assert.match(dayStatsResult.stdout, /Input Tokens/);
    assert.match(dayStatsResult.stdout, /Cached Input Tokens/);
    assert.match(dayStatsResult.stdout, /2026-03-09/);
    assert.match(dayStatsResult.stdout, /#/);

    const monthStatsResult = await runCliCapture(["stats", "usage", "--by", "month", "--store", storeDir], tempRoot);
    assert.equal(monthStatsResult.exitCode, 0);
    assert.match(monthStatsResult.stdout, /Monthly Token Charts/);
    assert.match(monthStatsResult.stdout, /2026-03/);
  } finally {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("stats usage --by model labels Claude synthetic error replies separately from provider models", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  try {
    await seedCliFixtures(tempRoot, { includeSyntheticClaudeError: true });
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    const syncResult = await runCliCapture(["sync", "--store", storeDir, "--source", "claude_code"], tempRoot);
    assert.equal(syncResult.exitCode, 0);

    const statsResult = await runCliCapture(["stats", "usage", "--by", "model", "--store", storeDir], tempRoot);
    assert.equal(statsResult.exitCode, 0);
    assert.match(statsResult.stdout, /claude-sonnet-4-6/);
    assert.match(statsResult.stdout, /Synthetic Error Reply/);
    assert.match(statsResult.stdout, /system-generated local\/API error messages/);
    assert.equal(statsResult.stdout.includes("<synthetic>"), false);
  } finally {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("pnpm-style leading -- is ignored before the command name", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    assert.equal((await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot)).exitCode, 0);

    const listResult = await runCliCapture(["--", "ls", "projects", "--store", storeDir], tempRoot);
    assert.equal(listResult.exitCode, 0);
    assert.match(listResult.stdout, /Name/);
  } finally {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("search upgrades legacy atom_edges schema in an existing indexed store", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));

  try {
    const storeDir = path.join(tempRoot, "store");
    const storage = new CCHistoryStorage(storeDir);
    try {
      storage.replaceSourcePayload(createLegacySchemaFixturePayload());
    } finally {
      storage.close();
    }

    rewriteAtomEdgesAsLegacyTable(path.join(storeDir, "cchistory.sqlite"));

    const result = await runCliCapture(["search", "claw", "--store", storeDir], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Legacy claw search/);

    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    try {
      const columns = (
        db.prepare("PRAGMA table_info(atom_edges)").all() as Array<{
          name: string;
        }>
      ).map((column) => column.name);
      assert.ok(columns.includes("from_atom_id"));
      assert.ok(columns.includes("to_atom_id"));
    } finally {
      db.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync and ls cover repo mock_data default roots for codex claude factory amp cursor and antigravity", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  try {
    await seedCliMockDataHome(tempRoot);
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    const syncResult = await runCliCapture(["sync", "--store", storeDir], tempRoot);
    assert.equal(syncResult.exitCode, 0);
    assert.match(syncResult.stdout, /Synced 6 source\(s\)/);
    assert.match(syncResult.stdout, /Factory Droid/);
    assert.match(syncResult.stdout, /AMP/);
    assert.match(syncResult.stdout, /Cursor/);
    assert.match(syncResult.stdout, /Antigravity/);

    const listResult = await runCliCapture(["ls", "sources", "--store", storeDir], tempRoot);
    assert.equal(listResult.exitCode, 0);
    assert.match(listResult.stdout, /Codex/);
    assert.match(listResult.stdout, /Claude Code/);
    assert.match(listResult.stdout, /Factory Droid/);
    assert.match(listResult.stdout, /AMP/);
    assert.match(listResult.stdout, /Cursor/);
    assert.match(listResult.stdout, /Antigravity/);

    const storage = new CCHistoryStorage(storeDir);
    try {
      const platforms = storage
        .listSources()
        .map((source) => source.platform)
        .sort();
      assert.deepEqual(platforms, ["amp", "antigravity", "claude_code", "codex", "cursor", "factory_droid"]);
      assert.ok(storage.listResolvedSessions().length >= 13);
      assert.ok(storage.listResolvedTurns().length >= 11);
    } finally {
      storage.close();
    }
  } finally {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync picks up openclaw and opencode default roots in the CLI", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  try {
    await seedCliOpenSourceFixtures(tempRoot);
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    const syncResult = await runCliCapture(["sync", "--store", storeDir], tempRoot);
    assert.equal(syncResult.exitCode, 0);
    assert.match(syncResult.stdout, /Synced 2 source\(s\)/);
    assert.match(syncResult.stdout, /OpenClaw/);
    assert.match(syncResult.stdout, /OpenCode/);

    const listResult = await runCliCapture(["ls", "sources", "--store", storeDir], tempRoot);
    assert.equal(listResult.exitCode, 0);
    assert.match(listResult.stdout, /OpenClaw/);
    assert.match(listResult.stdout, /OpenCode/);

    const statsResult = await runCliCapture(["stats", "usage", "--by", "model", "--store", storeDir], tempRoot);
    assert.equal(statsResult.exitCode, 0);
    assert.match(statsResult.stdout, /sonnet-4/);

    const storage = new CCHistoryStorage(storeDir);
    try {
      const platforms = storage
        .listSources()
        .map((source) => source.platform)
        .sort();
      assert.deepEqual(platforms, ["openclaw", "opencode"]);
      assert.equal(storage.listResolvedSessions().length, 2);
      assert.equal(storage.listResolvedTurns().length, 2);
    } finally {
      storage.close();
    }
  } finally {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("read commands support --full to rescan sources without mutating the indexed store", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    assert.equal((await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot)).exitCode, 0);

    const indexedBefore = await runCliJson<{ sessions: Array<{ id: string }> }>(
      ["ls", "sessions", "--store", storeDir, "--index"],
      tempRoot,
    );
    assert.equal(indexedBefore.sessions.length, 1);

    await writeCodexSessionFixture(tempRoot, "session-2.jsonl", {
      sessionId: "codex-session-2",
      cwd: "/workspace/cchistory",
      model: "gpt-5",
      prompt: "Count the newly scanned session.",
      reply: "The extra session is present.",
      startAt: "2026-03-09T02:00:00.000Z",
    });

    const indexedAfter = await runCliJson<{ sessions: Array<{ id: string }> }>(
      ["ls", "sessions", "--store", storeDir, "--index"],
      tempRoot,
    );
    assert.equal(indexedAfter.sessions.length, 1);

    const fullAfter = await runCliJson<{ sessions: Array<{ id: string }> }>(
      ["ls", "sessions", "--store", storeDir, "--full", "--source", "codex"],
      tempRoot,
    );
    assert.equal(fullAfter.sessions.length, 2);

    const storage = new CCHistoryStorage(storeDir);
    try {
      assert.equal(storage.listResolvedSessions().length, 1);
      assert.equal(storage.listResolvedTurns().length, 1);
    } finally {
      storage.close();
    }
  } finally {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("project listings hide empty projects unless --showall is requested", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    assert.equal((await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot)).exitCode, 0);

    const storage = new CCHistoryStorage(storeDir);
    try {
      storage.upsertProjectOverride({
        target_kind: "turn",
        target_ref: "missing-turn-for-empty-project",
        project_id: "project-empty",
        display_name: "Empty project",
      });
    } finally {
      storage.close();
    }

    const hiddenProjects = await runCliJson<{ projects: Array<{ project_id: string }> }>(
      ["ls", "projects", "--store", storeDir, "--index"],
      tempRoot,
    );
    assert.equal(hiddenProjects.projects.some((project) => project.project_id === "project-empty"), false);

    const shownProjects = await runCliJson<{
      projects: Array<{ project_id: string; session_count: number; committed_turn_count: number; candidate_turn_count: number }>;
    }>(["ls", "projects", "--store", storeDir, "--index", "--showall"], tempRoot);
    const emptyProject = shownProjects.projects.find((project) => project.project_id === "project-empty");
    assert.ok(emptyProject);
    assert.equal(emptyProject.session_count, 0);
    assert.equal(emptyProject.committed_turn_count, 0);
    assert.equal(emptyProject.candidate_turn_count, 0);

    const hiddenTree = await runCliJson<{ projects: Array<{ project_id: string }> }>(
      ["tree", "projects", "--store", storeDir, "--index"],
      tempRoot,
    );
    assert.equal(hiddenTree.projects.some((project) => project.project_id === "project-empty"), false);

    const shownTree = await runCliJson<{ projects: Array<{ project_id: string }> }>(
      ["tree", "projects", "--store", storeDir, "--index", "--showall"],
      tempRoot,
    );
    assert.equal(shownTree.projects.some((project) => project.project_id === "project-empty"), true);
  } finally {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("project listings sort by total turns descending", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  try {
    await seedCliFixtures(tempRoot);
    await writeCodexSessionFixture(tempRoot, "session-2.jsonl", {
      sessionId: "codex-session-2",
      cwd: "/workspace/cchistory",
      model: "gpt-5",
      prompt: "Second turn for the primary project.",
      reply: "Second turn stored.",
      startAt: "2026-03-09T02:00:00.000Z",
    });
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    assert.equal((await runCliCapture(["sync", "--store", storeDir], tempRoot)).exitCode, 0);

    const storage = new CCHistoryStorage(storeDir);
    try {
      const sessions = storage.listResolvedSessions();
      const codexSessions = sessions.filter((session) => session.source_id.includes("codex"));
      assert.ok(codexSessions.length >= 2);
      for (const session of codexSessions) {
        storage.upsertProjectOverride({
          target_kind: "session",
          target_ref: session.id,
          project_id: "project-large",
          display_name: "Large project",
        });
      }
      const claudeSession = sessions.find((session) => session.source_id.includes("claude_code"));
      assert.ok(claudeSession);
      storage.upsertProjectOverride({
        target_kind: "session",
        target_ref: claudeSession.id,
        project_id: "project-small",
        display_name: "Small project",
      });
    } finally {
      storage.close();
    }

    const projects = await runCliJson<{
      projects: Array<{ project_id: string; committed_turn_count: number; candidate_turn_count: number }>;
    }>(["ls", "projects", "--store", storeDir, "--index"], tempRoot);
    const largeIndex = projects.projects.findIndex((project) => project.project_id === "project-large");
    const smallIndex = projects.projects.findIndex((project) => project.project_id === "project-small");
    assert.notEqual(largeIndex, -1);
    assert.notEqual(smallIndex, -1);
    assert.ok(largeIndex < smallIndex);
  } finally {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("export and import round-trip preserves source, session, turn, and usage counts", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;

    const sourceStoreDir = path.join(tempRoot, "source-store");
    const targetStoreDir = path.join(tempRoot, "target-store");
    const bundleDir = path.join(tempRoot, "roundtrip.cchistory-bundle");

    assert.equal((await runCliCapture(["sync", "--store", sourceStoreDir, "--source", "codex", "--source", "claude_code"], tempRoot)).exitCode, 0);
    assert.equal((await runCliCapture(["export", "--store", sourceStoreDir, "--out", bundleDir], tempRoot)).exitCode, 0);
    assert.equal((await runCliCapture(["import", bundleDir, "--store", targetStoreDir], tempRoot)).exitCode, 0);

    const sourceStorage = new CCHistoryStorage(sourceStoreDir);
    const targetStorage = new CCHistoryStorage(targetStoreDir);

    try {
      assert.equal(sourceStorage.listSources().length, targetStorage.listSources().length);
      assert.equal(sourceStorage.listResolvedSessions().length, targetStorage.listResolvedSessions().length);
      assert.equal(sourceStorage.listResolvedTurns().length, targetStorage.listResolvedTurns().length);
      assert.equal(sourceStorage.getUsageOverview().total_tokens, targetStorage.getUsageOverview().total_tokens);
    } finally {
      sourceStorage.close();
      targetStorage.close();
    }
  } finally {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("import is idempotent for an already imported bundle", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    const bundleDir = path.join(tempRoot, "bundle.cchistory-bundle");
    assert.equal((await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot)).exitCode, 0);
    assert.equal((await runCliCapture(["export", "--store", storeDir, "--out", bundleDir], tempRoot)).exitCode, 0);
    assert.equal((await runCliCapture(["import", bundleDir, "--store", storeDir], tempRoot)).exitCode, 0);

    const secondImport = await runCliCapture(["import", bundleDir, "--store", storeDir], tempRoot);
    assert.equal(secondImport.exitCode, 0);
    assert.match(secondImport.stdout, /Skipped Sources/);
  } finally {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("import detects payload conflicts and supports skip and replace", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;

    const sourceStoreDir = path.join(tempRoot, "source-store");
    const targetStoreDir = path.join(tempRoot, "target-store");
    const bundleADir = path.join(tempRoot, "bundle-a.cchistory-bundle");
    const bundleBDir = path.join(tempRoot, "bundle-b.cchistory-bundle");

    assert.equal((await runCliCapture(["sync", "--store", sourceStoreDir, "--source", "codex"], tempRoot)).exitCode, 0);
    assert.equal((await runCliCapture(["export", "--store", sourceStoreDir, "--out", bundleADir], tempRoot)).exitCode, 0);
    assert.equal((await runCliCapture(["import", bundleADir, "--store", targetStoreDir], tempRoot)).exitCode, 0);

    await overwriteCodexPrompt(tempRoot, "Codex prompt changed for conflict test.");
    assert.equal((await runCliCapture(["sync", "--store", sourceStoreDir, "--source", "codex"], tempRoot)).exitCode, 0);
    assert.equal((await runCliCapture(["export", "--store", sourceStoreDir, "--out", bundleBDir], tempRoot)).exitCode, 0);

    const conflictImport = await runCliCapture(["import", bundleBDir, "--store", targetStoreDir], tempRoot);
    assert.equal(conflictImport.exitCode, 1);
    assert.match(conflictImport.stderr, /Source conflict detected/);

    const skipImport = await runCliCapture(["import", bundleBDir, "--store", targetStoreDir, "--on-conflict", "skip"], tempRoot);
    assert.equal(skipImport.exitCode, 0);
    assert.match(skipImport.stdout, /Skipped Sources\s*: 1/);

    const replaceImport = await runCliCapture(["import", bundleBDir, "--store", targetStoreDir, "--on-conflict", "replace"], tempRoot);
    assert.equal(replaceImport.exitCode, 0);
    assert.match(replaceImport.stdout, /Replaced Sources\s*: 1/);

    const targetStorage = new CCHistoryStorage({ dbPath: path.join(targetStoreDir, "cchistory.sqlite") });
    try {
      const turns = targetStorage.listResolvedTurns();
      assert.ok(turns.some((turn) => turn.canonical_text.includes("conflict test")));
    } finally {
      targetStorage.close();
    }
  } finally {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function runCliCapture(argv: string[], cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(argv, {
    cwd,
    stdout: (value) => {
      stdout += value;
    },
    stderr: (value) => {
      stderr += value;
    },
  });
  return { exitCode, stdout, stderr };
}

async function runCliJson<T>(argv: string[], cwd: string): Promise<T> {
  const result = await runCliCapture([...argv, "--json"], cwd);
  assert.equal(result.exitCode, 0, result.stderr);
  return JSON.parse(result.stdout) as T;
}

function rewriteAtomEdgesAsLegacyTable(dbPath: string): void {
  const db = new DatabaseSync(dbPath);

  try {
    db.exec("DROP INDEX IF EXISTS idx_atom_edges_from");
    db.exec("DROP INDEX IF EXISTS idx_atom_edges_to");
    db.exec(`
      CREATE TABLE atom_edges_legacy (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        session_ref TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
    `);
    db.exec(`
      INSERT INTO atom_edges_legacy (id, source_id, session_ref, payload_json)
      SELECT id, source_id, session_ref, payload_json FROM atom_edges;
    `);
    db.exec("DROP TABLE atom_edges");
    db.exec("ALTER TABLE atom_edges_legacy RENAME TO atom_edges");
  } finally {
    db.close();
  }
}

function createLegacySchemaFixturePayload(): SourceSyncPayload {
  return {
    source: {
      id: "src-cli-legacy-search",
      slot_id: "codex",
      family: "local_coding_agent",
      platform: "codex",
      display_name: "CLI legacy search fixture",
      base_dir: "/tmp/cli-legacy-search",
      host_id: "host-cli-legacy-search",
      last_sync: "2026-03-09T00:00:00.000Z",
      sync_status: "healthy",
      total_blobs: 1,
      total_records: 1,
      total_fragments: 4,
      total_atoms: 4,
      total_sessions: 1,
      total_turns: 1,
    },
    stage_runs: [],
    loss_audits: [],
    blobs: [],
    records: [],
    fragments: [],
    atoms: [
      {
        id: "atom-cli-legacy-user",
        source_id: "src-cli-legacy-search",
        session_ref: "session-cli-legacy-search",
        seq_no: 0,
        actor_kind: "user",
        origin_kind: "user_authored",
        content_kind: "text",
        time_key: "2026-03-09T00:00:00.000Z",
        display_policy: "show",
        payload: { text: "Legacy claw search" },
        fragment_refs: [],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: "atom-cli-legacy-assistant",
        source_id: "src-cli-legacy-search",
        session_ref: "session-cli-legacy-search",
        seq_no: 1,
        actor_kind: "assistant",
        origin_kind: "assistant_authored",
        content_kind: "text",
        time_key: "2026-03-09T00:00:01.000Z",
        display_policy: "show",
        payload: { text: "Found claw" },
        fragment_refs: [],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: "atom-cli-legacy-tool-call",
        source_id: "src-cli-legacy-search",
        session_ref: "session-cli-legacy-search",
        seq_no: 2,
        actor_kind: "tool",
        origin_kind: "tool_generated",
        content_kind: "tool_call",
        time_key: "2026-03-09T00:00:02.000Z",
        display_policy: "show",
        payload: { call_id: "call-cli-legacy", tool_name: "shell", input: {} },
        fragment_refs: [],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: "atom-cli-legacy-tool-result",
        source_id: "src-cli-legacy-search",
        session_ref: "session-cli-legacy-search",
        seq_no: 3,
        actor_kind: "tool",
        origin_kind: "tool_generated",
        content_kind: "tool_result",
        time_key: "2026-03-09T00:00:03.000Z",
        display_policy: "show",
        payload: { call_id: "call-cli-legacy", output: "claw" },
        fragment_refs: [],
        source_format_profile_id: "codex:jsonl:v1",
      },
    ],
    edges: [
      {
        id: "edge-cli-legacy-1",
        source_id: "src-cli-legacy-search",
        session_ref: "session-cli-legacy-search",
        from_atom_id: "atom-cli-legacy-tool-call",
        to_atom_id: "atom-cli-legacy-assistant",
        edge_kind: "spawned_from",
      },
      {
        id: "edge-cli-legacy-2",
        source_id: "src-cli-legacy-search",
        session_ref: "session-cli-legacy-search",
        from_atom_id: "atom-cli-legacy-tool-result",
        to_atom_id: "atom-cli-legacy-tool-call",
        edge_kind: "tool_result_for",
      },
    ],
    candidates: [],
    sessions: [
      {
        id: "session-cli-legacy-search",
        source_id: "src-cli-legacy-search",
        source_platform: "codex",
        host_id: "host-cli-legacy-search",
        title: "Legacy claw search",
        created_at: "2026-03-09T00:00:00.000Z",
        updated_at: "2026-03-09T00:00:03.000Z",
        turn_count: 1,
        model: "gpt-5",
        working_directory: "/workspace/legacy-claw",
        sync_axis: "current",
      },
    ],
    turns: [
      {
        id: "turn-cli-legacy-search",
        revision_id: "turn-cli-legacy-search:r1",
        user_messages: [
          {
            id: "message-cli-legacy-user",
            raw_text: "Legacy claw search",
            sequence: 0,
            is_injected: false,
            created_at: "2026-03-09T00:00:00.000Z",
            atom_refs: ["atom-cli-legacy-user"],
          },
        ],
        raw_text: "Legacy claw search",
        canonical_text: "Legacy claw search",
        display_segments: [{ type: "text", content: "Legacy claw search" }],
        created_at: "2026-03-09T00:00:00.000Z",
        submission_started_at: "2026-03-09T00:00:00.000Z",
        last_context_activity_at: "2026-03-09T00:00:03.000Z",
        session_id: "session-cli-legacy-search",
        source_id: "src-cli-legacy-search",
        link_state: "unlinked",
        sync_axis: "current",
        value_axis: "active",
        retention_axis: "keep_raw_and_derived",
        context_ref: "turn-cli-legacy-search",
        context_summary: {
          assistant_reply_count: 1,
          tool_call_count: 1,
          primary_model: "gpt-5",
          has_errors: false,
        },
        lineage: {
          atom_refs: [
            "atom-cli-legacy-user",
            "atom-cli-legacy-assistant",
            "atom-cli-legacy-tool-call",
            "atom-cli-legacy-tool-result",
          ],
          candidate_refs: [],
          fragment_refs: [],
          record_refs: [],
          blob_refs: [],
        },
      },
    ],
    contexts: [
      {
        turn_id: "turn-cli-legacy-search",
        system_messages: [],
        assistant_replies: [
          {
            id: "reply-cli-legacy-assistant",
            content: "Found claw",
            display_segments: [{ type: "text", content: "Found claw" }],
            content_preview: "Found claw",
            model: "gpt-5",
            created_at: "2026-03-09T00:00:01.000Z",
            tool_call_ids: ["tool-call-cli-legacy"],
          },
        ],
        tool_calls: [
          {
            id: "tool-call-cli-legacy",
            tool_name: "shell",
            input: {},
            input_summary: "{}",
            input_display_segments: [{ type: "text", content: "{}" }],
            output: "claw",
            output_preview: "claw",
            output_display_segments: [{ type: "text", content: "claw" }],
            status: "success",
            reply_id: "reply-cli-legacy-assistant",
            sequence: 0,
            created_at: "2026-03-09T00:00:02.000Z",
          },
        ],
        raw_event_refs: [],
      },
    ],
  };
}

function getRepoMockDataRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../mock_data");
}

async function copyTree(source: string, destination: string): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
}

async function seedCliMockDataHome(tempRoot: string): Promise<void> {
  const mockDataRoot = getRepoMockDataRoot();

  await copyTree(path.join(mockDataRoot, ".codex"), path.join(tempRoot, ".codex"));
  await copyTree(path.join(mockDataRoot, ".claude"), path.join(tempRoot, ".claude"));
  await copyTree(path.join(mockDataRoot, ".factory"), path.join(tempRoot, ".factory"));
  await copyTree(path.join(mockDataRoot, ".local", "share", "amp"), path.join(tempRoot, ".local", "share", "amp"));
  await copyTree(
    path.join(mockDataRoot, "Library", "Application Support", "Cursor"),
    path.join(tempRoot, "Library", "Application Support", "Cursor"),
  );
  await copyTree(
    path.join(mockDataRoot, "Library", "Application Support", "Cursor"),
    path.join(tempRoot, ".config", "Cursor"),
  );
  await copyTree(
    path.join(mockDataRoot, "Library", "Application Support", "antigravity"),
    path.join(tempRoot, "Library", "Application Support", "Antigravity"),
  );
  await copyTree(
    path.join(mockDataRoot, "Library", "Application Support", "antigravity"),
    path.join(tempRoot, ".config", "Antigravity"),
  );
}

async function seedCliFixtures(
  tempRoot: string,
  options: {
    includeSyntheticClaudeError?: boolean;
  } = {},
): Promise<void> {
  await mkdir(path.join(tempRoot, ".codex", "sessions"), { recursive: true });
  await mkdir(path.join(tempRoot, ".claude", "projects"), { recursive: true });

  await writeCodexSessionFixture(tempRoot, "session.jsonl", {
    sessionId: "codex-session-1",
    cwd: "/workspace/cchistory",
    model: "gpt-5",
    prompt: "Review the probe output.",
    reply: "Probe output looks healthy.",
    startAt: "2026-03-09T00:00:00.000Z",
  });

  const claudeConversation: Array<Record<string, unknown>> = [
    {
      timestamp: "2026-03-09T01:00:00.000Z",
      type: "user",
      cwd: "/workspace/claude-project",
      message: {
        role: "user",
        content: [{ type: "text", text: "Compare sync and import behavior." }],
      },
    },
    {
      timestamp: "2026-03-09T01:00:01.000Z",
      type: "assistant",
      cwd: "/workspace/claude-project",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        usage: {
          input_tokens: 11,
          cache_creation_input_tokens: 4,
          cache_read_input_tokens: 2,
          output_tokens: 5,
        },
        content: [{ type: "text", text: "Import should rebuild project linking." }],
      },
    },
  ];

  if (options.includeSyntheticClaudeError) {
    claudeConversation.push(
      {
        timestamp: "2026-03-09T01:05:00.000Z",
        type: "user",
        cwd: "/workspace/claude-project",
        message: {
          role: "user",
          content: [{ type: "text", text: "Handle the failing API call." }],
        },
      },
      {
        timestamp: "2026-03-09T01:05:01.000Z",
        type: "assistant",
        cwd: "/workspace/claude-project",
        isApiErrorMessage: true,
        message: {
          role: "assistant",
          model: "<synthetic>",
          content: [{ type: "text", text: "API Error: Cannot read properties of undefined (reading 'content')" }],
        },
      },
    );
  }

  await writeFile(
    path.join(tempRoot, ".claude", "projects", "conversation.jsonl"),
    claudeConversation.map((line) => JSON.stringify(line)).join("\n"),
    "utf8",
  );
}

async function seedCliOpenSourceFixtures(tempRoot: string): Promise<void> {
  const openclawDir = path.join(tempRoot, ".openclaw", "agents", "agent-a", "sessions");
  const opencodeSessionDir = path.join(tempRoot, ".local", "share", "opencode", "storage", "session");
  const opencodeMessageDir = path.join(tempRoot, ".local", "share", "opencode", "storage", "message", "opencode-fixture");

  await mkdir(openclawDir, { recursive: true });
  await mkdir(opencodeSessionDir, { recursive: true });
  await mkdir(opencodeMessageDir, { recursive: true });

  await writeFile(
    path.join(openclawDir, "openclaw-fixture.jsonl"),
    [
      {
        timestamp: "2026-03-10T04:00:00.000Z",
        role: "user",
        content: "Inspect OpenClaw history.",
      },
      {
        timestamp: "2026-03-10T04:00:01.000Z",
        role: "assistant",
        usage: {
          input_tokens: 7,
          output_tokens: 3,
          total_tokens: 10,
        },
        stopReason: "end_turn",
        content: [{ type: "text", text: "OpenClaw history loaded." }],
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(opencodeSessionDir, "opencode-fixture.json"),
    JSON.stringify({
      id: "opencode-fixture",
      title: "OpenCode fixture",
      cwd: "/workspace/opencode",
      model: "sonnet-4",
      createdAt: "2026-03-10T05:00:00.000Z",
      updatedAt: "2026-03-10T05:00:02.000Z",
    }),
    "utf8",
  );
  await writeFile(
    path.join(opencodeMessageDir, "0001.json"),
    JSON.stringify({
      info: {
        id: "opencode-user-1",
        role: "user",
        createdAt: "2026-03-10T05:00:01.000Z",
      },
      parts: [{ type: "text", text: "Inspect OpenCode history." }],
    }),
    "utf8",
  );
  await writeFile(
    path.join(opencodeMessageDir, "0002.json"),
    JSON.stringify({
      info: {
        id: "opencode-assistant-1",
        role: "assistant",
        createdAt: "2026-03-10T05:00:02.000Z",
        stopReason: "end_turn",
      },
      usage: {
        inputTokens: 8,
        outputTokens: 4,
        totalTokens: 12,
      },
      parts: [{ type: "text", text: "OpenCode history loaded." }],
    }),
    "utf8",
  );
}

async function overwriteCodexPrompt(tempRoot: string, prompt: string): Promise<void> {
  await writeCodexSessionFixture(tempRoot, "session.jsonl", {
    sessionId: "codex-session-1",
    cwd: "/workspace/cchistory",
    model: "gpt-5",
    prompt,
    reply: "Prompt updated.",
    startAt: "2026-03-09T00:00:00.000Z",
  });
}

async function writeCodexSessionFixture(
  tempRoot: string,
  fileName: string,
  input: {
    sessionId: string;
    cwd: string;
    model: string;
    prompt: string;
    reply: string;
    startAt: string;
  },
): Promise<void> {
  const startAt = new Date(input.startAt);
  const userAt = new Date(startAt.getTime() + 1000).toISOString();
  const assistantAt = new Date(startAt.getTime() + 2000).toISOString();
  await writeFile(
    path.join(tempRoot, ".codex", "sessions", fileName),
    [
      {
        timestamp: input.startAt,
        type: "session_meta",
        payload: {
          id: input.sessionId,
          cwd: input.cwd,
          model: input.model,
        },
      },
      {
        timestamp: userAt,
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: input.prompt }],
        },
      },
      {
        timestamp: assistantAt,
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: input.reply }],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );
}
