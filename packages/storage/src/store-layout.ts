import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface DefaultStoreDirInput {
  cwd: string;
  homeDir?: string;
}

export function resolveDefaultCchistoryDataDir(input: DefaultStoreDirInput): string {
  const homeStoreDir = resolveHomeStoreDir(input.homeDir);
  const homeRoot = homeStoreDir ? path.dirname(homeStoreDir) : undefined;
  return findNearestExistingStoreDir(input.cwd, homeRoot) ?? homeStoreDir ?? path.resolve(input.cwd, ".cchistory");
}

function findNearestExistingStoreDir(cwd: string, stopAtDir?: string): string | undefined {
  let current = path.resolve(cwd);
  const resolvedStopAtDir = stopAtDir ? path.resolve(stopAtDir) : undefined;
  const stopAtBoundary = resolvedStopAtDir ? isWithinOrEqualPath(current, resolvedStopAtDir) : false;
  while (true) {
    const currentRoot = path.parse(current).root;
    if (current === currentRoot && (!stopAtBoundary || current !== resolvedStopAtDir)) {
      return undefined;
    }
    const candidate = path.join(current, ".cchistory");
    if (existsSync(candidate)) {
      return candidate;
    }
    if (stopAtBoundary && current === resolvedStopAtDir) {
      return undefined;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function resolveHomeStoreDir(homeDir?: string): string | undefined {
  const resolvedHomeDir = homeDir?.trim() || process.env.HOME || process.env.USERPROFILE || os.homedir();
  return resolvedHomeDir ? path.resolve(resolvedHomeDir, ".cchistory") : undefined;
}

function isWithinOrEqualPath(targetPath: string, candidateParent: string): boolean {
  const relative = path.relative(candidateParent, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
