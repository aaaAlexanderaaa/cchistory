import path from "node:path";
import type { PlatformAdapter } from "./types.js";

export const opencodeAdapter: PlatformAdapter = {
  platform: "opencode",
  getDefaultBaseDirCandidates: (options) => {
    const homeDir = options.homeDir ?? "";
    const hostPlatform = options.platform ?? process.platform;
    const localAppData = process.env.LOCALAPPDATA ?? path.join(homeDir, "AppData", "Local");

    if (hostPlatform === "win32") {
      return [
        path.join(localAppData, "opencode", "storage", "session"),
        path.join(homeDir, ".local", "share", "opencode", "storage", "session"),
      ];
    }
    return [path.join(homeDir, ".local", "share", "opencode", "storage", "session")];
  },
  matchesSourceFile: (filePath) => filePath.endsWith(".json"),
};
