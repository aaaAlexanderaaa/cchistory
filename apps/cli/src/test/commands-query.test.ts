import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runCliCapture, seedCliFixtures } from "./helpers.js";

test("search matches partial keywords without requiring an exact phrase", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-search-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");

    await runCliCapture(["sync", "--store", storeDir], tempRoot);
    const result = await runCliCapture(["search", "probe output", "--store", storeDir], tempRoot);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Review the probe output/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("show session and query session accept human-friendly session references", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-session-refs-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");

    await runCliCapture(["sync", "--store", storeDir], tempRoot);

    // Use full session ID to avoid ambiguity (short prefixes like "sess" match multiple sessions)
    const sessionList = await runCliCapture(["ls", "sessions", "--store", storeDir, "--json"], tempRoot);
    const sessionsPayload = JSON.parse(sessionList.stdout);
    const sessions = sessionsPayload.sessions ?? sessionsPayload;
    const firstSessionId = sessions[0].id;

    const showResult = await runCliCapture(["show", "session", firstSessionId, "--store", storeDir], tempRoot);
    assert.equal(showResult.exitCode, 0);
    assert.match(showResult.stdout, /Title/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("tree session renders turn hierarchy for a specific session", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-tree-session-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");

    await runCliCapture(["sync", "--store", storeDir], tempRoot);
    const sessionList = await runCliCapture(["ls", "sessions", "--store", storeDir, "--json"], tempRoot);
    const sessionsPayload = JSON.parse(sessionList.stdout);
    const sessions = sessionsPayload.sessions ?? sessionsPayload;
    const firstSessionId = sessions[0].id;

    const treeResult = await runCliCapture(["tree", "session", firstSessionId, "--store", storeDir], tempRoot);
    assert.equal(treeResult.exitCode, 0);
    assert.match(treeResult.stdout, /Turns/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});
