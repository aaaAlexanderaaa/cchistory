import path from "node:path";
import type { PlatformAdapter } from "./types.js";

export const codexAdapter: PlatformAdapter = {
  platform: "codex",
  supportTier: "stable",
  getDefaultBaseDirCandidates: (options) => [path.join(options.homeDir ?? "", ".codex", "sessions")],
  matchesSourceFile: (filePath) => path.basename(filePath) !== "history.jsonl" && (filePath.endsWith(".jsonl") || filePath.endsWith(".json")),
};
