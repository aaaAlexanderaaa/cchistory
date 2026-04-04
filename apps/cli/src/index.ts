#!/usr/bin/env node

import { realpathSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import type { runCli as mainRunCli } from "./main.js";
import { installRuntimeWarningFilter } from "@cchistory/storage/runtime-warning-filter";

installRuntimeWarningFilter();

const mainModulePromise = import("./main.js");

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
