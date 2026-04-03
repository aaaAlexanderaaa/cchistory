import os from "node:os";
import path from "node:path";
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
} from "./types.js";
import { asArray, asNumber, asString, coerceIso, epochMillisToIso, isObject, normalizeStopReason, safeJsonParse, extractTokenUsage, firstDefinedNumber, truncate, normalizeWorkspacePath } from "./utils.js";

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

  const collectionCore = await collectSourceInputs(source, host, sourceFormatProfile, limitFilesPerSource, startedAt);
  const processingCore = await processCollectedSessions(
    collectionCore.sessionsById,
    collectionCore.orphanBlobs,
    collectionCore.sourceLossAudits,
  );
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
  const captureRunId = stableId("capture-run", source.id, startedAt);
  const adapter = getPlatformAdapter(source.platform);
  const sessionsById = new Map<string, SessionBuildInput>();
  const orphanBlobs: CapturedBlob[] = [];
  const companionFiles: string[] = [];
  const capturedCompanionPaths = new Set<string>();
  const sourceLossAudits: LossAuditRecord[] = [];
  const fileProcessingErrors: string[] = [];
  const liveFiles: string[] = [];
  let remainingFileLimit = limitFilesPerSource;

  if (source.platform === "antigravity") {
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
  }

  const files = await listSourceFiles(source.platform, source.base_dir, remainingFileLimit);

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
      if (adapter?.getCompanionEvidencePaths) {
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
    if (sessionInput.draft.source_platform === "antigravity") {
      sessionInput.atoms = collapseAntigravityUserTurnAtoms(sessionInput.atoms);
    }

    const gitProjectEvidence = await readGitProjectEvidence(sessionInput.draft.working_directory);
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
