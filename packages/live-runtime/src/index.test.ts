import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildProjectDisplayList } from "@cchistory/canonical";
import type { ProjectIdentity, SessionProjection, UserTurnProjection } from "@cchistory/domain";
import { runSourceProbe } from "@cchistory/source-adapters";
import { CCHistoryStorage } from "@cchistory/storage";
import {
  assertLiteSourceRoot,
  buildLiveSnapshot,
  LiveHistorySnapshot,
  resolveLiteSources,
  scanLiteHistory,
} from "./index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const mockDataRoot = path.join(repoRoot, "mock_data");
const fixtureRoots = {
  codex: ".codex/sessions",
  claude_code: ".claude/projects",
  factory_droid: ".factory/sessions",
  amp: ".local/share/amp/threads",
  cursor: ".cursor/chats",
  antigravity: ".gemini/antigravity/brain",
  gemini: ".gemini",
  openclaw: ".openclaw/agents",
  opencode: ".local/share/opencode/storage",
  codebuddy: ".codebuddy",
  accio: "fixtures/accio-multi-agent/agents",
} as const;

test("Lite materializer matches Full canonical readback across the fixture-backed adapter matrix", async () => {
  const tempStore = await mkdtemp(path.join(os.tmpdir(), "cchistory-lite-full-parity-"));
  try {
    const sources = await resolveLiteSources({
      homeDir: path.join(tempStore, "empty-home"),
      hostname: "cchistory-lite-matrix-host",
      sourceRefs: Object.keys(fixtureRoots),
      sourceRoots: Object.entries(fixtureRoots).map(([sourceRef, relativePath]) => ({
        sourceRef,
        baseDir: path.join(mockDataRoot, relativePath),
      })),
    });
    const probe = await runSourceProbe({ safe_mode: true }, sources);
    const askPayload = probe.sources.find((payload) => payload.source.platform === "codex");
    const askSession = askPayload?.sessions[0];
    const longTurn = askPayload?.turns.find((turn) => turn.session_id === askSession?.id);
    assert.ok(askPayload && askSession && longTurn);
    longTurn.canonical_text = `${"a".repeat(16 * 1024)} lite-full-tail-only-token`;
    const searchObservation = askPayload.candidates.find(
      (candidate) => candidate.candidate_kind === "project_observation" && candidate.session_ref === askSession.id,
    );
    if (searchObservation) {
      searchObservation.evidence = {
        ...searchObservation.evidence,
        repo_remote: "https://example.test/lite-full-search-parity.git",
        repo_fingerprint: "fingerprint-lite-full-search-parity",
      };
    } else {
      askPayload.candidates.push({
        id: "candidate-lite-full-search-parity",
        source_id: askPayload.source.id,
        session_ref: askSession.id,
        candidate_kind: "project_observation",
        input_atom_refs: [],
        started_at: askSession.created_at,
        ended_at: askSession.updated_at,
        rule_version: "test",
        evidence: {
          repo_remote: "https://example.test/lite-full-search-parity.git",
          repo_fingerprint: "fingerprint-lite-full-search-parity",
          confidence: 0.5,
        },
      });
    }
    askPayload.ask_user_question_turns.push({
      id: "ask-user-question-lite-parity",
      source_id: askPayload.source.id,
      session_id: askSession.id,
      source_platform: askPayload.source.platform,
      created_at: askSession.created_at,
      tool_name: "request_user_input",
      call_atom_id: "atom-lite-parity-call",
      result_atom_id: "atom-lite-parity-result",
      questions: [
        {
          id: "scope",
          header: "Scope",
          question: "Which parity scope should run?",
          options: [{ label: "All fixtures", description: "Run the complete registered fixture matrix." }],
        },
      ],
      answers: [{ question_index: 0, selected_label: "All fixtures" }],
    });
    const lite = buildLiveSnapshot(probe);
    const full = new CCHistoryStorage(path.join(tempStore, "full.sqlite"));
    try {
      for (const payload of probe.sources) {
        full.replaceSourcePayload(payload, { allow_host_rekey: true });
      }

      assert.deepEqual(sortById(lite.listSources()), sortById(full.listSources()));
      assert.deepEqual(
        lite.listProjects().map((project) => project.project_id),
        buildProjectDisplayList(full.listProjects()).map((project) => project.project_id),
      );
      assert.deepEqual(
        normalizeProjects(lite.listProjects()),
        normalizeProjects(buildProjectDisplayList(full.listProjects())),
      );
      assert.deepEqual(lite.listResolvedSessions(), jsonNormalize(full.listResolvedSessions()));
      assert.deepEqual(lite.listResolvedTurns(), jsonNormalize(full.listResolvedTurns()));
      for (const turn of lite.listResolvedTurns()) {
        assert.deepEqual(jsonNormalize(lite.getTurnContext(turn.id)), jsonNormalize(full.getTurnContext(turn.id)));
      }
      assert.deepEqual(
        sortById(lite.listAskUserQuestionTurns()),
        sortById(full.listAskUserQuestionTurns()),
      );

      const liteSearch = lite.search({ query: "mock", limit: 10_000 });
      const fullSearch = full.searchTurnsPaginated({ query: "mock", limit: 10_000 });
      assert.equal(liteSearch.total, fullSearch.total);
      assert.deepEqual(
        liteSearch.results.map((result) => ({ id: result.turn.id, highlights: result.highlights })),
        fullSearch.results.map((result) => ({ id: result.turn.id, highlights: result.highlights })),
      );
      for (const [query, expectedTotal] of [
        ["lite-full-tail-only-token", 0],
        ["fingerprint-lite-full-search-parity", undefined],
      ] as const) {
        const liteParitySearch = lite.search({ query, limit: 10_000 });
        const fullParitySearch = full.searchTurnsPaginated({ query, limit: 10_000 });
        assert.equal(liteParitySearch.total, fullParitySearch.total, `search total parity for ${query}`);
        assert.deepEqual(
          liteParitySearch.results.map((result) => result.turn.id),
          fullParitySearch.results.map((result) => result.turn.id),
          `search result parity for ${query}`,
        );
        if (expectedTotal !== undefined) {
          assert.equal(liteParitySearch.total, expectedTotal);
        } else {
          assert.ok(liteParitySearch.total > 0);
        }
      }

      assert.deepEqual(
        withoutGeneratedAt(lite.getUsageOverview()),
        withoutGeneratedAt(full.getUsageOverview()),
      );
      for (const dimension of ["source", "project", "model", "day"] as const) {
        assert.deepEqual(
          withoutGeneratedAt(lite.getUsageRollup(dimension)),
          withoutGeneratedAt(full.listUsageRollup(dimension)),
        );
      }
    } finally {
      full.close();
    }
  } finally {
    await rm(tempStore, { recursive: true, force: true });
  }
});

test("Lite scans explicit roots without creating or reading a Full store", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "cchistory-lite-no-store-"));
  try {
    const resolved = await resolveLiteSources({
      homeDir: tempHome,
      sourceRoots: [
        { sourceRef: "codex", baseDir: path.join(mockDataRoot, ".codex", "sessions") },
      ],
    });
    assert.deepEqual(resolved.map((source) => source.platform), ["codex"]);

    const snapshot = await scanLiteHistory({
      homeDir: tempHome,
      safeMode: true,
      sourceRoots: [
        { sourceRef: "codex", baseDir: path.join(mockDataRoot, ".codex", "sessions") },
      ],
    });
    assert.ok(snapshot.listResolvedTurns().length > 0);
    await assert.rejects(access(path.join(tempHome, ".cchistory")));

    await assert.rejects(
      scanLiteHistory({
        homeDir: tempHome,
        sourceRoots: [{ sourceRef: "codex", baseDir: path.join(tempHome, ".cchistory") }],
      }),
      /Full store paths are not Lite sources/,
    );

    const fullStoreRoot = path.join(tempHome, "full-store");
    await mkdir(fullStoreRoot);
    await writeFile(path.join(fullStoreRoot, "cchistory.sqlite"), "not opened by Lite");
    await assert.rejects(assertLiteSourceRoot(fullStoreRoot), /Full store paths are not Lite sources/);

    // Case variants resolve to the Full store on case-insensitive filesystems
    // (macOS/Windows), so the guard rejects them everywhere.
    const caseVariantStoreRoot = path.join(tempHome, ".CCHistory");
    await mkdir(caseVariantStoreRoot);
    await assert.rejects(assertLiteSourceRoot(caseVariantStoreRoot), /Full store paths are not Lite sources/);
    const caseVariantStoreFile = path.join(tempHome, "CCHistory.sqlite");
    await writeFile(caseVariantStoreFile, "not opened by Lite");
    await assert.rejects(assertLiteSourceRoot(caseVariantStoreFile), /Full store paths are not Lite sources/);

    const fullBundleRoot = path.join(tempHome, "full-bundle");
    await mkdir(path.join(fullBundleRoot, "payloads"), { recursive: true });
    await writeFile(path.join(fullBundleRoot, "manifest.json"), "{}");
    await assert.rejects(assertLiteSourceRoot(fullBundleRoot), /Full bundle paths are not Lite sources/);

    const canonicalFullRoot = path.join(tempHome, ".cchistory");
    await mkdir(canonicalFullRoot);
    await writeFile(path.join(canonicalFullRoot, "cchistory.sqlite"), "not opened by Lite");
    await assert.rejects(
      assertLiteSourceRoot(tempHome, { homeDir: tempHome }),
      /overlapping the Full store are not allowed in Lite/,
    );
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test("Lite context-light Codex scanning preserves canonical turns while releasing contexts", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "cchistory-lite-codex-stream-"));
  try {
    const sourceRoots = [
      { sourceRef: "codex", baseDir: path.join(mockDataRoot, fixtureRoots.codex) },
    ];
    const sources = await resolveLiteSources({
      homeDir: tempHome,
      hostname: "cchistory-lite-codex-stream-host",
      sourceRefs: ["codex"],
      sourceRoots,
    });
    const expectedProbe = await runSourceProbe({ safe_mode: true }, sources);
    const expected = buildLiveSnapshot(expectedProbe);
    const actual = await scanLiteHistory({
      homeDir: tempHome,
      hostname: "cchistory-lite-codex-stream-host",
      sourceRefs: ["codex"],
      sourceRoots,
      safeMode: true,
      contextMode: "none",
    });

    assert.deepEqual(actual.listResolvedSessions(), expected.listResolvedSessions());
    assert.deepEqual(actual.listResolvedTurns(), expected.listResolvedTurns());
    assert.deepEqual(normalizeProjects(actual.listProjects()), normalizeProjects(expected.listProjects()));
    assert.deepEqual(actual.listAskUserQuestionTurns(), expected.listAskUserQuestionTurns());
    assert.deepEqual(
      actual.listSources().map(withoutRunTimestamp),
      expected.listSources().map(withoutRunTimestamp),
    );
    assert.equal(actual.data.contexts.length, 0);
    assert.ok(expected.data.contexts.length > 0);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test("Lite context-light Claude scanning assembles parent and subagent files before projection", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "cchistory-lite-claude-stream-"));
  try {
    const sourceRoots = [
      { sourceRef: "claude_code", baseDir: path.join(mockDataRoot, fixtureRoots.claude_code) },
    ];
    const sources = await resolveLiteSources({
      homeDir: tempHome,
      hostname: "cchistory-lite-claude-stream-host",
      sourceRefs: ["claude_code"],
      sourceRoots,
    });
    const expectedProbe = await runSourceProbe({ safe_mode: true }, sources);
    const expected = buildLiveSnapshot(expectedProbe);
    const actual = await scanLiteHistory({
      homeDir: tempHome,
      hostname: "cchistory-lite-claude-stream-host",
      sourceRefs: ["claude_code"],
      sourceRoots,
      safeMode: true,
      contextMode: "none",
    });

    assert.deepEqual(actual.listResolvedSessions(), expected.listResolvedSessions());
    assert.deepEqual(actual.listResolvedTurns(), expected.listResolvedTurns());
    assert.deepEqual(normalizeProjects(actual.listProjects()), normalizeProjects(expected.listProjects()));
    assert.deepEqual(actual.listAskUserQuestionTurns(), expected.listAskUserQuestionTurns());
    assert.deepEqual(
      actual.listSources().map(withoutRunTimestamp),
      expected.listSources().map(withoutRunTimestamp),
    );
    assert.equal(actual.data.contexts.length, 0);
    assert.ok(expected.data.contexts.length > 0);
    assert.ok(actual.listResolvedSessions().some((session) => session.source_session_id === "cc1df109-4282-4321-8248-8bbcd471da78"));
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test("Lite groups Claude files by content session id across different project paths", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "cchistory-lite-claude-cross-path-"));
  const claudeRoot = path.join(tempHome, "claude-projects");
  try {
    const sharedSessionId = "shared-claude-session";
    const firstDir = path.join(claudeRoot, "project-a");
    const secondDir = path.join(claudeRoot, "project-b");
    await mkdir(firstDir, { recursive: true });
    await mkdir(secondDir, { recursive: true });
    await writeFile(
      path.join(firstDir, "first-file.jsonl"),
      [
        JSON.stringify({
          type: "user",
          sessionId: sharedSessionId,
          cwd: "/workspace/shared",
          timestamp: "2026-07-01T00:00:00.000Z",
          message: { role: "user", content: "First cross-path question" },
        }),
        JSON.stringify({
          type: "assistant",
          sessionId: sharedSessionId,
          cwd: "/workspace/shared",
          timestamp: "2026-07-01T00:00:01.000Z",
          message: { role: "assistant", content: [{ type: "text", text: "First answer" }] },
        }),
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(secondDir, "second-file.jsonl"),
      [
        JSON.stringify({
          type: "user",
          sessionId: sharedSessionId,
          cwd: "/workspace/shared",
          timestamp: "2026-07-01T00:01:00.000Z",
          message: { role: "user", content: "Second cross-path question" },
        }),
        JSON.stringify({
          type: "assistant",
          sessionId: sharedSessionId,
          cwd: "/workspace/shared",
          timestamp: "2026-07-01T00:01:01.000Z",
          message: { role: "assistant", content: [{ type: "text", text: "Second answer" }] },
        }),
      ].join("\n"),
      "utf8",
    );

    const sourceRoots = [{ sourceRef: "claude_code", baseDir: claudeRoot }];
    const sources = await resolveLiteSources({
      homeDir: tempHome,
      hostname: "cchistory-lite-claude-cross-path-host",
      sourceRefs: ["claude_code"],
      sourceRoots,
    });
    const expected = buildLiveSnapshot(await runSourceProbe({ safe_mode: true }, sources));
    let sourceStarts = 0;
    const actual = await scanLiteHistory({
      homeDir: tempHome,
      hostname: "cchistory-lite-claude-cross-path-host",
      sourceRefs: ["claude_code"],
      sourceRoots,
      safeMode: true,
      contextMode: "none",
      onProgress: (event) => {
        if (event.stage === "source_start") sourceStarts += 1;
      },
    });

    assert.equal(sourceStarts, 1);
    assert.equal(actual.listResolvedSessions().length, 1);
    assert.deepEqual(actual.listResolvedSessions(), expected.listResolvedSessions());
    assert.deepEqual(actual.listResolvedTurns(), expected.listResolvedTurns());
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test("Lite rejects ancestors and descendants of a symlink-relocated Full store", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "cchistory-lite-symlink-home-"));
  const relocatedParent = await mkdtemp(path.join(os.tmpdir(), "cchistory-lite-relocated-store-"));
  try {
    const fullStoreRoot = path.join(relocatedParent, "full-store");
    const fullStoreChild = path.join(fullStoreRoot, "source-shaped-child");
    await mkdir(fullStoreChild, { recursive: true });
    await writeFile(path.join(fullStoreRoot, "cchistory.sqlite"), "not opened by Lite");
    await symlink(fullStoreRoot, path.join(tempHome, ".cchistory"), "dir");

    for (const sourceRoot of [tempHome, relocatedParent, fullStoreChild]) {
      await assert.rejects(
        assertLiteSourceRoot(sourceRoot, { homeDir: tempHome }),
        /overlapping the Full store are not allowed in Lite/,
      );
    }
  } finally {
    await rm(tempHome, { recursive: true, force: true });
    await rm(relocatedParent, { recursive: true, force: true });
  }
});

test("Lite exposes the shared project visibility and display order", () => {
  const projects = [
    createProject("empty", 0, 3),
    createProject("small", 1, 1),
    createProject("large", 5, 2),
  ];
  const snapshot = new LiveHistorySnapshot({
    host: {
      id: "host-lite-project-list",
      hostname: "lite-project-list",
      first_seen: "2026-01-01T00:00:00.000Z",
      last_seen: "2026-01-01T00:00:00.000Z",
    },
    sources: [],
    projects,
    sessions: [],
    turns: [],
    contexts: [],
    ask_user_question_turns: [],
    loss_audits: [],
  });

  assert.deepEqual(
    snapshot.listProjects().map((project) => project.project_id),
    ["project-large", "project-small"],
  );
  assert.equal(snapshot.getProject("project-empty")?.project_id, "project-empty");
});

test("explicit roots replace one adapter without adding the missing adapter roster", async () => {
  const codexRoot = path.join(mockDataRoot, fixtureRoots.codex);
  const resolved = await resolveLiteSources({
    homeDir: mockDataRoot,
    hostname: "cchistory-lite-roster-host",
    sourceRoots: [{ sourceRef: "codex", baseDir: codexRoot }],
  });
  const platforms = resolved.map((source) => source.platform);
  assert.ok(platforms.includes("codex"));
  assert.ok(platforms.includes("claude_code"));
  assert.equal(platforms.includes("lobechat"), false);
  assert.equal(platforms.includes("zcode"), false);
  assert.equal(platforms.includes("accio"), false);
  assert.equal(resolved.find((source) => source.platform === "codex")?.base_dir, codexRoot);
});

test("Lite opens upstream native SQLite fixture data read-only", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "cchistory-lite-native-sqlite-"));
  const cursorRoot = path.join(mockDataRoot, fixtureRoots.cursor);
  const cursorDb = path.join(cursorRoot, "7ff8eb6283576301c3822ea828f4a8f4", "975b36d6-f001-4ce9-b64f-5ccd19e111a6", "store.db");
  const walPath = `${cursorDb}-wal`;
  const shmPath = `${cursorDb}-shm`;
  const before = await stat(cursorDb);
  await assert.rejects(access(walPath));
  await assert.rejects(access(shmPath));
  try {
    const snapshot = await scanLiteHistory({
      homeDir: tempHome,
      hostname: "cchistory-lite-native-sqlite-host",
      sourceRefs: ["cursor"],
      sourceRoots: [{ sourceRef: "cursor", baseDir: cursorRoot }],
      safeMode: true,
    });
    assert.ok(snapshot.listResolvedTurns().length > 0);
    const after = await stat(cursorDb);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
    await assert.rejects(access(walPath));
    await assert.rejects(access(shmPath));
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test("Lite and Full agree on a synthetic Kimi source through the shared probe pipeline", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-lite-kimi-parity-"));
  try {
    const kimiRoot = path.join(tempRoot, ".kimi-code");
    const sessionId = "session_lite-parity";
    const sessionDir = path.join(kimiRoot, "sessions", "wd_lite-parity", sessionId);
    const mainAgentDir = path.join(sessionDir, "agents", "main");
    await mkdir(mainAgentDir, { recursive: true });

    const wireLines = [
      { type: "metadata", protocol_version: "1", created_at: 1_773_000_000_000 },
      { type: "config.update", modelAlias: "kimi-code/k3", time: 1_773_000_000_100 },
      {
        type: "turn.prompt",
        input: [{ type: "text", text: "Review the Kimi parity boundary." }],
        origin: { kind: "user" },
        time: 1_773_000_001_000,
      },
      {
        type: "context.append_loop_event",
        event: { type: "content.part", uuid: "text-1", part: { type: "text", text: "The shared pipeline answered." } },
        time: 1_773_000_002_000,
      },
      {
        type: "usage.record",
        model: "kimi-code/k3",
        usageScope: "turn",
        usage: { inputOther: 100, inputCacheRead: 20, inputCacheCreation: 5, output: 30 },
        time: 1_773_000_003_000,
      },
      {
        type: "turn.prompt",
        input: [{ type: "text", text: "Now confirm the Lite parity coverage." }],
        origin: { kind: "user" },
        time: 1_773_000_004_000,
      },
      {
        type: "context.append_loop_event",
        event: { type: "content.part", uuid: "text-2", part: { type: "text", text: "Parity coverage confirmed." } },
        time: 1_773_000_005_000,
      },
    ];
    await writeFile(
      path.join(mainAgentDir, "wire.jsonl"),
      wireLines.map((line) => JSON.stringify(line)).join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(sessionDir, "state.json"),
      JSON.stringify({
        createdAt: "2026-03-09T06:00:00.000Z",
        updatedAt: "2026-03-09T06:10:00.000Z",
        title: "Kimi Lite parity",
        workDir: "/workspace/kimi-lite-parity",
        lastPrompt: "Now confirm the Lite parity coverage.",
        agents: { main: { type: "main", parentAgentId: null, homedir: "/tmp/main" } },
        custom: {},
      }),
      "utf8",
    );
    await writeFile(
      path.join(kimiRoot, "session_index.jsonl"),
      JSON.stringify({ sessionId, sessionDir, workDir: "/workspace/kimi-lite-parity" }),
      "utf8",
    );
    await writeFile(path.join(kimiRoot, "workspaces.json"), JSON.stringify({}), "utf8");

    // End-to-end Lite: discovery, source-root guard, probe, and snapshot.
    const lite = await scanLiteHistory({
      homeDir: tempRoot,
      hostname: "cchistory-lite-kimi-parity-host",
      sourceRefs: ["kimi"],
      sourceRoots: [{ sourceRef: "kimi", baseDir: kimiRoot }],
      safeMode: true,
    });
    assert.deepEqual(lite.listSources().map((source) => source.platform), ["kimi"]);
    assert.equal(lite.listResolvedSessions().length, 1);
    assert.equal(lite.listResolvedSessions()[0]?.source_session_id, sessionId);
    assert.equal(lite.listResolvedTurns().length, 2);
    await assert.rejects(access(path.join(tempRoot, ".cchistory")));

    // Full/Lite materialization parity from one shared probe payload.
    const sources = await resolveLiteSources({
      homeDir: tempRoot,
      hostname: "cchistory-lite-kimi-parity-host",
      sourceRefs: ["kimi"],
      sourceRoots: [{ sourceRef: "kimi", baseDir: kimiRoot }],
    });
    const probe = await runSourceProbe({ safe_mode: true }, sources);
    const liteFromProbe = buildLiveSnapshot(probe);
    const full = new CCHistoryStorage(path.join(tempRoot, "full.sqlite"));
    try {
      for (const payload of probe.sources) {
        full.replaceSourcePayload(payload, { allow_host_rekey: true });
      }
      assert.deepEqual(liteFromProbe.listResolvedSessions(), jsonNormalize(full.listResolvedSessions()));
      assert.deepEqual(liteFromProbe.listResolvedTurns(), jsonNormalize(full.listResolvedTurns()));
      for (const turn of liteFromProbe.listResolvedTurns()) {
        assert.deepEqual(
          jsonNormalize(liteFromProbe.getTurnContext(turn.id)),
          jsonNormalize(full.getTurnContext(turn.id)),
        );
      }
      const liteSearch = liteFromProbe.search({ query: "parity", limit: 100 });
      const fullSearch = full.searchTurnsPaginated({ query: "parity", limit: 100 });
      assert.equal(liteSearch.total, 2);
      assert.equal(liteSearch.total, fullSearch.total);
      assert.deepEqual(
        liteSearch.results.map((result) => result.turn.id),
        fullSearch.results.map((result) => result.turn.id),
      );
      assert.deepEqual(
        withoutGeneratedAt(liteFromProbe.getUsageOverview()),
        withoutGeneratedAt(full.getUsageOverview()),
      );
    } finally {
      full.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("LiveHistorySnapshot treats blank lookup refs as not found instead of matching everything", () => {
  const host = {
    id: "host-blank-ref",
    hostname: "blank-ref",
    first_seen: "2026-01-01T00:00:00.000Z",
    last_seen: "2026-01-01T00:00:00.000Z",
  };
  const session: SessionProjection = {
    id: "session-blank-ref",
    source_id: "source-blank-ref",
    source_platform: "codex",
    host_id: host.id,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    turn_count: 1,
    sync_axis: "current",
  };
  const snapshot = new LiveHistorySnapshot({
    host,
    sources: [],
    projects: [],
    sessions: [session],
    turns: [createBlankRefTurn(session)],
    contexts: [],
    ask_user_question_turns: [],
    loss_audits: [],
  });

  assert.equal(snapshot.getSession(""), undefined);
  assert.equal(snapshot.getSession("   "), undefined);
  assert.equal(snapshot.getTurn(""), undefined);
  assert.equal(snapshot.getTurn("  "), undefined);
  assert.equal(snapshot.getSource(""), undefined);
  assert.equal(snapshot.getProject(""), undefined);
  assert.equal(snapshot.getSession("session-blank-ref")?.id, "session-blank-ref");
});

function createBlankRefTurn(session: SessionProjection): UserTurnProjection {
  return {
    id: "turn-blank-ref",
    revision_id: "turn-blank-ref:r1",
    turn_id: "turn-blank-ref",
    turn_revision_id: "turn-blank-ref:r1",
    user_messages: [
      {
        id: "message-blank-ref",
        raw_text: "Blank ref fixture",
        canonical_text: "Blank ref fixture",
        display_segments: [{ type: "text", content: "Blank ref fixture" }],
        sequence: 0,
        is_injected: false,
        created_at: "2026-01-01T00:00:00.000Z",
        atom_refs: ["atom-blank-ref"],
      },
    ],
    raw_text: "Blank ref fixture",
    canonical_text: "Blank ref fixture",
    display_segments: [{ type: "text", content: "Blank ref fixture" }],
    created_at: "2026-01-01T00:00:00.000Z",
    submission_started_at: "2026-01-01T00:00:00.000Z",
    last_context_activity_at: "2026-01-01T00:01:00.000Z",
    session_id: session.id,
    source_id: session.source_id,
    link_state: "unlinked",
    sync_axis: "current",
    value_axis: "active",
    retention_axis: "keep_raw_and_derived",
    context_ref: "context-blank-ref",
    context_summary: {
      assistant_reply_count: 1,
      tool_call_count: 0,
      token_usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      total_tokens: 2,
      primary_model: "gpt-5",
      has_errors: false,
    },
    lineage: {
      atom_refs: ["atom-blank-ref"],
      candidate_refs: [],
      fragment_refs: [],
      record_refs: [],
      blob_refs: [],
    },
  };
}

function sortById<T extends { id: string }>(values: T[]): T[] {
  return jsonNormalize(values).sort((left, right) => left.id.localeCompare(right.id));
}

function createProject(name: string, turns: number, sessions: number): ProjectIdentity {
  return {
    project_id: `project-${name}`,
    project_revision_id: `project-${name}:r1`,
    display_name: name,
    slug: name,
    linkage_state: "committed",
    confidence: 1,
    link_reason: "manual_override",
    manual_override_status: "applied",
    source_platforms: ["codex"],
    host_ids: ["host-lite-project-list"],
    committed_turn_count: turns,
    candidate_turn_count: 0,
    session_count: sessions,
    project_last_activity_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function normalizeProjects(values: ReturnType<InstanceType<typeof CCHistoryStorage>["listProjects"]>) {
  return jsonNormalize(values)
    .map(({ project_revision_id: _revisionId, created_at: _createdAt, ...project }) => project)
    .sort((left, right) => left.project_id.localeCompare(right.project_id));
}

function withoutGeneratedAt<T extends { generated_at: string }>(value: T): Omit<T, "generated_at"> {
  const normalized = jsonNormalize(value);
  const { generated_at: _generatedAt, ...rest } = normalized;
  return rest;
}

function withoutRunTimestamp<T extends { last_sync?: string | null }>(value: T): Omit<T, "last_sync"> {
  const { last_sync: _lastSync, ...rest } = value;
  return rest;
}

function jsonNormalize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
