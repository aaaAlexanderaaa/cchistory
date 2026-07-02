import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitProjectEvidence } from "./types.js";
import { normalizeWorkspacePath, pathExists } from "./path-utils.js";
import { sha1 } from "./type-guards.js";

const execFileAsync = promisify(execFile);

class TtlCache<K, V> {
  private entries = new Map<K, { value: V; expiresAt: number }>();
  constructor(private maxSize: number, private ttlMs: number) {}

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.entries.size >= this.maxSize) {
      // Evict oldest (first inserted — Map preserves insertion order)
      const firstKey = this.entries.keys().next().value;
      if (firstKey !== undefined) this.entries.delete(firstKey);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

const gitProjectEvidenceCache = new TtlCache<string, Promise<GitProjectEvidence | undefined>>(200, 5 * 60 * 1000);

export async function readGitProjectEvidence(workingDirectory?: string): Promise<GitProjectEvidence | undefined> {
  const workspacePath = normalizeWorkspacePath(workingDirectory ?? "");
  if (!workspacePath) {
    return undefined;
  }

  let cached = gitProjectEvidenceCache.get(workspacePath);
  if (!cached) {
    cached = loadGitProjectEvidence(workspacePath);
    gitProjectEvidenceCache.set(workspacePath, cached);
  }

  return cached;
}

export async function loadGitProjectEvidence(workspacePath: string): Promise<GitProjectEvidence | undefined> {
  if (!(await pathExists(workspacePath))) {
    return undefined;
  }

  const repoRoot = normalizeWorkspacePath(
    (await runGitCommand(["-C", workspacePath, "rev-parse", "--show-toplevel"])) ?? "",
  );
  if (!repoRoot) {
    return undefined;
  }

  const repoRemote = normalizeGitRemote(await runGitCommand(["-C", repoRoot, "config", "--get", "remote.origin.url"]));

  return {
    repoRoot,
    repoRemote,
    repoFingerprint: repoRemote ? sha1(Buffer.from(`repo-remote:${repoRemote}`)) : undefined,
  };
}

async function runGitCommand(args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      timeout: 2000,
      maxBuffer: 64 * 1024,
    });
    const output = stdout.trim();
    return output || undefined;
  } catch {
    return undefined;
  }
}

export function normalizeGitRemote(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) {
    return undefined;
  }

  let normalized = raw.replace(/\.git$/iu, "").replace(/\/+$/u, "");
  if (/^[^@]+@[^:]+:.+/u.test(normalized)) {
    normalized = normalized.replace(/^([^@]+@[^:]+):/u, "ssh://$1/");
  }

  return normalized;
}
