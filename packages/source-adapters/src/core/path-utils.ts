import { promises as fs } from "node:fs";
import path from "node:path";
import type { SourcePlatform } from "@cchistory/domain";
import { normalizeLocalPathIdentity } from "@cchistory/domain";
import { getPlatformAdapter } from "../platforms/registry.js";
import { getSourceFilePriority } from "./source-identity.js";

export function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, "/");
}

export function normalizeFileUri(value: string): string {
  return normalizeLocalPathIdentity(value) ?? value.trim();
}

export function normalizeWorkspacePath(value: string): string | undefined {
  return normalizeLocalPathIdentity(value);
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function walkFiles(rootDir: string, limit?: number): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (limit && results.length >= limit) {
      break;
    }
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkFiles(fullPath, limit ? limit - results.length : undefined)));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

export async function listSourceFiles(
  platform: SourcePlatform,
  baseDir: string,
  limit?: number,
): Promise<string[]> {
  const adapter = getPlatformAdapter(platform);
  const roots = [...(adapter?.getSourceRoots?.(baseDir) ?? [baseDir]), ...(adapter?.getSupplementalSourceRoots?.(baseDir) ?? [])];
  const fileSet = new Set<string>();

  for (const rootDir of roots) {
    if (!(await pathExists(rootDir))) {
      continue;
    }
    for (const filePath of await walkFiles(rootDir)) {
      fileSet.add(filePath);
    }
  }

  const files = [...fileSet];
  const filtered = adapter ? files.filter((filePath) => adapter.matchesSourceFile(filePath)) : [];
  filtered.sort((left, right) => {
    const priorityDelta = getSourceFilePriority(platform, left) - getSourceFilePriority(platform, right);
    return priorityDelta !== 0 ? priorityDelta : left.localeCompare(right);
  });
  return typeof limit === "number" ? filtered.slice(0, limit) : filtered;
}
