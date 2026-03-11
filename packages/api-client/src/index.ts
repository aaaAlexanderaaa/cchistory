export interface DisplaySegmentDto {
  type: "text" | "masked" | "highlight" | "code" | "reference" | "injected";
  content: string;
  mask_label?: string;
  mask_char_count?: number;
  mask_template_id?: string;
  highlight_type?: "search" | "diff" | "error";
  is_expanded?: boolean;
  original_content?: string;
}

export interface UserMessageProjectionDto {
  id: string;
  raw_text: string;
  sequence: number;
  is_injected: boolean;
  created_at: string;
  atom_refs?: string[];
}

export interface TurnContextSummaryDto {
  assistant_reply_count: number;
  tool_call_count: number;
  token_usage?: TokenUsageSummaryDto;
  total_tokens?: number;
  primary_model?: string;
  has_errors: boolean;
}

export interface TokenUsageSummaryDto {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

export interface UserTurnProjectionDto {
  id: string;
  revision_id: string;
  turn_id?: string;
  turn_revision_id?: string;
  user_messages: UserMessageProjectionDto[];
  raw_text: string;
  canonical_text: string;
  display_segments: DisplaySegmentDto[];
  created_at: string;
  submission_started_at: string;
  last_context_activity_at: string;
  session_id: string;
  source_id: string;
  project_id?: string;
  project_ref?: string;
  link_state: "committed" | "candidate" | "unlinked";
  project_link_state?: "committed" | "candidate" | "unlinked";
  project_confidence?: number;
  candidate_project_ids?: string[];
  sync_axis: "current" | "superseded" | "source_absent" | "import_snapshot";
  value_axis: "active" | "covered" | "archived" | "suppressed";
  retention_axis: "keep_raw_and_derived" | "keep_raw_only" | "purged";
  context_ref: string;
  context_summary: TurnContextSummaryDto;
  lineage?: {
    atom_refs: string[];
    candidate_refs: string[];
    fragment_refs: string[];
    record_refs: string[];
    blob_refs: string[];
  };
}

export interface SystemMessageProjectionDto {
  id: string;
  content: string;
  display_segments: DisplaySegmentDto[];
  position: "before_user" | "after_user" | "interleaved";
  sequence: number;
  created_at: string;
}

export interface AssistantReplyProjectionDto {
  id: string;
  content: string;
  display_segments: DisplaySegmentDto[];
  content_preview: string;
  token_usage?: TokenUsageSummaryDto;
  token_count?: number;
  model: string;
  created_at: string;
  tool_call_ids: string[];
  stop_reason?: "end_turn" | "tool_use" | "max_tokens" | "error";
}

export interface ToolCallProjectionDto {
  id: string;
  tool_name: string;
  input: Record<string, unknown>;
  input_summary: string;
  input_display_segments: DisplaySegmentDto[];
  output?: string;
  output_preview?: string;
  output_display_segments?: DisplaySegmentDto[];
  status: "pending" | "running" | "success" | "error";
  error_message?: string;
  duration_ms?: number;
  reply_id: string;
  sequence: number;
  created_at: string;
}

export interface TurnContextProjectionDto {
  turn_id: string;
  system_messages: SystemMessageProjectionDto[];
  assistant_replies: AssistantReplyProjectionDto[];
  tool_calls: ToolCallProjectionDto[];
  raw_event_refs: string[];
}

export interface SessionProjectionDto {
  id: string;
  source_id: string;
  source_platform:
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
    | "other";
  host_id: string;
  title?: string;
  created_at: string;
  updated_at: string;
  turn_count: number;
  model?: string;
  working_directory?: string;
  primary_project_id?: string;
  sync_axis: "current" | "superseded" | "source_absent" | "import_snapshot";
}

export interface SourceStatusDto {
  id: string;
  family: "local_coding_agent" | "conversational_export";
  platform:
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
    | "other";
  display_name: string;
  base_dir: string;
  host_id: string;
  last_sync: string | null;
  sync_status: "healthy" | "stale" | "error";
  error_message?: string;
  total_blobs: number;
  total_records: number;
  total_fragments: number;
  total_atoms: number;
  total_sessions: number;
  total_turns: number;
}

export interface ProjectSummaryDto {
  project_id: string;
  project_revision_id: string;
  display_name: string;
  slug: string;
  linkage_state: "committed" | "candidate";
  confidence: number;
  link_reason:
    | "repo_fingerprint_match"
    | "repo_remote_match"
    | "workspace_path_continuity"
    | "source_native_project"
    | "manual_override"
    | "weak_path_hint"
    | "metadata_hint";
  manual_override_status: "none" | "applied" | "rejected" | "required";
  primary_workspace_path?: string;
  repo_root?: string;
  repo_remote?: string;
  repo_fingerprint?: string;
  source_platforms: Array<
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
    | "other"
  >;
  host_ids: string[];
  committed_turn_count: number;
  candidate_turn_count: number;
  session_count: number;
  project_last_activity_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectLinkRevisionDto {
  id: string;
  project_id: string;
  project_revision_id: string;
  linkage_state: "committed" | "candidate";
  confidence: number;
  link_reason:
    | "repo_fingerprint_match"
    | "repo_remote_match"
    | "workspace_path_continuity"
    | "source_native_project"
    | "manual_override"
    | "weak_path_hint"
    | "metadata_hint";
  manual_override_status: "none" | "applied" | "rejected" | "required";
  observation_refs: string[];
  supersedes_project_revision_id?: string;
  created_at: string;
}

export interface ProjectLineageEventDto {
  id: string;
  project_id: string;
  project_revision_id: string;
  previous_project_revision_id?: string;
  event_kind: "created" | "revised" | "manual_override";
  created_at: string;
  detail: Record<string, unknown>;
}

export interface ProjectManualOverrideDto {
  id: string;
  target_kind: "turn" | "session" | "observation";
  target_ref: string;
  project_id: string;
  display_name: string;
  created_at: string;
  updated_at: string;
  note?: string;
}

export interface MaskTemplateDto {
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
  created_at: string;
  updated_at: string;
}

export interface DriftTimelinePointDto {
  date: string;
  global_drift_index: number;
  consistency_score: number;
  total_turns: number;
}

export interface DriftReportDto {
  generated_at: string;
  global_drift_index: number;
  active_sources: number;
  sources_awaiting_sync: number;
  orphaned_turns: number;
  unlinked_turns: number;
  candidate_turns: number;
  consistency_score: number;
  timeline: DriftTimelinePointDto[];
}

export interface KnowledgeArtifactDto {
  artifact_id: string;
  artifact_revision_id: string;
  artifact_kind: "decision" | "instruction" | "fact" | "pattern" | "other";
  title: string;
  summary: string;
  project_id?: string;
  source_turn_refs: string[];
  sync_axis: "current" | "superseded" | "source_absent" | "import_snapshot";
  value_axis: "active" | "covered" | "archived" | "suppressed";
  retention_axis: "keep_raw_and_derived" | "keep_raw_only" | "purged";
  created_at: string;
  updated_at: string;
}

export interface ArtifactCoverageRecordDto {
  id: string;
  artifact_id: string;
  artifact_revision_id: string;
  turn_id: string;
  created_at: string;
}

export interface TombstoneProjectionDto {
  object_kind: "project" | "turn" | "artifact";
  logical_id: string;
  last_revision_id: string;
  sync_axis: "current" | "superseded" | "source_absent" | "import_snapshot";
  value_axis: "active" | "covered" | "archived" | "suppressed";
  retention_axis: "purged";
  purged_at: string;
  purge_reason?: string;
  replaced_by_logical_ids?: string[];
  lineage_event_refs?: string[];
}

export interface PipelineLineageDto {
  turn: UserTurnProjectionDto;
  session?: SessionProjectionDto;
  candidate_chain: Array<{
    id: string;
    source_id: string;
    session_ref: string;
    candidate_kind: "submission_group" | "turn" | "context_span" | "project_observation";
    input_atom_refs: string[];
    started_at: string;
    ended_at: string;
    rule_version: string;
    evidence: Record<string, unknown>;
  }>;
  atoms: Array<{
    id: string;
    source_id: string;
    session_ref: string;
    seq_no: number;
    actor_kind: "user" | "assistant" | "system" | "tool";
    origin_kind:
      | "user_authored"
      | "assistant_authored"
      | "injected_user_shaped"
      | "source_instruction"
      | "tool_generated"
      | "source_meta";
    content_kind: "text" | "tool_call" | "tool_result" | "meta_signal";
    time_key: string;
    display_policy: "show" | "collapse" | "hide";
    payload: Record<string, unknown>;
    fragment_refs: string[];
    source_format_profile_id: string;
  }>;
  edges: Array<{
    id: string;
    source_id: string;
    session_ref: string;
    from_atom_id: string;
    to_atom_id: string;
    edge_kind: "tool_result_for" | "spawned_from" | "same_submission" | "continuation_of" | "derived_from_fragment";
  }>;
  fragments: Array<{
    id: string;
    source_id: string;
    session_ref: string;
    record_id: string;
    seq_no: number;
    fragment_kind: "session_meta" | "title_signal" | "workspace_signal" | "model_signal" | "token_usage_signal" | "session_relation" | "text" | "tool_call" | "tool_result" | "unknown";
    actor_kind?: "user" | "assistant" | "system" | "tool";
    origin_kind?:
      | "user_authored"
      | "assistant_authored"
      | "injected_user_shaped"
      | "source_instruction"
      | "tool_generated"
      | "source_meta";
    time_key: string;
    payload: Record<string, unknown>;
    raw_refs: string[];
    source_format_profile_id: string;
  }>;
  records: Array<{
    id: string;
    source_id: string;
    blob_id: string;
    session_ref: string;
    ordinal: number;
    record_path_or_offset: string;
    observed_at: string;
    parseable: boolean;
    raw_json: string;
  }>;
  blobs: Array<{
    id: string;
    source_id: string;
    host_id: string;
    origin_path: string;
    captured_path?: string;
    checksum: string;
    size_bytes: number;
    captured_at: string;
    capture_run_id: string;
  }>;
}

export interface TurnSearchResultDto {
  turn: UserTurnProjectionDto;
  session?: SessionProjectionDto;
  project?: ProjectSummaryDto;
  highlights: Array<{ start: number; end: number }>;
  relevance_score: number;
}

export interface LinkingObservationDto {
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
  host_id: string;
  source_platform:
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
    | "other";
  workspace_subpath?: string;
  project_id?: string;
  linkage_state?: "committed" | "candidate";
  link_reason?:
    | "repo_fingerprint_match"
    | "repo_remote_match"
    | "workspace_path_continuity"
    | "source_native_project"
    | "manual_override"
    | "weak_path_hint"
    | "metadata_hint";
}

interface TurnsResponse {
  turns: UserTurnProjectionDto[];
}

interface TurnResponse {
  turn: UserTurnProjectionDto;
}

interface TurnContextResponse {
  context: TurnContextProjectionDto;
}

interface SessionResponse {
  session: SessionProjectionDto;
}

interface SessionsResponse {
  sessions: SessionProjectionDto[];
}

interface ProjectsResponse {
  projects: ProjectSummaryDto[];
}

interface SourcesResponse {
  sources: SourceStatusDto[];
}

interface SearchResultsResponse {
  results: TurnSearchResultDto[];
}

interface ProjectTurnsResponse {
  turns: UserTurnProjectionDto[];
}

interface ProjectRevisionsResponse {
  revisions: ProjectLinkRevisionDto[];
  lineage_events: ProjectLineageEventDto[];
}

interface LinkingOverridesResponse {
  overrides: ProjectManualOverrideDto[];
}

interface MasksResponse {
  templates: MaskTemplateDto[];
}

interface DriftResponse extends DriftReportDto {}

interface LineageResponse {
  lineage: PipelineLineageDto;
}

interface ArtifactsResponse {
  artifacts: KnowledgeArtifactDto[];
}

interface ArtifactResponse {
  artifact: KnowledgeArtifactDto;
  coverage: ArtifactCoverageRecordDto[];
}

interface ArtifactCoverageResponse {
  coverage: ArtifactCoverageRecordDto[];
}

interface CandidateGcResponse {
  processed_turn_ids: string[];
  tombstones: TombstoneProjectionDto[];
}

interface TombstoneResponse {
  tombstone: TombstoneProjectionDto;
}

export interface LinkingReviewResponse {
  committed_projects: ProjectSummaryDto[];
  candidate_projects: ProjectSummaryDto[];
  unlinked_turns: UserTurnProjectionDto[];
  candidate_turns: UserTurnProjectionDto[];
  project_observations: LinkingObservationDto[];
}

export interface UpsertLinkingOverrideRequest {
  target_kind: "turn" | "session" | "observation";
  target_ref: string;
  project_id?: string;
  display_name?: string;
  note?: string;
}

export interface UpsertArtifactRequest {
  artifact_id?: string;
  artifact_kind?: "decision" | "instruction" | "fact" | "pattern" | "other";
  title: string;
  summary: string;
  project_id?: string;
  source_turn_refs: string[];
}

export interface CCHistoryApiClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class CCHistoryApiError extends Error {
  readonly path: string;
  readonly status: number;
  readonly statusText: string;

  constructor(path: string, status: number, statusText: string) {
    super(`API request failed: ${status} ${statusText}`);
    this.name = "CCHistoryApiError";
    this.path = path;
    this.status = status;
    this.statusText = statusText;
  }
}

export function getDefaultApiBaseUrl(): string {
  return "http://127.0.0.1:8040";
}

export function createCCHistoryApiClient(options: CCHistoryApiClientOptions = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? getDefaultApiBaseUrl());
  const fetchImpl = options.fetch ?? globalThis.fetch;

  if (!fetchImpl) {
    throw new Error("A fetch implementation is required to create the API client.");
  }

  return {
    async getTurns(): Promise<UserTurnProjectionDto[]> {
      return (await fetchJson<TurnsResponse>(fetchImpl, baseUrl, "/api/turns")).turns;
    },
    async searchTurns(params: {
      q?: string;
      project_id?: string;
      source_ids?: string[];
      link_states?: string[];
      value_axes?: string[];
      limit?: number;
    }): Promise<TurnSearchResultDto[]> {
      const searchParams = new URLSearchParams();
      if (params.q) searchParams.set("q", params.q);
      if (params.project_id) searchParams.set("project_id", params.project_id);
      if (params.source_ids?.length) searchParams.set("source_ids", params.source_ids.join(","));
      if (params.link_states?.length) searchParams.set("link_states", params.link_states.join(","));
      if (params.value_axes?.length) searchParams.set("value_axes", params.value_axes.join(","));
      if (params.limit) searchParams.set("limit", String(params.limit));
      return (
        await fetchJson<SearchResultsResponse>(
          fetchImpl,
          baseUrl,
          `/api/turns/search${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`,
        )
      ).results;
    },
    async getTurn(turnId: string): Promise<UserTurnProjectionDto> {
      return (
        await fetchJson<TurnResponse>(fetchImpl, baseUrl, `/api/turns/${encodeURIComponent(turnId)}`)
      ).turn;
    },
    async getTurnContext(turnId: string): Promise<TurnContextProjectionDto> {
      return (
        await fetchJson<TurnContextResponse>(
          fetchImpl,
          baseUrl,
          `/api/turns/${encodeURIComponent(turnId)}/context`,
        )
      ).context;
    },
    async getSession(sessionId: string): Promise<SessionProjectionDto> {
      return (
        await fetchJson<SessionResponse>(
          fetchImpl,
          baseUrl,
          `/api/sessions/${encodeURIComponent(sessionId)}`,
        )
      ).session;
    },
    async getSessions(): Promise<SessionProjectionDto[]> {
      return (await fetchJson<SessionsResponse>(fetchImpl, baseUrl, "/api/sessions")).sessions;
    },
    async getSources(): Promise<SourceStatusDto[]> {
      return (await fetchJson<SourcesResponse>(fetchImpl, baseUrl, "/api/sources")).sources;
    },
    async getProjects(state: "committed" | "candidate" | "all" = "all"): Promise<ProjectSummaryDto[]> {
      const suffix = state === "all" ? "?state=all" : `?state=${encodeURIComponent(state)}`;
      return (await fetchJson<ProjectsResponse>(fetchImpl, baseUrl, `/api/projects${suffix}`)).projects;
    },
    async getProjectTurns(projectId: string, state?: "committed" | "candidate" | "all"): Promise<UserTurnProjectionDto[]> {
      const suffix = state && state !== "all" ? `?state=${encodeURIComponent(state)}` : "";
      return (
        await fetchJson<ProjectTurnsResponse>(
          fetchImpl,
          baseUrl,
          `/api/projects/${encodeURIComponent(projectId)}/turns${suffix}`,
        )
      ).turns;
    },
    async getProjectRevisions(projectId: string): Promise<ProjectRevisionsResponse> {
      return fetchJson<ProjectRevisionsResponse>(
        fetchImpl,
        baseUrl,
        `/api/projects/${encodeURIComponent(projectId)}/revisions`,
      );
    },
    async getLinkingReview(): Promise<LinkingReviewResponse> {
      return fetchJson<LinkingReviewResponse>(fetchImpl, baseUrl, "/api/admin/linking");
    },
    async getLinkingOverrides(): Promise<ProjectManualOverrideDto[]> {
      return (
        await fetchJson<LinkingOverridesResponse>(fetchImpl, baseUrl, "/api/admin/linking/overrides")
      ).overrides;
    },
    async upsertLinkingOverride(payload: UpsertLinkingOverrideRequest): Promise<{
      override: ProjectManualOverrideDto;
      project?: ProjectSummaryDto;
    }> {
      return fetchJsonWithBody(fetchImpl, baseUrl, "/api/admin/linking/overrides", payload);
    },
    async getMasks(): Promise<MaskTemplateDto[]> {
      return (await fetchJson<MasksResponse>(fetchImpl, baseUrl, "/api/admin/masks")).templates;
    },
    async getDriftReport(): Promise<DriftReportDto> {
      return fetchJson<DriftResponse>(fetchImpl, baseUrl, "/api/admin/drift");
    },
    async getTurnLineage(turnId: string): Promise<PipelineLineageDto> {
      return (
        await fetchJson<LineageResponse>(
          fetchImpl,
          baseUrl,
          `/api/admin/pipeline/lineage/${encodeURIComponent(turnId)}`,
        )
      ).lineage;
    },
    async getArtifacts(projectId?: string): Promise<KnowledgeArtifactDto[]> {
      const suffix = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
      return (await fetchJson<ArtifactsResponse>(fetchImpl, baseUrl, `/api/artifacts${suffix}`)).artifacts;
    },
    async upsertArtifact(payload: UpsertArtifactRequest): Promise<ArtifactResponse> {
      return fetchJsonWithBody(fetchImpl, baseUrl, "/api/artifacts", payload);
    },
    async getArtifactCoverage(artifactId: string): Promise<ArtifactCoverageRecordDto[]> {
      return (
        await fetchJson<ArtifactCoverageResponse>(
          fetchImpl,
          baseUrl,
          `/api/artifacts/${encodeURIComponent(artifactId)}/coverage`,
        )
      ).coverage;
    },
    async runCandidateGc(payload: {
      before_iso?: string;
      older_than_days?: number;
      mode?: "archive" | "purge";
    }): Promise<CandidateGcResponse> {
      return fetchJsonWithBody(fetchImpl, baseUrl, "/api/admin/lifecycle/candidate-gc", payload);
    },
    async getTombstone(logicalId: string): Promise<TombstoneProjectionDto> {
      return (
        await fetchJson<TombstoneResponse>(
          fetchImpl,
          baseUrl,
          `/api/tombstones/${encodeURIComponent(logicalId)}`,
        )
      ).tombstone;
    },
  };
}

async function fetchJson<T>(fetchImpl: typeof fetch, baseUrl: string, path: string): Promise<T> {
  const response = await fetchImpl(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new CCHistoryApiError(path, response.status, response.statusText);
  }
  return (await response.json()) as T;
}

async function fetchJsonWithBody<T>(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
  payload: unknown,
): Promise<T> {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new CCHistoryApiError(path, response.status, response.statusText);
  }
  return (await response.json()) as T;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/$/, "");
}
