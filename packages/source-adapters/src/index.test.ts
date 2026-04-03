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

test("platform adapter registry provides exactly one adapter per supported platform", () => {
  const adapters = listPlatformAdapters();
  const platforms = adapters.map((adapter) => adapter.platform).sort();

  assert.deepEqual(platforms, [
    "amp",
    "antigravity",
    "claude_code",
    "codebuddy",
    "codex",
    "cursor",
    "factory_droid",
    "gemini",
    "lobechat",
    "openclaw",
    "opencode",
  ]);
  assert.equal(new Set(platforms).size, adapters.length);
});

test("platform adapter registry distinguishes stable and experimental support tiers", () => {
  const stablePlatforms = listPlatformAdaptersBySupportTier("stable")
    .map((adapter) => adapter.platform)
    .sort();
  const experimentalPlatforms = listPlatformAdaptersBySupportTier("experimental")
    .map((adapter) => adapter.platform)
    .sort();

  assert.deepEqual(stablePlatforms, [
    "amp",
    "antigravity",
    "claude_code",
    "codebuddy",
    "codex",
    "cursor",
    "factory_droid",
    "gemini",
    "openclaw",
    "opencode",
  ]);
  assert.deepEqual(experimentalPlatforms, ["lobechat"]);
});

test("stable support tier is backed by documented real-world validation assets", async () => {
  const mockDataRoot = getRepoMockDataRoot();
  const manifest = await readStableAdapterValidationManifest();
  const scenarios = await readJsonFixture<MockDataScenarioFixture[]>(path.join(mockDataRoot, "scenarios.json"));
  const scenarioIds = new Set(scenarios.map((scenario) => scenario.id));
  const manifestPlatforms = manifest.stable_adapters.map((entry) => entry.platform).sort();
  const stablePlatforms = listPlatformAdaptersBySupportTier("stable")
    .map((adapter) => adapter.platform)
    .sort();
  const experimentalPlatforms = listPlatformAdaptersBySupportTier("experimental")
    .map((adapter) => adapter.platform)
    .sort();

  assert.equal(manifest.schema_version, 1);
  assert.match(manifest.last_reviewed, /^\d{4}-\d{2}-\d{2}$/u);
  assert.deepEqual(manifestPlatforms, stablePlatforms);

  for (const platform of experimentalPlatforms) {
    assert.equal(manifestPlatforms.includes(platform), false, `did not expect experimental ${platform} in stable manifest`);
  }

  for (const entry of manifest.stable_adapters) {
    assert.ok(entry.scenario_ids.length >= 1, `expected scenario coverage for ${entry.platform}`);
    assert.ok(entry.validation_basis.length >= 1, `expected validation basis for ${entry.platform}`);
    await access(path.join(mockDataRoot, entry.probe_base_dir));

    for (const scenarioId of entry.scenario_ids) {
      assert.ok(scenarioIds.has(scenarioId), `expected scenario ${scenarioId} for ${entry.platform}`);
    }

    for (const fixturePath of entry.runtime_fixture_paths ?? []) {
      await access(path.join(mockDataRoot, fixturePath));
    }
  }
});

const execFileAsync = promisify(execFile);

interface MockDataScenarioFixture {
  id: string;
  apps: string[];
  visible_roots: string[];
  paths: string[];
}

interface StableAdapterValidationEntry {
  platform: SourceDefinition["platform"];
  source_id: string;
  family: SourceDefinition["family"];
  probe_base_dir: string;
  scenario_ids: string[];
  validation_basis: string[];
  runtime_fixture_paths?: string[];
}

interface StableAdapterValidationManifest {
  schema_version: number;
  last_reviewed: string;
  stable_adapters: StableAdapterValidationEntry[];
}

test("runSourceProbe projects one turn per supported local source family", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const sources = await seedSupportedSourceFixtures(tempRoot);
    const result = await runSourceProbe({ limit_files_per_source: 1 }, sources);
    const payloadsByPlatform = new Map(result.sources.map((payload) => [payload.source.platform, payload]));

    assert.equal(result.sources.length, 4);

    for (const platform of ["codex", "claude_code", "factory_droid", "amp"] as const) {
      const payload = payloadsByPlatform.get(platform);
      assert.ok(payload, `expected payload for ${platform}`);
      assert.equal(payload.source.sync_status, "healthy");
      assert.equal(payload.sessions.length, 1);
      assert.equal(payload.turns.length, 1);
      assert.equal(payload.contexts.length, 1);
      assert.ok(payload.records.length >= 2);
      assert.ok(payload.fragments.length >= 5);
      assert.ok(payload.atoms.length >= 4);
      assert.ok(payload.candidates.some((candidate) => candidate.candidate_kind === "project_observation"));
      assert.ok(payload.candidates.some((candidate) => candidate.candidate_kind === "submission_group"));
      assert.ok(payload.candidates.some((candidate) => candidate.candidate_kind === "turn"));
      assert.ok(payload.candidates.some((candidate) => candidate.candidate_kind === "context_span"));
      assert.equal(payload.turns[0]?.link_state, "unlinked");
      assert.ok((payload.turns[0]?.lineage.record_refs.length ?? 0) >= 1);
      assertParserMetadata(payload);
    }

    const codexPayload = payloadsByPlatform.get("codex");
    assert.equal(codexPayload?.contexts[0]?.assistant_replies.length, 1);
    assert.equal(codexPayload?.contexts[0]?.tool_calls.length, 1);
    assert.equal(codexPayload?.turns[0]?.canonical_text, "How do I continue?");

    const factoryPayload = payloadsByPlatform.get("factory_droid");
    assert.equal(factoryPayload?.contexts[0]?.system_messages.length, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe emits source-specific fragment kinds and unknown-content audits", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const sources = await seedSupportedSourceFixtures(tempRoot);
    const result = await runSourceProbe({ limit_files_per_source: 1 }, sources);
    const payloadsByPlatform = new Map(result.sources.map((payload) => [payload.source.platform, payload]));

    assertFragmentKinds(payloadsByPlatform.get("codex"), [
      "session_meta",
      "workspace_signal",
      "model_signal",
      "text",
      "tool_call",
      "tool_result",
      "unknown",
    ]);
    assertFragmentKinds(payloadsByPlatform.get("claude_code"), [
      "workspace_signal",
      "session_relation",
      "text",
      "tool_call",
      "tool_result",
      "unknown",
    ]);
    assertFragmentKinds(payloadsByPlatform.get("factory_droid"), [
      "session_meta",
      "title_signal",
      "workspace_signal",
      "model_signal",
      "text",
      "tool_call",
      "tool_result",
      "unknown",
    ]);
    assertFragmentKinds(payloadsByPlatform.get("amp"), [
      "title_signal",
      "workspace_signal",
      "text",
      "tool_call",
      "tool_result",
      "unknown",
    ]);

    for (const payload of payloadsByPlatform.values()) {
      assert.ok(payload.loss_audits.length >= 1, `expected inspectable loss audit for ${payload.source.platform}`);
      assert.ok(
        payload.fragments.some((fragment) => fragment.fragment_kind === "unknown"),
        `expected unknown fragment for ${payload.source.platform}`,
      );
      assert.ok(
        payload.loss_audits.every(
          (audit) =>
            typeof audit.scope_ref === "string" &&
            audit.scope_ref.length > 0 &&
            typeof audit.stage_kind === "string" &&
            typeof audit.diagnostic_code === "string",
        ),
        `expected stage and diagnostic metadata for ${payload.source.platform}`,
      );
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe normalizes Factory delegated session metadata into session_relation fragments", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const factoryDir = path.join(tempRoot, "factory-relation");
    await mkdir(factoryDir, { recursive: true });
    await writeFile(
      path.join(factoryDir, "session.jsonl"),
      [
        {
          timestamp: "2026-03-09T02:00:00.000Z",
          type: "session_start",
          sessionTitle: "Factory delegated session",
          cwd: "/workspace/factory-relation",
        },
        {
          timestamp: "2026-03-09T02:00:01.000Z",
          type: "message",
          message: {
            role: "user",
            content: [{ type: "text", text: "Review the current plan as a delegated agent." }],
          },
        },
        {
          timestamp: "2026-03-09T02:00:02.000Z",
          type: "message",
          callingSessionId: "factory-parent-1",
          callingToolUseId: "factory-tool-parent-1",
          agentId: "reviewer-agent",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Subagent reviewed the current plan." }],
          },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf8",
    );

    const [payload] = (await runSourceProbe(
      { source_ids: ["src-factory-relation"] },
      [createSourceDefinition("src-factory-relation", "factory_droid", factoryDir)],
    )).sources;

    assert.ok(payload);
    assert.equal(payload.sessions.length, 1);
    assert.equal(payload.turns.length, 1);
    const relation = payload.fragments.find((fragment) => fragment.fragment_kind === "session_relation");
    assert.ok(relation);
    assert.equal(relation?.payload.parent_uuid, "factory-parent-1");
    assert.equal(relation?.payload.parent_tool_ref, "factory-tool-parent-1");
    assert.equal(relation?.payload.agent_id, "reviewer-agent");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe preserves malformed inputs across all four sources", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const sources = await seedMalformedSourceFixtures(tempRoot);
    const result = await runSourceProbe({ limit_files_per_source: 1 }, sources);
    const payloadsByPlatform = new Map(result.sources.map((payload) => [payload.source.platform, payload]));

    const codexPayload = payloadsByPlatform.get("codex");
    assert.ok(codexPayload);
    assert.equal(codexPayload.records.length, 1);
    assert.ok(codexPayload.fragments.some((fragment) => fragment.fragment_kind === "unknown"));
    assert.ok(codexPayload.loss_audits.some((audit) => audit.detail.includes("could not be parsed as JSON")));

    const claudePayload = payloadsByPlatform.get("claude_code");
    assert.ok(claudePayload);
    assert.ok(claudePayload.fragments.some((fragment) => fragment.fragment_kind === "unknown"));
    assert.ok(claudePayload.loss_audits.some((audit) => audit.detail.includes("Unsupported Claude content item")));

    const factoryPayload = payloadsByPlatform.get("factory_droid");
    assert.ok(factoryPayload);
    assert.ok(factoryPayload.fragments.some((fragment) => fragment.fragment_kind === "tool_result"));
    assert.ok(factoryPayload.fragments.some((fragment) => fragment.fragment_kind === "session_meta"));

    const ampPayload = payloadsByPlatform.get("amp");
    assert.ok(ampPayload);
    assert.equal(ampPayload.records[0]?.parseable, false);
    assert.ok(ampPayload.fragments.some((fragment) => fragment.fragment_kind === "unknown"));
    assert.ok(ampPayload.loss_audits.some((audit) => audit.scope_ref === ampPayload.records[0]?.id));
    assert.ok(ampPayload.loss_audits.some((audit) => audit.stage_kind === "extract_records"));
    assert.ok(
      ampPayload.loss_audits.every(
        (audit) => audit.session_ref || audit.blob_ref || audit.record_ref || audit.scope_ref,
      ),
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe classifies atoms, keeps appended user messages in one turn, and binds context to turn ids", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const source = await seedMultiTurnCodexFixture(tempRoot);
    const [payload] = (await runSourceProbe({ limit_files_per_source: 1 }, [source])).sources;

    assert.ok(payload);
    assert.equal(payload.sessions.length, 1);
    assert.equal(payload.turns.length, 2);
    assert.equal(payload.contexts.length, 2);
    assert.equal(payload.sessions[0]?.turn_count, 2);

    const firstTurn = payload.turns[0]!;
    const secondTurn = payload.turns[1]!;
    const firstContext = payload.contexts[0]!;
    const secondContext = payload.contexts[1]!;

    assert.equal(firstTurn.user_messages.length, 3);
    assert.equal(firstTurn.user_messages[0]?.is_injected, true);
    assert.equal(firstTurn.user_messages[1]?.raw_text, "Ship the fix.");
    assert.equal(firstTurn.user_messages[2]?.raw_text, "Also cover tests.");
    assert.equal(firstTurn.raw_text, "[Assistant Rules - hidden]\n\nShip the fix.\n\nAlso cover tests.");
    assert.equal(firstTurn.canonical_text, "Ship the fix.\n\nAlso cover tests.");
    assert.equal(
      firstTurn.display_segments.map((segment) => segment.content).join(""),
      "[Assistant Rules - hidden]\n\nShip the fix.\n\nAlso cover tests.",
    );
    assert.equal(firstTurn.display_segments[0]?.type, "injected");
    assert.equal(firstTurn.user_messages[0]?.display_segments?.[0]?.type, "injected");
    assert.equal(firstTurn.context_summary.assistant_reply_count, 1);
    assert.equal(firstTurn.context_summary.tool_call_count, 1);
    assert.equal(firstContext.turn_id, firstTurn.id);
    assert.equal(secondContext.turn_id, secondTurn.id);
    assert.equal(firstContext.assistant_replies.length, 1);
    assert.equal(firstContext.tool_calls.length, 1);
    assert.equal(secondContext.assistant_replies.length, 1);
    assert.equal(secondContext.tool_calls.length, 0);

    const submissionGroups = payload.candidates.filter((candidate) => candidate.candidate_kind === "submission_group");
    assert.equal(submissionGroups.length, 2);
    assert.equal(submissionGroups[0]?.input_atom_refs.length, 3);
    assert.equal(submissionGroups[1]?.input_atom_refs.length, 1);

    const contextSpans = payload.candidates.filter((candidate) => candidate.candidate_kind === "context_span");
    assert.equal(contextSpans.length, 2);
    assert.equal(contextSpans[0]?.input_atom_refs.length, 3);
    assert.equal(contextSpans[1]?.input_atom_refs.length, 1);

    const injectedAtom = payload.atoms.find((atom) => atom.origin_kind === "injected_user_shaped");
    assert.ok(injectedAtom);
    assert.equal(injectedAtom.actor_kind, "user");
    assert.equal(injectedAtom.content_kind, "text");
    assert.equal(injectedAtom.display_policy, "collapse");

    const userAtom = payload.atoms.find(
      (atom) => atom.actor_kind === "user" && atom.origin_kind === "user_authored" && atom.payload.text === "Ship the fix.",
    );
    assert.ok(userAtom);
    assert.equal(userAtom.content_kind, "text");

    const metaAtom = payload.atoms.find(
      (atom) => atom.content_kind === "meta_signal" && atom.payload.signal_kind === "workspace_signal",
    );
    assert.ok(metaAtom);
    assert.equal(metaAtom.actor_kind, "system");
    assert.equal(metaAtom.origin_kind, "source_meta");

    const toolCallAtom = payload.atoms.find((atom) => atom.content_kind === "tool_call");
    assert.ok(toolCallAtom);
    assert.equal(toolCallAtom.actor_kind, "tool");
    assert.equal(toolCallAtom.origin_kind, "tool_generated");

    const toolResultAtom = payload.atoms.find((atom) => atom.content_kind === "tool_result");
    assert.ok(toolResultAtom);
    assert.equal(toolResultAtom.actor_kind, "tool");
    assert.equal(toolResultAtom.origin_kind, "tool_generated");

    assert.ok(payload.edges.some((edge) => edge.edge_kind === "tool_result_for"));
    assert.ok(payload.edges.some((edge) => edge.edge_kind === "spawned_from"));
    assert.ok(payload.edges.some((edge) => edge.edge_kind === "same_submission"));
    assert.ok(payload.edges.some((edge) => edge.edge_kind === "continuation_of"));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe preserves injected scaffolding as masked user-message evidence instead of deleting it", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const source = await seedCodexInjectedScaffoldFixture(tempRoot);
    const [payload] = (await runSourceProbe({ limit_files_per_source: 1 }, [source])).sources;

    assert.ok(payload);
    assert.equal(payload.turns.length, 1);

    const turn = payload.turns[0]!;
    assert.equal(turn.user_messages.length, 3);
    assert.equal(turn.user_messages[0]?.is_injected, true);
    assert.equal(turn.user_messages[1]?.is_injected, true);
    assert.equal(turn.user_messages[2]?.is_injected, false);
    assert.match(turn.raw_text, /# AGENTS\.md instructions/u);
    assert.match(turn.raw_text, /<environment_context>/u);
    assert.equal(turn.canonical_text, "Please review the patch plan only.");
    assert.ok(turn.display_segments.some((segment) => segment.type === "masked" && segment.mask_label === "Agent Instructions"));
    assert.ok(turn.display_segments.some((segment) => segment.type === "masked" && segment.mask_label === "Environment Context"));
    assert.equal(
      turn.user_messages[0]?.display_segments?.some(
        (segment) => segment.type === "masked" && segment.mask_label === "Agent Instructions",
      ),
      true,
    );
    assert.equal(
      turn.user_messages[1]?.display_segments?.some(
        (segment) => segment.type === "masked" && segment.mask_label === "Environment Context",
      ),
      true,
    );
    assert.equal(turn.user_messages[2]?.display_segments?.[0]?.content, "Please review the patch plan only.");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe does not promote injected-only scaffolding into standalone user turns", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const source = await seedCodexInjectedOnlyFixture(tempRoot);
    const [payload] = (await runSourceProbe({ limit_files_per_source: 1 }, [source])).sources;

    assert.ok(payload);
    assert.equal(payload.turns.length, 0);
    assert.equal(payload.contexts.length, 0);
    assert.equal(payload.sessions[0]?.turn_count, 0);
    assert.ok(payload.atoms.some((atom) => atom.origin_kind === "injected_user_shaped"));
    assert.equal(payload.candidates.some((candidate) => candidate.candidate_kind === "turn"), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

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

test("runSourceProbe normalizes Windows file-URI workspace evidence across source families", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const sources = await seedWindowsNormalizedWorkspaceFixtures(tempRoot);
    const result = await runSourceProbe({ limit_files_per_source: 1 }, sources);

    for (const payload of result.sources) {
      const projectObservation = payload.candidates.find((candidate) => candidate.candidate_kind === "project_observation");
      assert.ok(projectObservation, `expected project observation for ${payload.source.platform}`);
      assert.equal(
        projectObservation.evidence.workspace_path_normalized,
        "c:/Users/dev/workspace/normalized-project",
        `expected normalized Windows workspace path for ${payload.source.platform}`,
      );
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe normalizes workspace-path evidence across source families", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const sources = await seedNormalizedWorkspaceFixtures(tempRoot);
    const result = await runSourceProbe({ limit_files_per_source: 1 }, sources);

    for (const payload of result.sources) {
      const projectObservation = payload.candidates.find((candidate) => candidate.candidate_kind === "project_observation");
      assert.ok(projectObservation, `expected project observation for ${payload.source.platform}`);
      assert.equal(
        projectObservation.evidence.workspace_path_normalized,
        "/workspace/normalized-project",
        `expected normalized workspace path for ${payload.source.platform}`,
      );
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe enriches project observations with git-backed repo root when workspace records omit repo metadata", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const sources = await seedRepoEvidenceFixtures(tempRoot);
    const result = await runSourceProbe({ limit_files_per_source: 1 }, sources);

    for (const payload of result.sources) {
      const projectObservation = payload.candidates.find((candidate) => candidate.candidate_kind === "project_observation");
      assert.ok(projectObservation, `expected project observation for ${payload.source.platform}`);
      assert.ok(projectObservation.evidence.repo_root, `expected repo root for ${payload.source.platform}`);
      assert.equal(projectObservation.evidence.repo_remote, undefined);
      assert.equal(projectObservation.evidence.repo_fingerprint, undefined);
      assert.equal(projectObservation.evidence.debug_summary, "workspace signal with git-backed repository root");
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe projects token usage and stop reasons into turn context", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const sources = await seedTokenProjectionFixtures(tempRoot);
    const result = await runSourceProbe({ limit_files_per_source: 1 }, sources);
    const payloadsByPlatform = new Map(result.sources.map((payload) => [payload.source.platform, payload]));

    const codexPayload = payloadsByPlatform.get("codex");
    assert.equal(codexPayload?.turns[0]?.context_summary.total_tokens, 20);
    assert.equal(codexPayload?.turns[0]?.context_summary.token_usage?.input_tokens, 7);
    assert.equal(codexPayload?.turns[0]?.context_summary.token_usage?.cache_read_input_tokens, 5);
    assert.equal(codexPayload?.turns[0]?.context_summary.token_usage?.cached_input_tokens, 5);
    assert.equal(codexPayload?.turns[0]?.context_summary.token_usage?.output_tokens, 8);
    assert.equal(codexPayload?.turns[0]?.context_summary.token_usage?.reasoning_output_tokens, 3);
    assert.equal(codexPayload?.contexts[0]?.assistant_replies[0]?.token_count, 20);
    assert.equal(codexPayload?.contexts[0]?.assistant_replies[0]?.token_usage?.input_tokens, 7);
    assert.equal(codexPayload?.contexts[0]?.assistant_replies[0]?.token_usage?.cache_read_input_tokens, 5);
    assert.equal(codexPayload?.contexts[0]?.assistant_replies[0]?.token_usage?.output_tokens, 8);
    assert.equal(codexPayload?.contexts[0]?.assistant_replies[0]?.stop_reason, "end_turn");
    assert.ok(codexPayload?.fragments.some((fragment) => fragment.fragment_kind === "token_usage_signal"));

    const claudePayload = payloadsByPlatform.get("claude_code");
    assert.equal(claudePayload?.turns[0]?.context_summary.total_tokens, 47);
    assert.equal(claudePayload?.turns[0]?.context_summary.primary_model, "claude-sonnet-4-6");
    assert.equal(claudePayload?.turns[0]?.context_summary.token_usage?.input_tokens, 30);
    assert.equal(claudePayload?.turns[0]?.context_summary.token_usage?.cache_creation_input_tokens, 5);
    assert.equal(claudePayload?.turns[0]?.context_summary.token_usage?.cache_read_input_tokens, 2);
    assert.equal(claudePayload?.turns[0]?.context_summary.token_usage?.cached_input_tokens, 7);
    assert.equal(claudePayload?.turns[0]?.context_summary.token_usage?.output_tokens, 10);
    assert.equal(claudePayload?.contexts[0]?.assistant_replies[0]?.token_count, 47);
    assert.equal(claudePayload?.contexts[0]?.assistant_replies[0]?.model, "claude-sonnet-4-6");
    assert.equal(claudePayload?.contexts[0]?.assistant_replies[0]?.token_usage?.cache_creation_input_tokens, 5);
    assert.equal(claudePayload?.contexts[0]?.assistant_replies[0]?.token_usage?.cache_read_input_tokens, 2);
    assert.equal(claudePayload?.contexts[0]?.assistant_replies[0]?.token_usage?.cached_input_tokens, 7);
    assert.equal(claudePayload?.contexts[0]?.assistant_replies[0]?.stop_reason, "tool_use");

    const factoryPayload = payloadsByPlatform.get("factory_droid");
    assert.equal(factoryPayload?.turns[0]?.context_summary.total_tokens, 18);
    assert.equal(factoryPayload?.turns[0]?.context_summary.primary_model, "claude-opus-4-6");
    assert.equal(factoryPayload?.turns[0]?.context_summary.token_usage?.input_tokens, 9);
    assert.equal(factoryPayload?.turns[0]?.context_summary.token_usage?.cache_creation_input_tokens, 1);
    assert.equal(factoryPayload?.turns[0]?.context_summary.token_usage?.cache_read_input_tokens, 2);
    assert.equal(factoryPayload?.turns[0]?.context_summary.token_usage?.cached_input_tokens, 3);
    assert.equal(factoryPayload?.turns[0]?.context_summary.token_usage?.output_tokens, 6);
    assert.equal(factoryPayload?.turns[0]?.context_summary.token_usage?.reasoning_output_tokens, 3);
    assert.equal(factoryPayload?.contexts[0]?.assistant_replies[0]?.token_count, 18);
    assert.equal(factoryPayload?.contexts[0]?.assistant_replies[0]?.model, "claude-opus-4-6");
    assert.equal(factoryPayload?.contexts[0]?.assistant_replies[0]?.stop_reason, "end_turn");

    const ampPayload = payloadsByPlatform.get("amp");
    assert.equal(ampPayload?.turns[0]?.context_summary.total_tokens, 24);
    assert.equal(ampPayload?.turns[0]?.context_summary.primary_model, "claude-opus-4-6");
    assert.equal(ampPayload?.turns[0]?.context_summary.token_usage?.input_tokens, 14);
    assert.equal(ampPayload?.turns[0]?.context_summary.token_usage?.cache_creation_input_tokens, 2);
    assert.equal(ampPayload?.turns[0]?.context_summary.token_usage?.cache_read_input_tokens, 1);
    assert.equal(ampPayload?.turns[0]?.context_summary.token_usage?.cached_input_tokens, 3);
    assert.equal(ampPayload?.turns[0]?.context_summary.token_usage?.output_tokens, 7);
    assert.equal(ampPayload?.contexts[0]?.assistant_replies[0]?.token_count, 24);
    assert.equal(ampPayload?.contexts[0]?.assistant_replies[0]?.model, "claude-opus-4-6");
    assert.equal(ampPayload?.contexts[0]?.assistant_replies[0]?.stop_reason, "max_tokens");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe keeps per-turn models when Claude switches models mid-session", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const source = await seedClaudeModelSwitchFixture(tempRoot);
    const [payload] = (await runSourceProbe({ limit_files_per_source: 1 }, [source])).sources;

    assert.ok(payload);
    assert.equal(payload.turns.length, 2);
    assert.equal(payload.contexts.length, 2);
    assert.equal(payload.turns[0]?.context_summary.primary_model, "claude-sonnet-4-6");
    assert.equal(payload.turns[1]?.context_summary.primary_model, "claude-opus-4-6");
    assert.equal(payload.contexts[0]?.assistant_replies[0]?.model, "claude-sonnet-4-6");
    assert.equal(payload.contexts[1]?.assistant_replies[0]?.model, "claude-opus-4-6");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe keeps the final token checkpoint per turn and sums token usage across turns", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const source = await seedMultiTurnCodexTokenFixture(tempRoot);
    const [payload] = (await runSourceProbe({ limit_files_per_source: 1 }, [source])).sources;

    assert.ok(payload);
    assert.equal(payload.turns.length, 2);
    assert.equal(payload.sessions[0]?.turn_count, 2);

    assert.equal(payload.turns[0]?.context_summary.total_tokens, 135);
    assert.equal(payload.turns[0]?.context_summary.token_usage?.input_tokens, 30);
    assert.equal(payload.turns[0]?.context_summary.token_usage?.cache_read_input_tokens, 90);
    assert.equal(payload.turns[0]?.context_summary.token_usage?.output_tokens, 15);
    assert.equal(payload.contexts[0]?.assistant_replies[0]?.token_count, 135);

    assert.equal(payload.turns[1]?.context_summary.total_tokens, 235);
    assert.equal(payload.turns[1]?.context_summary.token_usage?.input_tokens, 60);
    assert.equal(payload.turns[1]?.context_summary.token_usage?.cache_read_input_tokens, 150);
    assert.equal(payload.turns[1]?.context_summary.token_usage?.output_tokens, 25);
    assert.equal(payload.contexts[1]?.assistant_replies[0]?.token_count, 235);

    const sessionTotals = payload.turns.reduce(
      (totals, turn) => {
        totals.input += turn.context_summary.token_usage?.input_tokens ?? 0;
        totals.cache += turn.context_summary.token_usage?.cache_read_input_tokens ?? 0;
        totals.output += turn.context_summary.token_usage?.output_tokens ?? 0;
        totals.total += turn.context_summary.total_tokens ?? 0;
        return totals;
      },
      { input: 0, cache: 0, output: 0, total: 0 },
    );

    assert.deepEqual(sessionTotals, {
      input: 90,
      cache: 240,
      output: 40,
      total: 370,
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe sums the final token checkpoints across assistant replies inside one turn", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const source = await seedMultiReplyCodexTokenFixture(tempRoot);
    const [payload] = (await runSourceProbe({ limit_files_per_source: 1 }, [source])).sources;

    assert.ok(payload);
    assert.equal(payload.turns.length, 1);
    assert.equal(payload.contexts.length, 1);
    assert.equal(payload.contexts[0]?.assistant_replies.length, 2);

    assert.equal(payload.contexts[0]?.assistant_replies[0]?.token_count, 135);
    assert.equal(payload.contexts[0]?.assistant_replies[0]?.token_usage?.input_tokens, 30);
    assert.equal(payload.contexts[0]?.assistant_replies[0]?.token_usage?.cache_read_input_tokens, 90);
    assert.equal(payload.contexts[0]?.assistant_replies[0]?.token_usage?.output_tokens, 15);

    assert.equal(payload.contexts[0]?.assistant_replies[1]?.token_count, 235);
    assert.equal(payload.contexts[0]?.assistant_replies[1]?.token_usage?.input_tokens, 60);
    assert.equal(payload.contexts[0]?.assistant_replies[1]?.token_usage?.cache_read_input_tokens, 150);
    assert.equal(payload.contexts[0]?.assistant_replies[1]?.token_usage?.output_tokens, 25);

    assert.equal(payload.turns[0]?.context_summary.total_tokens, 370);
    assert.equal(payload.turns[0]?.context_summary.token_usage?.input_tokens, 90);
    assert.equal(payload.turns[0]?.context_summary.token_usage?.cache_read_input_tokens, 240);
    assert.equal(payload.turns[0]?.context_summary.token_usage?.output_tokens, 40);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe uses cumulative token deltas when one visible reply spans multiple billed token updates", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const source = await seedCodexCumulativeTokenFixture(tempRoot);
    const [payload] = (await runSourceProbe({ limit_files_per_source: 1 }, [source])).sources;

    assert.ok(payload);
    assert.equal(payload.turns.length, 1);
    assert.equal(payload.contexts[0]?.assistant_replies.length, 1);
    assert.equal(payload.contexts[0]?.assistant_replies[0]?.token_count, 135);
    assert.equal(payload.contexts[0]?.assistant_replies[0]?.token_usage?.input_tokens, 60);
    assert.equal(payload.contexts[0]?.assistant_replies[0]?.token_usage?.cache_read_input_tokens, 60);
    assert.equal(payload.contexts[0]?.assistant_replies[0]?.token_usage?.output_tokens, 15);
    assert.equal(payload.turns[0]?.context_summary.total_tokens, 135);
    assert.equal(payload.turns[0]?.context_summary.token_usage?.input_tokens, 60);
    assert.equal(payload.turns[0]?.context_summary.token_usage?.cache_read_input_tokens, 60);
    assert.equal(payload.turns[0]?.context_summary.token_usage?.output_tokens, 15);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe supports cursor antigravity gemini openclaw opencode and lobechat fixtures", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const sources = await seedExpandedSourceFixtures(tempRoot);
    const result = await runSourceProbe({ limit_files_per_source: 1 }, sources);
    const payloadsByPlatform = new Map(result.sources.map((payload) => [payload.source.platform, payload]));

    for (const platform of ["cursor", "gemini", "openclaw", "opencode", "lobechat"] as const) {
      const payload = payloadsByPlatform.get(platform);
      assert.ok(payload, `expected payload for ${platform}`);
      assert.equal(payload.source.sync_status, "healthy");
      assert.equal(payload.sessions.length, 1);
      assert.equal(payload.turns.length, 1);
      assert.equal(payload.contexts.length, 1);
      assert.ok(payload.turns[0]?.canonical_text.length);
      assert.ok(payload.contexts[0]?.assistant_replies[0]?.content.length);
      assertParserMetadata(payload);
    }

    const antigravityPayload = payloadsByPlatform.get("antigravity");
    assert.ok(antigravityPayload);
    assert.equal(antigravityPayload.source.sync_status, "healthy");
    assert.equal(antigravityPayload.sessions.length, 1);
    assert.equal(antigravityPayload.turns.length, 0);
    assert.equal(antigravityPayload.contexts.length, 0);
    assertParserMetadata(antigravityPayload);

    assert.equal(payloadsByPlatform.get("cursor")?.sessions[0]?.working_directory, "/workspace/cursor");
    assert.equal(payloadsByPlatform.get("antigravity")?.sessions[0]?.working_directory, "/workspace/antigravity");
    assert.equal(payloadsByPlatform.get("gemini")?.sessions[0]?.working_directory, "/workspace/gemini-fixture");
    assert.equal(payloadsByPlatform.get("gemini")?.sessions[0]?.title, "gemini-fixture");
    assert.ok(payloadsByPlatform.get("gemini")?.turns[0]?.canonical_text.includes("Inspect Gemini CLI history."));
    assert.equal(payloadsByPlatform.get("opencode")?.sessions[0]?.title, "OpenCode fixture");
    assert.ok(payloadsByPlatform.get("opencode")?.turns[0]?.canonical_text.includes("Inspect OpenCode history."));
    assertFragmentKinds(payloadsByPlatform.get("opencode"), ["workspace_signal", "text", "tool_call", "tool_result"]);
    assert.equal(payloadsByPlatform.get("lobechat")?.source.family, "conversational_export");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

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

test("[openclaw] sanitized real-archive fixtures keep cron-trigger prompts as automation evidence instead of canonical turns", async () => {
  const mockDataRoot = getRepoMockDataRoot();
  const baseDir = path.join(mockDataRoot, ".openclaw", "agents");
  const source = createSourceDefinition("src-openclaw-mock-data", "openclaw", baseDir);

  const result = await runSourceProbe({ source_ids: [source.id] }, [source]);
  const payload = result.sources[0];
  assert.ok(payload);
  assert.equal(payload.source.sync_status, "healthy");
  assert.equal(payload.sessions.length, 2);
  assert.equal(payload.turns.length, 0);
  assert.equal(payload.contexts.length, 0);

  const mainSession = payload.sessions.find((session) => session.working_directory === "/Users/mock_user/workspace/openclaw-automation");
  const cronRunSession = payload.sessions.find((session) => session.title === "cron:mock-openclaw-hourly");
  assert.equal(mainSession?.turn_count, 0);
  assert.ok(cronRunSession);
  assert.equal(cronRunSession?.turn_count, 0);
  assert.ok(
    payload.atoms.some(
      (atom) => atom.origin_kind === "automation_trigger" && String(atom.payload.text ?? "").includes("[cron:mock-openclaw-hourly]"),
    ),
  );
  assert.ok(
    payload.fragments.some(
      (fragment) =>
        fragment.session_ref === cronRunSession?.id &&
        fragment.fragment_kind === "session_relation" &&
        String(fragment.payload.parent_uuid ?? "") === "11111111-2222-4333-8444-555555555555" &&
        String(fragment.payload.session_key ?? "") === "main:11111111-2222-4333-8444-555555555555",
    ),
  );
  assert.ok(
    payload.fragments.some(
      (fragment) =>
        fragment.session_ref === cronRunSession?.id &&
        fragment.fragment_kind === "text" &&
        fragment.payload.origin_kind === "source_meta" &&
        String(fragment.payload.text ?? "").includes("Reviewed queued rule updates"),
    ),
  );
  assertFragmentKinds(payload, ["workspace_signal", "model_signal", "title_signal", "session_relation", "text", "tool_call", "tool_result"]);

  const blobPaths = payload.blobs.map((blob) => blob.origin_path);
  assert.equal(
    blobPaths.includes(path.join(baseDir, "main", "sessions", "22222222-3333-4444-8555-666666666666.jsonl.reset.2026-04-01T00-10-00.000Z")),
    true,
  );
  assert.equal(
    blobPaths.includes(path.join(baseDir, "main", "sessions", "33333333-4444-4555-8666-777777777777.jsonl.deleted.2026-04-01T00-20-00.000Z")),
    true,
  );
  assert.equal(blobPaths.includes(path.join(baseDir, "main", "agent", "auth-profiles.json")), true);
  assert.equal(blobPaths.includes(path.join(baseDir, "main", "agent", "models.json")), true);
  assert.equal(blobPaths.includes(path.join(baseDir, "anyrouter", "agent", "auth-profiles.json")), true);
  assert.equal(blobPaths.includes(path.join(baseDir, "kimicoding", "agent", "auth-profiles.json")), true);
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

test("[codex] root history jsonl stays out of default capture when scanning the source root", async () => {
  const mockDataRoot = getRepoMockDataRoot();
  const baseDir = path.join(mockDataRoot, ".codex");
  const source = createSourceDefinition("src-codex-root-mock-data", "codex", baseDir);

  const result = await runSourceProbe({ source_ids: [source.id] }, [source]);
  const payload = result.sources[0];
  assert.ok(payload);
  assert.equal(payload.source.sync_status, "healthy");
  assert.equal(payload.blobs.some((blob) => path.basename(blob.origin_path) === "history.jsonl"), false);
  assert.equal(payload.sessions.length, 4);
  assert.equal(payload.turns.length, 4);
  assert.equal(
    payload.turns.some(
      (turn) =>
        turn.canonical_text === "continue" ||
        turn.canonical_text === "follow the tasks.csv, once a task, allow subagents." ||
        turn.canonical_text === "no need to stop, just continue work to finish all tasks",
    ),
    false,
  );
});

test("[amp] root history jsonl stays out of default capture when scanning the source root", async () => {
  const mockDataRoot = getRepoMockDataRoot();
  const baseDir = path.join(mockDataRoot, ".local", "share", "amp");
  const source = createSourceDefinition("src-amp-root-mock-data", "amp", baseDir);

  const result = await runSourceProbe({ source_ids: [source.id] }, [source]);
  const payload = result.sources[0];
  assert.ok(payload);
  assert.equal(payload.source.sync_status, "healthy");
  assert.equal(payload.blobs.some((blob) => path.basename(blob.origin_path) === "history.jsonl"), false);
  assert.equal(payload.sessions.length, 1);
  assert.equal(payload.turns.length, 1);
});

test("[gemini] companion project files are captured as evidence blobs without creating extra sessions", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const sources = await seedExpandedSourceFixtures(tempRoot);
    const geminiSource = sources.find((source) => source.platform === "gemini");
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
    const geminiSource = sources.find((source) => source.platform === "gemini");
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
    const geminiSource = sources.find((source) => source.platform === "gemini");
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
    const geminiSource = sources.find((source) => source.platform === "gemini");
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

test("runSourceProbe preserves real mock_data coverage across all stable adapter roots", async () => {
  const mockDataRoot = getRepoMockDataRoot();
  const manifest = await readStableAdapterValidationManifest();
  const result = await runSourceProbe(
    {},
    manifest.stable_adapters.map((entry) =>
      createSourceDefinition(entry.source_id, entry.platform, path.join(mockDataRoot, entry.probe_base_dir), entry.family),
    ),
  );
  const payloadsByPlatform = new Map<SourceDefinition["platform"], SourceSyncPayload>(
    result.sources.map((payload) => [payload.source.platform, payload]),
  );

  assert.equal(result.sources.length, manifest.stable_adapters.length);

  const codexPayload = payloadsByPlatform.get("codex");
  assert.ok(codexPayload);
  assert.equal(codexPayload.source.sync_status, "healthy");
  assert.ok(codexPayload.sessions.length >= 4);
  assert.ok(codexPayload.turns.length >= 4);
  assert.ok(codexPayload.contexts.length >= 4);
  assert.ok(codexPayload.turns.some((turn) => turn.canonical_text.includes("review the validator")));
  assertParserMetadata(codexPayload);

  const claudePayload = payloadsByPlatform.get("claude_code");
  assert.ok(claudePayload);
  assert.equal(claudePayload.source.sync_status, "healthy");
  assert.ok(claudePayload.sessions.length >= 3);
  assert.ok(claudePayload.turns.length >= 2);
  assert.ok(claudePayload.contexts.length >= 2);
  assert.ok(claudePayload.turns.some((turn) => turn.canonical_text.length > 0));
  assertParserMetadata(claudePayload);

  const cursorPayload = payloadsByPlatform.get("cursor");
  assert.ok(cursorPayload);
  assert.equal(cursorPayload.source.sync_status, "healthy");
  assert.ok(cursorPayload.sessions.length >= 2);
  assert.ok(cursorPayload.turns.length >= 1);
  assert.ok(cursorPayload.contexts.length >= 1);
  assert.ok(cursorPayload.records.length >= 30);
  assert.ok(cursorPayload.loss_audits.length >= 20);
  assert.ok(cursorPayload.sessions.some((session) => typeof session.working_directory === "string" && session.working_directory.length > 0));
  assertParserMetadata(cursorPayload);

  const factoryPayload = payloadsByPlatform.get("factory_droid");
  assert.ok(factoryPayload);
  assert.equal(factoryPayload.source.sync_status, "healthy");
  assert.equal(factoryPayload.sessions.length, 1);
  assert.equal(factoryPayload.turns.length, 1);
  assert.equal(factoryPayload.contexts.length, 1);
  assert.ok(factoryPayload.records.length >= 4);
  assert.equal(factoryPayload.sessions[0]?.working_directory, "/Users/mock_user/workspace/history-lab");
  assert.equal(factoryPayload.contexts[0]?.system_messages.length, 1);
  assert.ok(
    factoryPayload.turns.some((turn) => turn.canonical_text.includes("Factory Droid sidecar behavior")),
  );
  assertParserMetadata(factoryPayload);

  const ampPayload = payloadsByPlatform.get("amp");
  assert.ok(ampPayload);
  assert.equal(ampPayload.source.sync_status, "healthy");
  assert.equal(ampPayload.sessions.length, 1);
  assert.equal(ampPayload.turns.length, 1);
  assert.equal(ampPayload.contexts.length, 1);
  assert.ok(ampPayload.records.length >= 5);
  assert.equal(ampPayload.sessions[0]?.working_directory, "/Users/mock_user/workspace/history-lab");
  assert.equal(ampPayload.contexts[0]?.tool_calls.length, 1);
  assert.ok(ampPayload.turns.some((turn) => turn.canonical_text.includes("AMP ingestion gaps")));
  assertParserMetadata(ampPayload);

  const antigravityPayload = payloadsByPlatform.get("antigravity");
  assert.ok(antigravityPayload);
  assert.equal(antigravityPayload.source.sync_status, "healthy");
  assert.ok(antigravityPayload.sessions.length >= 3);
  assert.ok(antigravityPayload.turns.length >= 1);
  assert.ok(antigravityPayload.contexts.length >= 1);
  assert.ok(antigravityPayload.records.length >= 4);
  assert.ok(antigravityPayload.fragments.length >= 8);
  assert.ok(
    antigravityPayload.turns.some((turn) => turn.canonical_text.includes("启动方式有点混乱")),
  );
  assert.ok(antigravityPayload.sessions.some((session) => typeof session.updated_at === "string" && session.updated_at.length > 0));
  assertParserMetadata(antigravityPayload);
});

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

test("getDefaultSourcesForHost includes Gemini CLI sync roots when .gemini exists", () => {
  const homeDir = "/Users/tester";
  const sources = getDefaultSourcesForHost({
    homeDir,
    platform: "darwin",
    pathExists(targetPath) {
      return targetPath === path.join(homeDir, ".gemini");
    },
  });

  const geminiSource = sources.find((source) => source.platform === "gemini");
  assert.ok(geminiSource);
  assert.equal(geminiSource?.base_dir, path.join(homeDir, ".gemini"));
});

test("[gemini] source enumeration narrows ~/.gemini roots to tmp chat data", () => {
  const geminiRoot = path.join("/Users/tester", ".gemini");
  assert.deepEqual(listGeminiSourceRoots(geminiRoot), [path.join(geminiRoot, "tmp")]);
  assert.deepEqual(listGeminiSourceRoots(path.join(geminiRoot, "tmp")), [path.join(geminiRoot, "tmp")]);
});

test("discoverDefaultSourcesForHost exposes candidate roots and selected OpenCode storage paths", () => {
  const homeDir = "/Users/tester";
  const discoveries = discoverDefaultSourcesForHost({
    homeDir,
    platform: "darwin",
    pathExists(targetPath) {
      return (
        targetPath === path.join(homeDir, ".local", "share", "opencode", "storage") ||
        targetPath === path.join(homeDir, ".local", "share", "opencode", "project") ||
        targetPath === path.join(homeDir, ".openclaw", "agents") ||
        targetPath === path.join(homeDir, ".codebuddy")
      );
    },
  });

  const opencode = discoveries.find((entry) => entry.platform === "opencode");
  const openclaw = discoveries.find((entry) => entry.platform === "openclaw");
  const codebuddy = discoveries.find((entry) => entry.platform === "codebuddy");

  assert.equal(opencode?.selected_path, path.join(homeDir, ".local", "share", "opencode", "storage"));
  assert.equal(opencode?.selected_exists, true);
  assert.ok(
    opencode?.candidates.some(
      (candidate) =>
        candidate.path === path.join(homeDir, ".local", "share", "opencode", "storage") && candidate.selected,
    ),
  );
  assert.ok(
    opencode?.candidates.some(
      (candidate) => candidate.path === path.join(homeDir, ".local", "share", "opencode", "project"),
    ),
  );
  assert.ok(
    opencode?.candidates.some(
      (candidate) => candidate.path === path.join(homeDir, ".local", "share", "opencode", "storage", "session"),
    ),
  );
  assert.equal(openclaw?.selected_path, path.join(homeDir, ".openclaw", "agents"));
  assert.equal(openclaw?.selected_exists, true);
  assert.equal(codebuddy?.selected_path, path.join(homeDir, ".codebuddy"));
  assert.equal(codebuddy?.selected_exists, true);
});

test("discoverHostToolsForHost includes discovery-only Gemini CLI paths", () => {
  const homeDir = "/Users/tester";
  const discoveries = discoverHostToolsForHost({
    homeDir,
    platform: "darwin",
    pathExists(targetPath) {
      return (
        targetPath === path.join(homeDir, ".gemini", "settings.json") ||
        targetPath === path.join(homeDir, ".gemini", "tmp")
      );
    },
  });

  const gemini = discoveries.find((entry) => entry.key === "gemini_cli");
  assert.ok(gemini);
  assert.equal(gemini?.kind, "tool");
  assert.equal(gemini?.capability, "discover_only");
  assert.equal(gemini?.selected_exists, true);
  assert.deepEqual(gemini?.discovered_paths.sort(), [
    path.join(homeDir, ".gemini", "settings.json"),
    path.join(homeDir, ".gemini", "tmp"),
  ]);
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

test("runSourceProbe uses file mtime as session end when factory_droid records share one timestamp", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const factoryDir = path.join(tempRoot, "factory");
    await mkdir(factoryDir, { recursive: true });

    const sharedTimestamp = "2026-03-09T05:00:00.000Z";
    await writeFile(
      path.join(factoryDir, "session.jsonl"),
      [
        { timestamp: sharedTimestamp, type: "session_start", sessionTitle: "Flat session", cwd: "/workspace/flat" },
        { timestamp: sharedTimestamp, type: "message", message: { role: "user", content: [{ type: "text", text: "Hello" }] } },
        { timestamp: sharedTimestamp, type: "message", message: { role: "assistant", content: [{ type: "text", text: "Hi there!" }] } },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf8",
    );

    const fileMtime = new Date("2026-03-09T05:10:00.000Z");
    await utimes(path.join(factoryDir, "session.jsonl"), fileMtime, fileMtime);

    const [payload] = (
      await runSourceProbe({ limit_files_per_source: 1 }, [
        createSourceDefinition("src-factory-flat", "factory_droid", factoryDir),
      ])
    ).sources;

    assert.ok(payload);
    assert.equal(payload.sessions.length, 1);
    const session = payload.sessions[0]!;
    assert.equal(session.created_at, sharedTimestamp);
    assert.equal(session.updated_at, fileMtime.toISOString());

    assert.ok(payload.blobs[0]?.file_modified_at);
    assert.equal(payload.blobs[0]!.file_modified_at, fileMtime.toISOString());
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe uses file mtime as session end when amp messages share one timestamp", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const ampDir = path.join(tempRoot, "amp");
    await mkdir(ampDir, { recursive: true });

    const sharedTimestamp = "2026-03-09T06:00:00.000Z";
    const sharedEpoch = new Date(sharedTimestamp).getTime();
    await writeFile(
      path.join(ampDir, "thread.json"),
      JSON.stringify({
        id: "amp-flat-1",
        created: sharedEpoch,
        title: "Flat AMP thread",
        env: { initial: { trees: [{ uri: "file:///workspace/amp-flat", displayName: "amp-flat" }] } },
        messages: [
          { meta: { sentAt: sharedEpoch }, role: "user", content: [{ type: "text", text: "Summarize." }] },
          { meta: { sentAt: sharedEpoch }, role: "assistant", content: [{ type: "text", text: "Here is the summary." }] },
        ],
      }),
      "utf8",
    );

    const fileMtime = new Date("2026-03-09T06:05:00.000Z");
    await utimes(path.join(ampDir, "thread.json"), fileMtime, fileMtime);

    const [payload] = (
      await runSourceProbe({ limit_files_per_source: 1 }, [
        createSourceDefinition("src-amp-flat", "amp", ampDir),
      ])
    ).sources;

    assert.ok(payload);
    assert.equal(payload.sessions.length, 1);
    const session = payload.sessions[0]!;
    assert.equal(session.created_at, sharedTimestamp);
    assert.equal(session.updated_at, fileMtime.toISOString());
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe does not use file mtime when atom timestamps already differ", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const factoryDir = path.join(tempRoot, "factory");
    await mkdir(factoryDir, { recursive: true });

    await writeFile(
      path.join(factoryDir, "session.jsonl"),
      [
        { timestamp: "2026-03-09T07:00:00.000Z", type: "session_start", sessionTitle: "Normal", cwd: "/workspace/normal" },
        { timestamp: "2026-03-09T07:00:01.000Z", type: "message", message: { role: "user", content: [{ type: "text", text: "Go" }] } },
        { timestamp: "2026-03-09T07:00:05.000Z", type: "message", message: { role: "assistant", content: [{ type: "text", text: "Done." }] } },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf8",
    );

    const fileMtime = new Date("2026-03-09T08:00:00.000Z");
    await utimes(path.join(factoryDir, "session.jsonl"), fileMtime, fileMtime);

    const [payload] = (
      await runSourceProbe({ limit_files_per_source: 1 }, [
        createSourceDefinition("src-factory-normal", "factory_droid", factoryDir),
      ])
    ).sources;

    assert.ok(payload);
    const session = payload.sessions[0]!;
    assert.equal(session.updated_at, "2026-03-09T07:00:05.000Z");
    assert.notEqual(session.updated_at, fileMtime.toISOString());
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe ingests CodeBuddy transcript JSONL while keeping skipRun echoes and empty siblings out of turns", async () => {
  const mockDataRoot = getRepoMockDataRoot();
  const source = createSourceDefinition("src-codebuddy", "codebuddy", path.join(mockDataRoot, ".codebuddy"));

  const [payload] = (await runSourceProbe({ source_ids: [source.id] }, [source])).sources;

  assert.ok(payload);
  assert.equal(payload.source.platform, "codebuddy");
  assert.equal(payload.source.sync_status, "healthy");
  assert.equal(payload.sessions.length, 2);
  assert.equal(payload.turns.length, 3);
  assert.equal(payload.sessions.some((session) => session.id.includes("11111111-2222-4333-8444-555555555555")), false);

  const canonicalTexts = payload.turns.map((turn) => turn.canonical_text);
  assert.equal(canonicalTexts.some((text) => text.includes("Caveat: local command echoes below")), false);
  assert.equal(canonicalTexts.some((text) => text.includes("<command-name>/model</command-name>")), false);
  assert.equal(canonicalTexts.some((text) => text.includes("Find practical AI learning resources")), true);
  assert.equal(canonicalTexts.some((text) => text.includes("two-week practice sprint")), true);
  assert.equal(canonicalTexts.some((text) => text.includes("Read @requirement.md and restate")), true);

  const aiLearningSession = payload.sessions.find((session) => session.id.includes("22222222-3333-4444-8555-666666666666"));
  assert.ok(aiLearningSession);
  assert.match(aiLearningSession?.title ?? "", /Find practical AI learning resources/);
  assert.equal(aiLearningSession?.source_native_project_ref, "config-workspace-ai_learning");

  const blobPaths = payload.blobs.map((blob) => blob.origin_path);
  assert.equal(blobPaths.some((value) => value.endsWith(path.join(".codebuddy", "settings.json"))), true);
  assert.equal(blobPaths.some((value) => value.includes(path.join(".codebuddy", "local_storage"))), true);

  const skipRunAudit = payload.loss_audits.find((audit) => audit.diagnostic_code === "codebuddy_skiprun_command_echo");
  assert.ok(skipRunAudit);
});

async function seedSupportedSourceFixtures(tempRoot: string): Promise<SourceDefinition[]> {
  const codexDir = path.join(tempRoot, "codex");
  const claudeDir = path.join(tempRoot, "claude");
  const factoryDir = path.join(tempRoot, "factory");
  const ampDir = path.join(tempRoot, "amp");

  await mkdir(codexDir, { recursive: true });
  await mkdir(claudeDir, { recursive: true });
  await mkdir(factoryDir, { recursive: true });
  await mkdir(ampDir, { recursive: true });

  await writeFile(
    path.join(codexDir, "session.jsonl"),
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

async function seedMalformedSourceFixtures(tempRoot: string): Promise<SourceDefinition[]> {
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

async function seedMultiTurnCodexFixture(tempRoot: string): Promise<SourceDefinition> {
  const codexDir = path.join(tempRoot, "codex-multi-turn");
  await mkdir(codexDir, { recursive: true });

  await writeFile(
    path.join(codexDir, "session.jsonl"),
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

async function seedCodexInjectedScaffoldFixture(tempRoot: string): Promise<SourceDefinition> {
  const codexDir = path.join(tempRoot, "codex-injected-scaffold");
  await mkdir(codexDir, { recursive: true });

  await writeFile(
    path.join(codexDir, "session.jsonl"),
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

async function seedCodexInjectedOnlyFixture(tempRoot: string): Promise<SourceDefinition> {
  const codexDir = path.join(tempRoot, "codex-injected-only");
  await mkdir(codexDir, { recursive: true });

  await writeFile(
    path.join(codexDir, "session.jsonl"),
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

async function seedClaudeInterruptedFixture(tempRoot: string): Promise<SourceDefinition> {
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

async function seedWindowsNormalizedWorkspaceFixtures(tempRoot: string): Promise<SourceDefinition[]> {
  const codexDir = path.join(tempRoot, "codex-win-normalized");
  const claudeDir = path.join(tempRoot, "claude-win-normalized");
  const factoryDir = path.join(tempRoot, "factory-win-normalized");
  const ampDir = path.join(tempRoot, "amp-win-normalized");

  await mkdir(codexDir, { recursive: true });
  await mkdir(claudeDir, { recursive: true });
  await mkdir(factoryDir, { recursive: true });
  await mkdir(ampDir, { recursive: true });

  await writeFile(
    path.join(codexDir, "session.jsonl"),
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

async function seedNormalizedWorkspaceFixtures(tempRoot: string): Promise<SourceDefinition[]> {
  const codexDir = path.join(tempRoot, "codex-normalized");
  const claudeDir = path.join(tempRoot, "claude-normalized");
  const factoryDir = path.join(tempRoot, "factory-normalized");
  const ampDir = path.join(tempRoot, "amp-normalized");

  await mkdir(codexDir, { recursive: true });
  await mkdir(claudeDir, { recursive: true });
  await mkdir(factoryDir, { recursive: true });
  await mkdir(ampDir, { recursive: true });

  await writeFile(
    path.join(codexDir, "session.jsonl"),
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

async function seedRepoEvidenceFixtures(tempRoot: string): Promise<SourceDefinition[]> {
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
    path.join(codexDir, "session.jsonl"),
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

async function seedTokenProjectionFixtures(tempRoot: string): Promise<SourceDefinition[]> {
  const codexDir = path.join(tempRoot, "codex-tokens");
  const claudeDir = path.join(tempRoot, "claude-tokens");
  const factoryDir = path.join(tempRoot, "factory-tokens");
  const ampDir = path.join(tempRoot, "amp-tokens");

  await mkdir(codexDir, { recursive: true });
  await mkdir(claudeDir, { recursive: true });
  await mkdir(factoryDir, { recursive: true });
  await mkdir(ampDir, { recursive: true });

  await writeFile(
    path.join(codexDir, "session.jsonl"),
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

async function seedClaudeModelSwitchFixture(tempRoot: string): Promise<SourceDefinition> {
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

async function seedMultiTurnCodexTokenFixture(tempRoot: string): Promise<SourceDefinition> {
  const codexDir = path.join(tempRoot, "codex-token-checkpoints");
  await mkdir(codexDir, { recursive: true });

  await writeFile(
    path.join(codexDir, "session.jsonl"),
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

async function seedMultiReplyCodexTokenFixture(tempRoot: string): Promise<SourceDefinition> {
  const codexDir = path.join(tempRoot, "codex-token-multi-reply");
  await mkdir(codexDir, { recursive: true });

  await writeFile(
    path.join(codexDir, "session.jsonl"),
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

async function seedCodexCumulativeTokenFixture(tempRoot: string): Promise<SourceDefinition> {
  const codexDir = path.join(tempRoot, "codex-token-cumulative");
  await mkdir(codexDir, { recursive: true });

  await writeFile(
    path.join(codexDir, "session.jsonl"),
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

async function seedExpandedSourceFixtures(tempRoot: string): Promise<SourceDefinition[]> {
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

function seedCursorStyleStateDb(
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

function seedCursorPromptHistoryDb(
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

function seedAntigravityTrajectoryStateDb(
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

function seedAntigravityHistoryStateDb(
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

function seedAntigravityEmptyStateDb(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB NOT NULL)");
  } finally {
    db.close();
  }
}

function encodeAntigravityTrajectorySummary(options: {
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

function encodeTimestamp(value: string): Buffer {
  const millis = Date.parse(value);
  const seconds = Math.floor(millis / 1000);
  const nanos = (millis % 1000) * 1_000_000;
  return encodeLengthDelimitedFields([
    [1, seconds],
    [2, nanos],
  ]);
}

function encodeLengthDelimitedFields(fields: Array<[number, Buffer | number]>): Buffer {
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

function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = value >>> 0;
  while (remaining >= 0x80) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  bytes.push(remaining);
  return Buffer.from(bytes);
}

function createSourceDefinition(
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

function getRepoMockDataRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../mock_data");
}

async function readStableAdapterValidationManifest(): Promise<StableAdapterValidationManifest> {
  return readJsonFixture<StableAdapterValidationManifest>(
    path.join(getRepoMockDataRoot(), "stable-adapter-validation.json"),
  );
}

async function readJsonFixture<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function assertFragmentKinds(
  payload: SourceSyncPayload | undefined,
  expectedKinds: FragmentKind[],
): void {
  assert.ok(payload);
  const fragmentKinds = new Set(payload.fragments.map((fragment) => fragment.fragment_kind));
  for (const fragmentKind of expectedKinds) {
    assert.ok(fragmentKinds.has(fragmentKind), `expected ${payload.source.platform} to emit ${fragmentKind}`);
  }
}

async function initGitRepo(repoRoot: string, remoteUrl: string): Promise<void> {
  await execFileAsync("git", ["init", repoRoot]);
  await execFileAsync("git", ["-C", repoRoot, "remote", "add", "origin", remoteUrl]);
}

function assertParserMetadata(payload: SourceSyncPayload): void {
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
