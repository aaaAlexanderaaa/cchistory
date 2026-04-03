import type { LinkState, ToolCall, ValueAxis } from "@cchistory/presentation";

export type {
  AssistantReply,
  DisplaySegment,
  DriftReport,
  DriftTimelinePoint,
  LinkState,
  LinkingObservation,
  LinkingReviewData,
  MaskTemplate,
  ProjectIdentity,
  ProjectLineageEvent,
  ProjectManualOverride,
  ProjectRevision,
  RetentionAxis,
  SearchResult,
  Session,
  SessionRelatedWork,
  SourceFamily,
  SourcePlatform,
  SourceStatus,
  SyncAxis,
  SystemMessage,
  TokenUsageSummary,
  ToolCall,
  TurnContext,
  TurnContextSummary,
  TurnLineage,
  UserMessage,
  UserTurn,
  ValueAxis,
  ZeroTokenReason,
} from "@cchistory/presentation";

export type AppArea = "history" | "admin";
export type HistoryView = "all_turns" | "projects" | "inbox" | "search" | "session_detail";
export type AdminView = "sources" | "linking" | "masks" | "drift";

export interface AppState {
  area: AppArea;
  history_view: HistoryView;
  admin_view: AdminView;
  selected_project_id?: string;
  selected_session_id?: string;
  selected_turn_id?: string;
  search_query?: string;
  filters: {
    link_states: LinkState[];
    value_axes: ValueAxis[];
    source_ids: string[];
    date_range?: { from: Date; to: Date };
  };
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
}

export interface ToolCallPage {
  tool_calls: ToolCall[];
  page: number;
  total_pages: number;
  total_count: number;
  page_size: number;
}
