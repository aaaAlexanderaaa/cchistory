import type { LossAuditRecord, RawRecord, SourceFragment } from "@cchistory/domain";
import type {
  CodexParseRuntimeHelpers,
  FragmentBuildContextLike,
  ParseRuntimeResult,
  SessionDraftLike,
} from "../runtime-types.js";

export function parseCodexRecord(
  context: FragmentBuildContextLike,
  record: RawRecord,
  parsed: Record<string, unknown>,
  draft: SessionDraftLike,
  helpers: CodexParseRuntimeHelpers,
): ParseRuntimeResult {
  const fragments: SourceFragment[] = [];
  const lossAudits: LossAuditRecord[] = [];
  const type = helpers.asString(parsed.type) ?? "unknown";
  const timeKey = helpers.coerceIso(parsed.timestamp) ?? helpers.nowIso();

  if (type === "session_meta" && helpers.isObject(parsed.payload)) {
    const payload = parsed.payload;
    draft.working_directory = helpers.asString(payload.cwd) ?? draft.working_directory;
    fragments.push(helpers.createFragment(context, record, fragments.length, "session_meta", timeKey, payload));
    if (helpers.asString(payload.cwd)) {
      fragments.push(
        helpers.createFragment(context, record, fragments.length, "workspace_signal", timeKey, {
          path: helpers.asString(payload.cwd),
        }),
      );
    }
    if (helpers.asString(payload.model)) {
      fragments.push(
        helpers.createFragment(context, record, fragments.length, "model_signal", timeKey, {
          model: helpers.asString(payload.model),
        }),
      );
    }
    return { fragments, lossAudits };
  }

  if (type === "turn_context" && helpers.isObject(parsed.payload)) {
    const payload = parsed.payload;
    if (helpers.asString(payload.cwd)) {
      draft.working_directory = helpers.asString(payload.cwd) ?? draft.working_directory;
      fragments.push(
        helpers.createFragment(context, record, fragments.length, "workspace_signal", timeKey, {
          path: helpers.asString(payload.cwd),
        }),
      );
    }
    if (helpers.asString(payload.model)) {
      draft.model = helpers.asString(payload.model) ?? draft.model;
      fragments.push(
        helpers.createFragment(context, record, fragments.length, "model_signal", timeKey, {
          model: helpers.asString(payload.model),
        }),
      );
    }
    return { fragments, lossAudits };
  }

  if (type === "response_item" && helpers.isObject(parsed.payload)) {
    const payload = parsed.payload;
    const payloadType = helpers.asString(payload.type) ?? "unknown";
    if (payloadType === "message") {
      const role = helpers.asString(payload.role) ?? "assistant";
      const actorKind = helpers.mapRoleToActor(role);
      const content = helpers.asArray(payload.content);
      const usage = helpers.extractTokenUsage(payload);
      const stopReason = helpers.normalizeStopReason(payload.stop_reason);
      let usageApplied = false;
      let localSeq = 0;
      for (const item of content) {
        if (!helpers.isObject(item)) {
          continue;
        }
        const itemType = helpers.asString(item.type) ?? "unknown";
        const text = helpers.extractTextFromContentItem(item);
        if (text) {
          const appended = helpers.appendChunkedTextFragments(
            context,
            record,
            fragments,
            timeKey,
            actorKind,
            text,
            localSeq,
            { usage, stopReason, usageApplied },
          );
          localSeq = appended.nextSeq;
          usageApplied = appended.usageApplied;
          continue;
        }
        if (isCodexOpaqueReasoningItem(item, helpers)) {
          fragments.push(createCodexOpaqueReasoningFragment(context, record, fragments.length, timeKey, item, helpers));
          localSeq += 1;
          continue;
        }
        localSeq = helpers.appendUnsupportedContentItem(
          context,
          record,
          fragments,
          lossAudits,
          timeKey,
          localSeq,
          item,
          `Unsupported Codex message content item: ${itemType}`,
          "codex_unsupported_content_item",
        );
      }
      if (!usageApplied && usage) {
        fragments.push(helpers.createTokenUsageFragment(context, record, localSeq++, timeKey, usage, stopReason));
      }
      return { fragments, lossAudits };
    }

    if (payloadType === "reasoning") {
      fragments.push(createCodexOpaqueReasoningFragment(context, record, 0, timeKey, payload, helpers));
      return { fragments, lossAudits };
    }

    if (payloadType === "function_call" || payloadType === "custom_tool_call") {
      const input =
        payloadType === "function_call"
          ? helpers.safeJsonParse(helpers.asString(payload.arguments)) ?? { raw: helpers.asString(payload.arguments) }
          : helpers.safeJsonParse(helpers.asString(payload.input)) ?? { raw: helpers.asString(payload.input) };
      fragments.push(
        helpers.createFragment(context, record, 0, "tool_call", timeKey, {
          call_id: helpers.asString(payload.call_id),
          tool_name: helpers.asString(payload.name) ?? payloadType,
          input: helpers.isObject(input) ? input : {},
        }),
      );
      return { fragments, lossAudits };
    }

    if (payloadType === "function_call_output" || payloadType === "custom_tool_call_output") {
      fragments.push(
        helpers.createFragment(context, record, 0, "tool_result", timeKey, {
          call_id: helpers.asString(payload.call_id),
          output: helpers.asString(payload.output) ?? JSON.stringify(payload.output ?? {}),
        }),
      );
      return { fragments, lossAudits };
    }

    if (payloadType === "web_search_call") {
      fragments.push(createCodexWebSearchCallFragment(context, record, 0, timeKey, payload, helpers));
      return { fragments, lossAudits };
    }

    if (payloadType === "tool_search_call") {
      fragments.push(createCodexToolSearchCallFragment(context, record, 0, timeKey, payload, helpers));
      return { fragments, lossAudits };
    }

    if (payloadType === "tool_search_output") {
      fragments.push(createCodexToolSearchResultFragment(context, record, 0, timeKey, payload, helpers));
      return { fragments, lossAudits };
    }
  }

  if (type === "compacted" && helpers.isObject(parsed.payload)) {
    const payload = parsed.payload;
    fragments.push(
      createCodexLifecycleEventFragment(
        context,
        record,
        0,
        timeKey,
        helpers.asString(payload.type) ?? type,
        payload,
        helpers,
      ),
    );
    return { fragments, lossAudits };
  }

  if (type === "event_msg" && helpers.isObject(parsed.payload)) {
    const payload = parsed.payload;
    const eventType = helpers.asString(payload.type) ?? "unknown";
    if (eventType === "token_count") {
      const usage = helpers.extractTokenUsage(payload.info ?? payload);
      const cumulativeUsage = helpers.extractCumulativeTokenUsage(payload.info ?? payload);
      const baselineKey = helpers.buildTokenUsageCheckpointBaselineKey(cumulativeUsage, usage);
      let deltaUsage: typeof usage;
      if (baselineKey && usage) {
        const checkpoints = draft.cumulative_token_usage_by_baseline ??= {};
        const previousCheckpoint = checkpoints[baselineKey];
        deltaUsage = helpers.diffTokenUsageMetrics(usage, previousCheckpoint) ?? undefined;
        checkpoints[baselineKey] = helpers.mergeMaxTokenUsageMetrics(previousCheckpoint, usage);
      } else {
        deltaUsage = helpers.diffTokenUsageMetrics(cumulativeUsage, draft.last_cumulative_token_usage) ?? undefined;
      }
      draft.last_cumulative_token_usage = cumulativeUsage ?? draft.last_cumulative_token_usage;
      if (usage) {
        fragments.push(
          helpers.createTokenUsageFragment(context, record, 0, timeKey, usage, undefined, {
            scope: "turn",
            source_event_type: "token_count",
            delta_token_usage: deltaUsage,
            cumulative_token_usage: cumulativeUsage,
            cumulative_token_usage_baseline_key: baselineKey,
          }),
        );
        return { fragments, lossAudits };
      }
      fragments.push(createCodexEventMetaFragment(context, record, 0, timeKey, eventType, payload, helpers));
      return { fragments, lossAudits };
    }

    if (eventType === "user_message") {
      const text = helpers.asString(payload.message);
      if (text) {
        helpers.appendChunkedTextFragments(context, record, fragments, timeKey, "user", text, 0);
      } else {
        fragments.push(createCodexEventMetaFragment(context, record, 0, timeKey, eventType, payload, helpers));
      }
      return { fragments, lossAudits };
    }

    if (eventType === "agent_message") {
      const text = helpers.asString(payload.message);
      if (text) {
        const appended = helpers.appendChunkedTextFragments(context, record, fragments, timeKey, "assistant", text, 0);
        appendCodexEventMetaFragment(context, record, fragments, timeKey, eventType, payload, helpers, appended.nextSeq);
      } else {
        fragments.push(createCodexEventMetaFragment(context, record, 0, timeKey, eventType, payload, helpers));
      }
      return { fragments, lossAudits };
    }

    if (eventType === "agent_reasoning") {
      fragments.push(
        helpers.createFragment(context, record, 0, "unknown", timeKey, {
          signal_kind: "agent_reasoning",
          source_event_type: eventType,
          text_present: helpers.asString(payload.text) !== undefined,
          text_bytes: helpers.asString(payload.text)?.length,
        }),
      );
      return { fragments, lossAudits };
    }

    if (eventType === "web_search_call") {
      fragments.push(createCodexWebSearchCallFragment(context, record, 0, timeKey, payload, helpers));
      return { fragments, lossAudits };
    }

    if (eventType === "web_search_end") {
      fragments.push(createCodexWebSearchResultFragment(context, record, 0, timeKey, payload, helpers));
      return { fragments, lossAudits };
    }

    if (eventType === "tool_search_call") {
      fragments.push(createCodexToolSearchCallFragment(context, record, 0, timeKey, payload, helpers));
      return { fragments, lossAudits };
    }

    if (eventType === "tool_search_output") {
      fragments.push(createCodexToolSearchResultFragment(context, record, 0, timeKey, payload, helpers));
      return { fragments, lossAudits };
    }

    if (eventType === "mcp_tool_call_end") {
      fragments.push(...createCodexMcpToolFragments(context, record, timeKey, payload, helpers));
      return { fragments, lossAudits };
    }

    if (eventType === "patch_apply_end") {
      fragments.push(...createCodexPatchApplyFragments(context, record, timeKey, payload, helpers));
      return { fragments, lossAudits };
    }

    if (isCodexLifecycleEventType(eventType)) {
      fragments.push(createCodexLifecycleEventFragment(context, record, 0, timeKey, eventType, payload, helpers));
      return { fragments, lossAudits };
    }
  }

  lossAudits.push(
    helpers.createRecordLossAudit(context, record, "unknown_fragment", `Unhandled Codex record type: ${type}`, {
      diagnosticCode: "codex_unhandled_record_type",
    }),
  );
  fragments.push(helpers.createFragment(context, record, 0, "unknown", timeKey, parsed));
  return { fragments, lossAudits };
}

function isCodexLifecycleEventType(eventType: string): boolean {
  return eventType === "context_compacted" ||
    eventType === "thread_goal_updated" ||
    eventType === "task_started" ||
    eventType === "task_complete" ||
    eventType === "turn_aborted" ||
    eventType === "entered_review_mode" ||
    eventType === "exited_review_mode" ||
    eventType === "thread_rolled_back" ||
    eventType === "item_completed";
}

function createCodexLifecycleEventFragment(
  context: FragmentBuildContextLike,
  record: RawRecord,
  seqNo: number,
  timeKey: string,
  eventType: string,
  payload: Record<string, unknown>,
  helpers: CodexParseRuntimeHelpers,
): SourceFragment {
  const replacementHistory = helpers.asArray(payload.replacement_history);
  const replacementSummary = summarizeCodexReplacementHistory(replacementHistory, helpers);
  const source = helpers.isObject(payload.source) ? payload.source : undefined;
  const sourceSubagent = helpers.isObject(source?.subagent) ? source.subagent : undefined;
  const sourceThreadSpawn = helpers.isObject(sourceSubagent?.thread_spawn) ? sourceSubagent.thread_spawn : undefined;
  const target = helpers.isObject(payload.target) ? payload.target : undefined;
  return helpers.createFragment(context, record, seqNo, "unknown", timeKey, {
    signal_kind: eventType,
    source_event_type: eventType,
    turn_id: helpers.asString(payload.turn_id) ?? helpers.asString(payload.turnId),
    status: helpers.asString(payload.status),
    reason: helpers.asString(payload.reason),
    num_turns: helpers.asNumber(payload.num_turns),
    replacement_history_item_count: replacementSummary.itemCount || undefined,
    replacement_history_roles: replacementSummary.roles,
    replacement_history_types: replacementSummary.types,
    replacement_history_content_bytes: replacementSummary.contentBytes || undefined,
    source_event_origin: helpers.asString(source?.type),
    parent_thread_id: helpers.asString(sourceThreadSpawn?.parent_thread_id),
    target_branch: helpers.asString(target?.branch),
  });
}

function summarizeCodexReplacementHistory(
  replacementHistory: unknown[],
  helpers: CodexParseRuntimeHelpers,
): { itemCount: number; roles?: string[]; types?: string[]; contentBytes: number } {
  const roles = new Set<string>();
  const types = new Set<string>();
  let contentBytes = 0;
  for (const entry of replacementHistory) {
    if (!helpers.isObject(entry)) {
      continue;
    }
    const role = helpers.asString(entry.role);
    const type = helpers.asString(entry.type);
    const content = helpers.asString(entry.content);
    if (role) {
      roles.add(role);
    }
    if (type) {
      types.add(type);
    }
    if (content) {
      contentBytes += content.length;
    }
  }
  return {
    itemCount: replacementHistory.length,
    roles: roles.size > 0 ? [...roles].sort() : undefined,
    types: types.size > 0 ? [...types].sort() : undefined,
    contentBytes,
  };
}

function appendCodexEventMetaFragment(
  context: FragmentBuildContextLike,
  record: RawRecord,
  fragments: SourceFragment[],
  timeKey: string,
  eventType: string,
  payload: Record<string, unknown>,
  helpers: CodexParseRuntimeHelpers,
  seqNo: number,
): void {
  const phase = helpers.asString(payload.phase);
  const memoryCitation = payload.memory_citation;
  if (!phase && memoryCitation === undefined) {
    return;
  }
  fragments.push(
    helpers.createFragment(context, record, seqNo, "unknown", timeKey, {
      signal_kind: eventType,
      source_event_type: eventType,
      phase,
      memory_citation_present: memoryCitation !== undefined,
    }),
  );
}

function isCodexOpaqueReasoningItem(
  item: Record<string, unknown>,
  helpers: CodexParseRuntimeHelpers,
): boolean {
  const itemType = helpers.asString(item.type);
  return itemType === "reasoning" && helpers.asString(item.encrypted_content) !== undefined;
}

function createCodexOpaqueReasoningFragment(
  context: FragmentBuildContextLike,
  record: RawRecord,
  seqNo: number,
  timeKey: string,
  payload: Record<string, unknown>,
  helpers: CodexParseRuntimeHelpers,
): SourceFragment {
  const encryptedContent = helpers.asString(payload.encrypted_content);
  const summary = helpers.asArray(payload.summary);
  return helpers.createFragment(context, record, seqNo, "unknown", timeKey, {
    signal_kind: "reasoning_opaque",
    source_event_type: "response_item.reasoning",
    opaque_reasoning: true,
    encrypted_content_present: encryptedContent !== undefined,
    encrypted_content_bytes: encryptedContent ? encryptedContent.length : undefined,
    summary_item_count: summary.length,
  });
}

function createCodexEventMetaFragment(
  context: FragmentBuildContextLike,
  record: RawRecord,
  seqNo: number,
  timeKey: string,
  eventType: string,
  payload: Record<string, unknown>,
  helpers: CodexParseRuntimeHelpers,
): SourceFragment {
  return helpers.createFragment(context, record, seqNo, "unknown", timeKey, {
    signal_kind: eventType,
    source_event_type: eventType,
    ...extractCodexEventMetadata(payload, helpers),
  });
}

function createCodexWebSearchCallFragment(
  context: FragmentBuildContextLike,
  record: RawRecord,
  seqNo: number,
  timeKey: string,
  payload: Record<string, unknown>,
  helpers: CodexParseRuntimeHelpers,
): SourceFragment {
  const action = helpers.isObject(payload.action) ? payload.action : undefined;
  const input = {
    query: helpers.asString(payload.query) ?? helpers.asString(action?.query),
    queries: helpers.asArray(action?.queries),
    url: helpers.asString(action?.url),
    pattern: helpers.asString(action?.pattern),
    action_type: helpers.asString(action?.type),
  };
  return helpers.createFragment(context, record, seqNo, "tool_call", timeKey, {
    call_id: helpers.asString(payload.call_id) ?? stableEventCallId("web_search", record),
    tool_name: "web_search",
    input,
    source_event_type: "web_search_call",
    status: helpers.asString(payload.status),
  });
}

function createCodexWebSearchResultFragment(
  context: FragmentBuildContextLike,
  record: RawRecord,
  seqNo: number,
  timeKey: string,
  payload: Record<string, unknown>,
  helpers: CodexParseRuntimeHelpers,
): SourceFragment {
  const action = helpers.isObject(payload.action) ? payload.action : undefined;
  return helpers.createFragment(context, record, seqNo, "tool_result", timeKey, {
    call_id: helpers.asString(payload.call_id) ?? stableEventCallId("web_search", record),
    output: JSON.stringify({
      query: helpers.asString(payload.query),
      action_type: helpers.asString(action?.type),
    }),
    source_event_type: "web_search_end",
  });
}

function createCodexToolSearchCallFragment(
  context: FragmentBuildContextLike,
  record: RawRecord,
  seqNo: number,
  timeKey: string,
  payload: Record<string, unknown>,
  helpers: CodexParseRuntimeHelpers,
): SourceFragment {
  const input = helpers.isObject(payload.arguments) ? payload.arguments : {};
  return helpers.createFragment(context, record, seqNo, "tool_call", timeKey, {
    call_id: helpers.asString(payload.call_id),
    tool_name: "tool_search",
    input,
    source_event_type: "tool_search_call",
    status: helpers.asString(payload.status),
    execution: helpers.asString(payload.execution),
  });
}

function createCodexToolSearchResultFragment(
  context: FragmentBuildContextLike,
  record: RawRecord,
  seqNo: number,
  timeKey: string,
  payload: Record<string, unknown>,
  helpers: CodexParseRuntimeHelpers,
): SourceFragment {
  return helpers.createFragment(context, record, seqNo, "tool_result", timeKey, {
    call_id: helpers.asString(payload.call_id),
    output: JSON.stringify({
      status: helpers.asString(payload.status),
      tool_count: helpers.asArray(payload.tools).length,
    }),
    source_event_type: "tool_search_output",
    status: helpers.asString(payload.status),
    execution: helpers.asString(payload.execution),
  });
}

function createCodexMcpToolFragments(
  context: FragmentBuildContextLike,
  record: RawRecord,
  timeKey: string,
  payload: Record<string, unknown>,
  helpers: CodexParseRuntimeHelpers,
): SourceFragment[] {
  const invocation = helpers.isObject(payload.invocation) ? payload.invocation : undefined;
  const invocationArguments = invocation?.arguments;
  const result = helpers.isObject(payload.result) ? payload.result : undefined;
  const callId = helpers.asString(payload.call_id);
  return [
    helpers.createFragment(context, record, 0, "tool_call", timeKey, {
      call_id: callId,
      tool_name: helpers.asString(invocation?.tool) ?? "mcp_tool_call",
      input: helpers.isObject(invocationArguments) ? invocationArguments : {},
      source_event_type: "mcp_tool_call_end",
      server: helpers.asString(invocation?.server),
    }),
    helpers.createFragment(context, record, 1, "tool_result", timeKey, {
      call_id: callId,
      output: JSON.stringify({
        ok: result && Object.prototype.hasOwnProperty.call(result, "Ok"),
        error: result && Object.prototype.hasOwnProperty.call(result, "Err"),
      }),
      source_event_type: "mcp_tool_call_end",
      server: helpers.asString(invocation?.server),
      tool_name: helpers.asString(invocation?.tool),
      duration_ms: codexDurationMs(payload.duration, helpers),
    }),
  ];
}

function createCodexPatchApplyFragments(
  context: FragmentBuildContextLike,
  record: RawRecord,
  timeKey: string,
  payload: Record<string, unknown>,
  helpers: CodexParseRuntimeHelpers,
): SourceFragment[] {
  const callId = helpers.asString(payload.call_id);
  const changes = helpers.asArray(payload.changes);
  return [
    helpers.createFragment(context, record, 0, "tool_call", timeKey, {
      call_id: callId,
      tool_name: "apply_patch",
      input: {
        change_count: changes.length,
        turn_id: helpers.asString(payload.turn_id),
      },
      source_event_type: "patch_apply_end",
    }),
    helpers.createFragment(context, record, 1, "tool_result", timeKey, {
      call_id: callId,
      output: JSON.stringify({
        status: helpers.asString(payload.status),
        success: helpers.asBoolean(payload.success),
        change_count: changes.length,
        stdout_present: helpers.asString(payload.stdout) !== undefined,
        stderr_present: helpers.asString(payload.stderr) !== undefined,
      }),
      source_event_type: "patch_apply_end",
      status: helpers.asString(payload.status),
      success: helpers.asBoolean(payload.success),
      turn_id: helpers.asString(payload.turn_id),
    }),
  ];
}

function extractCodexEventMetadata(
  payload: Record<string, unknown>,
  helpers: CodexParseRuntimeHelpers,
): Record<string, unknown> {
  return {
    status: helpers.asString(payload.status),
    call_id: helpers.asString(payload.call_id),
    execution: helpers.asString(payload.execution),
  };
}

function codexDurationMs(value: unknown, helpers: CodexParseRuntimeHelpers): number | undefined {
  if (!helpers.isObject(value)) {
    return undefined;
  }
  const secs = helpers.asNumber(value.secs) ?? 0;
  const nanos = helpers.asNumber(value.nanos) ?? 0;
  return secs * 1000 + nanos / 1_000_000;
}

function stableEventCallId(prefix: string, record: RawRecord): string {
  return `${prefix}:${record.id}`;
}
