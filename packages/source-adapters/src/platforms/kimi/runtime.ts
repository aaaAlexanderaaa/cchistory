import type { LossAuditRecord, RawRecord, SourceFragment } from "@cchistory/domain";
import type {
  CommonParseRuntimeHelpers,
  FragmentBuildContextLike,
  ParseRuntimeResult,
  SessionDraftLike,
  TokenUsageLike,
} from "../runtime-types.js";

const EVIDENCE_ONLY_RECORD_TYPES = new Set([
  "llm.request",
  "llm.tools_snapshot",
  "permission.record_approval_result",
  "permission.set_mode",
  "plan_mode.cancel",
  "plan_mode.enter",
  "swarm_mode.enter",
  "swarm_mode.exit",
  "tools.set_active_tools",
]);

export function parseKimiRecord(
  context: FragmentBuildContextLike,
  record: RawRecord,
  parsed: Record<string, unknown>,
  draft: SessionDraftLike,
  helpers: CommonParseRuntimeHelpers,
): ParseRuntimeResult {
  const fragments: SourceFragment[] = [];
  const lossAudits: LossAuditRecord[] = [];

  if (record.record_path_or_offset === "state") {
    const createdAt = helpers.coerceIso(parsed.createdAt);
    const updatedAt = helpers.coerceIso(parsed.updatedAt);
    const title = helpers.asString(parsed.title);
    const workDir = helpers.asString(parsed.workDir);
    draft.created_at = createdAt ?? draft.created_at;
    draft.updated_at = updatedAt ?? draft.updated_at;
    draft.title = title ?? draft.title;
    draft.working_directory = workDir ? helpers.normalizeWorkspacePath(workDir) : draft.working_directory;
    const timeKey = createdAt ?? record.observed_at ?? helpers.nowIso();

    fragments.push(helpers.createFragment(context, record, fragments.length, "session_meta", timeKey, parsed));
    if (draft.title) {
      fragments.push(helpers.createFragment(context, record, fragments.length, "title_signal", timeKey, {
        title: draft.title,
      }));
    }
    if (draft.working_directory) {
      fragments.push(helpers.createFragment(context, record, fragments.length, "workspace_signal", timeKey, {
        path: draft.working_directory,
      }));
    }
    return { fragments, lossAudits };
  }

  const recordType = helpers.asString(parsed.type) ?? "unknown";
  const timeKey = helpers.epochMillisToIso(helpers.asNumber(parsed.time)) ?? record.observed_at ?? helpers.nowIso();

  if (recordType === "metadata") {
    fragments.push(helpers.createFragment(context, record, 0, "session_meta", timeKey, parsed));
    return { fragments, lossAudits };
  }

  if (recordType === "config.update") {
    const model = helpers.asString(parsed.modelAlias) ?? helpers.asString(parsed.model);
    if (model) {
      draft.model = model;
      fragments.push(helpers.createFragment(context, record, 0, "model_signal", timeKey, { model }));
    }
    return { fragments, lossAudits };
  }

  if (recordType === "turn.prompt" || recordType === "turn.steer") {
    appendKimiInputFragments(context, record, parsed, timeKey, fragments, lossAudits, helpers);
    return { fragments, lossAudits };
  }

  if (recordType === "context.append_message") {
    const message = helpers.isObject(parsed.message) ? parsed.message : undefined;
    const role = helpers.asString(message?.role);
    if (role === "user") {
      lossAudits.push(helpers.createRecordLossAudit(
        context,
        record,
        "dropped_for_projection",
        "Kimi context.append_message user echo kept as raw evidence; turn.prompt is the submission anchor",
        { diagnosticCode: "kimi_duplicate_user_context_echo", severity: "info" },
      ));
      return { fragments, lossAudits };
    }
  }

  if (recordType === "context.append_loop_event") {
    const event = helpers.isObject(parsed.event) ? parsed.event : undefined;
    if (!event) {
      return unhandledKimiRecord(context, record, recordType, parsed, timeKey, helpers);
    }
    const eventType = helpers.asString(event.type) ?? "unknown";
    if (eventType === "step.begin" || eventType === "step.end") {
      return { fragments, lossAudits };
    }
    if (eventType === "content.part") {
      const part = helpers.isObject(event.part) ? event.part : undefined;
      const partType = helpers.asString(part?.type);
      const text = partType === "think" ? helpers.asString(part?.think) : helpers.asString(part?.text);
      if (text && (partType === "text" || partType === "think")) {
        fragments.push(helpers.createFragment(context, record, 0, "text", timeKey, {
          actor_kind: "assistant",
          origin_kind: "assistant_authored",
          text,
          display_policy: partType === "think" ? "collapse" : "show",
          source_content_type: partType,
          message_id: helpers.asString(event.uuid),
        }));
        return { fragments, lossAudits };
      }
      return unhandledKimiRecord(context, record, `${recordType}:${eventType}:${partType ?? "unknown"}`, parsed, timeKey, helpers);
    }
    if (eventType === "tool.call") {
      fragments.push(helpers.createFragment(context, record, 0, "tool_call", timeKey, {
        call_id: helpers.asString(event.toolCallId) ?? helpers.asString(event.uuid),
        tool_name: helpers.asString(event.name) ?? "tool.call",
        input: helpers.isObject(event.args) ? event.args : {},
        description: helpers.asString(event.description),
      }));
      return { fragments, lossAudits };
    }
    if (eventType === "tool.result") {
      const result = helpers.isObject(event.result) ? event.result : undefined;
      fragments.push(helpers.createFragment(context, record, 0, "tool_result", timeKey, {
        call_id: helpers.asString(event.toolCallId) ?? helpers.asString(event.parentUuid),
        output: helpers.stringifyToolContent(result?.output ?? event.result),
      }));
      return { fragments, lossAudits };
    }
    return unhandledKimiRecord(context, record, `${recordType}:${eventType}`, parsed, timeKey, helpers);
  }

  if (recordType === "usage.record") {
    const usage = extractKimiUsage(parsed, helpers);
    if (usage) {
      fragments.push(helpers.createTokenUsageFragment(context, record, 0, timeKey, usage, undefined, {
        scope: helpers.asString(parsed.usageScope) ?? "turn",
        source_event_type: recordType,
      }));
    }
    return { fragments, lossAudits };
  }

  if (EVIDENCE_ONLY_RECORD_TYPES.has(recordType)) {
    return { fragments, lossAudits };
  }

  return unhandledKimiRecord(context, record, recordType, parsed, timeKey, helpers);
}

function appendKimiInputFragments(
  context: FragmentBuildContextLike,
  record: RawRecord,
  parsed: Record<string, unknown>,
  timeKey: string,
  fragments: SourceFragment[],
  lossAudits: LossAuditRecord[],
  helpers: CommonParseRuntimeHelpers,
): void {
  const recordType = helpers.asString(parsed.type) ?? "turn.prompt";
  const origin = helpers.isObject(parsed.origin) ? parsed.origin : undefined;
  const originKind = helpers.asString(origin?.kind);
  const isDirectUserInput = originKind === undefined || originKind === "user";
  const isBackgroundInjection = recordType === "turn.steer" && originKind === "background_task";
  const actorKind = isDirectUserInput || isBackgroundInjection ? "user" : "system";
  const canonicalOrigin = isDirectUserInput
    ? "user_authored"
    : isBackgroundInjection
      ? "injected_user_shaped"
      : originKind === "system_trigger"
        ? "automation_trigger"
        : "source_instruction";
  const displayPolicy = isDirectUserInput ? "show" : "collapse";
  let appended = 0;

  for (const item of helpers.asArray(parsed.input)) {
    if (!helpers.isObject(item)) {
      continue;
    }
    const text = helpers.asString(item.text);
    if (helpers.asString(item.type) === "text" && text) {
      fragments.push(helpers.createFragment(context, record, fragments.length, "text", timeKey, {
        actor_kind: actorKind,
        origin_kind: canonicalOrigin,
        text,
        display_policy: displayPolicy,
        source_event_type: recordType,
        source_origin_kind: originKind,
      }));
      appended += 1;
      continue;
    }
    fragments.push(helpers.createFragment(context, record, fragments.length, "unknown", timeKey, item));
    lossAudits.push(helpers.createRecordLossAudit(
      context,
      record,
      "unknown_fragment",
      `Unsupported Kimi ${recordType} input item`,
      { diagnosticCode: "kimi_unsupported_input_item" },
    ));
  }

  if (appended === 0 && fragments.length === 0) {
    lossAudits.push(helpers.createRecordLossAudit(
      context,
      record,
      "unknown_fragment",
      `Kimi ${recordType} did not contain a text input item`,
      { diagnosticCode: "kimi_input_text_missing" },
    ));
    fragments.push(helpers.createFragment(context, record, 0, "unknown", timeKey, parsed));
  }
}

function extractKimiUsage(
  parsed: Record<string, unknown>,
  helpers: CommonParseRuntimeHelpers,
): TokenUsageLike | undefined {
  const raw = helpers.isObject(parsed.usage) ? parsed.usage : undefined;
  if (!raw) {
    return undefined;
  }
  const inputTokens = helpers.asNumber(raw.inputOther);
  const cacheReadTokens = helpers.asNumber(raw.inputCacheRead);
  const cacheCreationTokens = helpers.asNumber(raw.inputCacheCreation);
  const outputTokens = helpers.asNumber(raw.output);
  const values = [inputTokens, cacheReadTokens, cacheCreationTokens, outputTokens];
  if (values.every((value) => value === undefined)) {
    return undefined;
  }
  return {
    input_tokens: inputTokens,
    cache_read_input_tokens: cacheReadTokens,
    cache_creation_input_tokens: cacheCreationTokens,
    output_tokens: outputTokens,
    total_tokens: values.reduce<number>((total, value) => total + (value ?? 0), 0),
    model: helpers.asString(parsed.model),
  };
}

function unhandledKimiRecord(
  context: FragmentBuildContextLike,
  record: RawRecord,
  recordType: string,
  parsed: Record<string, unknown>,
  timeKey: string,
  helpers: CommonParseRuntimeHelpers,
): ParseRuntimeResult {
  return {
    fragments: [helpers.createFragment(context, record, 0, "unknown", timeKey, parsed)],
    lossAudits: [helpers.createRecordLossAudit(
      context,
      record,
      "unknown_fragment",
      `Unhandled Kimi record type: ${recordType}`,
      { diagnosticCode: "kimi_unhandled_record_type" },
    )],
  };
}
