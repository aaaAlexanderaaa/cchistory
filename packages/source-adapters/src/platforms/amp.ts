import path from "node:path";
import type { PlatformAdapter } from "./types.js";

export const ampAdapter: PlatformAdapter = {
  platform: "amp",
  getDefaultBaseDirCandidates: (options) => [path.join(options.homeDir ?? "", ".local", "share", "amp", "threads")],
  matchesSourceFile: (filePath) => filePath.endsWith(".json"),
};
