/**
 * Key press → intent mapping for the Lite TUI.
 *
 * Deliberately the same keymap as the Full TUI (`apps/tui/src/input.ts`) so
 * muscle memory transfers between the two terminal surfaces. `r` (refresh) is
 * the only Lite-specific binding, because only Lite can rescan from disk.
 */

import type { LiteKey } from "./keys.js";
import type { LiteBrowserAction, LiteBrowserState } from "./state.js";

export type LiteInputEffect =
  | { type: "action"; action: LiteBrowserAction }
  | { type: "refresh" }
  | { type: "load-context" }
  | { type: "exit" }
  | { type: "none" };

export function resolveLiteInputEffect(state: LiteBrowserState, key: LiteKey): LiteInputEffect {
  if (key.ctrl && (key.input === "c" || key.input === "d")) return { type: "exit" };

  if (key.name === "escape") {
    if (state.overlay !== "none") return action({ type: "close-overlay" });
    return action({ type: "retreat" });
  }

  const editingSearch = state.mode === "search" && state.focusPane === "projects" && state.overlay === "none";
  if (editingSearch) {
    if (key.name === "backspace" || key.name === "delete") return action({ type: "backspace-search" });
    if (key.name === "return") return action({ type: "commit-search" });
    if (isPrintable(key)) return action({ type: "append-search-char", value: key.input });
    // Navigation keys fall through so the search list stays keyboard-drivable.
  }

  if (!editingSearch) {
    switch (key.input) {
      case "q":
        return { type: "exit" };
      case "?":
        return action({ type: "toggle-help" });
      case "/":
        return action({ type: "enter-search-mode" });
      case "s":
        return action({ type: "toggle-sources" });
      case "i":
        return action({ type: "toggle-stats" });
      case "r":
        return { type: "refresh" };
      case "p":
        return action({ type: "set-browse-scope", scope: "projects" });
      case "S":
        return action({ type: "set-browse-scope", scope: "sessions" });
      case "t":
        return action({ type: "focus-turns" });
      case "d":
        return action({ type: "focus-detail" });
      case "g":
        return action({ type: key.shift ? "jump-last" : "jump-first" });
      case "G":
        return action({ type: "jump-last" });
      default:
        break;
    }
  }

  if (state.overlay === "stats" && key.name === "tab" && !key.shift) {
    return action({ type: "cycle-stats-dimension" });
  }
  if (key.name === "tab") {
    return action({ type: key.shift ? "focus-previous" : "focus-next" });
  }
  if (key.name === "right" && !editingSearch) return action({ type: "focus-next" });
  if (key.name === "left" && !editingSearch) return action({ type: "focus-previous" });
  if (key.name === "pageup") return action({ type: "page-up" });
  if (key.name === "pagedown") return action({ type: "page-down" });
  if (key.name === "home") return action({ type: "jump-first" });
  if (key.name === "end") return action({ type: "jump-last" });
  if (key.name === "down" || key.input === "j") return action({ type: "move-down" });
  if (key.name === "up" || key.input === "k") return action({ type: "move-up" });
  if (key.name === "return") {
    // Entering the conversation view needs the session's full context, which a
    // context-light snapshot does not carry yet.
    if (state.focusPane === "detail" && state.overlay === "none") return { type: "load-context" };
    return action({ type: "drill" });
  }

  return { type: "none" };
}

function action(value: LiteBrowserAction): LiteInputEffect {
  return { type: "action", action: value };
}

function isPrintable(key: LiteKey): boolean {
  // Multi-byte input from a CJK IME arrives as one composed string.
  return key.input.length > 0 && !key.ctrl && key.name === undefined;
}
