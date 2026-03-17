import path from "node:path";
import type { PlatformAdapter } from "./types.js";

export const factoryDroidAdapter: PlatformAdapter = {
  platform: "factory_droid",
  getDefaultBaseDirCandidates: (options) => {
    const homeDir = options.homeDir ?? "";
    const hostPlatform = options.platform ?? process.platform;
    const localAppData = process.env.LOCALAPPDATA ?? path.join(homeDir, "AppData", "Local");

    if (hostPlatform === "win32") {
      return [
        path.join(homeDir, ".factory", "sessions"),
        path.join(localAppData, "factory", "sessions"),
      ];
    }
    return [path.join(homeDir, ".factory", "sessions")];
  },
  matchesSourceFile: (filePath) => filePath.endsWith(".jsonl"),
};
