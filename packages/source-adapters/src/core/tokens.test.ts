import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runSourceProbe } from "../index.js";
import { 
  seedTokenProjectionFixtures, 
  seedClaudeModelSwitchFixture, 
  seedMultiTurnCodexTokenFixture, 
  seedMultiReplyCodexTokenFixture, 
  seedCodexCumulativeTokenFixture 
} from "../test-helpers.js";

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

