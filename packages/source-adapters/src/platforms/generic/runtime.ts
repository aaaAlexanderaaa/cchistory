import type { LossAuditRecord, RawRecord, SourceFragment } from "@cchistory/domain";
import type {
  FragmentBuildContextLike,
  GenericParseRuntimeHelpers,
  ParseRuntimeResult,
  SessionDraftLike,
} from "../runtime-types.js";

export interface GenericSessionMetadata {
  workspacePath?: string;
  repoRoot?: string;
  repoRemote?: string;
  model?: string;
  title?: string;
  parentUuid?: string;
  isSidechain?: boolean;
  parentToolRef?: string;
  childAgentKey?: string;
}

export function parseGenericConversationRecord(
  context: FragmentBuildContextLike,
  record: RawRecord,
  parsed: Record<string, unknown>,
  draft: SessionDraftLike,
  helpers: GenericParseRuntimeHelpers,
): ParseRuntimeResult {
  const fragments: SourceFragment[] = [];
  const lossAudits: LossAuditRecord[] = [];
  const timeKey =
    helpers.coerceIso(parsed.timestamp) ??
    helpers.coerceIso(parsed.updatedAt) ??
    helpers.coerceIso(parsed.createdAt) ??
    helpers.coerceIso(parsed.created_at) ??
    helpers.nowIso();

  const meta = extractGenericSessionMetadata(parsed, helpers);
  if (meta.workspacePath) {
    draft.working_directory = meta.workspacePath;
    fragments.push(
      helpers.createFragment(context, record, fragments.length, "workspace_signal", timeKey, {
        path: meta.workspacePath,
        repo_root: meta.repoRoot,
        repo_remote: meta.repoRemote,
      }),
    );
  }
  if (meta.model) {
    draft.model = meta.model;
    fragments.push(
      helpers.createFragment(context, record, fragments.length, "model_signal", timeKey, {
        model: meta.model,
      }),
    );
  }
  if (meta.title) {
    draft.title = draft.title ?? meta.title;
    fragments.push(
      helpers.createFragment(context, record, fragments.length, "title_signal", timeKey, {
        title: meta.title,
      }),
    );
  }
  if (meta.parentUuid || meta.isSidechain || meta.parentToolRef || meta.childAgentKey) {
    fragments.push(
      helpers.createFragment(context, record, fragments.length, "session_relation", timeKey, {
        parent_uuid: meta.parentUuid,
        is_sidechain: meta.isSidechain,
        parent_tool_ref: meta.parentToolRef,
        agent_id: meta.childAgentKey,
      }),
    );
  }

  const message = helpers.isObject(parsed.message) ? parsed.message : parsed;
  const role = extractGenericRole(parsed, helpers) ?? extractGenericRole(message, helpers);
  let contentItems = extractGenericContentItems(message, helpers);
  const normalizedRole = normalizeGenericRoleTag(role);
  if ((normalizedRole === "tool_result" || normalizedRole === "toolresult") && contentItems.length > 0) {
    contentItems = [{
      type: "tool_result",
      tool_use_id:
        helpers.asString(message.toolUseId) ??
        helpers.asString(message.tool_use_id) ??
        helpers.asString(message.toolCallId) ??
        helpers.asString(message.tool_call_id) ??
        helpers.asString(message.id),
      tool_name: helpers.asString(message.toolName) ?? helpers.asString(message.tool_name),
      content: message.content,
    }];
  }
  const usage = helpers.extractTokenUsage(message.usage ?? parsed.usage);
  const stopReason = helpers.normalizeStopReason(
    message.stop_reason ?? message.stopReason ?? parsed.stop_reason ?? parsed.stopReason,
  );
  let usageApplied = false;
  let localSeq = 0;

  if (!role && fragments.length > 0 && contentItems.length === 0) {
    return { fragments, lossAudits };
  }

  if (!role && contentItems.length === 0) {
    fragments.push(helpers.createFragment(context, record, 0, "unknown", timeKey, parsed));
    lossAudits.push(
      helpers.createRecordLossAudit(
        context,
        record,
        "unknown_fragment",
        `Unhandled ${context.source.platform} record without recognizable role or content`,
        {
          diagnosticCode: `${context.source.platform}_unhandled_record`,
        },
      ),
    );
    return { fragments, lossAudits };
  }

  const actorKind = helpers.mapRoleToActor(role ?? "assistant");
  for (const item of contentItems) {
    const itemType = normalizeGenericContentItemType(helpers.asString(item.type));
    if (itemType === "tool_use" || itemType === "tool_call" || itemType === "function_call") {
      fragments.push(
        helpers.createFragment(context, record, localSeq++, "tool_call", timeKey, {
          call_id: helpers.asString(item.id) ?? helpers.asString(item.call_id) ?? helpers.asString(item.tool_call_id),
          tool_name: helpers.asString(item.name) ?? helpers.asString(item.tool_name) ?? itemType,
          input: normalizeToolInput(item.input ?? item.arguments ?? item.args, helpers),
        }),
      );
      continue;
    }
    if (itemType === "tool_result" || itemType === "function_result" || itemType === "function_call_output") {
      fragments.push(
        helpers.createFragment(context, record, localSeq++, "tool_result", timeKey, {
          call_id: helpers.asString(item.tool_use_id) ?? helpers.asString(item.call_id) ?? helpers.asString(item.id),
          output: helpers.stringifyToolContent(item.content ?? item.output ?? item.result ?? item.text),
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
      `Unsupported ${context.source.platform} content item: ${itemType}`,
      `${context.source.platform}_unsupported_content_item`,
    );
  }

  if (!usageApplied && usage && actorKind === "assistant") {
    fragments.push(helpers.createTokenUsageFragment(context, record, localSeq++, timeKey, usage, stopReason));
  }

  return { fragments, lossAudits };
}

export function extractGenericSessionMetadata(
  parsed: Record<string, unknown>,
  helpers: Pick<GenericParseRuntimeHelpers, "isObject" | "asString" | "asBoolean" | "normalizeWorkspacePath">,
): GenericSessionMetadata {
  const metadata = helpers.isObject(parsed.metadata) ? parsed.metadata : undefined;
  const session = helpers.isObject(parsed.session) ? parsed.session : undefined;
  const message = helpers.isObject(parsed.message) ? parsed.message : undefined;
  const workspace = helpers.isObject(parsed.workspace) ? parsed.workspace : undefined;
  const project = helpers.isObject(parsed.project) ? parsed.project : undefined;
  const repository = helpers.isObject(parsed.repository) ? parsed.repository : undefined;
  const antigravityLive = helpers.isObject(parsed.antigravityLive) ? parsed.antigravityLive : undefined;
  const antigravitySummary = helpers.isObject(antigravityLive?.summary) ? antigravityLive.summary : undefined;
  const antigravityWorkspace = Array.isArray(antigravitySummary?.workspaces)
    ? antigravitySummary.workspaces.find((candidate): candidate is Record<string, unknown> => helpers.isObject(candidate))
    : undefined;
  const antigravityRepository = helpers.isObject(antigravityWorkspace?.repository)
    ? antigravityWorkspace.repository
    : undefined;

  const workspaceCandidate =
    helpers.asString(parsed.cwd) ??
    helpers.asString(parsed.workingDirectory) ??
    helpers.asString(parsed.working_directory) ??
    helpers.asString(parsed.workspacePath) ??
    helpers.asString(parsed.directory) ??
    helpers.asString(metadata?.cwd) ??
    helpers.asString(metadata?.workingDirectory) ??
    helpers.asString(session?.cwd) ??
    helpers.asString(session?.workingDirectory) ??
    helpers.asString(message?.cwd) ??
    helpers.asString(workspace?.path) ??
    helpers.asString(workspace?.uri) ??
    helpers.asString(project?.path) ??
    helpers.asString(antigravityWorkspace?.workspaceFolderAbsoluteUri);

  const repoRootCandidate =
    helpers.asString(parsed.repoRoot) ??
    helpers.asString(parsed.repo_root) ??
    helpers.asString(metadata?.repoRoot) ??
    helpers.asString(metadata?.repo_root) ??
    helpers.asString(session?.repoRoot) ??
    helpers.asString(session?.repo_root) ??
    helpers.asString(message?.repoRoot) ??
    helpers.asString(message?.repo_root) ??
    helpers.asString(workspace?.repoRoot) ??
    helpers.asString(workspace?.repo_root) ??
    helpers.asString(workspace?.gitRootAbsoluteUri) ??
    helpers.asString(project?.repoRoot) ??
    helpers.asString(project?.repo_root) ??
    helpers.asString(antigravityWorkspace?.gitRootAbsoluteUri);

  const repoRemoteCandidate =
    helpers.asString(parsed.repoRemote) ??
    helpers.asString(parsed.repo_remote) ??
    helpers.asString(metadata?.repoRemote) ??
    helpers.asString(metadata?.repo_remote) ??
    helpers.asString(session?.repoRemote) ??
    helpers.asString(session?.repo_remote) ??
    helpers.asString(message?.repoRemote) ??
    helpers.asString(message?.repo_remote) ??
    helpers.asString(workspace?.repoRemote) ??
    helpers.asString(workspace?.repo_remote) ??
    helpers.asString(workspace?.gitOriginUrl) ??
    helpers.asString(project?.repoRemote) ??
    helpers.asString(project?.repo_remote) ??
    helpers.asString(project?.gitOriginUrl) ??
    helpers.asString(repository?.gitOriginUrl) ??
    helpers.asString(antigravityRepository?.gitOriginUrl);

  return {
    workspacePath: workspaceCandidate ? helpers.normalizeWorkspacePath(workspaceCandidate) : undefined,
    repoRoot: repoRootCandidate ? helpers.normalizeWorkspacePath(repoRootCandidate) : undefined,
    repoRemote: repoRemoteCandidate?.trim() || undefined,
    model:
      helpers.asString(parsed.model) ??
      helpers.asString(parsed.modelId) ??
      helpers.asString(parsed.model_id) ??
      helpers.asString(parsed.modelName) ??
      helpers.asString(parsed.model_name) ??
      helpers.asString(parsed.providerModel) ??
      helpers.asString(metadata?.model) ??
      helpers.asString(session?.model) ??
      helpers.asString(message?.model) ??
      (helpers.isObject(parsed.data) ? helpers.asString(parsed.data.modelId) ?? helpers.asString(parsed.data.model) : undefined),
    title:
      helpers.asString(parsed.title) ??
      helpers.asString(parsed.name) ??
      helpers.asString(parsed.label) ??
      helpers.asString(parsed.sessionTitle) ??
      helpers.asString(session?.title),
    parentUuid:
      helpers.asString(parsed.parentUuid) ??
      helpers.asString(parsed.parentId) ??
      helpers.asString(parsed.parent_id) ??
      helpers.asString(parsed.callingSessionId) ??
      helpers.asString(parsed.calling_session_id) ??
      helpers.asString(session?.parentUuid) ??
      helpers.asString(session?.parentId) ??
      helpers.asString(session?.parent_id) ??
      helpers.asString(session?.callingSessionId) ??
      helpers.asString(session?.calling_session_id),
    isSidechain:
      helpers.asBoolean(parsed.isSidechain) ??
      helpers.asBoolean(parsed.sidechain) ??
      helpers.asBoolean(session?.isSidechain),
    parentToolRef:
      helpers.asString(parsed.parentToolRef) ??
      helpers.asString(parsed.parent_tool_ref) ??
      helpers.asString(parsed.callingToolUseId) ??
      helpers.asString(parsed.calling_tool_use_id) ??
      helpers.asString(session?.parentToolRef) ??
      helpers.asString(session?.parent_tool_ref) ??
      helpers.asString(session?.callingToolUseId) ??
      helpers.asString(session?.calling_tool_use_id),
    childAgentKey:
      helpers.asString(parsed.agentId) ??
      helpers.asString(parsed.agent_id) ??
      helpers.asString(parsed.childAgentKey) ??
      helpers.asString(parsed.child_agent_key) ??
      helpers.asString(session?.agentId) ??
      helpers.asString(session?.agent_id) ??
      helpers.asString(session?.childAgentKey) ??
      helpers.asString(session?.child_agent_key),
  };
}

function normalizeGenericRoleTag(value: string | undefined): string | undefined {
  return value?.trim().replace(/([a-z0-9])([A-Z])/gu, "$1_$2").replace(/[\s-]+/gu, "_").toLowerCase();
}

function normalizeGenericContentItemType(value: string | undefined): string {
  return normalizeGenericRoleTag(value) ?? "unknown";
}

export function extractGenericRole(
  message: Record<string, unknown>,
  helpers: Pick<GenericParseRuntimeHelpers, "isObject" | "asString">,
): string | undefined {
  const author = helpers.isObject(message.author) ? message.author : undefined;
  const sender = helpers.isObject(message.sender) ? message.sender : undefined;
  const info = helpers.isObject(message.info) ? message.info : undefined;
  const rawRole =
    helpers.asString(message.role) ??
    helpers.asString(author?.role) ??
    helpers.asString(author?.type) ??
    helpers.asString(message.author) ??
    helpers.asString(sender?.role) ??
    helpers.asString(message.sender) ??
    helpers.asString(message.from) ??
    helpers.asString(info?.role);
  const normalized = rawRole?.trim().toLowerCase();
  if (!normalized) {
    const type = helpers.asString(message.type)?.trim().toLowerCase();
    if (type === "user" || type === "assistant" || type === "system" || type === "developer") {
      return type;
    }
    return undefined;
  }
  if (normalized === "human" || normalized === "user" || normalized === "operator") {
    return "user";
  }
  if (normalized === "assistant" || normalized === "ai" || normalized === "model" || normalized === "bot") {
    return "assistant";
  }
  if (normalized === "developer" || normalized === "system" || normalized === "instruction") {
    return "system";
  }
  if (normalized === "tool") {
    return "assistant";
  }
  return normalized;
}

export function extractGenericContentItems(
  message: Record<string, unknown>,
  helpers: Pick<GenericParseRuntimeHelpers, "isObject" | "asString" | "asArray">,
): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  const pushText = (value: string | undefined) => {
    if (value && value.trim()) {
      items.push({ type: "text", text: value });
    }
  };
  const pushEntries = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (helpers.isObject(entry)) {
          items.push(entry);
        } else if (typeof entry === "string" && entry.trim()) {
          items.push({ type: "text", text: entry });
        }
      }
      return true;
    }
    if (helpers.isObject(value)) {
      items.push(value);
      return true;
    }
    if (typeof value === "string" && value.trim()) {
      items.push({ type: "text", text: value });
      return true;
    }
    return false;
  };

  pushEntries(message.content);
  pushEntries(message.parts);
  pushEntries(message.blocks);

  const toolCalls = helpers.asArray(message.tool_calls);
  for (const toolCall of toolCalls) {
    if (!helpers.isObject(toolCall)) {
      continue;
    }
    items.push({
      type: "tool_call",
      id: helpers.asString(toolCall.id) ?? helpers.asString(toolCall.call_id),
      name: helpers.asString(toolCall.name) ?? helpers.asString(toolCall.tool_name),
      input: toolCall.input ?? toolCall.arguments ?? toolCall.args,
    });
  }
  if (helpers.isObject(message.tool_call)) {
    items.push({
      type: "tool_call",
      id: helpers.asString(message.tool_call.id) ?? helpers.asString(message.tool_call.call_id),
      name: helpers.asString(message.tool_call.name) ?? helpers.asString(message.tool_call.tool_name),
      input: message.tool_call.input ?? message.tool_call.arguments ?? message.tool_call.args,
    });
  }

  const toolResults = helpers.asArray(message.tool_results);
  for (const toolResult of toolResults) {
    if (!helpers.isObject(toolResult)) {
      continue;
    }
    items.push({
      type: "tool_result",
      tool_use_id: helpers.asString(toolResult.tool_use_id) ?? helpers.asString(toolResult.call_id),
      content: toolResult.content ?? toolResult.output ?? toolResult.result ?? toolResult.text,
    });
  }
  if (helpers.isObject(message.tool_result)) {
    items.push({
      type: "tool_result",
      tool_use_id: helpers.asString(message.tool_result.tool_use_id) ?? helpers.asString(message.tool_result.call_id),
      content:
        message.tool_result.content ??
        message.tool_result.output ??
        message.tool_result.result ??
        message.tool_result.text,
    });
  }

  if (items.length === 0) {
    pushText(
      helpers.asString(message.text) ??
        helpers.asString(message.output_text) ??
        helpers.asString(message.input_text) ??
        helpers.asString(message.output) ??
        helpers.asString(message.response) ??
        helpers.asString(message.message),
    );
  }

  return items;
}

export function normalizeToolInput(
  value: unknown,
  helpers: Pick<GenericParseRuntimeHelpers, "isObject" | "safeJsonParse">,
): Record<string, unknown> {
  if (helpers.isObject(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = helpers.safeJsonParse(value);
    return helpers.isObject(parsed) ? parsed : value.trim() ? { raw: value } : {};
  }
  if (Array.isArray(value)) {
    return { items: value };
  }
  if (value === undefined || value === null) {
    return {};
  }
  return { value };
}
