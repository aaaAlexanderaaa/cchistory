/**
 * Journey E — Real-layout truthfulness
 *
 * Validates: Truthful about adopted experimental slices.
 * Pass conditions:
 * - Fixtures reflect observed real layouts for all stable adapters
 * - Sync from real-layout mock_data produces expected sources/sessions/projects
 * - Adapter-specific expectations:
 *   - Codex, Claude Code → committed "chat-ui-kit" project
 *   - Factory Droid, AMP, Antigravity → committed "history-lab" project
 *   - OpenCode → committed "esql-lab" project
 *   - Gemini → candidate "agentresearch" project
 *   - CodeBuddy → candidate project
 *   - Cursor chat-store → sessions with titles
 *   - OpenClaw → cron sessions with zero turns
 * - Search returns hits from real-layout sources
 * - CLI and API agree
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  ensureBuilt,
  createTempRoot,
  removeTempRoot,
  seedDefaultMockDataHome,
  seedRealLayoutHome,
  runCliJson,
  runCliCapture,
  startApiServer,
  apiGet,
} from "./helpers.mjs";

const STABLE_REAL_LAYOUT_SOURCES = [
  "codex",
  "claude_code",
  "factory_droid",
  "amp",
  "cursor",
  "antigravity",
  "gemini",
  "openclaw",
  "opencode",
  "codebuddy",
];

describe("Journey E — Real-layout truthfulness", () => {
  let tempRoot;
  let storeDir;
  let childEnv;

  before(async () => {
    ensureBuilt();
    tempRoot = await createTempRoot("e2e-journey-e-");
    storeDir = path.join(tempRoot, "store");
    childEnv = { ...process.env, HOME: tempRoot };
    await seedDefaultMockDataHome(tempRoot);
    await seedRealLayoutHome(tempRoot);
  });

  after(async () => {
    if (tempRoot) await removeTempRoot(tempRoot);
  });

  // ---- Sync ----

  it("CLI sync ingests all stable real-layout sources", async () => {
    const syncResult = await runCliCapture(
      [
        "sync", "--store", storeDir,
        ...STABLE_REAL_LAYOUT_SOURCES.flatMap((source) => ["--source", source]),
      ],
      tempRoot,
      childEnv,
    );
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);
    assert.match(syncResult.stdout, /Synced 10 source\(s\)/);
  });

  // ---- Source verification ----

  it("CLI ls sources shows all stable platforms", async () => {
    const sources = await runCliJson(["ls", "sources", "--store", storeDir], tempRoot, childEnv);
    assert.equal(sources.kind, "sources");
    assert.equal(sources.sources.length, 10);
    assert.deepEqual(
      sources.sources.map((s) => s.platform).sort(),
      [...STABLE_REAL_LAYOUT_SOURCES].sort(),
    );
  });

  it("OpenClaw source has 2 sessions and 0 turns", async () => {
    const sources = await runCliJson(["ls", "sources", "--store", storeDir], tempRoot, childEnv);
    const openclaw = sources.sources.find((s) => s.platform === "openclaw");
    assert.ok(openclaw);
    assert.equal(openclaw.total_sessions, 2);
    assert.equal(openclaw.total_turns, 0);
  });

  it("Cursor source has merged app and chat-store coverage", async () => {
    const sources = await runCliJson(["ls", "sources", "--store", storeDir], tempRoot, childEnv);
    const cursor = sources.sources.find((s) => s.platform === "cursor");
    assert.ok(cursor);
    assert.equal(cursor.total_sessions, 5);
    assert.equal(cursor.total_turns, 4);
  });

  // ---- Project verification ----

  it("OpenCode produces committed esql-lab project", async () => {
    const projects = await runCliJson(["ls", "projects", "--store", storeDir], tempRoot, childEnv);
    const opencodeProject = projects.projects.find((p) => p.display_name === "esql-lab");
    assert.ok(opencodeProject, "expected committed OpenCode project");
    assert.equal(opencodeProject.linkage_state, "committed");
  });

  it("Gemini produces candidate agentresearch project", async () => {
    const projects = await runCliJson(["ls", "projects", "--store", storeDir], tempRoot, childEnv);
    const geminiProject = projects.projects.find((p) => p.display_name === "agentresearch");
    assert.ok(geminiProject, "expected Gemini candidate project");
    assert.equal(geminiProject.linkage_state, "candidate");
  });

  it("CodeBuddy produces candidate project", async () => {
    const projects = await runCliJson(["ls", "projects", "--store", storeDir], tempRoot, childEnv);
    const codebuddyProject = projects.projects.find(
      (p) => p.display_name === "config-workspace-ai_learning",
    );
    assert.ok(codebuddyProject, "expected CodeBuddy candidate project");
    assert.equal(codebuddyProject.linkage_state, "candidate");
  });

  it("local coding-agent fixtures produce committed chat-ui-kit and history-lab projects", async () => {
    const projects = await runCliJson(["ls", "projects", "--store", storeDir], tempRoot, childEnv);
    const chatUiKit = projects.projects.find((p) => p.display_name === "chat-ui-kit" && p.linkage_state === "committed");
    const historyLab = projects.projects.find((p) => p.display_name === "history-lab" && p.linkage_state === "committed");
    assert.ok(chatUiKit, "expected committed chat-ui-kit project");
    assert.ok(historyLab, "expected committed history-lab project");
  });

  // ---- Session verification ----

  it("Cursor chat-store session has expected title", async () => {
    const sessions = await runCliJson(["ls", "sessions", "--store", storeDir], tempRoot, childEnv);
    const cursorSession = sessions.sessions.find(
      (s) => s.source_platform === "cursor" && s.title === "MCP Service Guide",
    );
    assert.ok(cursorSession, "expected Cursor session with title 'MCP Service Guide'");
  });

  it("OpenClaw cron session exists with correct title", async () => {
    const sessions = await runCliJson(["ls", "sessions", "--store", storeDir], tempRoot, childEnv);
    const cronSession = sessions.sessions.find(
      (s) => s.source_platform === "openclaw" && s.title === "cron:mock-openclaw-hourly",
    );
    assert.ok(cronSession, "expected OpenClaw cron session");
  });

  it("OpenClaw cron session has zero turns", async () => {
    const sessions = await runCliJson(["ls", "sessions", "--store", storeDir], tempRoot, childEnv);
    const cronSession = sessions.sessions.find(
      (s) => s.source_platform === "openclaw" && s.title === "cron:mock-openclaw-hourly",
    );
    const sessionDetail = await runCliJson(
      ["show", "session", cronSession.id, "--store", storeDir],
      tempRoot,
      childEnv,
    );
    assert.equal(sessionDetail.turns.length, 0);
  });

  // ---- Search across real-layout sources ----

  it("search finds OpenCode turn via Requirement Review", async () => {
    const results = await runCliJson(
      ["search", "Requirement Review", "--store", storeDir],
      tempRoot,
      childEnv,
    );
    const hit = results.results.find((r) => r.session.source_platform === "opencode");
    assert.ok(hit, "expected OpenCode search hit");
    assert.equal(hit.project.display_name, "esql-lab");
  });

  it("search finds Gemini turn via authored ask text", async () => {
    const results = await runCliJson(
      ["search", "noteworthy AI agent frameworks", "--store", storeDir],
      tempRoot,
      childEnv,
    );
    const hit = results.results.find((r) => r.session.source_platform === "gemini");
    assert.ok(hit, "expected Gemini search hit");
    assert.equal(hit.project.display_name, "agentresearch");
  });

  it("search finds CodeBuddy turn via AI learning", async () => {
    const results = await runCliJson(
      ["search", "AI learning", "--store", storeDir],
      tempRoot,
      childEnv,
    );
    const hit = results.results.find((r) => r.session.source_platform === "codebuddy");
    assert.ok(hit, "expected CodeBuddy search hit");
    assert.equal(hit.project.display_name, "config-workspace-ai_learning");
  });

  it("search finds Cursor chat-store turn via authored ask text", async () => {
    const results = await runCliJson(
      ["search", "Research stable MCP servers", "--store", storeDir],
      tempRoot,
      childEnv,
    );
    const hit = results.results.find((r) => r.session.source_platform === "cursor");
    assert.ok(hit, "expected Cursor search hit");
    assert.equal(hit.session.title, "MCP Service Guide");
  });

  it("search finds representative hits for the additional stable adapters", async () => {
    const cases = [
      { platform: "codex", query: "optimization plan", project: "chat-ui-kit" },
      { platform: "claude_code", query: "expert code reviewer", project: "chat-ui-kit" },
      { platform: "factory_droid", query: "history lab", project: "history-lab" },
      { platform: "amp", query: "AMP ingestion gaps", project: "history-lab" },
      { platform: "antigravity", query: "启动方式", project: "history-lab" },
    ];

    for (const entry of cases) {
      const results = await runCliJson(
        ["search", entry.query, "--store", storeDir],
        tempRoot,
        childEnv,
      );
      const hit = results.results.find((r) => r.session.source_platform === entry.platform);
      assert.ok(hit, `expected ${entry.platform} search hit for ${entry.query}`);
      assert.equal(hit.project.display_name, entry.project);
    }
  });

  it("path search exposes source-native resume commands for Codex and Claude Code", async () => {
    const results = await runCliJson(
      ["search", "/Users/mock_user/workspace/chat-ui-kit", "--store", storeDir],
      tempRoot,
      childEnv,
    );

    const codexHit = results.results.find((r) => r.session.source_platform === "codex");
    assert.ok(codexHit, "expected Codex hit from absolute workspace path search");
    assert.equal(codexHit.project.display_name, "chat-ui-kit");
    assert.ok(codexHit.session.source_session_id, "expected Codex source-native session id");
    assert.equal(codexHit.session.resume_working_directory, "/Users/mock_user/workspace/chat-ui-kit");
    assert.equal(
      codexHit.session.resume_command,
      `cd /Users/mock_user/workspace/chat-ui-kit && codex resume ${codexHit.session.source_session_id}`,
    );
    assert.match(codexHit.turn.path_text ?? "", /\/Users\/mock_user\/workspace\/chat-ui-kit/);

    const claudeHit = results.results.find((r) => r.session.source_platform === "claude_code");
    assert.ok(claudeHit, "expected Claude Code hit from absolute workspace path search");
    assert.equal(claudeHit.project.display_name, "chat-ui-kit");
    assert.ok(claudeHit.session.source_session_id, "expected Claude source-native session id");
    assert.equal(claudeHit.session.resume_working_directory, "/Users/mock_user/workspace/chat-ui-kit");
    assert.equal(
      claudeHit.session.resume_command,
      `cd /Users/mock_user/workspace/chat-ui-kit && claude --resume ${claudeHit.session.source_session_id}`,
    );
    assert.match(claudeHit.turn.path_text ?? "", /\/Users\/mock_user\/workspace\/chat-ui-kit/);
  });

  // ---- Turn drill-down ----

  it("show turn on OpenCode hit returns correct project and session", async () => {
    const results = await runCliJson(
      ["search", "Requirement Review", "--store", storeDir],
      tempRoot,
      childEnv,
    );
    const hit = results.results.find((r) => r.session.source_platform === "opencode");
    const turn = await runCliJson(
      ["show", "turn", hit.turn.id, "--store", storeDir],
      tempRoot,
      childEnv,
    );
    assert.equal(turn.turn.session_id, hit.session.id);
    assert.match(turn.turn.canonical_text, /Review the task requirements/);
  });

  it("show turn on Factory Droid hit returns correct project and session", async () => {
    const results = await runCliJson(
      ["search", "history lab", "--store", storeDir],
      tempRoot,
      childEnv,
    );
    const hit = results.results.find((r) => r.session.source_platform === "factory_droid");
    assert.ok(hit, "expected Factory Droid search hit");
    const turn = await runCliJson(
      ["show", "turn", hit.turn.id, "--store", storeDir],
      tempRoot,
      childEnv,
    );
    assert.equal(turn.turn.session_id, hit.session.id);
    assert.equal(turn.project.display_name, "history-lab");
    assert.match(turn.turn.canonical_text, /Factory Droid/);
  });

  // ---- API agreement ----

  it("API lists matching projects from real-layout sync", async () => {
    const server = await startApiServer(storeDir);
    try {
      const body = await apiGet(server.app, "/api/projects");
      assert.ok(body.projects.some((p) => p.display_name === "esql-lab"));
      assert.ok(body.projects.some((p) => p.display_name === "agentresearch"));
      assert.ok(body.projects.some((p) => p.display_name === "config-workspace-ai_learning"));
      assert.ok(body.projects.some((p) => p.display_name === "chat-ui-kit"));
      assert.ok(body.projects.some((p) => p.display_name === "history-lab"));
    } finally {
      await server.close();
    }
  });

  it("API search finds OpenCode and Gemini hits", async () => {
    const server = await startApiServer(storeDir);
    try {
      const opencodeBody = await apiGet(
        server.app,
        `/api/turns/search?q=${encodeURIComponent("Requirement Review")}`,
      );
      assert.ok(opencodeBody.results.some((r) => r.session.source_platform === "opencode"));

      const geminiBody = await apiGet(
        server.app,
        `/api/turns/search?q=${encodeURIComponent("noteworthy AI agent frameworks")}`,
      );
      assert.ok(geminiBody.results.some((r) => r.session.source_platform === "gemini"));

      const factoryBody = await apiGet(
        server.app,
        `/api/turns/search?q=${encodeURIComponent("history lab")}`,
      );
      assert.ok(factoryBody.results.some((r) => r.session.source_platform === "factory_droid"));
    } finally {
      await server.close();
    }
  });
});
