import type { SourcePlatform } from "@cchistory/domain";

export type AdapterSupportTier = "stable" | "experimental";

export type SupportedSourcePlatform =
  | "codex"
  | "claude_code"
  | "factory_droid"
  | "amp"
  | "cursor"
  | "antigravity"
  | "gemini"
  | "openclaw"
  | "opencode"
  | "lobechat"
  | "codebuddy"
  | "accio"
  | "zcode"
  | "kimi";

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
  supportTier: AdapterSupportTier;
  getDefaultBaseDirCandidates(options: DefaultSourceResolutionOptions): string[];
  getSourceRoots?(baseDir: string): string[];
  matchesSourceFile(filePath: string): boolean;
  /**
   * Declares that source files can be grouped by the canonical source-session
   * identity and each group projected independently. Omit when the adapter
   * requires source-wide assembly or has not proved a narrower boundary.
   */
  logicalSessionGrouping?: "source_session_id";
  getSourceFilePriority?(filePath: string): number;
  getSupplementalSourceRoots?(baseDir: string): string[];
  getCompanionEvidencePaths?(baseDir: string, filePath: string): string[] | Promise<string[]>;
}

export function isSupportedSourcePlatform(platform: SourcePlatform): platform is SupportedSourcePlatform {
  return (
    platform === "codex" ||
    platform === "claude_code" ||
    platform === "factory_droid" ||
    platform === "amp" ||
    platform === "cursor" ||
    platform === "antigravity" ||
    platform === "gemini" ||
    platform === "openclaw" ||
    platform === "opencode" ||
    platform === "lobechat" ||
    platform === "codebuddy" ||
    platform === "accio" ||
    platform === "zcode" ||
    platform === "kimi"
  );
}
