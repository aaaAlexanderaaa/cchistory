import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { TurnContextProjection, UserTurnProjection } from "@cchistory/domain";
import {
  readMigrationState,
  recordMigrationAbort,
  recordMigrationComplete,
  recordMigrationStart,
  type MigrationScope,
} from "./migration-state.js";
import {
  readStorageBoundaryMigrationPreview,
  type StorageBoundaryMigrationPreview,
} from "./migration-preview.js";
import { readTurnContextFromV2Cache } from "./evidence-store.js";
import * as Queries from "./internal/queries.js";

/**
 * B.4: post-B.3 validation. Three independent read-only validators prove the
 * V2 sidecars B.3 wrote are equivalent to the V1 payloads they replace:
 *
 *   (a) bundle byte-diff — re-export the current store, diff checksums
 *       against a pre-migration bundle the operator captured BEFORE B.3.
 *   (b) inventory diff — every V1↔V2 row pair has matching counts.
 *   (c) read-path parity — getTurnContext returns the same projection
 *       whether read from V1 or the V2 cache, across all turns.
 *
 * Each validator runs independently and writes its own marker row under
 * phase=storage-boundary.validate, scopeKind=store, scope_id per validator.
 * A failure in one does not block the others — operators want the full
 * picture in one run to triage. exit_code is non-zero iff any selected
 * validator reports mismatches.
 */

const PHASE = "storage-boundary.validate" as const;

export type MigrationValidatorKind = "bundle" | "inventory" | "read-paths" | "v1-payload-digest";

const SCOPE_IDS: Record<MigrationValidatorKind, string> = {
  bundle: "bundle-byte-diff",
  inventory: "inventory-diff",
  "read-paths": "read-path-parity",
  "v1-payload-digest": "v1-payload-digest",
};
const DEFAULT_VALIDATORS: readonly MigrationValidatorKind[] = ["bundle", "inventory", "read-paths", "v1-payload-digest"];

/**
 * C6: V1 tables whose payload_json byteset is hashed by the
 * v1-payload-digest validator. These are the tables B.6a will eventually
 * DROP COLUMN on (or drop entirely). The validator captures a sha256 per
 * table at first run (sticky baseline stored in migration_state.cursor_json)
 * and compares every subsequent run to that baseline. Drift indicates V1
 * state changed after B.3 — which is silent data movement B.6a would
 * propagate into permanent loss. The bundle byte-diff validator used to
 * catch this implicitly (V1 bundle bytes included payload_json); after the
 * C1 cutover the bundle path reads V2, so this dedicated validator is the
 * replacement coverage.
 *
 * All tables have a single-column PRIMARY KEY; turn_contexts uses turn_id,
 * the rest use id.
 */
const V1_PAYLOAD_TABLES: ReadonlyArray<{ table: string; keyColumn: string }> = [
  { table: "source_instances", keyColumn: "id" },
  { table: "stage_runs", keyColumn: "id" },
  { table: "loss_audits", keyColumn: "id" },
  { table: "captured_blobs", keyColumn: "id" },
  { table: "raw_records", keyColumn: "id" },
  { table: "source_fragments", keyColumn: "id" },
  { table: "conversation_atoms", keyColumn: "id" },
  { table: "atom_edges", keyColumn: "id" },
  { table: "derived_candidates", keyColumn: "id" },
  { table: "sessions", keyColumn: "id" },
  { table: "user_turns", keyColumn: "id" },
  { table: "turn_contexts", keyColumn: "turn_id" },
];

const MISMATCH_CAP = 10;

export interface BundleChecksumCompare {
  payload_sha256_by_source_id: Record<string, string>;
  raw_sha256_by_path: Record<string, string>;
  manifest_stable: {
    bundle_version?: string;
    schema_version?: string;
    source_instance_ids?: string[];
    includes_raw_blobs?: boolean;
    counts?: { sources: number; sessions: number; turns: number; blobs: number };
  };
}

export interface MigrationValidateInput {
  dbPath: string;
  assetDir?: string;
  only?: readonly MigrationValidatorKind[];
  preBundleChecksums?: BundleChecksumCompare;
  postBundleChecksums?: BundleChecksumCompare;
  onProgress?: (event: MigrationValidateProgressEvent) => void;
}

export interface BundleByteDiffResult {
  status: "pass" | "fail";
  payload_mismatches: Array<{ source_id: string; pre?: string; post?: string }>;
  raw_mismatches: Array<{ path: string; pre?: string; post?: string }>;
  manifest_field_mismatches: Array<{ field: string; pre: unknown; post: unknown }>;
}

export interface InventoryDiffResult {
  status: "pass" | "fail";
  mapping: StorageBoundaryMigrationPreview["v1_to_v2_mapping"];
  failing_pairs: Array<{ name: string; v1_rows: number; v2_rows: number; missing: number }>;
}

export interface ReadPathParityResult {
  status: "pass" | "fail";
  /**
   * B.6: true when the V1 reference tables are missing (post-compact store).
   * The parity check has nothing to compare against in this state, so it
   * returns a synthetic PASS with `turns_checked: 0`. Operators see the flag
   * in CLI output and know the validator is no longer load-bearing.
   */
  post_b6_skipped?: boolean;
  turns_checked: number;
  mismatches: Array<{
    turn_id: string;
    reason: "v2_missing" | "v1_missing" | "diff";
    detail?: string;
  }>;
  mismatch_count: number;
  /**
   * B.5.0d: UserTurnProjection parity. Tracks whether the V2 full-content
   * columns round-trip the entire projection the read paths consume. When
   * this fails, B.5.1-5 cutovers cannot proceed.
   */
  user_turn: {
    turns_checked: number;
    mismatches: Array<{
      turn_id: string;
      reason: "v2_missing" | "v1_missing" | "diff";
      detail?: string;
    }>;
    mismatch_count: number;
  };
}

/**
 * C6: per-table sha256 of V1 payload_json bytesets, compared against a
 * sticky baseline captured at first validator run. Drift indicates V1
 * state changed after B.3 — the exact silent data movement B.6a (DROP
 * COLUMN) would propagate into permanent loss.
 */
export interface V1PayloadDigestResult {
  status: "pass" | "fail";
  /**
   * True when this run captured a fresh baseline (no prior completed marker
   * existed). Subsequent runs compare against this baseline; the operator
   * must `migration reset --phase storage-boundary.validate` to refresh it
   * after intentionally modifying V1.
   */
  baseline_captured: boolean;
  /**
   * Per-table row counts at this run. Cheap signal for "did anything move
   * at all" without re-hashing.
   */
  row_counts: Record<string, number>;
  /**
   * Per-table sha256 of payload_json values, ordered by primary key. The
   * baseline run stores this in migration_state.cursor_json; subsequent
   * runs compare to it. B.6: null for tables dropped by `migration compact`
   * (user_turns, turn_contexts) — current state, not drift.
   */
  digests: Record<string, string | null>;
  /**
   * Per-table mismatches against the baseline. Empty when status=pass.
   * Capped at MISMATCH_CAP entries.
   */
  mismatches: Array<{ table: string; baseline?: string; current: string }>;
  mismatch_count: number;
}

export interface MigrationValidatorOutcome {
  validator: MigrationValidatorKind;
  status: "pass" | "fail" | "aborted";
  error?: string;
  bundle?: BundleByteDiffResult;
  inventory?: InventoryDiffResult;
  read_paths?: ReadPathParityResult;
  v1_payload_digest?: V1PayloadDigestResult;
}

export interface MigrationValidateResult {
  db_path: string;
  ran: MigrationValidatorKind[];
  outcomes: MigrationValidatorOutcome[];
  exit_code: number;
}

export interface MigrationValidateProgressEvent {
  kind: "validator_start" | "validator_pass" | "validator_fail" | "validator_abort";
  validator: MigrationValidatorKind;
  error?: string;
}

export async function runMigrationValidate(input: MigrationValidateInput): Promise<MigrationValidateResult> {
  const db = new DatabaseSync(input.dbPath);
  const selected = input.only && input.only.length > 0 ? input.only : DEFAULT_VALIDATORS;
  const outcomes: MigrationValidatorOutcome[] = [];
  let anyFail = false;

  try {
    for (const validator of selected) {
      const scope: MigrationScope = {
        phase: PHASE,
        scopeKind: "store",
        scopeId: SCOPE_IDS[validator],
      };
      input.onProgress?.({ kind: "validator_start", validator });

      let started = false;
      try {
        recordMigrationStart(db, scope);
        started = true;
        let outcome: MigrationValidatorOutcome;
        // C6: v1-payload-digest carries a sticky baseline in cursor_json.
        // Only this validator needs to write a cursor back, so the
        // complete-call cursor is threaded through `completeCursorJson`.
        let completeCursorJson: string | undefined;
        if (validator === "bundle") {
          if (!input.preBundleChecksums || !input.postBundleChecksums) {
            throw new Error(
              "bundle validator requires pre-bundle and post-bundle checksums; the CLI layer must supply both",
            );
          }
          const result = runBundleByteDiff(input.preBundleChecksums, input.postBundleChecksums);
          outcome = { validator, status: result.status, bundle: result };
        } else if (validator === "inventory") {
          const result = await runInventoryDiff(input.dbPath);
          outcome = { validator, status: result.status, inventory: result };
        } else if (validator === "v1-payload-digest") {
          // recordMigrationStart preserves cursor_json from the previous row.
          // Key off cursor_json content, NOT status: start just flipped status
          // from 'completed' to 'running', so a status check would always see
          // 'running' here and re-capture the baseline every time.
          const existing = readMigrationState(db, scope);
          const baseline = existing?.cursor_json && existing.cursor_json !== "{}"
            ? parseV1DigestBaseline(existing.cursor_json)
            : null;
          const result = runV1PayloadDigestCheck(input.dbPath, baseline);
          outcome = { validator, status: result.status, v1_payload_digest: result };
          // First-run captures the baseline; subsequent runs leave the
          // sticky baseline untouched so drift is detected against the
          // original capture point. Failed runs also leave the baseline
          // alone (recordMigrationAbort below doesn't touch cursor_json).
          if (baseline === null) {
            completeCursorJson = JSON.stringify(result.digests);
          } else {
            completeCursorJson = existing?.cursor_json;
          }
        } else {
          const result = runReadPathParity(input.dbPath, input.assetDir);
          outcome = { validator, status: result.status, read_paths: result };
        }

        if (outcome.status === "fail") {
          anyFail = true;
          // C5: write 'aborted' (not 'completed') on validator FAIL. The
          // marker is the durable signal downstream operators and B.5
          // cutover orchestration read; a 'completed' marker on failure
          // makes the two states indistinguishable. The next run will
          // refuse to start (recordMigrationStart throws on prior aborted)
          // — operator must explicitly `migration reset --phase
          // storage-boundary.validate` after fixing the underlying drift,
          // which is the intended acknowledgment gate.
          recordMigrationAbort(db, scope, new Error(summarizeValidatorFailure(outcome)));
        } else {
          recordMigrationComplete(
            db,
            scope,
            completeCursorJson !== undefined ? { cursorJson: completeCursorJson } : {},
          );
        }
        input.onProgress?.({ kind: outcome.status === "pass" ? "validator_pass" : "validator_fail", validator });
        outcomes.push(outcome);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (started) {
          recordMigrationAbort(db, scope, error);
        }
        anyFail = true;
        outcomes.push({ validator, status: "aborted", error: message });
        input.onProgress?.({ kind: "validator_abort", validator, error: message });
      }
    }
  } finally {
    db.close();
  }

  return {
    db_path: input.dbPath,
    ran: outcomes.map((o) => o.validator),
    outcomes,
    exit_code: anyFail ? 1 : 0,
  };
}

function runBundleByteDiff(
  pre: BundleChecksumCompare,
  post: BundleChecksumCompare,
): BundleByteDiffResult {
  const payloadMismatches = diffStringMaps(
    pre.payload_sha256_by_source_id,
    post.payload_sha256_by_source_id,
  ).map(([key, pre, post]) => ({ source_id: key, pre, post }));
  const rawMismatches = diffStringMaps(pre.raw_sha256_by_path, post.raw_sha256_by_path).map(
    ([key, pre, post]) => ({ path: key, pre, post }),
  );
  const manifestFieldMismatches = diffManifestStable(pre.manifest_stable, post.manifest_stable);
  const status = payloadMismatches.length > 0 || rawMismatches.length > 0 || manifestFieldMismatches.length > 0
    ? "fail"
    : "pass";
  return {
    status,
    payload_mismatches: payloadMismatches,
    raw_mismatches: rawMismatches,
    manifest_field_mismatches: manifestFieldMismatches,
  };
}

/**
 * C5: produce a short, durable summary of why a validator failed. Written to
 * migration_state.last_error so `migration status` and downstream tooling can
 * show the reason without re-running the validator. Each validator kind has
 * its own shape; keep this helper trivially readable since it lands in a
 * TEXT cell that operators read directly.
 */
function summarizeValidatorFailure(outcome: MigrationValidatorOutcome): string {
  if (outcome.bundle) {
    const b = outcome.bundle;
    return `bundle validator failed: ${b.payload_mismatches.length} payload mismatches, ${b.raw_mismatches.length} raw mismatches, ${b.manifest_field_mismatches.length} manifest field mismatches`;
  }
  if (outcome.inventory) {
    return `inventory validator failed: ${outcome.inventory.failing_pairs.length} failing v1↔v2 pairs`;
  }
  if (outcome.read_paths) {
    const r = outcome.read_paths;
    return `read-paths validator failed: context mismatch_count=${r.mismatch_count}, user_turn.mismatch_count=${r.user_turn.mismatch_count}`;
  }
  if (outcome.v1_payload_digest) {
    const v = outcome.v1_payload_digest;
    const tables = v.mismatches.map((m) => m.table).join(", ");
    return `v1-payload-digest validator failed: ${v.mismatch_count} table(s) drifted from baseline (${tables})`;
  }
  return `validator ${outcome.validator} failed`;
}

/**
 * C6: parse a baseline JSON blob stored in migration_state.cursor_json back
 * into a per-table sha256 map. Returns null on any structural problem so the
 * caller treats the run as a fresh baseline capture (safer than failing the
 * validator over a corrupt marker — the operator can `migration reset` if
 * they want a clean state).
 */
function parseV1DigestBaseline(cursorJson: string): Record<string, string> | null {
  try {
    const parsed = JSON.parse(cursorJson) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const map: Record<string, string> = {};
    for (const [table, sha] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof sha !== "string") return null;
      map[table] = sha;
    }
    return map;
  } catch {
    return null;
  }
}

/**
 * C6: compute per-table sha256 of every V1 payload_json value, ordered by
 * primary key. The digest is sensitive to row content AND row count — an
 * INSERT, UPDATE, or DELETE on any V1 payload table changes the digest for
 * that table. Used both for the initial baseline capture and for the
 * subsequent comparison runs.
 *
 * Hashing streams row-by-row so peak memory stays at one payload_json cell,
 * not the entire table. This matters on the operator store where individual
 * user_turns.payload_json cells are multi-KiB and there are thousands of
 * rows per table.
 */
function computeV1PayloadDigests(
  db: DatabaseSync,
): { digests: Record<string, string | null>; row_counts: Record<string, number> } {
  const digests: Record<string, string | null> = {};
  const rowCounts: Record<string, number> = {};
  for (const { table, keyColumn } of V1_PAYLOAD_TABLES) {
    // B.6: post-compact stores have dropped user_turns and turn_contexts.
    // Record null digest + 0 row count rather than throwing, so the
    // comparison logic can distinguish "table legitimately dropped" from
    // "table content drifted". Only the two B.6 tables are eligible for
    // this null treatment; if any of the other 10 are missing the table
    // itself is the problem and we want to surface it loudly below.
    const tableExists =
      db
        .prepare("SELECT 1 AS hit FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table) !== undefined;
    if (!tableExists) {
      digests[table] = null;
      rowCounts[table] = 0;
      continue;
    }
    const hash = createHash("sha256");
    let count = 0;
    // ORDER BY keyColumn guarantees a stable iteration order so identical
    // contents produce identical hashes regardless of physical row order
    // (VACUUM, INSERT-then-DELETE cycles, etc). The PK column is also
    // indexed, so the ORDER BY is cheap.
    const stmt = db.prepare(
      `SELECT payload_json FROM ${table} ORDER BY ${keyColumn}`,
    );
    for (const row of stmt.iterate() as Iterable<{ payload_json: string }>) {
      hash.update(row.payload_json);
      hash.update("\n");
      count += 1;
    }
    digests[table] = hash.digest("hex");
    rowCounts[table] = count;
  }
  return { digests, row_counts: rowCounts };
}

/**
 * B.6: tables dropped by `migration compact --step drop-v1-tables`. Their
 * current digest is null post-compact; comparing that against a non-null
 * baseline is the EXPECTED outcome, not drift. Other V1 tables (raw_records,
 * captured_blobs, etc.) are still required to match their baseline — they
 * have no V2 replacement yet and dropping them would break bundle export.
 */
const B6_DROPPED_TABLES: ReadonlySet<string> = new Set(["user_turns", "turn_contexts"]);

/**
 * C6: V1 payload_json drift detector. First call (baseline === null) captures
 * the current digests as the sticky baseline; subsequent calls compare and
 * fail on any drift. The CLI layer ensures the baseline is persisted to
 * migration_state.cursor_json via the recordMigrationComplete call.
 */
function runV1PayloadDigestCheck(
  dbPath: string,
  baseline: Record<string, string> | null,
): V1PayloadDigestResult {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const { digests, row_counts } = computeV1PayloadDigests(db);
    if (baseline === null) {
      return {
        status: "pass",
        baseline_captured: true,
        row_counts,
        digests,
        mismatches: [],
        mismatch_count: 0,
      };
    }
    const mismatches: V1PayloadDigestResult["mismatches"] = [];
    let mismatchCount = 0;
    for (const { table } of V1_PAYLOAD_TABLES) {
      const current = digests[table] ?? null;
      const baselineSha = baseline[table];
      // B.6: a table dropped by `migration compact` is expected to read as
      // null post-compact. The baseline had a real digest (captured before
      // the drop); current === null against a non-null baseline is the
      // expected post-B.6 state for user_turns and turn_contexts ONLY.
      // Treat as a match for these two; treat as drift for any other table.
      if (current === null && baselineSha !== undefined && B6_DROPPED_TABLES.has(table)) {
        continue;
      }
      const isMismatch = baselineSha === undefined || baselineSha !== current;
      if (!isMismatch) continue;
      mismatchCount += 1;
      // Cap only the surfaced list; mismatch_count reflects the true total.
      if (mismatches.length < MISMATCH_CAP) {
        if (baselineSha === undefined) {
          // Table added since baseline — surface as drift so the operator
          // either re-captures the baseline or investigates why a new V1
          // table appeared post-B.3.
          mismatches.push({ table, current: current ?? "" });
        } else {
          mismatches.push({ table, baseline: baselineSha, current: current ?? "" });
        }
      }
    }
    return {
      status: mismatchCount === 0 ? "pass" : "fail",
      baseline_captured: false,
      row_counts,
      digests,
      mismatches,
      mismatch_count: mismatchCount,
    };
  } finally {
    db.close();
  }
}

function diffStringMaps(
  pre: Record<string, string>,
  post: Record<string, string>,
): Array<[string, string | undefined, string | undefined]> {
  const keys = new Set([...Object.keys(pre), ...Object.keys(post)]);
  const out: Array<[string, string | undefined, string | undefined]> = [];
  for (const key of keys) {
    const a = pre[key];
    const b = post[key];
    if (a !== b) out.push([key, a, b]);
  }
  out.sort((x, y) => x[0].localeCompare(y[0]));
  return out;
}

function diffManifestStable(
  pre: BundleChecksumCompare["manifest_stable"],
  post: BundleChecksumCompare["manifest_stable"],
): Array<{ field: string; pre: unknown; post: unknown }> {
  const out: Array<{ field: string; pre: unknown; post: unknown }> = [];
  const fields: Array<keyof BundleChecksumCompare["manifest_stable"]> = [
    "bundle_version",
    "schema_version",
    "source_instance_ids",
    "includes_raw_blobs",
    "counts",
  ];
  for (const field of fields) {
    const a = pre[field];
    const b = post[field];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      out.push({ field, pre: a, post: b });
    }
  }
  return out;
}

async function runInventoryDiff(dbPath: string): Promise<InventoryDiffResult> {
  // readStorageBoundaryMigrationPreview is async (statfs for VACUUM math).
  // We re-read on each call — small DBs only matter here; large stores will
  // be audited against a one-shot baseline before B.6.
  const preview = await readStorageBoundaryMigrationPreview({ dbPath });
  const mapping = preview.v1_to_v2_mapping;
  const pairs: Array<{ name: keyof typeof mapping } & { v1_rows: number; v2_rows: number; missing: number }> = [
    { name: "user_turns", ...mapping.user_turns },
    { name: "turn_contexts", ...mapping.turn_contexts },
    { name: "raw_records", ...mapping.raw_records },
    { name: "captured_blobs", ...mapping.captured_blobs },
  ];
  const failing = pairs.filter((p) => p.missing > 0 || (p.name !== "captured_blobs" && p.v1_rows !== p.v2_rows));
  return {
    status: failing.length > 0 ? "fail" : "pass",
    mapping,
    failing_pairs: failing.map((p) => ({
      name: String(p.name),
      v1_rows: p.v1_rows,
      v2_rows: p.v2_rows,
      missing: p.missing,
    })),
  };
}

function runReadPathParity(dbPath: string, assetDir?: string): ReadPathParityResult {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const mismatches: ReadPathParityResult["mismatches"] = [];
  const userTurnMismatches: ReadPathParityResult["user_turn"]["mismatches"] = [];
  let turnsChecked = 0;
  let mismatchCount = 0;
  let userTurnsChecked = 0;
  let userTurnMismatchCount = 0;
  try {
    // B.6: post-compact stores have no V1 reference. The parity check exists
    // to gate B.5 cutovers on real-sized stores; once B.6 lands it has no
    // reference to compare against. Return synthetic PASS with a flag so the
    // CLI can render "post-B.6, skipped" rather than failing or pretending
    // to have run.
    if (!Queries.v1TurnTablesExist(db)) {
      return {
        status: "pass",
        post_b6_skipped: true,
        turns_checked: 0,
        mismatches: [],
        mismatch_count: 0,
        user_turn: { turns_checked: 0, mismatches: [], mismatch_count: 0 },
      };
    }
    const rows = db.prepare("SELECT id FROM user_turns ORDER BY id").all() as Array<{ id: string }>;
    for (const row of rows) {
      turnsChecked += 1;
      const v2 = readTurnContextFromV2Cache({ db, assetDir, turnId: row.id });
      const v1 = Queries.getTurnContext(db, row.id);
      if (v2 === undefined && v1 === undefined) continue;
      if (v2 === undefined && v1 !== undefined) {
        mismatchCount += 1;
        if (mismatches.length < MISMATCH_CAP) mismatches.push({ turn_id: row.id, reason: "v2_missing" });
        continue;
      }
      if (v1 === undefined && v2 !== undefined) {
        mismatchCount += 1;
        if (mismatches.length < MISMATCH_CAP) mismatches.push({ turn_id: row.id, reason: "v1_missing" });
        continue;
      }
      if (!turnContextEqual(v1 as TurnContextProjection, v2 as TurnContextProjection)) {
        mismatchCount += 1;
        if (mismatches.length < MISMATCH_CAP) {
          mismatches.push({
            turn_id: row.id,
            reason: "diff",
            detail: describeTurnContextDiff(v1 as TurnContextProjection, v2 as TurnContextProjection),
          });
        }
      }
    }

    for (const row of rows) {
      userTurnsChecked += 1;
      const v2 = Queries.readUserTurnFromV2({ db, turnId: row.id, assetDir });
      const v1 = Queries.getTurn(db, row.id);
      if (v2 === undefined && v1 === undefined) continue;
      if (v2 === undefined && v1 !== undefined) {
        userTurnMismatchCount += 1;
        if (userTurnMismatches.length < MISMATCH_CAP) {
          userTurnMismatches.push({ turn_id: row.id, reason: "v2_missing" });
        }
        continue;
      }
      if (v1 === undefined && v2 !== undefined) {
        userTurnMismatchCount += 1;
        if (userTurnMismatches.length < MISMATCH_CAP) {
          userTurnMismatches.push({ turn_id: row.id, reason: "v1_missing" });
        }
        continue;
      }
      if (!userTurnEqual(v1 as UserTurnProjection, v2 as UserTurnProjection)) {
        userTurnMismatchCount += 1;
        if (userTurnMismatches.length < MISMATCH_CAP) {
          userTurnMismatches.push({
            turn_id: row.id,
            reason: "diff",
            detail: describeUserTurnDiff(v1 as UserTurnProjection, v2 as UserTurnProjection),
          });
        }
      }
    }
  } finally {
    db.close();
  }
  return {
    status: mismatchCount > 0 || userTurnMismatchCount > 0 ? "fail" : "pass",
    turns_checked: turnsChecked,
    mismatches,
    mismatch_count: mismatchCount,
    user_turn: {
      turns_checked: userTurnsChecked,
      mismatches: userTurnMismatches,
      mismatch_count: userTurnMismatchCount,
    },
  };
}

function userTurnEqual(a: UserTurnProjection, b: UserTurnProjection): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function describeUserTurnDiff(a: UserTurnProjection, b: UserTurnProjection): string {
  const parts: string[] = [];
  if (a.user_messages.length !== b.user_messages.length) {
    parts.push(`user_messages: ${a.user_messages.length} vs ${b.user_messages.length}`);
  }
  if ((a.raw_text ?? "").length !== (b.raw_text ?? "").length) {
    parts.push(`raw_text length: ${(a.raw_text ?? "").length} vs ${(b.raw_text ?? "").length}`);
  }
  if ((a.canonical_text ?? "") !== (b.canonical_text ?? "")) {
    parts.push(`canonical_text differs (${(a.canonical_text ?? "").length} vs ${(b.canonical_text ?? "").length})`);
  }
  if ((a.project_id ?? "") !== (b.project_id ?? "")) {
    parts.push(`project_id: ${a.project_id ?? "(none)"} vs ${b.project_id ?? "(none)"}`);
  }
  if ((a.path_text ?? "") !== (b.path_text ?? "")) {
    parts.push(`path_text differs`);
  }
  if ((a.last_context_activity_at ?? "") !== (b.last_context_activity_at ?? "")) {
    parts.push(`last_context_activity_at: ${a.last_context_activity_at ?? ""} vs ${b.last_context_activity_at ?? ""}`);
  }
  return parts.length > 0 ? parts.join("; ") : "serialized projections differ";
}

function turnContextEqual(a: TurnContextProjection, b: TurnContextProjection): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return out;
}

function describeTurnContextDiff(a: TurnContextProjection, b: TurnContextProjection): string {
  const parts: string[] = [];
  if (a.system_messages.length !== b.system_messages.length) {
    parts.push(`system_messages: ${a.system_messages.length} vs ${b.system_messages.length}`);
  }
  if (a.assistant_replies.length !== b.assistant_replies.length) {
    parts.push(`assistant_replies: ${a.assistant_replies.length} vs ${b.assistant_replies.length}`);
  }
  if (a.tool_calls.length !== b.tool_calls.length) {
    parts.push(`tool_calls: ${a.tool_calls.length} vs ${b.tool_calls.length}`);
  }
  if (a.raw_event_refs.length !== b.raw_event_refs.length) {
    parts.push(`raw_event_refs: ${a.raw_event_refs.length} vs ${b.raw_event_refs.length}`);
  }
  return parts.length > 0 ? parts.join("; ") : "serialized projections differ";
}
