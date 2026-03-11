import { stat } from "node:fs/promises";
import process from "node:process";
import { getDefaultSources, runSourceProbe } from "../packages/source-adapters/dist/index.js";

const args = process.argv.slice(2);
const sourceIds = [];
let limit = 1;
let json = false;

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--json") {
    json = true;
    continue;
  }
  if (arg === "--source-id" && args[index + 1]) {
    sourceIds.push(args[index + 1]);
    index += 1;
    continue;
  }
  if (arg.startsWith("--source-id=")) {
    sourceIds.push(arg.slice("--source-id=".length));
    continue;
  }
  if (arg === "--limit" && args[index + 1]) {
    limit = Number.parseInt(args[index + 1], 10);
    index += 1;
    continue;
  }
  if (arg.startsWith("--limit=")) {
    limit = Number.parseInt(arg.slice("--limit=".length), 10);
  }
}

if (!Number.isFinite(limit) || limit <= 0) {
  console.error("Expected --limit to be a positive integer.");
  process.exit(1);
}

const discovered = await Promise.all(
  getDefaultSources().map(async (source) => ({
    ...source,
    exists: await pathExists(source.base_dir),
  })),
);

const existingSourceIds = discovered.filter((source) => source.exists).map((source) => source.id);
const selectedSourceIds = sourceIds.length > 0 ? sourceIds : existingSourceIds.slice(0, 1);

if (selectedSourceIds.length === 0) {
  console.error("No local source roots were found for the smoke probe.");
  console.error(JSON.stringify({ discovered }, null, 2));
  process.exit(1);
}

for (const sourceId of selectedSourceIds) {
  if (!discovered.some((source) => source.id === sourceId && source.exists)) {
    console.error(`Source is not available for smoke probe: ${sourceId}`);
    console.error(JSON.stringify({ discovered }, null, 2));
    process.exit(1);
  }
}

const result = await runSourceProbe({
  source_ids: selectedSourceIds,
  limit_files_per_source: limit,
});

const summary = {
  host_id: result.host.id,
  source_ids: selectedSourceIds,
  limit_files_per_source: limit,
  sources: result.sources.map((payload) => ({
    source_id: payload.source.id,
    platform: payload.source.platform,
    sync_status: payload.source.sync_status,
    counts: {
      blobs: payload.blobs.length,
      records: payload.records.length,
      fragments: payload.fragments.length,
      atoms: payload.atoms.length,
      candidates: payload.candidates.length,
      sessions: payload.sessions.length,
      turns: payload.turns.length,
      loss_audits: payload.loss_audits.length,
    },
  })),
};

if (json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`host_id=${summary.host_id}`);
  console.log(`source_ids=${summary.source_ids.join(",")}`);
  console.log(`limit_files_per_source=${summary.limit_files_per_source}`);
  for (const source of summary.sources) {
    console.log(
      [
        `${source.source_id}(${source.platform})`,
        `status=${source.sync_status}`,
        `blobs=${source.counts.blobs}`,
        `records=${source.counts.records}`,
        `fragments=${source.counts.fragments}`,
        `atoms=${source.counts.atoms}`,
        `candidates=${source.counts.candidates}`,
        `sessions=${source.counts.sessions}`,
        `turns=${source.counts.turns}`,
        `loss_audits=${source.counts.loss_audits}`,
      ].join(" "),
    );
  }
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}
