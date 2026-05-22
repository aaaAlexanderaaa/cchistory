import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runCliCapture, runCliJson, seedCliDiscoveryFixtures, seedCliFixtures } from "./helpers.js";

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

test("command help renders from the registry without opening a store", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-command-help-"));

  try {
    const searchHelp = await runCliCapture(["search", "--help"], tempRoot);
    assert.equal(searchHelp.exitCode, 0, searchHelp.stderr);
    assert.match(searchHelp.stdout, /Usage: cchistory search <query>/);
    assert.match(searchHelp.stdout, /--project <ref>/);
    assert.doesNotMatch(searchHelp.stderr, /Store not found|unable to open database/);

    const agentHelp = await runCliCapture(["help", "agent", "pull"], tempRoot);
    assert.equal(agentHelp.exitCode, 0, agentHelp.stderr);
    assert.match(agentHelp.stdout, /Usage: cchistory agent pull/);
    assert.match(agentHelp.stdout, /--state-file <file>/);
    assert.doesNotMatch(agentHelp.stderr, /Store not found|unable to open database/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("parser accepts global and command flags before or after positionals", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-parse-order-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");
    const syncResult = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);

    const globalFirst = await runCliCapture(["--json", "search", "probe", "--store", storeDir], tempRoot);
    assert.equal(globalFirst.exitCode, 0, globalFirst.stderr);
    assert.equal(JSON.parse(globalFirst.stdout).kind, "search");

    const globalLast = await runCliCapture(["search", "probe", "--store", storeDir, "--json"], tempRoot);
    assert.equal(globalLast.exitCode, 0, globalLast.stderr);
    assert.equal(JSON.parse(globalLast.stdout).kind, "search");

    const commandOptionBeforeQuery = await runCliCapture(["search", "--limit", "1", "probe", "--store", storeDir, "--json"], tempRoot);
    assert.equal(commandOptionBeforeQuery.exitCode, 0, commandOptionBeforeQuery.stderr);
    const payload = JSON.parse(commandOptionBeforeQuery.stdout);
    assert.equal(payload.kind, "search");
    assert.ok(payload.results.length <= 1);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("parser rejects unknown, invalid, and duplicate command options", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-strict-"));

  try {
    const unknown = await runCliCapture(["search", "probe", "--unknown"], tempRoot);
    assert.equal(unknown.exitCode, 1);
    assert.match(unknown.stderr, /Unknown option '--unknown'/);

    const wrongCommand = await runCliCapture(["search", "probe", "--out", "bundle"], tempRoot);
    assert.equal(wrongCommand.exitCode, 1);
    assert.match(wrongCommand.stderr, /Unknown option for `search`: --out/);

    const invalidNumber = await runCliCapture(["search", "--limit", "nope", "probe"], tempRoot);
    assert.equal(invalidNumber.exitCode, 1);
    assert.match(invalidNumber.stderr, /Invalid numeric value for --limit: nope/);

    const duplicate = await runCliCapture(["search", "--limit", "1", "--limit", "2", "probe"], tempRoot);
    assert.equal(duplicate.exitCode, 1);
    assert.match(duplicate.stderr, /Option --limit can only be provided once/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("errors hide stack traces unless debug is enabled", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-debug-"));
  const originalDebug = process.env.CCHISTORY_DEBUG;

  try {
    delete process.env.CCHISTORY_DEBUG;
    const normal = await runCliCapture(["unknown"], tempRoot);
    assert.equal(normal.exitCode, 1);
    assert.doesNotMatch(normal.stderr, /\n\s+at /);

    const flagDebug = await runCliCapture(["--debug", "unknown"], tempRoot);
    assert.equal(flagDebug.exitCode, 1);
    assert.match(flagDebug.stderr, /\n\s+at /);

    process.env.CCHISTORY_DEBUG = "1";
    const envDebug = await runCliCapture(["unknown"], tempRoot);
    assert.equal(envDebug.exitCode, 1);
    assert.match(envDebug.stderr, /\n\s+at /);
  } finally {
    if (originalDebug === undefined) {
      delete process.env.CCHISTORY_DEBUG;
    } else {
      process.env.CCHISTORY_DEBUG = originalDebug;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("--no-color disables ANSI even when FORCE_COLOR is set", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-no-color-"));
  const originalForceColor = process.env.FORCE_COLOR;
  const originalNoColor = process.env.NO_COLOR;

  try {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;

    const colored = await runCliCapture(["unknown"], tempRoot);
    assert.equal(colored.exitCode, 1);
    assert.match(colored.stderr, /\x1b\[/);

    const plain = await runCliCapture(["--no-color", "unknown"], tempRoot);
    assert.equal(plain.exitCode, 1);
    assert.doesNotMatch(plain.stderr, /\x1b\[/);
  } finally {
    if (originalForceColor === undefined) {
      delete process.env.FORCE_COLOR;
    } else {
      process.env.FORCE_COLOR = originalForceColor;
    }
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});
