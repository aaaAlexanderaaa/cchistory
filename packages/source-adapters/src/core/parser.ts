import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type {
  ActorKind,
  AtomEdge,
  ConversationAtom,
  LossAuditRecord,
  RawRecord,
  SourceDefinition,
  SourceFragment,
  SourceFormatProfile,
  SourcePlatform,
} from "@cchistory/domain";
import { parseAccioRecord as parseAccioRuntimeRecord } from "../platforms/accio/runtime.js";
import { parseAmpRecord as parseAmpRuntimeRecord } from "../platforms/amp/runtime.js";
import { isAntigravityBrainSourceFile, isAntigravityHistoryIndexFile } from "../platforms/antigravity.js";
import {
  extractAntigravityBrainSeed,
  extractAntigravityHistorySeed,
} from "../platforms/antigravity/runtime.js";
import { parseClaudeRecord as parseClaudeRuntimeRecord } from "../platforms/claude-code/runtime.js";
import { parseCodexRecord as parseCodexRuntimeRecord } from "../platforms/codex/runtime.js";
import { parseFactoryRecord as parseFactoryRuntimeRecord } from "../platforms/factory-droid/runtime.js";
import {
  extractGenericContentItems as extractGenericContentItemsRuntime,
  extractGenericRole as extractGenericRoleRuntime,
  extractGenericSessionMetadata as extractGenericSessionMetadataRuntime,
  normalizeToolInput as normalizeToolInputRuntime,
  parseGenericConversationRecord as parseGenericConversationRuntimeRecord,
} from "../platforms/generic/runtime.js";
import { parseOpenClawCronRunRecord as parseOpenClawCronRunRuntimeRecord } from "../platforms/openclaw/runtime.js";
import { extractGeminiProjectKey, resolveGeminiRoot } from "../platforms/gemini.js";
import { resolveKimiSessionDir } from "../platforms/kimi.js";
import { parseKimiRecord as parseKimiRuntimeRecord } from "../platforms/kimi/runtime.js";
import { extractZcodeSqliteSeeds } from "../platforms/zcode/runtime.js";
import { collectJsonlRecords, extractContentMaxTimestamp, isIncrementalJsonlPlatform } from "./jsonl-records.js";
import {
  collectConversationSeedsFromValue as collectConversationSeedsFromValueRuntime,
  normalizeMessageCandidate as normalizeMessageCandidateRuntime,
} from "./conversation-seeds.js";
import type { ConversationSeedOptions, ExtractedSessionSeed } from "./conversation-seeds.js";
import {
  asArray,
  asBoolean,
  asNumber,
  asString,
  coerceIso,
  createFragment,
  createLossAudit,
  deriveSessionId,
  extractSourceSessionIdFromCanonicalSessionId,
  buildSourceResumeCommand,
  epochMillisToIso,
  isObject,
  mapRoleToActor,
  nowIso,
  pathExists,
  safeJsonParse,
  stableId,
  truncate,
  normalizeWorkspacePath,
  sha1,
  extractTextFromContentItem,
  stringifyToolContent,
  extractTokenUsage,
  normalizeStopReason,
  extractCumulativeTokenUsage,
  buildTokenUsageCheckpointBaselineKey,
  mergeMaxTokenUsageMetrics,
  diffTokenUsageMetrics,
  isClaudeInterruptionMarker,
  normalizeFileUri,
  buildTextChunks,
  inferDisplayPolicy,
  firstDefinedNumber,
  sumDefinedNumbers,
  minIso,
  maxIso,
} from "./utils.js";
import type {
  AdapterBlobResult,
  AssistantStopReason,
  CapturedBlob,
  CapturedBlobInput,
  StreamingCapturedBlobInput,
  FragmentBuildContext,
  GenericSessionMetadata,
  LossAuditOptions,
  SessionDraft,
  TokenUsageMetrics,
  UserTextChunk,
} from "./types.js";
import { atomizeFragments, hydrateDraftFromAtoms, deriveSourceNativeProjectRef } from "./atomizer.js";

let vscodeStateExtractorPromise: Promise<typeof import("./vscode-state.js").extractVscodeStateSeeds> | undefined;

/**
 * Derive the conversation metadata file path from an Accio session file path.
 *
 * Session file:  .../agents/DID-xxx/sessions/DID-xxx_CID-yyy.messages.jsonl
 * Conversation:  .../conversations/dm/CID-yyy.jsonc
 */
function deriveAccioConversationMetaPath(sessionFilePath: string): string {
  const basename = path.basename(sessionFilePath, ".messages.jsonl");
  const cidIdx = basename.indexOf("_CID-");
  if (cidIdx < 0) return "";
  const cid = basename.slice(cidIdx + 1);
  // Walk up: sessions/ → <agentId>/ → agents/ → <accountRoot>/
  const accountRoot = path.resolve(path.dirname(sessionFilePath), "..", "..", "..");
  return path.join(accountRoot, "conversations", "dm", `${cid}.jsonc`);
}

export async function extractRecords(
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

  return collectJsonlRecords(
    text,
    {
      sourceId: context.source.id,
      blobId,
      sessionId: context.sessionId,
    },
    {
      observedAt: nowIso(),
      sidecars:
        context.source.platform === "factory_droid"
          ? [
              {
                filePath: context.filePath.replace(/\.jsonl?$/u, ".settings.json"),
                pointer: "settings",
              },
            ]
          : context.source.platform === "kimi"
            ? [
                {
                  filePath: path.join(resolveKimiSessionDir(context.filePath) ?? path.dirname(context.filePath), "state.json"),
                  pointer: "state",
                },
              ]
          : context.source.platform === "accio"
            ? [
                {
                  filePath: context.filePath.replace(/\.messages\.jsonl$/u, ".meta.jsonc"),
                  pointer: "meta",
                },
                {
                  filePath: deriveAccioConversationMetaPath(context.filePath),
                  pointer: "conversation_meta",
                },
              ]
            : undefined,
    },
    {
      createRecordId: baseRecordId,
      pathExists,
      readTextFile: (targetPath) => fs.readFile(targetPath, "utf8"),
      nowIso,
    },
  );
}

export function parseRecord(
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
      buildTokenUsageCheckpointBaselineKey,
      mergeMaxTokenUsageMetrics,
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
  if (context.source.platform === "kimi") {
    return parseKimiRuntimeRecord(context, record, parsed, draft, buildCommonParseRuntimeHelpers());
  }
  if (context.source.platform === "codebuddy") {
    const providerData = isObject(parsed.providerData) ? parsed.providerData : undefined;
    if (asBoolean(providerData?.skipRun) || asString(parsed.type) === "skip_run") {
      return {
        fragments: [],
        lossAudits: [
          createRecordLossAudit(
            context,
            record,
            "dropped_for_projection",
            "CodeBuddy skipRun command echo kept as raw evidence only",
            {
              diagnosticCode: "codebuddy_skiprun_command_echo",
              severity: "info",
            },
          ),
        ],
      };
    }

    const normalizedParsed = providerData && providerData.usage !== undefined && parsed.usage === undefined
      ? { ...parsed, usage: providerData.usage }
      : parsed;
    return parseGenericConversationRuntimeRecord(context, record, normalizedParsed, draft, {
      ...buildCommonParseRuntimeHelpers(),
      safeJsonParse,
    });
  }
  if (context.source.platform === "openclaw") {
    const normalizedFilePath = context.filePath.replace(/\\/g, "/");
    if (normalizedFilePath.includes("/cron/runs/")) {
      return parseOpenClawCronRunRuntimeRecord(context, record, parsed, draft, {
        ...buildCommonParseRuntimeHelpers(),
        safeJsonParse,
      });
    }
    return parseGenericConversationRuntimeRecord(context, record, parsed, draft, {
      ...buildCommonParseRuntimeHelpers(),
      safeJsonParse,
    });
  }
  if (context.source.platform === "accio") {
    return parseAccioRuntimeRecord(context, record, parsed, draft, {
      ...buildCommonParseRuntimeHelpers(),
      safeJsonParse,
    });
  }
  if (
    context.source.platform === "cursor" ||
    context.source.platform === "antigravity" ||
    context.source.platform === "gemini" ||
    context.source.platform === "opencode" ||
    context.source.platform === "lobechat" ||
    context.source.platform === "zcode"
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

export async function extractMultiSessionSeeds(
  source: SourceDefinition,
  filePath: string,
  fileBuffer: Buffer,
  blobId: string,
): Promise<ExtractedSessionSeed[] | undefined> {
  if (source.platform === "cursor" && path.basename(filePath) === "state.vscdb") {
    const extractVscodeStateSeeds = await loadExtractVscodeStateSeeds();
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
    });
  }
  if (source.platform === "antigravity" && path.basename(filePath) === "state.vscdb") {
    const extractVscodeStateSeeds = await loadExtractVscodeStateSeeds();
    return (await extractVscodeStateSeeds(source, filePath, {
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
    })) ?? [];
  }
  if (source.platform === "antigravity" && isAntigravityHistoryIndexFile(filePath)) {
    const historySeed = await extractAntigravityHistorySeed(filePath, fileBuffer, {
      readOptionalJsonFile,
      extractMarkdownHeading,
      pathExists,
      coerceIso,
      asString,
      nowIso,
      normalizeWorkspacePath,
    });
    return historySeed ? [historySeed] : [];
  }
  if (source.platform === "antigravity" && isAntigravityBrainSourceFile(filePath)) {
    const brainSeed = await extractAntigravityBrainSeed(filePath, fileBuffer, {
      readOptionalJsonFile,
      extractMarkdownHeading,
      pathExists,
      coerceIso,
      asString,
      nowIso,
      normalizeWorkspacePath,
    });
    return brainSeed ? [brainSeed] : [];
  }
  if (source.platform === "lobechat") {
    return extractConversationExportSeeds(source, filePath, fileBuffer, blobId);
  }
  if (source.platform === "zcode" && path.basename(filePath) === "db.sqlite") {
    return extractZcodeSqliteSeeds(source.platform, filePath, {
      asString,
      asNumber,
      isObject,
      safeJsonParse,
      epochMillisToIso,
      nowIso,
      normalizeWorkspacePath,
    });
  }
  if (source.platform === "opencode" || source.platform === "gemini") {
    const exportSeeds = await extractConversationExportSeeds(source, filePath, fileBuffer, blobId);
    if (exportSeeds && exportSeeds.length > 0) {
      return exportSeeds;
    }
  }
  return undefined;
}

export function buildAdapterBlobResult(
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
    source_session_id: draftPatch.source_session_id ??
      extractSourceSessionIdFromCanonicalSessionId(source.platform, sessionId),
    source_id: source.id,
    source_platform: source.platform,
    host_id: hostId,
    title: draftPatch.title,
    created_at: draftPatch.created_at,
    updated_at: draftPatch.updated_at,
    model: draftPatch.model,
    working_directory: draftPatch.working_directory,
    source_native_project_ref: deriveSourceNativeProjectRef(source, filePath),
    resume_command: draftPatch.resume_command,
    resume_working_directory: draftPatch.resume_working_directory,
    resume_command_confidence: draftPatch.resume_command_confidence,
    last_cumulative_token_usage: draftPatch.last_cumulative_token_usage,
    cumulative_token_usage_by_baseline: draftPatch.cumulative_token_usage_by_baseline,
  };

  for (const record of records) {
    const parsed = parseRecord(context, record, draft);
    fragments.push(...parsed.fragments);
    lossAudits.push(...parsed.lossAudits);
  }

  if (source.platform === "claude_code") {
    dedupeClaudeCodeTokenUsageFragments(fragments);
  }

  const atomized = atomizeFragments(source.id, sessionId, sourceFormatProfile.id, fragments);
  atoms.push(...atomized.atoms);
  edges.push(...atomized.edges);
  hydrateDraftFromAtoms(draft, atoms, blob.file_modified_at);
  // Note: the resume command is built from the *post-hydration* working_directory.
  // R40 deliberately reuses the latest cwd as the resume cwd signal, so the
  // synthesized `cd <cwd> && resume <uuid>` may diverge from the original
  // session's first cwd if a mid-session `cd` is reflected in workspace_signal
  // atoms. Validate that native `codex resume` / `claude --resume` reattach
  // correctly using the latest cwd on each supported upstream version before
  // assuming the projected command is interchangeable with the session's first
  // cwd.
  const resume = isOrdinaryResumeEligibleSourceFile(source.platform, filePath)
    ? buildSourceResumeCommand({
        platform: draft.source_platform,
        sourceSessionId: draft.source_session_id,
        workingDirectory: draft.working_directory,
      })
    : undefined;
  if (resume) {
    draft.resume_command = draft.resume_command ?? resume.command;
    draft.resume_working_directory = draft.resume_working_directory ?? resume.working_directory;
    draft.resume_command_confidence = draft.resume_command_confidence ?? resume.confidence;
  }

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

export function isOrdinaryResumeEligibleSourceFile(platform: SourcePlatform, filePath: string): boolean {
  if (platform === "claude_code" && /(^|[\\/])subagents([\\/]|$)/u.test(filePath)) {
    return false;
  }
  return true;
}

export async function captureBlob(
  source: SourceDefinition,
  hostId: string,
  filePath: string,
  captureRunId: string,
): Promise<CapturedBlobInput> {
  const beforeStats = await fs.stat(filePath);
  const fileBuffer = await fs.readFile(filePath);
  const afterStats = await fs.stat(filePath);
  const fileIdentityStable =
    beforeStats.size === afterStats.size &&
    beforeStats.mtimeMs === afterStats.mtimeMs &&
    beforeStats.ctimeMs === afterStats.ctimeMs &&
    fileBuffer.byteLength === afterStats.size;
  const checksum = sha1(fileBuffer);
  const content_max_timestamp = isIncrementalJsonlPlatform(source.platform)
    ? extractContentMaxTimestamp(fileBuffer)
    : undefined;
  return {
    blob: {
      id: stableId("blob", source.id, filePath, checksum),
      source_id: source.id,
      host_id: hostId,
      origin_path: filePath,
      checksum,
      size_bytes: fileBuffer.byteLength,
      captured_at: nowIso(),
      capture_run_id: captureRunId,
      file_modified_at: afterStats.mtime.toISOString(),
      file_changed_at: fileIdentityStable ? afterStats.ctime.toISOString() : undefined,
      file_identity_stable: fileIdentityStable,
      content_max_timestamp,
    },
    fileBuffer,
  };
}

// Stage 3: backing block size for streaming reads. 4 MiB balances syscall
// overhead against heap pressure — at this size a 100 MiB file costs ~25
// read syscalls and the in-flight chunk is bounded.
const STREAMING_BACKING_BLOCK_BYTES = 4 * 1024 * 1024;

// Stage 3: tail window retained during streaming capture so we can compute
// content_max_timestamp without re-reading the file. Matches the tailBytes
// default in extractContentMaxTimestamp.
const STREAMING_TAIL_RETENTION_BYTES = 64 * 1024;

// Stage 3: streaming variant of captureBlob for oversized JSONL files.
// Reads the file in STREAMING_BACKING_BLOCK_BYTES chunks, hashes incrementally,
// and retains only the last STREAMING_TAIL_RETENTION_BYTES for the watermark
// extraction. Returns a CapturedBlobInput without fileBuffer — downstream
// consumers must use streamingLineReader (for parsing) and prefixReader (for
// append detection) instead. The two helpers re-open the file on demand so
// the captured blob's memory cost stays bounded by the chunk size, not the
// file size.
export async function captureBlobStreaming(
  source: SourceDefinition,
  hostId: string,
  filePath: string,
  captureRunId: string,
): Promise<StreamingCapturedBlobInput> {
  const beforeStats = await fs.stat(filePath);
  const fileIdentityStableBefore = {
    size: beforeStats.size,
    mtimeMs: beforeStats.mtimeMs,
    ctimeMs: beforeStats.ctimeMs,
  };

  const handle = await fs.open(filePath, "r");
  let totalBytes = 0;
  let tail = Buffer.alloc(0);
  const hasher = createHash("sha1");
  try {
    while (true) {
      const block = Buffer.alloc(STREAMING_BACKING_BLOCK_BYTES);
      const { bytesRead } = await handle.read(block, 0, STREAMING_BACKING_BLOCK_BYTES, null);
      if (bytesRead === 0) {
        break;
      }
      const slice = bytesRead === STREAMING_BACKING_BLOCK_BYTES ? block : block.subarray(0, bytesRead);
      hasher.update(slice);
      totalBytes += bytesRead;
      const retained = Buffer.concat([tail, slice]);
      tail = retained.length > STREAMING_TAIL_RETENTION_BYTES
        ? retained.subarray(retained.length - STREAMING_TAIL_RETENTION_BYTES)
        : retained;
    }
  } finally {
    await handle.close();
  }

  const afterStats = await fs.stat(filePath);
  const fileIdentityStable =
    fileIdentityStableBefore.size === afterStats.size &&
    fileIdentityStableBefore.mtimeMs === afterStats.mtimeMs &&
    fileIdentityStableBefore.ctimeMs === afterStats.ctimeMs &&
    totalBytes === afterStats.size;
  const checksum = hasher.digest("hex");
  const content_max_timestamp = isIncrementalJsonlPlatform(source.platform)
    ? extractContentMaxTimestamp(tail)
    : undefined;

  return {
    blob: {
      id: stableId("blob", source.id, filePath, checksum),
      source_id: source.id,
      host_id: hostId,
      origin_path: filePath,
      checksum,
      size_bytes: totalBytes,
      captured_at: nowIso(),
      capture_run_id: captureRunId,
      file_modified_at: afterStats.mtime.toISOString(),
      file_changed_at: fileIdentityStable ? afterStats.ctime.toISOString() : undefined,
      file_identity_stable: fileIdentityStable,
      content_max_timestamp,
    },
    streamingLineReader: async function* streamChunks(): AsyncGenerator<Buffer> {
      const fh = await fs.open(filePath, "r");
      try {
        while (true) {
          const block = Buffer.alloc(STREAMING_BACKING_BLOCK_BYTES);
          const { bytesRead } = await fh.read(block, 0, STREAMING_BACKING_BLOCK_BYTES, null);
          if (bytesRead === 0) {
            break;
          }
          yield bytesRead === STREAMING_BACKING_BLOCK_BYTES ? block : block.subarray(0, bytesRead);
        }
      } finally {
        await fh.close();
      }
    },
    prefixReader: async function readPrefix(bytes: number): Promise<Buffer> {
      if (bytes <= 0) {
        return Buffer.alloc(0);
      }
      const fh = await fs.open(filePath, "r");
      try {
        const block = Buffer.alloc(bytes);
        const { bytesRead } = await fh.read(block, 0, bytes, 0);
        return bytesRead === bytes ? block : block.subarray(0, bytesRead);
      } finally {
        await fh.close();
      }
    },
    hashPrefix: async function hashPrefix(bytes: number): Promise<{ sha1: string; lastByte: number | null }> {
      if (bytes <= 0) {
        return { sha1: createHash("sha1").digest("hex"), lastByte: null };
      }
      const fh = await fs.open(filePath, "r");
      try {
        const hasher = createHash("sha1");
        let remaining = bytes;
        let lastByte: number | null = null;
        const block = Buffer.alloc(STREAMING_BACKING_BLOCK_BYTES);
        while (remaining > 0) {
          const toRead = Math.min(remaining, STREAMING_BACKING_BLOCK_BYTES);
          const { bytesRead } = await fh.read(block, 0, toRead, null);
          if (bytesRead === 0) {
            break;
          }
          hasher.update(block.subarray(0, bytesRead));
          lastByte = block[bytesRead - 1]!;
          remaining -= bytesRead;
        }
        return { sha1: hasher.digest("hex"), lastByte };
      } finally {
        await fh.close();
      }
    },
    readSuffix: async function readSuffix(offset: number): Promise<Buffer> {
      const fh = await fs.open(filePath, "r");
      try {
        const stats = await fh.stat();
        const length = Math.max(0, stats.size - offset);
        if (length === 0) {
          return Buffer.alloc(0);
        }
        const buf = Buffer.alloc(length);
        const { bytesRead } = await fh.read(buf, 0, length, offset);
        return bytesRead === length ? buf : buf.subarray(0, bytesRead);
      } finally {
        await fh.close();
      }
    },
  };
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

export function extractGenericSessionMetadata(parsed: Record<string, unknown>): GenericSessionMetadata {
  return extractGenericSessionMetadataRuntime(parsed, {
    isObject,
    asString,
    asBoolean,
    normalizeWorkspacePath,
  });
}

export function extractGenericRole(message: Record<string, unknown>): string | undefined {
  return extractGenericRoleRuntime(message, {
    isObject,
    asString,
  });
}

export function extractGenericContentItems(message: Record<string, unknown>): Record<string, unknown>[] {
  return extractGenericContentItemsRuntime(message, {
    isObject,
    asString,
    asArray,
  });
}

export function normalizeToolInput(value: unknown): Record<string, unknown> {
  return normalizeToolInputRuntime(value, {
    isObject,
    safeJsonParse,
  });
}

export function buildTextFragmentPayload(
  actorKind: ActorKind,
  chunk: UserTextChunk,
  options: {
    usage?: TokenUsageMetrics;
    stopReason?: AssistantStopReason;
    messageId?: string;
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
  if (options.messageId) {
    payload.message_id = options.messageId;
  }
  return payload;
}

// Claude Code writes multi-block assistant messages (thinking + text + N tool_use)
// as one JSONL line per block, each carrying the same Anthropic `message.id` and
// the same final aggregated usage. Without dedup, every non-text block re-emits a
// token_usage fragment and the same API call is counted many times.
// We collapse fragments sharing a `message.id` to one, keeping the highest
// `total_tokens` (subsequent blocks of a streaming response carry progressively
// more output, so max-total naturally selects the final state).
function dedupeClaudeCodeTokenUsageFragments(fragments: SourceFragment[]): void {
  const indexOfKept = new Map<string, number>();
  const removed = new Set<number>();
  for (let i = 0; i < fragments.length; i++) {
    const frag = fragments[i];
    if (!frag || frag.fragment_kind !== "token_usage_signal") continue;
    const messageId = typeof frag.payload.message_id === "string" ? frag.payload.message_id : undefined;
    if (!messageId) continue;
    const existingIdx = indexOfKept.get(messageId);
    if (existingIdx === undefined) {
      indexOfKept.set(messageId, i);
      continue;
    }
    const existing = fragments[existingIdx];
    if (existing && tokenUsageTotal(frag.payload) > tokenUsageTotal(existing.payload)) {
      fragments[existingIdx] = frag;
    }
    removed.add(i);
  }
  if (removed.size > 0) {
    for (let i = fragments.length - 1; i >= 0; i--) {
      if (removed.has(i)) fragments.splice(i, 1);
    }
  }
}

function tokenUsageTotal(payload: Record<string, unknown>): number {
  const usage = payload.token_usage;
  if (!usage || typeof usage !== "object") return 0;
  const u = usage as Record<string, unknown>;
  const sum = (key: string): number => (typeof u[key] === "number" ? (u[key] as number) : 0);
  return sum("input_tokens") + sum("cache_read_input_tokens")
    + sum("cache_creation_input_tokens") + sum("output_tokens");
}

export function createTokenUsageFragment(
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

export function appendChunkedTextFragments(
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
    messageId?: string;
  } = {},
): { nextSeq: number; usageApplied: boolean } {
  let usageApplied = options.usageApplied ?? false;
  const chunks = buildTextChunks(context.source.platform, actorKind, text, { filePath: context.filePath });
  for (const chunk of chunks) {
    const firstAssistantChunk = actorKind === "assistant" && !usageApplied;
    fragments.push(
      createFragment(context, record, nextSeq++, "text", timeKey, {
        ...buildTextFragmentPayload(actorKind, chunk, {
          usage: firstAssistantChunk ? options.usage : undefined,
          stopReason: firstAssistantChunk ? options.stopReason : undefined,
          messageId: firstAssistantChunk ? options.messageId : undefined,
        }),
      }),
    );
    if (firstAssistantChunk) {
      usageApplied = true;
    }
  }
  return { nextSeq, usageApplied };
}

export function appendUnsupportedContentItem(
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

export async function extractConversationExportSeeds(
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
  if (source.platform === "gemini") {
    const geminiSeed = await extractGeminiSessionSeed(source.base_dir, filePath, fileBuffer);
    if (geminiSeed) {
      return [geminiSeed];
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

export async function readOptionalJsonFile(targetPath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    const parsed = safeJsonParse(raw);
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function extractMarkdownHeading(text: string): string | undefined {
  const firstHeading = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.startsWith("#"));
  return firstHeading?.replace(/^#+\s*/u, "").trim() || undefined;
}

export function collectConversationSeedsFromValue(
  platform: SourcePlatform,
  value: unknown,
  originHint: string,
  options: ConversationSeedOptions = {},
): ExtractedSessionSeed[] {
  return collectConversationSeedsFromValueRuntime(
    platform,
    value,
    originHint,
    {
      asString,
      asNumber,
      asArray,
      isObject,
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
      stringifyToolContent,
    },
    options,
  );
}

export function normalizeMessageCandidate(
  value: unknown,
  defaultWorkingDirectory?: string,
): { observedAt?: string; record: Record<string, unknown> } | undefined {
  return normalizeMessageCandidateRuntime(
    value,
    {
      asString,
      asNumber,
      asArray,
      isObject,
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
      stringifyToolContent,
    },
    defaultWorkingDirectory,
  );
}

export async function extractGeminiSessionSeed(
  baseDir: string,
  filePath: string,
  fileBuffer: Buffer,
): Promise<ExtractedSessionSeed | undefined> {
  const parsed = safeJsonParse(fileBuffer.toString("utf8"));
  if (!isObject(parsed)) {
    return undefined;
  }

  const rawSessionId =
    asString(parsed.sessionId) ??
    asString(parsed.id) ??
    path.basename(filePath, path.extname(filePath));
  const sessionId = `sess:gemini:${rawSessionId}`;
  const projectKey = extractGeminiProjectKey(filePath);
  const geminiRoot = resolveGeminiRoot(baseDir, filePath);
  const projectMetadata = geminiRoot && projectKey ? await resolveGeminiProjectMetadata(geminiRoot, projectKey) : {};
  const title = projectMetadata.title ?? projectKey;
  const workingDirectory = projectMetadata.workingDirectory;
  const createdAt =
    coerceIso(parsed.startTime) ??
    coerceIso(parsed.createdAt) ??
    coerceIso(parsed.created_at);
  const updatedAt =
    coerceIso(parsed.lastUpdated) ??
    coerceIso(parsed.updatedAt) ??
    coerceIso(parsed.updated_at) ??
    createdAt;
  const model = asString(parsed.model);

  const seeds = collectConversationSeedsFromValue("gemini", parsed, rawSessionId, {
    defaultSessionId: sessionId,
    defaultTitle: title,
    defaultWorkingDirectory: workingDirectory,
  });
  const seed = seeds[0];
  if (!seed) {
    return undefined;
  }

  return {
    sessionId: seed.sessionId,
    title: seed.title ?? title,
    createdAt: minIso(seed.createdAt, createdAt),
    updatedAt: maxIso(seed.updatedAt, updatedAt),
    model: seed.model ?? model,
    workingDirectory: seed.workingDirectory ?? workingDirectory,
    records: seed.records,
  };
}

export async function resolveGeminiProjectMetadata(
  geminiRoot: string,
  projectKey: string,
): Promise<{ workingDirectory?: string; title?: string }> {
  const tmpProjectRoot = await readOptionalTextFile(path.join(geminiRoot, "tmp", projectKey, ".project_root"));
  const historyProjectRoot = await readOptionalTextFile(path.join(geminiRoot, "history", projectKey, ".project_root"));
  const projectRootPath = tmpProjectRoot ?? historyProjectRoot;
  let workingDirectory = projectRootPath ? normalizeWorkspacePath(projectRootPath) : undefined;

  const projectsFile = await readOptionalJsonFile(path.join(geminiRoot, "projects.json"));
  const projects = isObject(projectsFile?.projects) ? projectsFile.projects : undefined;
  let title: string | undefined;

  if (workingDirectory && projects) {
    title = asString(projects[workingDirectory]);
  }
  if (!workingDirectory && projects) {
    for (const [workspacePath, label] of Object.entries(projects)) {
      if (asString(label) === projectKey) {
        workingDirectory = normalizeWorkspacePath(workspacePath);
        title = projectKey;
        break;
      }
    }
  }

  return {
    workingDirectory,
    title: title ?? projectKey,
  };
}

export async function readOptionalTextFile(targetPath: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    const trimmed = raw.trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}

export async function extractOpenCodeSessionSeed(
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
  const storageRoot = resolveOpenCodeStorageRoot(filePath);
  const messageDir = storageRoot ? path.join(storageRoot, "message", rawSessionId) : undefined;
  const records: ExtractedSessionSeed["records"] = [];
  const meta = extractGenericSessionMetadata(parsed);
  const time = isObject(parsed.time) ? parsed.time : undefined;
  const title = meta.title ?? asString(parsed.title) ?? asString(parsed.name);
  const model = meta.model ?? asString(parsed.model);
  const workingDirectory =
    meta.workspacePath ??
    (typeof parsed.directory === "string" ? normalizeWorkspacePath(parsed.directory) : undefined);
  const createdAt =
    coerceIso(parsed.createdAt) ??
    coerceIso(parsed.created_at) ??
    epochMillisToIso(asNumber(parsed.createdAt)) ??
    epochMillisToIso(asNumber(parsed.created)) ??
    epochMillisToIso(asNumber(time?.created));
  const updatedAt =
    coerceIso(parsed.updatedAt) ??
    coerceIso(parsed.updated_at) ??
    epochMillisToIso(asNumber(parsed.updatedAt)) ??
    epochMillisToIso(asNumber(parsed.updated)) ??
    epochMillisToIso(asNumber(time?.updated));
  let childAgentKey: string | undefined;

  if (messageDir && (await pathExists(messageDir))) {
    const messageFiles = (await fs.readdir(messageDir))
      .filter((name) => name.endsWith(".json"))
      .sort();
    for (const [index, name] of messageFiles.entries()) {
      const content = await fs.readFile(path.join(messageDir, name), "utf8");
      const parsedMessage = safeJsonParse(content);
      const enrichedMessage = await normalizeOpenCodeMessageEnvelope(
        parsedMessage,
        storageRoot,
        rawSessionId,
        workingDirectory,
      );
      childAgentKey = childAgentKey ?? (isObject(enrichedMessage) ? asString(enrichedMessage.agentId) : undefined);
      const normalized = normalizeMessageCandidate(enrichedMessage ?? parsedMessage, workingDirectory);
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

  if (title || model || workingDirectory || meta.parentUuid || meta.isSidechain || childAgentKey) {
    records.unshift({
      pointer: "meta",
      observedAt: createdAt ?? updatedAt ?? nowIso(),
      rawJson: JSON.stringify({
        id: sessionId,
        title,
        model,
        cwd: workingDirectory,
        parentUuid: meta.parentUuid,
        isSidechain: meta.isSidechain,
        agentId: childAgentKey,
      }),
    });
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

export function resolveOpenCodeStorageRoot(filePath: string): string | undefined {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const parts = normalizedPath.split("/").filter(Boolean);
  const storageIndex = parts.lastIndexOf("storage");
  if (storageIndex === -1) {
    return undefined;
  }
  return `${normalizedPath.startsWith("/") ? "/" : ""}${parts.slice(0, storageIndex + 1).join("/")}`;
}

export async function normalizeOpenCodeMessageEnvelope(
  value: unknown,
  storageRoot: string | undefined,
  fallbackSessionId: string,
  defaultWorkingDirectory?: string,
): Promise<Record<string, unknown> | undefined> {
  if (!isObject(value)) {
    return undefined;
  }

  const info = isObject(value.info) ? value.info : undefined;
  const time = isObject(value.time) ? value.time : undefined;
  const messagePath = isObject(value.path) ? value.path : undefined;
  const messageId = asString(value.id) ?? asString(info?.id);
  const workingDirectoryCandidate = asString(messagePath?.cwd) ?? defaultWorkingDirectory;
  const workingDirectory = workingDirectoryCandidate
    ? normalizeWorkspacePath(workingDirectoryCandidate)
    : undefined;
  const partPayload = storageRoot && messageId ? await readOpenCodePartPayload(storageRoot, messageId) : undefined;
  const inlineParts = Array.isArray(value.parts)
    ? value.parts.filter((entry): entry is Record<string, unknown> => isObject(entry))
    : [];
  const timestamp =
    coerceIso(value.timestamp) ??
    coerceIso(info?.timestamp) ??
    coerceIso(value.createdAt) ??
    coerceIso(info?.createdAt) ??
    epochMillisToIso(asNumber(time?.created));

  return {
    id: messageId,
    sessionId: asString(value.sessionID) ?? asString(value.sessionId) ?? fallbackSessionId,
    parentId:
      asString(value.parentID) ??
      asString(value.parentId) ??
      asString(info?.parentID) ??
      asString(info?.parentId),
    agentId:
      asString(value.agentId) ??
      asString(value.agent) ??
      asString(info?.agentId) ??
      asString(info?.agent),
    role: asString(value.role) ?? asString(info?.role),
    model: asString(value.modelID) ?? asString(value.model) ?? asString(info?.model),
    cwd: workingDirectory,
    timestamp,
    stopReason:
      asString(value.finish) ??
      asString(value.stopReason) ??
      asString(info?.stopReason) ??
      partPayload?.stopReason,
    usage:
      normalizeOpenCodeUsagePayload(value.tokens) ??
      normalizeOpenCodeUsagePayload(value.usage) ??
      partPayload?.usage,
    parts: [...inlineParts, ...(partPayload?.items ?? [])],
  };
}

export async function readOpenCodePartPayload(
  storageRoot: string,
  messageId: string,
): Promise<{
  items: Record<string, unknown>[];
  usage?: Record<string, unknown>;
  stopReason?: string;
}> {
  const partDir = path.join(storageRoot, "part", messageId);
  if (!(await pathExists(partDir))) {
    return { items: [] };
  }

  const items: Record<string, unknown>[] = [];
  let usage: Record<string, unknown> | undefined;
  let stopReason: string | undefined;
  const partFiles = (await fs.readdir(partDir)).filter((name) => name.endsWith(".json")).sort();

  for (const name of partFiles) {
    const parsedPart = safeJsonParse(await fs.readFile(path.join(partDir, name), "utf8"));
    if (!isObject(parsedPart)) {
      continue;
    }

    const partType = asString(parsedPart.type);
    if ((partType === "text" || partType === "reasoning") && typeof parsedPart.text === "string" && parsedPart.text.trim()) {
      items.push({ type: "text", text: parsedPart.text });
      continue;
    }

    if (partType === "tool") {
      const state = isObject(parsedPart.state) ? parsedPart.state : undefined;
      const callId = asString(parsedPart.callID) ?? asString(parsedPart.callId);
      const toolName = asString(parsedPart.tool) ?? asString(parsedPart.name);
      items.push({
        type: "tool_call",
        id: callId,
        name: toolName,
        input: state?.input,
      });
      if (state?.output !== undefined || state?.result !== undefined || state?.metadata !== undefined) {
        items.push({
          type: "tool_result",
          tool_use_id: callId,
          content: state?.output ?? state?.result ?? state?.metadata ?? state,
        });
      }
      continue;
    }

    if (partType === "step-finish") {
      usage = normalizeOpenCodeUsagePayload(parsedPart.tokens) ?? usage;
      stopReason = asString(parsedPart.reason) ?? stopReason;
    }
  }

  return { items, usage, stopReason };
}

export function normalizeOpenCodeUsagePayload(value: unknown): Record<string, unknown> | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const cache = isObject(value.cache) ? value.cache : undefined;
  const inputTokens = asNumber(value.input);
  const outputTokens = asNumber(value.output);
  const reasoningTokens = asNumber(value.reasoning);
  const cacheReadTokens = asNumber(cache?.read);
  const cacheCreationTokens = asNumber(cache?.write);
  const totalTokens = sumDefinedNumbers(inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheCreationTokens);

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    reasoningTokens === undefined &&
    cacheReadTokens === undefined &&
    cacheCreationTokens === undefined
  ) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens,
  };
}

export function extractRichTextText(value: string): string | undefined {
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

async function loadExtractVscodeStateSeeds(): Promise<typeof import("./vscode-state.js").extractVscodeStateSeeds> {
  vscodeStateExtractorPromise ??= import("./vscode-state.js").then((module) => module.extractVscodeStateSeeds);
  return vscodeStateExtractorPromise;
}
