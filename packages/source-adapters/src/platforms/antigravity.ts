import path from "node:path";
import type { PlatformAdapter } from "./types.js";

const ANTIGRAVITY_CONVERSATION_HISTORY_FILE = /^Conversation_.*_History\.md$/u;
const ANTIGRAVITY_HOME_SUFFIXES = [
  "/Library/Application Support/Antigravity/User",
  "/Library/Application Support/Antigravity",
  "/Library/Application Support/antigravity/User",
  "/Library/Application Support/antigravity",
  "/AppData/Roaming/Antigravity/User",
  "/AppData/Roaming/Antigravity",
  "/AppData/Roaming/antigravity/User",
  "/AppData/Roaming/antigravity",
  "/.config/Antigravity/User",
  "/.config/Antigravity",
  "/.config/antigravity/User",
  "/.config/antigravity",
  "/.gemini/antigravity/brain",
  "/.gemini/antigravity",
] as const;

export interface AntigravityRoots {
  homeDir?: string;
  brainDir?: string;
  conversationDir?: string;
}

export function isAntigravityBrainSourceFile(filePath: string): boolean {
  const baseName = path.basename(filePath);
  return baseName === "task.md" || ANTIGRAVITY_CONVERSATION_HISTORY_FILE.test(baseName);
}

export function isAntigravityHistoryIndexFile(filePath: string): boolean {
  return path.basename(filePath) === "entries.json" && filePath.includes(`${path.sep}History${path.sep}`);
}

export const antigravityAdapter: PlatformAdapter = {
  platform: "antigravity",
  getDefaultBaseDirCandidates: (options) => {
    const homeDir = options.homeDir ?? "";
    const hostPlatform = options.platform ?? process.platform;
    const appDataDir = options.appDataDir ?? process.env.APPDATA ?? path.join(homeDir, "AppData", "Roaming");

    if (hostPlatform === "darwin") {
      return [
        path.join(homeDir, "Library", "Application Support", "Antigravity", "User"),
        path.join(homeDir, "Library", "Application Support", "Antigravity"),
        path.join(homeDir, ".gemini", "antigravity", "brain"),
        path.join(homeDir, ".gemini", "antigravity"),
      ];
    }
    if (hostPlatform === "win32") {
      return [
        path.join(appDataDir, "Antigravity", "User"),
        path.join(appDataDir, "Antigravity"),
        path.join(homeDir, ".gemini", "antigravity", "brain"),
        path.join(homeDir, ".gemini", "antigravity"),
      ];
    }
    return [
      path.join(homeDir, ".config", "Antigravity", "User"),
      path.join(homeDir, ".config", "Antigravity"),
      path.join(homeDir, ".config", "antigravity", "User"),
      path.join(homeDir, ".config", "antigravity"),
      path.join(homeDir, ".gemini", "antigravity", "brain"),
      path.join(homeDir, ".gemini", "antigravity"),
    ];
  },
  matchesSourceFile: (filePath) =>
    path.basename(filePath) === "state.vscdb" ||
    isAntigravityHistoryIndexFile(filePath) ||
    isAntigravityBrainSourceFile(filePath),
  getSourceFilePriority: (filePath) => {
    if (filePath.includes(`${path.sep}globalStorage${path.sep}`)) {
      return 0;
    }
    if (filePath.includes(`${path.sep}workspaceStorage${path.sep}`)) {
      return 1;
    }
    if (isAntigravityHistoryIndexFile(filePath)) {
      return 2;
    }
    if (isAntigravityBrainSourceFile(filePath) && filePath.includes(`${path.sep}brain${path.sep}`)) {
      return 3;
    }
    return 4;
  },
  getSupplementalSourceRoots: (baseDir) => {
    const roots = resolveAntigravityRoots(baseDir);
    return roots.brainDir ? [roots.brainDir] : [];
  },
};

export function resolveAntigravityRoots(baseDir: string): AntigravityRoots {
  const homeDir = deriveOfficialAntigravityHome(baseDir);
  if (!homeDir) {
    return {};
  }
  return {
    homeDir,
    brainDir: path.normalize(path.join(homeDir, ".gemini", "antigravity", "brain")),
    conversationDir: path.normalize(path.join(homeDir, ".gemini", "antigravity", "conversations")),
  };
}

export function deriveOfficialAntigravityHome(baseDir: string): string | undefined {
  const normalizedBaseDir = baseDir.replace(/\\/g, "/");

  for (const suffix of ANTIGRAVITY_HOME_SUFFIXES) {
    if (!normalizedBaseDir.endsWith(suffix)) {
      continue;
    }
    const homeDir = normalizedBaseDir.slice(0, -suffix.length);
    return homeDir || undefined;
  }

  return undefined;
}
