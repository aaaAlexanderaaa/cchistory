import type {
  ActorKind,
  AtomEdge,
  ConversationAtom,
  OriginKind,
  RawRecord,
  SourceFragment,
  LossAuditRecord,
} from "@cchistory/domain";
import { stableId, nowIso } from "@cchistory/domain";
import type { FragmentBuildContext, LossAuditOptions } from "./types.js";
import { buildStageRunId } from "./source-identity.js";

export function createFragment(
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

export function createEdge(
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

export function createLossAudit(
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

export function mapRoleToActor(role: string): ActorKind {
  if (role === "user" || role === "human") {
    return "user";
  }
  if (role === "developer" || role === "system") {
    return "system";
  }
  return "assistant";
}

export function isUserTurnAtom(atom: ConversationAtom): boolean {
  return (
    atom.actor_kind === "user" &&
    atom.content_kind === "text" &&
    (atom.origin_kind === "user_authored" || atom.origin_kind === "injected_user_shaped")
  );
}
