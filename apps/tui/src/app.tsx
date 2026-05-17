import React, { useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { LocalTuiBrowser } from "@cchistory/storage";
import { createBrowserState, reduceBrowserState, renderBrowserSnapshot } from "./browser.js";
import type { BrowserAction, BrowserState } from "./browser.js";
import { resolveTuiInputEffect } from "./input.js";

export interface TuiAppProps {
  browser: LocalTuiBrowser;
}

export function TuiApp({ browser }: TuiAppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const termHeight = stdout?.rows ?? 40;
  const termWidth = stdout?.columns ?? 120;
  const stateRef = useRef<BrowserState | null>(null);
  const [state, setState] = useState<BrowserState>(() => {
    const initialState = createBrowserState(browser);
    stateRef.current = initialState;
    return initialState;
  });
  stateRef.current = state;

  function dispatchAction(action: BrowserAction) {
    const currentState = stateRef.current ?? state;
    const nextState = reduceBrowserState(browser, currentState, action);
    stateRef.current = nextState;
    setState(nextState);
  }

  // Alternate screen + scroll mode (1049h, 1007h) are managed by index.ts
  // before Ink starts, so all frames render inside the alternate screen.

  useInput((input, key) => {
    const effect = resolveTuiInputEffect(stateRef.current ?? state, input, key);
    if (effect.type === "exit") {
      exit();
      return;
    }
    if (effect.type === "action") {
      dispatchAction(effect.action);
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
