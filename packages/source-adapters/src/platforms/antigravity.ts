import path from "node:path";
import type { PlatformAdapter } from "./types.js";

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
  matchesSourceFile: (filePath) => path.basename(filePath) === "state.vscdb" || path.basename(filePath) === "task.md",
  getSourceFilePriority: (filePath) => {
    if (filePath.includes(`${path.sep}globalStorage${path.sep}`)) {
      return 0;
    }
    if (filePath.includes(`${path.sep}workspaceStorage${path.sep}`)) {
      return 1;
    }
    if (path.basename(filePath) === "task.md" && filePath.includes(`${path.sep}brain${path.sep}`)) {
      return 2;
    }
    return 3;
  },
};
