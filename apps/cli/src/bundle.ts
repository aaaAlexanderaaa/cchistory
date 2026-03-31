import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import type {
  BundleChecksums,
  BundleObjectCounts,
  CapturedBlob,
  ImportBundleManifest,
  ImportedBundleRecord,
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
  payloads: SourceSyncPayload[];
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
  const payloads = options.storage
    .listSourcePayloads()
    .filter((payload) => (options.sourceIds && options.sourceIds.length > 0 ? options.sourceIds.includes(payload.source.id) : true));
  const bundleDir = path.resolve(options.bundleDir);
  await ensureEmptyDirectory(bundleDir);
  await mkdir(path.join(bundleDir, "payloads"), { recursive: true });
  if (options.includeRawBlobs) {
    await mkdir(path.join(bundleDir, "raw"), { recursive: true });
  }

  const payloadChecksums: Record<string, string> = {};
  const rawChecksums: Record<string, string> = {};
  const serializedPayloads = payloads.map(serializePayloadForBundle);

  for (const payload of serializedPayloads) {
    assertSafePathComponent(payload.source.id, "source_id");
    const payloadJson = JSON.stringify(payload, null, 2);
    payloadChecksums[payload.source.id] = computePayloadChecksum(payload);
    await writeFile(path.join(bundleDir, "payloads", `${payload.source.id}.json`), payloadJson, "utf8");

    if (!options.includeRawBlobs) {
      continue;
    }

    for (const [index, blob] of payload.blobs.entries()) {
      const sourceBlob = payloads.find((entry) => entry.source.id === payload.source.id)?.blobs[index];
      const sourcePath = sourceBlob?.captured_path ?? sourceBlob?.origin_path;
      const relativePath = bundleRawRelativePath(payload.source.id, blob);
      const targetPath = path.join(bundleDir, relativePath);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await materializeBlobSnapshot(targetPath, payloads.find((entry) => entry.source.id === payload.source.id) ?? payload, blob, sourcePath);
      rawChecksums[relativePath] = sha256(await readFile(targetPath));
    }
  }

  const exportedAt = new Date().toISOString();
  const counts = computeBundleCounts(serializedPayloads);
  const manifest: ImportBundleManifest = {
    bundle_id: `bundle-${sha256(JSON.stringify({ exportedAt, payloadChecksums })).slice(0, 12)}`,
    bundle_version: BUNDLE_VERSION,
    exported_at: exportedAt,
    exported_from_host_ids: uniqueStrings(serializedPayloads.map((payload) => payload.source.host_id)),
    schema_version: BUNDLE_SCHEMA_VERSION,
    source_instance_ids: serializedPayloads.map((payload) => payload.source.id).sort(),
    counts,
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
    payloads: serializedPayloads,
  };
}

export async function planBundleImport(options: {
  storage: CCHistoryStorage;
  bundleDir: string;
  onConflict: ConflictMode;
}): Promise<BundleImportPlanResult> {
  const bundle = await readBundle(options.bundleDir);
  return planBundleImportFromBundle({
    storage: options.storage,
    bundle,
    onConflict: options.onConflict,
  });
}

function planBundleImportFromBundle(options: {
  storage: CCHistoryStorage;
  bundle: BundleReadResult;
  onConflict: ConflictMode;
}): BundleImportPlanResult {
  const { bundle } = options;
  const importedBundle = options.storage.getImportedBundle(bundle.manifest.bundle_id);
  if (importedBundle && stableStringify(importedBundle.checksums) !== stableStringify(bundle.checksums)) {
    throw new Error(`Bundle id ${bundle.manifest.bundle_id} already exists with different checksums.`);
  }

  const importedSourceIds: string[] = [];
  const replacedSourceIds: string[] = [];
  const skippedSourceIds: string[] = [];
  const conflictingSourceIds: string[] = [];
  const sourcePlans: BundleImportPlanEntry[] = [];

  for (const payload of bundle.payloads) {
    const existingPayload = options.storage.getSourcePayload(payload.source.id);
    const incomingChecksum = bundle.checksums.payload_sha256_by_source_id[payload.source.id];
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
    manifest: bundle.manifest,
    checksums: bundle.checksums,
    source_plans: sourcePlans,
    imported_source_ids: importedSourceIds,
    replaced_source_ids: replacedSourceIds,
    skipped_source_ids: skippedSourceIds,
    conflicting_source_ids: conflictingSourceIds,
    would_fail: conflictingSourceIds.length > 0,
  };
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
  const bundle = await readBundle(options.bundleDir);
  const plan = planBundleImportFromBundle({
    storage: options.storage,
    bundle,
    onConflict: options.onConflict,
  });
  if (plan.would_fail) {
    throw new Error(`Source conflict detected for ${plan.conflicting_source_ids[0]}`);
  }

  const preparedPayloads: SourceSyncPayload[] = [];
  for (const payload of bundle.payloads) {
    const sourcePlan = plan.source_plans.find((entry) => entry.source_id === payload.source.id);
    if (!sourcePlan || sourcePlan.action === "skip" || sourcePlan.action === "conflict") {
      continue;
    }
    preparedPayloads.push(await materializePayloadRawBlobs(payload, bundle, options.rawDir));
  }

  const projectCountBefore = options.storage.listProjects().length;
  for (const payload of preparedPayloads) {
    options.storage.replaceSourcePayload(payload);
  }

  const importedRecord: ImportedBundleRecord = {
    bundle_id: bundle.manifest.bundle_id,
    bundle_version: bundle.manifest.bundle_version,
    imported_at: new Date().toISOString(),
    source_instance_ids: bundle.manifest.source_instance_ids,
    manifest: bundle.manifest,
    checksums: bundle.checksums,
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
    await materializeBlobSnapshot(targetPath, payload, blob, sourcePath);
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
  payload: SourceSyncPayload,
  blob: CapturedBlob,
  sourcePath: string | undefined,
): Promise<void> {
  if (sourcePath && !isVirtualBlobPath(sourcePath)) {
    await copyFile(sourcePath, targetPath);
    return;
  }

  const records = payload.records
    .filter((record) => record.blob_id === blob.id)
    .sort((left, right) => left.ordinal - right.ordinal);
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
