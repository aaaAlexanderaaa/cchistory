import fs from "node:fs/promises";
import path from "node:path";
import type { PlatformAdapter } from "./types.js";

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function resolveOpenClawHome(baseDir: string): string {
  return path.basename(baseDir) === "agents" ? path.dirname(baseDir) : baseDir;
}

async function listOpenClawCompanionEvidencePaths(baseDir: string): Promise<string[]> {
  const companionPaths = new Set<string>();
  const normalizedBaseName = path.basename(baseDir);
  const agentRoots: string[] = [];

  if (normalizedBaseName === "agents") {
    try {
      for (const entry of await fs.readdir(baseDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          agentRoots.push(path.join(baseDir, entry.name));
        }
      }
    } catch {
      return [];
    }
  } else {
    agentRoots.push(baseDir);
  }

  for (const agentRoot of agentRoots) {
    companionPaths.add(path.join(agentRoot, "agent", "auth-profiles.json"));
    companionPaths.add(path.join(agentRoot, "agent", "models.json"));

    const sessionsDir = path.join(agentRoot, "sessions");
    try {
      for (const entry of await fs.readdir(sessionsDir, { withFileTypes: true })) {
        if (!entry.isFile()) {
          continue;
        }
        if (entry.name.includes(".jsonl.reset.") || entry.name.includes(".jsonl.deleted.")) {
          companionPaths.add(path.join(sessionsDir, entry.name));
        }
      }
    } catch {}
  }

  return [...companionPaths];
}

export const openclawAdapter: PlatformAdapter = {
  platform: "openclaw",
  supportTier: "stable",
  getDefaultBaseDirCandidates: (options) => [path.join(options.homeDir ?? "", ".openclaw", "agents")],
  getSupplementalSourceRoots: (baseDir) => [path.join(resolveOpenClawHome(baseDir), "cron", "runs")],
  matchesSourceFile: (filePath) => {
    if (!filePath.endsWith(".jsonl")) {
      return false;
    }
    const normalized = normalizePath(filePath);
    return path.basename(path.dirname(filePath)) === "sessions" || normalized.includes("/cron/runs/");
  },
  getCompanionEvidencePaths: (baseDir) => listOpenClawCompanionEvidencePaths(baseDir),
};
