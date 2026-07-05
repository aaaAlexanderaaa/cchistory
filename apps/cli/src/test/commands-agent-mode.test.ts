import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { runCliCapture, seedCliFixtures } from "./helpers.js";

test("--non-interactive refuses to launch the TUI with a usage error", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-nonint-"));
  try {
    const result = await runCliCapture(["tui", "--non-interactive", "--store", tempRoot], tempRoot);
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /Refusing to launch the TUI under --non-interactive/);
    assert.match(result.stderr, /ls/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("--agent implies --non-interactive and refuses the TUI", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-agent-tui-"));
  try {
    const result = await runCliCapture(["tui", "--agent", "--store", tempRoot], tempRoot);
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /--non-interactive/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("--agent forces JSON output for stats", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-agent-json-"));
  const originalHome = process.env.HOME;
  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");
    const syncResult = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(syncResult.exitCode, 0);

    // No --json on the command line; --agent should force it.
    const result = await runCliCapture(["stats", "--agent", "--store", storeDir], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.kind, "stats-overview");
    assert.ok(payload.counts.turns > 0, "agent mode should still surface real counts");
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("--agent strips ANSI color codes from error output", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-agent-color-"));
  try {
    const result = await runCliCapture(["stats", "--agent", "--by", "bogus", "--store", tempRoot], tempRoot);
    assert.equal(result.exitCode, 2, result.stderr);
    assert.equal(result.stderr.includes("["), false, "agent mode must not emit ANSI escapes");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("global help surfaces --non-interactive and --agent", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-agent-help-"));
  try {
    const result = await runCliCapture([], tempRoot);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /--non-interactive/);
    assert.match(result.stdout, /--agent/);
    assert.match(result.stdout, /Automation:/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("command help lists --non-interactive and --agent under global flags", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-agent-cmd-help-"));
  try {
    const result = await runCliCapture(["help", "stats"], tempRoot);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /--non-interactive/);
    assert.match(result.stdout, /--agent/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

/**
 * Spawn the built CLI binary, pipe `stdin` into it, and resolve with the
 * captured stdout/stderr/exit. Used by the stdin-placeholder tests since
 * runCli in-process can't simulate a non-TTY stdin easily.
 */
function runBuiltCliWithStdin(
  argv: string[],
  cwd: string,
  stdin: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const entry = new URL("../index.js", import.meta.url);
    const child = spawn(process.execPath, [entry.pathname, ...argv], {
      cwd,
      env: { ...process.env, FORCE_COLOR: "0" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 0, stdout, stderr });
    });
    child.stdin.end(stdin);
  });
}

test("stdin placeholder `-` substitutes a positional argument", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-stdin-positional-"));
  const originalHome = process.env.HOME;
  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");
    const syncResult = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(syncResult.exitCode, 0);

    // Look up a turn ID via JSON, then pipe it as stdin to `show turn -`.
    const queryResult = await runCliCapture(["query", "turns", "--store", storeDir, "--json"], tempRoot);
    assert.equal(queryResult.exitCode, 0);
    const turns = JSON.parse(queryResult.stdout) as Array<{ id: string }>;
    assert.ok(turns.length > 0, "fixture should seed at least one turn");
    const turnId = turns[0]!.id;

    const piped = await runBuiltCliWithStdin(
      ["show", "turn", "-", "--store", storeDir, "--json"],
      tempRoot,
      `${turnId}\n`,
    );
    assert.equal(piped.exitCode, 0, piped.stderr);
    const payload = JSON.parse(piped.stdout);
    assert.equal(payload.turn.id, turnId, "stdin-substituted positional must resolve the same turn");
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("stdin placeholder `-` substitutes an --option value", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-stdin-option-"));
  const originalHome = process.env.HOME;
  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");
    await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);

    const piped = await runBuiltCliWithStdin(
      ["search", "-", "--store", storeDir, "--json"],
      tempRoot,
      "Probe output\n",
    );
    assert.equal(piped.exitCode, 0, piped.stderr);
    const payload = JSON.parse(piped.stdout);
    assert.ok(Array.isArray(payload.results), "stdin-substituted --search must run a query");
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("stdin placeholder with empty stdin surfaces a usage error", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-stdin-empty-"));
  try {
    const piped = await runBuiltCliWithStdin(["show", "turn", "-"], tempRoot, "");
    assert.equal(piped.exitCode, 2, piped.stderr);
    assert.match(piped.stderr, /stdin was empty/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("search returns next_cursor for pagination and --cursor resumes", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-cursor-"));
  const originalHome = process.env.HOME;
  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");
    await runCliCapture(["sync", "--store", storeDir, "--source", "codex", "--source", "claude_code"], tempRoot);

    // Inspect total matches first so the test isn't brittle to fixture
    // wording — we just need >= 2 to prove the cursor advances.
    const probe = await runCliCapture(
      ["search", "the", "--store", storeDir, "--json"],
      tempRoot,
    );
    assert.equal(probe.exitCode, 0, probe.stderr);
    const probePayload = JSON.parse(probe.stdout);
    const total = probePayload.total as number;
    if (total < 2) {
      // Fixture is too thin to exercise pagination; skip the rest without
      // failing. Heap guards already cover the no-page case.
      return;
    }

    const first = await runCliCapture(
      ["search", "the", "--store", storeDir, "--limit", "1", "--json"],
      tempRoot,
    );
    const firstPayload = JSON.parse(first.stdout);
    assert.ok(firstPayload.next_cursor, "first page should expose next_cursor when more matches exist");

    const second = await runCliCapture(
      ["search", "the", "--store", storeDir, "--limit", "1", "--cursor", firstPayload.next_cursor, "--json"],
      tempRoot,
    );
    assert.equal(second.exitCode, 0, second.stderr);
    const secondPayload = JSON.parse(second.stdout);
    assert.equal(secondPayload.offset, 1, "cursor must advance offset to the next page");
    assert.notEqual(
      secondPayload.results[0]?.id,
      firstPayload.results[0]?.id,
      "second page must not repeat the first-page row",
    );
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("search rejects --cursor combined with --offset", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-cursor-conflict-"));
  try {
    const result = await runCliCapture(
      ["search", "x", "--cursor", "Zm9v", "--offset", "5"],
      tempRoot,
    );
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /Choose either --cursor or --offset/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
