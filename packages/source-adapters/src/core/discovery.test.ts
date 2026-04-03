import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { SourceDefinition, SourceSyncPayload } from "@cchistory/domain";
import { discoverDefaultSourcesForHost, discoverHostToolsForHost, runSourceProbe } from "../index.js";
import { 
  assertFragmentKinds, 
  assertParserMetadata, 
  seedSupportedSourceFixtures, 
  seedExpandedSourceFixtures, 
  seedWindowsNormalizedWorkspaceFixtures, 
  seedNormalizedWorkspaceFixtures, 
  seedRepoEvidenceFixtures,
  seedMalformedSourceFixtures,
  seedMultiTurnCodexFixture,
  seedCodexInjectedScaffoldFixture,
  seedCodexInjectedOnlyFixture,
  seedClaudeInterruptedFixture,
  getRepoMockDataRoot,
  readStableAdapterValidationManifest,
  createSourceDefinition
} from "../test-helpers.js";

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

