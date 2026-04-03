import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createApiRuntime } from "../../apps/api/dist/app.js";
import { runCli } from "../../apps/cli/dist/index.js";

// --- In-process CLI helpers ---

export function createIo(cwd) {
  const stdout = [];
  const stderr = [];
  return {
    io: {
      cwd,
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
      isInteractiveTerminal: false,
    },
    stdout,
    stderr,
  };
}

export async function runCliJson(argv, cwd) {
  const { io, stdout, stderr } = createIo(cwd);
  const exitCode = await runCli([...argv, "--json"], io);
  assert.equal(exitCode, 0, stderr.join(""));
  return JSON.parse(stdout.join(""));
}

export async function runCliCapture(argv, cwd) {
  const { io, stdout, stderr } = createIo(cwd);
  const exitCode = await runCli(argv, io);
  return { exitCode, stdout: stdout.join(""), stderr: stderr.join("") };
}

// --- Out-of-process (skeptical) helpers ---

export async function runBuiltCliCapture(argv, cwd, env = process.env) {
  const cliEntry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../apps/cli/dist/index.js");
  return await new Promise((resolve, reject) => {
    execFile(process.execPath, [cliEntry, ...argv], { cwd, env }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") {
        reject(error);
        return;
      }
      resolve({
        exitCode: typeof error?.code === "number" ? Number(error.code) : 0,
        stdout,
        stderr,
      });
    });
  });
}

export async function runBuiltCliJson(argv, cwd, env = process.env) {
  const result = await runBuiltCliCapture([...argv, "--json"], cwd, env);
  assert.equal(result.exitCode, 0, result.stderr);
  return JSON.parse(result.stdout);
}

export async function fileExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

// --- API helper ---

export async function verifyApiTurn(storeDir, turnId, pattern) {
  const runtime = await createApiRuntime({ dataDir: storeDir, sources: [] });
  try {
    const response = await runtime.app.inject({ method: "GET", url: `/api/turns/${turnId}` });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.match(body.turn.canonical_text, pattern);
  } finally {
    await runtime.app.close();
    runtime.storage.close();
  }
}

// --- Codex fixture helper ---

export async function seedCodexFixtureHome(tempRoot, options = {}) {
  const {
    fileName = "session.jsonl",
    sessionId = "codex-session-1",
    cwd = "/workspace/cchistory",
    model = "gpt-5",
    prompt = "continue",
    reply = "Prompt acknowledged.",
    startAt = "2026-03-09T00:00:00.000Z",
  } = options;
  await mkdir(path.join(tempRoot, ".codex", "sessions"), { recursive: true });
  await writeCodexSessionFixture(tempRoot, fileName, { sessionId, cwd, model, prompt, reply, startAt });
}

export async function writeCodexSessionFixture(tempRoot, fileName, input) {
  const startAt = new Date(input.startAt);
  const userAt = new Date(startAt.getTime() + 1000).toISOString();
  const assistantAt = new Date(startAt.getTime() + 2000).toISOString();
  await writeFile(
    path.join(tempRoot, ".codex", "sessions", fileName),
    [
      {
        timestamp: input.startAt,
        type: "session_meta",
        payload: { id: input.sessionId, cwd: input.cwd, model: input.model },
      },
      {
        timestamp: userAt,
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: input.prompt }] },
      },
      {
        timestamp: assistantAt,
        type: "response_item",
        payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: input.reply }] },
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n"),
    "utf8",
  );
}
