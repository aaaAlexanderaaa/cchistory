import type { LossAuditRecord, RawRecord, SourceFragment } from "@cchistory/domain";
import type {
  FragmentBuildContextLike,
  GenericParseRuntimeHelpers,
  ParseRuntimeResult,
  SessionDraftLike,
} from "../runtime-types.js";

export function parseOpenClawCronRunRecord(
  context: FragmentBuildContextLike,
  record: RawRecord,
  parsed: Record<string, unknown>,
  draft: SessionDraftLike,
  helpers: GenericParseRuntimeHelpers,
): ParseRuntimeResult {
  const fragments: SourceFragment[] = [];
  const lossAudits: LossAuditRecord[] = [];
  const runAtMs = helpers.asNumber(parsed.runAtMs) ?? helpers.asNumber(parsed.startedAtMs);
  const timeKey =
    helpers.coerceIso(parsed.timestamp) ??
    helpers.coerceIso(parsed.runAt) ??
    helpers.epochMillisToIso(runAtMs) ??
    helpers.nowIso();

  const jobId = helpers.asString(parsed.jobId) ?? helpers.asString(parsed.job_id);
  const sessionId = helpers.asString(parsed.sessionId) ?? helpers.asString(parsed.session_id);
  const sessionKey = helpers.asString(parsed.sessionKey) ?? helpers.asString(parsed.session_key);
  const status = helpers.asString(parsed.status);
  const summary = helpers.asString(parsed.summary);

  if (jobId) {
    const title = `cron:${jobId}`;
    draft.title = draft.title ?? title;
    fragments.push(
      helpers.createFragment(context, record, fragments.length, "title_signal", timeKey, {
        title,
      }),
    );
  }

  if (sessionId || sessionKey || jobId || status) {
    fragments.push(
      helpers.createFragment(context, record, fragments.length, "session_relation", timeKey, {
        parent_uuid: sessionId,
        session_key: sessionKey,
        job_id: jobId,
        status,
        relation_kind: "automation_run",
      }),
    );
  }

  if (summary) {
    fragments.push(
      helpers.createFragment(context, record, fragments.length, "text", timeKey, {
        actor_kind: "system",
        origin_kind: "source_meta",
        text: summary,
        display_policy: "show",
        relation_kind: "automation_run",
        job_id: jobId,
        status,
        session_key: sessionKey,
      }),
    );
  }

  return { fragments, lossAudits };
}
