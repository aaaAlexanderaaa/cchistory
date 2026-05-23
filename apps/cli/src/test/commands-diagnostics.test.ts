import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileExists, runCliCapture, runCliJson, seedCliDiscoveryFixtures, seedCliFixtures } from "./helpers.js";

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

test("sync --detail reports source, file, write, and reindex progress on stderr", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-detail-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");

    const result = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--detail"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Synced 1 source\(s\)/);
    assert.match(result.stderr, /\[sync:codex:source_start\]/);
    assert.match(result.stderr, /\[sync:codex:file_start\]/);
    assert.match(result.stderr, /\[sync:codex:write_store_start\]/);
    assert.match(result.stderr, /\[sync:codex:reindex_done\]/);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync --progress jsonl emits machine-readable progress without corrupting stdout JSON", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-jsonl-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");

    const result = await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--json", "--progress", "jsonl"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.command, "sync");
    const progress = result.stderr.trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(progress.some((entry) => entry.kind === "sync-progress" && entry.stage === "source_start"));
    assert.ok(progress.some((entry) => entry.kind === "sync-progress" && entry.stage === "reindex_done"));
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("sync records an unavailable selected source as an error and continues with healthy sources", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-sync-partial-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");
    await rm(path.join(tempRoot, ".claude"), { recursive: true, force: true });

    const result = await runCliCapture([
      "sync",
      "--store",
      storeDir,
      "--source",
      "codex",
      "--source",
      "claude_code",
      "--json",
    ], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.command, "sync");
    assert.equal(payload.sources.length, 2);
    assert.ok(payload.sources.some((entry: { source: { slot_id: string; sync_status: string } }) =>
      entry.source.slot_id === "codex" && entry.source.sync_status === "healthy"));
    assert.ok(payload.failures.some((failure: { slot_id: string; error_message: string }) =>
      failure.slot_id === "claude_code" && /Source path not found/.test(failure.error_message)));
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("doctor reports store compatibility and source diagnostics without creating a store", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-doctor-"));
  const originalHome = process.env.HOME;

  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");
    const payload = await runCliJson<{
      kind: string;
      store: { status: string; future_schema: boolean };
      adapters: Array<{ platform: string; support_tier: string }>;
      capped_probes: Array<{ slot_id: string; status: string }>;
    }>(["doctor", "--store", storeDir, "--source", "codex"], tempRoot);

    assert.equal(payload.kind, "doctor");
    assert.equal(payload.store.status, "missing");
    assert.equal(payload.store.future_schema, false);
    assert.ok(payload.adapters.some((adapter) => adapter.platform === "codex" && adapter.support_tier === "stable"));
    assert.ok(payload.capped_probes.some((probe) => probe.slot_id === "codex"));
    assert.equal(await fileExists(path.join(storeDir, "cchistory.sqlite")), false);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("doctor reports future store schemas read-only instead of migrating them", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-doctor-future-"));

  try {
    const storeDir = path.join(tempRoot, "store");
    const dbPath = path.join(storeDir, "cchistory.sqlite");
    await mkdir(storeDir, { recursive: true });
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`
        CREATE TABLE schema_meta (
          key TEXT PRIMARY KEY,
          value_text TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      db.prepare("INSERT INTO schema_meta (key, value_text, updated_at) VALUES (?, ?, ?)")
        .run("schema_version", "2999-01-01.1", "2999-01-01T00:00:00.000Z");
    } finally {
      db.close();
    }

    const payload = await runCliJson<{
      store: { status: string; schema_version: string; future_schema: boolean };
    }>(["doctor", "--store", storeDir, "--store-only"], tempRoot);

    assert.equal(payload.store.status, "future_schema");
    assert.equal(payload.store.schema_version, "2999-01-01.1");
    assert.equal(payload.store.future_schema, true);
  } finally {
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
    assert.match(result.stdout, /--index\s+Read from existing store only/);
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
    assert.match(searchHelp.stdout, /--index\s+Read from existing store only/);
    assert.doesNotMatch(searchHelp.stderr, /Store not found|unable to open database/);

    const agentHelp = await runCliCapture(["help", "agent", "pull"], tempRoot);
    assert.equal(agentHelp.exitCode, 0, agentHelp.stderr);
    assert.match(agentHelp.stdout, /Usage: cchistory agent pull/);
    assert.match(agentHelp.stdout, /--state-file <file>/);
    assert.doesNotMatch(agentHelp.stderr, /Store not found|unable to open database/);

    const statsHelp = await runCliCapture(["help", "stats"], tempRoot);
    assert.equal(statsHelp.exitCode, 0, statsHelp.stderr);
    assert.match(statsHelp.stdout, /Usage: cchistory stats \[--by model\|project\|source\|host\|day\|month\]/);
    assert.match(statsHelp.stdout, /--by <dimension>\s+Group token usage by this dimension\. One of: model, project, source, host, day, month\./);
    assert.match(statsHelp.stdout, /cchistory stats --by model/);

    const statsUsageHelp = await runCliCapture(["stats", "usage", "--help"], tempRoot);
    assert.equal(statsUsageHelp.exitCode, 0, statsUsageHelp.stderr);
    assert.match(statsUsageHelp.stdout, /Usage: cchistory stats usage --by model\|project\|source\|host\|day\|month/);
    assert.match(statsUsageHelp.stdout, /--by <dimension>\s+Group token usage by this dimension\. One of: model, project, source, host, day, month\./);
    assert.doesNotMatch(statsUsageHelp.stderr, /Store not found|unable to open database/);

    const mergeHelp = await runCliCapture(["help", "merge"], tempRoot);
    assert.equal(mergeHelp.exitCode, 0, mergeHelp.stderr);
    assert.match(mergeHelp.stdout, /--on-conflict <mode>\s+Conflict behavior\. One of: skip, replace\./);
    assert.doesNotMatch(mergeHelp.stdout, /One of: error, skip, replace/);
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

    const invalidStatsDimension = await runCliCapture(["stats", "--by", "workspace"], tempRoot);
    assert.equal(invalidStatsDimension.exitCode, 1);
    assert.match(invalidStatsDimension.stderr, /Invalid value for --by: workspace\. Expected one of model, project, source, host, day, month\./);

    const invalidMergeConflict = await runCliCapture(["merge", "--from", "a.sqlite", "--to", "b.sqlite", "--on-conflict", "abort"], tempRoot);
    assert.equal(invalidMergeConflict.exitCode, 1);
    assert.match(invalidMergeConflict.stderr, /Invalid value for --on-conflict: abort\. Expected one of skip, replace\./);
    assert.doesNotMatch(invalidMergeConflict.stderr, /error, skip, replace/);

    const missingStatsDimension = await runCliCapture(["stats", "usage"], tempRoot);
    assert.equal(missingStatsDimension.exitCode, 1);
    assert.match(missingStatsDimension.stderr, /`stats usage` requires --by <dimension>/);
    assert.match(missingStatsDimension.stderr, /Example: cchistory stats usage --by model/);
    assert.doesNotMatch(missingStatsDimension.stderr, /Store not found|unable to open database/);

    const negativeLimit = await runCliCapture(["search", "--limit=-1", "probe"], tempRoot);
    assert.equal(negativeLimit.exitCode, 1);
    assert.match(negativeLimit.stderr, /Invalid value for --limit: -1\. Expected a positive integer\./);
    assert.doesNotMatch(negativeLimit.stderr, /Store not found|unable to open database/);

    const fractionalOffset = await runCliCapture(["search", "--offset", "1.5", "probe"], tempRoot);
    assert.equal(fractionalOffset.exitCode, 1);
    assert.match(fractionalOffset.stderr, /Invalid value for --offset: 1\.5\. Expected a non-negative integer\./);

    const conflictingReadModes = await runCliCapture(["--full", "--index", "stats"], tempRoot);
    assert.equal(conflictingReadModes.exitCode, 1);
    assert.match(conflictingReadModes.stderr, /Choose either --full or --index, not both\./);
    assert.doesNotMatch(conflictingReadModes.stderr, /Store not found|unable to open database/);

    const zeroInterval = await runCliCapture(["agent", "schedule", "--interval-seconds", "0"], tempRoot);
    assert.equal(zeroInterval.exitCode, 1);
    assert.match(zeroInterval.stderr, /Invalid value for --interval-seconds: 0\. Expected a positive integer\./);
    assert.doesNotMatch(zeroInterval.stderr, /Remote agent state file not found|fetch failed/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("usage errors for incomplete commands happen before store or remote access", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-usage-errors-"));

  try {
    const cases: Array<{ argv: string[]; pattern: RegExp }> = [
      { argv: ["tree", "project"], pattern: /Use `tree projects`, `tree project <project-id-or-slug>`, or `tree session <session-ref>`\./ },
      { argv: ["tree", "projects", "extra"], pattern: /Use `tree projects`, `tree project <project-id-or-slug>`, or `tree session <session-ref>`\./ },
      { argv: ["show", "banana", "x"], pattern: /Use `show project\|session\|turn\|source <ref>`\./ },
      { argv: ["show", "project", "cchistory", "extra"], pattern: /Use `show project\|session\|turn\|source <ref>`\./ },
      { argv: ["query"], pattern: /Use `query turns\|turn\|sessions\|session\|projects\|project \.\.\.`\./ },
      { argv: ["query", "turns", "extra"], pattern: /Use `query turns\|turn\|sessions\|session\|projects\|project \.\.\.`\./ },
      { argv: ["query", "turn"], pattern: /Missing required --id flag\./ },
      { argv: ["agent", "pair"], pattern: /Missing required --server flag\./ },
      { argv: ["agent", "schedule"], pattern: /Missing required --interval-seconds flag\./ },
      { argv: ["restore-check"], pattern: /`restore-check` requires an explicit --store or --db target\./ },
      { argv: ["export"], pattern: /Missing required --out flag\./ },
      { argv: ["merge", "--from", "a.sqlite"], pattern: /Missing required --to flag\./ },
    ];

    for (const { argv, pattern } of cases) {
      const result = await runCliCapture(argv, tempRoot);
      assert.equal(result.exitCode, 1, argv.join(" "));
      assert.match(result.stderr, pattern, argv.join(" "));
      assert.doesNotMatch(result.stderr, /Store not found|unable to open database|ENOENT|fetch failed/, argv.join(" "));
      assert.equal(result.stdout, "", argv.join(" "));
    }
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

test("--json failures keep stdout empty and print actionable text to stderr", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-json-error-"));

  try {
    const result = await runCliCapture(["--json", "search"], tempRoot);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Search requires a query string\./);
    assert.doesNotMatch(result.stderr, /\n\s+at /);
  } finally {
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
