import { readdir, stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

export interface StorageFootprintInventory {
  generated_at: string;
  db_path: string;
  status: "missing" | "ok" | "error";
  error_message?: string;
  schema_version?: string;
  sqlite_files: {
    main: StorageFileInventory;
    wal: StorageFileInventory;
    shm: StorageFileInventory;
    total_bytes: number;
  };
  search_index: SearchIndexInventory;
  evidence_store: EvidenceStoreInventory;
  tables: StorageTableInventory[];
  source_roots: SourceRootInventory[];
  totals: {
    table_count: number;
    row_count: number;
    payload_json_bytes: number;
    sqlite_file_bytes: number;
    evidence_store_files: number;
    evidence_store_bytes: number;
    source_root_files: number;
    source_root_bytes: number;
  };
}

export interface StorageFileInventory {
  path: string;
  exists: boolean;
  size_bytes: number;
}

export interface SearchIndexInventory {
  table_exists: boolean;
  status?: string;
  row_count?: number;
  shadow_tables: string[];
}

export interface EvidenceStoreInventory {
  path: string;
  status: "missing" | "ok" | "error";
  file_count: number;
  total_bytes: number;
  error_message?: string;
}

export interface StorageTableInventory {
  name: string;
  row_count: number;
  has_payload_json: boolean;
  payload_json_bytes: number;
  largest_payload_rows: StoragePayloadRowInventory[];
}

export interface StoragePayloadRowInventory {
  rowid?: number;
  id?: string;
  source_id?: string;
  payload_json_bytes: number;
}

export interface SourceRootInventory {
  source_id: string;
  slot_id?: string;
  display_name?: string;
  base_dir?: string;
  status: "missing" | "ok" | "error";
  file_count: number;
  total_bytes: number;
  error_message?: string;
}

interface SourcePayloadSlice {
  id?: unknown;
  slot_id?: unknown;
  display_name?: unknown;
  base_dir?: unknown;
}

const DEFAULT_LARGEST_ROWS_LIMIT = 3;

export async function readStorageFootprintInventory(input: {
  dbPath: string;
  assetDir?: string;
  largestRowsLimit?: number;
}): Promise<StorageFootprintInventory> {
  const dbPath = input.dbPath;
  const assetDir = input.assetDir ?? resolveAssetDirFromDbPath(dbPath);
  const largestRowsLimit = input.largestRowsLimit ?? DEFAULT_LARGEST_ROWS_LIMIT;
  const evidenceStore = await inspectEvidenceStore(path.join(assetDir, "evidence"));
  const sqliteFiles = {
    main: await inspectStorageFile(dbPath),
    wal: await inspectStorageFile(`${dbPath}-wal`),
    shm: await inspectStorageFile(`${dbPath}-shm`),
    total_bytes: 0,
  };
  sqliteFiles.total_bytes = sqliteFiles.main.size_bytes + sqliteFiles.wal.size_bytes + sqliteFiles.shm.size_bytes;

  const baseInventory: Omit<StorageFootprintInventory, "status" | "search_index" | "tables" | "source_roots" | "totals"> = {
    generated_at: new Date().toISOString(),
    db_path: dbPath,
    schema_version: undefined,
    sqlite_files: sqliteFiles,
    evidence_store: evidenceStore,
  };

  if (!sqliteFiles.main.exists) {
    return {
      ...baseInventory,
      status: "missing",
      search_index: emptySearchIndexInventory(),
      tables: [],
      source_roots: [],
      totals: emptyTotals(sqliteFiles.total_bytes, evidenceStore),
    };
  }

  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const schemaVersion = readSchemaMeta(db, "schema_version");
    const tables = readTableInventories(db, largestRowsLimit);
    const sourceRoots = await readSourceRootInventories(db);
    const payloadJsonBytes = tables.reduce((sum, table) => sum + table.payload_json_bytes, 0);
    const rowCount = tables.reduce((sum, table) => sum + table.row_count, 0);
    const sourceRootFiles = sourceRoots.reduce((sum, source) => sum + source.file_count, 0);
    const sourceRootBytes = sourceRoots.reduce((sum, source) => sum + source.total_bytes, 0);
    return {
      ...baseInventory,
      status: "ok",
      schema_version: schemaVersion,
      search_index: readSearchIndexInventory(db),
      tables,
      source_roots: sourceRoots,
      totals: {
        table_count: tables.length,
        row_count: rowCount,
        payload_json_bytes: payloadJsonBytes,
        sqlite_file_bytes: sqliteFiles.total_bytes,
        evidence_store_files: evidenceStore.file_count,
        evidence_store_bytes: evidenceStore.total_bytes,
        source_root_files: sourceRootFiles,
        source_root_bytes: sourceRootBytes,
      },
    };
  } catch (error) {
    return {
      ...baseInventory,
      status: "error",
      error_message: formatError(error),
      search_index: emptySearchIndexInventory(),
      tables: [],
      source_roots: [],
      totals: emptyTotals(sqliteFiles.total_bytes, evidenceStore),
    };
  } finally {
    db?.close();
  }
}

async function inspectEvidenceStore(evidenceDir: string): Promise<EvidenceStoreInventory> {
  try {
    const stats = await stat(evidenceDir);
    if (!stats.isDirectory()) {
      return {
        path: evidenceDir,
        status: "error",
        file_count: 0,
        total_bytes: 0,
        error_message: "Evidence path is not a directory",
      };
    }
    const totals = await scanFileTree(evidenceDir);
    return {
      path: evidenceDir,
      status: "ok",
      file_count: totals.file_count,
      total_bytes: totals.total_bytes,
    };
  } catch (error) {
    if (isMissingPathError(error)) {
      return {
        path: evidenceDir,
        status: "missing",
        file_count: 0,
        total_bytes: 0,
      };
    }
    return {
      path: evidenceDir,
      status: "error",
      file_count: 0,
      total_bytes: 0,
      error_message: formatError(error),
    };
  }
}

async function inspectStorageFile(filePath: string): Promise<StorageFileInventory> {
  try {
    const stats = await stat(filePath);
    return { path: filePath, exists: true, size_bytes: stats.size };
  } catch {
    return { path: filePath, exists: false, size_bytes: 0 };
  }
}

function readTableInventories(db: DatabaseSync, largestRowsLimit: number): StorageTableInventory[] {
  return listUserTables(db).map((tableName) => {
    const columns = listTableColumns(db, tableName);
    const hasPayloadJson = columns.includes("payload_json");
    return {
      name: tableName,
      row_count: countRows(db, tableName),
      has_payload_json: hasPayloadJson,
      payload_json_bytes: hasPayloadJson ? sumPayloadJsonBytes(db, tableName) : 0,
      largest_payload_rows: hasPayloadJson ? readLargestPayloadRows(db, tableName, columns, largestRowsLimit) : [],
    };
  });
}

function listUserTables(db: DatabaseSync): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC")
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function listTableColumns(db: DatabaseSync, tableName: string): string[] {
  try {
    return (db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all() as Array<{ name: string }>).map((row) => row.name);
  } catch {
    return [];
  }
}

function countRows(db: DatabaseSync, tableName: string): number {
  try {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`).get() as { count: number };
    return Number(row.count) || 0;
  } catch {
    return 0;
  }
}

function sumPayloadJsonBytes(db: DatabaseSync, tableName: string): number {
  try {
    const row = db.prepare(`SELECT COALESCE(SUM(LENGTH(CAST(payload_json AS BLOB))), 0) AS bytes FROM ${quoteIdentifier(tableName)}`).get() as {
      bytes: number;
    };
    return Number(row.bytes) || 0;
  } catch {
    return 0;
  }
}

function readLargestPayloadRows(
  db: DatabaseSync,
  tableName: string,
  columns: readonly string[],
  limit: number,
): StoragePayloadRowInventory[] {
  const safeLimit = Math.max(0, Math.floor(limit));
  if (safeLimit === 0) {
    return [];
  }
  const idColumn = selectIdentityColumn(columns);
  const sourceColumn = columns.includes("source_id") ? "source_id" : undefined;
  const identitySelect = idColumn ? `, ${quoteIdentifier(idColumn)} AS id` : "";
  const sourceSelect = sourceColumn ? `, ${quoteIdentifier(sourceColumn)} AS source_id` : "";
  try {
    const rows = db
      .prepare(
        `SELECT rowid AS rowid, LENGTH(CAST(payload_json AS BLOB)) AS payload_json_bytes${identitySelect}${sourceSelect}
         FROM ${quoteIdentifier(tableName)}
         ORDER BY LENGTH(CAST(payload_json AS BLOB)) DESC, rowid ASC
         LIMIT ?`,
      )
      .all(safeLimit) as Array<{ rowid?: number; id?: string; source_id?: string; payload_json_bytes: number }>;
    return rows.map((row) => ({
      rowid: typeof row.rowid === "number" ? row.rowid : undefined,
      id: typeof row.id === "string" ? row.id : undefined,
      source_id: typeof row.source_id === "string" ? row.source_id : undefined,
      payload_json_bytes: Number(row.payload_json_bytes) || 0,
    }));
  } catch {
    return [];
  }
}

function selectIdentityColumn(columns: readonly string[]): string | undefined {
  for (const column of ["id", "turn_id", "project_id", "artifact_id", "bundle_id", "logical_id"]) {
    if (columns.includes(column)) {
      return column;
    }
  }
  return undefined;
}

function readSearchIndexInventory(db: DatabaseSync): SearchIndexInventory {
  const tableExists = sqliteTableExists(db, "search_index");
  return {
    table_exists: tableExists,
    status: readSchemaMeta(db, "search_index_status"),
    row_count: tableExists ? countRows(db, "search_index") : undefined,
    shadow_tables: listUserTables(db).filter((name) => name.startsWith("search_index_")),
  };
}

async function readSourceRootInventories(db: DatabaseSync): Promise<SourceRootInventory[]> {
  if (!sqliteTableExists(db, "source_instances")) {
    return [];
  }
  const rows = db.prepare("SELECT payload_json FROM source_instances ORDER BY id ASC").all() as Array<{ payload_json: string }>;
  const sources = rows.flatMap((row) => {
    try {
      const parsed = JSON.parse(row.payload_json) as SourcePayloadSlice;
      const sourceId = asOptionalString(parsed.id);
      if (!sourceId) {
        return [];
      }
      return [{
        source_id: sourceId,
        slot_id: asOptionalString(parsed.slot_id),
        display_name: asOptionalString(parsed.display_name),
        base_dir: asOptionalString(parsed.base_dir),
      }];
    } catch {
      return [];
    }
  });
  const inventories: SourceRootInventory[] = [];
  for (const source of sources) {
    inventories.push(await inspectSourceRoot(source));
  }
  return inventories;
}

async function inspectSourceRoot(source: {
  source_id: string;
  slot_id?: string;
  display_name?: string;
  base_dir?: string;
}): Promise<SourceRootInventory> {
  if (!source.base_dir) {
    return {
      ...source,
      status: "missing",
      file_count: 0,
      total_bytes: 0,
      error_message: "Source has no base_dir",
    };
  }
  try {
    const stats = await stat(source.base_dir);
    if (!stats.isDirectory()) {
      return {
        ...source,
        status: "error",
        file_count: 0,
        total_bytes: 0,
        error_message: "Source base_dir is not a directory",
      };
    }
    const totals = await scanFileTree(source.base_dir);
    return {
      ...source,
      status: "ok",
      file_count: totals.file_count,
      total_bytes: totals.total_bytes,
    };
  } catch (error) {
    return {
      ...source,
      status: "missing",
      file_count: 0,
      total_bytes: 0,
      error_message: formatError(error),
    };
  }
}

async function scanFileTree(root: string): Promise<{ file_count: number; total_bytes: number }> {
  let fileCount = 0;
  let totalBytes = 0;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await scanFileTree(entryPath);
      fileCount += nested.file_count;
      totalBytes += nested.total_bytes;
      continue;
    }
    if (entry.isFile()) {
      try {
        const stats = await stat(entryPath);
        fileCount += 1;
        totalBytes += stats.size;
      } catch {
        // Inventory is diagnostic-only; skip files that disappear mid-scan.
      }
    }
  }
  return { file_count: fileCount, total_bytes: totalBytes };
}

function sqliteTableExists(db: DatabaseSync, tableName: string): boolean {
  try {
    const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName) as
      | { 1: number }
      | undefined;
    return Boolean(row);
  } catch {
    return false;
  }
}

function readSchemaMeta(db: DatabaseSync, key: string): string | undefined {
  if (!sqliteTableExists(db, "schema_meta")) {
    return undefined;
  }
  try {
    const row = db.prepare("SELECT value_text FROM schema_meta WHERE key = ?").get(key) as { value_text: string } | undefined;
    return row?.value_text;
  } catch {
    return undefined;
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function emptySearchIndexInventory(): SearchIndexInventory {
  return {
    table_exists: false,
    shadow_tables: [],
  };
}

function emptyTotals(
  sqliteFileBytes: number,
  evidenceStore: EvidenceStoreInventory,
): StorageFootprintInventory["totals"] {
  return {
    table_count: 0,
    row_count: 0,
    payload_json_bytes: 0,
    sqlite_file_bytes: sqliteFileBytes,
    evidence_store_files: evidenceStore.file_count,
    evidence_store_bytes: evidenceStore.total_bytes,
    source_root_files: 0,
    source_root_bytes: 0,
  };
}

function resolveAssetDirFromDbPath(dbPath: string): string {
  return path.basename(dbPath) === "cchistory.sqlite"
    ? path.dirname(dbPath)
    : `${dbPath}.cchistory`;
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
