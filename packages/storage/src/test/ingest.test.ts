import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SourceSyncPayload } from "@cchistory/domain";
import { CCHistoryStorage } from "../index.js";
import { mergeSourcePayloadStreaming, type SourcePayloadStreamingChunk } from "../evidence-store.js";
import { createFixturePayload } from "./helpers.js";

test("replaceSourcePayload persists pipeline layers and lineage drill-down", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(createFixturePayload("src-storage-test", "Need lineage", "stage-run-1"));

    assert.equal(storage.isEmpty(), false);
    assert.equal(storage.listSources().length, 1);
    assert.equal(storage.listStageRuns().length, 1);
    assert.equal(storage.listLossAudits().length, 1);
    assert.equal(storage.listBlobs().length, 1);
    assert.equal(storage.listRecords().length, 1);
    assert.equal(storage.listFragments().length, 4);
    assert.equal(storage.listAtoms().length, 4);
    assert.equal(storage.listEdges().length, 2);
    assert.equal(storage.listCandidates().length, 3);
    assert.equal(storage.listTurns().length, 1);
    assert.equal(storage.getSession("session-1")?.id, "session-1");
    assert.equal(storage.getTurn("turn-1")?.canonical_text, "Need lineage");
    assert.equal(storage.getTurnContext("turn-1")?.tool_calls.length, 1);

    const lineage = storage.getTurnLineage("turn-1");
    assert.ok(lineage);
    assert.equal(lineage.session?.id, "session-1");
    assert.equal(lineage.candidate_chain.length, 3);
    assert.equal(lineage.atoms.length, 4);
    assert.equal(lineage.edges.length, 2);
    assert.equal(lineage.fragments.length, 4);
    assert.equal(lineage.records.length, 1);
    assert.equal(lineage.blobs.length, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("replaceSourcePayload replaces prior rows for the same source deterministically", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-replace-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(createFixturePayload("src-1", "Initial text", "sr-1"));
    assert.equal(storage.listTurns().length, 1);
    assert.equal(storage.listTurns()[0]?.canonical_text, "Initial text");

    storage.replaceSourcePayload(createFixturePayload("src-1", "New text", "sr-2"));
    assert.equal(storage.listTurns().length, 1);
    assert.equal(storage.listTurns()[0]?.canonical_text, "New text");
    assert.equal(storage.listLossAudits().length, 1);
    assert.match(storage.listLossAudits()[0]?.detail ?? "", /updated fixture/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("replaceSourcePayload can rekey a local source when host identity changes", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-rekey-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const baseDir = "/tmp/rekey-test";

    // Initial ingest from host-a
    storage.replaceSourcePayload(
      createFixturePayload("src-rekey", "Text A", "sr-a", { hostId: "host-a", baseDir }),
    );
    assert.equal(storage.listSources().length, 1);
    const sourceA = storage.listSources()[0]!;
    assert.equal(sourceA.host_id, "host-a");

    // Re-ingest same baseDir from host-b (allow_host_rekey enables cross-host identity match)
    storage.replaceSourcePayload(
      createFixturePayload("src-rekey-new", "Text B", "sr-b", { hostId: "host-b", baseDir }),
      { allow_host_rekey: true },
    );

    // Should have replaced the source because baseDir matched
    assert.equal(storage.listSources().length, 1);
    const sourceB = storage.listSources()[0]!;
    assert.equal(sourceB.host_id, "host-b");
    assert.equal(storage.listTurns().length, 1);
    assert.equal(storage.listTurns()[0]?.canonical_text, "Text B");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("replaceSourcePayload tolerates duplicate blob rows within one payload", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-dup-blob-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const payload = createFixturePayload("src-dup", "Dup test", "sr-dup");
    payload.blobs.push({ ...payload.blobs[0]! });

    storage.replaceSourcePayload(payload);
    assert.equal(storage.listBlobs().length, 1, "Should deduplicate blobs on write");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("replaceSourcePayload tolerates duplicate loss audit rows within one payload", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-dup-audit-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const payload = createFixturePayload("src-dup", "Dup test", "sr-dup");
    payload.loss_audits.push({ ...payload.loss_audits[0]! });

    storage.replaceSourcePayload(payload);
    assert.equal(storage.listLossAudits().length, 1, "Should deduplicate loss audits on write");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("countSourceLossAuditsByStage excludes informational audits from failure counts", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-loss-audit-severity-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const payload = createFixturePayload("src-loss-audit-severity", "Severity test", "sr-severity");
    payload.loss_audits.push({
      ...payload.loss_audits[0]!,
      id: "info-loss-audit",
      diagnostic_code: "fixture_info",
      severity: "info",
      detail: "fixture info audit",
    });

    storage.replaceSourcePayload(payload);
    const sourceId = storage.listSources()[0]!.id;
    const counts = storage.countSourceLossAuditsByStage(sourceId);

    assert.equal(storage.listLossAudits().length, 2);
    assert.equal(counts.finalize_projections, 1);

    const db = new DatabaseSync(path.join(dataDir, "cchistory.sqlite"));
    try {
      const severities = db.prepare("SELECT severity, COUNT(*) AS count FROM loss_audits GROUP BY severity ORDER BY severity").all() as Array<{
        severity: string;
        count: number;
      }>;
      assert.deepEqual(severities.map(({ severity, count }) => ({ severity, count })), [
        { severity: "info", count: 1 },
        { severity: "warning", count: 1 },
      ]);
      assertPlanUsesIndex(
        db,
        "SELECT stage_kind, COUNT(*) AS count FROM loss_audits INDEXED BY idx_loss_audits_source_failure_stage WHERE source_id = ? AND severity IN ('warning', 'error') GROUP BY stage_kind",
        [sourceId],
        "idx_loss_audits_source_failure_stage",
      );
    } finally {
      db.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("replaceSourcePayload with zero turns creates source but isEmpty behavior is correct", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-empty-payload-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const payload = createFixturePayload("src-empty", "No turns", "sr-empty");
    payload.turns = [];
    payload.sessions = [];
    payload.source.total_turns = 0;
    payload.source.total_sessions = 0;

    storage.replaceSourcePayload(payload);
    assert.equal(storage.isEmpty(), false, "Storage with a source is not empty even if no turns exist");
    assert.equal(storage.listSources().length, 1);
    assert.equal(storage.listTurns().length, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("replaceSourcePayload is idempotent - double ingest produces same state", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-idempotent-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const payload = createFixturePayload("src-idempotent", "Idempotent test", "sr-idem", {
      turnId: "turn-idem",
      sessionId: "session-idem",
      projectObservation: {
        workspacePath: "/workspace/idem",
        repoFingerprint: "fp-idem",
        repoRemote: "https://github.com/test/idem",
      },
    });

    storage.replaceSourcePayload(payload);
    const turnsAfterFirst = storage.listTurns().length;
    const projectsAfterFirst = storage.listProjects().length;

    storage.replaceSourcePayload(payload);
    const turnsAfterSecond = storage.listTurns().length;
    const projectsAfterSecond = storage.listProjects().length;

    assert.equal(turnsAfterFirst, turnsAfterSecond, "Turn count should not change on re-ingest");
    assert.equal(projectsAfterFirst, projectsAfterSecond, "Project count should not change on re-ingest");
    assert.equal(storage.listSources().length, 1, "Should still have exactly one source");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("multiple sources coexist and query independently", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-multi-src-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-multi-a", "Source A turn", "sr-a", {
        turnId: "turn-multi-a",
        sessionId: "session-multi-a",
        hostId: "host-multi",
        projectObservation: {
          workspacePath: "/workspace/multi-a",
          repoFingerprint: "fp-multi-a",
          repoRemote: "https://github.com/test/multi-a",
        },
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-multi-b", "Source B turn", "sr-b", {
        turnId: "turn-multi-b",
        sessionId: "session-multi-b",
        hostId: "host-multi",
        projectObservation: {
          workspacePath: "/workspace/multi-b",
          repoFingerprint: "fp-multi-b",
          repoRemote: "https://github.com/test/multi-b",
        },
      }),
    );

    assert.equal(storage.listSources().length, 2);
    assert.equal(storage.listTurns().length, 2);

    // Replacing one source should not affect the other
    storage.replaceSourcePayload(
      createFixturePayload("src-multi-a", "Source A updated", "sr-a2", {
        turnId: "turn-multi-a-v2",
        sessionId: "session-multi-a-v2",
        hostId: "host-multi",
        projectObservation: {
          workspacePath: "/workspace/multi-a",
          repoFingerprint: "fp-multi-a",
          repoRemote: "https://github.com/test/multi-a",
        },
      }),
    );

    assert.equal(storage.listSources().length, 2, "Should still have 2 sources");
    assert.equal(storage.listTurns().length, 2, "Should have 2 turns (1 replaced + 1 unchanged)");
    const turns = storage.listTurns();
    assert.ok(
      turns.some((t) => t.id === "turn-multi-a-v2"),
      "Source A should have updated turn",
    );
    assert.ok(
      turns.some((t) => t.id === "turn-multi-b"),
      "Source B turn should be unchanged",
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("replaceSourcePayload with legacy src- prefixed ID re-derives stable ID", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-legacy-id-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const payload = createFixturePayload("src-legacy", "Legacy ID", "sr-legacy", {
      hostId: "host-legacy",
      baseDir: "/tmp/legacy",
    });

    storage.replaceSourcePayload(payload);
    const sources = storage.listSources();
    assert.equal(sources.length, 1);
    // Should NOT have src- prefix in the actual stored ID if it was derived from host/path
    assert.ok(!sources[0]!.id.startsWith("src-src-"));
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("replaceSourcePayload with Windows-style backslash paths normalizes correctly", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-win-paths-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const winPath = "C:\\Users\\tester\\project";
    const payload = createFixturePayload("src-win", "Windows path", "sr-win", {
      workingDirectory: winPath,
      projectObservation: {
        workspacePath: winPath,
      },
    });

    storage.replaceSourcePayload(payload);
    const projects = storage.listProjects();
    assert.equal(projects[0]?.primary_workspace_path, "c:/Users/tester/project");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("replaceSourcePayload treats equivalent Windows source roots as one source identity", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-win-identity-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const winPath1 = "C:\\Users\\tester\\.codex";
    const winPath2 = "c:/Users/tester/.codex";

    storage.replaceSourcePayload(
      createFixturePayload("src-win-1", "Turn 1", "sr-1", {
        hostId: "win-host",
        baseDir: winPath1,
      }),
    );
    assert.equal(storage.listSources().length, 1);

    storage.replaceSourcePayload(
      createFixturePayload("src-win-2", "Turn 2", "sr-2", {
        hostId: "win-host",
        baseDir: winPath2,
      }),
    );

    assert.equal(storage.listSources().length, 1, "Should treat case/slash variants of same Windows path as one source");
    assert.equal(storage.listTurns().length, 1);
    assert.equal(storage.listTurns()[0]?.canonical_text, "Turn 2");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("getSourcePayload returns undefined for unknown source ID", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-unknown-src-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const result = storage.getSourcePayload("src-does-not-exist");
    assert.equal(result, undefined);
    assert.equal(storage.getSourceIncrementalPayload("src-does-not-exist"), undefined);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("getSourceIncrementalPayload omits read projections while preserving reuse inputs", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-incremental-payload-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(createFixturePayload("src-incremental", "Need fast reuse", "stage-run-incremental"));

    const sourceId = storage.listSources()[0]?.id;
    assert.ok(sourceId);
    const payload = storage.getSourceIncrementalPayload(sourceId);
    assert.ok(payload);
    assert.equal(payload.stage_runs.length, 1);
    assert.equal(payload.loss_audits.length, 1);
    assert.equal(payload.blobs.length, 1);
    assert.equal(payload.records.length, 1);
    assert.equal(payload.fragments.length, 4);
    assert.equal(payload.atoms.length, 4);
    assert.equal(payload.edges.length, 2);
    assert.equal(payload.sessions.length, 1);
    assert.deepEqual(payload.candidates, []);
    assert.deepEqual(payload.turns, []);
    assert.deepEqual(payload.contexts, []);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("mergeSourcePayloadByOriginPath preserves skipped files and removes absent files", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-partial-source-merge-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const sourceId = "src-partial-merge";
    const baseDir = "/tmp/partial-merge";
    const keepPath = path.join(baseDir, "keep.jsonl");
    const stalePath = path.join(baseDir, "stale.jsonl");
    const newPath = path.join(baseDir, "new.jsonl");

    const keep = createFixturePayload(sourceId, "Keep old turn", "sr-keep", {
      baseDir,
      sessionId: "session-keep",
      turnId: "turn-keep",
    });
    keep.blobs[0]!.origin_path = keepPath;
    const stale = createFixturePayload(sourceId, "Drop stale turn", "sr-stale", {
      baseDir,
      sessionId: "session-stale",
      turnId: "turn-stale",
    });
    stale.blobs[0]!.origin_path = stalePath;
    storage.replaceSourcePayload(combineSourcePayloads(keep, stale));
    assert.equal(storage.listTurns().length, 2);

    const incoming = createFixturePayload(sourceId, "Add new turn", "sr-new", {
      baseDir,
      sessionId: "session-new",
      turnId: "turn-new",
    });
    incoming.blobs[0]!.origin_path = newPath;
    const counts = storage.mergeSourcePayloadByOriginPath(incoming, {
      preserve_origin_paths: [keepPath],
      observed_origin_paths: [keepPath, newPath],
    });

    assert.equal(counts.turns, 2);
    assert.equal(counts.blobs, 2);
    assert.deepEqual(storage.listTurns().map((turn) => turn.canonical_text).sort(), ["Add new turn", "Keep old turn"]);
    assert.deepEqual(storage.listBlobs().map((blob) => blob.origin_path).sort(), [keepPath, newPath].sort());
    assert.equal(storage.listSources()[0]?.total_turns, 2);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("mergeSourcePayloadByOriginPath does not rewrite preserved skipped file payload rows", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-partial-source-preserve-noop-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const sourceId = "src-partial-preserve-noop";
    const baseDir = "/tmp/partial-preserve-noop";
    const keepPath = path.join(baseDir, "keep.jsonl");
    const newPath = path.join(baseDir, "new.jsonl");
    const originalCapturedAt = "2026-01-01T00:00:00.000Z";
    const incomingCapturedAt = "2026-02-01T00:00:00.000Z";

    const keep = createFixturePayload(sourceId, "Keep skipped turn", "sr-keep-noop", {
      baseDir,
      sessionId: "session-keep-noop",
      turnId: "turn-keep-noop",
    });
    keep.blobs[0]!.origin_path = keepPath;
    keep.blobs[0]!.captured_at = originalCapturedAt;
    storage.replaceSourcePayload(keep);

    const incomingKeep = createFixturePayload(sourceId, "Keep skipped turn", "sr-keep-noop", {
      baseDir,
      sessionId: "session-keep-noop",
      turnId: "turn-keep-noop",
    });
    incomingKeep.blobs[0]!.origin_path = keepPath;
    incomingKeep.blobs[0]!.captured_at = incomingCapturedAt;
    const incomingNew = createFixturePayload(sourceId, "Add new turn", "sr-new-noop", {
      baseDir,
      sessionId: "session-new-noop",
      turnId: "turn-new-noop",
    });
    incomingNew.blobs[0]!.origin_path = newPath;

    const counts = storage.mergeSourcePayloadByOriginPath(combineSourcePayloads(incomingKeep, incomingNew), {
      preserve_origin_paths: [keepPath],
      observed_origin_paths: [keepPath, newPath],
    });

    assert.equal(counts.turns, 2);
    assert.deepEqual(storage.listTurns().map((turn) => turn.canonical_text).sort(), ["Add new turn", "Keep skipped turn"]);
    const keptBlob = storage.listBlobs().find((blob) => blob.id === keep.blobs[0]!.id);
    assert.equal(keptBlob?.captured_at, originalCapturedAt);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("mergeSourcePayloadByOriginPath deletes observed paths that produced no blob", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-partial-source-blobless-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const sourceId = "src-partial-blobless";
    const baseDir = "/tmp/partial-blobless";
    const keepPath = path.join(baseDir, "keep.jsonl");
    const failedPath = path.join(baseDir, "failed.jsonl");

    const keep = createFixturePayload(sourceId, "Keep skipped turn", "sr-keep-blobless", {
      baseDir,
      sessionId: "session-keep-blobless",
      turnId: "turn-keep-blobless",
    });
    keep.blobs[0]!.origin_path = keepPath;
    const failed = createFixturePayload(sourceId, "Drop failed turn", "sr-failed-blobless", {
      baseDir,
      sessionId: "session-failed-blobless",
      turnId: "turn-failed-blobless",
    });
    failed.blobs[0]!.origin_path = failedPath;
    storage.replaceSourcePayload(combineSourcePayloads(keep, failed));
    assert.equal(storage.listTurns().length, 2);

    const incoming: SourceSyncPayload = {
      ...createFixturePayload(sourceId, "No rows", "sr-blobless-empty", { baseDir }),
      blobs: [],
      records: [],
      fragments: [],
      atoms: [],
      edges: [],
      candidates: [],
      sessions: [],
      turns: [],
      contexts: [],
    };
    const counts = storage.mergeSourcePayloadByOriginPath(incoming, {
      preserve_origin_paths: [keepPath],
      observed_origin_paths: [keepPath, failedPath],
    });

    assert.equal(counts.turns, 1);
    assert.equal(counts.blobs, 1);
    assert.deepEqual(storage.listTurns().map((turn) => turn.canonical_text), ["Keep skipped turn"]);
    assert.deepEqual(storage.listBlobs().map((blob) => blob.origin_path), [keepPath]);
    assert.equal(storage.listSources()[0]?.total_turns, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("evidence sync hot paths use indexed structural columns", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-query-plan-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const sourceId = "src-query-plan";
    const payload = createFixturePayload(sourceId, "Use indexed evidence paths", "sr-query-plan", {
      sessionId: "session-query-plan",
      turnId: "turn-query-plan",
    });
    const originPath = path.join(payload.source.base_dir, "query-plan.jsonl");
    payload.blobs[0]!.origin_path = originPath;

    storage.replaceSourcePayload(payload);
    const storedSourceId = storage.listSources()[0]!.id;

    const incremental = storage.getSourceIncrementalPayloadForOriginPaths(storedSourceId, [originPath]);
    assert.ok(incremental);
    assert.equal(incremental.blobs.length, 1);
    assert.equal(incremental.records.length, 1);
    assert.equal(incremental.fragments.length, 4);
    assert.equal(incremental.atoms.length, 4);
    assert.equal(incremental.edges.length, 2);
    assert.equal(incremental.loss_audits.length, 1);

    const db = new DatabaseSync(path.join(dataDir, "cchistory.sqlite"));
    try {
      assertPlanUsesIndex(
        db,
        "SELECT id FROM captured_blobs WHERE source_id = ? AND origin_path = ?",
        [storedSourceId, path.normalize(originPath)],
        "idx_captured_blobs_source_origin",
      );
      assertPlanUsesIndex(
        db,
        "SELECT COUNT(*) AS count FROM captured_blobs WHERE source_id = ?",
        [storedSourceId],
        "idx_captured_blobs_source",
      );
      assertPlanUsesIndex(
        db,
        "SELECT payload_json FROM raw_records WHERE source_id = ? AND blob_id = ? ORDER BY ordinal",
        [storedSourceId, payload.blobs[0]!.id],
        "idx_raw_records_source_blob_ordinal",
      );
      assertPlanUsesIndex(
        db,
        "SELECT payload_json FROM raw_records WHERE source_id = ? AND session_ref = ?",
        [storedSourceId, payload.records[0]!.session_ref],
        "idx_raw_records_source_session",
      );
      assertPlanUsesAnyIndex(
        db,
        "SELECT COUNT(*) AS count FROM raw_records WHERE source_id = ?",
        [storedSourceId],
        ["idx_raw_records_source_session", "idx_raw_records_source_blob_ordinal"],
      );
      assertPlanUsesIndex(
        db,
        "SELECT session_ref FROM raw_records WHERE source_id = ? AND blob_id = ?",
        [storedSourceId, payload.blobs[0]!.id],
        "idx_raw_records_source_blob_ordinal",
      );
      assertPlanUsesIndex(
        db,
        "SELECT turn_id FROM user_turns_v2 WHERE source_id = ? AND session_id = ?",
        [storedSourceId, payload.records[0]!.session_ref],
        "idx_user_turns_v2_source_session",
      );
      assertPlanUsesIndex(
        db,
        "SELECT payload_json FROM source_fragments WHERE source_id = ? AND session_ref = ? ORDER BY id",
        [storedSourceId, payload.records[0]!.session_ref],
        "idx_source_fragments_source_session",
      );
      assertPlanUsesIndex(
        db,
        "SELECT COUNT(*) AS count FROM source_fragments WHERE source_id = ?",
        [storedSourceId],
        "idx_source_fragments_source_session",
      );
      assertPlanUsesIndex(
        db,
        "SELECT payload_json FROM conversation_atoms WHERE source_id = ? AND session_ref = ? ORDER BY time_key ASC, seq_no ASC",
        [storedSourceId, payload.records[0]!.session_ref],
        "idx_conversation_atoms_source_session_order",
      );
      assertPlanUsesIndex(
        db,
        "SELECT COUNT(*) AS count FROM conversation_atoms WHERE source_id = ?",
        [storedSourceId],
        "idx_conversation_atoms_source_session_order",
      );
      assertPlanUsesIndex(
        db,
        "SELECT payload_json FROM atom_edges WHERE source_id = ? AND session_ref = ? ORDER BY id",
        [storedSourceId, payload.records[0]!.session_ref],
        "idx_atom_edges_source_session",
      );
      assertPlanUsesIndex(
        db,
        "SELECT COUNT(*) AS count FROM atom_edges WHERE source_id = ?",
        [storedSourceId],
        "idx_atom_edges_source_session",
      );
      assertPlanUsesIndex(
        db,
        "SELECT COUNT(*) AS count FROM loss_audits WHERE source_id = ?",
        [storedSourceId],
        "idx_loss_audits_source",
      );
      assertPlanUsesIndex(
        db,
        "DELETE FROM loss_audits WHERE source_id = ? AND session_ref = ?",
        [storedSourceId, payload.records[0]!.session_ref],
        "idx_loss_audits_source_session",
      );
      assertPlanUsesIndex(
        db,
        "DELETE FROM loss_audits WHERE source_id = ? AND blob_ref = ?",
        [storedSourceId, payload.blobs[0]!.id],
        "idx_loss_audits_source_blob",
      );
      assertPlanUsesIndex(
        db,
        "SELECT payload_json FROM loss_audits WHERE source_id = ? AND record_ref = ?",
        [storedSourceId, payload.records[0]!.id],
        "idx_loss_audits_source_record",
      );
      assertPlanUsesIndex(
        db,
        "SELECT payload_json FROM loss_audits WHERE source_id = ? AND fragment_ref = ?",
        [storedSourceId, payload.fragments[3]!.id],
        "idx_loss_audits_source_fragment",
      );
      assertPlanUsesIndex(
        db,
        "SELECT payload_json FROM loss_audits WHERE source_id = ? AND diagnostic_code = ?",
        [storedSourceId, payload.loss_audits[0]!.diagnostic_code],
        "idx_loss_audits_source_diagnostic",
      );
      assertPlanUsesIndex(
        db,
        "SELECT stage_kind, COUNT(*) AS count FROM loss_audits INDEXED BY idx_loss_audits_source_failure_stage WHERE source_id = ? AND severity IN ('warning', 'error') GROUP BY stage_kind",
        [storedSourceId],
        "idx_loss_audits_source_failure_stage",
      );
    } finally {
      db.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("upsertImportedBundle stores and retrieves bundle records", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-import-bundle-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const bundle = {
      bundle_id: "bundle-test-001",
      bundle_version: "1.0.0",
      imported_at: "2026-03-09T12:00:00.000Z",
      source_instance_ids: ["src-1", "src-2"],
      manifest: {
        bundle_id: "bundle-test-001",
        bundle_version: "1.0.0",
        exported_at: "2026-03-09T11:00:00.000Z",
        exported_from_host_ids: ["host-export"],
        schema_version: "1",
        source_instance_ids: ["src-1", "src-2"],
        counts: { sources: 2, sessions: 5, turns: 20, blobs: 10 },
        includes_raw_blobs: true,
        created_by: "cchistory-cli",
      },
      checksums: {
        manifest_sha256: "abc123",
        payload_sha256_by_source_id: { "src-1": "def456" },
        raw_sha256_by_path: {},
      },
    };

    storage.upsertImportedBundle(bundle);
    const retrieved = storage.getImportedBundle("bundle-test-001");
    assert.ok(retrieved);
    assert.equal(retrieved.bundle_id, "bundle-test-001");
    assert.deepEqual(retrieved.source_instance_ids, ["src-1", "src-2"]);

    // Upsert again should replace
    const updated = { ...bundle, imported_at: "2026-03-10T12:00:00.000Z" };
    storage.upsertImportedBundle(updated);
    const updatedRetrieved = storage.getImportedBundle("bundle-test-001");
    assert.equal(updatedRetrieved?.imported_at, "2026-03-10T12:00:00.000Z");

    assert.equal(storage.listImportedBundles().length, 1);
    assert.equal(storage.getImportedBundle("non-existent"), undefined);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

function combineSourcePayloads(left: SourceSyncPayload, right: SourceSyncPayload): SourceSyncPayload {
  return {
    source: {
      ...left.source,
      last_sync:
        (right.source.last_sync ?? "") > (left.source.last_sync ?? "")
          ? right.source.last_sync
          : left.source.last_sync,
      total_blobs: left.blobs.length + right.blobs.length,
      total_records: left.records.length + right.records.length,
      total_fragments: left.fragments.length + right.fragments.length,
      total_atoms: left.atoms.length + right.atoms.length,
      total_sessions: left.sessions.length + right.sessions.length,
      total_turns: left.turns.length + right.turns.length,
    },
    stage_runs: [...left.stage_runs, ...right.stage_runs],
    loss_audits: [...left.loss_audits, ...right.loss_audits],
    blobs: [...left.blobs, ...right.blobs],
    records: [...left.records, ...right.records],
    fragments: [...left.fragments, ...right.fragments],
    atoms: [...left.atoms, ...right.atoms],
    edges: [...left.edges, ...right.edges],
    candidates: [...left.candidates, ...right.candidates],
    sessions: [...left.sessions, ...right.sessions],
    turns: [...left.turns, ...right.turns],
    contexts: [...left.contexts, ...right.contexts],
  };
}

function assertPlanUsesIndex(
  db: DatabaseSync,
  statement: string,
  params: readonly string[],
  indexName: string,
): void {
  assertPlanUsesAnyIndex(db, statement, params, [indexName]);
}

function assertPlanUsesAnyIndex(
  db: DatabaseSync,
  statement: string,
  params: readonly string[],
  indexNames: readonly string[],
): void {
  const rows = db.prepare(`EXPLAIN QUERY PLAN ${statement}`).all(...params) as Array<{ detail: string }>;
  assert.ok(
    rows.some((row) => indexNames.some((indexName) => row.detail.includes(indexName))),
    `Expected query plan to use one of ${indexNames.join(", ")}; got ${rows.map((row) => row.detail).join(" | ")}`,
  );
}

function payloadToChunk(payload: SourceSyncPayload, originPath: string): SourcePayloadStreamingChunk {
  return {
    origin_path: originPath,
    stage_runs: payload.stage_runs,
    loss_audits: payload.loss_audits,
    blobs: payload.blobs,
    records: payload.records,
    fragments: payload.fragments,
    atoms: payload.atoms,
    edges: payload.edges,
    candidates: payload.candidates,
    sessions: payload.sessions,
    turns: payload.turns,
    contexts: payload.contexts,
  };
}

async function* chunksFromPayloads(
  payloads: readonly { payload: SourceSyncPayload; origin_path: string }[],
): AsyncGenerator<SourcePayloadStreamingChunk, void, void> {
  for (const entry of payloads) {
    yield payloadToChunk(entry.payload, entry.origin_path);
  }
}

test("mergeSourcePayloadStreaming matches mergeSourcePayloadByOriginPath for single-file merge (parity)", async () => {
  const controlDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-stream-parity-control-"));
  const treatmentDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-stream-parity-treat-"));
  try {
    const control = new CCHistoryStorage(controlDir);
    const treatment = new CCHistoryStorage(treatmentDir);
    const sourceId = "src-stream-parity";
    const baseDir = "/tmp/stream-parity";
    const keepPath = path.join(baseDir, "keep.jsonl");
    const stalePath = path.join(baseDir, "stale.jsonl");
    const newPath = path.join(baseDir, "new.jsonl");

    const keep = createFixturePayload(sourceId, "Keep old turn", "sr-keep", {
      baseDir,
      sessionId: "session-keep",
      turnId: "turn-keep",
    });
    keep.blobs[0]!.origin_path = keepPath;
    const stale = createFixturePayload(sourceId, "Drop stale turn", "sr-stale", {
      baseDir,
      sessionId: "session-stale",
      turnId: "turn-stale",
    });
    stale.blobs[0]!.origin_path = stalePath;

    control.replaceSourcePayload(combineSourcePayloads(keep, stale));
    treatment.replaceSourcePayload(combineSourcePayloads(keep, stale));
    assert.equal(control.listTurns().length, 2);
    assert.equal(treatment.listTurns().length, 2);

    const incoming = createFixturePayload(sourceId, "Add new turn", "sr-new", {
      baseDir,
      sessionId: "session-new",
      turnId: "turn-new",
    });
    incoming.blobs[0]!.origin_path = newPath;

    const controlCounts = control.mergeSourcePayloadByOriginPath(incoming, {
      preserve_origin_paths: [keepPath],
      observed_origin_paths: [keepPath, newPath],
    });

    const treatmentCounts = await mergeSourcePayloadStreaming(
      (treatment as unknown as { db: DatabaseSync }).db,
      incoming.source,
      {
        chunks: chunksFromPayloads([{ payload: incoming, origin_path: newPath }]),
        preserve_origin_paths: new Set([keepPath]),
        observed_origin_paths: new Set([keepPath, newPath]),
        asset_dir: treatmentDir,
      },
    );

    assert.deepEqual(
      treatment.listTurns().map((turn) => turn.canonical_text).sort(),
      control.listTurns().map((turn) => turn.canonical_text).sort(),
    );
    assert.deepEqual(
      treatment.listBlobs().map((blob) => blob.origin_path).sort(),
      control.listBlobs().map((blob) => blob.origin_path).sort(),
    );
    assert.equal(treatmentCounts.turns, controlCounts.turns);
    assert.equal(treatmentCounts.blobs, controlCounts.blobs);
    assert.equal(treatment.listSources()[0]?.total_turns, control.listSources()[0]?.total_turns);
  } finally {
    await rm(controlDir, { recursive: true, force: true });
    await rm(treatmentDir, { recursive: true, force: true });
  }
});

test("mergeSourcePayloadStreaming handles multi-chunk stream (each file = one chunk)", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-stream-multi-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const sourceId = "src-stream-multi";
    const baseDir = "/tmp/stream-multi";
    const pathA = path.join(baseDir, "a.jsonl");
    const pathB = path.join(baseDir, "b.jsonl");
    const pathC = path.join(baseDir, "c.jsonl");

    const initial = createFixturePayload(sourceId, "Initial turn", "sr-init", {
      baseDir,
      sessionId: "session-init",
      turnId: "turn-init",
    });
    initial.blobs[0]!.origin_path = pathA;
    storage.replaceSourcePayload(initial);

    const chunkA = createFixturePayload(sourceId, "Refreshed A turn", "sr-a", {
      baseDir,
      sessionId: "session-a",
      turnId: "turn-a",
    });
    chunkA.blobs[0]!.origin_path = pathA;
    const chunkB = createFixturePayload(sourceId, "Fresh B turn", "sr-b", {
      baseDir,
      sessionId: "session-b",
      turnId: "turn-b",
    });
    chunkB.blobs[0]!.origin_path = pathB;
    const chunkC = createFixturePayload(sourceId, "Fresh C turn", "sr-c", {
      baseDir,
      sessionId: "session-c",
      turnId: "turn-c",
    });
    chunkC.blobs[0]!.origin_path = pathC;

    const counts = await mergeSourcePayloadStreaming(
      (storage as unknown as { db: DatabaseSync }).db,
      chunkA.source,
      {
        chunks: chunksFromPayloads([
          { payload: chunkA, origin_path: pathA },
          { payload: chunkB, origin_path: pathB },
          { payload: chunkC, origin_path: pathC },
        ]),
        preserve_origin_paths: new Set(),
        observed_origin_paths: new Set([pathA, pathB, pathC]),
        asset_dir: dataDir,
      },
    );

    assert.equal(counts.turns, 3);
    assert.equal(counts.blobs, 3);
    assert.deepEqual(
      storage.listTurns().map((turn) => turn.canonical_text).sort(),
      ["Fresh B turn", "Fresh C turn", "Refreshed A turn"],
    );
    assert.equal(storage.listSources()[0]?.total_turns, 3);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("mergeSourcePayloadStreaming preserves skipped files via preserve_origin_paths", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-stream-preserve-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const sourceId = "src-stream-preserve";
    const baseDir = "/tmp/stream-preserve";
    const keepPath = path.join(baseDir, "keep.jsonl");
    const newPath = path.join(baseDir, "new.jsonl");

    const keep = createFixturePayload(sourceId, "Keep old turn", "sr-keep", {
      baseDir,
      sessionId: "session-keep",
      turnId: "turn-keep",
    });
    keep.blobs[0]!.origin_path = keepPath;
    storage.replaceSourcePayload(keep);

    const incomingKeep = createFixturePayload(sourceId, "Keep old turn", "sr-keep", {
      baseDir,
      sessionId: "session-keep",
      turnId: "turn-keep",
    });
    incomingKeep.blobs[0]!.origin_path = keepPath;
    incomingKeep.blobs[0]!.captured_at = "2026-02-01T00:00:00.000Z";
    const incomingNew = createFixturePayload(sourceId, "Add new turn", "sr-new", {
      baseDir,
      sessionId: "session-new",
      turnId: "turn-new",
    });
    incomingNew.blobs[0]!.origin_path = newPath;

    const originalCapturedAt = keep.blobs[0]!.captured_at;
    await mergeSourcePayloadStreaming(
      (storage as unknown as { db: DatabaseSync }).db,
      incomingKeep.source,
      {
        chunks: chunksFromPayloads([
          { payload: incomingKeep, origin_path: keepPath },
          { payload: incomingNew, origin_path: newPath },
        ]),
        preserve_origin_paths: new Set([keepPath]),
        observed_origin_paths: new Set([keepPath, newPath]),
        asset_dir: dataDir,
      },
    );

    assert.deepEqual(
      storage.listTurns().map((turn) => turn.canonical_text).sort(),
      ["Add new turn", "Keep old turn"],
    );
    const keptBlob = storage.listBlobs().find((blob) => blob.id === keep.blobs[0]!.id);
    assert.equal(keptBlob?.captured_at, originalCapturedAt);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("mergeSourcePayloadStreaming upserts stage_runs by id across syncs (no unbounded accumulation)", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-stream-stage-runs-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const sourceId = "src-stream-stage-runs";
    const baseDir = "/tmp/stream-stage-runs";
    const filePath = path.join(baseDir, "session.jsonl");

    const buildSync = (stageRunId: string, turnText: string, turnId: string): SourcePayloadStreamingChunk => {
      const payload = createFixturePayload(sourceId, turnText, stageRunId, {
        baseDir,
        sessionId: "session-stage-runs",
        turnId,
      });
      payload.blobs[0]!.origin_path = filePath;
      return payloadToChunk(payload, filePath);
    };

    const runOnce = async (chunk: SourcePayloadStreamingChunk): Promise<void> => {
      await mergeSourcePayloadStreaming(
        (storage as unknown as { db: DatabaseSync }).db,
        createFixturePayload(sourceId, "", chunk.stage_runs[0]!.id, {
          baseDir,
          sessionId: "session-stage-runs",
          turnId: "turn-stage-runs",
        }).source,
        {
          chunks: (async function* (): AsyncGenerator<SourcePayloadStreamingChunk> {
            yield chunk;
          })(),
          preserve_origin_paths: new Set(),
          observed_origin_paths: new Set([filePath]),
          asset_dir: dataDir,
        },
      );
    };

    // First sync: stage_run id "sr-stage-A".
    await runOnce(buildSync("sr-stage-A", "Sync 1 turn", "turn-sync-1"));
    // Second sync: SAME stage_run id, different content. Should upsert, not append.
    await runOnce(buildSync("sr-stage-A", "Sync 2 turn", "turn-sync-2"));

    const stageRuns = storage.listStageRuns().filter((run) => run.source_id === sourceId);
    const matching = stageRuns.filter((run) => run.id === "sr-stage-A");
    assert.equal(matching.length, 1, `expected exactly one sr-stage-A row, got ${matching.length}`);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("mergeSourcePayloadStreaming preserves oversized-file loss audits despite synthetic blob_ref", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-stream-loss-audit-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const sourceId = "src-stream-loss-audit";
    const baseDir = "/tmp/stream-loss-audit";
    const oversizedPath = path.join(baseDir, "huge.jsonl");

    const basePayload = createFixturePayload(sourceId, "Baseline turn", "sr-loss-baseline", {
      baseDir,
      sessionId: "session-loss-baseline",
      turnId: "turn-baseline",
    });
    basePayload.blobs[0]!.origin_path = oversizedPath;

    // Simulate the probe's oversized-file audit: a synthetic blob_ref that
    // never becomes a captured_blobs row, plus diagnostic_code in the
    // SYNTHETIC_BLOB_AUDIT_DIAGNOSTIC_CODES set. The filter must keep this.
    const oversizedAudit: SourceSyncPayload["loss_audits"][number] = {
      id: "audit-oversized",
      source_id: sourceId,
      stage_run_id: "sr-loss-baseline",
      stage_kind: "capture",
      diagnostic_code: "blob_too_large",
      severity: "warning",
      scope_ref: "blob-oversized",
      session_ref: undefined,
      blob_ref: "blob-src-stream-loss-audit-oversized",
      record_ref: undefined,
      fragment_ref: undefined,
      atom_ref: undefined,
      candidate_ref: undefined,
      source_format_profile_id: "codex:jsonl:v1",
      loss_kind: "unknown_fragment",
      detail: "Skipped oversized source file: 999 bytes exceeds 64 MiB limit",
      created_at: "2026-03-09T09:00:00.000Z",
    };

    const chunk = payloadToChunk(basePayload, oversizedPath);
    chunk.loss_audits = [...chunk.loss_audits, oversizedAudit];

    await mergeSourcePayloadStreaming(
      (storage as unknown as { db: DatabaseSync }).db,
      basePayload.source,
      {
        chunks: (async function* (): AsyncGenerator<SourcePayloadStreamingChunk> {
          yield chunk;
        })(),
        preserve_origin_paths: new Set(),
        observed_origin_paths: new Set([oversizedPath]),
        asset_dir: dataDir,
      },
    );

    const audits = storage.listLossAudits();
    const oversized = audits.find((audit) => audit.id === "audit-oversized");
    assert.ok(oversized, "oversized-file loss audit was dropped by the filter");
    assert.equal(oversized?.diagnostic_code, "blob_too_large");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("mergeSourcePayloadStreaming materializes oversized blobs via the streaming path when no trusted bytes are supplied", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-stream-oversized-materialize-"));
  const sourceDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-stream-oversized-src-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const sourceId = "src-stream-oversized";
    // Write a real 65 MiB JSONL file so the storage threshold (64 MiB) trips
    // and the captured_path exists for createReadStream.
    const line = '{"type":"message","timestamp":"2026-03-12T10:00:01.000Z"}\n';
    const targetBytes = 65 * 1024 * 1024;
    const repeats = Math.ceil(targetBytes / line.length);
    const filePath = path.join(sourceDir, "huge.jsonl");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(filePath, line.repeat(repeats), "utf8");
    const fileStats = await stat(filePath);

    const basePayload = createFixturePayload(sourceId, "Baseline turn", "sr-oversized-baseline", {
      baseDir: sourceDir,
      sessionId: "session-oversized-baseline",
      turnId: "turn-oversized-baseline",
    });
    basePayload.blobs[0]!.origin_path = filePath;
    basePayload.blobs[0]!.captured_path = filePath;
    basePayload.blobs[0]!.size_bytes = fileStats.size;
    // Recompute checksum to match the file on disk so the storage layer's
    // streaming materialization produces a sha256 that lines up.
    const { createHash } = await import("node:crypto");
    const { readFileSync } = await import("node:fs");
    const fileBytes = readFileSync(filePath);
    basePayload.blobs[0]!.checksum = createHash("sha1").update(fileBytes).digest("hex");

    const chunk = payloadToChunk(basePayload, filePath);
    // No trusted_bytes_by_blob_id — forces the storage layer to stream-read
    // the file from captured_path.

    await mergeSourcePayloadStreaming(
      (storage as unknown as { db: DatabaseSync }).db,
      basePayload.source,
      {
        chunks: (async function* (): AsyncGenerator<SourcePayloadStreamingChunk> {
          yield chunk;
        })(),
        preserve_origin_paths: new Set(),
        observed_origin_paths: new Set([filePath]),
        asset_dir: dataDir,
      },
    );

    // The blob must be present in evidence_blobs with the correct sha256.
    const expectedSha = createHash("sha256").update(fileBytes).digest("hex");
    const evidencePath = path.join(dataDir, "evidence", "blobs", expectedSha.slice(0, 2), expectedSha);
    const { existsSync } = await import("node:fs");
    assert.ok(existsSync(evidencePath), "streaming-materialized blob must exist on disk");
    const written = readFileSync(evidencePath);
    assert.equal(written.byteLength, fileStats.size);
    assert.equal(createHash("sha256").update(written).digest("hex"), expectedSha);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
  }
});
