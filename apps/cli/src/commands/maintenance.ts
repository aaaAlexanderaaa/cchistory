import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type SourceSyncPayload } from "@cchistory/domain";
import {
  type CCHistoryStorage,
  type RawSnapshotGcResult,
} from "@cchistory/storage";
import {
  exportBundle,
  importBundleIntoStore,
  planBundleImport,
} from "../bundle.js";
import {
  decorateImportConflictError,
  formatNumber,
  renderImportTargetArg,
  renderKeyValue,
  renderSection,
  renderTable,
} from "../renderers.js";
import {
  createStorage,
  openStorage,
  pruneOrphanRawSnapshotsSafe,
  resolveStoreLayout,
} from "../store.js";
import {
  type CommandContext,
  type CommandOutput,
  openExistingStore,
  pathExists,
  requireStoreDatabase,
} from "../main.js";
import { resolveSourceRef } from "../resolvers.js";
import { createSourcesListOutput } from "./sync.js";
import { createStatsOverviewOutput } from "./stats.js";

export async function handleExport(context: CommandContext): Promise<CommandOutput> {
  return executeExportCommand(context);
}

export async function handleBackup(context: CommandContext): Promise<CommandOutput> {
  const dryRun = context.globals.dryRun;
  const shouldWrite = context.options.write && !dryRun;
  const mode = shouldWrite ? "write" : "preview";
  const exportOutput = await executeExportCommand(context, {
    dryRun: !shouldWrite,
  });
  return {
    text: [
      renderKeyValue([
        ["Workflow", "backup"],
        ["Mode", mode],
      ]),
      "",
      exportOutput.text,
    ].join("\n"),
    json: {
      kind: "backup",
      mode,
      export: exportOutput.json,
    },
  };
}

export async function handleRestoreCheck(context: CommandContext): Promise<CommandOutput> {
  if (context.positionals.length > 0) {
    throw new Error("`restore-check` does not take positional arguments.");
  }
  if (!context.globals.store && !context.globals.db) {
    throw new Error("`restore-check` requires an explicit --store or --db target.");
  }
  if (context.globals.full) {
    throw new Error("`restore-check` does not support --full; it verifies the indexed restored store only.");
  }
  if (context.options.source.length > 0) {
    throw new Error("`restore-check` does not support --source filters; it verifies all restored sources together.");
  }

  const layout = resolveStoreLayout({
    cwd: context.io.cwd,
    storeArg: context.globals.store,
    dbArg: context.globals.db,
  });
  await requireStoreDatabase(layout.dbPath);
  const storage = await openStorage(layout);

  try {
    const showAll = context.globals.showAll;
    const statsOutput = createStatsOverviewOutput(layout, storage, showAll);
    const sourcesOutput = createSourcesListOutput(layout, storage);
    return {
      text: [
        renderSection(
          "Restore Check",
          renderKeyValue([
            ["Target", layout.dbPath],
            ["Read Mode", "index"],
          ]),
        ),
        "",
        renderSection("Store Overview", statsOutput.text),
        "",
        renderSection("Source Presence", sourcesOutput.text),
      ].join("\n"),
      json: {
        kind: "restore-check",
        db_path: layout.dbPath,
        read_mode: "index",
        stats: statsOutput.json,
        sources: sourcesOutput.json,
      },
    };
  } finally {
    storage.close();
  }
}

export async function executeExportCommand(
  context: CommandContext,
  options: {
    dryRun?: boolean;
  } = {},
): Promise<CommandOutput> {
  const outDir = requireOption(context.options.out, "out");
  const includeRawBlobs = !context.options.noRaw;
  const sourceRefs = context.options.source;
  const dryRun = options.dryRun ?? context.globals.dryRun;
  const { layout, storage } = await openExistingStore(context);
  try {
    const selectedSourceIds = sourceRefs.length > 0 ? sourceRefs.map((ref) => resolveSourceRef(storage, ref).id) : undefined;
    const selectedSources = storage
      .listSources()
      .filter((source) => (selectedSourceIds && selectedSourceIds.length > 0 ? selectedSourceIds.includes(source.id) : true));

    if (dryRun) {
      const counts = { sources: 0, sessions: 0, turns: 0, blobs: 0 };
      const planRows: Array<{ source: SourceSyncPayload["source"]; sessions: number; turns: number; blobs: number }> = [];
      for (const source of selectedSources) {
        const payload = storage.getSourcePayload(source.id);
        if (!payload) continue;
        counts.sources += 1;
        counts.sessions += payload.sessions.length;
        counts.turns += payload.turns.length;
        counts.blobs += payload.blobs.length;
        planRows.push({
          source: payload.source,
          sessions: payload.sessions.length,
          turns: payload.turns.length,
          blobs: payload.blobs.length,
        });
      }
      return {
        text: [
          renderKeyValue([
            ["DB", layout.dbPath],
            ["Bundle", path.resolve(context.io.cwd, outDir)],
            ["Sources", String(counts.sources)],
            ["Sessions", String(counts.sessions)],
            ["Turns", String(counts.turns)],
            ["Blobs", String(counts.blobs)],
            ["Includes Raw", String(includeRawBlobs)],
          ]),
          "",
          renderExportPlanTableFromRows(planRows),
        ].join("\n"),
        json: {
          kind: "export-dry-run",
          db_path: layout.dbPath,
          bundle_dir: path.resolve(context.io.cwd, outDir),
          includes_raw_blobs: includeRawBlobs,
          counts,
          sources: planRows.map((row) => row.source),
        },
      };
    }

    const result = await exportBundle({
      storage,
      bundleDir: path.resolve(context.io.cwd, outDir),
      sourceIds: selectedSourceIds,
      includeRawBlobs,
    });
    return {
      text: renderKeyValue([
        ["Bundle", path.resolve(context.io.cwd, outDir)],
        ["Bundle ID", result.manifest.bundle_id],
        ["Sources", String(result.manifest.counts.sources)],
        ["Sessions", String(result.manifest.counts.sessions)],
        ["Turns", String(result.manifest.counts.turns)],
        ["Blobs", String(result.manifest.counts.blobs)],
        ["Includes Raw", String(result.manifest.includes_raw_blobs)],
      ]),
      json: {
        kind: "export",
        db_path: layout.dbPath,
        manifest: result.manifest,
        checksums: result.checksums,
      },
    };
  } finally {
    storage.close();
  }
}

export async function handleImport(context: CommandContext): Promise<CommandOutput> {
  const [bundleDir] = context.positionals;
  if (!bundleDir) {
    throw new Error("Import requires a bundle directory.");
  }
  const mode = (context.options.onConflict ?? "error") as "error" | "skip" | "replace";
  if (!["error", "skip", "replace"].includes(mode)) {
    throw new Error("`import --on-conflict` must be one of error, skip, replace.");
  }

  const layout = resolveStoreLayout({
    cwd: context.io.cwd,
    storeArg: context.globals.store,
    dbArg: context.globals.db,
  });
  const resolvedBundleDir = path.resolve(context.io.cwd, bundleDir);
  const dryRun = context.globals.dryRun;
  const targetStoreExists = await pathExists(layout.dbPath);
  let storage: CCHistoryStorage;
  if (dryRun && !targetStoreExists) {
    storage = await createStorage({ dbPath: ":memory:" });
  } else {
    if (!dryRun) {
      await mkdir(layout.assetDir, { recursive: true });
      await mkdir(layout.rawDir, { recursive: true });
    }
    storage = await openStorage(layout);
  }

  try {
    if (dryRun) {
      const plan = await planBundleImport({
        storage,
        bundleDir: resolvedBundleDir,
        onConflict: mode,
      });
      return {
        text: [
          renderKeyValue([
            ["Target DB", layout.dbPath],
            ["Target Exists", String(targetStoreExists)],
            ["Bundle", resolvedBundleDir],
            ["Bundle ID", plan.manifest.bundle_id],
            ["Conflict Mode", mode],
            ["Would Import", String(plan.imported_source_ids.length)],
            ["Would Replace", String(plan.replaced_source_ids.length)],
            ["Would Skip", String(plan.skipped_source_ids.length)],
            ["Would Conflict", String(plan.conflicting_source_ids.length)],
            ["Would Fail", String(plan.would_fail)],
          ]),
          "",
          renderImportPlanTable(plan),
        ].join("\n"),
        json: {
          kind: "import-dry-run",
          db_path: layout.dbPath,
          target_exists: targetStoreExists,
          ...plan,
        },
      };
    }

    let result: Awaited<ReturnType<typeof importBundleIntoStore>>;
    try {
      result = await importBundleIntoStore({
        storage,
        bundleDir: resolvedBundleDir,
        rawDir: layout.rawDir,
        onConflict: mode,
      });
    } catch (error) {
      throw decorateImportConflictError(error, {
        bundleDir: resolvedBundleDir,
        targetArg: renderImportTargetArg(context, layout),
      });
    }
    const rawGc = await pruneOrphanRawSnapshotsSafe({
      storage,
      rawDir: layout.rawDir,
    });
    return {
      text: renderKeyValue([
        ["DB", layout.dbPath],
        ["Bundle ID", result.manifest.bundle_id],
        ["Imported Sources", String(result.imported_source_ids.length)],
        ["Replaced Sources", String(result.replaced_source_ids.length)],
        ["Skipped Sources", String(result.skipped_source_ids.length)],
        ["Projects Before", String(result.project_count_before)],
        ["Projects After", String(result.project_count_after)],
        ["Raw GC Deleted Files", formatNumber(rawGc.deleted_files)],
        ["Raw GC Deleted Bytes", formatBytes(rawGc.deleted_bytes)],
      ]),
      json: {
        kind: "import",
        db_path: layout.dbPath,
        raw_gc: rawGc,
        ...result,
      },
    };
  } finally {
    storage.close();
  }
}

export async function handleMergeAlias(context: CommandContext): Promise<CommandOutput> {
  const fromPath = requireOption(context.options.from, "from");
  const toPath = requireOption(context.options.to, "to");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-merge-"));
  const fromLayout = resolveStoreLayout({ cwd: context.io.cwd, dbArg: fromPath });
  const toLayout = resolveStoreLayout({ cwd: context.io.cwd, dbArg: toPath });
  const sourceRefs = context.options.source;
  const conflictMode = (context.options.onConflict ?? "replace") as "skip" | "replace";

  const sourceStorage = await openStorage(fromLayout);
  const targetStorage = await openStorage(toLayout);
  try {
    const selectedSourceIds = sourceRefs.length > 0 ? sourceRefs.map((ref) => resolveSourceRef(sourceStorage, ref).id) : undefined;
    await exportBundle({
      storage: sourceStorage,
      bundleDir: tempDir,
      sourceIds: selectedSourceIds,
      includeRawBlobs: true,
    });
    const imported = await importBundleIntoStore({
      storage: targetStorage,
      bundleDir: tempDir,
      rawDir: toLayout.rawDir,
      onConflict: conflictMode === "replace" ? "replace" : "skip",
    });
    const rawGc = await pruneOrphanRawSnapshotsSafe({
      storage: targetStorage,
      rawDir: toLayout.rawDir,
    });
    return {
      text: [
        `Merged via bundle compatibility path: imported=${imported.imported_source_ids.length} replaced=${imported.replaced_source_ids.length} skipped=${imported.skipped_source_ids.length}`,
        "",
        renderSection("Raw GC", renderRawGcSummary(rawGc)),
      ].join("\n"),
      json: {
        ...imported,
        raw_gc: rawGc,
      },
    };
  } finally {
    sourceStorage.close();
    targetStorage.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function handleGc(context: CommandContext): Promise<CommandOutput> {
  const dryRun = context.globals.dryRun;
  const layout = resolveStoreLayout({
    cwd: context.io.cwd,
    storeArg: context.globals.store,
    dbArg: context.globals.db,
  });
  await requireStoreDatabase(layout.dbPath);
  const storage = await openStorage(layout);
  try {
    const result = await pruneOrphanRawSnapshotsSafe({
      storage,
      rawDir: layout.rawDir,
      dryRun,
    });
    return {
      text: renderKeyValue([
        ["DB", layout.dbPath],
        ["Raw Dir", layout.rawDir],
        ["Dry Run", String(dryRun)],
        ["Scanned Files", formatNumber(result.scanned_files)],
        ["Referenced Files", formatNumber(result.referenced_files)],
        ["Deleted Files", formatNumber(result.deleted_files)],
        ["Deleted Bytes", formatBytes(result.deleted_bytes)],
        ["Removed Dirs", formatNumber(result.removed_dirs)],
      ]),
      json: {
        kind: "gc",
        db_path: layout.dbPath,
        raw_dir: layout.rawDir,
        dry_run: dryRun,
        result,
      },
    };
  } finally {
    storage.close();
  }
}

function renderExportPlanTableFromRows(
  rows: Array<{ source: SourceSyncPayload["source"]; sessions: number; turns: number; blobs: number }>,
): string {
  return renderTable(
    ["Source", "Slot", "Platform", "Sessions", "Turns", "Blobs"],
    rows.map((row) => [
      row.source.display_name,
      row.source.slot_id,
      row.source.platform,
      String(row.sessions),
      String(row.turns),
      String(row.blobs),
    ]),
  );
}

function renderImportPlanTable(plan: { source_plans: any[] }): string {
  return renderTable(
    ["Source", "Slot", "Platform", "Action", "Reason", "Sessions", "Turns"],
    plan.source_plans.map((entry) => [
      entry.display_name,
      entry.slot_id,
      entry.platform,
      entry.action,
      entry.reason,
      String(entry.counts.sessions),
      String(entry.counts.turns),
    ]),
  );
}

function requireOption(value: string | undefined, key: string): string {
  if (!value) {
    throw new Error(`Missing required --${key} flag.`);
  }
  return value;
}

// Fixed version of renderImportPlanTable that uses the plan data better
// Actually, let's just use a simpler version since the ID matching is complex here.
/*
function renderImportPlanTable(plan: any): string {
    // ...
}
*/

export function renderRawGcSummary(result: RawSnapshotGcResult): string {
  return renderKeyValue([
    ["Scanned Files", formatNumber(result.scanned_files)],
    ["Referenced Files", formatNumber(result.referenced_files)],
    ["Deleted Files", formatNumber(result.deleted_files)],
    ["Deleted Bytes", formatBytes(result.deleted_bytes)],
    ["Removed Dirs", formatNumber(result.removed_dirs)],
  ]);
}

export function formatBytes(value: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const decimals = unitIndex === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(decimals)} ${units[unitIndex]}`;
}
