import path from "node:path";
import type { PlatformAdapter } from "./types.js";

export const codexAdapter: PlatformAdapter = {
  platform: "codex",
  supportTier: "stable",
  getDefaultBaseDirCandidates: (options) => [path.join(options.homeDir ?? "", ".codex", "sessions")],
  matchesSourceFile: (filePath) => {
    const base = path.basename(filePath);
    if (base === "history.jsonl" || base === "session.jsonl") return false;
    return filePath.endsWith(".jsonl") || filePath.endsWith(".json");
  },
};
