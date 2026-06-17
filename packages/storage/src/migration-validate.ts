import { DatabaseSync } from "node:sqlite";
import type { TurnContextProjection } from "@cchistory/domain";
import {
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

export type MigrationValidatorKind = "bundle" | "inventory" | "read-paths";

const SCOPE_IDS: Record<MigrationValidatorKind, string> = {
  bundle: "bundle-byte-diff",
  inventory: "inventory-diff",
  "read-paths": "read-path-parity",
};

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
  turns_checked: number;
  mismatches: Array<{
    turn_id: string;
    reason: "v2_missing" | "v1_missing" | "diff";
    detail?: string;
  }>;
  mismatch_count: number;
}

export interface MigrationValidatorOutcome {
  validator: MigrationValidatorKind;
  status: "pass" | "fail" | "aborted";
  error?: string;
  bundle?: BundleByteDiffResult;
  inventory?: InventoryDiffResult;
  read_paths?: ReadPathParityResult;
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
  const selected = input.only && input.only.length > 0 ? input.only : (["bundle", "inventory", "read-paths"] as const);
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

      try {
        recordMigrationStart(db, scope);
        let outcome: MigrationValidatorOutcome;
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
        } else {
          const result = runReadPathParity(input.dbPath, input.assetDir);
          outcome = { validator, status: result.status, read_paths: result };
        }

        if (outcome.status === "fail") anyFail = true;
        recordMigrationComplete(db, scope);
        input.onProgress?.({ kind: outcome.status === "pass" ? "validator_pass" : "validator_fail", validator });
        outcomes.push(outcome);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        recordMigrationAbort(db, scope, error);
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
  const failing = pairs.filter((p) => p.missing > 0 || p.v1_rows !== p.v2_rows);
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
  let turnsChecked = 0;
  let mismatchCount = 0;
  try {
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
  } finally {
    db.close();
  }
  return {
    status: mismatchCount > 0 ? "fail" : "pass",
    turns_checked: turnsChecked,
    mismatches,
    mismatch_count: mismatchCount,
  };
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
