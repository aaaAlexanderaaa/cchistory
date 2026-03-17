import path from "node:path";
import type { PlatformAdapter } from "./types.js";

export const codexAdapter: PlatformAdapter = {
  platform: "codex",
  getDefaultBaseDirCandidates: (options) => {
    const homeDir = options.homeDir ?? "";
    const hostPlatform = options.platform ?? process.platform;
    const localAppData = process.env.LOCALAPPDATA ?? path.join(homeDir, "AppData", "Local");

    if (hostPlatform === "win32") {
      return [
        path.join(homeDir, ".codex", "sessions"),
        path.join(localAppData, "codex", "sessions"),
      ];
    }
    return [path.join(homeDir, ".codex", "sessions")];
  },
  matchesSourceFile: (filePath) => filePath.endsWith(".jsonl") || filePath.endsWith(".json"),
};
