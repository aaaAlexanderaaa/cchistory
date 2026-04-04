import type {
  RemoteAgentJobLifecycleStatus,
  RemoteAgentJobSelector,
  RemoteAgentJobSyncMode,
  RemoteAgentJobTriggerKind,
  RemoteAgentSourceManifestEntry,
} from "@cchistory/domain";

export interface PersistedRemoteAgentSourceState {
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

export interface PersistedRemoteAgentRecord {
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

export interface PersistedRemoteAgentJobAgentState {
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

export interface PersistedRemoteAgentJobRecord {
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

export const EMPTY_REMOTE_AGENT_STATE: PersistedRemoteAgentState = {
  version: 2,
  agents: {},
  jobs: {},
};
