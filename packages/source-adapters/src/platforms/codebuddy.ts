import { readdirSync } from "node:fs";
import path from "node:path";
import type { PlatformAdapter } from "./types.js";

export function listCodeBuddyCompanionEvidencePaths(baseDir: string): string[] {
  const companionPaths = [path.join(baseDir, "settings.json")];
  const localStorageDir = path.join(baseDir, "local_storage");

  try {
    for (const entry of readdirSync(localStorageDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".info")) {
        companionPaths.push(path.join(localStorageDir, entry.name));
      }
    }
  } catch {
  }

  return companionPaths;
}

export const codebuddyAdapter: PlatformAdapter = {
  platform: "codebuddy",
  supportTier: "stable",
  getDefaultBaseDirCandidates: (options) => [path.join(options.homeDir ?? "", ".codebuddy")],
  getSourceRoots: (baseDir) => [path.join(baseDir, "projects")],
  matchesSourceFile: (filePath) => filePath.endsWith(".jsonl") && normalizePath(filePath).includes("/projects/"),
  getCompanionEvidencePaths: (baseDir) => listCodeBuddyCompanionEvidencePaths(baseDir),
};

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}
