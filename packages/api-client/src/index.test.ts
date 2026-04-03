import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { deriveHostId, deriveSourceInstanceId, type SourceDefinition } from "../../../packages/domain/dist/index.js";
import { createApiRuntime } from "../../../apps/api/dist/app.js";
import { CCHistoryApiError, createCCHistoryApiClient } from "./index.js";

const TEST_BASE_URL = "http://cchistory.test";

test("api-client traverses the canonical projects-search-context read chain against an in-process runtime", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-client-"));

  try {
    const source = await seedCodexSourceFixture(tempRoot, "api-client-managed-read", {
      userText: "Trace the managed API client route chain.",
    });
    const dataDir = path.join(tempRoot, "data-api-client-managed-read");
    const runtime = await createApiRuntime({ dataDir, sources: [source] });

    try {
      const client = createCCHistoryApiClient({
        baseUrl: TEST_BASE_URL,
        fetch: createInjectedFetch(runtime.app),
      });

      const projects = await client.getProjects("all");
      assert.equal(projects.length, 1);
      assert.equal(projects[0]?.display_name, "api-client-managed-read");

      const results = await client.searchTurns({ q: "managed API client route chain" });
      assert.equal(results.length, 1);
      assert.equal(results[0]?.turn.project_id, projects[0]?.project_id);
      assert.match(results[0]?.turn.canonical_text ?? "", /Trace the managed API client route chain\./);

      const context = await client.getTurnContext(results[0]!.turn.id);
      assert.equal(context.turn_id, results[0]?.turn.id);
      assert.equal(context.assistant_replies.length, 1);
      assert.match(context.assistant_replies[0]?.content ?? "", /Probe complete\./);
      assert.equal(context.tool_calls.length, 0);
    } finally {
      await runtime.app.close();
      runtime.storage.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});













test("api-client proves direct turn/session detail reads and project delete workflow against an in-process runtime", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-client-"));

  try {
    const source = await seedCodexSourceFixture(tempRoot, "api-client-delete-project", {
      userText: "Delete this API client project safely.",
    });
    const dataDir = path.join(tempRoot, "data-api-client-delete-project");
    const runtime = await createApiRuntime({ dataDir, sources: [source] });

    try {
      const client = createCCHistoryApiClient({
        baseUrl: TEST_BASE_URL,
        fetch: createInjectedFetch(runtime.app),
      });

      const turns = await client.getTurns();
      assert.equal(turns.turns.length, 1);
      const turnId = turns.turns[0]!.id;
      const sessionId = turns.turns[0]!.session_id;

      const turn = await client.getTurn(turnId);
      assert.equal(turn.id, turnId);
      assert.match(turn.canonical_text, /Delete this API client project safely\./);

      const session = await client.getSession(sessionId);
      assert.equal(session.id, sessionId);
      assert.equal(session.source_id, turn.source_id);

      const overrideResponse = await client.upsertLinkingOverride({
        target_kind: "turn",
        target_ref: turnId,
        display_name: "API Client Delete Project",
      });
      const projectId = overrideResponse.project?.project_id ?? overrideResponse.override.project_id;

      const deletion = await client.deleteProject(projectId, { reason: "api_client_delete" });
      assert.equal(deletion.project_id, projectId);
      assert.ok(deletion.deleted_turn_ids.includes(turnId));
      assert.ok(deletion.deleted_session_ids.includes(sessionId));
      assert.ok(deletion.tombstones.length >= 1);

      const projectTombstone = await client.getTombstone(projectId);
      assert.equal(projectTombstone.logical_id, projectId);
      assert.equal(projectTombstone.object_kind, "project");
      assert.equal(projectTombstone.retention_axis, "purged");
    } finally {
      await runtime.app.close();
      runtime.storage.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("api-client proves artifact coverage and candidate lifecycle flow against an in-process runtime", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-client-"));

  try {
    const source = await seedCodexSourceFixture(tempRoot, "api-client-lifecycle", {
      userText: "Preserve this API client lifecycle turn.",
    });
    const dataDir = path.join(tempRoot, "data-api-client-lifecycle");
    const runtime = await createApiRuntime({ dataDir, sources: [source] });

    try {
      const client = createCCHistoryApiClient({
        baseUrl: TEST_BASE_URL,
        fetch: createInjectedFetch(runtime.app),
      });

      const turns = await client.getTurns();
      assert.equal(turns.turns.length, 1);
      const turnId = turns.turns[0]!.id;

      const artifactResponse = await client.upsertArtifact({
        title: "API Client Lifecycle Artifact",
        summary: "Tracks lifecycle coverage through the shared client.",
        source_turn_refs: [turnId],
      });
      assert.equal(artifactResponse.coverage.length, 1);
      assert.equal(artifactResponse.coverage[0]?.turn_id, turnId);

      const artifacts = await client.getArtifacts();
      assert.ok(artifacts.some((artifact) => artifact.artifact_id === artifactResponse.artifact.artifact_id));

      const coverage = await client.getArtifactCoverage(artifactResponse.artifact.artifact_id);
      assert.equal(coverage.length, 1);
      assert.equal(coverage[0]?.turn_id, turnId);

      const gc = await client.runCandidateGc({
        before_iso: "2026-03-10T00:00:00.000Z",
        mode: "purge",
      });
      assert.equal(gc.processed_turn_ids[0], turnId);
      assert.ok(gc.tombstones.length >= 1);

      const tombstone = await client.getTombstone(turnId);
      assert.equal(tombstone.logical_id, turnId);
      assert.equal(tombstone.object_kind, "turn");
      assert.equal(tombstone.retention_axis, "purged");
    } finally {
      await runtime.app.close();
      runtime.storage.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("api-client proves masks, drift, and turn-lineage reads against an in-process runtime", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-client-"));

  try {
    const source = await seedCodexSourceFixture(tempRoot, "api-client-diagnostics", {
      userText: "Inspect diagnostics for this API client turn.",
    });
    const dataDir = path.join(tempRoot, "data-api-client-diagnostics");
    const runtime = await createApiRuntime({ dataDir, sources: [source] });

    try {
      const client = createCCHistoryApiClient({
        baseUrl: TEST_BASE_URL,
        fetch: createInjectedFetch(runtime.app),
      });

      const turns = await client.getTurns();
      assert.equal(turns.turns.length, 1);

      const masks = await client.getMasks();
      assert.ok(masks.length >= 1);
      assert.equal(masks[0]?.is_builtin, true);

      const drift = await client.getDriftReport();
      assert.equal(Array.isArray(drift.timeline), true);
      assert.equal(typeof drift.generated_at, "string");

      const lineage = await client.getTurnLineage(turns.turns[0]!.id);
      assert.equal(lineage.turn.id, turns.turns[0]!.id);
      assert.ok(lineage.atoms.length >= 1);
      assert.ok(lineage.candidate_chain.length >= 1);
    } finally {
      await runtime.app.close();
      runtime.storage.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("api-client proves linking review and manual override workflow against an in-process runtime", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-client-"));

  try {
    const source = await seedCodexSourceFixture(tempRoot, "api-client-linking-review", {
      userText: "Link this API client turn.",
    });
    const dataDir = path.join(tempRoot, "data-api-client-linking-review");
    const runtime = await createApiRuntime({ dataDir, sources: [source] });

    try {
      const client = createCCHistoryApiClient({
        baseUrl: TEST_BASE_URL,
        fetch: createInjectedFetch(runtime.app),
      });

      const review = await client.getLinkingReview();
      assert.ok(review.unlinked_turns.length + review.candidate_turns.length >= 1);

      const turns = await client.getTurns();
      assert.equal(turns.turns.length, 1);

      const overrideResponse = await client.upsertLinkingOverride({
        target_kind: "turn",
        target_ref: turns.turns[0]!.id,
        display_name: "API Client Manual Project",
      });
      const projectId = overrideResponse.project?.project_id ?? overrideResponse.override.project_id;
      assert.equal(typeof projectId, "string");

      const overrides = await client.getLinkingOverrides();
      assert.equal(overrides.length, 1);
      assert.equal(overrides[0]?.target_ref, turns.turns[0]!.id);

      const projectTurns = await client.getProjectTurns(projectId, "committed");
      assert.equal(projectTurns.length, 1);
      assert.equal(projectTurns[0]?.id, turns.turns[0]!.id);

      const revisions = await client.getProjectRevisions(projectId);
      assert.ok(revisions.revisions.length >= 1);
      assert.ok(revisions.lineage_events.length >= 1);
    } finally {
      await runtime.app.close();
      runtime.storage.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("api-client proves fixture-backed session related-work drill-down against an in-process runtime", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-client-"));

  try {
    const dataDir = path.join(tempRoot, "data-api-client-related-work");
    const runtime = await createApiRuntime({
      dataDir,
      sources: [
        createFixtureSourceDefinition("claude_code", resolveRepoPath("mock_data/.claude"), "Claude Code fixture"),
        createFixtureSourceDefinition("openclaw", resolveRepoPath("mock_data/.openclaw"), "OpenClaw fixture"),
      ],
    });

    try {
      const client = createCCHistoryApiClient({
        baseUrl: TEST_BASE_URL,
        fetch: createInjectedFetch(runtime.app),
      });

      const sessions = await client.getSessions();
      assert.ok(sessions.length > 0);

      let sawDelegatedSession = false;
      let sawAutomationRun = false;

      for (const session of sessions) {
        const relatedWork = await client.getSessionRelatedWork(session.id);
        if (relatedWork.some((entry) => entry.relation_kind === "delegated_session" && entry.target_kind === "session" && entry.transcript_primary)) {
          sawDelegatedSession = true;
        }
        if (relatedWork.some((entry) => entry.relation_kind === "automation_run" && entry.target_kind === "automation_run")) {
          sawAutomationRun = true;
        }
      }

      assert.equal(sawDelegatedSession, true);
      assert.equal(sawAutomationRun, true);
    } finally {
      await runtime.app.close();
      runtime.storage.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("api-client proves source-config list-create-update-reset roundtrip against an in-process runtime", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-client-"));

  try {
    const source = await seedCodexSourceFixture(tempRoot, "api-client-source-config-default", {
      userText: "Default directory turn.",
    });
    const extraDir = path.join(tempRoot, "api-client-source-config-extra");
    await writeCodexFixtureDirectory(extraDir, {
      sessionId: "api-client-source-config-extra-session",
      userText: "Manual Codex source turn.",
      workingDirectory: "/workspace/api-client-source-config-extra",
    });
    const overrideDir = path.join(tempRoot, "api-client-source-config-override");
    await writeCodexFixtureDirectory(overrideDir, {
      sessionId: "api-client-source-config-override-session",
      userText: "Override directory turn.",
      workingDirectory: "/workspace/api-client-source-config-override",
    });

    const dataDir = path.join(tempRoot, "data-api-client-source-config");
    const runtime = await createApiRuntime({ dataDir, sources: [source] });

    try {
      const client = createCCHistoryApiClient({
        baseUrl: TEST_BASE_URL,
        fetch: createInjectedFetch(runtime.app),
      });

      const initialSources = await client.getSources();
      assert.equal(initialSources.length, 1);
      assert.equal(initialSources[0]?.base_dir, source.base_dir);
      assert.equal(initialSources[0]?.is_overridden, false);

      const created = await client.createSourceConfig({
        platform: "codex",
        base_dir: extraDir,
        sync: true,
      });
      assert.equal(created.synced, true);
      assert.equal(created.source.base_dir, extraDir);
      assert.equal(created.source.is_default_source, false);

      const sourcesAfterCreate = await client.getSources();
      assert.equal(sourcesAfterCreate.length, 2);
      assert.ok(sourcesAfterCreate.some((configuredSource) => configuredSource.base_dir === extraDir));

      const updated = await client.updateSourceConfig(source.id, {
        base_dir: overrideDir,
        sync: true,
      });
      assert.equal(updated.synced, true);
      assert.equal(updated.source.base_dir, overrideDir);
      assert.equal(updated.source.default_base_dir, source.base_dir);
      assert.equal(updated.source.override_base_dir, overrideDir);
      assert.equal(updated.source.is_overridden, true);

      const sourcesAfterUpdate = await client.getSources();
      const overriddenSource = sourcesAfterUpdate.find((configuredSource) => configuredSource.id === source.id);
      assert.equal(overriddenSource?.base_dir, overrideDir);
      assert.equal(overriddenSource?.is_overridden, true);

      const reset = await client.resetSourceConfig(source.id, { sync: true });
      assert.equal(reset.synced, true);
      assert.equal(reset.source.base_dir, source.base_dir);
      assert.equal(reset.source.override_base_dir, undefined);
      assert.equal(reset.source.is_overridden, false);

      const sourcesAfterReset = await client.getSources();
      const resetSource = sourcesAfterReset.find((configuredSource) => configuredSource.id === source.id);
      assert.equal(resetSource?.base_dir, source.base_dir);
      assert.equal(resetSource?.is_overridden, false);
      assert.ok(sourcesAfterReset.some((configuredSource) => configuredSource.base_dir === extraDir));
    } finally {
      await runtime.app.close();
      runtime.storage.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("api-client proves paginated, filtered, and project-scoped managed reads against an in-process runtime", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-client-"));

  try {
    const alphaSource = await seedCodexSourceFixture(tempRoot, "api-client-filter-alpha", {
      userText: "Alpha filtered managed read prompt.",
    });
    const betaSource = await seedCodexSourceFixture(tempRoot, "api-client-filter-beta", {
      userText: "Beta filtered managed read prompt.",
    });
    const dataDir = path.join(tempRoot, "data-api-client-filtered-read");
    const runtime = await createApiRuntime({ dataDir, sources: [alphaSource, betaSource] });

    try {
      const client = createCCHistoryApiClient({
        baseUrl: TEST_BASE_URL,
        fetch: createInjectedFetch(runtime.app),
      });

      const firstPage = await client.getTurns({ limit: 1, offset: 0 });
      const secondPage = await client.getTurns({ limit: 1, offset: 1 });
      assert.equal(firstPage.total, 2);
      assert.equal(secondPage.total, 2);
      assert.equal(firstPage.turns.length, 1);
      assert.equal(secondPage.turns.length, 1);
      assert.notEqual(firstPage.turns[0]?.id, secondPage.turns[0]?.id);

      const allResults = await client.searchTurns({ q: "filtered managed read prompt" });
      assert.equal(allResults.length, 2);

      const alphaResults = await client.searchTurns({
        q: "filtered managed read prompt",
        source_ids: [alphaSource.id],
        limit: 5,
      });
      assert.equal(alphaResults.length, 1);
      assert.equal(alphaResults[0]?.turn.source_id, alphaSource.id);
      const alphaTurnId = alphaResults[0]!.turn.id;

      const overrideResponse = await client.upsertLinkingOverride({
        target_kind: "turn",
        target_ref: alphaTurnId,
        display_name: "API Client Filter Project",
      });
      const projectId = overrideResponse.project?.project_id ?? overrideResponse.override.project_id;

      const committedProjects = await client.getProjects("committed");
      assert.ok(committedProjects.some((project) => project.project_id === projectId));

      const projectResults = await client.searchTurns({
        q: "filtered managed read prompt",
        project_id: projectId,
        limit: 5,
      });
      assert.equal(projectResults.length, 1);
      assert.equal(projectResults[0]?.turn.id, alphaTurnId);
      assert.equal(projectResults[0]?.turn.project_id, projectId);

      const artifactResponse = await client.upsertArtifact({
        title: "Filtered Project Artifact",
        summary: "Project-scoped artifact retrieval through the shared client.",
        project_id: projectId,
        source_turn_refs: [alphaTurnId],
      });

      const scopedArtifacts = await client.getArtifacts(projectId);
      assert.equal(scopedArtifacts.length, 1);
      assert.equal(scopedArtifacts[0]?.artifact_id, artifactResponse.artifact.artifact_id);
      assert.equal(scopedArtifacts[0]?.project_id, projectId);

      const unrelatedArtifacts = await client.getArtifacts("project-missing");
      assert.equal(unrelatedArtifacts.length, 0);
    } finally {
      await runtime.app.close();
      runtime.storage.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("api-client surfaces read-path failures as CCHistoryApiError with path and status details", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-api-client-"));

  try {
    const dataDir = path.join(tempRoot, "data-api-client-error");
    const runtime = await createApiRuntime({ dataDir, sources: [] });

    try {
      const client = createCCHistoryApiClient({
        baseUrl: TEST_BASE_URL,
        fetch: createInjectedFetch(runtime.app),
      });

      await assert.rejects(
        () => client.getTurnContext("missing-turn"),
        (error: unknown) => {
          assert.ok(error instanceof CCHistoryApiError);
          assert.equal(error.path, "/api/turns/missing-turn/context");
          assert.equal(error.status, 404);
          return true;
        },
      );
    } finally {
      await runtime.app.close();
      runtime.storage.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

function createInjectedFetch(app: any): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const requestUrl = normalizeUrl(input);
    const method = normalizeMethod(input, init);
    const headers = normalizeHeaders(init?.headers);
    const body = normalizePayload(init?.body, headers["content-type"]);
    const response = await app.inject({
      method,
      url: `${requestUrl.pathname}${requestUrl.search}`,
      payload: body,
      headers,
    });

    return new Response(response.payload, {
      status: response.statusCode,
      statusText: response.statusMessage,
      headers: new Headers(flattenHeaders(response.headers)),
    });
  }) as typeof fetch;
}

function normalizeUrl(input: string | URL | Request): URL {
  if (typeof input === "string") {
    return new URL(input, TEST_BASE_URL);
  }
  if (input instanceof URL) {
    return input;
  }
  return new URL(input.url);
}

function normalizeMethod(input: string | URL | Request, init?: RequestInit): string {
  if (init?.method) {
    return init.method;
  }
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.method;
  }
  return "GET";
}

function normalizeHeaders(headers?: HeadersInit): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key, String(value)]));
  }
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => value != null)
      .map(([key, value]) => [key, String(value)]),
  );
}

function normalizePayload(body: RequestInit["body"], contentType?: string): unknown {
  if (body == null) {
    return undefined;
  }
  if (typeof body === "string") {
    if (contentType?.includes("application/json")) {
      return JSON.parse(body);
    }
    return body;
  }
  return body;
}

function flattenHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const flattened: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) continue;
    flattened[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return flattened;
}


function createFixtureSourceDefinition(
  platform: "claude_code" | "openclaw",
  baseDir: string,
  displayName: string,
): SourceDefinition {
  return {
    id: deriveSourceInstanceId({
      host_id: deriveHostId(os.hostname()),
      slot_id: platform,
      base_dir: baseDir,
    }),
    slot_id: platform,
    family: "local_coding_agent",
    platform,
    display_name: displayName,
    base_dir: baseDir,
  };
}

function resolveRepoPath(relativePath: string): string {
  return new URL(`../../../${relativePath}`, import.meta.url).pathname;
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
