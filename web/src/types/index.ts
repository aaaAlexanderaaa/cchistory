export type Mode = "explore" | "search" | "distill";
export type EntryType = "conversation" | "visit" | "message";
export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface Message {
  role: MessageRole;
  content: string;
  timestamp?: string;
  tool_name?: string;
  metadata?: Record<string, unknown>;
}

export interface EntrySummary {
  schema_version?: string;
  id: string;
  entry_id: string;
  source: string;
  type: EntryType;
  title: string;
  timestamp: string;
  project?: string;
  snippet?: string;
  score?: number | null;
  tags: string[];
}

export interface EntryDetail extends EntrySummary {
  source_id: string;
  origin_primary_key: string;
  origin_payload_ref?: string;
  url?: string;
  end_timestamp?: string;
  duration_seconds?: number;
  content?: string;
  messages?: Message[];
  metadata?: Record<string, unknown>;
}

export interface SearchHit extends EntrySummary {
  highlights: string[];
}

export interface SearchResult {
  entries: SearchHit[];
  total: number;
  query: string;
}

export interface EntryPage {
  entries: EntrySummary[];
  nextCursor: string | null;
}

export interface SourceInfo {
  schema_version?: string;
  source_id: string;
  name: string;
  type: string;
  enabled: boolean;
  entry_count?: number;
  status: string;
  last_run_status?: string;
  last_run_at?: string;
  last_success_at?: string;
  lag_seconds?: number;
  cursor?: string;
  has_more?: boolean;
  error_message?: string | null;
  metadata?: Record<string, unknown>;
}

export interface DistillArtifact {
  schema_version?: string;
  artifact_id: string;
  scope: string;
  artifact_type: string;
  title: string;
  summary: string;
  patterns: string[];
  decisions: string[];
  open_questions: string[];
  provenance_entry_ids: string[];
  tags: string[];
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, unknown>;
}

export interface DistillSessionRequest {
  source?: string;
  project?: string;
  limit?: number;
  entry_ids?: string[];
}
