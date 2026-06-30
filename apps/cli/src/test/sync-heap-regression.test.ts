import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as fsSync from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

// Heap regression guard for the streaming sync refactor.
//
// Before the refactor, `cchistory sync` OOMed at 1.83 GB on a single 66 MB
// codex JSONL file because the monolithic SourceSyncPayload forced every
// record/fragment/atom/session/turn/context for the whole source to live in
// memory simultaneously. The streaming refactor bounds memory at ~one file's
// worth of derived structures — the probe yields one chunk per file, the
// storage layer processes chunks one at a time, and per-chunk derived data
// is freed before the next file flows through.
//
// This test creates multiple codex-shaped JSONL fixtures totaling ~20 MiB,
// spawns a child node process to sync them, samples VmHWM (peak RSS) from
// /proc/<pid>/status, and asserts the peak stays well under the 1.5 GB
// ceiling. With streaming, peak RSS is well under 1 GB regardless of file
// count; the 1.5 GB bound leaves headroom for V8 GC and JIT noise while
// still catching a regression to monolithic behavior, which on this fixture
// size would push peak past 2 GB (extrapolating from the original
// 66 MB → 1.83 GB = 28x).

const HEAP_REGRESSION_PEAK_RSS_BYTES = 1500 * 1024 * 1024;
const HEAP_REGRESSION_FILE_COUNT = 4;
const HEAP_REGRESSION_FILE_MIB = 5;

async function writeCodexFixture(filePath: string, sessionId: string, targetBytes: number): Promise<void> {
  const lines: string[] = [];
  lines.push(JSON.stringify({
    timestamp: "2026-01-01T00:00:00.000Z",
    type: "session_meta",
    payload: { id: sessionId, cwd: "/workspace/cchistory", model: "gpt-5" },
  }));
  const approximateTurnBytes = 600;
  const turnCount = Math.max(1, Math.floor(targetBytes / approximateTurnBytes));
  for (let i = 0; i < turnCount; i++) {
    const userTime = new Date(Date.UTC(2026, 0, 1) + i * 60_000);
    const assistantTime = new Date(userTime.getTime() + 1000);
    lines.push(JSON.stringify({
      timestamp: userTime.toISOString(),
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: `Heap regression prompt ${i}: ${"x".repeat(120)}` }],
      },
    }));
    lines.push(JSON.stringify({
      timestamp: assistantTime.toISOString(),
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: `Heap regression reply ${i}: ${"y".repeat(120)}` }],
      },
    }));
  }
  await writeFile(filePath, lines.join("\n"), "utf8");
}

interface ChildRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  peakRssBytes: number | undefined;
}

async function runCliChildAndSamplePeakRss(
  argv: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<ChildRunResult> {
  const cliEntry = fileURLToPath(new URL("../index.js", import.meta.url));
  const child = spawn(process.execPath, [cliEntry, ...argv], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let peakRssBytes: number | undefined;

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  // Sample VmHWM (peak resident set size) from /proc/<pid>/status every 100ms.
  // Linux-only — on other platforms peakRssBytes stays undefined and the
  // assertion degrades to "child completed successfully".
  const sampler = setInterval(async () => {
    try {
      const statusContents = await fsSync.readFile(`/proc/${child.pid}/status`, "utf8").catch(() => "");
      const match = statusContents.match(/VmHWM:\s*(\d+)\s*kB/i);
      if (match) {
        const sample = Number(match[1]) * 1024;
        if (peakRssBytes === undefined || sample > peakRssBytes) {
          peakRssBytes = sample;
        }
      }
    } catch {
      // ignore sampling errors
    }
  }, 100);

  try {
    const exitCode: number = await new Promise((resolve) => {
      child.on("exit", (code) => resolve(code ?? 0));
    });
    return { exitCode, stdout, stderr, peakRssBytes };
  } finally {
    clearInterval(sampler);
  }
}

test("streaming sync keeps peak RSS bounded across multiple codex files (heap regression guard)", async () => {
  // Linux-only: we sample /proc/<pid>/status for VmHWM (peak RSS).
  if (process.platform !== "linux") {
    return;
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-heap-"));
  try {
    await mkdir(path.join(tempRoot, ".codex", "sessions"), { recursive: true });
    const totalMiB = HEAP_REGRESSION_FILE_COUNT * HEAP_REGRESSION_FILE_MIB;
    for (let i = 0; i < HEAP_REGRESSION_FILE_COUNT; i++) {
      const fixturePath = path.join(tempRoot, ".codex", "sessions", `rollout-heap-${i}.jsonl`);
      await writeCodexFixture(fixturePath, `heap-regression-session-${i}`, HEAP_REGRESSION_FILE_MIB * 1024 * 1024);
    }

    const storeDir = path.join(tempRoot, "store");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: tempRoot,
    };

    const result = await runCliChildAndSamplePeakRss(
      ["sync", "--store", storeDir, "--source", "codex", "--json"],
      tempRoot,
      env,
    );

    assert.equal(result.exitCode, 0, `sync failed: ${result.stderr}`);
    const payload = JSON.parse(result.stdout) as { sources: Array<{ counts: { sessions: number; turns: number } }> };
    const codexSummary = payload.sources[0];
    assert.ok(codexSummary, "expected codex source in sync output");
    assert.ok(
      codexSummary.counts.sessions > 0,
      `expected non-zero sessions, got ${codexSummary.counts.sessions}`,
    );
    assert.ok(
      codexSummary.counts.turns > 0,
      `expected non-zero turns, got ${codexSummary.counts.turns}`,
    );

    if (result.peakRssBytes !== undefined) {
      const readableMb = (result.peakRssBytes / (1024 * 1024)).toFixed(1);
      assert.ok(
        result.peakRssBytes < HEAP_REGRESSION_PEAK_RSS_BYTES,
        `peak RSS ${readableMb} MiB exceeded threshold ${HEAP_REGRESSION_PEAK_RSS_BYTES / (1024 * 1024)} MiB (${HEAP_REGRESSION_FILE_COUNT} files × ${HEAP_REGRESSION_FILE_MIB} MiB = ${totalMiB} MiB total)`,
      );
      // eslint-disable-next-line no-console
      console.log(`heap-regression: peak RSS ${readableMb} MiB (${totalMiB} MiB across ${HEAP_REGRESSION_FILE_COUNT} files)`);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
