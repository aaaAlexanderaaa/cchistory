import type { LossAuditRecord, RawRecord, SourceFragment } from "@cchistory/domain";
import type {
  ClaudeParseRuntimeHelpers,
  FragmentBuildContextLike,
  ParseRuntimeResult,
  SessionDraftLike,
} from "../runtime-types.js";

export function parseClaudeRecord(
  context: FragmentBuildContextLike,
  record: RawRecord,
  parsed: Record<string, unknown>,
  draft: SessionDraftLike,
  helpers: ClaudeParseRuntimeHelpers,
): ParseRuntimeResult {
  const fragments: SourceFragment[] = [];
  const lossAudits: LossAuditRecord[] = [];
  const timeKey = helpers.coerceIso(parsed.timestamp) ?? helpers.nowIso();
  const recordType = helpers.asString(parsed.type) ?? "unknown";
  if (helpers.asString(parsed.cwd)) {
    draft.working_directory = helpers.asString(parsed.cwd) ?? draft.working_directory;
    fragments.push(
      helpers.createFragment(context, record, fragments.length, "workspace_signal", timeKey, {
        path: helpers.asString(parsed.cwd),
      }),
    );
  }
  if (parsed.parentUuid || parsed.parentId || parsed.isSidechain) {
    fragments.push(
      helpers.createFragment(context, record, fragments.length, "session_relation", timeKey, {
        parent_uuid: helpers.asString(parsed.parentUuid) ?? helpers.asString(parsed.parentId),
        is_sidechain: Boolean(parsed.isSidechain),
      }),
    );
  }
  const message = helpers.isObject(parsed.message) ? parsed.message : undefined;
  const role =
    helpers.asString(message?.role) ??
    (recordType === "assistant" ? "assistant" : recordType === "user" ? "user" : "system");
  const actorKind = helpers.mapRoleToActor(role);
  const content = helpers.asArray(message?.content);
  const usage = helpers.extractTokenUsage(message);
  const stopReason = helpers.normalizeStopReason(message?.stop_reason);
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
    const text = helpers.extractTextFromContentItem(item);
    if (text) {
      if (helpers.isClaudeInterruptionMarker(text)) {
        fragments.push(
          helpers.createFragment(context, record, localSeq++, "text", timeKey, {
            actor_kind: "system",
            origin_kind: "source_meta",
            text: text.trim(),
            display_policy: "hide",
          }),
        );
        lossAudits.push(
          helpers.createLossAudit(
            context.source.id,
            record.id,
            "dropped_for_projection",
            "Claude interruption marker preserved as source meta and excluded from UserTurn anchors",
            {
              stageKind: "finalize_projections",
              diagnosticCode: "claude_interruption_marker_excluded",
              severity: "info",
              sessionRef: record.session_ref,
              blobRef: record.blob_id,
              recordRef: record.id,
              sourceFormatProfileId: context.profileId,
            },
          ),
        );
        continue;
      }
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
      `Unsupported Claude content item: ${itemType}`,
      "claude_unsupported_content_item",
    );
  }
  if (!usageApplied && usage && actorKind === "assistant") {
    fragments.push(helpers.createTokenUsageFragment(context, record, localSeq++, timeKey, usage, stopReason));
  }
  return { fragments, lossAudits };
}
