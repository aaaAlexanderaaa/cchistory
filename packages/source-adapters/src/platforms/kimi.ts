import fs from "node:fs/promises";
import path from "node:path";
import { normalizePathSeparators } from "../core/utils.js";
import type { PlatformAdapter } from "./types.js";

export function resolveKimiRoot(baseDir: string): string {
  return path.basename(baseDir) === "sessions" ? path.dirname(baseDir) : baseDir;
}

export function resolveKimiSessionDir(filePath: string): string | undefined {
  const normalized = normalizePathSeparators(filePath);
  const match = normalized.match(/^(.*\/sessions\/[^/]+\/session_[^/]+)\/agents\/main\/wire\.jsonl$/u);
  return match?.[1] ? path.normalize(match[1]) : undefined;
}

export function listKimiSourceRoots(baseDir: string): string[] {
  return [path.join(resolveKimiRoot(baseDir), "sessions")];
}

export async function listKimiCompanionEvidencePaths(baseDir: string, filePath: string): Promise<string[]> {
  const kimiRoot = resolveKimiRoot(baseDir);
  const sessionDir = resolveKimiSessionDir(filePath);
  const companions = new Set<string>([
    path.join(kimiRoot, "session_index.jsonl"),
    path.join(kimiRoot, "workspaces.json"),
  ]);

  if (sessionDir) {
    companions.add(path.join(sessionDir, "state.json"));
    const agentsDir = path.join(sessionDir, "agents");
    try {
      for (const entry of await fs.readdir(agentsDir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== "main") {
          companions.add(path.join(agentsDir, entry.name, "wire.jsonl"));
        }
      }
    } catch {}
  }

  try {
    const historyDir = path.join(kimiRoot, "user-history");
    for (const entry of await fs.readdir(historyDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        companions.add(path.join(historyDir, entry.name));
      }
    }
  } catch {}

  return [...companions];
}

export const kimiAdapter: PlatformAdapter = {
  platform: "kimi",
  supportTier: "experimental",
  getDefaultBaseDirCandidates: (options) => [path.join(options.homeDir ?? "", ".kimi-code")],
  getSourceRoots: (baseDir) => listKimiSourceRoots(baseDir),
  matchesSourceFile: (filePath) => resolveKimiSessionDir(filePath) !== undefined,
  getCompanionEvidencePaths: (baseDir, filePath) => listKimiCompanionEvidencePaths(baseDir, filePath),
};
