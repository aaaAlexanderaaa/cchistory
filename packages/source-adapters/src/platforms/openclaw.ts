import path from "node:path";
import type { PlatformAdapter } from "./types.js";

export const openclawAdapter: PlatformAdapter = {
  platform: "openclaw",
  getDefaultBaseDirCandidates: (options) => {
    const homeDir = options.homeDir ?? "";
    const hostPlatform = options.platform ?? process.platform;
    const localAppData = process.env.LOCALAPPDATA ?? path.join(homeDir, "AppData", "Local");

    if (hostPlatform === "win32") {
      return [
        path.join(homeDir, ".openclaw", "agents"),
        path.join(localAppData, "openclaw", "agents"),
      ];
    }
    return [path.join(homeDir, ".openclaw", "agents")];
  },
  matchesSourceFile: (filePath) =>
    filePath.endsWith(".jsonl") && path.basename(path.dirname(filePath)) === "sessions",
};
