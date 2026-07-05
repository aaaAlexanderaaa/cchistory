import { usageError } from "./errors.js";

/**
 * Opaque cursor for paginated CLI commands.
 *
 * The cursor is base64url-encoded JSON so consumers can treat it as a black
 * box. Today it carries only the next offset; reserving fields like
 * `filters_hash` for future use without breaking the wire format.
 *
 * Design rules:
 *   - Cursors are *hints*. Storage may evict rows between calls; the consumer
 *     must tolerate a cursor that returns an already-seen row.
 *   - Cursors never encode sensitive data. They are safe to log.
 *   - Decoding errors surface as a usage error (exit 2), not a crash.
 */

export interface CursorPayload {
  /** Offset to resume from. */
  offset: number;
  /** Schema version of the cursor envelope itself, not the data. */
  v: 1;
}

const SCHEMA_VERSION = 1 as const;

export function encodeCursor(offset: number): string {
  const payload: CursorPayload = { v: SCHEMA_VERSION, offset };
  const json = JSON.stringify(payload);
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeCursor(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  let json: string;
  try {
    json = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    throw usageError("Invalid --cursor: not valid base64url.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw usageError("Invalid --cursor: payload is not JSON.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw usageError("Invalid --cursor: payload is not an object.");
  }
  const payload = parsed as Partial<CursorPayload>;
  if (typeof payload.v !== "number" || payload.v !== SCHEMA_VERSION) {
    throw usageError(`Invalid --cursor: unsupported schema version (got ${String(payload.v)}, expected ${SCHEMA_VERSION}).`);
  }
  if (typeof payload.offset !== "number" || !Number.isFinite(payload.offset) || payload.offset < 0) {
    throw usageError("Invalid --cursor: missing or non-numeric offset.");
  }
  return payload.offset;
}
