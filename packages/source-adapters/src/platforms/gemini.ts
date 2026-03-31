import path from "node:path";
import type { PlatformAdapter } from "./types.js";

export function extractGeminiProjectKey(filePath: string): string | undefined {
  const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  const tmpIndex = parts.lastIndexOf("tmp");
  if (tmpIndex === -1 || tmpIndex + 2 >= parts.length) {
    return undefined;
  }
  if (parts[tmpIndex + 2] !== "chats") {
    return undefined;
  }
  return parts[tmpIndex + 1];
}

export function resolveGeminiRoot(baseDir: string, filePath: string): string | undefined {
  const fileParts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  const geminiIndex = fileParts.lastIndexOf(".gemini");
  if (geminiIndex !== -1) {
    return `${filePath.startsWith(path.sep) ? path.sep : ""}${fileParts.slice(0, geminiIndex + 1).join(path.sep)}`;
  }

  const normalizedBase = baseDir.replace(/\\/g, "/");
  if (normalizedBase.endsWith("/.gemini")) {
    return baseDir;
  }
  if (normalizedBase.endsWith("/.gemini/tmp") || normalizedBase.endsWith("/.gemini/history")) {
    return path.dirname(baseDir);
  }
  return undefined;
}

export function listGeminiCompanionEvidencePaths(baseDir: string, filePath: string): string[] {
  const projectKey = extractGeminiProjectKey(filePath);
  const geminiRoot = resolveGeminiRoot(baseDir, filePath);
  if (!projectKey || !geminiRoot) {
    return [];
  }

  return [
    path.join(geminiRoot, "projects.json"),
    path.join(geminiRoot, "tmp", projectKey, ".project_root"),
    path.join(geminiRoot, "history", projectKey, ".project_root"),
  ];
}

export function listGeminiSourceRoots(baseDir: string): string[] {
  const normalizedBase = baseDir.replace(/\\/g, "/");
  if (normalizedBase.endsWith("/.gemini")) {
    return [path.join(baseDir, "tmp")];
  }
  return [baseDir];
}

export const geminiAdapter: PlatformAdapter = {
  platform: "gemini",
  supportTier: "experimental",
  getDefaultBaseDirCandidates: (options) => [path.join(options.homeDir ?? "", ".gemini")],
  getSourceRoots: (baseDir) => listGeminiSourceRoots(baseDir),
  matchesSourceFile: (filePath) => {
    if (!filePath.endsWith('.json')) {
      return false;
    }
    const normalized = filePath.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    const chatsIndex = parts.lastIndexOf('chats');
    return chatsIndex >= 2 && parts[chatsIndex - 2] === 'tmp';
  },
  getCompanionEvidencePaths: (baseDir, filePath) => listGeminiCompanionEvidencePaths(baseDir, filePath),
};
