import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeLocalPathIdentity, type SourceSyncPayload } from "@cchistory/domain";
import { CCHistoryStorage } from "@cchistory/storage";
import { interceptReadStoreFactoryForTests, runCli } from "./main.js";

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

    const longProjectsResult = await runCliCapture(["ls", "projects", "--store", storeDir, "--long"], tempRoot);
    assert.equal(longProjectsResult.exitCode, 0, longProjectsResult.stderr);
    assert.match(longProjectsResult.stdout, /Source Mix/);
    assert.match(longProjectsResult.stdout, /Related Work/);
    assert.match(longProjectsResult.stdout, /codex|claude_code/);

    const projectsTreeLongResult = await runCliCapture(["tree", "projects", "--store", storeDir, "--long"], tempRoot);
    assert.equal(projectsTreeLongResult.exitCode, 0, projectsTreeLongResult.stderr);
    assert.match(projectsTreeLongResult.stdout, /source_mix=/);

    const searchResult = await runCliCapture(["search", "probe", "--store", storeDir], tempRoot);
    assert.equal(searchResult.exitCode, 0);
    assert.match(searchResult.stdout, /Unassigned|workspace/);
    assert.match(searchResult.stdout, /Review the probe output/);

    const overviewStatsResult = await runCliCapture(["stats", "--store", storeDir], tempRoot);
    assert.equal(overviewStatsResult.exitCode, 0);
    assert.match(overviewStatsResult.stdout, /Schema Version/);
    assert.match(overviewStatsResult.stdout, /Schema Migrations/);
    assert.match(overviewStatsResult.stdout, /Search Mode/);

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

test("search matches partial keywords without requiring an exact phrase", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    const syncResult = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);

    const searchResult = await runCliCapture(["search", "prob out", "--store", storeDir], tempRoot);
    assert.equal(searchResult.exitCode, 0, searchResult.stderr);
    assert.match(searchResult.stdout, /Review the probe output/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("default store falls back to one home-anchored path across working directories", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const firstCwd = path.join(tempRoot, "workspace-a");
    const secondCwd = path.join(tempRoot, "workspace-b", "nested");
    await mkdir(firstCwd, { recursive: true });
    await mkdir(secondCwd, { recursive: true });

    const syncResult = await runCliCapture(["sync", "--source", "codex"], firstCwd);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);

    const defaultDbPath = path.join(tempRoot, ".cchistory", "cchistory.sqlite");
    assert.equal(await fileExists(defaultDbPath), true);

    const searchResult = await runCliCapture(["search", "probe"], secondCwd);
    assert.equal(searchResult.exitCode, 0, searchResult.stderr);
    assert.match(searchResult.stdout, /Review the probe output/);

    const statsResult = await runCliCapture(["stats"], secondCwd);
    assert.equal(statsResult.exitCode, 0, statsResult.stderr);
    assert.ok(statsResult.stdout.includes(defaultDbPath));
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("default store reuses the nearest existing .cchistory directory before falling back to home", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const projectRoot = path.join(tempRoot, "project-root");
    const nestedCwd = path.join(projectRoot, "apps", "cli");
    await mkdir(path.join(projectRoot, ".cchistory"), { recursive: true });
    await mkdir(nestedCwd, { recursive: true });

    const syncResult = await runCliCapture(["sync", "--source", "codex"], nestedCwd);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);

    assert.equal(await fileExists(path.join(projectRoot, ".cchistory", "cchistory.sqlite")), true);
    assert.equal(await fileExists(path.join(tempRoot, ".cchistory", "cchistory.sqlite")), false);
  } finally {
    process.env.HOME = originalHome;
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
      assert.ok(storage.listResolvedTurns().length >= 10);
    } finally {
      storage.close();
    }
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("primary user story groups one project's turns across multiple coding agents and preserves searchable session context", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliMockDataHome(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    const syncResult = await runCliCapture(["sync", "--store", storeDir], tempRoot);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);
    assert.match(syncResult.stdout, /Synced 6 source\(s\)/);

    const projectsResult = await runCliJson<{
      projects: Array<{
        project_id: string;
        display_name: string;
        linkage_state: string;
        primary_workspace_path?: string;
        source_platforms: string[];
        session_count: number;
        committed_turn_count: number;
        candidate_turn_count: number;
      }>;
    }>(["ls", "projects", "--store", storeDir], tempRoot);
    const historyProject = projectsResult.projects.find(
      (project) =>
        project.display_name === "history-lab" &&
        project.primary_workspace_path === "/Users/mock_user/workspace/history-lab",
    );

    assert.ok(historyProject, "expected committed history-lab project");
    assert.equal(historyProject.linkage_state, "committed");
    assert.deepEqual([...historyProject.source_platforms].sort(), ["amp", "antigravity", "factory_droid"]);
    assert.equal(historyProject.session_count, 3);
    assert.equal(historyProject.committed_turn_count, 3);
    assert.equal(historyProject.candidate_turn_count, 0);

    const projectTree = await runCliJson<{
      project: { project_id: string };
      sessions: Array<{
        id: string;
        source_platform: string;
        primary_project_id?: string;
        working_directory?: string;
      }>;
    }>(["tree", "project", historyProject.project_id, "--store", storeDir], tempRoot);

    assert.equal(projectTree.project.project_id, historyProject.project_id);
    assert.equal(projectTree.sessions.length, 3);
    assert.deepEqual(projectTree.sessions.map((session) => session.source_platform).sort(), [
      "amp",
      "antigravity",
      "factory_droid",
    ]);
    assert.ok(
      projectTree.sessions.every(
        (session) =>
          session.primary_project_id === historyProject.project_id &&
          session.working_directory === "/Users/mock_user/workspace/history-lab",
      ),
    );

    const searchResult = await runCliJson<{
      results: Array<{
        turn: {
          id: string;
          project_id?: string;
          session_id: string;
          canonical_text: string;
        };
        session: {
          id: string;
          source_platform: string;
        };
        project: {
          project_id: string;
        };
      }>;
    }>(["search", "Factory", "--project", historyProject.project_id, "--store", storeDir], tempRoot);

    assert.equal(searchResult.results.length, 1);
    assert.equal(searchResult.results[0]?.project.project_id, historyProject.project_id);
    assert.equal(searchResult.results[0]?.session.source_platform, "factory_droid");
    assert.match(searchResult.results[0]?.turn.canonical_text ?? "", /Factory Droid sidecar behavior/);

    const turnDetail = await runCliJson<{
      turn: {
        id: string;
        session_id: string;
        project_id?: string;
      };
      context: {
        assistant_replies: unknown[];
        tool_calls: unknown[];
        system_messages: unknown[];
      } | null;
    }>(["show", "turn", searchResult.results[0]!.turn.id, "--store", storeDir], tempRoot);

    assert.equal(turnDetail.turn.project_id, historyProject.project_id);
    assert.equal(turnDetail.turn.session_id, searchResult.results[0]?.session.id);
    assert.ok(turnDetail.context);
    assert.ok((turnDetail.context?.assistant_replies.length ?? 0) >= 1);
    assert.ok((turnDetail.context?.tool_calls.length ?? 0) >= 1);

    const sessionDetail = await runCliJson<{
      session: {
        id: string;
        primary_project_id?: string;
      };
      turns: Array<{
        id: string;
      }>;
    }>(["show", "session", searchResult.results[0]!.session.id, "--store", storeDir], tempRoot);

    assert.equal(sessionDetail.session.id, searchResult.results[0]?.session.id);
    assert.equal(sessionDetail.session.primary_project_id, historyProject.project_id);
    assert.ok(sessionDetail.turns.some((turn) => turn.id === searchResult.results[0]?.turn.id));
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("search output exposes a shown turn prefix that drills down through show turn and show session", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliMockDataHome(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    const syncResult = await runCliCapture(["sync", "--store", storeDir], tempRoot);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);

    const searchResult = await runCliCapture(["search", "Factory", "--store", storeDir], tempRoot);
    assert.equal(searchResult.exitCode, 0, searchResult.stderr);
    assert.match(searchResult.stdout, /Use `cchistory show turn <shown-id>` to inspect a full turn\./);
    assert.match(searchResult.stdout, /Use `cchistory tree session <session-ref> --long` when you want nearby turns and related work together\./);
    assert.match(searchResult.stdout, /pivots: show turn/);
    assert.match(searchResult.stdout, /show session/);
    assert.match(searchResult.stdout, /tree session .* --long/);

    const markupSearch = await runCliCapture(["search", "expert code reviewer", "--store", storeDir], tempRoot);
    assert.equal(markupSearch.exitCode, 0, markupSearch.stderr);
    assert.match(markupSearch.stdout, /expert code reviewer/i);
    assert.match(markupSearch.stdout, /source=Claude Code \(claude_code\)/);
    assert.match(markupSearch.stdout, /\/clear \/review|\/review You are an expert code reviewer/i);
    assert.doesNotMatch(markupSearch.stdout, /<command-name>|<command-message>|<local-command-caveat>/);
    assert.doesNotMatch(markupSearch.stdout, /\/clear clear|review \/review/);

    const shownId = searchResult.stdout.match(/\b[a-f0-9]{12}\b/)?.[0];
    assert.ok(shownId, "expected a shown turn prefix in search output");

    const turnText = await runCliCapture(["show", "turn", shownId!, "--store", storeDir], tempRoot);
    assert.equal(turnText.exitCode, 0, turnText.stderr);
    assert.match(turnText.stdout, /Project\s+: history-lab \[ready\]/);
    assert.match(turnText.stdout, /Project ID\s+: project-/);
    assert.match(turnText.stdout, /Source\s+: Factory Droid \(factory_droid\)/);
    assert.match(turnText.stdout, /Source ID\s+: srcinst-/);

    const turnDetail = await runCliJson<{
      turn: {
        id: string;
        canonical_text: string;
        session_id: string;
        project_id?: string;
      };
      context: {
        assistant_replies: unknown[];
      } | null;
    }>(["show", "turn", shownId!, "--store", storeDir], tempRoot);

    assert.ok(turnDetail.turn.id.startsWith(shownId!));
    assert.match(turnDetail.turn.canonical_text, /Factory Droid sidecar behavior/);
    assert.ok((turnDetail.context?.assistant_replies.length ?? 0) >= 1);

    const sessionDetail = await runCliJson<{
      session: {
        id: string;
        primary_project_id?: string;
      };
      turns: Array<{
        id: string;
      }>;
    }>(["show", "session", turnDetail.turn.session_id, "--store", storeDir], tempRoot);

    assert.equal(sessionDetail.session.id, turnDetail.turn.session_id);
    assert.equal(sessionDetail.session.primary_project_id, turnDetail.turn.project_id);
    assert.ok(sessionDetail.turns.some((turn) => turn.id === turnDetail.turn.id));
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});


test("search parameter pivots keep skeptical browse flows truthful", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliMockDataHome(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    const syncResult = await runCliCapture(["sync", "--store", storeDir], tempRoot);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);

    const baseline = await runCliJson<{
      kind: string;
      results: Array<{
        turn: {
          id: string;
          project_id?: string;
        };
        session: {
          id: string;
          source_platform: string;
        };
      }>;
    }>(["search", "expert code reviewer", "--store", storeDir], tempRoot);
    assert.equal(baseline.kind, "search");

    const chosenHit = baseline.results.find((result) => result.session.source_platform === "claude_code");
    assert.ok(chosenHit, "expected a Claude Code skeptical search hit");
    assert.ok(chosenHit.turn.project_id, "expected skeptical search hit to belong to a project");

    const projectScoped = await runCliJson<typeof baseline>(
      ["search", "expert code reviewer", "--store", storeDir, "--project", chosenHit.turn.project_id!],
      tempRoot,
    );
    assert.ok(projectScoped.results.length >= 1);
    assert.ok(projectScoped.results.every((result) => result.turn.project_id === chosenHit.turn.project_id));
    assert.ok(projectScoped.results.some((result) => result.turn.id === chosenHit.turn.id));

    const sourceScoped = await runCliJson<typeof baseline>(
      ["search", "expert code reviewer", "--store", storeDir, "--source", "claude_code"],
      tempRoot,
    );
    assert.ok(sourceScoped.results.length >= 1);
    assert.ok(sourceScoped.results.every((result) => result.session.source_platform === "claude_code"));

    const limited = await runCliJson<typeof baseline>(
      ["search", "expert code reviewer", "--store", storeDir, "--source", "claude_code", "--limit", "1"],
      tempRoot,
    );
    assert.equal(limited.results.length, 1);
    assert.equal(limited.results[0]?.session.source_platform, "claude_code");

    const projectTree = await runCliCapture(["tree", "project", chosenHit.turn.project_id!, "--store", storeDir, "--long"], tempRoot);
    assert.equal(projectTree.exitCode, 0, projectTree.stderr);
    assert.match(projectTree.stdout, /chat-ui-kit \[ready\]/);
    assert.match(projectTree.stdout, /related=\d+ delegated/);
    assert.ok(projectTree.stdout.includes(chosenHit.session.id));
    assert.match(projectTree.stdout, /Claude Code \(claude_code\)/);
    assert.match(projectTree.stdout, /\/clear \/review|\/review You are an expert code reviewer/i);
    assert.doesNotMatch(projectTree.stdout, /<command-name>|<command-message>|<local-command-caveat>/);

    const sessionTree = await runCliCapture(["tree", "session", chosenHit.session.id, "--store", storeDir, "--long"], tempRoot);
    assert.equal(sessionTree.exitCode, 0, sessionTree.stderr);
    assert.match(sessionTree.stdout, /Related Work/);
    assert.match(sessionTree.stdout, /Claude Code \(claude_code\)/);
    assert.match(sessionTree.stdout, /\/clear \/review|\/review You are an expert code reviewer/i);
    assert.doesNotMatch(sessionTree.stdout, /<command-name>|<command-message>|<local-command-caveat>/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("query projects, turns, turn, and session provide a structured supply-side retrieval chain", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliMockDataHome(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    const syncResult = await runCliCapture(["sync", "--store", storeDir], tempRoot);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);

    const projects = await runCliJson<
      Array<{
        project_id: string;
        display_name: string;
        primary_workspace_path?: string;
        linkage_state: string;
      }>
    >(["query", "projects", "--store", storeDir], tempRoot);

    const historyProject = projects.find(
      (project) =>
        project.display_name === "history-lab" &&
        project.primary_workspace_path === "/Users/mock_user/workspace/history-lab",
    );
    assert.ok(historyProject, "expected structured project retrieval for history-lab");
    assert.equal(historyProject.linkage_state, "committed");

    const projectTurns = await runCliJson<
      Array<{
        id: string;
        project_id?: string;
        session_id: string;
        canonical_text: string;
      }>
    >(["query", "turns", "--project", historyProject.project_id, "--store", storeDir], tempRoot);

    assert.equal(projectTurns.length, 3);
    assert.ok(projectTurns.every((turn) => turn.project_id === historyProject.project_id));

    const targetTurn = projectTurns.find((turn) => /Factory Droid sidecar behavior/.test(turn.canonical_text));
    assert.ok(targetTurn, "expected one structured turn result for the Factory Droid ask");

    const turnDetail = await runCliJson<{
      turn: {
        id: string;
        session_id: string;
        project_id?: string;
        canonical_text: string;
      };
      context: {
        assistant_replies: unknown[];
        tool_calls: unknown[];
      } | null;
    }>(["query", "turn", "--id", targetTurn.id, "--store", storeDir], tempRoot);

    assert.equal(turnDetail.turn.id, targetTurn.id);
    assert.equal(turnDetail.turn.session_id, targetTurn.session_id);
    assert.equal(turnDetail.turn.project_id, historyProject.project_id);
    assert.match(turnDetail.turn.canonical_text, /Factory Droid sidecar behavior/);
    assert.ok((turnDetail.context?.assistant_replies.length ?? 0) >= 1);
    assert.ok((turnDetail.context?.tool_calls.length ?? 0) >= 1);

    const sessionDetail = await runCliJson<{
      session: {
        id: string;
        primary_project_id?: string;
      };
      turns: Array<{
        id: string;
      }>;
    }>(["query", "session", "--id", targetTurn.session_id, "--store", storeDir], tempRoot);

    assert.equal(sessionDetail.session.id, targetTurn.session_id);
    assert.equal(sessionDetail.session.primary_project_id, historyProject.project_id);
    assert.ok(sessionDetail.turns.some((turn) => turn.id === targetTurn.id));
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("repeated automation-shaped Claude review turns remain separately retrievable and drill down to distinct sessions", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliMockDataHome(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    const syncResult = await runCliCapture(["sync", "--store", storeDir], tempRoot);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);

    const projects = await runCliJson<
      Array<{
        project_id: string;
        display_name: string;
        primary_workspace_path?: string;
        linkage_state: string;
      }>
    >(["query", "projects", "--store", storeDir], tempRoot);

    const chatProject = projects.find(
      (project) =>
        project.display_name === "chat-ui-kit" &&
        project.primary_workspace_path === "/Users/mock_user/workspace/chat-ui-kit",
    );
    assert.ok(chatProject, "expected committed chat-ui-kit project");
    assert.equal(chatProject.linkage_state, "committed");

    const repeatedResults = await runCliJson<
      Array<{
        turn: {
          id: string;
          session_id: string;
          project_id?: string;
          canonical_text: string;
        };
        session: {
          id: string;
          source_platform: string;
        };
        project: {
          project_id: string;
        };
      }>
    >(["query", "turns", "--search", "expert code reviewer", "--project", chatProject.project_id, "--store", storeDir], tempRoot);

    assert.equal(repeatedResults.length, 2);
    assert.ok(
      repeatedResults.every(
        (result) =>
          result.project.project_id === chatProject.project_id &&
          result.session.source_platform === "claude_code" &&
          /expert code reviewer/i.test(result.turn.canonical_text),
      ),
    );
    assert.equal(new Set(repeatedResults.map((result) => result.turn.id)).size, 2);
    assert.equal(new Set(repeatedResults.map((result) => result.session.id)).size, 2);

    for (const result of repeatedResults) {
      const turnDetail = await runCliJson<{
        turn: {
          id: string;
          session_id: string;
          project_id?: string;
          canonical_text: string;
        };
        context: {
          assistant_replies: unknown[];
        } | null;
      }>(["show", "turn", result.turn.id, "--store", storeDir], tempRoot);

      assert.equal(turnDetail.turn.id, result.turn.id);
      assert.equal(turnDetail.turn.session_id, result.session.id);
      assert.equal(turnDetail.turn.project_id, chatProject.project_id);
      assert.match(turnDetail.turn.canonical_text, /expert code reviewer/i);
      assert.ok((turnDetail.context?.assistant_replies.length ?? 0) >= 1);

      const sessionDetail = await runCliJson<{
        session: {
          id: string;
          primary_project_id?: string;
          title?: string;
        };
        turns: Array<{
          id: string;
        }>;
      }>(["show", "session", result.session.id, "--store", storeDir], tempRoot);

      assert.equal(sessionDetail.session.id, result.session.id);
      assert.equal(sessionDetail.session.primary_project_id, chatProject.project_id);
      assert.match(sessionDetail.session.title ?? "", /expert code reviewer/i);
      assert.ok(sessionDetail.turns.some((turn) => turn.id === result.turn.id));
    }
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("show session and query session accept human-friendly session references", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliOpenSourceFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    const syncResult = await runCliCapture(["sync", "--store", storeDir, "--source", "opencode"], tempRoot);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);

    const listResult = await runCliCapture(["ls", "sessions", "--store", storeDir], tempRoot);
    assert.equal(listResult.exitCode, 0, listResult.stderr);
    assert.match(listResult.stdout, /Title/);
    assert.match(listResult.stdout, /Workspace/);
    assert.match(listResult.stdout, /OpenCode fixture/);
    assert.match(listResult.stdout, /\/workspace\/opencode/);

    const byPrefix = await runCliJson<{
      session: {
        id: string;
        title?: string;
        working_directory?: string;
      };
      turns: Array<{ id: string }>;
    }>(["show", "session", "sess:opencode:opencode-fixt", "--store", storeDir], tempRoot);
    assert.equal(byPrefix.session.id, "sess:opencode:opencode-fixture");
    assert.equal(byPrefix.session.title, "OpenCode fixture");
    assert.equal(byPrefix.turns.length, 1);

    const byTitle = await runCliJson<{
      session: {
        id: string;
      };
      turns: Array<{ id: string }>;
    }>(["query", "session", "--id", "OpenCode fixture", "--store", storeDir], tempRoot);
    assert.equal(byTitle.session.id, "sess:opencode:opencode-fixture");
    assert.equal(byTitle.turns.length, 1);

    const byWorkspace = await runCliJson<{
      session: {
        id: string;
        working_directory?: string;
      };
    }>(["show", "session", "opencode", "--store", storeDir], tempRoot);
    assert.equal(byWorkspace.session.id, "sess:opencode:opencode-fixture");
    assert.equal(byWorkspace.session.working_directory, "/workspace/opencode");

    const storage = new CCHistoryStorage(storeDir);
    try {
      const sessionId = byWorkspace.session.id;
      const session = storage.getSession(sessionId);
      assert.ok(session);
      const payload = storage.getSourcePayload(session!.source_id);
      assert.ok(payload);
      if (payload) {
        const lastFragment = payload.fragments[payload.fragments.length - 1] ?? payload.fragments[0];
        const relatedFragment = payload.fragments.find((fragment) => fragment.session_ref === sessionId && fragment.fragment_kind === 'session_relation');
        const nextFragment = relatedFragment
          ? {
              ...relatedFragment,
              payload: {
                ...relatedFragment.payload,
                parent_uuid: 'parent-session-1',
                is_sidechain: true,
              },
            }
          : {
              id: 'fragment-cli-opencode-related',
              source_id: payload.source.id,
              session_ref: sessionId,
              record_id: lastFragment?.record_id ?? 'record-cli-opencode-related',
              seq_no: (lastFragment?.seq_no ?? 0) + 1,
              fragment_kind: 'session_relation' as const,
              actor_kind: 'system' as const,
              origin_kind: 'source_meta' as const,
              time_key: session!.updated_at,
              payload: {
                parent_uuid: 'parent-session-1',
                is_sidechain: true,
              },
              raw_refs: [],
              source_format_profile_id: lastFragment?.source_format_profile_id ?? 'opencode:sqlite:v1',
            };
        const duplicateFragment = {
          ...nextFragment,
          id: `${nextFragment.id}-duplicate`,
          seq_no: nextFragment.seq_no + 1,
          time_key: '2026-03-09T09:00:05.000Z',
        };
        payload.fragments = relatedFragment
          ? [
              ...payload.fragments.map((fragment) => (fragment.id === relatedFragment.id ? nextFragment : fragment)),
              duplicateFragment,
            ]
          : [...payload.fragments, nextFragment, duplicateFragment];
        storage.replaceSourcePayload(payload);
      }
    } finally {
      storage.close();
    }

    const longSessionList = await runCliCapture(["ls", "sessions", "--store", storeDir, "--long"], tempRoot);
    assert.equal(longSessionList.exitCode, 0, longSessionList.stderr);
    assert.doesNotMatch(longSessionList.stdout, /Platform/);
    assert.doesNotMatch(longSessionList.stdout, /\bHost\b/);
    assert.match(longSessionList.stdout, /Turns/);
    assert.match(longSessionList.stdout, /Related Work/);
    assert.match(longSessionList.stdout, /opencode@host-/);
    assert.match(longSessionList.stdout, /1 delegated/);

    const sessionTree = await runCliCapture(["tree", "session", "OpenCode fixture", "--store", storeDir, "--long"], tempRoot);
    assert.equal(sessionTree.exitCode, 0, sessionTree.stderr);
    assert.match(sessionTree.stdout, /Turns/);
    assert.match(sessionTree.stdout, /Related Work/);
    assert.match(sessionTree.stdout, /delegated session parent-session-1/);
    assert.match(sessionTree.stdout, /transcript-primary/);
    assert.equal((sessionTree.stdout.match(/delegated session parent-session-1/g) ?? []).length, 1);

    const relatedSearch = await runCliCapture(["search", "OpenCode fixture", "--store", storeDir], tempRoot);
    assert.equal(relatedSearch.exitCode, 0, relatedSearch.stderr);
    assert.match(relatedSearch.stdout, /related=1 delegated/);
    assert.match(relatedSearch.stdout, /show session sess:opencode:opencode-fixture/);
    assert.match(relatedSearch.stdout, /tree session sess:opencode:opencode-fixture --long/);

    const sessionText = await runCliCapture(["show", "session", "OpenCode fixture", "--store", storeDir], tempRoot);
    assert.equal(sessionText.exitCode, 0, sessionText.stderr);
    assert.match(sessionText.stdout, /Project\s+: opencode \[tentative\]/);
    assert.match(sessionText.stdout, /Project ID\s+: project-/);
    assert.match(sessionText.stdout, /Source\s+: OpenCode \(opencode\)/);
    assert.match(sessionText.stdout, /Source ID\s+: srcinst-opencode/);
    assert.match(sessionText.stdout, /Related Work/);
    assert.match(sessionText.stdout, /delegated_session/);
    assert.match(sessionText.stdout, /transcript-primary/);
    assert.equal((sessionText.stdout.match(/delegated_session session parent-session-1 transcript-primary/g) ?? []).length, 1);

    const sessionJson = await runCliJson<{
      related_work: Array<{ relation_kind: string; transcript_primary: boolean }>
    }>(["query", "session", "--id", "OpenCode fixture", "--store", storeDir], tempRoot);
    assert.equal(sessionJson.related_work.length, 1);
    assert.equal(sessionJson.related_work[0]?.relation_kind, 'delegated_session');
    assert.equal(sessionJson.related_work[0]?.transcript_primary, true);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("show session accepts Windows-style workspace references on non-Windows hosts", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliOpenSourceFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const opencodeStorageRoot = path.join(tempRoot, ".local", "share", "opencode", "storage");
    const opencodeSessionPath = path.join(opencodeStorageRoot, "session", "global", "opencode-fixture.json");
    const opencodeMessageDir = path.join(opencodeStorageRoot, "message", "opencode-fixture");
    await writeFile(
      opencodeSessionPath,
      JSON.stringify({
        id: "opencode-fixture",
        title: "OpenCode fixture",
        directory: String.raw`C:\Users\dev\workspace\opencode`,
        version: "1.0.114",
        time: {
          created: 1771000000000,
          updated: 1771000002000,
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(opencodeMessageDir, "0001.json"),
      JSON.stringify({
        id: "opencode-user-1",
        sessionID: "opencode-fixture",
        role: "user",
        time: {
          created: 1771000001000,
        },
        path: {
          cwd: String.raw`C:\Users\dev\workspace\opencode`,
          root: "C:/",
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(opencodeMessageDir, "0002.json"),
      JSON.stringify({
        id: "opencode-assistant-1",
        sessionID: "opencode-fixture",
        role: "assistant",
        time: {
          created: 1771000002000,
          completed: 1771000003000,
        },
        modelID: "sonnet-4",
        path: {
          cwd: String.raw`C:\Users\dev\workspace\opencode`,
          root: "C:/",
        },
        finish: "tool-calls",
        tokens: {
          input: 8,
          output: 4,
          reasoning: 0,
          cache: {
            read: 2,
            write: 0,
          },
        },
      }),
      "utf8",
    );
    const storeDir = path.join(tempRoot, "store");
    const syncResult = await runCliCapture(["sync", "--store", storeDir, "--source", "opencode"], tempRoot);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);

    const byBasename = await runCliJson<{
      session: {
        id: string;
        working_directory?: string;
      };
    }>(["show", "session", "opencode", "--store", storeDir], tempRoot);
    assert.equal(byBasename.session.id, "sess:opencode:opencode-fixture");
    assert.equal(
      byBasename.session.working_directory,
      normalizeLocalPathIdentity("C:\\Users\\dev\\workspace\\opencode"),
    );

    const byNormalizedPath = await runCliJson<{
      session: {
        id: string;
      };
    }>(["query", "session", "--id", "c:/users/dev/workspace/opencode", "--store", storeDir], tempRoot);
    assert.equal(byNormalizedPath.session.id, "sess:opencode:opencode-fixture");

    const byMixedSeparators = await runCliJson<{
      session: {
        id: string;
      };
    }>(["show", "session", "C:/Users\\dev/workspace\\opencode/", "--store", storeDir], tempRoot);
    assert.equal(byMixedSeparators.session.id, "sess:opencode:opencode-fixture");

    const byFileUri = await runCliJson<{
      session: {
        id: string;
      };
    }>(["query", "session", "--id", "file://localhost/C:/Users/dev/workspace/opencode/", "--store", storeDir], tempRoot);
    assert.equal(byFileUri.session.id, "sess:opencode:opencode-fixture");
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("show session accepts UNC raw paths and UNC file-URI references", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    process.env.HOME = tempRoot;

    const opencodeRoot = path.join(tempRoot, ".local", "share", "opencode");
    const opencodeSessionDir = path.join(opencodeRoot, "storage", "session", "global");
    await mkdir(opencodeSessionDir, { recursive: true });

    await writeFile(
      path.join(opencodeSessionDir, "opencode-unc-fixture.json"),
      JSON.stringify({
        id: "opencode-unc-fixture",
        title: "OpenCode UNC fixture",
        directory: String.raw`\\server\share\opencode`,
        version: "1.0.114",
        time: {
          created: 1771000000000,
          updated: 1771000002000,
        },
      }),
      "utf8",
    );

    const storeDir = path.join(tempRoot, "store");
    const syncResult = await runCliCapture(["sync", "--store", storeDir, "--source", "opencode"], tempRoot);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);

    const byRawUnc = await runCliJson<{
      session: {
        id: string;
        working_directory?: string;
      };
    }>(["query", "session", "--id", String.raw`\\server\share\opencode`, "--store", storeDir], tempRoot);
    assert.equal(byRawUnc.session.id, "sess:opencode:opencode-unc-fixture");
    assert.equal(byRawUnc.session.working_directory, "//server/share/opencode");

    const byFileUri = await runCliJson<{
      session: {
        id: string;
      };
    }>(["show", "session", "file://server/share/opencode/", "--store", storeDir], tempRoot);
    assert.equal(byFileUri.session.id, "sess:opencode:opencode-unc-fixture");
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("show session fails explicitly when a human-friendly reference is ambiguous", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliOpenSourceFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const opencodeStorageRoot = path.join(tempRoot, ".local", "share", "opencode", "storage");
    const opencodeSessionDir = path.join(opencodeStorageRoot, "session", "global");
    const secondMessageDir = path.join(opencodeStorageRoot, "message", "opencode-fixture-2");
    const secondUserPartDir = path.join(opencodeStorageRoot, "part", "opencode-user-2");
    const secondAssistantPartDir = path.join(opencodeStorageRoot, "part", "opencode-assistant-2");
    await mkdir(secondMessageDir, { recursive: true });
    await mkdir(secondUserPartDir, { recursive: true });
    await mkdir(secondAssistantPartDir, { recursive: true });

    await writeFile(
      path.join(opencodeSessionDir, "opencode-fixture.json"),
      JSON.stringify({
        id: "opencode-fixture",
        title: "Shared session",
        directory: "/workspace/opencode",
        version: "1.0.114",
        time: {
          created: 1771000000000,
          updated: 1771000002000,
        },
      }),
      "utf8",
    );

    await writeFile(
      path.join(opencodeSessionDir, "opencode-fixture-2.json"),
      JSON.stringify({
        id: "opencode-fixture-2",
        title: "Shared session",
        directory: "/workspace/opencode-two",
        version: "1.0.114",
        time: {
          created: 1771000600000,
          updated: 1771000602000,
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(secondMessageDir, "0001.json"),
      JSON.stringify({
        id: "opencode-user-2",
        sessionID: "opencode-fixture-2",
        role: "user",
        time: {
          created: 1771000601000,
        },
        path: {
          cwd: "/workspace/opencode-two",
          root: "/",
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(secondUserPartDir, "0001.json"),
      JSON.stringify({
        id: "opencode-user-2-part-1",
        sessionID: "opencode-fixture-2",
        messageID: "opencode-user-2",
        type: "text",
        text: "Inspect the second OpenCode history.",
      }),
      "utf8",
    );
    await writeFile(
      path.join(secondMessageDir, "0002.json"),
      JSON.stringify({
        id: "opencode-assistant-2",
        sessionID: "opencode-fixture-2",
        role: "assistant",
        time: {
          created: 1771000602000,
          completed: 1771000603000,
        },
        modelID: "sonnet-4",
        path: {
          cwd: "/workspace/opencode-two",
          root: "/",
        },
        finish: "stop",
        tokens: {
          input: 9,
          output: 4,
          reasoning: 0,
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(secondAssistantPartDir, "0001.json"),
      JSON.stringify({
        id: "opencode-assistant-2-part-1",
        sessionID: "opencode-fixture-2",
        messageID: "opencode-assistant-2",
        type: "text",
        text: "Second OpenCode history loaded.",
      }),
      "utf8",
    );

    const storeDir = path.join(tempRoot, "store");
    const syncResult = await runCliCapture(["sync", "--store", storeDir, "--source", "opencode"], tempRoot);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);

    const result = await runCliCapture(["show", "session", "Shared session", "--store", storeDir], tempRoot);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Ambiguous session reference: Shared session/);
    assert.match(result.stderr, /opencode-fixture/);
    assert.match(result.stderr, /opencode-fixture-2/);
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

    const searchResult = await runCliCapture(["search", "part-backed", "--store", storeDir], tempRoot);
    assert.equal(searchResult.exitCode, 0, searchResult.stderr);
    assert.match(searchResult.stdout, /Review the OpenCode part-backed history\./);

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

test("sync --dry-run previews selected source roots without creating a store", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliOpenSourceFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    const dryRunResult = await runCliCapture(["sync", "--dry-run", "--store", storeDir], tempRoot);
    assert.equal(dryRunResult.exitCode, 0);
    assert.match(dryRunResult.stdout, /Dry run:/);
    assert.match(dryRunResult.stdout, /OpenClaw/);
    assert.match(dryRunResult.stdout, /OpenCode/);
    assert.match(dryRunResult.stdout, new RegExp(escapeRegExp(path.join(tempRoot, ".openclaw", "agents"))));
    assert.match(
      dryRunResult.stdout,
      new RegExp(escapeRegExp(path.join(tempRoot, ".local", "share", "opencode", "storage"))),
    );

    await assert.rejects(access(path.join(storeDir, "cchistory.sqlite")));
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("--help renders usage without touching storage-backed commands", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));

  try {
    const result = await runCliCapture(["--help"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /^Usage:/);
    assert.match(result.stdout, /cchistory sync/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("templates prints format profiles without opening a store", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));

  try {
    const profiles = await runCliJson<Array<{ id: string; family: string }>>(["templates"], tempRoot);
    assert.ok(profiles.length > 0);
    assert.ok(profiles.some((profile) => profile.family === "local_coding_agent"));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("discover lists Gemini CLI sync roots alongside discovery-only auxiliary paths", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
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
    const geminiSource = result.tools.find((tool) => tool.platform === "gemini" && tool.capability === "sync");
    const geminiTool = result.tools.find((tool) => tool.platform === "gemini" && tool.capability === "discover_only");

    assert.ok(openclaw);
    assert.ok(opencode);
    assert.ok(geminiSource);
    assert.ok(geminiTool);
    assert.equal(geminiSource?.display_name, "Gemini CLI");
    assert.equal(geminiSource?.selected_path, path.join(tempRoot, ".gemini"));
    assert.equal(geminiTool?.display_name, "Gemini CLI");
    assert.ok(
      geminiTool?.candidates.some(
        (candidate) => candidate.exists && candidate.path === path.join(tempRoot, ".gemini", "settings.json"),
      ),
    );
    assert.ok(
      geminiTool?.candidates.some(
        (candidate) => candidate.exists && candidate.path === path.join(tempRoot, ".gemini", "tmp"),
      ),
    );
    assert.ok(
      opencode?.candidates.some(
        (candidate) => candidate.exists && candidate.path === path.join(tempRoot, ".local", "share", "opencode", "project"),
      ),
    );
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("health combines discovery, sync preview, and indexed store summary in one command", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    const syncResult = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);

    const result = await runCliCapture(["health", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Overview/);
    assert.match(result.stdout, /Host Discovery/);
    assert.match(result.stdout, /Sync Preview/);
    assert.match(result.stdout, /Indexed Sources/);
    assert.match(result.stdout, /Store Overview/);
    assert.match(result.stdout, /Codex/);
    assert.match(result.stdout, /Schema Version/);

    const json = await runCliJson<{
      kind: string;
      read_mode: string;
      discovery: { kind: string };
      sync_preview: { kind: string };
      store_summary: {
        store_exists: boolean;
        sources: { kind: string };
        stats: { kind: string };
      };
    }>(["health", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(json.kind, "health");
    assert.equal(json.read_mode, "index");
    assert.equal(json.discovery.kind, "discover");
    assert.equal(json.sync_preview.kind, "sync-dry-run");
    assert.equal(json.store_summary.store_exists, true);
    assert.equal(json.store_summary.sources.kind, "sources");
    assert.equal(json.store_summary.stats.kind, "stats-overview");
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("health --store-only focuses on the selected store without host discovery noise", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    const syncResult = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);

    const result = await runCliCapture(["health", "--store-only", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Scope\s+: selected store only/);
    assert.match(result.stdout, /Indexed Sources/);
    assert.match(result.stdout, /Store Overview/);
    assert.doesNotMatch(result.stdout, /Host Discovery/);
    assert.doesNotMatch(result.stdout, /Sync Preview/);

    const json = await runCliJson<{
      kind: string;
      scope: string;
      discovery: null;
      sync_preview: null;
      store_summary: {
        store_exists: boolean;
        sources: { kind: string };
        stats: { kind: string };
      };
    }>(["health", "--store-only", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(json.kind, "health");
    assert.equal(json.scope, "store-only");
    assert.equal(json.discovery, null);
    assert.equal(json.sync_preview, null);
    assert.equal(json.store_summary.store_exists, true);
    assert.equal(json.store_summary.sources.kind, "sources");
    assert.equal(json.store_summary.stats.kind, "stats-overview");
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("health explains when the indexed store is missing instead of silently creating one", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "missing-store");
    const result = await runCliCapture(["health", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Indexed Store/);
    assert.match(result.stdout, /No indexed store found/);

    const json = await runCliJson<{
      kind: string;
      store_summary: { store_exists: boolean; note: string };
    }>(["health", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(json.kind, "health");
    assert.equal(json.store_summary.store_exists, false);
    assert.match(json.store_summary.note, /No indexed store found/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("health source filters also narrow indexed store summaries", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    assert.equal((await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--source", "claude_code"], tempRoot)).exitCode, 0);

    const result = await runCliCapture(["health", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Selected Sources\s+: codex/);
    assert.match(result.stdout, /Indexed Sources/);
    assert.match(result.stdout, /Codex/);
    assert.doesNotMatch(result.stdout, /Claude Code/);
    assert.match(result.stdout, /Sources\s+: 1/);

    const storeOnly = await runCliCapture(["health", "--store", storeDir, "--store-only", "--source", "codex"], tempRoot);
    assert.equal(storeOnly.exitCode, 0, storeOnly.stderr);
    assert.match(storeOnly.stdout, /Selected Sources\s+: codex/);
    assert.match(storeOnly.stdout, /Codex/);
    assert.doesNotMatch(storeOnly.stdout, /Claude Code/);
    assert.match(storeOnly.stdout, /Sources\s+: 1/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("health --full performs a live read-only scan without creating the indexed store", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "full-health-store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const result = await runCliCapture(["health", "--full", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Live Sources/);
    assert.match(result.stdout, /Live Store Overview/);
    assert.equal(await fileExists(dbPath), false);

    const json = await runCliJson<{
      kind: string;
      read_mode: string;
      store_summary: { read_mode: string };
    }>(["health", "--full", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(json.kind, "health");
    assert.equal(json.read_mode, "full");
    assert.equal(json.store_summary.read_mode, "full");
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("health --full reuses one live snapshot for both sources and stats", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;
  let openReadStoreCalls = 0;
  const restoreReadStoreFactory = interceptReadStoreFactoryForTests((next) => async (parsed, io) => {
    openReadStoreCalls += 1;
    return next(parsed, io);
  });

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const result = await runCliCapture(["health", "--full", "--source", "codex"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(openReadStoreCalls, 1);
  } finally {
    restoreReadStoreFactory();
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync keeps OpenCode sessions discoverable when project candidates also exist", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliDiscoveryFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    const syncResult = await runCliCapture(["sync", "--store", storeDir, "--source", "opencode"], tempRoot);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);

    const storage = new CCHistoryStorage(storeDir);
    try {
      const source = storage.listSources().find((entry) => entry.platform === "opencode");
      assert.ok(source);
      const payload = storage.getSourcePayload(source.id);
      assert.ok(payload);
      assert.deepEqual(
        payload.sessions.map((session) => session.title).sort(),
        ["OpenCode fixture", "OpenCode official fixture"],
      );
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


test("full read drilldown and summaries stay live-only without mutating indexed state", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    assert.equal((await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot)).exitCode, 0);

    await writeCodexSessionFixture(tempRoot, "session-2.jsonl", {
      sessionId: "codex-session-2",
      cwd: "/workspace/cchistory",
      model: "gpt-5",
      prompt: "Count the newly scanned session.",
      reply: "The extra session is present.",
      startAt: "2026-03-09T02:00:00.000Z",
    });

    const indexedSearch = await runCliJson<{ kind: string; results: Array<unknown> }>(
      ["search", "Count the newly scanned session.", "--store", storeDir, "--index"],
      tempRoot,
    );
    assert.equal(indexedSearch.kind, "search");
    assert.equal(indexedSearch.results.length, 0);

    const fullSearch = await runCliJson<{
      kind: string;
      results: Array<{
        turn?: { id?: string; canonical_text?: string };
        session?: { id?: string };
        project?: { project_id?: string };
      }>;
    }>(["search", "Count the newly scanned session.", "--store", storeDir, "--full", "--source", "codex"], tempRoot);
    assert.equal(fullSearch.kind, "search");
    assert.equal(fullSearch.results.length, 1);
    const liveTurnId = fullSearch.results[0]?.turn?.id;
    const liveSessionId = fullSearch.results[0]?.session?.id;
    const liveProjectId = fullSearch.results[0]?.project?.project_id;
    assert.equal(typeof liveTurnId, "string");
    assert.equal(typeof liveSessionId, "string");
    assert.equal(typeof liveProjectId, "string");
    assert.match(fullSearch.results[0]?.turn?.canonical_text ?? "", /Count the newly scanned session\./);

    const indexedShowTurn = await runCliCapture(["show", "turn", liveTurnId!, "--store", storeDir], tempRoot);
    assert.equal(indexedShowTurn.exitCode, 1);
    assert.match(indexedShowTurn.stderr, /Unknown turn reference/);

    const fullShowTurn = await runCliCapture(["show", "turn", liveTurnId!, "--store", storeDir, "--full", "--source", "codex"], tempRoot);
    assert.equal(fullShowTurn.exitCode, 0, fullShowTurn.stderr);
    assert.match(fullShowTurn.stdout, /Project\s+: cchistory \[ready\]/);
    assert.match(fullShowTurn.stdout, /Count the newly scanned session\./);

    const indexedShowSession = await runCliCapture(["show", "session", liveSessionId!, "--store", storeDir], tempRoot);
    assert.equal(indexedShowSession.exitCode, 1);
    assert.match(indexedShowSession.stderr, /Unknown session reference/);

    const fullShowSession = await runCliCapture(["show", "session", liveSessionId!, "--store", storeDir, "--full", "--source", "codex"], tempRoot);
    assert.equal(fullShowSession.exitCode, 0, fullShowSession.stderr);
    assert.match(fullShowSession.stdout, /Title\s+: Count the newly scanned session\./);
    assert.match(fullShowSession.stdout, /Project\s+: cchistory \[ready\]/);

    const indexedTreeSession = await runCliCapture(["tree", "session", liveSessionId!, "--store", storeDir, "--long"], tempRoot);
    assert.equal(indexedTreeSession.exitCode, 1);
    assert.match(indexedTreeSession.stderr, /Unknown session reference/);

    const fullTreeSession = await runCliCapture(["tree", "session", liveSessionId!, "--store", storeDir, "--full", "--source", "codex", "--long"], tempRoot);
    assert.equal(fullTreeSession.exitCode, 0, fullTreeSession.stderr);
    assert.match(fullTreeSession.stdout, /source=Codex \(codex\)/);
    assert.match(fullTreeSession.stdout, /Count the newly scanned session\./);

    const indexedShowProject = await runCliCapture(["show", "project", liveProjectId!, "--store", storeDir], tempRoot);
    assert.equal(indexedShowProject.exitCode, 0, indexedShowProject.stderr);
    assert.match(indexedShowProject.stdout, /Status\s+: tentative/);
    assert.match(indexedShowProject.stdout, /Sessions\s+: 1/);
    assert.doesNotMatch(indexedShowProject.stdout, /Count the newly scanned session\./);

    const fullShowProject = await runCliCapture(["show", "project", liveProjectId!, "--store", storeDir, "--full", "--source", "codex"], tempRoot);
    assert.equal(fullShowProject.exitCode, 0, fullShowProject.stderr);
    assert.match(fullShowProject.stdout, /Status\s+: ready/);
    assert.match(fullShowProject.stdout, /Sessions\s+: 2/);
    assert.match(fullShowProject.stdout, /Turns\s+: 2/);
    assert.match(fullShowProject.stdout, /Count the newly scanned session\./);

    const fullTreeProject = await runCliCapture(["tree", "project", liveProjectId!, "--store", storeDir, "--full", "--source", "codex", "--long"], tempRoot);
    assert.equal(fullTreeProject.exitCode, 0, fullTreeProject.stderr);
    assert.match(fullTreeProject.stdout, /cchistory \[ready\]/);
    assert.match(fullTreeProject.stdout, /sessions=2 turns=2/);
    assert.match(fullTreeProject.stdout, /Count the newly scanned session\./);

    const indexedStats = await runCliCapture(["stats", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(indexedStats.exitCode, 0, indexedStats.stderr);
    assert.match(indexedStats.stdout, /Sessions\s+: 1/);
    assert.match(indexedStats.stdout, /Turns\s+: 1/);
    assert.doesNotMatch(indexedStats.stdout, /full scan in memory/);

    const fullStats = await runCliCapture(["stats", "--store", storeDir, "--full", "--source", "codex"], tempRoot);
    assert.equal(fullStats.exitCode, 0, fullStats.stderr);
    assert.match(fullStats.stdout, /full scan in memory/);
    assert.match(fullStats.stdout, /Sessions\s+: 2/);
    assert.match(fullStats.stdout, /Turns\s+: 2/);

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

test("backup defaults to preview mode and wraps the canonical export dry-run", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    const bundleDir = path.join(tempRoot, "backup-preview.cchistory-bundle");

    assert.equal((await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--source", "claude_code"], tempRoot)).exitCode, 0);

    const preview = await runCliJson<{
      kind: string;
      mode: string;
      export: {
        kind: string;
        bundle_dir: string;
        includes_raw_blobs: boolean;
        counts: {
          sources: number;
          sessions: number;
          turns: number;
          blobs: number;
        };
      };
    }>(["backup", "--store", storeDir, "--out", bundleDir], tempRoot);

    assert.equal(preview.kind, "backup");
    assert.equal(preview.mode, "preview");
    assert.equal(preview.export.kind, "export-dry-run");
    assert.equal(preview.export.includes_raw_blobs, true);
    assert.equal(preview.export.counts.sources, 2);
    assert.equal(preview.export.bundle_dir, bundleDir);
    assert.equal(await fileExists(bundleDir), false);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("backup --write creates a scoped bundle and preserves export flags", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    const bundleDir = path.join(tempRoot, "backup-write.cchistory-bundle");

    assert.equal((await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--source", "claude_code"], tempRoot)).exitCode, 0);

    const result = await runCliJson<{
      kind: string;
      mode: string;
      export: {
        kind: string;
        manifest: {
          includes_raw_blobs: boolean;
          counts: {
            sources: number;
          };
        };
      };
    }>(["backup", "--store", storeDir, "--out", bundleDir, "--source", "codex", "--no-raw", "--write"], tempRoot);

    assert.equal(result.kind, "backup");
    assert.equal(result.mode, "write");
    assert.equal(result.export.kind, "export");
    assert.equal(result.export.manifest.includes_raw_blobs, false);
    assert.equal(result.export.manifest.counts.sources, 1);
    assert.equal(await fileExists(path.join(bundleDir, "manifest.json")), true);
    assert.equal(await fileExists(path.join(bundleDir, "checksums.json")), true);
    assert.equal(await fileExists(path.join(bundleDir, "raw")), false);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("backup --write --dry-run stays in preview mode and does not write bundle files", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    const bundleDir = path.join(tempRoot, "backup-dry-run.cchistory-bundle");

    assert.equal((await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--source", "claude_code"], tempRoot)).exitCode, 0);

    const preview = await runCliJson<{
      kind: string;
      mode: string;
      export: {
        kind: string;
        bundle_dir: string;
      };
    }>(["backup", "--store", storeDir, "--out", bundleDir, "--write", "--dry-run"], tempRoot);

    assert.equal(preview.kind, "backup");
    assert.equal(preview.mode, "preview");
    assert.equal(preview.export.kind, "export-dry-run");
    assert.equal(preview.export.bundle_dir, bundleDir);
    assert.equal(await fileExists(bundleDir), false);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("export --dry-run previews bundle contents without writing the bundle directory", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    const bundleDir = path.join(tempRoot, "preview.cchistory-bundle");

    assert.equal((await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--source", "claude_code"], tempRoot)).exitCode, 0);

    const dryRun = await runCliCapture(["export", "--store", storeDir, "--out", bundleDir, "--dry-run"], tempRoot);
    assert.equal(dryRun.exitCode, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /Sources\s*:\s*2/);
    assert.match(dryRun.stdout, /Includes Raw\s*:\s*true/);
    assert.match(dryRun.stdout, /Codex/);
    assert.match(dryRun.stdout, /Claude Code/);
    assert.equal(await fileExists(bundleDir), false);
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

test("export bundle defaults to raw snapshots and restores into a clean store with readable CLI output", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const sourceStoreDir = path.join(tempRoot, "source-store");
    const targetStoreDir = path.join(tempRoot, "target-store");
    const bundleDir = path.join(tempRoot, "backup.cchistory-bundle");

    assert.equal((await runCliCapture(["sync", "--store", sourceStoreDir, "--source", "codex", "--source", "claude_code"], tempRoot)).exitCode, 0);

    await assert.rejects(access(path.join(targetStoreDir, "cchistory.sqlite")));

    const exportResult = await runCliCapture(["export", "--store", sourceStoreDir, "--out", bundleDir], tempRoot);
    assert.equal(exportResult.exitCode, 0, exportResult.stderr);
    assert.match(exportResult.stdout, /Includes Raw\s*: true/);

    const manifest = JSON.parse(await readFile(path.join(bundleDir, "manifest.json"), "utf8")) as {
      includes_raw_blobs: boolean;
      counts: { blobs: number };
    };
    assert.equal(manifest.includes_raw_blobs, true);
    assert.ok(manifest.counts.blobs > 0);
    await access(path.join(bundleDir, "raw"));

    const importResult = await runCliCapture(["import", bundleDir, "--store", targetStoreDir], tempRoot);
    assert.equal(importResult.exitCode, 0, importResult.stderr);
    assert.match(importResult.stdout, /Imported Sources\s*: 2/);

    const statsResult = await runCliCapture(["stats", "--store", targetStoreDir], tempRoot);
    assert.equal(statsResult.exitCode, 0, statsResult.stderr);
    assert.match(statsResult.stdout, /Schema Version/);
    assert.match(statsResult.stdout, /Sources\s*:\s*2/);

    const sourcesResult = await runCliCapture(["ls", "sources", "--store", targetStoreDir], tempRoot);
    assert.equal(sourcesResult.exitCode, 0, sourcesResult.stderr);
    assert.match(sourcesResult.stdout, /Codex/);
    assert.match(sourcesResult.stdout, /Claude Code/);

    const sessionsResult = await runCliCapture(["ls", "sessions", "--store", targetStoreDir], tempRoot);
    assert.equal(sessionsResult.exitCode, 0, sessionsResult.stderr);
    assert.match(sessionsResult.stdout, /sess:codex:codex-session-1/);
    assert.match(sessionsResult.stdout, /sess:claude_code:conversation/);

    const searchResult = await runCliCapture(["search", "probe", "--store", targetStoreDir], tempRoot);
    assert.equal(searchResult.exitCode, 0, searchResult.stderr);
    assert.match(searchResult.stdout, /Review the probe output/);

    const restoredStorage = new CCHistoryStorage(targetStoreDir);
    try {
      assert.ok(restoredStorage.listAllBlobs().some((blob) => blob.captured_path?.startsWith(path.join(targetStoreDir, "raw"))));
    } finally {
      restoredStorage.close();
    }
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});


test("restore-check summarizes restored-store counts and source presence in one read-only command", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const sourceStoreDir = path.join(tempRoot, "source-store");
    const targetStoreDir = path.join(tempRoot, "target-store");
    const bundleDir = path.join(tempRoot, "restore-check.cchistory-bundle");

    assert.equal((await runCliCapture(["sync", "--store", sourceStoreDir, "--source", "codex", "--source", "claude_code"], tempRoot)).exitCode, 0);
    assert.equal((await runCliCapture(["export", "--store", sourceStoreDir, "--out", bundleDir], tempRoot)).exitCode, 0);
    assert.equal((await runCliCapture(["import", bundleDir, "--store", targetStoreDir], tempRoot)).exitCode, 0);

    const restoreCheckText = await runCliCapture(["restore-check", "--store", targetStoreDir], tempRoot);
    assert.equal(restoreCheckText.exitCode, 0, restoreCheckText.stderr);
    assert.match(restoreCheckText.stdout, /Restore Check/);
    assert.match(restoreCheckText.stdout, /Schema Version/);
    assert.match(restoreCheckText.stdout, /Codex/);
    assert.match(restoreCheckText.stdout, /Claude Code/);

    const restoreCheck = await runCliJson<{
      kind: string;
      read_mode: string;
      stats: {
        kind: string;
        counts: {
          sources: number;
          sessions: number;
          turns: number;
        };
      };
      sources: {
        kind: string;
        sources: Array<{
          display_name: string;
          total_sessions: number;
          total_turns: number;
        }>;
      };
    }>(["restore-check", "--store", targetStoreDir], tempRoot);

    assert.equal(restoreCheck.kind, "restore-check");
    assert.equal(restoreCheck.read_mode, "index");
    assert.equal(restoreCheck.stats.kind, "stats-overview");
    assert.equal(restoreCheck.sources.kind, "sources");
    assert.equal(restoreCheck.stats.counts.sources, 2);
    assert.equal(restoreCheck.sources.sources.length, 2);
    assert.deepEqual(
      restoreCheck.sources.sources.map((source) => source.display_name).sort(),
      ["Claude Code", "Codex"],
    );
    assert.ok(restoreCheck.stats.counts.sessions >= 2);
    assert.ok(restoreCheck.stats.counts.turns >= 2);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("restore-check requires an explicit target and never invents a store", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const missingStoreDir = path.join(tempRoot, "missing-store");

    const noTarget = await runCliCapture(["restore-check"], tempRoot);
    assert.equal(noTarget.exitCode, 1);
    assert.match(noTarget.stderr, /requires an explicit --store or --db target/);

    const missingTarget = await runCliCapture(["restore-check", "--store", missingStoreDir], tempRoot);
    assert.equal(missingTarget.exitCode, 1);
    assert.match(missingTarget.stderr, /Store not found/);
    assert.equal(await fileExists(path.join(missingStoreDir, "cchistory.sqlite")), false);

    const fullScan = await runCliCapture(["restore-check", "--store", missingStoreDir, "--full"], tempRoot);
    assert.equal(fullScan.exitCode, 1);
    assert.match(fullScan.stderr, /does not support --full/);
    assert.equal(await fileExists(path.join(missingStoreDir, "cchistory.sqlite")), false);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("built CLI keeps routine stderr quiet for successful and expected-failure workflows", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    const bundleDir = path.join(tempRoot, "bundle.cchistory-bundle");
    const childEnv = { ...process.env, HOME: tempRoot };

    const syncResult = await runBuiltCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot, childEnv);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);
    assert.match(syncResult.stdout, /Synced 1 source\(s\)/);
    assert.equal(syncResult.stderr.trim(), "");

    const backupResult = await runBuiltCliCapture(["backup", "--store", storeDir, "--out", bundleDir], tempRoot, childEnv);
    assert.equal(backupResult.exitCode, 0, backupResult.stderr);
    assert.match(backupResult.stdout, /Workflow\s*:\s*backup/);
    assert.equal(backupResult.stderr.trim(), "");

    const restoreCheckResult = await runBuiltCliCapture(["restore-check", "--store", storeDir], tempRoot, childEnv);
    assert.equal(restoreCheckResult.exitCode, 0, restoreCheckResult.stderr);
    assert.match(restoreCheckResult.stdout, /Restore Check/);
    assert.equal(restoreCheckResult.stderr.trim(), "");

    const missingStoreDir = path.join(tempRoot, "missing-store");
    const missingStoreResult = await runBuiltCliCapture(["restore-check", "--store", missingStoreDir], tempRoot, childEnv);
    assert.equal(missingStoreResult.exitCode, 1);
    assert.match(missingStoreResult.stderr, /Store not found/);
    assert.doesNotMatch(missingStoreResult.stderr, /ExperimentalWarning/);
    assert.doesNotMatch(missingStoreResult.stderr, /FTS5 unavailable/);
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
    assert.match(conflictImport.stderr, /Next steps:/);
    assert.match(conflictImport.stderr, /--dry-run/);
    assert.match(conflictImport.stderr, /--on-conflict skip/);
    assert.match(conflictImport.stderr, /--on-conflict replace/);

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

test("import --dry-run previews bundle actions without creating a target store", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const sourceStoreDir = path.join(tempRoot, "source-store");
    const targetStoreDir = path.join(tempRoot, "target-store");
    const bundleDir = path.join(tempRoot, "dry-run.cchistory-bundle");

    assert.equal((await runCliCapture(["sync", "--store", sourceStoreDir, "--source", "codex", "--source", "claude_code"], tempRoot)).exitCode, 0);
    assert.equal((await runCliCapture(["export", "--store", sourceStoreDir, "--out", bundleDir], tempRoot)).exitCode, 0);

    const dryRun = await runCliCapture(["import", bundleDir, "--store", targetStoreDir, "--dry-run"], tempRoot);
    assert.equal(dryRun.exitCode, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /Would Import\s*:\s*2/);
    assert.match(dryRun.stdout, /Would Fail\s*:\s*false/);
    assert.match(dryRun.stdout, /Codex/);
    assert.match(dryRun.stdout, /Claude Code/);

    await assert.rejects(access(path.join(targetStoreDir, "cchistory.sqlite")));
    assert.equal(await fileExists(path.join(targetStoreDir, "raw")), false);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("import --dry-run previews conflicts without mutating the target store", async () => {
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

    await overwriteCodexPrompt(tempRoot, "Codex prompt changed for dry-run conflict preview.");
    assert.equal((await runCliCapture(["sync", "--store", sourceStoreDir, "--source", "codex"], tempRoot)).exitCode, 0);
    assert.equal((await runCliCapture(["export", "--store", sourceStoreDir, "--out", bundleBDir], tempRoot)).exitCode, 0);

    const errorPreview = await runCliCapture(["import", bundleBDir, "--store", targetStoreDir, "--dry-run"], tempRoot);
    assert.equal(errorPreview.exitCode, 0, errorPreview.stderr);
    assert.match(errorPreview.stdout, /Would Conflict\s*:\s*1/);
    assert.match(errorPreview.stdout, /Would Fail\s*:\s*true/);
    assert.match(errorPreview.stdout, /conflict_error/);

    const replacePreview = await runCliCapture(
      ["import", bundleBDir, "--store", targetStoreDir, "--dry-run", "--on-conflict", "replace"],
      tempRoot,
    );
    assert.equal(replacePreview.exitCode, 0, replacePreview.stderr);
    assert.match(replacePreview.stdout, /Would Replace\s*:\s*1/);
    assert.match(replacePreview.stdout, /Would Fail\s*:\s*false/);
    assert.match(replacePreview.stdout, /conflict_replace/);

    const targetStorage = new CCHistoryStorage({ dbPath: path.join(targetStoreDir, "cchistory.sqlite") });
    try {
      const turns = targetStorage.listResolvedTurns();
      assert.equal(turns.some((turn) => turn.canonical_text.includes("dry-run conflict preview")), false);
    } finally {
      targetStorage.close();
    }
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("gc prunes orphan raw snapshots while preserving referenced blobs", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    assert.equal((await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot)).exitCode, 0);

    const storage = new CCHistoryStorage(storeDir);
    let sourceId = "";
    let referencedPath = "";
    try {
      const source = storage.listSources().find((entry) => entry.platform === "codex");
      assert.ok(source);
      sourceId = source.id;
      const payload = storage.getSourcePayload(source.id);
      assert.ok(payload);
      referencedPath = payload.blobs[0]?.captured_path ?? "";
      assert.notEqual(referencedPath, "");
    } finally {
      storage.close();
    }

    const orphanPath = path.join(storeDir, "raw", sourceId, "orphan.jsonl");
    const legacyPath = path.join(storeDir, "raw", "src-codex", "legacy.jsonl");
    await writeFile(orphanPath, "orphan\n", "utf8");
    await mkdir(path.dirname(legacyPath), { recursive: true });
    await writeFile(legacyPath, "legacy\n", "utf8");

    const gcResult = await runCliCapture(["gc", "--store", storeDir], tempRoot);
    assert.equal(gcResult.exitCode, 0, gcResult.stderr);
    assert.match(gcResult.stdout, /Deleted Files\s*: 2/);
    assert.equal(await fileExists(orphanPath), false);
    assert.equal(await fileExists(legacyPath), false);
    assert.equal(await fileExists(referencedPath), true);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("gc --dry-run fails for a missing store without creating a database", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));

  try {
    const storeDir = path.join(tempRoot, "missing-store");
    const gcResult = await runCliCapture(["gc", "--dry-run", "--store", storeDir], tempRoot);
    assert.equal(gcResult.exitCode, 1);
    assert.match(gcResult.stderr, /Store not found/);
    assert.equal(await fileExists(path.join(storeDir, "cchistory.sqlite")), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync leaves orphan raw snapshots in place until gc is run explicitly", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const storeDir = path.join(tempRoot, "store");
    assert.equal((await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot)).exitCode, 0);

    const storage = new CCHistoryStorage(storeDir);
    let sourceId = "";
    try {
      const source = storage.listSources().find((entry) => entry.platform === "codex");
      assert.ok(source);
      sourceId = source.id;
    } finally {
      storage.close();
    }

    const orphanPath = path.join(storeDir, "raw", sourceId, "stale.jsonl");
    await writeFile(orphanPath, "stale\n", "utf8");
    assert.equal(await fileExists(orphanPath), true);

    const syncResult = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);
    assert.doesNotMatch(syncResult.stdout, /Raw GC/);
    assert.equal(await fileExists(orphanPath), true);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("agent pair stores state and agent upload sends only dirty source payloads", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;
  const originalFetch = globalThis.fetch;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const statePath = path.join(tempRoot, "agent-state.json");
    const uploadBodies: Array<Record<string, unknown>> = [];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/agent/pair")) {
        return new Response(JSON.stringify({
          agent_id: "agent-test-1",
          agent_token: "agent-token-1",
          paired_at: "2026-04-02T00:00:00.000Z",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/agent/uploads")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        uploadBodies.push(body);
        const bundle = body.bundle as { manifest?: { bundle_id?: string }; payloads?: unknown[] };
        const manifest = body.source_manifest as unknown[];
        return new Response(JSON.stringify({
          bundle_id: bundle.manifest?.bundle_id ?? `bundle-${uploadBodies.length}`,
          imported_source_ids: (bundle.payloads?.length ?? 0) > 0 && uploadBodies.length === 1 ? [((manifest?.[0] as { source_id?: string } | undefined)?.source_id ?? "src-1")] : [],
          replaced_source_ids: [],
          skipped_source_ids: [],
          source_manifest_count: manifest?.length ?? 0,
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `Unhandled URL: ${url}` }), { status: 500, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const pairResult = await runCliCapture([
      "agent",
      "pair",
      "--server",
      "https://remote.example",
      "--pair-token",
      "pair-secret",
      "--state-file",
      statePath,
    ], tempRoot);
    assert.equal(pairResult.exitCode, 0, pairResult.stderr);
    assert.equal(await fileExists(statePath), true);

    const firstUpload = await runCliCapture(["agent", "upload", "--state-file", statePath, "--source", "codex"], tempRoot);
    assert.equal(firstUpload.exitCode, 0, firstUpload.stderr);
    assert.equal(uploadBodies.length, 1);
    const firstBundle = uploadBodies[0]?.bundle as { payloads?: unknown[] };
    assert.equal(firstBundle.payloads?.length, 1);

    const secondUpload = await runCliCapture(["agent", "upload", "--state-file", statePath, "--source", "codex"], tempRoot);
    assert.equal(secondUpload.exitCode, 0, secondUpload.stderr);
    assert.equal(uploadBodies.length, 2);
    const secondBundle = uploadBodies[1]?.bundle as { payloads?: unknown[] };
    assert.equal(secondBundle.payloads?.length, 0);

    const persistedState = JSON.parse(await readFile(statePath, "utf8")) as {
      last_uploaded_generation_by_source_id: Record<string, number>;
      last_uploaded_checksum_by_source_id: Record<string, string>;
    };
    const uploadedSourceIds = Object.keys(persistedState.last_uploaded_generation_by_source_id);
    assert.equal(uploadedSourceIds.length, 1);
    const uploadedSourceId = uploadedSourceIds[0]!;
    const uploadedGeneration = persistedState.last_uploaded_generation_by_source_id[uploadedSourceId];
    const uploadedChecksum = persistedState.last_uploaded_checksum_by_source_id[uploadedSourceId];
    assert.equal(typeof uploadedGeneration, "number");
    assert.equal((uploadedGeneration ?? 0) > 0, true);
    assert.equal(typeof uploadedChecksum, "string");
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});


test("agent schedule retries failed uploads and runs the requested number of local cycles", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;
  const originalFetch = globalThis.fetch;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const statePath = path.join(tempRoot, "agent-schedule-state.json");
    let uploadAttempt = 0;

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/agent/pair")) {
        return new Response(JSON.stringify({
          agent_id: "agent-test-schedule",
          agent_token: "agent-token-schedule",
          paired_at: "2026-04-02T00:00:00.000Z",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/api/agent/uploads")) {
        uploadAttempt += 1;
        if (uploadAttempt === 1) {
          return new Response(JSON.stringify({ error: "temporary upstream failure" }), { status: 503, headers: { "content-type": "application/json" } });
        }
        const body = JSON.parse(String(init?.body ?? "{}")) as { bundle?: { manifest?: { bundle_id?: string } } };
        return new Response(JSON.stringify({
          bundle_id: body.bundle?.manifest?.bundle_id ?? `bundle-${uploadAttempt}`,
          imported_source_ids: [],
          replaced_source_ids: [],
          skipped_source_ids: [],
          source_manifest_count: 1,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: `Unhandled URL: ${url}` }), { status: 500, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    assert.equal((await runCliCapture([
      "agent",
      "pair",
      "--server",
      "https://remote.example",
      "--pair-token",
      "pair-secret",
      "--state-file",
      statePath,
    ], tempRoot)).exitCode, 0);

    const scheduleResult = await runCliCapture([
      "agent",
      "schedule",
      "--state-file",
      statePath,
      "--source",
      "codex",
      "--interval-seconds",
      "0",
      "--iterations",
      "2",
      "--retry-attempts",
      "1",
      "--retry-delay-ms",
      "0",
    ], tempRoot);
    assert.equal(scheduleResult.exitCode, 0, scheduleResult.stderr);
    assert.match(scheduleResult.stdout, /Completed 2 scheduled remote-agent cycle\(s\)/);
    assert.match(scheduleResult.stdout, /attempts=2/);
    assert.equal(uploadAttempt, 3);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});


test("agent pull leases one job, uploads a filtered bundle, and reports completion", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-"));
  const originalHome = process.env.HOME;
  const originalFetch = globalThis.fetch;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const statePath = path.join(tempRoot, "agent-pull-state.json");
    const uploadBodies: Array<Record<string, unknown>> = [];
    const completionBodies: Array<Record<string, unknown>> = [];
    let leaseCalls = 0;

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/agent/pair")) {
        return new Response(JSON.stringify({
          agent_id: "agent-test-pull",
          agent_token: "agent-token-pull",
          paired_at: "2026-04-02T00:00:00.000Z",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/api/agent/jobs/lease")) {
        leaseCalls += 1;
        return new Response(JSON.stringify({
          agent_id: "agent-test-pull",
          job: leaseCalls === 1 ? {
            job_id: "job-test-pull",
            trigger_kind: "server_requested",
            selector: { kind: "all" },
            source_slots: ["codex"],
            sync_mode: "dirty_snapshot",
            created_at: "2026-04-02T00:01:00.000Z",
            leased_at: "2026-04-02T00:02:00.000Z",
            lease_expires_at: "2026-04-02T00:07:00.000Z",
          } : undefined,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/api/agent/uploads")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        uploadBodies.push(body);
        const bundle = body.bundle as { manifest?: { bundle_id?: string }; payloads?: unknown[] };
        const manifest = body.source_manifest as Array<{ source_id?: string }> | undefined;
        return new Response(JSON.stringify({
          bundle_id: bundle.manifest?.bundle_id ?? "bundle-pull-1",
          imported_source_ids: (bundle.payloads?.length ?? 0) > 0 ? [manifest?.[0]?.source_id ?? "src-1"] : [],
          replaced_source_ids: [],
          skipped_source_ids: [],
          source_manifest_count: manifest?.length ?? 0,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/api/agent/jobs/") && url.endsWith("/complete")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        completionBodies.push(body);
        return new Response(JSON.stringify({
          job_id: "job-test-pull",
          agent_id: "agent-test-pull",
          status: body.status,
          completed_at: "2026-04-02T00:03:00.000Z",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: `Unhandled URL: ${url}` }), { status: 500, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    assert.equal((await runCliCapture([
      "agent",
      "pair",
      "--server",
      "https://remote.example",
      "--pair-token",
      "pair-secret",
      "--state-file",
      statePath,
    ], tempRoot)).exitCode, 0);

    const pullResult = await runCliCapture([
      "agent",
      "pull",
      "--state-file",
      statePath,
      "--retry-attempts",
      "1",
      "--retry-delay-ms",
      "0",
    ], tempRoot);
    assert.equal(pullResult.exitCode, 0, pullResult.stderr);
    assert.match(pullResult.stdout, /Completed leased remote-agent job job-test-pull/);
    assert.equal(uploadBodies.length, 1);
    assert.equal(uploadBodies[0]?.job_id, "job-test-pull");
    const firstBundle = uploadBodies[0]?.bundle as { payloads?: unknown[] };
    assert.equal(firstBundle.payloads?.length, 1);
    assert.equal(completionBodies.length, 1);
    assert.equal(completionBodies[0]?.status, "succeeded");
    assert.equal(typeof completionBodies[0]?.bundle_id, "string");
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});


async function runBuiltCliCapture(
  argv: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const cliEntry = fileURLToPath(new URL("./index.js", import.meta.url));
  return await new Promise((resolve, reject) => {
    execFile(process.execPath, [cliEntry, ...argv], { cwd, env }, (error, stdout, stderr) => {
      if (error && typeof (error as { code?: unknown }).code !== "number") {
        reject(error);
        return;
      }
      resolve({
        exitCode: typeof (error as { code?: unknown } | null)?.code === "number" ? Number((error as { code: number }).code) : 0,
        stdout,
        stderr,
      });
    });
  });
}

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

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
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
  const opencodeStorageRoot = path.join(tempRoot, ".local", "share", "opencode", "storage");
  const opencodeSessionDir = path.join(opencodeStorageRoot, "session", "global");
  const opencodeMessageDir = path.join(opencodeStorageRoot, "message", "opencode-fixture");
  const opencodeUserPartDir = path.join(opencodeStorageRoot, "part", "opencode-user-1");
  const opencodeAssistantPartDir = path.join(opencodeStorageRoot, "part", "opencode-assistant-1");
  const opencodeTodoDir = path.join(opencodeStorageRoot, "todo");
  const opencodeSessionDiffDir = path.join(opencodeStorageRoot, "session_diff");

  await mkdir(openclawDir, { recursive: true });
  await mkdir(opencodeSessionDir, { recursive: true });
  await mkdir(opencodeMessageDir, { recursive: true });
  await mkdir(opencodeUserPartDir, { recursive: true });
  await mkdir(opencodeAssistantPartDir, { recursive: true });
  await mkdir(opencodeTodoDir, { recursive: true });
  await mkdir(opencodeSessionDiffDir, { recursive: true });

  await writeFile(
    path.join(openclawDir, "openclaw-fixture.jsonl"),
    [
      {
        type: "session",
        version: 3,
        id: "openclaw-fixture",
        timestamp: "2026-03-10T04:00:00.000Z",
        cwd: "/workspace/openclaw",
      },
      {
        type: "model_change",
        id: "openclaw-model-1",
        parentId: null,
        timestamp: "2026-03-10T04:00:00.001Z",
        provider: "zai",
        modelId: "glm-5-turbo",
      },
      {
        type: "message",
        id: "openclaw-user-1",
        parentId: "openclaw-model-1",
        timestamp: "2026-03-10T04:00:00.010Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Inspect OpenClaw history." }],
        },
      },
      {
        type: "message",
        id: "openclaw-assistant-1",
        parentId: "openclaw-user-1",
        timestamp: "2026-03-10T04:00:01.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Review the queued history before replying.", thinkingSignature: "mock-openclaw-thinking" },
            { type: "text", text: "I will inspect the queued history first." },
            { type: "toolCall", id: "call-openclaw-read-1", name: "read", arguments: { path: "/workspace/openclaw/notes.md" } },
          ],
          model: "glm-5-turbo",
          usage: { input: 7, output: 3, totalTokens: 10 },
          stopReason: "tool_use",
        },
      },
      {
        type: "message",
        id: "openclaw-tool-result-1",
        parentId: "openclaw-assistant-1",
        timestamp: "2026-03-10T04:00:01.200Z",
        message: {
          role: "toolResult",
          toolCallId: "call-openclaw-read-1",
          toolName: "read",
          content: [{ type: "text", text: "OpenClaw history loaded." }],
        },
      },
      {
        type: "message",
        id: "openclaw-assistant-2",
        parentId: "openclaw-tool-result-1",
        timestamp: "2026-03-10T04:00:01.400Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "OpenClaw history loaded." }],
          model: "glm-5-turbo",
          usage: { input: 3, output: 3, totalTokens: 6 },
          stopReason: "end_turn",
        },
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
      directory: "/workspace/opencode",
      version: "1.0.114",
      time: {
        created: 1771000000000,
        updated: 1771000002000,
      },
    }),
    "utf8",
  );
  await writeFile(
    path.join(opencodeMessageDir, "0001.json"),
    JSON.stringify({
      id: "opencode-user-1",
      sessionID: "opencode-fixture",
      role: "user",
      time: {
        created: 1771000001000,
      },
      path: {
        cwd: "/workspace/opencode",
        root: "/",
      },
    }),
    "utf8",
  );
  await writeFile(
    path.join(opencodeUserPartDir, "0001.json"),
    JSON.stringify({
      id: "opencode-user-1-part-1",
      sessionID: "opencode-fixture",
      messageID: "opencode-user-1",
      type: "text",
      text: "Review the OpenCode part-backed history.",
    }),
    "utf8",
  );
  await writeFile(
    path.join(opencodeMessageDir, "0002.json"),
    JSON.stringify({
      id: "opencode-assistant-1",
      sessionID: "opencode-fixture",
      role: "assistant",
      time: {
        created: 1771000002000,
        completed: 1771000003000,
      },
      modelID: "sonnet-4",
      path: {
        cwd: "/workspace/opencode",
        root: "/",
      },
      finish: "tool-calls",
      tokens: {
        input: 8,
        output: 4,
        reasoning: 0,
        cache: {
          read: 2,
          write: 0,
        },
      },
    }),
    "utf8",
  );
  await writeFile(
    path.join(opencodeAssistantPartDir, "0001.json"),
    JSON.stringify({
      id: "opencode-assistant-1-part-1",
      sessionID: "opencode-fixture",
      messageID: "opencode-assistant-1",
      type: "tool",
      callID: "call-opencode-read-1",
      tool: "read",
      state: {
        status: "completed",
        input: {
          filePath: "/workspace/opencode/notes.md",
          limit: 20,
        },
        output: "<file>\n00001| OpenCode part-backed history loaded.\n</file>",
      },
    }),
    "utf8",
  );
  await writeFile(
    path.join(opencodeAssistantPartDir, "0002.json"),
    JSON.stringify({
      id: "opencode-assistant-1-part-2",
      sessionID: "opencode-fixture",
      messageID: "opencode-assistant-1",
      type: "text",
      text: "OpenCode part-backed history loaded.",
    }),
    "utf8",
  );
  await writeFile(path.join(opencodeSessionDiffDir, "opencode-fixture.json"), "[]\n", "utf8");
  await writeFile(
    path.join(opencodeTodoDir, "opencode-fixture.json"),
    JSON.stringify([{ id: "todo-1", content: "Capture supporting checklist", status: "pending" }]),
    "utf8",
  );
}

async function seedCliDiscoveryFixtures(tempRoot: string): Promise<void> {
  await seedCliOpenSourceFixtures(tempRoot);

  const opencodeStorageRoot = path.join(tempRoot, ".local", "share", "opencode", "storage");
  const officialProjectDir = path.join(tempRoot, ".local", "share", "opencode", "project", "workspace-demo");
  const officialOpencodeSessionDir = path.join(opencodeStorageRoot, "session", "global");
  const officialOpencodeMessageDir = path.join(opencodeStorageRoot, "message", "opencode-official");
  const officialOpencodeUserPartDir = path.join(opencodeStorageRoot, "part", "opencode-official-user-1");

  await mkdir(officialProjectDir, { recursive: true });
  await mkdir(officialOpencodeSessionDir, { recursive: true });
  await mkdir(officialOpencodeMessageDir, { recursive: true });
  await mkdir(officialOpencodeUserPartDir, { recursive: true });

  await writeFile(
    path.join(officialOpencodeSessionDir, "opencode-official.json"),
    JSON.stringify({
      id: "opencode-official",
      title: "OpenCode official fixture",
      directory: "/workspace/opencode-official",
      version: "1.0.114",
      time: {
        created: 1771000100000,
        updated: 1771000102000,
      },
    }),
    "utf8",
  );
  await writeFile(
    path.join(officialOpencodeMessageDir, "0001.json"),
    JSON.stringify({
      id: "opencode-official-user-1",
      sessionID: "opencode-official",
      role: "user",
      time: {
        created: 1771000101000,
      },
      path: {
        cwd: "/workspace/opencode-official",
        root: "/",
      },
    }),
    "utf8",
  );
  await writeFile(
    path.join(officialOpencodeUserPartDir, "0001.json"),
    JSON.stringify({
      id: "opencode-official-user-1-part-1",
      sessionID: "opencode-official",
      messageID: "opencode-official-user-1",
      type: "text",
      text: "Inspect official OpenCode path.",
    }),
    "utf8",
  );

  await mkdir(path.join(tempRoot, ".gemini", "tmp", "project-hash"), { recursive: true });
  await mkdir(path.join(tempRoot, ".gemini", "history"), { recursive: true });
  await writeFile(path.join(tempRoot, ".gemini", "settings.json"), JSON.stringify({ theme: "dark" }), "utf8");
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
