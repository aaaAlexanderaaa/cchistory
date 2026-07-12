import assert from "node:assert/strict";
import { test } from "node:test";
import type { AtomEdge, ConversationAtom } from "@cchistory/domain";
import type { SessionDraft } from "./types.js";
import { buildAskUserQuestionTurns } from "./projections.js";

test("buildAskUserQuestionTurns synthesizes Claude AskUserQuestion pairs", () => {
  const draft = makeDraft("sess:claude:aqq", "claude_code");
  const callAtom = makeAtom(0, "tool", "tool_call", "tool_generated", "2026-07-11T10:00:00.000Z", {
    call_id: "call-1",
    tool_name: "AskUserQuestion",
    input: {
      questions: [
        {
          question: "Which library should we use?",
          header: "Library",
          options: [
            { label: "React", description: "component-based" },
            { label: "Vue", description: "template-first" },
          ],
        },
        {
          question: "Light or dark theme?",
          options: [{ label: "Light" }, { label: "Dark" }],
        },
      ],
    },
  });
  const resultAtom = makeAtom(1, "tool", "tool_result", "tool_generated", "2026-07-11T10:00:05.000Z", {
    call_id: "call-1",
    output: JSON.stringify([
      { type: "text", text: "React" },
      { type: "text", text: "Dark" },
    ]),
  });
  const unrelatedCall = makeAtom(2, "tool", "tool_call", "tool_generated", "2026-07-11T10:00:10.000Z", {
    call_id: "call-2",
    tool_name: "read_file",
    input: { path: "src/x.ts" },
  });
  const unrelatedResult = makeAtom(3, "tool", "tool_result", "tool_generated", "2026-07-11T10:00:11.000Z", {
    call_id: "call-2",
    output: "file contents",
  });
  const atoms = [callAtom, resultAtom, unrelatedCall, unrelatedResult];
  const edges: AtomEdge[] = [
    {
      id: "edge-aqq",
      source_id: draft.source_id,
      session_ref: draft.id,
      from_atom_id: resultAtom.id,
      to_atom_id: callAtom.id,
      edge_kind: "tool_result_for",
    },
    {
      id: "edge-read",
      source_id: draft.source_id,
      session_ref: draft.id,
      from_atom_id: unrelatedResult.id,
      to_atom_id: unrelatedCall.id,
      edge_kind: "tool_result_for",
    },
  ];

  const turns = buildAskUserQuestionTurns(draft, atoms, edges);
  assert.equal(turns.length, 1);
  const turn = turns[0];
  assert.ok(turn, "expected one synthesized turn");
  assert.equal(turn.tool_name, "AskUserQuestion");
  assert.equal(turn.call_atom_id, callAtom.id);
  assert.equal(turn.result_atom_id, resultAtom.id);
  assert.equal(turn.created_at, resultAtom.time_key);
  assert.equal(turn.questions.length, 2);

  const q0 = turn.questions[0];
  assert.ok(q0);
  assert.equal(q0.header, "Library");
  assert.equal(q0.options.length, 2);

  assert.equal(turn.answers.length, 2);
  const a0 = turn.answers[0];
  const a1 = turn.answers[1];
  assert.ok(a0 && a1);
  assert.equal(a0.selected_label, "React");
  assert.equal(a0.question_index, 0);
  assert.equal(a1.selected_label, "Dark");
  assert.equal(a1.question_index, 1);
});

test("buildAskUserQuestionTurns handles Codex request_user_input with structured answers map", () => {
  const draft = makeDraft("sess:codex:aqq", "codex");
  const callAtom = makeAtom(0, "tool", "tool_call", "tool_generated", "2026-07-11T11:00:00.000Z", {
    call_id: "call-codex-1",
    tool_name: "request_user_input",
    input: {
      questions: [
        {
          header: "Build tool",
          id: "build_tool",
          question: "Which build tool do you prefer?",
          options: [
            { label: "Vite", description: "fast" },
            { label: "Webpack", description: "mature" },
            { label: "esbuild", description: "minimal" },
          ],
        },
        {
          header: "Framework",
          id: "framework",
          question: "Which framework?",
          options: [{ label: "React" }, { label: "Vue" }],
        },
      ],
    },
  });
  const resultAtom = makeAtom(1, "tool", "tool_result", "tool_generated", "2026-07-11T11:00:08.000Z", {
    call_id: "call-codex-1",
    output: JSON.stringify({
      answers: {
        build_tool: { answers: ["Vite"] },
        framework: { answers: ["Vue"] },
      },
    }),
  });
  const atoms = [callAtom, resultAtom];
  const edges: AtomEdge[] = [
    {
      id: "edge-codex",
      source_id: draft.source_id,
      session_ref: draft.id,
      from_atom_id: resultAtom.id,
      to_atom_id: callAtom.id,
      edge_kind: "tool_result_for",
    },
  ];

  const turns = buildAskUserQuestionTurns(draft, atoms, edges);
  assert.equal(turns.length, 1);
  const turn = turns[0];
  assert.ok(turn);
  assert.equal(turn.tool_name, "request_user_input");
  assert.equal(turn.questions.length, 2);

  const q0 = turn.questions[0];
  assert.ok(q0);
  assert.equal(q0.header, "Build tool");
  assert.equal(q0.id, "build_tool");

  assert.equal(turn.answers.length, 2);
  const a0 = turn.answers[0];
  const a1 = turn.answers[1];
  assert.ok(a0 && a1);
  assert.equal(a0.selected_label, "Vite");
  assert.equal(a0.question_index, 0);
  assert.equal(a1.selected_label, "Vue");
  assert.equal(a1.question_index, 1);
});

test("buildAskUserQuestionTurns falls back to positional matching when Codex specs lack ids", () => {
  const draft = makeDraft("sess:codex:no-ids", "codex");
  const callAtom = makeAtom(0, "tool", "tool_call", "tool_generated", "2026-07-11T11:30:00.000Z", {
    call_id: "call-codex-no-ids",
    tool_name: "request_user_input",
    input: {
      questions: [
        {
          header: "Color",
          // No id field — answers must be paired positionally.
          question: "Which color?",
          options: [{ label: "Red" }, { label: "Green" }, { label: "Blue" }],
        },
        {
          header: "Size",
          question: "Which size?",
          options: [{ label: "S" }, { label: "M" }, { label: "L" }],
        },
      ],
    },
  });
  const resultAtom = makeAtom(1, "tool", "tool_result", "tool_generated", "2026-07-11T11:30:05.000Z", {
    call_id: "call-codex-no-ids",
    output: JSON.stringify({
      answers: {
        color: { answers: ["Blue"] },
        size: { answers: ["M"] },
      },
    }),
  });
  const edges: AtomEdge[] = [
    {
      id: "edge-codex-no-ids",
      source_id: draft.source_id,
      session_ref: draft.id,
      from_atom_id: resultAtom.id,
      to_atom_id: callAtom.id,
      edge_kind: "tool_result_for",
    },
  ];

  const turns = buildAskUserQuestionTurns(draft, [callAtom, resultAtom], edges);
  assert.equal(turns.length, 1);
  const turn = turns[0];
  assert.ok(turn);
  assert.equal(turn.answers.length, 2);
  const a0 = turn.answers[0];
  const a1 = turn.answers[1];
  assert.ok(a0 && a1);
  assert.equal(a0.question_index, 0);
  assert.equal(a0.selected_label, "Blue");
  assert.equal(a1.question_index, 1);
  assert.equal(a1.selected_label, "M");
});

test("buildAskUserQuestionTurns unwraps Claude Code wrapped single-select response", () => {
  const draft = makeDraft("sess:claude:wrapped", "claude_code");
  const callAtom = makeAtom(0, "tool", "tool_call", "tool_generated", "2026-07-11T12:30:00.000Z", {
    call_id: "call-wrapped",
    tool_name: "AskUserQuestion",
    input: {
      questions: [
        {
          question: "Pick a fix approach",
          header: "Fix",
          options: [{ label: "A" }, { label: "B" }, { label: "C" }],
        },
      ],
    },
  });
  const resultAtom = makeAtom(1, "tool", "tool_result", "tool_generated", "2026-07-11T12:30:02.000Z", {
    call_id: "call-wrapped",
    output: 'Your questions have been answered: "Pick a fix approach"="B". You can now continue with these answers in mind.',
  });
  const edges: AtomEdge[] = [
    {
      id: "edge-wrapped",
      source_id: draft.source_id,
      session_ref: draft.id,
      from_atom_id: resultAtom.id,
      to_atom_id: callAtom.id,
      edge_kind: "tool_result_for",
    },
  ];

  const turns = buildAskUserQuestionTurns(draft, [callAtom, resultAtom], edges);
  assert.equal(turns.length, 1);
  const turn = turns[0];
  assert.ok(turn);
  assert.equal(turn.answers.length, 1);
  const a = turn.answers[0];
  assert.ok(a);
  assert.equal(a.selected_label, "B");
  assert.equal(a.free_text, undefined);
});

test("buildAskUserQuestionTurns captures free_text when answer does not match any option", () => {
  const draft = makeDraft("sess:claude:free", "claude_code");
  const callAtom = makeAtom(0, "tool", "tool_call", "tool_generated", "2026-07-11T12:00:00.000Z", {
    call_id: "call-free",
    tool_name: "AskUserQuestion",
    input: {
      questions: [
        {
          question: "Pick one",
          options: [{ label: "A" }, { label: "B" }],
        },
      ],
    },
  });
  const resultAtom = makeAtom(1, "tool", "tool_result", "tool_generated", "2026-07-11T12:00:01.000Z", {
    call_id: "call-free",
    output: "neither, I want C",
  });
  const edges: AtomEdge[] = [
    {
      id: "edge-free",
      source_id: draft.source_id,
      session_ref: draft.id,
      from_atom_id: resultAtom.id,
      to_atom_id: callAtom.id,
      edge_kind: "tool_result_for",
    },
  ];

  const turns = buildAskUserQuestionTurns(draft, [callAtom, resultAtom], edges);
  assert.equal(turns.length, 1);
  const turn = turns[0];
  assert.ok(turn);
  const a = turn.answers[0];
  assert.ok(a);
  assert.equal(a.selected_label, undefined);
  assert.equal(a.free_text, "neither, I want C");
});

test("buildAskUserQuestionTurns skips unmatched calls (no result edge)", () => {
  const draft = makeDraft("sess:claude:unmatched", "claude_code");
  const callAtom = makeAtom(0, "tool", "tool_call", "tool_generated", "2026-07-11T13:00:00.000Z", {
    call_id: "call-orphan",
    tool_name: "AskUserQuestion",
    input: { questions: [{ question: "Anything?", options: [] }] },
  });
  const turns = buildAskUserQuestionTurns(draft, [callAtom], []);
  assert.equal(turns.length, 0);
});

test("buildAskUserQuestionTurns returns empty for platforms without a profile", () => {
  const draft = makeDraft("sess:cursor:aqq", "cursor");
  const turns = buildAskUserQuestionTurns(draft, [], []);
  assert.equal(turns.length, 0);
});

function makeDraft(id: string, platform: SessionDraft["source_platform"]): SessionDraft {
  return {
    id,
    source_id: `src-${platform}`,
    source_platform: platform,
    host_id: "host-test",
    model: "test-model",
    working_directory: `/workspace/${id}`,
  };
}

function makeAtom(
  seqNo: number,
  actorKind: ConversationAtom["actor_kind"],
  contentKind: ConversationAtom["content_kind"],
  originKind: ConversationAtom["origin_kind"],
  timeKey: string,
  payload: Record<string, unknown>,
): ConversationAtom {
  return {
    id: `atom-${seqNo}`,
    source_id: "src-test",
    session_ref: "sess:test",
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
