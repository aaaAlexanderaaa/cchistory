import path from "node:path";
import type { PlatformAdapter } from "./types.js";

export const claudeCodeAdapter: PlatformAdapter = {
  platform: "claude_code",
  getDefaultBaseDirCandidates: (options) => [path.join(options.homeDir ?? "", ".claude", "projects")],
  matchesSourceFile: (filePath) => filePath.endsWith(".jsonl"),
};
