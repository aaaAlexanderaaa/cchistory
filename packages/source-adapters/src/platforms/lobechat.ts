import path from "node:path";
import type { PlatformAdapter } from "./types.js";

export const lobechatAdapter: PlatformAdapter = {
  platform: "lobechat",
  getDefaultBaseDirCandidates: (options) => {
    const homeDir = options.homeDir ?? "";
    const hostPlatform = options.platform ?? process.platform;
    const appDataDir = options.appDataDir ?? process.env.APPDATA ?? path.join(homeDir, "AppData", "Roaming");

    if (hostPlatform === "win32") {
      return [
        path.join(appDataDir, "lobehub-storage"),
        path.join(homeDir, ".config", "lobehub-storage"),
      ];
    }
    return [path.join(homeDir, ".config", "lobehub-storage")];
  },
  matchesSourceFile: (filePath) => filePath.endsWith(".json"),
};
