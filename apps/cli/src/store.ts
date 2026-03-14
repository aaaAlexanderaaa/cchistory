import path from "node:path";
import { CCHistoryStorage } from "@cchistory/storage";

export interface StoreLayout {
  dbPath: string;
  assetDir: string;
  rawDir: string;
}

export function resolveStoreLayout(input: {
  cwd: string;
  storeArg?: string;
  dbArg?: string;
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

  const assetDir = path.resolve(input.cwd, ".cchistory");
  return {
    dbPath: path.join(assetDir, "cchistory.sqlite"),
    assetDir,
    rawDir: path.join(assetDir, "raw"),
  };
}

export function openStorage(layout: StoreLayout): CCHistoryStorage {
  return new CCHistoryStorage({ dbPath: layout.dbPath });
}
