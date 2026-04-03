import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type SourceSyncPayload } from "@cchistory/domain";
import { getDefaultSourcesForHost, runSourceProbe } from "@cchistory/source-adapters";
import {
  applyRemoteUploadSuccess,
  buildLocalRemoteAgentState,
  buildRemoteSourceManifestEntries,
  completeRemoteAgentJob,
  createEmptyRemoteBundlePayload,
  defaultRemoteAgentStatePath,
  encodeBundleForRemoteUpload,
  leaseRemoteAgentJob,
  pairRemoteAgent,
  readLocalRemoteAgentState,
  uploadRemoteAgentBundle,
  writeLocalRemoteAgentState,
} from "../remote-agent.js";
import {
  getFlag,
  getFlagValues,
  hasFlag,
  parseNumberFlag,
  requireFlag,
  type ParsedArgs,
} from "../args.js";
import { exportBundle } from "../bundle.js";
import { createStorage } from "../store.js";
import { formatError, type CliIo, type CommandOutput } from "../main.js";
import { applySourceSelection } from "./sync.js";

export async function handleAgent(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const [subcommand, ...rest] = parsed.positionals;
  const nextParsed: ParsedArgs = { ...parsed, positionals: rest };
  switch (subcommand) {
    case "pair":
      return handleAgentPair(nextParsed);
    case "upload":
      return handleAgentUpload(nextParsed);
    case "schedule":
      return handleAgentSchedule(nextParsed);
    case "pull":
      return handleAgentPull(nextParsed);
    default:
      throw new Error("Usage: cchistory agent pair|upload|schedule|pull ...");
  }
}

async function handleAgentPair(parsed: ParsedArgs): Promise<CommandOutput> {
  const serverUrl = requireFlag(parsed, "server");
  const pairingToken = requireFlag(parsed, "pair-token");
  const statePath = getFlag(parsed, "state-file") ?? defaultRemoteAgentStatePath();
  const response = await pairRemoteAgent(serverUrl, pairingToken, {
    displayName: getFlag(parsed, "display-name"),
    reportedHostname: getFlag(parsed, "reported-hostname") ?? os.hostname(),
  });
  const state = buildLocalRemoteAgentState(serverUrl, response);
  await writeLocalRemoteAgentState(statePath, state);
  return {
    text: [
      `Paired remote agent ${response.agent_id}`,
      `Server: ${state.server_url}`,
      `State File: ${statePath}`,
    ].join("\n"),
    json: {
      command: "agent-pair",
      server_url: state.server_url,
      state_file: statePath,
      agent_id: response.agent_id,
      paired_at: response.paired_at,
    },
  };
}

async function handleAgentUpload(parsed: ParsedArgs): Promise<CommandOutput> {
  const result = await runAgentUploadCycle(parsed);
  return {
    text: [
      `Uploaded remote agent bundle ${result.uploadResult.bundle_id}`,
      `Imported: ${result.uploadResult.imported_source_ids.length}`,
      `Replaced: ${result.uploadResult.replaced_source_ids.length}`,
      `Skipped: ${result.uploadResult.skipped_source_ids.length}`,
      `Manifest Entries: ${result.uploadResult.source_manifest_count}`,
      `State File: ${result.statePath}`,
    ].join("\n"),
    json: {
      command: "agent-upload",
      state_file: result.statePath,
      bundle_id: result.uploadResult.bundle_id,
      imported_source_ids: result.uploadResult.imported_source_ids,
      replaced_source_ids: result.uploadResult.replaced_source_ids,
      skipped_source_ids: result.uploadResult.skipped_source_ids,
      source_manifest: result.manifest.entries,
      attempts: result.attempts,
    },
  };
}

async function handleAgentSchedule(parsed: ParsedArgs): Promise<CommandOutput> {
  const intervalSeconds = parseNumberFlag(parsed, "interval-seconds");
  const iterations = parseNumberFlag(parsed, "iterations");
  if (intervalSeconds === undefined) {
    throw new Error("Missing required --interval-seconds flag.");
  }
  if (iterations !== undefined && (!Number.isInteger(iterations) || iterations <= 0)) {
    throw new Error("--iterations must be a positive integer when provided.");
  }

  const targetIterations = iterations ?? 1;
  const cycleResults: Array<{
    bundle_id: string;
    imported: number;
    replaced: number;
    skipped: number;
    attempts: number;
  }> = [];
  let statePath = getFlag(parsed, "state-file") ?? defaultRemoteAgentStatePath();

  for (let iteration = 0; iteration < targetIterations; iteration += 1) {
    const cycle = await runAgentUploadCycle(parsed);
    statePath = cycle.statePath;
    cycleResults.push({
      bundle_id: cycle.uploadResult.bundle_id,
      imported: cycle.uploadResult.imported_source_ids.length,
      replaced: cycle.uploadResult.replaced_source_ids.length,
      skipped: cycle.uploadResult.skipped_source_ids.length,
      attempts: cycle.attempts,
    });
    if (iteration < targetIterations - 1) {
      await sleep(Math.max(0, intervalSeconds) * 1000);
    }
  }

  return {
    text: [
      `Completed ${cycleResults.length} scheduled remote-agent cycle(s)`,
      `State File: ${statePath}`,
      ...cycleResults.map((cycle, index) => `Cycle ${index + 1}: bundle=${cycle.bundle_id} imported=${cycle.imported} replaced=${cycle.replaced} skipped=${cycle.skipped} attempts=${cycle.attempts}`),
    ].join("\n"),
    json: {
      command: "agent-schedule",
      state_file: statePath,
      interval_seconds: intervalSeconds,
      iterations: cycleResults.length,
      cycles: cycleResults,
    },
  };
}

async function handleAgentPull(parsed: ParsedArgs): Promise<CommandOutput> {
  const statePath = getFlag(parsed, "state-file") ?? defaultRemoteAgentStatePath();
  const state = await readLocalRemoteAgentState(statePath);
  const leased = await leaseRemoteAgentJob({ state });
  if (!leased.job) {
    return {
      text: [
        "No leased remote-agent jobs available",
        `State File: ${statePath}`,
      ].join("\n"),
      json: {
        command: "agent-pull",
        state_file: statePath,
        job: null,
      },
    };
  }

  try {
    const cycle = await runAgentUploadCycle(parsed, {
      sourceRefs: leased.job.source_slots === "all" ? [] : leased.job.source_slots,
      force: leased.job.sync_mode === "force_snapshot",
      limitFiles: leased.job.limit_files_per_source,
      jobId: leased.job.job_id,
    });
    const completion = await completeRemoteAgentJob({
      state,
      jobId: leased.job.job_id,
      status: "succeeded",
      bundleId: cycle.uploadResult.bundle_id,
      importedSourceIds: cycle.uploadResult.imported_source_ids,
      replacedSourceIds: cycle.uploadResult.replaced_source_ids,
      skippedSourceIds: cycle.uploadResult.skipped_source_ids,
    });
    return {
      text: [
        `Completed leased remote-agent job ${leased.job.job_id}`,
        `Bundle: ${cycle.uploadResult.bundle_id}`,
        `Imported: ${cycle.uploadResult.imported_source_ids.length}`,
        `Replaced: ${cycle.uploadResult.replaced_source_ids.length}`,
        `Skipped: ${cycle.uploadResult.skipped_source_ids.length}`,
        `State File: ${cycle.statePath}`,
      ].join("\n"),
      json: {
        command: "agent-pull",
        state_file: cycle.statePath,
        job: leased.job,
        bundle_id: cycle.uploadResult.bundle_id,
        imported_source_ids: cycle.uploadResult.imported_source_ids,
        replaced_source_ids: cycle.uploadResult.replaced_source_ids,
        skipped_source_ids: cycle.uploadResult.skipped_source_ids,
        completed_at: completion.completed_at,
      },
    };
  } catch (error) {
    try {
      await completeRemoteAgentJob({
        state,
        jobId: leased.job.job_id,
        status: "failed",
        errorMessage: formatError(error),
      });
    } catch {
      // ignore completion-report errors and surface the collection failure
    }
    throw error;
  }
}

export async function runAgentUploadCycle(parsed: ParsedArgs, overrides: {
  sourceRefs?: string[];
  limitFiles?: number;
  force?: boolean;
  jobId?: string;
} = {}): Promise<{
  statePath: string;
  manifest: ReturnType<typeof buildRemoteSourceManifestEntries>;
  uploadResult: Awaited<ReturnType<typeof uploadRemoteAgentBundle>>;
  attempts: number;
}> {
  const statePath = getFlag(parsed, "state-file") ?? defaultRemoteAgentStatePath();
  const state = await readLocalRemoteAgentState(statePath);
  const sourceRefs = overrides.sourceRefs ?? getFlagValues(parsed, "source");
  const limitFiles = overrides.limitFiles ?? parseNumberFlag(parsed, "limit-files");
  const includeRawBlobs = !hasFlag(parsed, "no-raw");
  const force = overrides.force ?? hasFlag(parsed, "force");
  const retryAttempts = Math.max(0, parseNumberFlag(parsed, "retry-attempts") ?? 0);
  const retryDelayMs = Math.max(0, parseNumberFlag(parsed, "retry-delay-ms") ?? 250);
  const selectedSources = applySourceSelection(getDefaultSourcesForHost({ includeMissing: true }), sourceRefs);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cchistory-agent-upload-"));
  const tempStoreDir = path.join(tempRoot, "store");
  const bundleDir = path.join(tempRoot, "bundle");
  const storage = await createStorage(tempStoreDir);

  try {
    const payloads: SourceSyncPayload[] = [];
    let collectedAt = new Date().toISOString();
    for (const source of selectedSources) {
      const result = await runSourceProbe(
        {
          source_ids: [source.id],
          limit_files_per_source: limitFiles,
        },
        [source],
      );
      for (const payload of result.sources) {
        collectedAt = payload.source.last_sync ?? collectedAt;
        storage.replaceSourcePayload(payload, { allow_host_rekey: true });
        payloads.push(payload);
      }
    }

    const manifest = buildRemoteSourceManifestEntries({ payloads, state, force });
    const uploadBundle = manifest.includedSourceIds.length === 0
      ? createEmptyRemoteBundlePayload(collectedAt)
      : await (async () => {
          const exportResult = await exportBundle({
            storage,
            bundleDir,
            sourceIds: manifest.includedSourceIds,
            includeRawBlobs,
          });
          return encodeBundleForRemoteUpload(bundleDir, exportResult);
        })();

    let attempts = 0;
    let uploadResult: Awaited<ReturnType<typeof uploadRemoteAgentBundle>> | undefined;
    let lastError: unknown;
    while (attempts <= retryAttempts) {
      attempts += 1;
      try {
        uploadResult = await uploadRemoteAgentBundle({
          state,
          collectedAt,
          jobId: overrides.jobId,
          bundle: await uploadBundle,
          sourceManifest: manifest.entries,
        });
        break;
      } catch (error) {
        lastError = error;
        if (attempts > retryAttempts) {
          throw error;
        }
        await sleep(retryDelayMs * 2 ** (attempts - 1));
      }
    }

    if (!uploadResult) {
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }

    const nextState = applyRemoteUploadSuccess({
      state,
      entries: manifest.entries,
      dirtyFingerprintBySourceId: manifest.dirtyFingerprintBySourceId,
    });
    await writeLocalRemoteAgentState(statePath, nextState);

    return {
      statePath,
      manifest,
      uploadResult,
      attempts,
    };
  } finally {
    storage.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function sleep(durationMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
}
