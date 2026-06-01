import os from "node:os";
import path from "node:path";
import { stat } from "node:fs/promises";
import type {
  Host,
  SourceDefinition,
  SourceSyncPayload,
  CapturedBlob,
  RawRecord,
  SourceFragment,
  ConversationAtom,
  AtomEdge,
  LossAuditRecord,
  DerivedCandidate,
  SessionProjection,
  UserTurnProjection,
  TurnContextProjection,
  SourceFormatProfile,
  SourcePlatform,
} from "@cchistory/domain";
import { deriveHostId, deriveSourceInstanceId } from "@cchistory/domain";
import {
  nowIso,
  stableId,
  pathExists,
  formatErrorMessage,
  createLossAudit,
  dedupeById,
  listSourceFiles,
  readGitProjectEvidence,
  deriveSessionId,
  extractSourceSessionIdFromCanonicalSessionId,
  buildSourceResumeCommand,
  minIso,
  maxIso,
  sha1,
  compareTimeThenSeq,
  collapseAntigravityUserTurnAtoms,
} from "./utils.js";
import { getDefaultSources, resolveSourceFormatProfile } from "./discovery.js";
import { extractAntigravityLiveSeeds } from "../platforms/antigravity/live.js";
import { extractCursorChatStoreSeed } from "../platforms/cursor/runtime.js";
import { getPlatformAdapter } from "../platforms/registry.js";
import {
  extractRecords,
  extractMultiSessionSeeds,
  buildAdapterBlobResult,
  captureBlob,
  parseRecord,
  isOrdinaryResumeEligibleSourceFile,
  extractGenericSessionMetadata,
  extractGenericRole,
  extractGenericContentItems,
  extractRichTextText,
  collectConversationSeedsFromValue,
} from "./parser.js";
import { atomizeFragments, hydrateDraftFromAtoms } from "./atomizer.js";
import {
  buildProjectObservationCandidates,
  buildSubmissionGroups,
  buildTurnsAndContext,
  buildStageRuns,
} from "./projections.js";
import type {
  ProbeOptions,
  SessionDraft,
  AdapterBlobResult,
  CollectionCoreResult,
  ProcessingCoreResult,
  CapturedBlobInput,
  SessionBuildInput,
  ExtractedSessionSeed,
  SourceProbeProgressEvent,
} from "./types.js";
import { asArray, asNumber, asString, coerceIso, epochMillisToIso, isObject, normalizeStopReason, safeJsonParse, extractTokenUsage, firstDefinedNumber, truncate, normalizeWorkspacePath } from "./utils.js";

const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;

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
    payloads.push(await processSource(source, host, options));
  }

  return { host, sources: payloads };
}

async function processSource(
  source: SourceDefinition,
  host: Host,
  options: ProbeOptions,
): Promise<SourceSyncPayload> {
  const startedAt = nowIso();
  const monotonicStartedAt = Date.now();
  const sourceFormatProfile = resolveSourceFormatProfile(source);
  emitProbeProgress(options, source, {
    stage: "source_start",
    message: `Scanning ${source.display_name} (${source.slot_id})`,
  });
  const baseDirExists = await pathExists(source.base_dir);
  if (!baseDirExists) {
    emitProbeProgress(options, source, {
      stage: "source_missing",
      message: `Source path not found: ${source.base_dir}`,
      elapsed_ms: Date.now() - monotonicStartedAt,
    });
    const stageRuns = buildStageRuns(source.id, source.platform, startedAt, nowIso(), {
      blobs: 0,
      records: 0,
      fragments: 0,
      atoms: 0,
      sessions: 0,
      turns: 0,
    }, []);
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

  const collectionCore = await collectSourceInputs(source, host, sourceFormatProfile, options, startedAt);
  emitProbeProgress(options, source, {
    stage: "derive_start",
    message: `Deriving projections from ${collectionCore.sessionsById.size} session candidate(s)`,
  });
  const deriveStartedAt = Date.now();
  const processingCore = await processCollectedSessions(
    collectionCore.sessionsById,
    collectionCore.orphanBlobs,
    collectionCore.sourceLossAudits,
    { safeMode: options.safe_mode ?? false },
  );
  emitProbeProgress(options, source, {
    stage: "derive_done",
    message: `Derived ${processingCore.sessions.length} session(s), ${processingCore.turns.length} turn(s)`,
    count: processingCore.turns.length,
    elapsed_ms: Date.now() - deriveStartedAt,
  });
  const uniqueBlobs = dedupeById(processingCore.blobs);

  const finishedAt = nowIso();
  const stageRuns = buildStageRuns(source.id, source.platform, startedAt, finishedAt, {
    blobs: uniqueBlobs.length,
    records: processingCore.records.length,
    fragments: processingCore.fragments.length,
    atoms: processingCore.atoms.length,
    sessions: processingCore.sessions.length,
    turns: processingCore.turns.length,
  }, processingCore.lossAudits);

  const payload: SourceSyncPayload = {
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
  emitProbeProgress(options, source, {
    stage: "source_done",
    message: `Finished ${source.display_name}`,
    count: processingCore.turns.length,
    elapsed_ms: Date.now() - monotonicStartedAt,
  });
  return payload;
}

async function collectSourceInputs(
  source: SourceDefinition,
  host: Host,
  sourceFormatProfile: SourceFormatProfile,
  options: ProbeOptions,
  startedAt: string,
): Promise<CollectionCoreResult> {
  const captureRunId = stableId("capture-run", source.id, startedAt);
  const adapter = getPlatformAdapter(source.platform);
  const previousIndex = buildPreviousSourceIndex(options.previous_payloads?.[source.id], sourceFormatProfile);
  const changedSinceMs = parseChangedSinceMs(options.changed_since);
  const sessionsById = new Map<string, SessionBuildInput>();
  const orphanBlobs: CapturedBlob[] = [];
  const companionFiles: string[] = [];
  const capturedCompanionPaths = new Set<string>();
  const sourceLossAudits: LossAuditRecord[] = [];
  const fileProcessingErrors: string[] = [];
  const liveFiles: string[] = [];
  let remainingFileLimit = options.limit_files_per_source;

  if (source.platform === "antigravity" && !options.safe_mode) {
    emitProbeProgress(options, source, {
      stage: "live_probe_start",
      message: "Reading Antigravity live trajectory API",
    });
    const liveCollection = await extractAntigravityLiveSeeds(source.base_dir, {
      limit: remainingFileLimit,
    });
    if (liveCollection) {
      for (const [index, seed] of liveCollection.seeds.entries()) {
        mergeAdapterBlobResult(
          sessionsById,
          buildSyntheticSeedAdapterResult(
            source,
            sourceFormatProfile,
            host.id,
            captureRunId,
            liveCollection.virtualPaths[index] ?? `antigravity-live://${seed.sessionId}`,
            seed,
          ),
        );
      }
      liveFiles.push(...liveCollection.virtualPaths);
      if (typeof remainingFileLimit === "number") {
        remainingFileLimit = Math.max(remainingFileLimit - liveCollection.virtualPaths.length, 0);
      }
    }
    emitProbeProgress(options, source, {
      stage: "live_probe_done",
      message: `Collected ${liveCollection?.virtualPaths.length ?? 0} live item(s)`,
      count: liveCollection?.virtualPaths.length ?? 0,
    });
  }

  emitProbeProgress(options, source, {
    stage: "list_files_start",
    message: `Listing source files under ${source.base_dir}`,
  });
  const listFilesStartedAt = Date.now();
  const files = await listSourceFiles(source.platform, source.base_dir, remainingFileLimit);
  emitProbeProgress(options, source, {
    stage: "list_files_done",
    message: `Found ${files.length} source file(s)`,
    count: files.length,
    file_count: files.length,
    elapsed_ms: Date.now() - listFilesStartedAt,
  });

  for (const [fileIndex, filePath] of files.entries()) {
    let capturedBlob: CapturedBlobInput | undefined;
    const fileStartedAt = Date.now();
    emitProbeProgress(options, source, {
      stage: "file_start",
      message: `Processing ${filePath}`,
      file_path: filePath,
      file_index: fileIndex + 1,
      file_count: files.length,
    });
    try {
      const fileStats = await stat(filePath);
      const sizeBytes = fileStats.size;
      const maxFileBytes = options.max_file_bytes ?? DEFAULT_MAX_FILE_BYTES;
      if (sizeBytes > maxFileBytes) {
        const detail = `Skipped oversized source file ${filePath}: ${sizeBytes} bytes exceeds ${maxFileBytes} byte limit`;
        const blobRef = stableId("blob", source.id, filePath, "oversized");
        sourceLossAudits.push(
          createLossAudit(source.id, blobRef, "unknown_fragment", detail, {
            stageKind: "capture",
            diagnosticCode: "blob_too_large",
            severity: "warning",
            blobRef,
            sourceFormatProfileId: sourceFormatProfile.id,
          }),
        );
        fileProcessingErrors.push(detail);
        emitProbeProgress(options, source, {
          stage: "file_error",
          message: detail,
          file_path: filePath,
          file_index: fileIndex + 1,
          file_count: files.length,
          elapsed_ms: Date.now() - fileStartedAt,
        });
        continue;
      }
      const previousEntry = previousIndex?.byOriginPath.get(path.normalize(filePath));
      const isOlderThanSince = changedSinceMs !== undefined && fileStats.mtime.getTime() < changedSinceMs;
      if (previousEntry && canReuseBlobFromStats(previousEntry, fileStats)) {
        if (!previousIndex?.metadataOnly) {
          mergePreviousFileEntry(sessionsById, orphanBlobs, sourceLossAudits, previousEntry);
        }
        emitProbeProgress(options, source, {
          stage: "file_skip",
          message: `Reused unchanged file without reading content: ${filePath}`,
          file_path: filePath,
          file_index: fileIndex + 1,
          file_count: files.length,
          size_bytes: fileStats.size,
          elapsed_ms: Date.now() - fileStartedAt,
        });
        emitProbeProgress(options, source, {
          stage: "file_done",
          message: `Processed ${filePath}`,
          file_path: filePath,
          file_index: fileIndex + 1,
          file_count: files.length,
          size_bytes: fileStats.size,
          elapsed_ms: Date.now() - fileStartedAt,
        });
        continue;
      }
      const captureStartedAt = Date.now();
      capturedBlob = await captureBlob(source, host.id, filePath, captureRunId);
      emitProbeProgress(options, source, {
        stage: "file_capture_done",
        message: `Captured ${filePath}`,
        file_path: filePath,
        file_index: fileIndex + 1,
        file_count: files.length,
        size_bytes: capturedBlob.blob.size_bytes,
        elapsed_ms: Date.now() - captureStartedAt,
      });

      if (previousEntry && canReuseCapturedBlob(previousEntry, capturedBlob.blob)) {
        if (previousIndex?.metadataOnly) {
          orphanBlobs.push(capturedBlob.blob);
          emitProbeProgress(options, source, {
            stage: "file_skip",
            message: `Reused unchanged file: ${filePath}`,
            file_path: filePath,
            file_index: fileIndex + 1,
            file_count: files.length,
            size_bytes: capturedBlob.blob.size_bytes,
            elapsed_ms: Date.now() - fileStartedAt,
          });
          emitProbeProgress(options, source, {
            stage: "file_done",
            message: `Processed ${filePath}`,
            file_path: filePath,
            file_index: fileIndex + 1,
            file_count: files.length,
            size_bytes: capturedBlob.blob.size_bytes,
            elapsed_ms: Date.now() - fileStartedAt,
          });
          continue;
        }
        mergePreviousFileEntry(sessionsById, orphanBlobs, sourceLossAudits, previousEntry, capturedBlob.blob);
        emitProbeProgress(options, source, {
          stage: isOlderThanSince ? "file_skip" : "file_reuse",
          message: isOlderThanSince
            ? `Reused unchanged file: ${filePath}`
            : `Reused unchanged projection for ${filePath}`,
          file_path: filePath,
          file_index: fileIndex + 1,
          file_count: files.length,
          size_bytes: capturedBlob.blob.size_bytes,
          elapsed_ms: Date.now() - fileStartedAt,
        });
        emitProbeProgress(options, source, {
          stage: "file_done",
          message: `Processed ${filePath}`,
          file_path: filePath,
          file_index: fileIndex + 1,
          file_count: files.length,
          size_bytes: capturedBlob.blob.size_bytes,
          elapsed_ms: Date.now() - fileStartedAt,
        });
        continue;
      }
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
      emitProbeProgress(options, source, {
        stage: "file_error",
        message: detail,
        file_path: filePath,
        file_index: fileIndex + 1,
        file_count: files.length,
        elapsed_ms: Date.now() - fileStartedAt,
      });
      continue;
    }

    try {
      const parseStartedAt = Date.now();
      const previousEntry = previousIndex?.byOriginPath.get(path.normalize(filePath));
      const appendedResults = previousEntry
        ? processAppendedJsonlBlob(source, sourceFormatProfile, filePath, capturedBlob, previousEntry)
        : undefined;
      if (appendedResults) {
        emitProbeProgress(options, source, {
          stage: "file_append_start",
          message: `Parsing appended records for ${filePath}`,
          file_path: filePath,
          file_index: fileIndex + 1,
          file_count: files.length,
        });
      }
      const adapterResults = appendedResults ?? await processBlob(source, sourceFormatProfile, filePath, capturedBlob);
      for (const adapterResult of adapterResults) {
        mergeAdapterBlobResult(sessionsById, adapterResult);
      }
      emitProbeProgress(options, source, {
        stage: appendedResults ? "file_append_done" : "file_parse_done",
        message: appendedResults ? `Parsed appended records for ${filePath}` : `Parsed ${filePath}`,
        file_path: filePath,
        file_index: fileIndex + 1,
        file_count: files.length,
        size_bytes: capturedBlob.blob.size_bytes,
        elapsed_ms: Date.now() - parseStartedAt,
      });
      if (adapter?.getCompanionEvidencePaths && !options.safe_mode) {
        for (const companionPath of await adapter.getCompanionEvidencePaths(source.base_dir, filePath)) {
          const normalizedCompanionPath = path.normalize(companionPath);
          if (capturedCompanionPaths.has(normalizedCompanionPath) || !(await pathExists(normalizedCompanionPath))) {
            continue;
          }

          capturedCompanionPaths.add(normalizedCompanionPath);
          try {
            orphanBlobs.push((await captureBlob(source, host.id, normalizedCompanionPath, captureRunId)).blob);
            companionFiles.push(normalizedCompanionPath);
          } catch (error) {
            const blobRef = stableId("blob", source.id, normalizedCompanionPath, "capture-failed");
            sourceLossAudits.push(
              createLossAudit(
                source.id,
                blobRef,
                "unknown_fragment",
                `Failed to capture companion evidence file ${normalizedCompanionPath}: ${formatErrorMessage(error)}`,
                {
                  stageKind: "capture",
                  diagnosticCode: "blob_capture_failed",
                  severity: "warning",
                  blobRef,
                  sourceFormatProfileId: sourceFormatProfile.id,
                },
              ),
            );
          }
        }
      }
      emitProbeProgress(options, source, {
        stage: "file_done",
        message: `Processed ${filePath}`,
        file_path: filePath,
        file_index: fileIndex + 1,
        file_count: files.length,
        size_bytes: capturedBlob.blob.size_bytes,
        elapsed_ms: Date.now() - fileStartedAt,
      });
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
      emitProbeProgress(options, source, {
        stage: "file_error",
        message: detail,
        file_path: filePath,
        file_index: fileIndex + 1,
        file_count: files.length,
        elapsed_ms: Date.now() - fileStartedAt,
      });
    }
  }

  return {
    files: [...liveFiles, ...files, ...companionFiles],
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
  mergeSessionBuildInput(sessionsById, {
    draft: adapterResult.draft,
    blobs: [...adapterResult.blobs],
    records: [...adapterResult.records],
    fragments: [...adapterResult.fragments],
    atoms: [...adapterResult.atoms],
    edges: [...adapterResult.edges],
    loss_audits: [...adapterResult.loss_audits],
  });
}

function mergeSessionBuildInput(
  sessionsById: Map<string, SessionBuildInput>,
  sessionInput: SessionBuildInput,
): void {
  const current = sessionsById.get(sessionInput.draft.id);
  if (current) {
    current.blobs.push(...sessionInput.blobs);
    current.records.push(...sessionInput.records);
    current.fragments.push(...sessionInput.fragments);
    current.atoms.push(...sessionInput.atoms);
    current.edges.push(...sessionInput.edges);
    current.loss_audits.push(...sessionInput.loss_audits);
    current.draft.title = current.draft.title ?? sessionInput.draft.title;
    current.draft.working_directory = current.draft.working_directory ?? sessionInput.draft.working_directory;
    current.draft.model = current.draft.model ?? sessionInput.draft.model;
    current.draft.source_session_id = current.draft.source_session_id ?? sessionInput.draft.source_session_id;
    current.draft.resume_command = current.draft.resume_command ?? sessionInput.draft.resume_command;
    current.draft.resume_working_directory =
      current.draft.resume_working_directory ?? sessionInput.draft.resume_working_directory;
    current.draft.resume_command_confidence =
      current.draft.resume_command_confidence ?? sessionInput.draft.resume_command_confidence;
    current.draft.created_at = minIso(current.draft.created_at, sessionInput.draft.created_at);
    current.draft.updated_at = maxIso(current.draft.updated_at, sessionInput.draft.updated_at);
    return;
  }

  sessionsById.set(sessionInput.draft.id, {
    draft: { ...sessionInput.draft },
    blobs: [...sessionInput.blobs],
    records: [...sessionInput.records],
    fragments: [...sessionInput.fragments],
    atoms: [...sessionInput.atoms],
    edges: [...sessionInput.edges],
    loss_audits: [...sessionInput.loss_audits],
  });
}

function mergePreviousFileEntry(
  sessionsById: Map<string, SessionBuildInput>,
  orphanBlobs: CapturedBlob[],
  sourceLossAudits: LossAuditRecord[],
  previousEntry: PreviousFileEntry,
  replacementTailBlob?: CapturedBlob,
): void {
  const blobReplacements = replacementTailBlob ? new Map([[replacementTailBlob.id, replacementTailBlob]]) : undefined;
  for (const sessionInput of previousEntry.sessionInputs) {
    mergeSessionBuildInput(sessionsById, blobReplacements ? replaceSessionInputBlobs(sessionInput, blobReplacements) : sessionInput);
  }
  orphanBlobs.push(...previousEntry.orphanBlobs.map((blob) => replaceBlob(blob, blobReplacements)));
  sourceLossAudits.push(...previousEntry.lossAudits);
}

function replaceSessionInputBlobs(
  sessionInput: SessionBuildInput,
  replacements: ReadonlyMap<string, CapturedBlob>,
): SessionBuildInput {
  return {
    ...sessionInput,
    blobs: sessionInput.blobs.map((blob) => replaceBlob(blob, replacements)),
  };
}

function replaceBlob(blob: CapturedBlob, replacements: ReadonlyMap<string, CapturedBlob> | undefined): CapturedBlob {
  const replacement = replacements?.get(blob.id);
  if (!replacement) {
    return blob;
  }
  return {
    ...blob,
    size_bytes: replacement.size_bytes,
    captured_at: replacement.captured_at,
    capture_run_id: replacement.capture_run_id,
    file_modified_at: replacement.file_modified_at,
    file_changed_at: replacement.file_changed_at,
    file_identity_stable: replacement.file_identity_stable,
  };
}

interface PreviousFileEntry {
  originPath: string;
  blobs: CapturedBlob[];
  tailBlob?: CapturedBlob;
  sessionInputs: SessionBuildInput[];
  orphanBlobs: CapturedBlob[];
  lossAudits: LossAuditRecord[];
}

function backfillReusableSessionResumeFields(
  platform: SourcePlatform,
  filePath: string,
  draft: SessionDraft,
): SessionDraft {
  const sourceSessionId = draft.source_session_id ??
    extractSourceSessionIdFromCanonicalSessionId(platform, draft.id);
  const resume = isOrdinaryResumeEligibleSourceFile(platform, filePath)
    ? buildSourceResumeCommand({
        platform,
        sourceSessionId,
        workingDirectory: draft.working_directory,
      })
    : undefined;
  return {
    ...draft,
    source_session_id: sourceSessionId,
    resume_command: draft.resume_command ?? resume?.command,
    resume_working_directory: draft.resume_working_directory ?? resume?.working_directory,
    resume_command_confidence: draft.resume_command_confidence ?? resume?.confidence,
  };
}

interface PreviousSourceIndex {
  byOriginPath: Map<string, PreviousFileEntry>;
  metadataOnly: boolean;
}

function buildPreviousSourceIndex(
  previousPayload: SourceSyncPayload | undefined,
  sourceFormatProfile: SourceFormatProfile,
): PreviousSourceIndex | undefined {
  if (!previousPayload || !isIncrementalJsonlPlatform(previousPayload.source.platform)) {
    return undefined;
  }
  if (!previousPayloadMatchesProfile(previousPayload, sourceFormatProfile)) {
    return undefined;
  }

  const sessionsById = new Map(previousPayload.sessions.map((session) => [session.id, session]));
  const recordsByBlobId = groupBy(previousPayload.records, (record) => record.blob_id);
  const fragmentsByRecordId = groupBy(previousPayload.fragments, (fragment) => fragment.record_id);
  const atomsByFragmentId = new Map<string, ConversationAtom[]>();
  for (const atom of previousPayload.atoms) {
    for (const fragmentRef of atom.fragment_refs) {
      pushGrouped(atomsByFragmentId, fragmentRef, atom);
    }
  }
  const edgesByAtomId = new Map<string, AtomEdge[]>();
  for (const edge of previousPayload.edges) {
    pushGrouped(edgesByAtomId, edge.from_atom_id, edge);
    pushGrouped(edgesByAtomId, edge.to_atom_id, edge);
  }
  const lossAuditsByBlobRef = groupPresent(previousPayload.loss_audits, (audit) => audit.blob_ref);
  const lossAuditsByRecordRef = groupPresent(previousPayload.loss_audits, (audit) => audit.record_ref);
  const lossAuditsByFragmentRef = groupPresent(previousPayload.loss_audits, (audit) => audit.fragment_ref);
  const lossAuditsByAtomRef = groupPresent(previousPayload.loss_audits, (audit) => audit.atom_ref);
  const blobsByOriginPath = groupBy(previousPayload.blobs, (blob) => path.normalize(blob.origin_path));

  const byOriginPath = new Map<string, PreviousFileEntry>();
  for (const [originPath, blobs] of blobsByOriginPath) {
    const fileRecords = blobs.flatMap((blob) => recordsByBlobId.get(blob.id) ?? []);
    const fileRecordIds = new Set(fileRecords.map((record) => record.id));
    const fileFragments = fileRecords.flatMap((record) => fragmentsByRecordId.get(record.id) ?? []);
    const fileFragmentIds = new Set(fileFragments.map((fragment) => fragment.id));
    const fileAtoms = dedupeById(fileFragments.flatMap((fragment) => atomsByFragmentId.get(fragment.id) ?? []));
    const fileAtomIds = new Set(fileAtoms.map((atom) => atom.id));
    const fileEdges = dedupeById(fileAtoms.flatMap((atom) => edgesByAtomId.get(atom.id) ?? []))
      .filter((edge) => fileAtomIds.has(edge.from_atom_id) && fileAtomIds.has(edge.to_atom_id));
    const fileLossAudits = dedupeById([
      ...blobs.flatMap((blob) => lossAuditsByBlobRef.get(blob.id) ?? []),
      ...fileRecords.flatMap((record) => lossAuditsByRecordRef.get(record.id) ?? []),
      ...fileFragments.flatMap((fragment) => lossAuditsByFragmentRef.get(fragment.id) ?? []),
      ...fileAtoms.flatMap((atom) => lossAuditsByAtomRef.get(atom.id) ?? []),
    ]);
    const sessionRefs = new Set(fileRecords.map((record) => record.session_ref));
    const sessionInputs: SessionBuildInput[] = [];
    const sessionLossAuditIds = new Set<string>();
    for (const sessionRef of sessionRefs) {
      const session = sessionsById.get(sessionRef);
      const records = fileRecords.filter((record) => record.session_ref === sessionRef);
      const recordIds = new Set(records.map((record) => record.id));
      const fragments = fileFragments.filter((fragment) => recordIds.has(fragment.record_id));
      const fragmentIds = new Set(fragments.map((fragment) => fragment.id));
      const atoms = fileAtoms.filter((atom) => atom.fragment_refs.some((fragmentRef) => fragmentIds.has(fragmentRef)));
      const atomIds = new Set(atoms.map((atom) => atom.id));
      const edges = fileEdges.filter((edge) => atomIds.has(edge.from_atom_id) || atomIds.has(edge.to_atom_id));
      const usedBlobIds = new Set(records.map((record) => record.blob_id));
      const sessionBlobs = blobs.filter((blob) => usedBlobIds.has(blob.id));
      const sessionLossAudits = dedupeById(fileLossAudits.filter((audit) =>
        audit.session_ref === sessionRef ||
        (audit.record_ref !== undefined && recordIds.has(audit.record_ref)) ||
        (audit.fragment_ref !== undefined && fragmentIds.has(audit.fragment_ref)) ||
        (audit.atom_ref !== undefined && atomIds.has(audit.atom_ref)) ||
        (audit.blob_ref !== undefined && usedBlobIds.has(audit.blob_ref)),
      ));
      for (const audit of sessionLossAudits) {
        sessionLossAuditIds.add(audit.id);
      }
      const draft = backfillReusableSessionResumeFields(
        previousPayload.source.platform,
        originPath,
        {
          id: sessionRef,
          source_id: previousPayload.source.id,
          source_platform: previousPayload.source.platform,
          host_id: session?.host_id ?? previousPayload.source.host_id,
          title: session?.title,
          created_at: minAtomTime(atoms) ?? session?.created_at,
          updated_at: maxAtomTime(atoms) ?? session?.updated_at,
          model: session?.model,
          working_directory: session?.working_directory,
          source_native_project_ref: session?.source_native_project_ref,
          source_session_id: session?.source_session_id,
          resume_command: session?.resume_command,
          resume_working_directory: session?.resume_working_directory,
          resume_command_confidence: session?.resume_command_confidence,
          last_cumulative_token_usage: findLastCumulativeTokenUsage(fragments),
        },
      );
      sessionInputs.push({
        draft,
        blobs: sessionBlobs,
        records,
        fragments,
        atoms,
        edges,
        loss_audits: sessionLossAudits,
      });
    }
    const recordBlobIds = new Set(fileRecords.map((record) => record.blob_id));
    byOriginPath.set(originPath, {
      originPath,
      blobs,
      tailBlob: blobs.reduce<CapturedBlob | undefined>(
        (current, blob) => !current || blob.size_bytes > current.size_bytes ? blob : current,
        undefined,
      ),
      sessionInputs,
      orphanBlobs: blobs.filter((blob) => !recordBlobIds.has(blob.id)),
      lossAudits: dedupeById(fileLossAudits.filter((audit) => !sessionLossAuditIds.has(audit.id))),
    });
  }

  return {
    byOriginPath,
    metadataOnly:
      previousPayload.records.length === 0 &&
      previousPayload.fragments.length === 0 &&
      previousPayload.atoms.length === 0 &&
      previousPayload.edges.length === 0 &&
      previousPayload.sessions.length === 0,
  };
}

function previousPayloadMatchesProfile(payload: SourceSyncPayload, sourceFormatProfile: SourceFormatProfile): boolean {
  return payload.stage_runs.some((stageRun) =>
    stageRun.parser_version === sourceFormatProfile.parser_version &&
    stageRun.source_format_profile_ids?.includes(sourceFormatProfile.id),
  );
}

function isIncrementalJsonlPlatform(platform: SourcePlatform): boolean {
  return platform === "codex" || platform === "claude_code";
}

function canReuseCapturedBlob(previousEntry: PreviousFileEntry, capturedBlob: CapturedBlob): boolean {
  return previousEntry.tailBlob?.size_bytes === capturedBlob.size_bytes &&
    previousEntry.tailBlob.file_modified_at === capturedBlob.file_modified_at &&
    previousEntry.tailBlob.checksum === capturedBlob.checksum;
}

function canReuseBlobFromStats(previousEntry: PreviousFileEntry, stats: { size: number; mtime: Date; ctime: Date }): boolean {
  return previousEntry.tailBlob?.size_bytes === stats.size &&
    previousEntry.tailBlob.file_modified_at === stats.mtime.toISOString() &&
    previousEntry.tailBlob.file_identity_stable === true &&
    previousEntry.tailBlob.file_changed_at !== undefined &&
    previousEntry.tailBlob.file_changed_at === stats.ctime.toISOString();
}

function processAppendedJsonlBlob(
  source: SourceDefinition,
  sourceFormatProfile: SourceFormatProfile,
  filePath: string,
  capturedBlob: CapturedBlobInput,
  previousEntry: PreviousFileEntry,
): AdapterBlobResult[] | undefined {
  if (!isIncrementalJsonlPlatform(source.platform) || previousEntry.sessionInputs.length !== 1 || !previousEntry.tailBlob) {
    return undefined;
  }
  const previousTail = previousEntry.tailBlob;
  if (
    capturedBlob.blob.size_bytes <= previousTail.size_bytes ||
    capturedBlob.blob.file_modified_at === previousTail.file_modified_at
  ) {
    return undefined;
  }
  const previousPrefix = capturedBlob.fileBuffer.subarray(0, previousTail.size_bytes);
  if (sha1(previousPrefix) !== previousTail.checksum) {
    return undefined;
  }
  const appendedBuffer = capturedBlob.fileBuffer.subarray(previousTail.size_bytes);
  if (!isJsonlAppendBoundary(previousPrefix, appendedBuffer)) {
    return undefined;
  }

  const previousInput = previousEntry.sessionInputs[0]!;
  if (hasPreviousJsonParseFailure(previousInput)) {
    return undefined;
  }
  const sessionId = previousInput.draft.id;
  const baseOrdinal = previousInput.records.reduce((max, record) => Math.max(max, record.ordinal), -1) + 1;
  const appendedRecords = collectJsonlRecordsFromText({
    text: appendedBuffer.toString("utf8"),
    sourceId: source.id,
    sessionId,
    blobId: capturedBlob.blob.id,
    baseOrdinal,
  });
  if (appendedRecords.length === 0) {
    return undefined;
  }

  const context = {
    source,
    hostId: capturedBlob.blob.host_id,
    filePath,
    profileId: sourceFormatProfile.id,
    sessionId,
    captureRunId: capturedBlob.blob.capture_run_id,
  };
  const draft: SessionDraft = {
    ...previousInput.draft,
    updated_at: undefined,
    last_cumulative_token_usage: findLastCumulativeTokenUsage(previousInput.fragments),
    source_session_id:
      previousInput.draft.source_session_id ??
      extractSourceSessionIdFromCanonicalSessionId(source.platform, sessionId),
  };
  const appendedFragments: SourceFragment[] = [];
  const appendedLossAudits: LossAuditRecord[] = [];
  for (const record of appendedRecords) {
    const parsed = parseRecord(context, record, draft);
    appendedFragments.push(...parsed.fragments);
    appendedLossAudits.push(...parsed.lossAudits);
  }

  const fragments = [...previousInput.fragments, ...appendedFragments];
  const atomized = atomizeFragments(source.id, sessionId, sourceFormatProfile.id, fragments);
  hydrateDraftFromAtoms(draft, atomized.atoms, capturedBlob.blob.file_modified_at);
  const backfilledDraft = backfillReusableSessionResumeFields(source.platform, filePath, draft);

  return [{
    draft: backfilledDraft,
    blobs: [...previousInput.blobs, capturedBlob.blob],
    records: [...previousInput.records, ...appendedRecords],
    fragments,
    atoms: atomized.atoms,
    edges: atomized.edges,
    loss_audits: [...previousInput.loss_audits, ...appendedLossAudits],
  }];
}

function isJsonlAppendBoundary(previousPrefix: Buffer, appendedBuffer: Buffer): boolean {
  if (previousPrefix.length === 0 || appendedBuffer.length === 0) {
    return true;
  }
  const previousLast = previousPrefix[previousPrefix.length - 1];
  const appendedFirst = appendedBuffer[0];
  return previousLast === 10 || previousLast === 13 || appendedFirst === 10 || appendedFirst === 13;
}

function collectJsonlRecordsFromText(input: {
  text: string;
  sourceId: string;
  sessionId: string;
  blobId: string;
  baseOrdinal: number;
}): RawRecord[] {
  const records: RawRecord[] = [];
  let start = 0;
  let ordinal = input.baseOrdinal;
  for (let index = 0; index <= input.text.length; index += 1) {
    const isEnd = index === input.text.length;
    const charCode = isEnd ? -1 : input.text.charCodeAt(index);
    if (!isEnd && charCode !== 10 && charCode !== 13) {
      continue;
    }
    const line = input.text.slice(start, index).trim();
    if (line) {
      records.push({
        id: stableId("record", input.sourceId, input.sessionId, input.blobId, String(ordinal), `${ordinal}`),
        source_id: input.sourceId,
        blob_id: input.blobId,
        session_ref: input.sessionId,
        ordinal,
        record_path_or_offset: `${ordinal}`,
        observed_at: nowIso(),
        parseable: true,
        raw_json: line,
      });
      ordinal += 1;
    }
    if (charCode === 13 && index + 1 < input.text.length && input.text.charCodeAt(index + 1) === 10) {
      index += 1;
    }
    start = index + 1;
  }
  return records;
}

function hasPreviousJsonParseFailure(previousInput: SessionBuildInput): boolean {
  return previousInput.loss_audits.some((audit) => audit.diagnostic_code === "record_json_parse_failed");
}

function minAtomTime(atoms: readonly ConversationAtom[]): string | undefined {
  return atoms.reduce<string | undefined>((current, atom) => minIso(current, atom.time_key), undefined);
}

function maxAtomTime(atoms: readonly ConversationAtom[]): string | undefined {
  return atoms.reduce<string | undefined>((current, atom) => maxIso(current, atom.time_key), undefined);
}

function findLastCumulativeTokenUsage(fragments: readonly SourceFragment[]): SessionDraft["last_cumulative_token_usage"] {
  for (let index = fragments.length - 1; index >= 0; index -= 1) {
    const usage = fragments[index]?.payload.cumulative_token_usage;
    if (isObject(usage)) {
      return extractTokenUsage(usage);
    }
  }
  return undefined;
}

function groupBy<T>(items: readonly T[], keyFor: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    pushGrouped(grouped, keyFor(item), item);
  }
  return grouped;
}

function groupPresent<T>(items: readonly T[], keyFor: (item: T) => string | undefined): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    if (key !== undefined) {
      pushGrouped(grouped, key, item);
    }
  }
  return grouped;
}

function pushGrouped<T>(grouped: Map<string, T[]>, key: string, item: T): void {
  const group = grouped.get(key) ?? [];
  group.push(item);
  grouped.set(key, group);
}

function parseChangedSinceMs(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const relative = value.trim().match(/^(\d+)(m|h|d|w)$/iu);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2]!.toLowerCase();
    const multiplier =
      unit === "m" ? 60 * 1000 :
      unit === "h" ? 60 * 60 * 1000 :
      unit === "d" ? 24 * 60 * 60 * 1000 :
      7 * 24 * 60 * 60 * 1000;
    return Date.now() - amount * multiplier;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

async function processCollectedSessions(
  sessionsById: ReadonlyMap<string, SessionBuildInput>,
  orphanBlobs: readonly CapturedBlob[],
  sourceLossAudits: readonly LossAuditRecord[],
  options: { safeMode: boolean },
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
    if (sessionInput.draft.source_platform === "antigravity") {
      sessionInput.atoms = collapseAntigravityUserTurnAtoms(sessionInput.atoms);
    }

    const gitProjectEvidence = options.safeMode
      ? undefined
      : await readGitProjectEvidence(sessionInput.draft.working_directory);
    const sessionProjectCandidates = buildProjectObservationCandidates(
      sessionInput.draft,
      sessionInput.atoms,
      gitProjectEvidence,
    );
    const submissionResult = buildSubmissionGroups(sessionInput.draft, sessionInput.atoms, sessionInput.edges);
    const turnResult = buildTurnsAndContext(
      sessionInput.draft,
      sessionInput.fragments,
      sessionInput.records,
      sessionInput.blobs,
      sessionInput.atoms,
      submissionResult.groups,
      submissionResult.edges,
    );

    const suppressEmptySession =
      sessionInput.draft.source_platform === "codebuddy" &&
      turnResult.turns.length === 0 &&
      sessionInput.atoms.length === 0;

    blobs.push(...sessionInput.blobs);
    records.push(...sessionInput.records);
    fragments.push(...sessionInput.fragments);
    atoms.push(...sessionInput.atoms);
    edges.push(...sessionInput.edges, ...submissionResult.edges);
    if (!suppressEmptySession) {
      candidates.push(
        ...sessionProjectCandidates,
        ...submissionResult.groups,
        ...turnResult.turnCandidates,
        ...turnResult.contextCandidates,
      );
      sessions.push(turnResult.session);
      turns.push(...turnResult.turns);
      contexts.push(...turnResult.contexts);
    }
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

function emitProbeProgress(
  options: ProbeOptions,
  source: SourceDefinition,
  event: Omit<SourceProbeProgressEvent, "source_id" | "slot_id" | "platform" | "display_name">,
): void {
  options.on_progress?.({
    source_id: source.id,
    slot_id: source.slot_id,
    platform: source.platform,
    display_name: source.display_name,
    ...event,
  });
}

async function getFileSize(filePath: string): Promise<number> {
  return (await stat(filePath)).size;
}

async function processBlob(
  source: SourceDefinition,
  sourceFormatProfile: SourceFormatProfile,
  filePath: string,
  capturedBlob: CapturedBlobInput,
): Promise<AdapterBlobResult[]> {
  const { blob, fileBuffer } = capturedBlob;
  const blobId = blob.id;

  if (source.platform === "cursor" && path.basename(filePath) === "store.db") {
    const chatStoreSeed = await extractCursorChatStoreSeed(source.platform, filePath, blob.file_modified_at ?? nowIso(), {
      asString,
      asNumber,
      asArray,
      isObject,
      safeJsonParse,
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
    if (chatStoreSeed) {
      const records = chatStoreSeed.seed.records.map((record, ordinal) => ({
        id: stableId("record", source.id, chatStoreSeed.seed.sessionId, blobId, String(ordinal), record.pointer),
        source_id: source.id,
        blob_id: blobId,
        session_ref: chatStoreSeed.seed.sessionId,
        ordinal,
        record_path_or_offset: record.pointer,
        observed_at: record.observedAt ?? nowIso(),
        parseable: true,
        raw_json: record.rawJson,
      }));
      const initialLossAudits = chatStoreSeed.diagnostics.map((diagnostic) =>
        createLossAudit(source.id, blobId, "dropped_for_projection", diagnostic.detail, {
          stageKind: "extract_records",
          diagnosticCode: diagnostic.code,
          severity: diagnostic.severity,
          sessionRef: chatStoreSeed.seed.sessionId,
          blobRef: blobId,
          sourceFormatProfileId: sourceFormatProfile.id,
        }),
      );
      return [
        buildAdapterBlobResult(
          source,
          sourceFormatProfile,
          blob.host_id,
          filePath,
          blob.capture_run_id,
          blob,
          chatStoreSeed.seed.sessionId,
          records,
          {
            title: chatStoreSeed.seed.title,
            created_at: chatStoreSeed.seed.createdAt,
            updated_at: chatStoreSeed.seed.updatedAt,
            model: chatStoreSeed.seed.model,
            working_directory: chatStoreSeed.seed.workingDirectory,
          },
          initialLossAudits,
        ),
      ];
    }
  }

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
  const context = {
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

function buildSyntheticSeedAdapterResult(
  source: SourceDefinition,
  sourceFormatProfile: SourceFormatProfile,
  hostId: string,
  captureRunId: string,
  originPath: string,
  seed: ExtractedSessionSeed,
): AdapterBlobResult {
  const serializedSeed = JSON.stringify(seed.records);
  const fileBuffer = Buffer.from(serializedSeed, "utf8");
  const checksum = sha1(fileBuffer);
  const capturedAt = nowIso();
  const blob: CapturedBlob = {
    id: stableId("blob", source.id, originPath, checksum),
    source_id: source.id,
    host_id: hostId,
    origin_path: originPath,
    checksum,
    size_bytes: fileBuffer.length,
    captured_at: capturedAt,
    capture_run_id: captureRunId,
    file_modified_at: seed.updatedAt ?? seed.createdAt ?? capturedAt,
  };

  const records = seed.records.map((record, ordinal) => ({
    id: stableId("record", source.id, seed.sessionId, blob.id, String(ordinal), record.pointer),
    source_id: source.id,
    blob_id: blob.id,
    session_ref: seed.sessionId,
    ordinal,
    record_path_or_offset: record.pointer,
    observed_at: record.observedAt ?? nowIso(),
    parseable: true,
    raw_json: record.rawJson,
  }));

  return buildAdapterBlobResult(
    source,
    sourceFormatProfile,
    hostId,
    originPath,
    captureRunId,
    blob,
    seed.sessionId,
    records,
    {
      title: seed.title,
      created_at: seed.createdAt,
      updated_at: seed.updatedAt,
      model: seed.model,
      working_directory: seed.workingDirectory,
    },
  );
}
