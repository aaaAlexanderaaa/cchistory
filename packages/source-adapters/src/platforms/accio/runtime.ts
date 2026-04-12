import type { LossAuditRecord, RawRecord, SourceFragment } from "@cchistory/domain";
import type {
  FragmentBuildContextLike,
  GenericParseRuntimeHelpers,
  ParseRuntimeResult,
  SessionDraftLike,
} from "../runtime-types.js";

/**
 * Accio agent-layer message schema:
 *
 * {
 *   id: string,
 *   timestamp: number (epoch ms),
 *   role: "user" | "assistant" | "tool" | "system",
 *   content: string,
 *   messageType?: "normal" | "tool_call" | "tool_result",
 *   toolCalls?: Array<{ id, name, arguments: Record<string, unknown> }>,
 *   metadata?: {
 *     usage?: { prompt_tokens, completion_tokens, total_tokens, reasoning_tokens },
 *     agentType?: string,
 *     agentId?: string,
 *     is_error?: boolean,
 *   }
 * }
 *
 * Subagent meta schema:
 * {
 *   sessionKey: string,
 *   agentId: string,            // "explore" | "bash" | "general" | "browser"
 *   parentSessionKey: string,
 *   status: "completed" | "running",
 *   label?: string,
 * }
 */

export function parseAccioRecord(
  context: FragmentBuildContextLike,
  record: RawRecord,
  parsed: Record<string, unknown>,
  draft: SessionDraftLike,
  helpers: GenericParseRuntimeHelpers,
): ParseRuntimeResult {
  const fragments: SourceFragment[] = [];
  const lossAudits: LossAuditRecord[] = [];

  const timestampMs = helpers.asNumber(parsed.timestamp);
  const timeKey =
    helpers.epochMillisToIso(timestampMs) ??
    helpers.coerceIso(parsed.timestamp) ??
    helpers.nowIso();

  // Subagent meta records (from *.meta.jsonc companion evidence)
  if (parsed.parentSessionKey && parsed.sessionKey) {
    const parentKey = helpers.asString(parsed.parentSessionKey);
    const agentId = helpers.asString(parsed.agentId);
    const label = helpers.asString(parsed.label);

    if (label) {
      draft.title = draft.title ?? label;
      fragments.push(
        helpers.createFragment(context, record, fragments.length, "title_signal", timeKey, {
          title: label,
        }),
      );
    }

    fragments.push(
      helpers.createFragment(context, record, fragments.length, "session_relation", timeKey, {
        parent_uuid: parentKey,
        is_sidechain: true,
        agent_id: agentId,
        relation_kind: "subagent",
      }),
    );
    return { fragments, lossAudits };
  }

  // Session meta records (from *.meta.jsonc companion evidence)
  if (parsed.sessionId && !parsed.role) {
    const title = helpers.asString(parsed.title);
    if (title) {
      draft.title = draft.title ?? title;
      fragments.push(
        helpers.createFragment(context, record, fragments.length, "title_signal", timeKey, {
          title,
        }),
      );
    }
    return { fragments, lossAudits };
  }

  // Conversation metadata records (from conversations/dm/CID-xxx.jsonc)
  if (parsed.id && helpers.asString(parsed.id)?.startsWith("CID-") && !parsed.role) {
    const title = helpers.asString(parsed.title);
    const sessionModel = helpers.asString(parsed.sessionModel);
    const workspacePath = helpers.asString(parsed.path);

    if (title && title !== "Session") {
      draft.title = title;
      fragments.push(
        helpers.createFragment(context, record, fragments.length, "title_signal", timeKey, {
          title,
        }),
      );
    }

    if (sessionModel) {
      draft.model = sessionModel;
      fragments.push(
        helpers.createFragment(context, record, fragments.length, "model_signal", timeKey, {
          model: sessionModel,
        }),
      );
    }

    if (workspacePath) {
      draft.working_directory = workspacePath;
      fragments.push(
        helpers.createFragment(context, record, fragments.length, "workspace_signal", timeKey, {
          working_directory: workspacePath,
        }),
      );
    }

    return { fragments, lossAudits };
  }

  const role = helpers.asString(parsed.role) ?? "system";
  const actorKind = helpers.mapRoleToActor(role);
  const content = helpers.asString(parsed.content);
  const messageType = helpers.asString(parsed.messageType);

  // Extract metadata
  const metadata = helpers.isObject(parsed.metadata) ? parsed.metadata : undefined;
  const usageRaw = helpers.isObject(metadata?.usage) ? (metadata.usage as Record<string, unknown>) : undefined;
  const usage = usageRaw
    ? helpers.extractTokenUsage(usageRaw)
    : undefined;
  const isError = metadata ? helpers.asBoolean(metadata.is_error) ?? helpers.asBoolean(metadata.isError) : undefined;

  // Tool calls from the toolCalls array
  const toolCalls = helpers.asArray(parsed.toolCalls);
  let localSeq = 0;
  let usageApplied = false;

  // Emit text content
  if (content && content.trim()) {
    if (isError) {
      fragments.push(
        helpers.createFragment(context, record, localSeq++, "text", timeKey, {
          actor_kind: actorKind,
          origin_kind: "source_meta",
          text: content.trim(),
          display_policy: "show",
          is_error: true,
        }),
      );
    } else {
      const stopReason = helpers.normalizeStopReason(parsed.stop_reason ?? parsed.stopReason);
      const appended = helpers.appendChunkedTextFragments(
        context,
        record,
        fragments,
        timeKey,
        actorKind,
        content,
        localSeq,
        { usage, stopReason, usageApplied },
      );
      localSeq = appended.nextSeq;
      usageApplied = appended.usageApplied;
    }
  }

  // Emit tool calls
  for (const call of toolCalls) {
    if (!helpers.isObject(call)) {
      continue;
    }
    const callId = helpers.asString(call.id);
    const toolName = helpers.asString(call.name) ?? "unknown_tool";
    const input = helpers.isObject(call.arguments) ? call.arguments : undefined;
    const inputStr = typeof call.arguments === "string" ? helpers.safeJsonParse(call.arguments) : undefined;
    const resolvedInput = input ?? (helpers.isObject(inputStr) ? inputStr : {});

    fragments.push(
      helpers.createFragment(context, record, localSeq++, "tool_call", timeKey, {
        call_id: callId,
        tool_name: toolName,
        input: resolvedInput,
      }),
    );
  }

  // Tool result messages: the entire content is the tool output
  if (role === "tool" && content) {
    const toolCallId =
      helpers.asString(parsed.toolCallId) ??
      helpers.asString(parsed.tool_call_id) ??
      helpers.asString(parsed.tool_use_id);

    fragments.push(
      helpers.createFragment(context, record, localSeq++, "tool_result", timeKey, {
        call_id: toolCallId,
        output: helpers.stringifyToolContent(content),
      }),
    );
  }

  // Token usage (only on assistant messages)
  if (!usageApplied && usage && actorKind === "assistant") {
    fragments.push(
      helpers.createTokenUsageFragment(context, record, localSeq++, timeKey, usage),
    );
  }

  if (fragments.length === 0 && content === undefined && toolCalls.length === 0) {
    lossAudits.push(
      helpers.createRecordLossAudit(
        context,
        record,
        "unknown_fragment",
        `Accio record with role=${role} messageType=${messageType} produced no fragments`,
        {
          diagnosticCode: "accio_empty_record",
          severity: "info",
        },
      ),
    );
  }

  return { fragments, lossAudits };
}
