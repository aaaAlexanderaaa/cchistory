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
  }

  if (type === "event_msg" && helpers.isObject(parsed.payload) && helpers.asString(parsed.payload.type) === "token_count") {
    const usage = helpers.extractTokenUsage(parsed.payload.info ?? parsed.payload);
    const cumulativeUsage = helpers.extractCumulativeTokenUsage(parsed.payload.info ?? parsed.payload);
    const deltaUsage = helpers.diffTokenUsageMetrics(cumulativeUsage, draft.last_cumulative_token_usage) ?? undefined;
    draft.last_cumulative_token_usage = cumulativeUsage ?? draft.last_cumulative_token_usage;
    if (usage) {
      fragments.push(
        helpers.createTokenUsageFragment(context, record, 0, timeKey, usage, undefined, {
          scope: "turn",
          source_event_type: "token_count",
          delta_token_usage: deltaUsage,
          cumulative_token_usage: cumulativeUsage,
        }),
      );
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
