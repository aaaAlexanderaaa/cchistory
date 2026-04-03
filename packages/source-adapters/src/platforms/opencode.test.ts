import assert from "node:assert/strict";
import { mkdir, writeFile, rm, mkdtemp } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { getDefaultSourcesForHost, runSourceProbe } from "../index.js";
import { 
  getRepoMockDataRoot, 
  createSourceDefinition, 
  assertFragmentKinds 
} from "../test-helpers.js";

test("[opencode] sanitized real-layout fixtures preserve part content and ignore companion-only files as transcripts", async () => {
  const mockDataRoot = getRepoMockDataRoot();
  const baseDir = path.join(mockDataRoot, ".local", "share", "opencode", "storage");
  const source = createSourceDefinition("src-opencode-mock-data", "opencode", baseDir);

  const result = await runSourceProbe({ source_ids: [source.id] }, [source]);
  const payload = result.sources[0];
  assert.ok(payload);
  assert.equal(payload.source.sync_status, "healthy");
  assert.deepEqual(
    payload.sessions.map((session) => session.title).sort(),
    ["Plan requirements review for ESQL notes", "Queued implementation checklist"],
  );
  assert.equal(payload.turns.length, 1);
  assert.equal(payload.contexts.length, 1);
  assert.ok(payload.turns[0]?.canonical_text.includes("Review the task requirements"));
  assert.ok(payload.sessions.some((session) => session.working_directory === "/Users/mock_user/workspace/esql-lab"));
  assertFragmentKinds(payload, ["workspace_signal", "title_signal", "text", "tool_call", "tool_result"]);
});

test("[opencode] child session metadata projects delegated-session relation from parent session and agent hints", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const storageRoot = path.join(tempRoot, ".local", "share", "opencode", "storage");
    const sessionId = "ses_child_opencode_relation";
    const sessionDir = path.join(storageRoot, "session", "global");
    const messageDir = path.join(storageRoot, "message", sessionId);
    const userPartDir = path.join(storageRoot, "part", "msg_opencode_relation_user");
    const assistantPartDir = path.join(storageRoot, "part", "msg_opencode_relation_assistant");
    await mkdir(sessionDir, { recursive: true });
    await mkdir(messageDir, { recursive: true });
    await mkdir(userPartDir, { recursive: true });
    await mkdir(assistantPartDir, { recursive: true });

    await writeFile(
      path.join(sessionDir, `${sessionId}.json`),
      JSON.stringify({
        id: sessionId,
        version: "1.0.114",
        projectID: "global",
        directory: "/Users/mock_user/workspace/esql-lab",
        title: "Delegated implementation checklist",
        parentId: "ses_parent_opencode_relation",
        time: { created: 1765000200000, updated: 1765000205000 },
      }),
      "utf8",
    );
    await writeFile(
      path.join(messageDir, "msg_opencode_relation_user.json"),
      JSON.stringify({
        id: "msg_opencode_relation_user",
        sessionID: sessionId,
        role: "user",
        time: { created: 1765000201000 },
        path: { cwd: "/Users/mock_user/workspace/esql-lab", root: "/" },
      }),
      "utf8",
    );
    await writeFile(
      path.join(userPartDir, "prt_opencode_relation_user_text.json"),
      JSON.stringify({
        id: "prt_opencode_relation_user_text",
        sessionID: sessionId,
        messageID: "msg_opencode_relation_user",
        type: "text",
        text: "Review the implementation checklist as a delegated agent.",
      }),
      "utf8",
    );
    await writeFile(
      path.join(messageDir, "msg_opencode_relation_assistant.json"),
      JSON.stringify({
        id: "msg_opencode_relation_assistant",
        sessionID: sessionId,
        role: "assistant",
        agent: "reviewer-agent",
        time: { created: 1765000202000, completed: 1765000203500 },
        modelID: "mock-planner-4.6",
        path: { cwd: "/Users/mock_user/workspace/esql-lab", root: "/" },
        finish: "step-finish",
      }),
      "utf8",
    );
    await writeFile(
      path.join(assistantPartDir, "prt_opencode_relation_assistant_text.json"),
      JSON.stringify({
        id: "prt_opencode_relation_assistant_text",
        sessionID: sessionId,
        messageID: "msg_opencode_relation_assistant",
        type: "text",
        text: "I reviewed the delegated checklist and outlined the next steps.",
      }),
      "utf8",
    );
    await writeFile(
      path.join(assistantPartDir, "prt_opencode_relation_assistant_finish.json"),
      JSON.stringify({
        id: "prt_opencode_relation_assistant_finish",
        sessionID: sessionId,
        messageID: "msg_opencode_relation_assistant",
        type: "step-finish",
        reason: "completed",
        tokens: { input: 10, output: 4 },
      }),
      "utf8",
    );

    const source = createSourceDefinition("src-opencode-relation", "opencode", storageRoot);
    const [payload] = (await runSourceProbe({ source_ids: [source.id] }, [source])).sources;

    assert.ok(payload);
    assert.equal(payload.source.sync_status, "healthy");
    assert.equal(payload.sessions.length, 1);
    assert.ok(payload.turns.length >= 1);
    const relation = payload.fragments.find(
      (fragment) =>
        fragment.fragment_kind === "session_relation" &&
        fragment.session_ref === `sess:opencode:${sessionId}`,
    );
    assert.ok(relation);
    assert.equal(relation?.payload.parent_uuid, "ses_parent_opencode_relation");
    assert.equal(relation?.payload.agent_id, "reviewer-agent");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("getDefaultSourcesForHost prefers the OpenCode storage root and keeps session layouts discoverable", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const storageRoot = path.join(tempRoot, ".local", "share", "opencode", "storage");
    const legacySessionDir = path.join(storageRoot, "session");
    const officialSessionDir = path.join(storageRoot, "session", "global");
    const legacyMessageDir = path.join(storageRoot, "message", "opencode-legacy");
    const officialMessageDir = path.join(storageRoot, "message", "opencode-official");
    const projectDir = path.join(tempRoot, ".local", "share", "opencode", "project");

    await mkdir(legacySessionDir, { recursive: true });
    await mkdir(officialSessionDir, { recursive: true });
    await mkdir(legacyMessageDir, { recursive: true });
    await mkdir(officialMessageDir, { recursive: true });
    await mkdir(projectDir, { recursive: true });

    await writeFile(
      path.join(legacySessionDir, "opencode-legacy.json"),
      JSON.stringify({
        id: "opencode-legacy",
        title: "OpenCode legacy fixture",
        directory: "/workspace/opencode-legacy",
        time: {
          created: 1770000000000,
          updated: 1770000001000,
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(legacyMessageDir, "0001.json"),
      JSON.stringify({
        info: {
          id: "opencode-legacy-user-1",
          role: "user",
          createdAt: "2026-03-10T05:00:01.000Z",
        },
        parts: [{ type: "text", text: "Inspect legacy OpenCode history." }],
      }),
      "utf8",
    );

    await writeFile(
      path.join(officialSessionDir, "opencode-official.json"),
      JSON.stringify({
        id: "opencode-official",
        title: "OpenCode official fixture",
        directory: "/workspace/opencode-official",
        time: {
          created: 1770000100000,
          updated: 1770000102000,
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(officialMessageDir, "0001.json"),
      JSON.stringify({
        id: "opencode-official-user-1",
        sessionID: "opencode-official",
        role: "user",
        time: {
          created: 1770000101000,
        },
        path: {
          cwd: "/workspace/opencode-official",
          root: "/",
        },
      }),
      "utf8",
    );
    await mkdir(path.join(storageRoot, "part", "opencode-official-user-1"), { recursive: true });
    await writeFile(
      path.join(storageRoot, "part", "opencode-official-user-1", "0001.json"),
      JSON.stringify({
        id: "opencode-official-user-1-part-1",
        sessionID: "opencode-official",
        messageID: "opencode-official-user-1",
        type: "text",
        text: "Inspect official OpenCode history.",
      }),
      "utf8",
    );

    const opencodeSource = getDefaultSourcesForHost({ homeDir: tempRoot, includeMissing: true }).find(
      (source) => source.platform === "opencode",
    );
    assert.ok(opencodeSource);
    assert.equal(opencodeSource?.base_dir, storageRoot);

    const result = await runSourceProbe({ source_ids: [opencodeSource.id] }, [opencodeSource]);
    assert.deepEqual(
      result.sources[0]?.sessions.map((session) => session.title).sort(),
      ["OpenCode legacy fixture", "OpenCode official fixture"],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

