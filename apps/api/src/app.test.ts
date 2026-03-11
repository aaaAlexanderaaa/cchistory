import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { SourceDefinition, SourceSyncPayload } from "@cchistory/domain";
import { CCHistoryStorage } from "@cchistory/storage";
import { createApiRuntime } from "./app.js";

test("probe and replay stay read-only when persist is false", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-"));

  try {
    const source = await seedCodexSourceFixture(tempRoot, "readonly");
    const dataDir = path.join(tempRoot, "data-readonly");
    const runtime = await createApiRuntime({ dataDir, sources: [source] });

    try {
      const probeResponse = await runtime.app.inject({
        method: "POST",
        url: "/api/admin/probe/runs",
        payload: {
          source_ids: [source.id],
          limit_files_per_source: 1,
          persist: false,
        },
      });

      assert.equal(probeResponse.statusCode, 200);
      assert.equal(runtime.storage.isEmpty(), true);
      assert.equal(await countFiles(runtime.rawStoreDir), 0);

      const replayResponse = await runtime.app.inject({
        method: "POST",
        url: "/api/admin/pipeline/replay",
        payload: {
          source_ids: [source.id],
          limit_files_per_source: 1,
        },
      });

      assert.equal(replayResponse.statusCode, 200);
      assert.equal(runtime.storage.isEmpty(), true);
      assert.equal(await countFiles(runtime.rawStoreDir), 0);
    } finally {
      await runtime.app.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("persisted probe snapshots raw blobs and seeds storage", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-"));

  try {
    const source = await seedCodexSourceFixture(tempRoot, "persisted");
    const dataDir = path.join(tempRoot, "data-persisted");
    const runtime = await createApiRuntime({ dataDir, sources: [source] });

    try {
      const response = await runtime.app.inject({
        method: "POST",
        url: "/api/admin/probe/runs",
        payload: {
          source_ids: [source.id],
          limit_files_per_source: 1,
          persist: true,
        },
      });

      assert.equal(response.statusCode, 200);
      assert.equal(runtime.storage.isEmpty(), false);
      assert.equal(await countFiles(runtime.rawStoreDir), 1);

      const turnsResponse = await runtime.app.inject({ method: "GET", url: "/api/turns" });
      assert.equal(turnsResponse.statusCode, 200);
      const turns = JSON.parse(turnsResponse.body).turns as Array<{
        id: string;
        link_state: string;
        candidate_project_ids?: string[];
        lineage?: unknown;
      }>;
      assert.equal(turns.length, 1);
      assert.equal(turns[0]?.link_state, "candidate");
      assert.equal(turns[0]?.candidate_project_ids?.length, 1);
      assert.equal("lineage" in turns[0]!, false);

      const contextResponse = await runtime.app.inject({
        method: "GET",
        url: `/api/turns/${encodeURIComponent(turns[0]!.id)}/context`,
      });
      assert.equal(contextResponse.statusCode, 200);

      const runsResponse = await runtime.app.inject({ method: "GET", url: "/api/admin/pipeline/runs" });
      assert.equal(runsResponse.statusCode, 200);
      assert.ok(JSON.parse(runsResponse.body).runs.length >= 1);

      const blobsResponse = await runtime.app.inject({ method: "GET", url: "/api/admin/pipeline/blobs" });
      assert.equal(blobsResponse.statusCode, 200);
      assert.equal(JSON.parse(blobsResponse.body).blobs.length, 1);

      const recordsResponse = await runtime.app.inject({ method: "GET", url: "/api/admin/pipeline/records" });
      assert.equal(recordsResponse.statusCode, 200);
      assert.ok(JSON.parse(recordsResponse.body).records.length >= 1);

      const fragmentsResponse = await runtime.app.inject({ method: "GET", url: "/api/admin/pipeline/fragments" });
      assert.equal(fragmentsResponse.statusCode, 200);
      assert.ok(JSON.parse(fragmentsResponse.body).fragments.length >= 2);

      const atomsResponse = await runtime.app.inject({ method: "GET", url: "/api/admin/pipeline/atoms" });
      assert.equal(atomsResponse.statusCode, 200);
      assert.ok(JSON.parse(atomsResponse.body).atoms.length >= 2);

      const edgesResponse = await runtime.app.inject({ method: "GET", url: "/api/admin/pipeline/edges" });
      assert.equal(edgesResponse.statusCode, 200);
      assert.ok(Array.isArray(JSON.parse(edgesResponse.body).edges));

      const candidatesResponse = await runtime.app.inject({ method: "GET", url: "/api/admin/pipeline/candidates" });
      assert.equal(candidatesResponse.statusCode, 200);
      assert.ok(JSON.parse(candidatesResponse.body).candidates.length >= 3);

      const auditsResponse = await runtime.app.inject({ method: "GET", url: "/api/admin/pipeline/loss-audits" });
      assert.equal(auditsResponse.statusCode, 200);
      assert.ok(Array.isArray(JSON.parse(auditsResponse.body).loss_audits));

      const linkingResponse = await runtime.app.inject({ method: "GET", url: "/api/admin/linking" });
      assert.equal(linkingResponse.statusCode, 200);
      const linkingBody = JSON.parse(linkingResponse.body) as {
        committed_projects: Array<{ project_id: string }>;
        candidate_projects: Array<{ project_id: string }>;
        unlinked_turns: Array<{ id: string }>;
        candidate_turns: Array<{ id: string }>;
        project_observations: Array<{ id: string; project_id?: string; linkage_state?: string }>;
      };
      assert.equal(linkingBody.committed_projects.length, 0);
      assert.equal(linkingBody.candidate_projects.length, 1);
      assert.equal(linkingBody.unlinked_turns.length, 0);
      assert.equal(linkingBody.candidate_turns.length, 1);
      assert.ok(linkingBody.project_observations.length >= 1);
      assert.equal(linkingBody.project_observations[0]?.linkage_state, "candidate");

      const projectsResponse = await runtime.app.inject({ method: "GET", url: "/api/projects" });
      assert.equal(projectsResponse.statusCode, 200);
      assert.equal(JSON.parse(projectsResponse.body).projects.length, 1);

      const committedProjectsResponse = await runtime.app.inject({ method: "GET", url: "/api/projects?state=committed" });
      assert.equal(committedProjectsResponse.statusCode, 200);
      assert.equal(JSON.parse(committedProjectsResponse.body).projects.length, 0);

      const sessionsResponse = await runtime.app.inject({ method: "GET", url: "/api/sessions" });
      assert.equal(sessionsResponse.statusCode, 200);
      assert.equal(JSON.parse(sessionsResponse.body).sessions.length, 1);

      const lineageResponse = await runtime.app.inject({
        method: "GET",
        url: `/api/admin/pipeline/lineage/${encodeURIComponent(turns[0]!.id)}`,
      });
      assert.equal(lineageResponse.statusCode, 200);
      assert.equal(JSON.parse(lineageResponse.body).lineage.turn.id, turns[0]!.id);
    } finally {
      await runtime.app.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("projects endpoint returns committed project summaries from derived linker output", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-"));

  try {
    const dataDir = path.join(tempRoot, "data-projects");
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createApiFixturePayload("src-api-project-a", "Committed API turn A", {
        sessionId: "session-api-project-a",
        turnId: "turn-api-project-a",
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
      createApiFixturePayload("src-api-project-b", "Committed API turn B", {
        sessionId: "session-api-project-b",
        turnId: "turn-api-project-b",
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

    const runtime = await createApiRuntime({ dataDir, storage, sources: [] });

    try {
      const projectsResponse = await runtime.app.inject({ method: "GET", url: "/api/projects" });
      assert.equal(projectsResponse.statusCode, 200);
      const projects = JSON.parse(projectsResponse.body).projects as Array<{
        project_id: string;
        committed_turn_count: number;
        session_count: number;
        link_reason: string;
      }>;
      assert.equal(projects.length, 1);
      assert.equal(projects[0]?.committed_turn_count, 2);
      assert.equal(projects[0]?.session_count, 2);
      assert.equal(projects[0]?.link_reason, "repo_fingerprint_match");

      const turnsResponse = await runtime.app.inject({ method: "GET", url: "/api/turns" });
      assert.equal(turnsResponse.statusCode, 200);
      const turns = JSON.parse(turnsResponse.body).turns as Array<{
        id: string;
        project_id?: string;
        link_state: string;
        lineage?: unknown;
      }>;
      assert.equal(turns.length, 2);
      assert.equal(turns[0]?.link_state, "committed");
      assert.equal(turns[1]?.link_state, "committed");
      assert.equal(turns[0]?.project_id, projects[0]?.project_id);
      assert.equal(turns[1]?.project_id, projects[0]?.project_id);
      assert.equal("lineage" in turns[0]!, false);

      const linkingResponse = await runtime.app.inject({ method: "GET", url: "/api/admin/linking" });
      assert.equal(linkingResponse.statusCode, 200);
      const linkingBody = JSON.parse(linkingResponse.body) as {
        committed_projects: Array<{ project_id: string }>;
        candidate_projects: Array<{ project_id: string }>;
        candidate_turns: Array<{ id: string; lineage?: unknown }>;
        unlinked_turns: Array<{ id: string; lineage?: unknown }>;
      };
      assert.equal(linkingBody.committed_projects.length, 1);
      assert.equal(linkingBody.candidate_projects.length, 0);
      assert.equal(linkingBody.candidate_turns.length, 0);
      assert.equal(linkingBody.unlinked_turns.length, 0);
    } finally {
      await runtime.app.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("search, drift, masks, override, revisions, and replay diff endpoints stay available together", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-"));

  try {
    const source = await seedCodexSourceFixture(tempRoot, "extended");
    const dataDir = path.join(tempRoot, "data-extended");
    const runtime = await createApiRuntime({ dataDir, sources: [source] });

    try {
      const probeResponse = await runtime.app.inject({
        method: "POST",
        url: "/api/admin/probe/runs",
        payload: {
          source_ids: [source.id],
          limit_files_per_source: 1,
          persist: true,
        },
      });
      assert.equal(probeResponse.statusCode, 200);

      const openApiResponse = await runtime.app.inject({ method: "GET", url: "/openapi.json" });
      assert.equal(openApiResponse.statusCode, 200);

      const turnsResponse = await runtime.app.inject({ method: "GET", url: "/api/turns" });
      const turns = JSON.parse(turnsResponse.body).turns as Array<{ id: string; source_id: string }>;
      assert.equal(turns.length, 1);

      const searchResponse = await runtime.app.inject({ method: "GET", url: "/api/turns/search?q=Probe" });
      assert.equal(searchResponse.statusCode, 200);
      const searchBody = JSON.parse(searchResponse.body) as {
        results: Array<{ turn: { id: string; lineage?: unknown } }>;
      };
      assert.equal(searchBody.results.length, 1);
      assert.equal("lineage" in searchBody.results[0]!.turn, false);

      const masksResponse = await runtime.app.inject({ method: "GET", url: "/api/admin/masks" });
      assert.equal(masksResponse.statusCode, 200);
      assert.ok(JSON.parse(masksResponse.body).templates.length >= 1);

      const driftResponse = await runtime.app.inject({ method: "GET", url: "/api/admin/drift" });
      assert.equal(driftResponse.statusCode, 200);
      assert.equal(Array.isArray(JSON.parse(driftResponse.body).timeline), true);

      const overrideResponse = await runtime.app.inject({
        method: "POST",
        url: "/api/admin/linking/overrides",
        payload: {
          target_kind: "turn",
          target_ref: turns[0]!.id,
          display_name: "Extended Manual Project",
        },
      });
      assert.equal(overrideResponse.statusCode, 200);
      const overrideBody = JSON.parse(overrideResponse.body) as {
        override: { project_id: string };
        project?: { project_id: string };
      };
      const projectId = overrideBody.project?.project_id ?? overrideBody.override.project_id;

      const overridesListResponse = await runtime.app.inject({ method: "GET", url: "/api/admin/linking/overrides" });
      assert.equal(overridesListResponse.statusCode, 200);
      assert.equal(JSON.parse(overridesListResponse.body).overrides.length, 1);

      const projectTurnsResponse = await runtime.app.inject({
        method: "GET",
        url: `/api/projects/${encodeURIComponent(projectId)}/turns?state=committed`,
      });
      assert.equal(projectTurnsResponse.statusCode, 200);
      assert.equal(JSON.parse(projectTurnsResponse.body).turns.length, 1);

      const projectRevisionsResponse = await runtime.app.inject({
        method: "GET",
        url: `/api/projects/${encodeURIComponent(projectId)}/revisions`,
      });
      assert.equal(projectRevisionsResponse.statusCode, 200);
      const revisionsBody = JSON.parse(projectRevisionsResponse.body) as {
        revisions: Array<{ project_id: string }>;
        lineage_events: Array<{ project_id: string }>;
      };
      assert.ok(revisionsBody.revisions.length >= 1);
      assert.ok(revisionsBody.lineage_events.length >= 1);

      const replayResponse = await runtime.app.inject({
        method: "POST",
        url: "/api/admin/pipeline/replay",
        payload: {
          source_ids: [source.id],
          limit_files_per_source: 1,
        },
      });
      assert.equal(replayResponse.statusCode, 200);
      const replayBody = JSON.parse(replayResponse.body) as {
        sources: Array<{ diff?: { count_deltas: Record<string, number> } }>;
      };
      assert.ok(replayBody.sources[0]?.diff);
      assert.equal(typeof replayBody.sources[0]?.diff?.count_deltas.turns, "number");
    } finally {
      await runtime.app.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("artifact coverage and candidate lifecycle endpoints expose tombstones after purge", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-"));

  try {
    const source = await seedCodexSourceFixture(tempRoot, "lifecycle");
    const dataDir = path.join(tempRoot, "data-lifecycle");
    const runtime = await createApiRuntime({ dataDir, sources: [source] });

    try {
      await runtime.app.inject({
        method: "POST",
        url: "/api/admin/probe/runs",
        payload: {
          source_ids: [source.id],
          limit_files_per_source: 1,
          persist: true,
        },
      });

      const turnsResponse = await runtime.app.inject({ method: "GET", url: "/api/turns" });
      const turns = JSON.parse(turnsResponse.body).turns as Array<{ id: string }>;
      const turnId = turns[0]!.id;

      const artifactResponse = await runtime.app.inject({
        method: "POST",
        url: "/api/artifacts",
        payload: {
          title: "Lifecycle Artifact",
          summary: "Tracks lifecycle coverage.",
          source_turn_refs: [turnId],
        },
      });
      assert.equal(artifactResponse.statusCode, 200);
      const artifactBody = JSON.parse(artifactResponse.body) as {
        artifact: { artifact_id: string };
        coverage: Array<{ turn_id: string }>;
      };
      assert.equal(artifactBody.coverage.length, 1);
      assert.equal(artifactBody.coverage[0]?.turn_id, turnId);

      const coverageResponse = await runtime.app.inject({
        method: "GET",
        url: `/api/artifacts/${encodeURIComponent(artifactBody.artifact.artifact_id)}/coverage`,
      });
      assert.equal(coverageResponse.statusCode, 200);
      assert.equal(JSON.parse(coverageResponse.body).coverage.length, 1);

      const gcResponse = await runtime.app.inject({
        method: "POST",
        url: "/api/admin/lifecycle/candidate-gc",
        payload: {
          before_iso: "2026-03-10T00:00:00.000Z",
          mode: "purge",
        },
      });
      assert.equal(gcResponse.statusCode, 200);
      assert.equal(JSON.parse(gcResponse.body).processed_turn_ids[0], turnId);

      const purgedTurnResponse = await runtime.app.inject({
        method: "GET",
        url: `/api/turns/${encodeURIComponent(turnId)}`,
      });
      assert.equal(purgedTurnResponse.statusCode, 410);

      const tombstoneResponse = await runtime.app.inject({
        method: "GET",
        url: `/api/tombstones/${encodeURIComponent(turnId)}`,
      });
      assert.equal(tombstoneResponse.statusCode, 200);
      assert.equal(JSON.parse(tombstoneResponse.body).tombstone.logical_id, turnId);
    } finally {
      await runtime.app.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function seedCodexSourceFixture(tempRoot: string, name: string): Promise<SourceDefinition> {
  const sourceDir = path.join(tempRoot, name);
  await mkdir(sourceDir, { recursive: true });

  await writeFile(
    path.join(sourceDir, "session.jsonl"),
    [
      {
        timestamp: "2026-03-09T08:00:00.000Z",
        type: "session_meta",
        payload: {
          id: `${name}-session`,
          cwd: `/workspace/${name}`,
          model: "gpt-5",
        },
      },
      {
        timestamp: "2026-03-09T08:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Probe this session." }],
        },
      },
      {
        timestamp: "2026-03-09T08:00:02.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Probe complete." }],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
    "utf8",
  );

  return {
    id: `src-codex-${name}`,
    family: "local_coding_agent",
    platform: "codex",
    display_name: `Codex ${name}`,
    base_dir: sourceDir,
  };
}

async function countFiles(rootDir: string): Promise<number> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  let total = 0;

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      total += await countFiles(fullPath);
      continue;
    }
    if (entry.isFile()) {
      total += 1;
    }
  }

  return total;
}

interface ApiFixtureOptions {
  sessionId: string;
  turnId: string;
  hostId: string;
  platform: "codex" | "claude_code" | "factory_droid" | "amp";
  workingDirectory: string;
  projectObservation?: {
    workspacePath?: string;
    repoRoot?: string;
    repoRemote?: string;
    repoFingerprint?: string;
  };
}

function createApiFixturePayload(
  sourceId: string,
  canonicalText: string,
  options: ApiFixtureOptions,
): SourceSyncPayload {
  const createdAt = "2026-03-09T08:00:00.000Z";
  const assistantAt = "2026-03-09T08:00:01.000Z";
  const toolCallAt = "2026-03-09T08:00:02.000Z";
  const toolResultAt = "2026-03-09T08:00:03.000Z";
  const blobId = `${options.turnId}-blob`;
  const recordId = `${options.turnId}-record`;
  const userFragmentId = `${options.turnId}-fragment-user`;
  const assistantFragmentId = `${options.turnId}-fragment-assistant`;
  const toolCallFragmentId = `${options.turnId}-fragment-tool-call`;
  const toolResultFragmentId = `${options.turnId}-fragment-tool-result`;
  const userAtomId = `${options.turnId}-atom-user`;
  const assistantAtomId = `${options.turnId}-atom-assistant`;
  const toolCallAtomId = `${options.turnId}-atom-tool-call`;
  const toolResultAtomId = `${options.turnId}-atom-tool-result`;
  const projectObservationCandidateId = `${options.turnId}-candidate-project-observation`;

  return {
    source: {
      id: sourceId,
      family: "local_coding_agent",
      platform: options.platform,
      display_name: canonicalText,
      base_dir: "/tmp/api-fixture",
      host_id: options.hostId,
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
        id: `${options.turnId}-stage-run`,
        source_id: sourceId,
        stage_kind: "finalize_projections",
        parser_version: "fixture-parser@2026-03-09.1",
        parser_capabilities: ["turn_projections", "turn_context_projections", "project_observation_candidates"],
        source_format_profile_ids: [`${options.platform}:fixture:v1`],
        started_at: createdAt,
        finished_at: toolResultAt,
        status: "success",
        stats: { turns: 1, sessions: 1 },
      },
    ],
    loss_audits: [],
    blobs: [
      {
        id: blobId,
        source_id: sourceId,
        host_id: options.hostId,
        origin_path: "/tmp/api-fixture/session.jsonl",
        checksum: "fixture-checksum",
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
        session_ref: options.sessionId,
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
        session_ref: options.sessionId,
        record_id: recordId,
        seq_no: 0,
        fragment_kind: "text",
        actor_kind: "user",
        origin_kind: "user_authored",
        time_key: createdAt,
        payload: { text: canonicalText },
        raw_refs: [recordId],
        source_format_profile_id: `${options.platform}:fixture:v1`,
      },
      {
        id: assistantFragmentId,
        source_id: sourceId,
        session_ref: options.sessionId,
        record_id: recordId,
        seq_no: 1,
        fragment_kind: "text",
        actor_kind: "assistant",
        origin_kind: "assistant_authored",
        time_key: assistantAt,
        payload: { text: "Processing." },
        raw_refs: [recordId],
        source_format_profile_id: `${options.platform}:fixture:v1`,
      },
      {
        id: toolCallFragmentId,
        source_id: sourceId,
        session_ref: options.sessionId,
        record_id: recordId,
        seq_no: 2,
        fragment_kind: "tool_call",
        time_key: toolCallAt,
        payload: { call_id: "call-1", tool_name: "shell", input: {} },
        raw_refs: [recordId],
        source_format_profile_id: `${options.platform}:fixture:v1`,
      },
      {
        id: toolResultFragmentId,
        source_id: sourceId,
        session_ref: options.sessionId,
        record_id: recordId,
        seq_no: 3,
        fragment_kind: "tool_result",
        time_key: toolResultAt,
        payload: { call_id: "call-1", output: "ok" },
        raw_refs: [recordId],
        source_format_profile_id: `${options.platform}:fixture:v1`,
      },
    ],
    atoms: [
      {
        id: userAtomId,
        source_id: sourceId,
        session_ref: options.sessionId,
        seq_no: 0,
        actor_kind: "user",
        origin_kind: "user_authored",
        content_kind: "text",
        time_key: createdAt,
        display_policy: "show",
        payload: { text: canonicalText },
        fragment_refs: [userFragmentId],
        source_format_profile_id: `${options.platform}:fixture:v1`,
      },
      {
        id: assistantAtomId,
        source_id: sourceId,
        session_ref: options.sessionId,
        seq_no: 1,
        actor_kind: "assistant",
        origin_kind: "assistant_authored",
        content_kind: "text",
        time_key: assistantAt,
        display_policy: "show",
        payload: { text: "Processing." },
        fragment_refs: [assistantFragmentId],
        source_format_profile_id: `${options.platform}:fixture:v1`,
      },
      {
        id: toolCallAtomId,
        source_id: sourceId,
        session_ref: options.sessionId,
        seq_no: 2,
        actor_kind: "tool",
        origin_kind: "tool_generated",
        content_kind: "tool_call",
        time_key: toolCallAt,
        display_policy: "show",
        payload: { call_id: "call-1", tool_name: "shell", input: {} },
        fragment_refs: [toolCallFragmentId],
        source_format_profile_id: `${options.platform}:fixture:v1`,
      },
      {
        id: toolResultAtomId,
        source_id: sourceId,
        session_ref: options.sessionId,
        seq_no: 3,
        actor_kind: "tool",
        origin_kind: "tool_generated",
        content_kind: "tool_result",
        time_key: toolResultAt,
        display_policy: "show",
        payload: { call_id: "call-1", output: "ok" },
        fragment_refs: [toolResultFragmentId],
        source_format_profile_id: `${options.platform}:fixture:v1`,
      },
    ],
    edges: [],
    candidates: [
      {
        id: `${options.turnId}-candidate-submission`,
        source_id: sourceId,
        session_ref: options.sessionId,
        candidate_kind: "submission_group",
        input_atom_refs: [userAtomId],
        started_at: createdAt,
        ended_at: createdAt,
        rule_version: "2026-03-09.1",
        evidence: {},
      },
      {
        id: `${options.turnId}-candidate-turn`,
        source_id: sourceId,
        session_ref: options.sessionId,
        candidate_kind: "turn",
        input_atom_refs: [userAtomId],
        started_at: createdAt,
        ended_at: toolResultAt,
        rule_version: "2026-03-09.1",
        evidence: {},
      },
      {
        id: `${options.turnId}-candidate-context`,
        source_id: sourceId,
        session_ref: options.sessionId,
        candidate_kind: "context_span",
        input_atom_refs: [assistantAtomId, toolCallAtomId, toolResultAtomId],
        started_at: createdAt,
        ended_at: toolResultAt,
        rule_version: "2026-03-09.1",
        evidence: {},
      },
      {
        id: projectObservationCandidateId,
        source_id: sourceId,
        session_ref: options.sessionId,
        candidate_kind: "project_observation",
        input_atom_refs: [userAtomId],
        started_at: createdAt,
        ended_at: createdAt,
        rule_version: "2026-03-09.1",
        evidence: {
          workspace_path: options.projectObservation?.workspacePath ?? options.workingDirectory,
          workspace_path_normalized: options.projectObservation?.workspacePath ?? options.workingDirectory,
          repo_root: options.projectObservation?.repoRoot,
          repo_remote: options.projectObservation?.repoRemote,
          repo_fingerprint: options.projectObservation?.repoFingerprint,
          confidence: 0.5,
        },
      },
    ],
    sessions: [
      {
        id: options.sessionId,
        source_id: sourceId,
        source_platform: options.platform,
        host_id: options.hostId,
        title: canonicalText,
        created_at: createdAt,
        updated_at: toolResultAt,
        turn_count: 1,
        model: "gpt-5",
        working_directory: options.workingDirectory,
        sync_axis: "current",
      },
    ],
    turns: [
      {
        id: options.turnId,
        revision_id: `${options.turnId}:r1`,
        user_messages: [
          {
            id: `${options.turnId}-user-message`,
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
        session_id: options.sessionId,
        source_id: sourceId,
        link_state: "unlinked",
        sync_axis: "current",
        value_axis: "active",
        retention_axis: "keep_raw_and_derived",
        context_ref: options.turnId,
        context_summary: {
          assistant_reply_count: 1,
          tool_call_count: 1,
          primary_model: "gpt-5",
          has_errors: false,
        },
        lineage: {
          atom_refs: [userAtomId, assistantAtomId, toolCallAtomId, toolResultAtomId],
          candidate_refs: [
            `${options.turnId}-candidate-submission`,
            `${options.turnId}-candidate-turn`,
            `${options.turnId}-candidate-context`,
            projectObservationCandidateId,
          ],
          fragment_refs: [userFragmentId, assistantFragmentId, toolCallFragmentId, toolResultFragmentId],
          record_refs: [recordId],
          blob_refs: [blobId],
        },
      },
    ],
    contexts: [
      {
        turn_id: options.turnId,
        system_messages: [],
        assistant_replies: [
          {
            id: `${options.turnId}-assistant-reply`,
            content: "Processing.",
            display_segments: [{ type: "text", content: "Processing." }],
            content_preview: "Processing.",
            model: "gpt-5",
            created_at: assistantAt,
            tool_call_ids: [`${options.turnId}-tool-call-projection`],
          },
        ],
        tool_calls: [
          {
            id: `${options.turnId}-tool-call-projection`,
            tool_name: "shell",
            input: {},
            input_summary: "{}",
            input_display_segments: [{ type: "text", content: "{}" }],
            output: "ok",
            output_preview: "ok",
            output_display_segments: [{ type: "text", content: "ok" }],
            status: "success",
            reply_id: `${options.turnId}-assistant-reply`,
            sequence: 0,
            created_at: toolCallAt,
          },
        ],
        raw_event_refs: [recordId],
      },
    ],
  };
}
