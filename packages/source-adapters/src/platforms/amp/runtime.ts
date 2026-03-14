import type { LossAuditRecord, RawRecord, SourceFragment } from "@cchistory/domain";
import type {
  AmpParseRuntimeHelpers,
  FragmentBuildContextLike,
  ParseRuntimeResult,
  SessionDraftLike,
} from "../runtime-types.js";

export function parseAmpRecord(
  context: FragmentBuildContextLike,
  record: RawRecord,
  parsed: Record<string, unknown>,
  draft: SessionDraftLike,
  helpers: AmpParseRuntimeHelpers,
): ParseRuntimeResult {
  const fragments: SourceFragment[] = [];
  const lossAudits: LossAuditRecord[] = [];
  const meta = helpers.isObject(parsed.meta) ? parsed.meta : undefined;
  const env = helpers.isObject(parsed.env) ? parsed.env : undefined;
  const initialEnv = env && helpers.isObject(env.initial) ? env.initial : undefined;
  const timeKey =
    helpers.coerceIso(parsed.timestamp) ??
    helpers.epochMillisToIso(helpers.isObject(meta) ? helpers.asNumber(meta.sentAt) : undefined) ??
    helpers.epochMillisToIso(helpers.asNumber(parsed.created)) ??
    helpers.nowIso();

  if (record.record_path_or_offset === "root") {
    const title = helpers.asString(parsed.title);
    if (title) {
      draft.title = title;
      fragments.push(helpers.createFragment(context, record, 0, "title_signal", timeKey, { title }));
    }
    const trees = helpers.asArray(initialEnv?.trees);
    const tree = trees.find((item) => helpers.isObject(item) && helpers.asString(item.uri));
    if (helpers.isObject(tree) && helpers.asString(tree.uri)) {
      const workspace = helpers.normalizeFileUri(helpers.asString(tree.uri) ?? "");
      draft.working_directory = workspace || draft.working_directory;
      fragments.push(
        helpers.createFragment(context, record, 1, "workspace_signal", timeKey, {
          path: workspace,
          display_name: helpers.asString(tree.displayName),
        }),
      );
    }
    return { fragments, lossAudits };
  }

  const role = helpers.asString(parsed.role) ?? "assistant";
  const actorKind = helpers.mapRoleToActor(role);
  const content = helpers.asArray(parsed.content);
  const extractedUsage = helpers.extractTokenUsage(parsed.usage);
  const messageModel = helpers.asString(parsed.model) ?? extractedUsage?.model;
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
  const state = helpers.isObject(parsed.state) ? parsed.state : undefined;
  const stopReason = helpers.normalizeStopReason(state?.stopReason ?? parsed.stopReason);
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
      `Unsupported AMP content item: ${itemType}`,
      "amp_unsupported_content_item",
    );
  }
  if (!usageApplied && usage && actorKind === "assistant") {
    fragments.push(helpers.createTokenUsageFragment(context, record, localSeq++, timeKey, usage, stopReason));
  }
  return { fragments, lossAudits };
}
