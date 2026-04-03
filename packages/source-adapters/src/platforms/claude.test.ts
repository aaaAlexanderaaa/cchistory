import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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

