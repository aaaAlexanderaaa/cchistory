import React, { useMemo, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { LocalTuiBrowser } from "@cchistory/storage";
import { createBrowserState, reduceBrowserState, renderBrowserSnapshot } from "./browser.js";

export interface TuiAppProps {
  browser: LocalTuiBrowser;
}

export function TuiApp({ browser }: TuiAppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const termHeight = stdout?.rows ?? 40;
  const termWidth = stdout?.columns ?? 120;
  const [state, setState] = useState(() => createBrowserState(browser));

  // Alternate screen + scroll mode (1049h, 1007h) are managed by index.ts
  // before Ink starts, so all frames render inside the alternate screen.

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }

    if (key.escape) {
      if (state.showHelp) {
        setState(current => reduceBrowserState(browser, current, { type: "close-help" }));
        return;
      }
      if (state.showSourceHealth) {
        setState(current => reduceBrowserState(browser, current, { type: "close-source-health" }));
        return;
      }
      if (state.showStats) {
        setState(current => reduceBrowserState(browser, current, { type: "close-stats" }));
        return;
      }
      setState(current => reduceBrowserState(browser, current, { type: "retreat" }));
      return;
    }

    const editingSearch = state.mode === "search" && state.focusPane === "projects";
    if (editingSearch) {
      if (key.backspace || key.delete) {
        setState(current => reduceBrowserState(browser, current, { type: "backspace-search" }));
        return;
      }
      if (key.return) {
        // Commit search for short queries, then fall through to navigation
        setState(current => reduceBrowserState(browser, current, { type: "commit-search" }));
        return;
      } else if (input === "\t" || key.tab || key.rightArrow || key.leftArrow || key.upArrow || key.downArrow) {
        // fall through to navigation handling
      } else if (isPrintableSearchInput(input, key)) {
        setState(current => reduceBrowserState(browser, current, { type: "append-search-char", value: input }));
        return;
      }
    }

    if (input === "q" && !editingSearch) { exit(); return; }
    if (input === "?" && !editingSearch) {
      setState(current => reduceBrowserState(browser, current, { type: "toggle-help" }));
      return;
    }
    if (input === "/" && !editingSearch) {
      setState(current => reduceBrowserState(browser, current, { type: "enter-search-mode" }));
      return;
    }
    if (input === "s" && !editingSearch) {
      setState(current => reduceBrowserState(browser, current, { type: "toggle-source-health" }));
      return;
    }
    if (input === "i" && !editingSearch) {
      setState(current => reduceBrowserState(browser, current, { type: "toggle-stats" }));
      return;
    }
    if (state.showStats && (input === "\t" || key.tab)) {
      setState(current => reduceBrowserState(browser, current, { type: "cycle-stats-time-window" }));
      return;
    }
    if (input === "p" && !editingSearch) {
      setState(current => reduceBrowserState(browser, current, { type: "focus-projects" }));
      return;
    }
    if (input === "t" && !editingSearch) {
      setState(current => reduceBrowserState(browser, current, { type: "focus-turns" }));
      return;
    }
    if (input === "d" && !editingSearch) {
      setState(current => reduceBrowserState(browser, current, { type: "focus-detail" }));
      return;
    }
    if (input === "\t" || key.tab || key.rightArrow) {
      setState(current => reduceBrowserState(browser, current, { type: "focus-next" }));
      return;
    }
    if (input === "\u001B[Z" || key.leftArrow) {
      setState(current => reduceBrowserState(browser, current, { type: "focus-previous" }));
      return;
    }
    if (key.pageUp || input === "\u001B[5~") {
      setState(current => reduceBrowserState(browser, current, { type: "page-up" }));
      return;
    }
    if (key.pageDown || input === "\u001B[6~") {
      setState(current => reduceBrowserState(browser, current, { type: "page-down" }));
      return;
    }
    if (input === "g" && !key.shift && !editingSearch) {
      setState(current => reduceBrowserState(browser, current, { type: "jump-first" }));
      return;
    }
    if (input === "G" && !editingSearch) {
      setState(current => reduceBrowserState(browser, current, { type: "jump-last" }));
      return;
    }
    if (input === "j" || key.downArrow) {
      setState(current => reduceBrowserState(browser, current, { type: "move-down" }));
      return;
    }
    if (input === "k" || key.upArrow) {
      setState(current => reduceBrowserState(browser, current, { type: "move-up" }));
      return;
    }
    if (key.return) {
      setState(current => reduceBrowserState(browser, current, { type: "drill" }));
    }
  });

  const snapshot = useMemo(
    () => renderBrowserSnapshot(browser, state, { width: termWidth, height: termHeight }),
    [browser, state, termWidth, termHeight],
  );
  const lines = useMemo(() => snapshot.split("\n").slice(0, termHeight - 1), [snapshot, termHeight]);

  return (
    <Box flexDirection="column" height={termHeight}>
      {lines.map((line, index) => (
        <Text key={`${index}-${hashLine(line)}`}>
          {line}
        </Text>
      ))}
    </Box>
  );
}

function hashLine(line: string): string {
  let h = 0;
  for (let i = 0; i < line.length; i++) {
    h = ((h << 5) - h + line.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

function isPrintableSearchInput(input: string, key: { ctrl: boolean; meta: boolean; shift: boolean }): boolean {
  // Accept multi-byte input from CJK IME (length > 1 is normal for composed chars)
  return input.length > 0 && !key.ctrl && !key.meta;
}
