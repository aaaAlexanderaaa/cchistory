import type { SourcePlatform } from "@cchistory/domain";

export type SupportedSourcePlatform =
  | "codex"
  | "claude_code"
  | "factory_droid"
  | "amp"
  | "cursor"
  | "antigravity"
  | "openclaw"
  | "opencode"
  | "lobechat";

export interface DefaultSourceResolutionOptions {
  homeDir?: string;
  hostname?: string;
  platform?: NodeJS.Platform;
  appDataDir?: string;
  pathExists?: (targetPath: string) => boolean;
  includeMissing?: boolean;
}

export interface PlatformAdapter {
  platform: SupportedSourcePlatform;
  getDefaultBaseDirCandidates(options: DefaultSourceResolutionOptions): string[];
  matchesSourceFile(filePath: string): boolean;
  getSourceFilePriority?(filePath: string): number;
  getSupplementalSourceRoots?(baseDir: string): string[];
}

export function isSupportedSourcePlatform(platform: SourcePlatform): platform is SupportedSourcePlatform {
  return (
    platform === "codex" ||
    platform === "claude_code" ||
    platform === "factory_droid" ||
    platform === "amp" ||
    platform === "cursor" ||
    platform === "antigravity" ||
    platform === "openclaw" ||
    platform === "opencode" ||
    platform === "lobechat"
  );
}
