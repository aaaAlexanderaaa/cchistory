import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runCliCapture } from "./helpers.js";

const execFileAsync = promisify(execFile);

test("completions without a shell argument exits 2 with a usage error", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-completions-none-"));
  try {
    const result = await runCliCapture(["completions"], tempRoot);
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /Specify a target shell/);
    assert.match(result.stderr, /bash, zsh, fish/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("completions rejects an unsupported shell", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-completions-bad-shell-"));
  try {
    const result = await runCliCapture(["completions", "powershell"], tempRoot);
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /Unsupported shell "powershell"/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("completions bash emits a complete -F cchistory handler", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-completions-bash-"));
  try {
    const result = await runCliCapture(["completions", "bash"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /_cchistory_complete\b/);
    assert.match(result.stdout, /complete -F _cchistory_complete cchistory/);
    // Top-level command names should appear in the script.
    assert.match(result.stdout, /\bstatus\b/);
    assert.match(result.stdout, /\bsync\b/);
    assert.match(result.stdout, /\bmaintenance\b/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("completions bash output is syntactically valid (bash -n) and has no `return 0 fi`", async () => {
  // Skip silently when bash isn't available (non-Linux CI without bash).
  try {
    await execFileAsync("bash", ["--version"]);
  } catch {
    return; // bash unavailable — skip
  }
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-completions-bash-syntax-"));
  try {
    const result = await runCliCapture(["completions", "bash"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    // Regression guard: the prior emit produced `... ; return 0 fi` which is
    // a syntax error. The fix emits `if …; then … return 0\n fi` on its own
    // lines.
    assert.doesNotMatch(result.stdout, /return 0 fi/);
    const scriptPath = path.join(tempRoot, "cchistory-completion.bash");
    await writeFile(scriptPath, result.stdout, "utf8");
    // `bash -n` parses without executing; non-zero exit + stderr means syntax error.
    try {
      await execFileAsync("bash", ["-n", scriptPath]);
    } catch (err) {
      assert.fail(`bash -n rejected generated completion: ${(err as Error).message}`);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("completions zsh emits a #compdef line and command list", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-completions-zsh-"));
  try {
    const result = await runCliCapture(["completions", "zsh"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /^#compdef cchistory/);
    assert.match(result.stdout, /_cchistory\(\)/);
    assert.match(result.stdout, /\bstatus:status command\b/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("completions fish chains subcommand conditions", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-completions-fish-"));
  try {
    const result = await runCliCapture(["completions", "fish"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /complete -c cchistory/);
    // Top-level subcommand hint
    assert.match(result.stdout, /__fish_use_subcommand/);
    // Per-command option flags
    assert.match(result.stdout, /-n "__fish_seen_subcommand_from status" -l store/);
    // Subcommand chaining for two-level commands like `maintenance gc-evidence`
    assert.match(result.stdout, /__fish_seen_subcommand_from maintenance gc-evidence/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("completions surfaces every documented top-level command", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-completions-coverage-"));
  try {
    const result = await runCliCapture(["completions", "bash"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    // Spot-check a spread of categories so we know the spec list is wired through.
    for (const command of [
      "status", "sync", "doctor", "ls", "tree", "show", "search",
      "stats", "export", "backup", "restore-check", "import", "merge",
      "gc", "maintenance", "migration", "query", "templates", "agent",
      "tui", "completions",
    ]) {
      assert.ok(
        result.stdout.includes(command),
        `expected completions script to mention "${command}"`,
      );
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
