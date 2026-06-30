import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runCliCapture, writeCodexSessionFixture } from "./helpers.js";

test("sync reuses externally-touched Codex files via checksum L2 when mtime-based L0 fails", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-touch-"));
  const originalHome = process.env.HOME;

  try {
    process.env.HOME = tempRoot;
    await mkdir(path.join(tempRoot, ".codex", "sessions"), { recursive: true });
    const filePath = path.join(tempRoot, ".codex", "sessions", "rollout-codex-touched.jsonl");
    await writeCodexSessionFixture(tempRoot, "rollout-codex-touched.jsonl", {
      sessionId: "codex-touched-session",
      cwd: "/workspace/cchistory",
      model: "gpt-5",
      prompt: "Touch-test prompt stays indexed after external touch.",
      reply: "Touch-test reply survives re-sync without re-capture.",
      startAt: "2026-03-09T00:00:00.000Z",
    });
    const originalDate = new Date("2020-01-01T00:00:00.000Z");
    await utimes(filePath, originalDate, originalDate);

    const storeDir = path.join(tempRoot, "store");
    const firstSync = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(firstSync.exitCode, 0, firstSync.stderr);

    await utimes(filePath, new Date(), new Date());

    const result = await runCliCapture(
      ["sync", "--store", storeDir, "--source", "codex", "--since", "1h", "--detail"],
      tempRoot,
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stderr, /\[sync:codex:file_capture_done\]/);
    assert.match(result.stderr, /\[sync:codex:file_reuse\]/);
    assert.doesNotMatch(result.stderr, /\[sync:codex:file_parse_done\]/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync reuses externally-touched Claude Code files via checksum L2", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-touch-claude-"));
  const originalHome = process.env.HOME;

  try {
    process.env.HOME = tempRoot;
    const projectDir = path.join(tempRoot, ".claude", "projects", "/workspace-cchistory");
    await mkdir(projectDir, { recursive: true });
    const filePath = path.join(projectDir, "session-claude-touched.jsonl");
    const startedAt = "2026-03-09T00:00:00.000Z";
    const userAt = "2026-03-09T00:00:01.000Z";
    const assistantAt = "2026-03-09T00:00:02.000Z";
    const sessionLines = [
      JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: "Claude touch-test prompt." }] },
        timestamp: userAt,
        sessionId: "claude-touched-session",
        cwd: "/workspace-cchistory",
        version: "1.0",
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "Claude touch-test reply." }],
        },
        timestamp: assistantAt,
        sessionId: "claude-touched-session",
        cwd: "/workspace-cchistory",
        version: "1.0",
      }),
    ].join("\n") + "\n";
    await writeFile(filePath, sessionLines, "utf8");
    await utimes(filePath, new Date(startedAt), new Date(startedAt));

    const storeDir = path.join(tempRoot, "store");
    const firstSync = await runCliCapture(
      ["sync", "--store", storeDir, "--source", "claude_code"],
      tempRoot,
    );
    assert.equal(firstSync.exitCode, 0, firstSync.stderr);

    await utimes(filePath, new Date(), new Date());

    const result = await runCliCapture(
      ["sync", "--store", storeDir, "--source", "claude_code", "--since", "1h", "--detail"],
      tempRoot,
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stderr, /\[sync:claude_code:file_capture_done\]/);
    assert.match(result.stderr, /\[sync:claude_code:file_reuse\]/);
    assert.doesNotMatch(result.stderr, /\[sync:claude_code:file_parse_done\]/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});
