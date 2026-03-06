import test from "node:test";
import assert from "node:assert/strict";

import {
  applyModeChange,
  applyProjectFilter,
  applySourceFilter,
  shouldFetchEntryDetail,
  type ViewState,
} from "../src/viewState.ts";

const baseState: ViewState = {
  mode: "explore",
  selectedSource: "claude_code",
  selectedProject: "acme/dashboard",
  selectedEntryId: "entry-1",
};

test("mode switching clears the selected entry", () => {
  const next = applyModeChange(baseState, "search");

  assert.equal(next.mode, "search");
  assert.equal(next.selectedEntryId, null);
  assert.equal(next.selectedSource, "claude_code");
});

test("source filters reset project and selection", () => {
  const next = applySourceFilter(baseState, "brave");

  assert.equal(next.selectedSource, "brave");
  assert.equal(next.selectedProject, null);
  assert.equal(next.selectedEntryId, null);
});

test("project filters preserve mode while clearing selection", () => {
  const next = applyProjectFilter(baseState, "acme/search");

  assert.equal(next.mode, "explore");
  assert.equal(next.selectedProject, "acme/search");
  assert.equal(next.selectedEntryId, null);
});

test("lazy detail fetch only runs when the cache misses", () => {
  assert.equal(shouldFetchEntryDetail("entry-1", {}), true);
  assert.equal(shouldFetchEntryDetail("entry-1", { "entry-1": { id: "entry-1" } }), false);
  assert.equal(shouldFetchEntryDetail(null, {}), false);
});
