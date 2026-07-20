import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { SourcePlatform } from "@cchistory/domain";
import { deriveSessionId } from "./source-identity.js";

/**
 * Resolve the same logical session identity used by the canonical parser while
 * reading only the first non-empty JSONL record. This lets ephemeral consumers
 * assemble all files for one session before projection without retaining an
 * entire source payload in memory.
 */
export async function deriveSourceFileLogicalSessionKey(
  platform: SourcePlatform,
  filePath: string,
): Promise<string> {
  const input = createReadStream(filePath);
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      return deriveSessionId(platform, filePath, Buffer.from(line, "utf8"));
    }
    return deriveSessionId(platform, filePath, Buffer.alloc(0));
  } catch {
    // A file that cannot be read (deleted or rotated mid-scan, EACCES, EIO)
    // degrades to the same path-based key an empty file gets, so the scan
    // continues; the per-group probe re-reads the file and records its own
    // file_error event instead of aborting the whole source.
    return deriveSessionId(platform, filePath, Buffer.alloc(0));
  } finally {
    lines.close();
    input.destroy();
  }
}
