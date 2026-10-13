import type { DatabaseSync } from "node:sqlite";

/** Return whether this caller owns a newly reserved writer transaction. */
export function beginImmediateTransactionIfNeeded(db: DatabaseSync): boolean {
  const active = db.isTransaction;
  if (active === true) return false;
  try {
    db.exec("BEGIN IMMEDIATE;");
    return true;
  } catch (error) {
    // Node's SQLite module predates isTransaction (added in 22.16). On those
    // runtimes SQLite itself can identify an existing transaction without
    // modifying it. Busy, I/O and all other failures still propagate.
    if (active === undefined && error instanceof Error && "code" in error &&
      error.code === "ERR_SQLITE_ERROR" &&
      error.message === "cannot start a transaction within a transaction") {
      return false;
    }
    throw error;
  }
}
