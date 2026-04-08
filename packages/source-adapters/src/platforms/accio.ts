import { readdirSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { normalizePathSeparators } from "../core/utils.js";
import type { PlatformAdapter } from "./types.js";

/**
 * Accio Work stores per-account agent sessions and subagent sessions as JSONL.
 *
 * Layout:
 *   ~/.accio/accounts/<accountId>/agents/<agentId>/sessions/*.messages.jsonl
 *   ~/.accio/accounts/<accountId>/subagent-sessions/*.messages.jsonl
 *
 * The adapter treats the "agents" directory as the base dir and discovers
 * per-agent session subdirectories as source roots.  Subagent session files
 * are added via supplemental roots.
 */

function resolveAccioAccountRoot(baseDir: string): string {
  // baseDir is typically ~/.accio/accounts/<id>/agents
  return path.basename(baseDir) === "agents" ? path.dirname(baseDir) : baseDir;
}

async function listAccioCompanionEvidencePaths(baseDir: string): Promise<string[]> {
  const companions = new Set<string>();
  const accountRoot = resolveAccioAccountRoot(baseDir);

  // Agent profiles contain agent name, model, personality — useful metadata
  try {
    const agentDirs = await fs.readdir(baseDir, { withFileTypes: true });
    for (const entry of agentDirs.filter((e) => e.isDirectory())) {
      const profilePath = path.join(baseDir, entry.name, "agent-core", "profile.jsonc");
      companions.add(profilePath);
      // Session meta files for created_at / title
      const sessionsDir = path.join(baseDir, entry.name, "sessions");
      try {
        for (const sess of await fs.readdir(sessionsDir, { withFileTypes: true })) {
          if (sess.isFile() && sess.name.endsWith(".meta.jsonc")) {
            companions.add(path.join(sessionsDir, sess.name));
          }
        }
      } catch {}
    }
  } catch {}

  // Subagent meta files
  const subagentDir = path.join(accountRoot, "subagent-sessions");
  try {
    for (const entry of await fs.readdir(subagentDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".meta.jsonc")) {
        companions.add(path.join(subagentDir, entry.name));
      }
    }
  } catch {}

  // Conversation metadata (for workspace path and conversation title)
  const convDir = path.join(accountRoot, "conversations", "dm");
  try {
    for (const entry of await fs.readdir(convDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".jsonc")) {
        companions.add(path.join(convDir, entry.name));
      }
    }
  } catch {}

  return [...companions];
}

export const accioAdapter: PlatformAdapter = {
  platform: "accio",
  supportTier: "experimental",
  getDefaultBaseDirCandidates: (options) => {
    const homeDir = options.homeDir ?? "";
    const accountsDir = path.join(homeDir, ".accio", "accounts");
    // Return all <accountId>/agents dirs as candidates
    try {
      const accountDirs = readdirSync(accountsDir, { withFileTypes: true });
      const candidates = accountDirs
        .filter((entry) => entry.isDirectory() && entry.name !== "guest")
        .map((entry) => path.join(accountsDir, entry.name, "agents"));
      if (candidates.length > 0) {
        return candidates;
      }
    } catch {}
    return [path.join(accountsDir, "default", "agents")];
  },
  getSupplementalSourceRoots: (baseDir) => {
    const accountRoot = resolveAccioAccountRoot(baseDir);
    return [path.join(accountRoot, "subagent-sessions")];
  },
  matchesSourceFile: (filePath) => {
    if (!filePath.endsWith(".messages.jsonl")) {
      return false;
    }
    const normalized = normalizePathSeparators(filePath);
    return (
      normalized.includes("/sessions/") ||
      normalized.includes("/subagent-sessions/")
    );
  },
  getSourceFilePriority: (filePath) => {
    // Prioritize main agent sessions over subagent sessions
    const normalized = normalizePathSeparators(filePath);
    if (normalized.includes("/subagent-sessions/")) {
      return 1;
    }
    return 0;
  },
  getCompanionEvidencePaths: (baseDir) => listAccioCompanionEvidencePaths(baseDir),
};
