import type {
  DriftReportDto,
  LinkingObservationDto,
  LinkingReviewResponse,
  MaskTemplateDto,
  PipelineLineageDto,
  ProjectLineageEventDto,
  ProjectLinkRevisionDto,
  ProjectManualOverrideDto,
  ProjectSummaryDto,
  SessionProjectionDto,
  SourceStatusDto,
  TurnContextProjectionDto,
  TurnSearchResultDto,
  UserTurnProjectionDto,
} from "../../api-client/dist/index.js";

export type LinkState = "committed" | "candidate" | "unlinked";
export type SyncAxis = "current" | "superseded" | "source_absent" | "import_snapshot";
export type ValueAxis = "active" | "covered" | "archived" | "suppressed";
export type RetentionAxis = "keep_raw_and_derived" | "keep_raw_only" | "purged";
export type SourceFamily = "local_coding_agent" | "conversational_export";
export type SourcePlatform =
  | "claude_code"
  | "codex"
  | "amp"
  | "factory_droid"
  | "cursor"
  | "antigravity"
  | "openclaw"
  | "opencode"
  | "claude_web"
  | "chatgpt"
  | "lobechat"
  | "gemini"
  | "other";

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

export interface UserMessage {
  id: string;
  raw_text: string;
  sequence: number;
  is_injected: boolean;
  created_at: Date;
  canonical_text?: string;
  display_segments: DisplaySegment[];
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

export interface UserTurn {
  id: string;
  revision_id: string;
  user_messages: UserMessage[];
  canonical_text: string;
  display_segments: DisplaySegment[];
  created_at: Date;
  last_context_activity_at: Date;
  session_id: string;
  source_id: string;
  project_id?: string;
  link_state: LinkState;
  project_confidence?: number;
  candidate_project_ids?: string[];
  sync_axis: SyncAxis;
  value_axis: ValueAxis;
  retention_axis: RetentionAxis;
  context_ref: string;
  context_summary: TurnContextSummary;
  tags?: string[];
  is_flagged?: boolean;
  flag_reason?: string;
  covered_by_artifact_id?: string;
}

export interface SystemMessage {
  id: string;
  content: string;
  display_segments: DisplaySegment[];
  position: "before_user" | "after_user" | "interleaved";
  sequence: number;
  created_at: Date;
}

export interface AssistantReply {
  id: string;
  content: string;
  display_segments: DisplaySegment[];
  content_preview: string;
  token_usage?: TokenUsageSummary;
  token_count?: number;
  model: string;
  created_at: Date;
  tool_call_ids: string[];
  stop_reason?: "end_turn" | "tool_use" | "max_tokens" | "error";
}

export interface ToolCall {
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
  created_at: Date;
}

export interface TurnContext {
  turn_id: string;
  system_messages: SystemMessage[];
  assistant_replies: AssistantReply[];
  tool_calls: ToolCall[];
  raw_event_refs: string[];
}

export interface Session {
  id: string;
  source_id: string;
  source_platform: SourcePlatform;
  host_id: string;
  title?: string;
  created_at: Date;
  updated_at: Date;
  turn_count: number;
  model?: string;
  working_directory?: string;
  source_native_project_ref?: string;
  primary_project_id?: string;
  sync_axis: SyncAxis;
}

export interface ProjectIdentity {
  id: string;
  revision_id: string;
  name: string;
  description?: string;
  color: string;
  slug?: string;
  linkage_state: Exclude<LinkState, "unlinked">;
  confidence: number;
  link_reason:
    | "repo_fingerprint_match"
    | "repo_remote_match"
    | "repo_root_match"
    | "workspace_path_continuity"
    | "source_native_project"
    | "manual_override"
    | "weak_path_hint"
    | "metadata_hint";
  manual_override_status: "none" | "applied" | "rejected" | "required";
  primary_workspace_path?: string;
  repo_root?: string;
  primary_repo_remote?: string;
  repo_fingerprint?: string;
  source_platforms: SourcePlatform[];
  host_ids: string[];
  committed_turn_count: number;
  candidate_turn_count: number;
  session_count: number;
  last_activity: Date;
  created_at: Date;
}

export interface ProjectRevision {
  id: string;
  project_id: string;
  project_revision_id: string;
  linkage_state: Exclude<LinkState, "unlinked">;
  confidence: number;
  link_reason: ProjectIdentity["link_reason"];
  manual_override_status: ProjectIdentity["manual_override_status"];
  observation_refs: string[];
  supersedes_project_revision_id?: string;
  created_at: Date;
}

export interface ProjectLineageEvent {
  id: string;
  project_id: string;
  project_revision_id: string;
  previous_project_revision_id?: string;
  event_kind: "created" | "revised" | "manual_override";
  created_at: Date;
  detail: Record<string, unknown>;
}

export interface ProjectManualOverride {
  id: string;
  target_kind: "turn" | "session" | "observation";
  target_ref: string;
  project_id: string;
  display_name: string;
  created_at: Date;
  updated_at: Date;
  note?: string;
}

export interface SourceStatus {
  id: string;
  family: SourceFamily;
  platform: SourcePlatform;
  display_name: string;
  base_dir: string;
  default_base_dir?: string;
  override_base_dir?: string;
  is_overridden: boolean;
  is_default_source: boolean;
  path_exists: boolean;
  host_id: string;
  last_sync: Date | null;
  sync_status: "healthy" | "stale" | "error";
  error_message?: string;
  total_blobs: number;
  total_records: number;
  total_fragments: number;
  total_atoms: number;
  total_sessions: number;
  total_turns: number;
}

export interface MaskTemplate {
  id: string;
  name: string;
  description?: string;
  match_type: "regex" | "prefix" | "contains";
  match_pattern: string;
  action: "collapse";
  collapse_label: string;
  priority: number;
  applies_to: Array<"user_message" | "system_message" | "assistant_reply" | "tool_input" | "tool_output">;
  is_builtin: true;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface DriftTimelinePoint {
  date: Date;
  global_drift_index: number;
  consistency_score: number;
  total_turns: number;
}

export interface DriftReport {
  generated_at: Date;
  global_drift_index: number;
  active_sources: number;
  sources_awaiting_sync: number;
  orphaned_turns: number;
  unlinked_turns: number;
  candidate_turns: number;
  consistency_score: number;
  timeline: DriftTimelinePoint[];
}

export interface SearchResult {
  turn: UserTurn;
  session: Session;
  project?: ProjectIdentity;
  match_highlights: Array<{ start: number; end: number }>;
  relevance_score: number;
}

export interface TurnLineage {
  turn: UserTurn;
  session?: Session;
  candidate_chain: Array<{
    id: string;
    candidate_kind: "submission_group" | "turn" | "context_span" | "project_observation";
    input_atom_refs: string[];
    started_at: Date;
    ended_at: Date;
    rule_version: string;
    evidence: Record<string, unknown>;
  }>;
  atoms: Array<{
    id: string;
    actor_kind: "user" | "assistant" | "system" | "tool";
    origin_kind:
      | "user_authored"
      | "assistant_authored"
      | "injected_user_shaped"
      | "source_instruction"
      | "tool_generated"
      | "source_meta";
    content_kind: "text" | "tool_call" | "tool_result" | "meta_signal";
    time_key: Date;
    payload: Record<string, unknown>;
    fragment_refs: string[];
  }>;
  edges: Array<{
    id: string;
    from_atom_id: string;
    to_atom_id: string;
    edge_kind: "tool_result_for" | "spawned_from" | "same_submission" | "continuation_of" | "derived_from_fragment";
  }>;
  fragments: Array<{
    id: string;
    record_id: string;
    fragment_kind:
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
    time_key: Date;
    payload: Record<string, unknown>;
    raw_refs: string[];
  }>;
  records: Array<{
    id: string;
    blob_id: string;
    record_path_or_offset: string;
    observed_at: Date;
    parseable: boolean;
  }>;
  blobs: Array<{
    id: string;
    origin_path: string;
    captured_path?: string;
    checksum: string;
    size_bytes: number;
    captured_at: Date;
  }>;
}

export interface LinkingObservation {
  id: string;
  source_id: string;
  session_ref: string;
  observed_at: Date;
  confidence: number;
  workspace_path?: string;
  workspace_path_normalized?: string;
  repo_root?: string;
  repo_remote?: string;
  repo_fingerprint?: string;
  source_native_project_ref?: string;
  host_id: string;
  source_platform: Session["source_platform"];
  workspace_subpath?: string;
  project_id?: string;
  linkage_state?: Exclude<LinkState, "unlinked">;
  link_reason?: LinkingObservationDto["link_reason"];
}

export interface LinkingReviewData {
  committed_projects: ProjectIdentity[];
  candidate_projects: ProjectIdentity[];
  unlinked_turns: UserTurn[];
  candidate_turns: UserTurn[];
  project_observations: LinkingObservation[];
}

export function mapUserTurn(turn: UserTurnProjectionDto): UserTurn {
  return {
    id: turn.id,
    revision_id: turn.revision_id,
    user_messages: turn.user_messages.map((message) => ({
      id: message.id,
      raw_text: message.raw_text,
      sequence: message.sequence,
      is_injected: message.is_injected,
      created_at: new Date(message.created_at),
      canonical_text: message.canonical_text,
      display_segments: message.display_segments ?? [
        {
          type: message.is_injected ? "injected" : "text",
          content: message.raw_text,
        },
      ],
    })),
    canonical_text: turn.canonical_text,
    display_segments: turn.display_segments,
    created_at: new Date(turn.submission_started_at || turn.created_at),
    last_context_activity_at: new Date(turn.last_context_activity_at),
    session_id: turn.session_id,
    source_id: turn.source_id,
    project_id: turn.project_id,
    link_state: turn.link_state,
    project_confidence: turn.project_confidence,
    candidate_project_ids: turn.candidate_project_ids,
    sync_axis: turn.sync_axis,
    value_axis: turn.value_axis,
    retention_axis: turn.retention_axis,
    context_ref: turn.context_ref,
    context_summary: turn.context_summary,
  };
}

export function mapTurnContext(context: TurnContextProjectionDto): TurnContext {
  return {
    turn_id: context.turn_id,
    system_messages: context.system_messages.map((message) => ({
      ...message,
      created_at: new Date(message.created_at),
    })),
    assistant_replies: context.assistant_replies.map((reply) => ({
      ...reply,
      created_at: new Date(reply.created_at),
    })),
    tool_calls: context.tool_calls.map((toolCall) => ({
      ...toolCall,
      created_at: new Date(toolCall.created_at),
    })),
    raw_event_refs: context.raw_event_refs,
  };
}

export function mapSession(session: SessionProjectionDto): Session {
  return {
    ...session,
    created_at: new Date(session.created_at),
    updated_at: new Date(session.updated_at),
  };
}

export function mapProject(project: ProjectSummaryDto): ProjectIdentity {
  return {
    id: project.project_id,
    revision_id: project.project_revision_id,
    name: project.display_name,
    color: projectColor(project.project_id),
    slug: project.slug,
    linkage_state: project.linkage_state,
    confidence: project.confidence,
    link_reason: project.link_reason,
    manual_override_status: project.manual_override_status,
    primary_workspace_path: project.primary_workspace_path,
    repo_root: project.repo_root,
    primary_repo_remote: project.repo_remote,
    repo_fingerprint: project.repo_fingerprint,
    committed_turn_count: project.committed_turn_count,
    candidate_turn_count: project.candidate_turn_count,
    session_count: project.session_count,
    source_platforms: project.source_platforms,
    host_ids: project.host_ids,
    last_activity: new Date(project.project_last_activity_at ?? project.updated_at),
    created_at: new Date(project.created_at),
  };
}

export function mapLinkingObservation(observation: LinkingObservationDto): LinkingObservation {
  return {
    ...observation,
    observed_at: new Date(observation.observed_at),
  };
}

export function mapLinkingReview(review: LinkingReviewResponse): LinkingReviewData {
  return {
    committed_projects: review.committed_projects.map(mapProject),
    candidate_projects: review.candidate_projects.map(mapProject),
    unlinked_turns: review.unlinked_turns.map(mapUserTurn),
    candidate_turns: review.candidate_turns.map(mapUserTurn),
    project_observations: review.project_observations.map(mapLinkingObservation),
  };
}

export function mapProjectRevision(revision: ProjectLinkRevisionDto): ProjectRevision {
  return {
    ...revision,
    created_at: new Date(revision.created_at),
  };
}

export function mapProjectLineageEvent(event: ProjectLineageEventDto): ProjectLineageEvent {
  return {
    ...event,
    created_at: new Date(event.created_at),
  };
}

export function mapProjectManualOverride(override: ProjectManualOverrideDto): ProjectManualOverride {
  return {
    ...override,
    created_at: new Date(override.created_at),
    updated_at: new Date(override.updated_at),
  };
}

export function mapSourceStatus(source: SourceStatusDto): SourceStatus {
  return {
    ...source,
    last_sync: source.last_sync ? new Date(source.last_sync) : null,
  };
}

export function mapMaskTemplate(template: MaskTemplateDto): MaskTemplate {
  return {
    ...template,
    created_at: new Date(template.created_at),
    updated_at: new Date(template.updated_at),
  };
}

export function mapDriftReport(report: DriftReportDto): DriftReport {
  return {
    ...report,
    generated_at: new Date(report.generated_at),
    timeline: report.timeline.map((point) => ({
      ...point,
      date: new Date(`${point.date}T00:00:00.000Z`),
    })),
  };
}

export function mapSearchResult(result: TurnSearchResultDto): SearchResult {
  return {
    turn: mapUserTurn(result.turn),
    session: mapSession(
      result.session ?? {
        id: result.turn.session_id,
        source_id: result.turn.source_id,
        source_platform: "other",
        host_id: "unknown",
        created_at: result.turn.created_at,
        updated_at: result.turn.last_context_activity_at,
        turn_count: 1,
        sync_axis: "current",
      },
    ),
    project: result.project ? mapProject(result.project) : undefined,
    match_highlights: result.highlights,
    relevance_score: result.relevance_score,
  };
}

export function mapTurnLineage(lineage: PipelineLineageDto): TurnLineage {
  return {
    turn: mapUserTurn(lineage.turn),
    session: lineage.session ? mapSession(lineage.session) : undefined,
    candidate_chain: lineage.candidate_chain.map((candidate) => ({
      ...candidate,
      started_at: new Date(candidate.started_at),
      ended_at: new Date(candidate.ended_at),
    })),
    atoms: lineage.atoms.map((atom) => ({
      id: atom.id,
      actor_kind: atom.actor_kind,
      origin_kind: atom.origin_kind,
      content_kind: atom.content_kind,
      time_key: new Date(atom.time_key),
      payload: atom.payload,
      fragment_refs: atom.fragment_refs,
    })),
    edges: lineage.edges,
    fragments: lineage.fragments.map((fragment) => ({
      id: fragment.id,
      record_id: fragment.record_id,
      fragment_kind: fragment.fragment_kind,
      time_key: new Date(fragment.time_key),
      payload: fragment.payload,
      raw_refs: fragment.raw_refs,
    })),
    records: lineage.records.map((record) => ({
      id: record.id,
      blob_id: record.blob_id,
      record_path_or_offset: record.record_path_or_offset,
      observed_at: new Date(record.observed_at),
      parseable: record.parseable,
    })),
    blobs: lineage.blobs.map((blob) => ({
      id: blob.id,
      origin_path: blob.origin_path,
      captured_path: blob.captured_path,
      checksum: blob.checksum,
      size_bytes: blob.size_bytes,
      captured_at: new Date(blob.captured_at),
    })),
  };
}

export function projectColor(projectId: string): string {
  let hash = 0;
  for (const char of projectId) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 65% 45%)`;
}
