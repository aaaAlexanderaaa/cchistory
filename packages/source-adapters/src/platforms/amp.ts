import path from "node:path";
import type { PlatformAdapter } from "./types.js";

export const ampAdapter: PlatformAdapter = {
  platform: "amp",
  getDefaultBaseDirCandidates: (options) => {
    const homeDir = options.homeDir ?? "";
    const hostPlatform = options.platform ?? process.platform;
    const localAppData = process.env.LOCALAPPDATA ?? path.join(homeDir, "AppData", "Local");

    if (hostPlatform === "win32") {
      return [
        path.join(localAppData, "amp", "threads"),
        path.join(homeDir, ".local", "share", "amp", "threads"),
      ];
    }
    return [path.join(homeDir, ".local", "share", "amp", "threads")];
  },
  matchesSourceFile: (filePath) => filePath.endsWith(".json"),
};
