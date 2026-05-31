import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runSourceProbe } from "../index.js";
import { 
  getRepoMockDataRoot, 
  createSourceDefinition, 
  seedSupportedSourceFixtures,
  seedClaudeInterruptedFixture
} from "../test-helpers.js";

test("runSourceProbe keeps Claude interruption markers as source metadata instead of turns", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const source = await seedClaudeInterruptedFixture(tempRoot);
    const [payload] = (await runSourceProbe({ limit_files_per_source: 1 }, [source])).sources;

    assert.ok(payload);
    assert.equal(payload.source.platform, "claude_code");
    assert.equal(payload.turns.length, 1);
    assert.equal(payload.contexts.length, 1);
    assert.equal(payload.turns[0]?.canonical_text, "Ship the fix.");
    assert.ok(
      payload.atoms.some(
        (atom) =>
          atom.origin_kind === "source_meta" &&
          atom.content_kind === "text" &&
          atom.payload.text === "[Request interrupted by user]",
      ),
    );
    assert.ok(
      payload.loss_audits.some((audit) =>
        audit.detail.includes("Claude interruption marker preserved as source meta"),
      ),
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("[claude] sidechain subagent fixtures stay as delegated evidence instead of canonical turns", async () => {
  const mockDataRoot = getRepoMockDataRoot();
  const baseDir = path.join(
    mockDataRoot,
    ".claude",
    "projects",
    "-Users-mock-user-workspace-chat-ui-kit",
    "cc1df109-4282-4321-8248-8bbcd471da78",
    "subagents",
  );
  const source = createSourceDefinition("src-claude-subagent-mock-data", "claude_code", baseDir);

  const result = await runSourceProbe({ source_ids: [source.id] }, [source]);
  const payload = result.sources[0];
  assert.ok(payload);
  assert.equal(payload.source.sync_status, "healthy");
  assert.equal(payload.sessions.length, 1);
  assert.equal(payload.turns.length, 0);
  assert.equal(payload.contexts.length, 0);
  assert.equal(payload.sessions[0]?.turn_count, 0);
  assert.equal(payload.sessions[0]?.resume_command, undefined);
  assert.ok(payload.fragments.some((fragment) => fragment.fragment_kind === "session_relation"));
  assert.ok(
    payload.atoms.some(
      (atom) =>
        atom.origin_kind === "delegated_instruction" &&
        String(atom.payload.text ?? "").includes("Search the codebase for all timeout"),
    ),
  );
  assert.equal(payload.candidates.some((candidate) => candidate.candidate_kind === "turn"), false);
});

test("[claude] preserves source session UUID and resume command provenance", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-claude-resume-"));

  try {
    const claudeDir = path.join(tempRoot, ".claude", "projects", "-workspace-claude-resume");
    await mkdir(claudeDir, { recursive: true });
    const sourceSessionId = "9d77cfc2-1e2e-4fcb-a0f5-0013bd8cf101";

    await writeFile(
      path.join(claudeDir, `${sourceSessionId}.jsonl`),
      [
        {
          timestamp: "2026-03-09T01:00:00.000Z",
          type: "user",
          sessionId: sourceSessionId,
          cwd: "/workspace/claude-resume",
          message: { role: "user", content: [{ type: "text", text: "Recover Claude resume command." }] },
        },
        {
          timestamp: "2026-03-09T01:00:01.000Z",
          type: "assistant",
          sessionId: sourceSessionId,
          cwd: "/workspace/claude-resume",
          message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf8",
    );

    const source = createSourceDefinition("src-claude-resume", "claude_code", claudeDir);
    const result = await runSourceProbe({ source_ids: [source.id] }, [source]);
    const payload = result.sources[0];
    const session = payload?.sessions[0];

    assert.ok(session);
    assert.equal(session.id, `sess:claude_code:${sourceSessionId}`);
    assert.equal(session.source_session_id, sourceSessionId);
    assert.equal(session.resume_working_directory, "/workspace/claude-resume");
    assert.equal(session.resume_command, `cd /workspace/claude-resume && claude --resume ${sourceSessionId}`);
    assert.equal(session.resume_command_confidence, 1);
    assert.match(payload?.turns[0]?.path_text ?? "", /\/workspace\/claude-resume/u);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("[claude] local command envelopes do not anchor slash-command control noise", async () => {
  const mockDataRoot = getRepoMockDataRoot();
  const baseDir = path.join(
    mockDataRoot,
    ".claude",
    "projects",
    "-Users-mock-user-workspace-chat-ui-kit",
  );
  const source = createSourceDefinition("src-claude-local-command-mock-data", "claude_code", baseDir);

  const result = await runSourceProbe({ source_ids: [source.id] }, [source]);
  const payload = result.sources[0];
  assert.ok(payload);

  const sessionTurns = payload.turns
    .filter((turn) => turn.session_id === "sess:claude_code:b98095d7-b7ee-4d23-9d4c-beb9725d1dc5")
    .sort((left, right) => left.submission_started_at.localeCompare(right.submission_started_at));
  const firstTurn = sessionTurns[0];
  assert.ok(firstTurn);
  assert.match(firstTurn.canonical_text, /Audit local-command wrapper handling/u);
  assert.doesNotMatch(firstTurn.canonical_text, /\/clear|<command-/u);
  assert.ok(
    firstTurn.user_messages.some(
      (message) => message.is_injected && message.raw_text.includes("<command-name>/clear</command-name>"),
    ),
  );
  assert.ok(
    firstTurn.user_messages.some(
      (message) => !message.is_injected && message.raw_text === "Audit local-command wrapper handling.",
    ),
  );
});


test("[claude] synthetic user-shaped messages do not produce user turns", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-claude-synthetic-"));

  try {
    const claudeDir = path.join(tempRoot, "claude-synthetic");
    await mkdir(claudeDir, { recursive: true });

    await writeFile(
      path.join(claudeDir, "conversation.jsonl"),
      [
        // Real user message
        {
          timestamp: "2026-03-09T01:00:00.000Z",
          type: "user",
          sessionId: "synth-test-session",
          cwd: "/workspace",
          message: { role: "user", content: [{ type: "text", text: "Fix the parser bug." }] },
        },
        // Assistant reply
        {
          timestamp: "2026-03-09T01:00:01.000Z",
          type: "assistant",
          sessionId: "synth-test-session",
          cwd: "/workspace",
          message: { role: "assistant", content: [{ type: "text", text: "On it." }] },
        },
        // Synthetic: task-notification (sub-agent callback)
        {
          timestamp: "2026-03-09T01:00:02.000Z",
          type: "user",
          sessionId: "synth-test-session",
          cwd: "/workspace",
          message: {
            role: "user",
            content: [{ type: "text", text: "<task-notification>\n<task-id>abc123</task-id>\n<status>completed</status>\n</task-notification>" }],
          },
        },
        // Assistant reply to synthetic
        {
          timestamp: "2026-03-09T01:00:03.000Z",
          type: "assistant",
          sessionId: "synth-test-session",
          cwd: "/workspace",
          message: { role: "assistant", content: [{ type: "text", text: "Sub-agent done." }] },
        },
        // Synthetic: continuation summary after compact
        {
          timestamp: "2026-03-09T01:00:04.000Z",
          type: "user",
          sessionId: "synth-test-session",
          cwd: "/workspace",
          message: {
            role: "user",
            content: [{
              type: "text",
              text: "This session is being continued from a previous conversation that ran out of context. Summary: we were fixing a bug.",
            }],
          },
        },
        // Assistant reply to continuation
        {
          timestamp: "2026-03-09T01:00:05.000Z",
          type: "assistant",
          sessionId: "synth-test-session",
          cwd: "/workspace",
          message: { role: "assistant", content: [{ type: "text", text: "Continuing from summary." }] },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf8",
    );

    const source = createSourceDefinition("src-claude-synthetic", "claude_code", claudeDir);
    const result = await runSourceProbe({ source_ids: [source.id] }, [source]);
    const payload = result.sources[0];

    assert.ok(payload);
    assert.equal(payload.sessions.length, 1);
    // Only the real user message should produce a turn
    assert.equal(payload.turns.length, 1);
    assert.equal(payload.turns[0]?.canonical_text, "Fix the parser bug.");

    // Synthetic atoms should exist but marked as injected_user_shaped
    assert.ok(
      payload.atoms.some(
        (atom) =>
          atom.origin_kind === "injected_user_shaped" &&
          String(atom.payload.text ?? "").includes("<task-notification>"),
      ),
      "task-notification should be injected_user_shaped",
    );
    assert.ok(
      payload.atoms.some(
        (atom) =>
          atom.origin_kind === "injected_user_shaped" &&
          String(atom.payload.text ?? "").startsWith("This session is being continued"),
      ),
      "continuation summary should be injected_user_shaped",
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("[claude] deriveSessionId groups subagent files under parent session", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-claude-session-id-"));

  try {
    const claudeDir = path.join(tempRoot, "claude-session-grouping");
    await mkdir(claudeDir, { recursive: true });

    // Simulate a subagent file that has sessionId in the content
    // but a filename that is NOT the session UUID
    await writeFile(
      path.join(claudeDir, "agent-a4bcc77.jsonl"),
      [
        {
          timestamp: "2026-03-09T01:00:00.000Z",
          type: "user",
          sessionId: "parent-session-uuid",
          cwd: "/workspace",
          message: { role: "user", content: [{ type: "text", text: "Sub-agent task." }] },
        },
        {
          timestamp: "2026-03-09T01:00:01.000Z",
          type: "assistant",
          sessionId: "parent-session-uuid",
          cwd: "/workspace",
          message: { role: "assistant", content: [{ type: "text", text: "Working on it." }] },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf8",
    );

    const source = createSourceDefinition("src-claude-session-grouping", "claude_code", claudeDir);
    const result = await runSourceProbe({ source_ids: [source.id] }, [source]);
    const payload = result.sources[0];

    assert.ok(payload);
    assert.equal(payload.sessions.length, 1);
    // Session ID should use sessionId from content, not filename
    assert.equal(payload.sessions[0]?.id, "sess:claude_code:parent-session-uuid");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("[claude] root history jsonl stays out of default capture when scanning the source root", async () => {
  const mockDataRoot = getRepoMockDataRoot();
  const baseDir = path.join(mockDataRoot, ".claude");
  const source = createSourceDefinition("src-claude-root-mock-data", "claude_code", baseDir);

  const result = await runSourceProbe({ source_ids: [source.id] }, [source]);
  const payload = result.sources[0];
  assert.ok(payload);
  assert.equal(payload.source.sync_status, "healthy");
  assert.equal(payload.blobs.some((blob) => path.basename(blob.origin_path) === "history.jsonl"), false);
  assert.ok(payload.sessions.length >= 2);
  assert.ok(payload.turns.every((turn) => !turn.canonical_text.startsWith("/")));
});
