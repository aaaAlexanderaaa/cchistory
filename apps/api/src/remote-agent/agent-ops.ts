import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  RemoteAgentAdminSummary,
  RemoteAgentHeartbeatRequest,
  RemoteAgentHeartbeatResponse,
  RemoteAgentJobSelector,
  RemoteAgentPairResponse,
  RemoteAgentSourceManifestEntry,
} from "@cchistory/domain";
import {
  type PersistedRemoteAgentRecord,
  type PersistedRemoteAgentSourceState,
  type PersistedRemoteAgentState,
} from "./types.js";
import { normalizeLabels } from "./state-io.js";

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
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
  const expected = Buffer.from(record.agent_token_sha256);
  const actual = Buffer.from(sha256(agentToken));
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? record : undefined;
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

export function buildPersistedSourceState(
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

export function toSourceManifestEntry(source: PersistedRemoteAgentSourceState): RemoteAgentSourceManifestEntry {
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

export function agentMatchesSelector(
  agent: PersistedRemoteAgentRecord,
  selector: RemoteAgentJobSelector,
): boolean {
  if (selector.kind === "all") {
    return true;
  }
  if (selector.kind === "agent_ids") {
    return selector.agent_ids.includes(agent.agent_id);
  }
  return selector.labels.some((label) => agent.labels.includes(label));
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
