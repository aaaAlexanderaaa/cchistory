import type { FastifyInstance } from "fastify";
import type { SourceDefinition } from "@cchistory/domain";
import type { CCHistoryStorage } from "@cchistory/storage";
import { summarizeRun } from "../utils/summarizers.js";

export interface SourceOverrideRecord {
  base_dir: string;
  updated_at: string;
}

export type SourceOverrideMap = Record<string, SourceOverrideRecord>;

export interface ManualSourceRecord extends SourceDefinition {
  created_at: string;
  updated_at: string;
}

export interface ConfiguredSourceStatus {
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

export interface SourceRoutesContext {
  storage: CCHistoryStorage;
  listConfiguredSourceStatuses: () => Promise<ConfiguredSourceStatus[]>;
  getConfiguredSourceStatus: (sourceId: string) => Promise<ConfiguredSourceStatus | undefined>;
  getConfiguredSourceDefinition: (sourceId: string) => SourceDefinition | undefined;
  getDefaultSourceDefinition: (sourceId: string) => SourceDefinition | undefined;
  getDefaultSourceTemplateByPlatform: (platform: SourceDefinition["platform"]) => SourceDefinition | undefined;
  getSourceConfig: () => { overrides: SourceOverrideMap; extras: ManualSourceRecord[] };
  setSourceConfig: (config: { overrides: SourceOverrideMap; extras: ManualSourceRecord[] }) => Promise<void>;
  syncSources: (options: { source_ids?: string[]; limit_files_per_source?: number; persist: boolean }) => Promise<any>;
  createManualSourceRecord: (template: SourceDefinition, baseDir: string, displayName?: string) => ManualSourceRecord;
  normalizePathKey: (value: string) => string;
}

export function registerSourceRoutes(app: FastifyInstance, context: SourceRoutesContext) {
  app.get("/api/admin/source-config", async () => ({
    sources: await context.listConfiguredSourceStatuses(),
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

    const sourceTemplate = context.getDefaultSourceTemplateByPlatform(platform);
    if (!sourceTemplate) {
      reply.code(404);
      return { error: `Unsupported source platform: ${platform}` };
    }

    // This part is tricky because it calls getConfiguredSources() in app.ts
    // I'll assume getConfiguredSources is available via context if needed, or I'll just use listConfiguredSourceStatuses
    const statuses = await context.listConfiguredSourceStatuses();
    const existingSource = statuses.find(
      (source) => source.platform === platform && context.normalizePathKey(source.base_dir) === context.normalizePathKey(nextBaseDir),
    );
    if (existingSource) {
      return {
        source: await context.getConfiguredSourceStatus(existingSource.id),
        synced: false,
      };
    }

    const manualSource = context.createManualSourceRecord(sourceTemplate, nextBaseDir, body.display_name);
    const sourceConfig = context.getSourceConfig();
    const nextSourceConfig = {
      ...sourceConfig,
      extras: [...sourceConfig.extras.filter((source) => source.id !== manualSource.id), manualSource],
    };
    await context.setSourceConfig(nextSourceConfig);

    const synced = body.sync ?? true;
    if (synced) {
      await context.syncSources({
        source_ids: [manualSource.id],
        limit_files_per_source: body.limit_files_per_source,
        persist: true,
      });
    }

    return {
      source: await context.getConfiguredSourceStatus(manualSource.id),
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
    const configuredSource = context.getConfiguredSourceDefinition(sourceId);
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

    const defaultSource = context.getDefaultSourceDefinition(sourceId);
    const sourceConfig = context.getSourceConfig();
    let nextSourceConfig;
    if (defaultSource) {
      nextSourceConfig = {
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
      nextSourceConfig = {
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
    await context.setSourceConfig(nextSourceConfig);

    const synced = body.sync ?? true;
    if (synced) {
      await context.syncSources({
        source_ids: [sourceId],
        limit_files_per_source: body.limit_files_per_source,
        persist: true,
      });
    }

    return {
      source: await context.getConfiguredSourceStatus(sourceId),
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
    if (!context.getDefaultSourceDefinition(sourceId)) {
      reply.code(400);
      return { error: `Source ${sourceId} does not support reset` };
    }

    const body = (request.body ?? {}) as {
      sync?: boolean;
      limit_files_per_source?: number;
    };

    const sourceConfig = context.getSourceConfig();
    if (sourceConfig.overrides[sourceId]) {
      const nextOverrides = { ...sourceConfig.overrides };
      delete nextOverrides[sourceId];
      await context.setSourceConfig({
        ...sourceConfig,
        overrides: nextOverrides,
      });
    }

    const synced = body.sync ?? true;
    if (synced) {
      await context.syncSources({
        source_ids: [sourceId],
        limit_files_per_source: body.limit_files_per_source,
        persist: true,
      });
    }

    return {
      source: await context.getConfiguredSourceStatus(sourceId),
      synced,
    };
  });

  app.get("/api/admin/probe/sources", async () => {
    return {
      sources: await context.listConfiguredSourceStatuses(),
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
    const result = await context.syncSources({
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
    const result = await context.syncSources({
      source_ids: body.source_ids,
      limit_files_per_source: body.limit_files_per_source,
      persist: false,
    });
    return summarizeRun(result, { storage: context.storage, includeDiff: true });
  });

  app.get("/api/sources", async () => {
    return {
      sources: await context.listConfiguredSourceStatuses(),
    };
  });
}
