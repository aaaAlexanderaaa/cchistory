import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { SourceSyncPayload, UserTurnProjection } from "@cchistory/domain";
import { CCHistoryStorage } from "../index.js";
import { retireStorageBoundaryV2Sources, shrinkJsonToBudget } from "../evidence-store.js";
import { selectOrphanedBlobIds } from "../internal/gc.js";
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
      assert.equal(evidenceBlobCount.count, 3, "source blob, context cache, and turn lineage blob should each be stored once");

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
               content_max_timestamp,
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
            content_max_timestamp: string | null;
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
      assert.equal(ledger.content_max_timestamp, null);
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

test("storage boundary v2 reconstructs turn context from the content-addressed cache (B.6: V1 turn_contexts no longer exists)", async () => {
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

    // B.6: V1 turn_contexts no longer exists; the V2 cache is the only source.
    // The "DELETE FROM turn_contexts" step from the pre-B.6 version of this
    // test is now a no-op. Verify the cache file exists and is readable.
    const db = new DatabaseSync(dbPath);
    try {
      const contextRef = db.prepare("SELECT cache_storage_path FROM turn_context_refs_v2 WHERE turn_id = ?")
        .get("turn-v2-context-cache") as { cache_storage_path: string } | undefined;
      assert.ok(contextRef);
      await access(path.join(storeDir, contextRef.cache_storage_path));
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
          (SELECT COUNT(*) FROM user_turns_v2 WHERE turn_id = ?) AS user_turns_v2,
          (SELECT COUNT(*) FROM turn_context_refs_v2 WHERE turn_id = ?) AS turn_context_refs_v2,
          (SELECT COUNT(*) FROM captured_blobs WHERE source_id = ?) AS captured_blobs,
          (SELECT COUNT(*) FROM evidence_captures WHERE source_id = ?) AS evidence_captures,
          (SELECT COUNT(*) FROM parsed_record_spans WHERE source_id = ?) AS parsed_record_spans
      `).get(
        "turn-v2-context-purge",
        "turn-v2-context-purge",
        "srcinst-codex-v2-context-purge",
        "srcinst-codex-v2-context-purge",
        "srcinst-codex-v2-context-purge",
      ) as {
        user_turns_v2: number;
        turn_context_refs_v2: number;
        captured_blobs: number;
        evidence_captures: number;
        parsed_record_spans: number;
      };
      assert.equal(counts.user_turns_v2, 0);
      assert.equal(counts.turn_context_refs_v2, 0);
      assert.equal(counts.captured_blobs, 0, "single-turn purge must remove orphaned captured blob rows");
      assert.equal(counts.evidence_captures, 0, "single-turn purge must remove orphaned evidence captures");
      assert.equal(counts.parsed_record_spans, 0, "single-turn purge must remove orphaned parsed spans");
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
      // B.6: V1 turn_contexts is no longer written. The read path's "is this
      // turn live?" check post-B.5.6 is V2-only via getTurn, so the orphan
      // simulation is to drop the V2 user_turns_v2 row.
      db.prepare("DELETE FROM user_turns_v2 WHERE turn_id = ?").run("turn-v2-context-orphan");
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
    // Crucially, the SAME 40 segments are mirrored onto user_messages[0].display_segments
    // — that's where the parser puts them, and the V2 read path now reconstructs
    // turn.display_segments from there (the bounded display_segments_json column
    // is kept only as a scan hint, not as the authoritative source).
    const bigText = "x".repeat(512);
    const bigSegments = Array.from({ length: 40 }, (_, i) => ({
      type: "text" as const,
      content: `${i}-${bigText}`,
    }));
    payload.turns[0]!.display_segments = bigSegments;
    payload.turns[0]!.user_messages[0]!.display_segments = bigSegments;
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

    // End-to-end: readUserTurnFromV2 reconstructs display_segments from
    // user_messages[].display_segments (the same way the parser produces it),
    // so the result is the FULL 40 segments — not the truncated subset stored
    // in the bounded column. This is the V2-native pattern for derivable
    // fields: don't pay storage for what you can recompute.
    const reopened = new CCHistoryStorage({ dbPath });
    try {
      const db2 = reopened.getDatabaseForMigration();
      const assetDir = path.dirname(dbPath);
      const { readUserTurnFromV2 } = await import("../internal/queries.js");
      const turn = readUserTurnFromV2({ db: db2, turnId: "turn-v2-bounded", assetDir }) as UserTurnProjection | undefined;
      assert.ok(turn, "V2 read must return a projection");
      assert.equal(turn.display_segments.length, 40, "display_segments is reconstructed in full from user_messages");
      assert.equal(turn.display_segments[0]!.content, `0-${bigText}`);
      assert.equal(turn.display_segments[39]!.content, `39-${bigText}`);
      // B.5.0g: full lineage is fetched from the content-addressed blob, so
      // atom_refs survives in full (the bounded column would have truncated
      // the 2000 entries to ~80).
      assert.equal(turn.lineage.atom_refs.length, 2000, "lineage refs reconstructed in full from blob");
    } finally {
      reopened.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("storage boundary v2 bounded JSON keeps an oversized single-string value via truncation (H5)", async () => {
  // Regression: shrinkJsonToBudget used to bottom out at the primitive branch
  // for any non-object/array value, returning it unchanged. An object whose
  // only value was a single string larger than perKeyBudget (e.g.
  // {"summary": "<10 KiB string>"} at a 4 KiB bound) would then fail the
  // "still over budget" check, enter the tail-key drop loop, delete the only
  // key, and return {} — silent total loss of the field on every read.
  // Fix: strings take the boundedString path so the key survives with a
  // truncated value. Numbers/booleans/null still pass through (no smaller
  // valid JSON of the same type exists).
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-boundary-v2-h5-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });

    const storage = new CCHistoryStorage({ dbPath });
    const payload = createFixturePayload(
      "srcinst-codex-v2-h5",
      "H5 string-primitive shrink",
      "stage-v2-h5",
      { baseDir: sourceRoot, sessionId: "session-v2-h5", turnId: "turn-v2-h5" },
    );
    // context_summary is a bounded object column (~4 KiB budget). Stuff one
    // string field (primary_model) with 16 KiB so perKeyBudget alone can't
    // fit it; the rest of the object stays small.
    const hugeModel = "Z".repeat(16 * 1024);
    payload.turns[0]!.context_summary = {
      assistant_reply_count: 0,
      tool_call_count: 0,
      has_errors: false,
      primary_model: hugeModel,
    };
    storage.replaceSourcePayload(payload);
    storage.close();

    const db = new DatabaseSync(dbPath);
    try {
      const row = db
        .prepare(
          "SELECT context_summary_json FROM user_turns_v2 WHERE turn_id = ?",
        )
        .get("turn-v2-h5") as { context_summary_json: string } | undefined;
      assert.ok(row, "V2 sidecar row must exist");
      const parsed = JSON.parse(row.context_summary_json) as Record<string, unknown>;
      assert.ok(
        typeof parsed === "object" && parsed !== null && "primary_model" in parsed,
        "context_summary must keep the 'primary_model' key (H5: no silent total loss)",
      );
      const value = parsed.primary_model;
      assert.equal(typeof value, "string", "primary_model value must remain a string after shrink");
      assert.ok(
        (value as string).length < hugeModel.length,
        "primary_model value must be truncated to fit the budget",
      );
      assert.ok(
        (value as string).length > 0,
        "primary_model value must not be empty (would defeat keeping the key)",
      );
    } finally {
      db.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("storage boundary v2 boundedString preserves a legitimate trailing U+FFFD when the cut is clean (M3)", async () => {
  // Regression: boundedString unconditionally stripped a trailing U+FFFD
  // after a subarray cut. When the original value legitimately ended with
  // U+FFFD AND the cut landed exactly after it (clean boundary), the regex
  // deleted the user's actual character along with any truncation artifact.
  // The fix detects clean cuts via byte-length round-trip and only strips
  // when the cut actually landed mid-multi-byte.
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-boundary-v2-m3-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });

    const storage = new CCHistoryStorage({ dbPath });
    const payload = createFixturePayload(
      "srcinst-codex-v2-m3",
      "M3 FFMD preservation",
      "stage-v2-m3",
      { baseDir: sourceRoot, sessionId: "session-v2-m3", turnId: "turn-v2-m3" },
    );

    // canonical_text is bounded at 16 * 1024 = 16384 bytes via boundedString.
    // Reserve for "...[truncated]" is 13 bytes, so the cut lands at byte 16371
    // (subarray(0, 16371) — exclusive end). Place a legitimate U+FFFD
    // (3 bytes EF BF BD) ending exactly at byte 16370 — i.e., fully inside
    // the slice, with the next byte (the cut position) being a clean
    // boundary. Old behavior stripped the FFMD; fix preserves it.
    const CUT = 16 * 1024 - Buffer.byteLength("...[truncated]", "utf8"); // 16371
    const FFMD_BYTES = Buffer.byteLength("�", "utf8"); // 3
    const filler = "a".repeat(CUT - FFMD_BYTES); // bytes 0..16367 are filler
    const canonical = filler + "�" + "b".repeat(100); // FFMD at 16368..16370, cut at 16371 is clean
    payload.turns[0]!.canonical_text = canonical;
    payload.turns[0]!.raw_text = canonical;
    storage.replaceSourcePayload(payload);
    storage.close();

    const db = new DatabaseSync(dbPath);
    try {
      const row = db
        .prepare("SELECT canonical_text FROM user_turns_v2 WHERE turn_id = ?")
        .get("turn-v2-m3") as { canonical_text: string } | undefined;
      assert.ok(row, "V2 sidecar row must exist");
      // The FFMD must be preserved AND the truncator must be appended.
      // Old behavior produced "aaa...[truncated]" with the FFMD gone.
      assert.ok(
        row.canonical_text.endsWith("�...[truncated]"),
        `canonical_text must preserve the legitimate trailing U+FFFD before the truncator; got: ${JSON.stringify(row.canonical_text.slice(-40))}`,
      );
    } finally {
      db.close();
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

test("storage boundary v2 merge marks stale projections source-absent while preserving all rows", async () => {
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

    assert.deepEqual(storage.listTurns().map((turn) => turn.canonical_text).sort(), [
      "Keep V2 turn",
      "New V2 turn",
      "Stale V2 turn",
    ]);
    assert.equal(storage.getTurn("turn-v2-stale")?.sync_axis, "source_absent");
    assert.equal(storage.getSession("session-v2-stale")?.sync_axis, "source_absent");
    storage.close();

    const db = new DatabaseSync(path.join(dataDir, "cchistory.sqlite"));
    try {
      const hotTexts = (db.prepare("SELECT canonical_text FROM user_turns_v2 WHERE source_id = ? ORDER BY canonical_text").all(sourceId) as Array<{
        canonical_text: string;
      }>).map((row) => row.canonical_text);
      assert.deepEqual(hotTexts, ["Keep V2 turn", "New V2 turn", "Stale V2 turn"]);

      const hotAxes = db.prepare(`
        SELECT canonical_text,
               sync_axis
          FROM user_turns_v2
         WHERE source_id = ?
         ORDER BY canonical_text
      `).all(sourceId) as Array<{ canonical_text: string; sync_axis: string }>;
      assert.deepEqual(hotAxes.map((row) => ({ ...row })), [
        { canonical_text: "Keep V2 turn", sync_axis: "current" },
        { canonical_text: "New V2 turn", sync_axis: "current" },
        { canonical_text: "Stale V2 turn", sync_axis: "source_absent" },
      ]);

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

test("shared-session replacement retains an absent sibling contribution and replaces only the current origin", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-shared-session-absence-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });
    const absentPath = path.join(sourceRoot, "absent.jsonl");
    const changedPath = path.join(sourceRoot, "changed.jsonl");
    const sourceId = "srcinst-shared-session-absence";
    const sessionId = "session-shared-absence";

    const absent = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath: absentPath,
      text: "{\"absent\":1}\n",
      canonicalText: "absent sibling turn",
      stageRunId: "stage-shared-absent",
      sessionId,
      turnId: "turn-shared-absent",
    });
    const oldCurrent = retargetPayloadSession(createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath: changedPath,
      text: "{\"current\":1}\n",
      canonicalText: "old current sibling turn",
      stageRunId: "stage-shared-current-old",
      sessionId: "session-before-retarget",
      turnId: "turn-shared-current-old",
    }), sessionId, { omitSession: true });

    const storage = new CCHistoryStorage(storeDir);
    storage.replaceSourcePayload(combineSourcePayloads(absent, oldCurrent));

    const newCurrent = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath: changedPath,
      text: "{\"current\":2}\n",
      canonicalText: "new current sibling turn",
      stageRunId: "stage-shared-current-new",
      sessionId,
      turnId: "turn-shared-current-new",
    });
    storage.mergeSourcePayloadByOriginPath(newCurrent, {
      observed_origin_paths: [changedPath],
      refreshDerived: false,
    });

    assert.equal(storage.getTurn("turn-shared-absent")?.sync_axis, "current");
    assert.equal(storage.getTurn("turn-shared-current-old"), undefined);
    assert.equal(storage.getTurn("turn-shared-current-new")?.sync_axis, "current");
    assert.equal(storage.getSession(sessionId)?.sync_axis, "current");
    assert.ok(storage.getTurnLineage("turn-shared-absent")?.blobs.some((blob) => blob.origin_path === absentPath));

    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    try {
      const absentRaw = db.prepare(
        "SELECT COUNT(*) AS count FROM raw_records WHERE source_id = ? AND blob_id = ?",
      ).get(sourceId, absent.blobs[0]!.id) as { count: number };
      assert.equal(absentRaw.count, 1);
    } finally {
      db.close();
    }
    storage.close();
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("shared-session replacement keeps lineage coherent when a sibling parse is non-authoritative", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-shared-session-failure-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });
    const failedPath = path.join(sourceRoot, "failed.jsonl");
    const changedPath = path.join(sourceRoot, "changed.jsonl");
    const sourceId = "srcinst-shared-session-failure";
    const sessionId = "session-shared-failure";

    const priorFailedSibling = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath: failedPath,
      text: "{\"valid\":1}\n",
      canonicalText: "last valid failed sibling turn",
      stageRunId: "stage-shared-failed-old",
      sessionId,
      turnId: "turn-shared-failed-old",
    });
    const priorChangedSibling = retargetPayloadSession(createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath: changedPath,
      text: "{\"changed\":1}\n",
      canonicalText: "old changed sibling turn",
      stageRunId: "stage-shared-changed-old",
      sessionId: "session-shared-failure-before-retarget",
      turnId: "turn-shared-changed-old",
    }), sessionId, { omitSession: true });
    const storage = new CCHistoryStorage(storeDir);
    storage.replaceSourcePayload(combineSourcePayloads(priorFailedSibling, priorChangedSibling));

    const changedSibling = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath: changedPath,
      text: "{\"changed\":2}\n",
      canonicalText: "new changed sibling turn",
      stageRunId: "stage-shared-changed-new",
      sessionId,
      turnId: "turn-shared-changed-new",
    });
    const failedCapture = retargetPayloadSession(createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath: failedPath,
      text: "{\"invalid\":",
      canonicalText: "must not replace failed sibling turn",
      stageRunId: "stage-shared-failed-new",
      sessionId: "session-shared-failure-failed-retarget",
      turnId: "turn-shared-failed-new",
    }), sessionId, { omitSession: true });
    failedCapture.loss_audits = [{
      ...failedCapture.loss_audits[0]!,
      stage_kind: "parse_source_fragments",
      diagnostic_code: "record_json_parse_failed",
      severity: "warning",
      blob_ref: failedCapture.blobs[0]!.id,
    }];

    storage.mergeSourcePayloadByOriginPath(combineSourcePayloads(changedSibling, failedCapture), {
      observed_origin_paths: [changedPath, failedPath],
      refreshDerived: false,
      skipPrune: true,
    });
    storage.pruneEvidenceBlobsNow();

    assert.equal(storage.getTurn("turn-shared-failed-old")?.sync_axis, "current");
    assert.equal(storage.getTurn("turn-shared-failed-new"), undefined);
    assert.equal(storage.getTurn("turn-shared-changed-old")?.sync_axis, "current");
    assert.equal(storage.getTurn("turn-shared-changed-new"), undefined);
    assert.ok(storage.getTurnLineage("turn-shared-failed-old")?.blobs.some((blob) => blob.origin_path === failedPath));
    assert.ok(storage.getTurnLineage("turn-shared-changed-old")?.blobs.some((blob) => blob.origin_path === changedPath));
    storage.close();
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("lifecycle-only merge reports a projection change and preserves stale source health", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-lifecycle-only-progress-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const sourceRoot = path.join(tempRoot, "source");
    const originPath = path.join(sourceRoot, "session.jsonl");
    const sourceId = "srcinst-lifecycle-only-progress";
    const storage = new CCHistoryStorage(storeDir);
    const initial = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath,
      text: "{\"lifecycle\":1}\n",
      canonicalText: "retained lifecycle-only turn",
      stageRunId: "stage-lifecycle-only",
      sessionId: "session-lifecycle-only",
      turnId: "turn-lifecycle-only",
    });
    storage.replaceSourcePayload(initial);

    const lifecycleOnly: SourceSyncPayload = {
      ...initial,
      source: { ...initial.source, sync_status: "stale" },
      blobs: [],
      records: [],
      fragments: [],
      atoms: [],
      edges: [],
      candidates: [],
      sessions: [],
      turns: [],
      contexts: [],
      ask_user_question_turns: [],
    };
    const progress: boolean[] = [];
    storage.mergeSourcePayloadByOriginPath(lifecycleOnly, {
      observed_origin_paths: [],
      refreshDerived: false,
      onProgress: (event) => {
        if (event.stage === "write_store_done") {
          progress.push(event.projection_changed);
        }
      },
    });

    assert.deepEqual(progress, [true]);
    assert.equal(storage.getTurn("turn-lifecycle-only")?.sync_axis, "source_absent");
    assert.equal(storage.listSources()[0]?.sync_status, "stale");
    assert.equal(storage.listSources()[0]?.total_turns, 1);
    storage.close();
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("source absence retains non-streaming evidence and projections through forced GC", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-absence-nonstream-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });
    const absentPath = path.join(sourceRoot, "absent.jsonl");
    const currentPath = path.join(sourceRoot, "current.jsonl");
    const absentText = "{\"absence\":\"retained\"}\n";
    const currentText = "{\"current\":true}\n";
    await writeFile(absentPath, absentText, "utf8");
    await writeFile(currentPath, currentText, "utf8");

    const sourceId = "srcinst-claude-absence-retention";
    const absent = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath: absentPath,
      text: absentText,
      canonicalText: "retain absent projection",
      stageRunId: "stage-absence-old",
      sessionId: "session-absence-old",
      turnId: "turn-absence-old",
    });
    const current = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath: currentPath,
      text: currentText,
      canonicalText: "keep current projection",
      stageRunId: "stage-absence-current",
      sessionId: "session-absence-current",
      turnId: "turn-absence-current",
    });

    const storage = new CCHistoryStorage({ dbPath });
    storage.replaceSourcePayload(absent);
    const before = new DatabaseSync(dbPath);
    const evidence = before.prepare(`
      SELECT ec.evidence_sha256, eb.storage_path
        FROM evidence_captures ec
        JOIN evidence_blobs eb ON eb.sha256 = ec.evidence_sha256
       WHERE ec.source_id = ? AND ec.blob_id = ?
    `).get(sourceId, absent.blobs[0]!.id) as { evidence_sha256: string; storage_path: string };
    before.close();
    const evidencePath = path.join(storeDir, evidence.storage_path);
    await access(evidencePath);

    await rm(absentPath);
    storage.mergeSourcePayloadByOriginPath(current, {
      observed_origin_paths: [currentPath],
      refreshDerived: false,
      skipPrune: true,
    });
    storage.pruneEvidenceBlobsNow();

    const retainedTurn = storage.getTurn("turn-absence-old");
    assert.ok(retainedTurn, "source-absent UserTurn remains addressable");
    assert.equal(retainedTurn.sync_axis, "source_absent");
    assert.equal(storage.getSession("session-absence-old")?.sync_axis, "source_absent");
    assert.equal(storage.getTurnContext("turn-absence-old")?.turn_id, "turn-absence-old");

    const after = new DatabaseSync(dbPath);
    try {
      const state = after.prepare(`
        SELECT
          (SELECT COUNT(*) FROM captured_blobs WHERE source_id = ? AND id = ?) AS captured_blob_count,
          (SELECT COUNT(*) FROM raw_records WHERE source_id = ? AND blob_id = ?) AS raw_record_count,
          (SELECT COUNT(*) FROM parsed_record_spans WHERE source_id = ? AND blob_id = ?) AS parsed_span_count,
          (SELECT COUNT(*) FROM evidence_captures WHERE source_id = ? AND blob_id = ?) AS capture_count,
          (SELECT COUNT(*) FROM evidence_blobs WHERE sha256 = ?) AS evidence_blob_count,
          (SELECT sync_axis FROM source_file_ledger WHERE source_id = ? AND origin_path = ?) AS ledger_axis
      `).get(
        sourceId, absent.blobs[0]!.id,
        sourceId, absent.blobs[0]!.id,
        sourceId, absent.blobs[0]!.id,
        sourceId, absent.blobs[0]!.id,
        evidence.evidence_sha256,
        sourceId, absentPath,
      ) as {
        captured_blob_count: number;
        raw_record_count: number;
        parsed_span_count: number;
        capture_count: number;
        evidence_blob_count: number;
        ledger_axis: string;
      };
      assert.deepEqual({ ...state }, {
        captured_blob_count: 1,
        raw_record_count: 1,
        parsed_span_count: 1,
        capture_count: 1,
        evidence_blob_count: 1,
        ledger_axis: "source_absent",
      });
    } finally {
      after.close();
    }
    await access(evidencePath);
    storage.close();
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("source absence retains streaming evidence and projections through forced GC", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-absence-stream-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });
    const absentPath = path.join(sourceRoot, "absent.jsonl");
    const currentPath = path.join(sourceRoot, "current.jsonl");
    const absentText = "{\"stream_absence\":\"retained\"}\n";
    const currentText = "{\"stream_current\":true}\n";
    await writeFile(absentPath, absentText, "utf8");
    await writeFile(currentPath, currentText, "utf8");

    const sourceId = "srcinst-codex-stream-absence-retention";
    const absent = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath: absentPath,
      text: absentText,
      canonicalText: "retain streaming absent projection",
      stageRunId: "stage-stream-absence-old",
      sessionId: "session-stream-absence-old",
      turnId: "turn-stream-absence-old",
    });
    const current = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath: currentPath,
      text: currentText,
      canonicalText: "keep streaming current projection",
      stageRunId: "stage-stream-absence-current",
      sessionId: "session-stream-absence-current",
      turnId: "turn-stream-absence-current",
    });

    const storage = new CCHistoryStorage({ dbPath });
    storage.replaceSourcePayload(absent);
    const before = new DatabaseSync(dbPath);
    const evidence = before.prepare(`
      SELECT ec.evidence_sha256, eb.storage_path
        FROM evidence_captures ec
        JOIN evidence_blobs eb ON eb.sha256 = ec.evidence_sha256
       WHERE ec.source_id = ? AND ec.blob_id = ?
    `).get(sourceId, absent.blobs[0]!.id) as { evidence_sha256: string; storage_path: string };
    before.close();
    const evidencePath = path.join(storeDir, evidence.storage_path);
    await access(evidencePath);

    await rm(absentPath);
    await storage.mergeSourcePayloadStreaming(current.source, {
      chunks: (async function* () {
        yield {
          origin_path: currentPath,
          stage_runs: current.stage_runs,
          loss_audits: current.loss_audits,
          blobs: current.blobs,
          records: current.records,
          fragments: current.fragments,
          atoms: current.atoms,
          edges: current.edges,
          candidates: current.candidates,
          sessions: current.sessions,
          turns: current.turns,
          contexts: current.contexts,
          ask_user_question_turns: current.ask_user_question_turns,
        };
      })(),
      preserve_origin_paths: new Set(),
      observed_origin_paths: new Set([currentPath]),
    });
    storage.pruneEvidenceBlobsNow();

    const retainedTurn = storage.getTurn("turn-stream-absence-old");
    assert.ok(retainedTurn, "streaming source-absent UserTurn remains addressable");
    assert.equal(retainedTurn.sync_axis, "source_absent");
    assert.equal(storage.getSession("session-stream-absence-old")?.sync_axis, "source_absent");
    assert.equal(storage.getTurnContext("turn-stream-absence-old")?.turn_id, "turn-stream-absence-old");

    const after = new DatabaseSync(dbPath);
    try {
      const state = after.prepare(`
        SELECT
          (SELECT COUNT(*) FROM captured_blobs WHERE source_id = ? AND id = ?) AS captured_blob_count,
          (SELECT COUNT(*) FROM raw_records WHERE source_id = ? AND blob_id = ?) AS raw_record_count,
          (SELECT COUNT(*) FROM parsed_record_spans WHERE source_id = ? AND blob_id = ?) AS parsed_span_count,
          (SELECT COUNT(*) FROM evidence_captures WHERE source_id = ? AND blob_id = ?) AS capture_count,
          (SELECT COUNT(*) FROM evidence_blobs WHERE sha256 = ?) AS evidence_blob_count,
          (SELECT sync_axis FROM source_file_ledger WHERE source_id = ? AND origin_path = ?) AS ledger_axis
      `).get(
        sourceId, absent.blobs[0]!.id,
        sourceId, absent.blobs[0]!.id,
        sourceId, absent.blobs[0]!.id,
        sourceId, absent.blobs[0]!.id,
        evidence.evidence_sha256,
        sourceId, absentPath,
      ) as {
        captured_blob_count: number;
        raw_record_count: number;
        parsed_span_count: number;
        capture_count: number;
        evidence_blob_count: number;
        ledger_axis: string;
      };
      assert.deepEqual({ ...state }, {
        captured_blob_count: 1,
        raw_record_count: 1,
        parsed_span_count: 1,
        capture_count: 1,
        evidence_blob_count: 1,
        ledger_axis: "source_absent",
      });
    } finally {
      after.close();
    }
    await access(evidencePath);
    storage.close();
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("source presence reconciliation keeps a cross-file session current and reactivates an unchanged origin", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-presence-cross-file-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });
    const firstPath = path.join(sourceRoot, "first.jsonl");
    const secondPath = path.join(sourceRoot, "second.jsonl");
    const firstText = "{\"cross_file\":\"first\"}\n";
    const secondText = "{\"cross_file\":\"second\"}\n";
    await writeFile(firstPath, firstText, "utf8");
    await writeFile(secondPath, secondText, "utf8");

    const sourceId = "srcinst-claude-cross-file-presence";
    const sessionId = "session-cross-file-presence";
    const first = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath: firstPath,
      text: firstText,
      canonicalText: "cross-file first turn",
      stageRunId: "stage-cross-file-first",
      sessionId,
      turnId: "turn-cross-file-first",
    });
    const second = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath: secondPath,
      text: secondText,
      canonicalText: "cross-file second turn",
      stageRunId: "stage-cross-file-second",
      sessionId,
      turnId: "turn-cross-file-second",
    });

    const storage = new CCHistoryStorage(storeDir);
    const combined = combineSourcePayloads(first, second);
    combined.sessions = [first.sessions[0]!];
    storage.replaceSourcePayload(combined);
    storage.pruneSourcePayloadByObservedOriginPaths(sourceId, [secondPath], { refreshDerived: false });

    assert.equal(storage.getSession(sessionId)?.sync_axis, "current");
    assert.equal(storage.getTurn("turn-cross-file-first")?.sync_axis, "current");
    assert.equal(storage.getTurn("turn-cross-file-second")?.sync_axis, "current");

    const absentDb = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    try {
      const axes = absentDb.prepare(`
        SELECT origin_path, sync_axis
          FROM source_file_ledger
         WHERE source_id = ?
         ORDER BY origin_path
      `).all(sourceId) as Array<{ origin_path: string; sync_axis: string }>;
      assert.deepEqual(axes.map((row) => ({ ...row })), [
        { origin_path: firstPath, sync_axis: "source_absent" },
        { origin_path: secondPath, sync_axis: "current" },
      ]);
    } finally {
      absentDb.close();
    }

    storage.pruneSourcePayloadByObservedOriginPaths(sourceId, [firstPath, secondPath], { refreshDerived: false });
    assert.equal(storage.getSession(sessionId)?.sync_axis, "current");
    assert.equal(storage.getTurn("turn-cross-file-first")?.sync_axis, "current");

    const currentDb = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    try {
      const firstLedger = currentDb.prepare(`
        SELECT sync_axis
          FROM source_file_ledger
         WHERE source_id = ? AND origin_path = ?
      `).get(sourceId, firstPath) as { sync_axis: string };
      assert.equal(firstLedger.sync_axis, "current");
    } finally {
      currentDb.close();
    }
    storage.close();
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("merge without a complete observed inventory never marks unvisited origins absent", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-presence-partial-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });
    const visitedPath = path.join(sourceRoot, "visited.jsonl");
    const unvisitedPath = path.join(sourceRoot, "unvisited.jsonl");
    const oldVisitedText = "{\"partial\":\"old-visited\"}\n";
    const newVisitedText = "{\"partial\":\"new-visited\"}\n";
    const unvisitedText = "{\"partial\":\"unvisited\"}\n";
    await writeFile(visitedPath, oldVisitedText, "utf8");
    await writeFile(unvisitedPath, unvisitedText, "utf8");

    const sourceId = "srcinst-claude-partial-presence";
    const oldVisited = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath: visitedPath,
      text: oldVisitedText,
      canonicalText: "old visited turn",
      stageRunId: "stage-partial-old-visited",
      sessionId: "session-partial-visited",
      turnId: "turn-partial-old-visited",
    });
    const unvisited = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath: unvisitedPath,
      text: unvisitedText,
      canonicalText: "unvisited retained turn",
      stageRunId: "stage-partial-unvisited",
      sessionId: "session-partial-unvisited",
      turnId: "turn-partial-unvisited",
    });

    const storage = new CCHistoryStorage(storeDir);
    storage.replaceSourcePayload(combineSourcePayloads(oldVisited, unvisited));
    await writeFile(visitedPath, newVisitedText, "utf8");
    const newVisited = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath: visitedPath,
      text: newVisitedText,
      canonicalText: "new visited turn",
      stageRunId: "stage-partial-new-visited",
      sessionId: "session-partial-visited",
      turnId: "turn-partial-new-visited",
    });

    storage.mergeSourcePayloadByOriginPath(newVisited, { refreshDerived: false });

    assert.equal(storage.getTurn("turn-partial-old-visited"), undefined);
    assert.equal(storage.getTurn("turn-partial-new-visited")?.sync_axis, "current");
    assert.equal(storage.getTurn("turn-partial-unvisited")?.sync_axis, "current");
    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    try {
      const unvisitedLedger = db.prepare(`
        SELECT sync_axis
          FROM source_file_ledger
         WHERE source_id = ? AND origin_path = ?
      `).get(sourceId, unvisitedPath) as { sync_axis: string };
      assert.equal(unvisitedLedger.sync_axis, "current");
    } finally {
      db.close();
    }
    storage.close();
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("non-authoritative captured bytes retain the prior projection and both evidence versions", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-nonauthoritative-capture-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });
    const originPath = path.join(sourceRoot, "session.jsonl");
    const oldText = "{\"parse\":\"valid\"}\n";
    const failedText = "{\"parse\":\"captured-but-invalid";
    await writeFile(originPath, oldText, "utf8");

    const sourceId = "srcinst-claude-nonauthoritative-capture";
    const oldPayload = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath,
      text: oldText,
      canonicalText: "last successful projection",
      stageRunId: "stage-nonauthoritative-old",
      sessionId: "session-nonauthoritative",
      turnId: "turn-nonauthoritative-old",
    });
    const storage = new CCHistoryStorage({ dbPath });
    storage.replaceSourcePayload(oldPayload);

    await writeFile(originPath, failedText, "utf8");
    const failedCapture = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath,
      text: failedText,
      canonicalText: "must not replace the old projection",
      stageRunId: "stage-nonauthoritative-failed",
      sessionId: "session-nonauthoritative",
      turnId: "turn-nonauthoritative-failed",
    });
    failedCapture.loss_audits = [{
      ...failedCapture.loss_audits[0]!,
      stage_kind: "parse_source_fragments",
      diagnostic_code: "record_json_parse_failed",
      severity: "warning",
      blob_ref: failedCapture.blobs[0]!.id,
    }];
    storage.mergeSourcePayloadByOriginPath(failedCapture, {
      observed_origin_paths: [originPath],
      refreshDerived: false,
      skipPrune: true,
    });
    storage.pruneEvidenceBlobsNow();

    assert.equal(storage.getTurn("turn-nonauthoritative-old")?.sync_axis, "current");
    assert.equal(storage.getTurn("turn-nonauthoritative-failed"), undefined);
    const db = new DatabaseSync(dbPath);
    try {
      const state = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM captured_blobs WHERE source_id = ?) AS captured_blob_count,
          (SELECT COUNT(*) FROM evidence_captures WHERE source_id = ? AND capture_kind = 'source_blob') AS capture_count,
          (SELECT current_evidence_sha256 FROM source_file_ledger WHERE source_id = ? AND origin_path = ?) AS current_evidence_sha256,
          (SELECT COUNT(*) FROM evidence_blobs WHERE sha256 IN (?, ?)) AS source_evidence_count
      `).get(
        sourceId,
        sourceId,
        sourceId,
        originPath,
        sha256(oldText),
        sha256(failedText),
      ) as {
        captured_blob_count: number;
        capture_count: number;
        current_evidence_sha256: string;
        source_evidence_count: number;
      };
      assert.deepEqual({ ...state }, {
        captured_blob_count: 2,
        capture_count: 2,
        current_evidence_sha256: sha256(oldText),
        source_evidence_count: 2,
      });
    } finally {
      db.close();
    }
    await access(path.join(storeDir, "evidence", "blobs", sha256(failedText).slice(0, 2), sha256(failedText)));
    storage.close();
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("a failed cross-file contributor protects the shared prior projection during sibling replacement", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-nonauthoritative-cross-file-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });
    const changedPath = path.join(sourceRoot, "changed.jsonl");
    const failedPath = path.join(sourceRoot, "failed.jsonl");
    const oldChangedText = "{\"shared\":\"old-changed\"}\n";
    const oldFailedText = "{\"shared\":\"old-failed\"}\n";
    const newChangedText = "{\"shared\":\"new-changed\"}\n";
    const failedText = "{\"shared\":\"captured-but-invalid\"";
    await writeFile(changedPath, oldChangedText, "utf8");
    await writeFile(failedPath, oldFailedText, "utf8");

    const sourceId = "srcinst-claude-nonauthoritative-cross-file";
    const sessionId = "session-nonauthoritative-cross-file";
    const oldChanged = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath: changedPath,
      text: oldChangedText,
      canonicalText: "old successful sibling turn",
      stageRunId: "stage-nonauthoritative-cross-file-old-changed",
      sessionId,
      turnId: "turn-nonauthoritative-cross-file-old-changed",
    });
    const oldFailed = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath: failedPath,
      text: oldFailedText,
      canonicalText: "old protected sibling turn",
      stageRunId: "stage-nonauthoritative-cross-file-old-failed",
      sessionId,
      turnId: "turn-nonauthoritative-cross-file-old-failed",
    });
    const initial = combineSourcePayloads(oldChanged, oldFailed);
    initial.sessions = [oldChanged.sessions[0]!];

    const storage = new CCHistoryStorage(storeDir);
    storage.replaceSourcePayload(initial);

    await writeFile(changedPath, newChangedText, "utf8");
    await writeFile(failedPath, failedText, "utf8");
    const newChanged = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath: changedPath,
      text: newChangedText,
      canonicalText: "new sibling must wait for a complete shared projection",
      stageRunId: "stage-nonauthoritative-cross-file-new-changed",
      sessionId,
      turnId: "turn-nonauthoritative-cross-file-new-changed",
    });
    const failed = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath: failedPath,
      text: failedText,
      canonicalText: "failed sibling must not replace the shared projection",
      stageRunId: "stage-nonauthoritative-cross-file-failed",
      sessionId,
      turnId: "turn-nonauthoritative-cross-file-failed",
    });
    failed.loss_audits = [{
      ...failed.loss_audits[0]!,
      stage_kind: "parse_source_fragments",
      diagnostic_code: "record_json_parse_failed",
      severity: "warning",
      blob_ref: failed.blobs[0]!.id,
    }];

    storage.mergeSourcePayloadByOriginPath(combineSourcePayloads(newChanged, failed), {
      observed_origin_paths: [changedPath, failedPath],
      refreshDerived: false,
    });

    assert.ok(storage.getSession(sessionId));
    assert.equal(storage.getTurn("turn-nonauthoritative-cross-file-old-changed")?.sync_axis, "current");
    assert.equal(storage.getTurn("turn-nonauthoritative-cross-file-old-failed")?.sync_axis, "current");
    assert.equal(storage.getTurn("turn-nonauthoritative-cross-file-new-changed"), undefined);
    assert.equal(storage.getTurn("turn-nonauthoritative-cross-file-failed"), undefined);
    assert.ok(
      storage.getTurnLineage("turn-nonauthoritative-cross-file-old-changed")?.blobs
        .some((blob) => blob.id === oldChanged.blobs[0]!.id),
      "the vetoed sibling turn keeps its original captured blob lineage",
    );
    const db = new DatabaseSync(path.join(storeDir, "cchistory.sqlite"));
    try {
      const retained = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM captured_blobs WHERE source_id = ? AND id = ?) AS blob_count,
          (SELECT COUNT(*) FROM raw_records WHERE source_id = ? AND blob_id = ?) AS record_count
      `).get(
        sourceId,
        oldChanged.blobs[0]!.id,
        sourceId,
        oldChanged.blobs[0]!.id,
      ) as { blob_count: number; record_count: number };
      assert.deepEqual({ ...retained }, { blob_count: 1, record_count: 1 });
    } finally {
      db.close();
    }
    storage.close();
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("streaming successful replacement retains superseded source evidence through forced GC", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-stream-replacement-evidence-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });
    const originPath = path.join(sourceRoot, "session.jsonl");
    const oldText = "{\"replacement\":\"old\"}\n";
    const newText = "{\"replacement\":\"new\"}\n";
    await writeFile(originPath, oldText, "utf8");

    const sourceId = "srcinst-codex-stream-replacement-evidence";
    const oldPayload = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath,
      text: oldText,
      canonicalText: "superseded streaming turn",
      stageRunId: "stage-stream-replacement-old",
      sessionId: "session-stream-replacement",
      turnId: "turn-stream-replacement-old",
    });
    const storage = new CCHistoryStorage({ dbPath });
    storage.replaceSourcePayload(oldPayload);

    const before = new DatabaseSync(dbPath);
    const oldEvidence = before.prepare(`
      SELECT ec.evidence_sha256, eb.storage_path
        FROM evidence_captures ec
        JOIN evidence_blobs eb ON eb.sha256 = ec.evidence_sha256
       WHERE ec.source_id = ? AND ec.blob_id = ?
    `).get(sourceId, oldPayload.blobs[0]!.id) as { evidence_sha256: string; storage_path: string };
    before.close();
    const oldEvidencePath = path.join(storeDir, oldEvidence.storage_path);

    await writeFile(originPath, newText, "utf8");
    const newPayload = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath,
      text: newText,
      canonicalText: "current streaming turn",
      stageRunId: "stage-stream-replacement-new",
      sessionId: "session-stream-replacement",
      turnId: "turn-stream-replacement-new",
    });
    await storage.mergeSourcePayloadStreaming(newPayload.source, {
      chunks: (async function* () {
        yield {
          origin_path: originPath,
          stage_runs: newPayload.stage_runs,
          loss_audits: newPayload.loss_audits,
          blobs: newPayload.blobs,
          records: newPayload.records,
          fragments: newPayload.fragments,
          atoms: newPayload.atoms,
          edges: newPayload.edges,
          candidates: newPayload.candidates,
          sessions: newPayload.sessions,
          turns: newPayload.turns,
          contexts: newPayload.contexts,
          ask_user_question_turns: newPayload.ask_user_question_turns,
        };
      })(),
      preserve_origin_paths: new Set(),
      observed_origin_paths: new Set([originPath]),
    });
    storage.pruneEvidenceBlobsNow();

    assert.equal(storage.getTurn("turn-stream-replacement-old"), undefined);
    assert.equal(storage.getTurn("turn-stream-replacement-new")?.sync_axis, "current");
    const after = new DatabaseSync(dbPath);
    try {
      const captures = after.prepare(`
        SELECT COUNT(*) AS count
          FROM evidence_captures
         WHERE source_id = ? AND capture_kind = 'source_blob'
      `).get(sourceId) as { count: number };
      assert.equal(captures.count, 2);
      const oldBlob = after.prepare(
        "SELECT COUNT(*) AS count FROM evidence_blobs WHERE sha256 = ?",
      ).get(oldEvidence.evidence_sha256) as { count: number };
      assert.equal(oldBlob.count, 1);
    } finally {
      after.close();
    }
    await access(oldEvidencePath);
    storage.close();
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

test("storage boundary v2 listUserTurnsFromV2 withLineage flag controls blob reads (C1)", async () => {
  // C1 regression: V2 list reads previously did N+1 SQL queries and N file
  // reads for lineage blobs (one per turn). List views that don't dereference
  // .lineage (UI session detail, project view) should be able to skip the
  // blob read entirely. The withLineage flag defaults to false for list
  // functions; the lineage_*_count columns stay readable from the row.
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-v2-lazy-lineage-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });
    const originPath = path.join(sourceRoot, "session.jsonl");
    const text = "{\"lazy\":true}\n";
    await writeFile(originPath, text, "utf8");

    const sourceId = "srcinst-codex-lazy-lineage";
    const storage = new CCHistoryStorage({ dbPath });
    const payload = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath,
      text,
      canonicalText: "lazy lineage asks",
      stageRunId: "stage-lazy",
      sessionId: "session-lazy",
      turnId: "turn-lazy",
    });
    storage.replaceSourcePayload(payload);
    storage.close();

    const bareDb = new DatabaseSync(dbPath);
    try {
      const { listUserTurnsFromV2, readUserTurnFromV2 } = await import("../internal/queries.js");
      const assetDir = storeDir;

      const withoutLineage = listUserTurnsFromV2({ db: bareDb, assetDir });
      assert.equal(withoutLineage.length, 1, "list returns the seeded turn");
      assert.equal(
        withoutLineage[0]!.lineage.atom_refs.length,
        0,
        "withLineage default (false) returns empty atom_refs — blob not read",
      );
      assert.equal(
        withoutLineage[0]!.lineage.blob_refs.length,
        0,
        "withLineage default (false) returns empty blob_refs — blob not read",
      );

      const withLineage = listUserTurnsFromV2({ db: bareDb, assetDir, withLineage: true });
      assert.equal(withLineage.length, 1);
      assert.ok(
        withLineage[0]!.lineage.atom_refs.length > 0,
        "withLineage:true reads the blob and populates atom_refs",
      );

      const single = readUserTurnFromV2({ db: bareDb, turnId: "turn-lazy", assetDir });
      assert.ok(single, "single-turn read returns the projection");
      assert.ok(
        single!.lineage.atom_refs.length > 0,
        "single-turn read defaults to withLineage:true (preserves detail-view behavior)",
      );

      const singleWithoutLineage = readUserTurnFromV2({
        db: bareDb,
        turnId: "turn-lazy",
        assetDir,
        withLineage: false,
      });
      assert.equal(
        singleWithoutLineage!.lineage.atom_refs.length,
        0,
        "single-turn read with withLineage:false skips the blob",
      );
    } finally {
      bareDb.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("storage boundary v2 pruneOrphanEvidence preserves lineage blobs still referenced from user_turns_v2.lineage_blob_sha256", async () => {
  // Regression: pruneUnreferencedEvidenceBlobsInTransaction originally listed
  // only five ref sources. B.5.0g added a sixth (user_turns_v2.lineage_blob_sha256)
  // and lineage blobs have no evidence_captures row, so the maintenance prune
  // path treated them as orphaned and dropped them while user_turns_v2 still
  // pointed at them. On the operator store every lineage-only blob would have
  // been silently pruned on the next GC pass.
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-prune-lineage-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });

    const sourceId = "srcinst-codex-prune-lineage";
    const originPath = path.join(sourceRoot, "session.jsonl");
    const firstLine = "{\"fixture\":true}\n";
    await writeFile(originPath, firstLine, "utf8");

    const storage = new CCHistoryStorage({ dbPath });
    const payload = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath,
      text: firstLine,
      canonicalText: "prune lineage asks",
      stageRunId: "stage-prune",
      sessionId: "session-prune",
      turnId: "turn-prune",
    });
    storage.replaceSourcePayload(payload);
    storage.close();

    const inspectDb = new DatabaseSync(dbPath);
    try {
      const lineageOnly = inspectDb.prepare(
        `SELECT COUNT(*) AS count FROM evidence_blobs eb
         WHERE eb.sha256 IN (SELECT DISTINCT lineage_blob_sha256 FROM user_turns_v2 WHERE lineage_blob_sha256 <> '')
         AND NOT EXISTS (SELECT 1 FROM evidence_captures ec WHERE ec.evidence_sha256 = eb.sha256)
         AND NOT EXISTS (SELECT 1 FROM parsed_record_spans prs WHERE prs.evidence_sha256 = eb.sha256)
         AND NOT EXISTS (SELECT 1 FROM source_file_ledger sfl WHERE sfl.current_evidence_sha256 = eb.sha256)
         AND NOT EXISTS (SELECT 1 FROM turn_context_refs_v2 tcr WHERE tcr.context_evidence_sha256 = eb.sha256)
         AND NOT EXISTS (SELECT 1 FROM derived_cache_refs dcr WHERE dcr.evidence_sha256 = eb.sha256)`,
      ).get() as { count: number };
      assert.equal(
        lineageOnly.count,
        1,
        "fixture should produce exactly one lineage-only blob referenced solely via user_turns_v2.lineage_blob_sha256",
      );
    } finally {
      inspectDb.close();
    }

    const pruner = new CCHistoryStorage({ dbPath });
    const result = pruner.pruneOrphanEvidence();
    pruner.close();

    assert.equal(
      result.pruned_count,
      0,
      "lineage blobs still referenced from user_turns_v2.lineage_blob_sha256 must survive prune",
    );

    const verifyDb = new DatabaseSync(dbPath);
    try {
      const dangling = verifyDb.prepare(
        `SELECT COUNT(*) AS count FROM user_turns_v2 utv
         WHERE utv.lineage_blob_sha256 <> ''
         AND NOT EXISTS (SELECT 1 FROM evidence_blobs eb WHERE eb.sha256 = utv.lineage_blob_sha256)`,
      ).get() as { count: number };
      assert.equal(
        dangling.count,
        0,
        "no user_turns_v2.lineage_blob_sha256 should be left dangling after prune",
      );
    } finally {
      verifyDb.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("storage boundary v2 retireStorageBoundaryV2Sources preserves lineage blobs of NON-retired sources", async () => {
  // Regression (mirror of the pruneOrphanEvidence test, but for the second of
  // the two ref-inventory sites). retireStorageBoundaryV2Sources runs when a
  // source is dropped during replaceSourcePayload. It deletes V2 rows for the
  // retired source ids and then runs the same 6-source orphan prune. Before
  // the B.5.0g fix, the prune query listed only five ref sources, so a lineage
  // blob belonging to a NON-retired source (no evidence_captures row, only
  // referenced via user_turns_v2.lineage_blob_sha256) would have been pruned
  // as a side effect of retiring an unrelated source. That is the more
  // dangerous of the two leak sites because it crosses source boundaries.
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-retire-lineage-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });

    const survivingSourceId = "srcinst-codex-retire-keep";
    const retiredSourceId = "srcinst-codex-retire-drop";
    const survivingOrigin = path.join(sourceRoot, "keep-session.jsonl");
    const retiredOrigin = path.join(sourceRoot, "drop-session.jsonl");
    const survivingText = "{\"keep\":true}\n";
    const retiredText = "{\"drop\":true}\n";
    await writeFile(survivingOrigin, survivingText, "utf8");
    await writeFile(retiredOrigin, retiredText, "utf8");

    const survivingPayload = createPayloadForSourceFile({
      sourceId: survivingSourceId,
      sourceRoot,
      originPath: survivingOrigin,
      text: survivingText,
      canonicalText: "retire keeps this lineage",
      stageRunId: "stage-keep",
      sessionId: "session-keep",
      turnId: "turn-keep",
    });
    const retiredPayload = createPayloadForSourceFile({
      sourceId: retiredSourceId,
      sourceRoot,
      originPath: retiredOrigin,
      text: retiredText,
      canonicalText: "retire drops this lineage",
      stageRunId: "stage-drop",
      sessionId: "session-drop",
      turnId: "turn-drop",
    });

    const seedStorage = new CCHistoryStorage({ dbPath });
    seedStorage.replaceSourcePayload(survivingPayload);
    seedStorage.mergeSourcePayloadByOriginPath(retiredPayload);
    seedStorage.close();

    const afterSeedDb = new DatabaseSync(dbPath);
    let survivingLineageSha = "";
    let retiredLineageSha = "";
    let retiredEvidenceSha = "";
    try {
      const survivingRow = afterSeedDb
        .prepare("SELECT lineage_blob_sha256 AS sha FROM user_turns_v2 WHERE turn_id = ?")
        .get("turn-keep") as { sha: string } | undefined;
      const retiredRow = afterSeedDb
        .prepare("SELECT lineage_blob_sha256 AS sha FROM user_turns_v2 WHERE turn_id = ?")
        .get("turn-drop") as { sha: string } | undefined;
      assert.ok(survivingRow?.sha, "surviving source must have a lineage blob before retire");
      assert.ok(retiredRow?.sha, "retired source must have a lineage blob before retire");
      assert.notEqual(survivingRow!.sha, retiredRow!.sha, "the two sources should have distinct lineage blobs");
      survivingLineageSha = survivingRow!.sha;
      retiredLineageSha = retiredRow!.sha;
      const retiredLedger = afterSeedDb
        .prepare("SELECT current_evidence_sha256 AS sha FROM source_file_ledger WHERE source_id = ?")
        .get(retiredSourceId) as { sha: string } | undefined;
      assert.ok(retiredLedger?.sha, "retired source must have source evidence before retire");
      retiredEvidenceSha = retiredLedger!.sha;
    } finally {
      afterSeedDb.close();
    }

    // Simulate the storage-facade flow when retiredSourceId is dropped during
    // a replace. retireStorageBoundaryV2Sources opens its own transaction and
    // deletes V2 rows for the retired source ids before running the prune.
    const retireDb = new DatabaseSync(dbPath);
    try {
      const retirement = retireStorageBoundaryV2Sources({
        db: retireDb,
        sourceIds: [retiredSourceId],
      });
      assert.ok(
        retirement.pruned_evidence_shas.includes(retiredLineageSha),
        "retired source's lineage blob should be in the pruned set",
      );
      assert.ok(
        !retirement.pruned_evidence_shas.includes(survivingLineageSha),
        "surviving source's lineage blob must NOT be pruned (cross-source leak regression)",
      );
    } finally {
      retireDb.close();
    }

    const afterRetireDb = new DatabaseSync(dbPath);
    try {
      const survivingBlob = afterRetireDb
        .prepare("SELECT COUNT(*) AS count FROM evidence_blobs WHERE sha256 = ?")
        .get(survivingLineageSha) as { count: number };
      assert.equal(
        survivingBlob.count,
        1,
        "lineage blob of a non-retired source must survive retireStorageBoundaryV2Sources",
      );
      const retiredBlob = afterRetireDb
        .prepare("SELECT COUNT(*) AS count FROM evidence_blobs WHERE sha256 = ?")
        .get(retiredLineageSha) as { count: number };
      assert.equal(
        retiredBlob.count,
        0,
        "lineage blob of the retired source should be pruned after its user_turns_v2 rows are gone",
      );
      const retiredEvidenceBlob = afterRetireDb
        .prepare("SELECT COUNT(*) AS count FROM evidence_blobs WHERE sha256 = ?")
        .get(retiredEvidenceSha) as { count: number };
      assert.equal(
        retiredEvidenceBlob.count,
        0,
        "source_absent ledger rows must not pin retired source evidence blobs",
      );
      const absentLedger = afterRetireDb
        .prepare(
          `SELECT sync_axis, current_evidence_sha256
             FROM source_file_ledger
            WHERE source_id = ?`,
        )
        .get(retiredSourceId) as { sync_axis: string; current_evidence_sha256: string } | undefined;
      assert.equal(absentLedger?.sync_axis, "source_absent", "retired ledger row remains as audit trail");
      assert.equal(absentLedger?.current_evidence_sha256, retiredEvidenceSha);
      const dangling = afterRetireDb
        .prepare(
          `SELECT COUNT(*) AS count FROM user_turns_v2 utv
           WHERE utv.lineage_blob_sha256 <> ''
           AND NOT EXISTS (SELECT 1 FROM evidence_blobs eb WHERE eb.sha256 = utv.lineage_blob_sha256)`,
        )
        .get() as { count: number };
      assert.equal(dangling.count, 0, "no user_turns_v2.lineage_blob_sha256 should be left dangling after retire");
    } finally {
      afterRetireDb.close();
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

function retargetPayloadSession(
  payload: SourceSyncPayload,
  sessionId: string,
  options: { omitSession?: boolean } = {},
): SourceSyncPayload {
  for (const record of payload.records) record.session_ref = sessionId;
  for (const fragment of payload.fragments) fragment.session_ref = sessionId;
  for (const atom of payload.atoms) atom.session_ref = sessionId;
  for (const edge of payload.edges) edge.session_ref = sessionId;
  for (const candidate of payload.candidates) candidate.session_ref = sessionId;
  for (const turn of payload.turns) turn.session_id = sessionId;
  for (const turn of payload.ask_user_question_turns) turn.session_id = sessionId;
  if (options.omitSession) {
    payload.sessions = [];
  } else {
    for (const session of payload.sessions) session.id = sessionId;
  }
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
    ask_user_question_turns: [...left.ask_user_question_turns, ...right.ask_user_question_turns],
  };
}

function sha1(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// C1 regression: streamSourcePayloadJson must produce the same per-field JSON
// arrays as the in-memory buildSourcePayload path, because both are now V2-
// backed and feed the same external consumers (bundle export, payload
// checksums). Before the C1 fix, streamSourcePayloadJson still iterated V1
// user_turns/turn_contexts payload_json, so the two paths silently diverged
// on display_segments reconstruction, lineage blob resolution, and context
// cache reads. The B.4a bundle byte-diff gate at the operator-store level
// could not catch this because both pre- and post-cutover bundles were V1.
//
// This test ingests a payload with one turn that exercises: short canonical
// text, multi-message shape (via fixture), large tool output (over the
// context inline budget), non-empty lineage (forces blob read). It then
// snapshots each top-level array from getSourcePayload (V2 in-memory path)
// and from streamSourcePayloadJson (V2 streaming path) and asserts the two
// snapshots agree byte-for-byte per array element.
test("storage boundary v2 streamSourcePayloadJson matches buildSourcePayload per-array output (C1)", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-v2-stream-parity-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });
    const originPath = path.join(sourceRoot, "session.jsonl");
    const text = "{\"stream\":true}\n";
    await writeFile(originPath, text, "utf8");

    const sourceId = "srcinst-codex-stream-parity";
    const storage = new CCHistoryStorage({ dbPath });
    const payload = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath,
      text,
      canonicalText: "stream parity asks",
      stageRunId: "stage-stream",
      sessionId: "session-stream",
      turnId: "turn-stream",
    });
    // Force the context to exceed the inline budget so the V2 path must read
    // from the content-addressed cache, not from any inline column.
    payload.contexts[0]!.tool_calls[0]!.output = "large tool output ".repeat(1600);
    storage.replaceSourcePayload(payload);

    // In-memory V2 path (B.5.5 cutover).
    const inMemory = storage.getSourcePayload(sourceId);
    assert.ok(inMemory, "getSourcePayload returns the seeded payload");

    // Streaming V2 path (C1 cutover). Collect into a single string then
    // parse back so we can compare per-array element rather than relying on
    // undocumented top-level key order from JSON.stringify of an object.
    const chunks: string[] = [];
    const counts = storage.streamSourcePayloadJson(sourceId, (chunk) => chunks.push(chunk));
    assert.ok(counts, "streamSourcePayloadJson returns counts");
    const streamed = JSON.parse(chunks.join("")) as SourceSyncPayload;

    // The two paths must agree on every array element. We compare per element
    // rather than via deep-equal on the whole payload so a failure points at
    // the exact diverging field. Use deep-equal per element to ignore
    // key-ordering differences in nested objects.
    const arrayKeys: Array<keyof SourceSyncPayload> = [
      "stage_runs",
      "loss_audits",
      "blobs",
      "records",
      "fragments",
      "atoms",
      "edges",
      "candidates",
      "sessions",
      "turns",
      "contexts",
    ];
    for (const key of arrayKeys) {
      const fromInMemory = inMemory![key] as readonly unknown[];
      const fromStreamed = streamed[key] as readonly unknown[];
      assert.equal(
        fromStreamed.length,
        fromInMemory.length,
        `streamSourcePayloadJson ${key} count matches buildSourcePayload`,
      );
      // Compare via JSON.stringify, not deepEqual, because the bundle surface
      // IS the JSON form and that's what both paths feed into. JSON.stringify
      // drops undefined-valued keys; deepEqual does not. The two paths agree
      // on the bundle bytes iff their JSON serializations agree per element.
      for (let i = 0; i < fromInMemory.length; i++) {
        assert.equal(
          JSON.stringify(fromStreamed[i]),
          JSON.stringify(fromInMemory[i]),
          `streamSourcePayloadJson ${key}[${i}] JSON matches buildSourcePayload JSON`,
        );
      }
    }

    // C1 specifically: turns and contexts must round-trip through V2 reads
    // with lineage fully populated. Confirm the streamed turns array carries
    // non-empty lineage atom_refs (the blob was actually read on the stream
    // path, not silently dropped).
    const streamedTurn = streamed.turns[0] as UserTurnProjection | undefined;
    assert.ok(streamedTurn, "stream produced at least one turn");
    assert.ok(
      streamedTurn!.lineage.atom_refs.length > 0,
      "streamed turn lineage.atom_refs is populated — the lineage blob was read on the V2 stream path",
    );
    assert.ok(
      streamedTurn!.canonical_text.length > 0,
      "streamed turn canonical_text is non-empty",
    );

    const streamedContext = streamed.contexts[0] as
      | { tool_calls?: Array<{ output?: string }> }
      | undefined;
    assert.ok(streamedContext, "stream produced at least one context");
    assert.equal(
      streamedContext!.tool_calls?.[0]?.output,
      payload.contexts[0]!.tool_calls[0]!.output,
      "streamed context tool_calls[0].output matches the ingested payload — V2 cache read works on the stream path",
    );

    storage.close();
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("storage boundary v2 shrinkJsonToBudget keeps a single-oversized-element array via element shrink (I8)", () => {
  // Regression: shrinkJsonToBudget's array branch binary-searched for the
  // largest prefix that fit. When even one element exceeded maxBytes, lo
  // stayed at 0 and the function returned [] — silent total loss of the
  // field, same shape as the H5 bug for single-string object values.
  // display_segments (the kind of array most likely to contain one giant
  // paste) was the field most at risk.
  //
  // Fix: when lo===0, fall back to shrinking the first element so the field
  // survives with truncated content rather than vanishing.

  // Sanity: arrays that fit are unchanged.
  assert.deepEqual(shrinkJsonToBudget([], 1024), []);
  assert.deepEqual(shrinkJsonToBudget([1, 2, 3], 1024), [1, 2, 3]);

  // Large array shrinks to the largest prefix that fits.
  const prefixable = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
  const shrunk = shrinkJsonToBudget(prefixable, 16) as unknown[];
  assert.ok(shrunk.length > 0, "prefix shrink produces at least one element");
  assert.ok(shrunk.length < prefixable.length, "prefix shrink drops the tail");
  assert.ok(
    JSON.stringify(shrunk).length <= 16,
    "shrunk array fits the budget",
  );

  // I8: single element that alone exceeds maxBytes. Previously returned [].
  const hugeString = "X".repeat(64);
  const singleOversized = [hugeString];
  const recovered = shrinkJsonToBudget(singleOversized, 32) as unknown[];
  assert.equal(recovered.length, 1, "single-element array survives (not [])");
  assert.equal(typeof recovered[0], "string", "element type preserved");
  assert.ok(
    (recovered[0] as string).length < hugeString.length,
    "element content is truncated to fit",
  );
  assert.ok(
    (recovered[0] as string).length > 0,
    "element content is non-empty (not silent total loss)",
  );
  assert.ok(
    JSON.stringify(recovered).length <= 32,
    "recovered array fits the budget",
  );

  // Pathological: budget smaller than the array brackets themselves.
  // Element shrinks to whatever fits; if even an empty string array
  // exceeds the budget, [] is correct.
  const tiny = shrinkJsonToBudget([hugeString], 1) as unknown[];
  assert.ok(Array.isArray(tiny), "tiny budget still returns an array");
});

// Source inventory reconciliation is lifecycle-only. An upstream file that
// disappears becomes source_absent; its V2 turn and context remain available
// for explicit lifecycle recall and future parser rebuilds.
test("storage boundary v2 pruneSourcePayloadByObservedOriginPaths retains source-absent V2 projections", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-c3-prune-v2-mirror-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });
    const originPath = path.join(sourceRoot, "session.jsonl");
    const text = "{\"c3\":true}\n";
    await writeFile(originPath, text, "utf8");

    const sourceId = "srcinst-codex-c3-prune";
    const storage = new CCHistoryStorage({ dbPath });
    const payload = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath,
      text,
      canonicalText: "c3 prune asks",
      stageRunId: "stage-c3",
      sessionId: "session-c3",
      turnId: "turn-c3",
    });
    storage.replaceSourcePayload(payload);

    // Sanity: V2 sidecar rows exist before the prune.
    const db = new DatabaseSync(dbPath);
    try {
      const beforeTurn = db.prepare("SELECT COUNT(*) AS count FROM user_turns_v2 WHERE source_id = ?").get(sourceId) as {
        count: number;
      };
      const beforeContext = db.prepare(
        "SELECT COUNT(*) AS count FROM turn_context_refs_v2 WHERE source_id = ?",
      ).get(sourceId) as { count: number };
      assert.equal(beforeTurn.count, 1, "V2 turn sidecar exists before prune");
      assert.equal(beforeContext.count, 1, "V2 context sidecar exists before prune");
    } finally {
      db.close();
    }

    // Empty complete observed list → all sessions become source_absent.
    storage.pruneSourcePayloadByObservedOriginPaths(sourceId, []);

    const dbAfter = new DatabaseSync(dbPath);
    try {
      const afterTurn = dbAfter.prepare(
        "SELECT COUNT(*) AS count, MIN(sync_axis) AS sync_axis FROM user_turns_v2 WHERE source_id = ?",
      ).get(sourceId) as { count: number; sync_axis: string };
      const afterContext = dbAfter
        .prepare("SELECT COUNT(*) AS count FROM turn_context_refs_v2 WHERE source_id = ?")
        .get(sourceId) as { count: number };
      assert.equal(afterTurn.count, 1, "V2 turn sidecar is retained when its source file disappears");
      assert.equal(afterTurn.sync_axis, "source_absent");
      assert.equal(afterContext.count, 1, "V2 context sidecar is retained when its source file disappears");
    } finally {
      dbAfter.close();
    }

    storage.close();
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

// B.6 will drop V1 user_turns / turn_contexts entirely. The B1–B4 fixes above
// switch the affected read paths to V2 so they keep working post-B.6. These
// regression tests simulate B.6 (drop the V1 tables after populating both V1
// and V2) and exercise each fixed path to confirm it no longer silently
// no-ops or returns zero rows.

test("B1 post-B.6 regression: selectOrphanedBlobIds is a pure set-difference (no V1 read)", () => {
  // B1 moved selectOrphanedBlobIds from "read V1 json_each over lineage.blob_refs"
  // to a pure set-difference against a caller-supplied referenced set. The
  // caller now reads V2 lineage blobs (loadReferencedBlobIdsBySource). This
  // test fixes the function's contract so a future refactor that re-introduces
  // a V1 read inside gc.ts would fail loudly here.
  assert.deepEqual(selectOrphanedBlobIds([], new Set()), []);
  assert.deepEqual(selectOrphanedBlobIds(["a", "b"], new Set(["a", "b"])), []);
  assert.deepEqual(
    selectOrphanedBlobIds(["a", "b", "c", "d"], new Set(["b", "d"])),
    ["a", "c"],
  );
  // Dedupes + preserves candidate order minus referenced.
  assert.deepEqual(
    selectOrphanedBlobIds(["a", "a", "b", "c"], new Set(["b"])),
    ["a", "c"],
  );
});

test("B2 post-B.6 regression: rewriteStoredTurn archives via V2 (no V1 fallback needed)", async () => {
  // B.6 removed the V1 user_turns table entirely. rewriteStoredTurn now reads
  // V2 as the source of truth and writes the archive mutation back to V2.
  // garbageCollectCandidateTurns({mode:"archive"}) exercises rewriteStoredTurn;
  // pre-B2 every archive would silently no-op when the V1 row was absent.
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-b2-post-b6-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });

    const sourceId = "srcinst-codex-b2-post-b6";
    const originPath = path.join(sourceRoot, "session.jsonl");
    const text = "{\"fixture\":true}\n";
    await writeFile(originPath, text, "utf8");

    const storage = new CCHistoryStorage({ dbPath });
    const payload = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath,
      text,
      canonicalText: "b2 post-b6 asks",
      stageRunId: "stage-b2",
      sessionId: "session-b2",
      turnId: "turn-b2",
    });
    storage.replaceSourcePayload(payload);

    // Force the turn into candidate state so archive GC will pick it up.
    // B.6: no V1 mutation — only V2 sidecars exist.
    const db = new DatabaseSync(dbPath);
    try {
      db.prepare("UPDATE user_turns_v2 SET link_state = 'candidate'").run();
    } finally {
      db.close();
    }

    const before = new DatabaseSync(dbPath);
    try {
      const row = before.prepare("SELECT value_axis FROM user_turns_v2 WHERE turn_id = ?").get("turn-b2") as {
        value_axis: string;
      };
      assert.notEqual(row.value_axis, "archived", "precondition: V2 row is not yet archived");
    } finally {
      before.close();
    }

    // Archive the candidate. Pre-B2 this would silently no-op because the V1
    // row was gone and rewriteStoredTurn returned undefined early. Post-B.6
    // the V2 read is the only path.
    storage.garbageCollectCandidateTurns({ before_iso: "9999-01-01T00:00:00.000Z", mode: "archive" });

    const after = new DatabaseSync(dbPath);
    try {
      const row = after.prepare("SELECT value_axis, retention_axis FROM user_turns_v2 WHERE turn_id = ?").get("turn-b2") as {
        value_axis: string;
        retention_axis: string;
      };
      assert.equal(row.value_axis, "archived", "B2: V2 row was archived via V2 read");
      assert.equal(row.retention_axis, "keep_raw_only");
    } finally {
      after.close();
    }

    storage.close();
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("B3+B4 post-B.6 regression: source counts stay correct via V2 (no V1 row to drop)", async () => {
  // B3: refreshSourceStatusCountsInTransaction read V1 user_turns for total_turns
  // — post-B.6 it would return 0. Now reads V2.
  // B4: countStoredSourcePayload (called inside merge/replace) had the same V1
  // dependency plus an ordering gap — V2 sidecars are written AFTER the count
  // runs. B4 fixed both: V2 source for the count, plus a post-sidecar recount.
  // B.6: V1 user_turns no longer exists at all, so the "drop V1" step from
  // the pre-B.6 version of this test is now a no-op. The rest of the test
  // still exercises both fixes: run a merge, verify the returned count AND
  // source_instances.total_turns both equal the live turn count.
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-b3-b4-post-b6-"));
  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    const sourceRoot = path.join(tempRoot, "source");
    await mkdir(sourceRoot, { recursive: true });

    const sourceId = "srcinst-codex-b3-b4";
    const keepPath = path.join(sourceRoot, "keep.jsonl");
    const newPath = path.join(sourceRoot, "new.jsonl");
    const keepText = "{\"k\":1}\n";
    const newText = "{\"n\":1}\n";
    await writeFile(keepPath, keepText, "utf8");

    const storage = new CCHistoryStorage({ dbPath });
    const keep = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath: keepPath,
      text: keepText,
      canonicalText: "keep asks",
      stageRunId: "stage-keep",
      sessionId: "session-keep",
      turnId: "turn-keep",
    });
    storage.replaceSourcePayload(keep);
    const initialTotalTurns = storage.listSources()[0]!.total_turns;
    assert.equal(initialTotalTurns, 1, "precondition: V2 sidecars written for the keep turn");

    await writeFile(newPath, newText, "utf8");
    const incoming = createPayloadForSourceFile({
      sourceId,
      sourceRoot,
      originPath: newPath,
      text: newText,
      canonicalText: "new asks",
      stageRunId: "stage-new",
      sessionId: "session-new",
      turnId: "turn-new",
    });
    const counts = storage.mergeSourcePayloadByOriginPath(incoming, {
      preserve_origin_paths: [keepPath],
      observed_origin_paths: [keepPath, newPath],
    });

    // B4: returned counts.turns reflects the post-sidecar V2 state — keep turn
    // (preserved) + new turn (just written). Pre-B4 this returned 0 because the
    // count ran before writeStorageBoundaryV2Sidecars wrote the new V2 row.
    assert.equal(counts.turns, 2, "B4: merge returns V2-backed turn count");

    // B3: source_instances.total_turns was refreshed from V2 after the merge.
    // Pre-B3 refreshSourceStatusCountsInTransaction would have read V1 (now
    // always empty post-B.6) and stored 0.
    assert.equal(storage.listSources()[0]!.total_turns, 2, "B3: source_instances.total_turns read from V2");

    storage.close();
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
