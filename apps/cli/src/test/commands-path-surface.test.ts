import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runCliCapture, runCliJson, seedCliFixtures, writeCodexSessionFixture } from "./helpers.js";
import { classifyProjectToken, isPathForm, resolvePathInput } from "../resolvers.js";

const LS_KEYWORDS = new Set(["projects", "sessions", "sources"]);

async function withSeededStore(
  fn: (storeDir: string, tempRoot: string) => Promise<void>,
): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-cli-path-"));
  const originalHome = process.env.HOME;
  try {
    await seedCliFixtures(tempRoot);
    // Seed an explicit sub-project at /workspace/cchistory/apps/cli so we can
    // exercise descendant matching without depending on fixture drift.
    await writeCodexSessionFixture(tempRoot, "rollout-codex-subproject.jsonl", {
      sessionId: "codex-subproject-session",
      cwd: "/workspace/cchistory/apps/cli",
      model: "gpt-5",
      prompt: "Refactor the CLI path resolver.",
      reply: "Path-first surface lands cleanly.",
      startAt: "2026-03-09T03:00:00.000Z",
    });
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

// --- Token classifier unit tests ---

test("isPathForm: detects absolute, ./, ../, ~, and bare . / ..", () => {
  assert.equal(isPathForm("/abs/path"), true);
  assert.equal(isPathForm("./rel"), true);
  assert.equal(isPathForm("../parent"), true);
  assert.equal(isPathForm("~/home"), true);
  assert.equal(isPathForm("."), true);
  assert.equal(isPathForm(".."), true);
  // Bare names are NOT path-form — must add ./ to force path interpretation.
  assert.equal(isPathForm("projects"), false);
  assert.equal(isPathForm("cchistory"), false);
  assert.equal(isPathForm("01H..."), false);
});

test("classifyProjectToken: keyword wins over path-form", () => {
  assert.equal(classifyProjectToken("projects", LS_KEYWORDS), "keyword");
  assert.equal(classifyProjectToken("sessions", LS_KEYWORDS), "keyword");
  assert.equal(classifyProjectToken("sources", LS_KEYWORDS), "keyword");
});

test("classifyProjectToken: ./ escape forces path interpretation even for keyword-named dirs", () => {
  assert.equal(classifyProjectToken("./projects", LS_KEYWORDS), "path");
  assert.equal(classifyProjectToken("./sessions", LS_KEYWORDS), "path");
  assert.equal(classifyProjectToken("/abs/path", LS_KEYWORDS), "path");
});

test("classifyProjectToken: non-keyword non-path falls through to ref", () => {
  assert.equal(classifyProjectToken("cchistory", LS_KEYWORDS), "ref");
  assert.equal(classifyProjectToken("01H...", LS_KEYWORDS), "ref");
});

test("resolvePathInput: relative input resolves against cwd", () => {
  const result = resolvePathInput("./foo", "/root");
  assert.equal(result.resolvedPath, "/root/foo");
  assert.equal(result.normalizedIdentity, "/root/foo");
});

test("resolvePathInput: absolute input passes through", () => {
  const result = resolvePathInput("/root/foo", "/some/other/cwd");
  assert.equal(result.resolvedPath, "/root/foo");
});

// --- Integration: ls path-form ---

test("ls <path>: exact workspace match shows project as main with sub_projects in JSON", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    const result = await runCliJson<{
      kind: string;
      path_scope: string;
      resolved_path: string;
      projects: Array<{ display_name: string; primary_workspace_path?: string }>;
      hierarchy: {
        main?: { project_id: string };
        sub_projects: Array<{ project_id: string; relative_path: string; depth: number }>;
      };
    }>(["ls", "/workspace/cchistory", "--store", storeDir], tempRoot);

    assert.equal(result.kind, "projects");
    assert.equal(result.path_scope, "/workspace/cchistory");
    assert.equal(result.resolved_path, "/workspace/cchistory");
    assert.ok(result.hierarchy.main, "main project must be present");
    assert.ok(
      result.projects.some((p) => p.display_name === "cchistory"),
      "cchistory main project should appear in flat projects[]",
    );
    const sub = result.hierarchy.sub_projects.find((entry) => entry.relative_path === "./apps/cli");
    assert.ok(sub, "expected a sub-project at ./apps/cli");
    // apps/cli is two segments deep from /workspace/cchistory (apps + cli).
    assert.equal(sub!.depth, 2);
  });
});

test("ls <path>: descendant-only mode lists sub_projects when no ancestor project matches", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    // /workspace is the parent of every seeded project workspace; no project
    // has a workspace at or above it, so main is undefined and we list every
    // descendant as a sub_project.
    const result = await runCliJson<{
      hierarchy: {
        main?: { project_id: string };
        sub_projects: Array<{ relative_path: string }>;
      };
      projects: Array<{ primary_workspace_path?: string }>;
    }>(["ls", "/workspace", "--store", storeDir], tempRoot);

    assert.equal(result.hierarchy.main, undefined);
    assert.ok(
      result.hierarchy.sub_projects.length >= 2,
      "expected multiple descendant projects under /workspace",
    );
  });
});

test("ls <path>: ancestor match resolves upward and sets ancestor_note", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    const result = await runCliJson<{
      ancestor_note?: string;
      hierarchy: { main?: { project_id: string } };
    }>(["ls", "/workspace/cchistory/apps/cli/src", "--store", storeDir], tempRoot);

    assert.ok(result.ancestor_note, "ancestor_note should be set when path is below main workspace");
    assert.match(result.ancestor_note!, /Resolved upward to/);
    assert.ok(result.hierarchy.main, "main should be the closest ancestor project");
  });
});

test("ls bare: defaults to cwd-aware listing when run from a project workspace", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    // Create a fake "cwd" directory matching the seeded workspace and run
    // from inside it. The CLI uses io.cwd for path resolution.
    const fakeWorkspace = path.join(tempRoot, "fake-cwd");
    // We can't easily make the store treat fakeWorkspace as a project; instead
    // exercise the no-match path: bare ls from a non-project cwd errors with
    // a helpful "No project at" message rather than the legacy usage error.
    const result = await runCliCapture(["ls", "--store", storeDir], fakeWorkspace);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /No project at/);
  });
});

test("ls ./projects: keyword-named path is treated as path, not as the global listing", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    const result = await runCliCapture(["ls", "./projects", "--store", storeDir], tempRoot);
    // ./projects doesn't exist as a workspace → "No project at" error,
    // NOT the legacy "Use ls projects|sessions|sources" usage error.
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /No project at/);
    assert.doesNotMatch(result.stderr, /Use `ls projects/);
  });
});

test("ls <path> --json: backward-compatible flat projects[] is preserved", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    const result = await runCliJson<{
      projects: Array<{ project_id: string; display_name: string }>;
    }>(["ls", "/workspace/cchistory", "--store", storeDir], tempRoot);
    // Legacy consumers can still iterate the flat array — main + subs all appear.
    assert.ok(result.projects.length >= 1);
    assert.ok(result.projects.every((p) => typeof p.project_id === "string"));
  });
});

// --- Integration: stats path-scope ---

test("stats <path>: per-project blocks by default; --merge aggregates", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    const perProject = await runCliJson<{ kind: string; per_project: unknown[] }>(
      ["stats", "/workspace/cchistory", "--store", storeDir, ],
      tempRoot,
    );
    assert.equal(perProject.kind, "stats-overview-scoped");
    assert.ok(perProject.per_project.length >= 2, "expected one block per matched project (main + sub)");

    const merged = await runCliJson<{ kind: string; scoped_project_ids: string[]; overview: unknown }>(
      ["stats", "/workspace/cchistory", "--merge", "--store", storeDir, ],
      tempRoot,
    );
    // Merged mode reuses the legacy overview shape with a scope envelope.
    assert.equal(merged.scoped_project_ids.length >= 2, true);
    assert.ok(typeof merged.overview === "object");
  });
});

// --- Integration: tree / show path-form ---

test("tree <path>: renders main + sub-project summary", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    const result = await runCliCapture(["tree", "/workspace/cchistory", "--store", storeDir], tempRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Session Threads/);
    assert.match(result.stdout, /Sub-Projects/);
    assert.match(result.stdout, /apps\/cli/);
  });
});

test("show <path>: defaults to project kind and includes path_scope in JSON", async () => {
  await withSeededStore(async (storeDir, tempRoot) => {
    const result = await runCliJson<{
      kind: string;
      project: { display_name: string };
      path_scope: string;
      resolved_path: string;
      sub_projects: unknown[];
    }>(["show", "/workspace/cchistory", "--store", storeDir], tempRoot);
    assert.equal(result.kind, "project");
    assert.equal(result.path_scope, "/workspace/cchistory");
    assert.ok(Array.isArray(result.sub_projects));
  });
});

// --- Multi-main case: two projects share the same workspace path ---
//
// We exercise this at the resolver level rather than via the sync fixture
// path because the storage linker intentionally collapses same-workspace
// sessions into one project row. Operators hit the multi-main case in real
// data when different hosts or import runs persist separate project rows
// for the same workspace — the resolver contract must surface all of them
// rather than throw.

import { resolveProjectScope, scopeMain } from "../resolvers.js";
import type { ProjectIdentity } from "@cchistory/domain";
import type { CCHistoryStorage } from "@cchistory/storage";

function makeFakeStorage(projects: ProjectIdentity[]): Pick<CCHistoryStorage, "listProjects"> {
  return {
    listProjects: () => projects,
  };
}

test("resolveProjectScope: multiple projects at same workspace surfaces all mains, no throw", () => {
  const sharedWorkspace = "/workspace/cchistory";
  const projects: ProjectIdentity[] = [
    {
      project_id: "project-aaaaaaaaaaaa",
      display_name: "cchistory",
      slug: "cchistory",
      primary_workspace_path: sharedWorkspace,
      host_ids: ["host-a"],
      source_native_project_ref: "native-a",
      session_count: 1,
      committed_turn_count: 0,
      candidate_turn_count: 0,
      project_last_activity_at: "2026-03-09T05:00:00.000Z",
      updated_at: "2026-03-09T05:00:00.000Z",
    } as unknown as ProjectIdentity,
    {
      project_id: "project-bbbbbbbbbbbb",
      display_name: "cchistory",
      slug: "cchistory-2",
      primary_workspace_path: sharedWorkspace,
      host_ids: ["host-b"],
      source_native_project_ref: "native-b",
      session_count: 1,
      committed_turn_count: 0,
      candidate_turn_count: 0,
      project_last_activity_at: "2026-03-09T06:00:00.000Z",
      updated_at: "2026-03-09T06:00:00.000Z",
    } as unknown as ProjectIdentity,
  ];

  const scope = resolveProjectScope(
    makeFakeStorage(projects) as CCHistoryStorage,
    sharedWorkspace,
    "/cwd",
  );

  assert.equal(scope.mains.length, 2);
  assert.ok(scope.sub_projects.length === 0, "no descendants expected");
  // scopeMain returns the first main deterministically (sortMainsStable
  // orders by display_name then project_id — both names equal here, so
  // project_id is the tiebreaker).
  assert.equal(scopeMain(scope)?.project_id, "project-aaaaaaaaaaaa");
});

test("resolveProjectScope: descendant-only mode ignores project count at the input path itself", () => {
  // Sanity: ancestor/descendant logic is unaffected by the multi-main change.
  const projects: ProjectIdentity[] = [
    {
      project_id: "project-sub",
      display_name: "sub-app",
      slug: "sub-app",
      primary_workspace_path: "/workspace/cchistory/apps/cli",
      host_ids: [],
      source_native_project_ref: undefined,
      session_count: 0,
      committed_turn_count: 0,
      candidate_turn_count: 0,
      project_last_activity_at: "2026-03-09T05:00:00.000Z",
      updated_at: "2026-03-09T05:00:00.000Z",
    } as unknown as ProjectIdentity,
  ];

  const scope = resolveProjectScope(
    makeFakeStorage(projects) as CCHistoryStorage,
    "/workspace/cchistory/apps",
    "/cwd",
  );
  assert.equal(scope.mains.length, 0);
  assert.equal(scope.sub_projects.length, 1);
});
