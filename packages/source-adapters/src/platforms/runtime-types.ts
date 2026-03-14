import type {
  ActorKind,
  LossAuditRecord,
  RawRecord,
  SourceFragment,
  SourcePlatform,
  StageKind,
} from "@cchistory/domain";

export interface TokenUsageLike {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
  model?: string;
}

export type AssistantStopReasonLike = "end_turn" | "tool_use" | "max_tokens" | "error";

export interface FragmentBuildContextLike {
  source: {
    id: string;
    platform: SourcePlatform;
  };
  sessionId: string;
  profileId: string;
}

export interface SessionDraftLike {
  title?: string;
  model?: string;
  working_directory?: string;
  last_cumulative_token_usage?: TokenUsageLike;
}

export interface LossAuditOptionsLike {
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

export interface ParseRuntimeResult {
  fragments: SourceFragment[];
  lossAudits: LossAuditRecord[];
}

export interface CommonParseRuntimeHelpers {
  asString(value: unknown): string | undefined;
  asNumber(value: unknown): number | undefined;
  asBoolean(value: unknown): boolean | undefined;
  asArray(value: unknown): unknown[];
  isObject(value: unknown): value is Record<string, any>;
  coerceIso(value: unknown): string | undefined;
  epochMillisToIso(value: number | undefined): string | undefined;
  nowIso(): string;
  normalizeWorkspacePath(value: string): string | undefined;
  mapRoleToActor(role: string): ActorKind;
  extractTextFromContentItem(item: Record<string, unknown>): string | undefined;
  stringifyToolContent(value: unknown): string;
  extractTokenUsage(value: unknown): TokenUsageLike | undefined;
  normalizeStopReason(value: unknown): AssistantStopReasonLike | undefined;
  createFragment(
    context: FragmentBuildContextLike,
    record: RawRecord,
    seqNo: number,
    fragmentKind: SourceFragment["fragment_kind"],
    timeKey: string,
    payload: Record<string, unknown>,
  ): SourceFragment;
  createTokenUsageFragment(
    context: FragmentBuildContextLike,
    record: RawRecord,
    seqNo: number,
    timeKey: string,
    usage: TokenUsageLike,
    stopReason?: AssistantStopReasonLike,
    extraPayload?: Record<string, unknown>,
  ): SourceFragment;
  appendChunkedTextFragments(
    context: FragmentBuildContextLike,
    record: RawRecord,
    fragments: SourceFragment[],
    timeKey: string,
    actorKind: ActorKind,
    text: string,
    nextSeq: number,
    options?: {
      usage?: TokenUsageLike;
      stopReason?: AssistantStopReasonLike;
      usageApplied?: boolean;
    },
  ): { nextSeq: number; usageApplied: boolean };
  appendUnsupportedContentItem(
    context: FragmentBuildContextLike,
    record: RawRecord,
    fragments: SourceFragment[],
    lossAudits: LossAuditRecord[],
    timeKey: string,
    nextSeq: number,
    item: Record<string, unknown>,
    detail: string,
    diagnosticCode: string,
  ): number;
  createRecordLossAudit(
    context: FragmentBuildContextLike,
    record: RawRecord,
    lossKind: LossAuditRecord["loss_kind"],
    detail: string,
    options?: LossAuditOptionsLike & { scopeRef?: string },
  ): LossAuditRecord;
  createLossAudit(
    sourceId: string,
    scopeRef: string,
    lossKind: LossAuditRecord["loss_kind"],
    detail: string,
    options?: LossAuditOptionsLike,
  ): LossAuditRecord;
}

export interface CodexParseRuntimeHelpers extends CommonParseRuntimeHelpers {
  safeJsonParse(value: string | undefined): unknown;
  extractCumulativeTokenUsage(value: unknown): TokenUsageLike | undefined;
  diffTokenUsageMetrics(
    current: TokenUsageLike | undefined,
    previous: TokenUsageLike | undefined,
  ): TokenUsageLike | undefined;
}

export interface ClaudeParseRuntimeHelpers extends CommonParseRuntimeHelpers {
  isClaudeInterruptionMarker(text: string): boolean;
}

export interface FactoryParseRuntimeHelpers extends CommonParseRuntimeHelpers {}

export interface AmpParseRuntimeHelpers extends CommonParseRuntimeHelpers {
  normalizeFileUri(value: string): string;
}

export interface GenericParseRuntimeHelpers extends CommonParseRuntimeHelpers {
  safeJsonParse(value: string | undefined): unknown;
}
