import { createHash } from "node:crypto";
import { createReadStream, openSync, writeSync, closeSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import type {
  BundleChecksums,
  BundleObjectCounts,
  CapturedBlob,
  ImportBundleManifest,
  ImportedBundleRecord,
  RawRecord,
  SourcePlatform,
  SourceSyncPayload,
} from "@cchistory/domain";
import type { CCHistoryStorage } from "@cchistory/storage";

function assertSafePathComponent(value: string, label: string): void {
  if (value.includes("/") || value.includes("\\") || value.includes("..") || value.includes("\0")) {
    throw new Error(`Unsafe ${label}: ${value}`);
  }
}

function assertPathWithinDirectory(resolvedPath: string, baseDir: string, label: string): void {
  const normalizedBase = path.resolve(baseDir);
  const normalizedPath = path.resolve(resolvedPath);
  if (!normalizedPath.startsWith(normalizedBase + path.sep) && normalizedPath !== normalizedBase) {
    throw new Error(`${label} escapes the target directory: ${resolvedPath}`);
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => JSON.stringify(key) + ":" + stableStringify((value as Record<string, unknown>)[key]));
  return "{" + entries.join(",") + "}";
}

export const BUNDLE_VERSION = "cchistory.bundle.v1";
export const BUNDLE_SCHEMA_VERSION = "2026-03-14.1";
const VIRTUAL_BLOB_PATH_PREFIXES = ["antigravity-live://"];

export interface BundleReadResult {
  bundleDir: string;
  manifest: ImportBundleManifest;
  checksums: BundleChecksums;
  payloads: SourceSyncPayload[];
}

export interface BundleExportResult {
  manifest: ImportBundleManifest;
  checksums: BundleChecksums;
}

export interface BundleImportPlanEntry {
  source_id: string;
  slot_id: string;
  display_name: string;
  platform: SourcePlatform;
  host_id: string;
  counts: BundleObjectCounts;
  action: "import" | "replace" | "skip" | "conflict";
  reason: "new_source" | "identical_payload" | "conflict_skip" | "conflict_replace" | "conflict_error";
}

export interface BundleImportPlanResult {
  manifest: ImportBundleManifest;
  checksums: BundleChecksums;
  source_plans: BundleImportPlanEntry[];
  imported_source_ids: string[];
  replaced_source_ids: string[];
  skipped_source_ids: string[];
  conflicting_source_ids: string[];
  would_fail: boolean;
}

export interface BundleImportResult extends BundleImportPlanResult {
  project_count_before: number;
  project_count_after: number;
}

type ConflictMode = "error" | "skip" | "replace";

export async function exportBundle(options: {
  storage: CCHistoryStorage;
  bundleDir: string;
  sourceIds?: string[];
  includeRawBlobs: boolean;
}): Promise<BundleExportResult> {
  const sources = options.storage
    .listSources()
    .filter((source) => (options.sourceIds && options.sourceIds.length > 0 ? options.sourceIds.includes(source.id) : true));
  const bundleDir = path.resolve(options.bundleDir);
  await ensureEmptyDirectory(bundleDir);
  await mkdir(path.join(bundleDir, "payloads"), { recursive: true });
  if (options.includeRawBlobs) {
    await mkdir(path.join(bundleDir, "raw"), { recursive: true });
  }

  const payloadChecksums: Record<string, string> = {};
  const rawChecksums: Record<string, string> = {};
  const sourceInstanceIds: string[] = [];
  const hostIds: string[] = [];
  let totalCounts: BundleObjectCounts = { sources: 0, sessions: 0, turns: 0, blobs: 0 };

  // Stream each source payload to disk one row at a time — constant memory per source
  for (const source of sources) {
    assertSafePathComponent(source.id, "source_id");

    // Collect blob info during streaming for raw blob materialization
    const blobSourcePaths: Array<{ captured_path?: string; origin_path?: string }> = [];
    const collectedBlobs: CapturedBlob[] = [];

    const payloadPath = path.join(bundleDir, "payloads", `${source.id}.json`);
    const hash = createHash("sha256");
    const fd = openSync(payloadPath, "w");
    const writeChunk = (chunk: string) => {
      writeSync(fd, chunk);
      hash.update(chunk);
    };

    const counts = options.storage.streamSourcePayloadJson(source.id, writeChunk, {
      transformBlob: (blob) => {
        blobSourcePaths.push({ captured_path: blob.captured_path, origin_path: blob.origin_path });
        const serialized = { ...blob, captured_path: bundleRawRelativePath(source.id, blob) };
        collectedBlobs.push(serialized);
        return serialized;
      },
    });
    closeSync(fd);

    if (!counts) continue;

    payloadChecksums[source.id] = hash.digest("hex");
    sourceInstanceIds.push(source.id);
    hostIds.push(source.host_id);
    totalCounts = {
      sources: totalCounts.sources + 1,
      sessions: totalCounts.sessions + counts.sessions,
      turns: totalCounts.turns + counts.turns,
      blobs: totalCounts.blobs + counts.blobs,
    };

    if (options.includeRawBlobs) {
      for (const [index, blob] of collectedBlobs.entries()) {
        const sourcePath = blobSourcePaths[index]?.captured_path ?? blobSourcePaths[index]?.origin_path;
        const relativePath = bundleRawRelativePath(source.id, blob);
        const targetPath = path.join(bundleDir, relativePath);
        await mkdir(path.dirname(targetPath), { recursive: true });
        await materializeBlobSnapshot(targetPath, blob, sourcePath, () => options.storage.getRecordsByBlobId(blob.id));
        rawChecksums[relativePath] = sha256(await readFile(targetPath));
      }
    }
  }

  const exportedAt = new Date().toISOString();
  const manifest: ImportBundleManifest = {
    bundle_id: `bundle-${sha256(JSON.stringify({ exportedAt, payloadChecksums })).slice(0, 12)}`,
    bundle_version: BUNDLE_VERSION,
    exported_at: exportedAt,
    exported_from_host_ids: uniqueStrings(hostIds),
    schema_version: BUNDLE_SCHEMA_VERSION,
    source_instance_ids: sourceInstanceIds.sort(),
    counts: totalCounts,
    includes_raw_blobs: options.includeRawBlobs,
    created_by: "cchistory-cli",
  };
  const manifestJson = JSON.stringify(manifest, null, 2);
  const checksums: BundleChecksums = {
    manifest_sha256: sha256(manifestJson),
    payload_sha256_by_source_id: payloadChecksums,
    raw_sha256_by_path: rawChecksums,
  };

  await writeFile(path.join(bundleDir, "manifest.json"), manifestJson, "utf8");
  await writeFile(path.join(bundleDir, "checksums.json"), JSON.stringify(checksums, null, 2), "utf8");

  return {
    manifest,
    checksums,
  };
}

export async function planBundleImport(options: {
  storage: CCHistoryStorage;
  bundleDir: string;
  onConflict: ConflictMode;
}): Promise<BundleImportPlanResult> {
  const bundleMeta = await readBundleManifest(options.bundleDir);
  // For plan we need payload data to show per-source counts and metadata.
  // Load payloads one at a time (lazy).
  const payloads: SourceSyncPayload[] = [];
  for (const sourceId of bundleMeta.manifest.source_instance_ids) {
    payloads.push(await readSinglePayload(bundleMeta, sourceId));
  }
  return planBundleImportFromPayloads({
    storage: options.storage,
    bundleMeta,
    payloads,
    onConflict: options.onConflict,
  });
}

function planBundleImportFromPayloads(options: {
  storage: CCHistoryStorage;
  bundleMeta: BundleManifestResult;
  payloads: SourceSyncPayload[];
  onConflict: ConflictMode;
}): BundleImportPlanResult {
  const { bundleMeta } = options;
  const importedBundle = options.storage.getImportedBundle(bundleMeta.manifest.bundle_id);
  if (importedBundle && stableStringify(importedBundle.checksums) !== stableStringify(bundleMeta.checksums)) {
    throw new Error(`Bundle id ${bundleMeta.manifest.bundle_id} already exists with different checksums.`);
  }

  const importedSourceIds: string[] = [];
  const replacedSourceIds: string[] = [];
  const skippedSourceIds: string[] = [];
  const conflictingSourceIds: string[] = [];
  const sourcePlans: BundleImportPlanEntry[] = [];

  for (const payload of options.payloads) {
    const existingPayload = options.storage.getSourcePayload(payload.source.id);
    const incomingChecksum = bundleMeta.checksums.payload_sha256_by_source_id[payload.source.id];
    if (!incomingChecksum) {
      throw new Error(`Missing checksum for source ${payload.source.id}`);
    }

    let action: BundleImportPlanEntry["action"];
    let reason: BundleImportPlanEntry["reason"];

    if (!existingPayload) {
      action = "import";
      reason = "new_source";
      importedSourceIds.push(payload.source.id);
    } else {
      const existingChecksum = computePayloadChecksum(existingPayload);
      if (existingChecksum === incomingChecksum) {
        action = "skip";
        reason = "identical_payload";
        skippedSourceIds.push(payload.source.id);
      } else if (options.onConflict === "skip") {
        action = "skip";
        reason = "conflict_skip";
        skippedSourceIds.push(payload.source.id);
      } else if (options.onConflict === "replace") {
        action = "replace";
        reason = "conflict_replace";
        replacedSourceIds.push(payload.source.id);
      } else {
        action = "conflict";
        reason = "conflict_error";
        conflictingSourceIds.push(payload.source.id);
      }
    }

    sourcePlans.push({
      source_id: payload.source.id,
      slot_id: payload.source.slot_id,
      display_name: payload.source.display_name,
      platform: payload.source.platform,
      host_id: payload.source.host_id,
      counts: computeBundleCounts([payload]),
      action,
      reason,
    });
  }

  return {
    manifest: bundleMeta.manifest,
    checksums: bundleMeta.checksums,
    source_plans: sourcePlans,
    imported_source_ids: importedSourceIds,
    replaced_source_ids: replacedSourceIds,
    skipped_source_ids: skippedSourceIds,
    conflicting_source_ids: conflictingSourceIds,
    would_fail: conflictingSourceIds.length > 0,
  };
}

/**
 * Plan import without loading payloads — uses only manifest metadata
 * and storage source presence to determine actions.
 * Per-source counts are taken from the manifest-level aggregates.
 */
function planBundleImportFromManifest(options: {
  storage: CCHistoryStorage;
  bundleMeta: BundleManifestResult;
  onConflict: ConflictMode;
}): BundleImportPlanResult {
  const { bundleMeta } = options;
  const importedBundle = options.storage.getImportedBundle(bundleMeta.manifest.bundle_id);
  if (importedBundle && stableStringify(importedBundle.checksums) !== stableStringify(bundleMeta.checksums)) {
    throw new Error(`Bundle id ${bundleMeta.manifest.bundle_id} already exists with different checksums.`);
  }

  const importedSourceIds: string[] = [];
  const replacedSourceIds: string[] = [];
  const skippedSourceIds: string[] = [];
  const conflictingSourceIds: string[] = [];
  const sourcePlans: BundleImportPlanEntry[] = [];
  const existingSources = options.storage.listSources();

  for (const sourceId of bundleMeta.manifest.source_instance_ids) {
    const incomingChecksum = bundleMeta.checksums.payload_sha256_by_source_id[sourceId];
    if (!incomingChecksum) {
      throw new Error(`Missing checksum for source ${sourceId}`);
    }
    const existingSource = existingSources.find((src) => src.id === sourceId);

    let action: BundleImportPlanEntry["action"];
    let reason: BundleImportPlanEntry["reason"];

    if (!existingSource) {
      action = "import";
      reason = "new_source";
      importedSourceIds.push(sourceId);
    } else {
      // Compute existing checksum via streaming to avoid loading huge payloads
      const existingChecksum = computeStoredPayloadChecksum(options.storage, sourceId);
      if (existingChecksum === incomingChecksum) {
        action = "skip";
        reason = "identical_payload";
        skippedSourceIds.push(sourceId);
      } else if (options.onConflict === "skip") {
        action = "skip";
        reason = "conflict_skip";
        skippedSourceIds.push(sourceId);
      } else if (options.onConflict === "replace") {
        action = "replace";
        reason = "conflict_replace";
        replacedSourceIds.push(sourceId);
      } else {
        action = "conflict";
        reason = "conflict_error";
        conflictingSourceIds.push(sourceId);
      }
    }

    sourcePlans.push({
      source_id: sourceId,
      slot_id: existingSource?.slot_id ?? sourceId,
      display_name: existingSource?.display_name ?? sourceId,
      platform: existingSource?.platform ?? ("unknown" as SourcePlatform),
      host_id: existingSource?.host_id ?? "unknown",
      counts: { sources: 1, sessions: 0, turns: 0, blobs: 0 },
      action,
      reason,
    });
  }

  return {
    manifest: bundleMeta.manifest,
    checksums: bundleMeta.checksums,
    source_plans: sourcePlans,
    imported_source_ids: importedSourceIds,
    replaced_source_ids: replacedSourceIds,
    skipped_source_ids: skippedSourceIds,
    conflicting_source_ids: conflictingSourceIds,
    would_fail: conflictingSourceIds.length > 0,
  };
}

/**
 * Compute checksum of a stored source payload using streaming,
 * avoiding loading the entire payload into memory.
 */
function computeStoredPayloadChecksum(storage: CCHistoryStorage, sourceId: string): string {
  const hash = createHash("sha256");
  storage.streamSourcePayloadJson(sourceId, (chunk) => hash.update(chunk), {
    transformBlob: (blob) => ({
      ...blob,
      captured_path: bundleRawRelativePath(sourceId, blob),
    }),
  });
  return hash.digest("hex");
}

async function sha256FileStream(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: Buffer | string) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

interface BundleManifestResult {
  bundleDir: string;
  manifest: ImportBundleManifest;
  checksums: BundleChecksums;
}

async function readBundleManifest(bundleDir: string): Promise<BundleManifestResult> {
  const resolvedBundleDir = path.resolve(bundleDir);
  const manifestPath = path.join(resolvedBundleDir, "manifest.json");
  const checksumsPath = path.join(resolvedBundleDir, "checksums.json");
  const manifestJson = await readFile(manifestPath, "utf8");
  const checksumsJson = await readFile(checksumsPath, "utf8");
  const manifest = JSON.parse(manifestJson) as ImportBundleManifest;
  const checksums = JSON.parse(checksumsJson) as BundleChecksums;

  if (checksums.manifest_sha256 !== sha256(manifestJson)) {
    throw new Error(`Manifest checksum mismatch for ${manifestPath}`);
  }

  return { bundleDir: resolvedBundleDir, manifest, checksums };
}

async function readSinglePayload(
  bundleMeta: BundleManifestResult,
  sourceId: string,
): Promise<SourceSyncPayload> {
  assertSafePathComponent(sourceId, "source_instance_id");
  const payloadPath = path.join(bundleMeta.bundleDir, "payloads", `${sourceId}.json`);
  assertPathWithinDirectory(payloadPath, bundleMeta.bundleDir, "payload path");

  const expectedChecksum = bundleMeta.checksums.payload_sha256_by_source_id[sourceId];
  if (!expectedChecksum) {
    throw new Error(`Missing checksum for source ${sourceId}`);
  }

  const fileChecksum = await sha256FileStream(payloadPath);
  if (expectedChecksum !== fileChecksum) {
    throw new Error(`Payload checksum mismatch for ${payloadPath}`);
  }

  const fileSize = (await stat(payloadPath)).size;
  if (fileSize > MAX_INLINE_PAYLOAD_SIZE) {
    return parsePayloadStreaming(payloadPath);
  }

  const payloadJson = await readFile(payloadPath, "utf8");
  return JSON.parse(payloadJson) as SourceSyncPayload;
}

const MAX_INLINE_PAYLOAD_SIZE = 400 * 1024 * 1024; // 400MB

/**
 * Parse a large payload JSON file using streaming, avoiding V8 string length limits.
 *
 * Exploits the known structure produced by `streamSourcePayloadJson`:
 *   `{"source":{...},"stage_runs":[{...},{...}],...}`
 * Each array element is a compact JSON.stringify() output (no internal newlines
 * outside of string literals), so we can safely buffer one element at a time.
 *
 * Strategy: read the file as raw Buffers, scan for top-level structural chars
 * while tracking string boundaries and nesting depth.  When a complete element
 * is found, decode only that slice to UTF-8 and JSON.parse() it.
 */
async function parsePayloadStreaming(payloadPath: string): Promise<SourceSyncPayload> {
  const ARRAY_FIELD_NAMES = new Set([
    "stage_runs", "loss_audits", "blobs", "records", "fragments",
    "atoms", "edges", "candidates", "sessions", "turns", "contexts",
  ]);

  return new Promise<SourceSyncPayload>((resolve, reject) => {
    const result: Record<string, unknown[]> = {};
    let source: unknown = undefined;

    // State machine
    let phase: "top" | "key" | "colon" | "value_start" | "source_value" | "array_body" | "element" | "done" = "top";
    let currentKey = "";
    let depth = 0;
    let inString = false;
    let escape = false;

    // Accumulator for the current value being parsed (one element or source obj).
    // We accumulate raw Buffer slices to avoid creating huge strings.
    let accBufs: Buffer[] = [];
    let accLen = 0;

    function flushAcc(): string {
      const combined = Buffer.concat(accBufs, accLen);
      accBufs = [];
      accLen = 0;
      return combined.toString("utf8");
    }

    function pushAcc(buf: Buffer, start: number, end: number): void {
      if (start < end) {
        const slice = buf.subarray(start, end);
        accBufs.push(Buffer.from(slice)); // copy to avoid retaining the large chunk
        accLen += slice.length;
      }
    }

    const stream = createReadStream(payloadPath, { highWaterMark: 4 * 1024 * 1024 });

    stream.on("data", (rawChunk: Buffer | string) => {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      // If we're mid-value from a previous chunk, start accumulating from byte 0
      const midValue = phase === "source_value" || phase === "element";
      let accStart = midValue ? 0 : -1;

      for (let i = 0; i < chunk.length; i++) {
        const byte = chunk[i];

        // Handle string literal tracking
        if (escape) {
          escape = false;
          continue;
        }
        if (byte === 0x5C /* \\ */ && inString) {
          escape = true;
          continue;
        }
        if (byte === 0x22 /* " */) {
          if (inString) {
            inString = false;
            // If we're collecting a key name
            if (phase === "key") {
              pushAcc(chunk, accStart, i);
              currentKey = flushAcc();
              phase = "colon";
              accStart = -1;
            }
            continue;
          }
          inString = true;
          if (phase === "key") {
            accStart = i + 1; // start collecting key chars
          }
          continue;
        }
        if (inString) continue;

        // Outside string — structural chars only
        switch (phase) {
          case "top":
            // Expect opening `{` of the top-level object
            if (byte === 0x7B /* { */) {
              phase = "key";
            }
            break;

          case "key":
            // Waiting for opening `"` of key — handled above in quote logic
            break;

          case "colon":
            if (byte === 0x3A /* : */) {
              phase = "value_start";
            }
            break;

          case "value_start":
            if (byte === 0x7B /* { */) {
              // source value (object)
              phase = "source_value";
              depth = 1;
              accStart = i;
            } else if (byte === 0x5B /* [ */) {
              // array value
              if (!result[currentKey]) result[currentKey] = [];
              phase = "array_body";
            }
            break;

          case "source_value":
            if (byte === 0x7B || byte === 0x5B) depth++;
            else if (byte === 0x7D || byte === 0x5D) {
              depth--;
              if (depth === 0) {
                pushAcc(chunk, accStart, i + 1);
                source = JSON.parse(flushAcc());
                accStart = -1;
                phase = "key"; // back to looking for next key (after comma)
              }
            }
            break;

          case "array_body":
            if (byte === 0x5D /* ] */) {
              // empty array
              phase = "key";
            } else if (byte === 0x7B /* { */ || byte === 0x5B /* [ */) {
              // start of first element
              phase = "element";
              depth = 1;
              accStart = i;
            }
            break;

          case "element":
            if (byte === 0x7B || byte === 0x5B) {
              depth++;
            } else if (byte === 0x7D || byte === 0x5D) {
              depth--;
              if (depth === 0) {
                // Complete element
                pushAcc(chunk, accStart, i + 1);
                (result[currentKey] as unknown[]).push(JSON.parse(flushAcc()));
                accStart = -1;
                // Now expect comma or closing `]`
                phase = "array_body";
              }
            }
            break;

          case "done":
            break;
        }
      }

      // Carry over accumulated bytes for incomplete values
      if (accStart >= 0 && (phase === "source_value" || phase === "element")) {
        pushAcc(chunk, accStart, chunk.length);
      }
    });

    stream.on("end", () => {
      for (const key of ARRAY_FIELD_NAMES) {
        if (!(key in result)) {
          result[key] = [];
        }
      }
      resolve({
        source: source as SourceSyncPayload["source"],
        ...result,
      } as unknown as SourceSyncPayload);
    });

    stream.on("error", reject);
  });
}

export async function readBundle(bundleDir: string): Promise<BundleReadResult> {
  const resolvedBundleDir = path.resolve(bundleDir);
  const manifestPath = path.join(resolvedBundleDir, "manifest.json");
  const checksumsPath = path.join(resolvedBundleDir, "checksums.json");
  const manifestJson = await readFile(manifestPath, "utf8");
  const checksumsJson = await readFile(checksumsPath, "utf8");
  const manifest = JSON.parse(manifestJson) as ImportBundleManifest;
  const checksums = JSON.parse(checksumsJson) as BundleChecksums;

  if (checksums.manifest_sha256 !== sha256(manifestJson)) {
    throw new Error(`Manifest checksum mismatch for ${manifestPath}`);
  }

  const payloads: SourceSyncPayload[] = [];
  for (const sourceId of manifest.source_instance_ids) {
    assertSafePathComponent(sourceId, "source_instance_id");
    const payloadPath = path.join(resolvedBundleDir, "payloads", `${sourceId}.json`);
    assertPathWithinDirectory(payloadPath, resolvedBundleDir, "payload path");
    const payloadJson = await readFile(payloadPath, "utf8");
    const payload = JSON.parse(payloadJson) as SourceSyncPayload;
    if (checksums.payload_sha256_by_source_id[sourceId] !== computePayloadChecksum(payload)) {
      throw new Error(`Payload checksum mismatch for ${payloadPath}`);
    }
    payloads.push(payload);
  }

  return {
    bundleDir: resolvedBundleDir,
    manifest,
    checksums,
    payloads,
  };
}

export async function importBundleIntoStore(options: {
  storage: CCHistoryStorage;
  bundleDir: string;
  rawDir: string;
  onConflict: ConflictMode;
}): Promise<BundleImportResult> {
  const bundleMeta = await readBundleManifest(options.bundleDir);

  // Plan without loading payloads — uses manifest + storage presence only
  const plan = planBundleImportFromManifest({
    storage: options.storage,
    bundleMeta,
    onConflict: options.onConflict,
  });
  if (plan.would_fail) {
    throw new Error(`Source conflict detected for ${plan.conflicting_source_ids[0]}`);
  }

  const projectCountBefore = options.storage.listProjects().length;

  // Validate and materialize every payload before mutating the target store.
  // This preserves the previous all-or-nothing store import behavior even
  // though payload loading now happens lazily.
  const preparedPayloads: SourceSyncPayload[] = [];
  for (const sourcePlan of plan.source_plans) {
    if (sourcePlan.action === "skip" || sourcePlan.action === "conflict") {
      continue;
    }
    const payload = await readSinglePayload(bundleMeta, sourcePlan.source_id);
    const prepared = await materializePayloadRawBlobsFromMeta(payload, bundleMeta, options.rawDir);
    preparedPayloads.push(prepared);
  }

  for (const payload of preparedPayloads) {
    options.storage.replaceSourcePayload(payload);
  }

  const importedRecord: ImportedBundleRecord = {
    bundle_id: bundleMeta.manifest.bundle_id,
    bundle_version: bundleMeta.manifest.bundle_version,
    imported_at: new Date().toISOString(),
    source_instance_ids: bundleMeta.manifest.source_instance_ids,
    manifest: bundleMeta.manifest,
    checksums: bundleMeta.checksums,
  };
  options.storage.upsertImportedBundle(importedRecord);

  return {
    ...plan,
    project_count_before: projectCountBefore,
    project_count_after: options.storage.listProjects().length,
  };
}

export function computePayloadChecksum(payload: SourceSyncPayload): string {
  return sha256(JSON.stringify(serializePayloadForBundle(payload)));
}

export async function snapshotPayloadRawBlobs(rawDir: string, payload: SourceSyncPayload): Promise<SourceSyncPayload> {
  const nextPayload = {
    ...payload,
    blobs: payload.blobs.map((blob) => ({ ...blob })),
  };

  for (const blob of nextPayload.blobs) {
    const sourcePath = blob.origin_path;
    const targetPath = path.join(rawDir, payload.source.id, path.basename(bundleRawRelativePath(payload.source.id, blob)));
    await mkdir(path.dirname(targetPath), { recursive: true });
    await materializeBlobSnapshot(targetPath, blob, sourcePath, () =>
      payload.records.filter((r) => r.blob_id === blob.id),
    );
    blob.captured_path = targetPath;
    blob.size_bytes = (await stat(targetPath)).size;
  }

  return nextPayload;
}

export function serializePayloadForBundle(payload: SourceSyncPayload): SourceSyncPayload {
  return {
    ...payload,
    blobs: payload.blobs.map((blob) => ({
      ...blob,
      captured_path: bundleRawRelativePath(payload.source.id, blob),
    })),
  };
}

function computeBundleCounts(payloads: SourceSyncPayload[]): BundleObjectCounts {
  return payloads.reduce<BundleObjectCounts>(
    (counts, payload) => ({
      sources: counts.sources + 1,
      sessions: counts.sessions + payload.sessions.length,
      turns: counts.turns + payload.turns.length,
      blobs: counts.blobs + payload.blobs.length,
    }),
    { sources: 0, sessions: 0, turns: 0, blobs: 0 },
  );
}

async function materializePayloadRawBlobsFromMeta(
  payload: SourceSyncPayload,
  bundleMeta: BundleManifestResult,
  rawDir: string,
): Promise<SourceSyncPayload> {
  const nextPayload = {
    ...payload,
    blobs: payload.blobs.map((blob) => ({ ...blob })),
  };

  if (!bundleMeta.manifest.includes_raw_blobs) {
    for (const blob of nextPayload.blobs) {
      blob.captured_path = undefined;
    }
    return nextPayload;
  }

  for (const blob of nextPayload.blobs) {
    const relativePath = blob.captured_path ?? bundleRawRelativePath(payload.source.id, blob);
    const bundleRawPath = path.join(bundleMeta.bundleDir, relativePath);
    assertPathWithinDirectory(bundleRawPath, bundleMeta.bundleDir, "bundle raw path");
    if (bundleMeta.checksums.raw_sha256_by_path[relativePath] !== sha256(await readFile(bundleRawPath))) {
      throw new Error(`Raw checksum mismatch for ${relativePath}`);
    }
    const targetPath = path.join(rawDir, payload.source.id, path.basename(relativePath));
    assertPathWithinDirectory(targetPath, rawDir, "raw target path");
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(bundleRawPath, targetPath);
    blob.captured_path = targetPath;
    blob.size_bytes = (await stat(targetPath)).size;
  }

  return nextPayload;
}

async function materializePayloadRawBlobs(
  payload: SourceSyncPayload,
  bundle: BundleReadResult,
  rawDir: string,
): Promise<SourceSyncPayload> {
  const nextPayload = {
    ...payload,
    blobs: payload.blobs.map((blob) => ({ ...blob })),
  };

  if (!bundle.manifest.includes_raw_blobs) {
    for (const blob of nextPayload.blobs) {
      blob.captured_path = undefined;
    }
    return nextPayload;
  }

  for (const blob of nextPayload.blobs) {
    const relativePath = blob.captured_path ?? bundleRawRelativePath(payload.source.id, blob);
    const bundleRawPath = path.join(bundle.bundleDir, relativePath);
    assertPathWithinDirectory(bundleRawPath, bundle.bundleDir, "bundle raw path");
    if (bundle.checksums.raw_sha256_by_path[relativePath] !== sha256(await readFile(bundleRawPath))) {
      throw new Error(`Raw checksum mismatch for ${relativePath}`);
    }
    const targetPath = path.join(rawDir, payload.source.id, path.basename(relativePath));
    assertPathWithinDirectory(targetPath, rawDir, "raw target path");
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(bundleRawPath, targetPath);
    blob.captured_path = targetPath;
    blob.size_bytes = (await stat(targetPath)).size;
  }

  return nextPayload;
}

function bundleRawRelativePath(sourceId: string, blob: CapturedBlob): string {
  const extension = path.extname(blob.origin_path || blob.captured_path || "") || ".json";
  return path.join("raw", sourceId, `${blob.id}${extension}`);
}

async function materializeBlobSnapshot(
  targetPath: string,
  blob: CapturedBlob,
  sourcePath: string | undefined,
  getRecords: () => RawRecord[],
): Promise<void> {
  if (sourcePath && !isVirtualBlobPath(sourcePath)) {
    await copyFile(sourcePath, targetPath);
    return;
  }

  const records = getRecords().sort((left, right) => left.ordinal - right.ordinal);
  if (records.length === 0) {
    throw new Error(`Missing raw source path and record snapshot for blob ${blob.id}`);
  }

  await writeFile(
    targetPath,
    `${JSON.stringify(
      {
        blob,
        records,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function isVirtualBlobPath(value: string): boolean {
  return VIRTUAL_BLOB_PATH_PREFIXES.some((prefix) => value.startsWith(prefix));
}

async function ensureEmptyDirectory(targetDir: string): Promise<void> {
  try {
    const entries = await readdir(targetDir);
    if (entries.length > 0) {
      throw new Error(`Bundle output directory already exists and is not empty: ${targetDir}`);
    }
    // Directory exists and is already empty — reuse as-is
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  // Directory doesn't exist — create atomically
  await mkdir(targetDir, { recursive: true });
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort();
}
