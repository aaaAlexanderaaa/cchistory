import path from "node:path";
import type { PlatformAdapter } from "./types.js";

const OPENCODE_STORAGE_SUFFIX = "/.local/share/opencode/storage";
const OPENCODE_PROJECT_SUFFIX = "/.local/share/opencode/project";
const OPENCODE_LEGACY_SESSION_SUFFIX = "/.local/share/opencode/storage/session";

export const opencodeAdapter: PlatformAdapter = {
  platform: "opencode",
  supportTier: "stable",
  getDefaultBaseDirCandidates: (options) => [
    path.join(options.homeDir ?? "", ".local", "share", "opencode", "storage"),
    path.join(options.homeDir ?? "", ".local", "share", "opencode", "project"),
    path.join(options.homeDir ?? "", ".local", "share", "opencode", "storage", "session"),
  ],
  matchesSourceFile: (filePath) => {
    if (!filePath.endsWith(".json")) {
      return false;
    }
    const normalized = normalizePath(filePath);
    return normalized.includes("/storage/session/");
  },
  getSupplementalSourceRoots: (baseDir) => {
    const homeDir = deriveOpencodeHomeDir(baseDir);
    if (!homeDir) {
      return [];
    }
    if (normalizePath(baseDir).endsWith(OPENCODE_PROJECT_SUFFIX)) {
      return [path.join(homeDir, ".local", "share", "opencode", "storage")];
    }
    return [];
  },
};

function deriveOpencodeHomeDir(baseDir: string): string | undefined {
  const normalizedBaseDir = normalizePath(baseDir);
  for (const suffix of [OPENCODE_STORAGE_SUFFIX, OPENCODE_PROJECT_SUFFIX, OPENCODE_LEGACY_SESSION_SUFFIX]) {
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
