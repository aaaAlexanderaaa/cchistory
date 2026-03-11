import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { copyFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { SourceDefinition, SourceSyncPayload, TurnSearchResult, UserTurnProjection } from "@cchistory/domain";
import { getBuiltinMaskTemplates, getDefaultSources, runSourceProbe } from "@cchistory/source-adapters";
import { CCHistoryStorage } from "@cchistory/storage";

export interface ApiRuntimeOptions {
  dataDir?: string;
  probeRunner?: typeof runSourceProbe;
  sources?: readonly SourceDefinition[];
  storage?: CCHistoryStorage;
}

export interface ApiRuntime {
  app: FastifyInstance;
  dataDir: string;
  rawStoreDir: string;
  storage: CCHistoryStorage;
}

export async function createApiRuntime(options: ApiRuntimeOptions = {}): Promise<ApiRuntime> {
  const dataDir =
    options.dataDir ?? path.resolve(process.cwd(), "..", "..", ".cchistory");
  const rawStoreDir = path.join(dataDir, "raw");
  const probeRunner = options.probeRunner ?? runSourceProbe;
  const sources = options.sources?.map((source) => ({ ...source })) ?? getDefaultSources();

  mkdirSync(rawStoreDir, { recursive: true });

  const storage = options.storage ?? new CCHistoryStorage(dataDir);
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  let bootstrapPromise: Promise<void> | undefined;

  app.get("/health", async () => ({
    status: "ok",
    hostname: os.hostname(),
    data_dir: dataDir,
  }));

  app.get("/openapi.json", async () => buildOpenApiDocument());

  app.get("/api/admin/probe/sources", async () => {
    const rows = await Promise.all(
      sources.map(async (source) => ({
        ...source,
        exists: await pathExists(source.base_dir),
      })),
    );
    return { sources: rows };
  });

  app.post("/api/admin/probe/runs", async (request) => {
    const body = (request.body ?? {}) as {
      source_ids?: string[];
      limit_files_per_source?: number;
      persist?: boolean;
    };
    const result = await syncSources({
      source_ids: body.source_ids,
      limit_files_per_source: body.limit_files_per_source,
      persist: body.persist ?? true,
    });
    return summarizeRun(result);
  });

  app.post("/api/admin/pipeline/replay", async (request) => {
    const body = (request.body ?? {}) as {
      source_ids?: string[];
      limit_files_per_source?: number;
    };
    const result = await syncSources({
      source_ids: body.source_ids,
      limit_files_per_source: body.limit_files_per_source,
      persist: false,
    });
    return summarizeRun(result, { storage, includeDiff: true });
  });

  app.get("/api/sources", async () => {
    await ensureSeeded();
    return {
      sources: storage.listSources(),
    };
  });

  app.get("/api/turns", async () => {
    await ensureSeeded();
    return {
      turns: storage.listResolvedTurns().map(summarizeTurn),
    };
  });

  app.get("/api/turns/search", async (request) => {
    await ensureSeeded();
    const query = request.query as Record<string, string | undefined>;
    return {
      results: storage
        .searchTurns({
          query: query.q,
          project_id: query.project_id,
          source_ids: splitCsv(query.source_ids),
          link_states: splitCsv(query.link_states) as Array<"committed" | "candidate" | "unlinked">,
          value_axes: splitCsv(query.value_axes) as Array<"active" | "covered" | "archived" | "suppressed">,
          limit: asOptionalNumber(query.limit) ?? 50,
        })
        .map(summarizeSearchResult),
    };
  });

  app.get("/api/turns/:turnId", async (request, reply) => {
    await ensureSeeded();
    const turnId = (request.params as { turnId: string }).turnId;
    const turn = storage.getResolvedTurn(turnId) ?? storage.getTurn(turnId);
    if (!turn) {
      const tombstone = storage.getTombstone(turnId);
      if (tombstone) {
        reply.code(410);
        return { tombstone };
      }
      reply.code(404);
      return { error: `Turn not found: ${turnId}` };
    }
    return { turn };
  });

  app.get("/api/turns/:turnId/context", async (request, reply) => {
    await ensureSeeded();
    const turnId = (request.params as { turnId: string }).turnId;
    const context = storage.getTurnContext(turnId);
    if (!context) {
      reply.code(404);
      return { error: `Turn context not found: ${turnId}` };
    }
    return { context };
  });

  app.get("/api/sessions/:sessionId", async (request, reply) => {
    await ensureSeeded();
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const session = storage.getResolvedSession(sessionId) ?? storage.getSession(sessionId);
    if (!session) {
      reply.code(404);
      return { error: `Session not found: ${sessionId}` };
    }
    return { session };
  });

  app.get("/api/sessions", async () => {
    await ensureSeeded();
    return {
      sessions: storage.listResolvedSessions(),
    };
  });

  app.get("/api/projects", async (request) => {
    await ensureSeeded();
    const query = request.query as Record<string, string | undefined>;
    const state = query.state === "committed" || query.state === "candidate" ? query.state : "all";
    const projects = storage.listProjects();
    return {
      projects:
        state === "all"
          ? projects
          : projects.filter((project) => project.linkage_state === state),
    };
  });

  app.get("/api/projects/:projectId", async (request, reply) => {
    await ensureSeeded();
    const projectId = (request.params as { projectId: string }).projectId;
    const project = storage.getProject(projectId);
    if (!project) {
      reply.code(404);
      return { error: `Project not found: ${projectId}` };
    }
    return { project };
  });

  app.get("/api/projects/:projectId/turns", async (request) => {
    await ensureSeeded();
    const projectId = (request.params as { projectId: string }).projectId;
    const query = request.query as Record<string, string | undefined>;
    const state = query.state === "committed" || query.state === "candidate" ? query.state : "all";
    return {
      turns: storage.listProjectTurns(projectId, state).map(summarizeTurn),
    };
  });

  app.get("/api/projects/:projectId/revisions", async (request) => {
    await ensureSeeded();
    const projectId = (request.params as { projectId: string }).projectId;
    return {
      revisions: storage.listProjectRevisions(projectId),
      lineage_events: storage.listProjectLineageEvents(projectId),
    };
  });

  app.get("/api/artifacts", async (request) => {
    await ensureSeeded();
    const query = request.query as Record<string, string | undefined>;
    return {
      artifacts: storage.listKnowledgeArtifacts(query.project_id),
    };
  });

  app.post("/api/artifacts", async (request, reply) => {
    await ensureSeeded();
    const body = (request.body ?? {}) as {
      artifact_id?: string;
      artifact_kind?: "decision" | "instruction" | "fact" | "pattern" | "other";
      title?: string;
      summary?: string;
      project_id?: string;
      source_turn_refs?: string[];
    };
    if (!body.title || !body.summary || !body.source_turn_refs || body.source_turn_refs.length === 0) {
      reply.code(400);
      return { error: "title, summary, and source_turn_refs are required" };
    }
    const artifact = storage.upsertKnowledgeArtifact({
      artifact_id: body.artifact_id,
      artifact_kind: body.artifact_kind,
      title: body.title,
      summary: body.summary,
      project_id: body.project_id,
      source_turn_refs: body.source_turn_refs,
    });
    return {
      artifact,
      coverage: storage.listArtifactCoverage(artifact.artifact_id),
    };
  });

  app.get("/api/artifacts/:artifactId/coverage", async (request) => {
    await ensureSeeded();
    const artifactId = (request.params as { artifactId: string }).artifactId;
    return {
      coverage: storage.listArtifactCoverage(artifactId),
    };
  });

  app.get("/api/admin/linking", async () => {
    await ensureSeeded();
    return summarizeLinkingReview(storage.getLinkingReview());
  });

  app.get("/api/admin/linking/overrides", async () => {
    await ensureSeeded();
    return {
      overrides: storage.listProjectOverrides(),
    };
  });

  app.post("/api/admin/linking/overrides", async (request, reply) => {
    await ensureSeeded();
    const body = (request.body ?? {}) as {
      target_kind?: "turn" | "session" | "observation";
      target_ref?: string;
      project_id?: string;
      display_name?: string;
      note?: string;
    };
    if (!body.target_kind || !body.target_ref) {
      reply.code(400);
      return { error: "target_kind and target_ref are required" };
    }

    const existingProject = body.project_id
      ? storage.listProjects().find((project) => project.project_id === body.project_id)
      : undefined;
    const projectId =
      body.project_id ?? stableManualProjectId(body.display_name ?? body.target_ref, body.target_kind, body.target_ref);
    const displayName =
      body.display_name ?? existingProject?.display_name ?? inferOverrideDisplayName(storage, body.target_kind, body.target_ref);
    const override = storage.upsertProjectOverride({
      target_kind: body.target_kind,
      target_ref: body.target_ref,
      project_id: projectId,
      display_name: displayName,
      note: body.note,
    });

    return {
      override,
      project: storage.listProjects().find((project) => project.project_id === override.project_id),
    };
  });

  app.post("/api/admin/projects/lineage-events", async (request, reply) => {
    await ensureSeeded();
    const body = (request.body ?? {}) as {
      project_id?: string;
      project_revision_id?: string;
      previous_project_revision_id?: string;
      event_kind?: "split" | "merge" | "superseded" | "manual_override" | "created" | "revised";
      detail?: Record<string, unknown>;
    };
    if (!body.project_id || !body.event_kind) {
      reply.code(400);
      return { error: "project_id and event_kind are required" };
    }
    return {
      event: storage.appendProjectLineageEvent({
        project_id: body.project_id,
        project_revision_id: body.project_revision_id,
        previous_project_revision_id: body.previous_project_revision_id,
        event_kind: body.event_kind,
        detail: body.detail ?? {},
      }),
    };
  });

  app.post("/api/admin/lifecycle/candidate-gc", async (request) => {
    await ensureSeeded();
    const body = (request.body ?? {}) as {
      before_iso?: string;
      older_than_days?: number;
      mode?: "archive" | "purge";
    };
    const beforeIso =
      body.before_iso ??
      new Date(Date.now() - (body.older_than_days ?? 30) * 24 * 60 * 60 * 1000).toISOString();
    return storage.garbageCollectCandidateTurns({
      before_iso: beforeIso,
      mode: body.mode,
    });
  });

  app.get("/api/admin/pipeline/runs", async () => {
    await ensureSeeded();
    return { runs: storage.listStageRuns() };
  });

  app.get("/api/admin/pipeline/blobs", async () => {
    await ensureSeeded();
    return { blobs: storage.listBlobs() };
  });

  app.get("/api/admin/pipeline/records", async () => {
    await ensureSeeded();
    return { records: storage.listRecords() };
  });

  app.get("/api/admin/pipeline/fragments", async () => {
    await ensureSeeded();
    return { fragments: storage.listFragments() };
  });

  app.get("/api/admin/pipeline/atoms", async () => {
    await ensureSeeded();
    return { atoms: storage.listAtoms() };
  });

  app.get("/api/admin/pipeline/edges", async () => {
    await ensureSeeded();
    return { edges: storage.listEdges() };
  });

  app.get("/api/admin/pipeline/candidates", async () => {
    await ensureSeeded();
    return { candidates: storage.listCandidates() };
  });

  app.get("/api/admin/pipeline/loss-audits", async () => {
    await ensureSeeded();
    return { loss_audits: storage.listLossAudits() };
  });

  app.get("/api/admin/pipeline/lineage/:turnId", async (request, reply) => {
    await ensureSeeded();
    const turnId = (request.params as { turnId: string }).turnId;
    const lineage = storage.getTurnLineage(turnId);
    if (!lineage) {
      reply.code(404);
      return { error: `Lineage not found for turn: ${turnId}` };
    }
    return { lineage };
  });

  app.get("/api/admin/masks", async () => ({
    templates: getBuiltinMaskTemplates(),
  }));

  app.get("/api/admin/drift", async () => {
    await ensureSeeded();
    return storage.getDriftReport();
  });

  app.get("/api/tombstones/:logicalId", async (request, reply) => {
    await ensureSeeded();
    const logicalId = (request.params as { logicalId: string }).logicalId;
    const tombstone = storage.getTombstone(logicalId);
    if (!tombstone) {
      reply.code(404);
      return { error: `Tombstone not found: ${logicalId}` };
    }
    return { tombstone };
  });

  async function ensureSeeded(): Promise<void> {
    if (!storage.isEmpty()) {
      return;
    }
    if (!bootstrapPromise) {
      bootstrapPromise = syncSources({ persist: true }).then(() => undefined);
    }
    await bootstrapPromise;
  }

  async function syncSources(options: {
    source_ids?: string[];
    limit_files_per_source?: number;
    persist: boolean;
  }): Promise<{ host: Awaited<ReturnType<typeof runSourceProbe>>["host"]; sources: SourceSyncPayload[] }> {
    const result = await probeRunner(
      {
        source_ids: options.source_ids,
        limit_files_per_source: options.limit_files_per_source,
      },
      sources,
    );

    if (options.persist) {
      for (const sourcePayload of result.sources) {
        await snapshotRawBlobs(rawStoreDir, sourcePayload);
        storage.replaceSourcePayload(sourcePayload);
      }
    }

    return result;
  }

  return { app, dataDir, rawStoreDir, storage };
}

async function snapshotRawBlobs(rawStoreDir: string, payload: SourceSyncPayload): Promise<void> {
  for (const blob of payload.blobs) {
    const extension = path.extname(blob.origin_path) || ".json";
    const targetDir = path.join(rawStoreDir, payload.source.id);
    const targetPath = path.join(targetDir, `${blob.id}${extension}`);
    mkdirSync(targetDir, { recursive: true });
    if (!(await pathExists(targetPath))) {
      await copyFile(blob.origin_path, targetPath);
    }
    blob.captured_path = targetPath;
    blob.size_bytes = (await stat(targetPath)).size;
  }
}

function summarizeRun(
  result: { host: { id: string }; sources: SourceSyncPayload[] },
  options: { storage?: CCHistoryStorage; includeDiff?: boolean } = {},
) {
  return {
    host_id: result.host.id,
    sources: result.sources.map((payload) => ({
      source: payload.source,
      counts: {
        blobs: payload.blobs.length,
        records: payload.records.length,
        fragments: payload.fragments.length,
        atoms: payload.atoms.length,
        candidates: payload.candidates.length,
        sessions: payload.sessions.length,
        turns: payload.turns.length,
      },
      latest_stage_runs: payload.stage_runs,
      diff:
        options.includeDiff && options.storage
          ? buildReplayDiff(options.storage.getSourceReplayBaseline(payload.source.id), payload)
          : undefined,
    })),
  };
}

function summarizeTurn(turn: UserTurnProjection) {
  const { lineage, ...summary } = turn;
  return summary;
}

function summarizeSearchResult(result: TurnSearchResult) {
  return {
    ...result,
    turn: summarizeTurn(result.turn),
  };
}

function summarizeLinkingReview(review: ReturnType<CCHistoryStorage["getLinkingReview"]>) {
  return {
    ...review,
    candidate_turns: review.candidate_turns.map(summarizeTurn),
    unlinked_turns: review.unlinked_turns.map(summarizeTurn),
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function buildReplayDiff(
  baseline: ReturnType<CCHistoryStorage["getSourceReplayBaseline"]>,
  payload: SourceSyncPayload,
) {
  const nextCounts = {
    blobs: payload.blobs.length,
    records: payload.records.length,
    fragments: payload.fragments.length,
    atoms: payload.atoms.length,
    candidates: payload.candidates.length,
    sessions: payload.sessions.length,
    turns: payload.turns.length,
  };
  const nextTurnTextById = Object.fromEntries(payload.turns.map((turn) => [turn.id, turn.canonical_text]));
  const previousTurnIds = new Set(Object.keys(baseline.turn_text_by_id));
  const nextTurnIds = new Set(Object.keys(nextTurnTextById));

  return {
    count_deltas: Object.fromEntries(
      Object.entries(nextCounts).map(([key, value]) => [key, value - (baseline.counts[key] ?? 0)]),
    ),
    added_turn_ids: [...nextTurnIds].filter((turnId) => !previousTurnIds.has(turnId)),
    removed_turn_ids: [...previousTurnIds].filter((turnId) => !nextTurnIds.has(turnId)),
    changed_turn_ids: [...nextTurnIds].filter((turnId) => baseline.turn_text_by_id[turnId] !== nextTurnTextById[turnId]),
    previous_project_ids: baseline.project_ids,
    next_project_ids: uniqueStrings(
      payload.turns.map((turn) => turn.project_id).filter((projectId): projectId is string => Boolean(projectId)),
    ),
  };
}

function splitCsv(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const parts = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return parts.length > 0 ? parts : undefined;
}

function asOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stableManualProjectId(displayName: string, targetKind: string, targetRef: string): string {
  const digest = createHash("sha1").update(`${displayName}:${targetKind}:${targetRef}`).digest("hex").slice(0, 12);
  return `project-manual-${digest}`;
}

function inferOverrideDisplayName(
  storage: CCHistoryStorage,
  targetKind: "turn" | "session" | "observation",
  targetRef: string,
): string {
  if (targetKind === "turn") {
    return storage.getResolvedTurn(targetRef)?.canonical_text.slice(0, 48) || "Manual Project";
  }
  if (targetKind === "session") {
    return storage.getResolvedSession(targetRef)?.title || "Manual Project";
  }
  return `Manual Project ${targetRef.slice(0, 8)}`;
}

function uniqueStrings<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

function buildOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "CCHistory Local API",
      version: "0.1.0",
    },
    paths: {
      "/health": { get: { summary: "Health check" } },
      "/api/sources": { get: { summary: "List sources" } },
      "/api/turns": { get: { summary: "List resolved turns" } },
      "/api/turns/search": { get: { summary: "Search turns" } },
      "/api/turns/{turnId}": { get: { summary: "Get turn detail" } },
      "/api/turns/{turnId}/context": { get: { summary: "Get turn context" } },
      "/api/sessions/{sessionId}": { get: { summary: "Get session detail" } },
      "/api/projects": { get: { summary: "List committed projects" } },
      "/api/projects/{projectId}": { get: { summary: "Resolve a project id to the current project revision" } },
      "/api/projects/{projectId}/turns": { get: { summary: "List project turns" } },
      "/api/projects/{projectId}/revisions": { get: { summary: "List project revisions and lineage events" } },
      "/api/artifacts": {
        get: { summary: "List knowledge artifacts" },
        post: { summary: "Create or update a knowledge artifact" },
      },
      "/api/artifacts/{artifactId}/coverage": { get: { summary: "List artifact coverage rows" } },
      "/api/admin/linking": { get: { summary: "Get linking review queue" } },
      "/api/admin/linking/overrides": {
        get: { summary: "List manual linking overrides" },
        post: { summary: "Create or update a manual linking override" },
      },
      "/api/admin/projects/lineage-events": {
        post: { summary: "Append explicit split, merge, superseded, or override lineage events for a project" },
      },
      "/api/admin/lifecycle/candidate-gc": { post: { summary: "Archive or purge candidate turns older than a cutoff" } },
      "/api/admin/probe/sources": { get: { summary: "List probe source definitions" } },
      "/api/admin/probe/runs": { post: { summary: "Run a local probe" } },
      "/api/admin/pipeline/replay": { post: { summary: "Replay the pipeline without persistence" } },
      "/api/admin/pipeline/runs": { get: { summary: "List stage runs" } },
      "/api/admin/pipeline/blobs": { get: { summary: "List captured blobs" } },
      "/api/admin/pipeline/records": { get: { summary: "List raw records" } },
      "/api/admin/pipeline/fragments": { get: { summary: "List source fragments" } },
      "/api/admin/pipeline/atoms": { get: { summary: "List conversation atoms" } },
      "/api/admin/pipeline/edges": { get: { summary: "List atom edges" } },
      "/api/admin/pipeline/candidates": { get: { summary: "List derived candidates" } },
      "/api/admin/pipeline/loss-audits": { get: { summary: "List loss audits" } },
      "/api/admin/pipeline/lineage/{turnId}": { get: { summary: "Get turn lineage drill-down" } },
      "/api/admin/masks": { get: { summary: "List mask templates" } },
      "/api/admin/drift": { get: { summary: "Get drift diagnostics" } },
      "/api/tombstones/{logicalId}": { get: { summary: "Resolve a purged logical id to a tombstone projection" } },
    },
  };
}
