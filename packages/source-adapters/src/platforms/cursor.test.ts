import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { getDefaultSourcesForHost, runSourceProbe } from "../index.js";
import { 
  seedCursorStyleStateDb, 
  seedCursorPromptHistoryDb, 
  createSourceDefinition,
  getRepoMockDataRoot 
} from "../test-helpers.js";

test("getDefaultSourcesForHost prefers official macOS Cursor and Antigravity user-data roots", () => {
  const homeDir = "/Users/tester";
  const sources = getDefaultSourcesForHost({
    homeDir,
    platform: "darwin",
    pathExists(targetPath) {
      return (
        targetPath === path.join(homeDir, "Library", "Application Support", "Cursor", "User") ||
        targetPath === path.join(homeDir, "Library", "Application Support", "Antigravity", "User")
      );
    },
  });

  const cursorSource = sources.find((source) => source.platform === "cursor");
  const antigravitySource = sources.find((source) => source.platform === "antigravity");

  assert.equal(cursorSource?.base_dir, path.join(homeDir, "Library", "Application Support", "Cursor", "User"));
  assert.equal(
    antigravitySource?.base_dir,
    path.join(homeDir, "Library", "Application Support", "Antigravity", "User"),
  );
  assert.equal(sources.some((source) => source.platform === "opencode"), false);
});

test("getDefaultSourcesForHost prefers official Windows Cursor and Antigravity user-data roots", () => {
  const homeDir = "C:/Users/tester";
  const appDataDir = "C:/Users/tester/AppData/Roaming";
  const sources = getDefaultSourcesForHost({
    homeDir,
    appDataDir,
    platform: "win32",
    pathExists(targetPath) {
      return (
        targetPath === path.join(appDataDir, "Cursor", "User") ||
        targetPath === path.join(appDataDir, "Antigravity", "User")
      );
    },
  });

  const cursorSource = sources.find((source) => source.platform === "cursor");
  const antigravitySource = sources.find((source) => source.platform === "antigravity");

  assert.equal(cursorSource?.base_dir, path.join(appDataDir, "Cursor", "User"));
  assert.equal(antigravitySource?.base_dir, path.join(appDataDir, "Antigravity", "User"));
});

test("getDefaultSourcesForHost keeps Cursor project transcripts but prefers official Antigravity user roots over brain artifacts", () => {
  const homeDir = "/Users/tester";
  const sources = getDefaultSourcesForHost({
    homeDir,
    platform: "darwin",
    pathExists(targetPath) {
      return (
        targetPath === path.join(homeDir, ".cursor", "projects") ||
        targetPath === path.join(homeDir, ".gemini", "antigravity", "brain") ||
        targetPath === path.join(homeDir, "Library", "Application Support", "Antigravity", "User")
      );
    },
  });

  const cursorSource = sources.find((source) => source.platform === "cursor");
  const antigravitySource = sources.find((source) => source.platform === "antigravity");

  assert.equal(cursorSource?.base_dir, path.join(homeDir, ".cursor", "projects"));
  assert.equal(
    antigravitySource?.base_dir,
    path.join(homeDir, "Library", "Application Support", "Antigravity", "User"),
  );
});

test("runSourceProbe ingests Cursor agent transcripts from project history roots", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const sessionId = "cursor-transcript-session";
    const transcriptDir = path.join(tempRoot, ".cursor", "projects", "workspace-a", "agent-transcripts", sessionId);
    await mkdir(transcriptDir, { recursive: true });
    await writeFile(
      path.join(transcriptDir, `${sessionId}.jsonl`),
      [
        {
          role: "user",
          title: "Cursor transcript fixture",
          content: "Investigate Cursor transcript ingestion.",
        },
        {
          role: "assistant",
          updatedAt: "2026-03-10T08:00:01.000Z",
          usage: {
            inputTokens: 6,
            outputTokens: 4,
            totalTokens: 10,
          },
          stopReason: "end_turn",
          content: "Cursor transcript ingestion is working.",
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf8",
    );

    const [payload] = (
      await runSourceProbe(
        {},
        [createSourceDefinition("src-cursor-transcript", "cursor", path.join(tempRoot, ".cursor", "projects"))],
      )
    ).sources;

    assert.ok(payload);
    assert.equal(payload.source.sync_status, "healthy");
    assert.equal(payload.sessions.length, 1);
    assert.equal(payload.turns.length, 1);
    assert.equal(payload.contexts.length, 1);
    assert.match(payload.turns[0]?.canonical_text ?? "", /Cursor transcript ingestion/);
    const projectObservation = payload.candidates.find((candidate) => candidate.candidate_kind === "project_observation");
    assert.equal(projectObservation?.evidence.source_native_project_ref, "workspace-a");
    assert.ok(
      payload.atoms.some(
        (atom) => atom.actor_kind === "assistant" && typeof atom.payload.text === "string" && atom.payload.text.includes("is working"),
      ),
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe ingests Cursor chat-store metadata and minimal readable fragments as an experimental slice", async () => {
  const mockDataRoot = getRepoMockDataRoot();
  const source = createSourceDefinition("src-cursor-chat-store", "cursor", path.join(mockDataRoot, ".cursor", "chats"));

  const [payload] = (await runSourceProbe({ source_ids: [source.id] }, [source])).sources;

  assert.ok(payload);
  assert.equal(payload.source.sync_status, "healthy");
  assert.equal(payload.sessions.length, 3);
  assert.equal(payload.turns.length, 3);
  assert.equal(payload.contexts.length, 3);
  assert.equal(payload.sessions.every((session) => session.working_directory === undefined), true);
  assert.equal(payload.sessions.some((session) => session.title === "MCP Service Guide"), true);
  assert.equal(payload.sessions.some((session) => session.title === "Custom API Settings"), true);
  assert.equal(payload.sessions.some((session) => session.title === "Requirement Review"), true);
  assert.equal(payload.turns.some((turn) => turn.canonical_text.includes("Research stable MCP servers")), true);
  assert.equal(payload.turns.some((turn) => turn.canonical_text.includes("Design a simple API settings panel")), true);
  assert.equal(payload.turns.some((turn) => turn.canonical_text.includes("Read @requirement.md")), true);
  assert.ok(
    payload.contexts.some((context) =>
      context.assistant_replies.some((reply) => reply.content.includes("Prefer filesystem, fetch, and GitHub examples")),
    ),
  );
  assert.ok(
    payload.loss_audits.some((audit) => audit.diagnostic_code === "cursor_chat_store_blob_graph_opaque"),
  );
});

test("runSourceProbe falls back to Cursor prompt history with workspace-linked synthetic sessions", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const cursorUserDir = path.join(tempRoot, "Cursor", "User");
    const workspaceDir = path.join(cursorUserDir, "workspaceStorage", "cursor-prompt-history");
    await mkdir(workspaceDir, { recursive: true });

    seedCursorPromptHistoryDb(path.join(workspaceDir, "state.vscdb"), {
      title: "Cursor prompt history",
      prompt: "Inspect the Cursor prompt fallback.",
      observedAt: "2026-03-10T10:00:00.000Z",
    });
    await writeFile(
      path.join(workspaceDir, "workspace.json"),
      JSON.stringify({ folder: "/workspace/cursor-prompt-history" }),
      "utf8",
    );

    const [payload] = (
      await runSourceProbe(
        { limit_files_per_source: 1 },
        [createSourceDefinition("src-cursor-prompt-history", "cursor", cursorUserDir)],
      )
    ).sources;

    assert.ok(payload);
    assert.equal(payload.source.sync_status, "healthy");
    assert.equal(payload.sessions.length, 1);
    assert.equal(payload.turns.length, 1);
    assert.equal(payload.contexts.length, 1);
    assert.equal(payload.sessions[0]?.working_directory, "/workspace/cursor-prompt-history");
    assert.equal(payload.turns[0]?.session_id, payload.sessions[0]?.id);
    assert.equal(payload.turns[0]?.canonical_text, "Inspect the Cursor prompt fallback.");
    assert.equal(payload.contexts[0]?.assistant_replies.length, 0);
    assert.ok(payload.candidates.some((candidate) => candidate.candidate_kind === "project_observation"));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe skips unreadable Cursor global state DBs and still ingests workspaceStorage", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const cursorUserDir = path.join(tempRoot, "Cursor", "User");
    const workspaceDir = path.join(cursorUserDir, "workspaceStorage", "cursor-workspace");
    const globalDir = path.join(cursorUserDir, "globalStorage");
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(globalDir, { recursive: true });

    seedCursorStyleStateDb(path.join(workspaceDir, "state.vscdb"), {
      workspacePath: "/workspace/cursor-priority",
      composerId: "cursor-priority",
      title: "Cursor priority fixture",
      storageMode: "composerData",
    });
    await writeFile(path.join(workspaceDir, "workspace.json"), JSON.stringify({ folder: "/workspace/cursor-priority" }), "utf8");
    await writeFile(path.join(globalDir, "state.vscdb"), "not-a-sqlite-database", "utf8");

    const [payload] = (
      await runSourceProbe(
        { limit_files_per_source: 2 },
        [createSourceDefinition("src-cursor-priority", "cursor", cursorUserDir)],
      )
    ).sources;

    assert.ok(payload);
    assert.equal(payload.source.sync_status, "healthy");
    assert.equal(payload.sessions.length, 1);
    assert.equal(payload.turns.length, 1);
    assert.equal(payload.sessions[0]?.working_directory, "/workspace/cursor-priority");
    assert.ok(
      payload.blobs.some((blob) => blob.origin_path === path.join(globalDir, "state.vscdb")),
      "expected unreadable globalStorage DB to remain visible as a captured blob",
    );
    assert.ok(
      payload.loss_audits.some(
        (audit) =>
          audit.detail.includes("Failed to process captured source file") &&
          audit.stage_kind === "extract_records",
      ),
      "expected unreadable DB to produce a loss audit instead of aborting the source probe",
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe prioritizes Cursor workspaceStorage before globalStorage when file limits apply", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const cursorUserDir = path.join(tempRoot, "Cursor", "User");
    const workspaceDir = path.join(cursorUserDir, "workspaceStorage", "cursor-workspace");
    const globalDir = path.join(cursorUserDir, "globalStorage");
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(globalDir, { recursive: true });

    seedCursorStyleStateDb(path.join(workspaceDir, "state.vscdb"), {
      workspacePath: "/workspace/cursor-limited",
      composerId: "cursor-limited",
      title: "Cursor limited fixture",
      storageMode: "composerData",
    });
    await writeFile(path.join(workspaceDir, "workspace.json"), JSON.stringify({ folder: "/workspace/cursor-limited" }), "utf8");
    await writeFile(path.join(globalDir, "state.vscdb"), "not-a-sqlite-database", "utf8");

    const [payload] = (
      await runSourceProbe(
        { limit_files_per_source: 1 },
        [createSourceDefinition("src-cursor-limited", "cursor", cursorUserDir)],
      )
    ).sources;

    assert.ok(payload);
    assert.equal(payload.source.sync_status, "healthy");
    assert.equal(payload.sessions.length, 1);
    assert.equal(payload.turns.length, 1);
    assert.equal(payload.blobs.length, 1);
    assert.equal(payload.blobs[0]?.origin_path, path.join(workspaceDir, "state.vscdb"));
    assert.equal(payload.sessions[0]?.working_directory, "/workspace/cursor-limited");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

