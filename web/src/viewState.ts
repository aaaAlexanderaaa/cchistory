import type { Mode } from "./types";

export interface ViewState {
  mode: Mode;
  selectedSource: string | null;
  selectedProject: string | null;
  selectedEntryId: string | null;
}

export function applyModeChange(state: ViewState, mode: Mode): ViewState {
  return {
    ...state,
    mode,
    selectedEntryId: null,
  };
}

export function applySourceFilter(
  state: ViewState,
  sourceId: string | null
): ViewState {
  return {
    ...state,
    selectedSource: sourceId,
    selectedProject: null,
    selectedEntryId: null,
  };
}

export function applyProjectFilter(
  state: ViewState,
  project: string | null
): ViewState {
  return {
    ...state,
    selectedProject: project,
    selectedEntryId: null,
  };
}

export function shouldFetchEntryDetail(
  selectedEntryId: string | null,
  cache: Record<string, unknown>
): boolean {
  return Boolean(selectedEntryId && !cache[selectedEntryId]);
}
