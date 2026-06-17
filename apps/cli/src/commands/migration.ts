import {
  backfillStorageBoundaryV2ForStore,
  type BackfillStoreResult,
  listMigrationStates,
  readStorageBoundaryMigrationPreview,
  type StorageBoundaryMigrationPreview,
} from "@cchistory/storage";
import type { CommandContext, CommandOutput } from "../main.js";
import { openStorage, resolveStoreLayout, type StoreLayout } from "../store.js";
import { formatNumber, renderKeyValue, renderSection, renderTable } from "../renderers.js";

export async function handleMigration(context: CommandContext): Promise<CommandOutput> {
  const subcommand = context.commandPath[1];
  if (!subcommand) {
    throw new Error("`migration` requires a subcommand: preview, run, or status.");
  }
  if (context.positionals.length > 0) {
    throw new Error(`\`migration ${subcommand}\` does not take positional arguments.`);
  }

  const layout = resolveStoreLayout({
    cwd: context.io.cwd,
    storeArg: context.globals.store,
    dbArg: context.globals.db,
  });
  // Check store exists for write/status paths; preview tolerates a missing
  // store so operators can run it before sync.
  switch (subcommand) {
    case "preview":
      return runMigrationPreview(context, layout);
    case "run":
      return runMigrationRun(context, layout);
    case "status":
      return runMigrationStatus(layout);
    default:
      throw new Error(`Unknown migration subcommand: ${subcommand}`);
  }
}

async function runMigrationPreview(context: CommandContext, layout: StoreLayout): Promise<CommandOutput> {
  if (context.globals.full) {
    throw new Error("`migration preview` is read-only and does not support --full.");
  }
  const preview = await readStorageBoundaryMigrationPreview({ dbPath: layout.dbPath });
  return {
    text: renderPreview(preview),
    json: {
      kind: "migration-preview",
      preview,
    },
  };
}

async function runMigrationRun(context: CommandContext, layout: StoreLayout): Promise<CommandOutput> {
  // B.3 rewrites V2 state per source; --dry-run reports what would happen
  // without writing so the operator can audit the preview first.
  const dryRun = context.globals.dryRun;
  if (dryRun) {
    const preview = await readStorageBoundaryMigrationPreview({ dbPath: layout.dbPath });
    return {
      text: [
        renderKeyValue([
          ["Workflow", "migration run"],
          ["Mode", "preview (--dry-run)"],
          ["Would backfill sources", formatNumber(preview.affected.sources)],
          ["Backfill gap", `${formatNumber(preview.backfill.total_missing)} missing V2 rows`],
        ]),
        "",
        "Re-run without --dry-run to write V2 sidecars. V1 payloads are not touched.",
      ].join("\n"),
      json: {
        kind: "migration-run-dry-run",
        preview,
      },
    };
  }

  const storage = await openStorage(layout);
  try {
    const result = backfillStorageBoundaryV2ForStore({
      storage,
      sourceIds: context.options.source.length > 0 ? context.options.source : undefined,
    });
    return {
      text: renderRunResult(result),
      json: {
        kind: "migration-run",
        result,
      },
    };
  } finally {
    storage.close();
  }
}

async function runMigrationStatus(layout: StoreLayout): Promise<CommandOutput> {
  const preview = await readStorageBoundaryMigrationPreview({ dbPath: layout.dbPath });
  const storage = await openStorage(layout);
  try {
    const states = listMigrationStates(storage.getDatabaseForMigration());
    return {
      text: renderStatus(preview, states),
      json: {
        kind: "migration-status",
        preview,
        states,
      },
    };
  } finally {
    storage.close();
  }
}

function renderRunResult(result: BackfillStoreResult): string {
  const lines = [
    renderSection(
      "Migration Run (B.3)",
      renderKeyValue([
        ["Sources total", formatNumber(result.sources_total)],
        ["Processed", formatNumber(result.sources_processed)],
        ["Skipped (already completed)", formatNumber(result.sources_skipped)],
        ["Aborted", formatNumber(result.sources_aborted)],
        ["Halted at", result.halted_at_source_id ?? "(none)"],
      ]),
    ),
  ];
  if (result.results.length > 0) {
    lines.push("", renderSection("Per-source", renderRunResultTable(result)));
  }
  if (result.halted_at_source_id) {
    lines.push(
      "",
      `Migration halted at source ${result.halted_at_source_id}. Audit the abort reason, clear with \`cchistory migration reset\`, then re-run \`cchistory migration run\`.`,
    );
  }
  return lines.join("\n");
}

function renderRunResultTable(result: BackfillStoreResult): string {
  return renderTable(
    ["Source", "Status", "Records", "Turns", "Blobs", "Error"],
    result.results.map((row) => [
      row.source_id,
      row.skipped ? "skipped" : row.aborted ? "aborted" : "completed",
      row.counts ? formatNumber(row.counts.records) : "-",
      row.counts ? formatNumber(row.counts.turns) : "-",
      row.counts ? formatNumber(row.counts.blobs) : "-",
      row.error ?? "",
    ]),
  );
}

function renderStatus(
  preview: StorageBoundaryMigrationPreview,
  states: ReturnType<typeof listMigrationStates>,
): string {
  const completed = states.filter((s) => s.status === "completed").length;
  const running = states.filter((s) => s.status === "running").length;
  const aborted = states.filter((s) => s.status === "aborted").length;
  return [
    renderSection(
      "Migration Status",
      renderKeyValue([
        ["Store", preview.db_path],
        ["Affected sources", formatNumber(preview.affected.sources)],
        ["B.3 markers", `${completed} completed / ${running} running / ${aborted} aborted`],
        ["Backfill gap remaining", `${formatNumber(preview.backfill.total_missing)} rows`],
      ]),
    ),
    states.length > 0
      ? renderSection(
          "Markers",
          renderTable(
            ["Phase", "Scope", "Status", "Started", "Error"],
            states.map((s) => [
              s.phase,
              `${s.scope_kind}:${s.scope_id}`,
              s.status,
              s.started_at,
              s.last_error,
            ]),
          ),
        )
      : "(no migration markers yet — run `cchistory migration run`)",
  ].join("\n\n");
}

function renderPreview(preview: StorageBoundaryMigrationPreview): string {
  return [
    renderSection(
      "Migration Preview (B.1)",
      renderKeyValue([
        ["Store", preview.db_path],
        ["Schema", preview.schema_version ?? "(unknown)"],
        ["Generated", preview.generated_at],
      ]),
    ),
    "",
    renderSection(
      "Affected",
      renderKeyValue([
        ["Sources", formatNumber(preview.affected.sources)],
        ["Sessions", formatNumber(preview.affected.sessions)],
        ["Turns", formatNumber(preview.affected.turns)],
      ]),
    ),
    "",
    renderSection("V1 → V2 Mapping", renderMappingTable(preview.v1_to_v2_mapping)),
    "",
    renderSection(
      "Backfill Gap (B.3 will need to reconstruct these)",
      renderKeyValue([
        ["user_turns → user_turns_v2", formatNumber(preview.backfill.missing_user_turns_v2)],
        ["turn_contexts → turn_context_refs_v2", formatNumber(preview.backfill.missing_turn_context_refs_v2)],
        ["raw_records → parsed_record_spans", formatNumber(preview.backfill.missing_parsed_record_spans)],
        ["captured_blobs → evidence_captures", formatNumber(preview.backfill.missing_evidence_captures)],
        ["Total missing", formatNumber(preview.backfill.total_missing)],
      ]),
    ),
    "",
    renderSection("Removable V1 payload_json bytes (B.6a)", renderRemovableTable(preview.removable)),
    "",
    renderSection(
      "VACUUM Disk Requirement (B.6b)",
      renderKeyValue([
        ["Current DB size", formatBytes(preview.vacuum.current_db_bytes)],
        ["Required free space", formatBytes(preview.vacuum.required_free_bytes)],
        ["Available free space", formatBytes(preview.vacuum.available_free_bytes)],
        ["Disk total size", formatBytes(preview.vacuum.available_total_bytes)],
        ["Sufficient", preview.vacuum.sufficient ? "yes" : "NO — free disk before B.6b"],
      ]),
    ),
    "",
    renderSection(
      "Recommended pre-migration backup",
      preview.recommended_backup_command,
    ),
    "",
    "Phase B is destructive past B.6. Back up the store before running B.3.",
  ].join("\n");
}

function renderMappingTable(mapping: StorageBoundaryMigrationPreview["v1_to_v2_mapping"]): string {
  const rows: Array<[string, string, string, string]> = [
    ["user_turns → user_turns_v2", String(mapping.user_turns.v1_rows), String(mapping.user_turns.v2_rows), String(mapping.user_turns.missing)],
    ["turn_contexts → turn_context_refs_v2", String(mapping.turn_contexts.v1_rows), String(mapping.turn_contexts.v2_rows), String(mapping.turn_contexts.missing)],
    ["raw_records → parsed_record_spans", String(mapping.raw_records.v1_rows), String(mapping.raw_records.v2_rows), String(mapping.raw_records.missing)],
    ["captured_blobs → evidence_captures", String(mapping.captured_blobs.v1_rows), String(mapping.captured_blobs.v2_rows), String(mapping.captured_blobs.missing)],
  ];
  return renderTable(["Mapping", "V1 rows", "V2 rows", "Missing"], rows, {
    align: ["left", "right", "right", "right"],
  });
}

function renderRemovableTable(removable: StorageBoundaryMigrationPreview["removable"]): string {
  const rows: Array<[string, string]> = [
    ["raw_records.payload_json", formatBytes(removable.raw_records_payload_bytes)],
    ["source_fragments.payload_json", formatBytes(removable.source_fragments_payload_bytes)],
    ["conversation_atoms.payload_json", formatBytes(removable.conversation_atoms_payload_bytes)],
    ["atom_edges.payload_json", formatBytes(removable.atom_edges_payload_bytes)],
    ["derived_candidates.payload_json", formatBytes(removable.derived_candidates_payload_bytes)],
    ["user_turns.payload_json", formatBytes(removable.user_turns_payload_bytes)],
    ["turn_contexts.payload_json", formatBytes(removable.turn_contexts_payload_bytes)],
    ["captured_blobs.payload_json", formatBytes(removable.captured_blobs_payload_bytes)],
    ["sessions.payload_json", formatBytes(removable.sessions_payload_bytes)],
    ["TOTAL removable", formatBytes(removable.total_bytes)],
  ];
  return renderTable(["Source", "Bytes"], rows, { align: ["left", "right"] });
}

function formatBytes(value: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const decimals = unitIndex === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(decimals)}${units[unitIndex]}`;
}
