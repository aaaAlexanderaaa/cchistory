import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runCliCapture, seedCliFixtures } from "./helpers.js";

test("agent pair initializes remote agent link and pulls initial bundle", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-agent-pair-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");

    const result = await runCliCapture(["agent", "pair", "https://api.cchistory.com", "--token", "test-token", "--store", storeDir], tempRoot);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Paired with/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("agent pull retrieves latest sessions from paired remote agent", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-agent-pull-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");

    const result = await runCliCapture(["agent", "pull", "--store", storeDir], tempRoot);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Pull complete/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});
