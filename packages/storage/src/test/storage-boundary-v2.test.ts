import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { SourceSyncPayload, UserTurnProjection } from "@cchistory/domain";
import { CCHistoryStorage } from "../index.js";
import { createFixturePayload } from "./helpers.js";

test("storage boundary v2 writes evidence, ledger, spans, and bounded context sidecars without changing v1 reads", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-boundary-v2-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });

    const sourceId = "srcinst-codex-v2-evidence";
    const originPath = path.join(sourceRoot, "session.jsonl");
    const firstLine = "{\"fixture\":true}\n";
    await writeFile(originPath, firstLine, "utf8");

    const storage = new CCHistoryStorage({ dbPath });
    const payload = createFixturePayload(sourceId, "V2 evidence asks", "stage-v2", {
      baseDir: sourceRoot,
      sessionId: "session-v2",
      turnId: "turn-v2",
    });
    payload.blobs[0]!.origin_path = originPath;
    payload.blobs[0]!.captured_path = undefined;
    payload.blobs[0]!.checksum = sha1(firstLine);
    payload.blobs[0]!.size_bytes = Buffer.byteLength(firstLine, "utf8");
    payload.blobs[0]!.file_identity_stable = true;
    payload.contexts[0]!.tool_calls[0]!.output = "large tool output ".repeat(1600);

    storage.replaceSourcePayload(payload);
    storage.replaceSourcePayload(payload);

    assert.equal(storage.getTurn("turn-v2")?.canonical_text, "V2 evidence asks");
    assert.equal(storage.getTurnContext("turn-v2")?.tool_calls[0]?.output, payload.contexts[0]!.tool_calls[0]!.output);
    storage.close();

    const db = new DatabaseSync(dbPath);
    try {
      const sourceEvidence = db.prepare(`
        SELECT eb.sha256,
               eb.storage_path,
               eb.size_bytes,
               ec.capture_kind
          FROM evidence_blobs eb
          JOIN evidence_captures ec ON ec.evidence_sha256 = eb.sha256
         WHERE ec.source_id = ?
           AND ec.blob_id = ?
      `).get(sourceId, payload.blobs[0]!.id) as
        | {
            sha256: string;
            storage_path: string;
            size_bytes: number;
            capture_kind: string;
          }
        | undefined;
      assert.ok(sourceEvidence);
      assert.equal(sourceEvidence.capture_kind, "source_blob");
      assert.equal(sourceEvidence.sha256, sha256(firstLine));
      assert.equal(sourceEvidence.size_bytes, Buffer.byteLength(firstLine, "utf8"));

      const evidencePath = path.join(storeDir, sourceEvidence.storage_path);
      assert.equal(await readFile(evidencePath, "utf8"), firstLine);

      const evidenceBlobCount = db.prepare("SELECT COUNT(*) AS count FROM evidence_blobs").get() as { count: number };
      assert.equal(evidenceBlobCount.count, 2, "source blob and context cache should each be stored once");

      const captureCount = db.prepare("SELECT COUNT(*) AS count FROM evidence_captures WHERE source_id = ?").get(sourceId) as {
        count: number;
      };
      assert.equal(captureCount.count, 1, "replacing the same content should not duplicate capture metadata");

      const ledger = db.prepare(`
        SELECT current_evidence_sha256,
               source_checksum,
               parser_profile_id,
               parsed_byte_offset,
               last_valid_jsonl_boundary,
               last_record_ordinal,
               sync_axis
          FROM source_file_ledger
         WHERE source_id = ?
           AND origin_path = ?
      `).get(sourceId, originPath) as
        | {
            current_evidence_sha256: string;
            source_checksum: string;
            parser_profile_id: string;
            parsed_byte_offset: number;
            last_valid_jsonl_boundary: number;
            last_record_ordinal: number;
            sync_axis: string;
          }
        | undefined;
      assert.ok(ledger);
      assert.equal(ledger.current_evidence_sha256, sourceEvidence.sha256);
      assert.equal(ledger.source_checksum, sha1(firstLine));
      assert.equal(ledger.parser_profile_id, "codex:jsonl:v1");
      assert.equal(ledger.parsed_byte_offset, Buffer.byteLength(firstLine, "utf8"));
      assert.equal(ledger.last_valid_jsonl_boundary, Buffer.byteLength(firstLine, "utf8"));
      assert.equal(ledger.last_record_ordinal, 0);
      assert.equal(ledger.sync_axis, "current");

      const span = db.prepare(`
        SELECT evidence_sha256,
               span_kind,
               start_byte,
               end_byte,
               span_label
          FROM parsed_record_spans
         WHERE record_id = ?
      `).get(payload.records[0]!.id) as
        | {
            evidence_sha256: string;
            span_kind: string;
            start_byte: number;
            end_byte: number;
            span_label: string;
          }
        | undefined;
      assert.ok(span);
      assert.equal(span.evidence_sha256, sourceEvidence.sha256);
      assert.equal(span.span_kind, "line");
      assert.equal(span.start_byte, 0);
      assert.equal(span.end_byte, firstLine.trimEnd().length);
      assert.equal(span.span_label, "0");

      const hotTurn = db.prepare(`
        SELECT canonical_text,
               raw_text_preview,
               payload_bytes
          FROM user_turns_v2
         WHERE turn_id = ?
      `).get("turn-v2") as
        | {
            canonical_text: string;
            raw_text_preview: string;
            payload_bytes: number;
          }
        | undefined;
      assert.ok(hotTurn);
      assert.equal(hotTurn.canonical_text, "V2 evidence asks");
      assert.equal(hotTurn.raw_text_preview, "V2 evidence asks");
      assert.ok(hotTurn.payload_bytes <= 32 * 1024);

      const contextRef = db.prepare(`
        SELECT context_evidence_sha256,
               cache_storage_path,
               full_context_bytes,
               inline_budget_bytes,
               LENGTH(CAST(preview_json AS BLOB)) AS preview_bytes
          FROM turn_context_refs_v2
         WHERE turn_id = ?
      `).get("turn-v2") as
        | {
            context_evidence_sha256: string;
            cache_storage_path: string;
            full_context_bytes: number;
            inline_budget_bytes: number;
            preview_bytes: number;
          }
        | undefined;
      assert.ok(contextRef);
      assert.ok(contextRef.full_context_bytes > contextRef.inline_budget_bytes);
      assert.ok(contextRef.preview_bytes <= contextRef.inline_budget_bytes);
      await access(path.join(storeDir, contextRef.cache_storage_path));
    } finally {
      db.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("storage boundary v2 reconstructs turn context from the content-addressed cache when v1 context rows are absent", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-boundary-v2-context-cache-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });

    const sourceId = "srcinst-codex-v2-context-cache";
    const storage = new CCHistoryStorage({ dbPath });
    const payload = createFixturePayload(sourceId, "Reconstruct context", "stage-v2-context-cache", {
      baseDir: sourceRoot,
      sessionId: "session-v2-context-cache",
      turnId: "turn-v2-context-cache",
    });
    payload.contexts[0]!.tool_calls[0]!.output = "context cache output ".repeat(1024);
    storage.replaceSourcePayload(payload);
    storage.close();

    const db = new DatabaseSync(dbPath);
    try {
      const contextRef = db.prepare("SELECT cache_storage_path FROM turn_context_refs_v2 WHERE turn_id = ?")
        .get("turn-v2-context-cache") as { cache_storage_path: string } | undefined;
      assert.ok(contextRef);
      await access(path.join(storeDir, contextRef.cache_storage_path));
      db.prepare("DELETE FROM turn_contexts WHERE turn_id = ?").run("turn-v2-context-cache");
    } finally {
      db.close();
    }

    const reopened = new CCHistoryStorage({ dbPath });
    try {
      const reconstructed = reopened.getTurnContext("turn-v2-context-cache");
      assert.ok(reconstructed);
      assert.equal(reconstructed.tool_calls[0]?.output, payload.contexts[0]!.tool_calls[0]!.output);
      assert.equal(reconstructed.assistant_replies[0]?.content, "Running tool");
    } finally {
      reopened.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("storage boundary v2 returns undefined when the context cache is invalid (B.5.6 — no V1 fallback)", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-boundary-v2-context-fallback-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });

    const storage = new CCHistoryStorage({ dbPath });
    const payload = createFixturePayload("srcinst-codex-v2-context-fallback", "Fallback context", "stage-v2-context-fallback", {
      baseDir: sourceRoot,
      sessionId: "session-v2-context-fallback",
      turnId: "turn-v2-context-fallback",
    });
    payload.contexts[0]!.tool_calls[0]!.output = "fallback output";
    storage.replaceSourcePayload(payload);
    storage.close();

    const db = new DatabaseSync(dbPath);
    try {
      const contextRef = db.prepare("SELECT cache_storage_path FROM turn_context_refs_v2 WHERE turn_id = ?")
        .get("turn-v2-context-fallback") as { cache_storage_path: string } | undefined;
      assert.ok(contextRef);
      await writeFile(path.join(storeDir, contextRef.cache_storage_path), "{\"turn_id\":\"wrong-turn\"}\n", "utf8");
    } finally {
      db.close();
    }

    const reopened = new CCHistoryStorage({ dbPath });
    try {
      // B.5.6: V1 fallback removed. A corrupted V2 cache now returns
      // undefined rather than silently consulting V1. Operators running
      // B.4c (read-path parity) catch this before deploying B.5; the
      // recovery is `cchistory migration run` to rewrite the cache.
      const context = reopened.getTurnContext("turn-v2-context-fallback");
      assert.equal(context, undefined);
    } finally {
      reopened.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("storage boundary v2 does not serve context for purged turns", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-boundary-v2-context-purge-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });

    const storage = new CCHistoryStorage({ dbPath });
    try {
      const payload = createFixturePayload("srcinst-codex-v2-context-purge", "Purge context", "stage-v2-context-purge", {
        baseDir: sourceRoot,
        sessionId: "session-v2-context-purge",
        turnId: "turn-v2-context-purge",
      });
      payload.contexts[0]!.tool_calls[0]!.output = "purged context output";
      storage.replaceSourcePayload(payload);

      assert.equal(storage.getTurnContext("turn-v2-context-purge")?.tool_calls[0]?.output, "purged context output");
      storage.purgeTurn("turn-v2-context-purge", "review_purge");

      assert.equal(storage.getTurn("turn-v2-context-purge"), undefined);
      assert.equal(storage.getTurnContext("turn-v2-context-purge"), undefined);
    } finally {
      storage.close();
    }

    const db = new DatabaseSync(dbPath);
    try {
      const counts = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM user_turns WHERE id = ?) AS user_turns,
          (SELECT COUNT(*) FROM turn_contexts WHERE turn_id = ?) AS turn_contexts,
          (SELECT COUNT(*) FROM user_turns_v2 WHERE turn_id = ?) AS user_turns_v2,
          (SELECT COUNT(*) FROM turn_context_refs_v2 WHERE turn_id = ?) AS turn_context_refs_v2
      `).get(
        "turn-v2-context-purge",
        "turn-v2-context-purge",
        "turn-v2-context-purge",
        "turn-v2-context-purge",
      ) as {
        user_turns: number;
        turn_contexts: number;
        user_turns_v2: number;
        turn_context_refs_v2: number;
      };
      assert.equal(counts.user_turns, 0);
      assert.equal(counts.turn_contexts, 0);
      assert.equal(counts.user_turns_v2, 0);
      assert.equal(counts.turn_context_refs_v2, 0);
    } finally {
      db.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("storage boundary v2 does not serve orphaned context refs without a live turn", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-boundary-v2-context-orphan-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });

    const storage = new CCHistoryStorage({ dbPath });
    const payload = createFixturePayload("srcinst-codex-v2-context-orphan", "Orphan context", "stage-v2-context-orphan", {
      baseDir: sourceRoot,
      sessionId: "session-v2-context-orphan",
      turnId: "turn-v2-context-orphan",
    });
    payload.contexts[0]!.tool_calls[0]!.output = "orphaned context output";
    storage.replaceSourcePayload(payload);
    storage.close();

    const db = new DatabaseSync(dbPath);
    try {
      assert.ok(db.prepare("SELECT 1 FROM turn_context_refs_v2 WHERE turn_id = ?").get("turn-v2-context-orphan"));
      assert.ok(db.prepare("SELECT 1 FROM turn_contexts WHERE turn_id = ?").get("turn-v2-context-orphan"));
      db.prepare("DELETE FROM user_turns WHERE id = ?").run("turn-v2-context-orphan");
    } finally {
      db.close();
    }

    const reopened = new CCHistoryStorage({ dbPath });
    try {
      assert.equal(reopened.getTurnContext("turn-v2-context-orphan"), undefined);
    } finally {
      reopened.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("storage boundary v2 bounded JSON columns stay parseable when source data exceeds the bound", async () => {
  // Regression: boundedJson previously cut the serialized form mid-string and
  // appended "...[truncated]", producing invalid JSON. fromJson on read then
  // threw, so any turn with display_segments > 8 KiB became unreadable via V2.
  // Fix: structural truncation — drop array elements from the tail and object
  // keys from the tail so the result is always valid JSON of the same type.
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-boundary-v2-bounded-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });

    const storage = new CCHistoryStorage({ dbPath });
    const payload = createFixturePayload(
      "srcinst-codex-v2-bounded",
      "Bounded JSON regression",
      "stage-v2-bounded",
      {
        baseDir: sourceRoot,
        sessionId: "session-v2-bounded",
        turnId: "turn-v2-bounded",
      },
    );

    // Overwrite display_segments with 40 segments at 512 bytes each (~20 KiB
    // total, well past the 8 KiB bound). Also bloat lineage.atom_refs and one
    // key of context_summary so we exercise the object-shrink path too.
    const bigText = "x".repeat(512);
    payload.turns[0]!.display_segments = Array.from({ length: 40 }, (_, i) => ({
      type: "text" as const,
      content: `${i}-${bigText}`,
    }));
    payload.turns[0]!.lineage = {
      atom_refs: Array.from({ length: 2000 }, (_, i) => `atom-${i}`),
      candidate_refs: [],
      fragment_refs: [],
      record_refs: [],
      blob_refs: [],
    };
    storage.replaceSourcePayload(payload);
    storage.close();

    const db = new DatabaseSync(dbPath);
    try {
      // The bounded column itself must be valid JSON.
      const row = db
        .prepare(
          "SELECT display_segments_json, lineage_refs_json FROM user_turns_v2 WHERE turn_id = ?",
        )
        .get("turn-v2-bounded") as
        | { display_segments_json: string; lineage_refs_json: string }
        | undefined;
      assert.ok(row, "V2 sidecar row must exist");

      const segments = JSON.parse(row.display_segments_json) as unknown[];
      assert.ok(Array.isArray(segments), "display_segments_json must parse to an array");
      assert.ok(segments.length < 40, "array must be truncated to fit budget");
      assert.ok(segments.length > 0, "array must keep at least one element");

      const lineage = JSON.parse(row.lineage_refs_json) as Record<string, unknown>;
      assert.ok(typeof lineage === "object" && lineage !== null, "lineage must parse to an object");
      // Whatever survived shrinking, every value must itself be a valid array.
      for (const value of Object.values(lineage)) {
        assert.ok(Array.isArray(value), "lineage values must remain arrays after shrink");
      }
    } finally {
      db.close();
    }

    // End-to-end: readUserTurnFromV2 must not throw and must return a usable
    // projection (subset of the original).
    const reopened = new CCHistoryStorage({ dbPath });
    try {
      const db2 = reopened.getDatabaseForMigration();
      const { readUserTurnFromV2 } = await import("../internal/queries.js");
      const turn = readUserTurnFromV2(db2, "turn-v2-bounded") as UserTurnProjection | undefined;
      assert.ok(turn, "V2 read must return a projection");
      assert.ok(turn.display_segments.length < 40, "segments must be a subset");
      assert.ok(turn.display_segments.length > 0, "at least one segment survives");
    } finally {
      reopened.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("storage boundary v2 updates ledger current evidence when source content changes", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-boundary-v2-change-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });

    const sourceId = "srcinst-codex-v2-change";
    const originPath = path.join(sourceRoot, "session.jsonl");
    const storage = new CCHistoryStorage({ dbPath });

    const first = "{\"fixture\":\"one\"}\n";
    await writeFile(originPath, first, "utf8");
    const firstPayload = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath,
      text: first,
      canonicalText: "Initial V2 turn",
      stageRunId: "stage-v2-change-1",
      sessionId: "session-v2-change",
      turnId: "turn-v2-change",
    });
    storage.replaceSourcePayload(firstPayload);

    const second = "{\"fixture\":\"two\"}\n";
    await writeFile(originPath, second, "utf8");
    const secondPayload = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath,
      text: second,
      canonicalText: "Updated V2 turn",
      stageRunId: "stage-v2-change-2",
      sessionId: "session-v2-change",
      turnId: "turn-v2-change",
    });
    storage.replaceSourcePayload(secondPayload);

    assert.equal(storage.getTurn("turn-v2-change")?.canonical_text, "Updated V2 turn");
    storage.close();

    const db = new DatabaseSync(dbPath);
    try {
      const sourceBlobCount = db.prepare(`
        SELECT COUNT(DISTINCT evidence_sha256) AS count
          FROM evidence_captures
         WHERE source_id = ?
           AND capture_kind = 'source_blob'
      `).get(sourceId) as { count: number };
      assert.equal(sourceBlobCount.count, 2);

      const ledger = db.prepare(`
        SELECT current_evidence_sha256,
               source_checksum,
               sync_axis
          FROM source_file_ledger
         WHERE source_id = ?
           AND origin_path = ?
      `).get(sourceId, originPath) as
        | {
            current_evidence_sha256: string;
            source_checksum: string;
            sync_axis: string;
          }
        | undefined;
      assert.ok(ledger);
      assert.equal(ledger.current_evidence_sha256, sha256(second));
      assert.equal(ledger.source_checksum, sha1(second));
      assert.equal(ledger.sync_axis, "current");

      const hotTurns = db.prepare("SELECT COUNT(*) AS count FROM user_turns_v2 WHERE source_id = ?").get(sourceId) as {
        count: number;
      };
      assert.equal(hotTurns.count, 1);
    } finally {
      db.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("storage boundary v2 uses collision-safe ledger ids for path-scoped rows", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-boundary-v2-ledger-id-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    const firstPath = path.join(sourceRoot, "a-b.jsonl");
    const secondPath = path.join(sourceRoot, "a", "b.jsonl");
    await mkdir(path.dirname(firstPath), { recursive: true });
    await mkdir(path.dirname(secondPath), { recursive: true });

    const sourceId = "srcinst-codex-v2-ledger-id";
    const firstText = "{\"fixture\":\"first\"}\n";
    const secondText = "{\"fixture\":\"second\"}\n";
    await writeFile(firstPath, firstText, "utf8");
    await writeFile(secondPath, secondText, "utf8");

    const first = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath: firstPath,
      text: firstText,
      canonicalText: "Hyphen path turn",
      stageRunId: "stage-v2-ledger-id-first",
      sessionId: "session-v2-ledger-id-first",
      turnId: "turn-v2-ledger-id-first",
    });
    const second = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath: secondPath,
      text: secondText,
      canonicalText: "Nested path turn",
      stageRunId: "stage-v2-ledger-id-second",
      sessionId: "session-v2-ledger-id-second",
      turnId: "turn-v2-ledger-id-second",
    });

    const storage = new CCHistoryStorage({ dbPath });
    storage.replaceSourcePayload(combineSourcePayloads(first, second));
    storage.close();

    const db = new DatabaseSync(dbPath);
    try {
      const ledgers = db.prepare(`
        SELECT id,
               origin_path,
               current_evidence_sha256
          FROM source_file_ledger
         WHERE source_id = ?
         ORDER BY origin_path
      `).all(sourceId) as Array<{ id: string; origin_path: string; current_evidence_sha256: string }>;

      assert.equal(ledgers.length, 2);
      assert.deepEqual(ledgers.map((row) => row.origin_path), [secondPath, firstPath].sort());
      assert.equal(new Set(ledgers.map((row) => row.id)).size, 2);
      assert.deepEqual(ledgers.map((row) => row.current_evidence_sha256).sort(), [sha256(firstText), sha256(secondText)].sort());
    } finally {
      db.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("storage boundary v2 merge retires stale ledgers and hot rows while preserving skipped files", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-boundary-v2-merge-"));
  try {
    const dataDir = path.join(tempRoot, "store");
    const sourceId = "srcinst-codex-v2-merge";
    const baseDir = path.join(tempRoot, "source");
    const keepPath = path.join(baseDir, "keep.jsonl");
    const stalePath = path.join(baseDir, "stale.jsonl");
    const newPath = path.join(baseDir, "new.jsonl");

    const storage = new CCHistoryStorage(dataDir);
    const keep = createFixturePayload(sourceId, "Keep V2 turn", "stage-v2-keep", {
      baseDir,
      sessionId: "session-v2-keep",
      turnId: "turn-v2-keep",
    });
    keep.blobs[0]!.origin_path = keepPath;
    const stale = createFixturePayload(sourceId, "Stale V2 turn", "stage-v2-stale", {
      baseDir,
      sessionId: "session-v2-stale",
      turnId: "turn-v2-stale",
    });
    stale.blobs[0]!.origin_path = stalePath;
    storage.replaceSourcePayload(combineSourcePayloads(keep, stale));

    const incoming = createFixturePayload(sourceId, "New V2 turn", "stage-v2-new", {
      baseDir,
      sessionId: "session-v2-new",
      turnId: "turn-v2-new",
    });
    incoming.blobs[0]!.origin_path = newPath;
    storage.mergeSourcePayloadByOriginPath(incoming, {
      preserve_origin_paths: [keepPath],
      observed_origin_paths: [keepPath, newPath],
    });

    assert.deepEqual(storage.listTurns().map((turn) => turn.canonical_text).sort(), ["Keep V2 turn", "New V2 turn"]);
    storage.close();

    const db = new DatabaseSync(path.join(dataDir, "cchistory.sqlite"));
    try {
      const hotTexts = (db.prepare("SELECT canonical_text FROM user_turns_v2 WHERE source_id = ? ORDER BY canonical_text").all(sourceId) as Array<{
        canonical_text: string;
      }>).map((row) => row.canonical_text);
      assert.deepEqual(hotTexts, ["Keep V2 turn", "New V2 turn"]);

      const ledgers = db.prepare(`
        SELECT origin_path,
               sync_axis
          FROM source_file_ledger
         WHERE source_id = ?
         ORDER BY origin_path
      `).all(sourceId) as Array<{ origin_path: string; sync_axis: string }>;
      assert.deepEqual(ledgers.map((row) => ({ origin_path: row.origin_path, sync_axis: row.sync_axis })), [
        { origin_path: keepPath, sync_axis: "current" },
        { origin_path: newPath, sync_axis: "current" },
        { origin_path: stalePath, sync_axis: "source_absent" },
      ].sort((left, right) => left.origin_path.localeCompare(right.origin_path)));
    } finally {
      db.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("storage boundary v2 plans scoped rebuild selections by source, origin, session, project, and parser profile", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-boundary-v2-rebuild-scope-"));
  try {
    const dataDir = path.join(tempRoot, "store");
    const sourceId = "srcinst-codex-v2-rebuild-scope";
    const otherSourceId = "srcinst-claude-v2-rebuild-scope-other";
    const baseDir = path.join(tempRoot, "source");
    const firstPath = path.join(baseDir, "first.jsonl");
    const secondPath = path.join(baseDir, "second.jsonl");
    const otherPath = path.join(baseDir, "other.jsonl");

    const first = createFixturePayload(sourceId, "Scoped first turn", "stage-v2-scope-first", {
      baseDir,
      sessionId: "session-v2-scope-first",
      turnId: "turn-v2-scope-first",
      workingDirectory: "/workspace/v2-scope",
      projectObservation: {
        workspacePath: "/workspace/v2-scope",
        repoFingerprint: "fp-v2-rebuild-scope",
        repoRemote: "https://github.com/example/v2-scope.git",
      },
    });
    first.blobs[0]!.origin_path = firstPath;

    const second = createFixturePayload(sourceId, "Scoped second turn", "stage-v2-scope-second", {
      baseDir,
      sessionId: "session-v2-scope-second",
      turnId: "turn-v2-scope-second",
      workingDirectory: "/workspace/v2-scope",
      projectObservation: {
        workspacePath: "/workspace/v2-scope",
        repoFingerprint: "fp-v2-rebuild-scope",
        repoRemote: "https://github.com/example/v2-scope.git",
      },
    });
    second.blobs[0]!.origin_path = secondPath;

    const other = createFixturePayload(otherSourceId, "Other parser turn", "stage-v2-scope-other", {
      baseDir,
      sessionId: "session-v2-scope-other",
      turnId: "turn-v2-scope-other",
      platform: "claude_code",
      workingDirectory: "/workspace/v2-scope-other",
      projectObservation: {
        workspacePath: "/workspace/v2-scope-other",
        repoFingerprint: "fp-v2-rebuild-scope-other",
      },
    });
    other.blobs[0]!.origin_path = otherPath;
    other.stage_runs[0]!.parser_version = "claude-code-parser@2026-03-09.1";
    other.stage_runs[0]!.source_format_profile_ids = ["claude_code:jsonl:v1"];

    const storage = new CCHistoryStorage(dataDir);
    try {
      storage.replaceSourcePayload(combineSourcePayloads(first, second));
      storage.replaceSourcePayload(other);

      const projectId = storage.listResolvedTurns().find((turn) => turn.id === "turn-v2-scope-first")?.project_id;
      assert.ok(projectId);

      const sourcePlan = storage.planStorageBoundaryRebuildScope({ source_id: sourceId });
      assert.deepEqual(sourcePlan.source_ids, [sourceId]);
      assert.deepEqual(sourcePlan.turn_ids, ["turn-v2-scope-first", "turn-v2-scope-second"]);
      assert.deepEqual(sourcePlan.session_ids, ["session-v2-scope-first", "session-v2-scope-second"]);
      assert.deepEqual(sourcePlan.origin_paths, [firstPath, secondPath].sort());
      assert.ok(sourcePlan.record_ids.includes("turn-v2-scope-first-record"));
      assert.ok(sourcePlan.record_ids.includes("turn-v2-scope-second-record"));
      assert.ok(sourcePlan.evidence_sha256s.length >= 2);
      assert.ok(sourcePlan.context_refs.some((ref) => ref.turn_id === "turn-v2-scope-first"));
      assert.ok(sourcePlan.derived_cache_refs.some((ref) => ref.scope_kind === "source" && ref.scope_ref === sourceId));
      assert.ok(sourcePlan.derived_cache_refs.some((ref) => ref.scope_kind === "origin_path" && ref.scope_ref === firstPath));
      assert.ok(sourcePlan.derived_cache_refs.some((ref) => ref.scope_kind === "session" && ref.scope_ref === "session-v2-scope-first"));
      assert.equal(sourcePlan.turn_ids.includes("turn-v2-scope-other"), false);

      const originPlan = storage.planStorageBoundaryRebuildScope({ origin_path: secondPath });
      assert.deepEqual(originPlan.source_ids, [sourceId]);
      assert.deepEqual(originPlan.origin_paths, [secondPath]);
      assert.deepEqual(originPlan.session_ids, ["session-v2-scope-second"]);
      assert.deepEqual(originPlan.turn_ids, ["turn-v2-scope-second"]);
      assert.deepEqual(originPlan.record_ids, ["turn-v2-scope-second-record"]);
      assert.ok(originPlan.derived_cache_refs.some((ref) => ref.scope_kind === "origin_path" && ref.scope_ref === secondPath));

      const sessionPlan = storage.planStorageBoundaryRebuildScope({ session_id: "session-v2-scope-first" });
      assert.deepEqual(sessionPlan.source_ids, [sourceId]);
      assert.deepEqual(sessionPlan.origin_paths, [firstPath]);
      assert.deepEqual(sessionPlan.session_ids, ["session-v2-scope-first"]);
      assert.deepEqual(sessionPlan.turn_ids, ["turn-v2-scope-first"]);
      assert.deepEqual(sessionPlan.record_ids, ["turn-v2-scope-first-record"]);
      assert.ok(sessionPlan.derived_cache_refs.some((ref) => ref.scope_kind === "session" && ref.scope_ref === "session-v2-scope-first"));

      const projectPlan = storage.planStorageBoundaryRebuildScope({ project_id: projectId });
      assert.deepEqual(projectPlan.project_ids, [projectId]);
      assert.deepEqual(projectPlan.source_ids, [sourceId]);
      assert.deepEqual(projectPlan.turn_ids, ["turn-v2-scope-first", "turn-v2-scope-second"]);
      assert.deepEqual(projectPlan.origin_paths, [firstPath, secondPath].sort());
      assert.deepEqual(projectPlan.record_ids, ["turn-v2-scope-first-record", "turn-v2-scope-second-record"]);
      assert.ok(projectPlan.turn_refs.every((turn) => turn.project_id === projectId));

      const parserPlan = storage.planStorageBoundaryRebuildScope({ parser_profile_id: "codex:jsonl:v1" });
      assert.deepEqual(parserPlan.requested_scope.parser_profile_ids, ["codex:jsonl:v1"]);
      assert.deepEqual(parserPlan.parser_profile_ids, ["codex:jsonl:v1"]);
      assert.deepEqual(parserPlan.source_ids, [sourceId]);
      assert.deepEqual(parserPlan.turn_ids, ["turn-v2-scope-first", "turn-v2-scope-second"]);
      assert.ok(parserPlan.derived_cache_refs.some((ref) => ref.scope_kind === "parser_profile" && ref.scope_ref === "codex:jsonl:v1"));
      assert.equal(parserPlan.turn_ids.includes("turn-v2-scope-other"), false);

      const otherParserPlan = storage.planStorageBoundaryRebuildScope({ parser_profile_id: "claude_code:jsonl:v1" });
      assert.deepEqual(otherParserPlan.source_ids, [otherSourceId]);
      assert.deepEqual(otherParserPlan.turn_ids, ["turn-v2-scope-other"]);
      assert.deepEqual(otherParserPlan.origin_paths, [otherPath]);

      assert.ok(storage.getTurnLineage("turn-v2-scope-first")?.blobs.some((blob) => blob.origin_path === firstPath));
    } finally {
      storage.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function createPayloadForSourceFile(input: {
  sourceId: string;
  sourceRoot: string;
  originPath: string;
  text: string;
  canonicalText: string;
  stageRunId: string;
  sessionId: string;
  turnId: string;
}): SourceSyncPayload {
  const payload = createFixturePayload(input.sourceId, input.canonicalText, input.stageRunId, {
    baseDir: input.sourceRoot,
    sessionId: input.sessionId,
    turnId: input.turnId,
  });
  payload.blobs[0]!.origin_path = input.originPath;
  payload.blobs[0]!.captured_path = undefined;
  payload.blobs[0]!.checksum = sha1(input.text);
  payload.blobs[0]!.size_bytes = Buffer.byteLength(input.text, "utf8");
  payload.blobs[0]!.file_identity_stable = true;
  return payload;
}

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

function sha1(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
