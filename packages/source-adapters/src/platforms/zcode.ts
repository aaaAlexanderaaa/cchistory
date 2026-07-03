import path from "node:path";
import { normalizePathSeparators } from "../core/utils.js";
import type { PlatformAdapter } from "./types.js";

export const zcodeAdapter: PlatformAdapter = {
  platform: "zcode",
  supportTier: "experimental",
  getDefaultBaseDirCandidates: (options) => [path.join(options.homeDir ?? "", ".zcode")],
  getSourceRoots: (baseDir) => resolveZcodeSourceRoots(baseDir),
  matchesSourceFile: (filePath) => path.basename(filePath) === "db.sqlite",
  getCompanionEvidencePaths: (_baseDir, filePath) => [
    `${filePath}-wal`,
    `${filePath}-shm`,
  ],
};

function resolveZcodeSourceRoots(baseDir: string): string[] {
  const normalized = normalizePathSeparators(baseDir);
  if (normalized.endsWith("/cli/db")) {
    return [baseDir];
  }
  if (normalized.endsWith("/cli")) {
    return [path.join(baseDir, "db")];
  }
  return [path.join(baseDir, "cli", "db")];
}
