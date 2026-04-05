
export type SourceFamily = "local_coding_agent" | "conversational_export" | "local_runtime_sessions" | "manual_export_bundles";

export type SourcePlatform =
  | "codex"
  | "claude_code"
  | "factory_droid"
  | "amp"
  | "cursor"
  | "antigravity"
  | "openclaw"
  | "opencode"
  | "chatgpt"
  | "claude_web"
  | "gemini"
  | "lobechat"
  | "codebuddy"
  | "other";

export type LinkState = "committed" | "candidate" | "unlinked";
export type SyncAxis = "current" | "superseded" | "source_absent" | "import_snapshot";
export type ValueAxis = "active" | "covered" | "archived" | "suppressed";
export type RetentionAxis = "keep_raw_and_derived" | "keep_raw_only" | "purged";
export type ProjectLinkageState = Exclude<LinkState, "unlinked">;
export type ManualOverrideStatus = "none" | "applied" | "rejected" | "required";

export interface TurnIdentity {
  turn_id: string;
  turn_revision_id: string;
}

export interface ProjectRevisionIdentity {
  project_id: string;
  project_revision_id: string;
}

export interface ArtifactIdentity {
  artifact_id: string;
  artifact_revision_id: string;
}

export interface LifecycleState {
  sync_axis: SyncAxis;
  value_axis: ValueAxis;
  retention_axis: RetentionAxis;
}

export type StageKind =
  | "capture"
  | "extract_records"
  | "parse_source_fragments"
  | "atomize"
  | "derive_candidates"
  | "finalize_projections"
  | "apply_masks"
  | "index_projections";

export type ParserCapability =
  | "session_meta"
  | "title_signal"
  | "workspace_signal"
  | "model_signal"
  | "token_usage"
  | "text_fragments"
  | "tool_calls"
  | "tool_results"
  | "submission_group_candidates"
  | "project_observation_candidates"
  | "turn_projections"
  | "turn_context_projections"
  | "loss_audits";

export interface SourceFormatProfile {
  id: string;
  family: SourceFamily;
  platform: SourcePlatform;
  parser_version: string;
  description: string;
  capabilities: ParserCapability[];
}

export type CanonicalOrderingView =
  | "raw_session_debug"
  | "global_turn_recall"
  | "project_feed"
  | "project_list"
  | "linking_inbox"
  | "source_admin_diagnostics";

export type CanonicalOrderingField =
  | "event_time"
  | "seq_no"
  | "submission_started_at"
  | "last_context_activity_at"
  | "last_committed_turn_activity_at"
  | "project_last_activity_at"
  | "review_priority"
  | "health_severity"
  | "created_at"
  | "updated_at";

export interface CanonicalOrderingTerm {
  field: CanonicalOrderingField;
  direction: "asc" | "desc";
  nulls?: "first" | "last";
}

/** Canonical ranking for source sync status used in health-based sorting (lower = worse). */
export const statusRank = { error: 0, stale: 1, healthy: 2 } as const;

export const CANONICAL_ORDERING_POLICIES: Record<
  CanonicalOrderingView,
  readonly CanonicalOrderingTerm[]
> = {
  raw_session_debug: [
    { field: "event_time", direction: "asc" },
    { field: "seq_no", direction: "asc" },
  ],
  global_turn_recall: [{ field: "submission_started_at", direction: "desc" }],
  project_feed: [{ field: "last_committed_turn_activity_at", direction: "desc" }],
  project_list: [{ field: "project_last_activity_at", direction: "desc" }],
  linking_inbox: [
    { field: "review_priority", direction: "desc" },
    { field: "submission_started_at", direction: "desc" },
  ],
  source_admin_diagnostics: [
    { field: "health_severity", direction: "desc" },
    { field: "updated_at", direction: "desc" },
  ],
};

export type FragmentKind =
  | "session_meta"
  | "title_signal"
  | "workspace_signal"
  | "model_signal"
  | "token_usage_signal"
  | "session_relation"
  | "text"
  | "tool_call"
  | "tool_result"
  | "unknown";

export type ActorKind = "user" | "assistant" | "system" | "tool";
export type OriginKind =
  | "user_authored"
  | "assistant_authored"
  | "injected_user_shaped"
  | "delegated_instruction"
  | "automation_trigger"
  | "source_instruction"
  | "tool_generated"
  | "source_meta";
export type ContentKind = "text" | "tool_call" | "tool_result" | "meta_signal";
export type DisplayPolicy = "show" | "collapse" | "hide";

export type AtomEdgeKind =
  | "tool_result_for"
  | "spawned_from"
  | "same_submission"
  | "continuation_of"
  | "derived_from_fragment";

export type CandidateKind =
  | "submission_group"
  | "turn"
  | "context_span"
  | "turn_context"
  | "project_observation";

export interface SourceDefinition {
  id: string;
  slot_id: string;
  family: SourceFamily;
  platform: SourcePlatform;
  display_name: string;
  base_dir: string;
}

export interface SourceInstance extends SourceDefinition {
  host_id: string;
  last_sync: string | null;
  sync_status: "healthy" | "stale" | "error";
  error_message?: string;
}

export interface SourceStatus extends SourceInstance {
  total_blobs: number;
  total_records: number;
  total_fragments: number;
  total_atoms: number;
  total_sessions: number;
  total_turns: number;
}

export interface StageRun {
  id: string;
  source_id: string;
  stage_kind: StageKind;
  parser_version?: string;
  parser_capabilities?: ParserCapability[];
  source_format_profile_ids?: string[];
  started_at: string;
  finished_at: string;
  status: "success" | "error";
  stats: Record<string, number>;
  error_message?: string;
}

export interface LossAuditRecord {
  id: string;
  source_id: string;
  stage_run_id: string;
  stage_kind: StageKind;
  diagnostic_code: string;
  severity: "info" | "warning" | "error";
  scope_ref: string;
  session_ref?: string;
  blob_ref?: string;
  record_ref?: string;
  fragment_ref?: string;
  atom_ref?: string;
  candidate_ref?: string;
  source_format_profile_id?: string;
  loss_kind: "unknown_fragment" | "opaque_atom" | "dropped_for_projection";
  detail: string;
  created_at: string;
}

export interface CapturedBlob {
  id: string;
  source_id: string;
  host_id: string;
  origin_path: string;
  captured_path?: string;
  checksum: string;
  size_bytes: number;
  captured_at: string;
  capture_run_id: string;
  file_modified_at?: string;
}

export interface RawRecord {
  id: string;
  source_id: string;
  blob_id: string;
  session_ref: string;
  ordinal: number;
  record_path_or_offset: string;
  observed_at: string;
  parseable: boolean;
  raw_json: string;
}

export interface RawEvent {
  id: string;
  source_id: string;
  session_ref: string;
  observed_at: string;
  record_ref: string;
  blob_ref: string;
  payload: Record<string, unknown>;
}

export interface SourceFragment {
  id: string;
  source_id: string;
  session_ref: string;
  record_id: string;
  seq_no: number;
  fragment_kind: FragmentKind;
  actor_kind?: ActorKind;
  origin_kind?: OriginKind;
  time_key: string;
  payload: Record<string, unknown>;
  raw_refs: string[];
  source_format_profile_id: string;
}

export interface ConversationAtom {
  id: string;
  source_id: string;
  session_ref: string;
  seq_no: number;
  actor_kind: ActorKind;
  origin_kind: OriginKind;
  content_kind: ContentKind;
  time_key: string;
  display_policy: DisplayPolicy;
  payload: Record<string, unknown>;
  fragment_refs: string[];
  source_format_profile_id: string;
}

export interface AtomEdge {
  id: string;
  source_id: string;
  session_ref: string;
  from_atom_id: string;
  to_atom_id: string;
  edge_kind: AtomEdgeKind;
}

export interface DerivedCandidate {
  id: string;
  source_id: string;
  session_ref: string;
  candidate_kind: CandidateKind;
  input_atom_refs: string[];
  started_at: string;
  ended_at: string;
  rule_version: string;
  evidence: Record<string, unknown>;
}

export interface ProjectObservation {
  id: string;
  source_id: string;
  session_ref: string;
  observed_at: string;
  confidence: number;
  workspace_path?: string;
  workspace_path_normalized?: string;
  repo_root?: string;
  repo_remote?: string;
  repo_fingerprint?: string;
  source_native_project_ref?: string;
  evidence: Record<string, unknown>;
}

export type ProjectLinkReason =
  | "repo_fingerprint_match"
  | "repo_remote_match"
  | "repo_root_match"
  | "workspace_path_continuity"
  | "source_native_project"
  | "manual_override"
  | "weak_path_hint"
  | "metadata_hint";

export interface ProjectIdentity extends ProjectRevisionIdentity {
  display_name: string;
  slug: string;
  linkage_state: ProjectLinkageState;
  confidence: number;
  link_reason: ProjectLinkReason;
  manual_override_status: ManualOverrideStatus;
  primary_workspace_path?: string;
  source_native_project_ref?: string;
  repo_root?: string;
  repo_remote?: string;
  repo_fingerprint?: string;
  source_platforms: SourcePlatform[];
  host_ids: string[];
  committed_turn_count: number;
  candidate_turn_count: number;
  session_count: number;
  project_last_activity_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectLinkRevision extends ProjectRevisionIdentity {
  id: string;
  linkage_state: ProjectLinkageState;
  confidence: number;
  link_reason: ProjectLinkReason;
  manual_override_status: ManualOverrideStatus;
  observation_refs: string[];
  supersedes_project_revision_id?: string;
  created_at: string;
}

export type ManualOverrideTargetKind = "turn" | "session" | "observation";

export interface ProjectManualOverride {
  id: string;
  target_kind: ManualOverrideTargetKind;
  target_ref: string;
  project_id: string;
  display_name: string;
  created_at: string;
  updated_at: string;
  note?: string;
}

export interface ProjectLineageEvent {
  id: string;
  project_id: string;
  project_revision_id: string;
  previous_project_revision_id?: string;
  event_kind: "created" | "revised" | "manual_override" | "superseded" | "split" | "merge";
  created_at: string;
  detail: Record<string, unknown>;
}

export interface ImportBundle {
  id: string;
  source_family: SourceFamily;
  source_platform?: SourcePlatform;
  bundle_version: string;
  captured_at: string;
  host_id?: string;
  manifest: Record<string, unknown>;
}

export interface BundleObjectCounts {
  sources: number;
  sessions: number;
  turns: number;
  blobs: number;
}

export interface ImportBundleManifest {
  bundle_id: string;
  bundle_version: string;
  exported_at: string;
  exported_from_host_ids: string[];
  schema_version: string;
  source_instance_ids: string[];
  counts: BundleObjectCounts;
  includes_raw_blobs: boolean;
  created_by: string;
}

export interface BundleChecksums {
  manifest_sha256: string;
  payload_sha256_by_source_id: Record<string, string>;
  raw_sha256_by_path: Record<string, string>;
}

export interface ImportedBundleRecord {
  bundle_id: string;
  bundle_version: string;
  imported_at: string;
  source_instance_ids: string[];
  manifest: ImportBundleManifest;
  checksums: BundleChecksums;
}

export type RemoteSourcePresence = "present" | "unreadable" | "absent";

export interface RemoteAgentPairRequest {
  pairing_token: string;
  display_name?: string;
  reported_hostname?: string;
}

export interface RemoteAgentPairResponse {
  agent_id: string;
  agent_token: string;
  paired_at: string;
}

export interface RemoteAgentBundlePayload {
  manifest: ImportBundleManifest;
  checksums: BundleChecksums;
  payloads: SourceSyncPayload[];
  raw_blobs_base64_by_path: Record<string, string>;
}

export interface RemoteAgentSourceManifestEntry {
  source_id: string;
  slot_id: string;
  platform: SourcePlatform;
  display_name: string;
  base_dir: string;
  sync_status: SourceStatus["sync_status"];
  presence: RemoteSourcePresence;
  total_turns: number;
  payload_checksum?: string;
  generation: number;
  included_in_bundle: boolean;
  error_message?: string;
}

export interface RemoteAgentUploadRequest {
  agent_id: string;
  agent_token: string;
  job_id?: string;
  collected_at: string;
  bundle: RemoteAgentBundlePayload;
  source_manifest: RemoteAgentSourceManifestEntry[];
}

export interface RemoteAgentUploadResponse {
  bundle_id: string;
  imported_source_ids: string[];
  replaced_source_ids: string[];
  skipped_source_ids: string[];
  source_manifest_count: number;
  /** Server-side accepted generation per source_id, so the client can
   *  reconcile local state even after a crash-before-write scenario. */
  accepted_generations: Record<string, number>;
}

export type RemoteAgentJobTriggerKind = "manual" | "scheduled" | "server_requested";
export type RemoteAgentJobSyncMode = "dirty_snapshot" | "force_snapshot";
export type RemoteAgentJobLifecycleStatus = "pending" | "leased" | "succeeded" | "failed";

export type RemoteAgentJobSelector =
  | { kind: "all" }
  | { kind: "agent_ids"; agent_ids: string[] }
  | { kind: "labels"; labels: string[] };

export interface RemoteAgentJobAgentStatus {
  agent_id: string;
  status: RemoteAgentJobLifecycleStatus;
  leased_at?: string;
  lease_expires_at?: string;
  completed_at?: string;
  bundle_id?: string;
  imported_source_ids?: string[];
  replaced_source_ids?: string[];
  skipped_source_ids?: string[];
  error_message?: string;
}

export interface RemoteAgentCollectionJobSummary {
  job_id: string;
  trigger_kind: RemoteAgentJobTriggerKind;
  selector: RemoteAgentJobSelector;
  source_slots: "all" | string[];
  sync_mode: RemoteAgentJobSyncMode;
  limit_files_per_source?: number;
  expected_generation?: number;
  created_at: string;
  lease_duration_seconds: number;
  status: RemoteAgentJobLifecycleStatus;
  matched_agent_ids: string[];
  agent_statuses: RemoteAgentJobAgentStatus[];
}

export interface RemoteAgentCreateJobRequest {
  trigger_kind?: RemoteAgentJobTriggerKind;
  selector: RemoteAgentJobSelector;
  source_slots?: "all" | string[];
  sync_mode?: RemoteAgentJobSyncMode;
  limit_files_per_source?: number;
  expected_generation?: number;
  lease_duration_seconds?: number;
}

export interface RemoteAgentLeasedJob {
  job_id: string;
  trigger_kind: RemoteAgentJobTriggerKind;
  selector: RemoteAgentJobSelector;
  source_slots: "all" | string[];
  sync_mode: RemoteAgentJobSyncMode;
  limit_files_per_source?: number;
  expected_generation?: number;
  created_at: string;
  leased_at: string;
  lease_expires_at: string;
}

export interface RemoteAgentLeaseJobRequest {
  agent_id: string;
  agent_token: string;
}

export interface RemoteAgentLeaseJobResponse {
  agent_id: string;
  job?: RemoteAgentLeasedJob;
}

export interface RemoteAgentCompleteJobRequest {
  agent_id: string;
  agent_token: string;
  status: "succeeded" | "failed";
  error_message?: string;
  bundle_id?: string;
  imported_source_ids?: string[];
  replaced_source_ids?: string[];
  skipped_source_ids?: string[];
}

export interface RemoteAgentCompleteJobResponse {
  job_id: string;
  agent_id: string;
  status: "succeeded" | "failed";
  completed_at: string;
}

export interface RemoteAgentHeartbeatRequest {
  agent_id: string;
  agent_token: string;
  display_name?: string;
  reported_hostname?: string;
  labels?: string[];
  source_manifest?: RemoteAgentSourceManifestEntry[];
}

export interface RemoteAgentHeartbeatResponse {
  agent_id: string;
  last_seen_at: string;
  source_manifest_count: number;
}

export interface RemoteAgentAdminSummary {
  agent_id: string;
  paired_at: string;
  display_name?: string;
  reported_hostname?: string;
  labels: string[];
  last_seen_at?: string;
  last_upload_at?: string;
  source_manifest: RemoteAgentSourceManifestEntry[];
}

export interface Host {
  id: string;
  hostname: string;
  os?: string;
  first_seen: string;
  last_seen: string;
}

export interface SessionProjection {
  id: string;
  source_id: string;
  source_platform: SourcePlatform;
  host_id: string;
  title?: string;
  created_at: string;
  updated_at: string;
  turn_count: number;
  model?: string;
  working_directory?: string;
  source_native_project_ref?: string;
  primary_project_id?: string;
  sync_axis: SyncAxis;
}

export type SessionRelatedWorkKind = "delegated_session" | "automation_run";
export type SessionRelatedWorkTargetKind = "session" | "automation_run";

export interface SessionRelatedWorkProjection {
  id: string;
  source_id: string;
  source_platform: SourcePlatform;
  source_session_ref: string;
  relation_kind: SessionRelatedWorkKind;
  target_kind: SessionRelatedWorkTargetKind;
  target_session_ref?: string;
  target_run_ref?: string;
  transcript_primary: boolean;
  evidence_confidence: number;
  parent_event_ref?: string;
  parent_tool_ref?: string;
  child_agent_key?: string;
  automation_job_ref?: string;
  automation_run_key?: string;
  title?: string;
  status?: string;
  created_at: string;
  updated_at: string;
  fragment_refs: string[];
  raw_detail: Record<string, unknown>;
}

export interface UserMessageProjection {
  id: string;
  raw_text: string;
  sequence: number;
  is_injected: boolean;
  created_at: string;
  atom_refs: string[];
  canonical_text?: string;
  display_segments?: DisplaySegment[];
}

export type SegmentType = "text" | "masked" | "highlight" | "code" | "reference" | "injected";

export interface DisplaySegment {
  type: SegmentType;
  content: string;
  mask_label?: string;
  mask_char_count?: number;
  mask_template_id?: string;
  highlight_type?: "search" | "diff" | "error";
  is_expanded?: boolean;
  original_content?: string;
}

export type ZeroTokenReason = "no_assistant_reply" | "command_only";

export interface TurnContextSummary {
  assistant_reply_count: number;
  tool_call_count: number;
  token_usage?: TokenUsageSummary;
  total_tokens?: number;
  primary_model?: string;
  has_errors: boolean;
  zero_token_reason?: ZeroTokenReason;
}

export interface TokenUsageSummary {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

export interface UserTurnProjection extends TurnIdentity {
  id: string;
  revision_id: string;
  user_messages: UserMessageProjection[];
  raw_text: string;
  canonical_text: string;
  display_segments: DisplaySegment[];
  created_at: string;
  submission_started_at: string;
  last_context_activity_at: string;
  session_id: string;
  source_id: string;
  project_id?: string;
  project_ref?: string;
  link_state: LinkState;
  project_link_state?: LinkState;
  project_confidence?: number;
  candidate_project_ids?: string[];
  sync_axis: SyncAxis;
  value_axis: ValueAxis;
  retention_axis: RetentionAxis;
  context_ref: string;
  context_summary: TurnContextSummary;
  lineage: {
    atom_refs: string[];
    candidate_refs: string[];
    fragment_refs: string[];
    record_refs: string[];
    blob_refs: string[];
  };
}

export interface SystemMessageProjection {
  id: string;
  content: string;
  display_segments: DisplaySegment[];
  position: "before_user" | "after_user" | "interleaved";
  sequence: number;
  created_at: string;
}

export interface AssistantReplyProjection {
  id: string;
  content: string;
  display_segments: DisplaySegment[];
  content_preview: string;
  token_usage?: TokenUsageSummary;
  token_count?: number;
  model: string;
  created_at: string;
  tool_call_ids: string[];
  stop_reason?: "end_turn" | "tool_use" | "max_tokens" | "error";
}

export interface ToolCallProjection {
  id: string;
  tool_name: string;
  input: Record<string, unknown>;
  input_summary: string;
  input_display_segments: DisplaySegment[];
  output?: string;
  output_preview?: string;
  output_display_segments?: DisplaySegment[];
  status: "pending" | "running" | "success" | "error";
  error_message?: string;
  duration_ms?: number;
  reply_id: string;
  sequence: number;
  created_at: string;
}

export interface TurnContextProjection {
  turn_id: string;
  system_messages: SystemMessageProjection[];
  assistant_replies: AssistantReplyProjection[];
  tool_calls: ToolCallProjection[];
  raw_event_refs: string[];
}

export type TombstoneObjectKind = "project" | "turn" | "artifact";

export interface TombstoneProjection {
  object_kind: TombstoneObjectKind;
  logical_id: string;
  last_revision_id: string;
  sync_axis: SyncAxis;
  value_axis: ValueAxis;
  retention_axis: "purged";
  purged_at: string;
  purge_reason?: string;
  replaced_by_logical_ids?: string[];
  lineage_event_refs?: string[];
}

export type MaskRuleKind = "regex" | "prefix" | "contains" | "exact";

export interface MaskTemplate {
  id: string;
  name: string;
  description?: string;
  rule_kind: MaskRuleKind;
  pattern: string;
  replacement_label: string;
  display_policy: DisplayPolicy;
  created_at: string;
  updated_at: string;
}

export type KnowledgeArtifactKind = "decision" | "instruction" | "fact" | "pattern" | "other";

export interface KnowledgeArtifact extends ArtifactIdentity, LifecycleState {
  artifact_kind: KnowledgeArtifactKind;
  title: string;
  summary: string;
  project_id?: string;
  source_turn_refs: string[];
  created_at: string;
  updated_at: string;
}

export interface ArtifactCoverageRecord {
  id: string;
  artifact_id: string;
  artifact_revision_id: string;
  turn_id: string;
  created_at: string;
}

export interface SearchDocument {
  turn_id: string;
  project_id?: string;
  source_id: string;
  link_state: LinkState;
  value_axis: ValueAxis;
  canonical_text: string;
  raw_text: string;
  updated_at: string;
}

export interface SearchHighlight {
  start: number;
  end: number;
}

export interface TurnSearchResult {
  turn: UserTurnProjection;
  session?: SessionProjection;
  project?: ProjectIdentity;
  highlights: SearchHighlight[];
  relevance_score: number;
}

export interface DriftTimelinePoint {
  date: string;
  global_drift_index: number;
  consistency_score: number;
  total_turns: number;
}

export interface DriftReport {
  generated_at: string;
  global_drift_index: number;
  active_sources: number;
  sources_awaiting_sync: number;
  orphaned_turns: number;
  unlinked_turns: number;
  candidate_turns: number;
  consistency_score: number;
  timeline: DriftTimelinePoint[];
}

export interface PipelineLineage {
  turn: UserTurnProjection;
  session?: SessionProjection;
  candidate_chain: DerivedCandidate[];
  atoms: ConversationAtom[];
  edges: AtomEdge[];
  fragments: SourceFragment[];
  records: RawRecord[];
  blobs: CapturedBlob[];
}

export interface SourceSyncPayload {
  source: SourceStatus;
  stage_runs: StageRun[];
  loss_audits: LossAuditRecord[];
  blobs: CapturedBlob[];
  records: RawRecord[];
  fragments: SourceFragment[];
  atoms: ConversationAtom[];
  edges: AtomEdge[];
  candidates: DerivedCandidate[];
  sessions: SessionProjection[];
  turns: UserTurnProjection[];
  contexts: TurnContextProjection[];
}

export type Session = SessionProjection;
export type UserTurn = UserTurnProjection;
export type TurnContext = TurnContextProjection;

export type UsageStatsDimension = "model" | "project" | "source" | "host" | "day" | "month";

export interface UsageStatsOverview {
  generated_at: string;
  total_turns: number;
  turns_with_token_usage: number;
  turn_coverage_ratio: number;
  turns_with_primary_model: number;
  total_input_tokens: number;
  total_cached_input_tokens: number;
  total_output_tokens: number;
  total_reasoning_output_tokens: number;
  total_tokens: number;
  excluded_zero_token_turns?: number;
}

export interface UsageStatsRollupRow {
  key: string;
  label: string;
  dimension: UsageStatsDimension;
  turn_count: number;
  turns_with_token_usage: number;
  turn_coverage_ratio: number;
  turns_with_primary_model: number;
  total_input_tokens: number;
  total_cached_input_tokens: number;
  total_output_tokens: number;
  total_reasoning_output_tokens: number;
  total_tokens: number;
}

export interface UsageStatsRollup {
  generated_at: string;
  dimension: UsageStatsDimension;
  rows: UsageStatsRollupRow[];
  excluded_zero_token_turns?: number;
}

export function deriveSourceSlotId(platform: SourcePlatform): string {
  return platform;
}

export function normalizeSourceBaseDir(baseDir: string): string {
  // Delegate to normalizeLocalPathIdentity for full URI-aware normalization
  // (file:/// stripping, percent-decode, UNC, etc.).  Fall back to the
  // lightweight slash-only normalizer when the input is not a recognisable
  // local path (e.g. a remote URL).
  const identity = normalizeLocalPathIdentity(baseDir);
  if (identity !== undefined) {
    return identity;
  }
  const normalized = baseDir.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
  if (/^[A-Za-z]:/.test(normalized)) {
    return `${normalized.slice(0, 1).toLowerCase()}${normalized.slice(1)}`;
  }
  return normalized;
}


export function normalizeLocalPathIdentity(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  let raw = decodeUriPath(value.trim());
  if (/^file:\/\/localhost\//iu.test(raw)) {
    raw = raw.slice("file://localhost".length);
  } else if (/^file:\/\//iu.test(raw)) {
    const fileUriMatch = raw.match(/^file:\/\/([^/]*)(\/.*)?$/iu);
    if (fileUriMatch) {
      const authority = fileUriMatch[1] ?? "";
      const pathname = fileUriMatch[2] ?? "";
      if (/^[A-Za-z]:$/u.test(authority)) {
        raw = `${authority}${pathname}`;
      } else if (authority) {
        raw = `//${authority}${pathname}`;
      } else {
        raw = pathname;
      }
    } else {
      raw = raw.slice("file://".length);
    }
  }

  raw = raw.replace(/\\/g, "/");

  if (/^\/[A-Za-z]:/u.test(raw)) {
    raw = raw.slice(1);
  }

  const isUncPath = raw.startsWith("//") && !/^\/\/[A-Za-z]:/u.test(raw);
  if (isUncPath) {
    const normalizedUnc = posixNormalize(`/${raw.slice(2)}`);
    return `/${trimTrailingSlash(normalizedUnc)}`;
  }

  const collapsed = raw.replace(/\/+/g, "/");
  if (/^[A-Za-z]:/u.test(collapsed)) {
    const drive = collapsed.slice(0, 1).toLowerCase();
    const rest = collapsed.slice(2);
    const normalizedRest = posixNormalize(rest.startsWith("/") ? rest : `/${rest}`);
    return `${drive}:${trimTrailingSlash(normalizedRest)}`;
  }

  return trimTrailingSlash(posixNormalize(collapsed));
}

export function getLocalPathBasename(value: string | undefined): string | undefined {
  const normalized = normalizeLocalPathIdentity(value);
  if (!normalized) {
    return undefined;
  }
  const basename = posixBasename(normalized);
  return basename || undefined;
}

export function localPathIdentitiesMatch(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalizeLocalPathIdentity(left);
  const normalizedRight = normalizeLocalPathIdentity(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function trimTrailingSlash(value: string): string {
  if (value === "/" || value === "//" || /^[a-z]:\/$/u.test(value)) {
    return value;
  }
  return value.replace(/\/+$/u, "");
}

export function deriveHostId(hostname: string): string {
  return `host-${stableHash(hostname.trim().toLowerCase())}`;
}

export function deriveSourceInstanceId(input: {
  host_id: string;
  slot_id: string;
  base_dir: string;
}): string {
  return `srcinst-${input.slot_id}-${stableHash(`${input.host_id}|${normalizeSourceBaseDir(input.base_dir)}`)}`;
}

export function isLegacySourceInstanceId(sourceId: string): boolean {
  return sourceId.startsWith("src-");
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Pure POSIX path normalization: collapses repeated slashes and resolves `.` / `..` segments.
 * Equivalent to `path.posix.normalize` but requires no Node.js import, keeping the domain
 * package platform-agnostic.
 */
function posixNormalize(value: string): string {
  if (!value) {
    return ".";
  }
  const isAbsolute = value.startsWith("/");
  const parts = value.split("/").filter(Boolean);
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === ".") {
      continue;
    }
    if (part === "..") {
      if (resolved.length > 0 && resolved[resolved.length - 1] !== "..") {
        resolved.pop();
      } else if (!isAbsolute) {
        resolved.push("..");
      }
    } else {
      resolved.push(part);
    }
  }
  const result = (isAbsolute ? "/" : "") + resolved.join("/");
  return result || (isAbsolute ? "/" : ".");
}

/**
 * Pure POSIX basename: returns the final path component.
 * Equivalent to `path.posix.basename` but requires no Node.js import.
 */
function posixBasename(value: string): string {
  const last = value.split("/").filter(Boolean).at(-1);
  return last ?? "";
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";

/**
 * Produce a deterministic, content-addressable hex ID by SHA-1-hashing the
 * joined parts.  Used throughout the pipeline for fragment, atom, edge, and
 * other entity IDs.
 */
export function stableId(...parts: string[]): string {
  return createHash("sha1").update(parts.join("::")).digest("hex");
}

/** Current wall-clock time as an ISO-8601 string. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Return the earlier of two optional ISO-8601 timestamps (or the defined one). */
export function minIso(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return left < right ? left : right;
}

/** Return the later of two optional ISO-8601 timestamps (or the defined one). */
export function maxIso(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return left > right ? left : right;
}

/**
 * Decode percent-encoded segments in a URI path.  Returns the original
 * string when no encoded sequences are detected or decoding fails.
 */
export function decodeUriPath(value: string): string {
  if (!/%[0-9a-f]{2}/iu.test(value)) {
    return value;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
