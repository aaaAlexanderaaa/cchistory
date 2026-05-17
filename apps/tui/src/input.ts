import type { BrowserAction, BrowserState } from "./browser.js";

export interface TuiInputKey {
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  escape?: boolean;
  backspace?: boolean;
  delete?: boolean;
  return?: boolean;
  tab?: boolean;
  rightArrow?: boolean;
  leftArrow?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
}

export type TuiInputEffect =
  | { type: "action"; action: BrowserAction }
  | { type: "exit" }
  | { type: "none" };

export function resolveTuiInputEffect(state: BrowserState, input: string, key: TuiInputKey): TuiInputEffect {
  if (key.ctrl && input === "c") {
    return { type: "exit" };
  }

  if (key.escape) {
    if (state.showHelp) {
      return action({ type: "close-help" });
    }
    if (state.showSourceHealth) {
      return action({ type: "close-source-health" });
    }
    if (state.showStats) {
      return action({ type: "close-stats" });
    }
    return action({ type: "retreat" });
  }

  const editingSearch = state.mode === "search" && state.focusPane === "projects";
  if (editingSearch) {
    if (key.backspace || key.delete) {
      return action({ type: "backspace-search" });
    }
    if (key.return) {
      return action({ type: "commit-search" });
    }
    if (input === "\t" || key.tab || key.rightArrow || key.leftArrow || key.upArrow || key.downArrow) {
      // Fall through to navigation handling.
    } else if (isPrintableSearchInput(input, key)) {
      return action({ type: "append-search-char", value: input });
    }
  }

  if (input === "q" && !editingSearch) {
    return { type: "exit" };
  }
  if (input === "?" && !editingSearch) {
    return action({ type: "toggle-help" });
  }
  if (input === "/" && !editingSearch) {
    return action({ type: "enter-search-mode" });
  }
  if (input === "s" && !editingSearch) {
    return action({ type: "toggle-source-health" });
  }
  if (input === "i" && !editingSearch) {
    return action({ type: "toggle-stats" });
  }
  if (state.showStats && (input === "\t" || key.tab)) {
    return action({ type: "cycle-stats-time-window" });
  }
  if (input === "p" && !editingSearch) {
    return action({ type: "focus-projects" });
  }
  if (input === "t" && !editingSearch) {
    return action({ type: "focus-turns" });
  }
  if (input === "d" && !editingSearch) {
    return action({ type: "focus-detail" });
  }
  if (input === "\t" || key.tab || key.rightArrow) {
    return action({ type: "focus-next" });
  }
  if (input === "\u001B[Z" || key.leftArrow) {
    return action({ type: "focus-previous" });
  }
  if (key.pageUp || input === "\u001B[5~") {
    return action({ type: "page-up" });
  }
  if (key.pageDown || input === "\u001B[6~") {
    return action({ type: "page-down" });
  }
  if (input === "g" && !key.shift && !editingSearch) {
    return action({ type: "jump-first" });
  }
  if (input === "G" && !editingSearch) {
    return action({ type: "jump-last" });
  }
  if (input === "j" || key.downArrow) {
    return action({ type: "move-down" });
  }
  if (input === "k" || key.upArrow) {
    return action({ type: "move-up" });
  }
  if (key.return) {
    return action({ type: "drill" });
  }

  return { type: "none" };
}

function action(action: BrowserAction): TuiInputEffect {
  return { type: "action", action };
}

function isPrintableSearchInput(input: string, key: TuiInputKey): boolean {
  // Accept multi-byte input from CJK IME; length > 1 is normal for composed chars.
  return input.length > 0 && !key.ctrl && !key.meta;
}
