import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { scanLiteHistory } from "@cchistory/live-runtime";
import { resolveLiteInputEffect } from "./input.js";
import { LiteBrowserModel, UNLINKED_PROJECT_KEY } from "./model.js";
import {
  clampState,
  createLiteBrowserState,
  getSearchGroups,
  getSelectedTurn,
  getVisibleTurns,
  reduceLiteBrowserState,
  shouldRunSearch,
  type LiteBrowserAction,
  type LiteBrowserState,
} from "./state.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const codexRoot = path.join(repoRoot, "mock_data", ".codex", "sessions");

async function buildModel(): Promise<LiteBrowserModel> {
  const snapshot = await scanLiteHistory({
    homeDir: repoRoot,
    hostname: "cchistory-lite-tui-state-test-host",
    sourceRoots: [{ sourceRef: "codex", baseDir: codexRoot }],
    sourceRefs: ["codex"],
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

test("initial state focuses the first project in browse mode", async () => {
  const model = await buildModel();
  const state = createLiteBrowserState(model);
  assert.equal(state.mode, "browse");
  assert.equal(state.focusPane, "projects");
  assert.equal(state.selectedProjectIndex, 0);
  assert.equal(state.overlay, "none");
  assert.ok(model.projects.length > 0);
});

test("search backspace removes complete astral characters", async () => {
  const model = await buildModel();
  for (const character of ["🧭", "𠀀"]) {
    const state = apply(model, createLiteBrowserState(model),
      { type: "open-search", query: `find${character}` }, { type: "backspace-search" });
    assert.equal(state.searchQuery, "find");
    assert.equal(Buffer.from(state.searchQuery).toString("utf8"), state.searchQuery);
  }
});

test("the model buckets project-less turns into one unlinked entry", async () => {
  const model = await buildModel();
  const unlinked = model.projects.find((entry) => entry.key === UNLINKED_PROJECT_KEY);
  // The fixture corpus intentionally contains a candidate-only session.
  assert.ok(unlinked, "expected an unlinked bucket for candidate-only turns");
  assert.ok(unlinked.turns.length > 0);
  assert.equal(unlinked.project, undefined);
  // Unlinked turns are excluded from the linked project count.
  assert.equal(model.counts.projects, model.projects.length - 1);
});

test("focus cycles projects → turns → detail and back", async () => {
  const model = await buildModel();
  let state = createLiteBrowserState(model);
  state = apply(model, state, { type: "focus-next" });
  assert.equal(state.focusPane, "turns");
  state = apply(model, state, { type: "focus-next" });
  assert.equal(state.focusPane, "detail");
  state = apply(model, state, { type: "focus-next" });
  assert.equal(state.focusPane, "projects");
  state = apply(model, state, { type: "focus-previous" });
  assert.equal(state.focusPane, "detail");
});

test("drill descends to the conversation view and retreat unwinds it", async () => {
  const model = await buildModel();
  let state = createLiteBrowserState(model);
  for (const expected of ["turns", "detail", "conversation"] as const) {
    state = apply(model, state, { type: "drill" });
    assert.equal(state.focusPane, expected);
  }
  state = apply(model, state, { type: "drill" });
  assert.equal(state.focusPane, "conversation", "conversation is the deepest pane");
  for (const expected of ["detail", "turns", "projects"] as const) {
    state = apply(model, state, { type: "retreat" });
    assert.equal(state.focusPane, expected);
  }
});

test("movement clamps at both ends instead of erroring", async () => {
  const model = await buildModel();
  let state = createLiteBrowserState(model);
  state = apply(model, state, { type: "move-up" }, { type: "move-up" });
  assert.equal(state.selectedProjectIndex, 0);
  state = apply(model, state, { type: "jump-last" });
  assert.equal(state.selectedProjectIndex, model.projects.length - 1);
  state = apply(model, state, { type: "move-down" }, { type: "page-down" });
  assert.equal(state.selectedProjectIndex, model.projects.length - 1);
  state = apply(model, state, { type: "jump-first" });
  assert.equal(state.selectedProjectIndex, 0);
});

test("changing project resets the turn selection and detail scroll", async () => {
  const model = await buildModel();
  let state = createLiteBrowserState(model);
  state = apply(model, state, { type: "focus-turns" }, { type: "move-down" }, { type: "focus-detail" }, { type: "move-down" });
  assert.ok(state.detailScrollOffset > 0);
  state = apply(model, state, { type: "focus-projects" }, { type: "move-down" });
  assert.equal(state.selectedTurnIndex, 0);
  assert.equal(state.detailScrollOffset, 0);
});

test("short queries wait for Enter and long queries auto-commit", async () => {
  const model = await buildModel();
  let state = apply(model, createLiteBrowserState(model), { type: "enter-search-mode" });
  assert.equal(state.mode, "search");

  for (const value of ["m", "o"]) {
    state = apply(model, state, { type: "append-search-char", value });
  }
  assert.equal(shouldRunSearch(state), false, "2-char query should not auto-run");
  state = apply(model, state, { type: "commit-search" });
  assert.equal(shouldRunSearch(state), true);

  state = apply(model, createLiteBrowserState(model), { type: "enter-search-mode" });
  for (const value of ["m", "o", "c", "k"]) {
    state = apply(model, state, { type: "append-search-char", value });
  }
  assert.equal(state.searchQuery, "mock");
  assert.equal(shouldRunSearch(state), true, "4-char query auto-commits");
  assert.ok(getSearchGroups(model, state).length > 0);
});

test("backspacing below the auto-commit length stops running the search", async () => {
  const model = await buildModel();
  let state = apply(model, createLiteBrowserState(model), { type: "open-search", query: "mock" });
  assert.equal(shouldRunSearch(state), true);
  state = apply(model, state, { type: "backspace-search" });
  assert.equal(state.searchQuery, "moc");
  assert.equal(shouldRunSearch(state), false);
  assert.deepEqual(getSearchGroups(model, state), []);
});

test("search groups matches by project and drives the turn pane", async () => {
  const model = await buildModel();
  const state = apply(model, createLiteBrowserState(model), { type: "open-search", query: "mock" });
  const groups = getSearchGroups(model, state);
  assert.ok(groups.length > 0);
  const total = groups.reduce((sum, group) => sum + group.results.length, 0);
  assert.equal(total, model.searchAll("mock").total);
  assert.deepEqual(
    getVisibleTurns(model, state).map((entry) => entry.turn.id),
    groups[0]!.results.map((result) => result.turn.id),
  );
});

test("retreating out of search returns to browse mode", async () => {
  const model = await buildModel();
  let state = apply(model, createLiteBrowserState(model), { type: "open-search", query: "mock" });
  assert.equal(state.mode, "search");
  state = apply(model, state, { type: "retreat" });
  assert.equal(state.mode, "browse");
  assert.equal(state.focusPane, "projects");
});

test("overlays are mutually exclusive and Esc closes the active one", async () => {
  const model = await buildModel();
  let state = apply(model, createLiteBrowserState(model), { type: "toggle-help" });
  assert.equal(state.overlay, "help");
  state = apply(model, state, { type: "toggle-stats" });
  assert.equal(state.overlay, "stats");
  state = apply(model, state, { type: "toggle-stats" });
  assert.equal(state.overlay, "none");
  state = apply(model, state, { type: "toggle-sources" }, { type: "retreat" });
  assert.equal(state.overlay, "none");
});

test("stats dimension cycles through the four canonical rollups", async () => {
  const model = await buildModel();
  let state = apply(model, createLiteBrowserState(model), { type: "toggle-stats" });
  const seen = [state.statsDimension];
  for (let index = 0; index < 4; index += 1) {
    state = apply(model, state, { type: "cycle-stats-dimension" });
    seen.push(state.statsDimension);
  }
  assert.deepEqual(seen, ["source", "project", "model", "day", "source"]);
});

test("the sessions scope reaches sessions that derived no UserTurn", async () => {
  const openclawRoot = path.join(repoRoot, "mock_data", ".openclaw", "agents");
  const snapshot = await scanLiteHistory({
    homeDir: repoRoot,
    hostname: "cchistory-lite-tui-sessions-scope-host",
    sourceRoots: [{ sourceRef: "openclaw", baseDir: openclawRoot }],
    sourceRefs: ["openclaw"],
    safeMode: true,
    contextMode: "none",
  });
  const model = new LiteBrowserModel(snapshot);
  // The fixture is exactly the hard case: sessions with related work, no turns.
  assert.equal(model.counts.turns, 0);
  assert.ok(model.sessions.length > 0);
  assert.ok(model.sessions.some((entry) => entry.relatedWorkCount > 0));

  const state = apply(model, createLiteBrowserState(model), { type: "set-browse-scope", scope: "sessions" });
  assert.equal(state.browseScope, "sessions");
  assert.equal(state.status, undefined);

  const targeted = apply(model, createLiteBrowserState(model), {
    type: "open-session-ref",
    ref: "sess:openclaw:44444444-5555-4666-8777-888888888888",
  });
  assert.equal(targeted.browseScope, "sessions");
  assert.equal(targeted.focusPane, "detail");
  assert.equal(targeted.status, undefined);
  assert.equal(
    model.sessions[targeted.selectedSessionIndex]?.session.id,
    "sess:openclaw:44444444-5555-4666-8777-888888888888",
  );
});

test("switching scope keeps the turn selection valid", async () => {
  const model = await buildModel();
  let state = apply(model, createLiteBrowserState(model), { type: "focus-turns" }, { type: "jump-last" });
  state = apply(model, state, { type: "set-browse-scope", scope: "sessions" });
  assert.equal(state.browseScope, "sessions");
  assert.equal(state.focusPane, "projects");
  assert.equal(state.selectedTurnIndex, 0);
  const turns = getVisibleTurns(model, state);
  assert.deepEqual(turns, model.sessions[state.selectedSessionIndex]?.turns ?? []);
  state = apply(model, state, { type: "set-browse-scope", scope: "projects" });
  assert.equal(state.browseScope, "projects");
});

test("entry-point refs open a project, session, and turn", async () => {
  const model = await buildModel();
  const initial = createLiteBrowserState(model);
  const project = model.projects.find((entry) => entry.project);
  assert.ok(project?.project);

  const byProject = apply(model, initial, { type: "open-project-ref", ref: project.project.project_id });
  assert.equal(byProject.focusPane, "turns");
  assert.equal(model.projects[byProject.selectedProjectIndex]?.key, project.key);

  const turn = project.turns[0];
  assert.ok(turn);
  const byTurn = apply(model, initial, { type: "open-turn-ref", ref: turn.turn.id });
  assert.equal(byTurn.focusPane, "detail");
  assert.equal(getSelectedTurn(model, byTurn)?.turn.id, turn.turn.id);

  const bySession = apply(model, initial, { type: "open-session-ref", ref: turn.turn.session_id });
  assert.equal(bySession.browseScope, "sessions");
  assert.equal(bySession.focusPane, "turns");
  assert.equal(getSelectedTurn(model, bySession)?.turn.session_id, turn.turn.session_id);
});

test("an unresolvable ref surfaces an error status instead of throwing", async () => {
  const model = await buildModel();
  const state = apply(model, createLiteBrowserState(model), { type: "open-project-ref", ref: "no-such-project" });
  assert.equal(state.status?.kind, "error");
  assert.match(state.status?.text ?? "", /Project not found: no-such-project/);
});

test("clampState repairs out-of-range indices from a replaced snapshot", async () => {
  const model = await buildModel();
  const state = createLiteBrowserState(model);
  const clamped = clampState({ ...state, selectedProjectIndex: 999, selectedTurnIndex: 999 }, model);
  assert.equal(clamped.selectedProjectIndex, model.projects.length - 1);
  assert.ok(clamped.selectedTurnIndex < Math.max(1, model.projects.at(-1)?.turns.length ?? 1));
});

test("keymap matches the Full TUI for navigation, panes, and actions", async () => {
  const model = await buildModel();
  const state = createLiteBrowserState(model);
  const effect = (key: Parameters<typeof resolveLiteInputEffect>[1]) => resolveLiteInputEffect(state, key);

  assert.deepEqual(effect({ input: "j" }), { type: "action", action: { type: "move-down" } });
  assert.deepEqual(effect({ input: "k" }), { type: "action", action: { type: "move-up" } });
  assert.deepEqual(effect({ input: "", name: "down" }), { type: "action", action: { type: "move-down" } });
  assert.deepEqual(effect({ input: "", name: "pagedown" }), { type: "action", action: { type: "page-down" } });
  assert.deepEqual(effect({ input: "g" }), { type: "action", action: { type: "jump-first" } });
  assert.deepEqual(effect({ input: "G" }), { type: "action", action: { type: "jump-last" } });
  assert.deepEqual(effect({ input: "", name: "tab" }), { type: "action", action: { type: "focus-next" } });
  assert.deepEqual(effect({ input: "", name: "tab", shift: true }), { type: "action", action: { type: "focus-previous" } });
  assert.deepEqual(effect({ input: "p" }), {
    type: "action",
    action: { type: "set-browse-scope", scope: "projects" },
  });
  assert.deepEqual(effect({ input: "S" }), {
    type: "action",
    action: { type: "set-browse-scope", scope: "sessions" },
  });
  assert.deepEqual(effect({ input: "t" }), { type: "action", action: { type: "focus-turns" } });
  assert.deepEqual(effect({ input: "d" }), { type: "action", action: { type: "focus-detail" } });
  assert.deepEqual(effect({ input: "/" }), { type: "action", action: { type: "enter-search-mode" } });
  assert.deepEqual(effect({ input: "?" }), { type: "action", action: { type: "toggle-help" } });
  assert.deepEqual(effect({ input: "i" }), { type: "action", action: { type: "toggle-stats" } });
  assert.deepEqual(effect({ input: "s" }), { type: "action", action: { type: "toggle-sources" } });
  assert.deepEqual(effect({ input: "r" }), { type: "refresh" });
  assert.deepEqual(effect({ input: "q" }), { type: "exit" });
  assert.deepEqual(effect({ input: "c", ctrl: true }), { type: "exit" });
});

test("search mode routes printable keys to the query, not to commands", async () => {
  const model = await buildModel();
  const searching = apply(model, createLiteBrowserState(model), { type: "enter-search-mode" });
  assert.deepEqual(resolveLiteInputEffect(searching, { input: "q" }), {
    type: "action",
    action: { type: "append-search-char", value: "q" },
  });
  assert.deepEqual(resolveLiteInputEffect(searching, { input: "", name: "backspace" }), {
    type: "action",
    action: { type: "backspace-search" },
  });
  // Navigation still works while the query line has focus.
  assert.deepEqual(resolveLiteInputEffect(searching, { input: "", name: "down" }), {
    type: "action",
    action: { type: "move-down" },
  });
});

test("Enter on the detail pane requests the session context before drilling", async () => {
  const model = await buildModel();
  const onDetail = apply(model, createLiteBrowserState(model), { type: "focus-detail" });
  assert.deepEqual(resolveLiteInputEffect(onDetail, { input: "", name: "return" }), { type: "load-context" });
  const onProjects = createLiteBrowserState(model);
  assert.deepEqual(resolveLiteInputEffect(onProjects, { input: "", name: "return" }), {
    type: "action",
    action: { type: "drill" },
  });
});

test("Tab cycles the stats dimension while the stats overlay is open", async () => {
  const model = await buildModel();
  const state = apply(model, createLiteBrowserState(model), { type: "toggle-stats" });
  assert.deepEqual(resolveLiteInputEffect(state, { input: "", name: "tab" }), {
    type: "action",
    action: { type: "cycle-stats-dimension" },
  });
});
