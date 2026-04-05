import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import type { CCHistoryStorage } from "@cchistory/storage";
import { resolveDefaultCchistoryDataDir } from "@cchistory/storage/store-layout";

export interface StoreLayout {
  dbPath: string;
  assetDir: string;
  rawDir: string;
}

export type TuiReadMode = "index" | "full";

export interface OpenedReadStore {
  layout: StoreLayout;
  storage: CCHistoryStorage;
  readMode: TuiReadMode;
  close: () => Promise<void>;
}

const SQLITE_MIN_NODE_MAJOR = 22;

type StorageModule = typeof import("@cchistory/storage");
type SourceAdaptersModule = typeof import("@cchistory/source-adapters");

let storageModulePromise: Promise<StorageModule> | undefined;
let sourceAdaptersModulePromise: Promise<SourceAdaptersModule> | undefined;

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

export async function openReadStorage(input: {
  cwd: string;
  storeArg?: string;
  dbArg?: string;
  homeDir?: string;
  readMode: TuiReadMode;
  sourceRefs: string[];
  limitFiles?: number;
}): Promise<OpenedReadStore> {
  const baseLayout = resolveStoreLayout(input);
  if (input.readMode === "index") {
    const storage = await openIndexedStorage(baseLayout);
    return {
      layout: baseLayout,
      storage,
      readMode: "index",
      close: async () => {
        storage.close();
      },
    };
  }

  const storage = await createStorage({ dbPath: ":memory:" });
  const layout: StoreLayout = {
    ...baseLayout,
    dbPath: `${baseLayout.dbPath} (full scan in memory)`,
  };

  try {
    await syncSelectedSources(storage, input.sourceRefs, input.limitFiles);
    return {
      layout,
      storage,
      readMode: "full",
      close: async () => {
        storage.close();
      },
    };
  } catch (error) {
    storage.close();
    throw error;
  }
}

async function openIndexedStorage(layout: StoreLayout): Promise<CCHistoryStorage> {
  try {
    ensureIndexedStoreExists(layout);
    return await createStorage({ dbPath: layout.dbPath });
  } catch (error) {
    throw formatStorageRuntimeError(error);
  }
}

async function createStorage(location: string | { dataDir?: string; dbPath?: string }): Promise<CCHistoryStorage> {
  try {
    const { CCHistoryStorage } = await loadStorageModule();
    return new CCHistoryStorage(location);
  } catch (error) {
    throw formatStorageRuntimeError(error);
  }
}

async function syncSelectedSources(storage: CCHistoryStorage, sourceRefs: string[], limitFiles?: number): Promise<void> {
  const { getDefaultSources, runSourceProbe } = await loadSourceAdaptersModule();
  const sources = applySourceSelection(getDefaultSources(), sourceRefs);
  for (const source of sources) {
    const result = await runSourceProbe(
      {
        source_ids: [source.id],
        limit_files_per_source: limitFiles,
      },
      [source],
    );
    for (const payload of result.sources) {
      storage.replaceSourcePayload(payload, { allow_host_rekey: true });
    }
  }
}

function applySourceSelection<T extends { id: string; slot_id: string }>(sources: T[], selectedRefs: string[]): T[] {
  if (selectedRefs.length === 0) {
    return sources;
  }
  return sources.filter((source) => selectedRefs.includes(source.id) || selectedRefs.includes(source.slot_id));
}

function ensureIndexedStoreExists(layout: StoreLayout): void {
  if (existsSync(layout.dbPath)) {
    return;
  }

  throw new Error(
    `No indexed store found at ${layout.dbPath}. Run \`cchistory sync\` or \`cchistory import\` first.`,
  );
}

async function loadStorageModule(): Promise<StorageModule> {
  storageModulePromise ??= import("@cchistory/storage");
  return storageModulePromise;
}

async function loadSourceAdaptersModule(): Promise<SourceAdaptersModule> {
  sourceAdaptersModulePromise ??= import("@cchistory/source-adapters");
  return sourceAdaptersModulePromise;
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
