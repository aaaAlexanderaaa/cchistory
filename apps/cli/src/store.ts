import path from "node:path";
import process from "node:process";
import type { CCHistoryStorage, RawSnapshotGcResult } from "@cchistory/storage";
import { resolveDefaultCchistoryDataDir } from "@cchistory/storage/store-layout";

export interface StoreLayout {
  dbPath: string;
  assetDir: string;
  rawDir: string;
}

const SQLITE_MIN_NODE_MAJOR = 22;

type StorageModule = typeof import("@cchistory/storage");

let storageModulePromise: Promise<StorageModule> | undefined;

export function resolveStoreLayout(input: {
  cwd: string;
  storeArg?: string;
  dbArg?: string;
  homeDir?: string;
}): StoreLayout {
  if (input.storeArg && input.dbArg) {
    throw new Error("Use either --store or --db, not both.");
  }

  if (input.storeArg) {
    const assetDir = path.resolve(input.cwd, input.storeArg);
    return {
      dbPath: path.join(assetDir, "cchistory.sqlite"),
      assetDir,
      rawDir: path.join(assetDir, "raw"),
    };
  }

  if (input.dbArg) {
    const dbPath = path.resolve(input.cwd, input.dbArg);
    const assetDir =
      path.basename(dbPath) === "cchistory.sqlite" ? path.dirname(dbPath) : `${dbPath}.cchistory`;
    return {
      dbPath,
      assetDir,
      rawDir: path.join(assetDir, "raw"),
    };
  }

  const assetDir = resolveDefaultCchistoryDataDir({ cwd: input.cwd, homeDir: input.homeDir });
  return {
    dbPath: path.join(assetDir, "cchistory.sqlite"),
    assetDir,
    rawDir: path.join(assetDir, "raw"),
  };
}

export async function createStorage(location: string | { dataDir?: string; dbPath?: string }): Promise<CCHistoryStorage> {
  try {
    const { CCHistoryStorage } = await loadStorageModule();
    return new CCHistoryStorage(location);
  } catch (error) {
    throw formatStorageRuntimeError(error);
  }
}

export async function openStorage(layout: StoreLayout): Promise<CCHistoryStorage> {
  return createStorage({ dbPath: layout.dbPath });
}

export async function pruneOrphanRawSnapshotsSafe(input: {
  storage: CCHistoryStorage;
  rawDir: string;
  dryRun?: boolean;
}): Promise<RawSnapshotGcResult> {
  try {
    const { pruneOrphanRawSnapshots } = await loadStorageModule();
    return pruneOrphanRawSnapshots(input);
  } catch (error) {
    throw formatStorageRuntimeError(error);
  }
}

async function loadStorageModule(): Promise<StorageModule> {
  storageModulePromise ??= import("@cchistory/storage");
  return storageModulePromise;
}

function formatStorageRuntimeError(error: unknown): Error {
  if (!isNodeSqliteImportError(error)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  return new Error(
    `This command requires Node.js >= ${SQLITE_MIN_NODE_MAJOR} (current: ${process.versions.node}) because CCHistory storage uses the built-in \`node:sqlite\` module.`,
  );
}

function isNodeSqliteImportError(error: unknown): error is Error & { code?: string } {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { code?: string }).code === "ERR_UNKNOWN_BUILTIN_MODULE" &&
    error.message.includes("node:sqlite")
  );
}
