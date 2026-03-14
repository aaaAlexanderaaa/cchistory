import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { deriveSourceInstanceId, type SourceSyncPayload } from "@cchistory/domain";
import { CCHistoryStorage } from "./index.js";

test("replaceSourcePayload persists pipeline layers and lineage drill-down", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(createFixturePayload("src-storage-test", "Need lineage", "stage-run-1"));

    assert.equal(storage.isEmpty(), false);
    assert.equal(storage.listSources().length, 1);
    assert.equal(storage.listStageRuns().length, 1);
    assert.equal(storage.listLossAudits().length, 1);
    assert.equal(storage.listBlobs().length, 1);
    assert.equal(storage.listRecords().length, 1);
    assert.equal(storage.listFragments().length, 4);
    assert.equal(storage.listAtoms().length, 4);
    assert.equal(storage.listEdges().length, 2);
    assert.equal(storage.listCandidates().length, 3);
    assert.equal(storage.listTurns().length, 1);
    assert.equal(storage.getSession("session-1")?.id, "session-1");
    assert.equal(storage.getTurn("turn-1")?.canonical_text, "Need lineage");
    assert.equal(storage.getTurnContext("turn-1")?.tool_calls.length, 1);

    const lineage = storage.getTurnLineage("turn-1");
    assert.ok(lineage);
    assert.equal(lineage.session?.id, "session-1");
    assert.equal(lineage.candidate_chain.length, 3);
    assert.equal(lineage.atoms.length, 4);
    assert.equal(lineage.edges.length, 2);
    assert.equal(lineage.fragments.length, 4);
    assert.equal(lineage.records.length, 1);
    assert.equal(lineage.blobs.length, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("replaceSourcePayload replaces prior rows for the same source deterministically", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(createFixturePayload("src-storage-test", "Old text", "stage-run-old"));
    storage.replaceSourcePayload(createFixturePayload("src-storage-test", "New text", "stage-run-new"));

    assert.equal(storage.listTurns().length, 1);
    assert.equal(storage.listStageRuns().length, 1);
    assert.equal(storage.listLossAudits().length, 1);
    assert.equal(storage.listEdges().length, 2);
    assert.equal(storage.getTurn("turn-1")?.canonical_text, "New text");
    assert.equal(storage.listStageRuns()[0]?.id, "stage-run-new");
    assert.equal(storage.listLossAudits()[0]?.detail, "updated fixture loss audit");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("replaceSourcePayload can rekey a local source when host identity changes", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    const baseDir = "/tmp/storage-fixture/legacy-codex";
    const legacyPayload = createFixturePayload("src-codex", "Legacy text", "stage-run-legacy", {
      baseDir,
      hostId: "host-legacy",
    });
    const normalizedPayload = createFixturePayload(
      deriveSourceInstanceId({
        host_id: "host-current",
        slot_id: "codex",
        base_dir: baseDir,
      }),
      "Fresh text",
      "stage-run-current",
      {
        baseDir,
        hostId: "host-current",
      },
    );

    storage.replaceSourcePayload(legacyPayload, { allow_host_rekey: true });
    storage.replaceSourcePayload(normalizedPayload, { allow_host_rekey: true });

    assert.equal(storage.listSources().length, 1);
    assert.equal(storage.listResolvedSessions().length, 1);
    assert.equal(storage.listTurns().length, 1);
    assert.equal(storage.getTurn("turn-1")?.canonical_text, "Fresh text");
    assert.equal(storage.listSources()[0]?.id, normalizedPayload.source.id);
    assert.equal(storage.listSources()[0]?.host_id, "host-current");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("replaceSourcePayload tolerates duplicate blob rows within one payload", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    const payload = createFixturePayload("src-storage-duplicate-blob", "Duplicate blob", "stage-run-duplicate-blob");
    payload.blobs.push({ ...payload.blobs[0]! });

    storage.replaceSourcePayload(payload);

    const storedPayload = storage.listSourcePayloads()[0];
    assert.equal(storage.listBlobs().length, 1);
    assert.equal(storedPayload?.blobs.length, 1);
    assert.equal(storage.getTurn("turn-1")?.canonical_text, "Duplicate blob");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("listSourcePayloads reconstructs persisted source payloads for export or merge", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(createFixturePayload("src-storage-export-a", "Export A", "stage-run-export-a"));
    storage.replaceSourcePayload(createFixturePayload("src-storage-export-b", "Export B", "stage-run-export-b", { turnId: "turn-2", sessionId: "session-2" }));

    const payloads = storage.listSourcePayloads().sort((left, right) =>
      left.turns[0]!.canonical_text.localeCompare(right.turns[0]!.canonical_text),
    );
    assert.equal(payloads.length, 2);
    assert.equal(payloads[0]?.turns[0]?.canonical_text, "Export A");
    assert.equal(payloads[1]?.turns[0]?.canonical_text, "Export B");
    assert.equal(storage.getSourcePayload(payloads[1]!.source.id)?.sessions[0]?.id, "session-2");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("usage rollups sort day and month buckets chronologically", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    const marchPayload = createFixturePayload("src-storage-rollup-march", "March turn", "stage-run-rollup-march", {
      sessionId: "session-rollup-march",
      turnId: "turn-rollup-march",
    });
    marchPayload.turns[0] = {
      ...marchPayload.turns[0]!,
      created_at: "2026-03-15T09:00:00.000Z",
      submission_started_at: "2026-03-15T09:00:00.000Z",
      context_summary: {
        ...marchPayload.turns[0]!.context_summary,
        total_tokens: 20,
        token_usage: {
          ...marchPayload.turns[0]!.context_summary.token_usage!,
          total_tokens: 20,
        },
      },
    };
    marchPayload.sessions[0] = {
      ...marchPayload.sessions[0]!,
      created_at: "2026-03-15T09:00:00.000Z",
      updated_at: "2026-03-15T09:00:01.000Z",
    };

    const februaryPayload = createFixturePayload(
      "src-storage-rollup-february",
      "February turn",
      "stage-run-rollup-february",
      {
        sessionId: "session-rollup-february",
        turnId: "turn-rollup-february",
      },
    );
    februaryPayload.turns[0] = {
      ...februaryPayload.turns[0]!,
      created_at: "2026-02-20T09:00:00.000Z",
      submission_started_at: "2026-02-20T09:00:00.000Z",
      context_summary: {
        ...februaryPayload.turns[0]!.context_summary,
        total_tokens: 200,
        token_usage: {
          ...februaryPayload.turns[0]!.context_summary.token_usage!,
          total_tokens: 200,
        },
      },
    };
    februaryPayload.sessions[0] = {
      ...februaryPayload.sessions[0]!,
      created_at: "2026-02-20T09:00:00.000Z",
      updated_at: "2026-02-20T09:00:01.000Z",
    };

    storage.replaceSourcePayload(marchPayload);
    storage.replaceSourcePayload(februaryPayload);

    assert.deepEqual(
      storage.listUsageRollup("day").rows.map((row) => row.key),
      ["2026-02-20", "2026-03-15"],
    );
    assert.deepEqual(
      storage.listUsageRollup("month").rows.map((row) => row.key),
      ["2026-02", "2026-03"],
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("resolved snapshot reads reuse one memoized project-link snapshot", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(createFixturePayload("src-storage-cache", "Cache me", "stage-run-cache"));

    const originalCompute = (storage as any).computeProjectLinkSnapshot.bind(storage) as () => unknown;
    let computeCalls = 0;
    (storage as any).computeProjectLinkSnapshot = () => {
      computeCalls += 1;
      return originalCompute();
    };

    (storage as any).invalidateProjectLinkSnapshot();
    storage.listResolvedTurns();
    storage.listResolvedSessions();
    storage.getResolvedTurn("turn-1");
    storage.getResolvedSession("session-1");
    storage.listProjectObservations();
    storage.getLinkingReview();

    assert.equal(computeCalls, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("writes invalidate and repopulate the memoized project-link snapshot once per write", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(createFixturePayload("src-storage-cache-write", "Cache write", "stage-run-cache-write"));

    const originalCompute = (storage as any).computeProjectLinkSnapshot.bind(storage) as () => unknown;
    let computeCalls = 0;
    (storage as any).computeProjectLinkSnapshot = () => {
      computeCalls += 1;
      return originalCompute();
    };

    storage.upsertProjectOverride({
      target_kind: "turn",
      target_ref: "turn-1",
      project_id: "project-cache-write",
      display_name: "Cache Write",
    });
    assert.equal(computeCalls, 1);

    storage.listResolvedTurns();
    storage.getLinkingReview();
    assert.equal(computeCalls, 1);

    storage.purgeTurn("turn-1");
    assert.equal(computeCalls, 2);

    storage.listResolvedTurns();
    assert.equal(computeCalls, 2);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("derived project linker commits repo continuity and preserves workspace-only candidates", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-committed-a", "Committed turn A", "stage-run-committed-a", {
        sessionId: "session-committed-a",
        turnId: "turn-committed-a",
        hostId: "host-1",
        platform: "codex",
        workingDirectory: "/workspace/cchistory",
        projectObservation: {
          workspacePath: "/workspace/cchistory",
          repoRoot: "/workspace/cchistory",
          repoRemote: "https://example.com/org/cchistory",
          repoFingerprint: "repo-fingerprint-cchistory",
        },
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-committed-b", "Committed turn B", "stage-run-committed-b", {
        sessionId: "session-committed-b",
        turnId: "turn-committed-b",
        hostId: "host-2",
        platform: "claude_code",
        workingDirectory: "/projects/cchistory",
        projectObservation: {
          workspacePath: "/projects/cchistory",
          repoRoot: "/projects/cchistory",
          repoRemote: "https://example.com/renamed/cchistory",
          repoFingerprint: "repo-fingerprint-cchistory",
        },
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-candidate", "Candidate turn", "stage-run-candidate", {
        sessionId: "session-candidate",
        turnId: "turn-candidate",
        hostId: "host-1",
        platform: "amp",
        workingDirectory: "/workspace/local-candidate",
        projectObservation: {
          workspacePath: "/workspace/local-candidate",
        },
      }),
    );

    const projects = storage.listProjects();
    assert.equal(projects.length, 2);

    const committedProjects = projects.filter((project) => project.linkage_state === "committed");
    const candidateProjects = projects.filter((project) => project.linkage_state === "candidate");
    assert.equal(committedProjects.length, 1);
    assert.equal(candidateProjects.length, 1);

    const committedProject = committedProjects[0]!;
    assert.equal(committedProject.link_reason, "repo_fingerprint_match");
    assert.equal(committedProject.committed_turn_count, 2);
    assert.equal(committedProject.session_count, 2);
    assert.deepEqual(committedProject.host_ids, ["host-1", "host-2"]);

    const candidateProject = candidateProjects[0]!;
    assert.equal(candidateProject.link_reason, "workspace_path_continuity");
    assert.equal(candidateProject.candidate_turn_count, 1);
    assert.equal(candidateProject.committed_turn_count, 0);

    const resolvedTurns = storage.listResolvedTurns();
    const committedTurnA = resolvedTurns.find((turn) => turn.id === "turn-committed-a");
    const committedTurnB = resolvedTurns.find((turn) => turn.id === "turn-committed-b");
    const candidateTurn = resolvedTurns.find((turn) => turn.id === "turn-candidate");
    assert.equal(committedTurnA?.link_state, "committed");
    assert.equal(committedTurnB?.link_state, "committed");
    assert.equal(committedTurnA?.project_id, committedTurnB?.project_id);
    assert.equal(candidateTurn?.link_state, "candidate");
    assert.deepEqual(candidateTurn?.candidate_project_ids, [candidateProject.project_id]);

    const resolvedSession = storage.getResolvedSession("session-candidate");
    assert.equal(resolvedSession?.primary_project_id, candidateProject.project_id);

    const lineage = storage.getTurnLineage("turn-committed-a");
    assert.equal(lineage?.turn.link_state, "committed");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("workspace continuity candidates gain confidence when repeated across sessions", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-workspace-a", "Workspace turn A", "stage-run-workspace-a", {
        sessionId: "session-workspace-a",
        turnId: "turn-workspace-a",
        hostId: "host-1",
        platform: "codex",
        workingDirectory: "/workspace/repeated-project",
        projectObservation: {
          workspacePath: "/workspace/repeated-project",
          repoRoot: "/workspace/repeated-project",
        },
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-workspace-b", "Workspace turn B", "stage-run-workspace-b", {
        sessionId: "session-workspace-b",
        turnId: "turn-workspace-b",
        hostId: "host-1",
        platform: "claude_code",
        workingDirectory: "/workspace/repeated-project",
        projectObservation: {
          workspacePath: "/workspace/repeated-project",
          repoRoot: "/workspace/repeated-project",
        },
      }),
    );

    const projects = storage.listProjects();
    assert.equal(projects.length, 1);

    const candidateProject = projects[0]!;
    assert.equal(candidateProject.linkage_state, "candidate");
    assert.equal(candidateProject.link_reason, "workspace_path_continuity");
    assert.equal(candidateProject.session_count, 2);
    assert.equal(candidateProject.candidate_turn_count, 2);
    assert.ok(candidateProject.confidence > 0.55);

    const resolvedTurns = storage.listResolvedTurns();
    assert.equal(resolvedTurns.length, 2);
    assert.ok(resolvedTurns.every((turn) => turn.link_state === "candidate"));
    assert.ok(resolvedTurns.every((turn) => turn.project_confidence === candidateProject.confidence));
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("source-native project refs keep turns candidate-linked when workspace paths are unavailable", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-native-project", "Native project turn", "stage-run-native-project", {
        sessionId: "session-native-project",
        turnId: "turn-native-project",
        platform: "codex",
        workingDirectory: "",
        projectObservation: {
          sourceNativeProjectRef: "Users-alex-m4-workspace-111",
        },
      }),
    );

    const projects = storage.listProjects();
    assert.equal(projects.length, 1);
    assert.equal(projects[0]?.linkage_state, "candidate");
    assert.equal(projects[0]?.link_reason, "source_native_project");
    assert.equal(projects[0]?.source_native_project_ref, "Users-alex-m4-workspace-111");

    const resolvedTurn = storage.getResolvedTurn("turn-native-project");
    assert.equal(resolvedTurn?.link_state, "candidate");
    assert.equal(resolvedTurn?.project_id, projects[0]?.project_id);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("storage synthesizes Cursor project observations from persisted blob origins when source candidates are missing", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    const payload = createFixturePayload(
      "src-storage-cursor-fallback",
      "Cursor fallback turn",
      "stage-run-cursor-fallback",
      {
        sessionId: "session-cursor-fallback",
        turnId: "turn-cursor-fallback",
        platform: "cursor",
        workingDirectory: "",
        includeProjectObservation: false,
      },
    );

    payload.source.base_dir = "/tmp/.cursor/projects";
    payload.blobs[0] = {
      ...payload.blobs[0]!,
      origin_path:
        "/tmp/.cursor/projects/workspace-a/agent-transcripts/session-cursor-fallback/session-cursor-fallback.jsonl",
    };
    payload.sessions[0] = {
      ...payload.sessions[0]!,
      working_directory: undefined,
      source_native_project_ref: undefined,
    };

    storage.replaceSourcePayload(payload);

    const projects = storage.listProjects();
    assert.equal(projects.length, 1);
    assert.equal(projects[0]?.linkage_state, "candidate");
    assert.equal(projects[0]?.link_reason, "source_native_project");
    assert.equal(projects[0]?.source_native_project_ref, "workspace-a");
    assert.equal(projects[0]?.confidence, 0.72);

    const resolvedTurn = storage.getResolvedTurn("turn-cursor-fallback");
    assert.equal(resolvedTurn?.link_state, "candidate");
    assert.equal(resolvedTurn?.project_id, projects[0]?.project_id);
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

    const resolvedTurns = storage.listResolvedTurns();
    assert.equal(resolvedTurns.length, 2);
    assert.ok(resolvedTurns.every((turn) => turn.link_state === "candidate"));
    assert.ok(resolvedTurns.every((turn) => turn.project_confidence === candidateProject.confidence));
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("derived linking review separates committed, candidate, and unlinked material", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-remote", "Committed via remote", "stage-run-remote", {
        sessionId: "session-remote",
        turnId: "turn-remote",
        hostId: "host-1",
        platform: "codex",
        workingDirectory: "/workspace/remote-only",
        projectObservation: {
          workspacePath: "/workspace/remote-only",
          repoRemote: "https://example.com/org/remote-only",
        },
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-workspace", "Candidate via workspace", "stage-run-workspace", {
        sessionId: "session-workspace",
        turnId: "turn-workspace",
        hostId: "host-1",
        platform: "factory_droid",
        workingDirectory: "/workspace/local-only",
        projectObservation: {
          workspacePath: "/workspace/local-only",
        },
      }),
    );
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-unlinked", "Unlinked turn", "stage-run-unlinked", {
        sessionId: "session-unlinked",
        turnId: "turn-unlinked",
        hostId: "host-1",
        platform: "amp",
        workingDirectory: "",
        includeProjectObservation: false,
      }),
    );

    const review = storage.getLinkingReview();
    assert.equal(review.committed_projects.length, 1);
    assert.equal(review.candidate_projects.length, 1);
    assert.equal(review.candidate_turns.length, 1);
    assert.equal(review.unlinked_turns.length, 1);
    assert.equal(review.candidate_turns[0]?.id, "turn-workspace");
    assert.equal(review.unlinked_turns[0]?.id, "turn-unlinked");

    const remoteProject = review.committed_projects[0]!;
    assert.equal(remoteProject.link_reason, "repo_remote_match");

    const remoteObservation = review.project_observations.find((observation) => observation.session_ref === "session-remote");
    assert.equal(remoteObservation?.project_id, remoteProject.project_id);
    assert.equal(remoteObservation?.linkage_state, "committed");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("linking review uses all project observation candidates instead of truncating to the first 500", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    const payload = createFixturePayload("src-storage-candidate-limit", "Candidate beyond candidate limit", "stage-run-candidate-limit", {
      sessionId: "session-candidate-limit",
      turnId: "turn-candidate-limit",
      hostId: "host-1",
      platform: "codex",
      workingDirectory: "/workspace/candidate-limit",
      projectObservation: {
        workspacePath: "/workspace/candidate-limit",
      },
    });

    const projectObservationCandidate = payload.candidates.find(
      (candidate) => candidate.candidate_kind === "project_observation",
    );
    assert.ok(projectObservationCandidate);
    projectObservationCandidate!.id = "0000-project-observation";

    for (let index = 0; index < 500; index += 1) {
      payload.candidates.push({
        id: `zzzz-noise-${String(index).padStart(4, "0")}`,
        source_id: payload.source.id,
        session_ref: payload.sessions[0]!.id,
        candidate_kind: "turn",
        input_atom_refs: [],
        started_at: payload.sessions[0]!.created_at,
        ended_at: payload.sessions[0]!.updated_at,
        rule_version: "2026-03-09.1",
        evidence: {
          noise: true,
          ordinal: index,
        },
      });
    }

    storage.replaceSourcePayload(payload);

    const review = storage.getLinkingReview();
    assert.equal(review.unlinked_turns.length, 0);
    assert.equal(review.candidate_turns.length, 1);
    assert.equal(review.candidate_turns[0]?.id, "turn-candidate-limit");
    assert.equal(review.candidate_turns[0]?.link_state, "candidate");
    assert.equal(review.project_observations.length, 1);
    assert.equal(review.project_observations[0]?.session_ref, "session-candidate-limit");
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

test("candidate lifecycle controls can archive or purge turns and artifact coverage remains queryable", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-storage-"));

  try {
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createFixturePayload("src-storage-lifecycle", "Lifecycle candidate", "stage-run-lifecycle", {
        sessionId: "session-lifecycle",
        turnId: "turn-lifecycle",
        hostId: "host-1",
        platform: "amp",
        workingDirectory: "/workspace/lifecycle",
        projectObservation: {
          workspacePath: "/workspace/lifecycle",
        },
      }),
    );

    const archiveRun = storage.garbageCollectCandidateTurns({
      before_iso: "2026-03-10T00:00:00.000Z",
      mode: "archive",
    });
    assert.deepEqual(archiveRun.processed_turn_ids, ["turn-lifecycle"]);
    assert.equal(storage.getResolvedTurn("turn-lifecycle")?.value_axis, "archived");
    assert.equal(storage.getResolvedTurn("turn-lifecycle")?.retention_axis, "keep_raw_only");

    const artifact = storage.upsertKnowledgeArtifact({
      title: "Lifecycle Artifact",
      summary: "Captures lifecycle test coverage.",
      source_turn_refs: ["turn-lifecycle"],
    });
    assert.equal(storage.listKnowledgeArtifacts().length, 1);
    assert.equal(storage.listArtifactCoverage(artifact.artifact_id).length, 1);

    const tombstone = storage.purgeTurn("turn-lifecycle", "test_purge");
    assert.equal(tombstone?.logical_id, "turn-lifecycle");
    assert.equal(storage.getTombstone("turn-lifecycle")?.purge_reason, "test_purge");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

interface FixturePayloadOptions {
  sessionId?: string;
  turnId?: string;
  hostId?: string;
  platform?: "codex" | "claude_code" | "factory_droid" | "amp" | "cursor";
  baseDir?: string;
  workingDirectory?: string;
  includeProjectObservation?: boolean;
  projectObservation?: {
    workspacePath?: string;
    repoRoot?: string;
    repoRemote?: string;
    repoFingerprint?: string;
    sourceNativeProjectRef?: string;
    confidence?: number;
  };
}

function createFixturePayload(
  sourceId: string,
  canonicalText: string,
  stageRunId: string,
  options: FixturePayloadOptions = {},
): SourceSyncPayload {
  const createdAt = "2026-03-09T09:00:00.000Z";
  const assistantAt = "2026-03-09T09:00:01.000Z";
  const toolCallAt = "2026-03-09T09:00:02.000Z";
  const toolResultAt = "2026-03-09T09:00:03.000Z";
  const sessionId = options.sessionId ?? "session-1";
  const turnId = options.turnId ?? "turn-1";
  const hostId = options.hostId ?? "host-1";
  const platform = options.platform ?? "codex";
  const baseDir = options.baseDir ?? `/tmp/storage-fixture/${sourceId}`;
  const workingDirectory = options.workingDirectory ?? "/workspace/storage-fixture";
  const projectObservation = options.projectObservation;
  const includeProjectObservation = options.includeProjectObservation ?? Boolean(projectObservation);
  const blobId = `${turnId}-blob`;
  const recordId = `${turnId}-record`;
  const userFragmentId = `${turnId}-fragment-user`;
  const assistantFragmentId = `${turnId}-fragment-assistant`;
  const toolCallFragmentId = `${turnId}-fragment-tool-call`;
  const toolResultFragmentId = `${turnId}-fragment-tool-result`;
  const userAtomId = `${turnId}-atom-user`;
  const assistantAtomId = `${turnId}-atom-assistant`;
  const toolCallAtomId = `${turnId}-atom-tool-call`;
  const toolResultAtomId = `${turnId}-atom-tool-result`;
  const submissionCandidateId = `${turnId}-candidate-submission`;
  const turnCandidateId = `${turnId}-candidate-turn`;
  const contextCandidateId = `${turnId}-candidate-context`;
  const projectObservationCandidateId = `${turnId}-candidate-project-observation`;
  const assistantReplyId = `${turnId}-assistant-reply`;
  const toolCallProjectionId = `${turnId}-tool-call`;
  const userMessageId = `${turnId}-user-message`;

  const candidates: SourceSyncPayload["candidates"] = [
    {
      id: submissionCandidateId,
      source_id: sourceId,
      session_ref: sessionId,
      candidate_kind: "submission_group",
      input_atom_refs: [userAtomId],
      started_at: createdAt,
      ended_at: createdAt,
      rule_version: "2026-03-09.1",
      evidence: { assistant_seen_after_group_start: true },
    },
    {
      id: turnCandidateId,
      source_id: sourceId,
      session_ref: sessionId,
      candidate_kind: "turn",
      input_atom_refs: [userAtomId],
      started_at: createdAt,
      ended_at: toolResultAt,
      rule_version: "2026-03-09.1",
      evidence: { submission_group_id: submissionCandidateId },
    },
    {
      id: contextCandidateId,
      source_id: sourceId,
      session_ref: sessionId,
      candidate_kind: "context_span",
      input_atom_refs: [assistantAtomId, toolCallAtomId, toolResultAtomId],
      started_at: createdAt,
      ended_at: toolResultAt,
      rule_version: "2026-03-09.1",
      evidence: { turn_candidate_id: turnCandidateId },
    },
  ];

  if (includeProjectObservation) {
    candidates.push({
      id: projectObservationCandidateId,
      source_id: sourceId,
      session_ref: sessionId,
      candidate_kind: "project_observation",
      input_atom_refs: [userAtomId],
      started_at: createdAt,
      ended_at: createdAt,
      rule_version: "2026-03-09.1",
      evidence: {
        workspace_path: projectObservation?.workspacePath ?? workingDirectory,
        workspace_path_normalized: projectObservation?.workspacePath ?? workingDirectory,
        repo_root: projectObservation?.repoRoot,
        repo_remote: projectObservation?.repoRemote,
        repo_fingerprint: projectObservation?.repoFingerprint,
        source_native_project_ref: projectObservation?.sourceNativeProjectRef,
        confidence: projectObservation?.confidence ?? 0.5,
      },
    });
  }

  return {
    source: {
      id: sourceId,
      slot_id: platform,
      family: "local_coding_agent",
      platform,
      display_name: "Storage fixture",
      base_dir: baseDir,
      host_id: hostId,
      last_sync: toolResultAt,
      sync_status: "healthy",
      total_blobs: 1,
      total_records: 1,
      total_fragments: 4,
      total_atoms: 4,
      total_sessions: 1,
      total_turns: 1,
    },
    stage_runs: [
      {
        id: stageRunId,
        source_id: sourceId,
        stage_kind: "finalize_projections",
        parser_version: "codex-parser@2026-03-09.1",
        parser_capabilities: ["turn_projections", "turn_context_projections", "loss_audits"],
        source_format_profile_ids: ["codex:jsonl:v1"],
        started_at: createdAt,
        finished_at: toolResultAt,
        status: "success",
        stats: { turns: 1, sessions: 1 },
      },
    ],
    loss_audits: [
      {
        id: `${turnId}-loss-audit`,
        source_id: sourceId,
        stage_run_id: stageRunId,
        stage_kind: "finalize_projections",
        diagnostic_code: "fixture_projection_gap",
        severity: "warning",
        scope_ref: toolResultFragmentId,
        session_ref: sessionId,
        blob_ref: blobId,
        record_ref: recordId,
        fragment_ref: toolResultFragmentId,
        source_format_profile_id: "codex:jsonl:v1",
        loss_kind: "unknown_fragment",
        detail: canonicalText === "New text" ? "updated fixture loss audit" : "fixture loss audit",
        created_at: toolResultAt,
      },
    ],
    blobs: [
      {
        id: blobId,
        source_id: sourceId,
        host_id: hostId,
        origin_path: path.join(baseDir, "session.jsonl"),
        checksum: "checksum-1",
        size_bytes: 128,
        captured_at: createdAt,
        capture_run_id: "capture-run-1",
      },
    ],
    records: [
      {
        id: recordId,
        source_id: sourceId,
        blob_id: blobId,
        session_ref: sessionId,
        ordinal: 0,
        record_path_or_offset: "0",
        observed_at: createdAt,
        parseable: true,
        raw_json: "{\"fixture\":true}",
      },
    ],
    fragments: [
      {
        id: userFragmentId,
        source_id: sourceId,
        session_ref: sessionId,
        record_id: recordId,
        seq_no: 0,
        fragment_kind: "text",
        actor_kind: "user",
        origin_kind: "user_authored",
        time_key: createdAt,
        payload: { text: canonicalText },
        raw_refs: [recordId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: assistantFragmentId,
        source_id: sourceId,
        session_ref: sessionId,
        record_id: recordId,
        seq_no: 1,
        fragment_kind: "text",
        actor_kind: "assistant",
        origin_kind: "assistant_authored",
        time_key: assistantAt,
        payload: { text: "Running tool" },
        raw_refs: [recordId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: toolCallFragmentId,
        source_id: sourceId,
        session_ref: sessionId,
        record_id: recordId,
        seq_no: 2,
        fragment_kind: "tool_call",
        time_key: toolCallAt,
        payload: { call_id: "call-1", tool_name: "shell", input: {} },
        raw_refs: [recordId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: toolResultFragmentId,
        source_id: sourceId,
        session_ref: sessionId,
        record_id: recordId,
        seq_no: 3,
        fragment_kind: "tool_result",
        time_key: toolResultAt,
        payload: { call_id: "call-1", output: "ok" },
        raw_refs: [recordId],
        source_format_profile_id: "codex:jsonl:v1",
      },
    ],
    atoms: [
      {
        id: userAtomId,
        source_id: sourceId,
        session_ref: sessionId,
        seq_no: 0,
        actor_kind: "user",
        origin_kind: "user_authored",
        content_kind: "text",
        time_key: createdAt,
        display_policy: "show",
        payload: { text: canonicalText },
        fragment_refs: [userFragmentId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: assistantAtomId,
        source_id: sourceId,
        session_ref: sessionId,
        seq_no: 1,
        actor_kind: "assistant",
        origin_kind: "assistant_authored",
        content_kind: "text",
        time_key: assistantAt,
        display_policy: "show",
        payload: { text: "Running tool" },
        fragment_refs: [assistantFragmentId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: toolCallAtomId,
        source_id: sourceId,
        session_ref: sessionId,
        seq_no: 2,
        actor_kind: "tool",
        origin_kind: "tool_generated",
        content_kind: "tool_call",
        time_key: toolCallAt,
        display_policy: "show",
        payload: { call_id: "call-1", tool_name: "shell", input: {} },
        fragment_refs: [toolCallFragmentId],
        source_format_profile_id: "codex:jsonl:v1",
      },
      {
        id: toolResultAtomId,
        source_id: sourceId,
        session_ref: sessionId,
        seq_no: 3,
        actor_kind: "tool",
        origin_kind: "tool_generated",
        content_kind: "tool_result",
        time_key: toolResultAt,
        display_policy: "show",
        payload: { call_id: "call-1", output: "ok" },
        fragment_refs: [toolResultFragmentId],
        source_format_profile_id: "codex:jsonl:v1",
      },
    ],
    edges: [
      {
        id: `${turnId}-edge-spawned-from`,
        source_id: sourceId,
        session_ref: sessionId,
        from_atom_id: toolCallAtomId,
        to_atom_id: assistantAtomId,
        edge_kind: "spawned_from",
      },
      {
        id: `${turnId}-edge-tool-result-for`,
        source_id: sourceId,
        session_ref: sessionId,
        from_atom_id: toolResultAtomId,
        to_atom_id: toolCallAtomId,
        edge_kind: "tool_result_for",
      },
    ],
    candidates,
    sessions: [
      {
        id: sessionId,
        source_id: sourceId,
        source_platform: platform,
        host_id: hostId,
        title: canonicalText,
        created_at: createdAt,
        updated_at: toolResultAt,
        turn_count: 1,
        model: "gpt-5",
        working_directory: workingDirectory,
        sync_axis: "current",
      },
    ],
    turns: [
      {
        id: turnId,
        revision_id: `${turnId}:r1`,
        user_messages: [
          {
            id: userMessageId,
            raw_text: canonicalText,
            sequence: 0,
            is_injected: false,
            created_at: createdAt,
            atom_refs: [userAtomId],
          },
        ],
        raw_text: canonicalText,
        canonical_text: canonicalText,
        display_segments: [{ type: "text", content: canonicalText }],
        created_at: createdAt,
        submission_started_at: createdAt,
        last_context_activity_at: toolResultAt,
        session_id: sessionId,
        source_id: sourceId,
        link_state: "unlinked",
        sync_axis: "current",
        value_axis: "active",
        retention_axis: "keep_raw_and_derived",
        context_ref: turnId,
        context_summary: {
          assistant_reply_count: 1,
          tool_call_count: 1,
          primary_model: "gpt-5",
          has_errors: false,
        },
        lineage: {
          atom_refs: [userAtomId, assistantAtomId, toolCallAtomId, toolResultAtomId],
          candidate_refs: candidates.map((candidate) => candidate.id),
          fragment_refs: [userFragmentId, assistantFragmentId, toolCallFragmentId, toolResultFragmentId],
          record_refs: [recordId],
          blob_refs: [blobId],
        },
      },
    ],
    contexts: [
      {
        turn_id: turnId,
        system_messages: [],
        assistant_replies: [
          {
            id: assistantReplyId,
            content: "Running tool",
            display_segments: [{ type: "text", content: "Running tool" }],
            content_preview: "Running tool",
            model: "gpt-5",
            created_at: assistantAt,
            tool_call_ids: [toolCallProjectionId],
          },
        ],
        tool_calls: [
          {
            id: toolCallProjectionId,
            tool_name: "shell",
            input: {},
            input_summary: "{}",
            input_display_segments: [{ type: "text", content: "{}" }],
            output: "ok",
            output_preview: "ok",
            output_display_segments: [{ type: "text", content: "ok" }],
            status: "success",
            reply_id: assistantReplyId,
            sequence: 0,
            created_at: toolCallAt,
          },
        ],
        raw_event_refs: [recordId],
      },
    ],
  };
}
