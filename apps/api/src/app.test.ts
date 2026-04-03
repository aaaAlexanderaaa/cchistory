import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  deriveHostId,
  deriveSourceInstanceId,
  type SourceDefinition,
  type SourceSyncPayload,
} from "@cchistory/domain";
import { getDefaultSourcesForHost, runSourceProbe } from "@cchistory/source-adapters";
import { CCHistoryStorage } from "@cchistory/storage";
import { createApiRuntime } from "./app.js";

test("runtime defaults to the nearest existing .cchistory directory under the provided cwd", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-"));

  try {
    const homeDir = path.join(tempRoot, "home");
    const projectRoot = path.join(tempRoot, "project-root");
    const apiCwd = path.join(projectRoot, "apps", "api");
    await mkdir(homeDir, { recursive: true });
    await mkdir(path.join(projectRoot, ".cchistory"), { recursive: true });
    await mkdir(apiCwd, { recursive: true });

    const runtime = await createApiRuntime({ cwd: apiCwd, homeDir, sources: [] });
    try {
      assert.equal(runtime.dataDir, path.join(projectRoot, ".cchistory"));
    } finally {
      await runtime.app.close();
      runtime.storage.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runtime falls back to the home .cchistory directory when no ancestor store exists", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-"));

  try {
    const homeDir = path.join(tempRoot, "home");
    const apiCwd = path.join(tempRoot, "workspace", "apps", "api");
    await mkdir(homeDir, { recursive: true });
    await mkdir(apiCwd, { recursive: true });

    const runtime = await createApiRuntime({ cwd: apiCwd, homeDir, sources: [] });
    try {
      assert.equal(runtime.dataDir, path.join(homeDir, ".cchistory"));
      assert.equal(existsSync(runtime.rawStoreDir), true);
    } finally {
      await runtime.app.close();
      runtime.storage.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});


test("runtime honors CCHISTORY_API_DATA_DIR when no explicit dataDir option is provided", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-"));
  const previousDataDir = process.env.CCHISTORY_API_DATA_DIR;

  try {
    const overriddenDataDir = path.join(tempRoot, "seeded-review-store");
    process.env.CCHISTORY_API_DATA_DIR = overriddenDataDir;

    const runtime = await createApiRuntime({ sources: [] });
    try {
      assert.equal(runtime.dataDir, overriddenDataDir);
      assert.equal(existsSync(runtime.rawStoreDir), true);
    } finally {
      await runtime.app.close();
      runtime.storage.close();
    }
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.CCHISTORY_API_DATA_DIR;
    } else {
      process.env.CCHISTORY_API_DATA_DIR = previousDataDir;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runtime bootstraps exactly once when storage is empty and GET routes stay read-only afterwards", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-"));

  try {
    const source = await seedCodexSourceFixture(tempRoot, "bootstrap-once");
    const dataDir = path.join(tempRoot, "data-bootstrap-once");
    let probeCalls = 0;
    const runtime = await createApiRuntime({
      dataDir,
      sources: [source],
      probeRunner: async (...args) => {
        probeCalls += 1;
        return runSourceProbe(...args);
      },
    });

    try {
      assert.equal(probeCalls, 1);

      const turnsResponse = await runtime.app.inject({ method: "GET", url: "/api/turns" });
      assert.equal(turnsResponse.statusCode, 200);
      assert.equal(JSON.parse(turnsResponse.body).turns.length, 1);

      const sourcesResponse = await runtime.app.inject({ method: "GET", url: "/api/sources" });
      assert.equal(sourcesResponse.statusCode, 200);
      assert.equal(JSON.parse(sourcesResponse.body).sources.length, 1);

      assert.equal(probeCalls, 1);
    } finally {
      await runtime.app.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("probe and replay stay read-only when persist is false", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-"));

  try {
    const source = await seedCodexSourceFixture(tempRoot, "readonly");
    const dataDir = path.join(tempRoot, "data-readonly");
    const runtime = await createApiRuntime({ dataDir, sources: [source] });

    try {
      const initialTurnCount = runtime.storage.listTurns().length;
      const initialStageRunCount = runtime.storage.listStageRuns().length;
      const initialRawFileCount = await countFiles(runtime.rawStoreDir);

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
      assert.equal(runtime.storage.listTurns().length, initialTurnCount);
      assert.equal(runtime.storage.listStageRuns().length, initialStageRunCount);
      assert.equal(await countFiles(runtime.rawStoreDir), initialRawFileCount);

      const replayResponse = await runtime.app.inject({
        method: "POST",
        url: "/api/admin/pipeline/replay",
        payload: {
          source_ids: [source.id],
          limit_files_per_source: 1,
        },
      });

      assert.equal(replayResponse.statusCode, 200);
      assert.equal(runtime.storage.listTurns().length, initialTurnCount);
      assert.equal(runtime.storage.listStageRuns().length, initialStageRunCount);
      assert.equal(await countFiles(runtime.rawStoreDir), initialRawFileCount);
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

test("admin pipeline endpoints keep delegated and automation evidence inspectable without canonical turns", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-secondary-evidence-"));

  try {
    const mockDataRoot = getRepoMockDataRoot();
    const hostId = deriveHostId(os.hostname());
    const sources: SourceDefinition[] = [
      {
        id: deriveSourceInstanceId({
          host_id: hostId,
          slot_id: "openclaw",
          base_dir: path.join(mockDataRoot, ".openclaw", "agents"),
        }),
        slot_id: "openclaw",
        family: "local_coding_agent",
        platform: "openclaw",
        display_name: "OpenClaw automation mock",
        base_dir: path.join(mockDataRoot, ".openclaw", "agents"),
      },
      {
        id: deriveSourceInstanceId({
          host_id: hostId,
          slot_id: "claude_code",
          base_dir: path.join(
            mockDataRoot,
            ".claude",
            "projects",
            "-Users-mock-user-workspace-chat-ui-kit",
            "cc1df109-4282-4321-8248-8bbcd471da78",
            "subagents",
          ),
        }),
        slot_id: "claude_code",
        family: "local_coding_agent",
        platform: "claude_code",
        display_name: "Claude delegated mock",
        base_dir: path.join(
          mockDataRoot,
          ".claude",
          "projects",
          "-Users-mock-user-workspace-chat-ui-kit",
          "cc1df109-4282-4321-8248-8bbcd471da78",
          "subagents",
        ),
      },
    ];
    const dataDir = path.join(tempRoot, "data-secondary-evidence");
    const runtime = await createApiRuntime({ dataDir, sources });

    try {
      assert.equal(runtime.storage.listTurns().length, 0);

      const turnsResponse = await runtime.app.inject({ method: "GET", url: "/api/turns" });
      assert.equal(turnsResponse.statusCode, 200);
      assert.equal(JSON.parse(turnsResponse.body).turns.length, 0);

      const atomsResponse = await runtime.app.inject({ method: "GET", url: "/api/admin/pipeline/atoms" });
      assert.equal(atomsResponse.statusCode, 200);
      const atoms = JSON.parse(atomsResponse.body).atoms as Array<{
        source_id: string;
        origin_kind: string;
        payload: { text?: string };
      }>;
      assert.ok(
        atoms.some(
          (atom) =>
            atom.source_id === sources[0]!.id &&
            atom.origin_kind === "automation_trigger" &&
            String(atom.payload.text ?? "").includes("[cron:mock-openclaw-hourly]"),
        ),
      );
      assert.ok(
        atoms.some(
          (atom) =>
            atom.source_id === sources[1]!.id &&
            atom.origin_kind === "delegated_instruction" &&
            String(atom.payload.text ?? "").includes("Search the codebase for all timeout"),
        ),
      );

      const fragmentsResponse = await runtime.app.inject({ method: "GET", url: "/api/admin/pipeline/fragments" });
      assert.equal(fragmentsResponse.statusCode, 200);
      const fragments = JSON.parse(fragmentsResponse.body).fragments as Array<{
        source_id: string;
        fragment_kind: string;
        payload: Record<string, unknown>;
      }>;
      assert.ok(
        fragments.some(
          (fragment) =>
            fragment.source_id === sources[0]!.id &&
            fragment.fragment_kind === "session_relation" &&
            fragment.payload.relation_kind === "automation_run" &&
            fragment.payload.parent_uuid === "11111111-2222-4333-8444-555555555555",
        ),
      );
      assert.ok(
        fragments.some(
          (fragment) =>
            fragment.source_id === sources[1]!.id &&
            fragment.fragment_kind === "session_relation" &&
            fragment.payload.is_sidechain === true,
        ),
      );

      const sessions = runtime.storage.listResolvedSessions();
      const openclawSession = sessions.find((session) => session.source_id === sources[0]!.id);
      const claudeSession = sessions.find((session) => session.source_id === sources[1]!.id);
      assert.ok(openclawSession);
      assert.ok(claudeSession);

      const openclawRelatedWorkResponse = await runtime.app.inject({
        method: "GET",
        url: `/api/admin/sessions/${encodeURIComponent(openclawSession!.id)}/related-work`,
      });
      assert.equal(openclawRelatedWorkResponse.statusCode, 200);
      const openclawRelatedWork = JSON.parse(openclawRelatedWorkResponse.body).related_work as Array<{
        relation_kind: string;
        target_kind: string;
        automation_job_ref?: string;
      }>;
      assert.equal(openclawRelatedWork[0]?.relation_kind, "automation_run");
      assert.equal(openclawRelatedWork[0]?.target_kind, "automation_run");
      assert.equal(openclawRelatedWork[0]?.automation_job_ref, "mock-openclaw-hourly");

      const claudeRelatedWorkResponse = await runtime.app.inject({
        method: "GET",
        url: `/api/admin/sessions/${encodeURIComponent(claudeSession!.id)}/related-work`,
      });
      assert.equal(claudeRelatedWorkResponse.statusCode, 200);
      const claudeRelatedWork = JSON.parse(claudeRelatedWorkResponse.body).related_work as Array<{
        relation_kind: string;
        target_kind: string;
        transcript_primary: boolean;
      }>;
      assert.equal(claudeRelatedWork[0]?.relation_kind, "delegated_session");
      assert.equal(claudeRelatedWork[0]?.target_kind, "session");
      assert.equal(claudeRelatedWork[0]?.transcript_primary, true);
    } finally {
      await runtime.app.close();
      runtime.storage.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("persisted probe does not automatically prune orphan raw blobs", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-"));

  try {
    const source = await seedCodexSourceFixture(tempRoot, "persisted-no-auto-gc");
    const dataDir = path.join(tempRoot, "data-persisted-no-auto-gc");
    const runtime = await createApiRuntime({ dataDir, sources: [source] });

    try {
      const orphanPath = path.join(runtime.rawStoreDir, source.id, "orphan.jsonl");
      await writeFile(orphanPath, "orphan\n", "utf8");
      assert.equal(existsSync(orphanPath), true);

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
      assert.equal(existsSync(orphanPath), true);
      assert.equal(await countFiles(runtime.rawStoreDir), 2);
    } finally {
      await runtime.app.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("source directory overrides persist and drive subsequent syncs", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-"));

  try {
    const source = await seedCodexSourceFixture(tempRoot, "source-config-default", {
      userText: "Default directory turn.",
    });
    const overrideDir = path.join(tempRoot, "source-config-override");
    await writeCodexFixtureDirectory(overrideDir, {
      sessionId: "source-config-override-session",
      userText: "Override directory turn.",
      workingDirectory: "/workspace/source-config-override",
    });

    const dataDir = path.join(tempRoot, "data-source-config");
    const runtime = await createApiRuntime({ dataDir, sources: [source] });

    try {
      const initialConfigResponse = await runtime.app.inject({
        method: "GET",
        url: "/api/admin/source-config",
      });
      assert.equal(initialConfigResponse.statusCode, 200);
      const initialConfig = JSON.parse(initialConfigResponse.body).sources as Array<{
        id: string;
        base_dir: string;
        default_base_dir: string;
        is_overridden: boolean;
        path_exists: boolean;
      }>;
      assert.equal(initialConfig[0]?.id, source.id);
      assert.equal(initialConfig[0]?.base_dir, source.base_dir);
      assert.equal(initialConfig[0]?.default_base_dir, source.base_dir);
      assert.equal(initialConfig[0]?.is_overridden, false);
      assert.equal(initialConfig[0]?.path_exists, true);

      const updateResponse = await runtime.app.inject({
        method: "POST",
        url: `/api/admin/source-config/${encodeURIComponent(source.id)}`,
        payload: {
          base_dir: overrideDir,
          sync: false,
        },
      });
      assert.equal(updateResponse.statusCode, 200);
      const updatedSource = JSON.parse(updateResponse.body).source as {
        base_dir: string;
        default_base_dir: string;
        override_base_dir?: string;
        is_overridden: boolean;
      };
      assert.equal(updatedSource.base_dir, overrideDir);
      assert.equal(updatedSource.default_base_dir, source.base_dir);
      assert.equal(updatedSource.override_base_dir, overrideDir);
      assert.equal(updatedSource.is_overridden, true);

      const overridesFile = JSON.parse(await readFile(path.join(dataDir, "source-overrides.json"), "utf8")) as {
        overrides: Record<string, { base_dir: string }>;
      };
      assert.equal(overridesFile.overrides[source.id]?.base_dir, overrideDir);
    } finally {
      await runtime.app.close();
    }

    const restartedRuntime = await createApiRuntime({ dataDir, sources: [source] });

    try {
      const configResponse = await restartedRuntime.app.inject({
        method: "GET",
        url: "/api/admin/source-config",
      });
      assert.equal(configResponse.statusCode, 200);
      const configuredSource = JSON.parse(configResponse.body).sources[0] as {
        base_dir: string;
        default_base_dir: string;
        override_base_dir?: string;
        is_overridden: boolean;
      };
      assert.equal(configuredSource.base_dir, overrideDir);
      assert.equal(configuredSource.default_base_dir, source.base_dir);
      assert.equal(configuredSource.override_base_dir, overrideDir);
      assert.equal(configuredSource.is_overridden, true);

      const turnsResponse = await restartedRuntime.app.inject({ method: "GET", url: "/api/turns" });
      assert.equal(turnsResponse.statusCode, 200);
      const turns = JSON.parse(turnsResponse.body).turns as Array<{ canonical_text: string }>;
      assert.equal(turns.length, 1);
      assert.equal(turns[0]?.canonical_text, "Default directory turn.");

      const sourcesResponse = await restartedRuntime.app.inject({ method: "GET", url: "/api/sources" });
      assert.equal(sourcesResponse.statusCode, 200);
      const sources = JSON.parse(sourcesResponse.body).sources as Array<{
        base_dir: string;
        default_base_dir: string;
        is_overridden: boolean;
        sync_status: string;
      }>;
      assert.equal(sources[0]?.base_dir, overrideDir);
      assert.equal(sources[0]?.default_base_dir, source.base_dir);
      assert.equal(sources[0]?.is_overridden, true);
      assert.equal(sources[0]?.sync_status, "stale");

      const resetResponse = await restartedRuntime.app.inject({
        method: "POST",
        url: `/api/admin/source-config/${encodeURIComponent(source.id)}/reset`,
        payload: {
          sync: true,
        },
      });
      assert.equal(resetResponse.statusCode, 200);
      const resetSource = JSON.parse(resetResponse.body).source as {
        base_dir: string;
        default_base_dir: string;
        override_base_dir?: string;
        is_overridden: boolean;
      };
      assert.equal(resetSource.base_dir, source.base_dir);
      assert.equal(resetSource.default_base_dir, source.base_dir);
      assert.equal(resetSource.override_base_dir, undefined);
      assert.equal(resetSource.is_overridden, false);

      const resetTurnsResponse = await restartedRuntime.app.inject({ method: "GET", url: "/api/turns" });
      assert.equal(resetTurnsResponse.statusCode, 200);
      const resetTurns = JSON.parse(resetTurnsResponse.body).turns as Array<{ canonical_text: string }>;
      assert.equal(resetTurns.length, 1);
      assert.equal(resetTurns[0]?.canonical_text, "Default directory turn.");
    } finally {
      await restartedRuntime.app.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("manual source instances can be added alongside the default source for the same platform", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-"));

  try {
    const source = await seedCodexSourceFixture(tempRoot, "manual-source-default", {
      userText: "Default Codex source turn.",
    });
    const extraDir = path.join(tempRoot, "manual-source-extra");
    await writeCodexFixtureDirectory(extraDir, {
      sessionId: "manual-source-extra-session",
      userText: "Manual Codex source turn.",
      workingDirectory: "/workspace/manual-source-extra",
    });

    const dataDir = path.join(tempRoot, "data-manual-source");
    const runtime = await createApiRuntime({ dataDir, sources: [source] });

    try {
      const createResponse = await runtime.app.inject({
        method: "POST",
        url: "/api/admin/source-config",
        payload: {
          platform: "codex",
          base_dir: extraDir,
          sync: true,
        },
      });
      assert.equal(createResponse.statusCode, 200);
      const createdSource = JSON.parse(createResponse.body).source as {
        id: string;
        base_dir: string;
        is_default_source: boolean;
      };
      assert.equal(createdSource.base_dir, extraDir);
      assert.equal(createdSource.is_default_source, false);

      const sourcesResponse = await runtime.app.inject({ method: "GET", url: "/api/sources" });
      assert.equal(sourcesResponse.statusCode, 200);
      const sources = JSON.parse(sourcesResponse.body).sources as Array<{
        id: string;
        base_dir: string;
        is_default_source: boolean;
      }>;
      assert.equal(sources.length, 2);
      assert.ok(sources.some((configuredSource) => configuredSource.id === source.id && configuredSource.is_default_source));
      assert.ok(
        sources.some(
          (configuredSource) => configuredSource.id === createdSource.id && configuredSource.base_dir === extraDir,
        ),
      );

      const turnsResponse = await runtime.app.inject({ method: "GET", url: "/api/turns" });
      assert.equal(turnsResponse.statusCode, 200);
      const turns = JSON.parse(turnsResponse.body).turns as Array<{ canonical_text: string }>;
      assert.ok(turns.some((turn) => turn.canonical_text === "Default Codex source turn."));
      assert.ok(turns.some((turn) => turn.canonical_text === "Manual Codex source turn."));
    } finally {
      await runtime.app.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("configured directory changes stay stale until an explicit sync runs", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-"));

  try {
    const validSource = await seedCodexSourceFixture(tempRoot, "startup-refresh", {
      userText: "Startup refresh turn.",
    });
    const staleSource = {
      ...validSource,
      base_dir: path.join(tempRoot, "missing-source-dir"),
    };
    const dataDir = path.join(tempRoot, "data-startup-refresh");

    const staleRuntime = await createApiRuntime({ dataDir, sources: [staleSource] });

    try {
      const staleProbeResponse = await staleRuntime.app.inject({
        method: "POST",
        url: "/api/admin/probe/runs",
        payload: {
          source_ids: [staleSource.id],
          persist: true,
        },
      });
      assert.equal(staleProbeResponse.statusCode, 200);

      const staleSources = staleRuntime.storage.listSources();
      assert.equal(staleSources[0]?.base_dir, staleSource.base_dir);
      assert.equal(staleSources[0]?.sync_status, "error");
      assert.equal(staleSources[0]?.total_turns, 0);
    } finally {
      await staleRuntime.app.close();
    }

    let probeCalls = 0;
    const refreshedRuntime = await createApiRuntime({
      dataDir,
      sources: [validSource],
      probeRunner: async (...args) => {
        probeCalls += 1;
        return runSourceProbe(...args);
      },
    });

    try {
      const refreshedSources = refreshedRuntime.storage.listSources();
      assert.equal(probeCalls, 0);
      assert.equal(refreshedSources[0]?.base_dir, staleSource.base_dir);
      assert.equal(refreshedSources[0]?.sync_status, "error");
      assert.equal(refreshedSources[0]?.total_turns, 0);

      const sourcesResponse = await refreshedRuntime.app.inject({ method: "GET", url: "/api/sources" });
      assert.equal(sourcesResponse.statusCode, 200);
      const sources = JSON.parse(sourcesResponse.body).sources as Array<{
        base_dir: string;
        sync_status: string;
        total_turns: number;
      }>;
      assert.equal(sources[0]?.base_dir, validSource.base_dir);
      assert.equal(sources[0]?.sync_status, "stale");
      assert.equal(sources[0]?.total_turns, 0);

      const turnsResponse = await refreshedRuntime.app.inject({ method: "GET", url: "/api/turns" });
      assert.equal(turnsResponse.statusCode, 200);
      const turns = JSON.parse(turnsResponse.body).turns as Array<{ canonical_text: string }>;
      assert.equal(turns.length, 0);
      assert.equal(probeCalls, 0);
    } finally {
      await refreshedRuntime.app.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("stored default sources remain editable when discovery no longer finds their default path", async () => {
  const missingDefaultSource = getDefaultSourcesForHost({ includeMissing: true }).find(
    (source) => !existsSync(source.base_dir),
  );
  if (!missingDefaultSource) {
    return;
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-"));

  try {
    const dataDir = path.join(tempRoot, "data-missing-default-source");
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createStoredSourcePayload(missingDefaultSource, path.join(tempRoot, "previous-source-dir")),
    );

    const runtime = await createApiRuntime({ dataDir, storage });

    try {
      const sourcesResponse = await runtime.app.inject({ method: "GET", url: "/api/sources" });
      assert.equal(sourcesResponse.statusCode, 200);
      const listedSource = (JSON.parse(sourcesResponse.body).sources as Array<{
        id: string;
        base_dir: string;
        default_base_dir?: string;
        is_default_source: boolean;
        path_exists: boolean;
        total_turns: number;
      }>).find((source) => source.id === missingDefaultSource.id);
      assert.equal(listedSource?.is_default_source, true);
      assert.equal(listedSource?.default_base_dir, missingDefaultSource.base_dir);
      assert.equal(listedSource?.base_dir, missingDefaultSource.base_dir);
      assert.equal(listedSource?.path_exists, false);
      assert.equal(listedSource?.total_turns, 1);

      const repairedDir = path.join(tempRoot, "repaired-source-dir");
      await mkdir(repairedDir, { recursive: true });

      const updateResponse = await runtime.app.inject({
        method: "POST",
        url: `/api/admin/source-config/${encodeURIComponent(missingDefaultSource.id)}`,
        payload: {
          base_dir: repairedDir,
          sync: false,
        },
      });
      assert.equal(updateResponse.statusCode, 200);
      const updatedSource = JSON.parse(updateResponse.body).source as {
        base_dir: string;
        default_base_dir?: string;
        override_base_dir?: string;
        is_default_source: boolean;
        is_overridden: boolean;
        path_exists: boolean;
      };
      assert.equal(updatedSource.base_dir, repairedDir);
      assert.equal(updatedSource.default_base_dir, missingDefaultSource.base_dir);
      assert.equal(updatedSource.override_base_dir, repairedDir);
      assert.equal(updatedSource.is_default_source, true);
      assert.equal(updatedSource.is_overridden, true);
      assert.equal(updatedSource.path_exists, true);
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

test("project delete endpoint purges the project and preserves unrelated projects", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-"));

  try {
    const dataDir = path.join(tempRoot, "data-project-delete");
    const storage = new CCHistoryStorage(dataDir);
    storage.replaceSourcePayload(
      createApiFixturePayload("source-project-delete-a", "Delete via API", {
        sessionId: "session-project-delete-a",
        turnId: "turn-project-delete-a",
        hostId: "host-project-delete",
        platform: "codex",
        workingDirectory: "/workspace/project-delete-a",
        projectObservation: {
          workspacePath: "/workspace/project-delete-a",
          repoRoot: "/workspace/project-delete-a",
          repoRemote: "https://github.com/test/project-delete",
          repoFingerprint: "fp-project-delete-shared",
        },
      }),
    );
    storage.replaceSourcePayload(
      createApiFixturePayload("source-project-delete-a2", "Delete via API again", {
        sessionId: "session-project-delete-a2",
        turnId: "turn-project-delete-a2",
        hostId: "host-project-delete-2",
        platform: "claude_code",
        workingDirectory: "/projects/project-delete-a",
        projectObservation: {
          workspacePath: "/projects/project-delete-a",
          repoRoot: "/projects/project-delete-a",
          repoRemote: "https://github.com/test/project-delete-renamed",
          repoFingerprint: "fp-project-delete-shared",
        },
      }),
    );
    storage.replaceSourcePayload(
      createApiFixturePayload("source-project-keep", "Keep via API", {
        sessionId: "session-project-keep",
        turnId: "turn-project-keep",
        hostId: "host-project-keep",
        platform: "codex",
        workingDirectory: "/workspace/project-keep",
        projectObservation: {
          workspacePath: "/workspace/project-keep",
          repoRoot: "/workspace/project-keep",
          repoRemote: "https://github.com/test/project-keep",
          repoFingerprint: "fp-project-keep",
        },
      }),
    );
    const runtime = await createApiRuntime({ dataDir, storage, sources: [] });

    try {
      const projectToDelete = runtime.storage
        .listProjects()
        .find((project) =>
          runtime.storage
            .listProjectTurns(project.project_id, "all")
            .some((turn) => turn.id === "turn-project-delete-a"),
        );
      assert.ok(projectToDelete, "project to delete should exist");
      const preservedProject = runtime.storage
        .listProjects()
        .find((project) =>
          runtime.storage
            .listProjectTurns(project.project_id, "all")
            .some((turn) => turn.id === "turn-project-keep"),
        );
      assert.ok(preservedProject, "preserved project should exist");

      const deleteResponse = await runtime.app.inject({
        method: "POST",
        url: `/api/admin/projects/${encodeURIComponent(projectToDelete.project_id)}/delete`,
        payload: {
          reason: "api_test_delete_project",
        },
      });
      assert.equal(deleteResponse.statusCode, 200);
      const deleteBody = JSON.parse(deleteResponse.body) as {
        project_id: string;
        deleted_turn_ids: string[];
        deleted_session_ids: string[];
        tombstones: Array<{ logical_id: string; object_kind: string; purge_reason?: string }>;
      };
      assert.equal(deleteBody.project_id, projectToDelete.project_id);
      assert.deepEqual(deleteBody.deleted_turn_ids, ["turn-project-delete-a", "turn-project-delete-a2"]);
      assert.deepEqual(deleteBody.deleted_session_ids, ["session-project-delete-a", "session-project-delete-a2"]);
      assert.equal(
        deleteBody.tombstones.some(
          (tombstone) =>
            tombstone.logical_id === projectToDelete.project_id &&
            tombstone.object_kind === "project" &&
            tombstone.purge_reason === "api_test_delete_project",
        ),
        true,
      );

      const deletedProjectResponse = await runtime.app.inject({
        method: "GET",
        url: `/api/projects/${encodeURIComponent(projectToDelete.project_id)}`,
      });
      assert.equal(deletedProjectResponse.statusCode, 410);
      assert.equal(JSON.parse(deletedProjectResponse.body).tombstone.logical_id, projectToDelete.project_id);

      const preservedProjectResponse = await runtime.app.inject({
        method: "GET",
        url: `/api/projects/${encodeURIComponent(preservedProject.project_id)}`,
      });
      assert.equal(preservedProjectResponse.statusCode, 200);
      assert.equal(JSON.parse(preservedProjectResponse.body).project.project_id, preservedProject.project_id);

      const turnsResponse = await runtime.app.inject({ method: "GET", url: "/api/turns" });
      assert.equal(turnsResponse.statusCode, 200);
      const turns = JSON.parse(turnsResponse.body).turns as Array<{ id: string }>;
      assert.deepEqual(turns.map((turn) => turn.id), ["turn-project-keep"]);
    } finally {
      await runtime.app.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("remote agent pair and upload import one bundle and reject stale generations", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-"));

  try {
    const source = await seedCodexSourceFixture(tempRoot, "remote-agent-upload", {
      userText: "Remote agent upload turn.",
    });
    const dataDir = path.join(tempRoot, "data-remote-agent-upload");
    const runtime = await createApiRuntime({ dataDir, sources: [], agentPairingToken: "pair-secret" });

    try {
      const pairResponse = await runtime.app.inject({
        method: "POST",
        url: "/api/agent/pair",
        payload: {
          pairing_token: "pair-secret",
          display_name: "Remote Test Host",
          reported_hostname: "remote-host-a",
        },
      });
      assert.equal(pairResponse.statusCode, 200);
      const paired = JSON.parse(pairResponse.body) as { agent_id: string; agent_token: string };

      const probe = await runSourceProbe({ source_ids: [source.id], limit_files_per_source: 10 }, [source]);
      const payload = probe.sources[0]!;
      const bundle = buildRemoteUploadBundleFromPayload(payload);
      const uploadResponse = await runtime.app.inject({
          method: "POST",
          url: "/api/agent/uploads",
          payload: {
            agent_id: paired.agent_id,
            agent_token: paired.agent_token,
            collected_at: payload.source.last_sync,
            bundle,
            source_manifest: [
              {
                source_id: payload.source.id,
                slot_id: payload.source.slot_id,
                platform: payload.source.platform,
                display_name: payload.source.display_name,
                base_dir: payload.source.base_dir,
                sync_status: payload.source.sync_status,
                presence: "present",
                total_turns: payload.turns.length,
                payload_checksum: bundle.checksums.payload_sha256_by_source_id[payload.source.id],
                generation: 1,
                included_in_bundle: true,
              },
            ],
          },
        });
        assert.equal(uploadResponse.statusCode, 200, uploadResponse.body);
        const uploadBody = JSON.parse(uploadResponse.body) as { imported_source_ids: string[] };
        assert.deepEqual(uploadBody.imported_source_ids, [payload.source.id]);

        const turnsResponse = await runtime.app.inject({ method: "GET", url: "/api/turns" });
        assert.equal(turnsResponse.statusCode, 200);
        const turns = JSON.parse(turnsResponse.body).turns as Array<{ canonical_text: string }>;
        assert.equal(turns.length, 1);
        assert.equal(turns[0]?.canonical_text, "Remote agent upload turn.");

      const staleResponse = await runtime.app.inject({
          method: "POST",
          url: "/api/agent/uploads",
          payload: {
            agent_id: paired.agent_id,
            agent_token: paired.agent_token,
            collected_at: payload.source.last_sync,
            bundle,
            source_manifest: [
              {
                source_id: payload.source.id,
                slot_id: payload.source.slot_id,
                platform: payload.source.platform,
                display_name: payload.source.display_name,
                base_dir: payload.source.base_dir,
                sync_status: payload.source.sync_status,
                presence: "present",
                total_turns: payload.turns.length,
                payload_checksum: bundle.checksums.payload_sha256_by_source_id[payload.source.id],
                generation: 1,
                included_in_bundle: true,
              },
            ],
          },
        });
      assert.equal(staleResponse.statusCode, 409);
    } finally {
      await runtime.app.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});


test("remote agent heartbeat and admin inventory surfaces persist labels and source manifests", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-"));

  try {
    const dataDir = path.join(tempRoot, "data-remote-agent-inventory");
    const runtime = await createApiRuntime({ dataDir, sources: [], agentPairingToken: "pair-secret" });

    try {
      const pairResponse = await runtime.app.inject({
        method: "POST",
        url: "/api/agent/pair",
        payload: {
          pairing_token: "pair-secret",
          display_name: "Inventory Host",
          reported_hostname: "inventory-host-a",
        },
      });
      assert.equal(pairResponse.statusCode, 200);
      const paired = JSON.parse(pairResponse.body) as { agent_id: string; agent_token: string };

      const heartbeatResponse = await runtime.app.inject({
        method: "POST",
        url: "/api/agent/heartbeat",
        payload: {
          agent_id: paired.agent_id,
          agent_token: paired.agent_token,
          labels: ["office", "macbook", "office"],
          source_manifest: [
            {
              source_id: "src-remote-codex",
              slot_id: "codex",
              platform: "codex",
              display_name: "Codex",
              base_dir: "/remote/.codex/sessions",
              sync_status: "healthy",
              presence: "present",
              total_turns: 3,
              payload_checksum: "abc123",
              generation: 1,
              included_in_bundle: false,
            },
          ],
        },
      });
      assert.equal(heartbeatResponse.statusCode, 200, heartbeatResponse.body);
      const heartbeatBody = JSON.parse(heartbeatResponse.body) as { source_manifest_count: number; last_seen_at: string };
      assert.equal(heartbeatBody.source_manifest_count, 1);
      assert.equal(typeof heartbeatBody.last_seen_at, "string");

      const agentsResponse = await runtime.app.inject({ method: "GET", url: "/api/admin/agents" });
      assert.equal(agentsResponse.statusCode, 200);
      const agents = JSON.parse(agentsResponse.body).agents as Array<{
        agent_id: string;
        display_name?: string;
        reported_hostname?: string;
        labels: string[];
        source_manifest: Array<{ source_id: string; total_turns: number }>;
      }>;
      assert.equal(agents.length, 1);
      assert.equal(agents[0]?.agent_id, paired.agent_id);
      assert.equal(agents[0]?.display_name, "Inventory Host");
      assert.equal(agents[0]?.reported_hostname, "inventory-host-a");
      assert.deepEqual(agents[0]?.labels, ["macbook", "office"]);
      assert.deepEqual(agents[0]?.source_manifest.map((entry) => entry.source_id), ["src-remote-codex"]);
      assert.equal(agents[0]?.source_manifest[0]?.total_turns, 3);

      const updateResponse = await runtime.app.inject({
        method: "POST",
        url: `/api/admin/agents/${encodeURIComponent(paired.agent_id)}/labels`,
        payload: {
          display_name: "Inventory Host Renamed",
          labels: ["lab", "office"],
        },
      });
      assert.equal(updateResponse.statusCode, 200);
      const updatedAgent = JSON.parse(updateResponse.body).agent as { display_name?: string; labels: string[] };
      assert.equal(updatedAgent.display_name, "Inventory Host Renamed");
      assert.deepEqual(updatedAgent.labels, ["lab", "office"]);

      const restartedRuntime = await createApiRuntime({ dataDir, sources: [], agentPairingToken: "pair-secret" });
      try {
        const restartedAgentsResponse = await restartedRuntime.app.inject({ method: "GET", url: "/api/admin/agents" });
        assert.equal(restartedAgentsResponse.statusCode, 200);
        const restartedAgents = JSON.parse(restartedAgentsResponse.body).agents as Array<{ display_name?: string; labels: string[] }>;
        assert.equal(restartedAgents[0]?.display_name, "Inventory Host Renamed");
        assert.deepEqual(restartedAgents[0]?.labels, ["lab", "office"]);
      } finally {
        await restartedRuntime.app.close();
      }
    } finally {
      await runtime.app.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});


test("remote agent jobs support targeted leasing, upload linkage, and completion status", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-"));

  try {
    const source = await seedCodexSourceFixture(tempRoot, "remote-agent-job", {
      userText: "Remote agent leased job turn.",
    });
    const dataDir = path.join(tempRoot, "data-remote-agent-jobs");
    const runtime = await createApiRuntime({ dataDir, sources: [], agentPairingToken: "pair-secret" });

    try {
      const officePair = await runtime.app.inject({
        method: "POST",
        url: "/api/agent/pair",
        payload: {
          pairing_token: "pair-secret",
          display_name: "Office Host",
          reported_hostname: "office-host",
        },
      });
      assert.equal(officePair.statusCode, 200, officePair.body);
      const officeAgent = JSON.parse(officePair.body) as { agent_id: string; agent_token: string };

      const labPair = await runtime.app.inject({
        method: "POST",
        url: "/api/agent/pair",
        payload: {
          pairing_token: "pair-secret",
          display_name: "Lab Host",
          reported_hostname: "lab-host",
        },
      });
      assert.equal(labPair.statusCode, 200, labPair.body);
      const labAgent = JSON.parse(labPair.body) as { agent_id: string; agent_token: string };

      assert.equal((await runtime.app.inject({
        method: "POST",
        url: "/api/agent/heartbeat",
        payload: {
          agent_id: officeAgent.agent_id,
          agent_token: officeAgent.agent_token,
          labels: ["office"],
        },
      })).statusCode, 200);
      assert.equal((await runtime.app.inject({
        method: "POST",
        url: "/api/agent/heartbeat",
        payload: {
          agent_id: labAgent.agent_id,
          agent_token: labAgent.agent_token,
          labels: ["lab"],
        },
      })).statusCode, 200);

      const createResponse = await runtime.app.inject({
        method: "POST",
        url: "/api/admin/agent-jobs",
        payload: {
          selector: { kind: "labels", labels: ["office"] },
          source_slots: ["codex"],
          sync_mode: "dirty_snapshot",
          lease_duration_seconds: 300,
        },
      });
      assert.equal(createResponse.statusCode, 200, createResponse.body);
      const createdJob = JSON.parse(createResponse.body).job as {
        job_id: string;
        matched_agent_ids: string[];
        status: string;
      };
      assert.equal(createdJob.status, "pending");
      assert.deepEqual(createdJob.matched_agent_ids, [officeAgent.agent_id]);

      const labLeaseResponse = await runtime.app.inject({
        method: "POST",
        url: "/api/agent/jobs/lease",
        payload: {
          agent_id: labAgent.agent_id,
          agent_token: labAgent.agent_token,
        },
      });
      assert.equal(labLeaseResponse.statusCode, 200, labLeaseResponse.body);
      assert.equal(JSON.parse(labLeaseResponse.body).job, undefined);

      const officeLeaseResponse = await runtime.app.inject({
        method: "POST",
        url: "/api/agent/jobs/lease",
        payload: {
          agent_id: officeAgent.agent_id,
          agent_token: officeAgent.agent_token,
        },
      });
      assert.equal(officeLeaseResponse.statusCode, 200, officeLeaseResponse.body);
      const leasedJob = JSON.parse(officeLeaseResponse.body).job as { job_id: string; source_slots: string[] };
      assert.equal(leasedJob.job_id, createdJob.job_id);
      assert.deepEqual(leasedJob.source_slots, ["codex"]);

      const probe = await runSourceProbe({ source_ids: [source.id], limit_files_per_source: 10 }, [source]);
      const payload = probe.sources[0]!;
      const bundle = buildRemoteUploadBundleFromPayload(payload);
      const uploadResponse = await runtime.app.inject({
        method: "POST",
        url: "/api/agent/uploads",
        payload: {
          agent_id: officeAgent.agent_id,
          agent_token: officeAgent.agent_token,
          job_id: createdJob.job_id,
          collected_at: payload.source.last_sync,
          bundle,
          source_manifest: [
            {
              source_id: payload.source.id,
              slot_id: payload.source.slot_id,
              platform: payload.source.platform,
              display_name: payload.source.display_name,
              base_dir: payload.source.base_dir,
              sync_status: payload.source.sync_status,
              presence: "present",
              total_turns: payload.turns.length,
              payload_checksum: bundle.checksums.payload_sha256_by_source_id[payload.source.id],
              generation: 1,
              included_in_bundle: true,
            },
          ],
        },
      });
      assert.equal(uploadResponse.statusCode, 200, uploadResponse.body);
      const uploadBody = JSON.parse(uploadResponse.body) as { bundle_id: string; imported_source_ids: string[] };
      assert.deepEqual(uploadBody.imported_source_ids, [payload.source.id]);

      const completeSuccessResponse = await runtime.app.inject({
        method: "POST",
        url: `/api/agent/jobs/${encodeURIComponent(createdJob.job_id)}/complete`,
        payload: {
          agent_id: officeAgent.agent_id,
          agent_token: officeAgent.agent_token,
          status: "succeeded",
          bundle_id: uploadBody.bundle_id,
          imported_source_ids: uploadBody.imported_source_ids,
        },
      });
      assert.equal(completeSuccessResponse.statusCode, 200, completeSuccessResponse.body);

      const failedCreateResponse = await runtime.app.inject({
        method: "POST",
        url: "/api/admin/agent-jobs",
        payload: {
          selector: { kind: "agent_ids", agent_ids: [officeAgent.agent_id] },
          source_slots: "all",
          sync_mode: "force_snapshot",
          lease_duration_seconds: 300,
        },
      });
      assert.equal(failedCreateResponse.statusCode, 200, failedCreateResponse.body);
      const failedJobId = JSON.parse(failedCreateResponse.body).job.job_id as string;

      const failedLeaseResponse = await runtime.app.inject({
        method: "POST",
        url: "/api/agent/jobs/lease",
        payload: {
          agent_id: officeAgent.agent_id,
          agent_token: officeAgent.agent_token,
        },
      });
      assert.equal(failedLeaseResponse.statusCode, 200, failedLeaseResponse.body);
      assert.equal(JSON.parse(failedLeaseResponse.body).job.job_id, failedJobId);

      const completeFailureResponse = await runtime.app.inject({
        method: "POST",
        url: `/api/agent/jobs/${encodeURIComponent(failedJobId)}/complete`,
        payload: {
          agent_id: officeAgent.agent_id,
          agent_token: officeAgent.agent_token,
          status: "failed",
          error_message: "simulated collection failure",
        },
      });
      assert.equal(completeFailureResponse.statusCode, 200, completeFailureResponse.body);

      const jobsResponse = await runtime.app.inject({ method: "GET", url: "/api/admin/agent-jobs" });
      assert.equal(jobsResponse.statusCode, 200, jobsResponse.body);
      const jobs = JSON.parse(jobsResponse.body).jobs as Array<{
        job_id: string;
        status: string;
        agent_statuses: Array<{ agent_id: string; status: string; bundle_id?: string; error_message?: string }>;
      }>;
      const succeededJob = jobs.find((job) => job.job_id === createdJob.job_id);
      const failedJob = jobs.find((job) => job.job_id === failedJobId);
      assert.equal(succeededJob?.status, "succeeded");
      assert.equal(succeededJob?.agent_statuses[0]?.bundle_id, uploadBody.bundle_id);
      assert.equal(failedJob?.status, "failed");
      assert.equal(failedJob?.agent_statuses[0]?.error_message, "simulated collection failure");
    } finally {
      await runtime.app.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});


function buildRemoteUploadBundleFromPayload(payload: SourceSyncPayload): {
  manifest: {
    bundle_id: string;
    bundle_version: string;
    exported_at: string;
    exported_from_host_ids: string[];
    schema_version: string;
    source_instance_ids: string[];
    counts: { sources: number; sessions: number; turns: number; blobs: number };
    includes_raw_blobs: boolean;
    created_by: string;
  };
  checksums: {
    manifest_sha256: string;
    payload_sha256_by_source_id: Record<string, string>;
    raw_sha256_by_path: Record<string, string>;
  };
  payloads: SourceSyncPayload[];
  raw_blobs_base64_by_path: Record<string, string>;
} {
  const serializedPayload: SourceSyncPayload = {
    ...payload,
    blobs: payload.blobs.map((blob) => ({
      ...blob,
      captured_path: undefined,
    })),
  };
  const manifest = {
    bundle_id: `bundle-test-${payload.source.id}`,
    bundle_version: "cchistory.bundle.v1",
    exported_at: payload.source.last_sync ?? new Date().toISOString(),
    exported_from_host_ids: [payload.source.host_id],
    schema_version: "2026-03-14.1",
    source_instance_ids: [payload.source.id],
    counts: {
      sources: 1,
      sessions: payload.sessions.length,
      turns: payload.turns.length,
      blobs: payload.blobs.length,
    },
    includes_raw_blobs: false,
    created_by: "api-test",
  };
  return {
    manifest,
    checksums: {
      manifest_sha256: sha256(JSON.stringify(manifest, null, 2)),
      payload_sha256_by_source_id: {
        [payload.source.id]: sha256(JSON.stringify(serializedPayload)),
      },
      raw_sha256_by_path: {},
    },
    payloads: [serializedPayload],
    raw_blobs_base64_by_path: {},
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}


function getRepoMockDataRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../mock_data");
}

async function seedCodexSourceFixture(
  tempRoot: string,
  name: string,
  options: { userText?: string } = {},
): Promise<SourceDefinition> {
  const sourceDir = path.join(tempRoot, name);
  const slotId = "codex";
  await writeCodexFixtureDirectory(sourceDir, {
    sessionId: `${name}-session`,
    userText: options.userText ?? "Probe this session.",
    workingDirectory: `/workspace/${name}`,
  });

  return {
    id: deriveSourceInstanceId({
      host_id: deriveHostId(os.hostname()),
      slot_id: slotId,
      base_dir: sourceDir,
    }),
    slot_id: slotId,
    family: "local_coding_agent",
    platform: "codex",
    display_name: `Codex ${name}`,
    base_dir: sourceDir,
  };
}

async function writeCodexFixtureDirectory(
  sourceDir: string,
  options: { sessionId: string; userText: string; workingDirectory: string },
): Promise<void> {
  await mkdir(sourceDir, { recursive: true });

  await writeFile(
    path.join(sourceDir, "session.jsonl"),
    [
      {
        timestamp: "2026-03-09T08:00:00.000Z",
        type: "session_meta",
        payload: {
          id: options.sessionId,
          cwd: options.workingDirectory,
          model: "gpt-5",
        },
      },
      {
        timestamp: "2026-03-09T08:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: options.userText }],
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
}

function createStoredSourcePayload(source: SourceDefinition, baseDir: string): SourceSyncPayload {
  return {
    source: {
      id: source.id,
      slot_id: source.slot_id,
      family: source.family,
      platform: source.platform,
      display_name: source.display_name,
      base_dir: baseDir,
      host_id: "host-stored-source",
      last_sync: "2026-03-09T08:00:00.000Z",
      sync_status: "healthy",
      total_blobs: 1,
      total_records: 1,
      total_fragments: 1,
      total_atoms: 1,
      total_sessions: 1,
      total_turns: 1,
    },
    stage_runs: [],
    loss_audits: [],
    blobs: [],
    records: [],
    fragments: [],
    atoms: [],
    edges: [],
    candidates: [],
    sessions: [],
    turns: [],
    contexts: [],
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
      slot_id: options.platform,
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
