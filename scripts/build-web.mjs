#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");
const memMb = process.env.NODE_MEMORY_MB || "1536";
const existing = (process.env.NODE_OPTIONS || "").trim();
const nodeOptions = existing ? `${existing} --max-old-space-size=${memMb}` : `--max-old-space-size=${memMb}`;

const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(pnpmBin, ["--filter", "@cchistory/web", "build"], {
  stdio: "inherit",
  cwd: rootDir,
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});

child.on("exit", (code) => process.exit(code ?? 1));
