import path from "node:path";
import type {
  CapturedBlob,
  DerivedCandidate,
  SessionProjection,
  SourceStatus,
  UserTurnProjection,
} from "@cchistory/domain";
import { normalizeLocalPathIdentity } from "@cchistory/domain";
import { stableId, uniqueStrings } from "../internal/utils.js";

const FALLBACK_LINKER_RULE_VERSION = "storage-linker-fallback@2026-03-13.1";

export function buildFallbackProjectObservationCandidates(input: {
  sessions: readonly SessionProjection[];
  turns: readonly UserTurnProjection[];
  candidates: readonly DerivedCandidate[];
  sources: readonly SourceStatus[];
  selectBlobsByIds: (ids: string[]) => CapturedBlob[];
}): DerivedCandidate[] {
  const sessionsWithProjectObservation = new Set(
    input.candidates
      .filter((candidate) => candidate.candidate_kind === "project_observation")
      .map((candidate) => candidate.session_ref),
  );
  const turnSessionIds = new Set(input.turns.map((turn) => turn.session_id));
  const sourcesById = new Map(input.sources.map((source) => [source.id, source]));
  const fallbackSessionIds = input.sessions
    .filter((session) => turnSessionIds.has(session.id) && !sessionsWithProjectObservation.has(session.id))
    .map((session) => session.id);
  const blobOriginsBySession = listBlobOriginsBySession({
    sessionIds: fallbackSessionIds,
    turns: input.turns,
    selectBlobsByIds: input.selectBlobsByIds,
  });
  const fallbackCandidates: DerivedCandidate[] = [];

  for (const session of input.sessions) {
    if (!turnSessionIds.has(session.id) || sessionsWithProjectObservation.has(session.id)) {
      continue;
    }

    const source = sourcesById.get(session.source_id);
    const workspacePathNormalized = normalizePathKey(session.working_directory);
    const sourceNativeProjectRef =
      session.source_native_project_ref ??
      deriveSourceNativeProjectRefFromBlobOrigins(
        session.source_platform,
        source?.base_dir,
        blobOriginsBySession.get(session.id) ?? [],
      );

    if (!workspacePathNormalized && !sourceNativeProjectRef) {
      continue;
    }

    const observedAt = session.updated_at ?? session.created_at;
    fallbackCandidates.push({
      id: stableId(
        "candidate",
        "project_observation_fallback",
        session.source_id,
        session.id,
        workspacePathNormalized ?? sourceNativeProjectRef ?? "session",
      ),
      source_id: session.source_id,
      session_ref: session.id,
      candidate_kind: "project_observation",
      input_atom_refs: [],
      started_at: observedAt,
      ended_at: observedAt,
      rule_version: FALLBACK_LINKER_RULE_VERSION,
      evidence: {
        workspace_path: session.working_directory,
        workspace_path_normalized: workspacePathNormalized,
        source_native_project_ref: sourceNativeProjectRef,
        confidence: workspacePathNormalized ? 0.5 : 0.35,
        reason: workspacePathNormalized ? "session_workspace_fallback" : "blob_origin_project_ref_fallback",
        debug_summary: workspacePathNormalized
          ? "Synthetic project observation derived from persisted session workspace metadata."
          : "Synthetic project observation derived from persisted blob origin path.",
      },
    });
  }

  return fallbackCandidates;
}

export function listBlobOriginsBySession(input: {
  sessionIds: readonly string[];
  turns: readonly UserTurnProjection[];
  selectBlobsByIds: (ids: string[]) => CapturedBlob[];
}): Map<string, string[]> {
  if (input.sessionIds.length === 0) {
    return new Map();
  }

  const targetSessionIds = new Set(input.sessionIds);
  const blobIds = uniqueStrings(
    input.turns
      .filter((turn) => targetSessionIds.has(turn.session_id))
      .flatMap((turn) => turn.lineage.blob_refs),
  );
  const blobsById = new Map(input.selectBlobsByIds(blobIds).map((blob) => [blob.id, blob]));
  const blobOriginsBySession = new Map<string, Set<string>>();

  for (const turn of input.turns) {
    if (!targetSessionIds.has(turn.session_id)) {
      continue;
    }
    const origins = blobOriginsBySession.get(turn.session_id) ?? new Set<string>();
    for (const blobId of turn.lineage.blob_refs) {
      const originPath = blobsById.get(blobId)?.origin_path;
      if (originPath) {
        origins.add(originPath);
      }
    }
    if (origins.size > 0) {
      blobOriginsBySession.set(turn.session_id, origins);
    }
  }

  return new Map(
    [...blobOriginsBySession.entries()].map(([sessionId, origins]) => [sessionId, [...origins].sort()]),
  );
}

function deriveSourceNativeProjectRefFromBlobOrigins(
  platform: SessionProjection["source_platform"],
  baseDir: string | undefined,
  originPaths: readonly string[],
): string | undefined {
  if (!baseDir || originPaths.length === 0) {
    return undefined;
  }

  const refs = uniqueStrings(
    originPaths
      .map((originPath) => deriveSourceNativeProjectRefFromOrigin(platform, baseDir, originPath))
      .filter((ref): ref is string => Boolean(ref)),
  );
  return refs.length === 1 ? refs[0] : undefined;
}

function deriveSourceNativeProjectRefFromOrigin(
  platform: SessionProjection["source_platform"],
  baseDir: string,
  originPath: string,
): string | undefined {
  const normalizedBaseDir = normalizePathKey(baseDir);
  const normalizedOriginPath = normalizePathKey(originPath);
  if (!normalizedBaseDir || !normalizedOriginPath) {
    return undefined;
  }

  const relativePath = path.posix.relative(normalizedBaseDir, normalizedOriginPath);
  if (!relativePath || relativePath.startsWith("..")) {
    return undefined;
  }

  const parts = relativePath.split("/").filter(Boolean);
  if (platform === "cursor") {
    const transcriptIndex = parts.indexOf("agent-transcripts");
    if (transcriptIndex > 0) {
      return parts[transcriptIndex - 1];
    }
  }

  if (platform === "antigravity" && parts[0] === "brain" && parts.length >= 3) {
    return parts[1];
  }

  return undefined;
}

function normalizePathKey(value: string | undefined): string | undefined {
  return normalizeLocalPathIdentity(value);
}
