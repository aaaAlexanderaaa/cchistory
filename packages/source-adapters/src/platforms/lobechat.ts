import path from "node:path";
import type { PlatformAdapter } from "./types.js";

export const lobechatAdapter: PlatformAdapter = {
  platform: "lobechat",
  supportTier: "experimental",
  getDefaultBaseDirCandidates: (options) => [path.join(options.homeDir ?? "", ".config", "lobehub-storage")],
  matchesSourceFile: (filePath) => filePath.endsWith(".json"),
};
