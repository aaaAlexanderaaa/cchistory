import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CCHistoryStorage } from "@cchistory/storage";
import { runCli } from "./index.js";

test("sync, ls, search, and stats usage render human-readable output for real source shapes", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

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
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("stats usage --by model labels Claude synthetic error replies separately from provider models", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot, { includeSyntheticClaudeError: true });
    process.env.HOME = tempRoot;

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
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("pnpm-style leading -- is ignored before the command name", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    assert.equal((await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot)).exitCode, 0);

    const listResult = await runCliCapture(["--", "ls", "projects", "--store", storeDir], tempRoot);
    assert.equal(listResult.exitCode, 0);
    assert.match(listResult.stdout, /Name/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync and ls cover repo mock_data default roots for codex claude factory amp cursor and antigravity", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliMockDataHome(tempRoot);
    process.env.HOME = tempRoot;

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
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync picks up openclaw and opencode default roots in the CLI", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliOpenSourceFixtures(tempRoot);
    process.env.HOME = tempRoot;

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
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("read commands support --full to rescan sources without mutating the indexed store", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

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
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("project listings hide empty projects unless --showall is requested", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

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
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("project listings sort by total turns descending", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

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
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("export and import round-trip preserves source, session, turn, and usage counts", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

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
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("import is idempotent for an already imported bundle", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

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
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("import detects payload conflicts and supports skip and replace", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

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
