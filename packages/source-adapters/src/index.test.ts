import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { FragmentKind, SourceDefinition, SourceSyncPayload } from "@cchistory/domain";
import { getDefaultSourcesForHost, getSourceFormatProfiles, runSourceProbe } from "./index.js";
import { listPlatformAdapters } from "./platforms/registry.js";

test("platform adapter registry provides exactly one adapter per supported platform", () => {
  const adapters = listPlatformAdapters();
  const platforms = adapters.map((adapter) => adapter.platform).sort();

  assert.deepEqual(platforms, [
    "amp",
    "antigravity",
    "claude_code",
    "codex",
    "cursor",
    "factory_droid",
    "lobechat",
    "openclaw",
    "opencode",
  ]);
  assert.equal(new Set(platforms).size, adapters.length);
});

const execFileAsync = promisify(execFile);

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

test("runSourceProbe enriches project observations with repo evidence when git metadata is available", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const sources = await seedRepoEvidenceFixtures(tempRoot);
    const result = await runSourceProbe({ limit_files_per_source: 1 }, sources);
    const fingerprints = new Set<string>();

    for (const payload of result.sources) {
      const projectObservation = payload.candidates.find((candidate) => candidate.candidate_kind === "project_observation");
      assert.ok(projectObservation, `expected project observation for ${payload.source.platform}`);
      assert.ok(projectObservation.evidence.repo_root, `expected repo root for ${payload.source.platform}`);
      assert.equal(
        projectObservation.evidence.repo_remote,
        "https://example.com/org/normalized-project",
        `expected normalized repo remote for ${payload.source.platform}`,
      );
      assert.ok(projectObservation.evidence.repo_fingerprint, `expected repo fingerprint for ${payload.source.platform}`);
      fingerprints.add(String(projectObservation.evidence.repo_fingerprint));
    }

    assert.equal(fingerprints.size, 1);
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
    assert.equal(claudePayload?.turns[0]?.context_summary.token_usage?.input_tokens, 30);
    assert.equal(claudePayload?.turns[0]?.context_summary.token_usage?.cache_creation_input_tokens, 5);
    assert.equal(claudePayload?.turns[0]?.context_summary.token_usage?.cache_read_input_tokens, 2);
    assert.equal(claudePayload?.turns[0]?.context_summary.token_usage?.cached_input_tokens, 7);
    assert.equal(claudePayload?.turns[0]?.context_summary.token_usage?.output_tokens, 10);
    assert.equal(claudePayload?.contexts[0]?.assistant_replies[0]?.token_count, 47);
    assert.equal(claudePayload?.contexts[0]?.assistant_replies[0]?.token_usage?.cache_creation_input_tokens, 5);
    assert.equal(claudePayload?.contexts[0]?.assistant_replies[0]?.token_usage?.cache_read_input_tokens, 2);
    assert.equal(claudePayload?.contexts[0]?.assistant_replies[0]?.token_usage?.cached_input_tokens, 7);
    assert.equal(claudePayload?.contexts[0]?.assistant_replies[0]?.stop_reason, "tool_use");

    const factoryPayload = payloadsByPlatform.get("factory_droid");
    assert.equal(factoryPayload?.turns[0]?.context_summary.total_tokens, 18);
    assert.equal(factoryPayload?.turns[0]?.context_summary.token_usage?.input_tokens, 9);
    assert.equal(factoryPayload?.turns[0]?.context_summary.token_usage?.cache_creation_input_tokens, 1);
    assert.equal(factoryPayload?.turns[0]?.context_summary.token_usage?.cache_read_input_tokens, 2);
    assert.equal(factoryPayload?.turns[0]?.context_summary.token_usage?.cached_input_tokens, 3);
    assert.equal(factoryPayload?.turns[0]?.context_summary.token_usage?.output_tokens, 6);
    assert.equal(factoryPayload?.turns[0]?.context_summary.token_usage?.reasoning_output_tokens, 3);
    assert.equal(factoryPayload?.contexts[0]?.assistant_replies[0]?.token_count, 18);
    assert.equal(factoryPayload?.contexts[0]?.assistant_replies[0]?.stop_reason, "end_turn");

    const ampPayload = payloadsByPlatform.get("amp");
    assert.equal(ampPayload?.turns[0]?.context_summary.total_tokens, 24);
    assert.equal(ampPayload?.turns[0]?.context_summary.token_usage?.input_tokens, 14);
    assert.equal(ampPayload?.turns[0]?.context_summary.token_usage?.cache_creation_input_tokens, 2);
    assert.equal(ampPayload?.turns[0]?.context_summary.token_usage?.cache_read_input_tokens, 1);
    assert.equal(ampPayload?.turns[0]?.context_summary.token_usage?.cached_input_tokens, 3);
    assert.equal(ampPayload?.turns[0]?.context_summary.token_usage?.output_tokens, 7);
    assert.equal(ampPayload?.contexts[0]?.assistant_replies[0]?.token_count, 24);
    assert.equal(ampPayload?.contexts[0]?.assistant_replies[0]?.stop_reason, "max_tokens");
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

test("runSourceProbe supports cursor antigravity openclaw opencode and lobechat fixtures", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const sources = await seedExpandedSourceFixtures(tempRoot);
    const result = await runSourceProbe({ limit_files_per_source: 1 }, sources);
    const payloadsByPlatform = new Map(result.sources.map((payload) => [payload.source.platform, payload]));

    for (const platform of ["cursor", "openclaw", "opencode", "lobechat"] as const) {
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
    assert.equal(payloadsByPlatform.get("opencode")?.sessions[0]?.title, "OpenCode fixture");
    assert.equal(payloadsByPlatform.get("lobechat")?.source.family, "conversational_export");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runSourceProbe preserves real mock_data coverage across codex claude cursor and antigravity roots", async () => {
  const mockDataRoot = getRepoMockDataRoot();
  const result = await runSourceProbe({}, [
    createSourceDefinition("src-codex-mock-data", "codex", path.join(mockDataRoot, ".codex", "sessions")),
    createSourceDefinition("src-claude-mock-data", "claude_code", path.join(mockDataRoot, ".claude", "projects")),
    createSourceDefinition(
      "src-cursor-mock-data",
      "cursor",
      path.join(mockDataRoot, "Library", "Application Support", "Cursor", "User"),
    ),
    createSourceDefinition(
      "src-antigravity-mock-data",
      "antigravity",
      path.join(mockDataRoot, "Library", "Application Support", "antigravity", "User"),
    ),
  ]);
  const payloadsByPlatform = new Map(result.sources.map((payload) => [payload.source.platform, payload]));

  assert.equal(result.sources.length, 4);

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
  assert.ok(claudePayload.sessions.length >= 4);
  assert.ok(claudePayload.turns.length >= 4);
  assert.ok(claudePayload.contexts.length >= 4);
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

  const antigravityPayload = payloadsByPlatform.get("antigravity");
  assert.ok(antigravityPayload);
  assert.equal(antigravityPayload.source.sync_status, "healthy");
  assert.ok(antigravityPayload.sessions.length >= 1);
  assert.ok(antigravityPayload.records.length >= 100);
  assert.ok(antigravityPayload.fragments.length >= 100);
  assert.ok(antigravityPayload.loss_audits.length >= 50);
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
  const opencodeSessionDir = path.join(opencodeRoot, "session");
  const opencodeMessageDir = path.join(opencodeRoot, "message", "opencode-fixture");
  const lobechatDir = path.join(tempRoot, "lobechat");

  await mkdir(cursorDir, { recursive: true });
  await mkdir(antigravityGlobalDir, { recursive: true });
  await mkdir(openclawDir, { recursive: true });
  await mkdir(opencodeSessionDir, { recursive: true });
  await mkdir(opencodeMessageDir, { recursive: true });
  await mkdir(lobechatDir, { recursive: true });

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
        timestamp: "2026-03-10T04:00:00.000Z",
        role: "user",
        content: "Inspect OpenClaw history.",
      },
      {
        timestamp: "2026-03-10T04:00:01.000Z",
        role: "assistant",
        usage: {
          input_tokens: 7,
          output_tokens: 3,
          total_tokens: 10,
        },
        stopReason: "end_turn",
        content: [{ type: "text", text: "OpenClaw history loaded." }],
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
      cwd: "/workspace/opencode",
      model: "sonnet-4",
      createdAt: "2026-03-10T05:00:00.000Z",
      updatedAt: "2026-03-10T05:00:02.000Z",
    }),
    "utf8",
  );
  await writeFile(
    path.join(opencodeMessageDir, "0001.json"),
    JSON.stringify({
      info: {
        id: "opencode-user-1",
        role: "user",
        createdAt: "2026-03-10T05:00:01.000Z",
      },
      parts: [{ type: "text", text: "Inspect OpenCode history." }],
    }),
    "utf8",
  );
  await writeFile(
    path.join(opencodeMessageDir, "0002.json"),
    JSON.stringify({
      info: {
        id: "opencode-assistant-1",
        role: "assistant",
        createdAt: "2026-03-10T05:00:02.000Z",
        stopReason: "end_turn",
      },
      usage: {
        inputTokens: 8,
        outputTokens: 4,
        totalTokens: 12,
      },
      parts: [{ type: "text", text: "OpenCode history loaded." }],
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
    createSourceDefinition("src-openclaw-fixture", "openclaw", path.join(tempRoot, "openclaw")),
    createSourceDefinition("src-opencode-fixture", "opencode", opencodeSessionDir),
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
