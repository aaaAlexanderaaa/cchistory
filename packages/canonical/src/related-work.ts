import type {
  SessionProjection,
  SessionRelatedWorkProjection,
  SourceFragment,
} from "@cchistory/domain";
import { asOptionalString, compositeKey, uniqueStrings } from "./utils.js";

interface SessionRelationEdge {
  relationKind: SessionRelatedWorkProjection["relation_kind"];
  evidenceSession: SessionProjection;
  parentSession?: SessionProjection;
  childSession?: SessionProjection;
  parentRef?: string;
  childRef?: string;
  parentToolRef?: string;
  childAgentKey?: string;
  sessionKey?: string;
  jobId?: string;
  fragment: SourceFragment;
  payload: Record<string, unknown>;
}

export function buildSessionRelatedWorkIndex(
  sessions: readonly SessionProjection[],
  fragments: readonly SourceFragment[],
): Map<string, SessionRelatedWorkProjection[]> {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const sessionsByAlias = buildSessionsByAlias(sessions);
  const groupedBySession = new Map<string, Map<string, SessionRelatedWorkProjection>>();

  for (const fragment of fragments) {
    if (fragment.fragment_kind !== "session_relation") continue;
    const evidenceSession = sessionsById.get(fragment.session_ref);
    if (!evidenceSession) continue;
    const payload = fragment.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
    const edge = buildSessionRelationEdge(evidenceSession, fragment, payload, sessionsByAlias);
    if (!edge) continue;

    if (edge.relationKind === "delegated_session") {
      if (edge.childSession) {
        mergeSessionRelatedWork(
          groupedBySession,
          edge.childSession.id,
          buildDelegatedRelatedWorkEntry(edge.childSession, edge, "inbound"),
        );
      }
      if (edge.parentSession && (!edge.childSession || edge.parentSession.id !== edge.childSession.id)) {
        mergeSessionRelatedWork(
          groupedBySession,
          edge.parentSession.id,
          buildDelegatedRelatedWorkEntry(edge.parentSession, edge, "outbound"),
        );
      }
      continue;
    }

    mergeSessionRelatedWork(
      groupedBySession,
      edge.evidenceSession.id,
      buildAutomationRelatedWorkEntry(edge.evidenceSession, edge, "self"),
    );
    if (edge.parentSession && edge.parentSession.id !== edge.evidenceSession.id) {
      mergeSessionRelatedWork(
        groupedBySession,
        edge.parentSession.id,
        buildAutomationRelatedWorkEntry(edge.parentSession, edge, "outbound"),
      );
    }
  }

  const index = new Map<string, SessionRelatedWorkProjection[]>();
  for (const [sessionId, grouped] of groupedBySession) {
    index.set(
      sessionId,
      [...grouped.values()].sort(
        (left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id),
      ),
    );
  }
  return index;
}

export function listSessionRelatedWork(
  sessions: readonly SessionProjection[],
  fragments: readonly SourceFragment[],
): SessionRelatedWorkProjection[] {
  return [...buildSessionRelatedWorkIndex(sessions, fragments).values()].flat();
}

function buildSessionRelationEdge(
  evidenceSession: SessionProjection,
  fragment: SourceFragment,
  payload: Record<string, unknown>,
  sessionsByAlias: Map<string, SessionProjection[]>,
): SessionRelationEdge | undefined {
  const relationKind = normalizeRelatedWorkKind(payload);
  if (!relationKind) return undefined;
  const parentRef = relationParentRef(payload);
  const childRef = relationChildRef(payload);
  const parentSession = parentRef ? resolveRelatedSession(parentRef, evidenceSession, sessionsByAlias) : undefined;
  const childSession = childRef
    ? resolveRelatedSession(childRef, evidenceSession, sessionsByAlias) ?? evidenceSession
    : relationKind === "delegated_session"
      ? evidenceSession
      : undefined;

  return {
    relationKind,
    evidenceSession,
    parentSession,
    childSession,
    parentRef,
    childRef: childRef ?? childSession?.id,
    parentToolRef:
      asOptionalString(payload.parent_tool_ref) ??
      asOptionalString(payload.callingToolUseId) ??
      asOptionalString(payload.calling_tool_use_id),
    childAgentKey:
      asOptionalString(payload.agent_id) ??
      asOptionalString(payload.agentId) ??
      asOptionalString(payload.childAgentKey) ??
      asOptionalString(payload.child_agent_key),
    sessionKey: asOptionalString(payload.session_key),
    jobId: asOptionalString(payload.job_id),
    fragment,
    payload,
  };
}

function buildDelegatedRelatedWorkEntry(
  querySession: SessionProjection,
  edge: SessionRelationEdge,
  direction: SessionRelatedWorkProjection["direction"],
): SessionRelatedWorkProjection {
  const parentSessionRef = edge.parentSession?.id ?? edge.parentRef;
  const childSessionRef = edge.childSession?.id ?? edge.childRef ?? edge.evidenceSession.id;
  const targetSession = direction === "outbound" ? edge.childSession : edge.parentSession;
  const targetSessionRef = direction === "outbound" ? childSessionRef : parentSessionRef;
  const key = `delegated:${parentSessionRef ?? "unknown-parent"}:${childSessionRef ?? "unknown-child"}:${edge.childAgentKey ?? ""}:${direction}`;
  return {
    id: compositeKey("session-related-work", querySession.id, key),
    query_session_ref: querySession.id,
    source_id: edge.evidenceSession.source_id,
    source_platform: edge.evidenceSession.source_platform,
    source_session_ref: edge.evidenceSession.id,
    evidence_session_ref: edge.evidenceSession.id,
    parent_session_ref: parentSessionRef,
    child_session_ref: childSessionRef,
    relation_kind: "delegated_session",
    target_kind: "session",
    direction,
    target_session_ref: targetSessionRef,
    transcript_primary: true,
    evidence_confidence: isStrictlyTrue(edge.payload.is_sidechain) ? 0.95 : 0.8,
    parent_event_ref: parentSessionRef,
    parent_tool_ref: edge.parentToolRef,
    child_agent_key: edge.childAgentKey,
    title: targetSession?.title,
    status: asOptionalString(edge.payload.status),
    created_at: edge.fragment.time_key,
    updated_at: edge.fragment.time_key,
    fragment_refs: [edge.fragment.id],
    raw_detail: {
      ...edge.payload,
      direction,
      evidence_session_ref: edge.evidenceSession.id,
      parent_session_ref: parentSessionRef,
      child_session_ref: childSessionRef,
    },
  };
}

function buildAutomationRelatedWorkEntry(
  querySession: SessionProjection,
  edge: SessionRelationEdge,
  direction: SessionRelatedWorkProjection["direction"],
): SessionRelatedWorkProjection {
  const ownerSessionRef = edge.parentSession?.id ?? edge.parentRef ?? edge.evidenceSession.id;
  const targetRunRef = compositeKey(
    "automation-run",
    edge.evidenceSession.source_id,
    edge.evidenceSession.id,
    edge.jobId ?? "",
    edge.sessionKey ?? edge.fragment.id,
  );
  const key = `automation:${ownerSessionRef}:${edge.evidenceSession.id}:${edge.jobId ?? ""}:${edge.sessionKey ?? edge.fragment.id}:${direction}`;
  return {
    id: compositeKey("session-related-work", querySession.id, key),
    query_session_ref: querySession.id,
    source_id: edge.evidenceSession.source_id,
    source_platform: edge.evidenceSession.source_platform,
    source_session_ref: edge.evidenceSession.id,
    evidence_session_ref: edge.evidenceSession.id,
    automation_session_ref: edge.evidenceSession.id,
    automation_owner_session_ref: ownerSessionRef,
    relation_kind: "automation_run",
    target_kind: "automation_run",
    direction,
    target_session_ref: ownerSessionRef,
    target_run_ref: targetRunRef,
    transcript_primary: false,
    evidence_confidence: 0.95,
    parent_event_ref: ownerSessionRef,
    parent_tool_ref: edge.parentToolRef,
    automation_job_ref: edge.jobId,
    automation_run_key: edge.sessionKey,
    title: edge.evidenceSession.title,
    status: asOptionalString(edge.payload.status),
    created_at: edge.fragment.time_key,
    updated_at: edge.fragment.time_key,
    fragment_refs: [edge.fragment.id],
    raw_detail: {
      ...edge.payload,
      direction,
      evidence_session_ref: edge.evidenceSession.id,
      automation_session_ref: edge.evidenceSession.id,
      automation_owner_session_ref: ownerSessionRef,
    },
  };
}

function mergeSessionRelatedWork(
  groupedBySession: Map<string, Map<string, SessionRelatedWorkProjection>>,
  sessionId: string,
  entry: SessionRelatedWorkProjection,
): void {
  const grouped = groupedBySession.get(sessionId) ?? new Map<string, SessionRelatedWorkProjection>();
  const existing = grouped.get(entry.id);
  if (existing) {
    existing.created_at = existing.created_at <= entry.created_at ? existing.created_at : entry.created_at;
    existing.updated_at = existing.updated_at >= entry.updated_at ? existing.updated_at : entry.updated_at;
    existing.fragment_refs = uniqueStrings([...existing.fragment_refs, ...entry.fragment_refs]);
    existing.parent_tool_ref = existing.parent_tool_ref ?? entry.parent_tool_ref;
    existing.child_agent_key = existing.child_agent_key ?? entry.child_agent_key;
    existing.automation_job_ref = existing.automation_job_ref ?? entry.automation_job_ref;
    existing.automation_run_key = existing.automation_run_key ?? entry.automation_run_key;
    existing.status = entry.status ?? existing.status;
    existing.raw_detail = { ...existing.raw_detail, ...entry.raw_detail };
    return;
  }
  grouped.set(entry.id, entry);
  groupedBySession.set(sessionId, grouped);
}

function relationParentRef(payload: Record<string, unknown>): string | undefined {
  return (
    asOptionalString(payload.parent_uuid) ??
    asOptionalString(payload.callingSessionId) ??
    asOptionalString(payload.calling_session_id) ??
    asOptionalString(payload.parentId) ??
    asOptionalString(payload.parent_id)
  );
}

function relationChildRef(payload: Record<string, unknown>): string | undefined {
  return (
    asOptionalString(payload.child_session_ref) ??
    asOptionalString(payload.childSessionId) ??
    asOptionalString(payload.child_session_id) ??
    asOptionalString(payload.session_uuid) ??
    asOptionalString(payload.session_id)
  );
}

function buildSessionsByAlias(sessions: readonly SessionProjection[]): Map<string, SessionProjection[]> {
  const byAlias = new Map<string, SessionProjection[]>();
  for (const session of sessions) {
    for (const alias of sessionAliases(session)) {
      const matches = byAlias.get(alias) ?? [];
      matches.push(session);
      byAlias.set(alias, matches);
    }
  }
  return byAlias;
}

function resolveRelatedSession(
  sessionRef: string,
  evidenceSession: SessionProjection,
  sessionsByAlias: Map<string, SessionProjection[]>,
): SessionProjection | undefined {
  const matches = sessionsByAlias.get(sessionRef) ?? [];
  if (matches.length === 0) return undefined;
  const sameSource = matches.filter((session) => session.source_id === evidenceSession.source_id);
  if (sameSource.length === 1) return sameSource[0];
  const samePlatform = matches.filter((session) => session.source_platform === evidenceSession.source_platform);
  if (samePlatform.length === 1) return samePlatform[0];
  return matches.length === 1 ? matches[0] : undefined;
}

function sessionAliases(session: SessionProjection): string[] {
  const aliases = [session.id];
  if (session.source_session_id) aliases.push(session.source_session_id);
  const prefixedMatch = /^sess:[^:]+:(.+)$/u.exec(session.id);
  if (prefixedMatch?.[1]) aliases.push(prefixedMatch[1]);
  return uniqueStrings(aliases);
}

function normalizeRelatedWorkKind(
  payload: Record<string, unknown>,
): SessionRelatedWorkProjection["relation_kind"] | undefined {
  const relationKind = asOptionalString(payload.relation_kind);
  if (relationKind === "automation_run") return "automation_run";
  if (
    isStrictlyTrue(payload.is_sidechain) ||
    asOptionalString(payload.parent_uuid) ||
    asOptionalString(payload.callingSessionId) ||
    asOptionalString(payload.calling_session_id) ||
    asOptionalString(payload.parentId) ||
    asOptionalString(payload.parent_id)
  ) {
    return "delegated_session";
  }
  return undefined;
}

function isStrictlyTrue(value: unknown): boolean {
  return value === true;
}
