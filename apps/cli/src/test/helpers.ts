import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { type SourceSyncPayload } from "@cchistory/domain";
import { runCli } from "../main.js";

export async function runBuiltCliCapture(
  argv: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const cliEntry = fileURLToPath(new URL("../index.js", import.meta.url));
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

export async function runCliCapture(argv: string[], cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
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

export async function runCliJson<T>(argv: string[], cwd: string): Promise<T> {
  const result = await runCliCapture([...argv, "--json"], cwd);
  assert.equal(result.exitCode, 0, result.stderr);
  return JSON.parse(result.stdout) as T;
}

export async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function rewriteAtomEdgesAsLegacyTable(dbPath: string): void {
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

export function createLegacySchemaFixturePayload(): SourceSyncPayload {
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
        turn_id: "turn-cli-legacy-search",
        turn_revision_id: "turn-cli-legacy-search:r1",
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

export function getRepoMockDataRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../mock_data");
}

export async function copyTree(source: string, destination: string): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
}

export async function seedCliMockDataHome(tempRoot: string): Promise<void> {
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

export async function seedCliFixtures(
  tempRoot: string,
  options: {
    includeSyntheticClaudeError?: boolean;
  } = {},
): Promise<void> {
  await mkdir(path.join(tempRoot, ".codex", "sessions"), { recursive: true });
  await mkdir(path.join(tempRoot, ".claude", "projects"), { recursive: true });

  await writeCodexSessionFixture(tempRoot, "rollout-codex-session-1.jsonl", {
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

export async function seedCliOpenSourceFixtures(tempRoot: string): Promise<void> {
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

export async function seedCliDiscoveryFixtures(tempRoot: string): Promise<void> {
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

export async function overwriteCodexPrompt(tempRoot: string, prompt: string): Promise<void> {
  await writeCodexSessionFixture(tempRoot, "rollout-codex-session-1.jsonl", {
    sessionId: "codex-session-1",
    cwd: "/workspace/cchistory",
    model: "gpt-5",
    prompt,
    reply: "Prompt updated.",
    startAt: "2026-03-09T00:00:00.000Z",
  });
}

export async function writeCodexSessionFixture(
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

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
