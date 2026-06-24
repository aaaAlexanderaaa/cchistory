import {
  backfillStorageBoundaryV2ForStore,
  type BackfillStoreResult,
  clearMigrationStatesByPhase,
  listMigrationStates,
  MIGRATION_PHASES,
  readStorageBoundaryMigrationPreview,
  runMigrationValidate,
  type BundleChecksumCompare,
  type MigrationPhase,
  type MigrationValidateResult,
  type MigrationValidatorKind,
  type MigrationValidatorOutcome,
  type StorageBoundaryMigrationPreview,
} from "@cchistory/storage";
import { mkdtemp, readFile, readdir, rm, stat, statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BundleChecksums, ImportBundleManifest } from "@cchistory/domain";
import type { CommandContext, CommandOutput } from "../main.js";
import { openStorage, resolveStoreLayout, type StoreLayout } from "../store.js";
import { exportBundle } from "../bundle.js";
import { formatNumber, renderKeyValue, renderSection, renderTable } from "../renderers.js";

export async function handleMigration(context: CommandContext): Promise<CommandOutput> {
  const subcommand = context.commandPath[1];
  if (!subcommand) {
    throw new Error("`migration` requires a subcommand: preview, run, status, validate, or reset.");
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
    case "validate":
      return runMigrationValidateHandler(context, layout);
    case "reset":
      return runMigrationReset(context, layout);
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

async function runMigrationReset(context: CommandContext, layout: StoreLayout): Promise<CommandOutput> {
  const phaseArg = context.options.phase;
  if (phaseArg !== undefined && phaseArg.length === 0) {
    throw new Error("`migration reset --phase <name>` requires a non-empty phase value.");
  }
  // Validate the phase name against the known set. Without this, a typo like
  // `storage-boundary.wirte` would DELETE 0 rows silently and the operator
  // would re-run `migration run` expecting the typo'd phase to be re-populated.
  // Mirror the ALLOWED_VALIDATORS gate already used by `migration validate`.
  let phase: MigrationPhase | undefined;
  if (phaseArg !== undefined) {
    if (!MIGRATION_PHASES.includes(phaseArg as MigrationPhase)) {
      throw new Error(
        `Unknown migration phase '${phaseArg}'. Valid phases: ${MIGRATION_PHASES.join(", ")}.`,
      );
    }
    phase = phaseArg as MigrationPhase;
  }
  const storage = await openStorage(layout);
  let rowsDeleted = 0;
  try {
    const db = storage.getDatabaseForMigration();
    // C4: refuse to clear while any marker is still 'running'. The C2 guard
    // in recordMigrationStart exists to prevent writer-collision resurrection
    // — but if an operator can wipe a live running marker via `reset`, two
    // processes end up in BEGIN IMMEDIATE on the same source_id and the
    // first COMMIT wins silently. Force the operator to acknowledge with
    // --force after confirming the prior PID is actually dead.
    const force = context.options.force;
    if (!force) {
      const running = listMigrationStates(db)
        .filter((row) => row.status === "running")
        .filter((row) => phase === undefined || row.phase === phase);
      if (running.length > 0) {
        const markerLines = running
          .map((row) => `  - ${row.phase}/${row.scope_kind}/${row.scope_id} (started ${row.started_at})`)
          .join("\n");
        throw new Error(
          `Refusing to reset migration_state: ${running.length} marker(s) are currently 'running'.\n` +
            `Clearing them while a migration is in progress can introduce the writer-collision the C2 guard exists to prevent — ` +
            `two processes racing on BEGIN IMMEDIATE for the same source_id, where the first COMMIT wins silently.\n\n` +
            `Audit via \`cchistory migration status\`, confirm the prior PID is actually dead (not just slow), then re-run with --force:\n` +
            markerLines,
        );
      }
    }
    rowsDeleted = clearMigrationStatesByPhase(db, phase);
  } finally {
    storage.close();
  }
  const lines = [
    renderSection(
      "Migration Reset (B.5.0)",
      renderKeyValue([
        ["Store", layout.dbPath],
        ["Phase", phase ?? "(all)"],
        ["Marker rows deleted", formatNumber(rowsDeleted)],
      ]),
    ),
  ];
  if (rowsDeleted > 0) {
    lines.push(
      "",
      phase
        ? `Re-run \`cchistory migration run\` (or \`cchistory migration validate\`) to re-populate ${phase}.`
        : "All migration_state markers cleared. Re-run the appropriate migration subcommand to re-populate them.",
    );
  }
  return {
    text: lines.join("\n"),
    json: {
      kind: "migration-reset",
      phase: phase ?? null,
      rows_deleted: rowsDeleted,
    },
  };
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

async function computeDirSizeBytes(dirPath: string): Promise<number> {
  let total = 0;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const childPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await computeDirSizeBytes(childPath);
    } else if (entry.isFile()) {
      try {
        total += (await stat(childPath)).size;
      } catch {
        // ignore unreadable entries
      }
    }
  }
  return total;
}

async function assertSufficientDiskForBundleExport(layout: StoreLayout): Promise<void> {
  // AGENTS.md Temp File And Disk Hygiene: artifacts >100 MiB must confirm
  // >=2x free space before creation. The B.4a post-bundle export lives in
  // /tmp (same FS as the operator store) and includes the store DB plus raw
  // blobs (includeRawBlobs: true), so the footprint is dbBytes + assetBytes.
  let dbBytes = 0;
  try {
    dbBytes = (await stat(layout.dbPath)).size;
  } catch {
    return; // dbPath missing — let openStorage surface a clearer error.
  }
  const assetBytes = await computeDirSizeBytes(layout.assetDir);
  const artifactBytes = dbBytes + assetBytes;
  const requiredBytes = artifactBytes * 2;
  const tmpDir = os.tmpdir();
  const fsInfo = await statfs(tmpDir);
  const freeBytes = Number(fsInfo.bavail) * Number(fsInfo.bsize);
  if (freeBytes < requiredBytes) {
    const shortfall = requiredBytes - freeBytes;
    throw new Error(
      [
        "Insufficient free disk space for B.4a bundle export.",
        `  Store DB:    ${formatBytes(dbBytes)} (${layout.dbPath})`,
        `  Asset dir:   ${formatBytes(assetBytes)} (${layout.assetDir})`,
        `  Artifact:    ${formatBytes(artifactBytes)} (DB + raw blobs)`,
        `  Required:    ${formatBytes(requiredBytes)} (2x artifact, per AGENTS.md temp file hygiene)`,
        `  Available:   ${formatBytes(freeBytes)} on ${tmpDir}`,
        `  Shortfall:   ${formatBytes(shortfall)}`,
        "Free disk before re-running `migration validate --only bundle`.",
      ].join("\n"),
    );
  }
}

const ALLOWED_VALIDATORS: readonly MigrationValidatorKind[] = ["bundle", "inventory", "read-paths", "v1-payload-digest"];

async function runMigrationValidateHandler(context: CommandContext, layout: StoreLayout): Promise<CommandOutput> {
  const requested = context.options.only;
  for (const value of requested) {
    if (!ALLOWED_VALIDATORS.includes(value as MigrationValidatorKind)) {
      throw new Error(
        `Invalid --only value: ${value}. Expected one of ${ALLOWED_VALIDATORS.join(", ")}.`,
      );
    }
  }
  const only = requested.length > 0 ? (requested as readonly MigrationValidatorKind[]) : undefined;
  const wantsBundle = only ? only.includes("bundle") : true;
  const preBundleDir = context.options.preBundle;
  if (wantsBundle && !preBundleDir) {
    throw new Error(
      "`migration validate` requires --pre-bundle <dir> when the bundle validator runs. Capture it via `cchistory export --out <dir>` BEFORE B.3, then `cchistory migration validate --pre-bundle <dir>`.",
    );
  }

  let postTempDir: string | undefined;
  let preCompare: BundleChecksumCompare | undefined;
  let postCompare: BundleChecksumCompare | undefined;
  try {
    if (wantsBundle) {
      // Scope the writable store handle to the bundle export only. The
      // validators below each open their own connection to the same DB file
      // (runMigrationValidate opens one for migration_state writes;
      // runReadPathParity / readStorageBoundaryMigrationPreview open readOnly
      // ones). Holding `storage` open across them would leave two writable
      // handles on the same SQLite file at once — a pointless lock-contention
      // risk for no benefit, since exportBundle is the only consumer here.
      const storage = await openStorage(layout);
      try {
        preCompare = await readBundleCompare(preBundleDir!);
        await assertSufficientDiskForBundleExport(layout);
        postTempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-b4-validate-"));
        await exportBundle({
          storage,
          bundleDir: postTempDir,
          includeRawBlobs: true,
        });
        postCompare = await readBundleCompare(postTempDir);
      } finally {
        storage.close();
      }
    }

    const result = await runMigrationValidate({
      dbPath: layout.dbPath,
      assetDir: layout.assetDir,
      only,
      preBundleChecksums: preCompare,
      postBundleChecksums: postCompare,
    });
    return {
      text: renderValidateResult(result),
      json: {
        kind: "migration-validate",
        result,
      },
      // Surface failure as a non-zero exit code so scripts and CI can gate on it.
      exitCode: result.exit_code,
    };
  } finally {
    if (postTempDir) {
      await rm(postTempDir, { recursive: true, force: true });
    }
  }
}

async function readBundleCompare(bundleDir: string): Promise<BundleChecksumCompare> {
  const manifestPath = path.join(bundleDir, "manifest.json");
  const checksumsPath = path.join(bundleDir, "checksums.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ImportBundleManifest;
  const checksums = JSON.parse(await readFile(checksumsPath, "utf8")) as BundleChecksums;
  return {
    payload_sha256_by_source_id: checksums.payload_sha256_by_source_id,
    raw_sha256_by_path: checksums.raw_sha256_by_path,
    manifest_stable: {
      bundle_version: manifest.bundle_version,
      schema_version: manifest.schema_version,
      source_instance_ids: manifest.source_instance_ids,
      includes_raw_blobs: manifest.includes_raw_blobs,
      counts: manifest.counts,
    },
  };
}

function renderValidateResult(result: MigrationValidateResult): string {
  const lines: string[] = [
    renderSection(
      "Migration Validate (B.4)",
      renderKeyValue([
        ["Store", result.db_path],
        ["Validators run", result.ran.join(", ") || "(none)"],
        ["Outcome", result.exit_code === 0 ? "PASS" : "FAIL"],
      ]),
    ),
  ];
  for (const outcome of result.outcomes) {
    lines.push("", renderValidatorOutcome(outcome));
  }
  if (result.exit_code !== 0) {
    lines.push(
      "",
      "One or more validators failed. Audit the per-validator output above, fix the underlying drift, and re-run `cchistory migration validate`.",
    );
  }
  return lines.join("\n");
}

function renderValidatorOutcome(outcome: MigrationValidatorOutcome): string {
  const header = renderSection(
    `${outcome.validator} → ${outcome.status.toUpperCase()}`,
    outcome.error ? `Error: ${outcome.error}` : "",
  );
  if (outcome.validator === "bundle" && outcome.bundle) {
    const b = outcome.bundle;
    return [
      header,
      renderKeyValue([
        ["Payload mismatches", formatNumber(b.payload_mismatches.length)],
        ["Raw mismatches", formatNumber(b.raw_mismatches.length)],
        ["Manifest field mismatches", formatNumber(b.manifest_field_mismatches.length)],
      ]),
      ...(b.payload_mismatches.length > 0
        ? ["", renderTable(["Source", "Pre SHA", "Post SHA"], b.payload_mismatches.map((m) => [m.source_id, m.pre ?? "(missing)", m.post ?? "(missing)"]))]
        : []),
      ...(b.raw_mismatches.length > 0
        ? ["", renderTable(["Path", "Pre SHA", "Post SHA"], b.raw_mismatches.map((m) => [m.path, m.pre ?? "(missing)", m.post ?? "(missing)"]))]
        : []),
    ]
      .filter((s) => s !== "")
      .join("\n");
  }
  if (outcome.validator === "inventory" && outcome.inventory) {
    const inv = outcome.inventory;
    return [
      header,
      renderTable(
        ["Pair", "V1 rows", "V2 rows", "Missing"],
        [
          ["user_turns ↔ user_turns_v2", formatNumber(inv.mapping.user_turns.v1_rows), formatNumber(inv.mapping.user_turns.v2_rows), formatNumber(inv.mapping.user_turns.missing)],
          ["turn_contexts ↔ turn_context_refs_v2", formatNumber(inv.mapping.turn_contexts.v1_rows), formatNumber(inv.mapping.turn_contexts.v2_rows), formatNumber(inv.mapping.turn_contexts.missing)],
          ["raw_records ↔ parsed_record_spans", formatNumber(inv.mapping.raw_records.v1_rows), formatNumber(inv.mapping.raw_records.v2_rows), formatNumber(inv.mapping.raw_records.missing)],
          ["captured_blobs ↔ evidence_captures", formatNumber(inv.mapping.captured_blobs.v1_rows), formatNumber(inv.mapping.captured_blobs.v2_rows), formatNumber(inv.mapping.captured_blobs.missing)],
        ],
        { align: ["left", "right", "right", "right"] },
      ),
    ].join("\n");
  }
  if (outcome.validator === "read-paths" && outcome.read_paths) {
    const rp = outcome.read_paths;
    const sections = [
      header,
      renderKeyValue([
        ["Turns checked", formatNumber(rp.turns_checked)],
        ["Mismatches", formatNumber(rp.mismatch_count)],
        ["UserTurn turns checked", formatNumber(rp.user_turn.turns_checked)],
        ["UserTurn mismatches", formatNumber(rp.user_turn.mismatch_count)],
      ]),
    ];
    if (rp.mismatches.length > 0) {
      sections.push(
        "",
        renderSection(
          "TurnContext mismatches",
          renderTable(
            ["Turn", "Reason", "Detail"],
            rp.mismatches.map((m) => [m.turn_id.slice(0, 16), m.reason, m.detail ?? ""]),
          ),
        ),
      );
    }
    if (rp.user_turn.mismatches.length > 0) {
      sections.push(
        "",
        renderSection(
          "UserTurnProjection mismatches (B.5.0d)",
          renderTable(
            ["Turn", "Reason", "Detail"],
            rp.user_turn.mismatches.map((m) => [m.turn_id.slice(0, 16), m.reason, m.detail ?? ""]),
          ),
        ),
      );
    }
    return sections.join("\n");
  }
  if (outcome.validator === "v1-payload-digest" && outcome.v1_payload_digest) {
    const v = outcome.v1_payload_digest;
    const sections = [
      header,
      renderKeyValue([
        ["Baseline", v.baseline_captured ? "captured this run" : "comparing to prior baseline"],
        ["Mismatched tables", formatNumber(v.mismatch_count)],
      ]),
    ];
    if (v.mismatches.length > 0) {
      sections.push(
        "",
        renderSection(
          "Drifted tables",
          renderTable(
            ["Table", "Baseline SHA", "Current SHA"],
            v.mismatches.map((m) => [m.table, (m.baseline ?? "(missing)").slice(0, 16), m.current.slice(0, 16)]),
          ),
        ),
      );
    }
    return sections.join("\n");
  }
  return header;
}
