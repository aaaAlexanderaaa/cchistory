import type {
  ActorKind,
  AtomEdge,
  CandidateKind,
  CapturedBlob,
  ContentKind,
  ConversationAtom,
  DerivedCandidate,
  DisplayPolicy,
  DisplaySegment,
  Host,
  LossAuditRecord,
  ParserCapability,
  OriginKind,
  RawRecord,
  SessionProjection,
  SourceDefinition,
  SourceFragment,
  SourceFormatProfile,
  SourcePlatform,
  SourceStatus,
  SourceSyncPayload,
  StageKind,
  StageRun,
  ToolCallProjection,
  TurnContextProjection,
  UserMessageProjection,
  UserTurnProjection,
} from "@cchistory/domain";
import type { ConversationSeedOptions, ExtractedSessionSeed } from "./conversation-seeds.js";

export type {
  ActorKind,
  AtomEdge,
  CandidateKind,
  CapturedBlob,
  ContentKind,
  ConversationAtom,
  DerivedCandidate,
  DisplayPolicy,
  DisplaySegment,
  Host,
  LossAuditRecord,
  ParserCapability,
  OriginKind,
  RawRecord,
  SessionProjection,
  SourceDefinition,
  SourceFragment,
  SourceFormatProfile,
  SourcePlatform,
  SourceStatus,
  SourceSyncPayload,
  StageKind,
  StageRun,
  ToolCallProjection,
  TurnContextProjection,
  UserMessageProjection,
  UserTurnProjection,
};

export interface ProbeOptions {
  source_ids?: string[];
  limit_files_per_source?: number;
  safe_mode?: boolean;
  max_file_bytes?: number;
  changed_since?: string;
  source_file_paths?: Record<string, readonly string[] | undefined>;
  previous_payloads?: Record<string, SourceSyncPayload | undefined>;
  on_progress?: (event: SourceProbeProgressEvent) => void;
}

/**
 * Per-file slice of probe output, emitted by streamSourceProbe. Carries
 * pre-projection SessionBuildInputs so consumers can either re-merge across
 * files (runSourceProbe collector path) or project per-file (streaming merge
 * path). trusted_bytes_by_blob_id lets the storage evidence path reuse the
 * already-captured fileBuffer instead of readFileSync'ing the file again.
 */
export interface SourceProbeFileChunk {
  source_id: string;
  origin_path: string;
  session_inputs: readonly SessionBuildInput[];
  orphan_blobs: readonly CapturedBlob[];
  loss_audits: readonly LossAuditRecord[];
  trusted_bytes_by_blob_id: ReadonlyMap<string, Buffer>;
}

export type SourceProbeFileSkipReason = "unchanged" | "metadata_only" | "oversized" | "capture_failed";

export type SourceProbeEvent =
  | { kind: "source_start"; source_id: string; source: SourceStatus }
  | { kind: "source_missing"; source_id: string; source: SourceStatus }
  | { kind: "file_chunk"; chunk: SourceProbeFileChunk }
  | {
      kind: "file_skip";
      source_id: string;
      origin_path: string;
      reason: SourceProbeFileSkipReason;
      size_bytes?: number;
      chunk?: SourceProbeFileChunk;
    }
  | {
      kind: "file_error";
      source_id: string;
      origin_path: string;
      detail: string;
      chunk?: SourceProbeFileChunk;
    }
  | { kind: "source_done"; source_id: string; file_processing_errors: readonly string[] };

export type SourceProbeProgressStage =
  | "source_start"
  | "source_missing"
  | "live_probe_start"
  | "live_probe_done"
  | "list_files_start"
  | "list_files_done"
  | "file_start"
  | "file_capture_done"
  | "file_parse_done"
  | "file_done"
  | "file_reuse"
  | "file_append_start"
  | "file_append_done"
  | "file_skip"
  | "file_error"
  | "derive_start"
  | "derive_done"
  | "source_done";

export interface SourceProbeProgressEvent {
  stage: SourceProbeProgressStage;
  source_id: string;
  slot_id: string;
  platform: SourcePlatform;
  display_name: string;
  message?: string;
  file_path?: string;
  file_index?: number;
  file_count?: number;
  size_bytes?: number;
  count?: number;
  elapsed_ms?: number;
}

export interface HostDiscoveryCandidate {
  kind: "default" | "supplemental" | "artifact";
  label: string;
  path: string;
  exists: boolean;
  selected: boolean;
}

export interface HostDiscoveryEntry {
  key: string;
  kind: "source" | "tool";
  capability: "sync" | "discover_only";
  platform: SourcePlatform;
  family?: SourceDefinition["family"];
  slot_id?: string;
  display_name: string;
  selected_path?: string;
  selected_exists: boolean;
  discovered_paths: string[];
  candidates: HostDiscoveryCandidate[];
}

export interface SessionDraft {
  id: string;
  source_session_id?: string;
  source_id: string;
  source_platform: SourcePlatform;
  host_id: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
  model?: string;
  working_directory?: string;
  source_native_project_ref?: string;
  resume_command?: string;
  resume_working_directory?: string;
  resume_command_confidence?: number;
  last_cumulative_token_usage?: TokenUsageMetrics;
}

export interface SessionBuildInput {
  draft: SessionDraft;
  blobs: CapturedBlob[];
  records: RawRecord[];
  fragments: SourceFragment[];
  atoms: ConversationAtom[];
  edges: AtomEdge[];
  loss_audits: LossAuditRecord[];
}

export interface CollectionCoreResult {
  files: string[];
  sessionsById: Map<string, SessionBuildInput>;
  orphanBlobs: CapturedBlob[];
  sourceLossAudits: LossAuditRecord[];
  fileProcessingErrors: string[];
}

export interface ProcessingCoreResult {
  blobs: CapturedBlob[];
  records: RawRecord[];
  fragments: SourceFragment[];
  atoms: ConversationAtom[];
  edges: AtomEdge[];
  candidates: DerivedCandidate[];
  sessions: SessionProjection[];
  turns: UserTurnProjection[];
  contexts: TurnContextProjection[];
  lossAudits: LossAuditRecord[];
}

export interface AdapterBlobResult {
  draft: SessionDraft;
  blobs: CapturedBlob[];
  records: RawRecord[];
  fragments: SourceFragment[];
  atoms: ConversationAtom[];
  edges: AtomEdge[];
  loss_audits: LossAuditRecord[];
}

export type { ExtractedSessionSeed, ConversationSeedOptions } from "./conversation-seeds.js";

export interface FragmentBuildContext {
  source: SourceDefinition;
  hostId: string;
  filePath: string;
  profileId: string;
  sessionId: string;
  captureRunId: string;
}

export interface UserTextChunk {
  originKind: OriginKind;
  text: string;
  displayPolicy?: DisplayPolicy;
}

export interface GitProjectEvidence {
  repoRoot?: string;
  repoRemote?: string;
  repoFingerprint?: string;
}

export interface TokenUsageMetrics {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
  model?: string;
}

export interface GenericSessionMetadata {
  workspacePath?: string;
  model?: string;
  title?: string;
  parentUuid?: string;
  isSidechain?: boolean;
}

export interface UnknownProtobufField {
  field_number: number;
  wire_type: 0 | 1 | 2 | 5;
  value: number | Buffer;
}

export interface CapturedBlobInput {
  blob: CapturedBlob;
  fileBuffer: Buffer;
}

export interface LossAuditOptions {
  stageKind?: StageKind;
  diagnosticCode?: string;
  severity?: LossAuditRecord["severity"];
  sessionRef?: string;
  blobRef?: string;
  recordRef?: string;
  fragmentRef?: string;
  atomRef?: string;
  candidateRef?: string;
  sourceFormatProfileId?: string;
}

export type AssistantStopReason = "end_turn" | "tool_use" | "max_tokens" | "error";
