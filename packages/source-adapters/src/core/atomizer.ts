import path from "node:path";
import type {
  ActorKind,
  AtomEdge,
  ConversationAtom,
  DisplayPolicy,
  OriginKind,
  SourceDefinition,
  SourceFragment,
} from "@cchistory/domain";
import type { SessionDraft } from "./types.js";
import {
  asString,
  compareFragments,
  createEdge,
  nowIso,
  stableId,
  truncate,
  normalizeWorkspacePath,
} from "./utils.js";

export function atomizeFragments(
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

export function fragmentToAtom(
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

export function hydrateDraftFromAtoms(draft: SessionDraft, atoms: ConversationAtom[], fileModifiedAt?: string): void {
  const firstAtom = atoms[0];
  const lastAtom = atoms.at(-1);
  draft.created_at = draft.created_at ?? firstAtom?.time_key ?? nowIso();
  draft.updated_at = draft.updated_at ?? lastAtom?.time_key ?? draft.created_at;
  if (draft.updated_at === draft.created_at && fileModifiedAt && fileModifiedAt > draft.created_at) {
    draft.updated_at = fileModifiedAt;
  }
  for (const atom of atoms) {
    if (atom.content_kind === "meta_signal" && atom.payload.signal_kind === "workspace_signal") {
      draft.working_directory = (atom.payload.path as string | undefined) ?? draft.working_directory;
    }
    if (atom.content_kind === "meta_signal" && atom.payload.signal_kind === "model_signal") {
      draft.model = (atom.payload.model as string | undefined) ?? draft.model;
    }
    if (!draft.title && atom.actor_kind === "user" && atom.origin_kind === "user_authored") {
      const text = asString(atom.payload.text);
      const titleCandidate = normalizeSessionTitleCandidate(text);
      draft.title = titleCandidate ? truncate(titleCandidate, 72) : draft.title;
    }
  }
}

export function normalizeSessionTitleCandidate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const stripped = value
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/giu, " ")
    .replace(/<command-(?:name|message|args)>[\s\S]*?<\/command-(?:name|message|args)>/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  return stripped || undefined;
}

export function deriveSourceNativeProjectRef(source: SourceDefinition, filePath: string): string | undefined {
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
    const chatStoreMatch = normalizedFilePath.match(/\/\.cursor\/chats\/([^/]+)\/[^/]+\/store\.db$/u);
    if (chatStoreMatch) {
      return chatStoreMatch[1];
    }
    const transcriptIndex = parts.indexOf("agent-transcripts");
    if (transcriptIndex > 0) {
      return parts[transcriptIndex - 1];
    }
  }

  if (source.platform === "antigravity" && parts[0] === "brain" && parts.length >= 3) {
    return parts[1];
  }
  if (source.platform === "codebuddy" && parts[0] === "projects" && parts.length >= 3) {
    return parts[1];
  }

  return undefined;
}
