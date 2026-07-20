import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deriveSourceFileLogicalSessionKey } from "./session-grouping.js";
import { deriveSessionId } from "./source-identity.js";

test("deriveSourceFileLogicalSessionKey keys on the first non-empty record", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cchistory-grouping-first-line-"));
  try {
    const filePath = path.join(dir, "session-file.jsonl");
    const firstRecord = JSON.stringify({
      type: "user",
      sessionId: "grouping-session-1",
      cwd: "/workspace/grouping",
      timestamp: "2026-07-01T00:00:00.000Z",
      message: { role: "user", content: "hello" },
    });
    await writeFile(filePath, `\n${firstRecord}\n`, "utf8");
    const key = await deriveSourceFileLogicalSessionKey("claude_code", filePath);
    assert.equal(key, deriveSessionId("claude_code", filePath, Buffer.from(firstRecord, "utf8")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("deriveSourceFileLogicalSessionKey degrades to the path-based key when the file cannot be read", async () => {
  const missing = path.join(os.tmpdir(), `cchistory-grouping-missing-${process.pid}-${Date.now()}.jsonl`);
  const key = await deriveSourceFileLogicalSessionKey("claude_code", missing);
  assert.equal(key, deriveSessionId("claude_code", missing, Buffer.alloc(0)));
});
