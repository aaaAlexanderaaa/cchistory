import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  RemoteAgentBundlePayload,
  RemoteAgentCompleteJobResponse,
  RemoteAgentLeaseJobResponse,
  RemoteAgentPairResponse,
  RemoteAgentSourceManifestEntry,
  RemoteAgentUploadResponse,
  SourceSyncPayload,
} from "@cchistory/domain";
import type { BundleExportResult } from "./bundle.js";
import { computePayloadChecksum } from "./bundle.js";

export interface LocalRemoteAgentState {
  version: 1;
  server_url: string;
  agent_id: string;
  agent_token: string;
  paired_at: string;
  last_uploaded_generation_by_source_id: Record<string, number>;
  last_uploaded_checksum_by_source_id: Record<string, string>;
}

export function defaultRemoteAgentStatePath(): string {
  return path.join(os.homedir(), ".cchistory-agent", "agent-state.json");
}

export async function readLocalRemoteAgentState(statePath: string): Promise<LocalRemoteAgentState> {
  const payload = JSON.parse(await readFile(statePath, "utf8")) as Partial<LocalRemoteAgentState>;
  if (
    payload.version !== 1 ||
    typeof payload.server_url !== "string" ||
    typeof payload.agent_id !== "string" ||
    typeof payload.agent_token !== "string"
  ) {
    throw new Error(`Invalid remote agent state file: ${statePath}`);
  }
  return {
    version: 1,
    server_url: payload.server_url,
    agent_id: payload.agent_id,
    agent_token: payload.agent_token,
    paired_at: typeof payload.paired_at === "string" ? payload.paired_at : new Date().toISOString(),
    last_uploaded_generation_by_source_id: payload.last_uploaded_generation_by_source_id ?? {},
    last_uploaded_checksum_by_source_id: payload.last_uploaded_checksum_by_source_id ?? {},
  };
}

export async function writeLocalRemoteAgentState(statePath: string, state: LocalRemoteAgentState): Promise<void> {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
}

export function buildLocalRemoteAgentState(serverUrl: string, response: RemoteAgentPairResponse): LocalRemoteAgentState {
  return {
    version: 1,
    server_url: normalizeServerUrl(serverUrl),
    agent_id: response.agent_id,
    agent_token: response.agent_token,
    paired_at: response.paired_at,
    last_uploaded_generation_by_source_id: {},
    last_uploaded_checksum_by_source_id: {},
  };
}

export function buildRemoteSourceManifestEntries(input: {
  payloads: SourceSyncPayload[];
  state: LocalRemoteAgentState;
  force: boolean;
}): { entries: RemoteAgentSourceManifestEntry[]; includedSourceIds: string[]; dirtyFingerprintBySourceId: Record<string, string> } {
  const includedSourceIds: string[] = [];
  const dirtyFingerprintBySourceId: Record<string, string> = {};
  const entries = input.payloads.map((payload) => {
    const payloadChecksum = computePayloadChecksum(payload);
    const dirtyFingerprint = computeDirtyFingerprint(payload);
    dirtyFingerprintBySourceId[payload.source.id] = dirtyFingerprint;
    const previousChecksum = input.state.last_uploaded_checksum_by_source_id[payload.source.id];
    const previousGeneration = input.state.last_uploaded_generation_by_source_id[payload.source.id] ?? 0;
    const presence = derivePresence(payload);
    const includedInBundle = presence !== "absent" && (input.force || previousChecksum !== dirtyFingerprint);
    const generation = includedInBundle ? previousGeneration + 1 : previousGeneration;
    if (includedInBundle) {
      includedSourceIds.push(payload.source.id);
    }
    return {
      source_id: payload.source.id,
      slot_id: payload.source.slot_id,
      platform: payload.source.platform,
      display_name: payload.source.display_name,
      base_dir: payload.source.base_dir,
      sync_status: payload.source.sync_status,
      presence,
      total_turns: payload.turns.length,
      payload_checksum: payloadChecksum,
      generation,
      included_in_bundle: includedInBundle,
      error_message: payload.source.error_message,
    } satisfies RemoteAgentSourceManifestEntry;
  });
  return { entries, includedSourceIds, dirtyFingerprintBySourceId };
}

export function createEmptyRemoteBundlePayload(collectedAt: string): RemoteAgentBundlePayload {
  const manifest = {
    bundle_id: `bundle-empty-${collectedAt.replace(/[^0-9]/g, "").slice(0, 14) || "remote"}`,
    bundle_version: "cchistory.bundle.v1",
    exported_at: collectedAt,
    exported_from_host_ids: [],
    schema_version: "2026-03-14.1",
    source_instance_ids: [],
    counts: { sources: 0, sessions: 0, turns: 0, blobs: 0 },
    includes_raw_blobs: false,
    created_by: "cchistory-agent",
  };
  return {
    manifest,
    checksums: {
      manifest_sha256: createHash("sha256").update(JSON.stringify(manifest, null, 2)).digest("hex"),
      payload_sha256_by_source_id: {},
      raw_sha256_by_path: {},
    },
    payloads: [],
    raw_blobs_base64_by_path: {},
  };
}

export async function encodeBundleForRemoteUpload(bundleDir: string, exportResult: BundleExportResult): Promise<RemoteAgentBundlePayload> {
  const rawBlobsBase64ByPath = Object.fromEntries(
    await Promise.all(
      Object.keys(exportResult.checksums.raw_sha256_by_path).map(async (relativePath) => {
        const buffer = await readFile(path.join(bundleDir, relativePath));
        return [relativePath, buffer.toString("base64")] as const;
      }),
    ),
  );

  return {
    manifest: exportResult.manifest,
    checksums: exportResult.checksums,
    payloads: exportResult.payloads,
    raw_blobs_base64_by_path: rawBlobsBase64ByPath,
  };
}

export function applyRemoteUploadSuccess(input: {
  state: LocalRemoteAgentState;
  entries: RemoteAgentSourceManifestEntry[];
  dirtyFingerprintBySourceId: Record<string, string>;
  /** Server-authoritative generations per source_id. When provided, these
   *  take precedence over locally-computed entry.generation values, which
   *  prevents the client from getting stuck in a stale retry loop after a
   *  crash-before-write scenario. */
  acceptedGenerations?: Record<string, number>;
}): LocalRemoteAgentState {
  const nextState: LocalRemoteAgentState = {
    ...input.state,
    last_uploaded_generation_by_source_id: {
      ...input.state.last_uploaded_generation_by_source_id,
    },
    last_uploaded_checksum_by_source_id: {
      ...input.state.last_uploaded_checksum_by_source_id,
    },
  };
  for (const entry of input.entries) {
    if (!entry.included_in_bundle) {
      continue;
    }
    // Prefer server-returned generation (authoritative) over locally computed value.
    const serverGeneration = input.acceptedGenerations?.[entry.source_id];
    nextState.last_uploaded_generation_by_source_id[entry.source_id] = serverGeneration ?? entry.generation;
    nextState.last_uploaded_checksum_by_source_id[entry.source_id] = input.dirtyFingerprintBySourceId[entry.source_id] ?? nextState.last_uploaded_checksum_by_source_id[entry.source_id] ?? "";
  }
  return nextState;
}

export async function pairRemoteAgent(serverUrl: string, pairingToken: string, options: {
  displayName?: string;
  reportedHostname?: string;
} = {}): Promise<RemoteAgentPairResponse> {
  const response = await fetch(`${normalizeServerUrl(serverUrl)}/api/agent/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pairing_token: pairingToken,
      display_name: options.displayName,
      reported_hostname: options.reportedHostname,
    }),
  });
  if (!response.ok) {
    throw new Error(await describeRemoteError(response, "Remote agent pair failed."));
  }
  return (await response.json()) as RemoteAgentPairResponse;
}

export async function uploadRemoteAgentBundle(input: {
  state: LocalRemoteAgentState;
  collectedAt: string;
  jobId?: string;
  bundle: RemoteAgentBundlePayload;
  sourceManifest: RemoteAgentSourceManifestEntry[];
}): Promise<RemoteAgentUploadResponse> {
  const response = await fetch(`${normalizeServerUrl(input.state.server_url)}/api/agent/uploads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agent_id: input.state.agent_id,
      agent_token: input.state.agent_token,
      job_id: input.jobId,
      collected_at: input.collectedAt,
      bundle: input.bundle,
      source_manifest: input.sourceManifest,
    }),
  });
  if (!response.ok) {
    throw new Error(await describeRemoteError(response, "Remote agent upload failed."));
  }
  return (await response.json()) as RemoteAgentUploadResponse;
}

export async function leaseRemoteAgentJob(input: {
  state: LocalRemoteAgentState;
}): Promise<RemoteAgentLeaseJobResponse> {
  const response = await fetch(`${normalizeServerUrl(input.state.server_url)}/api/agent/jobs/lease`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agent_id: input.state.agent_id,
      agent_token: input.state.agent_token,
    }),
  });
  if (!response.ok) {
    throw new Error(await describeRemoteError(response, "Remote agent lease failed."));
  }
  return (await response.json()) as RemoteAgentLeaseJobResponse;
}

export async function completeRemoteAgentJob(input: {
  state: LocalRemoteAgentState;
  jobId: string;
  status: "succeeded" | "failed";
  errorMessage?: string;
  bundleId?: string;
  importedSourceIds?: string[];
  replacedSourceIds?: string[];
  skippedSourceIds?: string[];
}): Promise<RemoteAgentCompleteJobResponse> {
  const response = await fetch(`${normalizeServerUrl(input.state.server_url)}/api/agent/jobs/${encodeURIComponent(input.jobId)}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agent_id: input.state.agent_id,
      agent_token: input.state.agent_token,
      status: input.status,
      error_message: input.errorMessage,
      bundle_id: input.bundleId,
      imported_source_ids: input.importedSourceIds,
      replaced_source_ids: input.replacedSourceIds,
      skipped_source_ids: input.skippedSourceIds,
    }),
  });
  if (!response.ok) {
    throw new Error(await describeRemoteError(response, "Remote agent completion failed."));
  }
  return (await response.json()) as RemoteAgentCompleteJobResponse;
}

function computeDirtyFingerprint(payload: SourceSyncPayload): string {
  return createHash("sha256").update(JSON.stringify({
    source: {
      slot_id: payload.source.slot_id,
      platform: payload.source.platform,
      base_dir: payload.source.base_dir,
      sync_status: payload.source.sync_status,
      error_message: payload.source.error_message,
    },
    blobs: payload.blobs.map((blob) => ({
      origin_path: blob.origin_path,
      checksum: blob.checksum,
      size_bytes: blob.size_bytes,
      file_modified_at: blob.file_modified_at,
    })),
    // Include derived layer data so that parser/linker/projection changes
    // invalidate the fingerprint even when raw blobs are unchanged.
    payload_checksum: computePayloadChecksum(payload),
  })).digest("hex");
}

function derivePresence(payload: SourceSyncPayload): RemoteAgentSourceManifestEntry["presence"] {
  if (payload.source.sync_status === "error") {
    return payload.source.error_message?.startsWith("Source path not found:") ? "absent" : "unreadable";
  }
  return "present";
}

async function describeRemoteError(response: Response, prefix: string): Promise<string> {
  try {
    const parsed = await response.json() as { error?: string };
    return parsed.error ? `${prefix} ${parsed.error}` : `${prefix} HTTP ${response.status}`;
  } catch {
    return `${prefix} HTTP ${response.status}`;
  }
}

function normalizeServerUrl(value: string): string {
  return value.replace(/\/+$/u, "");
}
