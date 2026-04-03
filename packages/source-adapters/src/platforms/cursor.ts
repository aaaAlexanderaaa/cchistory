import path from "node:path";
import type { PlatformAdapter } from "./types.js";

export const cursorAdapter: PlatformAdapter = {
  platform: "cursor",
  supportTier: "stable",
  getDefaultBaseDirCandidates: (options) => {
    const homeDir = options.homeDir ?? "";
    const hostPlatform = options.platform ?? process.platform;
    const appDataDir = options.appDataDir ?? process.env.APPDATA ?? path.join(homeDir, "AppData", "Roaming");

    if (hostPlatform === "darwin") {
      return [
        path.join(homeDir, ".cursor", "projects"),
        path.join(homeDir, "Library", "Application Support", "Cursor", "User"),
        path.join(homeDir, "Library", "Application Support", "Cursor"),
      ];
    }
    if (hostPlatform === "win32") {
      return [
        path.join(homeDir, ".cursor", "projects"),
        path.join(appDataDir, "Cursor", "User"),
        path.join(appDataDir, "Cursor"),
      ];
    }
    return [
      path.join(homeDir, ".cursor", "projects"),
      path.join(homeDir, ".config", "Cursor", "User"),
      path.join(homeDir, ".config", "Cursor"),
      path.join(homeDir, ".config", "cursor", "User"),
      path.join(homeDir, ".config", "cursor"),
    ];
  },
  matchesSourceFile: (filePath) =>
    path.basename(filePath) === "state.vscdb" ||
    (path.basename(filePath) === "store.db" && filePath.includes(`${path.sep}chats${path.sep}`)) ||
    (filePath.endsWith(".jsonl") && filePath.includes(`${path.sep}agent-transcripts${path.sep}`)),
  getSourceFilePriority: (filePath) => {
    if (filePath.includes(`${path.sep}agent-transcripts${path.sep}`)) {
      return 0;
    }
    if (filePath.includes(`${path.sep}workspaceStorage${path.sep}`)) {
      return 1;
    }
    if (filePath.includes(`${path.sep}chats${path.sep}`) && path.basename(filePath) === "store.db") {
      return 2;
    }
    if (filePath.includes(`${path.sep}globalStorage${path.sep}`)) {
      return 3;
    }
    return 4;
  },
};
