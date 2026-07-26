import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { inspectSourceFileInventory } from "./path-utils.js";

test("source inventory is incomplete until every supplemental root is available", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-source-roots-"));
  try {
    const openClawHome = path.join(tempRoot, ".openclaw");
    const agentsRoot = path.join(openClawHome, "agents");
    const sessionRoot = path.join(agentsRoot, "main", "sessions");
    const cronRoot = path.join(openClawHome, "cron", "runs");
    const sessionPath = path.join(sessionRoot, "session.jsonl");
    const cronPath = path.join(cronRoot, "run.jsonl");
    await mkdir(sessionRoot, { recursive: true });
    await writeFile(sessionPath, "{}\n", "utf8");

    const incomplete = await inspectSourceFileInventory("openclaw", agentsRoot);
    assert.equal(incomplete.complete, false);
    assert.deepEqual(incomplete.files, [sessionPath]);
    assert.deepEqual(incomplete.missing_roots, [cronRoot]);

    await mkdir(cronRoot, { recursive: true });
    await writeFile(cronPath, "{}\n", "utf8");
    const complete = await inspectSourceFileInventory("openclaw", agentsRoot);
    assert.equal(complete.complete, true);
    assert.deepEqual(complete.missing_roots, []);
    assert.deepEqual(complete.files.sort(), [cronPath, sessionPath].sort());
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
