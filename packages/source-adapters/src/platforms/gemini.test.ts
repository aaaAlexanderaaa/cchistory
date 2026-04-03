import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { SourceDefinition } from "@cchistory/domain";
import { getDefaultSourcesForHost, runSourceProbe } from "../index.js";
import { 
  seedExpandedSourceFixtures
} from "../test-helpers.js";
import { listGeminiSourceRoots } from "./gemini.js";

test("[gemini] companion project files are captured as evidence blobs without creating extra sessions", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const sources = await seedExpandedSourceFixtures(tempRoot);
    const geminiSource = sources.find((source: SourceDefinition) => source.platform === "gemini");
    assert.ok(geminiSource);

    const [payload] = (await runSourceProbe({ limit_files_per_source: 1 }, [geminiSource])).sources;

    assert.ok(payload);
    assert.equal(payload.source.sync_status, "healthy");
    assert.equal(payload.sessions.length, 1);
    assert.equal(payload.turns.length, 1);
    assert.deepEqual(
      payload.blobs.map((blob) => blob.origin_path).sort(),
      [
        path.join(geminiSource.base_dir, "projects.json"),
        path.join(geminiSource.base_dir, "history", "gemini-fixture", ".project_root"),
        path.join(geminiSource.base_dir, "tmp", "gemini-fixture", ".project_root"),
        path.join(geminiSource.base_dir, "tmp", "gemini-fixture", "chats", "session-2026-03-10T07-00-gemini-fixture.json"),
      ].sort(),
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("[gemini] projects.json restores the workspace path when .project_root sidecars are missing", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const sources = await seedExpandedSourceFixtures(tempRoot);
    const geminiSource = sources.find((source: SourceDefinition) => source.platform === "gemini");
    assert.ok(geminiSource);

    await rm(path.join(geminiSource.base_dir, "tmp", "gemini-fixture", ".project_root"));
    await rm(path.join(geminiSource.base_dir, "history", "gemini-fixture", ".project_root"));

    const [payload] = (await runSourceProbe({ limit_files_per_source: 1 }, [geminiSource])).sources;

    assert.ok(payload);
    assert.equal(payload.sessions.length, 1);
    assert.equal(payload.sessions[0]?.working_directory, "/workspace/gemini-fixture");
    assert.equal(payload.sessions[0]?.title, "gemini-fixture");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("[gemini] hashed tmp chats remain valid when companion files are absent", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const sources = await seedExpandedSourceFixtures(tempRoot);
    const geminiSource = sources.find((source: SourceDefinition) => source.platform === "gemini");
    assert.ok(geminiSource);

    await rm(path.join(geminiSource.base_dir, "projects.json"));
    await rm(path.join(geminiSource.base_dir, "tmp", "gemini-fixture", ".project_root"));
    await rm(path.join(geminiSource.base_dir, "history", "gemini-fixture", ".project_root"));
    await rm(path.join(geminiSource.base_dir, "tmp", "gemini-fixture", "chats", "session-2026-03-10T07-00-gemini-fixture.json"));

    const projectKey = "4f3e2d1c0b9a887766554433221100ffeeddccbbaa99887766554433221100aa";
    const chatDir = path.join(geminiSource.base_dir, "tmp", projectKey, "chats");
    await mkdir(chatDir, { recursive: true });
    await writeFile(
      path.join(geminiSource.base_dir, "tmp", projectKey, "logs.json"),
      JSON.stringify([
        {
          sessionId: "gemini-missing-1",
          messageId: 0,
          type: "user",
          message: "/memory show",
          timestamp: "2026-03-31T08:58:21.000Z",
        },
      ]),
      "utf8",
    );
    await writeFile(
      path.join(chatDir, "session-2026-03-31T08-58-gemini-missing-companions.json"),
      JSON.stringify({
        sessionId: "gemini-missing-1",
        projectHash: projectKey,
        startTime: "2026-03-31T08:58:30.000Z",
        lastUpdated: "2026-03-31T08:59:14.000Z",
        messages: [
          {
            id: "gemini-missing-user-1",
            timestamp: "2026-03-31T08:58:30.000Z",
            type: "user",
            content: "Review PIPELINE.md and summarize the next ready backlog item.",
          },
          {
            id: "gemini-missing-assistant-1",
            timestamp: "2026-03-31T08:59:14.000Z",
            type: "gemini",
            content: "The next ready backlog item is the Gemini missing-companion fixture task.",
            model: "gemini-2.5-pro",
          },
        ],
      }),
      "utf8",
    );

    const [payload] = (await runSourceProbe({ limit_files_per_source: 10 }, [geminiSource])).sources;

    assert.ok(payload);
    assert.equal(payload.sessions.length, 1);
    assert.equal(payload.turns.length, 1);
    assert.equal(payload.sessions[0]?.title, projectKey);
    assert.equal(payload.sessions[0]?.working_directory, undefined);
    assert.match(payload.turns[0]?.canonical_text ?? "", /Review PIPELINE\.md/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("[gemini] multiple chat files under one hash remain separate sessions without companions", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const sources = await seedExpandedSourceFixtures(tempRoot);
    const geminiSource = sources.find((source: SourceDefinition) => source.platform === "gemini");
    assert.ok(geminiSource);

    await rm(path.join(geminiSource.base_dir, "projects.json"));
    await rm(path.join(geminiSource.base_dir, "tmp", "gemini-fixture", ".project_root"));
    await rm(path.join(geminiSource.base_dir, "history", "gemini-fixture", ".project_root"));
    await rm(path.join(geminiSource.base_dir, "tmp", "gemini-fixture", "chats", "session-2026-03-10T07-00-gemini-fixture.json"));

    const projectKey = "8e7d6c5b4a39281716151413121110ffeeddccbbaa0099887766554433221100";
    const chatDir = path.join(geminiSource.base_dir, "tmp", projectKey, "chats");
    await mkdir(chatDir, { recursive: true });
    await writeFile(
      path.join(geminiSource.base_dir, "tmp", projectKey, "logs.json"),
      JSON.stringify([
        {
          sessionId: "gemini-scale-a",
          messageId: 0,
          type: "user",
          message: "/init",
          timestamp: "2026-03-31T10:00:00.000Z",
        },
        {
          sessionId: "gemini-scale-b",
          messageId: 0,
          type: "user",
          message: "/tools",
          timestamp: "2026-03-31T11:02:00.000Z",
        },
        {
          sessionId: "gemini-scale-c",
          messageId: 0,
          type: "user",
          message: "/memory show",
          timestamp: "2026-03-31T12:15:00.000Z",
        },
      ]),
      "utf8",
    );

    const chats = [
      [
        "session-2026-03-31T10-00-gemini-scale-a.json",
        "gemini-scale-a",
        "Summarize the repo validation commands for local operators.",
      ],
      [
        "session-2026-03-31T11-02-gemini-scale-b.json",
        "gemini-scale-b",
        "List the current ready tasks and tell me which one is blocked.",
      ],
      [
        "session-2026-03-31T12-15-gemini-scale-c.json",
        "gemini-scale-c",
        "Draft a note explaining why missing companion metadata should not discard a Gemini session.",
      ],
    ] as const;

    for (const [fileName, sessionId, prompt] of chats) {
      await writeFile(
        path.join(chatDir, fileName),
        JSON.stringify({
          sessionId,
          projectHash: projectKey,
          startTime: "2026-03-31T10:00:10.000Z",
          lastUpdated: "2026-03-31T10:00:48.000Z",
          messages: [
            {
              id: `${sessionId}-user`,
              timestamp: "2026-03-31T10:00:10.000Z",
              type: "user",
              content: prompt,
            },
            {
              id: `${sessionId}-assistant`,
              timestamp: "2026-03-31T10:00:48.000Z",
              type: "gemini",
              content: `Handled ${sessionId}.`,
              model: "gemini-2.5-pro",
            },
          ],
        }),
        "utf8",
      );
    }

    const [payload] = (await runSourceProbe({ limit_files_per_source: 10 }, [geminiSource])).sources;

    assert.ok(payload);
    assert.equal(payload.sessions.length, 3);
    assert.equal(payload.turns.length, 3);
    assert.deepEqual(new Set(payload.sessions.map((session) => session.title)), new Set([projectKey]));
    assert.ok(payload.sessions.every((session) => session.working_directory === undefined));
    assert.ok(payload.turns.some((turn) => turn.canonical_text.includes("validation commands")));
    assert.ok(payload.turns.some((turn) => turn.canonical_text.includes("ready tasks")));
    assert.ok(payload.turns.some((turn) => turn.canonical_text.includes("missing companion metadata")));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("getDefaultSourcesForHost includes Gemini CLI sync roots when .gemini exists", () => {
  const homeDir = "/Users/tester";
  const sources = getDefaultSourcesForHost({
    homeDir,
    platform: "darwin",
    pathExists(targetPath) {
      return targetPath === path.join(homeDir, ".gemini");
    },
  });

  const geminiSource = sources.find((source: SourceDefinition) => source.platform === "gemini");
  assert.ok(geminiSource);
  assert.equal(geminiSource?.base_dir, path.join(homeDir, ".gemini"));
});

test("[gemini] source enumeration narrows ~/.gemini roots to tmp chat data", () => {
  const geminiRoot = path.join("/Users/tester", ".gemini");
  assert.deepEqual(listGeminiSourceRoots(geminiRoot), [path.join(geminiRoot, "tmp")]);
  assert.deepEqual(listGeminiSourceRoots(path.join(geminiRoot, "tmp")), [path.join(geminiRoot, "tmp")]);
});

