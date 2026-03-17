import path from "node:path";
import type { PlatformAdapter } from "./types.js";

export const claudeCodeAdapter: PlatformAdapter = {
  platform: "claude_code",
  getDefaultBaseDirCandidates: (options) => {
    const homeDir = options.homeDir ?? "";
    const hostPlatform = options.platform ?? process.platform;
    const localAppData = process.env.LOCALAPPDATA ?? path.join(homeDir, "AppData", "Local");

    if (hostPlatform === "win32") {
      return [
        path.join(homeDir, ".claude", "projects"),
        path.join(localAppData, "claude", "projects"),
      ];
    }
    return [path.join(homeDir, ".claude", "projects")];
  },
  matchesSourceFile: (filePath) => filePath.endsWith(".jsonl"),
};
