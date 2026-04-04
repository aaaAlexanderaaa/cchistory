import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  RemoteAgentJobSelector,
  RemoteAgentJobSyncMode,
  RemoteAgentJobTriggerKind,
} from "@cchistory/domain";
import {
  EMPTY_REMOTE_AGENT_STATE,
  type PersistedRemoteAgentJobAgentState,
  type PersistedRemoteAgentJobRecord,
  type PersistedRemoteAgentRecord,
  type PersistedRemoteAgentSourceState,
  type PersistedRemoteAgentState,
} from "./types.js";

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

export function normalizeJobSelector(value: unknown): RemoteAgentJobSelector | undefined {
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

export function normalizeJobSourceSlots(
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

export function normalizeJobSyncMode(value: unknown): RemoteAgentJobSyncMode | undefined {
  return value === "dirty_snapshot" || value === "force_snapshot" ? value : undefined;
}

export function normalizeJobTriggerKind(value: unknown): RemoteAgentJobTriggerKind | undefined {
  return value === "manual" || value === "scheduled" || value === "server_requested" ? value : undefined;
}

export function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter((entry) => entry.length > 0))]
    : [];
}

export function normalizePositiveInteger(value: unknown, fieldName: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
  return Number(value);
}

export function normalizeOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return normalizePositiveInteger(value, fieldName);
}

export function normalizeLabels(labels: string[]): string[] {
  return [...new Set(labels.map((value) => value.trim()).filter((value) => value.length > 0))].sort();
}
