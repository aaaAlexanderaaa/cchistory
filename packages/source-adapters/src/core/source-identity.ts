import path from "node:path";
import type { SourcePlatform, StageKind } from "@cchistory/domain";
import { stableId } from "@cchistory/domain";
import { getPlatformAdapter } from "../platforms/registry.js";
import { firstNonEmptyTrimmedLineFromBuffer } from "./jsonl-records.js";
import { asString, isObject } from "./type-guards.js";

export const RULE_VERSION = "2026-03-10.1";

export function buildStageRunId(sourceId: string, stageKind: StageKind): string {
  return stableId("stage-run", sourceId, stageKind);
}

export function getSourceFilePriority(platform: SourcePlatform, filePath: string): number {
  return getPlatformAdapter(platform)?.getSourceFilePriority?.(filePath) ?? 0;
}

export function deriveSessionId(platform: SourcePlatform, filePath: string, fileBuffer: Buffer): string {
  const sourceSessionId = extractSourceSessionId(platform, filePath, fileBuffer);
  if (sourceSessionId) {
    return `sess:${platform}:${sourceSessionId}`;
  }

  return `sess:${platform}:${path.basename(filePath, path.extname(filePath))}`;
}

export function extractSourceSessionId(platform: SourcePlatform, filePath: string, fileBuffer: Buffer): string | undefined {
  if (platform === "amp") {
    try {
      const parsed = JSON.parse(fileBuffer.toString("utf8")) as Record<string, unknown>;
      const id = asString(parsed.id);
      if (id) {
        return id;
      }
    } catch {
      return undefined;
    }
  }

  if (platform === "openclaw") {
    return path.basename(filePath, path.extname(filePath));
  }

  if (platform === "kimi") {
    const normalized = filePath.replace(/\\/gu, "/");
    const match = normalized.match(/\/((?:session_)[^/]+)\/agents\/main\/wire\.jsonl$/u);
    if (match?.[1]) {
      return match[1];
    }
  }

  if (platform === "gemini") {
    try {
      const parsed = JSON.parse(fileBuffer.toString("utf8")) as Record<string, unknown>;
      const id = asString(parsed.sessionId) ?? asString(parsed.id);
      if (id) {
        return id;
      }
    } catch {
      return undefined;
    }
  }

  if (platform === "codex") {
    const firstLine = firstNonEmptyTrimmedLineFromBuffer(fileBuffer);
    if (firstLine) {
      try {
        const parsed = JSON.parse(firstLine) as Record<string, unknown>;
        const payload = isObject(parsed.payload) ? parsed.payload : undefined;
        const sessionId = asString(payload?.id);
        if (sessionId) {
          return sessionId;
        }
      } catch {
        return undefined;
      }
    }
  }

  if (platform === "claude_code") {
    const firstLine = firstNonEmptyTrimmedLineFromBuffer(fileBuffer);
    if (firstLine) {
      try {
        const parsed = JSON.parse(firstLine) as Record<string, unknown>;
        const sessionId = asString(parsed.sessionId);
        if (sessionId) {
          return sessionId;
        }
      } catch {
        /* fall through to basename */
      }
    }
  }

  return undefined;
}

export function buildSourceResumeCommand(input: {
  platform: SourcePlatform;
  sourceSessionId?: string;
  workingDirectory?: string;
}): { command: string; working_directory: string; confidence: number } | undefined {
  if (!input.sourceSessionId || !input.workingDirectory) {
    return undefined;
  }

  const nativeCommand =
    input.platform === "codex"
      ? `codex resume ${quoteShellArg(input.sourceSessionId)}`
      : input.platform === "claude_code"
        ? `claude --resume ${quoteShellArg(input.sourceSessionId)}`
        : undefined;
  if (!nativeCommand) {
    return undefined;
  }

  return {
    command: `cd ${quoteShellArg(input.workingDirectory)} && ${nativeCommand}`,
    working_directory: input.workingDirectory,
    confidence: 1,
  };
}

/**
 * Inverse of `deriveSessionId`: strip the `sess:${platform}:` prefix to recover
 * the source-native session id. Returns undefined if `sessionId` is missing or
 * was not produced by the canonical id format — for example, if `deriveSessionId`
 * is ever changed to a hash-only scheme, this function will silently degrade
 * to "no resume available" with no signal. Callers that need to distinguish
 * "no source id" from "no canonical id" should check the prefix themselves.
 */
export function extractSourceSessionIdFromCanonicalSessionId(
  platform: SourcePlatform,
  sessionId: string | undefined,
): string | undefined {
  if (!sessionId) {
    return undefined;
  }
  const prefix = `sess:${platform}:`;
  if (!sessionId.startsWith(prefix)) {
    return undefined;
  }
  return sessionId.slice(prefix.length) || undefined;
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/u.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
