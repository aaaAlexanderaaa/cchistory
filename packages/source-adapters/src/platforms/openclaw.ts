import path from "node:path";
import type { PlatformAdapter } from "./types.js";

export const openclawAdapter: PlatformAdapter = {
  platform: "openclaw",
  supportTier: "experimental",
  getDefaultBaseDirCandidates: (options) => [path.join(options.homeDir ?? "", ".openclaw", "agents")],
  matchesSourceFile: (filePath) =>
    filePath.endsWith(".jsonl") && path.basename(path.dirname(filePath)) === "sessions",
};
