import fs from "node:fs/promises";
import path from "node:path";
import { normalizePathSeparators } from "../core/utils.js";
import type { PlatformAdapter } from "./types.js";

function resolveOpenClawHome(baseDir: string): string {
  return path.basename(baseDir) === "agents" ? path.dirname(baseDir) : baseDir;
}

async function listOpenClawCompanionEvidencePaths(baseDir: string): Promise<string[]> {
  const companionPaths = new Set<string>();
  const agentRoots: string[] = [];

  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    const subdirs = entries.filter((entry) => entry.isDirectory());
    const hasAgentSubdirs = subdirs.some((entry) => entry.name === "agent" || entry.name === "sessions");

    if (path.basename(baseDir) === "agents" || !hasAgentSubdirs) {
      for (const entry of subdirs) {
        agentRoots.push(path.join(baseDir, entry.name));
      }
    }
    if (hasAgentSubdirs || subdirs.length === 0) {
      agentRoots.push(baseDir);
    }
  } catch {
    return [];
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
    const normalized = normalizePathSeparators(filePath);
    return path.basename(path.dirname(filePath)) === "sessions" || normalized.includes("/cron/runs/");
  },
  getCompanionEvidencePaths: (baseDir) => listOpenClawCompanionEvidencePaths(baseDir),
};
