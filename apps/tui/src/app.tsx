import React, { useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { LocalTuiBrowser } from "@cchistory/storage";
import { createBrowserState, reduceBrowserState, renderBrowserSnapshot } from "./browser.js";

export interface TuiAppProps {
  browser: LocalTuiBrowser;
}

export function TuiApp({ browser }: TuiAppProps) {
  const { exit } = useApp();
  const [state, setState] = useState(() => createBrowserState(browser));

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }

    if (key.escape) {
      if (state.showHelp) {
        setState((current) => reduceBrowserState(browser, current, { type: "close-help" }));
        return;
      }
      if (state.showSourceHealth) {
        setState((current) => reduceBrowserState(browser, current, { type: "close-source-health" }));
        return;
      }
      if (state.mode === "search" && state.focusPane === "projects") {
        setState((current) => reduceBrowserState(browser, current, { type: "exit-search-mode" }));
        return;
      }
      setState((current) => reduceBrowserState(browser, current, { type: "retreat" }));
      return;
    }

    const editingSearch = state.mode === "search" && state.focusPane === "projects";
    if (editingSearch) {
      if (key.backspace || key.delete) {
        setState((current) => reduceBrowserState(browser, current, { type: "backspace-search" }));
        return;
      }
      if (key.return || input === "\t" || key.tab || key.rightArrow || key.leftArrow || key.upArrow || key.downArrow) {
      } else if (isPrintableSearchInput(input, key)) {
        setState((current) => reduceBrowserState(browser, current, { type: "append-search-char", value: input }));
        return;
      }
    }

    if (input === "q") {
      exit();
      return;
    }

    if (input === "?") {
      setState((current) => reduceBrowserState(browser, current, { type: "toggle-help" }));
      return;
    }

    if (input === "/") {
      setState((current) => reduceBrowserState(browser, current, { type: "enter-search-mode" }));
      return;
    }

    if (input === "s") {
      setState((current) => reduceBrowserState(browser, current, { type: "toggle-source-health" }));
      return;
    }

    if (input === "p") {
      setState((current) => reduceBrowserState(browser, current, { type: "focus-projects" }));
      return;
    }

    if (input === "t") {
      setState((current) => reduceBrowserState(browser, current, { type: "focus-turns" }));
      return;
    }

    if (input === "d") {
      setState((current) => reduceBrowserState(browser, current, { type: "focus-detail" }));
      return;
    }

    if (input === "\t" || key.tab || key.rightArrow) {
      setState((current) => reduceBrowserState(browser, current, { type: "focus-next" }));
      return;
    }

    if (input === "\u001B[Z" || key.leftArrow) {
      setState((current) => reduceBrowserState(browser, current, { type: "focus-previous" }));
      return;
    }

    if (input === "j" || key.downArrow) {
      setState((current) => reduceBrowserState(browser, current, { type: "move-down" }));
      return;
    }

    if (input === "k" || key.upArrow) {
      setState((current) => reduceBrowserState(browser, current, { type: "move-up" }));
      return;
    }

    if (key.return) {
      setState((current) => reduceBrowserState(browser, current, { type: "drill" }));
    }
  });

  const lines = useMemo(() => renderBrowserSnapshot(browser, state).split("\n"), [browser, state]);

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Text key={`${index}-${line}`} color={colorForLine(line)}>
          {line}
        </Text>
      ))}
    </Box>
  );
}

function colorForLine(line: string): "cyan" | "green" | "yellow" | undefined {
  if (/^CCHistory TUI$/.test(line)) {
    return "green";
  }
  if (/ \[active\]:$/.test(line)) {
    return "cyan";
  }
  if (/^(Help|Source Health):/.test(line)) {
    return "yellow";
  }
  return undefined;
}

function isPrintableSearchInput(input: string, key: { ctrl: boolean; meta: boolean; shift: boolean }): boolean {
  return input.length === 1 && !key.ctrl && !key.meta;
}
