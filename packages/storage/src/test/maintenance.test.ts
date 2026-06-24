import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { type UserTurnProjection } from "@cchistory/domain";
import { CCHistoryStorage } from "../index.js";
import { createFixturePayload } from "./helpers.js";

test("deleteProject removes project data and leaves a tombstone", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-delete-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const payload = createFixturePayload("src-1", "Delete me", "sr-1", {
      projectObservation: {
        workspacePath: "/workspace/delete-me",
        repoFingerprint: "fp-delete",
      },
    });
    storage.replaceSourcePayload(payload);

    const project = storage.listProjects()[0]!;
    const projectId = project.project_id;

    storage.deleteProject(projectId, "cleanup");

    assert.equal(storage.getProject(projectId), undefined);
    assert.equal(storage.getTombstone(projectId)?.purge_reason, "cleanup");
    assert.equal(storage.listTurns().length, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("fresh storage is empty", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-fresh-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    assert.equal(storage.isEmpty(), true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("storage refuses to write stores with a future schema version", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-future-schema-"));
  try {
    const dbPath = path.join(dataDir, "cchistory.sqlite");
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`
        CREATE TABLE schema_meta (
          key TEXT PRIMARY KEY,
          value_text TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      db.prepare("INSERT INTO schema_meta (key, value_text, updated_at) VALUES (?, ?, ?)")
        .run("schema_version", "2999-01-01.1", "2999-01-01T00:00:00.000Z");
    } finally {
      db.close();
    }

    assert.throws(
      () => new CCHistoryStorage({ dbPath }),
      /Store schema version 2999-01-01\.1 is newer than this CCHistory build supports/,
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("opening an old evidence schema backfills structural query columns", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-evidence-migration-"));
  try {
    const dbPath = path.join(dataDir, "cchistory.sqlite");
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`
        CREATE TABLE schema_meta (
          key TEXT PRIMARY KEY,
          value_text TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE captured_blobs (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );
        CREATE TABLE raw_records (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL,
          session_ref TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );
        CREATE TABLE loss_audits (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );
      `);
      db.prepare("INSERT INTO schema_meta (key, value_text, updated_at) VALUES (?, ?, ?)")
        .run("schema_version", "2026-03-20.1", "2026-03-20T00:00:00.000Z");
      db.prepare("INSERT INTO captured_blobs (id, source_id, payload_json) VALUES (?, ?, ?)")
        .run("blob-old", "src-old", JSON.stringify({ id: "blob-old", origin_path: "/tmp/old/session.jsonl" }));
      db.prepare("INSERT INTO raw_records (id, source_id, session_ref, payload_json) VALUES (?, ?, ?, ?)")
        .run("record-old", "src-old", "session-old", JSON.stringify({
          id: "record-old",
          blob_id: "blob-old",
          ordinal: 7,
        }));
      db.prepare("INSERT INTO loss_audits (id, source_id, payload_json) VALUES (?, ?, ?)")
        .run("loss-old", "src-old", JSON.stringify({
          id: "loss-old",
          stage_kind: "parse_source_fragments",
          diagnostic_code: "old_warning",
          severity: "warning",
          session_ref: "session-old",
          blob_ref: "blob-old",
          record_ref: "record-old",
          fragment_ref: "fragment-old",
          atom_ref: "atom-old",
          candidate_ref: "candidate-old",
        }));
    } finally {
      db.close();
    }

    const storage = new CCHistoryStorage({ dbPath });
    storage.close();

    const migrated = new DatabaseSync(dbPath);
    try {
      const schemaMeta = migrated.prepare("SELECT value_text FROM schema_meta WHERE key = ?").get("evidence_query_columns_backfill") as
        | { value_text: string }
        | undefined;
      assert.equal(schemaMeta?.value_text, "done");
      const blob = migrated.prepare("SELECT origin_path FROM captured_blobs WHERE id = ?").get("blob-old") as
        | { origin_path: string }
        | undefined;
      assert.equal(blob?.origin_path, path.normalize("/tmp/old/session.jsonl"));

      const record = migrated.prepare("SELECT blob_id, ordinal FROM raw_records WHERE id = ?").get("record-old") as
        | { blob_id: string; ordinal: number }
        | undefined;
      assert.equal(record?.blob_id, "blob-old");
      assert.equal(record?.ordinal, 7);

      const lossAudit = migrated.prepare(`
          SELECT stage_kind,
                 diagnostic_code,
                 severity,
                 session_ref,
                 blob_ref,
                 record_ref,
                 fragment_ref,
                 atom_ref,
                 candidate_ref
            FROM loss_audits
           WHERE id = ?
        `).get("loss-old") as
        | {
            stage_kind: string;
            diagnostic_code: string;
            severity: string;
            session_ref: string;
            blob_ref: string;
            record_ref: string;
            fragment_ref: string;
            atom_ref: string;
            candidate_ref: string;
          }
        | undefined;
      assert.equal(lossAudit?.stage_kind, "parse_source_fragments");
      assert.equal(lossAudit?.diagnostic_code, "old_warning");
      assert.equal(lossAudit?.severity, "warning");
      assert.equal(lossAudit?.session_ref, "session-old");
      assert.equal(lossAudit?.blob_ref, "blob-old");
      assert.equal(lossAudit?.record_ref, "record-old");
      assert.equal(lossAudit?.fragment_ref, "fragment-old");
      assert.equal(lossAudit?.atom_ref, "atom-old");
      assert.equal(lossAudit?.candidate_ref, "candidate-old");
    } finally {
      migrated.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("opening a 2026-06-02 evidence schema backfills loss audit severity", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-severity-migration-"));
  try {
    const dbPath = path.join(dataDir, "cchistory.sqlite");
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`
        CREATE TABLE schema_meta (
          key TEXT PRIMARY KEY,
          value_text TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE loss_audits (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL,
          stage_kind TEXT NOT NULL DEFAULT '',
          diagnostic_code TEXT NOT NULL DEFAULT '',
          session_ref TEXT NOT NULL DEFAULT '',
          blob_ref TEXT NOT NULL DEFAULT '',
          record_ref TEXT NOT NULL DEFAULT '',
          fragment_ref TEXT NOT NULL DEFAULT '',
          atom_ref TEXT NOT NULL DEFAULT '',
          candidate_ref TEXT NOT NULL DEFAULT '',
          payload_json TEXT NOT NULL
        );
      `);
      const insertMeta = db.prepare("INSERT INTO schema_meta (key, value_text, updated_at) VALUES (?, ?, ?)");
      insertMeta.run("schema_version", "2026-06-02.1", "2026-06-02T00:00:00.000Z");
      insertMeta.run("evidence_query_columns_backfill", "done", "2026-06-02T00:00:00.000Z");
      insertMeta.run("evidence_query_columns_backfill:loss_audits", "done", "2026-06-02T00:00:00.000Z");

      const insertAudit = db.prepare(`
        INSERT INTO loss_audits (
          id,
          source_id,
          stage_kind,
          diagnostic_code,
          session_ref,
          blob_ref,
          record_ref,
          fragment_ref,
          atom_ref,
          candidate_ref,
          payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertAudit.run(
        "loss-info",
        "src-old",
        "finalize_projections",
        "old_info",
        "session-old",
        "",
        "",
        "",
        "",
        "",
        JSON.stringify({
          id: "loss-info",
          stage_kind: "finalize_projections",
          diagnostic_code: "old_info",
          severity: "info",
        }),
      );
      insertAudit.run(
        "loss-warning",
        "src-old",
        "parse_source_fragments",
        "old_warning",
        "session-old",
        "",
        "",
        "",
        "",
        "",
        JSON.stringify({
          id: "loss-warning",
          stage_kind: "parse_source_fragments",
          diagnostic_code: "old_warning",
        }),
      );
    } finally {
      db.close();
    }

    const storage = new CCHistoryStorage({ dbPath });
    storage.close();

    const migrated = new DatabaseSync(dbPath);
    try {
      const rows = migrated.prepare("SELECT id, severity FROM loss_audits ORDER BY id").all() as Array<{
        id: string;
        severity: string;
      }>;
      assert.deepEqual(rows.map(({ id, severity }) => ({ id, severity })), [
        { id: "loss-info", severity: "info" },
        { id: "loss-warning", severity: "warning" },
      ]);
      const marker = migrated.prepare("SELECT value_text FROM schema_meta WHERE key = ?").get("loss_audit_severity_column_backfill") as
        | { value_text: string }
        | undefined;
      assert.equal(marker?.value_text, "done");
    } finally {
      migrated.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("garbageCollectCandidateTurns with purge mode creates tombstones", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-gc-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(createFixturePayload("src-1", "GC test", "sr-1", {
      projectObservation: {
        workspacePath: "/workspace/gc-test",
      },
    }));
    const turnId = "turn-1";

    const result = (storage as any).garbageCollectCandidateTurns({
      before_iso: "2099-01-01T00:00:00.000Z",
      mode: "purge",
    });

    assert.equal(result.processed_turn_ids.length, 1);
    assert.equal(storage.getTurn(turnId), undefined);
    assert.equal(storage.getTombstone(turnId)?.purge_reason, "candidate_gc");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("B.5.2: rewriteStoredTurn keeps V2 sidecar in sync with V1 payload", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-b52-sync-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(createFixturePayload("src-1", "Archive test", "sr-1"));
    const turnId = "turn-1";

    const before = storage.getTurn(turnId);
    assert.equal(before?.value_axis, "active");
    assert.equal(before?.retention_axis, "keep_raw_and_derived");

    (storage as any).rewriteStoredTurn(turnId, (turn: UserTurnProjection) => ({
      ...turn,
      value_axis: "archived",
      retention_axis: "keep_raw_only",
    }));

    const after = storage.getTurn(turnId);
    assert.equal(after?.value_axis, "archived", "V2 value_axis must reflect the archive mutation");
    assert.equal(after?.retention_axis, "keep_raw_only", "V2 retention_axis must reflect the archive mutation");

    // M4: assert at the SQL level too, so a future refactor that breaks the
    // V2 UPDATE (while leaving getTurn's projection somehow consistent) is
    // still caught. Read every column the dual-write sets.
    const db = (storage as any).db as DatabaseSync;
    const row = db
      .prepare(
        "SELECT link_state, value_axis, retention_axis, project_id, project_ref, project_link_state FROM user_turns_v2 WHERE turn_id = ?",
      )
      .get(turnId) as {
        link_state: string;
        value_axis: string;
        retention_axis: string;
        project_id: string;
        project_ref: string;
        project_link_state: string;
      };
    assert.equal(row.value_axis, "archived", "V2 column value_axis must be set directly by UPDATE");
    assert.equal(row.retention_axis, "keep_raw_only", "V2 column retention_axis must be set directly by UPDATE");
    assert.ok(row.link_state.length > 0, "V2 link_state must be carried through the dual-write");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("B.5.2 + M4: rewriteStoredTurn throws if the V2 sidecar is missing (dual-write invariant)", async () => {
  // Regression: if a future refactor drops the V2 UPDATE, or if B.3 backfill
  // was skipped for a turn, rewriteStoredTurn would silently leave V1 and V2
  // in drift. The M4 assertion makes this loud: changes !== 1 throws.
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-b52-missing-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(createFixturePayload("src-1", "Missing sidecar test", "sr-1"));
    const turnId = "turn-1";

    // Simulate a missing sidecar: delete the V2 row but leave V1 intact.
    const db = (storage as any).db as DatabaseSync;
    db.prepare("DELETE FROM user_turns_v2 WHERE turn_id = ?").run(turnId);
    // Also delete the dependent lineage blob ref so the sidecar absence is
    // the only drift — no FK violation muddies the assertion.
    // (turn_context_refs_v2 may exist; clear it for the same reason.)
    db.prepare("DELETE FROM turn_context_refs_v2 WHERE turn_id = ?").run(turnId);

    assert.throws(
      () => {
        (storage as any).rewriteStoredTurn(turnId, (turn: UserTurnProjection) => ({
          ...turn,
          value_axis: "archived",
        }));
      },
      /dual-write invariant broken/i,
      "rewriteStoredTurn must throw when the V2 sidecar is missing",
    );

    // V1 payload_json must still have been updated — the assertion fires
    // after the V1 UPDATE, so V1 reflects the mutation even though V2 didn't.
    // This is the correct ordering: we don't roll back V1 just because V2
    // is broken. The operator runs `migration run` to backfill.
    const v1After = db
      .prepare("SELECT payload_json FROM user_turns WHERE id = ?")
      .get(turnId) as { payload_json: string };
    const v1Parsed = JSON.parse(v1After.payload_json) as { value_axis: string };
    assert.equal(v1Parsed.value_axis, "archived", "V1 UPDATE must land even when V2 throws");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("purgeTurn is idempotent - second purge returns existing tombstone", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-purge-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(createFixturePayload("src-1", "Purge test", "sr-1"));
    const turnId = "turn-1";

    storage.purgeTurn(turnId, "test_purge_1");
    const t1 = storage.getTombstone(turnId);
    assert.equal(t1?.purge_reason, "test_purge_1");

    storage.purgeTurn(turnId, "test_purge_2");
    const t2 = storage.getTombstone(turnId);
    assert.equal(t2?.purge_reason, "test_purge_1", "Original tombstone should be preserved");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("I13: purgeTurn throws if the V2 sidecar is missing (dual-write drift, transaction rolls back)", async () => {
  // Regression: purgeTurnInTransaction sums V2 row deletes across the id and
  // turn_id iterations. If the V2 sidecar is missing, the sum stays at 0 and
  // the V1 row was already deleted in the same transaction — leaving a silent
  // V1 orphan (read-path returns undefined for the turn but no tombstone,
  // nothing to surface the drift). The I13 assertion makes this loud and the
  // caller's ROLLBACK undoes the V1 delete so the operator can fix the sidecar
  // without losing data.
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-i13-missing-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(createFixturePayload("src-1", "I13 missing sidecar test", "sr-1"));
    const turnId = "turn-1";

    // Simulate the missing sidecar: delete V2 row + context ref so no FK
    // violation muddies the assertion. V1 stays intact.
    const db = (storage as any).db as DatabaseSync;
    db.prepare("DELETE FROM user_turns_v2 WHERE turn_id = ?").run(turnId);
    db.prepare("DELETE FROM turn_context_refs_v2 WHERE turn_id = ?").run(turnId);

    assert.throws(
      () => storage.purgeTurn(turnId, "i13_test"),
      /V2 sidecar missing/i,
      "purgeTurn must throw when the V2 sidecar is missing",
    );

    // Transaction rolled back: V1 row and any tombstone insert must be undone.
    const v1Row = db
      .prepare("SELECT id FROM user_turns WHERE id = ?")
      .get(turnId);
    assert.ok(v1Row, "V1 row must survive the rolled-back purge");
    const tombstone = db
      .prepare("SELECT logical_id FROM tombstones WHERE logical_id = ?")
      .get(turnId);
    assert.equal(tombstone, undefined, "tombstone insert must be rolled back");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
