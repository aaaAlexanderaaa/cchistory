import path from "node:path";
import type { PlatformAdapter } from "./types.js";

export const opencodeAdapter: PlatformAdapter = {
  platform: "opencode",
  getDefaultBaseDirCandidates: (options) => [
    path.join(options.homeDir ?? "", ".local", "share", "opencode", "storage", "session"),
  ],
  matchesSourceFile: (filePath) => filePath.endsWith(".json"),
};
