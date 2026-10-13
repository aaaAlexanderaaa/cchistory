import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LiveHistorySnapshot, scanLiteHistory } from "@cchistory/live-runtime";
import { configureColorPolicy, stripAnsi } from "./colors.js";
import { LiteBrowserModel } from "./model.js";
import { BANNER_SUBTITLE, BANNER_TITLE, renderLiteFrame } from "./render.js";
import {
  createLiteBrowserState,
  reduceLiteBrowserState,
  type LiteBrowserAction,
  type LiteBrowserState,
} from "./state.js";
import { clipLine, compact, displayWidth, padLine, wrapText } from "./text.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const codexRoot = path.join(repoRoot, "mock_data", ".codex", "sessions");
const openclawRoot = path.join(repoRoot, "mock_data", ".openclaw", "agents");
const FIXED_NOW = Date.UTC(2026, 6, 27, 12, 0, 0);

configureColorPolicy({ color: false });

async function buildModel(baseDir = codexRoot, sourceRef = "codex"): Promise<LiteBrowserModel> {
  const snapshot = await scanLiteHistory({
    homeDir: repoRoot,
    hostname: "cchistory-lite-tui-render-test-host",
    sourceRoots: [{ sourceRef, baseDir }],
    sourceRefs: [sourceRef],
    safeMode: true,
    contextMode: "none",
  });
  return new LiteBrowserModel(snapshot);
}

function apply(
  model: LiteBrowserModel,
  state: LiteBrowserState,
  ...actions: LiteBrowserAction[]
): LiteBrowserState {
  return actions.reduce((current, action) => reduceLiteBrowserState(model, current, action), state);
}

function frame(model: LiteBrowserModel, state: LiteBrowserState, width = 110, height = 34): string {
  return renderLiteFrame(model, state, { width, height, now: FIXED_NOW });
}

test("a frame is exactly the requested height and never exceeds the width", async () => {
  const model = await buildModel();
  const state = createLiteBrowserState(model);
  for (const [width, height] of [
    [80, 24],
    [110, 34],
    [200, 60],
    [46, 14],
  ] as const) {
    const lines = frame(model, state, width, height).split("\n");
    assert.equal(lines.length, height, `height ${height}`);
    for (const line of lines) {
      assert.ok(displayWidth(line) <= width, `line exceeded ${width} columns: ${JSON.stringify(line)}`);
    }
  }
});

test("every view keeps the frame geometry stable", async () => {
  const model = await buildModel();
  const base = createLiteBrowserState(model);
  const views: Array<[string, LiteBrowserState]> = [
    ["browse", base],
    ["turns", apply(model, base, { type: "focus-turns" })],
    ["detail", apply(model, base, { type: "focus-detail" })],
    ["conversation", apply(model, base, { type: "drill" }, { type: "drill" }, { type: "drill" })],
    ["search", apply(model, base, { type: "open-search", query: "mock" })],
    ["help", apply(model, base, { type: "toggle-help" })],
    ["stats", apply(model, base, { type: "toggle-stats" })],
    ["sources", apply(model, base, { type: "toggle-sources" })],
  ];
  for (const [label, state] of views) {
    const lines = frame(model, state, 100, 30).split("\n");
    assert.equal(lines.length, 30, `${label} view height`);
    for (const line of lines) {
      assert.ok(displayWidth(line) <= 100, `${label} view overflowed: ${JSON.stringify(line)}`);
    }
  }
});

test("the banner lines release verifiers grep for are byte-identical", async () => {
  const model = await buildModel();
  const lines = frame(model, createLiteBrowserState(model)).split("\n");
  assert.equal(lines[0], BANNER_TITLE);
  assert.equal(lines[1], BANNER_SUBTITLE);
  assert.equal(BANNER_TITLE, "CC History Lite TUI 0.3.0");
  assert.equal(BANNER_SUBTITLE, "Ephemeral live snapshot · single machine · no Full store");
});

test("browse shows both panes, the counts line, and the status bar", async () => {
  const model = await buildModel();
  const output = frame(model, createLiteBrowserState(model));
  assert.match(output, /Projects/);
  assert.match(output, /Turns/);
  assert.match(output, /Detail/);
  assert.match(output, /\d+ sources · \d+ projects · \d+ sessions · \d+ turns/);
  assert.match(output, /\? help/);
  assert.match(output, /q quit/);
});

test("the focused pane is marked and the selected row carries a cursor", async () => {
  const model = await buildModel();
  const projects = frame(model, createLiteBrowserState(model));
  assert.match(projects, /▸ Projects/);
  assert.match(projects, /❯ /);
  const turns = frame(model, apply(model, createLiteBrowserState(model), { type: "focus-turns" }));
  assert.match(turns, /▸ Turns/);
  assert.doesNotMatch(turns, /▸ Projects/);
});

test("moving the cursor moves the marker to the next project", async () => {
  const model = await buildModel();
  const first = frame(model, createLiteBrowserState(model)).split("\n");
  const second = frame(model, apply(model, createLiteBrowserState(model), { type: "move-down" })).split("\n");
  const cursorRow = (lines: string[]) => lines.findIndex((line) => line.includes("❯"));
  assert.ok(cursorRow(first) >= 0);
  assert.equal(cursorRow(second), cursorRow(first) + 1);
});

test("search mode renders the query line and groups matches by project", async () => {
  const model = await buildModel();
  const state = apply(model, createLiteBrowserState(model), { type: "open-search", query: "mock" });
  const output = frame(model, state);
  assert.match(output, /\/ mock/);
  assert.match(output, /search "mock"/);
  assert.match(output, /\d+ matches/);
});

test("an uncommitted short query prompts for Enter rather than searching", async () => {
  const model = await buildModel();
  let state = apply(model, createLiteBrowserState(model), { type: "enter-search-mode" });
  state = apply(model, state, { type: "append-search-char", value: "m" });
  assert.match(frame(model, state), /Press Enter to search/);
});

test("the help overlay documents the Full-TUI-compatible keymap", async () => {
  const model = await buildModel();
  const output = frame(model, apply(model, createLiteBrowserState(model), { type: "toggle-help" }));
  for (const fragment of ["Navigation", "Panes", "Actions", "j/k", "PgUp/PgDn", "Enter", "Esc", "refresh"]) {
    assert.ok(output.includes(fragment), `help overlay missing ${fragment}`);
  }
  assert.match(output, /Never opens or creates ~\/\.cchistory/);
});

test("short-screen help scrolls through every action and the final guarantee", async () => {
  const model = await buildModel();
  const help = apply(model, createLiteBrowserState(model), { type: "toggle-help" });
  for (const height of [14, 20, 24]) {
    const first = frame(model, help, 80, height);
    const paged = frame(model, apply(model, help, { type: "page-down" }), 80, height);
    assert.notEqual(paged, first, `help page-down at height ${height}`);
    const outputs = Array.from({ length: 40 }, (_, offset) =>
      frame(model, { ...help, overlayScrollOffset: offset }, 80, height));
    for (const fragment of ["Actions", "refresh the snapshot", "stats overlay cycles", "Lite guarantees", "failed rescan keeps"]) {
      assert.ok(outputs.some((output) => output.includes(fragment)), `unreachable help ${fragment} at height ${height}`);
    }
    for (const output of outputs) {
      assert.equal(output.split("\n").length, height);
      assert.ok(output.split("\n").every((line) => displayWidth(line) <= 80));
      assert.match(output, /Help.*Esc to close/);
    }
  }
});

test("the stats overlay shows the overview and the selected rollup dimension", async () => {
  const model = await buildModel();
  let state = apply(model, createLiteBrowserState(model), { type: "toggle-stats" });
  assert.match(frame(model, state), /Statistics/);
  assert.match(frame(model, state), /By source/);
  state = apply(model, state, { type: "cycle-stats-dimension" });
  assert.match(frame(model, state), /By project/);
});

test("the sources overlay reports health counts and adapter roots", async () => {
  const model = await buildModel();
  const output = frame(model, apply(model, createLiteBrowserState(model), { type: "toggle-sources" }));
  assert.match(output, /Sources/);
  assert.match(output, /Healthy: \d+/);
  assert.match(output, /Stale: \d+/);
  assert.match(output, /Error: \d+/);
  assert.ok(output.includes(".codex"), "expected the adapter base dir");
});

test("the detail pane surfaces canonical turn identity and the prompt", async () => {
  const model = await buildModel();
  const output = frame(model, apply(model, createLiteBrowserState(model), { type: "focus-detail" }));
  assert.match(output, /Ask 1\/\d+ in /);
  assert.match(output, /Model:/);
  assert.match(output, /Turn:/);
  assert.match(output, /Prompt:/);
});

test("session detail surfaces canonical related work for a turn-less session", async () => {
  const model = await buildModel(openclawRoot, "openclaw");
  const sessionId = "sess:openclaw:44444444-5555-4666-8777-888888888888";
  const state = apply(model, createLiteBrowserState(model), { type: "open-session-ref", ref: sessionId });
  const output = frame(model, state, 130, 40);
  assert.match(output, /Sessions/);
  assert.match(output, /Related work \(1\)/);
  assert.match(output, /automation run · self/);
  assert.match(output, /derived no UserTurn/);
});

test("the sessions scope lists every session with turn and related-work counts", async () => {
  const model = await buildModel(openclawRoot, "openclaw");
  const state = apply(model, createLiteBrowserState(model), { type: "set-browse-scope", scope: "sessions" });
  const output = frame(model, state, 130, 40);
  assert.match(output, /▸ Sessions/);
  assert.match(output, /sessions\/projects/);
  for (const entry of model.sessions) {
    const label = entry.session.title ?? entry.session.source_session_id ?? entry.session.id;
    assert.ok(output.includes(label.slice(0, 12)), `session ${label} missing from the pane`);
  }
});

test("the conversation view labels context that the light snapshot has not loaded", async () => {
  const model = await buildModel();
  const state = apply(model, createLiteBrowserState(model), { type: "drill" }, { type: "drill" }, { type: "drill" });
  const output = frame(model, state);
  assert.match(output, /▸ Conversation/);
  assert.match(output, /Ask 1\/\d+/);
  assert.match(output, /context not loaded/);
});

test("the conversation view renders replies and tool calls once context is loaded", async () => {
  const snapshot = await scanLiteHistory({
    homeDir: repoRoot,
    hostname: "cchistory-lite-tui-render-context-host",
    sourceRoots: [{ sourceRef: "codex", baseDir: codexRoot }],
    sourceRefs: ["codex"],
    safeMode: true,
    contextMode: "full",
  });
  const model = new LiteBrowserModel(snapshot);
  const state = apply(model, createLiteBrowserState(model), { type: "drill" }, { type: "drill" }, { type: "drill" });
  const output = frame(model, state, 120, 44);
  assert.match(output, /Assistant replies: [1-9]/);
  assert.match(output, /Tool calls: \d+/);
  assert.doesNotMatch(output, /context not loaded/);
});

test("conversation renders tool-only and unmatched tools exactly once", async () => {
  const snapshot = await scanLiteHistory({
    homeDir: repoRoot, hostname: "lite-tool-only-host",
    sourceRoots: [{ sourceRef: "codex", baseDir: codexRoot }],
    sourceRefs: ["codex"], safeMode: true, contextMode: "full",
  });
  const context = snapshot.data.contexts.find((entry) => entry.tool_calls.length > 0 && entry.assistant_replies.length > 0);
  assert.ok(context);
  const turn = snapshot.getTurn(context.turn_id);
  assert.ok(turn);
  const tool = context.tool_calls[0]!;
  for (const withReply of [false, true]) {
    const model = new LiteBrowserModel(new LiveHistorySnapshot({
      ...snapshot.data, turns: [turn], contexts: [{
        ...context,
        assistant_replies: withReply ? [context.assistant_replies[0]!] : [],
        tool_calls: [
          { ...tool, tool_name: "UNMATCHED_TOOL_MARKER", reply_id: "synthetic-reply-without-text" },
          ...(withReply ? [{ ...tool, id: "matched-tool", tool_name: "MATCHED_TOOL_MARKER", reply_id: context.assistant_replies[0]!.id }] : []),
        ],
      }],
    }));
    const state = apply(model, createLiteBrowserState(model),
      { type: "open-turn-ref", ref: turn.id }, { type: "drill" });
    const output = frame(model, state, 120, 60);
    assert.ok(output.includes(`Tool calls: ${withReply ? 2 : 1}`));
    assert.equal(output.split("UNMATCHED_TOOL_MARKER").length - 1, 1, `tool visibility withReply=${withReply}`);
    if (withReply) assert.equal(output.split("  MATCHED_TOOL_MARKER").length - 1, 1, "matched tools must not be duplicated");
  }
});

test("large unbroken prompts wrap promptly without losing text or splitting code points", () => {
  for (const prompt of ["x".repeat(256 * 1024), "𠀀".repeat(32 * 1024), "👩🏽‍💻".repeat(8 * 1024)]) {
    const started = performance.now();
    const rows = wrapText(prompt, 50);
    const elapsed = performance.now() - started;
    assert.equal(rows.join(""), prompt);
    assert.ok(rows.every((row) => displayWidth(row) <= 50));
    assert.ok(elapsed < 2000, `long prompt wrapping took ${elapsed.toFixed(0)}ms`);
  }
});

test("the bottom of a long conversation remains visible at every supported height", async () => {
  const snapshot = await scanLiteHistory({
    homeDir: repoRoot,
    hostname: "cchistory-lite-tui-render-tail-host",
    sourceRoots: [{ sourceRef: "codex", baseDir: codexRoot }],
    sourceRefs: ["codex"],
    safeMode: true,
    contextMode: "full",
  });
  const turn = snapshot.listResolvedTurns()[0];
  assert.ok(turn);
  const context = snapshot.getTurnContext(turn.id);
  const reply = context?.assistant_replies[0];
  assert.ok(context && reply);
  const model = new LiteBrowserModel(new LiveHistorySnapshot({
    ...snapshot.data,
    turns: [turn],
    contexts: [{
      ...context,
      assistant_replies: [{ ...reply, content: `${"reply line\n".repeat(50)}FINAL_REPLY_MARKER` }],
      tool_calls: [],
    }],
  }));
  const state = apply(model, createLiteBrowserState(model),
    { type: "open-turn-ref", ref: turn.id }, { type: "drill" }, { type: "jump-last" });
  for (const height of [14, 24, 34]) {
    const output = frame(model, state, 100, height);
    assert.match(output, /FINAL_REPLY_MARKER/, `conversation tail at height ${height}`);
    assert.equal(output.split("\n").length, height);
    assert.ok(output.split("\n").every((line) => displayWidth(line) <= 100));
    assert.doesNotMatch(output, /more lines below/);
  }
});

test("scrolling detail reaches the final row and clamps downward movement at the tail", async () => {
  const turnModel = await buildModel();
  const sessionModel = await buildModel(openclawRoot, "openclaw");
  const cases = [
    { model: turnModel, state: apply(turnModel, createLiteBrowserState(turnModel), { type: "focus-detail" }),
      marker: "Enter → full session conversation" },
    { model: sessionModel, state: apply(sessionModel, createLiteBrowserState(sessionModel),
      { type: "open-session-ref", ref: "sess:openclaw:44444444-5555-4666-8777-888888888888" }),
      marker: "derived no UserTurn" },
  ];
  for (const { model, state, marker } of cases) {
    const tail = apply(model, state, { type: "jump-last" });
    for (const width of [80, 130]) for (const height of [14, 24, 34]) {
      const output = frame(model, tail, width, height);
      assert.ok(output.includes(marker), `detail tail ${marker} at ${width}x${height}`);
      assert.doesNotMatch(output, /↓ \d+ more lines/);
      assert.equal(output.split("\n").length, height);
      assert.ok(output.split("\n").every((line) => displayWidth(line) <= width));
      assert.equal(frame(model, apply(model, tail, { type: "move-down" }), width, height), output);
    }
  }
});

test("narrow detail scrolling preserves every prompt line across the layout breakpoint", async () => {
  const base = (await buildModel()).snapshot;
  const turn = base.listResolvedTurns()[0];
  assert.ok(turn);
  const promptLines = [
    "ABCDEFGHIJKLMNOPQRSTUVWX",
    "abcdefghijklmnopqrstuvwx",
    "𠀀𠀁𠀂𠀃𠀄𠀅𠀆𠀇𠀈𠀉𠀊𠀋",
  ];
  const model = new LiteBrowserModel(new LiveHistorySnapshot({
    ...base.data, turns: [{ ...turn, canonical_text: promptLines.join("\n") }],
  }));
  const detail = apply(model, createLiteBrowserState(model), { type: "open-turn-ref", ref: turn.id });
  for (const width of [40, 46, 56, 57, 80]) for (const height of [14, 24, 34]) {
    const outputs = Array.from({ length: 40 }, (_, offset) =>
      frame(model, { ...detail, detailScrollOffset: offset }, width, height));
    for (const prompt of promptLines) {
      assert.ok(outputs.some((output) => output.includes(prompt)), `prompt lost at ${width}x${height}: ${prompt}`);
    }
    for (const output of outputs) {
      assert.equal(output.split("\n").length, height);
      assert.ok(output.split("\n").every((line) => displayWidth(line) <= width));
      assert.equal(Buffer.from(output).toString("utf8"), output, "frame must contain complete Unicode characters");
    }
  }
});

test("session detail labels the selected turn's project instead of the prior project selection", async () => {
  const base = (await buildModel()).snapshot;
  const turn = base.listResolvedTurns().find((entry) => entry.project_id);
  assert.ok(turn?.project_id);
  const project = base.getProject(turn.project_id);
  const session = base.getSession(turn.session_id);
  assert.ok(project && session);
  const model = new LiteBrowserModel(new LiveHistorySnapshot({
    ...base.data,
    projects: [
      { ...project, display_name: "Prior project" },
      { ...project, project_id: "selected-project", display_name: "Selected project" },
    ],
    sessions: [session, { ...session, id: "selected-session" }],
    turns: [turn, { ...turn, id: "selected-turn", session_id: "selected-session", project_id: "selected-project" }],
  }));
  const state = apply(model, createLiteBrowserState(model),
    { type: "open-project-ref", ref: project.project_id },
    { type: "open-session-ref", ref: "selected-session" },
    { type: "focus-detail" });
  const output = frame(model, state, 140, 40);
  assert.match(output, /Ask 1\/1 in Selected project/);
  assert.doesNotMatch(output, /Ask 1\/1 in Prior project/);
});

test("a status message renders above the status bar", async () => {
  const model = await buildModel();
  const state = apply(model, createLiteBrowserState(model), {
    type: "set-status",
    status: { kind: "error", text: "Refresh failed; previous snapshot retained: boom" },
  });
  const lines = frame(model, state).split("\n");
  assert.match(lines.at(-2) ?? "", /Refresh failed; previous snapshot retained: boom/);
});

test("an empty snapshot renders guidance instead of a blank frame", async () => {
  const model = new LiteBrowserModel(
    new LiveHistorySnapshot({
      host: { id: "host", hostname: "empty", platform: "darwin", created_at: "2026-01-01T00:00:00.000Z" } as never,
      sources: [],
      projects: [],
      sessions: [],
      turns: [],
      contexts: [],
      ask_user_question_turns: [],
      loss_audits: [],
    }),
  );
  const state = createLiteBrowserState(model);
  const output = frame(model, state);
  assert.match(output, /No projects/);
  assert.match(output, /0 sources · 0 projects · 0 sessions · 0 turns/);
  assert.match(output, /No AI coding history found on this machine/);
  assert.match(output, /--source-root <slot-or-id>=<path>/);
  const sources = frame(model, apply(model, state, { type: "toggle-sources" }));
  assert.match(sources, /No adapter roots were found on this machine/);
  assert.match(sources, /--source-root <slot-or-id>=<path>/);
});

test("frames carry no escape bytes when color is disabled", async () => {
  const model = await buildModel();
  const output = frame(model, apply(model, createLiteBrowserState(model), { type: "toggle-stats" }));
  assert.equal(output, stripAnsi(output));
});

test("text helpers measure and clip by terminal columns, not string length", () => {
  assert.equal(displayWidth("abc"), 3);
  assert.equal(displayWidth("日本語"), 6);
  assert.equal(displayWidth("\x1b[31mabc\x1b[39m"), 3);
  assert.equal(displayWidth(padLine("ab", 6)), 6);
  assert.ok(displayWidth(clipLine("日本語テスト", 6)) <= 6);
  assert.equal(clipLine("abc", 10), "abc");
  assert.deepEqual(wrapText("one two three", 7), ["one two", "three"]);
  assert.deepEqual(wrapText("supercalifragilistic", 6), ["superc", "alifra", "gilist", "ic"]);
  assert.deepEqual(wrapText("first\n\nsecond", 40), ["first", "", "second"]);
  for (const line of wrapText("日本語のテキストを折り返します", 8)) {
    assert.ok(displayWidth(line) <= 8);
  }
});

test("literal XML in canonical prompts and replies survives browse, detail and conversation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cchistory-lite-literal-xml-"));
  try {
    const sourceRoot = path.join(root, "sessions");
    await mkdir(sourceRoot);
    const prompt = "Keep this sample: <command-args>USER_XML_MARKER</command-args>";
    const reply = "Example: <command-message>REPLY_XML_MARKER</command-message>";
    await writeFile(path.join(sourceRoot, "rollout-xml.jsonl"), [
      { type: "session_meta", timestamp: "2026-01-01T00:00:00Z", payload: { id: "literal-xml", cwd: "/workspace/xml" } },
      { type: "response_item", timestamp: "2026-01-01T00:00:01Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: prompt }] } },
      { type: "response_item", timestamp: "2026-01-01T00:00:02Z", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: reply }] } },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    const snapshot = await scanLiteHistory({ homeDir: root, hostname: "literal-xml-test",
      sourceRoots: [{ sourceRef: "codex", baseDir: sourceRoot }], sourceRefs: ["codex"], contextMode: "full" });
    const turn = snapshot.listResolvedTurns()[0];
    assert.ok(turn);
    assert.equal(turn.canonical_text, prompt, "producer already owns canonical masking");
    assert.equal(snapshot.getTurnContext(turn.id)?.assistant_replies[0]?.content, reply);
    const model = new LiteBrowserModel(snapshot);
    const detail = apply(model, createLiteBrowserState(model), { type: "open-turn-ref", ref: turn.id });
    assert.ok(frame(model, createLiteBrowserState(model), 200, 60).includes(prompt));
    assert.ok(frame(model, detail, 200, 60).includes(prompt));
    const conversation = frame(model, apply(model, detail, { type: "drill" }), 200, 60);
    assert.ok(conversation.includes(prompt));
    assert.ok(conversation.includes(reply));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Unicode cell widths and truncation preserve complete graphemes", () => {
  for (const [text, width] of [["😀", 2], ["👩🏽‍💻", 2], ["🇨🇳", 2], ["1️⃣", 2], ["❤️", 2],
    ["♥", 1], ["e\u0301", 1], ["\u0301", 0], ["\u200d", 0], ["\x1b[31m👩🏽‍💻\x1b[39m", 2]] as const) {
    assert.equal(displayWidth(text), width, JSON.stringify(text));
  }
  for (const glyph of ["😀", "👩🏽‍💻", "🇨🇳", "1️⃣", "❤️", "e\u0301"]) {
    const width = glyph === "e\u0301" ? 1 : 2;
    assert.equal(clipLine(`${glyph}abcd`, width + 1), `${glyph}…`);
    assert.equal(compact(`${glyph}abcd`, width + 1), `${glyph}…`);
    assert.equal(padLine(glyph, width + 2), `${glyph}  `);
    assert.deepEqual(wrapText(glyph.repeat(4), width * 2), [glyph.repeat(2), glyph.repeat(2)]);
  }
  assert.equal(clipLine("\x1b[31m👩🏽‍💻abcd\x1b[39m", 3), "\x1b[31m👩🏽‍💻…\x1b[0m");
});

test("emoji rows fit the frame using an independent terminal-cell expectation", async () => {
  const snapshot = await scanLiteHistory({ homeDir: repoRoot, hostname: "emoji-frame-test",
    sourceRoots: [{ sourceRef: "codex", baseDir: codexRoot }], sourceRefs: ["codex"], contextMode: "none" });
  const original = snapshot.listResolvedTurns()[0];
  assert.ok(original);
  const turn = { ...original, canonical_text: "😀".repeat(40) };
  const model = new LiteBrowserModel(new LiveHistorySnapshot({ ...snapshot.data, turns: [turn] }));
  const initial = createLiteBrowserState(model);
  for (const width of [40, 46, 57, 80, 120]) {
    for (const state of [initial, apply(model, initial, { type: "open-turn-ref", ref: turn.id }),
      apply(model, initial, { type: "open-turn-ref", ref: turn.id }, { type: "drill" })]) {
      const output = frame(model, state, width, 40);
      for (const line of output.split("\n").filter((row) => row.includes("😀"))) {
        // Fixture rows contain ASCII/chrome and U+1F600. This oracle never
        // calls the production width helper that decides wrapping/clipping.
        const cells = [...stripAnsi(line)].reduce((sum, character) => sum + (character === "😀" ? 2 : 1), 0);
        assert.ok(cells <= width, `${cells} cells exceeded ${width}: ${line}`);
      }
    }
  }
});

test("clipping preserves astral characters and styling at every column boundary", () => {
  assert.equal(clipLine("𠀀ABCD", 2), "…");
  assert.equal(clipLine("𠀀ABCD", 3), "𠀀…");
  assert.equal(clipLine("𠀀ABCD", 4), "𠀀A…");
  for (const text of ["𠀀ABCD", "😀ABCD", "\x1b[31m𠀀😀ABCD\x1b[39m"]) {
    for (let width = 1; width <= displayWidth(text); width++) {
      const clipped = clipLine(text, width);
      assert.equal(Buffer.from(clipped).toString("utf8"), clipped, `invalid Unicode at width ${width}`);
      assert.ok(displayWidth(clipped) <= width);
    }
  }
  assert.match(clipLine("\x1b[31m𠀀ABCD\x1b[39m", 3), /^\x1b\[31m𠀀…\x1b\[0m$/);
});
