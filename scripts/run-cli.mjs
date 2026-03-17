#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");
const memMb = process.env.CLI_NODE_MEMORY_MB || "768";
const existing = (process.env.NODE_OPTIONS || "").trim();
const nodeOptions = existing ? `${existing} --max-old-space-size=${memMb}` : `--max-old-space-size=${memMb}`;

const child = spawn(process.execPath, [path.join(rootDir, "apps/cli/dist/index.js"), ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});

child.on("exit", (code) => process.exit(code ?? 1));
