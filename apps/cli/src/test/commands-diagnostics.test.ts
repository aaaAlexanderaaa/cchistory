import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runCliCapture, runCliJson, seedCliDiscoveryFixtures } from "./helpers.js";

test("discover lists Gemini CLI sync roots alongside discovery-only auxiliary paths", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-discover-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliDiscoveryFixtures(tempRoot);
    process.env.HOME = tempRoot;

    const result = await runCliJson<{
      tools: Array<{
        display_name: string;
        platform: string;
        capability: string;
        selected_path?: string;
        candidates: Array<{ path: string; exists: boolean }>;
      }>;
    }>(["discover"], tempRoot);

    const openclaw = result.tools.find((tool) => tool.platform === "openclaw");
    const opencode = result.tools.find((tool) => tool.platform === "opencode");

    assert.ok(openclaw, "OpenClaw should be discovered");
    assert.ok(opencode, "OpenCode should be discovered");
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("health combines discovery, sync preview, and indexed store summary in one command", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-health-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliDiscoveryFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");

    const result = await runCliCapture(["health", "--store", storeDir], tempRoot);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Host Discovery/);
    assert.match(result.stdout, /Sync Preview/);
    assert.match(result.stdout, /Indexed Store/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("templates prints format profiles without opening a store", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-templates-"));

  try {
    const profiles = await runCliJson<Array<{ id: string; family: string }>>(["templates"], tempRoot);
    assert.ok(profiles.length > 0);
    assert.ok(profiles.some((profile) => profile.family === "local_runtime_sessions"));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("--help renders usage without touching storage-backed commands", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-help-"));

  try {
    const result = await runCliCapture(["--help"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /^Usage:/);
    assert.match(result.stdout, /cchistory sync/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
