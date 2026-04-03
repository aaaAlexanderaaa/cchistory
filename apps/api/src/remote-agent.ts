import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ImportedBundleRecord,
  RemoteAgentAdminSummary,
  RemoteAgentCollectionJobSummary,
  RemoteAgentCompleteJobRequest,
  RemoteAgentCompleteJobResponse,
  RemoteAgentCreateJobRequest,
  RemoteAgentHeartbeatRequest,
  RemoteAgentHeartbeatResponse,
  RemoteAgentJobAgentStatus,
  RemoteAgentJobLifecycleStatus,
  RemoteAgentJobSelector,
  RemoteAgentJobSyncMode,
  RemoteAgentJobTriggerKind,
  RemoteAgentLeaseJobRequest,
  RemoteAgentLeaseJobResponse,
  RemoteAgentLeasedJob,
  RemoteAgentPairResponse,
  RemoteAgentSourceManifestEntry,
  RemoteAgentUploadRequest,
  RemoteAgentUploadResponse,
  SourceSyncPayload,
} from "@cchistory/domain";
import type { CCHistoryStorage } from "@cchistory/storage";

interface PersistedRemoteAgentSourceState {
  source_id: string;
  slot_id: string;
  platform: RemoteAgentSourceManifestEntry["platform"];
  display_name: string;
  base_dir: string;
  sync_status: RemoteAgentSourceManifestEntry["sync_status"];
  presence: RemoteAgentSourceManifestEntry["presence"];
  total_turns: number;
  payload_checksum?: string;
  last_generation: number;
  last_collected_at: string;
  included_in_bundle: boolean;
  error_message?: string;
}

interface PersistedRemoteAgentRecord {
  agent_id: string;
  agent_token_sha256: string;
  paired_at: string;
  display_name?: string;
  reported_hostname?: string;
  labels: string[];
  last_seen_at?: string;
  last_upload_at?: string;
  sources: Record<string, PersistedRemoteAgentSourceState>;
}

interface PersistedRemoteAgentJobAgentState {
  agent_id: string;
  status: Exclude<RemoteAgentJobLifecycleStatus, "pending">;
  leased_at?: string;
  lease_expires_at?: string;
  completed_at?: string;
  bundle_id?: string;
  imported_source_ids: string[];
  replaced_source_ids: string[];
  skipped_source_ids: string[];
  error_message?: string;
}

interface PersistedRemoteAgentJobRecord {
  job_id: string;
  trigger_kind: RemoteAgentJobTriggerKind;
  selector: RemoteAgentJobSelector;
  source_slots: "all" | string[];
  sync_mode: RemoteAgentJobSyncMode;
  limit_files_per_source?: number;
  expected_generation?: number;
  created_at: string;
  lease_duration_seconds: number;
  agent_statuses: Record<string, PersistedRemoteAgentJobAgentState>;
}

export interface PersistedRemoteAgentState {
  version: 2;
  agents: Record<string, PersistedRemoteAgentRecord>;
  jobs: Record<string, PersistedRemoteAgentJobRecord>;
}

const EMPTY_REMOTE_AGENT_STATE: PersistedRemoteAgentState = {
  version: 2,
  agents: {},
  jobs: {},
};

export async function readRemoteAgentState(statePath: string): Promise<PersistedRemoteAgentState> {
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as { version?: number; agents?: unknown; jobs?: unknown };
    const hasValidAgents = parsed && typeof parsed === "object" && typeof parsed.agents === "object";
    if (!hasValidAgents || (parsed.version !== 1 && parsed.version !== 2)) {
      return { ...EMPTY_REMOTE_AGENT_STATE };
    }
    return {
      version: 2,
      agents: Object.fromEntries(
        Object.entries(parsed.agents ?? {}).flatMap(([agentId, value]) => {
          if (typeof value?.agent_id !== "string" || typeof value?.agent_token_sha256 !== "string") {
            return [];
          }
          const record: PersistedRemoteAgentRecord = {
            agent_id: value.agent_id,
            agent_token_sha256: value.agent_token_sha256,
            paired_at: typeof value.paired_at === "string" ? value.paired_at : new Date().toISOString(),
            display_name: typeof value.display_name === "string" && value.display_name.trim().length > 0 ? value.display_name.trim() : undefined,
            reported_hostname:
              typeof value.reported_hostname === "string" && value.reported_hostname.trim().length > 0
                ? value.reported_hostname.trim()
                : undefined,
            labels: Array.isArray(value.labels) ? normalizeLabels(value.labels) : [],
            last_seen_at: typeof value.last_seen_at === "string" ? value.last_seen_at : undefined,
            last_upload_at: typeof value.last_upload_at === "string" ? value.last_upload_at : undefined,
            sources: normalizePersistedSourceStates(value.sources),
          };
          return [[agentId, record] as const];
        }),
      ),
      jobs:
        parsed.version === 2 && typeof parsed.jobs === "object" && parsed.jobs
          ? Object.fromEntries(
              Object.entries(parsed.jobs).flatMap(([jobId, value]) => {
                const record = normalizePersistedJobRecord(value);
                return record ? ([[jobId, record]] as const) : [];
              }),
            )
          : {},
    };
  } catch {
    return { ...EMPTY_REMOTE_AGENT_STATE };
  }
}

export async function writeRemoteAgentState(statePath: string, state: PersistedRemoteAgentState): Promise<void> {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
}

export function pairRemoteAgent(input: {
  state: PersistedRemoteAgentState;
  displayName?: string;
  reportedHostname?: string;
}): { state: PersistedRemoteAgentState; response: RemoteAgentPairResponse } {
  const agentId = `agent-${randomBytes(8).toString("hex")}`;
  const agentToken = randomBytes(24).toString("hex");
  const pairedAt = new Date().toISOString();
  const nextState: PersistedRemoteAgentState = {
    ...input.state,
    agents: {
      ...input.state.agents,
      [agentId]: {
        agent_id: agentId,
        agent_token_sha256: sha256(agentToken),
        paired_at: pairedAt,
        display_name: input.displayName?.trim() || undefined,
        reported_hostname: input.reportedHostname?.trim() || undefined,
        labels: [],
        sources: {},
      },
    },
  };
  return {
    state: nextState,
    response: {
      agent_id: agentId,
      agent_token: agentToken,
      paired_at: pairedAt,
    },
  };
}

export function authenticateRemoteAgent(
  state: PersistedRemoteAgentState,
  agentId: string,
  agentToken: string,
): PersistedRemoteAgentRecord | undefined {
  const record = state.agents[agentId];
  if (!record) {
    return undefined;
  }
  return record.agent_token_sha256 === sha256(agentToken) ? record : undefined;
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

  const manifestJson = JSON.stringify(options.request.bundle.manifest, null, 2);
  if (sha256(manifestJson) !== options.request.bundle.checksums.manifest_sha256) {
    throw new Error("Remote upload manifest checksum mismatch.");
  }

  const existingBundle = options.storage.getImportedBundle(options.request.bundle.manifest.bundle_id);
  if (existingBundle && JSON.stringify(existingBundle.checksums) !== JSON.stringify(options.request.bundle.checksums)) {
    throw new Error(`Bundle id ${options.request.bundle.manifest.bundle_id} already exists with different checksums.`);
  }

  const manifestEntries = new Map(options.request.source_manifest.map((entry) => [entry.source_id, entry]));
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
  const nextAgentRecord: PersistedRemoteAgentRecord = {
    ...record,
    last_seen_at: now,
    last_upload_at: now,
    sources: {
      ...record.sources,
    },
  };
  for (const entry of options.request.source_manifest) {
    nextAgentRecord.sources[entry.source_id] = buildPersistedSourceState(entry, options.request.collected_at);
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
    },
  };
}

export function applyRemoteAgentHeartbeat(input: {
  state: PersistedRemoteAgentState;
  request: RemoteAgentHeartbeatRequest;
}): { state: PersistedRemoteAgentState; response: RemoteAgentHeartbeatResponse } {
  const record = authenticateRemoteAgent(input.state, input.request.agent_id, input.request.agent_token);
  if (!record) {
    throw new Error("Unauthorized remote agent heartbeat.");
  }

  const lastSeenAt = new Date().toISOString();
  const nextRecord: PersistedRemoteAgentRecord = {
    ...record,
    last_seen_at: lastSeenAt,
    display_name: input.request.display_name?.trim() || record.display_name,
    reported_hostname: input.request.reported_hostname?.trim() || record.reported_hostname,
    labels: input.request.labels ? normalizeLabels(input.request.labels) : record.labels,
    sources: {
      ...record.sources,
    },
  };
  for (const entry of input.request.source_manifest ?? []) {
    const previousGeneration = nextRecord.sources[entry.source_id]?.last_generation ?? 0;
    const generation = entry.generation > previousGeneration ? entry.generation : previousGeneration;
    nextRecord.sources[entry.source_id] = buildPersistedSourceState({ ...entry, generation }, lastSeenAt);
  }

  return {
    state: {
      ...input.state,
      agents: {
        ...input.state.agents,
        [record.agent_id]: nextRecord,
      },
    },
    response: {
      agent_id: record.agent_id,
      last_seen_at: lastSeenAt,
      source_manifest_count: input.request.source_manifest?.length ?? 0,
    },
  };
}

export function listRemoteAgents(state: PersistedRemoteAgentState): RemoteAgentAdminSummary[] {
  return Object.values(state.agents)
    .map((record) => ({
      agent_id: record.agent_id,
      paired_at: record.paired_at,
      display_name: record.display_name,
      reported_hostname: record.reported_hostname,
      labels: [...record.labels].sort(),
      last_seen_at: record.last_seen_at,
      last_upload_at: record.last_upload_at,
      source_manifest: Object.values(record.sources)
        .map(toSourceManifestEntry)
        .sort((left, right) => left.display_name.localeCompare(right.display_name)),
    }))
    .sort((left, right) => left.agent_id.localeCompare(right.agent_id));
}

export function updateRemoteAgentLabels(input: {
  state: PersistedRemoteAgentState;
  agentId: string;
  labels?: string[];
  displayName?: string;
}): { state: PersistedRemoteAgentState; agent: RemoteAgentAdminSummary } {
  const record = input.state.agents[input.agentId];
  if (!record) {
    throw new Error(`Remote agent not found: ${input.agentId}`);
  }
  const nextRecord: PersistedRemoteAgentRecord = {
    ...record,
    display_name: input.displayName?.trim() || record.display_name,
    labels: input.labels ? normalizeLabels(input.labels) : record.labels,
  };
  const nextState: PersistedRemoteAgentState = {
    ...input.state,
    agents: {
      ...input.state.agents,
      [input.agentId]: nextRecord,
    },
  };
  return {
    state: nextState,
    agent: listRemoteAgents(nextState).find((entry) => entry.agent_id === input.agentId)!,
  };
}

export function createRemoteAgentJob(input: {
  state: PersistedRemoteAgentState;
  request: RemoteAgentCreateJobRequest;
}): { state: PersistedRemoteAgentState; job: RemoteAgentCollectionJobSummary } {
  const selector = normalizeJobSelector(input.request.selector);
  if (!selector) {
    throw new Error("Remote agent job selector is invalid.");
  }
  if (selector.kind === "agent_ids") {
    const missingAgentId = selector.agent_ids.find((agentId) => !input.state.agents[agentId]);
    if (missingAgentId) {
      throw new Error(`Remote agent not found: ${missingAgentId}`);
    }
  }

  const sourceSlots = normalizeJobSourceSlots(input.request.source_slots, { allowDefaultAll: true });
  if (!sourceSlots) {
    throw new Error("Remote agent job source_slots must be 'all' or a non-empty string array.");
  }
  const syncMode = normalizeJobSyncMode(input.request.sync_mode) ?? "dirty_snapshot";
  const limitFilesPerSource = normalizeOptionalPositiveInteger(input.request.limit_files_per_source, "limit_files_per_source");
  const expectedGeneration = normalizeOptionalPositiveInteger(input.request.expected_generation, "expected_generation");
  const leaseDurationSeconds = normalizePositiveInteger(input.request.lease_duration_seconds ?? 300, "lease_duration_seconds");
  const createdAt = new Date().toISOString();
  const jobId = `job-${randomBytes(8).toString("hex")}`;
  const nextState: PersistedRemoteAgentState = {
    ...input.state,
    jobs: {
      ...input.state.jobs,
      [jobId]: {
        job_id: jobId,
        trigger_kind: normalizeJobTriggerKind(input.request.trigger_kind) ?? "server_requested",
        selector,
        source_slots: sourceSlots,
        sync_mode: syncMode,
        limit_files_per_source: limitFilesPerSource,
        expected_generation: expectedGeneration,
        created_at: createdAt,
        lease_duration_seconds: leaseDurationSeconds,
        agent_statuses: {},
      },
    },
  };
  return {
    state: nextState,
    job: listRemoteAgentJobs(nextState).find((entry) => entry.job_id === jobId)!,
  };
}

export function listRemoteAgentJobs(state: PersistedRemoteAgentState): RemoteAgentCollectionJobSummary[] {
  const nowMs = Date.now();
  return Object.values(state.jobs)
    .map((job) => toRemoteAgentJobSummary(job, state, nowMs))
    .sort((left, right) => right.created_at.localeCompare(left.created_at) || left.job_id.localeCompare(right.job_id));
}

export function leaseRemoteAgentJob(input: {
  state: PersistedRemoteAgentState;
  request: RemoteAgentLeaseJobRequest;
}): { state: PersistedRemoteAgentState; response: RemoteAgentLeaseJobResponse } {
  const record = authenticateRemoteAgent(input.state, input.request.agent_id, input.request.agent_token);
  if (!record) {
    throw new Error("Unauthorized remote agent job lease.");
  }

  const nowMs = Date.now();
  const activeLease = Object.values(input.state.jobs)
    .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.job_id.localeCompare(right.job_id))
    .find((job) => {
      const assignment = job.agent_statuses[record.agent_id];
      return Boolean(assignment && assignment.status === "leased" && !isExpired(assignment.lease_expires_at, nowMs));
    });
  if (activeLease) {
    const assignment = activeLease.agent_statuses[record.agent_id]!;
    return {
      state: input.state,
      response: {
        agent_id: record.agent_id,
        job: buildLeasedJob(activeLease, assignment),
      },
    };
  }

  const job = Object.values(input.state.jobs)
    .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.job_id.localeCompare(right.job_id))
    .find((entry) => agentMatchesSelector(record, entry.selector) && isLeaseCandidate(entry, record.agent_id, nowMs));
  if (!job) {
    return {
      state: input.state,
      response: {
        agent_id: record.agent_id,
      },
    };
  }

  const leasedAt = new Date(nowMs).toISOString();
  const leaseExpiresAt = new Date(nowMs + job.lease_duration_seconds * 1000).toISOString();
  const nextAssignment: PersistedRemoteAgentJobAgentState = {
    agent_id: record.agent_id,
    status: "leased",
    leased_at: leasedAt,
    lease_expires_at: leaseExpiresAt,
    imported_source_ids: [],
    replaced_source_ids: [],
    skipped_source_ids: [],
  };
  const nextJob: PersistedRemoteAgentJobRecord = {
    ...job,
    agent_statuses: {
      ...job.agent_statuses,
      [record.agent_id]: nextAssignment,
    },
  };
  const nextState: PersistedRemoteAgentState = {
    ...input.state,
    jobs: {
      ...input.state.jobs,
      [job.job_id]: nextJob,
    },
  };
  return {
    state: nextState,
    response: {
      agent_id: record.agent_id,
      job: buildLeasedJob(nextJob, nextAssignment),
    },
  };
}

export function completeRemoteAgentJob(input: {
  state: PersistedRemoteAgentState;
  jobId: string;
  request: RemoteAgentCompleteJobRequest;
}): { state: PersistedRemoteAgentState; response: RemoteAgentCompleteJobResponse } {
  const record = authenticateRemoteAgent(input.state, input.request.agent_id, input.request.agent_token);
  if (!record) {
    throw new Error("Unauthorized remote agent job completion.");
  }
  const lease = requireLeasedJobAssignment(input.state, input.jobId, record.agent_id, { requireActiveLease: false });
  if (lease.assignment.status !== "leased") {
    throw new Error(`Remote agent job ${input.jobId} is not leased by ${record.agent_id}.`);
  }

  const completedAt = new Date().toISOString();
  const nextAssignment: PersistedRemoteAgentJobAgentState = {
    ...lease.assignment,
    status: input.request.status,
    completed_at: completedAt,
    bundle_id: input.request.bundle_id ?? lease.assignment.bundle_id,
    imported_source_ids: normalizeStringList(input.request.imported_source_ids ?? lease.assignment.imported_source_ids),
    replaced_source_ids: normalizeStringList(input.request.replaced_source_ids ?? lease.assignment.replaced_source_ids),
    skipped_source_ids: normalizeStringList(input.request.skipped_source_ids ?? lease.assignment.skipped_source_ids),
    error_message:
      input.request.status === "failed"
        ? input.request.error_message?.trim() || lease.assignment.error_message || "Remote agent job failed."
        : undefined,
  };
  const nextJob: PersistedRemoteAgentJobRecord = {
    ...lease.job,
    agent_statuses: {
      ...lease.job.agent_statuses,
      [record.agent_id]: nextAssignment,
    },
  };
  return {
    state: {
      ...input.state,
      jobs: {
        ...input.state.jobs,
        [lease.job.job_id]: nextJob,
      },
    },
    response: {
      job_id: lease.job.job_id,
      agent_id: record.agent_id,
      status: input.request.status,
      completed_at: completedAt,
    },
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

function buildPersistedSourceState(
  entry: RemoteAgentSourceManifestEntry,
  collectedAt: string,
): PersistedRemoteAgentSourceState {
  return {
    source_id: entry.source_id,
    slot_id: entry.slot_id,
    platform: entry.platform,
    display_name: entry.display_name,
    base_dir: entry.base_dir,
    sync_status: entry.sync_status,
    presence: entry.presence,
    total_turns: entry.total_turns,
    payload_checksum: entry.payload_checksum,
    last_generation: entry.generation,
    last_collected_at: collectedAt,
    included_in_bundle: entry.included_in_bundle,
    error_message: entry.error_message,
  };
}

function toSourceManifestEntry(source: PersistedRemoteAgentSourceState): RemoteAgentSourceManifestEntry {
  return {
    source_id: source.source_id,
    slot_id: source.slot_id,
    platform: source.platform,
    display_name: source.display_name,
    base_dir: source.base_dir,
    sync_status: source.sync_status,
    presence: source.presence,
    total_turns: source.total_turns,
    payload_checksum: source.payload_checksum,
    generation: source.last_generation,
    included_in_bundle: source.included_in_bundle,
    error_message: source.error_message,
  };
}

function toRemoteAgentJobSummary(
  job: PersistedRemoteAgentJobRecord,
  state: PersistedRemoteAgentState,
  nowMs: number,
): RemoteAgentCollectionJobSummary {
  const matchedAgentIds = Object.values(state.agents)
    .filter((agent) => agentMatchesSelector(agent, job.selector))
    .map((agent) => agent.agent_id)
    .sort();
  const agentIds = [...new Set([...matchedAgentIds, ...Object.keys(job.agent_statuses)])].sort();
  const agentStatuses = agentIds.map((agentId) => toJobAgentStatus(agentId, job.agent_statuses[agentId], nowMs));
  return {
    job_id: job.job_id,
    trigger_kind: job.trigger_kind,
    selector: job.selector,
    source_slots: job.source_slots,
    sync_mode: job.sync_mode,
    limit_files_per_source: job.limit_files_per_source,
    expected_generation: job.expected_generation,
    created_at: job.created_at,
    lease_duration_seconds: job.lease_duration_seconds,
    status: deriveJobSummaryStatus(agentStatuses),
    matched_agent_ids: matchedAgentIds,
    agent_statuses: agentStatuses,
  };
}

function toJobAgentStatus(
  agentId: string,
  assignment: PersistedRemoteAgentJobAgentState | undefined,
  nowMs: number,
): RemoteAgentJobAgentStatus {
  if (!assignment) {
    return {
      agent_id: agentId,
      status: "pending",
    };
  }
  if (assignment.status === "leased" && isExpired(assignment.lease_expires_at, nowMs)) {
    return {
      agent_id: agentId,
      status: "pending",
    };
  }
  return {
    agent_id: agentId,
    status: assignment.status,
    leased_at: assignment.leased_at,
    lease_expires_at: assignment.lease_expires_at,
    completed_at: assignment.completed_at,
    bundle_id: assignment.bundle_id,
    imported_source_ids: [...assignment.imported_source_ids],
    replaced_source_ids: [...assignment.replaced_source_ids],
    skipped_source_ids: [...assignment.skipped_source_ids],
    error_message: assignment.error_message,
  };
}

function deriveJobSummaryStatus(statuses: RemoteAgentJobAgentStatus[]): RemoteAgentJobLifecycleStatus {
  if (statuses.some((status) => status.status === "leased")) {
    return "leased";
  }
  if (statuses.some((status) => status.status === "failed")) {
    return "failed";
  }
  if (statuses.length > 0 && statuses.every((status) => status.status === "succeeded")) {
    return "succeeded";
  }
  return "pending";
}

function buildLeasedJob(job: PersistedRemoteAgentJobRecord, assignment: PersistedRemoteAgentJobAgentState): RemoteAgentLeasedJob {
  return {
    job_id: job.job_id,
    trigger_kind: job.trigger_kind,
    selector: job.selector,
    source_slots: job.source_slots,
    sync_mode: job.sync_mode,
    limit_files_per_source: job.limit_files_per_source,
    expected_generation: job.expected_generation,
    created_at: job.created_at,
    leased_at: assignment.leased_at!,
    lease_expires_at: assignment.lease_expires_at!,
  };
}

function normalizePersistedSourceStates(value: unknown): Record<string, PersistedRemoteAgentSourceState> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([sourceId, source]) => {
      if (typeof source?.source_id !== "string" || typeof source?.slot_id !== "string" || typeof source?.platform !== "string") {
        return [];
      }
      return [[
        sourceId,
        {
          source_id: source.source_id,
          slot_id: source.slot_id,
          platform: source.platform,
          display_name: typeof source.display_name === "string" ? source.display_name : source.source_id,
          base_dir: typeof source.base_dir === "string" ? source.base_dir : "",
          sync_status: source.sync_status === "error" || source.sync_status === "stale" ? source.sync_status : "healthy",
          presence: source.presence === "absent" || source.presence === "unreadable" ? source.presence : "present",
          total_turns: typeof source.total_turns === "number" ? source.total_turns : 0,
          payload_checksum: typeof source.payload_checksum === "string" ? source.payload_checksum : undefined,
          last_generation: typeof source.last_generation === "number" ? source.last_generation : 0,
          last_collected_at: typeof source.last_collected_at === "string" ? source.last_collected_at : new Date().toISOString(),
          included_in_bundle: Boolean(source.included_in_bundle),
          error_message: typeof source.error_message === "string" ? source.error_message : undefined,
        } satisfies PersistedRemoteAgentSourceState,
      ]] as const;
    }),
  );
}

function normalizePersistedJobRecord(value: unknown): PersistedRemoteAgentJobRecord | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.job_id !== "string") {
    return undefined;
  }
  const selector = normalizeJobSelector(raw.selector);
  const sourceSlots = normalizeJobSourceSlots(raw.source_slots, { allowDefaultAll: false });
  const syncMode = normalizeJobSyncMode(raw.sync_mode);
  const triggerKind = normalizeJobTriggerKind(raw.trigger_kind);
  if (!selector || !sourceSlots || !syncMode || !triggerKind) {
    return undefined;
  }
  return {
    job_id: raw.job_id,
    trigger_kind: triggerKind,
    selector,
    source_slots: sourceSlots,
    sync_mode: syncMode,
    limit_files_per_source: normalizeOptionalPositiveInteger(raw.limit_files_per_source, "limit_files_per_source"),
    expected_generation: normalizeOptionalPositiveInteger(raw.expected_generation, "expected_generation"),
    created_at: typeof raw.created_at === "string" ? raw.created_at : new Date().toISOString(),
    lease_duration_seconds: normalizePositiveInteger(raw.lease_duration_seconds ?? 300, "lease_duration_seconds"),
    agent_statuses: normalizePersistedJobAgentStates(raw.agent_statuses),
  };
}

function normalizePersistedJobAgentStates(value: unknown): Record<string, PersistedRemoteAgentJobAgentState> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([agentId, assignment]) => {
      const status = assignment?.status;
      if (
        typeof assignment?.agent_id !== "string" ||
        (status !== "leased" && status !== "succeeded" && status !== "failed")
      ) {
        return [];
      }
      return [[
        agentId,
        {
          agent_id: assignment.agent_id,
          status,
          leased_at: typeof assignment.leased_at === "string" ? assignment.leased_at : undefined,
          lease_expires_at: typeof assignment.lease_expires_at === "string" ? assignment.lease_expires_at : undefined,
          completed_at: typeof assignment.completed_at === "string" ? assignment.completed_at : undefined,
          bundle_id: typeof assignment.bundle_id === "string" ? assignment.bundle_id : undefined,
          imported_source_ids: normalizeStringList(assignment.imported_source_ids),
          replaced_source_ids: normalizeStringList(assignment.replaced_source_ids),
          skipped_source_ids: normalizeStringList(assignment.skipped_source_ids),
          error_message: typeof assignment.error_message === "string" ? assignment.error_message : undefined,
        } satisfies PersistedRemoteAgentJobAgentState,
      ]] as const;
    }),
  );
}

function normalizeJobSelector(value: unknown): RemoteAgentJobSelector | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.kind !== "string") {
    return undefined;
  }
  if (raw.kind === "all") {
    return { kind: "all" };
  }
  if (raw.kind === "agent_ids") {
    const agentIds = normalizeStringList(raw.agent_ids);
    return agentIds.length > 0 ? { kind: "agent_ids", agent_ids: agentIds } : undefined;
  }
  if (raw.kind === "labels") {
    const labels = normalizeLabels(Array.isArray(raw.labels) ? raw.labels as string[] : []);
    return labels.length > 0 ? { kind: "labels", labels } : undefined;
  }
  return undefined;
}

function normalizeJobSourceSlots(
  value: unknown,
  options: { allowDefaultAll: boolean },
): "all" | string[] | undefined {
  if (value === undefined) {
    return options.allowDefaultAll ? "all" : undefined;
  }
  if (value === "all") {
    return "all";
  }
  const slots = normalizeStringList(value);
  return slots.length > 0 ? slots : undefined;
}

function normalizeJobSyncMode(value: unknown): RemoteAgentJobSyncMode | undefined {
  return value === "dirty_snapshot" || value === "force_snapshot" ? value : undefined;
}

function normalizeJobTriggerKind(value: unknown): RemoteAgentJobTriggerKind | undefined {
  return value === "manual" || value === "scheduled" || value === "server_requested" ? value : undefined;
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter((entry) => entry.length > 0))]
    : [];
}

function normalizePositiveInteger(value: unknown, fieldName: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
  return Number(value);
}

function normalizeOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return normalizePositiveInteger(value, fieldName);
}

function agentMatchesSelector(agent: PersistedRemoteAgentRecord, selector: RemoteAgentJobSelector): boolean {
  if (selector.kind === "all") {
    return true;
  }
  if (selector.kind === "agent_ids") {
    return selector.agent_ids.includes(agent.agent_id);
  }
  return selector.labels.some((label) => agent.labels.includes(label));
}

function isLeaseCandidate(job: PersistedRemoteAgentJobRecord, agentId: string, nowMs: number): boolean {
  const assignment = job.agent_statuses[agentId];
  if (!assignment) {
    return true;
  }
  if (assignment.status === "leased") {
    return isExpired(assignment.lease_expires_at, nowMs);
  }
  return false;
}

function requireLeasedJobAssignment(
  state: PersistedRemoteAgentState,
  jobId: string,
  agentId: string,
  options: { requireActiveLease: boolean },
): { job: PersistedRemoteAgentJobRecord; assignment: PersistedRemoteAgentJobAgentState } {
  const job = state.jobs[jobId];
  if (!job) {
    throw new Error(`Remote agent job not found: ${jobId}`);
  }
  const assignment = job.agent_statuses[agentId];
  if (!assignment || assignment.status !== "leased") {
    throw new Error(`Remote agent job ${jobId} is not leased by ${agentId}.`);
  }
  if (options.requireActiveLease && isExpired(assignment.lease_expires_at, Date.now())) {
    throw new Error(`Remote agent job lease expired for ${jobId}.`);
  }
  return { job, assignment };
}

function isExpired(value: string | undefined, nowMs: number): boolean {
  if (!value) {
    return true;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) || timestamp <= nowMs;
}

function normalizeLabels(labels: string[]): string[] {
  return [...new Set(labels.map((value) => value.trim()).filter((value) => value.length > 0))].sort();
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

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
