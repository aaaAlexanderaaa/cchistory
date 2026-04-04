import type { LossAuditRecord, RawRecord, SourceFragment } from "@cchistory/domain";
import type {
  FactoryParseRuntimeHelpers,
  FragmentBuildContextLike,
  ParseRuntimeResult,
  SessionDraftLike,
} from "../runtime-types.js";

export function parseFactoryRecord(
  context: FragmentBuildContextLike,
  record: RawRecord,
  parsed: Record<string, unknown>,
  draft: SessionDraftLike,
  helpers: FactoryParseRuntimeHelpers,
): ParseRuntimeResult {
  const fragments: SourceFragment[] = [];
  const lossAudits: LossAuditRecord[] = [];
  const recordType = helpers.asString(parsed.type) ?? "unknown";
  const timeKey = helpers.coerceIso(parsed.timestamp) ?? helpers.nowIso();

  if (record.record_path_or_offset === "settings") {
    if (helpers.asString(parsed.model)) {
      draft.model = helpers.asString(parsed.model) ?? draft.model;
      fragments.push(
        helpers.createFragment(context, record, 0, "model_signal", timeKey, {
          model: helpers.asString(parsed.model),
        }),
      );
    }
    const tokenUsage = helpers.extractTokenUsage(parsed.tokenUsage ?? parsed.usage);
    if (tokenUsage) {
      fragments.push(
        helpers.createTokenUsageFragment(context, record, fragments.length, timeKey, tokenUsage, undefined, {
          scope: "session",
          source_event_type: "settings_token_usage",
        }),
      );
    }
    return { fragments, lossAudits };
  }

  if (recordType === "session_start") {
    draft.title = helpers.asString(parsed.sessionTitle) ?? helpers.asString(parsed.title) ?? draft.title;
    draft.working_directory = helpers.asString(parsed.cwd) ?? draft.working_directory;
    fragments.push(helpers.createFragment(context, record, 0, "session_meta", timeKey, parsed));
    if (draft.title) {
      fragments.push(
        helpers.createFragment(context, record, 1, "title_signal", timeKey, {
          title: draft.title,
        }),
      );
    }
    if (draft.working_directory) {
      fragments.push(
        helpers.createFragment(context, record, 2, "workspace_signal", timeKey, {
          path: draft.working_directory,
        }),
      );
    }
    return { fragments, lossAudits };
  }

  if (recordType === "message" && helpers.isObject(parsed.message)) {
    const message = parsed.message;
    const role = helpers.asString(message.role) ?? "assistant";
    const actorKind = helpers.mapRoleToActor(role);
    const content = helpers.asArray(message.content);
    const extractedUsage = helpers.extractTokenUsage(message);
    const messageModel = helpers.asString(message.model) ?? extractedUsage?.model;
    const parentSessionRef =
      helpers.asString(parsed.callingSessionId) ??
      helpers.asString(parsed.calling_session_id) ??
      helpers.asString(parsed.parentUuid) ??
      helpers.asString(parsed.parent_uuid) ??
      helpers.asString(parsed.parentId) ??
      helpers.asString(parsed.parent_id);
    const parentToolRef =
      helpers.asString(parsed.callingToolUseId) ??
      helpers.asString(parsed.calling_tool_use_id) ??
      helpers.asString(parsed.parentToolRef) ??
      helpers.asString(parsed.parent_tool_ref);
    const childAgentKey =
      helpers.asString(parsed.agentId) ??
      helpers.asString(parsed.agent_id) ??
      helpers.asString(parsed.childAgentKey) ??
      helpers.asString(parsed.child_agent_key);
    const isSidechain = helpers.asBoolean(parsed.isSidechain) ?? helpers.asBoolean(parsed.sidechain);
    if (parentSessionRef || parentToolRef || childAgentKey || isSidechain) {
      fragments.push(
        helpers.createFragment(context, record, fragments.length, "session_relation", timeKey, {
          parent_uuid: parentSessionRef,
          is_sidechain: isSidechain,
          parent_tool_ref: parentToolRef,
          agent_id: childAgentKey,
        }),
      );
    }
    if (actorKind === "assistant" && messageModel) {
      draft.model = messageModel;
      fragments.push(
        helpers.createFragment(context, record, fragments.length, "model_signal", timeKey, {
          model: messageModel,
        }),
      );
    }
    const usage =
      messageModel && extractedUsage && !extractedUsage.model
        ? { ...extractedUsage, model: messageModel }
        : extractedUsage;
    const stopReason = helpers.normalizeStopReason(message.stop_reason);
    let usageApplied = false;
    let localSeq = 0;
    for (const item of content) {
      if (!helpers.isObject(item)) {
        continue;
      }
      const itemType = helpers.asString(item.type) ?? "unknown";
      if (itemType === "tool_use") {
        fragments.push(
          helpers.createFragment(context, record, localSeq++, "tool_call", timeKey, {
            call_id: helpers.asString(item.id),
            tool_name: helpers.asString(item.name) ?? "tool_use",
            input: helpers.isObject(item.input) ? item.input : {},
          }),
        );
        continue;
      }
      if (itemType === "tool_result") {
        fragments.push(
          helpers.createFragment(context, record, localSeq++, "tool_result", timeKey, {
            call_id: helpers.asString(item.tool_use_id),
            output: helpers.stringifyToolContent(item.content),
          }),
        );
        continue;
      }
      if (itemType === "thinking" && helpers.asString(item.thinking)) {
        fragments.push(
          helpers.createFragment(context, record, localSeq++, "text", timeKey, {
            actor_kind: "system",
            origin_kind: "source_meta",
            text: helpers.asString(item.thinking),
            display_policy: "collapse",
          }),
        );
        continue;
      }
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
      localSeq = helpers.appendUnsupportedContentItem(
        context,
        record,
        fragments,
        lossAudits,
        timeKey,
        localSeq,
        item,
        `Unsupported Factory Droid content item: ${itemType}`,
        "factory_droid_unsupported_content_item",
      );
    }
    if (!usageApplied && usage && actorKind === "assistant") {
      fragments.push(helpers.createTokenUsageFragment(context, record, localSeq++, timeKey, usage, stopReason));
    }
    return { fragments, lossAudits };
  }

  lossAudits.push(
    helpers.createRecordLossAudit(
      context,
      record,
      "unknown_fragment",
      `Unhandled Factory Droid record type: ${recordType}`,
      { diagnosticCode: "factory_droid_unhandled_record_type" },
    ),
  );
  fragments.push(helpers.createFragment(context, record, 0, "unknown", timeKey, parsed));
  return { fragments, lossAudits };
}
