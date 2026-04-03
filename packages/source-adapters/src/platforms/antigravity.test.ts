import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runSourceProbe } from "../index.js";
import { 
  buildAntigravityLiveSessionSeed, 
  extractAntigravityLiveSeeds 
} from "../platforms/antigravity/live.js";
import { 
  extractGenericSessionMetadata 
} from "../platforms/generic/runtime.js";
import { 
  seedAntigravityTrajectoryStateDb, 
  seedAntigravityHistoryStateDb, 
  seedAntigravityEmptyStateDb, 
  createSourceDefinition,
  initGitRepo,
  getRepoMockDataRoot,
  readJsonFixture
} from "../test-helpers.js";

test("runSourceProbe captures Antigravity brain task artifacts without misclassifying them as user turns", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const sessionId = "brain-session";
    const sessionDir = path.join(tempRoot, ".gemini", "antigravity", "brain", sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      path.join(sessionDir, "task.md"),
      "# Antigravity Task\n\nHelp the user understand the migration plan.\n",
      "utf8",
    );
    await writeFile(
      path.join(sessionDir, "task.md.metadata.json"),
      JSON.stringify({
        artifactType: "ARTIFACT_TYPE_TASK",
        summary: "Task summary",
        updatedAt: "2026-03-10T09:00:00.000Z",
      }),
      "utf8",
    );
    await writeFile(
      path.join(sessionDir, "walkthrough.md"),
      "# Walkthrough\n\nProduced the migration plan and next steps.\n",
      "utf8",
    );
    await writeFile(
      path.join(sessionDir, "walkthrough.md.metadata.json"),
      JSON.stringify({
        updatedAt: "2026-03-10T09:05:00.000Z",
      }),
      "utf8",
    );

    const [payload] = (
      await runSourceProbe(
        {},
        [createSourceDefinition("src-antigravity-brain", "antigravity", path.join(tempRoot, ".gemini", "antigravity", "brain"))],
      )
    ).sources;

    assert.ok(payload);
    assert.equal(payload.source.sync_status, "healthy");
    assert.equal(payload.sessions.length, 1);
    assert.equal(payload.turns.length, 0);
    assert.equal(payload.contexts.length, 0);
    assert.ok(
      payload.atoms.some(
        (atom) => atom.actor_kind === "system" && typeof atom.payload.text === "string" && atom.payload.text.includes("migration plan"),
      ),
    );
    assert.ok(
      payload.atoms.some(
        (atom) => atom.actor_kind === "assistant" && typeof atom.payload.text === "string" && atom.payload.text.includes("next steps"),
      ),
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe derives Antigravity user turns from workspace history descriptions while keeping brain markdown as attachments", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const sessionId = "f016bbd7-ad8f-4b3b-bab0-a73e197f391a";
    const userDir = path.join(tempRoot, "Library", "Application Support", "Antigravity", "User");
    const workspaceDir = path.join(userDir, "workspaceStorage", "cchistory-workspace");
    const brainDir = path.join(tempRoot, ".gemini", "antigravity", "brain", sessionId);
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(brainDir, { recursive: true });

    seedAntigravityTrajectoryStateDb(path.join(workspaceDir, "state.vscdb"), {
      trajectoryId: sessionId,
      title: "Refining Startup Configuration",
      workspacePath: "/Users/mock_user/workspace/cchistory",
      createdAt: "2026-03-12T01:14:03.000Z",
      updatedAt: "2026-03-12T01:16:13.000Z",
    });
    seedAntigravityHistoryStateDb(path.join(workspaceDir, "state.vscdb.backup"), {
      sessionId,
      description:
        "启动方式有点混乱，帮我规整一下，最开始只是 web/API分别起，后来包装成了service，最近一次debug改成了node apps/api/dist/index.js起后端，而之前的service启动方式失效了",
      observedAt: "2026-03-12T01:13:00.000Z",
    });
    await writeFile(
      path.join(workspaceDir, "workspace.json"),
      JSON.stringify({
        folder: "file:///Users/mock_user/workspace/cchistory",
      }),
      "utf8",
    );

    await writeFile(
      path.join(brainDir, "task.md"),
      "# Consolidate Dev Startup Scripts\n\n- [x] Investigate current startup scripts and identify issues\n",
      "utf8",
    );
    await writeFile(
      path.join(brainDir, "task.md.metadata.json"),
      JSON.stringify({
        artifactType: "ARTIFACT_TYPE_TASK",
        summary: "Completed checklist for startup script consolidation.",
        updatedAt: "2026-03-12T01:15:54.000Z",
      }),
      "utf8",
    );
    await writeFile(
      path.join(brainDir, "implementation_plan.md"),
      [
        "# Consolidate Dev Startup Scripts",
        "",
        "The project has accumulated three overlapping dev-server startup paths that are now inconsistent.",
        "The supervisor-based service system (`pnpm services:start`) is broken, so recent work fell back to `node apps/api/dist/index.js` for the API.",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(brainDir, "implementation_plan.md.metadata.json"),
      JSON.stringify({
        artifactType: "ARTIFACT_TYPE_IMPLEMENTATION_PLAN",
        updatedAt: "2026-03-12T01:14:03.000Z",
      }),
      "utf8",
    );
    await writeFile(
      path.join(brainDir, "walkthrough.md"),
      [
        "# Walkthrough: Startup Script Consolidation",
        "",
        "`pnpm services:start` now starts the API and web services under the supervisor again.",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(brainDir, "walkthrough.md.metadata.json"),
      JSON.stringify({
        artifactType: "ARTIFACT_TYPE_WALKTHROUGH",
        updatedAt: "2026-03-12T01:16:13.000Z",
      }),
      "utf8",
    );

    const [payload] = (
      await runSourceProbe({}, [createSourceDefinition("src-antigravity-history", "antigravity", userDir)])
    ).sources;

    assert.ok(payload);
    assert.equal(payload.source.sync_status, "healthy");
    assert.equal(payload.sessions.length, 1);
    assert.equal(payload.turns.length, 1);
    assert.equal(payload.contexts.length, 1);
    assert.equal(payload.sessions[0]?.working_directory, "/Users/mock_user/workspace/cchistory");
    assert.match(payload.turns[0]?.canonical_text ?? "", /启动方式有点混乱/);
    assert.ok(
      payload.contexts[0]?.assistant_replies.some((reply) => reply.content.includes("three overlapping dev-server startup paths")),
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe does not backfill Antigravity repo_remote from current git when source records only provide workspace path", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const repoRoot = path.join(tempRoot, "workspace", "history-lab");
    await mkdir(repoRoot, { recursive: true });
    await initGitRepo(repoRoot, tempRoot);
    const repoRootRealPath = await realpath(repoRoot);

    const userDir = path.join(tempRoot, "Library", "Application Support", "Antigravity", "User");
    const workspaceDir = path.join(userDir, "workspaceStorage", "history-workspace");
    await mkdir(workspaceDir, { recursive: true });

    seedAntigravityTrajectoryStateDb(path.join(workspaceDir, "state.vscdb"), {
      trajectoryId: "repo-root-only-session",
      title: "Repo Root Only",
      workspacePath: repoRoot,
      createdAt: "2026-03-12T01:14:03.000Z",
      updatedAt: "2026-03-12T01:16:13.000Z",
    });
    await writeFile(
      path.join(workspaceDir, "workspace.json"),
      JSON.stringify({ folder: `file://${repoRoot}` }),
      "utf8",
    );

    const [payload] = (
      await runSourceProbe({}, [createSourceDefinition("src-antigravity-repo-root-only", "antigravity", userDir)])
    ).sources;

    assert.ok(payload);
    const projectObservation = payload.candidates.find((candidate) => candidate.candidate_kind === "project_observation");
    assert.ok(projectObservation);
    assert.equal(projectObservation.evidence.repo_root, repoRootRealPath);
    assert.equal(projectObservation.evidence.repo_remote, undefined);
    assert.equal(projectObservation.evidence.repo_fingerprint, undefined);
    assert.equal(projectObservation.evidence.debug_summary, "workspace signal with git-backed repository root");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe keeps short Antigravity history titles as metadata only when no prompt survives", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const sessionId = "035b86d5-8ae6-4dfd-bdf0-3a28e9f1df5e";
    const userDir = path.join(tempRoot, "Library", "Application Support", "Antigravity", "User");
    const workspaceDir = path.join(userDir, "workspaceStorage", "cchistory-workspace");
    const brainDir = path.join(tempRoot, ".gemini", "antigravity", "brain", sessionId);
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(brainDir, { recursive: true });

    seedAntigravityTrajectoryStateDb(path.join(workspaceDir, "state.vscdb"), {
      trajectoryId: sessionId,
      title: "Interactive UX Testing",
      workspacePath: "/Users/mock_user/workspace/cchistory",
      createdAt: "2026-03-11T15:40:03.000Z",
      updatedAt: "2026-03-11T15:42:18.000Z",
    });
    seedAntigravityHistoryStateDb(path.join(workspaceDir, "state.vscdb.backup"), {
      sessionId,
      description: "Interactive UX Testing",
      observedAt: "2026-03-11T15:42:18.000Z",
    });
    await writeFile(
      path.join(workspaceDir, "workspace.json"),
      JSON.stringify({
        folder: "file:///Users/mock_user/workspace/cchistory",
      }),
      "utf8",
    );

    await writeFile(
      path.join(brainDir, "task.md"),
      "# Task Checklist\n\n- [x] Open the browser\n- [x] Inspect the UX issue\n- [x] Fix the issue\n",
      "utf8",
    );
    await writeFile(
      path.join(brainDir, "task.md.metadata.json"),
      JSON.stringify({
        artifactType: "ARTIFACT_TYPE_TASK",
        updatedAt: "2026-03-11T15:42:19.000Z",
      }),
      "utf8",
    );
    await writeFile(
      path.join(brainDir, "walkthrough.md"),
      "# Walkthrough: Interactive UX Testing\n\nThe issue came from a stale selection state in the turns view.\n",
      "utf8",
    );
    await writeFile(
      path.join(brainDir, "walkthrough.md.metadata.json"),
      JSON.stringify({
        artifactType: "ARTIFACT_TYPE_WALKTHROUGH",
        updatedAt: "2026-03-11T15:42:20.000Z",
      }),
      "utf8",
    );

    const [payload] = (
      await runSourceProbe({}, [createSourceDefinition("src-antigravity-short-title", "antigravity", userDir)])
    ).sources;

    assert.ok(payload);
    assert.equal(payload.source.sync_status, "healthy");
    assert.equal(payload.sessions.length, 1);
    assert.equal(payload.turns.length, 0);
    assert.equal(payload.contexts.length, 0);
    assert.ok(
      payload.sessions[0]?.title === "Interactive UX Testing",
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("buildAntigravityLiveSessionSeed normalizes Windows file URIs from live summaries", () => {
  const seed = buildAntigravityLiveSessionSeed({
    cascadeId: "windows-live-session",
    summary: {
      summary: "Windows Live Session",
      createdTime: "2026-03-12T01:11:10.214459Z",
      workspaces: [
        {
          workspaceFolderAbsoluteUri: "file://localhost/C:/Users/dev/workspace/history-lab/",
        },
      ],
    },
    steps: [
      {
        type: "CORTEX_STEP_TYPE_USER_INPUT",
        metadata: {
          createdAt: "2026-03-12T01:11:10.214459Z",
        },
        userInput: {
          userResponse: "Continue on Windows",
        },
      },
    ],
  });

  assert.ok(seed);
  assert.equal(seed.workingDirectory, "c:/Users/dev/workspace/history-lab");
});

test("buildAntigravityLiveSessionSeed decodes percent-encoded separators in file URIs", () => {
  const seed = buildAntigravityLiveSessionSeed({
    cascadeId: "encoded-live-session",
    summary: {
      summary: "Encoded Live Session",
      createdTime: "2026-03-12T01:11:10.214459Z",
      workspaces: [
        {
          workspaceFolderAbsoluteUri: "file://localhost/C:/Users/dev/workspace/history%2Flab%3Afeature/",
        },
      ],
    },
    steps: [
      {
        type: "CORTEX_STEP_TYPE_USER_INPUT",
        metadata: {
          createdAt: "2026-03-12T01:11:10.214459Z",
        },
        userInput: {
          userResponse: "Continue on encoded Windows workspace",
        },
      },
    ],
  });

  assert.ok(seed);
  assert.equal(seed.workingDirectory, "c:/Users/dev/workspace/history/lab:feature");
});

test("buildAntigravityLiveSessionSeed prefers userResponse text and skips artifact-only user inputs", () => {
  const seed = buildAntigravityLiveSessionSeed({
    cascadeId: "f016bbd7-ad8f-4b3b-bab0-a73e197f391a",
    summary: {
      summary: "Refining Startup Configuration",
      createdTime: "2026-03-12T01:10:56.625283Z",
      lastModifiedTime: "2026-03-12T01:16:22.848023Z",
      workspaces: [
        {
          workspaceFolderAbsoluteUri: "file:///Users/mock_user/workspace/cchistory",
        },
      ],
    },
    steps: [
      {
        type: "CORTEX_STEP_TYPE_USER_INPUT",
        metadata: {
          createdAt: "2026-03-12T01:10:56.625283Z",
        },
        userInput: {
          items: [{ text: "Translated plan summary" }, { text: "Extra split fragment" }],
          userResponse:
            "启动方式有点混乱，帮我规整一下，最开始只是 web/API分别起，后来包装成了service，最近一次debug改成了node apps/api/dist/index.js起后端，而之前的service启动方式失效了",
        },
      },
      {
        type: "CORTEX_STEP_TYPE_USER_INPUT",
        metadata: {
          createdAt: "2026-03-12T01:14:13.417734Z",
        },
        userInput: {
          userResponse: "",
          artifactComments: [{ absolutePathUri: "file:///Users/mock_user/.gemini/antigravity/brain/f016/implementation_plan.md" }],
        },
      },
      {
        type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
        metadata: {
          createdAt: "2026-03-12T01:11:04.243852Z",
        },
        plannerResponse: {
          modifiedResponse: "I investigated the startup configuration and found conflicting startup paths.",
        },
      },
      {
        type: "CORTEX_STEP_TYPE_RUN_COMMAND",
        metadata: {
          createdAt: "2026-03-12T01:11:10.214459Z",
          toolCall: {
            id: "run-command-1",
            name: "run_command",
            argumentsJson: JSON.stringify({
              CommandLine: "pnpm services:status",
              Cwd: "/Users/mock_user/workspace/cchistory",
            }),
          },
        },
        runCommand: {
          commandLine: "pnpm services:status",
          cwd: "/Users/mock_user/workspace/cchistory",
          combinedOutput: {
            full: "api: running\nweb: running",
          },
        },
      },
    ],
  });

  assert.ok(seed);
  assert.equal(seed.workingDirectory, "/Users/mock_user/workspace/cchistory");

  const normalizedRecords = seed.records.filter((record) => record.pointer.startsWith("live:steps["));
  assert.equal(normalizedRecords.length, 3);

  const userRecord = JSON.parse(normalizedRecords[0]?.rawJson ?? "{}") as Record<string, unknown>;
  assert.equal(
    (userRecord.message as { content?: Array<{ text?: string }> }).content?.[0]?.text,
    "启动方式有点混乱，帮我规整一下，最开始只是 web/API分别起，后来包装成了service，最近一次debug改成了node apps/api/dist/index.js起后端，而之前的service启动方式失效了",
  );

  const toolRecord = JSON.parse(normalizedRecords[2]?.rawJson ?? "{}") as Record<string, unknown>;
  assert.deepEqual(toolRecord.message, {
    role: "assistant",
    tool_call: {
      id: "run-command-1",
      name: "run_command",
      input: {
        CommandLine: "pnpm services:status",
        Cwd: "/Users/mock_user/workspace/cchistory",
      },
    },
    tool_result: {
      tool_use_id: "run-command-1",
      content: "api: running\nweb: running",
    },
  });
});

test("extractGenericSessionMetadata preserves Antigravity live repo metadata from trajectory summaries", () => {
  const meta = extractGenericSessionMetadata(
    {
      antigravityLive: {
        summary: {
          workspaces: [
            {
              workspaceFolderAbsoluteUri: "file:///Users/mock_user/workspace/cchistory",
              gitRootAbsoluteUri: "file:///Users/mock_user/workspace/cchistory",
              repository: {
                gitOriginUrl: "https://git.example.invalid/acme/history-lab.git",
              },
            },
          ],
        },
      },
    },
    {
      isObject(value: unknown): value is Record<string, any> {
        return typeof value === "object" && value !== null && !Array.isArray(value);
      },
      asString(value: unknown): string | undefined {
        return typeof value === "string" ? value : undefined;
      },
      asBoolean(value: unknown): boolean | undefined {
        return typeof value === "boolean" ? value : undefined;
      },
      normalizeWorkspacePath(value: string): string | undefined {
        const normalized = value.startsWith("file://")
          ? new URL(value).pathname
          : path.posix.normalize(value.replace(/\\/g, "/"));
        return normalized === "/" ? normalized : normalized.replace(/\/+$/u, "");
      },
    },
  );

  assert.equal(meta.workspacePath, "/Users/mock_user/workspace/cchistory");
  assert.equal(meta.repoRoot, "/Users/mock_user/workspace/cchistory");
  assert.equal(meta.repoRemote, "https://git.example.invalid/acme/history-lab.git");
});

test("extractAntigravityLiveSeeds falls back to live summaries when no pb cache is present", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const userDir = path.join(tempRoot, "Library", "Application Support", "Antigravity", "User");
    await mkdir(userDir, { recursive: true });

    const collection = await extractAntigravityLiveSeeds(userDir, {
      listConversationPbIds: async () => [],
      discoverLiveEndpoint: async () => ({
        pid: 1,
        command: "language_server_macos_arm --app_data_dir antigravity",
        csrfToken: "token",
        extensionServerPort: 63605,
        apiPort: 63606,
        candidatePorts: [63606],
      }),
      callLanguageServer: async (_live, method, body) => {
        if (method === "GetAllCascadeTrajectories") {
          return {
            trajectorySummaries: {
              "summary-only-session": {
                summary: "Summary Only Session",
                createdTime: "2026-03-11T15:40:03.894311Z",
                workspaces: [
                  {
                    workspaceFolderAbsoluteUri: "file:///Users/mock_user/workspace/history-lab",
                  },
                ],
              },
            },
          };
        }
        assert.equal(method, "GetCascadeTrajectorySteps");
        assert.equal(body.cascadeId, "summary-only-session");
        return {
          steps: [
            {
              type: "CORTEX_STEP_TYPE_USER_INPUT",
              metadata: {
                createdAt: "2026-03-11T15:40:03.894311Z",
              },
              userInput: {
                userResponse: "Summary-only live prompt",
              },
            },
          ],
        };
      },
    });

    assert.ok(collection);
    assert.deepEqual(collection.virtualPaths, ["antigravity-live://summary-only-session"]);
    assert.equal(collection.seeds[0]?.sessionId, "sess:antigravity:summary-only-session");
    assert.equal(
      JSON.parse(collection.seeds[0]?.records[1]?.rawJson ?? "{}").message.content[0].text,
      "Summary-only live prompt",
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("extractAntigravityLiveSeeds reads pb-backed cascade ids from the Antigravity home rooted at the source base dir", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const userDir = path.join(tempRoot, "Library", "Application Support", "Antigravity", "User");
    const conversationDir = path.join(tempRoot, ".gemini", "antigravity", "conversations");
    await mkdir(userDir, { recursive: true });
    await mkdir(conversationDir, { recursive: true });
    await writeFile(path.join(conversationDir, "live-session.pb"), "", "utf8");

    const collection = await extractAntigravityLiveSeeds(userDir, {
      discoverLiveEndpoint: async () => ({
        pid: 1,
        command: "language_server_macos_arm --app_data_dir antigravity",
        csrfToken: "token",
        extensionServerPort: 63605,
        apiPort: 63606,
        candidatePorts: [63606],
      }),
      callLanguageServer: async (_live, method, body) => {
        if (method === "GetAllCascadeTrajectories") {
          return { trajectorySummaries: {} };
        }
        assert.equal(method, "GetCascadeTrajectorySteps");
        assert.equal(body.cascadeId, "live-session");
        return {
          steps: [
            {
              type: "CORTEX_STEP_TYPE_USER_INPUT",
              metadata: {
                createdAt: "2026-03-11T15:40:03.894311Z",
              },
              userInput: {
                userResponse: "Continue",
              },
            },
          ],
        };
      },
    });

    assert.ok(collection);
    assert.deepEqual(collection.virtualPaths, ["antigravity-live://live-session"]);
    assert.equal(collection.seeds[0]?.sessionId, "sess:antigravity:live-session");
    assert.equal(
      JSON.parse(collection.seeds[0]?.records[1]?.rawJson ?? "{}").message.content[0].text,
      "Continue",
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("extractAntigravityLiveSeeds applies the limit before fetching live steps", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const userDir = path.join(tempRoot, "Library", "Application Support", "Antigravity", "User");
    await mkdir(userDir, { recursive: true });
    const fetchedCascadeIds: string[] = [];

    const collection = await extractAntigravityLiveSeeds(userDir, {
      limit: 1,
      listConversationPbIds: async () => ["second-session", "first-session"],
      discoverLiveEndpoint: async () => ({
        pid: 1,
        command: "language_server_macos_arm --app_data_dir antigravity",
        csrfToken: "token",
        extensionServerPort: 63605,
        apiPort: 63606,
        candidatePorts: [63606],
      }),
      callLanguageServer: async (_live, method, body) => {
        if (method === "GetAllCascadeTrajectories") {
          return {
            trajectorySummaries: {
              "first-session": {
                summary: "First Session",
              },
              "second-session": {
                summary: "Second Session",
              },
            },
          };
        }
        assert.equal(method, "GetCascadeTrajectorySteps");
        const cascadeId = typeof body.cascadeId === "string" ? body.cascadeId : "";
        fetchedCascadeIds.push(cascadeId);
        return {
          steps: [
            {
              type: "CORTEX_STEP_TYPE_USER_INPUT",
              metadata: {
                createdAt: "2026-03-11T15:40:03.894311Z",
              },
              userInput: {
                userResponse: `Prompt for ${cascadeId}`,
              },
            },
          ],
        };
      },
    });

    assert.ok(collection);
    assert.deepEqual(fetchedCascadeIds, ["first-session"]);
    assert.deepEqual(collection.virtualPaths, ["antigravity-live://first-session"]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("extractAntigravityLiveSeeds preserves mock antigravity live fixtures and prefers userResponse over rewritten items", async () => {
  const mockDataRoot = getRepoMockDataRoot();
  const fixtureRoot = path.join(mockDataRoot, "fixtures", "antigravity-live");
  const summariesPayload = await readJsonFixture<Record<string, unknown>>(
    path.join(fixtureRoot, "trajectory-summaries.json"),
  );
  const stepPayloads = new Map<string, Record<string, unknown>>([
    [
      "035b86d5-8ae6-4dfd-bdf0-3a28e9f1df5e",
      await readJsonFixture<Record<string, unknown>>(
        path.join(fixtureRoot, "steps", "035b86d5-8ae6-4dfd-bdf0-3a28e9f1df5e.json"),
      ),
    ],
    [
      "f016bbd7-ad8f-4b3b-bab0-a73e197f391a",
      await readJsonFixture<Record<string, unknown>>(
        path.join(fixtureRoot, "steps", "f016bbd7-ad8f-4b3b-bab0-a73e197f391a.json"),
      ),
    ],
  ]);

  const collection = await extractAntigravityLiveSeeds(
    path.join(mockDataRoot, "Library", "Application Support", "antigravity", "User"),
    {
      listConversationPbIds: async () => [...stepPayloads.keys()],
      discoverLiveEndpoint: async () => ({
        pid: 1,
        command: "language_server_macos_arm --app_data_dir antigravity",
        csrfToken: "token",
        extensionServerPort: 63605,
        apiPort: 63606,
        candidatePorts: [63606],
      }),
      callLanguageServer: async (_live, method, body) => {
        if (method === "GetAllCascadeTrajectories") {
          return summariesPayload;
        }
        assert.equal(method, "GetCascadeTrajectorySteps");
        const cascadeId = typeof body.cascadeId === "string" ? body.cascadeId : undefined;
        assert.ok(cascadeId);
        const payload = stepPayloads.get(cascadeId);
        assert.ok(payload, `expected steps fixture for ${cascadeId}`);
        return payload;
      },
    },
  );

  assert.ok(collection);
  assert.equal(collection.seeds.length, 2);

  const uxSeed = collection.seeds.find((seed) => seed.sessionId.endsWith("035b86d5-8ae6-4dfd-bdf0-3a28e9f1df5e"));
  assert.ok(uxSeed);
  assert.equal(uxSeed.workingDirectory, "/Users/mock_user/workspace/history-lab");
  const uxMessages = uxSeed.records
    .filter((record) => record.pointer.startsWith("live:steps["))
    .map((record) => JSON.parse(record.rawJson) as { message?: { content?: Array<{ text?: string }> } });
  assert.equal(uxMessages[0]?.message?.content?.[0]?.text, "我把API起在了8040端口，web起在了8085端口，你自己访问浏览做个交互测试吧，我觉得有点问题，用户体验不太舒服，但是你最好看看");
  assert.equal(uxMessages[2]?.message?.content?.[0]?.text, "Continue");

  const startupSeed = collection.seeds.find((seed) => seed.sessionId.endsWith("f016bbd7-ad8f-4b3b-bab0-a73e197f391a"));
  assert.ok(startupSeed);
  const startupMessages = startupSeed.records
    .filter((record) => record.pointer.startsWith("live:steps["))
    .map((record) => JSON.parse(record.rawJson) as { message?: { role?: string; content?: Array<{ text?: string }> } });
  assert.equal(startupMessages.length, 2);
  assert.equal(startupMessages[0]?.message?.role, "user");
  assert.equal(
    startupMessages[0]?.message?.content?.[0]?.text,
    "启动方式有点混乱，帮我规整一下，最开始只是 web/API分别起，后来包装成了service，最近一次debug改成了node apps/api/dist/index.js起后端，而之前的service启动方式失效了",
  );
  assert.equal(startupMessages[1]?.message?.role, "assistant");
});

test("runSourceProbe keeps Antigravity prompts literal even when they resemble injected system markers", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const sessionId = "2f7ceabf-8122-4f3e-94a3-53a7eabf8122";
    const userDir = path.join(tempRoot, "Library", "Application Support", "Antigravity", "User");
    const workspaceDir = path.join(userDir, "workspaceStorage", "cchistory-workspace");
    await mkdir(workspaceDir, { recursive: true });

    seedAntigravityTrajectoryStateDb(path.join(workspaceDir, "state.vscdb"), {
      trajectoryId: sessionId,
      title: "Literal Marker Prompt",
      workspacePath: "/Users/mock_user/workspace/cchistory",
      createdAt: "2026-03-12T01:10:56.625283Z",
      updatedAt: "2026-03-12T01:10:57.625283Z",
    });
    seedAntigravityHistoryStateDb(path.join(workspaceDir, "state.vscdb.backup"), {
      sessionId,
      description: "<environment_context>\nport=8040\n</environment_context>\n请把这段原样保留，不要做系统提示词拆分。",
      observedAt: "2026-03-12T01:10:56.625283Z",
    });

    const [payload] = (
      await runSourceProbe({}, [createSourceDefinition("src-antigravity-literal-prompt", "antigravity", userDir)])
    ).sources;

    assert.ok(payload);
    assert.equal(payload.turns.length, 1);
    assert.equal(payload.turns[0]?.user_messages.length, 1);
    assert.match(payload.turns[0]?.canonical_text ?? "", /^<environment_context>/u);
    assert.match(payload.turns[0]?.canonical_text ?? "", /不要做系统提示词拆分/u);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe keeps Antigravity prompt markers literal while still masking secrets", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const sessionId = "a8e13f4e-4506-4fcf-a938-9dd095e78910";
    const userDir = path.join(tempRoot, "Library", "Application Support", "Antigravity", "User");
    const workspaceDir = path.join(userDir, "workspaceStorage", "cchistory-workspace");
    await mkdir(workspaceDir, { recursive: true });

    seedAntigravityTrajectoryStateDb(path.join(workspaceDir, "state.vscdb"), {
      trajectoryId: sessionId,
      title: "Literal Marker With Secret",
      workspacePath: "/Users/mock_user/workspace/cchistory",
      createdAt: "2026-03-12T01:11:56.625283Z",
      updatedAt: "2026-03-12T01:11:57.625283Z",
    });
    seedAntigravityHistoryStateDb(path.join(workspaceDir, "state.vscdb.backup"), {
      sessionId,
      description:
        "<environment_context>\nport=8040\n</environment_context>\n请保留这段上下文，并把 sk-abcdefghijklmnopqrstuvwxyz123456 这个测试密钥隐藏掉。",
      observedAt: "2026-03-12T01:11:56.625283Z",
    });

    const [payload] = (
      await runSourceProbe({}, [createSourceDefinition("src-antigravity-literal-secret-prompt", "antigravity", userDir)])
    ).sources;

    assert.ok(payload);
    assert.equal(payload.turns.length, 1);
    assert.equal(payload.turns[0]?.user_messages.length, 1);
    assert.match(payload.turns[0]?.canonical_text ?? "", /^<environment_context>/u);
    assert.match(payload.turns[0]?.canonical_text ?? "", /请保留这段上下文/u);
    assert.doesNotMatch(payload.turns[0]?.canonical_text ?? "", /sk-abcdefghijklmnopqrstuvwxyz123456/u);
    assert.equal(
      payload.turns[0]?.user_messages[0]?.display_segments?.some(
        (segment) => segment.type === "masked" && segment.mask_label === "API Key",
      ),
      true,
    );
    assert.match(payload.turns[0]?.user_messages[0]?.raw_text ?? "", /sk-abcdefghijklmnopqrstuvwxyz123456/u);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe derives multiple Antigravity user turns from History snapshot entries while deduping same-request plan echoes", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const sessionId = "f6632265-5d9f-4c9b-8336-947d5a795cd3";
    const userDir = path.join(tempRoot, "Library", "Application Support", "Antigravity", "User");
    const taskHistoryDir = path.join(userDir, "History", "task-history");
    const planHistoryDir = path.join(userDir, "History", "plan-history");
    await mkdir(taskHistoryDir, { recursive: true });
    await mkdir(planHistoryDir, { recursive: true });

    await writeFile(
      path.join(taskHistoryDir, "entries.json"),
      JSON.stringify({
        version: 1,
        resource: `file:///Users/mock_user/.gemini/antigravity/brain/${sessionId}/task.md`,
        entries: [
          { id: "task-1.md", source: "Workspace Edit", timestamp: Date.parse("2025-12-17T12:00:00.000Z") },
        ],
      }),
      "utf8",
    );
    await writeFile(
      path.join(taskHistoryDir, "task-1.md"),
      [
        "# Splunk Skills Task",
        "",
        "## Objective",
        "Create comprehensive skills for Splunk SPL and Dashboard Studio to enable AI agents to assist with Splunk search building and dashboard creation.",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      path.join(planHistoryDir, "entries.json"),
      JSON.stringify({
        version: 1,
        resource: `file:///Users/mock_user/.gemini/antigravity/brain/${sessionId}/implementation_plan.md`,
        entries: [
          { id: "plan-1.md", source: "Workspace Edit", timestamp: Date.parse("2025-12-17T12:00:10.000Z") },
          { id: "plan-2.md", source: "Workspace Edit", timestamp: Date.parse("2025-12-17T12:30:00.000Z") },
        ],
      }),
      "utf8",
    );
    await writeFile(
      path.join(planHistoryDir, "plan-1.md"),
      [
        "# Implementation Plan",
        "",
        "Create comprehensive Splunk skills for AI agents covering SPL (Search Processing Language) and Dashboard Studio, following the established skill design patterns in the Claude_skills project.",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(planHistoryDir, "plan-2.md"),
      [
        "# Implementation Plan",
        "",
        "Address user feedback: expand the validator scope so it reports command coverage gaps and actionable warnings.",
      ].join("\n"),
      "utf8",
    );

    const [payload] = (
      await runSourceProbe({}, [createSourceDefinition("src-antigravity-history-snapshots", "antigravity", userDir)])
    ).sources;

    assert.ok(payload);
    assert.equal(payload.source.sync_status, "healthy");
    assert.equal(payload.sessions.length, 1);
    assert.equal(payload.turns.length, 2);
    assert.match(payload.turns[0]?.canonical_text ?? "", /Create comprehensive skills for Splunk SPL and Dashboard Studio/);
    assert.match(payload.turns[1]?.canonical_text ?? "", /Address user feedback: expand the validator scope/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe does not synthesize bogus Antigravity sessions from empty state or non-prompt history snapshots", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const sessionId = "58375d20-a7ce-491c-99c6-f6ee758a7c8a";
    const userDir = path.join(tempRoot, "Library", "Application Support", "Antigravity", "User");
    const workspaceDir = path.join(userDir, "workspaceStorage", "empty-workspace");
    const historyDir = path.join(userDir, "History", "walkthrough-only");
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(historyDir, { recursive: true });

    seedAntigravityEmptyStateDb(path.join(workspaceDir, "state.vscdb"));
    await writeFile(
      path.join(historyDir, "entries.json"),
      JSON.stringify({
        version: 1,
        resource: `file:///Users/mock_user/.gemini/antigravity/brain/${sessionId}/walkthrough.md`,
        entries: [
          { id: "walkthrough-1.md", source: "Workspace Edit", timestamp: Date.parse("2025-12-11T13:55:17.630Z") },
        ],
      }),
      "utf8",
    );
    await writeFile(
      path.join(historyDir, "walkthrough-1.md"),
      [
        "# UTM Auto-Recovery Solution - Walkthrough",
        "",
        "## Overview",
        "",
        "This walkthrough documents the review and fixes applied to the UTM Auto-Recovery Solution for macOS.",
      ].join("\n"),
      "utf8",
    );

    const [payload] = (
      await runSourceProbe({}, [createSourceDefinition("src-antigravity-empty-inputs", "antigravity", userDir)])
    ).sources;

    assert.ok(payload);
    assert.equal(payload.source.sync_status, "stale");
    assert.equal(payload.sessions.length, 0);
    assert.equal(payload.turns.length, 0);
    assert.equal(payload.contexts.length, 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe derives Antigravity user turns from Conversation_History snapshots in the user brain root", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const referencedSessionId = "1bcefd41-029b-4a29-ba79-9a429a88e8f9";
    const snapshotSessionId = "9b28d5a6-dee3-4f2a-bc6e-2c8c21aa61bc";
    const userDir = path.join(tempRoot, "Library", "Application Support", "Antigravity", "User");
    const snapshotDir = path.join(tempRoot, ".gemini", "antigravity", "brain", snapshotSessionId);
    await mkdir(userDir, { recursive: true });
    await mkdir(snapshotDir, { recursive: true });

    const historyPath = path.join(snapshotDir, "Conversation_1bcefd41_History.md");
    await writeFile(
      historyPath,
      [
        "# Conversation History: SOTA Agents Context Engineering Research",
        `**Conversation ID**: ${referencedSessionId}`,
        "",
        "## Objective",
        "Deep research on how SOTA AI coding agents (Claude Code, OpenAI Codex CLI, Cursor, Antigravity, Windsurf) realize their context engineering.",
        "",
        "## Task State (from task.md)",
        "- [x] Review existing document",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      `${historyPath}.metadata.json`,
      JSON.stringify({
        updatedAt: "2025-12-17T15:09:19.004Z",
      }),
      "utf8",
    );

    const [payload] = (
      await runSourceProbe({}, [createSourceDefinition("src-antigravity-conversation-history", "antigravity", userDir)])
    ).sources;

    assert.ok(payload);
    assert.equal(payload.source.sync_status, "healthy");
    assert.equal(payload.sessions.length, 1);
    assert.equal(payload.turns.length, 1);
    assert.equal(payload.sessions[0]?.id, `sess:antigravity:${referencedSessionId}`);
    assert.equal(payload.sessions[0]?.title, "SOTA Agents Context Engineering Research");
    assert.match(payload.turns[0]?.canonical_text ?? "", /Deep research on how SOTA AI coding agents/);
    assert.ok(
      payload.atoms.some(
        (atom) =>
          atom.actor_kind === "system" &&
          typeof atom.payload.text === "string" &&
          atom.payload.text.includes("Conversation History: SOTA Agents Context Engineering Research"),
      ),
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

