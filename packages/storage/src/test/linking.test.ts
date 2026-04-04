import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { CCHistoryStorage } from "../index.js";
import { createFixturePayload } from "./helpers.js";

test("storage keeps delegated and automation evidence inspectable even when no canonical turns are emitted", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-secondary-evidence-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    // Simulate a payload that has records but no top-level turns (e.g. from an automation process)
    const payload = createFixturePayload("src-automation", "Automation", "sr-auto");
    payload.turns = [];
    payload.source.total_turns = 0;

    storage.replaceSourcePayload(payload);

    assert.equal(storage.listRecords().length, 1);
    assert.equal(storage.listTurns().length, 0);
    assert.equal(storage.listLossAudits().length, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("getSessionRelatedWork normalizes delegated factory relations from callingSessionId metadata", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-related-work-"));
  try {
    const storage = new CCHistoryStorage(dataDir);

    const parentSessionId = "session-parent";
    const childSessionId = "session-child";

    // Ingest parent session (the delegating session)
    const parentPayload = createFixturePayload("src-factory-parent", "Parent turn", "sr-parent", {
      sessionId: parentSessionId,
      turnId: "turn-parent",
    });
    storage.replaceSourcePayload(parentPayload);

    // Ingest child session with a session_relation fragment referencing the parent via callingSessionId
    const childPayload = createFixturePayload("src-factory-child", "Child turn", "sr-child", {
      sessionId: childSessionId,
      turnId: "turn-child",
    });
    childPayload.fragments.push({
      id: "fragment-relation-child",
      source_id: "src-factory-child",
      session_ref: childSessionId,
      record_id: "turn-child-record",
      seq_no: 99,
      fragment_kind: "session_relation",
      time_key: "2026-03-09T09:00:00.000Z",
      payload: {
        callingSessionId: parentSessionId,
        relation_kind: "delegated_session",
      },
      raw_refs: [],
      source_format_profile_id: "generic-v1",
    });
    storage.replaceSourcePayload(childPayload);

    const relatedWork = storage.getSessionRelatedWork(childSessionId);
    assert.ok(relatedWork.length >= 1, "child session should have at least one related work entry");

    const delegated = relatedWork.find((r) => r.relation_kind === "delegated_session");
    assert.ok(delegated, "should find a delegated_session relation");
    assert.equal(delegated.source_session_ref, childSessionId);
    assert.equal(delegated.target_session_ref, parentSessionId);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("derived project linker commits repo continuity and preserves workspace-only candidates", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-linker-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const sharedFingerprint = "fp-123";

    storage.replaceSourcePayload(
      createFixturePayload("src-1", "Turn 1", "sr-1", {
        projectObservation: {
          workspacePath: "/workspace/a",
          repoFingerprint: sharedFingerprint,
          repoRemote: "https://github.com/org/repo",
        },
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-2", "Turn 2", "sr-2", {
        projectObservation: {
          workspacePath: "/workspace/b",
          repoFingerprint: sharedFingerprint,
          repoRemote: "https://github.com/org/repo",
        },
      }),
    );

    const projects = storage.listProjects();
    assert.equal(projects.length, 1);
    assert.equal(projects[0]?.repo_fingerprint, sharedFingerprint);
    assert.equal(projects[0]?.linkage_state, "committed");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("project display names decode percent-encoded workspace paths", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-encoded-path", "Encoded path turn", "stage-run-encoded-path", {
        sessionId: "session-encoded-path",
        turnId: "turn-encoded-path",
        workingDirectory: "/Users/tester/Documents/deep%20research",
        projectObservation: {
          workspacePath: "/Users/tester/Documents/deep%20research",
        },
      }),
    );

    const projects = storage.listProjects();
    assert.equal(projects[0]?.display_name, "deep research");
    assert.equal(projects[0]?.primary_workspace_path, "/Users/tester/Documents/deep research");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("temporary workspace paths stay low-confidence even when repeated across sessions", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-temp-a", "Temp turn A", "stage-run-temp-a", {
        sessionId: "session-temp-a",
        turnId: "turn-temp-a",
        hostId: "host-1",
        platform: "codex",
        workingDirectory: "/root/.config/AionUi/aionui/claude-temp-abc",
        projectObservation: {
          workspacePath: "/root/.config/AionUi/aionui/claude-temp-abc",
        },
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-temp-b", "Temp turn B", "stage-run-temp-b", {
        sessionId: "session-temp-b",
        turnId: "turn-temp-b",
        hostId: "host-1",
        platform: "claude_code",
        workingDirectory: "/root/.config/AionUi/aionui/claude-temp-abc",
        projectObservation: {
          workspacePath: "/root/.config/AionUi/aionui/claude-temp-abc",
        },
      }),
    );

    const projects = storage.listProjects();
    assert.equal(projects.length, 1);

    const candidateProject = projects[0]!;
    assert.equal(candidateProject.linkage_state, "candidate");
    assert.equal(candidateProject.link_reason, "weak_path_hint");
    assert.equal(candidateProject.session_count, 2);
    assert.ok(candidateProject.confidence < 0.55);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("manual overrides commit turns, create project revisions, and keep search/drift data queryable", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-manual", "Manual override target", "stage-run-manual", {
        sessionId: "session-manual",
        turnId: "turn-manual",
        hostId: "host-1",
        platform: "codex",
        workingDirectory: "/workspace/manual-target",
        projectObservation: {
          workspacePath: "/workspace/manual-target",
        },
      }),
    );

    const beforeOverride = storage.listResolvedTurns().find((turn) => turn.id === "turn-manual");
    assert.equal(beforeOverride?.link_state, "candidate");

    storage.upsertProjectOverride({
      target_kind: "turn",
      target_ref: "turn-manual",
      project_id: "project-manual-test",
      display_name: "Manual Test Project",
      note: "manual link for coverage",
    });

    const afterOverride = storage.listResolvedTurns().find((turn) => turn.id === "turn-manual");
    assert.equal(afterOverride?.link_state, "committed");
    assert.equal(afterOverride?.project_id, "project-manual-test");

    const projectTurns = storage.listProjectTurns("project-manual-test", "committed");
    assert.equal(projectTurns.length, 1);
    assert.equal(projectTurns[0]?.id, "turn-manual");

    const revisions = storage.listProjectRevisions("project-manual-test");
    assert.ok(revisions.length >= 1);
    assert.equal(revisions[0]?.link_reason, "manual_override");

    const events = storage.listProjectLineageEvents("project-manual-test");
    assert.ok(events.some((event) => event.event_kind === "created" || event.event_kind === "manual_override"));

    const searchResults = storage.searchTurns({ query: "override target" });
    assert.ok(searchResults.some((result) => result.turn.id === "turn-manual"));

    const drift = storage.getDriftReport();
    assert.ok(drift.consistency_score >= 0);
    assert.equal(Array.isArray(drift.timeline), true);
    assert.equal(drift.timeline.length, 7);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("same repo fingerprint across different platforms consolidates into one project", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-cross-plat-"));
  try {
    const storage = new CCHistoryStorage(dataDir);
    const sharedFingerprint = "fp-cross-platform-shared";
    const sharedRemote = "https://github.com/test/cross-platform";
    const sharedWorkspace = "/workspace/cross-platform";

    storage.replaceSourcePayload(
      createFixturePayload("src-cross-codex", "Codex turn", "sr-cross-codex", {
        turnId: "turn-cross-codex",
        sessionId: "session-cross-codex",
        hostId: "host-cross",
        platform: "codex",
        workingDirectory: sharedWorkspace,
        projectObservation: {
          workspacePath: sharedWorkspace,
          repoFingerprint: sharedFingerprint,
          repoRemote: sharedRemote,
        },
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-cross-claude", "Claude turn", "sr-cross-claude", {
        turnId: "turn-cross-claude",
        sessionId: "session-cross-claude",
        hostId: "host-cross",
        platform: "claude_code",
        workingDirectory: sharedWorkspace,
        projectObservation: {
          workspacePath: sharedWorkspace,
          repoFingerprint: sharedFingerprint,
          repoRemote: sharedRemote,
        },
      }),
    );

    const projects = storage.listProjects();
    const crossProject = projects.find((p) => p.repo_fingerprint === sharedFingerprint);
    assert.ok(crossProject, "Cross-platform project should exist");
    assert.equal(crossProject.linkage_state, "committed");
    assert.ok(
      crossProject.source_platforms.length >= 2,
      `Should have 2+ platforms, got ${crossProject.source_platforms.join(", ")}`,
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
