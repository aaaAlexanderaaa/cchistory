import { spawn } from "node:child_process";
import os from "node:os";
import process from "node:process";

const MIB = 1024 ** 2;
const MAX_OLD_SPACE_MIB = 4096;
const APPLIED_MEMORY_ENV = "CCHISTORY_ADAPTIVE_NODE_MEMORY_MB";

export function calculateAdaptiveOldSpaceMiB(totalMemoryBytes: number): number {
  if (!Number.isFinite(totalMemoryBytes) || totalMemoryBytes <= 0) {
    throw new Error(`Host memory must be a positive finite byte count; received ${totalMemoryBytes}.`);
  }
  return Math.max(1, Math.min(Math.floor(totalMemoryBytes / (2 * MIB)), MAX_OLD_SPACE_MIB));
}

export function buildAdaptiveNodeExecArgv(execArgv: readonly string[], memoryMiB: number): string[] {
  const filtered: string[] = [];
  for (let index = 0; index < execArgv.length; index += 1) {
    const argument = execArgv[index]!;
    if (/^--max[-_]old[-_]space[-_]size=/u.test(argument)) continue;
    if (/^--max[-_]old[-_]space[-_]size$/u.test(argument)) {
      index += 1;
      continue;
    }
    filtered.push(argument);
  }
  return [...filtered, `--max-old-space-size=${memoryMiB}`];
}

export function isAdaptiveNodeMemoryApplied(
  execArgv: readonly string[],
  appliedMemoryEnv: string | undefined,
  memoryMiB: number,
): boolean {
  if (appliedMemoryEnv !== String(memoryMiB)) return false;
  return execArgv.some((argument) => {
    const match = /^--max[-_]old[-_]space[-_]size=(\d+)$/u.exec(argument);
    return match?.[1] === String(memoryMiB);
  });
}

export async function runWithAdaptiveNodeMemory(runCurrentProcess: () => Promise<number>): Promise<number> {
  const memoryMiB = calculateAdaptiveOldSpaceMiB(os.totalmem());
  if (isAdaptiveNodeMemoryApplied(process.execArgv, process.env[APPLIED_MEMORY_ENV], memoryMiB)) {
    return runCurrentProcess();
  }
  const entryPath = process.argv[1];
  if (!entryPath) return runCurrentProcess();

  return new Promise<number>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        ...buildAdaptiveNodeExecArgv(process.execArgv, memoryMiB),
        entryPath,
        ...process.argv.slice(2),
      ],
      {
        env: { ...process.env, [APPLIED_MEMORY_ENV]: String(memoryMiB) },
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
