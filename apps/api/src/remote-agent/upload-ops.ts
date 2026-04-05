import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ImportedBundleRecord,
  RemoteAgentUploadRequest,
  RemoteAgentUploadResponse,
  SourceSyncPayload,
} from "@cchistory/domain";
import type { CCHistoryStorage } from "@cchistory/storage";
import { type PersistedRemoteAgentState } from "./types.js";
import { authenticateRemoteAgent, buildPersistedSourceState } from "./agent-ops.js";
import { requireLeasedJobAssignment } from "./job-ops.js";

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function serializePayload(payload: SourceSyncPayload): SourceSyncPayload {
  return {
    ...payload,
    blobs: payload.blobs.map((blob) => ({
      ...blob,
      captured_path: blob.captured_path ? path.join("raw", payload.source.id, path.basename(blob.captured_path)) : blob.captured_path,
    })),
  };
}

async function materializeUploadedRawBlobs(
  rawStoreDir: string,
  payload: SourceSyncPayload,
  rawBlobsBase64ByPath: Record<string, string>,
  rawChecksumsByPath: Record<string, string>,
  includesRawBlobs: boolean,
): Promise<SourceSyncPayload> {
  const nextPayload: SourceSyncPayload = {
    ...payload,
    blobs: payload.blobs.map((blob) => ({ ...blob })),
  };

  if (!includesRawBlobs) {
    for (const blob of nextPayload.blobs) {
      blob.captured_path = undefined;
    }
    return nextPayload;
  }

  for (const blob of nextPayload.blobs) {
    const relativePath = blob.captured_path;
    if (!relativePath) {
      throw new Error(`Missing relative raw path for blob ${blob.id}.`);
    }
    const encoded = rawBlobsBase64ByPath[relativePath];
    if (!encoded) {
      throw new Error(`Missing uploaded raw blob for ${relativePath}.`);
    }
    const buffer = Buffer.from(encoded, "base64");
    if (sha256(buffer) !== rawChecksumsByPath[relativePath]) {
      throw new Error(`Remote upload raw checksum mismatch for ${relativePath}.`);
    }
    const targetDir = path.join(rawStoreDir, payload.source.id);
    const targetPath = path.join(targetDir, path.basename(relativePath));
    await mkdir(targetDir, { recursive: true });
    await writeFile(targetPath, buffer);
    blob.captured_path = targetPath;
    blob.size_bytes = buffer.byteLength;
  }

  return nextPayload;
}

export async function applyRemoteAgentUpload(options: {
  state: PersistedRemoteAgentState;
  request: RemoteAgentUploadRequest;
  rawStoreDir: string;
  storage: CCHistoryStorage;
}): Promise<{
  state: PersistedRemoteAgentState;
  response: RemoteAgentUploadResponse;
}> {
  const record = authenticateRemoteAgent(options.state, options.request.agent_id, options.request.agent_token);
  if (!record) {
    throw new Error("Unauthorized remote agent upload.");
  }

  const jobLease = options.request.job_id
    ? requireLeasedJobAssignment(options.state, options.request.job_id, record.agent_id, { requireActiveLease: true })
    : undefined;

  // Accept both canonical (stable) and pretty-printed manifest checksums
  // to be resilient against different JSON serializers on the client side.
  const prettyManifestJson = JSON.stringify(options.request.bundle.manifest, null, 2);
  const canonicalManifestJson = stableStringify(options.request.bundle.manifest);
  const expectedChecksum = options.request.bundle.checksums.manifest_sha256;
  if (sha256(prettyManifestJson) !== expectedChecksum && sha256(canonicalManifestJson) !== expectedChecksum) {
    throw new Error("Remote upload manifest checksum mismatch.");
  }

  const existingBundle = options.storage.getImportedBundle(options.request.bundle.manifest.bundle_id);
  if (existingBundle && stableStringify(existingBundle.checksums) !== stableStringify(options.request.bundle.checksums)) {
    throw new Error(`Bundle id ${options.request.bundle.manifest.bundle_id} already exists with different checksums.`);
  }

  // Enforce source_slots: when the leased job restricts to specific slots,
  // every included manifest entry must belong to one of those slots.
  if (jobLease && Array.isArray(jobLease.job.source_slots)) {
    const allowedSlots = new Set(jobLease.job.source_slots);
    for (const entry of options.request.source_manifest) {
      if (entry.included_in_bundle && !allowedSlots.has(entry.slot_id)) {
        throw new Error(
          `Source ${entry.source_id} (slot ${entry.slot_id}) is outside the allowed source_slots for job ${jobLease.job.job_id}. Allowed: [${jobLease.job.source_slots.join(", ")}].`,
        );
      }
    }
  }

  // Enforce expected_generation guard: when the leased job specifies an
  // expected_generation, every included manifest entry must match it exactly.
  if (jobLease?.job.expected_generation !== undefined) {
    for (const entry of options.request.source_manifest) {
      if (entry.included_in_bundle && entry.generation !== jobLease.job.expected_generation) {
        throw new Error(
          `Generation mismatch for ${entry.source_id}: manifest has generation=${entry.generation} but job ${jobLease.job.job_id} requires expected_generation=${jobLease.job.expected_generation}.`,
        );
      }
    }
  }

  const manifestEntries = new Map(options.request.source_manifest.map((entry) => [entry.source_id, entry]));

  // Validate bidirectional consistency between manifest and payloads:
  // 1. Every manifest entry with included_in_bundle=true must have a payload.
  // 2. Every payload must have a manifest entry with included_in_bundle=true.
  // Without (1), the server would persist "uploaded" status with no data.
  // Without (2), an agent could sneak payloads past manifest-level guards
  // (source_slots, expected_generation) by marking them as not bundled.
  const payloadSourceIds = new Set(options.request.bundle.payloads.map((payload) => payload.source.id));
  for (const entry of options.request.source_manifest) {
    if (entry.included_in_bundle && !payloadSourceIds.has(entry.source_id)) {
      throw new Error(
        `Source manifest entry ${entry.source_id} declares included_in_bundle=true but no matching payload exists in the bundle.`,
      );
    }
  }
  for (const payload of options.request.bundle.payloads) {
    const manifestEntry = manifestEntries.get(payload.source.id);
    if (!manifestEntry || !manifestEntry.included_in_bundle) {
      throw new Error(
        `Bundle contains payload for ${payload.source.id} but manifest does not declare included_in_bundle=true for it.`,
      );
    }
  }

  const importedSourceIds: string[] = [];
  const replacedSourceIds: string[] = [];
  const skippedSourceIds: string[] = [];

  for (const payload of options.request.bundle.payloads) {
    const incomingChecksum = sha256(JSON.stringify(payload));
    const expectedChecksum = options.request.bundle.checksums.payload_sha256_by_source_id[payload.source.id];
    if (!expectedChecksum || incomingChecksum !== expectedChecksum) {
      throw new Error(`Remote upload payload checksum mismatch for ${payload.source.id}.`);
    }

    const manifestEntry = manifestEntries.get(payload.source.id);
    if (!manifestEntry) {
      throw new Error(`Missing source manifest entry for ${payload.source.id}.`);
    }
    const previousGeneration = record.sources[payload.source.id]?.last_generation ?? 0;
    if (manifestEntry.generation <= previousGeneration) {
      throw new Error(`Stale remote upload rejected for ${payload.source.id}.`);
    }

    const existingPayload = options.storage.getSourcePayload(payload.source.id);
    const existingChecksum = existingPayload ? sha256(JSON.stringify(serializePayload(existingPayload))) : undefined;
    if (existingChecksum === incomingChecksum) {
      skippedSourceIds.push(payload.source.id);
      continue;
    }

    const preparedPayload = await materializeUploadedRawBlobs(
      options.rawStoreDir,
      payload,
      options.request.bundle.raw_blobs_base64_by_path,
      options.request.bundle.checksums.raw_sha256_by_path,
      options.request.bundle.manifest.includes_raw_blobs,
    );
    options.storage.replaceSourcePayload(preparedPayload, { allow_host_rekey: true });
    if (existingPayload) {
      replacedSourceIds.push(payload.source.id);
    } else {
      importedSourceIds.push(payload.source.id);
    }
  }

  const importedRecord: ImportedBundleRecord = {
    bundle_id: options.request.bundle.manifest.bundle_id,
    bundle_version: options.request.bundle.manifest.bundle_version,
    imported_at: new Date().toISOString(),
    source_instance_ids: options.request.bundle.manifest.source_instance_ids,
    manifest: options.request.bundle.manifest,
    checksums: options.request.bundle.checksums,
  };
  options.storage.upsertImportedBundle(importedRecord);

  const now = new Date().toISOString();
  const nextAgentRecord = {
    ...record,
    last_seen_at: now,
    last_upload_at: now,
    sources: {
      ...record.sources,
    },
  };
  for (const entry of options.request.source_manifest) {
    if (entry.included_in_bundle) {
      // Only advance generation for entries that actually carried payload data.
      nextAgentRecord.sources[entry.source_id] = buildPersistedSourceState(entry, options.request.collected_at);
    } else {
      // For non-bundled entries, update metadata but preserve server's
      // last_generation to prevent client-side generation escalation.
      const previousGeneration = nextAgentRecord.sources[entry.source_id]?.last_generation ?? 0;
      nextAgentRecord.sources[entry.source_id] = buildPersistedSourceState(
        { ...entry, generation: previousGeneration },
        options.request.collected_at,
      );
    }
  }

  let nextJobs = options.state.jobs;
  if (jobLease) {
    nextJobs = {
      ...options.state.jobs,
      [jobLease.job.job_id]: {
        ...jobLease.job,
        agent_statuses: {
          ...jobLease.job.agent_statuses,
          [record.agent_id]: {
            ...jobLease.assignment,
            bundle_id: options.request.bundle.manifest.bundle_id,
            imported_source_ids: [...importedSourceIds],
            replaced_source_ids: [...replacedSourceIds],
            skipped_source_ids: [...skippedSourceIds],
          },
        },
      },
    };
  }

  // Build accepted_generations: the server's authoritative generation for
  // each source after this upload, so clients can reconcile local state
  // even when a previous response was lost (crash-before-write recovery).
  const acceptedGenerations: Record<string, number> = {};
  for (const entry of options.request.source_manifest) {
    acceptedGenerations[entry.source_id] = nextAgentRecord.sources[entry.source_id]?.last_generation ?? entry.generation;
  }

  return {
    state: {
      ...options.state,
      agents: {
        ...options.state.agents,
        [record.agent_id]: nextAgentRecord,
      },
      jobs: nextJobs,
    },
    response: {
      bundle_id: options.request.bundle.manifest.bundle_id,
      imported_source_ids: importedSourceIds,
      replaced_source_ids: replacedSourceIds,
      skipped_source_ids: skippedSourceIds,
      source_manifest_count: options.request.source_manifest.length,
      accepted_generations: acceptedGenerations,
    },
  };
}

/** Key-order-independent JSON serialization for structural equality checks. */
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
