import assert from "node:assert/strict";
import { test } from "node:test";
import type { AtomEdge, ConversationAtom, LossAuditRecord } from "@cchistory/domain";
import type { SessionDraft } from "./types.js";
import { buildSubmissionGroups, buildTurnsAndContext, countLossAuditsByStage } from "./projections.js";

test("buildTurnsAndContext derives many turn spans from indexed lookups", () => {
  const draft: SessionDraft = {
    id: "sess:codex:projection-scale",
    source_id: "src-projection-scale",
    source_platform: "codex",
    host_id: "host-test",
    model: "gpt-5.2",
    working_directory: "/workspace/projection-scale",
  };
  const atoms: ConversationAtom[] = [];
  const edges: AtomEdge[] = [];
  const turnCount = 240;

  for (let turnIndex = 0; turnIndex < turnCount; turnIndex += 1) {
    const baseSeq = turnIndex * 4;
    const timestampBase = `2026-03-09T00:${String(Math.floor(turnIndex / 60)).padStart(2, "0")}:${String(turnIndex % 60).padStart(2, "0")}`;
    const userAtom = createAtom(baseSeq, "user", "text", "user_authored", `${timestampBase}.000Z`, {
      text: `Inspect turn ${turnIndex}.`,
    });
    const assistantAtom = createAtom(baseSeq + 1, "assistant", "text", "assistant_authored", `${timestampBase}.100Z`, {
      text: `Turn ${turnIndex} inspected.`,
      model: "gpt-5.2",
    });
    const toolCallAtom = createAtom(baseSeq + 2, "tool", "tool_call", "tool_generated", `${timestampBase}.200Z`, {
      call_id: `call-${turnIndex}`,
      tool_name: "read_file",
      input: { path: `src/file-${turnIndex}.ts` },
    });
    const toolResultAtom = createAtom(baseSeq + 3, "tool", "tool_result", "tool_generated", `${timestampBase}.300Z`, {
      call_id: `call-${turnIndex}`,
      output: `file ${turnIndex} ok`,
    });
    atoms.push(userAtom, assistantAtom, toolCallAtom, toolResultAtom);
    edges.push(
      {
        id: `edge-spawned-${turnIndex}`,
        source_id: draft.source_id,
        session_ref: draft.id,
        from_atom_id: toolCallAtom.id,
        to_atom_id: assistantAtom.id,
        edge_kind: "spawned_from",
      },
      {
        id: `edge-result-${turnIndex}`,
        source_id: draft.source_id,
        session_ref: draft.id,
        from_atom_id: toolResultAtom.id,
        to_atom_id: toolCallAtom.id,
        edge_kind: "tool_result_for",
      },
    );
  }

  const submissionResult = buildSubmissionGroups(draft, atoms, [...edges]);
  assert.equal(submissionResult.groups.length, turnCount);

  const guardedAtoms = rejectArrayMethods(atoms, ["filter", "findIndex"]);
  const guardedEdges = rejectArrayMethods(submissionResult.edges, ["find"]);
  const result = buildTurnsAndContext(
    draft,
    [],
    [],
    [],
    guardedAtoms,
    submissionResult.groups,
    guardedEdges,
  );

  assert.equal(result.session.turn_count, turnCount);
  assert.equal(result.turns.length, turnCount);
  assert.equal(result.contexts.length, turnCount);
  assert.equal(result.contexts[0]?.assistant_replies[0]?.tool_call_ids.length, 1);
  assert.equal(result.contexts[0]?.tool_calls[0]?.output, "file 0 ok");
  assert.equal(result.contexts.at(-1)?.tool_calls[0]?.output, `file ${turnCount - 1} ok`);
});

test("countLossAuditsByStage excludes informational audits from failure counts", () => {
  const warningAudit = createLossAudit("warning-audit", "warning", "parse_source_fragments");
  const infoAudit = createLossAudit("info-audit", "info", "parse_source_fragments");
  const errorAudit = createLossAudit("error-audit", "error", "finalize_projections");

  const counts = countLossAuditsByStage([warningAudit, infoAudit, errorAudit]);

  assert.equal(counts.parse_source_fragments, 1);
  assert.equal(counts.finalize_projections, 1);
});

function rejectArrayMethods<T>(items: T[], methodNames: string[]): T[] {
  return new Proxy(items, {
    get(target, property, receiver) {
      if (typeof property === "string" && methodNames.includes(property)) {
        throw new Error(`unexpected ${property} scan`);
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function createAtom(
  seqNo: number,
  actorKind: ConversationAtom["actor_kind"],
  contentKind: ConversationAtom["content_kind"],
  originKind: ConversationAtom["origin_kind"],
  timeKey: string,
  payload: Record<string, unknown>,
): ConversationAtom {
  return {
    id: `atom-${seqNo}`,
    source_id: "src-projection-scale",
    session_ref: "sess:codex:projection-scale",
    seq_no: seqNo,
    actor_kind: actorKind,
    origin_kind: originKind,
    content_kind: contentKind,
    time_key: timeKey,
    display_policy: "show",
    payload,
    fragment_refs: [],
    source_format_profile_id: "profile-test",
  };
}

function createLossAudit(
  id: string,
  severity: LossAuditRecord["severity"],
  stageKind: LossAuditRecord["stage_kind"],
): LossAuditRecord {
  return {
    id,
    source_id: "src-projection-scale",
    stage_run_id: `stage-${stageKind}`,
    stage_kind: stageKind,
    diagnostic_code: id,
    severity,
    scope_ref: id,
    loss_kind: "dropped_for_projection",
    detail: id,
    created_at: "2026-03-09T00:00:00.000Z",
  };
}
