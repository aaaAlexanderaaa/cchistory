import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
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
import { applyMaskTemplates, getBuiltinMaskTemplates } from "./masks.js";

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

interface AdapterBlobResult {
  draft: SessionDraft;
  blobs: CapturedBlob[];
  records: RawRecord[];
  fragments: SourceFragment[];
  atoms: ConversationAtom[];
  edges: AtomEdge[];
  loss_audits: LossAuditRecord[];
}

interface ExtractedSessionSeed {
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

interface ConversationSeedOptions {
  defaultSessionId?: string;
  defaultTitle?: string;
  defaultWorkingDirectory?: string;
}

type AssistantStopReason = "end_turn" | "tool_use" | "max_tokens" | "error";

const RULE_VERSION = "2026-03-10.1";
const DEFAULT_SOURCE_FAMILY = "local_coding_agent";
const EXPORT_SOURCE_FAMILY = "conversational_export";
type SupportedSourcePlatform =
  | "codex"
  | "claude_code"
  | "factory_droid"
  | "amp"
  | "cursor"
  | "antigravity"
  | "openclaw"
  | "opencode"
  | "lobechat";
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
    description: "Cursor VS Code state.vscdb chat state using composerData and aichat keys.",
    capabilities: ["session_meta", "workspace_signal", "model_signal", ...COMMON_PARSER_CAPABILITIES],
  },
  antigravity: {
    id: "antigravity:vscode-state-sqlite:v1",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "antigravity",
    parser_version: "antigravity-parser@2026-03-11.1",
    description: "Antigravity VS Code state.vscdb chat state using VS Code storage keys.",
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

const DEFAULT_SOURCES: SourceDefinition[] = [
  {
    id: "src-codex",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "codex",
    display_name: "Codex",
    base_dir: path.join(os.homedir(), ".codex", "sessions"),
  },
  {
    id: "src-claude-code",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "claude_code",
    display_name: "Claude Code",
    base_dir: path.join(os.homedir(), ".claude", "projects"),
  },
  {
    id: "src-factory-droid",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "factory_droid",
    display_name: "Factory Droid",
    base_dir: path.join(os.homedir(), ".factory", "sessions"),
  },
  {
    id: "src-amp",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "amp",
    display_name: "AMP",
    base_dir: path.join(os.homedir(), ".local", "share", "amp", "threads"),
  },
  {
    id: "src-cursor",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "cursor",
    display_name: "Cursor",
    base_dir: path.join(os.homedir(), ".config", "Cursor", "User"),
  },
  {
    id: "src-antigravity",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "antigravity",
    display_name: "Antigravity",
    base_dir: path.join(os.homedir(), ".config", "antigravity"),
  },
  {
    id: "src-openclaw",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "openclaw",
    display_name: "OpenClaw",
    base_dir: path.join(os.homedir(), ".openclaw", "agents"),
  },
  {
    id: "src-opencode",
    family: DEFAULT_SOURCE_FAMILY,
    platform: "opencode",
    display_name: "OpenCode",
    base_dir: path.join(os.homedir(), ".local", "share", "opencode", "storage", "session"),
  },
  {
    id: "src-lobechat",
    family: EXPORT_SOURCE_FAMILY,
    platform: "lobechat",
    display_name: "LobeChat",
    base_dir: path.join(os.homedir(), ".config", "lobehub-storage"),
  },
];

export function getDefaultSources(): SourceDefinition[] {
  return DEFAULT_SOURCES.map((source) => ({ ...source }));
}

export function getSourceFormatProfiles(): SourceFormatProfile[] {
  return Object.values(SOURCE_FORMAT_PROFILES).map(cloneSourceFormatProfile);
}

export async function runSourceProbe(
  options: ProbeOptions = {},
  sources: readonly SourceDefinition[] = DEFAULT_SOURCES,
): Promise<{
  host: Host;
  sources: SourceSyncPayload[];
}> {
  const sourceList = sources.map((source) => ({ ...source }));
  const selectedSourceIds = new Set(options.source_ids ?? sourceList.map((source) => source.id));
  const now = nowIso();
  const host: Host = {
    id: stableId("host", os.hostname()),
    hostname: os.hostname(),
    os: `${os.platform()} ${os.release()}`,
    first_seen: now,
    last_seen: now,
  };

  const payloads: SourceSyncPayload[] = [];
  for (const source of sourceList) {
    if (!selectedSourceIds.has(source.id)) {
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
      blobs: 0,
      records: 0,
      fragments: 0,
      atoms: 0,
      candidates: 0,
      sessions: 0,
      turns: 0,
    });
    return {
      source: {
        id: source.id,
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

  const files = await listSourceFiles(source.platform, source.base_dir, limitFilesPerSource);
  const captureRunId = stableId("capture-run", source.id, startedAt);
  const sessionsById = new Map<string, SessionBuildInput>();

  for (const filePath of files) {
    const adapterResults = await processBlob(source, sourceFormatProfile, host.id, filePath, captureRunId);
    for (const adapterResult of adapterResults) {
      const current = sessionsById.get(adapterResult.draft.id);
      if (current) {
        current.blobs.push(...adapterResult.blobs);
        current.records.push(...adapterResult.records);
        current.fragments.push(...adapterResult.fragments);
        current.atoms.push(...adapterResult.atoms);
        current.edges.push(...adapterResult.edges);
        current.loss_audits.push(...adapterResult.loss_audits);
        current.draft.title = current.draft.title ?? adapterResult.draft.title;
        current.draft.working_directory =
          current.draft.working_directory ?? adapterResult.draft.working_directory;
        current.draft.model = current.draft.model ?? adapterResult.draft.model;
        current.draft.created_at = minIso(current.draft.created_at, adapterResult.draft.created_at);
        current.draft.updated_at = maxIso(current.draft.updated_at, adapterResult.draft.updated_at);
      } else {
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
    }
  }

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
    const turnResult = buildTurnsAndContext(sessionInput.draft, sessionInput.fragments, sessionInput.records, sessionInput.blobs, sessionInput.atoms, submissionResult.groups, submissionResult.edges);

    blobs.push(...sessionInput.blobs);
    records.push(...sessionInput.records);
    fragments.push(...sessionInput.fragments);
    atoms.push(...sessionInput.atoms);
    edges.push(...sessionInput.edges, ...submissionResult.edges);
    candidates.push(...sessionProjectCandidates, ...submissionResult.groups, ...turnResult.turnCandidates, ...turnResult.contextCandidates);
    sessions.push(turnResult.session);
    turns.push(...turnResult.turns);
    contexts.push(...turnResult.contexts);
    lossAudits.push(...sessionInput.loss_audits);
  }

  const finishedAt = nowIso();
  const stageRuns = buildStageRuns(source.id, sourceFormatProfile, startedAt, finishedAt, {
    blobs: blobs.length,
    records: records.length,
    fragments: fragments.length,
    atoms: atoms.length,
    candidates: candidates.length,
    sessions: sessions.length,
    turns: turns.length,
  });

  return {
    source: {
      id: source.id,
      family: source.family,
      platform: source.platform,
      display_name: source.display_name,
      base_dir: source.base_dir,
      host_id: host.id,
      last_sync: finishedAt,
      sync_status: files.length > 0 ? "healthy" : "stale",
      total_blobs: blobs.length,
      total_records: records.length,
      total_fragments: fragments.length,
      total_atoms: atoms.length,
      total_sessions: sessions.length,
      total_turns: turns.length,
    },
    stage_runs: stageRuns,
    loss_audits: lossAudits,
    blobs,
    records,
    fragments,
    atoms,
    edges,
    candidates,
    sessions,
    turns,
    contexts,
  };
}

async function processBlob(
  source: SourceDefinition,
  sourceFormatProfile: SourceFormatProfile,
  hostId: string,
  filePath: string,
  captureRunId: string,
): Promise<AdapterBlobResult[]> {
  const fileBuffer = await fs.readFile(filePath);
  const stats = await fs.stat(filePath);
  const checksum = sha1(fileBuffer);
  const blobId = stableId("blob", source.id, filePath, checksum);
  const blob: CapturedBlob = {
    id: blobId,
    source_id: source.id,
    host_id: hostId,
    origin_path: filePath,
    checksum,
    size_bytes: stats.size,
    captured_at: nowIso(),
    capture_run_id: captureRunId,
  };

  const multiSessionSeeds = await extractMultiSessionSeeds(source, filePath, fileBuffer, blobId);
  if (multiSessionSeeds) {
    const results: AdapterBlobResult[] = [];
    for (const seed of multiSessionSeeds) {
      results.push(
        buildAdapterBlobResult(
          source,
          sourceFormatProfile,
          hostId,
          filePath,
          captureRunId,
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
    hostId,
    filePath,
    profileId,
    sessionId,
    captureRunId,
  };

  const records = await extractRecords(context, blobId, fileBuffer);
  const fragments: SourceFragment[] = [];
  const atoms: ConversationAtom[] = [];
  const edges: AtomEdge[] = [];
  const lossAudits: LossAuditRecord[] = [];
  const draft: SessionDraft = {
    id: sessionId,
    source_id: source.id,
    source_platform: source.platform,
    host_id: hostId,
  };

  for (const record of records) {
    const parsed = parseRecord(context, record, draft);
    fragments.push(...parsed.fragments);
    lossAudits.push(...parsed.lossAudits);
  }

  const atomized = atomizeFragments(source.id, sessionId, profileId, fragments);
  atoms.push(...atomized.atoms);
  edges.push(...atomized.edges);
  hydrateDraftFromAtoms(draft, atoms);

  return [
    {
      draft,
      blobs: [blob],
      records,
      fragments,
      atoms,
      edges,
      loss_audits: lossAudits,
    },
  ];
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
  const lossAudits: LossAuditRecord[] = [];
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
  if (source.platform === "cursor" || source.platform === "antigravity") {
    return extractVscodeStateSeeds(source, filePath, blobId);
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
      lossAudits: [createLossAudit(context.source.id, record.id, "unknown_fragment", "Record could not be parsed as JSON")],
    };
  }

  if (!isObject(parsed)) {
    return {
      fragments: [
        createFragment(context, record, 0, "unknown", nowIso(), {
          reason: "non_object_record",
        }),
      ],
      lossAudits: [createLossAudit(context.source.id, record.id, "unknown_fragment", "Record parsed but is not an object")],
    };
  }

  if (context.source.platform === "codex") {
    return parseCodexRecord(context, record, parsed, draft);
  }
  if (context.source.platform === "claude_code") {
    return parseClaudeRecord(context, record, parsed, draft);
  }
  if (context.source.platform === "factory_droid") {
    return parseFactoryRecord(context, record, parsed, draft);
  }
  if (
    context.source.platform === "cursor" ||
    context.source.platform === "antigravity" ||
    context.source.platform === "openclaw" ||
    context.source.platform === "opencode" ||
    context.source.platform === "lobechat"
  ) {
    return parseGenericConversationRecord(context, record, parsed, draft);
  }
  return parseAmpRecord(context, record, parsed, draft);
}

function parseCodexRecord(
  context: FragmentBuildContext,
  record: RawRecord,
  parsed: Record<string, unknown>,
  draft: SessionDraft,
): { fragments: SourceFragment[]; lossAudits: LossAuditRecord[] } {
  const fragments: SourceFragment[] = [];
  const lossAudits: LossAuditRecord[] = [];
  const type = asString(parsed.type) ?? "unknown";
  const timeKey = coerceIso(parsed.timestamp) ?? nowIso();

  if (type === "session_meta" && isObject(parsed.payload)) {
    const payload = parsed.payload;
    draft.working_directory = asString(payload.cwd) ?? draft.working_directory;
    fragments.push(createFragment(context, record, fragments.length, "session_meta", timeKey, payload));
    if (asString(payload.cwd)) {
      fragments.push(createFragment(context, record, fragments.length, "workspace_signal", timeKey, { path: asString(payload.cwd) }));
    }
    if (asString(payload.model)) {
      fragments.push(createFragment(context, record, fragments.length, "model_signal", timeKey, { model: asString(payload.model) }));
    }
    return { fragments, lossAudits };
  }

  if (type === "turn_context" && isObject(parsed.payload)) {
    const payload = parsed.payload;
    if (asString(payload.cwd)) {
      draft.working_directory = asString(payload.cwd) ?? draft.working_directory;
      fragments.push(createFragment(context, record, fragments.length, "workspace_signal", timeKey, { path: asString(payload.cwd) }));
    }
    if (asString(payload.model)) {
      draft.model = asString(payload.model) ?? draft.model;
      fragments.push(createFragment(context, record, fragments.length, "model_signal", timeKey, { model: asString(payload.model) }));
    }
    return { fragments, lossAudits };
  }

  if (type === "response_item" && isObject(parsed.payload)) {
    const payload = parsed.payload;
    const payloadType = asString(payload.type) ?? "unknown";
    if (payloadType === "message") {
      const role = asString(payload.role) ?? "assistant";
      const content = asArray(payload.content);
      const usage = extractTokenUsage(payload);
      const stopReason = normalizeStopReason(payload.stop_reason);
      let usageApplied = false;
      let localSeq = 0;
      for (const item of content) {
        if (!isObject(item)) {
          continue;
        }
        const itemType = asString(item.type) ?? "unknown";
        const text = extractTextFromContentItem(item);
        if (text) {
          const actorKind = mapRoleToActor(role);
          const chunks = buildTextChunks(actorKind, text);
          for (const chunk of chunks) {
            const firstAssistantChunk = actorKind === "assistant" && !usageApplied;
            fragments.push(
              createFragment(context, record, localSeq++, "text", timeKey, {
                ...buildTextFragmentPayload(actorKind, chunk, {
                  usage: firstAssistantChunk ? usage : undefined,
                  stopReason: firstAssistantChunk ? stopReason : undefined,
                }),
              }),
            );
            if (firstAssistantChunk) {
              usageApplied = true;
            }
          }
          continue;
        }
        lossAudits.push(createLossAudit(context.source.id, record.id, "unknown_fragment", `Unsupported Codex message content item: ${itemType}`));
        fragments.push(createFragment(context, record, localSeq++, "unknown", timeKey, item));
      }
      if (!usageApplied && usage) {
        fragments.push(createTokenUsageFragment(context, record, localSeq++, timeKey, usage, stopReason));
      }
      return { fragments, lossAudits };
    }

    if (payloadType === "function_call" || payloadType === "custom_tool_call") {
      const input =
        payloadType === "function_call"
          ? safeJsonParse(asString(payload.arguments)) ?? { raw: asString(payload.arguments) }
          : safeJsonParse(asString(payload.input)) ?? { raw: asString(payload.input) };
      fragments.push(
        createFragment(context, record, 0, "tool_call", timeKey, {
          call_id: asString(payload.call_id),
          tool_name: asString(payload.name) ?? payloadType,
          input: input ?? {},
        }),
      );
      return { fragments, lossAudits };
    }

    if (payloadType === "function_call_output" || payloadType === "custom_tool_call_output") {
      fragments.push(
        createFragment(context, record, 0, "tool_result", timeKey, {
          call_id: asString(payload.call_id),
          output: asString(payload.output) ?? JSON.stringify(payload.output ?? {}),
        }),
      );
      return { fragments, lossAudits };
    }
  }

  if (type === "event_msg" && isObject(parsed.payload) && asString(parsed.payload.type) === "token_count") {
    const usage = extractTokenUsage(parsed.payload.info ?? parsed.payload);
    if (usage) {
      fragments.push(
        createTokenUsageFragment(
          context,
          record,
          0,
          timeKey,
          usage,
          undefined,
          { scope: "turn", source_event_type: "token_count" },
        ),
      );
      return { fragments, lossAudits };
    }
  }

  lossAudits.push(createLossAudit(context.source.id, record.id, "unknown_fragment", `Unhandled Codex record type: ${type}`));
  fragments.push(createFragment(context, record, 0, "unknown", timeKey, parsed));
  return { fragments, lossAudits };
}

function parseClaudeRecord(
  context: FragmentBuildContext,
  record: RawRecord,
  parsed: Record<string, unknown>,
  draft: SessionDraft,
): { fragments: SourceFragment[]; lossAudits: LossAuditRecord[] } {
  const fragments: SourceFragment[] = [];
  const lossAudits: LossAuditRecord[] = [];
  const timeKey = coerceIso(parsed.timestamp) ?? nowIso();
  const recordType = asString(parsed.type) ?? "unknown";
  if (asString(parsed.cwd)) {
    draft.working_directory = asString(parsed.cwd) ?? draft.working_directory;
    fragments.push(createFragment(context, record, fragments.length, "workspace_signal", timeKey, { path: asString(parsed.cwd) }));
  }
  if (parsed.parentUuid || parsed.parentId || parsed.isSidechain) {
    fragments.push(
      createFragment(context, record, fragments.length, "session_relation", timeKey, {
        parent_uuid: asString(parsed.parentUuid) ?? asString(parsed.parentId),
        is_sidechain: Boolean(parsed.isSidechain),
      }),
    );
  }
  const message = isObject(parsed.message) ? parsed.message : undefined;
  const role = asString(message?.role) ?? (recordType === "assistant" ? "assistant" : recordType === "user" ? "user" : "system");
  const actorKind = mapRoleToActor(role);
  const content = asArray(message?.content);
  const usage = extractTokenUsage(message);
  const stopReason = normalizeStopReason(message?.stop_reason);
  let usageApplied = false;
  let localSeq = 0;
  for (const item of content) {
    if (!isObject(item)) {
      continue;
    }
    const itemType = asString(item.type) ?? "unknown";
    if (itemType === "tool_use") {
      fragments.push(
        createFragment(context, record, localSeq++, "tool_call", timeKey, {
          call_id: asString(item.id),
          tool_name: asString(item.name) ?? "tool_use",
          input: isObject(item.input) ? item.input : {},
        }),
      );
      continue;
    }
    if (itemType === "tool_result") {
      fragments.push(
        createFragment(context, record, localSeq++, "tool_result", timeKey, {
          call_id: asString(item.tool_use_id),
          output: stringifyToolContent(item.content),
        }),
      );
      continue;
    }
    const text = extractTextFromContentItem(item);
    if (text) {
      if (isClaudeInterruptionMarker(text)) {
        fragments.push(
          createFragment(context, record, localSeq++, "text", timeKey, {
            actor_kind: "system",
            origin_kind: "source_meta",
            text: text.trim(),
            display_policy: "hide",
          }),
        );
        lossAudits.push(
          createLossAudit(
            context.source.id,
            record.id,
            "dropped_for_projection",
            "Claude interruption marker preserved as source meta and excluded from UserTurn anchors",
          ),
        );
        continue;
      }
      const chunks = buildTextChunks(actorKind, text);
      for (const chunk of chunks) {
        const firstAssistantChunk = actorKind === "assistant" && !usageApplied;
        fragments.push(
          createFragment(context, record, localSeq++, "text", timeKey, {
            ...buildTextFragmentPayload(actorKind, chunk, {
              usage: firstAssistantChunk ? usage : undefined,
              stopReason: firstAssistantChunk ? stopReason : undefined,
            }),
          }),
        );
        if (firstAssistantChunk) {
          usageApplied = true;
        }
      }
      continue;
    }
    lossAudits.push(createLossAudit(context.source.id, record.id, "unknown_fragment", `Unsupported Claude content item: ${itemType}`));
    fragments.push(createFragment(context, record, localSeq++, "unknown", timeKey, item));
  }
  if (!usageApplied && usage && actorKind === "assistant") {
    fragments.push(createTokenUsageFragment(context, record, localSeq++, timeKey, usage, stopReason));
  }
  return { fragments, lossAudits };
}

function parseFactoryRecord(
  context: FragmentBuildContext,
  record: RawRecord,
  parsed: Record<string, unknown>,
  draft: SessionDraft,
): { fragments: SourceFragment[]; lossAudits: LossAuditRecord[] } {
  const fragments: SourceFragment[] = [];
  const lossAudits: LossAuditRecord[] = [];
  const recordType = asString(parsed.type) ?? "unknown";
  const timeKey = coerceIso(parsed.timestamp) ?? nowIso();

  if (record.record_path_or_offset === "settings") {
    if (asString(parsed.model)) {
      draft.model = asString(parsed.model) ?? draft.model;
      fragments.push(createFragment(context, record, 0, "model_signal", timeKey, { model: asString(parsed.model) }));
    }
    const tokenUsage = extractTokenUsage(parsed.tokenUsage ?? parsed.usage);
    if (tokenUsage) {
      fragments.push(
        createTokenUsageFragment(
          context,
          record,
          fragments.length,
          timeKey,
          tokenUsage,
          undefined,
          { scope: "session", source_event_type: "settings_token_usage" },
        ),
      );
    }
    return { fragments, lossAudits };
  }

  if (recordType === "session_start") {
    draft.title = asString(parsed.sessionTitle) ?? asString(parsed.title) ?? draft.title;
    draft.working_directory = asString(parsed.cwd) ?? draft.working_directory;
    fragments.push(createFragment(context, record, 0, "session_meta", timeKey, parsed));
    if (draft.title) {
      fragments.push(createFragment(context, record, 1, "title_signal", timeKey, { title: draft.title }));
    }
    if (draft.working_directory) {
      fragments.push(createFragment(context, record, 2, "workspace_signal", timeKey, { path: draft.working_directory }));
    }
    return { fragments, lossAudits };
  }

  if (recordType === "message" && isObject(parsed.message)) {
    const message = parsed.message;
    const role = asString(message.role) ?? "assistant";
    const actorKind = mapRoleToActor(role);
    const content = asArray(message.content);
    const usage = extractTokenUsage(message);
    const stopReason = normalizeStopReason(message.stop_reason);
    let usageApplied = false;
    let localSeq = 0;
    for (const item of content) {
      if (!isObject(item)) {
        continue;
      }
      const itemType = asString(item.type) ?? "unknown";
      if (itemType === "tool_use") {
        fragments.push(
          createFragment(context, record, localSeq++, "tool_call", timeKey, {
            call_id: asString(item.id),
            tool_name: asString(item.name) ?? "tool_use",
            input: isObject(item.input) ? item.input : {},
          }),
        );
        continue;
      }
      if (itemType === "tool_result") {
        fragments.push(
          createFragment(context, record, localSeq++, "tool_result", timeKey, {
            call_id: asString(item.tool_use_id),
            output: stringifyToolContent(item.content),
          }),
        );
        continue;
      }
      if (itemType === "thinking" && asString(item.thinking)) {
        fragments.push(
          createFragment(context, record, localSeq++, "text", timeKey, {
            actor_kind: "system",
            origin_kind: "source_meta",
            text: asString(item.thinking),
            display_policy: "hide",
          }),
        );
        continue;
      }
      const text = extractTextFromContentItem(item);
      if (text) {
        const chunks = buildTextChunks(actorKind, text);
        for (const chunk of chunks) {
          const firstAssistantChunk = actorKind === "assistant" && !usageApplied;
          fragments.push(
            createFragment(context, record, localSeq++, "text", timeKey, {
              ...buildTextFragmentPayload(actorKind, chunk, {
                usage: firstAssistantChunk ? usage : undefined,
                stopReason: firstAssistantChunk ? stopReason : undefined,
              }),
            }),
          );
          if (firstAssistantChunk) {
            usageApplied = true;
          }
        }
        continue;
      }
      lossAudits.push(createLossAudit(context.source.id, record.id, "unknown_fragment", `Unsupported Factory Droid content item: ${itemType}`));
      fragments.push(createFragment(context, record, localSeq++, "unknown", timeKey, item));
    }
    if (!usageApplied && usage && actorKind === "assistant") {
      fragments.push(createTokenUsageFragment(context, record, localSeq++, timeKey, usage, stopReason));
    }
    return { fragments, lossAudits };
  }

  lossAudits.push(createLossAudit(context.source.id, record.id, "unknown_fragment", `Unhandled Factory Droid record type: ${recordType}`));
  fragments.push(createFragment(context, record, 0, "unknown", timeKey, parsed));
  return { fragments, lossAudits };
}

function parseAmpRecord(
  context: FragmentBuildContext,
  record: RawRecord,
  parsed: Record<string, unknown>,
  draft: SessionDraft,
): { fragments: SourceFragment[]; lossAudits: LossAuditRecord[] } {
  const fragments: SourceFragment[] = [];
  const lossAudits: LossAuditRecord[] = [];
  const meta = isObject(parsed.meta) ? parsed.meta : undefined;
  const env = isObject(parsed.env) ? parsed.env : undefined;
  const initialEnv = env && isObject(env.initial) ? env.initial : undefined;
  const timeKey =
    coerceIso(parsed.timestamp) ??
    epochMillisToIso(asNumber(meta?.sentAt)) ??
    epochMillisToIso(asNumber(parsed.created)) ??
    nowIso();

  if (record.record_path_or_offset === "root") {
    const title = asString(parsed.title);
    if (title) {
      draft.title = title;
      fragments.push(createFragment(context, record, 0, "title_signal", timeKey, { title }));
    }
    const trees = asArray(initialEnv?.trees);
    const tree = trees.find((item) => isObject(item) && asString(item.uri));
    if (isObject(tree) && asString(tree.uri)) {
      const workspace = normalizeFileUri(asString(tree.uri) ?? "");
      draft.working_directory = workspace || draft.working_directory;
      fragments.push(createFragment(context, record, 1, "workspace_signal", timeKey, { path: workspace, display_name: asString(tree.displayName) }));
    }
    return { fragments, lossAudits };
  }

  const role = asString(parsed.role) ?? "assistant";
  const actorKind = mapRoleToActor(role);
  const content = asArray(parsed.content);
  const usage = extractTokenUsage(parsed.usage);
  const state = isObject(parsed.state) ? parsed.state : undefined;
  const stopReason = normalizeStopReason(state?.stopReason ?? parsed.stopReason);
  let usageApplied = false;
  let localSeq = 0;
  for (const item of content) {
    if (!isObject(item)) {
      continue;
    }
    const itemType = asString(item.type) ?? "unknown";
    if (itemType === "tool_use") {
      fragments.push(
        createFragment(context, record, localSeq++, "tool_call", timeKey, {
          call_id: asString(item.id),
          tool_name: asString(item.name) ?? "tool_use",
          input: isObject(item.input) ? item.input : {},
        }),
      );
      continue;
    }
    if (itemType === "tool_result") {
      fragments.push(
        createFragment(context, record, localSeq++, "tool_result", timeKey, {
          call_id: asString(item.tool_use_id),
          output: stringifyToolContent(item.content),
        }),
      );
      continue;
    }
    const text = extractTextFromContentItem(item);
    if (text) {
      const chunks = buildTextChunks(actorKind, text);
      for (const chunk of chunks) {
        const firstAssistantChunk = actorKind === "assistant" && !usageApplied;
        fragments.push(
          createFragment(context, record, localSeq++, "text", timeKey, {
            ...buildTextFragmentPayload(actorKind, chunk, {
              usage: firstAssistantChunk ? usage : undefined,
              stopReason: firstAssistantChunk ? stopReason : undefined,
            }),
          }),
        );
        if (firstAssistantChunk) {
          usageApplied = true;
        }
      }
      continue;
    }
    lossAudits.push(createLossAudit(context.source.id, record.id, "unknown_fragment", `Unsupported AMP content item: ${itemType}`));
    fragments.push(createFragment(context, record, localSeq++, "unknown", timeKey, item));
  }
  if (!usageApplied && usage && actorKind === "assistant") {
    fragments.push(createTokenUsageFragment(context, record, localSeq++, timeKey, usage, stopReason));
  }
  return { fragments, lossAudits };
}

function parseGenericConversationRecord(
  context: FragmentBuildContext,
  record: RawRecord,
  parsed: Record<string, unknown>,
  draft: SessionDraft,
): { fragments: SourceFragment[]; lossAudits: LossAuditRecord[] } {
  const fragments: SourceFragment[] = [];
  const lossAudits: LossAuditRecord[] = [];
  const timeKey =
    coerceIso(parsed.timestamp) ??
    coerceIso(parsed.updatedAt) ??
    coerceIso(parsed.createdAt) ??
    coerceIso(parsed.created_at) ??
    nowIso();

  const meta = extractGenericSessionMetadata(parsed);
  if (meta.workspacePath) {
    draft.working_directory = meta.workspacePath;
    fragments.push(createFragment(context, record, fragments.length, "workspace_signal", timeKey, { path: meta.workspacePath }));
  }
  if (meta.model) {
    draft.model = meta.model;
    fragments.push(createFragment(context, record, fragments.length, "model_signal", timeKey, { model: meta.model }));
  }
  if (meta.title) {
    draft.title = draft.title ?? meta.title;
    fragments.push(createFragment(context, record, fragments.length, "title_signal", timeKey, { title: meta.title }));
  }
  if (meta.parentUuid || meta.isSidechain) {
    fragments.push(
      createFragment(context, record, fragments.length, "session_relation", timeKey, {
        parent_uuid: meta.parentUuid,
        is_sidechain: meta.isSidechain,
      }),
    );
  }

  const message = isObject(parsed.message) ? parsed.message : parsed;
  const role = extractGenericRole(message);
  const contentItems = extractGenericContentItems(message);
  const usage = extractTokenUsage(message.usage ?? parsed.usage);
  const stopReason = normalizeStopReason(message.stop_reason ?? message.stopReason ?? parsed.stop_reason ?? parsed.stopReason);
  let usageApplied = false;
  let localSeq = 0;

  if (!role && fragments.length > 0 && contentItems.length === 0) {
    return { fragments, lossAudits };
  }

  if (!role && contentItems.length === 0) {
    fragments.push(createFragment(context, record, 0, "unknown", timeKey, parsed));
    lossAudits.push(
      createLossAudit(context.source.id, record.id, "unknown_fragment", `Unhandled ${context.source.platform} record without recognizable role or content`),
    );
    return { fragments, lossAudits };
  }

  const actorKind = mapRoleToActor(role ?? "assistant");
  for (const item of contentItems) {
    const itemType = asString(item.type) ?? "unknown";
    if (itemType === "tool_use" || itemType === "tool_call" || itemType === "function_call") {
      fragments.push(
        createFragment(context, record, localSeq++, "tool_call", timeKey, {
          call_id: asString(item.id) ?? asString(item.call_id) ?? asString(item.tool_call_id),
          tool_name: asString(item.name) ?? asString(item.tool_name) ?? itemType,
          input: normalizeToolInput(item.input ?? item.arguments ?? item.args),
        }),
      );
      continue;
    }
    if (itemType === "tool_result" || itemType === "function_result" || itemType === "function_call_output") {
      fragments.push(
        createFragment(context, record, localSeq++, "tool_result", timeKey, {
          call_id: asString(item.tool_use_id) ?? asString(item.call_id) ?? asString(item.id),
          output: stringifyToolContent(item.content ?? item.output ?? item.result ?? item.text),
        }),
      );
      continue;
    }

    const text = extractTextFromContentItem(item);
    if (text) {
      const chunks = buildTextChunks(actorKind, text);
      for (const chunk of chunks) {
        const firstAssistantChunk = actorKind === "assistant" && !usageApplied;
        fragments.push(
          createFragment(context, record, localSeq++, "text", timeKey, {
            ...buildTextFragmentPayload(actorKind, chunk, {
              usage: firstAssistantChunk ? usage : undefined,
              stopReason: firstAssistantChunk ? stopReason : undefined,
            }),
          }),
        );
        if (firstAssistantChunk) {
          usageApplied = true;
        }
      }
      continue;
    }

    fragments.push(createFragment(context, record, localSeq++, "unknown", timeKey, item));
    lossAudits.push(
      createLossAudit(context.source.id, record.id, "unknown_fragment", `Unsupported ${context.source.platform} content item: ${itemType}`),
    );
  }

  if (!usageApplied && usage && actorKind === "assistant") {
    fragments.push(createTokenUsageFragment(context, record, localSeq++, timeKey, usage, stopReason));
  }

  return { fragments, lossAudits };
}

function extractGenericSessionMetadata(parsed: Record<string, unknown>): GenericSessionMetadata {
  const metadata = isObject(parsed.metadata) ? parsed.metadata : undefined;
  const session = isObject(parsed.session) ? parsed.session : undefined;
  const message = isObject(parsed.message) ? parsed.message : undefined;
  const workspace = isObject(parsed.workspace) ? parsed.workspace : undefined;
  const project = isObject(parsed.project) ? parsed.project : undefined;

  const workspaceCandidate =
    asString(parsed.cwd) ??
    asString(parsed.workingDirectory) ??
    asString(parsed.working_directory) ??
    asString(parsed.workspacePath) ??
    asString(parsed.directory) ??
    asString(metadata?.cwd) ??
    asString(metadata?.workingDirectory) ??
    asString(session?.cwd) ??
    asString(session?.workingDirectory) ??
    asString(message?.cwd) ??
    asString(workspace?.path) ??
    asString(workspace?.uri) ??
    asString(project?.path);

  return {
    workspacePath: workspaceCandidate ? normalizeWorkspacePath(workspaceCandidate) : undefined,
    model:
      asString(parsed.model) ??
      asString(parsed.modelName) ??
      asString(parsed.model_name) ??
      asString(parsed.providerModel) ??
      asString(metadata?.model) ??
      asString(session?.model) ??
      asString(message?.model),
    title:
      asString(parsed.title) ??
      asString(parsed.name) ??
      asString(parsed.label) ??
      asString(parsed.sessionTitle) ??
      asString(session?.title),
    parentUuid:
      asString(parsed.parentUuid) ??
      asString(parsed.parentId) ??
      asString(parsed.parent_id) ??
      asString(session?.parentUuid),
    isSidechain:
      asBoolean(parsed.isSidechain) ??
      asBoolean(parsed.sidechain) ??
      asBoolean(session?.isSidechain),
  };
}

function extractGenericRole(message: Record<string, unknown>): string | undefined {
  const author = isObject(message.author) ? message.author : undefined;
  const sender = isObject(message.sender) ? message.sender : undefined;
  const info = isObject(message.info) ? message.info : undefined;
  const rawRole =
    asString(message.role) ??
    asString(author?.role) ??
    asString(author?.type) ??
    asString(message.author) ??
    asString(sender?.role) ??
    asString(message.sender) ??
    asString(message.from) ??
    asString(info?.role);
  const normalized = rawRole?.trim().toLowerCase();
  if (!normalized) {
    const type = asString(message.type)?.trim().toLowerCase();
    if (type === "user" || type === "assistant" || type === "system" || type === "developer") {
      return type;
    }
    return undefined;
  }
  if (normalized === "human" || normalized === "user" || normalized === "operator") {
    return "user";
  }
  if (normalized === "assistant" || normalized === "ai" || normalized === "model" || normalized === "bot") {
    return "assistant";
  }
  if (normalized === "developer" || normalized === "system" || normalized === "instruction") {
    return "system";
  }
  if (normalized === "tool") {
    return "assistant";
  }
  return normalized;
}

function extractGenericContentItems(message: Record<string, unknown>): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  const pushText = (value: string | undefined) => {
    if (value && value.trim()) {
      items.push({ type: "text", text: value });
    }
  };
  const pushEntries = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (isObject(entry)) {
          items.push(entry);
        } else if (typeof entry === "string" && entry.trim()) {
          items.push({ type: "text", text: entry });
        }
      }
      return true;
    }
    if (isObject(value)) {
      items.push(value);
      return true;
    }
    if (typeof value === "string" && value.trim()) {
      items.push({ type: "text", text: value });
      return true;
    }
    return false;
  };

  pushEntries(message.content);
  pushEntries(message.parts);
  pushEntries(message.blocks);

  const toolCalls = asArray(message.tool_calls);
  for (const toolCall of toolCalls) {
    if (!isObject(toolCall)) {
      continue;
    }
    items.push({
      type: "tool_call",
      id: asString(toolCall.id) ?? asString(toolCall.call_id),
      name: asString(toolCall.name) ?? asString(toolCall.tool_name),
      input: toolCall.input ?? toolCall.arguments ?? toolCall.args,
    });
  }
  if (isObject(message.tool_call)) {
    items.push({
      type: "tool_call",
      id: asString(message.tool_call.id) ?? asString(message.tool_call.call_id),
      name: asString(message.tool_call.name) ?? asString(message.tool_call.tool_name),
      input: message.tool_call.input ?? message.tool_call.arguments ?? message.tool_call.args,
    });
  }

  const toolResults = asArray(message.tool_results);
  for (const toolResult of toolResults) {
    if (!isObject(toolResult)) {
      continue;
    }
    items.push({
      type: "tool_result",
      tool_use_id: asString(toolResult.tool_use_id) ?? asString(toolResult.call_id),
      content: toolResult.content ?? toolResult.output ?? toolResult.result ?? toolResult.text,
    });
  }
  if (isObject(message.tool_result)) {
    items.push({
      type: "tool_result",
      tool_use_id: asString(message.tool_result.tool_use_id) ?? asString(message.tool_result.call_id),
      content: message.tool_result.content ?? message.tool_result.output ?? message.tool_result.result ?? message.tool_result.text,
    });
  }

  if (items.length === 0) {
    pushText(
      asString(message.text) ??
        asString(message.output_text) ??
        asString(message.input_text) ??
        asString(message.output) ??
        asString(message.response) ??
        asString(message.message),
    );
  }

  return items;
}

function normalizeToolInput(value: unknown): Record<string, unknown> {
  if (isObject(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = safeJsonParse(value);
    return isObject(parsed) ? parsed : value.trim() ? { raw: value } : {};
  }
  if (Array.isArray(value)) {
    return { items: value };
  }
  if (value === undefined || value === null) {
    return {};
  }
  return { value };
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

function extractTokenUsage(value: unknown, depth = 0): TokenUsageMetrics | undefined {
  if (!isObject(value) || depth > 3) {
    return undefined;
  }

  const direct = normalizeTokenUsageObject(value);
  if (direct) {
    return direct;
  }

  for (const nested of [value.usage, value.tokenUsage, value.last_token_usage, value.lastTokenUsage, value.info]) {
    const usage = extractTokenUsage(nested, depth + 1);
    if (usage) {
      return usage;
    }
  }

  return undefined;
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

async function extractVscodeStateSeeds(
  source: SourceDefinition,
  filePath: string,
  _blobId: string,
): Promise<ExtractedSessionSeed[] | undefined> {
  const workspacePath = await extractWorkspacePathFromWorkspaceState(filePath);
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    const rows = selectVscodeKeyValueRows(db);
    const rowMap = new Map(rows.map((row) => [row.storage_key, row.storage_value]));
    const seedsById = new Map<string, ExtractedSessionSeed>();

    for (const row of rows) {
      if (row.storage_key.startsWith("composerData:")) {
        const parsed = safeJsonParse(row.storage_value);
        if (!isObject(parsed)) {
          continue;
        }
        const seed = buildCursorComposerSeed(source.platform, row.storage_key, parsed, rowMap, workspacePath);
        if (seed) {
          upsertExtractedSeed(seedsById, seed);
        }
        continue;
      }

      if (row.storage_key === "composer.composerData") {
        const parsed = safeJsonParse(row.storage_value);
        if (isObject(parsed)) {
          for (const composer of asArray(parsed.allComposers)) {
            if (!isObject(composer)) {
              continue;
            }
            const seed = buildCursorComposerSeed(source.platform, row.storage_key, composer, rowMap, workspacePath);
            if (seed) {
              upsertExtractedSeed(seedsById, seed);
            }
          }
        }
      }

      if (row.storage_key.includes("chatdata") || row.storage_key.includes("aichat")) {
        const parsed = safeJsonParse(row.storage_value);
        const seeds = collectConversationSeedsFromValue(
          source.platform,
          parsed,
          `${path.basename(filePath)}:${row.storage_key}`,
          { defaultWorkingDirectory: workspacePath },
        );
        for (const seed of seeds) {
          upsertExtractedSeed(seedsById, seed);
        }
      }
    }

    if (seedsById.size === 0) {
      for (const row of rows) {
        const parsed = safeJsonParse(row.storage_value);
        const seeds = collectConversationSeedsFromValue(
          source.platform,
          parsed,
          `${path.basename(filePath)}:${row.storage_key}`,
          { defaultWorkingDirectory: workspacePath },
        );
        for (const seed of seeds) {
          upsertExtractedSeed(seedsById, seed);
        }
      }
    }

    return seedsById.size > 0 ? [...seedsById.values()] : undefined;
  } finally {
    db.close();
  }
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

function normalizeTokenUsageObject(value: Record<string, unknown>): TokenUsageMetrics | undefined {
  const inputTokens = firstDefinedNumber(
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
  const totalTokens =
    explicitTotal ??
    sumDefinedNumbers(inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens);
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

function selectVscodeKeyValueRows(db: DatabaseSync): Array<{ storage_key: string; storage_value: string }> {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  const rows: Array<{ storage_key: string; storage_value: string }> = [];

  for (const table of tables) {
    const tableName = table.name;
    const tableInfo = db.prepare(`PRAGMA table_info(${escapeSqliteIdentifier(tableName)})`).all() as Array<{
      name: string;
    }>;
    const columnNames = new Set(tableInfo.map((column) => column.name));
    const keyColumn = ["key", "storage_key", "itemKey"].find((column) => columnNames.has(column));
    const valueColumn = ["value", "storage_value", "itemValue", "data"].find((column) => columnNames.has(column));
    if (!keyColumn || !valueColumn) {
      continue;
    }

    const query = `
      SELECT ${escapeSqliteIdentifier(keyColumn)} AS storage_key, ${escapeSqliteIdentifier(valueColumn)} AS storage_value
      FROM ${escapeSqliteIdentifier(tableName)}
      WHERE lower(${escapeSqliteIdentifier(keyColumn)}) LIKE ? OR lower(${escapeSqliteIdentifier(keyColumn)}) LIKE ? OR lower(${escapeSqliteIdentifier(keyColumn)}) LIKE ? OR lower(${escapeSqliteIdentifier(keyColumn)}) LIKE ? OR lower(${escapeSqliteIdentifier(keyColumn)}) LIKE ? OR lower(${escapeSqliteIdentifier(keyColumn)}) LIKE ?
    `;
    const selectedRows = db.prepare(query).all(
      "%composer%",
      "%chat%",
      "%aichat%",
      "%bubble%",
      "%prompt%",
      "%generation%",
    ) as Array<{ storage_key: unknown; storage_value: unknown }>;

    for (const row of selectedRows) {
      const storageKey = asString(row.storage_key);
      const storageValue = coerceDbText(row.storage_value);
      if (!storageKey || !storageValue) {
        continue;
      }
      rows.push({ storage_key: storageKey, storage_value: storageValue });
    }
  }

  return rows;
}

function buildCursorComposerSeed(
  platform: SourcePlatform,
  storageKey: string,
  composer: Record<string, unknown>,
  rowMap: Map<string, string>,
  defaultWorkingDirectory?: string,
): ExtractedSessionSeed | undefined {
  const composerId =
    (asString(composer.composerId) ??
      asString(composer.id) ??
      storageKey.split(":").slice(1).join(":")) ||
    sha1(storageKey);
  const sessionId = `sess:${platform}:${composerId}`;
  const meta = extractGenericSessionMetadata(composer);
  const workingDirectory = meta.workspacePath ?? defaultWorkingDirectory;
  const bubbleRefs = extractBubbleRefsFromComposer(composer);
  const messageRecords = bubbleRefs
    .map((bubbleRef) => {
      const rawBubble = rowMap.get(bubbleRef) ?? rowMap.get(`bubbleId:${bubbleRef}`);
      if (!rawBubble) {
        return undefined;
      }
      const parsedBubble = safeJsonParse(rawBubble);
      if (!isObject(parsedBubble)) {
        return undefined;
      }
      return normalizeCursorBubbleRecord(parsedBubble, workingDirectory);
    })
    .filter((record): record is { observedAt?: string; record: Record<string, unknown> } => record !== undefined);

  if (messageRecords.length === 0) {
    const fallback = collectConversationSeedsFromValue(platform, composer, storageKey, {
      defaultSessionId: sessionId,
      defaultWorkingDirectory: workingDirectory,
      defaultTitle: meta.title,
    });
    return fallback[0];
  }

  const records: ExtractedSessionSeed["records"] = [];
  if (meta.title || meta.model || workingDirectory) {
    records.push({
      pointer: "meta",
      observedAt: messageRecords[0]?.observedAt ?? nowIso(),
      rawJson: JSON.stringify({
        id: sessionId,
        title: meta.title,
        model: meta.model,
        cwd: workingDirectory,
      }),
    });
  }
  messageRecords
    .sort((left, right) => (left.observedAt ?? "").localeCompare(right.observedAt ?? ""))
    .forEach((message, index) => {
      records.push({
        pointer: `bubble[${index}]`,
        observedAt: message.observedAt ?? nowIso(),
        rawJson: JSON.stringify(message.record),
      });
    });

  return {
    sessionId,
    title: meta.title,
    createdAt: messageRecords[0]?.observedAt,
    updatedAt: messageRecords.at(-1)?.observedAt,
    model: meta.model,
    workingDirectory,
    records,
  };
}

function extractBubbleRefsFromComposer(value: unknown): string[] {
  const refs = new Set<string>();

  const visit = (candidate: unknown, fieldHint?: string, depth = 0) => {
    if (depth > 6 || candidate === null || candidate === undefined) {
      return;
    }
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed.startsWith("bubbleId:")) {
        refs.add(trimmed);
      } else if (fieldHint?.includes("bubble") && trimmed) {
        refs.add(`bubbleId:${trimmed}`);
      }
      return;
    }
    if (Array.isArray(candidate)) {
      for (const entry of candidate) {
        visit(entry, fieldHint, depth + 1);
      }
      return;
    }
    if (!isObject(candidate)) {
      return;
    }

    const bubbleId = asString(candidate.bubbleId) ?? asString(candidate.id);
    if (bubbleId && fieldHint?.includes("bubble")) {
      refs.add(bubbleId.startsWith("bubbleId:") ? bubbleId : `bubbleId:${bubbleId}`);
    }

    for (const [key, entry] of Object.entries(candidate)) {
      visit(entry, key.toLowerCase(), depth + 1);
    }
  };

  visit(value);
  return [...refs];
}

function normalizeCursorBubbleRecord(
  value: Record<string, unknown>,
  defaultWorkingDirectory?: string,
): { observedAt?: string; record: Record<string, unknown> } | undefined {
  const role =
    extractGenericRole(value) ??
    (asNumber(value.type) === 1 ? "user" : asNumber(value.type) === 2 ? "assistant" : undefined);
  let content = extractGenericContentItems(value);
  if (content.length === 0) {
    const richText = asString(value.richText);
    const extractedText = richText ? extractRichTextText(richText) : undefined;
    if (extractedText) {
      content = [{ type: "text", text: extractedText }];
    }
  }
  if (!role && content.length === 0) {
    return undefined;
  }

  return {
    observedAt:
      coerceIso(value.createdAt) ??
      coerceIso(value.updatedAt) ??
      epochMillisToIso(asNumber(value.createdAt)) ??
      epochMillisToIso(asNumber(value.created)),
    record: {
      id: asString(value.bubbleId) ?? asString(value.id),
      role: role ?? "assistant",
      content,
      usage: extractTokenUsage(value),
      stopReason: normalizeStopReason(value.stopReason),
      cwd: defaultWorkingDirectory,
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

async function extractWorkspacePathFromWorkspaceState(filePath: string): Promise<string | undefined> {
  const workspaceJsonPath = path.join(path.dirname(filePath), "workspace.json");
  if (!(await pathExists(workspaceJsonPath))) {
    return undefined;
  }
  const parsed = safeJsonParse(await fs.readFile(workspaceJsonPath, "utf8"));
  if (!isObject(parsed)) {
    return undefined;
  }
  const workspaceCandidate =
    asString(parsed.folder) ??
    asString(parsed.path) ??
    asString(parsed.uri) ??
    (isObject(parsed.workspace) ? asString(parsed.workspace.path) ?? asString(parsed.workspace.uri) : undefined);
  return workspaceCandidate ? normalizeWorkspacePath(workspaceCandidate) : undefined;
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

function coerceDbText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("utf8");
  }
  return undefined;
}

function escapeSqliteIdentifier(value: string): string {
  return `"${value.replace(/"/gu, "\"\"")}"`;
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

  return [...workspaceSignals.values()].map((atom) => ({
    id: stableId(
      "candidate",
      "project_observation",
      draft.source_id,
      draft.id,
      normalizeWorkspacePath(asString(atom.payload.path) ?? "") ?? String(atom.payload.path),
    ),
    source_id: draft.source_id,
    session_ref: draft.id,
    candidate_kind: "project_observation",
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
        confidence: 0.5,
        reason: "workspace_signal_detected",
        debug_summary: gitProjectEvidence?.repoFingerprint
          ? "workspace signal with git-backed repository evidence"
          : "workspace signal without git repository evidence",
      },
    }));
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

    const userMessages = groupAtoms
      .filter((atom) => atom.content_kind === "text" && (atom.origin_kind === "user_authored" || atom.origin_kind === "injected_user_shaped"))
      .map((atom, userIndex): UserMessageProjection => ({
        id: stableId("user-message", draft.source_id, draft.id, atom.id),
        raw_text: asString(atom.payload.text) ?? "",
        sequence: userIndex,
        is_injected: atom.origin_kind === "injected_user_shaped",
        created_at: atom.time_key,
        atom_refs: [atom.id],
      }));

    const rawText = userMessages.map((message) => message.raw_text).join("\n\n");
    const maskedUserMessages = userMessages.map((message) =>
      applyMaskTemplates(message.raw_text, "user_message", { injected: message.is_injected }),
    );
    const displaySegments = joinDisplaySegments(maskedUserMessages.map((maskedMessage) => maskedMessage.display_segments));
    const canonicalText = maskedUserMessages
      .map((maskedMessage) => maskedMessage.canonical_text)
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
    turns.push({
      id: turnId,
      revision_id: `${turnId}:r1`,
      turn_id: turnId,
      turn_revision_id: `${turnId}:r1`,
      user_messages: userMessages,
      raw_text: rawText,
      canonical_text: canonicalText || rawText,
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
        total_tokens:
          contextProjection.assistant_replies.reduce((sum, reply) => sum + (reply.token_count ?? 0), 0) || undefined,
        primary_model: draft.model,
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
  let toolSequence = 0;

  for (const atom of [...groupAtoms, ...contextAtoms]) {
    for (const fragmentId of atom.fragment_refs) {
      const recordId = fragmentById.get(fragmentId)?.record_id;
      if (recordId) {
        rawEventRefs.add(recordId);
      }
    }
  }

  for (const atom of contextAtoms) {
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
      assistantReplies.push({
        id: replyId,
        content,
        display_segments: masked.display_segments,
        content_preview: truncate(masked.canonical_text || content, 140),
        token_count: extractTokenCountFromPayload(atom.payload),
        model: draft.model ?? "unknown",
        created_at: atom.time_key,
        tool_call_ids: [],
        stop_reason: extractStopReasonFromPayload(atom.payload),
      });
      continue;
    }
  }

  const turnTokenSignals = contextAtoms.filter(
    (atom) => atom.content_kind === "meta_signal" && atom.payload.signal_kind === "token_usage_signal",
  );
  const lastTurnTokenSignal = [...turnTokenSignals]
    .reverse()
    .find((atom) => asString(atom.payload.scope) !== "session");
  if (lastTurnTokenSignal) {
    const tokenCount = extractTokenCountFromPayload(lastTurnTokenSignal.payload);
    const stopReason = extractStopReasonFromPayload(lastTurnTokenSignal.payload);
    const lastReply = assistantReplies.at(-1);
    if (lastReply) {
      lastReply.token_count = lastReply.token_count ?? tokenCount;
      lastReply.stop_reason = lastReply.stop_reason ?? stopReason;
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

function buildStageRuns(
  sourceId: string,
  sourceFormatProfile: SourceFormatProfile,
  startedAt: string,
  finishedAt: string,
  counts: {
    blobs: number;
    records: number;
    fragments: number;
    atoms: number;
    candidates: number;
    sessions: number;
    turns: number;
  },
): StageRun[] {
  const stageStats: Record<StageKind, Record<string, number>> = {
    capture: { blobs: counts.blobs },
    extract_records: { records: counts.records },
    parse_source_fragments: { fragments: counts.fragments },
    atomize: { atoms: counts.atoms },
    derive_candidates: { candidates: counts.candidates },
    finalize_projections: { sessions: counts.sessions, turns: counts.turns },
    apply_masks: { turns: counts.turns },
    index_projections: { turns: counts.turns },
  };

  return (Object.keys(stageStats) as StageKind[]).map((stage) => ({
    id: stableId("stage-run", sourceId, stage, startedAt),
    source_id: sourceId,
    stage_kind: stage,
    parser_version: sourceFormatProfile.parser_version,
    parser_capabilities: [...sourceFormatProfile.capabilities],
    source_format_profile_ids: [sourceFormatProfile.id],
    started_at: startedAt,
    finished_at: finishedAt,
    status: "success",
    stats: stageStats[stage],
  }));
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
): LossAuditRecord {
  return {
    id: stableId("loss-audit", sourceId, scopeRef, lossKind, detail),
    source_id: sourceId,
    stage_run_id: stableId("loss-stage", sourceId, lossKind),
    scope_ref: scopeRef,
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

async function listSourceFiles(
  platform: SourcePlatform,
  baseDir: string,
  limit?: number,
): Promise<string[]> {
  const files = await walkFiles(baseDir);
  const filtered = files.filter((filePath) => {
    if (platform === "cursor" || platform === "antigravity") {
      return path.basename(filePath) === "state.vscdb";
    }
    if (platform === "amp") {
      return filePath.endsWith(".json");
    }
    if (platform === "lobechat" || platform === "opencode") {
      return filePath.endsWith(".json");
    }
    if (platform === "openclaw") {
      return filePath.endsWith(".jsonl") && path.basename(path.dirname(filePath)) === "sessions";
    }
    if (platform === "claude_code") {
      return filePath.endsWith(".jsonl");
    }
    if (platform === "factory_droid") {
      return filePath.endsWith(".jsonl");
    }
    return filePath.endsWith(".jsonl") || filePath.endsWith(".json");
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
  const raw = normalizeFileUri(value).trim();
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
