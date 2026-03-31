import { mkdirSync } from "node:fs";
import { createHash, timingSafeEqual } from "node:crypto";
import { copyFile, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import {
  deriveHostId,
  deriveSourceInstanceId,
  deriveSourceSlotId,
  isLegacySourceInstanceId,
  type SourceDefinition,
  type SourceSyncPayload,
  type TurnSearchResult,
  type UserTurnProjection,
} from "@cchistory/domain";
import { getBuiltinMaskTemplates, getDefaultSources, getDefaultSourcesForHost, runSourceProbe } from "@cchistory/source-adapters";
import { CCHistoryStorage } from "@cchistory/storage";
import { resolveDefaultCchistoryDataDir } from "@cchistory/storage/store-layout";

export interface ApiRuntimeOptions {
  dataDir?: string;
  cwd?: string;
  homeDir?: string;
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

interface SourceOverrideRecord {
  base_dir: string;
  updated_at: string;
}

type SourceOverrideMap = Record<string, SourceOverrideRecord>;

interface ManualSourceRecord extends SourceDefinition {
  created_at: string;
  updated_at: string;
}

interface PersistedSourceConfig {
  version: 2;
  overrides: SourceOverrideMap;
  extras: ManualSourceRecord[];
}

interface ConfiguredSourceStatus {
  id: string;
  family: SourceDefinition["family"];
  platform: SourceDefinition["platform"];
  display_name: string;
  base_dir: string;
  default_base_dir?: string;
  override_base_dir?: string;
  is_overridden: boolean;
  is_default_source: boolean;
  path_exists: boolean;
  host_id: string;
  last_sync: string | null;
  sync_status: "healthy" | "stale" | "error";
  error_message?: string;
  total_blobs: number;
  total_records: number;
  total_fragments: number;
  total_atoms: number;
  total_sessions: number;
  total_turns: number;
}

export async function createApiRuntime(options: ApiRuntimeOptions = {}): Promise<ApiRuntime> {
  const hostName = os.hostname();
  const hostId = deriveHostId(hostName);
  const dataDir =
    options.dataDir ?? resolveDefaultCchistoryDataDir({ cwd: options.cwd ?? process.cwd(), homeDir: options.homeDir });
  const rawStoreDir = path.join(dataDir, "raw");
  const sourceConfigPath = path.join(dataDir, "source-overrides.json");
  const probeRunner = options.probeRunner ?? runSourceProbe;
  const defaultSourceDefinitions = normalizeConfiguredSourceDefinitions(
    options.sources ?? getDefaultSourcesForHost({ includeMissing: true }),
    hostId,
  );
  let sourceConfig = normalizePersistedSourceConfig(await readSourceConfig(sourceConfigPath), hostId);

  mkdirSync(rawStoreDir, { recursive: true });

  const storage = options.storage ?? new CCHistoryStorage(dataDir);
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  const corsOrigins = (process.env.CCHISTORY_CORS_ORIGIN ?? "http://localhost:8085,http://127.0.0.1:8085")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((origin) => {
      try {
        new URL(origin);
        return true;
      } catch {
        console.warn(`[cchistory/api] Ignoring invalid CORS origin: ${origin}`);
        return false;
      }
    });
  await app.register(cors, { origin: corsOrigins });

  const apiToken = process.env.CCHISTORY_API_TOKEN;
  if (apiToken) {
    const expectedAuth = Buffer.from(`Bearer ${apiToken}`, "utf8");
    app.addHook("onRequest", async (request, reply) => {
      if (request.url === "/health" || request.url === "/openapi.json") {
        return;
      }
      const header = request.headers.authorization ?? "";
      const providedAuth = Buffer.from(header, "utf8");
      const isValid =
        expectedAuth.length === providedAuth.length &&
        timingSafeEqual(expectedAuth, providedAuth);
      if (!isValid) {
        reply.code(401);
        return reply.send({ error: "Unauthorized" });
      }
    });
  }

  let bootstrapPromise: Promise<void> | undefined;

  app.get("/health", async () => ({
    status: "ok",
    hostname: hostName,
  }));

  app.get("/openapi.json", async () => buildOpenApiDocument());

  app.get("/api/admin/source-config", async () => ({
    sources: await listConfiguredSourceStatuses(),
  }));

  app.post("/api/admin/source-config", {
    schema: {
      body: {
        type: "object",
        required: ["platform", "base_dir"],
        properties: {
          platform: { type: "string" },
          base_dir: { type: "string" },
          display_name: { type: "string" },
          sync: { type: "boolean" },
          limit_files_per_source: { type: "number" },
        },
      },
    },
  }, async (request, reply) => {
    const body = (request.body ?? {}) as {
      platform?: SourceDefinition["platform"];
      base_dir?: string;
      display_name?: string;
      sync?: boolean;
      limit_files_per_source?: number;
    };
    const platform = body.platform;
    const nextBaseDir = body.base_dir?.trim();
    if (!platform || !nextBaseDir) {
      reply.code(400);
      return { error: "platform and base_dir are required" };
    }

    const sourceTemplate = getDefaultSourceTemplateByPlatform(platform);
    if (!sourceTemplate) {
      reply.code(404);
      return { error: `Unsupported source platform: ${platform}` };
    }

    const existingSource = getConfiguredSources().find(
      (source) => source.platform === platform && normalizePathKey(source.base_dir) === normalizePathKey(nextBaseDir),
    );
    if (existingSource) {
      return {
        source: await getConfiguredSourceStatus(existingSource.id),
        synced: false,
      };
    }

    const manualSource = createManualSourceRecord(sourceTemplate, nextBaseDir, body.display_name);
    sourceConfig = {
      ...sourceConfig,
      extras: [...sourceConfig.extras.filter((source) => source.id !== manualSource.id), manualSource],
    };
    await writeSourceConfig(sourceConfigPath, sourceConfig);

    const synced = body.sync ?? true;
    if (synced) {
      await syncSources({
        source_ids: [manualSource.id],
        limit_files_per_source: body.limit_files_per_source,
        persist: true,
      });
    }

    return {
      source: await getConfiguredSourceStatus(manualSource.id),
      synced,
    };
  });

  app.post("/api/admin/source-config/:sourceId", {
    schema: {
      body: {
        type: "object",
        required: ["base_dir"],
        properties: {
          base_dir: { type: "string" },
          sync: { type: "boolean" },
          limit_files_per_source: { type: "number" },
        },
      },
    },
  }, async (request, reply) => {
    const sourceId = (request.params as { sourceId: string }).sourceId;
    const configuredSource = getConfiguredSourceDefinition(sourceId);
    if (!configuredSource) {
      reply.code(404);
      return { error: `Source not found: ${sourceId}` };
    }

    const body = (request.body ?? {}) as {
      base_dir?: string;
      sync?: boolean;
      limit_files_per_source?: number;
    };
    const nextBaseDir = body.base_dir?.trim();
    if (!nextBaseDir) {
      reply.code(400);
      return { error: "base_dir is required" };
    }

    const defaultSource = getDefaultSourceDefinition(sourceId);
    if (defaultSource) {
      sourceConfig = {
        ...sourceConfig,
        overrides: {
          ...sourceConfig.overrides,
          [sourceId]: {
            base_dir: nextBaseDir,
            updated_at: new Date().toISOString(),
          },
        },
      };
    } else {
      sourceConfig = {
        ...sourceConfig,
        extras: sourceConfig.extras.map((source) =>
          source.id === sourceId
            ? {
                ...source,
                base_dir: nextBaseDir,
                updated_at: new Date().toISOString(),
              }
            : source,
        ),
      };
    }
    await writeSourceConfig(sourceConfigPath, sourceConfig);

    const synced = body.sync ?? true;
    if (synced) {
      await syncSources({
        source_ids: [sourceId],
        limit_files_per_source: body.limit_files_per_source,
        persist: true,
      });
    }

    return {
      source: await getConfiguredSourceStatus(sourceId),
      synced,
    };
  });

  app.post("/api/admin/source-config/:sourceId/reset", {
    schema: {
      body: {
        type: "object",
        properties: {
          sync: { type: "boolean" },
          limit_files_per_source: { type: "number" },
        },
      },
    },
  }, async (request, reply) => {
    const sourceId = (request.params as { sourceId: string }).sourceId;
    if (!getDefaultSourceDefinition(sourceId)) {
      reply.code(400);
      return { error: `Source ${sourceId} does not support reset` };
    }

    const body = (request.body ?? {}) as {
      sync?: boolean;
      limit_files_per_source?: number;
    };

    if (sourceConfig.overrides[sourceId]) {
      const nextOverrides = { ...sourceConfig.overrides };
      delete nextOverrides[sourceId];
      sourceConfig = {
        ...sourceConfig,
        overrides: nextOverrides,
      };
      await writeSourceConfig(sourceConfigPath, sourceConfig);
    }

    const synced = body.sync ?? true;
    if (synced) {
      await syncSources({
        source_ids: [sourceId],
        limit_files_per_source: body.limit_files_per_source,
        persist: true,
      });
    }

    return {
      source: await getConfiguredSourceStatus(sourceId),
      synced,
    };
  });

  app.get("/api/admin/probe/sources", async () => {
    return {
      sources: await listConfiguredSourceStatuses(),
    };
  });

  app.post("/api/admin/probe/runs", {
    schema: {
      body: {
        type: "object",
        properties: {
          source_ids: { type: "array", items: { type: "string" } },
          limit_files_per_source: { type: "number" },
          persist: { type: "boolean" },
        },
      },
    },
  }, async (request) => {
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

  app.post("/api/admin/pipeline/replay", {
    schema: {
      body: {
        type: "object",
        properties: {
          source_ids: { type: "array", items: { type: "string" } },
          limit_files_per_source: { type: "number" },
        },
      },
    },
  }, async (request) => {
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
    return {
      sources: await listConfiguredSourceStatuses(),
    };
  });

  app.get("/api/turns", async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const limit = asOptionalNumber(query.limit);
    const offset = asOptionalNumber(query.offset) ?? 0;
    const allTurns = storage.listResolvedTurns();
    const sliced = limit != null ? allTurns.slice(offset, offset + limit) : allTurns.slice(offset);
    return {
      turns: sliced.map(summarizeTurn),
      total: allTurns.length,
    };
  });

  app.get("/api/turns/search", async (request) => {
    const query = request.query as Record<string, string | undefined>;
    return {
      search_mode: storage.searchMode,
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
    const turnId = (request.params as { turnId: string }).turnId;
    const context = storage.getTurnContext(turnId);
    if (!context) {
      reply.code(404);
      return { error: `Turn context not found: ${turnId}` };
    }
    return { context };
  });

  app.get("/api/sessions/:sessionId", async (request, reply) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const session = storage.getResolvedSession(sessionId) ?? storage.getSession(sessionId);
    if (!session) {
      reply.code(404);
      return { error: `Session not found: ${sessionId}` };
    }
    return { session };
  });

  app.get("/api/sessions", async () => {
    return {
      sessions: storage.listResolvedSessions(),
    };
  });

  app.get("/api/projects", async (request) => {
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
    const projectId = (request.params as { projectId: string }).projectId;
    const project = storage.getProject(projectId);
    if (!project) {
      const tombstone = storage.getTombstone(projectId);
      if (tombstone?.object_kind === "project") {
        reply.code(410);
        return { tombstone };
      }
      reply.code(404);
      return { error: `Project not found: ${projectId}` };
    }
    return { project };
  });

  app.get("/api/projects/:projectId/turns", async (request) => {
    const projectId = (request.params as { projectId: string }).projectId;
    const query = request.query as Record<string, string | undefined>;
    const state = query.state === "committed" || query.state === "candidate" ? query.state : "all";
    return {
      turns: storage.listProjectTurns(projectId, state).map(summarizeTurn),
    };
  });

  app.get("/api/projects/:projectId/revisions", async (request) => {
    const projectId = (request.params as { projectId: string }).projectId;
    return {
      revisions: storage.listProjectRevisions(projectId),
      lineage_events: storage.listProjectLineageEvents(projectId),
    };
  });

  app.get("/api/artifacts", async (request) => {
    const query = request.query as Record<string, string | undefined>;
    return {
      artifacts: storage.listKnowledgeArtifacts(query.project_id),
    };
  });

  app.post("/api/artifacts", {
    schema: {
      body: {
        type: "object",
        required: ["title", "summary", "source_turn_refs"],
        properties: {
          artifact_id: { type: "string" },
          artifact_kind: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          project_id: { type: "string" },
          source_turn_refs: { type: "array", items: { type: "string" } },
        },
      },
    },
  }, async (request, reply) => {
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
    const artifactId = (request.params as { artifactId: string }).artifactId;
    return {
      coverage: storage.listArtifactCoverage(artifactId),
    };
  });

  app.get("/api/admin/linking", async () => {
    return summarizeLinkingReview(storage.getLinkingReview());
  });

  app.get("/api/admin/linking/overrides", async () => {
    return {
      overrides: storage.listProjectOverrides(),
    };
  });

  app.post("/api/admin/linking/overrides", {
    schema: {
      body: {
        type: "object",
        required: ["target_kind", "target_ref"],
        properties: {
          target_kind: { type: "string" },
          target_ref: { type: "string" },
          project_id: { type: "string" },
          display_name: { type: "string" },
          note: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
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

  app.post("/api/admin/projects/lineage-events", {
    schema: {
      body: {
        type: "object",
        required: ["project_id", "event_kind"],
        properties: {
          project_id: { type: "string" },
          project_revision_id: { type: "string" },
          previous_project_revision_id: { type: "string" },
          event_kind: { type: "string" },
          detail: { type: "object" },
        },
      },
    },
  }, async (request, reply) => {
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

  app.post("/api/admin/projects/:projectId/delete", {
    schema: {
      body: {
        type: "object",
        properties: {
          reason: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    const projectId = (request.params as { projectId: string }).projectId;
    const body = (request.body ?? {}) as { reason?: string };
    const result = storage.deleteProject(projectId, body.reason);
    if (!result) {
      reply.code(404);
      return { error: `Project not found: ${projectId}` };
    }
    return result;
  });

  app.post("/api/admin/lifecycle/candidate-gc", {
    schema: {
      body: {
        type: "object",
        properties: {
          before_iso: { type: "string" },
          older_than_days: { type: "number" },
          mode: { type: "string", enum: ["archive", "purge"] },
        },
      },
    },
  }, async (request) => {
    const body = (request.body ?? {}) as {
      before_iso?: string;
      older_than_days?: number;
      mode?: "archive" | "purge";
    };
    const beforeIso =
      body.before_iso ??
      new Date(Date.now() - (body.older_than_days ?? 30) * 24 * 60 * 60 * 1000).toISOString();
    console.warn(`[cchistory/api] candidate-gc invoked: mode=${body.mode ?? "archive"}, before=${beforeIso}`);
    const result = storage.garbageCollectCandidateTurns({
      before_iso: beforeIso,
      mode: body.mode,
    });
    console.warn(`[cchistory/api] candidate-gc completed: processed=${result.processed_turn_ids.length}, tombstones=${result.tombstones.length}`);
    return result;
  });

  app.get("/api/admin/pipeline/runs", async () => {
    return { runs: storage.listStageRuns() };
  });

  app.get("/api/admin/pipeline/blobs", async () => {
    return { blobs: storage.listBlobs() };
  });

  app.get("/api/admin/pipeline/records", async () => {
    return { records: storage.listRecords() };
  });

  app.get("/api/admin/pipeline/fragments", async () => {
    return { fragments: storage.listFragments() };
  });

  app.get("/api/admin/pipeline/atoms", async () => {
    return { atoms: storage.listAtoms() };
  });

  app.get("/api/admin/pipeline/edges", async () => {
    return { edges: storage.listEdges() };
  });

  app.get("/api/admin/pipeline/candidates", async () => {
    return { candidates: storage.listCandidates() };
  });

  app.get("/api/admin/pipeline/loss-audits", async () => {
    return { loss_audits: storage.listLossAudits() };
  });

  app.get("/api/admin/pipeline/lineage/:turnId", async (request, reply) => {
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
    return storage.getDriftReport();
  });

  app.get("/api/tombstones/:logicalId", async (request, reply) => {
    const logicalId = (request.params as { logicalId: string }).logicalId;
    const tombstone = storage.getTombstone(logicalId);
    if (!tombstone) {
      reply.code(404);
      return { error: `Tombstone not found: ${logicalId}` };
    }
    return { tombstone };
  });

  async function bootstrapStorage(): Promise<void> {
    if (!storage.isEmpty()) {
      return;
    }
    if (!bootstrapPromise) {
      bootstrapPromise = syncSources({ persist: true }).then(
        () => undefined,
        (error) => {
          bootstrapPromise = undefined;
          throw error;
        },
      );
    }
    await bootstrapPromise;
  }

  async function syncSources(options: {
    source_ids?: string[];
    limit_files_per_source?: number;
    persist: boolean;
  }): Promise<{ host: Awaited<ReturnType<typeof runSourceProbe>>["host"]; sources: SourceSyncPayload[] }> {
    const sources = getConfiguredSources();
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
        storage.replaceSourcePayload(sourcePayload, { allow_host_rekey: true });
      }
    }

    return result;
  }

  function getConfiguredSources(): SourceDefinition[] {
    if (options.sources) {
      return dedupeSourceDefinitions([
        ...defaultSourceDefinitions.map((source) => applySourceOverride(source, sourceConfig.overrides[source.id])),
        ...sourceConfig.extras,
      ]);
    }

    const discoveredDefaults = new Map(getDefaultSources().map((source) => [source.id, source]));
    const configuredDefaults = defaultSourceDefinitions.flatMap((source) => {
      const discovered = discoveredDefaults.get(source.id);
      if (discovered) {
        return [applySourceOverride(discovered, sourceConfig.overrides[source.id])];
      }
      if (sourceConfig.overrides[source.id]) {
        return [applySourceOverride(source, sourceConfig.overrides[source.id])];
      }
      return [];
    });

    return dedupeSourceDefinitions([...configuredDefaults, ...sourceConfig.extras]);
  }

  function getConfiguredSourceDefinition(sourceId: string): SourceDefinition | undefined {
    return getConfiguredSources().find((source) => source.id === sourceId) ?? getDefaultSourceDefinition(sourceId);
  }

  function getDefaultSourceDefinition(sourceId: string): SourceDefinition | undefined {
    return defaultSourceDefinitions.find((source) => source.id === sourceId);
  }

  function getDefaultSourceTemplateByPlatform(
    platform: SourceDefinition["platform"],
  ): SourceDefinition | undefined {
    return defaultSourceDefinitions.find((source) => source.platform === platform);
  }

  async function getConfiguredSourceStatus(sourceId: string): Promise<ConfiguredSourceStatus | undefined> {
    const rows = await listConfiguredSourceStatuses();
    return rows.find((source) => source.id === sourceId);
  }

  async function listConfiguredSourceStatuses(): Promise<ConfiguredSourceStatus[]> {
    const storedSources = new Map(storage.listSources().map((source) => [source.id, source]));
    const configuredSources = getConfiguredSources();
    const configuredSourceIds = new Set(configuredSources.map((source) => source.id));
    const rows = await Promise.all(
      configuredSources.map((source) =>
        buildConfiguredSourceStatus({
          defaultSource: getDefaultSourceDefinition(source.id),
          configuredSource: source,
          override: sourceConfig.overrides[source.id],
          storedSource: storedSources.get(source.id),
          hostName,
        }),
      ),
    );
    const storedOnlyRows = await Promise.all(
      [...storedSources.values()]
        .filter((source) => !configuredSourceIds.has(source.id))
        .filter(hasMeaningfulStoredSourceData)
        .map((source) => {
          const defaultSource = getDefaultSourceDefinition(source.id);
          return buildConfiguredSourceStatus({
            defaultSource,
            configuredSource: defaultSource ? applySourceOverride(defaultSource, sourceConfig.overrides[source.id]) : source,
            override: sourceConfig.overrides[source.id],
            storedSource: source,
            hostName,
          });
        }),
    );

    return [...rows, ...storedOnlyRows].sort((left, right) => left.display_name.localeCompare(right.display_name));
  }

  await bootstrapStorage();

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
      "/api/admin/projects/{projectId}/delete": {
        post: { summary: "Delete a project and purge its currently linked local data" },
      },
      "/api/admin/lifecycle/candidate-gc": { post: { summary: "Archive or purge candidate turns older than a cutoff" } },
      "/api/admin/source-config": {
        get: { summary: "List source configuration and current effective directories" },
        post: { summary: "Add a manual source instance for a supported source platform" },
      },
      "/api/admin/source-config/{sourceId}": { post: { summary: "Override the base directory for a configured source" } },
      "/api/admin/source-config/{sourceId}/reset": { post: { summary: "Reset a source base directory back to its default" } },
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

function normalizeConfiguredSourceDefinitions(
  sources: readonly SourceDefinition[],
  hostId: string,
): SourceDefinition[] {
  return sources.map((source) => {
    const slotId = source.slot_id || deriveSourceSlotId(source.platform);
    return {
      ...source,
      id: isLegacySourceInstanceId(source.id)
        ? deriveSourceInstanceId({
            host_id: hostId,
            slot_id: slotId,
            base_dir: source.base_dir,
          })
        : source.id,
      slot_id: slotId,
    };
  });
}

function normalizePersistedSourceConfig(
  config: { overrides: SourceOverrideMap; extras: ManualSourceRecord[] },
  hostId: string,
): { overrides: SourceOverrideMap; extras: ManualSourceRecord[] } {
  return {
    overrides: config.overrides,
    extras: config.extras.map((source) => {
      const slotId = source.slot_id || deriveSourceSlotId(source.platform);
      return {
        ...source,
        id: isLegacySourceInstanceId(source.id)
          ? deriveSourceInstanceId({
              host_id: hostId,
              slot_id: slotId,
              base_dir: source.base_dir,
            })
          : source.id,
        slot_id: slotId,
      };
    }),
  };
}

function applySourceOverride(source: SourceDefinition, override?: SourceOverrideRecord): SourceDefinition {
  return {
    ...source,
    base_dir: override?.base_dir ?? source.base_dir,
  };
}

async function buildConfiguredSourceStatus(options: {
  defaultSource?: SourceDefinition;
  configuredSource: SourceDefinition;
  override?: SourceOverrideRecord;
  storedSource?: {
    host_id: string;
    last_sync: string | null;
    sync_status: "healthy" | "stale" | "error";
    error_message?: string;
    total_blobs: number;
    total_records: number;
    total_fragments: number;
    total_atoms: number;
    total_sessions: number;
    total_turns: number;
    base_dir: string;
  };
  hostName: string;
}): Promise<ConfiguredSourceStatus> {
  const { configuredSource, defaultSource, hostName, override, storedSource } = options;
  const exists = await pathExists(configuredSource.base_dir);
  const configChangedSinceLastSync = Boolean(storedSource && storedSource.base_dir !== configuredSource.base_dir);

  return {
    id: configuredSource.id,
    family: configuredSource.family,
    platform: configuredSource.platform,
    display_name: configuredSource.display_name,
    base_dir: configuredSource.base_dir,
    default_base_dir: defaultSource?.base_dir,
    override_base_dir: override?.base_dir,
    is_overridden: Boolean(override),
    is_default_source: Boolean(defaultSource),
    path_exists: exists,
    host_id: storedSource?.host_id ?? hostName,
    last_sync: storedSource?.last_sync ?? null,
    sync_status: !exists ? "error" : configChangedSinceLastSync ? "stale" : storedSource?.sync_status ?? "stale",
    error_message: !exists
      ? `Configured directory does not exist: ${configuredSource.base_dir}`
      : configChangedSinceLastSync
        ? "Source directory changed after the last sync. Run a rescan to load data from the new path."
        : storedSource?.error_message,
    total_blobs: storedSource?.total_blobs ?? 0,
    total_records: storedSource?.total_records ?? 0,
    total_fragments: storedSource?.total_fragments ?? 0,
    total_atoms: storedSource?.total_atoms ?? 0,
    total_sessions: storedSource?.total_sessions ?? 0,
    total_turns: storedSource?.total_turns ?? 0,
  };
}

async function readSourceConfig(sourceConfigPath: string): Promise<{ overrides: SourceOverrideMap; extras: ManualSourceRecord[] }> {
  try {
    const payload = JSON.parse(await readFile(sourceConfigPath, "utf8")) as Partial<PersistedSourceConfig> & {
      version?: number;
    };
    if (!payload || typeof payload !== "object") {
      return { overrides: {}, extras: [] };
    }

    const overrides = Object.fromEntries(
      Object.entries(payload.overrides ?? {})
        .filter(([, value]) => typeof value?.base_dir === "string" && value.base_dir.trim().length > 0)
        .map(([sourceId, value]) => [
          sourceId,
          {
            base_dir: value.base_dir.trim(),
            updated_at:
              typeof value.updated_at === "string" && value.updated_at.length > 0
                ? value.updated_at
                : new Date().toISOString(),
          },
        ]),
    );
    const extras =
      payload.version === 2 && Array.isArray(payload.extras)
        ? payload.extras
            .filter(
              (value): value is ManualSourceRecord =>
                typeof value?.id === "string" &&
                typeof value?.family === "string" &&
                typeof value?.platform === "string" &&
                typeof value?.display_name === "string" &&
                typeof value?.base_dir === "string" &&
                value.id.trim().length > 0 &&
                value.base_dir.trim().length > 0,
            )
            .map((value) => ({
              ...value,
              id: value.id.trim(),
              slot_id:
                typeof value.slot_id === "string" && value.slot_id.trim().length > 0
                  ? value.slot_id.trim()
                  : deriveSourceSlotId(value.platform),
              display_name: value.display_name.trim() || value.platform,
              base_dir: value.base_dir.trim(),
              created_at:
                typeof value.created_at === "string" && value.created_at.length > 0
                  ? value.created_at
                  : new Date().toISOString(),
              updated_at:
                typeof value.updated_at === "string" && value.updated_at.length > 0
                  ? value.updated_at
                  : new Date().toISOString(),
            }))
        : [];

    return { overrides, extras };
  } catch {
    return { overrides: {}, extras: [] };
  }
}

async function writeSourceConfig(
  sourceConfigPath: string,
  config: { overrides: SourceOverrideMap; extras: ManualSourceRecord[] },
): Promise<void> {
  await writeFile(
    sourceConfigPath,
    JSON.stringify(
      {
        version: 2,
        overrides: config.overrides,
        extras: config.extras,
      } satisfies PersistedSourceConfig,
      null,
      2,
    ),
    "utf8",
  );
}

function createManualSourceRecord(
  sourceTemplate: SourceDefinition,
  baseDir: string,
  displayName?: string,
): ManualSourceRecord {
  const normalizedBaseDir = baseDir.trim();
  const now = new Date().toISOString();
  return {
    id: deriveSourceInstanceId({
      host_id: deriveHostId(os.hostname()),
      slot_id: sourceTemplate.slot_id || deriveSourceSlotId(sourceTemplate.platform),
      base_dir: normalizedBaseDir,
    }),
    slot_id: sourceTemplate.slot_id || deriveSourceSlotId(sourceTemplate.platform),
    family: sourceTemplate.family,
    platform: sourceTemplate.platform,
    display_name: displayName?.trim() || `${sourceTemplate.display_name} (manual)`,
    base_dir: normalizedBaseDir,
    created_at: now,
    updated_at: now,
  };
}

function hasMeaningfulStoredSourceData(source: {
  total_blobs: number;
  total_records: number;
  total_fragments: number;
  total_atoms: number;
  total_sessions: number;
  total_turns: number;
}): boolean {
  return (
    source.total_blobs > 0 ||
    source.total_records > 0 ||
    source.total_fragments > 0 ||
    source.total_atoms > 0 ||
    source.total_sessions > 0 ||
    source.total_turns > 0
  );
}

function dedupeSourceDefinitions(sources: readonly SourceDefinition[]): SourceDefinition[] {
  const seen = new Set<string>();
  const unique: SourceDefinition[] = [];
  for (const source of sources) {
    if (seen.has(source.id)) {
      continue;
    }
    seen.add(source.id);
    unique.push(source);
  }
  return unique;
}

function normalizePathKey(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/u, "");
}
