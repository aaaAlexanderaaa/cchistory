import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runCliCapture, seedCliFixtures } from "./helpers.js";

async function withSeededStore(
  fn: (storeDir: string, tempRoot: string) => Promise<void>,
): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-resume-"));
  const originalHome = process.env.HOME;
  try {
    await seedCliFixtures(tempRoot);
    process.env.HOME = tempRoot;
    const storeDir = path.join(tempRoot, "store");
    const syncResult = await runCliCapture(["sync", "--store", storeDir, "--source", "codex"], tempRoot);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);
    await fn(storeDir, tempRoot);
  } finally {
    process.env.HOME = originalHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test("resume without a project ref exits 2 with a usage error", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-resume-noref-"));
  try {
    const result = await runCliCapture(["resume"], tempRoot);
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /Provide a project reference/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("resume surfaces an unknown project ref as a usage error", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    const result = await runCliCapture(["resume", "no-such-project", "--store", storeDir], tempRoot);
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /Unknown project reference/);
  });
});

test("resume prints a card with project, latest session, and latest turn", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    // Pick up the project slug from ls projects so we use a real ref.
    const lsResult = await runCliCapture(["ls", "projects", "--store", storeDir, "--json"], tempRoot);
    assert.equal(lsResult.exitCode, 0, lsResult.stderr);
    const lsPayload = JSON.parse(lsResult.stdout) as { projects: Array<{ slug?: string; project_id?: string; display_name?: string }> };
    assert.ok(lsPayload.projects.length > 0, "fixture should seed at least one project");
    const ref = lsPayload.projects[0]!.slug ?? lsPayload.projects[0]!.project_id!;

    const result = await runCliCapture(["resume", ref, "--store", storeDir], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Resume:/);
    assert.match(result.stdout, /Latest session/);
    assert.match(result.stdout, /Latest turn/);
    assert.match(result.stdout, /cchistory tui --turn/);
  });
});

test("resume --json returns schema_version-stamped payload keyed by project_id", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    const lsResult = await runCliCapture(["ls", "projects", "--store", storeDir, "--json"], tempRoot);
    const lsPayload = JSON.parse(lsResult.stdout) as { projects: Array<{ project_id?: string }> };
    const projectId = lsPayload.projects[0]!.project_id!;

    const result = await runCliCapture(["resume", projectId, "--store", storeDir, "--json"], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.schema_version, 1);
    assert.equal(payload.project.id, projectId);
    assert.ok(payload.latest_turn.id, "latest_turn.id must be present");
    assert.ok(payload.latest_session.id, "latest_session.id must be present");
    assert.match(payload.resume_hint.tui_command, /^cchistory tui --turn /);
  });
});
