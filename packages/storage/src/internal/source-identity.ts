import type {
  CapturedBlob,
  ConversationAtom,
  DerivedCandidate,
  LossAuditRecord,
  RawRecord,
  SessionProjection,
  SourceFragment,
  SourceStatus,
  SourceSyncPayload,
  StageRun,
  TurnContextProjection,
  UserTurnProjection,
} from "@cchistory/domain";
import {
  deriveSourceInstanceId,
  deriveSourceSlotId,
  isLegacySourceInstanceId,
  normalizeSourceBaseDir,
} from "@cchistory/domain";

export function hydrateSourceStatus(source: SourceStatus): SourceStatus {
  return {
    ...source,
    slot_id: source.slot_id || deriveSourceSlotId(source.platform),
  };
}

export function normalizeSourceStatus(source: SourceStatus): SourceStatus {
  const hydratedSource = hydrateSourceStatus(source);
  const slotId = hydratedSource.slot_id;
  const nextId =
    hydratedSource.id && !isLegacySourceInstanceId(hydratedSource.id)
      ? hydratedSource.id
      : deriveSourceInstanceId({
          host_id: hydratedSource.host_id,
          slot_id: slotId,
          base_dir: hydratedSource.base_dir,
        });

  return {
    ...hydratedSource,
    id: nextId,
  };
}

export function normalizeSourcePayload(payload: SourceSyncPayload): SourceSyncPayload {
  const source = normalizeSourceStatus(payload.source);
  const sourceId = source.id;

  if (sourceId === payload.source.id && source.slot_id === payload.source.slot_id) {
    return {
      ...payload,
      source,
    };
  }

  return {
    source,
    stage_runs: payload.stage_runs.map((stageRun) => updateSourceScopedEntry(stageRun, sourceId)),
    loss_audits: payload.loss_audits.map((lossAudit) => updateSourceScopedEntry(lossAudit, sourceId)),
    blobs: payload.blobs.map((blob) => updateSourceScopedEntry(blob, sourceId)),
    records: payload.records.map((record) => updateSourceScopedEntry(record, sourceId)),
    fragments: payload.fragments.map((fragment) => updateSourceScopedEntry(fragment, sourceId)),
    atoms: payload.atoms.map((atom) => updateSourceScopedEntry(atom, sourceId)),
    edges: payload.edges.map((edge) => updateSourceScopedEntry(edge, sourceId)),
    candidates: payload.candidates.map((candidate) => updateSourceScopedEntry(candidate, sourceId)),
    sessions: payload.sessions.map((session) => updateSourceScopedEntry(session, sourceId)),
    turns: payload.turns.map((turn) => updateSourceScopedEntry(turn, sourceId)),
    contexts: payload.contexts,
  };
}

export function matchesSourceIdentity(
  left: Pick<SourceStatus, "host_id" | "platform" | "base_dir" | "slot_id">,
  right: Pick<SourceStatus, "host_id" | "platform" | "base_dir" | "slot_id">,
): boolean {
  const normalizedLeft = deriveComparableSourceIdentity(left);
  const normalizedRight = deriveComparableSourceIdentity(right);
  return (
    normalizedLeft.host_id === normalizedRight.host_id &&
    normalizedLeft.slot_id === normalizedRight.slot_id &&
    normalizedLeft.platform === normalizedRight.platform &&
    normalizedLeft.base_dir === normalizedRight.base_dir
  );
}

export function matchesReplaceableSourceIdentity(
  left: Pick<SourceStatus, "id" | "host_id" | "platform" | "base_dir" | "slot_id">,
  right: Pick<SourceStatus, "id" | "host_id" | "platform" | "base_dir" | "slot_id">,
  options: { allowHostRekey: boolean },
): boolean {
  if (matchesSourceIdentity(left, right)) {
    return true;
  }

  if (!options.allowHostRekey && !isLegacySourceInstanceId(left.id) && !isLegacySourceInstanceId(right.id)) {
    return false;
  }

  const normalizedLeft = deriveComparableSourceIdentity(left);
  const normalizedRight = deriveComparableSourceIdentity(right);
  return (
    normalizedLeft.slot_id === normalizedRight.slot_id &&
    normalizedLeft.platform === normalizedRight.platform &&
    normalizedLeft.base_dir === normalizedRight.base_dir
  );
}

function deriveComparableSourceIdentity(source: Pick<SourceStatus, "host_id" | "platform" | "base_dir" | "slot_id">) {
  return {
    host_id: source.host_id,
    platform: source.platform,
    slot_id: source.slot_id || deriveSourceSlotId(source.platform),
    base_dir: normalizeSourceBaseDir(source.base_dir),
  };
}

function updateSourceScopedEntry<T extends { source_id: string }>(entry: T, sourceId: string): T {
  return {
    ...entry,
    source_id: sourceId,
  };
}
