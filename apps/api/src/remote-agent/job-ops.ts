import { randomBytes } from "node:crypto";
import type {
  RemoteAgentCollectionJobSummary,
  RemoteAgentCompleteJobRequest,
  RemoteAgentCompleteJobResponse,
  RemoteAgentCreateJobRequest,
  RemoteAgentJobAgentStatus,
  RemoteAgentJobLifecycleStatus,
  RemoteAgentLeaseJobRequest,
  RemoteAgentLeaseJobResponse,
  RemoteAgentLeasedJob,
} from "@cchistory/domain";
import {
  type PersistedRemoteAgentJobAgentState,
  type PersistedRemoteAgentJobRecord,
  type PersistedRemoteAgentState,
} from "./types.js";
import { authenticateRemoteAgent, agentMatchesSelector } from "./agent-ops.js";
import {
  normalizeJobSelector,
  normalizeJobSourceSlots,
  normalizeJobSyncMode,
  normalizeJobTriggerKind,
  normalizeOptionalPositiveInteger,
  normalizePositiveInteger,
  normalizeStringList,
} from "./state-io.js";

function isExpired(value: string | undefined, nowMs: number): boolean {
  if (!value) {
    return true;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) || timestamp <= nowMs;
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

export function requireLeasedJobAssignment(
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
