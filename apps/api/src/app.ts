import { mkdirSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { copyFile, readFile, rename, stat, writeFile } from "node:fs/promises";
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
} from "@cchistory/domain";
import { getDefaultSources, getDefaultSourcesForHost, runSourceProbe } from "@cchistory/source-adapters";
import { CCHistoryStorage } from "@cchistory/storage";
import { resolveDefaultCchistoryDataDir } from "@cchistory/storage/store-layout";
import {
  readRemoteAgentState,
} from "./remote-agent.js";

import { buildOpenApiDocument } from "./utils/openapi.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerSourceRoutes, type ConfiguredSourceStatus, type ManualSourceRecord, type SourceOverrideMap, type SourceOverrideRecord } from "./routes/sources.js";
import { registerDataRoutes } from "./routes/data.js";
import { normalizePathKey } from "./utils/summarizers.js";

export interface ApiRuntimeOptions {
  dataDir?: string;
  cwd?: string;
  homeDir?: string;
  probeRunner?: typeof runSourceProbe;
  sources?: readonly SourceDefinition[];
  storage?: CCHistoryStorage;
  agentPairingToken?: string;
}

export interface ApiRuntime {
  app: FastifyInstance;
  dataDir: string;
  rawStoreDir: string;
  storage: CCHistoryStorage;
}

interface PersistedSourceConfig {
  version: 2;
  overrides: SourceOverrideMap;
  extras: ManualSourceRecord[];
}

export async function createApiRuntime(options: ApiRuntimeOptions = {}): Promise<ApiRuntime> {
  const hostName = os.hostname();
  const hostId = deriveHostId(hostName);
  const dataDir =
    options.dataDir ??
    process.env.CCHISTORY_API_DATA_DIR ??
    resolveDefaultCchistoryDataDir({ cwd: options.cwd ?? process.cwd(), homeDir: options.homeDir });
  const rawStoreDir = path.join(dataDir, "raw");
  const sourceConfigPath = path.join(dataDir, "source-overrides.json");
  const remoteAgentStatePath = path.join(dataDir, "remote-agents.json");
  const probeRunner = options.probeRunner ?? runSourceProbe;
  const defaultSourceDefinitions = normalizeConfiguredSourceDefinitions(
    options.sources ?? getDefaultSourcesForHost({ includeMissing: true }),
    hostId,
  );
  let sourceConfig = normalizePersistedSourceConfig(await readSourceConfig(sourceConfigPath), hostId);
  let remoteAgentState = await readRemoteAgentState(remoteAgentStatePath);
  const agentPairingToken = options.agentPairingToken ?? process.env.CCHISTORY_AGENT_PAIRING_TOKEN;

  mkdirSync(rawStoreDir, { recursive: true });

  const storage = options.storage ?? new CCHistoryStorage(dataDir);
  const app = Fastify({ logger: false, bodyLimit: 32 * 1024 * 1024 });
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
      if (request.url === "/health" || request.url === "/openapi.json" || request.url.startsWith("/api/agent/")) {
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

  registerAgentRoutes(app, {
    storage,
    getRemoteAgentState: () => remoteAgentState,
    setRemoteAgentState: (state) => { remoteAgentState = state; },
    remoteAgentStatePath,
    agentPairingToken,
    rawStoreDir,
  });

  registerSourceRoutes(app, {
    storage,
    listConfiguredSourceStatuses,
    getConfiguredSourceStatus,
    getConfiguredSourceDefinition,
    getDefaultSourceDefinition,
    getDefaultSourceTemplateByPlatform,
    getSourceConfig: () => sourceConfig,
    setSourceConfig: async (config) => {
      sourceConfig = config;
      await writeSourceConfig(sourceConfigPath, config);
    },
    syncSources,
    createManualSourceRecord: (template, baseDir, displayName) => createManualSourceRecord(template, baseDir, displayName, hostId),
    normalizePathKey,
  });

  registerDataRoutes(app, { storage });

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

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
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
  const tmpPath = `${sourceConfigPath}.tmp`;
  await writeFile(
    tmpPath,
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
  await rename(tmpPath, sourceConfigPath);
}

function createManualSourceRecord(
  sourceTemplate: SourceDefinition,
  baseDir: string,
  displayName: string | undefined,
  hostId: string,
): ManualSourceRecord {
  const normalizedBaseDir = baseDir.trim();
  const now = new Date().toISOString();
  return {
    id: deriveSourceInstanceId({
      host_id: hostId,
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
