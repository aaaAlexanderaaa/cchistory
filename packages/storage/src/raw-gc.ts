import path from "node:path";
import { readdir, rm, stat } from "node:fs/promises";
import type { CapturedBlob } from "@cchistory/domain";
import { CCHistoryStorage } from "./internal/storage.js";

export interface RawSnapshotGcResult {
  scanned_files: number;
  referenced_files: number;
  kept_files: number;
  kept_bytes: number;
  deleted_files: number;
  deleted_bytes: number;
  removed_dirs: number;
}

export async function pruneOrphanRawSnapshots(options: {
  storage: CCHistoryStorage;
  rawDir: string;
  dryRun?: boolean;
}): Promise<RawSnapshotGcResult> {
  const rawDir = path.resolve(options.rawDir);
  const dryRun = options.dryRun ?? false;
  const referencedPaths = collectReferencedRawPaths(options.storage.listAllBlobs(), rawDir);
  const files = await collectFiles(rawDir);

  let keptBytes = 0;
  let deletedBytes = 0;
  let keptFiles = 0;
  let deletedFiles = 0;

  for (const filePath of files) {
    const size = (await stat(filePath)).size;
    if (referencedPaths.has(filePath)) {
      keptFiles += 1;
      keptBytes += size;
      continue;
    }

    deletedFiles += 1;
    deletedBytes += size;
    if (!dryRun) {
      await rm(filePath, { force: true });
    }
  }

  const removedDirs = dryRun ? 0 : await removeEmptyDirectories(rawDir, rawDir);

  return {
    scanned_files: files.length,
    referenced_files: referencedPaths.size,
    kept_files: keptFiles,
    kept_bytes: keptBytes,
    deleted_files: deletedFiles,
    deleted_bytes: deletedBytes,
    removed_dirs: removedDirs,
  };
}

function collectReferencedRawPaths(blobs: CapturedBlob[], rawDir: string): Set<string> {
  const results = new Set<string>();
  for (const blob of blobs) {
    if (!blob.captured_path) {
      continue;
    }
    const resolvedPath = path.resolve(blob.captured_path);
    if (!isPathWithinDirectory(resolvedPath, rawDir)) {
      continue;
    }
    results.add(resolvedPath);
  }
  return results;
}

async function collectFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }
    throw error;
  }

  const results: string[] = [];
  for (const entry of entries) {
    const nextPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectFiles(nextPath)));
      continue;
    }
    if (entry.isFile()) {
      results.push(path.resolve(nextPath));
    }
  }
  return results.sort();
}

async function removeEmptyDirectories(dir: string, stopDir: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) {
      return 0;
    }
    throw error;
  }

  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    removed += await removeEmptyDirectories(path.join(dir, entry.name), stopDir);
  }

  if (path.resolve(dir) === path.resolve(stopDir)) {
    return removed;
  }

  const remainingEntries = await readdir(dir);
  if (remainingEntries.length > 0) {
    return removed;
  }

  await rm(dir, { recursive: true, force: true });
  return removed + 1;
}

function isPathWithinDirectory(candidatePath: string, directory: string): boolean {
  const normalizedDirectory = path.resolve(directory);
  const normalizedCandidate = path.resolve(candidatePath);
  return (
    normalizedCandidate === normalizedDirectory ||
    normalizedCandidate.startsWith(normalizedDirectory + path.sep)
  );
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
