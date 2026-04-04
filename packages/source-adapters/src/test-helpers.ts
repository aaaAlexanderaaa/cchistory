import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, realpath, rm, writeFile, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { FragmentKind, SourceDefinition, SourceSyncPayload } from "@cchistory/domain";
import { discoverDefaultSourcesForHost, discoverHostToolsForHost, getDefaultSourcesForHost, getSourceFormatProfiles, runSourceProbe } from "./index.js";
import { buildAntigravityLiveSessionSeed, extractAntigravityLiveSeeds } from "./platforms/antigravity/live.js";
import { extractGenericSessionMetadata } from "./platforms/generic/runtime.js";
import { listGeminiSourceRoots } from "./platforms/gemini.js";
import { listPlatformAdapters, listPlatformAdaptersBySupportTier } from "./platforms/registry.js";

export const execFileAsync = promisify(execFile);

export interface MockDataScenarioFixture {
  id: string;
  apps: string[];
  visible_roots: string[];
  paths: string[];
}

export interface StableAdapterValidationEntry {
  platform: SourceDefinition["platform"];
  source_id: string;
  family: SourceDefinition["family"];
  probe_base_dir: string;
  scenario_ids: string[];
  validation_basis: string[];
  runtime_fixture_paths?: string[];
}

export interface StableAdapterValidationManifest {
  schema_version: number;
  last_reviewed: string;
  stable_adapters: StableAdapterValidationEntry[];
}

export async function seedSupportedSourceFixtures(tempRoot: string): Promise<SourceDefinition[]> {
  const codexDir = path.join(tempRoot, "codex");
  const claudeDir = path.join(tempRoot, "claude");
  const factoryDir = path.join(tempRoot, "factory");
  const ampDir = path.join(tempRoot, "amp");

  await mkdir(codexDir, { recursive: true });
  await mkdir(claudeDir, { recursive: true });
  await mkdir(factoryDir, { recursive: true });
  await mkdir(ampDir, { recursive: true });

  await writeFile(
    path.join(codexDir, "rollout-2026-03-09T00-00-00-codex-session-1.jsonl"),
    [
      {
        timestamp: "2026-03-09T00:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "codex-session-1",
          cwd: "/workspace/codex",
          model: "gpt-5",
        },
      },
      {
        timestamp: "2026-03-09T00:00:00.500Z",
        type: "turn_context",
        payload: {
          cwd: "/workspace/codex",
          model: "gpt-5",
        },
      },
      {
        timestamp: "2026-03-09T00:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "How do I continue?" }],
        },
      },
      {
        timestamp: "2026-03-09T00:00:02.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            { type: "output_text", text: "Start with the validation harness." },
            { type: "image", url: "file:///tmp/codex.png" },
          ],
        },
      },
      {
        timestamp: "2026-03-09T00:00:03.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "codex-call-1",
          name: "read_file",
          arguments: "{\"path\":\"README.md\"}",
        },
      },
      {
        timestamp: "2026-03-09T00:00:04.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "codex-call-1",
          output: "README.md loaded",
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(claudeDir, "conversation.jsonl"),
    [
      {
        timestamp: "2026-03-09T01:00:00.000Z",
        type: "user",
        cwd: "/workspace/claude",
        parentUuid: "claude-parent-1",
        message: {
          role: "user",
          content: [{ type: "text", text: "Review the probe output." }],
        },
      },
      {
        timestamp: "2026-03-09T01:00:01.000Z",
        type: "assistant",
        cwd: "/workspace/claude",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Probe output looks healthy." },
            {
              type: "tool_use",
              id: "claude-tool-1",
              name: "shell",
              input: { cmd: "pwd" },
            },
            {
              type: "tool_result",
              tool_use_id: "claude-tool-1",
              content: [{ type: "text", text: "/workspace/claude" }],
            },
            { type: "image", url: "file:///tmp/claude.png" },
          ],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(factoryDir, "session.jsonl"),
    [
      {
        timestamp: "2026-03-09T02:00:00.000Z",
        type: "session_start",
        sessionTitle: "Factory session",
        cwd: "/workspace/factory",
      },
      {
        timestamp: "2026-03-09T02:00:01.000Z",
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "Run the build safely." }],
        },
      },
      {
        timestamp: "2026-03-09T02:00:02.000Z",
        type: "message",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Running a scoped build now." },
            { type: "thinking", thinking: "Checking package boundaries." },
            {
              type: "tool_use",
              id: "factory-tool-1",
              name: "shell",
              input: { cmd: "pnpm --filter @cchistory/api build" },
            },
            {
              type: "tool_result",
              tool_use_id: "factory-tool-1",
              content: [{ type: "text", text: "Build complete." }],
            },
            { type: "diagram", title: "unsupported" },
          ],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(factoryDir, "session.settings.json"),
    JSON.stringify({ model: "sonnet-4" }),
    "utf8",
  );

  await writeFile(
    path.join(ampDir, "thread.json"),
    JSON.stringify({
      id: "amp-thread-1",
      created: 1741492800000,
      title: "AMP thread",
      env: {
        initial: {
          trees: [{ uri: "file:///workspace/amp", displayName: "amp" }],
        },
      },
      messages: [
        {
          timestamp: "2026-03-09T03:00:01.000Z",
          role: "user",
          content: [{ type: "text", text: "Summarize the current plan." }],
        },
        {
          timestamp: "2026-03-09T03:00:02.000Z",
          role: "assistant",
          content: [
            { type: "text", text: "Validation comes before integration." },
            {
              type: "tool_use",
              id: "amp-tool-1",
              name: "search",
              input: { query: "implementation plan" },
            },
            {
              type: "tool_result",
              tool_use_id: "amp-tool-1",
              content: [{ type: "text", text: "docs/IMPLEMENTATION_PLAN.md" }],
            },
            { type: "chart", data: [] },
          ],
        },
      ],
    }),
    "utf8",
  );

  return [
    createSourceDefinition("src-codex-test", "codex", codexDir),
    createSourceDefinition("src-claude-test", "claude_code", claudeDir),
    createSourceDefinition("src-factory-test", "factory_droid", factoryDir),
    createSourceDefinition("src-amp-test", "amp", ampDir),
  ];
}

export async function seedMalformedSourceFixtures(tempRoot: string): Promise<SourceDefinition[]> {
  const codexDir = path.join(tempRoot, "codex-malformed");
  const claudeDir = path.join(tempRoot, "claude-malformed");
  const factoryDir = path.join(tempRoot, "factory-malformed");
  const ampDir = path.join(tempRoot, "amp-malformed");

  await mkdir(codexDir, { recursive: true });
  await mkdir(claudeDir, { recursive: true });
  await mkdir(factoryDir, { recursive: true });
  await mkdir(ampDir, { recursive: true });

  await writeFile(
    path.join(codexDir, "broken-session.jsonl"),
    '{"timestamp":"2026-03-09T04:00:00.000Z","type":"response_item"',
    "utf8",
  );

  await writeFile(
    path.join(claudeDir, "unsupported.jsonl"),
    JSON.stringify({
      timestamp: "2026-03-09T05:00:00.000Z",
      type: "assistant",
      cwd: "/workspace/claude-malformed",
      message: {
        role: "assistant",
        content: [{ type: "image", url: "file:///tmp/unsupported.png" }],
      },
    }),
    "utf8",
  );

  await writeFile(
    path.join(factoryDir, "missing-fields.jsonl"),
    [
      {
        timestamp: "2026-03-09T06:00:00.000Z",
        type: "session_start",
        sessionTitle: "Factory malformed",
        cwd: "/workspace/factory-malformed",
      },
      {
        timestamp: "2026-03-09T06:00:01.000Z",
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "tool_result" }],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );
  await writeFile(path.join(factoryDir, "missing-fields.settings.json"), JSON.stringify({}), "utf8");

  await writeFile(path.join(ampDir, "broken-thread.json"), "{not valid json", "utf8");

  return [
    createSourceDefinition("src-codex-malformed", "codex", codexDir),
    createSourceDefinition("src-claude-malformed", "claude_code", claudeDir),
    createSourceDefinition("src-factory-malformed", "factory_droid", factoryDir),
    createSourceDefinition("src-amp-malformed", "amp", ampDir),
  ];
}

export async function seedMultiTurnCodexFixture(tempRoot: string): Promise<SourceDefinition> {
  const codexDir = path.join(tempRoot, "codex-multi-turn");
  await mkdir(codexDir, { recursive: true });

  await writeFile(
    path.join(codexDir, "rollout-2026-03-09T00-00-00-codex-fixture.jsonl"),
    [
      {
        timestamp: "2026-03-09T07:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "codex-multi-turn-session",
          cwd: "/workspace/multi-turn",
          model: "gpt-5",
        },
      },
      {
        timestamp: "2026-03-09T07:00:00.500Z",
        type: "turn_context",
        payload: {
          cwd: "/workspace/multi-turn",
          model: "gpt-5",
        },
      },
      {
        timestamp: "2026-03-09T07:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "[Assistant Rules - hidden]\n[User Request]\nShip the fix.",
            },
          ],
        },
      },
      {
        timestamp: "2026-03-09T07:00:01.500Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Also cover tests." }],
        },
      },
      {
        timestamp: "2026-03-09T07:00:02.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "I will patch it." }],
        },
      },
      {
        timestamp: "2026-03-09T07:00:02.500Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "codex-multi-call-1",
          name: "read_file",
          arguments: "{\"path\":\"tasks.csv\"}",
        },
      },
      {
        timestamp: "2026-03-09T07:00:03.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "codex-multi-call-1",
          output: "tasks.csv loaded",
        },
      },
      {
        timestamp: "2026-03-09T07:00:04.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "What's next?" }],
        },
      },
      {
        timestamp: "2026-03-09T07:00:05.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Validate the API route." }],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );

  return createSourceDefinition("src-codex-multi-turn", "codex", codexDir);
}

export async function seedCodexInjectedScaffoldFixture(tempRoot: string): Promise<SourceDefinition> {
  const codexDir = path.join(tempRoot, "codex-injected-scaffold");
  await mkdir(codexDir, { recursive: true });

  await writeFile(
    path.join(codexDir, "rollout-2026-03-09T00-00-00-codex-fixture.jsonl"),
    [
      {
        timestamp: "2026-03-09T08:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "codex-injected-scaffold-session",
          cwd: "/workspace/injected-scaffold",
          model: "gpt-5",
        },
      },
      {
        timestamp: "2026-03-09T08:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "# AGENTS.md instructions for /workspace/injected-scaffold\n\n<INSTRUCTIONS>\nBe precise.\n</INSTRUCTIONS>\n\n<environment_context>\n  <cwd>/workspace/injected-scaffold</cwd>\n  <shell>zsh</shell>\n</environment_context>\n\nPlease review the patch plan only.",
            },
          ],
        },
      },
      {
        timestamp: "2026-03-09T08:00:02.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "I will review the plan." }],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );

  return createSourceDefinition("src-codex-injected-scaffold", "codex", codexDir);
}

export async function seedCodexInjectedOnlyFixture(tempRoot: string): Promise<SourceDefinition> {
  const codexDir = path.join(tempRoot, "codex-injected-only");
  await mkdir(codexDir, { recursive: true });

  await writeFile(
    path.join(codexDir, "rollout-2026-03-09T00-00-00-codex-fixture.jsonl"),
    [
      {
        timestamp: "2026-03-09T08:10:00.000Z",
        type: "session_meta",
        payload: {
          id: "codex-injected-only-session",
          cwd: "/workspace/injected-only",
          model: "gpt-5",
        },
      },
      {
        timestamp: "2026-03-09T08:10:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "# AGENTS.md instructions for /workspace/injected-only\n\n<INSTRUCTIONS>\nBe precise.\n</INSTRUCTIONS>\n\n<environment_context>\n  <cwd>/workspace/injected-only</cwd>\n  <shell>zsh</shell>\n</environment_context>",
            },
          ],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );

  return createSourceDefinition("src-codex-injected-only", "codex", codexDir);
}

export async function seedClaudeInterruptedFixture(tempRoot: string): Promise<SourceDefinition> {
  const claudeDir = path.join(tempRoot, "claude-interrupted");
  await mkdir(claudeDir, { recursive: true });

  await writeFile(
    path.join(claudeDir, "conversation.jsonl"),
    [
      {
        timestamp: "2026-03-09T08:00:00.000Z",
        type: "user",
        cwd: "/workspace/claude-interrupted",
        message: {
          role: "user",
          content: [{ type: "text", text: "Ship the fix." }],
        },
      },
      {
        timestamp: "2026-03-09T08:00:02.000Z",
        type: "assistant",
        cwd: "/workspace/claude-interrupted",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "I will patch it." }],
        },
      },
      {
        timestamp: "2026-03-09T08:00:03.000Z",
        type: "user",
        cwd: "/workspace/claude-interrupted",
        message: {
          role: "user",
          content: [{ type: "text", text: "[Request interrupted by user]" }],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );

  return createSourceDefinition("src-claude-interrupted", "claude_code", claudeDir);
}

export async function seedWindowsNormalizedWorkspaceFixtures(tempRoot: string): Promise<SourceDefinition[]> {
  const codexDir = path.join(tempRoot, "codex-win-normalized");
  const claudeDir = path.join(tempRoot, "claude-win-normalized");
  const factoryDir = path.join(tempRoot, "factory-win-normalized");
  const ampDir = path.join(tempRoot, "amp-win-normalized");

  await mkdir(codexDir, { recursive: true });
  await mkdir(claudeDir, { recursive: true });
  await mkdir(factoryDir, { recursive: true });
  await mkdir(ampDir, { recursive: true });

  await writeFile(
    path.join(codexDir, "rollout-2026-03-09T00-00-00-codex-fixture.jsonl"),
    [
      {
        timestamp: "2026-03-09T10:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "codex-win-normalized-session",
          cwd: "C:\\Users\\dev\\workspace\\normalized-project\\",
          model: "gpt-5",
        },
      },
      {
        timestamp: "2026-03-09T10:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Normalize Windows codex paths." }],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(claudeDir, "conversation.jsonl"),
    [
      {
        timestamp: "2026-03-09T10:10:00.000Z",
        type: "user",
        cwd: "file:///C:/Users/dev/workspace/normalized-project/./",
        message: {
          role: "user",
          content: [{ type: "text", text: "Normalize Windows claude paths." }],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(factoryDir, "session.jsonl"),
    [
      {
        timestamp: "2026-03-09T10:20:00.000Z",
        type: "session_start",
        sessionTitle: "Factory Windows normalized",
        cwd: "file://localhost/C:/Users/dev/workspace/normalized-project/subdir/..",
      },
      {
        timestamp: "2026-03-09T10:20:01.000Z",
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "Normalize Windows factory paths." }],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );
  await writeFile(path.join(factoryDir, "session.settings.json"), JSON.stringify({ model: "sonnet-4" }), "utf8");

  await writeFile(
    path.join(ampDir, "thread.json"),
    JSON.stringify({
      id: "amp-win-normalized-thread",
      created: 1741492800000,
      title: "AMP Windows normalized",
      env: {
        initial: {
          trees: [{ uri: "file:///C:/Users/dev/workspace/normalized-project/", displayName: "normalized" }],
        },
      },
      messages: [
        {
          timestamp: "2026-03-09T10:30:01.000Z",
          role: "user",
          content: [{ type: "text", text: "Normalize Windows amp paths." }],
        },
      ],
    }),
    "utf8",
  );

  return [
    createSourceDefinition("src-codex-win-normalized", "codex", codexDir),
    createSourceDefinition("src-claude-win-normalized", "claude_code", claudeDir),
    createSourceDefinition("src-factory-win-normalized", "factory_droid", factoryDir),
    createSourceDefinition("src-amp-win-normalized", "amp", ampDir),
  ];
}

export async function seedNormalizedWorkspaceFixtures(tempRoot: string): Promise<SourceDefinition[]> {
  const codexDir = path.join(tempRoot, "codex-normalized");
  const claudeDir = path.join(tempRoot, "claude-normalized");
  const factoryDir = path.join(tempRoot, "factory-normalized");
  const ampDir = path.join(tempRoot, "amp-normalized");

  await mkdir(codexDir, { recursive: true });
  await mkdir(claudeDir, { recursive: true });
  await mkdir(factoryDir, { recursive: true });
  await mkdir(ampDir, { recursive: true });

  await writeFile(
    path.join(codexDir, "rollout-2026-03-09T00-00-00-codex-fixture.jsonl"),
    [
      {
        timestamp: "2026-03-09T10:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "codex-normalized-session",
          cwd: "/workspace/normalized-project/",
          model: "gpt-5",
        },
      },
      {
        timestamp: "2026-03-09T10:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Normalize codex paths." }],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(claudeDir, "conversation.jsonl"),
    [
      {
        timestamp: "2026-03-09T10:10:00.000Z",
        type: "user",
        cwd: "/workspace/normalized-project/./",
        message: {
          role: "user",
          content: [{ type: "text", text: "Normalize claude paths." }],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(factoryDir, "session.jsonl"),
    [
      {
        timestamp: "2026-03-09T10:20:00.000Z",
        type: "session_start",
        sessionTitle: "Factory normalized",
        cwd: "/workspace/normalized-project/subdir/..",
      },
      {
        timestamp: "2026-03-09T10:20:01.000Z",
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "Normalize factory paths." }],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );
  await writeFile(path.join(factoryDir, "session.settings.json"), JSON.stringify({ model: "sonnet-4" }), "utf8");

  await writeFile(
    path.join(ampDir, "thread.json"),
    JSON.stringify({
      id: "amp-normalized-thread",
      created: 1741492800000,
      title: "AMP normalized",
      env: {
        initial: {
          trees: [{ uri: "file:///workspace/normalized-project/", displayName: "normalized" }],
        },
      },
      messages: [
        {
          timestamp: "2026-03-09T10:30:01.000Z",
          role: "user",
          content: [{ type: "text", text: "Normalize amp paths." }],
        },
      ],
    }),
    "utf8",
  );

  return [
    createSourceDefinition("src-codex-normalized", "codex", codexDir),
    createSourceDefinition("src-claude-normalized", "claude_code", claudeDir),
    createSourceDefinition("src-factory-normalized", "factory_droid", factoryDir),
    createSourceDefinition("src-amp-normalized", "amp", ampDir),
  ];
}

export async function seedRepoEvidenceFixtures(tempRoot: string): Promise<SourceDefinition[]> {
  const repoRoot = path.join(tempRoot, "git-project");
  const repoWorkspace = path.join(repoRoot, "packages", "app");
  await mkdir(repoWorkspace, { recursive: true });
  await initGitRepo(repoRoot, "https://example.com/org/normalized-project.git");

  const codexDir = path.join(tempRoot, "codex-repo");
  const claudeDir = path.join(tempRoot, "claude-repo");
  const factoryDir = path.join(tempRoot, "factory-repo");
  const ampDir = path.join(tempRoot, "amp-repo");

  await mkdir(codexDir, { recursive: true });
  await mkdir(claudeDir, { recursive: true });
  await mkdir(factoryDir, { recursive: true });
  await mkdir(ampDir, { recursive: true });

  await writeFile(
    path.join(codexDir, "rollout-2026-03-09T00-00-00-codex-fixture.jsonl"),
    [
      {
        timestamp: "2026-03-09T11:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "codex-repo-session",
          cwd: `${repoWorkspace}/`,
          model: "gpt-5",
        },
      },
      {
        timestamp: "2026-03-09T11:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Collect repo evidence." }],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(claudeDir, "conversation.jsonl"),
    [
      {
        timestamp: "2026-03-09T11:10:00.000Z",
        type: "user",
        cwd: `${repoWorkspace}/./`,
        message: {
          role: "user",
          content: [{ type: "text", text: "Collect claude repo evidence." }],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(factoryDir, "session.jsonl"),
    [
      {
        timestamp: "2026-03-09T11:20:00.000Z",
        type: "session_start",
        sessionTitle: "Factory repo evidence",
        cwd: path.join(repoWorkspace, "..", "app"),
      },
      {
        timestamp: "2026-03-09T11:20:01.000Z",
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "Collect factory repo evidence." }],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );
  await writeFile(path.join(factoryDir, "session.settings.json"), JSON.stringify({ model: "sonnet-4" }), "utf8");

  await writeFile(
    path.join(ampDir, "thread.json"),
    JSON.stringify({
      id: "amp-repo-thread",
      created: 1741492800000,
      title: "AMP repo evidence",
      env: {
        initial: {
          trees: [{ uri: `file://${repoWorkspace}/`, displayName: "normalized" }],
        },
      },
      messages: [
        {
          timestamp: "2026-03-09T11:30:01.000Z",
          role: "user",
          content: [{ type: "text", text: "Collect amp repo evidence." }],
        },
      ],
    }),
    "utf8",
  );

  return [
    createSourceDefinition("src-codex-repo", "codex", codexDir),
    createSourceDefinition("src-claude-repo", "claude_code", claudeDir),
    createSourceDefinition("src-factory-repo", "factory_droid", factoryDir),
    createSourceDefinition("src-amp-repo", "amp", ampDir),
  ];
}

export async function seedTokenProjectionFixtures(tempRoot: string): Promise<SourceDefinition[]> {
  const codexDir = path.join(tempRoot, "codex-tokens");
  const claudeDir = path.join(tempRoot, "claude-tokens");
  const factoryDir = path.join(tempRoot, "factory-tokens");
  const ampDir = path.join(tempRoot, "amp-tokens");

  await mkdir(codexDir, { recursive: true });
  await mkdir(claudeDir, { recursive: true });
  await mkdir(factoryDir, { recursive: true });
  await mkdir(ampDir, { recursive: true });

  await writeFile(
    path.join(codexDir, "rollout-2026-03-09T00-00-00-codex-fixture.jsonl"),
    [
      {
        timestamp: "2026-03-10T00:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "codex-token-session",
          cwd: "/workspace/codex-token",
          model: "gpt-5",
        },
      },
      {
        timestamp: "2026-03-10T00:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Count the codex tokens." }],
        },
      },
      {
        timestamp: "2026-03-10T00:00:02.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          stop_reason: "end_turn",
          content: [{ type: "output_text", text: "Codex token event recorded." }],
        },
      },
      {
        timestamp: "2026-03-10T00:00:03.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 12,
              cached_input_tokens: 5,
              output_tokens: 8,
              reasoning_output_tokens: 3,
              total_tokens: 20,
            },
          },
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(claudeDir, "conversation.jsonl"),
    [
      {
        timestamp: "2026-03-10T01:00:00.000Z",
        type: "user",
        cwd: "/workspace/claude-token",
        message: {
          role: "user",
          content: [{ type: "text", text: "Count the claude tokens." }],
        },
      },
      {
        timestamp: "2026-03-10T01:00:01.000Z",
        type: "assistant",
        cwd: "/workspace/claude-token",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          stop_reason: "tool_use",
          usage: {
            input_tokens: 30,
            cache_creation_input_tokens: 5,
            cache_read_input_tokens: 2,
            output_tokens: 10,
          },
          content: [{ type: "text", text: "Claude token usage attached." }],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(factoryDir, "session.jsonl"),
    [
      {
        timestamp: "2026-03-10T02:00:00.000Z",
        type: "session_start",
        sessionTitle: "Factory tokens",
        cwd: "/workspace/factory-token",
      },
      {
        timestamp: "2026-03-10T02:00:01.000Z",
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "Count the factory tokens." }],
        },
      },
      {
        timestamp: "2026-03-10T02:00:02.000Z",
        type: "message",
        message: {
          role: "assistant",
          model: "claude-opus-4-6",
          stop_reason: "end_turn",
          usage: {
            inputTokens: 9,
            outputTokens: 6,
            cacheCreationTokens: 1,
            cacheReadTokens: 2,
            thinkingTokens: 3,
          },
          content: [{ type: "text", text: "Factory token usage attached." }],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );
  await writeFile(path.join(factoryDir, "session.settings.json"), JSON.stringify({ model: "sonnet-4" }), "utf8");

  await writeFile(
    path.join(ampDir, "thread.json"),
    JSON.stringify({
      id: "amp-token-thread",
      created: 1741492800000,
      title: "AMP tokens",
      env: {
        initial: {
          trees: [{ uri: "file:///workspace/amp-token", displayName: "amp-token" }],
        },
      },
      messages: [
        {
          timestamp: "2026-03-10T03:00:01.000Z",
          role: "user",
          content: [{ type: "text", text: "Count the amp tokens." }],
        },
        {
          timestamp: "2026-03-10T03:00:02.000Z",
          role: "assistant",
          stopReason: "max_tokens",
          usage: {
            model: "claude-opus-4-6",
            inputTokens: 14,
            outputTokens: 7,
            cacheCreationInputTokens: 2,
            cacheReadInputTokens: 1,
          },
          content: [{ type: "text", text: "AMP token usage attached." }],
        },
      ],
    }),
    "utf8",
  );

  return [
    createSourceDefinition("src-codex-tokens", "codex", codexDir),
    createSourceDefinition("src-claude-tokens", "claude_code", claudeDir),
    createSourceDefinition("src-factory-tokens", "factory_droid", factoryDir),
    createSourceDefinition("src-amp-tokens", "amp", ampDir),
  ];
}

export async function seedClaudeModelSwitchFixture(tempRoot: string): Promise<SourceDefinition> {
  const claudeDir = path.join(tempRoot, "claude-model-switch");
  await mkdir(claudeDir, { recursive: true });

  await writeFile(
    path.join(claudeDir, "conversation.jsonl"),
    [
      {
        timestamp: "2026-03-10T04:00:00.000Z",
        type: "user",
        cwd: "/workspace/claude-model-switch",
        message: {
          role: "user",
          content: [{ type: "text", text: "Handle the first turn." }],
        },
      },
      {
        timestamp: "2026-03-10T04:00:01.000Z",
        type: "assistant",
        cwd: "/workspace/claude-model-switch",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          stop_reason: "end_turn",
          usage: {
            input_tokens: 10,
            output_tokens: 4,
          },
          content: [{ type: "text", text: "First Claude reply." }],
        },
      },
      {
        timestamp: "2026-03-10T04:00:02.000Z",
        type: "user",
        cwd: "/workspace/claude-model-switch",
        message: {
          role: "user",
          content: [{ type: "text", text: "Handle the second turn." }],
        },
      },
      {
        timestamp: "2026-03-10T04:00:03.000Z",
        type: "assistant",
        cwd: "/workspace/claude-model-switch",
        message: {
          role: "assistant",
          model: "claude-opus-4-6",
          stop_reason: "end_turn",
          usage: {
            input_tokens: 20,
            output_tokens: 8,
          },
          content: [{ type: "text", text: "Second Claude reply." }],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );

  return createSourceDefinition("src-claude-model-switch", "claude_code", claudeDir);
}

export async function seedMultiTurnCodexTokenFixture(tempRoot: string): Promise<SourceDefinition> {
  const codexDir = path.join(tempRoot, "codex-token-checkpoints");
  await mkdir(codexDir, { recursive: true });

  await writeFile(
    path.join(codexDir, "rollout-2026-03-09T00-00-00-codex-fixture.jsonl"),
    [
      {
        timestamp: "2026-03-10T04:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "codex-token-checkpoints-session",
          cwd: "/workspace/codex-token-checkpoints",
          model: "gpt-5",
        },
      },
      {
        timestamp: "2026-03-10T04:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "First tokenized turn." }],
        },
      },
      {
        timestamp: "2026-03-10T04:00:02.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          stop_reason: "end_turn",
          content: [{ type: "output_text", text: "First answer." }],
        },
      },
      {
        timestamp: "2026-03-10T04:00:02.500Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 40,
              cached_input_tokens: 20,
              output_tokens: 5,
              total_tokens: 45,
            },
          },
        },
      },
      {
        timestamp: "2026-03-10T04:00:03.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 120,
              cached_input_tokens: 90,
              output_tokens: 15,
              total_tokens: 135,
            },
          },
        },
      },
      {
        timestamp: "2026-03-10T04:00:04.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Second tokenized turn." }],
        },
      },
      {
        timestamp: "2026-03-10T04:00:05.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          stop_reason: "end_turn",
          content: [{ type: "output_text", text: "Second answer." }],
        },
      },
      {
        timestamp: "2026-03-10T04:00:05.500Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 70,
              cached_input_tokens: 30,
              output_tokens: 8,
              total_tokens: 78,
            },
          },
        },
      },
      {
        timestamp: "2026-03-10T04:00:06.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 210,
              cached_input_tokens: 150,
              output_tokens: 25,
              total_tokens: 235,
            },
          },
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );

  return createSourceDefinition("src-codex-token-checkpoints", "codex", codexDir);
}

export async function seedMultiReplyCodexTokenFixture(tempRoot: string): Promise<SourceDefinition> {
  const codexDir = path.join(tempRoot, "codex-token-multi-reply");
  await mkdir(codexDir, { recursive: true });

  await writeFile(
    path.join(codexDir, "rollout-2026-03-09T00-00-00-codex-fixture.jsonl"),
    [
      {
        timestamp: "2026-03-10T05:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "codex-token-multi-reply-session",
          cwd: "/workspace/codex-token-multi-reply",
          model: "gpt-5",
        },
      },
      {
        timestamp: "2026-03-10T05:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Keep working on the same turn." }],
        },
      },
      {
        timestamp: "2026-03-10T05:00:02.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          stop_reason: "end_turn",
          usage: {
            input_tokens: 12,
            cached_input_tokens: 5,
            output_tokens: 2,
            total_tokens: 14,
          },
          content: [{ type: "output_text", text: "First reply." }],
        },
      },
      {
        timestamp: "2026-03-10T05:00:02.500Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 40,
              cached_input_tokens: 20,
              output_tokens: 5,
              total_tokens: 45,
            },
            last_token_usage: {
              input_tokens: 40,
              cached_input_tokens: 20,
              output_tokens: 5,
              total_tokens: 45,
            },
          },
        },
      },
      {
        timestamp: "2026-03-10T05:00:03.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 120,
              cached_input_tokens: 90,
              output_tokens: 15,
              total_tokens: 135,
            },
            last_token_usage: {
              input_tokens: 120,
              cached_input_tokens: 90,
              output_tokens: 15,
              total_tokens: 135,
            },
          },
        },
      },
      {
        timestamp: "2026-03-10T05:00:04.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          stop_reason: "end_turn",
          content: [{ type: "output_text", text: "Second reply." }],
        },
      },
      {
        timestamp: "2026-03-10T05:00:04.500Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 190,
              cached_input_tokens: 120,
              output_tokens: 23,
              total_tokens: 213,
            },
            last_token_usage: {
              input_tokens: 70,
              cached_input_tokens: 30,
              output_tokens: 8,
              total_tokens: 78,
            },
          },
        },
      },
      {
        timestamp: "2026-03-10T05:00:05.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 330,
              cached_input_tokens: 240,
              output_tokens: 40,
              total_tokens: 370,
            },
            last_token_usage: {
              input_tokens: 210,
              cached_input_tokens: 150,
              output_tokens: 25,
              total_tokens: 235,
            },
          },
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );

  return createSourceDefinition("src-codex-token-multi-reply", "codex", codexDir);
}

export async function seedCodexCumulativeTokenFixture(tempRoot: string): Promise<SourceDefinition> {
  const codexDir = path.join(tempRoot, "codex-token-cumulative");
  await mkdir(codexDir, { recursive: true });

  await writeFile(
    path.join(codexDir, "rollout-2026-03-09T00-00-00-codex-fixture.jsonl"),
    [
      {
        timestamp: "2026-03-10T06:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "codex-token-cumulative-session",
          cwd: "/workspace/codex-token-cumulative",
          model: "gpt-5",
        },
      },
      {
        timestamp: "2026-03-10T06:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Track the hidden billed work." }],
        },
      },
      {
        timestamp: "2026-03-10T06:00:02.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          stop_reason: "end_turn",
          content: [{ type: "output_text", text: "One visible reply." }],
        },
      },
      {
        timestamp: "2026-03-10T06:00:02.500Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 40,
              cached_input_tokens: 20,
              output_tokens: 5,
              total_tokens: 45,
            },
            last_token_usage: {
              input_tokens: 40,
              cached_input_tokens: 20,
              output_tokens: 5,
              total_tokens: 45,
            },
          },
        },
      },
      {
        timestamp: "2026-03-10T06:00:03.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 80,
              cached_input_tokens: 40,
              output_tokens: 10,
              total_tokens: 90,
            },
            last_token_usage: {
              input_tokens: 40,
              cached_input_tokens: 20,
              output_tokens: 5,
              total_tokens: 45,
            },
          },
        },
      },
      {
        timestamp: "2026-03-10T06:00:03.500Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 120,
              cached_input_tokens: 60,
              output_tokens: 15,
              total_tokens: 135,
            },
            last_token_usage: {
              input_tokens: 40,
              cached_input_tokens: 20,
              output_tokens: 5,
              total_tokens: 45,
            },
          },
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );

  return createSourceDefinition("src-codex-token-cumulative", "codex", codexDir);
}

export async function seedExpandedSourceFixtures(tempRoot: string): Promise<SourceDefinition[]> {
  const cursorDir = path.join(tempRoot, "cursor", "workspaceStorage", "cursor-workspace");
  const antigravityDir = path.join(tempRoot, "antigravity", "User");
  const antigravityGlobalDir = path.join(antigravityDir, "globalStorage");
  const openclawDir = path.join(tempRoot, "openclaw", "agent-a", "sessions");
  const opencodeRoot = path.join(tempRoot, "opencode");
  const opencodeStorageRoot = path.join(opencodeRoot, "storage");
  const opencodeSessionDir = path.join(opencodeStorageRoot, "session", "global");
  const opencodeMessageDir = path.join(opencodeStorageRoot, "message", "opencode-fixture");
  const opencodeUserPartDir = path.join(opencodeStorageRoot, "part", "opencode-user-1");
  const opencodeAssistantPartDir = path.join(opencodeStorageRoot, "part", "opencode-assistant-1");
  const opencodeTodoDir = path.join(opencodeStorageRoot, "todo");
  const opencodeSessionDiffDir = path.join(opencodeStorageRoot, "session_diff");
  const lobechatDir = path.join(tempRoot, "lobechat");
  const geminiRoot = path.join(tempRoot, ".gemini");
  const geminiChatDir = path.join(geminiRoot, "tmp", "gemini-fixture", "chats");
  const geminiHistoryDir = path.join(geminiRoot, "history", "gemini-fixture");

  await mkdir(cursorDir, { recursive: true });
  await mkdir(antigravityGlobalDir, { recursive: true });
  await mkdir(openclawDir, { recursive: true });
  await mkdir(opencodeSessionDir, { recursive: true });
  await mkdir(opencodeMessageDir, { recursive: true });
  await mkdir(opencodeUserPartDir, { recursive: true });
  await mkdir(opencodeAssistantPartDir, { recursive: true });
  await mkdir(opencodeTodoDir, { recursive: true });
  await mkdir(opencodeSessionDiffDir, { recursive: true });
  await mkdir(lobechatDir, { recursive: true });
  await mkdir(geminiChatDir, { recursive: true });
  await mkdir(geminiHistoryDir, { recursive: true });

  seedCursorStyleStateDb(path.join(cursorDir, "state.vscdb"), {
    workspacePath: "/workspace/cursor",
    composerId: "cursor-fixture",
    title: "Cursor fixture",
    storageMode: "composerData",
  });
  await writeFile(path.join(cursorDir, "workspace.json"), JSON.stringify({ folder: "/workspace/cursor" }), "utf8");

  seedAntigravityTrajectoryStateDb(path.join(antigravityGlobalDir, "state.vscdb"), {
    trajectoryId: "antigravity-fixture",
    title: "Antigravity fixture",
    workspacePath: "/workspace/antigravity",
    createdAt: "2026-03-10T03:29:59.000Z",
    updatedAt: "2026-03-10T03:30:01.000Z",
  });

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
        type: "thinking_level_change",
        id: "openclaw-thinking-1",
        parentId: "openclaw-model-1",
        timestamp: "2026-03-10T04:00:00.002Z",
        thinkingLevel: "low",
      },
      {
        type: "custom",
        customType: "model-snapshot",
        data: { timestamp: 1773115200003, provider: "zai", modelId: "glm-5-turbo" },
        id: "openclaw-snapshot-1",
        parentId: "openclaw-thinking-1",
        timestamp: "2026-03-10T04:00:00.003Z",
      },
      {
        type: "message",
        id: "openclaw-user-1",
        parentId: "openclaw-snapshot-1",
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
      text: "Inspect OpenCode history.",
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
        output: "<file>\n00001| OpenCode history loaded.\n</file>",
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
      text: "OpenCode history loaded.",
    }),
    "utf8",
  );
  await writeFile(path.join(opencodeSessionDiffDir, "opencode-fixture.json"), "[]\n", "utf8");
  await writeFile(
    path.join(opencodeTodoDir, "opencode-fixture.json"),
    JSON.stringify([{ id: "todo-1", content: "Capture supporting checklist", status: "pending" }]),
    "utf8",
  );

  await writeFile(
    path.join(geminiRoot, "projects.json"),
    JSON.stringify({
      projects: {
        "/workspace/gemini-fixture": "gemini-fixture",
      },
    }),
    "utf8",
  );
  await writeFile(path.join(geminiRoot, "tmp", "gemini-fixture", ".project_root"), "/workspace/gemini-fixture\n", "utf8");
  await writeFile(path.join(geminiHistoryDir, ".project_root"), "/workspace/gemini-fixture\n", "utf8");
  await writeFile(
    path.join(geminiChatDir, "session-2026-03-10T07-00-gemini-fixture.json"),
    JSON.stringify({
      sessionId: "gemini-fixture",
      projectHash: "abc123",
      startTime: "2026-03-10T07:00:00.000Z",
      lastUpdated: "2026-03-10T07:00:01.000Z",
      messages: [
        {
          id: "gemini-user-1",
          timestamp: "2026-03-10T07:00:00.000Z",
          type: "user",
          content: [{ text: "Inspect Gemini CLI history." }],
        },
        {
          id: "gemini-assistant-1",
          timestamp: "2026-03-10T07:00:01.000Z",
          type: "assistant",
          content: [{ text: "Gemini CLI history loaded." }],
        },
      ],
    }),
    "utf8",
  );

  await writeFile(
    path.join(lobechatDir, "lobechat-export.json"),
    JSON.stringify({
      id: "lobechat-fixture",
      title: "LobeChat fixture",
      model: "gpt-4.1",
      messages: [
        {
          id: "lobechat-user-1",
          role: "user",
          createdAt: "2026-03-10T06:00:00.000Z",
          content: "Inspect LobeChat history.",
        },
        {
          id: "lobechat-assistant-1",
          role: "assistant",
          createdAt: "2026-03-10T06:00:01.000Z",
          usage: {
            inputTokens: 11,
            outputTokens: 4,
            totalTokens: 15,
          },
          stopReason: "end_turn",
          content: "LobeChat history loaded.",
        },
      ],
    }),
    "utf8",
  );

  return [
    createSourceDefinition("src-cursor-fixture", "cursor", path.join(tempRoot, "cursor")),
    createSourceDefinition("src-antigravity-fixture", "antigravity", antigravityDir),
    createSourceDefinition("src-gemini-fixture", "gemini", geminiRoot),
    createSourceDefinition("src-openclaw-fixture", "openclaw", path.join(tempRoot, "openclaw")),
    createSourceDefinition("src-opencode-fixture", "opencode", opencodeStorageRoot),
    createSourceDefinition("src-lobechat-fixture", "lobechat", lobechatDir, "conversational_export"),
  ];
}

export function seedCursorStyleStateDb(
  dbPath: string,
  options: {
    workspacePath: string;
    composerId: string;
    title: string;
    storageMode: "composerData" | "composerRoot";
  },
): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB NOT NULL)");
    const insert = db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)");
    const composer = {
      composerId: options.composerId,
      title: options.title,
      bubbleIds: [`${options.composerId}-user`, `${options.composerId}-assistant`],
    };

    if (options.storageMode === "composerData") {
      insert.run(`composerData:${options.composerId}`, JSON.stringify(composer));
    } else {
      insert.run("composer.composerData", JSON.stringify({ allComposers: [composer] }));
    }

    insert.run(
      `bubbleId:${options.composerId}-user`,
      JSON.stringify({
        bubbleId: `${options.composerId}-user`,
        type: 1,
        createdAt: "2026-03-10T03:30:00.000Z",
        text: `Inspect ${options.title}.`,
      }),
    );
    insert.run(
      `bubbleId:${options.composerId}-assistant`,
      JSON.stringify({
        bubbleId: `${options.composerId}-assistant`,
        type: 2,
        createdAt: "2026-03-10T03:30:01.000Z",
        text: `${options.title} loaded.`,
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        stopReason: "end_turn",
      }),
    );
  } finally {
    db.close();
  }
}

export function seedCursorPromptHistoryDb(
  dbPath: string,
  options: {
    title: string;
    prompt: string;
    observedAt: string;
  },
): void {
  const observedAtMs = Date.parse(options.observedAt);
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB NOT NULL)");
    const insert = db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)");
    insert.run(
      "composer.composerData",
      JSON.stringify({
        allComposers: [
          {
            composerId: "cursor-prompt-history",
            name: options.title,
            lastUpdatedAt: observedAtMs,
            createdAt: observedAtMs,
          },
        ],
      }),
    );
    insert.run(
      "aiService.generations",
      JSON.stringify([
        {
          unixMs: observedAtMs,
          generationUUID: "cursor-prompt-history-gen-1",
          type: "composer",
          textDescription: options.prompt,
        },
      ]),
    );
    insert.run(
      "aiService.prompts",
      JSON.stringify([
        {
          text: options.prompt,
          commandType: 4,
        },
      ]),
    );
  } finally {
    db.close();
  }
}

export function seedAntigravityTrajectoryStateDb(
  dbPath: string,
  options: {
    trajectoryId: string;
    title: string;
    workspacePath: string;
    createdAt: string;
    updatedAt: string;
  },
): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB NOT NULL)");
    const insert = db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)");
    insert.run(
      "antigravityUnifiedStateSync.trajectorySummaries",
      encodeAntigravityTrajectorySummary({
        trajectoryId: options.trajectoryId,
        title: options.title,
        workspacePath: options.workspacePath,
        createdAt: options.createdAt,
        updatedAt: options.updatedAt,
      }),
    );
  } finally {
    db.close();
  }
}

export function seedAntigravityHistoryStateDb(
  dbPath: string,
  options: {
    sessionId: string;
    description: string;
    observedAt: string;
  },
): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB NOT NULL)");
    const insert = db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)");
    insert.run(
      "history.entries",
      JSON.stringify([
        {
          editor: {
            resource: `file:///Users/mock_user/.gemini/antigravity/brain/${options.sessionId}/implementation_plan.md.resolved`,
            label: "Implementation Plan",
            description: options.description,
            options: {
              override: "antigravity.artifactsEditorInput",
            },
          },
          timestamp: Date.parse(options.observedAt),
        },
      ]),
    );
  } finally {
    db.close();
  }
}

export function seedAntigravityEmptyStateDb(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB NOT NULL)");
  } finally {
    db.close();
  }
}

export function encodeAntigravityTrajectorySummary(options: {
  trajectoryId: string;
  title: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
}): string {
  const innerPayload = encodeLengthDelimitedFields([
    [1, Buffer.from(options.title, "utf8")],
    [7, encodeTimestamp(options.createdAt)],
    [9, encodeLengthDelimitedFields([[1, Buffer.from(`file://${options.workspacePath}`, "utf8")]])],
    [10, encodeTimestamp(options.updatedAt)],
  ]);
  const wrapper = encodeLengthDelimitedFields([
    [1, Buffer.from(innerPayload.toString("base64"), "utf8")],
    [2, innerPayload.length],
  ]);
  const outer = encodeLengthDelimitedFields([
    [1, Buffer.from(options.trajectoryId, "utf8")],
    [2, wrapper],
  ]);
  return encodeLengthDelimitedFields([[1, outer]]).toString("base64");
}

export function encodeTimestamp(value: string): Buffer {
  const millis = Date.parse(value);
  const seconds = Math.floor(millis / 1000);
  const nanos = (millis % 1000) * 1_000_000;
  return encodeLengthDelimitedFields([
    [1, seconds],
    [2, nanos],
  ]);
}

export function encodeLengthDelimitedFields(fields: Array<[number, Buffer | number]>): Buffer {
  const chunks: Buffer[] = [];
  for (const [fieldNumber, value] of fields) {
    if (typeof value === "number") {
      chunks.push(encodeVarint((fieldNumber << 3) | 0), encodeVarint(value));
      continue;
    }
    chunks.push(encodeVarint((fieldNumber << 3) | 2), encodeVarint(value.length), value);
  }
  return Buffer.concat(chunks);
}

export function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = value >>> 0;
  while (remaining >= 0x80) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  bytes.push(remaining);
  return Buffer.from(bytes);
}

export function createSourceDefinition(
  id: string,
  platform: SourceDefinition["platform"],
  baseDir: string,
  family: SourceDefinition["family"] = "local_coding_agent",
): SourceDefinition {
  return {
    id,
    slot_id: platform,
    family,
    platform,
    display_name: `${platform} fixture`,
    base_dir: baseDir,
  };
}

export function getRepoMockDataRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../mock_data");
}

export async function readStableAdapterValidationManifest(): Promise<StableAdapterValidationManifest> {
  return readJsonFixture<StableAdapterValidationManifest>(
    path.join(getRepoMockDataRoot(), "stable-adapter-validation.json"),
  );
}

export async function readJsonFixture<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export function assertFragmentKinds(
  payload: SourceSyncPayload | undefined,
  expectedKinds: FragmentKind[],
): void {
  assert.ok(payload);
  const fragmentKinds = new Set(payload.fragments.map((fragment) => fragment.fragment_kind));
  for (const fragmentKind of expectedKinds) {
    assert.ok(fragmentKinds.has(fragmentKind), `expected ${payload.source.platform} to emit ${fragmentKind}`);
  }
}

export async function initGitRepo(repoRoot: string, remoteUrl: string): Promise<void> {
  await execFileAsync("git", ["init", repoRoot]);
  await execFileAsync("git", ["-C", repoRoot, "remote", "add", "origin", remoteUrl]);
}

export function assertParserMetadata(payload: SourceSyncPayload): void {
  const knownProfileIds = new Set(getSourceFormatProfiles().map((profile) => profile.id));

  for (const stageRun of payload.stage_runs) {
    assert.ok(stageRun.parser_version, `expected parser version for ${payload.source.platform}:${stageRun.stage_kind}`);
    assert.ok(stageRun.parser_capabilities?.length, `expected parser capabilities for ${payload.source.platform}:${stageRun.stage_kind}`);
    assert.equal(stageRun.source_format_profile_ids?.length, 1);
    assert.ok(
      knownProfileIds.has(stageRun.source_format_profile_ids[0]!),
      `expected known source format profile for ${payload.source.platform}:${stageRun.stage_kind}`,
    );
  }
}
