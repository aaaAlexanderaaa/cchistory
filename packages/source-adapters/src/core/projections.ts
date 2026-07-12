import path from "node:path";
import type {
  AtomEdge,
  CapturedBlob,
  ConversationAtom,
  DerivedCandidate,
  RawRecord,
  SourceFragment,
  SessionProjection,
  UserTurnProjection,
  TurnContextProjection,
  ToolCallProjection,
  DisplaySegment,
  UserMessageProjection,
  StageRun,
  SourceFormatProfile,
  StageKind,
  LossAuditRecord,
  SourcePlatform,
  SourceDefinition,
  AskUserQuestionTurn,
} from "@cchistory/domain";
import { joinDisplaySegments } from "@cchistory/domain";
import { applyMaskTemplates, LITERAL_PROMPT_MASK_TEMPLATE_IDS } from "../masks.js";
import {
  stableId,
  asString,
  nowIso,
  truncate,
  sumDefinedNumbers,
  firstDefinedNumber,
  isObject,
  accumulateTokenUsageMetrics,
  mergeTokenUsageMetrics,
  sha1,
  normalizeGitRemote,
  normalizeWorkspacePath,
  isUserTurnAtom,
  collapseAntigravityUserTurnAtoms,
  extractTokenUsageFromPayload,
  extractTokenCountFromPayload,
  extractStopReasonFromPayload,
  buildStageRunId,
  RULE_VERSION,
  normalizePathSeparators,
} from "./utils.js";
import type { SessionDraft, GitProjectEvidence, TokenUsageMetrics } from "./types.js";
import { resolveSourceFormatProfile } from "./discovery.js";
import { getAskUserProfile } from "./ask-user-registry.js";

export function buildProjectObservationCandidates(
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

  const workspaceCandidates: DerivedCandidate[] = [...workspaceSignals.values()].map((atom) => {
    const sourceBackedRepoRoot = normalizeWorkspacePath(asString(atom.payload.repo_root) ?? "");
    const sourceBackedRepoRemote = normalizeGitRemote(asString(atom.payload.repo_remote));
    const observedRepoRoot = sourceBackedRepoRoot ?? gitProjectEvidence?.repoRoot;
    const observedRepoRemote = sourceBackedRepoRemote;
    const observedRepoFingerprint = sourceBackedRepoRemote
      ? sha1(Buffer.from(`repo-remote:${sourceBackedRepoRemote}`))
      : undefined;
    const debugSummary = sourceBackedRepoRemote
      ? "workspace signal with source-backed repository evidence"
      : sourceBackedRepoRoot
        ? "workspace signal with source-backed repository root"
        : observedRepoRoot
          ? "workspace signal with git-backed repository root"
          : "workspace signal without git repository evidence";

    return {
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
        repo_root: observedRepoRoot,
        repo_remote: observedRepoRemote,
        repo_fingerprint: observedRepoFingerprint,
        source_native_project_ref: draft.source_native_project_ref,
        confidence: 0.5,
        reason: "workspace_signal_detected",
        debug_summary: debugSummary,
      },
    };
  });

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
        debug_summary: "source-native project reference without explicit workspace signal",
      },
    },
  ];
}

export function buildSubmissionGroups(draft: SessionDraft, atoms: ConversationAtom[], edges: AtomEdge[]): {
  groups: DerivedCandidate[];
  edges: AtomEdge[];
} {
  const groups: DerivedCandidate[] = [];
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

    const antigravityStartsFreshGroup =
      draft.source_platform === "antigravity" && atom.origin_kind === "user_authored" && currentGroupAtomIds.length > 0;
    const continuesCurrentGroup =
      currentGroupAtomIds.length > 0 &&
      !antigravityStartsFreshGroup &&
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
      edges.push({
        id: stableId("edge", draft.source_id, draft.id, atom.id, lastUserAtomId, "same_submission"),
        source_id: draft.source_id,
        session_ref: draft.id,
        from_atom_id: atom.id,
        to_atom_id: lastUserAtomId,
        edge_kind: "same_submission",
      });
      if (continuesCurrentGroup) {
        edges.push({
          id: stableId("edge", draft.source_id, draft.id, atom.id, lastUserAtomId, "continuation_of"),
          source_id: draft.source_id,
          session_ref: draft.id,
          from_atom_id: atom.id,
          to_atom_id: lastUserAtomId,
          edge_kind: "continuation_of",
        });
      }
    }

    lastUserAtomId = atom.id;
  }

  commitGroup();
  return { groups, edges };
}

export function buildTurnsAndContext(
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
  const atomById = new Map<string, ConversationAtom>();
  const atomIndexById = new Map<string, number>();
  for (const [index, atom] of atoms.entries()) {
    atomById.set(atom.id, atom);
    atomIndexById.set(atom.id, index);
  }
  const edgeIndex = buildTurnContextEdgeIndex(edges);

  for (const [index, group] of submissionGroups.entries()) {
    const firstAtomId = group.input_atom_refs[0];
    if (!firstAtomId) {
      continue;
    }
    const atomIndex = atomIndexById.get(firstAtomId) ?? -1;

    const nextGroup = submissionGroups[index + 1];
    const nextStartAtomId = nextGroup?.input_atom_refs[0];
    const nextIndex = nextStartAtomId ? atomIndexById.get(nextStartAtomId) : undefined;
    const currentGroupAtomSet = new Set(group.input_atom_refs);
    const turnId = stableId("turn", draft.source_id, draft.id, String(index));
    const contextAtoms: ConversationAtom[] = [];
    const contextAtomIds = new Set<string>();
    const contextEndIndex = nextIndex === undefined || nextIndex < 0 ? atoms.length : nextIndex;
    if (atomIndex >= 0) {
      for (let atomIndexValue = atomIndex + 1; atomIndexValue < contextEndIndex; atomIndexValue += 1) {
        const atom = atoms[atomIndexValue];
        if (!atom || currentGroupAtomSet.has(atom.id)) {
          continue;
        }
        contextAtoms.push(atom);
        contextAtomIds.add(atom.id);
      }
    }

    const groupAtoms: ConversationAtom[] = [];
    for (const atomId of group.input_atom_refs) {
      const atom = atomById.get(atomId);
      if (atom) {
        groupAtoms.push(atom);
      }
    }
    const turnCandidateId = stableId("candidate", "turn", draft.source_id, draft.id, String(index));
    const contextCandidateId = stableId("candidate", "context", draft.source_id, draft.id, String(index));
    const userMessages = groupAtoms
      .filter((atom) => atom.content_kind === "text" && (atom.origin_kind === "user_authored" || atom.origin_kind === "injected_user_shaped"))
      .map((atom, userIndex): UserMessageProjection => {
        const rawText = asString(atom.payload.text) ?? "";
        const isInjected = atom.origin_kind === "injected_user_shaped";
        const masked = applyMaskTemplates(rawText, "user_message", {
          injected: isInjected,
          exclude_template_ids:
            draft.source_platform === "antigravity" && !isInjected ? LITERAL_PROMPT_MASK_TEMPLATE_IDS : undefined,
        });
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
      {
        atomById,
        contextAtomIds,
        edgeIndex,
      },
    );

    const hasAuthoredUserInput = userMessages.some((message) => !message.is_injected);
    if (!hasAuthoredUserInput) {
      continue;
    }
    const lastContextAtom = contextAtoms[contextAtoms.length - 1];

    turnCandidates.push({
      id: turnCandidateId,
      source_id: draft.source_id,
      session_ref: draft.id,
      candidate_kind: "turn",
      input_atom_refs: groupAtoms.map((atom) => atom.id),
      started_at: group.started_at,
      ended_at: lastContextAtom?.time_key ?? group.ended_at,
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
      ended_at: lastContextAtom?.time_key ?? group.ended_at,
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

    const contextTokenUsage = summarizeAssistantReplyUsage(contextProjection.assistant_replies);
    const hasNoAssistantReply = contextProjection.assistant_replies.length === 0;

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
      last_context_activity_at: lastContextAtom?.time_key ?? group.ended_at,
      session_id: draft.id,
      source_id: draft.source_id,
      link_state: "unlinked",
      sync_axis: "current",
      value_axis: "active",
      retention_axis: "keep_raw_and_derived",
      context_ref: contextCandidateId,
      context_summary: {
        assistant_reply_count: contextProjection.assistant_replies.length,
        tool_call_count: contextProjection.tool_calls.length,
        token_usage: contextTokenUsage,
        total_tokens: contextTokenUsage?.total_tokens,
        primary_model: summarizeAssistantReplyPrimaryModel(contextProjection.assistant_replies) ?? draft.model,
        has_errors: contextProjection.assistant_replies.some((reply) => reply.stop_reason === "error"),
        zero_token_reason: hasNoAssistantReply ? "no_assistant_reply" : undefined,
      },
      lineage: {
        atom_refs: [...groupAtoms.map((atom) => atom.id), ...contextAtoms.map((atom) => atom.id)],
        candidate_refs: [turnCandidateId, contextCandidateId],
        fragment_refs: Array.from(allFragmentIds),
        record_refs: Array.from(allRecordIds),
        blob_refs: Array.from(allBlobIds),
      },
      path_text: buildTurnPathText(draft, contextProjection, groupAtoms, contextAtoms),
    });

    contexts.push(contextProjection);
  }

  const session: SessionProjection = {
    id: draft.id,
    source_id: draft.source_id,
    host_id: draft.host_id,
    source_platform: draft.source_platform,
    title: draft.title,
    created_at: draft.created_at ?? atoms[0]?.time_key ?? nowIso(),
    updated_at: draft.updated_at ?? atoms.at(-1)?.time_key ?? nowIso(),
    model: draft.model,
    working_directory: draft.working_directory,
    source_native_project_ref: draft.source_native_project_ref,
    source_session_id: draft.source_session_id,
    resume_command: draft.resume_command,
    resume_working_directory: draft.resume_working_directory,
    resume_command_confidence: draft.resume_command_confidence,
    turn_count: turns.length,
    sync_axis: "current",
  };

  return { session, turnCandidates, contextCandidates, turns, contexts };
}

interface TurnContextEdgeIndex {
  spawnedFromAtomIdByToolAtomId: Map<string, string>;
  toolResultAtomIdByToolAtomId: Map<string, string>;
}

interface TurnContextBuildIndex {
  atomById: ReadonlyMap<string, ConversationAtom>;
  contextAtomIds: ReadonlySet<string>;
  edgeIndex: TurnContextEdgeIndex;
}

function buildTurnContextEdgeIndex(edges: readonly AtomEdge[]): TurnContextEdgeIndex {
  const spawnedFromAtomIdByToolAtomId = new Map<string, string>();
  const toolResultAtomIdByToolAtomId = new Map<string, string>();
  for (const edge of edges) {
    if (edge.edge_kind === "spawned_from" && !spawnedFromAtomIdByToolAtomId.has(edge.from_atom_id)) {
      spawnedFromAtomIdByToolAtomId.set(edge.from_atom_id, edge.to_atom_id);
      continue;
    }
    if (edge.edge_kind === "tool_result_for" && !toolResultAtomIdByToolAtomId.has(edge.to_atom_id)) {
      toolResultAtomIdByToolAtomId.set(edge.to_atom_id, edge.from_atom_id);
    }
  }
  return {
    spawnedFromAtomIdByToolAtomId,
    toolResultAtomIdByToolAtomId,
  };
}

export function buildTurnContext(
  turnId: string,
  draft: SessionDraft,
  groupAtoms: ConversationAtom[],
  contextAtoms: ConversationAtom[],
  fragmentById: Map<string, SourceFragment>,
  edges: AtomEdge[],
  buildIndex?: TurnContextBuildIndex,
): TurnContextProjection {
  const assistantReplies: TurnContextProjection["assistant_replies"] = [];
  const systemMessages: TurnContextProjection["system_messages"] = [];
  const toolCalls: ToolCallProjection[] = [];
  const rawEventRefs = new Set<string>();
  const replyIdByAtomId = new Map<string, string>();
  const toolCallIdsByReplyId = new Map<string, string[]>();
  let toolSequence = 0;
  let activeModel = draft.model;
  const contextIndex =
    buildIndex ??
    {
      atomById: new Map(contextAtoms.map((atom) => [atom.id, atom])),
      contextAtomIds: new Set(contextAtoms.map((atom) => atom.id)),
      edgeIndex: buildTurnContextEdgeIndex(edges),
    };

  for (const atom of groupAtoms) {
    for (const fragmentId of atom.fragment_refs) {
      const recordId = fragmentById.get(fragmentId)?.record_id;
      if (recordId) {
        rawEventRefs.add(recordId);
      }
    }
  }
  const signalsByReply = new Map<number, ConversationAtom[]>();
  // Maps Claude message.id → index of the assistant reply that contains that
  // message's text. Used to attribute token_usage_signal atoms to the correct
  // reply even when the signal atom arrives in the stream before the text atom
  // (which happens because the signal is emitted from the first non-text chunk
  // of a multi-block message, and that chunk precedes the text chunk in JSONL).
  const replyIndexByMessageId = new Map<string, number>();
  // Signals whose message.id has not yet been seen on a text reply. These are
  // real billed API calls — either they arrive before their own text reply
  // (queued until the reply shows up), or they belong to a tool-only / thinking-
  // only message that has no text reply at all (orphan; attributed to the next
  // reply in the session so their tokens are not silently dropped).
  const pendingSignals: ConversationAtom[] = [];
  let currentReplyIndex = -1;
  for (const atom of contextAtoms) {
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
    if (atom.actor_kind === "system" && atom.content_kind === "text" && atom.display_policy !== "hide") {
      const content = asString(atom.payload.text) ?? "";
      const masked = applyMaskTemplates(content, "system_message");
      systemMessages.push({
        id: stableId("system-message", draft.source_id, draft.id, atom.id),
        content,
        display_segments: masked.display_segments,
        position: "interleaved",
        sequence: systemMessages.length,
        created_at: atom.time_key,
      });
      continue;
    }
    if (atom.actor_kind === "assistant" && atom.content_kind === "text" && atom.display_policy !== "hide") {
      const replyId = stableId("assistant-reply", draft.source_id, draft.id, atom.id);
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
      currentReplyIndex = assistantReplies.length - 1;
      if (replyModel !== "unknown") {
        activeModel = replyModel;
      }
      const replyMessageId = asString(atom.payload.message_id);
      if (replyMessageId) {
        replyIndexByMessageId.set(replyMessageId, currentReplyIndex);
      }
      // Flush any signals that arrived earlier in the session without a
      // matching text reply — either their own reply (now created) or as
      // orphans attributed to this turn.
      if (pendingSignals.length > 0) {
        const signals = signalsByReply.get(currentReplyIndex) ?? [];
        for (const pending of pendingSignals) {
          signals.push(pending);
        }
        signalsByReply.set(currentReplyIndex, signals);
        pendingSignals.length = 0;
      }
      continue;
    }
    if (
      atom.content_kind === "meta_signal" &&
      atom.payload.signal_kind === "token_usage_signal"
    ) {
      const signalMessageId = asString(atom.payload.message_id);
      const matchedReplyIndex =
        signalMessageId !== undefined ? replyIndexByMessageId.get(signalMessageId) : undefined;
      if (signalMessageId !== undefined && matchedReplyIndex === undefined) {
        // Signal's message.id has no text reply yet (and may never have one).
        // Queue rather than mis-attribute to the most recent reply.
        pendingSignals.push(atom);
      } else {
        const targetReplyIndex = matchedReplyIndex ?? currentReplyIndex;
        if (targetReplyIndex >= 0) {
          let signals = signalsByReply.get(targetReplyIndex);
          if (!signals) {
            signals = [];
            signalsByReply.set(targetReplyIndex, signals);
          }
          signals.push(atom);
        } else {
          pendingSignals.push(atom);
        }
      }
    }
  }

  // Trailing orphans: signals whose message.id has no text reply anywhere in
  // the session (tool-only / thinking-only API calls). Attribute them to the
  // last assistant reply so their billing is not silently dropped. If the
  // session has no text reply at all, there is nowhere to anchor the cost and
  // the tokens are dropped — logged as a known limitation.
  if (pendingSignals.length > 0 && assistantReplies.length > 0) {
    const lastReplyIndex = assistantReplies.length - 1;
    const signals = signalsByReply.get(lastReplyIndex) ?? [];
    for (const pending of pendingSignals) {
      signals.push(pending);
    }
    signalsByReply.set(lastReplyIndex, signals);
    pendingSignals.length = 0;
  }

  // Apply token_usage_signal atoms to the most recent preceding assistant reply.
  // Each signal is associated with the reply that precedes it in the atom sequence.
  if (assistantReplies.length > 0 && signalsByReply.size > 0) {
    for (const [replyIndex, signals] of signalsByReply.entries()) {
      const reply = assistantReplies[replyIndex];
      if (!reply || signals.length === 0) {
        continue;
      }

      // Check if signals carry delta_token_usage (cumulative mode)
      const hasDeltas = signals.some((s) => isObject(s.payload.delta_token_usage));
      // Codex's `last_token_usage` (without `total_token_usage`) is a cumulative
      // checkpoint within the turn — the last signal already subsumes earlier
      // ones. Claude Code's per-message.id signals are independent API calls
      // that must be summed. We tell them apart by Codex's `source_event_type`.
      const isCodexCumulativeWithinTurn = signals.every(
        (s) => s.payload.source_event_type === "token_count",
      );
      let resolvedUsage: TokenUsageMetrics | undefined;

      if (hasDeltas) {
        // Codex cumulative mode: each signal carries a delta since the prior
        // checkpoint. Sum deltas to recover the total increment for this reply.
        for (const signal of signals) {
          const delta = extractTokenUsageFromPayload(
            isObject(signal.payload.delta_token_usage) ? { token_usage: signal.payload.delta_token_usage } : {},
          );
          resolvedUsage = mergeTokenUsageMetrics(resolvedUsage, delta);
        }
      } else if (isCodexCumulativeWithinTurn) {
        // Codex without total_token_usage: last_token_usage is cumulative
        // within the turn, so the final checkpoint is the turn total.
        const lastSignal = signals.at(-1)!;
        resolvedUsage = extractTokenUsageFromPayload(lastSignal.payload);
      } else {
        // Claude Code mode: each signal is one API call's standalone usage
        // (after upstream dedup by message.id). A turn can chain several API
        // calls behind one text reply (text + tool_use loop + ...), and every
        // call's tokens must be summed — taking only the last signal silently
        // drops every preceding call's billing.
        for (const signal of signals) {
          const u = extractTokenUsageFromPayload(signal.payload);
          resolvedUsage = mergeTokenUsageMetrics(resolvedUsage, u);
        }
      }

      if (resolvedUsage) {
        reply.token_usage = resolvedUsage;
        reply.token_count = resolvedUsage.total_tokens ?? reply.token_count;
        if (resolvedUsage.model && reply.model === "unknown") {
          reply.model = resolvedUsage.model;
        }
        if (!reply.stop_reason) {
          const lastSignal = signals.at(-1)!;
          reply.stop_reason = extractStopReasonFromPayload(lastSignal.payload);
        }
      }
    }
  }

  const lastAssistantReplyId = () => assistantReplies.at(-1)?.id ?? stableId("assistant-reply", draft.id, "synthetic");
  for (const atom of contextAtoms) {
    if (atom.content_kind !== "tool_call" || atom.display_policy === "hide") {
      continue;
    }
    const spawnedFromAtomId = contextIndex.edgeIndex.spawnedFromAtomIdByToolAtomId.get(atom.id);
    const replyId = spawnedFromAtomId ? replyIdByAtomId.get(spawnedFromAtomId) ?? lastAssistantReplyId() : lastAssistantReplyId();
    const inputJson = JSON.stringify(atom.payload.input ?? {});
    const maskedInput = applyMaskTemplates(inputJson, "tool_input");
    const toolCall: ToolCallProjection = {
      id: stableId("tool-call", draft.source_id, draft.id, atom.id),
      tool_name: asString(atom.payload.tool_name) ?? "tool_call",
      input: isObject(atom.payload.input) ? atom.payload.input : {},
      input_summary: truncate(maskedInput.canonical_text || inputJson, 140),
      input_display_segments: maskedInput.display_segments,
      status: "success",
      reply_id: replyId,
      sequence: toolSequence++,
      created_at: atom.time_key,
    };

    const resultAtomId = contextIndex.edgeIndex.toolResultAtomIdByToolAtomId.get(atom.id);
    const resultAtom =
      resultAtomId && contextIndex.contextAtomIds.has(resultAtomId)
        ? contextIndex.atomById.get(resultAtomId)
        : undefined;
    if (resultAtom) {
      const output = asString(resultAtom.payload.output) ?? "";
      const maskedOutput = applyMaskTemplates(output, "tool_output");
      toolCall.output = output;
      toolCall.output_preview = truncate(maskedOutput.canonical_text || output, 140);
      toolCall.output_display_segments = maskedOutput.display_segments;
    }
    toolCalls.push(toolCall);
    let replyToolCallIds = toolCallIdsByReplyId.get(replyId);
    if (!replyToolCallIds) {
      replyToolCallIds = [];
      toolCallIdsByReplyId.set(replyId, replyToolCallIds);
    }
    replyToolCallIds.push(toolCall.id);
  }

  for (const reply of assistantReplies) {
    reply.tool_call_ids = toolCallIdsByReplyId.get(reply.id) ?? [];
  }

  return {
    turn_id: turnId,
    system_messages: systemMessages,
    assistant_replies: assistantReplies,
    tool_calls: toolCalls,
    raw_event_refs: Array.from(rawEventRefs),
  };
}

function buildTurnPathText(
  draft: SessionDraft,
  contextProjection: TurnContextProjection,
  groupAtoms: ConversationAtom[],
  contextAtoms: ConversationAtom[],
): string | undefined {
  const parts = new Set<string>();

  addPathText(parts, draft.working_directory);
  addPathText(parts, draft.source_native_project_ref);
  addPathText(parts, draft.resume_working_directory);
  addPathText(parts, draft.source_native_project_ref ? path.basename(draft.source_native_project_ref) : undefined);

  for (const atom of [...groupAtoms, ...contextAtoms]) {
    const payload = atom.payload;
    addPathText(parts, asString(payload.path));
    addPathText(parts, asString(payload.workspace_path));
    addPathText(parts, asString(payload.repo_root));
    addPathText(parts, asString(payload.source_native_project_ref));
  }

  for (const reply of contextProjection.assistant_replies) {
    for (const segment of reply.display_segments ?? []) {
      if (segment.type === "reference") {
        addPathText(parts, segment.content);
      }
    }
  }

  return [...parts].join(" ").trim() || undefined;
}

function addPathText(target: Set<string>, value: string | undefined): void {
  if (!value) {
    return;
  }
  const normalized = normalizePathSeparators(value).trim();
  if (!normalized) {
    return;
  }
  target.add(normalized);
  const basename = normalized.split("/").filter(Boolean).at(-1);
  if (basename) {
    target.add(basename);
  }
}

export function summarizeAssistantReplyUsage(replies: TurnContextProjection["assistant_replies"]): TokenUsageMetrics | undefined {
  let total: TokenUsageMetrics | undefined;
  for (const reply of replies) {
    if (reply.token_usage) {
      total = mergeTokenUsageMetrics(total, reply.token_usage);
    }
  }
  return total;
}

export function summarizeAssistantReplyPrimaryModel(replies: TurnContextProjection["assistant_replies"]): string | undefined {
  return replies.find((reply) => reply.model)?.model;
}

export function buildStageRuns(
  sourceId: string,
  sourcePlatform: SourcePlatform,
  startedAt: string,
  finishedAt: string,
  counts: {
    blobs: number;
    records: number;
    fragments: number;
    atoms: number;
    sessions: number;
    turns: number;
  },
  lossAudits: readonly LossAuditRecord[],
): StageRun[] {
  const sourceDefinition: SourceDefinition = {
    id: sourceId,
    slot_id: sourceId,
    family: "local_runtime_sessions",
    platform: sourcePlatform,
    base_dir: "unknown",
    display_name: "unknown",
  };
  const sourceFormatProfile = resolveSourceFormatProfile(sourceDefinition);
  const failureCounts = countLossAuditsByStage(lossAudits);

  const stageStats: Record<StageKind, StageRun["stats"]> = {
    capture: {
      input_count: 1,
      output_count: counts.blobs,
      success_count: counts.blobs,
      failure_count: failureCounts.capture,
      skipped_count: 0,
      unparseable_count: 0,
    },
    extract_records: {
      input_count: counts.blobs,
      output_count: counts.records,
      success_count: counts.records,
      failure_count: failureCounts.extract_records,
      skipped_count: 0,
      unparseable_count: failureCounts.extract_records,
    },
    parse_source_fragments: {
      input_count: counts.records,
      output_count: counts.fragments,
      success_count: counts.fragments,
      failure_count: failureCounts.parse_source_fragments,
      skipped_count: 0,
      unparseable_count: failureCounts.parse_source_fragments,
    },
    atomize: {
      input_count: counts.fragments,
      output_count: counts.atoms,
      success_count: counts.atoms,
      failure_count: failureCounts.atomize,
      skipped_count: 0,
      unparseable_count: 0,
    },
    derive_candidates: {
      input_count: counts.atoms,
      output_count: counts.sessions + counts.turns,
      success_count: counts.sessions + counts.turns,
      failure_count: failureCounts.derive_candidates,
      skipped_count: 0,
      unparseable_count: 0,
    },
    finalize_projections: {
      input_count: counts.sessions + counts.turns,
      output_count: counts.sessions + counts.turns,
      success_count: counts.sessions + counts.turns,
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

export function countLossAuditsByStage(lossAudits: readonly LossAuditRecord[]): Record<StageKind, number> {
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
    if (audit.severity === "info") {
      continue;
    }
    counts[audit.stage_kind] += 1;
  }
  return counts;
}

export function extractCanonicalFallback(segments: readonly DisplaySegment[]): string {
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

export function buildAskUserQuestionTurns(
  draft: SessionDraft,
  atoms: ConversationAtom[],
  edges: AtomEdge[],
): AskUserQuestionTurn[] {
  const profile = getAskUserProfile(draft.source_platform);
  if (!profile) {
    return [];
  }
  const toolNameSet = new Set(profile.toolNames);
  const atomById = new Map<string, ConversationAtom>();
  const toolCallEntries: Array<{ atom: ConversationAtom; toolName: string }> = [];
  for (const atom of atoms) {
    atomById.set(atom.id, atom);
    if (atom.content_kind !== "tool_call") {
      continue;
    }
    const toolName = asString(atom.payload.tool_name);
    if (!toolName || !toolNameSet.has(toolName)) {
      continue;
    }
    toolCallEntries.push({ atom, toolName });
  }
  if (toolCallEntries.length === 0) {
    return [];
  }

  const toolCallAtomIds = new Set(toolCallEntries.map((entry) => entry.atom.id));
  const resultAtomByCallAtomId = new Map<string, ConversationAtom>();
  for (const edge of edges) {
    if (edge.edge_kind !== "tool_result_for") {
      continue;
    }
    if (!toolCallAtomIds.has(edge.to_atom_id)) {
      continue;
    }
    const resultAtom = atomById.get(edge.from_atom_id);
    if (resultAtom && resultAtom.content_kind === "tool_result") {
      resultAtomByCallAtomId.set(edge.to_atom_id, resultAtom);
    }
  }

  const turns: AskUserQuestionTurn[] = [];
  for (const { atom: callAtom, toolName } of toolCallEntries) {
    const resultAtom = resultAtomByCallAtomId.get(callAtom.id);
    if (!resultAtom) {
      continue;
    }
    const questions = profile.parseCall(callAtom.payload.input);
    if (questions.length === 0) {
      continue;
    }
    const answers = profile.parseResult(resultAtom.payload.output, questions);
    turns.push({
      id: stableId("aqq", draft.source_id, callAtom.id, resultAtom.id),
      source_id: draft.source_id,
      session_id: draft.id,
      source_platform: draft.source_platform,
      created_at: resultAtom.time_key,
      tool_name: toolName,
      call_atom_id: callAtom.id,
      result_atom_id: resultAtom.id,
      questions,
      answers,
    });
  }
  return turns;
}
