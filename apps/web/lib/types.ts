// CCHistory Core Types - Based on High-Level Design Freeze
// =============================================================================

// =============================================================================
// STATUS AXES (from design doc Section 11)
// =============================================================================

/** Link State - how a turn relates to projects */
export type LinkState = 'committed' | 'candidate' | 'unlinked'

/** Sync Axis - freshness relative to source */
export type SyncAxis = 'current' | 'superseded' | 'source_absent' | 'import_snapshot'

/** Value Axis - usefulness/visibility */
export type ValueAxis = 'active' | 'covered' | 'archived' | 'suppressed'

/** Retention Axis */
export type RetentionAxis = 'keep_raw_and_derived' | 'keep_raw_only' | 'purged'

// =============================================================================
// EVIDENCE OBJECTS (Section 6.1)
// =============================================================================

/** Source Family */
export type SourceFamily = 'local_coding_agent' | 'conversational_export'

/** Source Platform - specific platforms within families */
export type SourcePlatform = 
  | 'claude_code'      // Claude Code / Claude CLI
  | 'codex'            // OpenAI Codex CLI
  | 'amp'              // Sourcegraph AMP
  | 'factory_droid'    // Factory Droid
  | 'cursor'           // Cursor
  | 'antigravity'      // Antigravity
  | 'openclaw'         // OpenClaw
  | 'opencode'         // OpenCode
  | 'claude_web'       // Claude.ai web
  | 'chatgpt'          // ChatGPT
  | 'lobechat'         // LobeChat
  | 'gemini'           // Google Gemini
  | 'other'

/** Session - a raw conversation container from a source */
export interface Session {
  id: string
  source_id: string
  source_platform: SourcePlatform
  host_id: string
  
  // Session metadata
  title?: string
  created_at: Date
  updated_at: Date
  
  // Counts (for list display)
  turn_count: number
  
  // Context
  model?: string
  working_directory?: string
  
  // Optional: primary project linkage
  primary_project_id?: string
  
  // Lifecycle
  sync_axis: SyncAxis
}

// =============================================================================
// USER TURN - The core object (Section 9)
// =============================================================================

/**
 * UserMessage - a single user message within a turn
 * A turn may have multiple contiguous user messages (e.g., follow-ups before AI responds)
 */
export interface UserMessage {
  id: string
  raw_text: string
  /** Index within the turn */
  sequence: number
  /** Whether this is user-authored or injected context */
  is_injected: boolean
  created_at: Date
}

/**
 * UserTurn - the canonical user-intent unit
 * Contains one or more contiguous user messages and their resulting context
 */
export interface UserTurn {
  /** Logical identity - stable across revisions */
  id: string
  /** Revision identity - changes when re-derived */
  revision_id: string
  
  /** All user messages in this turn (may be multiple consecutive) */
  user_messages: UserMessage[]
  
  /** Aggregated canonical text for search (after masking) */
  canonical_text: string
  /** Display segments for rendering with masks/highlights */
  display_segments: DisplaySegment[]
  
  // Temporal
  created_at: Date
  last_context_activity_at: Date

  // Relationships
  session_id: string
  source_id: string
  
  // Project linkage
  project_id?: string
  link_state: LinkState
  project_confidence?: number
  candidate_project_ids?: string[]
  
  // Status axes
  sync_axis: SyncAxis
  value_axis: ValueAxis
  retention_axis: RetentionAxis
  
  // Context reference (loaded on demand)
  context_ref: string
  /** Summary stats for list display */
  context_summary: TurnContextSummary
  
  // Metadata
  tags?: string[]
  is_flagged?: boolean
  flag_reason?: string
  
  // Coverage by KnowledgeArtifact
  covered_by_artifact_id?: string
}

/** Summary stats about turn context for list views */
export interface TurnContextSummary {
  assistant_reply_count: number
  tool_call_count: number
  token_usage?: TokenUsageSummary
  total_tokens?: number
  primary_model?: string
  has_errors: boolean
}

export interface TokenUsageSummary {
  input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cached_input_tokens?: number
  output_tokens?: number
  reasoning_output_tokens?: number
  total_tokens?: number
}

// =============================================================================
// TURN CONTEXT - Assistant/tool/system context (Section 9.5)
// =============================================================================

/** 
 * TurnContext - full context attached to a UserTurn 
 * Loaded on demand, not in list views
 */
export interface TurnContext {
  turn_id: string
  
  /** System messages (often injected prompts) */
  system_messages: SystemMessage[]
  
  /** Assistant replies - there may be many per turn */
  assistant_replies: AssistantReply[]
  
  /** All tool calls across all replies */
  tool_calls: ToolCall[]
  
  /** Raw event references for traceability */
  raw_event_refs: string[]
}

/** System message - often injected prompts */
export interface SystemMessage {
  id: string
  content: string
  display_segments: DisplaySegment[]
  /** Position relative to user messages */
  position: 'before_user' | 'after_user' | 'interleaved'
  sequence: number
  created_at: Date
}

/** AssistantReply - one response from the AI */
export interface AssistantReply {
  id: string
  content: string
  display_segments: DisplaySegment[]
  content_preview: string
  token_usage?: TokenUsageSummary
  token_count?: number
  model: string
  created_at: Date
  
  /** Tool calls initiated by this reply */
  tool_call_ids: string[]
  
  /** Stop reason */
  stop_reason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'error'
  
  // Code blocks extracted
  code_blocks?: CodeBlock[]
}

/** CodeBlock - code in an assistant reply */
export interface CodeBlock {
  id: string
  language: string
  code: string
  filename?: string
  line_range?: { start: number; end: number }
}

/** ToolCall - a tool/function call made by the AI */
export interface ToolCall {
  id: string
  tool_name: string
  
  /** Input to the tool */
  input: Record<string, unknown>
  input_summary: string
  input_display_segments: DisplaySegment[]
  
  /** Output from the tool */
  output?: string
  output_preview?: string
  output_display_segments?: DisplaySegment[]
  
  status: 'pending' | 'running' | 'success' | 'error'
  error_message?: string
  duration_ms?: number
  
  /** Which assistant reply initiated this */
  reply_id: string
  /** Sequence within the turn */
  sequence: number
  
  created_at: Date
}

// =============================================================================
// DISPLAY SEGMENTS - For rendering with masks (Section 10)
// =============================================================================

export type SegmentType = 
  | 'text'           // Normal text
  | 'masked'         // Collapsed/masked content
  | 'highlight'      // Search match highlight
  | 'code'           // Code block
  | 'reference'      // File/URL reference
  | 'injected'       // Injected system content

export interface DisplaySegment {
  type: SegmentType
  content: string
  
  /** For masked segments */
  mask_label?: string        // e.g., "System Prompt"
  mask_char_count?: number   // Original character count
  mask_template_id?: string  // Which template matched
  
  /** For highlights */
  highlight_type?: 'search' | 'diff' | 'error'
  
  /** Whether this segment is currently expanded (UI state) */
  is_expanded?: boolean
  
  /** Original content for masked segments */
  original_content?: string
}

// =============================================================================
// PROJECT (Section 8)
// =============================================================================

export interface ProjectIdentity {
  id: string
  revision_id: string
  
  name: string
  description?: string
  color: string
  slug?: string
  linkage_state: 'committed' | 'candidate'
  confidence: number
  link_reason: 'repo_fingerprint_match' | 'repo_remote_match' | 'workspace_path_continuity' | 'source_native_project' | 'manual_override' | 'weak_path_hint' | 'metadata_hint'
  manual_override_status: 'none' | 'applied' | 'rejected' | 'required'
  
  // Primary identifiers
  primary_workspace_path?: string
  repo_root?: string
  primary_repo_remote?: string
  repo_fingerprint?: string
  source_platforms: SourcePlatform[]
  host_ids: string[]
  
  // Counts
  committed_turn_count: number
  candidate_turn_count: number
  session_count: number
  
  last_activity: Date
  created_at: Date
}

export interface ProjectRevision {
  id: string
  project_id: string
  project_revision_id: string
  linkage_state: Exclude<LinkState, 'unlinked'>
  confidence: number
  link_reason: 'repo_fingerprint_match' | 'repo_remote_match' | 'workspace_path_continuity' | 'source_native_project' | 'manual_override' | 'weak_path_hint' | 'metadata_hint'
  manual_override_status: 'none' | 'applied' | 'rejected' | 'required'
  observation_refs: string[]
  supersedes_project_revision_id?: string
  created_at: Date
}

export interface ProjectLineageEvent {
  id: string
  project_id: string
  project_revision_id: string
  previous_project_revision_id?: string
  event_kind: 'created' | 'revised' | 'manual_override'
  created_at: Date
  detail: Record<string, unknown>
}

export interface ProjectManualOverride {
  id: string
  target_kind: 'turn' | 'session' | 'observation'
  target_ref: string
  project_id: string
  display_name: string
  created_at: Date
  updated_at: Date
  note?: string
}

export interface SourceStatus {
  id: string
  family: SourceFamily
  platform: SourcePlatform
  display_name: string
  base_dir: string
  host_id: string
  last_sync: Date | null
  sync_status: 'healthy' | 'stale' | 'error'
  error_message?: string
  total_blobs: number
  total_records: number
  total_fragments: number
  total_atoms: number
  total_sessions: number
  total_turns: number
}

export interface MaskTemplate {
  id: string
  name: string
  description?: string
  match_type: 'regex' | 'prefix' | 'contains'
  match_pattern: string
  action: 'collapse'
  collapse_label: string
  priority: number
  applies_to: Array<'user_message' | 'system_message' | 'assistant_reply' | 'tool_input' | 'tool_output'>
  is_builtin: true
  is_active: boolean
  created_at: Date
  updated_at: Date
}

export interface DriftTimelinePoint {
  date: Date
  global_drift_index: number
  consistency_score: number
  total_turns: number
}

export interface DriftReport {
  generated_at: Date
  global_drift_index: number
  active_sources: number
  sources_awaiting_sync: number
  orphaned_turns: number
  unlinked_turns: number
  candidate_turns: number
  consistency_score: number
  timeline: DriftTimelinePoint[]
}

// =============================================================================
// KNOWLEDGE ARTIFACT (Section 13)
// =============================================================================

export interface KnowledgeArtifact {
  id: string
  revision_id: string
  
  title: string
  content: string
  artifact_type: 'pattern' | 'decision' | 'instruction' | 'memory'
  
  /** Turns this artifact covers */
  covered_turn_ids: string[]
  
  /** Provenance */
  created_by: 'user' | 'external_agent' | 'system'
  source_agent?: string
  
  created_at: Date
  updated_at: Date
}

// =============================================================================
// SEARCH & ADMIN
// =============================================================================

export interface SearchQuery {
  query: string
  filters?: {
    project_ids?: string[]
    source_ids?: string[]
    date_range?: { from: Date; to: Date }
    link_states?: LinkState[]
    value_axes?: ValueAxis[]
  }
  limit?: number
  offset?: number
}

export interface SearchResult {
  turn: UserTurn
  session: Session
  project?: ProjectIdentity
  match_highlights: Array<{ start: number; end: number }>
  relevance_score: number
}

export interface TurnLineage {
  turn: UserTurn
  session?: Session
  candidate_chain: Array<{
    id: string
    candidate_kind: 'submission_group' | 'turn' | 'context_span' | 'project_observation'
    input_atom_refs: string[]
    started_at: Date
    ended_at: Date
    rule_version: string
    evidence: Record<string, unknown>
  }>
  atoms: Array<{
    id: string
    actor_kind: 'user' | 'assistant' | 'system' | 'tool'
    origin_kind: 'user_authored' | 'assistant_authored' | 'injected_user_shaped' | 'source_instruction' | 'tool_generated' | 'source_meta'
    content_kind: 'text' | 'tool_call' | 'tool_result' | 'meta_signal'
    time_key: Date
    payload: Record<string, unknown>
    fragment_refs: string[]
  }>
  edges: Array<{
    id: string
    from_atom_id: string
    to_atom_id: string
    edge_kind: 'tool_result_for' | 'spawned_from' | 'same_submission' | 'continuation_of' | 'derived_from_fragment'
  }>
  fragments: Array<{
    id: string
    record_id: string
    fragment_kind: 'session_meta' | 'title_signal' | 'workspace_signal' | 'model_signal' | 'token_usage_signal' | 'session_relation' | 'text' | 'tool_call' | 'tool_result' | 'unknown'
    time_key: Date
    payload: Record<string, unknown>
    raw_refs: string[]
  }>
  records: Array<{
    id: string
    blob_id: string
    record_path_or_offset: string
    observed_at: Date
    parseable: boolean
  }>
  blobs: Array<{
    id: string
    origin_path: string
    captured_path?: string
    checksum: string
    size_bytes: number
    captured_at: Date
  }>
}

// =============================================================================
// APP STATE
// =============================================================================

export type AppArea = 'history' | 'admin'
export type HistoryView = 'all_turns' | 'projects' | 'inbox' | 'search' | 'session_detail'
export type AdminView = 'sources' | 'imports' | 'linking' | 'masks' | 'drift'

export interface AppState {
  area: AppArea
  history_view: HistoryView
  admin_view: AdminView
  
  // Selection state
  selected_project_id?: string
  selected_session_id?: string
  selected_turn_id?: string
  
  // Search state
  search_query?: string
  
  // Filter state
  filters: {
    link_states: LinkState[]
    value_axes: ValueAxis[]
    source_ids: string[]
    date_range?: { from: Date; to: Date }
  }
}

// =============================================================================
// PAGINATION
// =============================================================================

export interface PaginatedResult<T> {
  items: T[]
  total: number
  offset: number
  limit: number
  has_more: boolean
}

export interface ToolCallPage {
  tool_calls: ToolCall[]
  page: number
  total_pages: number
  total_count: number
  page_size: number
}
