import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runSourceProbe } from "../index.js";
import { 
  createSourceDefinition 
} from "../test-helpers.js";

test("runSourceProbe ingests CodeBuddy transcript JSONL while keeping skipRun echoes and empty siblings out of turns", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-adapters-"));

  try {
    const codebuddyDir = path.join(tempRoot, "codebuddy");
    await mkdir(codebuddyDir, { recursive: true });
    await writeFile(
      path.join(codebuddyDir, "transcript.jsonl"),
      [
        {
          timestamp: "2026-03-09T05:00:00.000Z",
          type: "user",
          message: "How do I continue with CodeBuddy?",
        },
        {
          timestamp: "2026-03-09T05:00:01.000Z",
          type: "assistant",
          message: "Start with the codebuddy harness.",
        },
        {
          timestamp: "2026-03-09T05:00:02.000Z",
          type: "skip_run",
          command: "echo 'skipping'",
        },
        {
          timestamp: "2026-03-09T05:00:03.000Z",
          type: "user",
          message: "",
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n"),
      "utf8",
    );

    const [payload] = (await runSourceProbe(
      { source_ids: ["src-codebuddy"] },
      [createSourceDefinition("src-codebuddy", "codebuddy", codebuddyDir)],
    )).sources;

    assert.ok(payload);
    assert.equal(payload.sessions.length, 1);
    assert.equal(payload.turns.length, 1);
    assert.equal(payload.turns[0]?.canonical_text, "How do I continue with CodeBuddy?");
    
    const skipRunAudit = payload.loss_audits.find((audit) => audit.diagnostic_code === "codebuddy_skiprun_command_echo");
    assert.ok(skipRunAudit);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
