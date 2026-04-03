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
  source_id: string;
  source_platform: SourcePlatform;
  host_id: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
  model?: string;
  working_directory?: string;
  source_native_project_ref?: string;
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
