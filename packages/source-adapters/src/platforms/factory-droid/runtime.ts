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

  if (recordType === "todo_state" || recordType === "session_end" || recordType === "compaction_state") {
    fragments.push(createFactoryLifecycleFragment(context, record, timeKey, recordType, parsed, helpers));
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

function createFactoryLifecycleFragment(
  context: FragmentBuildContextLike,
  record: RawRecord,
  timeKey: string,
  recordType: string,
  parsed: Record<string, unknown>,
  helpers: FactoryParseRuntimeHelpers,
): SourceFragment {
  const todos = extractFactoryTodoItems(parsed, helpers);
  const todoText = extractFactoryTodoText(parsed, helpers);
  const summary = firstFactoryLifecycleText(helpers, parsed.summary, parsed.summaryText, parsed.summary_text);
  const finalText = firstFactoryLifecycleText(helpers, parsed.finalText, parsed.final_text);
  const lifecycleText = todoText ?? summary ?? finalText;
  const todoStatusCounts = summarizeFactoryTodoStatuses(todos, todoText, helpers);
  return helpers.createFragment(context, record, 0, "unknown", timeKey, {
    signal_kind: recordType,
    source_event_type: recordType,
    source_event_id: helpers.asString(parsed.id),
    status: helpers.asString(parsed.status),
    reason: helpers.asString(parsed.reason),
    message_index: helpers.asNumber(parsed.messageIndex ?? parsed.message_index),
    duration_ms: helpers.asNumber(parsed.durationMs ?? parsed.duration_ms),
    tool_count: helpers.asNumber(parsed.toolCount ?? parsed.tool_count),
    todo_item_count: todos.length || undefined,
    todo_status_counts: todoStatusCounts,
    todo_text_present: todoText !== undefined,
    todo_text_bytes: todoText ? todoText.length : undefined,
    summary_present: summary !== undefined,
    summary_bytes: summary ? summary.length : undefined,
    final_text_present: finalText !== undefined,
    final_text_bytes: finalText ? finalText.length : undefined,
    lifecycle_text_kind: lifecycleText ? recordType : undefined,
    lifecycle_text_present: lifecycleText !== undefined,
    lifecycle_text_bytes: lifecycleText ? lifecycleText.length : undefined,
    lifecycle_text_preview: lifecycleText ? previewFactoryLifecycleText(lifecycleText) : undefined,
    compacted: helpers.asBoolean(parsed.compacted),
  });
}

function extractFactoryTodoItems(
  parsed: Record<string, unknown>,
  helpers: FactoryParseRuntimeHelpers,
): unknown[] {
  for (const candidate of [parsed.todos, parsed.items, parsed.tasks, parsed.todoState, parsed.todo_state]) {
    const directItems = helpers.asArray(candidate);
    if (directItems.length > 0) {
      return directItems;
    }
    if (!helpers.isObject(candidate)) {
      continue;
    }
    for (const nestedKey of ["items", "tasks", "todos"]) {
      const nestedItems = helpers.asArray(candidate[nestedKey]);
      if (nestedItems.length > 0) {
        return nestedItems;
      }
    }
  }
  return [];
}

function extractFactoryTodoText(
  parsed: Record<string, unknown>,
  helpers: FactoryParseRuntimeHelpers,
): string | undefined {
  const todos = parsed.todos;
  if (helpers.isObject(todos)) {
    return firstFactoryLifecycleText(
      helpers,
      todos.todos,
      todos.text,
      todos.markdown,
      todos.summary,
      parsed.todoText,
      parsed.todo_text,
    );
  }
  return firstFactoryLifecycleText(helpers, parsed.todoText, parsed.todo_text, todos);
}

function firstFactoryLifecycleText(
  helpers: FactoryParseRuntimeHelpers,
  ...values: unknown[]
): string | undefined {
  for (const value of values) {
    const text = helpers.asString(value)?.trim();
    if (text) {
      return text;
    }
  }
  return undefined;
}

function summarizeFactoryTodoStatuses(
  todos: unknown[],
  todoText: string | undefined,
  helpers: FactoryParseRuntimeHelpers,
): Record<string, number> | undefined {
  const counts: Record<string, number> = {};
  const addStatus = (value: unknown) => {
    const status = helpers.asString(value)?.trim().toLowerCase().replace(/\s+/gu, "_");
    if (!status) {
      return;
    }
    counts[status] = (counts[status] ?? 0) + 1;
  };

  for (const todo of todos) {
    if (helpers.isObject(todo)) {
      addStatus(todo.status ?? todo.state);
      continue;
    }
    const todoLine = helpers.asString(todo);
    if (!todoLine) {
      continue;
    }
    const match = todoLine.match(/\[([^\]]+)\]/u);
    addStatus(match?.[1]);
  }

  if (todoText) {
    const matches = todoText.matchAll(/^\s*(?:\d+\.\s*)?\[([^\]]+)\]/gmu);
    for (const match of matches) {
      addStatus(match[1]);
    }
  }

  return Object.keys(counts).length > 0 ? counts : undefined;
}

function previewFactoryLifecycleText(text: string): string {
  const normalized = text.replace(/\s+/gu, " ").trim();
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 237)}...`;
}
