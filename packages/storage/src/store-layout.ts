import os from "node:os";
import path from "node:path";

export interface DefaultStoreDirInput {
  cwd: string;
  homeDir?: string;
}

export function resolveDefaultCchistoryDataDir(input: DefaultStoreDirInput): string {
  const homeStoreDir = resolveHomeStoreDir(input.homeDir);
  return homeStoreDir ?? path.resolve(input.cwd, ".cchistory");
}

function resolveHomeStoreDir(homeDir?: string): string | undefined {
  const resolvedHomeDir = homeDir?.trim() || process.env.HOME || process.env.USERPROFILE || os.homedir();
  return resolvedHomeDir ? path.resolve(resolvedHomeDir, ".cchistory") : undefined;
}
