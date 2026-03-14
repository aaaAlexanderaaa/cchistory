import path from "node:path";
import type { PlatformAdapter } from "./types.js";

export const codexAdapter: PlatformAdapter = {
  platform: "codex",
  getDefaultBaseDirCandidates: (options) => [path.join(options.homeDir ?? "", ".codex", "sessions")],
  matchesSourceFile: (filePath) => filePath.endsWith(".jsonl") || filePath.endsWith(".json"),
};
