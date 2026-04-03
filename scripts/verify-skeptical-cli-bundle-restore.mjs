import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-skeptical-cli-"));
  const childEnv = { ...process.env, HOME: tempRoot };

  try {
    await seedCodexFixtureHome(tempRoot);

    const sourceStoreDir = path.join(tempRoot, "source-store");
    const targetStoreDir = path.join(tempRoot, "target-store");
    const missingStoreDir = path.join(tempRoot, "missing-store");
    const bundleADir = path.join(tempRoot, "bundle-a.cchistory-bundle");
    const bundleBDir = path.join(tempRoot, "bundle-b.cchistory-bundle");
    const replacementPrompt = "continue changed for skeptical conflict test";

    const syncResult = await runBuiltCliCapture(["sync", "--store", sourceStoreDir, "--source", "codex"], tempRoot, childEnv);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);
    assert.match(syncResult.stdout, /Synced 1 source\(s\)/);
    assert.equal(syncResult.stderr.trim(), "");

    const backupPreview = await runBuiltCliCapture(["backup", "--store", sourceStoreDir, "--out", bundleADir], tempRoot, childEnv);
    assert.equal(backupPreview.exitCode, 0, backupPreview.stderr);
    assert.match(backupPreview.stdout, /Workflow\s*:\s*backup/);
    assert.match(backupPreview.stdout, /Mode\s*:\s*preview/);
    assert.equal(await fileExists(bundleADir), false);
    assert.equal(backupPreview.stderr.trim(), "");

    const backupWrite = await runBuiltCliCapture(["backup", "--store", sourceStoreDir, "--out", bundleADir, "--write"], tempRoot, childEnv);
    assert.equal(backupWrite.exitCode, 0, backupWrite.stderr);
    assert.match(backupWrite.stdout, /Workflow\s*:\s*backup/);
    assert.match(backupWrite.stdout, /Mode\s*:\s*write/);
    assert.equal(await fileExists(path.join(bundleADir, "manifest.json")), true);
    assert.equal(backupWrite.stderr.trim(), "");

    const firstImport = await runBuiltCliCapture(["import", bundleADir, "--store", targetStoreDir], tempRoot, childEnv);
    assert.equal(firstImport.exitCode, 0, firstImport.stderr);
    assert.match(firstImport.stdout, /Imported Sources\s*:\s*1/);
    assert.equal(firstImport.stderr.trim(), "");

    await overwriteCodexPrompt(tempRoot, replacementPrompt);

    const secondSync = await runBuiltCliCapture(["sync", "--store", sourceStoreDir, "--source", "codex"], tempRoot, childEnv);
    assert.equal(secondSync.exitCode, 0, secondSync.stderr);
    assert.match(secondSync.stdout, /Synced 1 source\(s\)/);
    assert.equal(secondSync.stderr.trim(), "");

    const exportResult = await runBuiltCliCapture(["export", "--store", sourceStoreDir, "--out", bundleBDir], tempRoot, childEnv);
    assert.equal(exportResult.exitCode, 0, exportResult.stderr);
    assert.match(exportResult.stdout, /Sources\s*:\s*1/);
    assert.equal(await fileExists(path.join(bundleBDir, "manifest.json")), true);
    assert.equal(exportResult.stderr.trim(), "");

    const conflictImport = await runBuiltCliCapture(["import", bundleBDir, "--store", targetStoreDir], tempRoot, childEnv);
    assert.equal(conflictImport.exitCode, 1);
    assert.match(conflictImport.stderr, /Source conflict detected/);
    assert.doesNotMatch(conflictImport.stderr, /ExperimentalWarning/);
    assert.doesNotMatch(conflictImport.stderr, /FTS5 unavailable/);

    const errorPreview = await runBuiltCliCapture(["import", bundleBDir, "--store", targetStoreDir, "--dry-run"], tempRoot, childEnv);
    assert.equal(errorPreview.exitCode, 0, errorPreview.stderr);
    assert.match(errorPreview.stdout, /Would Conflict\s*:\s*1/);
    assert.match(errorPreview.stdout, /Would Fail\s*:\s*true/);
    assert.match(errorPreview.stdout, /conflict_error/);
    assert.equal(errorPreview.stderr.trim(), "");

    const replacePreview = await runBuiltCliCapture(
      ["import", bundleBDir, "--store", targetStoreDir, "--dry-run", "--on-conflict", "replace"],
      tempRoot,
      childEnv,
    );
    assert.equal(replacePreview.exitCode, 0, replacePreview.stderr);
    assert.match(replacePreview.stdout, /Would Replace\s*:\s*1/);
    assert.match(replacePreview.stdout, /Would Fail\s*:\s*false/);
    assert.match(replacePreview.stdout, /conflict_replace/);
    assert.equal(replacePreview.stderr.trim(), "");

    const skipImport = await runBuiltCliCapture(["import", bundleBDir, "--store", targetStoreDir, "--on-conflict", "skip"], tempRoot, childEnv);
    assert.equal(skipImport.exitCode, 0, skipImport.stderr);
    assert.match(skipImport.stdout, /Skipped Sources\s*:\s*1/);
    assert.equal(skipImport.stderr.trim(), "");

    const replaceImport = await runBuiltCliCapture(["import", bundleBDir, "--store", targetStoreDir, "--on-conflict", "replace"], tempRoot, childEnv);
    assert.equal(replaceImport.exitCode, 0, replaceImport.stderr);
    assert.match(replaceImport.stdout, /Replaced Sources\s*:\s*1/);
    assert.equal(replaceImport.stderr.trim(), "");

    const searchResult = await runBuiltCliJson(["search", replacementPrompt, "--store", targetStoreDir], tempRoot, childEnv);
    assert.equal(searchResult.kind, "search");
    assert.equal(searchResult.results.length, 1);
    const searchHit = searchResult.results[0];
    assert.match(searchHit.turn.canonical_text, new RegExp(replacementPrompt));

    const turnDetail = await runBuiltCliJson(["show", "turn", searchHit.turn.id, "--store", targetStoreDir], tempRoot, childEnv);
    assert.match(turnDetail.turn.canonical_text, new RegExp(replacementPrompt));
    assert.equal(turnDetail.turn.session_id, searchHit.session.id);

    const restoreCheck = await runBuiltCliCapture(["restore-check", "--store", targetStoreDir], tempRoot, childEnv);
    assert.equal(restoreCheck.exitCode, 0, restoreCheck.stderr);
    assert.match(restoreCheck.stdout, /Restore Check/);
    assert.match(restoreCheck.stdout, /Codex/);
    assert.equal(restoreCheck.stderr.trim(), "");

    const missingStore = await runBuiltCliCapture(["restore-check", "--store", missingStoreDir], tempRoot, childEnv);
    assert.equal(missingStore.exitCode, 1);
    assert.match(missingStore.stderr, /Store not found:/);
    assert.doesNotMatch(missingStore.stderr, /ExperimentalWarning/);
    assert.doesNotMatch(missingStore.stderr, /FTS5 unavailable/);

    console.log("Skeptical CLI bundle/restore verification passed.");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function runBuiltCliCapture(argv, cwd, env = process.env) {
  const cliEntry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../apps/cli/dist/index.js");
  return await new Promise((resolve, reject) => {
    execFile(process.execPath, [cliEntry, ...argv], { cwd, env }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") {
        reject(error);
        return;
      }
      resolve({
        exitCode: typeof error?.code === "number" ? Number(error.code) : 0,
        stdout,
        stderr,
      });
    });
  });
}

async function runBuiltCliJson(argv, cwd, env = process.env) {
  const result = await runBuiltCliCapture([...argv, "--json"], cwd, env);
  assert.equal(result.exitCode, 0, result.stderr);
  return JSON.parse(result.stdout);
}

async function fileExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function seedCodexFixtureHome(tempRoot) {
  await mkdir(path.join(tempRoot, ".codex", "sessions"), { recursive: true });
  await writeCodexSessionFixture(tempRoot, "session.jsonl", {
    sessionId: "codex-session-1",
    cwd: "/workspace/cchistory",
    model: "gpt-5",
    prompt: "continue",
    reply: "Prompt acknowledged.",
    startAt: "2026-03-09T00:00:00.000Z",
  });
}

async function overwriteCodexPrompt(tempRoot, prompt) {
  await writeCodexSessionFixture(tempRoot, "session.jsonl", {
    sessionId: "codex-session-1",
    cwd: "/workspace/cchistory",
    model: "gpt-5",
    prompt,
    reply: "Prompt updated.",
    startAt: "2026-03-09T00:00:00.000Z",
  });
}

async function writeCodexSessionFixture(tempRoot, fileName, input) {
  const startAt = new Date(input.startAt);
  const userAt = new Date(startAt.getTime() + 1000).toISOString();
  const assistantAt = new Date(startAt.getTime() + 2000).toISOString();
  await writeFile(
    path.join(tempRoot, ".codex", "sessions", fileName),
    [
      {
        timestamp: input.startAt,
        type: "session_meta",
        payload: {
          id: input.sessionId,
          cwd: input.cwd,
          model: input.model,
        },
      },
      {
        timestamp: userAt,
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: input.prompt }],
        },
      },
      {
        timestamp: assistantAt,
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: input.reply }],
        },
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n"),
    "utf8",
  );
}

await main();
