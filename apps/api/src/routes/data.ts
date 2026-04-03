import type { FastifyInstance } from "fastify";
import { getBuiltinMaskTemplates } from "@cchistory/source-adapters";
import type { CCHistoryStorage } from "@cchistory/storage";
import {
  asOptionalNumber,
  inferOverrideDisplayName,
  splitCsv,
  stableManualProjectId,
  summarizeLinkingReview,
  summarizeSearchResult,
  summarizeTurn,
} from "../utils/summarizers.js";

export interface DataRoutesContext {
  storage: CCHistoryStorage;
}

export function registerDataRoutes(app: FastifyInstance, context: DataRoutesContext) {
  const { storage } = context;

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

  app.get("/api/admin/sessions/:sessionId/related-work", async (request, reply) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const session = storage.getResolvedSession(sessionId) ?? storage.getSession(sessionId);
    if (!session) {
      reply.code(404);
      return { error: `Session not found: ${sessionId}` };
    }
    return { related_work: storage.getSessionRelatedWork(sessionId) };
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
}
