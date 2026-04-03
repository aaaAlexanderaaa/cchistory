#!/usr/bin/env node

import { realpathSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import type { runCli as mainRunCli } from "./main.js";

const SQLITE_EXPERIMENTAL_WARNING_TEXT = "SQLite is an experimental feature and might change at any time";
const SHOW_RUNTIME_WARNINGS_ENV = "CCHISTORY_SHOW_RUNTIME_WARNINGS";

installCliRuntimeWarningFilter();

const mainModulePromise = import("./main.js");

function installCliRuntimeWarningFilter(): void {
  if (process.env[SHOW_RUNTIME_WARNINGS_ENV] === "1") {
    return;
  }

  const currentEmitWarning = process.emitWarning as typeof process.emitWarning & {
    __cchistoryRuntimeFilterInstalled?: boolean;
  };
  if (currentEmitWarning.__cchistoryRuntimeFilterInstalled) {
    return;
  }

  const originalEmitWarning = process.emitWarning.bind(process);
  const filteredEmitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const message = typeof warning === "string" ? warning : warning.message;
    if (message.includes(SQLITE_EXPERIMENTAL_WARNING_TEXT)) {
      return;
    }
    return (originalEmitWarning as (...values: unknown[]) => void)(warning, ...args);
  }) as typeof process.emitWarning & { __cchistoryRuntimeFilterInstalled?: boolean };

  filteredEmitWarning.__cchistoryRuntimeFilterInstalled = true;
  process.emitWarning = filteredEmitWarning;
}

export async function runCli(...args: Parameters<typeof mainRunCli>): ReturnType<typeof mainRunCli> {
  const { runCli: delegatedRunCli } = await mainModulePromise;
  return delegatedRunCli(...args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const { runCli: delegatedRunCli } = await mainModulePromise;
  delegatedRunCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
