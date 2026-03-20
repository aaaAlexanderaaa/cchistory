import path from "node:path";
import type { PlatformAdapter } from "./types.js";

const OPENCODE_PROJECT_SUFFIX = "/.local/share/opencode/project";
const OPENCODE_LEGACY_SESSION_SUFFIX = "/.local/share/opencode/storage/session";

export const opencodeAdapter: PlatformAdapter = {
  platform: "opencode",
  supportTier: "experimental",
  getDefaultBaseDirCandidates: (options) => [
    path.join(options.homeDir ?? "", ".local", "share", "opencode", "project"),
    path.join(options.homeDir ?? "", ".local", "share", "opencode", "storage", "session"),
  ],
  matchesSourceFile: (filePath) => filePath.endsWith(".json") && path.basename(path.dirname(filePath)) === "session",
  getSupplementalSourceRoots: (baseDir) => {
    const homeDir = deriveOpencodeHomeDir(baseDir);
    if (!homeDir || !normalizePath(baseDir).endsWith(OPENCODE_PROJECT_SUFFIX)) {
      return [];
    }
    return [path.join(homeDir, ".local", "share", "opencode", "storage", "session")];
  },
};

function deriveOpencodeHomeDir(baseDir: string): string | undefined {
  const normalizedBaseDir = normalizePath(baseDir);
  for (const suffix of [OPENCODE_PROJECT_SUFFIX, OPENCODE_LEGACY_SESSION_SUFFIX]) {
    if (!normalizedBaseDir.endsWith(suffix)) {
      continue;
    }
    const homeDir = normalizedBaseDir.slice(0, -suffix.length);
    return homeDir || undefined;
  }
  return undefined;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}
