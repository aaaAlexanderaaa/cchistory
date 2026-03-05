export type EntryType = "conversation" | "visit" | "message";
export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface Message {
  role: MessageRole;
  content: string;
  timestamp?: string;
  tool_name?: string;
  metadata?: Record<string, unknown>;
}

export interface HistoryEntry {
  id: string;
  source: string;
  source_id: string;
  type: EntryType;
  title: string;
  url?: string;
  project?: string;
  timestamp: string;
  end_timestamp?: string;
  duration_seconds?: number;
  content?: string;
  messages?: Message[];
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export interface SourceInfo {
  name: string;
  type: string;
  enabled: boolean;
  entry_count?: number;
  status: string;
}

export interface SearchResult {
  entries: HistoryEntry[];
  total: number;
  query: string;
}
