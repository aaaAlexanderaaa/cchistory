import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
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
import {
  deriveHostId,
  deriveSourceInstanceId,
  deriveSourceSlotId,
} from "@cchistory/domain";
import { applyMaskTemplates, getBuiltinMaskTemplates } from "../masks.js";
import { extractVscodeStateSeeds } from "./vscode-state.js";
import { parseAmpRecord as parseAmpRuntimeRecord } from "../platforms/amp/runtime.js";
import { extractAntigravityBrainSeed, extractAntigravityTrajectorySeeds, isAntigravityTrajectoryKey } from "../platforms/antigravity/runtime.js";
import { parseClaudeRecord as parseClaudeRuntimeRecord } from "../platforms/claude-code/runtime.js";
import { parseCodexRecord as parseCodexRuntimeRecord } from "../platforms/codex/runtime.js";
import { buildCursorComposerSeed, buildCursorPromptHistorySeed } from "../platforms/cursor/runtime.js";
import { parseFactoryRecord as parseFactoryRuntimeRecord } from "../platforms/factory-droid/runtime.js";
import {
  extractGenericContentItems as extractGenericContentItemsRuntime,
  extractGenericRole as extractGenericRoleRuntime,
  extractGenericSessionMetadata as extractGenericSessionMetadataRuntime,
  normalizeToolInput as normalizeToolInputRuntime,
  parseGenericConversationRecord as parseGenericConversationRuntimeRecord,
} from "../platforms/generic/runtime.js";
import { getPlatformAdapter } from "../platforms/registry.js";
import type { DefaultSourceResolutionOptions, SupportedSourcePlatform } from "../platforms/types.js";

export interface ProbeOptions {
  source_ids?: string[];
  limit_files_per_source?: number;
}

interface SessionDraft {
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

interface SessionBuildInput {
  draft: SessionDraft;
  blobs: CapturedBlob[];
  records: RawRecord[];
  fragments: SourceFragment[];
  atoms: ConversationAtom[];
  edges: AtomEdge[];
  loss_audits: LossAuditRecord[];
}

interface CollectionCoreResult {
  files: string[];
  sessionsById: Map<string, SessionBuildInput>;
  orphanBlobs: CapturedBlob[];
  sourceLossAudits: LossAuditRecord[];
  fileProcessingErrors: string[];
}

interface ProcessingCoreResult {
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

interface AdapterBlobResult {
  draft: SessionDraft;
  blobs: CapturedBlob[];
  records: RawRecord[];
  fragments: SourceFragment[];
  atoms: ConversationAtom[];
  edges: AtomEdge[];
  loss_audits: LossAuditRecord[];
}

export interface ExtractedSessionSeed {
  sessionId: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  model?: string;
  workingDirectory?: string;
  records: Array<{
    pointer: string;
    observedAt?: string;
    rawJson: string;
  }>;
}

interface FragmentBuildContext {
  source: SourceDefinition;
  hostId: string;
  filePath: string;
  profileId: string;
  sessionId: string;
  captureRunId: string;
}

interface UserTextChunk {
  originKind: OriginKind;
  text: string;
  displayPolicy?: DisplayPolicy;
}

interface GitProjectEvidence {
  repoRoot?: string;
  repoRemote?: string;
  repoFingerprint?: string;
}

interface TokenUsageMetrics {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
  model?: string;
}

interface GenericSessionMetadata {
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

interface ConversationSeedOptions {
  defaultSessionId?: string;
  defaultTitle?: string;
  defaultWorkingDirectory?: string;
}

interface CapturedBlobInput {
  blob: CapturedBlob;
  fileBuffer: Buffer;
}

interface LossAuditOptions {
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

type AssistantStopReason = "end_turn" | "tool_use" | "max_tokens" | "error";

const RULE_VERSION = "2026-03-10.1";
const DEFAULT_SOURCE_FAMILY = "local_coding_agent";
const EXPORT_SOURCE_FAMILY = "conversational_export";
const execFileAsync = promisify(execFile);
const gitProjectEvidenceCache = new Map<string, Promise<GitProjectEvidence | undefined>>();
const CLAUDE_INTERRUPTION_MARKERS = new Set([
  "[Request interrupted by user]",
  "[Request interrupted by user for tool use]",
]);

const COMMON_PARSER_CAPABILITIES: readonly ParserCapability[] = [
  "token_usage",
  "text_fragments",
  "tool_calls",
  "tool_results",
  "submission_group_candidates",
  "project_observation_candidates",
  "turn_projections",
  "turn_context_projections",
  "loss_audits",
];

const SOURCE_FORMAT_PROFILES: Record<SupportedSourcePlatform, SourceFormatProfile> = {
  codex: {
    id: "codex:jsonl:v1",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "codex",
    parser_version: "codex-parser@2026-03-11.1",
    description: "Codex local JSONL sessions with session_meta, turn_context, response items, tool records, and token_count events.",
    capabilities: ["session_meta", "workspace_signal", "model_signal", ...COMMON_PARSER_CAPABILITIES],
  },
  claude_code: {
    id: "claude_code:jsonl:v1",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "claude_code",
    parser_version: "claude-code-parser@2026-03-11.1",
    description: "Claude Code JSONL transcripts with cwd signals, content items, tool use/results, and relation hints.",
    capabilities: ["workspace_signal", ...COMMON_PARSER_CAPABILITIES],
  },
  factory_droid: {
    id: "factory_droid:jsonl:v1",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "factory_droid",
    parser_version: "factory-droid-parser@2026-03-11.1",
    description: "Factory Droid JSONL sessions plus sidecar settings metadata for model and workspace evidence.",
    capabilities: ["session_meta", "workspace_signal", "model_signal", ...COMMON_PARSER_CAPABILITIES],
  },
  amp: {
    id: "amp:thread-json:v1",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "amp",
    parser_version: "amp-parser@2026-03-11.1",
    description: "AMP whole-thread JSON exports with root env metadata and message arrays.",
    capabilities: ["workspace_signal", ...COMMON_PARSER_CAPABILITIES],
  },
  cursor: {
    id: "cursor:vscode-state-sqlite:v1",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "cursor",
    parser_version: "cursor-parser@2026-03-11.1",
    description: "Cursor project transcripts plus VS Code state.vscdb fallbacks using composerData and aichat keys.",
    capabilities: ["session_meta", "workspace_signal", "model_signal", ...COMMON_PARSER_CAPABILITIES],
  },
  antigravity: {
    id: "antigravity:vscode-state-sqlite:v1",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "antigravity",
    parser_version: "antigravity-parser@2026-03-12.1",
    description: "Antigravity trajectory summaries and VS Code state.vscdb storage, with brain task artifacts treated as auxiliary evidence.",
    capabilities: ["session_meta", "workspace_signal", "model_signal", ...COMMON_PARSER_CAPABILITIES],
  },
  openclaw: {
    id: "openclaw:jsonl:v1",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "openclaw",
    parser_version: "openclaw-parser@2026-03-11.1",
    description: "OpenClaw local session JSONL transcripts plus sessions metadata sidecars.",
    capabilities: ["session_meta", "workspace_signal", ...COMMON_PARSER_CAPABILITIES],
  },
  opencode: {
    id: "opencode:json:v1",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "opencode",
    parser_version: "opencode-parser@2026-03-11.1",
    description: "OpenCode exported session JSON or raw storage session/message trees.",
    capabilities: ["session_meta", "workspace_signal", "model_signal", ...COMMON_PARSER_CAPABILITIES],
  },
  lobechat: {
    id: "lobechat:export-json:v1",
    family: EXPORT_SOURCE_FAMILY,
    platform: "lobechat",
    parser_version: "lobechat-parser@2026-03-11.1",
    description: "LobeChat exported JSON bundles with one or more conversations.",
    capabilities: ["session_meta", "title_signal", "workspace_signal", "model_signal", ...COMMON_PARSER_CAPABILITIES],
  },
};

const DEFAULT_SOURCE_SPECS: ReadonlyArray<
  Omit<SourceDefinition, "id" | "base_dir" | "platform"> & { platform: SupportedSourcePlatform }
> = [
  {
    slot_id: "codex",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "codex",
    display_name: "Codex",
  },
  {
    slot_id: "claude_code",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "claude_code",
    display_name: "Claude Code",
  },
  {
    slot_id: "factory_droid",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "factory_droid",
    display_name: "Factory Droid",
  },
  {
    slot_id: "amp",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "amp",
    display_name: "AMP",
  },
  {
    slot_id: "cursor",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "cursor",
    display_name: "Cursor",
  },
  {
    slot_id: "antigravity",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "antigravity",
    display_name: "Antigravity",
  },
  {
    slot_id: "openclaw",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "openclaw",
    display_name: "OpenClaw",
  },
  {
    slot_id: "opencode",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "opencode",
    display_name: "OpenCode",
  },
  {
    slot_id: "lobechat",
    family: EXPORT_SOURCE_FAMILY,
    platform: "lobechat",
    display_name: "LobeChat",
  },
];

export function getDefaultSources(): SourceDefinition[] {
  return getDefaultSourcesForHost();
}

export function getDefaultSourcesForHost(
  options: DefaultSourceResolutionOptions = {},
): SourceDefinition[] {
  const pathExistsFn = options.pathExists ?? existsSync;
  const hostId = deriveHostId(options.hostname ?? os.hostname());
  return DEFAULT_SOURCE_SPECS.flatMap((source) => {
    const baseDir = resolveDefaultSourceBaseDir(source.platform, options);
    if (!options.includeMissing && !pathExistsFn(baseDir)) {
      return [];
    }
    return [
      {
        ...source,
        id: deriveSourceInstanceId({
          host_id: hostId,
          slot_id: source.slot_id || deriveSourceSlotId(source.platform),
          base_dir: baseDir,
        }),
        base_dir: baseDir,
      },
    ];
  });
}

export function getSourceFormatProfiles(): SourceFormatProfile[] {
  return Object.values(SOURCE_FORMAT_PROFILES).map(cloneSourceFormatProfile);
}

function resolveDefaultSourceBaseDir(
  platform: SupportedSourcePlatform,
  options: DefaultSourceResolutionOptions,
): string {
  const adapter = getPlatformAdapter(platform);
  const candidates = adapter?.getDefaultBaseDirCandidates({
    ...options,
    homeDir: options.homeDir ?? os.homedir(),
    platform: options.platform ?? os.platform(),
    appDataDir:
      options.appDataDir ??
      process.env.APPDATA ??
      path.join(options.homeDir ?? os.homedir(), "AppData", "Roaming"),
  }) ?? [];
  const pathExistsFn = options.pathExists ?? existsSync;
  return candidates.find((candidate) => pathExistsFn(candidate)) ?? candidates[0] ?? os.homedir();
}

export async function runSourceProbe(
  options: ProbeOptions = {},
  sources: readonly SourceDefinition[] = getDefaultSources(),
): Promise<{
  host: Host;
  sources: SourceSyncPayload[];
}> {
  const sourceList = sources.map((source) => ({ ...source }));
  const selectedSourceIds = new Set(options.source_ids ?? sourceList.map((source) => source.id));
  const now = nowIso();
  const host: Host = {
    id: deriveHostId(os.hostname()),
    hostname: os.hostname(),
    os: `${os.platform()} ${os.release()}`,
    first_seen: now,
    last_seen: now,
  };

  const payloads: SourceSyncPayload[] = [];
  for (const source of sourceList) {
    if (!selectedSourceIds.has(source.id) && !selectedSourceIds.has(source.slot_id)) {
      continue;
    }
    payloads.push(await processSource(source, host, options.limit_files_per_source));
  }

  return { host, sources: payloads };
}

async function processSource(
  source: SourceDefinition,
  host: Host,
  limitFilesPerSource?: number,
): Promise<SourceSyncPayload> {
  const startedAt = nowIso();
  const sourceFormatProfile = resolveSourceFormatProfile(source);
  const baseDirExists = await pathExists(source.base_dir);
  if (!baseDirExists) {
    const stageRuns = buildStageRuns(source.id, sourceFormatProfile, startedAt, nowIso(), {
      files: 0,
      blobs: 0,
      records: 0,
      fragments: 0,
      atoms: 0,
      candidates: 0,
      sessions: 0,
      turns: 0,
      lossAudits: [],
    });
    return {
      source: {
        id: source.id,
        slot_id: source.slot_id,
        family: source.family,
        platform: source.platform,
        display_name: source.display_name,
        base_dir: source.base_dir,
        host_id: host.id,
        last_sync: nowIso(),
        sync_status: "error",
        error_message: `Source path not found: ${source.base_dir}`,
        total_blobs: 0,
        total_records: 0,
        total_fragments: 0,
        total_atoms: 0,
        total_sessions: 0,
        total_turns: 0,
      },
      stage_runs: stageRuns,
      loss_audits: [],
      blobs: [],
      records: [],
      fragments: [],
      atoms: [],
      edges: [],
      candidates: [],
      sessions: [],
      turns: [],
      contexts: [],
    };
  }

  const collectionCore = await collectSourceInputs(source, host, sourceFormatProfile, limitFilesPerSource, startedAt);
  const processingCore = await processCollectedSessions(
    collectionCore.sessionsById,
    collectionCore.orphanBlobs,
    collectionCore.sourceLossAudits,
  );
  const uniqueBlobs = dedupeById(processingCore.blobs);

  const finishedAt = nowIso();
  const stageRuns = buildStageRuns(source.id, sourceFormatProfile, startedAt, finishedAt, {
    files: collectionCore.files.length,
    blobs: uniqueBlobs.length,
    records: processingCore.records.length,
    fragments: processingCore.fragments.length,
    atoms: processingCore.atoms.length,
    candidates: processingCore.candidates.length,
    sessions: processingCore.sessions.length,
    turns: processingCore.turns.length,
    lossAudits: processingCore.lossAudits,
  });

  return {
    source: {
      id: source.id,
      slot_id: source.slot_id,
      family: source.family,
      platform: source.platform,
      display_name: source.display_name,
      base_dir: source.base_dir,
      host_id: host.id,
      last_sync: finishedAt,
      sync_status:
        collectionCore.files.length === 0
          ? "stale"
          : processingCore.sessions.length > 0 || processingCore.turns.length > 0
            ? "healthy"
            : collectionCore.fileProcessingErrors.length > 0
              ? "error"
              : "stale",
      error_message:
        collectionCore.fileProcessingErrors.length > 0
          ? `${collectionCore.fileProcessingErrors[0]}${collectionCore.fileProcessingErrors.length > 1 ? ` (+${collectionCore.fileProcessingErrors.length - 1} more)` : ""}`
          : undefined,
      total_blobs: uniqueBlobs.length,
      total_records: processingCore.records.length,
      total_fragments: processingCore.fragments.length,
      total_atoms: processingCore.atoms.length,
      total_sessions: processingCore.sessions.length,
      total_turns: processingCore.turns.length,
    },
    stage_runs: stageRuns,
    loss_audits: processingCore.lossAudits,
    blobs: uniqueBlobs,
    records: processingCore.records,
    fragments: processingCore.fragments,
    atoms: processingCore.atoms,
    edges: processingCore.edges,
    candidates: processingCore.candidates,
    sessions: processingCore.sessions,
    turns: processingCore.turns,
    contexts: processingCore.contexts,
  };
}

async function collectSourceInputs(
  source: SourceDefinition,
  host: Host,
  sourceFormatProfile: SourceFormatProfile,
  limitFilesPerSource: number | undefined,
  startedAt: string,
): Promise<CollectionCoreResult> {
  const files = await listSourceFiles(source.platform, source.base_dir, limitFilesPerSource);
  const captureRunId = stableId("capture-run", source.id, startedAt);
  const sessionsById = new Map<string, SessionBuildInput>();
  const orphanBlobs: CapturedBlob[] = [];
  const sourceLossAudits: LossAuditRecord[] = [];
  const fileProcessingErrors: string[] = [];

  for (const filePath of files) {
    let capturedBlob: CapturedBlobInput | undefined;
    try {
      capturedBlob = await captureBlob(source, host.id, filePath, captureRunId);
    } catch (error) {
      const detail = `Failed to capture source file ${filePath}: ${formatErrorMessage(error)}`;
      const blobRef = stableId("blob", source.id, filePath, "capture-failed");
      sourceLossAudits.push(
        createLossAudit(source.id, blobRef, "unknown_fragment", detail, {
          stageKind: "capture",
          diagnosticCode: "blob_capture_failed",
          severity: "error",
          blobRef,
          sourceFormatProfileId: sourceFormatProfile.id,
        }),
      );
      fileProcessingErrors.push(detail);
      continue;
    }

    try {
      const adapterResults = await processBlob(source, sourceFormatProfile, filePath, capturedBlob);
      for (const adapterResult of adapterResults) {
        mergeAdapterBlobResult(sessionsById, adapterResult);
      }
    } catch (error) {
      orphanBlobs.push(capturedBlob.blob);
      const detail = `Failed to process captured source file ${filePath}: ${formatErrorMessage(error)}`;
      sourceLossAudits.push(
        createLossAudit(source.id, capturedBlob.blob.id, "unknown_fragment", detail, {
          stageKind: "extract_records",
          diagnosticCode: "blob_processing_failed",
          severity: "error",
          blobRef: capturedBlob.blob.id,
          sessionRef: deriveSessionId(source.platform, filePath, capturedBlob.fileBuffer),
          sourceFormatProfileId: sourceFormatProfile.id,
        }),
      );
      fileProcessingErrors.push(detail);
    }
  }

  return {
    files,
    sessionsById,
    orphanBlobs,
    sourceLossAudits,
    fileProcessingErrors,
  };
}

function mergeAdapterBlobResult(
  sessionsById: Map<string, SessionBuildInput>,
  adapterResult: AdapterBlobResult,
): void {
  const current = sessionsById.get(adapterResult.draft.id);
  if (current) {
    current.blobs.push(...adapterResult.blobs);
    current.records.push(...adapterResult.records);
    current.fragments.push(...adapterResult.fragments);
    current.atoms.push(...adapterResult.atoms);
    current.edges.push(...adapterResult.edges);
    current.loss_audits.push(...adapterResult.loss_audits);
    current.draft.title = current.draft.title ?? adapterResult.draft.title;
    current.draft.working_directory = current.draft.working_directory ?? adapterResult.draft.working_directory;
    current.draft.model = current.draft.model ?? adapterResult.draft.model;
    current.draft.created_at = minIso(current.draft.created_at, adapterResult.draft.created_at);
    current.draft.updated_at = maxIso(current.draft.updated_at, adapterResult.draft.updated_at);
    return;
  }

  sessionsById.set(adapterResult.draft.id, {
    draft: adapterResult.draft,
    blobs: [...adapterResult.blobs],
    records: [...adapterResult.records],
    fragments: [...adapterResult.fragments],
    atoms: [...adapterResult.atoms],
    edges: [...adapterResult.edges],
    loss_audits: [...adapterResult.loss_audits],
  });
}

async function processCollectedSessions(
  sessionsById: ReadonlyMap<string, SessionBuildInput>,
  orphanBlobs: readonly CapturedBlob[],
  sourceLossAudits: readonly LossAuditRecord[],
): Promise<ProcessingCoreResult> {
  const blobs: CapturedBlob[] = [];
  const records: RawRecord[] = [];
  const fragments: SourceFragment[] = [];
  const atoms: ConversationAtom[] = [];
  const edges: AtomEdge[] = [];
  const candidates: DerivedCandidate[] = [];
  const sessions: SessionProjection[] = [];
  const turns: UserTurnProjection[] = [];
  const contexts: TurnContextProjection[] = [];
  const lossAudits: LossAuditRecord[] = [];

  for (const sessionInput of sessionsById.values()) {
    sessionInput.atoms.sort(compareTimeThenSeq);

    const gitProjectEvidence = await readGitProjectEvidence(sessionInput.draft.working_directory);
    const sessionProjectCandidates = buildProjectObservationCandidates(
      sessionInput.draft,
      sessionInput.atoms,
      gitProjectEvidence,
    );
    const submissionResult = buildSubmissionGroups(sessionInput.draft, sessionInput.atoms);
    const turnResult = buildTurnsAndContext(
      sessionInput.draft,
      sessionInput.fragments,
      sessionInput.records,
      sessionInput.blobs,
      sessionInput.atoms,
      submissionResult.groups,
      submissionResult.edges,
    );

    blobs.push(...sessionInput.blobs);
    records.push(...sessionInput.records);
    fragments.push(...sessionInput.fragments);
    atoms.push(...sessionInput.atoms);
    edges.push(...sessionInput.edges, ...submissionResult.edges);
    candidates.push(
      ...sessionProjectCandidates,
      ...submissionResult.groups,
      ...turnResult.turnCandidates,
      ...turnResult.contextCandidates,
    );
    sessions.push(turnResult.session);
    turns.push(...turnResult.turns);
    contexts.push(...turnResult.contexts);
    lossAudits.push(...sessionInput.loss_audits);
  }

  blobs.push(...orphanBlobs);
  lossAudits.push(...sourceLossAudits);

  return {
    blobs,
    records,
    fragments,
    atoms,
    edges,
    candidates,
    sessions,
    turns,
    contexts,
    lossAudits,
  };
}

async function processBlob(
  source: SourceDefinition,
  sourceFormatProfile: SourceFormatProfile,
  filePath: string,
  capturedBlob: CapturedBlobInput,
): Promise<AdapterBlobResult[]> {
  const { blob, fileBuffer } = capturedBlob;
  const blobId = blob.id;

  const multiSessionSeeds = await extractMultiSessionSeeds(source, filePath, fileBuffer, blobId);
  if (multiSessionSeeds) {
    const results: AdapterBlobResult[] = [];
    for (const seed of multiSessionSeeds) {
      results.push(
        buildAdapterBlobResult(
          source,
          sourceFormatProfile,
          blob.host_id,
          filePath,
          blob.capture_run_id,
          blob,
          seed.sessionId,
          seed.records.map((record, ordinal) => ({
            id: stableId("record", source.id, seed.sessionId, blobId, String(ordinal), record.pointer),
            source_id: source.id,
            blob_id: blobId,
            session_ref: seed.sessionId,
            ordinal,
            record_path_or_offset: record.pointer,
            observed_at: record.observedAt ?? nowIso(),
            parseable: true,
            raw_json: record.rawJson,
          })),
          {
            title: seed.title,
            created_at: seed.createdAt,
            updated_at: seed.updatedAt,
            model: seed.model,
            working_directory: seed.workingDirectory,
          },
        ),
      );
    }
    return results;
  }

  const profileId = sourceFormatProfile.id;
  const sessionId = deriveSessionId(source.platform, filePath, fileBuffer);
  const context: FragmentBuildContext = {
    source,
    hostId: blob.host_id,
    filePath,
    profileId,
    sessionId,
    captureRunId: blob.capture_run_id,
  };

  const records = await extractRecords(context, blobId, fileBuffer);
  const extractionLossAudits: LossAuditRecord[] = [];

  if (records.length === 0) {
    extractionLossAudits.push(
      createLossAudit(source.id, blobId, "dropped_for_projection", "Blob was captured but produced no raw records", {
        stageKind: "extract_records",
        diagnosticCode: "records_missing",
        severity: "error",
        sessionRef: sessionId,
        blobRef: blobId,
        sourceFormatProfileId: profileId,
      }),
    );
  }

  for (const record of records) {
    if (record.parseable) {
      continue;
    }
    extractionLossAudits.push(
      createLossAudit(source.id, record.id, "unknown_fragment", "Raw record could not be extracted into a parseable object", {
        stageKind: "extract_records",
        diagnosticCode: "record_unparseable",
        severity: "warning",
        sessionRef: sessionId,
        blobRef: blobId,
        recordRef: record.id,
        sourceFormatProfileId: profileId,
      }),
    );
  }

  return [
    buildAdapterBlobResult(
      source,
      sourceFormatProfile,
      blob.host_id,
      filePath,
      blob.capture_run_id,
      blob,
      sessionId,
      records,
      {},
      extractionLossAudits,
    ),
  ];
}

async function captureBlob(
  source: SourceDefinition,
  hostId: string,
  filePath: string,
  captureRunId: string,
): Promise<CapturedBlobInput> {
  const fileBuffer = await fs.readFile(filePath);
  const stats = await fs.stat(filePath);
  const checksum = sha1(fileBuffer);
  return {
    blob: {
      id: stableId("blob", source.id, filePath, checksum),
      source_id: source.id,
      host_id: hostId,
      origin_path: filePath,
      checksum,
      size_bytes: stats.size,
      captured_at: nowIso(),
      capture_run_id: captureRunId,
    },
    fileBuffer,
  };
}

function buildAdapterBlobResult(
  source: SourceDefinition,
  sourceFormatProfile: SourceFormatProfile,
  hostId: string,
  filePath: string,
  captureRunId: string,
  blob: CapturedBlob,
  sessionId: string,
  records: RawRecord[],
  draftPatch: Partial<SessionDraft> = {},
  initialLossAudits: readonly LossAuditRecord[] = [],
): AdapterBlobResult {
  const context: FragmentBuildContext = {
    source,
    hostId,
    filePath,
    profileId: sourceFormatProfile.id,
    sessionId,
    captureRunId,
  };

  const fragments: SourceFragment[] = [];
  const atoms: ConversationAtom[] = [];
  const edges: AtomEdge[] = [];
  const lossAudits: LossAuditRecord[] = [...initialLossAudits];
  const draft: SessionDraft = {
    id: sessionId,
    source_id: source.id,
    source_platform: source.platform,
    host_id: hostId,
    title: draftPatch.title,
    created_at: draftPatch.created_at,
    updated_at: draftPatch.updated_at,
    model: draftPatch.model,
    working_directory: draftPatch.working_directory,
    source_native_project_ref: deriveSourceNativeProjectRef(source, filePath),
  };

  for (const record of records) {
    const parsed = parseRecord(context, record, draft);
    fragments.push(...parsed.fragments);
    lossAudits.push(...parsed.lossAudits);
  }

  const atomized = atomizeFragments(source.id, sessionId, sourceFormatProfile.id, fragments);
  atoms.push(...atomized.atoms);
  edges.push(...atomized.edges);
  hydrateDraftFromAtoms(draft, atoms);

  return {
    draft,
    blobs: [blob],
    records,
    fragments,
    atoms,
    edges,
    loss_audits: lossAudits,
  };
}

async function extractMultiSessionSeeds(
  source: SourceDefinition,
  filePath: string,
  fileBuffer: Buffer,
  blobId: string,
): Promise<ExtractedSessionSeed[] | undefined> {
  if (source.platform === "cursor" && path.basename(filePath) === "state.vscdb") {
    return extractVscodeStateSeeds(source, filePath, {
      safeJsonParse,
      isObject,
      asArray,
      asString,
      asNumber,
      coerceIso,
      epochMillisToIso,
      nowIso,
      truncate,
      sha1,
      normalizeWorkspacePath,
      extractGenericSessionMetadata,
      extractGenericRole,
      extractGenericContentItems,
      extractTokenUsage,
      normalizeStopReason,
      extractRichTextText,
      collectConversationSeedsFromValue,
      firstDefinedNumber,
      minIso,
      maxIso,
      buildCursorComposerSeed,
      buildCursorPromptHistorySeed,
      isAntigravityTrajectoryKey,
      extractAntigravityTrajectorySeeds,
    });
  }
  if (source.platform === "antigravity" && path.basename(filePath) === "state.vscdb") {
    return extractVscodeStateSeeds(source, filePath, {
      safeJsonParse,
      isObject,
      asArray,
      asString,
      asNumber,
      coerceIso,
      epochMillisToIso,
      nowIso,
      truncate,
      sha1,
      normalizeWorkspacePath,
      extractGenericSessionMetadata,
      extractGenericRole,
      extractGenericContentItems,
      extractTokenUsage,
      normalizeStopReason,
      extractRichTextText,
      collectConversationSeedsFromValue,
      firstDefinedNumber,
      minIso,
      maxIso,
      buildCursorComposerSeed,
      buildCursorPromptHistorySeed,
      isAntigravityTrajectoryKey,
      extractAntigravityTrajectorySeeds,
    });
  }
  if (source.platform === "antigravity" && path.basename(filePath) === "task.md") {
    const brainSeed = await extractAntigravityBrainSeed(filePath, fileBuffer, {
      readOptionalJsonFile,
      extractMarkdownHeading,
      pathExists,
      coerceIso,
      asString,
      nowIso,
      normalizeWorkspacePath,
    });
    return brainSeed ? [brainSeed] : undefined;
  }
  if (source.platform === "lobechat") {
    return extractConversationExportSeeds(source, filePath, fileBuffer, blobId);
  }
  if (source.platform === "opencode") {
    const exportSeeds = await extractConversationExportSeeds(source, filePath, fileBuffer, blobId);
    if (exportSeeds && exportSeeds.length > 0) {
      return exportSeeds;
    }
  }
  return undefined;
}

async function extractRecords(
  context: FragmentBuildContext,
  blobId: string,
  fileBuffer: Buffer,
): Promise<RawRecord[]> {
  const text = fileBuffer.toString("utf8");
  const records: RawRecord[] = [];
  const baseRecordId = (ordinal: number, pointer: string) =>
    stableId("record", context.source.id, context.sessionId, blobId, String(ordinal), pointer);

  if (context.source.platform === "amp") {
    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(text);
    } catch {
      records.push({
        id: baseRecordId(0, "root"),
        source_id: context.source.id,
        blob_id: blobId,
        session_ref: context.sessionId,
        ordinal: 0,
        record_path_or_offset: "root",
        observed_at: nowIso(),
        parseable: false,
        raw_json: text,
      });
      return records;
    }
    if (!isObject(parsedValue)) {
      records.push({
        id: baseRecordId(0, "root"),
        source_id: context.source.id,
        blob_id: blobId,
        session_ref: context.sessionId,
        ordinal: 0,
        record_path_or_offset: "root",
        observed_at: nowIso(),
        parseable: false,
        raw_json: text,
      });
      return records;
    }
    const parsed = parsedValue;
    const rootObserved = coerceIso(parsed.created_at) ?? epochMillisToIso(asNumber(parsed.created)) ?? nowIso();
    records.push({
      id: baseRecordId(0, "root"),
      source_id: context.source.id,
      blob_id: blobId,
      session_ref: context.sessionId,
      ordinal: 0,
      record_path_or_offset: "root",
      observed_at: rootObserved,
      parseable: true,
      raw_json: JSON.stringify(parsed),
    });

    const messages = asArray(parsed.messages);
    for (const [index, message] of messages.entries()) {
      if (!isObject(message)) {
        continue;
      }
      const observedAt =
        epochMillisToIso(asNumber(message.meta?.sentAt)) ??
        coerceIso(message.timestamp) ??
        rootObserved;
      records.push({
        id: baseRecordId(index + 1, `messages[${index}]`),
        source_id: context.source.id,
        blob_id: blobId,
        session_ref: context.sessionId,
        ordinal: index + 1,
        record_path_or_offset: `messages[${index}]`,
        observed_at: observedAt,
        parseable: true,
        raw_json: JSON.stringify(message),
      });
    }
    return records;
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const [index, line] of lines.entries()) {
    records.push({
      id: baseRecordId(index, `${index}`),
      source_id: context.source.id,
      blob_id: blobId,
      session_ref: context.sessionId,
      ordinal: index,
      record_path_or_offset: `${index}`,
      observed_at: nowIso(),
      parseable: true,
      raw_json: line,
    });
  }

  if (context.source.platform === "factory_droid") {
    const settingsPath = context.filePath.replace(/\.jsonl?$/u, ".settings.json");
    if (await pathExists(settingsPath)) {
      const settingsText = await fs.readFile(settingsPath, "utf8");
      records.push({
        id: baseRecordId(records.length, "settings"),
        source_id: context.source.id,
        blob_id: blobId,
        session_ref: context.sessionId,
        ordinal: records.length,
        record_path_or_offset: "settings",
        observed_at: nowIso(),
        parseable: true,
        raw_json: settingsText,
      });
    }
  }

  return records;
}

function createRecordLossAudit(
  context: FragmentBuildContext,
  record: RawRecord,
  lossKind: LossAuditRecord["loss_kind"],
  detail: string,
  options: LossAuditOptions & { scopeRef?: string } = {},
): LossAuditRecord {
  return createLossAudit(context.source.id, options.scopeRef ?? record.id, lossKind, detail, {
    stageKind: "parse_source_fragments",
    diagnosticCode: options.diagnosticCode,
    severity: options.severity,
    sessionRef: options.sessionRef ?? record.session_ref,
    blobRef: options.blobRef ?? record.blob_id,
    recordRef: options.recordRef ?? record.id,
    fragmentRef: options.fragmentRef,
    atomRef: options.atomRef,
    candidateRef: options.candidateRef,
    sourceFormatProfileId: options.sourceFormatProfileId ?? context.profileId,
  });
}

function buildCommonParseRuntimeHelpers() {
  return {
    asString,
    asNumber,
    asBoolean,
    asArray,
    isObject,
    coerceIso,
    epochMillisToIso,
    nowIso,
    normalizeWorkspacePath,
    mapRoleToActor,
    extractTextFromContentItem,
    stringifyToolContent,
    extractTokenUsage,
    normalizeStopReason,
    createFragment,
    createTokenUsageFragment,
    appendChunkedTextFragments,
    appendUnsupportedContentItem,
    createRecordLossAudit,
    createLossAudit,
  };
}

function parseRecord(
  context: FragmentBuildContext,
  record: RawRecord,
  draft: SessionDraft,
): {
  fragments: SourceFragment[];
  lossAudits: LossAuditRecord[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.raw_json);
  } catch {
    return {
      fragments: [
        createFragment(context, record, 0, "unknown", nowIso(), {
          reason: "invalid_json",
          raw_preview: record.raw_json.slice(0, 200),
        }),
      ],
      lossAudits: [
        createRecordLossAudit(context, record, "unknown_fragment", "Record could not be parsed as JSON", {
          diagnosticCode: "record_json_parse_failed",
          severity: "warning",
        }),
      ],
    };
  }

  if (!isObject(parsed)) {
    return {
      fragments: [
        createFragment(context, record, 0, "unknown", nowIso(), {
          reason: "non_object_record",
        }),
      ],
      lossAudits: [
        createRecordLossAudit(context, record, "unknown_fragment", "Record parsed but is not an object", {
          diagnosticCode: "record_not_object",
          severity: "warning",
        }),
      ],
    };
  }

  if (context.source.platform === "codex") {
    return parseCodexRuntimeRecord(context, record, parsed, draft, {
      ...buildCommonParseRuntimeHelpers(),
      safeJsonParse,
      extractCumulativeTokenUsage,
      diffTokenUsageMetrics,
    });
  }
  if (context.source.platform === "claude_code") {
    return parseClaudeRuntimeRecord(context, record, parsed, draft, {
      ...buildCommonParseRuntimeHelpers(),
      isClaudeInterruptionMarker,
    });
  }
  if (context.source.platform === "factory_droid") {
    return parseFactoryRuntimeRecord(context, record, parsed, draft, buildCommonParseRuntimeHelpers());
  }
  if (
    context.source.platform === "cursor" ||
    context.source.platform === "antigravity" ||
    context.source.platform === "openclaw" ||
    context.source.platform === "opencode" ||
    context.source.platform === "lobechat"
  ) {
    return parseGenericConversationRuntimeRecord(context, record, parsed, draft, {
      ...buildCommonParseRuntimeHelpers(),
      safeJsonParse,
    });
  }
  return parseAmpRuntimeRecord(context, record, parsed, draft, {
    ...buildCommonParseRuntimeHelpers(),
    normalizeFileUri,
  });
}

function extractGenericSessionMetadata(parsed: Record<string, unknown>): GenericSessionMetadata {
  return extractGenericSessionMetadataRuntime(parsed, {
    isObject,
    asString,
    asBoolean,
    normalizeWorkspacePath,
  });
}

function extractGenericRole(message: Record<string, unknown>): string | undefined {
  return extractGenericRoleRuntime(message, {
    isObject,
    asString,
  });
}

function extractGenericContentItems(message: Record<string, unknown>): Record<string, unknown>[] {
  return extractGenericContentItemsRuntime(message, {
    isObject,
    asString,
    asArray,
  });
}

function normalizeToolInput(value: unknown): Record<string, unknown> {
  return normalizeToolInputRuntime(value, {
    isObject,
    safeJsonParse,
  });
}

function buildTextFragmentPayload(
  actorKind: ActorKind,
  chunk: UserTextChunk,
  options: {
    usage?: TokenUsageMetrics;
    stopReason?: AssistantStopReason;
  } = {},
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    actor_kind: actorKind,
    origin_kind: chunk.originKind,
    text: chunk.text,
    display_policy: chunk.displayPolicy ?? inferDisplayPolicy(chunk.originKind, chunk.text),
  };
  if (options.usage) {
    payload.token_usage = options.usage;
    if (typeof options.usage.total_tokens === "number") {
      payload.token_count = options.usage.total_tokens;
    }
    if (options.usage.model) {
      payload.model = options.usage.model;
    }
  }
  if (options.stopReason) {
    payload.stop_reason = options.stopReason;
  }
  return payload;
}

function createTokenUsageFragment(
  context: FragmentBuildContext,
  record: RawRecord,
  seqNo: number,
  timeKey: string,
  usage: TokenUsageMetrics,
  stopReason?: AssistantStopReason,
  extraPayload: Record<string, unknown> = {},
): SourceFragment {
  const payload: Record<string, unknown> = {
    token_usage: usage,
    scope: "turn",
    ...extraPayload,
  };
  if (typeof usage.total_tokens === "number") {
    payload.token_count = usage.total_tokens;
  }
  if (usage.model) {
    payload.model = usage.model;
  }
  if (stopReason) {
    payload.stop_reason = stopReason;
  }
  return createFragment(context, record, seqNo, "token_usage_signal", timeKey, payload);
}

function appendChunkedTextFragments(
  context: FragmentBuildContext,
  record: RawRecord,
  fragments: SourceFragment[],
  timeKey: string,
  actorKind: ActorKind,
  text: string,
  nextSeq: number,
  options: {
    usage?: TokenUsageMetrics;
    stopReason?: AssistantStopReason;
    usageApplied?: boolean;
  } = {},
): { nextSeq: number; usageApplied: boolean } {
  let usageApplied = options.usageApplied ?? false;
  const chunks = buildTextChunks(actorKind, text);
  for (const chunk of chunks) {
    const firstAssistantChunk = actorKind === "assistant" && !usageApplied;
    fragments.push(
      createFragment(context, record, nextSeq++, "text", timeKey, {
        ...buildTextFragmentPayload(actorKind, chunk, {
          usage: firstAssistantChunk ? options.usage : undefined,
          stopReason: firstAssistantChunk ? options.stopReason : undefined,
        }),
      }),
    );
    if (firstAssistantChunk) {
      usageApplied = true;
    }
  }
  return { nextSeq, usageApplied };
}

function appendUnsupportedContentItem(
  context: FragmentBuildContext,
  record: RawRecord,
  fragments: SourceFragment[],
  lossAudits: LossAuditRecord[],
  timeKey: string,
  nextSeq: number,
  item: Record<string, unknown>,
  detail: string,
  diagnosticCode: string,
): number {
  lossAudits.push(
    createRecordLossAudit(context, record, "unknown_fragment", detail, {
      diagnosticCode,
    }),
  );
  fragments.push(createFragment(context, record, nextSeq, "unknown", timeKey, item));
  return nextSeq + 1;
}

function extractTokenUsage(value: unknown, depth = 0): TokenUsageMetrics | undefined {
  if (!isObject(value) || depth > 3) {
    return undefined;
  }

  const direct = normalizeTokenUsageObject(value);
  let nestedUsage: TokenUsageMetrics | undefined;

  for (const nested of [value.usage, value.tokenUsage, value.last_token_usage, value.lastTokenUsage, value.info]) {
    nestedUsage = mergeTokenUsageMetrics(nestedUsage, extractTokenUsage(nested, depth + 1));
  }

  return mergeTokenUsageMetrics(nestedUsage, direct);
}

function extractCumulativeTokenUsage(value: unknown, depth = 0): TokenUsageMetrics | undefined {
  if (!isObject(value) || depth > 3) {
    return undefined;
  }

  const direct = normalizeTokenUsageObject(value);
  let nestedUsage: TokenUsageMetrics | undefined;

  for (const nested of [value.total_token_usage, value.totalTokenUsage, value.total_usage, value.totalUsage, value.info]) {
    nestedUsage = mergeTokenUsageMetrics(nestedUsage, extractCumulativeTokenUsage(nested, depth + 1));
  }

  return mergeTokenUsageMetrics(nestedUsage, direct);
}

function normalizeStopReason(value: unknown): AssistantStopReason | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/gu, "_");
  if (
    normalized === "end_turn" ||
    normalized === "end" ||
    normalized === "stop" ||
    normalized === "completed" ||
    normalized === "complete" ||
    normalized === "finished"
  ) {
    return "end_turn";
  }
  if (
    normalized === "tool_use" ||
    normalized === "tool_call" ||
    normalized === "tool_calls" ||
    normalized === "function_call" ||
    normalized === "function_calls"
  ) {
    return "tool_use";
  }
  if (normalized === "max_tokens" || normalized === "length" || normalized === "token_limit") {
    return "max_tokens";
  }
  if (
    normalized === "error" ||
    normalized === "failed" ||
    normalized === "failure" ||
    normalized === "abort" ||
    normalized === "aborted" ||
    normalized === "cancelled" ||
    normalized === "canceled" ||
    normalized === "interrupted"
  ) {
    return "error";
  }
  return undefined;
}

async function extractConversationExportSeeds(
  source: SourceDefinition,
  filePath: string,
  fileBuffer: Buffer,
  _blobId: string,
): Promise<ExtractedSessionSeed[] | undefined> {
  if (source.platform === "opencode") {
    const opencodeSeed = await extractOpenCodeSessionSeed(filePath, fileBuffer);
    if (opencodeSeed) {
      return [opencodeSeed];
    }
  }

  const parsed = safeJsonParse(fileBuffer.toString("utf8"));
  const seeds = collectConversationSeedsFromValue(
    source.platform,
    parsed,
    path.basename(filePath, path.extname(filePath)),
  );
  return seeds.length > 0 ? seeds : undefined;
}

async function readOptionalJsonFile(targetPath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    const parsed = safeJsonParse(raw);
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function extractMarkdownHeading(text: string): string | undefined {
  const firstHeading = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.startsWith("#"));
  return firstHeading?.replace(/^#+\s*/u, "").trim() || undefined;
}

function normalizeTokenUsageObject(value: Record<string, unknown>): TokenUsageMetrics | undefined {
  const rawInputTokens = firstDefinedNumber(
    asNumber(value.input_tokens),
    asNumber(value.inputTokens),
    asNumber(value.prompt_tokens),
    asNumber(value.promptTokens),
    asNumber(value.totalInputTokens),
  );
  const cacheCreationTokens = firstDefinedNumber(
    asNumber(value.cache_creation_input_tokens),
    asNumber(value.cacheCreationInputTokens),
    asNumber(value.cacheCreationTokens),
  );
  const cacheReadTokens = firstDefinedNumber(
    asNumber(value.cache_read_input_tokens),
    asNumber(value.cacheReadInputTokens),
    asNumber(value.cacheReadTokens),
    asNumber(value.cached_input_tokens),
    asNumber(value.cachedInputTokens),
  );
  const hasExplicitCacheBreakout =
    firstDefinedNumber(
      asNumber(value.cache_creation_input_tokens),
      asNumber(value.cacheCreationInputTokens),
      asNumber(value.cacheCreationTokens),
      asNumber(value.cache_read_input_tokens),
      asNumber(value.cacheReadInputTokens),
      asNumber(value.cacheReadTokens),
    ) !== undefined;
  const inputIncludesCachedTokens =
    !hasExplicitCacheBreakout &&
    (firstDefinedNumber(asNumber(value.cached_input_tokens), asNumber(value.cachedInputTokens)) !== undefined ||
      firstDefinedNumber(asNumber(value.prompt_tokens), asNumber(value.promptTokens)) !== undefined);
  const inputTokens =
    typeof rawInputTokens === "number" && typeof cacheReadTokens === "number" && inputIncludesCachedTokens
      ? Math.max(rawInputTokens - cacheReadTokens, 0)
      : rawInputTokens;
  const cachedInputTokens =
    cacheCreationTokens !== undefined || cacheReadTokens !== undefined
      ? (cacheCreationTokens ?? 0) + (cacheReadTokens ?? 0)
      : undefined;
  const outputTokens = firstDefinedNumber(
    asNumber(value.output_tokens),
    asNumber(value.outputTokens),
    asNumber(value.completion_tokens),
    asNumber(value.completionTokens),
    asNumber(value.response_tokens),
  );
  const reasoningOutputTokens = firstDefinedNumber(
    asNumber(value.reasoning_output_tokens),
    asNumber(value.reasoningOutputTokens),
    asNumber(value.reasoningTokens),
    asNumber(value.thinking_tokens),
    asNumber(value.thinkingTokens),
  );
  const explicitTotal = firstDefinedNumber(
    asNumber(value.total_tokens),
    asNumber(value.totalTokens),
    asNumber(value.token_count),
    asNumber(value.tokenCount),
  );
  const totalTokens = explicitTotal ?? sumDefinedNumbers(inputTokens, cacheReadTokens, cacheCreationTokens, outputTokens);
  const model =
    asString(value.model) ??
    asString(value.modelName) ??
    asString(value.model_name);

  if (
    inputTokens === undefined &&
    cachedInputTokens === undefined &&
    outputTokens === undefined &&
    reasoningOutputTokens === undefined &&
    totalTokens === undefined &&
    !model
  ) {
    return undefined;
  }

  return {
    input_tokens: inputTokens,
    cache_read_input_tokens: cacheReadTokens,
    cache_creation_input_tokens: cacheCreationTokens,
    cached_input_tokens: cachedInputTokens,
    output_tokens: outputTokens,
    reasoning_output_tokens: reasoningOutputTokens,
    total_tokens: totalTokens,
    model,
  };
}

function collectConversationSeedsFromValue(
  platform: SourcePlatform,
  value: unknown,
  originHint: string,
  options: ConversationSeedOptions = {},
): ExtractedSessionSeed[] {
  const seedsById = new Map<string, ExtractedSessionSeed>();
  const seen = new Set<unknown>();

  const visit = (candidate: unknown, pathHint: string, depth: number, root = false) => {
    if (depth > 8 || candidate === null || candidate === undefined) {
      return;
    }
    if (typeof candidate === "object") {
      if (seen.has(candidate)) {
        return;
      }
      seen.add(candidate);
    }

    const seed = buildSeedFromCandidateValue(platform, candidate, pathHint, {
      defaultSessionId: root ? options.defaultSessionId : undefined,
      defaultTitle: root ? options.defaultTitle : undefined,
      defaultWorkingDirectory: options.defaultWorkingDirectory,
    });
    if (seed) {
      upsertExtractedSeed(seedsById, seed);
      return;
    }

    if (Array.isArray(candidate)) {
      for (const [index, entry] of candidate.entries()) {
        visit(entry, `${pathHint}[${index}]`, depth + 1);
      }
      return;
    }

    if (!isObject(candidate)) {
      return;
    }

    for (const [key, entry] of Object.entries(candidate)) {
      if (entry && typeof entry === "object") {
        visit(entry, `${pathHint}.${key}`, depth + 1);
      }
    }
  };

  visit(value, originHint, 0, true);
  return [...seedsById.values()];
}

function buildSeedFromCandidateValue(
  platform: SourcePlatform,
  candidate: unknown,
  originHint: string,
  options: ConversationSeedOptions,
): ExtractedSessionSeed | undefined {
  const messageEntries = extractCandidateMessageEntries(candidate);
  if (!messageEntries || messageEntries.length === 0) {
    return undefined;
  }

  const normalizedMessages = messageEntries
    .map((entry) => normalizeMessageCandidate(entry, options.defaultWorkingDirectory))
    .filter((entry): entry is { observedAt?: string; record: Record<string, unknown> } => entry !== undefined);
  if (normalizedMessages.length === 0) {
    return undefined;
  }

  const meta = isObject(candidate) ? extractGenericSessionMetadata(candidate) : {};
  const sessionRefRaw =
    options.defaultSessionId ??
    (isObject(candidate)
      ? asString(candidate.id) ??
        asString(candidate.sessionId) ??
        asString(candidate.session_id) ??
        asString(candidate.conversationId) ??
        asString(candidate.conversation_id) ??
        asString(candidate.chatId) ??
        asString(candidate.chat_id) ??
        asString(candidate.composerId)
      : undefined) ??
    sha1(originHint);
  const sessionId = options.defaultSessionId ?? `sess:${platform}:${sessionRefRaw}`;
  const firstUserMessage = normalizedMessages.find((message) => asString(message.record.role) === "user");
  const title =
    options.defaultTitle ??
    meta.title ??
    (Array.isArray(firstUserMessage?.record.content)
      ? truncate(stringifyToolContent(firstUserMessage.record.content), 72)
      : undefined);
  const workingDirectory = meta.workspacePath ?? options.defaultWorkingDirectory;
  const model = meta.model ?? normalizedMessages.map((message) => asString(message.record.model)).find(Boolean);
  const createdAt =
    coerceIso(isObject(candidate) ? candidate.createdAt : undefined) ??
    coerceIso(isObject(candidate) ? candidate.created_at : undefined) ??
    epochMillisToIso(isObject(candidate) ? asNumber(candidate.createdAt) : undefined) ??
    normalizedMessages[0]?.observedAt;
  const updatedAt =
    coerceIso(isObject(candidate) ? candidate.updatedAt : undefined) ??
    coerceIso(isObject(candidate) ? candidate.updated_at : undefined) ??
    epochMillisToIso(isObject(candidate) ? asNumber(candidate.updatedAt) : undefined) ??
    normalizedMessages.at(-1)?.observedAt ??
    createdAt;

  const records: ExtractedSessionSeed["records"] = [];
  if (title || model || workingDirectory || meta.parentUuid || meta.isSidechain) {
    records.push({
      pointer: "meta",
      observedAt: createdAt ?? nowIso(),
      rawJson: JSON.stringify({
        id: sessionId,
        title,
        model,
        cwd: workingDirectory,
        parentUuid: meta.parentUuid,
        isSidechain: meta.isSidechain,
      }),
    });
  }

  normalizedMessages
    .sort((left, right) => (left.observedAt ?? "").localeCompare(right.observedAt ?? ""))
    .forEach((message, index) => {
      records.push({
        pointer: `messages[${index}]`,
        observedAt: message.observedAt ?? nowIso(),
        rawJson: JSON.stringify(message.record),
      });
    });

  const hasUserOrAssistant = normalizedMessages.some((message) => {
    const role = asString(message.record.role);
    return role === "user" || role === "assistant";
  });
  if (!hasUserOrAssistant) {
    return undefined;
  }

  return {
    sessionId,
    title,
    createdAt,
    updatedAt,
    model,
    workingDirectory,
    records,
  };
}

function extractCandidateMessageEntries(candidate: unknown): unknown[] | undefined {
  if (Array.isArray(candidate)) {
    return candidate.some((entry) => normalizeMessageCandidate(entry)) ? candidate : undefined;
  }
  if (!isObject(candidate)) {
    return undefined;
  }

  const directArrays = [
    candidate.messages,
    candidate.items,
    candidate.turns,
    candidate.history,
    candidate.entries,
    candidate.parts,
  ];
  for (const entry of directArrays) {
    if (Array.isArray(entry) && entry.some((item) => normalizeMessageCandidate(item))) {
      return entry;
    }
  }

  for (const mapping of [candidate.messageMap, candidate.mapping]) {
    if (!isObject(mapping)) {
      continue;
    }
    const values = Object.values(mapping).map((value) => (isObject(value) && isObject(value.message) ? value.message : value));
    if (values.some((value) => normalizeMessageCandidate(value))) {
      return values;
    }
  }

  return undefined;
}

function normalizeMessageCandidate(
  value: unknown,
  defaultWorkingDirectory?: string,
): { observedAt?: string; record: Record<string, unknown> } | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const info = isObject(value.info) ? value.info : undefined;
  const message = isObject(value.message) ? value.message : undefined;
  const base = message ?? info ?? value;
  let content = extractGenericContentItems(base);
  if (content.length === 0 && Array.isArray(value.parts)) {
    content = extractGenericContentItems({ parts: value.parts });
  }
  if (content.length === 0) {
    const richText = asString(base.richText) ?? asString(value.richText);
    const extractedText = richText ? extractRichTextText(richText) : undefined;
    if (extractedText) {
      content = [{ type: "text", text: extractedText }];
    }
  }

  const role = extractGenericRole(base) ?? extractGenericRole(value) ?? extractGenericRole(info ?? {});
  if (!role && content.length === 0) {
    return undefined;
  }

  const observedAt =
    coerceIso(base.timestamp) ??
    coerceIso(base.createdAt) ??
    coerceIso(base.updatedAt) ??
    coerceIso(value.timestamp) ??
    coerceIso(info?.createdAt) ??
    epochMillisToIso(asNumber(base.timestamp)) ??
    epochMillisToIso(asNumber(base.createdAt)) ??
    epochMillisToIso(asNumber(base.created)) ??
    epochMillisToIso(asNumber(info?.createdAt)) ??
    epochMillisToIso(asNumber(info?.created)) ??
    epochMillisToIso(asNumber(value.createdAt));
  const meta = extractGenericSessionMetadata(value);
  const usage = extractTokenUsage(value) ?? extractTokenUsage(info) ?? extractTokenUsage(base);
  const stopReason =
    normalizeStopReason(base.stop_reason) ??
    normalizeStopReason(base.stopReason) ??
    normalizeStopReason(info?.stopReason) ??
    normalizeStopReason(value.stopReason);

  return {
    observedAt,
    record: {
      id: asString(base.id) ?? asString(value.id),
      role: role ?? "assistant",
      content,
      usage,
      stopReason,
      model:
        asString(base.model) ??
        asString(info?.model) ??
        asString(value.model),
      cwd: meta.workspacePath ?? defaultWorkingDirectory,
    },
  };
}

async function extractOpenCodeSessionSeed(
  filePath: string,
  fileBuffer: Buffer,
): Promise<ExtractedSessionSeed | undefined> {
  const parsed = safeJsonParse(fileBuffer.toString("utf8"));
  if (!isObject(parsed)) {
    return undefined;
  }

  const rawSessionId =
    asString(parsed.id) ??
    asString(parsed.sessionId) ??
    asString(parsed.session_id) ??
    path.basename(filePath, path.extname(filePath));
  const sessionId = `sess:opencode:${rawSessionId}`;
  const messageDir = path.join(path.dirname(path.dirname(filePath)), "message", rawSessionId);
  const records: ExtractedSessionSeed["records"] = [];
  const meta = extractGenericSessionMetadata(parsed);
  const title = meta.title ?? asString(parsed.title) ?? asString(parsed.name);
  const model = meta.model ?? asString(parsed.model);
  const workingDirectory = meta.workspacePath;
  const createdAt =
    coerceIso(parsed.createdAt) ??
    coerceIso(parsed.created_at) ??
    epochMillisToIso(asNumber(parsed.createdAt)) ??
    epochMillisToIso(asNumber(parsed.created));
  const updatedAt =
    coerceIso(parsed.updatedAt) ??
    coerceIso(parsed.updated_at) ??
    epochMillisToIso(asNumber(parsed.updatedAt)) ??
    epochMillisToIso(asNumber(parsed.updated));

  if (title || model || workingDirectory) {
    records.push({
      pointer: "meta",
      observedAt: createdAt ?? updatedAt ?? nowIso(),
      rawJson: JSON.stringify({
        id: sessionId,
        title,
        model,
        cwd: workingDirectory,
      }),
    });
  }

  if (await pathExists(messageDir)) {
    const messageFiles = (await fs.readdir(messageDir))
      .filter((name) => name.endsWith(".json"))
      .sort();
    for (const [index, name] of messageFiles.entries()) {
      const content = await fs.readFile(path.join(messageDir, name), "utf8");
      const parsedMessage = safeJsonParse(content);
      const normalized = normalizeMessageCandidate(parsedMessage, workingDirectory);
      if (!normalized) {
        continue;
      }
      records.push({
        pointer: `messages[${index}]`,
        observedAt: normalized.observedAt ?? nowIso(),
        rawJson: JSON.stringify(normalized.record),
      });
    }
  }

  if (records.length === 0) {
    const fallback = collectConversationSeedsFromValue("opencode", parsed, rawSessionId, {
      defaultSessionId: sessionId,
      defaultTitle: title,
      defaultWorkingDirectory: workingDirectory,
    });
    return fallback[0];
  }

  return {
    sessionId,
    title,
    createdAt,
    updatedAt,
    model,
    workingDirectory,
    records,
  };
}

function extractRichTextText(value: string): string | undefined {
  const parsed = safeJsonParse(value);
  const parts: string[] = [];
  const visit = (candidate: unknown) => {
    if (typeof candidate === "string") {
      return;
    }
    if (Array.isArray(candidate)) {
      for (const entry of candidate) {
        visit(entry);
      }
      return;
    }
    if (!isObject(candidate)) {
      return;
    }
    if (typeof candidate.text === "string") {
      parts.push(candidate.text);
    }
    for (const entry of Object.values(candidate)) {
      if (entry && typeof entry === "object") {
        visit(entry);
      }
    }
  };
  visit(parsed);
  const text = parts.join("").trim();
  return text || undefined;
}

function upsertExtractedSeed(
  target: Map<string, ExtractedSessionSeed>,
  seed: ExtractedSessionSeed,
): void {
  const existing = target.get(seed.sessionId);
  if (!existing) {
    target.set(seed.sessionId, seed);
    return;
  }
  target.set(seed.sessionId, {
    sessionId: seed.sessionId,
    title: existing.title ?? seed.title,
    createdAt: minIso(existing.createdAt, seed.createdAt),
    updatedAt: maxIso(existing.updatedAt, seed.updatedAt),
    model: existing.model ?? seed.model,
    workingDirectory: existing.workingDirectory ?? seed.workingDirectory,
    records: [...existing.records, ...seed.records].sort((left, right) =>
      (left.observedAt ?? "").localeCompare(right.observedAt ?? ""),
    ),
  });
}

function firstDefinedNumber(...values: Array<number | undefined>): number | undefined {
  return values.find((value) => typeof value === "number" && !Number.isNaN(value));
}

function sumDefinedNumbers(...values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => typeof value === "number" && !Number.isNaN(value));
  if (present.length === 0) {
    return undefined;
  }
  return present.reduce((sum, value) => sum + value, 0);
}

function extractTokenCountFromPayload(payload: Record<string, unknown>): number | undefined {
  const tokenUsage = isObject(payload.token_usage) ? payload.token_usage : undefined;
  return firstDefinedNumber(
    asNumber(payload.token_count),
    asNumber(payload.total_tokens),
    asNumber(tokenUsage?.total_tokens),
  );
}

function extractTokenUsageFromPayload(payload: Record<string, unknown>): TokenUsageMetrics | undefined {
  const tokenUsage = isObject(payload.token_usage) ? payload.token_usage : undefined;
  return extractTokenUsage(tokenUsage ?? payload);
}

function mergeTokenUsageMetrics(
  current: TokenUsageMetrics | undefined,
  incoming: TokenUsageMetrics | undefined,
): TokenUsageMetrics | undefined {
  if (!current) {
    return incoming ? { ...incoming } : undefined;
  }
  if (!incoming) {
    return current;
  }
  const cacheReadTokens = incoming.cache_read_input_tokens ?? current.cache_read_input_tokens;
  const cacheCreationTokens = incoming.cache_creation_input_tokens ?? current.cache_creation_input_tokens;
  const cachedInputTokens =
    cacheReadTokens !== undefined || cacheCreationTokens !== undefined
      ? (cacheReadTokens ?? 0) + (cacheCreationTokens ?? 0)
      : incoming.cached_input_tokens ?? current.cached_input_tokens;
  return {
    input_tokens: incoming.input_tokens ?? current.input_tokens,
    cache_read_input_tokens: cacheReadTokens,
    cache_creation_input_tokens: cacheCreationTokens,
    cached_input_tokens: cachedInputTokens,
    output_tokens: incoming.output_tokens ?? current.output_tokens,
    reasoning_output_tokens: incoming.reasoning_output_tokens ?? current.reasoning_output_tokens,
    total_tokens: incoming.total_tokens ?? current.total_tokens,
    model: incoming.model ?? current.model,
  };
}

function accumulateTokenUsageMetrics(
  current: TokenUsageMetrics | undefined,
  incoming: TokenUsageMetrics | undefined,
): TokenUsageMetrics | undefined {
  if (!current) {
    return incoming ? { ...incoming } : undefined;
  }
  if (!incoming) {
    return current;
  }

  const cacheReadTokens = sumDefinedNumbers(current.cache_read_input_tokens, incoming.cache_read_input_tokens);
  const cacheCreationTokens = sumDefinedNumbers(current.cache_creation_input_tokens, incoming.cache_creation_input_tokens);
  const cachedInputTokens =
    cacheReadTokens !== undefined || cacheCreationTokens !== undefined
      ? (cacheReadTokens ?? 0) + (cacheCreationTokens ?? 0)
      : sumDefinedNumbers(current.cached_input_tokens, incoming.cached_input_tokens);

  return {
    input_tokens: sumDefinedNumbers(current.input_tokens, incoming.input_tokens),
    cache_read_input_tokens: cacheReadTokens,
    cache_creation_input_tokens: cacheCreationTokens,
    cached_input_tokens: cachedInputTokens,
    output_tokens: sumDefinedNumbers(current.output_tokens, incoming.output_tokens),
    reasoning_output_tokens: sumDefinedNumbers(current.reasoning_output_tokens, incoming.reasoning_output_tokens),
    total_tokens: sumDefinedNumbers(current.total_tokens, incoming.total_tokens),
    model: incoming.model ?? current.model,
  };
}

function diffTokenUsageMetrics(
  current: TokenUsageMetrics | undefined,
  previous: TokenUsageMetrics | undefined,
): TokenUsageMetrics | undefined {
  if (!current) {
    return undefined;
  }

  const subtract = (currentValue: number | undefined, previousValue: number | undefined) => {
    if (typeof currentValue !== "number") {
      return undefined;
    }
    if (typeof previousValue !== "number") {
      return currentValue;
    }
    return Math.max(currentValue - previousValue, 0);
  };

  const cacheReadTokens = subtract(current.cache_read_input_tokens, previous?.cache_read_input_tokens);
  const cacheCreationTokens = subtract(current.cache_creation_input_tokens, previous?.cache_creation_input_tokens);
  const cachedInputTokens =
    cacheReadTokens !== undefined || cacheCreationTokens !== undefined
      ? (cacheReadTokens ?? 0) + (cacheCreationTokens ?? 0)
      : subtract(current.cached_input_tokens, previous?.cached_input_tokens);

  const delta: TokenUsageMetrics = {
    input_tokens: subtract(current.input_tokens, previous?.input_tokens),
    cache_read_input_tokens: cacheReadTokens,
    cache_creation_input_tokens: cacheCreationTokens,
    cached_input_tokens: cachedInputTokens,
    output_tokens: subtract(current.output_tokens, previous?.output_tokens),
    reasoning_output_tokens: subtract(current.reasoning_output_tokens, previous?.reasoning_output_tokens),
    total_tokens: subtract(current.total_tokens, previous?.total_tokens),
    model: current.model,
  };

  if (
    delta.input_tokens === undefined &&
    delta.cache_read_input_tokens === undefined &&
    delta.cache_creation_input_tokens === undefined &&
    delta.cached_input_tokens === undefined &&
    delta.output_tokens === undefined &&
    delta.reasoning_output_tokens === undefined &&
    delta.total_tokens === undefined
  ) {
    return undefined;
  }

  return delta;
}

function extractStopReasonFromPayload(payload: Record<string, unknown>): AssistantStopReason | undefined {
  return normalizeStopReason(payload.stop_reason) ?? normalizeStopReason(payload.stopReason);
}

function atomizeFragments(
  sourceId: string,
  sessionRef: string,
  profileId: string,
  fragments: SourceFragment[],
): {
  atoms: ConversationAtom[];
  edges: AtomEdge[];
} {
  const atoms: ConversationAtom[] = [];
  const edges: AtomEdge[] = [];
  let seq = 0;
  let lastAssistantTextAtomId: string | undefined;
  const toolCallsByCallId = new Map<string, string>();

  const sortedFragments = [...fragments].sort(compareFragments);
  for (const fragment of sortedFragments) {
    if (fragment.fragment_kind === "session_meta") {
      continue;
    }
    const atom = fragmentToAtom(sourceId, sessionRef, profileId, fragment, seq++);
    if (!atom) {
      continue;
    }
    atoms.push(atom);
    if (atom.actor_kind === "assistant" && atom.content_kind === "text") {
      lastAssistantTextAtomId = atom.id;
    }
    if (atom.content_kind === "tool_call") {
      const callId = asString(atom.payload.call_id);
      if (callId) {
        toolCallsByCallId.set(callId, atom.id);
      }
      if (lastAssistantTextAtomId) {
        edges.push(createEdge(sourceId, sessionRef, atom.id, lastAssistantTextAtomId, "spawned_from"));
      }
    }
    if (atom.content_kind === "tool_result") {
      const callId = asString(atom.payload.call_id);
      const callAtomId = callId ? toolCallsByCallId.get(callId) : undefined;
      if (callAtomId) {
        edges.push(createEdge(sourceId, sessionRef, atom.id, callAtomId, "tool_result_for"));
      }
    }
  }

  return { atoms, edges };
}

function fragmentToAtom(
  sourceId: string,
  sessionRef: string,
  profileId: string,
  fragment: SourceFragment,
  seqNo: number,
): ConversationAtom | undefined {
  if (fragment.fragment_kind === "text") {
    const actorKind = (fragment.payload.actor_kind as ActorKind | undefined) ?? "assistant";
    const originKind = (fragment.payload.origin_kind as OriginKind | undefined) ?? "assistant_authored";
    const displayPolicy = (fragment.payload.display_policy as DisplayPolicy | undefined) ?? "show";
    return {
      id: stableId("atom", sourceId, fragment.id),
      source_id: sourceId,
      session_ref: sessionRef,
      seq_no: seqNo,
      actor_kind: actorKind,
      origin_kind: originKind,
      content_kind: "text",
      time_key: fragment.time_key,
      display_policy: displayPolicy,
      payload: {
        ...fragment.payload,
        text: fragment.payload.text ?? "",
      },
      fragment_refs: [fragment.id],
      source_format_profile_id: profileId,
    };
  }

  if (fragment.fragment_kind === "tool_call") {
    return {
      id: stableId("atom", sourceId, fragment.id),
      source_id: sourceId,
      session_ref: sessionRef,
      seq_no: seqNo,
      actor_kind: "tool",
      origin_kind: "tool_generated",
      content_kind: "tool_call",
      time_key: fragment.time_key,
      display_policy: "show",
      payload: fragment.payload,
      fragment_refs: [fragment.id],
      source_format_profile_id: profileId,
    };
  }

  if (fragment.fragment_kind === "tool_result") {
    return {
      id: stableId("atom", sourceId, fragment.id),
      source_id: sourceId,
      session_ref: sessionRef,
      seq_no: seqNo,
      actor_kind: "tool",
      origin_kind: "tool_generated",
      content_kind: "tool_result",
      time_key: fragment.time_key,
      display_policy: "show",
      payload: fragment.payload,
      fragment_refs: [fragment.id],
      source_format_profile_id: profileId,
    };
  }

  if (
    fragment.fragment_kind === "workspace_signal" ||
    fragment.fragment_kind === "model_signal" ||
    fragment.fragment_kind === "token_usage_signal" ||
    fragment.fragment_kind === "session_relation" ||
    fragment.fragment_kind === "title_signal" ||
    fragment.fragment_kind === "unknown"
  ) {
    return {
      id: stableId("atom", sourceId, fragment.id),
      source_id: sourceId,
      session_ref: sessionRef,
      seq_no: seqNo,
      actor_kind: "system",
      origin_kind: "source_meta",
      content_kind: "meta_signal",
      time_key: fragment.time_key,
      display_policy: "hide",
      payload: {
        signal_kind: fragment.fragment_kind,
        opaque_fragment: fragment.fragment_kind === "unknown",
        ...fragment.payload,
      },
      fragment_refs: [fragment.id],
      source_format_profile_id: profileId,
    };
  }

  return undefined;
}

function hydrateDraftFromAtoms(draft: SessionDraft, atoms: ConversationAtom[]): void {
  const firstAtom = atoms[0];
  const lastAtom = atoms.at(-1);
  draft.created_at = draft.created_at ?? firstAtom?.time_key ?? nowIso();
  draft.updated_at = draft.updated_at ?? lastAtom?.time_key ?? draft.created_at;
  for (const atom of atoms) {
    if (atom.content_kind === "meta_signal" && atom.payload.signal_kind === "workspace_signal") {
      draft.working_directory = (atom.payload.path as string | undefined) ?? draft.working_directory;
    }
    if (atom.content_kind === "meta_signal" && atom.payload.signal_kind === "model_signal") {
      draft.model = (atom.payload.model as string | undefined) ?? draft.model;
    }
    if (!draft.title && atom.actor_kind === "user" && atom.origin_kind === "user_authored") {
      const text = asString(atom.payload.text);
      draft.title = text ? truncate(text, 72) : draft.title;
    }
  }
}

function deriveSourceNativeProjectRef(source: SourceDefinition, filePath: string): string | undefined {
  const normalizedBaseDir = normalizeWorkspacePath(source.base_dir);
  const normalizedFilePath = normalizeWorkspacePath(filePath);
  if (!normalizedBaseDir || !normalizedFilePath) {
    return undefined;
  }

  const relativePath = path.posix.relative(normalizedBaseDir, normalizedFilePath);
  if (!relativePath || relativePath.startsWith("..")) {
    return undefined;
  }

  const parts = relativePath.split("/").filter(Boolean);
  if (source.platform === "cursor") {
    const transcriptIndex = parts.indexOf("agent-transcripts");
    if (transcriptIndex > 0) {
      return parts[transcriptIndex - 1];
    }
  }

  if (source.platform === "antigravity" && parts[0] === "brain" && parts.length >= 3) {
    return parts[1];
  }

  return undefined;
}

function buildProjectObservationCandidates(
  draft: SessionDraft,
  atoms: ConversationAtom[],
  gitProjectEvidence?: GitProjectEvidence,
): DerivedCandidate[] {
  const workspaceSignals = new Map<string, ConversationAtom>();
  for (const atom of atoms) {
    if (atom.content_kind !== "meta_signal") {
      continue;
    }
    if (atom.payload.signal_kind !== "workspace_signal") {
      continue;
    }
    const workspacePath = asString(atom.payload.path);
    if (!workspacePath) {
      continue;
    }
    const workspacePathNormalized = normalizeWorkspacePath(workspacePath) ?? workspacePath;
    workspaceSignals.set(workspacePathNormalized, atom);
  }

  const workspaceCandidates: DerivedCandidate[] = [...workspaceSignals.values()].map((atom) => ({
    id: stableId(
      "candidate",
      "project_observation",
      draft.source_id,
      draft.id,
      normalizeWorkspacePath(asString(atom.payload.path) ?? "") ?? String(atom.payload.path),
    ),
    source_id: draft.source_id,
    session_ref: draft.id,
    candidate_kind: "project_observation" as const,
    input_atom_refs: [atom.id],
    started_at: atom.time_key,
    ended_at: atom.time_key,
    rule_version: RULE_VERSION,
    evidence: {
      workspace_path: atom.payload.path,
      workspace_path_normalized: normalizeWorkspacePath(asString(atom.payload.path) ?? ""),
      repo_root: gitProjectEvidence?.repoRoot,
      repo_remote: gitProjectEvidence?.repoRemote,
      repo_fingerprint: gitProjectEvidence?.repoFingerprint,
      source_native_project_ref: draft.source_native_project_ref,
      confidence: 0.5,
      reason: "workspace_signal_detected",
      debug_summary: gitProjectEvidence?.repoFingerprint
        ? "workspace signal with git-backed repository evidence"
        : "workspace signal without git repository evidence",
    },
  }));

  if (workspaceCandidates.length > 0) {
    return workspaceCandidates;
  }

  if (!draft.source_native_project_ref) {
    return [];
  }

  const seedAtom = atoms[0];
  const observedAt = seedAtom?.time_key ?? draft.updated_at ?? draft.created_at ?? nowIso();
  return [
    {
      id: stableId("candidate", "project_observation", draft.source_id, draft.id, draft.source_native_project_ref),
      source_id: draft.source_id,
      session_ref: draft.id,
      candidate_kind: "project_observation" as const,
      input_atom_refs: seedAtom ? [seedAtom.id] : [],
      started_at: observedAt,
      ended_at: observedAt,
      rule_version: RULE_VERSION,
      evidence: {
        source_native_project_ref: draft.source_native_project_ref,
        confidence: 0.35,
        reason: "source_native_project_detected",
        debug_summary: "source-native project directory detected without workspace path evidence",
      },
    },
  ];
}

function buildSubmissionGroups(
  draft: SessionDraft,
  atoms: ConversationAtom[],
): {
  groups: DerivedCandidate[];
  edges: AtomEdge[];
} {
  const groups: DerivedCandidate[] = [];
  const edges: AtomEdge[] = [];
  let currentGroupAtomIds: string[] = [];
  let currentStartedAt: string | undefined;
  let currentEndedAt: string | undefined;
  let lastUserAtomId: string | undefined;
  let assistantSeenAfterGroupStart = false;
  let groupIndex = 0;

  const commitGroup = () => {
    if (currentGroupAtomIds.length === 0 || !currentStartedAt || !currentEndedAt) {
      return;
    }
    groups.push({
      id: stableId("candidate", "submission_group", draft.source_id, draft.id, String(groupIndex)),
      source_id: draft.source_id,
      session_ref: draft.id,
      candidate_kind: "submission_group",
      input_atom_refs: [...currentGroupAtomIds],
      started_at: currentStartedAt,
      ended_at: currentEndedAt,
      rule_version: RULE_VERSION,
      evidence: {
        group_index: groupIndex,
        assistant_seen_after_group_start: assistantSeenAfterGroupStart,
        boundary_reason:
          assistantSeenAfterGroupStart
            ? "assistant reply observed after the current user submission"
            : "consecutive user-authored or injected fragments continued the same submission",
        debug_atom_refs: [...currentGroupAtomIds],
      },
    });
    groupIndex += 1;
    currentGroupAtomIds = [];
    currentStartedAt = undefined;
    currentEndedAt = undefined;
    lastUserAtomId = undefined;
    assistantSeenAfterGroupStart = false;
  };

  for (const atom of atoms) {
    if (atom.actor_kind === "assistant" && atom.content_kind === "text" && atom.display_policy !== "hide") {
      assistantSeenAfterGroupStart = currentGroupAtomIds.length > 0 || assistantSeenAfterGroupStart;
    }

    if (!isUserTurnAtom(atom)) {
      continue;
    }

    const continuesCurrentGroup =
      currentGroupAtomIds.length > 0 &&
      (!assistantSeenAfterGroupStart || atom.origin_kind === "injected_user_shaped");

    if (!continuesCurrentGroup) {
      commitGroup();
    }

    if (!currentStartedAt) {
      currentStartedAt = atom.time_key;
    }
    currentEndedAt = atom.time_key;
    currentGroupAtomIds.push(atom.id);

    if (lastUserAtomId) {
      edges.push(createEdge(draft.source_id, draft.id, atom.id, lastUserAtomId, "same_submission"));
      if (continuesCurrentGroup) {
        edges.push(createEdge(draft.source_id, draft.id, atom.id, lastUserAtomId, "continuation_of"));
      }
    }

    lastUserAtomId = atom.id;
  }

  commitGroup();
  return { groups, edges };
}

function buildTurnsAndContext(
  draft: SessionDraft,
  fragments: SourceFragment[],
  records: RawRecord[],
  blobs: CapturedBlob[],
  atoms: ConversationAtom[],
  submissionGroups: DerivedCandidate[],
  edges: AtomEdge[],
): {
  session: SessionProjection;
  turnCandidates: DerivedCandidate[];
  contextCandidates: DerivedCandidate[];
  turns: UserTurnProjection[];
  contexts: TurnContextProjection[];
} {
  const turnCandidates: DerivedCandidate[] = [];
  const contextCandidates: DerivedCandidate[] = [];
  const turns: UserTurnProjection[] = [];
  const contexts: TurnContextProjection[] = [];
  const fragmentById = new Map(fragments.map((fragment) => [fragment.id, fragment]));
  const recordById = new Map(records.map((record) => [record.id, record]));
  const blobById = new Map(blobs.map((blob) => [blob.id, blob]));

  for (const [index, group] of submissionGroups.entries()) {
    const firstAtomId = group.input_atom_refs[0];
    if (!firstAtomId) {
      continue;
    }
    const atomIndex = atoms.findIndex((atom) => atom.id === firstAtomId);

    const nextGroup = submissionGroups[index + 1];
    const nextStartAtomId = nextGroup?.input_atom_refs[0];
    const currentGroupAtomSet = new Set(group.input_atom_refs);
    const turnId = stableId("turn", draft.source_id, draft.id, String(index));
    const contextAtoms = atoms.filter((atom, atomIndexValue) => {
      if (atomIndex < 0 || atomIndexValue <= atomIndex) {
        return false;
      }
      if (nextStartAtomId) {
        const nextIndex = atoms.findIndex((candidateAtom) => candidateAtom.id === nextStartAtomId);
        if (nextIndex >= 0 && atomIndexValue >= nextIndex) {
          return false;
        }
      }
      return !currentGroupAtomSet.has(atom.id);
    });

    const groupAtoms = atoms.filter((atom) => currentGroupAtomSet.has(atom.id));
    const turnCandidateId = stableId("candidate", "turn", draft.source_id, draft.id, String(index));
    const contextCandidateId = stableId("candidate", "context", draft.source_id, draft.id, String(index));
    const userMessages = groupAtoms
      .filter((atom) => atom.content_kind === "text" && (atom.origin_kind === "user_authored" || atom.origin_kind === "injected_user_shaped"))
      .map((atom, userIndex): UserMessageProjection => {
        const rawText = asString(atom.payload.text) ?? "";
        const isInjected = atom.origin_kind === "injected_user_shaped";
        const masked = applyMaskTemplates(rawText, "user_message", { injected: isInjected });
        return {
          id: stableId("user-message", draft.source_id, draft.id, atom.id),
          raw_text: rawText,
          sequence: userIndex,
          is_injected: isInjected,
          created_at: atom.time_key,
          atom_refs: [atom.id],
          canonical_text: masked.canonical_text,
          display_segments: masked.display_segments,
        };
      });

    const rawText = userMessages.map((message) => message.raw_text).join("\n\n");
    const displaySegments = joinDisplaySegments(
      userMessages.map((message) => message.display_segments ?? [{ type: message.is_injected ? "injected" : "text", content: message.raw_text }]),
    );
    const canonicalText = userMessages
      .map((message) => message.canonical_text ?? "")
      .filter((value) => value.length > 0)
      .join("\n\n");
    const contextProjection = buildTurnContext(
      turnId,
      draft,
      groupAtoms,
      contextAtoms,
      fragmentById,
      edges,
    );

    const hasAuthoredUserInput = userMessages.some((message) => !message.is_injected);
    const hasRenderableContext =
      contextProjection.assistant_replies.length > 0 ||
      contextProjection.tool_calls.length > 0 ||
      contextProjection.system_messages.length > 0;
    if (!hasAuthoredUserInput && !hasRenderableContext) {
      continue;
    }

    turnCandidates.push({
      id: turnCandidateId,
      source_id: draft.source_id,
      session_ref: draft.id,
      candidate_kind: "turn",
      input_atom_refs: group.input_atom_refs,
      started_at: group.started_at,
      ended_at: contextAtoms.at(-1)?.time_key ?? group.ended_at,
      rule_version: RULE_VERSION,
      evidence: {
        submission_group_id: group.id,
      },
    });
    contextCandidates.push({
      id: contextCandidateId,
      source_id: draft.source_id,
      session_ref: draft.id,
      candidate_kind: "context_span",
      input_atom_refs: contextAtoms.map((atom) => atom.id),
      started_at: group.started_at,
      ended_at: contextAtoms.at(-1)?.time_key ?? group.ended_at,
      rule_version: RULE_VERSION,
      evidence: {
        turn_candidate_id: turnCandidateId,
      },
    });

    const allFragmentIds = new Set<string>();
    const allRecordIds = new Set<string>();
    const allBlobIds = new Set<string>();
    for (const atom of [...groupAtoms, ...contextAtoms]) {
      for (const fragmentId of atom.fragment_refs) {
        allFragmentIds.add(fragmentId);
        const recordId = fragmentById.get(fragmentId)?.record_id;
        if (recordId) {
          allRecordIds.add(recordId);
          const blobId = recordById.get(recordId)?.blob_id;
          if (blobId && blobById.get(blobId)) {
            allBlobIds.add(blobId);
          }
        }
      }
    }

    contexts.push(contextProjection);
    const contextTokenUsage = summarizeAssistantReplyUsage(contextProjection.assistant_replies);
    turns.push({
      id: turnId,
      revision_id: `${turnId}:r1`,
      turn_id: turnId,
      turn_revision_id: `${turnId}:r1`,
      user_messages: userMessages,
      raw_text: rawText,
      canonical_text: canonicalText || extractCanonicalFallback(displaySegments),
      display_segments: displaySegments,
      created_at: group.started_at,
      submission_started_at: group.started_at,
      last_context_activity_at: contextAtoms.at(-1)?.time_key ?? group.ended_at,
      session_id: draft.id,
      source_id: draft.source_id,
      link_state: "unlinked",
      sync_axis: "current",
      value_axis: "active",
      retention_axis: "keep_raw_and_derived",
      context_ref: turnId,
      context_summary: {
        assistant_reply_count: contextProjection.assistant_replies.length,
        tool_call_count: contextProjection.tool_calls.length,
        token_usage: contextTokenUsage,
        total_tokens:
          contextTokenUsage?.total_tokens ??
          (contextProjection.assistant_replies.reduce((sum, reply) => sum + (reply.token_count ?? 0), 0) || undefined),
        primary_model: summarizeAssistantReplyPrimaryModel(contextProjection.assistant_replies) ?? draft.model,
        has_errors: contextProjection.assistant_replies.some((reply) => reply.stop_reason === "error"),
      },
      lineage: {
        atom_refs: [...group.input_atom_refs, ...contextAtoms.map((atom) => atom.id)],
        candidate_refs: [group.id, turnCandidateId, contextCandidateId],
        fragment_refs: [...allFragmentIds],
        record_refs: [...allRecordIds],
        blob_refs: [...allBlobIds],
      },
    });
  }

  const session: SessionProjection = {
    id: draft.id,
    source_id: draft.source_id,
    source_platform: draft.source_platform,
    host_id: draft.host_id,
    title: draft.title,
    created_at: draft.created_at ?? nowIso(),
    updated_at: draft.updated_at ?? draft.created_at ?? nowIso(),
    turn_count: turns.length,
    model: draft.model,
    working_directory: draft.working_directory,
    source_native_project_ref: draft.source_native_project_ref,
    sync_axis: "current",
  };

  return { session, turnCandidates, contextCandidates, turns, contexts };
}

function buildTurnContext(
  turnId: string,
  draft: SessionDraft,
  groupAtoms: ConversationAtom[],
  contextAtoms: ConversationAtom[],
  fragmentById: Map<string, SourceFragment>,
  edges: AtomEdge[],
): TurnContextProjection {
  const assistantReplies: TurnContextProjection["assistant_replies"] = [];
  const systemMessages: TurnContextProjection["system_messages"] = [];
  const toolCalls: ToolCallProjection[] = [];
  const rawEventRefs = new Set<string>();
  const replyIdByAtomId = new Map<string, string>();
  const replyByAtomId = new Map<string, TurnContextProjection["assistant_replies"][number]>();
  const repliesWithSignalTotals = new Set<string>();
  let toolSequence = 0;
  let activeAssistantReply: TurnContextProjection["assistant_replies"][number] | undefined;
  let activeModel = draft.model;

  for (const atom of [...groupAtoms, ...contextAtoms]) {
    for (const fragmentId of atom.fragment_refs) {
      const recordId = fragmentById.get(fragmentId)?.record_id;
      if (recordId) {
        rawEventRefs.add(recordId);
      }
    }
  }

  for (const atom of contextAtoms) {
    if (atom.content_kind === "meta_signal" && atom.payload.signal_kind === "model_signal") {
      const signalModel = asString(atom.payload.model);
      if (signalModel) {
        activeModel = signalModel;
      }
      continue;
    }
    if (atom.actor_kind === "system" && atom.content_kind === "text") {
      const content = asString(atom.payload.text) ?? "";
      const masked = applyMaskTemplates(content, "system_message");
      systemMessages.push({
        id: stableId("system-message", atom.id),
        content,
        display_segments: masked.display_segments,
        position: "interleaved",
        sequence: systemMessages.length,
        created_at: atom.time_key,
      });
      continue;
    }
    if (atom.actor_kind === "assistant" && atom.content_kind === "text") {
      const replyId = stableId("assistant-reply", atom.id);
      replyIdByAtomId.set(atom.id, replyId);
      const content = asString(atom.payload.text) ?? "";
      const masked = applyMaskTemplates(content, "assistant_reply");
      const tokenUsage = extractTokenUsageFromPayload(atom.payload);
      const replyModel =
        asString(atom.payload.model) ??
        tokenUsage?.model ??
        activeModel ??
        draft.model ??
        "unknown";
      const reply = {
        id: replyId,
        content,
        display_segments: masked.display_segments,
        content_preview: truncate(masked.canonical_text || content, 140),
        token_usage: tokenUsage,
        token_count: extractTokenCountFromPayload(atom.payload) ?? tokenUsage?.total_tokens,
        model: replyModel,
        created_at: atom.time_key,
        tool_call_ids: [],
        stop_reason: extractStopReasonFromPayload(atom.payload),
      };
      assistantReplies.push(reply);
      replyByAtomId.set(atom.id, reply);
      activeAssistantReply = reply;
      if (replyModel !== "unknown") {
        activeModel = replyModel;
      }
      continue;
    }
  }

  activeAssistantReply = undefined;
  for (const atom of contextAtoms) {
    if (atom.actor_kind === "assistant" && atom.content_kind === "text") {
      activeAssistantReply = replyByAtomId.get(atom.id);
      continue;
    }
    if (
      atom.content_kind === "meta_signal" &&
      atom.payload.signal_kind === "token_usage_signal" &&
      asString(atom.payload.scope) !== "session"
    ) {
      const reply = activeAssistantReply ?? assistantReplies.at(-1);
      if (!reply) {
        continue;
      }
      const deltaUsage = isObject(atom.payload.delta_token_usage)
        ? extractTokenUsageFromPayload({ token_usage: atom.payload.delta_token_usage })
        : undefined;
      const tokenUsage = extractTokenUsageFromPayload(atom.payload);
      const tokenCount = extractTokenCountFromPayload(atom.payload);
      const stopReason = extractStopReasonFromPayload(atom.payload);
      const signalModel = asString(atom.payload.model) ?? tokenUsage?.model;
      if (deltaUsage) {
        const signalBase = repliesWithSignalTotals.has(reply.id) ? reply.token_usage : undefined;
        reply.token_usage = accumulateTokenUsageMetrics(signalBase, deltaUsage);
        reply.token_count = repliesWithSignalTotals.has(reply.id)
          ? sumDefinedNumbers(reply.token_count, deltaUsage.total_tokens) ?? reply.token_count
          : deltaUsage.total_tokens ?? reply.token_count;
        repliesWithSignalTotals.add(reply.id);
      } else {
        reply.token_usage = mergeTokenUsageMetrics(reply.token_usage, tokenUsage);
        reply.token_count = tokenCount ?? reply.token_usage?.total_tokens ?? reply.token_count;
      }
      if (signalModel) {
        reply.model = signalModel;
      }
      reply.stop_reason = stopReason ?? reply.stop_reason;
    }
  }

  const lastAssistantReplyId = () => assistantReplies.at(-1)?.id ?? stableId("assistant-reply", draft.id, "synthetic");
  for (const atom of contextAtoms) {
    if (atom.content_kind !== "tool_call") {
      continue;
    }
    const incomingEdge = edges.find((edge) => edge.from_atom_id === atom.id && edge.edge_kind === "spawned_from");
    const replyId = incomingEdge ? replyIdByAtomId.get(incomingEdge.to_atom_id) ?? lastAssistantReplyId() : lastAssistantReplyId();
    const inputJson = JSON.stringify(atom.payload.input ?? {});
    const maskedInput = applyMaskTemplates(inputJson, "tool_input");
    const toolCall: ToolCallProjection = {
      id: stableId("tool-call", atom.id),
      tool_name: asString(atom.payload.tool_name) ?? "tool_call",
      input: isObject(atom.payload.input) ? atom.payload.input : {},
      input_summary: truncate(maskedInput.canonical_text || inputJson, 140),
      input_display_segments: maskedInput.display_segments,
      status: "success",
      reply_id: replyId,
      sequence: toolSequence++,
      created_at: atom.time_key,
    };

    const resultEdge = edges.find((edge) => edge.to_atom_id === atom.id && edge.edge_kind === "tool_result_for");
    const resultAtom = resultEdge ? contextAtoms.find((candidate) => candidate.id === resultEdge.from_atom_id) : undefined;
    if (resultAtom) {
      const output = asString(resultAtom.payload.output) ?? "";
      const maskedOutput = applyMaskTemplates(output, "tool_output");
      toolCall.output = output;
      toolCall.output_preview = truncate(maskedOutput.canonical_text || output, 140);
      toolCall.output_display_segments = maskedOutput.display_segments;
    }
    toolCalls.push(toolCall);
  }

  for (const reply of assistantReplies) {
    reply.tool_call_ids = toolCalls.filter((toolCall) => toolCall.reply_id === reply.id).map((toolCall) => toolCall.id);
  }

  return {
    turn_id: turnId,
    system_messages: systemMessages,
    assistant_replies: assistantReplies,
    tool_calls: toolCalls,
    raw_event_refs: [...rawEventRefs],
  };
}

function summarizeAssistantReplyUsage(
  replies: TurnContextProjection["assistant_replies"],
): TokenUsageMetrics | undefined {
  let inputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let reasoningOutputTokens = 0;
  let totalTokens = 0;
  let hasInputTokens = false;
  let hasCacheReadTokens = false;
  let hasCacheCreationTokens = false;
  let hasCachedInputTokens = false;
  let hasOutputTokens = false;
  let hasReasoningOutputTokens = false;
  let hasTotalTokens = false;

  for (const reply of replies) {
    if (typeof reply.token_usage?.input_tokens === "number") {
      inputTokens += reply.token_usage.input_tokens;
      hasInputTokens = true;
    }
    if (typeof reply.token_usage?.cache_read_input_tokens === "number") {
      cacheReadTokens += reply.token_usage.cache_read_input_tokens;
      hasCacheReadTokens = true;
    }
    if (typeof reply.token_usage?.cache_creation_input_tokens === "number") {
      cacheCreationTokens += reply.token_usage.cache_creation_input_tokens;
      hasCacheCreationTokens = true;
    }
    const replyCachedInputTokens = firstDefinedNumber(
      reply.token_usage?.cached_input_tokens,
      sumDefinedNumbers(reply.token_usage?.cache_read_input_tokens, reply.token_usage?.cache_creation_input_tokens),
    );
    if (typeof replyCachedInputTokens === "number") {
      cachedInputTokens += replyCachedInputTokens;
      hasCachedInputTokens = true;
    }
    if (typeof reply.token_usage?.output_tokens === "number") {
      outputTokens += reply.token_usage.output_tokens;
      hasOutputTokens = true;
    }
    if (typeof reply.token_usage?.reasoning_output_tokens === "number") {
      reasoningOutputTokens += reply.token_usage.reasoning_output_tokens;
      hasReasoningOutputTokens = true;
    }

    const replyTotalTokens = firstDefinedNumber(reply.token_usage?.total_tokens, reply.token_count);
    if (typeof replyTotalTokens === "number") {
      totalTokens += replyTotalTokens;
      hasTotalTokens = true;
    }
  }

  if (
    !hasInputTokens &&
    !hasCacheReadTokens &&
    !hasCacheCreationTokens &&
    !hasCachedInputTokens &&
    !hasOutputTokens &&
    !hasReasoningOutputTokens &&
    !hasTotalTokens
  ) {
    return undefined;
  }

  return {
    input_tokens: hasInputTokens ? inputTokens : undefined,
    cache_read_input_tokens: hasCacheReadTokens ? cacheReadTokens : undefined,
    cache_creation_input_tokens: hasCacheCreationTokens ? cacheCreationTokens : undefined,
    cached_input_tokens: hasCachedInputTokens ? cachedInputTokens : undefined,
    output_tokens: hasOutputTokens ? outputTokens : undefined,
    reasoning_output_tokens: hasReasoningOutputTokens ? reasoningOutputTokens : undefined,
    total_tokens: hasTotalTokens ? totalTokens : undefined,
  };
}

function summarizeAssistantReplyPrimaryModel(
  replies: TurnContextProjection["assistant_replies"],
): string | undefined {
  const knownReplies = replies.filter((reply) => reply.model !== "unknown");
  if (knownReplies.length === 0) {
    return undefined;
  }

  const tokenTotalsByModel = new Map<string, number>();
  const lastSeenOrder = new Map<string, number>();
  let hasTokenTotals = false;

  knownReplies.forEach((reply, index) => {
    lastSeenOrder.set(reply.model, index);
    const replyTotalTokens = firstDefinedNumber(reply.token_usage?.total_tokens, reply.token_count);
    if (typeof replyTotalTokens === "number") {
      hasTokenTotals = true;
      tokenTotalsByModel.set(reply.model, (tokenTotalsByModel.get(reply.model) ?? 0) + replyTotalTokens);
    }
  });

  if (hasTokenTotals) {
    return [...tokenTotalsByModel.entries()]
      .sort((left, right) => {
        if (right[1] !== left[1]) {
          return right[1] - left[1];
        }
        return (lastSeenOrder.get(right[0]) ?? -1) - (lastSeenOrder.get(left[0]) ?? -1);
      })[0]?.[0];
  }

  return knownReplies.at(-1)?.model;
}

function buildStageRuns(
  sourceId: string,
  sourceFormatProfile: SourceFormatProfile,
  startedAt: string,
  finishedAt: string,
  counts: {
    files: number;
    blobs: number;
    records: number;
    fragments: number;
    atoms: number;
    candidates: number;
    sessions: number;
    turns: number;
    lossAudits: LossAuditRecord[];
  },
): StageRun[] {
  const failureCounts = countLossAuditsByStage(counts.lossAudits);
  const unparseableRecords = counts.lossAudits.filter(
    (audit) => audit.stage_kind === "extract_records" && audit.diagnostic_code === "record_unparseable",
  ).length;
  const stageStats: Record<StageKind, Record<string, number>> = {
    capture: {
      input_count: counts.files,
      output_count: counts.blobs,
      success_count: counts.blobs,
      failure_count: failureCounts.capture,
      skipped_count: 0,
      unparseable_count: 0,
      files: counts.files,
      blobs: counts.blobs,
    },
    extract_records: {
      input_count: counts.blobs,
      output_count: counts.records,
      success_count: Math.max(counts.records - unparseableRecords, 0),
      failure_count: failureCounts.extract_records,
      skipped_count: 0,
      unparseable_count: unparseableRecords,
      records: counts.records,
    },
    parse_source_fragments: {
      input_count: counts.records,
      output_count: counts.fragments,
      success_count: counts.fragments,
      failure_count: failureCounts.parse_source_fragments,
      skipped_count: 0,
      unparseable_count: 0,
      fragments: counts.fragments,
    },
    atomize: {
      input_count: counts.fragments,
      output_count: counts.atoms,
      success_count: counts.atoms,
      failure_count: failureCounts.atomize,
      skipped_count: 0,
      unparseable_count: 0,
      atoms: counts.atoms,
    },
    derive_candidates: {
      input_count: counts.atoms,
      output_count: counts.candidates,
      success_count: counts.candidates,
      failure_count: failureCounts.derive_candidates,
      skipped_count: 0,
      unparseable_count: 0,
      candidates: counts.candidates,
    },
    finalize_projections: {
      input_count: counts.candidates,
      output_count: counts.turns,
      success_count: counts.turns,
      failure_count: failureCounts.finalize_projections,
      skipped_count: 0,
      unparseable_count: 0,
      sessions: counts.sessions,
      turns: counts.turns,
    },
    apply_masks: {
      input_count: counts.turns,
      output_count: counts.turns,
      success_count: counts.turns,
      failure_count: failureCounts.apply_masks,
      skipped_count: 0,
      unparseable_count: 0,
      turns: counts.turns,
    },
    index_projections: {
      input_count: counts.turns,
      output_count: counts.turns,
      success_count: counts.turns,
      failure_count: failureCounts.index_projections,
      skipped_count: 0,
      unparseable_count: 0,
      turns: counts.turns,
    },
  };

  return (Object.keys(stageStats) as StageKind[]).map((stage) => ({
    id: buildStageRunId(sourceId, stage),
    source_id: sourceId,
    stage_kind: stage,
    parser_version: sourceFormatProfile.parser_version,
    parser_capabilities: [...sourceFormatProfile.capabilities],
    source_format_profile_ids: [sourceFormatProfile.id],
    started_at: startedAt,
    finished_at: finishedAt,
    status: failureCounts[stage] > 0 && stageStats[stage].success_count === 0 ? "error" : "success",
    stats: stageStats[stage],
  }));
}

function buildStageRunId(sourceId: string, stageKind: StageKind): string {
  return stableId("stage-run", sourceId, stageKind);
}

function countLossAuditsByStage(lossAudits: readonly LossAuditRecord[]): Record<StageKind, number> {
  const counts: Record<StageKind, number> = {
    capture: 0,
    extract_records: 0,
    parse_source_fragments: 0,
    atomize: 0,
    derive_candidates: 0,
    finalize_projections: 0,
    apply_masks: 0,
    index_projections: 0,
  };
  for (const audit of lossAudits) {
    counts[audit.stage_kind] += 1;
  }
  return counts;
}

function resolveSourceFormatProfile(source: SourceDefinition): SourceFormatProfile {
  const localProfile = SOURCE_FORMAT_PROFILES[source.platform as SupportedSourcePlatform];
  if (localProfile) {
    return cloneSourceFormatProfile(localProfile);
  }

  return {
    id: `${source.platform}:fallback:v1`,
    family: source.family,
    platform: source.platform,
    parser_version: `${source.platform}-parser@${RULE_VERSION}`,
    description: `Fallback parser profile for ${source.display_name}.`,
    capabilities: ["loss_audits"],
  };
}

function cloneSourceFormatProfile(profile: SourceFormatProfile): SourceFormatProfile {
  return {
    ...profile,
    capabilities: [...profile.capabilities],
  };
}

function joinDisplaySegments(segmentGroups: readonly (readonly DisplaySegment[])[]): DisplaySegment[] {
  const segments: DisplaySegment[] = [];
  for (const [index, group] of segmentGroups.entries()) {
    if (index > 0) {
      segments.push({ type: "text", content: "\n\n" });
    }
    segments.push(...group);
  }
  return segments;
}

function extractCanonicalFallback(segments: readonly DisplaySegment[]): string {
  return segments
    .map((segment) => {
      if (segment.type === "masked") {
        return `[${segment.mask_label ?? "Masked"}]`;
      }
      if (segment.type === "injected") {
        return "";
      }
      return segment.content;
    })
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function createFragment(
  context: FragmentBuildContext,
  record: RawRecord,
  seqNo: number,
  fragmentKind: SourceFragment["fragment_kind"],
  timeKey: string,
  payload: Record<string, unknown>,
): SourceFragment {
  return {
    id: stableId("fragment", context.source.id, context.sessionId, record.id, String(seqNo), fragmentKind),
    source_id: context.source.id,
    session_ref: context.sessionId,
    record_id: record.id,
    seq_no: seqNo,
    fragment_kind: fragmentKind,
    actor_kind: payload.actor_kind as ActorKind | undefined,
    origin_kind: payload.origin_kind as OriginKind | undefined,
    time_key: timeKey,
    payload,
    raw_refs: [record.id],
    source_format_profile_id: context.profileId,
  };
}

function createEdge(
  sourceId: string,
  sessionRef: string,
  fromAtomId: string,
  toAtomId: string,
  edgeKind: AtomEdge["edge_kind"],
): AtomEdge {
  return {
    id: stableId("edge", sourceId, sessionRef, fromAtomId, toAtomId, edgeKind),
    source_id: sourceId,
    session_ref: sessionRef,
    from_atom_id: fromAtomId,
    to_atom_id: toAtomId,
    edge_kind: edgeKind,
  };
}

function createLossAudit(
  sourceId: string,
  scopeRef: string,
  lossKind: LossAuditRecord["loss_kind"],
  detail: string,
  options: LossAuditOptions = {},
): LossAuditRecord {
  const stageKind = options.stageKind ?? "parse_source_fragments";
  return {
    id: stableId(
      "loss-audit",
      sourceId,
      stageKind,
      options.diagnosticCode ?? lossKind,
      scopeRef,
      detail,
    ),
    source_id: sourceId,
    stage_run_id: buildStageRunId(sourceId, stageKind),
    stage_kind: stageKind,
    diagnostic_code: options.diagnosticCode ?? lossKind,
    severity: options.severity ?? "warning",
    scope_ref: scopeRef,
    session_ref: options.sessionRef,
    blob_ref: options.blobRef,
    record_ref: options.recordRef,
    fragment_ref: options.fragmentRef,
    atom_ref: options.atomRef,
    candidate_ref: options.candidateRef,
    source_format_profile_id: options.sourceFormatProfileId,
    loss_kind: lossKind,
    detail,
    created_at: nowIso(),
  };
}

function splitUserText(text: string): UserTextChunk[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const requestMarker = "[User Request]";
  const requestIndex = normalized.indexOf(requestMarker);
  if (requestIndex >= 0) {
    const before = normalized.slice(0, requestIndex).trim();
    const after = normalized.slice(requestIndex + requestMarker.length).trim();
    const chunks: UserTextChunk[] = [];
    if (before) {
      chunks.push({
        originKind: "injected_user_shaped",
        text: before,
        displayPolicy: "collapse",
      });
    }
    if (after) {
      chunks.push({
        originKind: "user_authored",
        text: after,
      });
    }
    return chunks;
  }

  const chunks: UserTextChunk[] = [];
  let remaining = normalized;
  for (;;) {
    const injectedChunk = extractLeadingInjectedUserChunk(remaining);
    if (!injectedChunk) {
      break;
    }
    chunks.push({
      originKind: "injected_user_shaped",
      text: injectedChunk.text,
      displayPolicy: "collapse",
    });
    remaining = injectedChunk.rest.trim();
  }

  if (chunks.length > 0) {
    if (remaining) {
      chunks.push({
        originKind: "user_authored",
        text: remaining,
      });
    }
    return chunks;
  }

  if (
    normalized.startsWith("[Assistant Rules") ||
    normalized.startsWith("# AGENTS.md instructions") ||
    normalized.startsWith("<environment_context>") ||
    normalized.startsWith("<system-reminder>") ||
    normalized.startsWith("<INSTRUCTIONS>")
  ) {
    return [{ originKind: "injected_user_shaped", text: normalized, displayPolicy: "collapse" }];
  }

  return [{ originKind: "user_authored", text: normalized }];
}

function extractLeadingInjectedUserChunk(
  text: string,
): { text: string; rest: string } | undefined {
  const patterns = [
    /^# AGENTS\.md instructions[^\n]*\n\n<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>\s*/u,
    /^<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>\s*/u,
    /^<environment_context>[\s\S]*?<\/environment_context>\s*/u,
    /^<system-reminder>[\s\S]*?<\/system-reminder>\s*/u,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match || !match[0]) {
      continue;
    }
    return {
      text: match[0].trim(),
      rest: text.slice(match[0].length),
    };
  }

  return undefined;
}

function buildTextChunks(actorKind: ActorKind, text: string): UserTextChunk[] {
  if (actorKind === "user") {
    return splitUserText(text);
  }
  return [
    {
      originKind: actorKind === "assistant" ? "assistant_authored" : "source_instruction",
      text,
    },
  ];
}

function extractTextFromContentItem(item: Record<string, unknown>): string | undefined {
  const directText = asString(item.text) ?? asString(item.output_text) ?? asString(item.input_text) ?? asString(item.content);
  if (directText) {
    return directText;
  }
  if (Array.isArray(item.content)) {
    return item.content
      .filter((entry): entry is Record<string, unknown> => isObject(entry))
      .map((entry) => asString(entry.text) ?? asString(entry.content) ?? "")
      .filter(Boolean)
      .join("\n");
  }
  return undefined;
}

function stringifyToolContent(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is Record<string, unknown> => isObject(entry))
      .map((entry) => asString(entry.text) ?? asString(entry.content) ?? JSON.stringify(entry))
      .join("\n");
  }
  if (isObject(value)) {
    return JSON.stringify(value);
  }
  return asString(value) ?? "";
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function dedupeById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
}

async function listSourceFiles(
  platform: SourcePlatform,
  baseDir: string,
  limit?: number,
): Promise<string[]> {
  const adapter = getPlatformAdapter(platform);
  const files = await walkFiles(baseDir);
  const filtered = adapter ? files.filter((filePath) => adapter.matchesSourceFile(filePath)) : [];
  filtered.sort((left, right) => {
    const priorityDelta = getSourceFilePriority(platform, left) - getSourceFilePriority(platform, right);
    return priorityDelta !== 0 ? priorityDelta : left.localeCompare(right);
  });
  return typeof limit === "number" ? filtered.slice(0, limit) : filtered;
}

async function walkFiles(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkFiles(fullPath)));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

function getSourceFilePriority(platform: SourcePlatform, filePath: string): number {
  return getPlatformAdapter(platform)?.getSourceFilePriority?.(filePath) ?? 0;
}

function deriveSessionId(platform: SourcePlatform, filePath: string, fileBuffer: Buffer): string {
  if (platform === "amp") {
    try {
      const parsed = JSON.parse(fileBuffer.toString("utf8")) as Record<string, unknown>;
      const id = asString(parsed.id);
      if (id) {
        return `sess:${platform}:${id}`;
      }
    } catch {
      return `sess:${platform}:${path.basename(filePath)}`;
    }
  }

  if (platform === "openclaw") {
    return `sess:${platform}:${path.basename(filePath, path.extname(filePath))}`;
  }

  if (platform === "codex") {
    const firstLine = fileBuffer.toString("utf8").split(/\r?\n/u).find(Boolean);
    if (firstLine) {
      try {
        const parsed = JSON.parse(firstLine) as Record<string, unknown>;
        const payload = isObject(parsed.payload) ? parsed.payload : undefined;
        const sessionId = asString(payload?.id);
        if (sessionId) {
          return `sess:${platform}:${sessionId}`;
        }
      } catch {
        return `sess:${platform}:${path.basename(filePath, path.extname(filePath))}`;
      }
    }
  }

  return `sess:${platform}:${path.basename(filePath, path.extname(filePath))}`;
}

function mapRoleToActor(role: string): ActorKind {
  if (role === "user" || role === "human") {
    return "user";
  }
  if (role === "developer" || role === "system") {
    return "system";
  }
  return "assistant";
}

function isUserTurnAtom(atom: ConversationAtom): boolean {
  return (
    atom.actor_kind === "user" &&
    atom.content_kind === "text" &&
    (atom.origin_kind === "user_authored" || atom.origin_kind === "injected_user_shaped")
  );
}

function inferDisplayPolicy(originKind: OriginKind, text: string): DisplayPolicy {
  if (originKind === "injected_user_shaped") {
    return text.length > 180 ? "collapse" : "show";
  }
  return "show";
}

function isClaudeInterruptionMarker(text: string): boolean {
  return CLAUDE_INTERRUPTION_MARKERS.has(text.trim());
}

function normalizeFileUri(value: string): string {
  if (value.startsWith("file://")) {
    return value.replace("file://", "");
  }
  return value;
}

function normalizeWorkspacePath(value: string): string | undefined {
  const raw = decodeUriPath(normalizeFileUri(value).trim());
  if (!raw) {
    return undefined;
  }

  const slashNormalized = raw.replace(/\\/g, "/");
  if (/^[A-Za-z]:/u.test(slashNormalized)) {
    const drive = slashNormalized.slice(0, 2).toLowerCase();
    const rest = slashNormalized.slice(2);
    const normalizedRest = path.posix.normalize(rest.startsWith("/") ? rest : `/${rest}`);
    return `${drive}${trimTrailingSlash(normalizedRest)}`;
  }

  return trimTrailingSlash(path.posix.normalize(slashNormalized));
}

function decodeUriPath(value: string): string {
  if (!/%[0-9a-f]{2}/iu.test(value)) {
    return value;
  }
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function trimTrailingSlash(value: string): string {
  if (value === "/" || /^[a-z]:\/$/u.test(value)) {
    return value;
  }
  return value.replace(/\/+$/u, "");
}

function safeJsonParse(value: string | undefined): unknown {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function compareFragments(left: SourceFragment, right: SourceFragment): number {
  return compareTimeThenSeq(left, right);
}

function compareTimeThenSeq(
  left: { time_key: string; seq_no: number },
  right: { time_key: string; seq_no: number },
): number {
  if (left.time_key === right.time_key) {
    return left.seq_no - right.seq_no;
  }
  return left.time_key.localeCompare(right.time_key);
}

function stableId(...parts: string[]): string {
  return createHash("sha1").update(parts.join("::")).digest("hex");
}

function sha1(value: string | Buffer): string {
  return createHash("sha1").update(value).digest("hex");
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}...`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export { getBuiltinMaskTemplates };

function epochMillisToIso(value: number | undefined): string | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return undefined;
  }
  return new Date(value).toISOString();
}

function coerceIso(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function minIso(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return left < right ? left : right;
}

function maxIso(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return left > right ? left : right;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readGitProjectEvidence(workingDirectory?: string): Promise<GitProjectEvidence | undefined> {
  const workspacePath = normalizeWorkspacePath(workingDirectory ?? "");
  if (!workspacePath) {
    return undefined;
  }

  let cached = gitProjectEvidenceCache.get(workspacePath);
  if (!cached) {
    cached = loadGitProjectEvidence(workspacePath);
    gitProjectEvidenceCache.set(workspacePath, cached);
  }

  return cached;
}

async function loadGitProjectEvidence(workspacePath: string): Promise<GitProjectEvidence | undefined> {
  if (!(await pathExists(workspacePath))) {
    return undefined;
  }

  const repoRoot = normalizeWorkspacePath(
    (await runGitCommand(["-C", workspacePath, "rev-parse", "--show-toplevel"])) ?? "",
  );
  if (!repoRoot) {
    return undefined;
  }

  const repoRemote = normalizeGitRemote(await runGitCommand(["-C", repoRoot, "config", "--get", "remote.origin.url"]));

  return {
    repoRoot,
    repoRemote,
    repoFingerprint: repoRemote ? sha1(Buffer.from(`repo-remote:${repoRemote}`)) : undefined,
  };
}

async function runGitCommand(args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      timeout: 2000,
      maxBuffer: 64 * 1024,
    });
    const output = stdout.trim();
    return output || undefined;
  } catch {
    return undefined;
  }
}

function normalizeGitRemote(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) {
    return undefined;
  }

  let normalized = raw.replace(/\.git$/iu, "").replace(/\/+$/u, "");
  if (/^[^@]+@[^:]+:.+/u.test(normalized)) {
    normalized = normalized.replace(/^([^@]+@[^:]+):/u, "ssh://$1/");
  }

  return normalized;
}
