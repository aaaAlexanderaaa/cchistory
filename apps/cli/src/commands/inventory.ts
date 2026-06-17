import { readStorageFootprintInventory, type StorageFootprintInventory } from "@cchistory/storage";
import type { CommandContext, CommandOutput } from "../main.js";
import { resolveStoreLayout } from "../store.js";
import { renderKeyValue, renderSection, renderTable, formatNumber } from "../renderers.js";

export async function handleInventory(context: CommandContext): Promise<CommandOutput> {
  if (context.positionals.length > 0) {
    throw new Error("`inventory` does not take positional arguments.");
  }
  if (context.globals.full) {
    throw new Error("`inventory` is read-only and does not support --full.");
  }
  const layout = resolveStoreLayout({
    cwd: context.io.cwd,
    storeArg: context.globals.store,
    dbArg: context.globals.db,
  });
  const inventory = await readStorageFootprintInventory({ dbPath: layout.dbPath, assetDir: layout.assetDir });
  return {
    text: renderInventory(inventory),
    json: {
      kind: "storage-footprint-inventory",
      inventory,
    },
  };
}

function renderInventory(inventory: StorageFootprintInventory): string {
  const sections = [
    renderSection("Storage Inventory", renderInventorySummary(inventory)),
    renderSection("SQLite Files", renderSqliteFiles(inventory)),
    renderSection("Evidence Store", renderEvidenceStore(inventory)),
  ];
  if (inventory.status === "ok") {
    sections.push(renderSection("Payload Tables", renderTableInventory(inventory)));
    sections.push(renderSection("Largest Payload Rows", renderLargestPayloadRows(inventory)));
    sections.push(renderSection("Source Roots", renderSourceRoots(inventory)));
    sections.push(renderSection("Search Index", renderSearchIndex(inventory)));
  } else if (inventory.error_message) {
    sections.push(renderSection("Error", inventory.error_message));
  }
  return sections.join("\n\n");
}

function renderInventorySummary(inventory: StorageFootprintInventory): string {
  return renderKeyValue([
    ["Store", inventory.db_path],
    ["Status", inventory.status],
    ["Schema", inventory.schema_version ?? "(unknown)"],
    ["Tables", formatNumber(inventory.totals.table_count)],
    ["Rows", formatNumber(inventory.totals.row_count)],
    ["Payload JSON", formatBytes(inventory.totals.payload_json_bytes)],
    ["SQLite Files", formatBytes(inventory.totals.sqlite_file_bytes)],
    ["Evidence Files", formatNumber(inventory.totals.evidence_store_files)],
    ["Evidence Bytes", formatBytes(inventory.totals.evidence_store_bytes)],
    ["Source Root Files", formatNumber(inventory.totals.source_root_files)],
    ["Source Root Bytes", formatBytes(inventory.totals.source_root_bytes)],
  ]);
}

function renderSqliteFiles(inventory: StorageFootprintInventory): string {
  const files = [inventory.sqlite_files.main, inventory.sqlite_files.wal, inventory.sqlite_files.shm];
  return renderTable(
    ["File", "Exists", "Bytes"],
    files.map((file) => [file.path, file.exists ? "yes" : "no", formatBytes(file.size_bytes)]),
    { align: ["left", "left", "right"] },
  );
}

function renderEvidenceStore(inventory: StorageFootprintInventory): string {
  const entries: Array<[string, string]> = [
    ["Path", inventory.evidence_store.path],
    ["Status", inventory.evidence_store.status],
    ["Files", formatNumber(inventory.evidence_store.file_count)],
    ["Bytes", formatBytes(inventory.evidence_store.total_bytes)],
  ];
  if (inventory.evidence_store.error_message) {
    entries.push(["Error", inventory.evidence_store.error_message]);
  }
  return renderKeyValue(entries);
}

function renderTableInventory(inventory: StorageFootprintInventory): string {
  const rows = inventory.tables
    .filter((table) => table.row_count > 0 || table.payload_json_bytes > 0)
    .sort((left, right) => right.payload_json_bytes - left.payload_json_bytes || right.row_count - left.row_count)
    .map((table) => [
      table.name,
      formatNumber(table.row_count),
      table.has_payload_json ? formatBytes(table.payload_json_bytes) : "-",
    ]);
  return renderTable(["Table", "Rows", "Payload JSON"], rows, { align: ["left", "right", "right"] });
}

function renderLargestPayloadRows(inventory: StorageFootprintInventory): string {
  const rows = inventory.tables.flatMap((table) =>
    table.largest_payload_rows.map((row) => [
      table.name,
      row.id ?? (row.rowid !== undefined ? `rowid:${row.rowid}` : ""),
      row.source_id ?? "",
      formatBytes(row.payload_json_bytes),
    ])
  ).sort((left, right) => parseRenderedBytes(right[3] ?? "0B") - parseRenderedBytes(left[3] ?? "0B"));
  return renderTable(["Table", "Row", "Source", "Bytes"], rows.slice(0, 20), { align: ["left", "left", "left", "right"] });
}

function renderSourceRoots(inventory: StorageFootprintInventory): string {
  const rows = inventory.source_roots.map((source) => [
    source.slot_id ?? source.source_id,
    source.status,
    formatNumber(source.file_count),
    formatBytes(source.total_bytes),
    source.base_dir ?? "",
  ]);
  return renderTable(["Source", "Status", "Files", "Bytes", "Base Dir"], rows, {
    align: ["left", "left", "right", "right", "left"],
  });
}

function renderSearchIndex(inventory: StorageFootprintInventory): string {
  return renderKeyValue([
    ["Table Exists", inventory.search_index.table_exists ? "yes" : "no"],
    ["Status", inventory.search_index.status ?? "(unknown)"],
    ["Rows", inventory.search_index.row_count === undefined ? "(unknown)" : formatNumber(inventory.search_index.row_count)],
    ["Shadow Tables", inventory.search_index.shadow_tables.length > 0 ? inventory.search_index.shadow_tables.join(", ") : "none"],
  ]);
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

function parseRenderedBytes(value: string): number {
  const match = value.match(/^([0-9.]+)([KMGT]?i?B)$/u);
  if (!match) {
    return 0;
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "B"
    ? 1
    : unit === "KiB"
      ? 1024
      : unit === "MiB"
        ? 1024 ** 2
        : unit === "GiB"
          ? 1024 ** 3
          : unit === "TiB"
            ? 1024 ** 4
            : 1;
  return Number.isFinite(amount) ? amount * multiplier : 0;
}
