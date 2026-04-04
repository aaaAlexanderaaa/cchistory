import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { CCHistoryStorage } from "../index.js";
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

