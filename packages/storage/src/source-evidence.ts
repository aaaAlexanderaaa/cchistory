import { createHash } from "node:crypto";
import { createReadStream, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type { CapturedBlob } from "@cchistory/domain";
import type { DatabaseSync } from "node:sqlite";

interface SourceCapture {
  sha256: string; storage_path: string; size_bytes: number; created_at: string; absolutePath: string;
}

function locateSourceCapture(db: DatabaseSync, assetDir: string | undefined, blob: CapturedBlob): SourceCapture | undefined {
  if (!assetDir) return undefined;
  const row = db.prepare(`SELECT eb.sha256, eb.storage_path, eb.size_bytes, eb.created_at
    FROM evidence_captures ec JOIN evidence_blobs eb ON eb.sha256 = ec.evidence_sha256
    WHERE ec.source_id = ? AND ec.blob_id = ? AND ec.capture_kind = 'source_blob'
      AND ec.source_checksum = ? AND ec.size_bytes = ?
    ORDER BY ec.created_at, ec.id LIMIT 1`).get(blob.source_id, blob.id, blob.checksum, blob.size_bytes) as
      Omit<SourceCapture, "absolutePath"> | undefined;
  if (!row) return undefined;
  const absolutePath = path.resolve(assetDir, row.storage_path);
  const root = path.resolve(assetDir) + path.sep;
  if (!absolutePath.startsWith(root)) throw new Error(`Source evidence path escapes store for ${blob.id}`);
  try {
    if (!lstatSync(absolutePath).isFile() || !realpathSync(absolutePath).startsWith(realpathSync(assetDir) + path.sep)) {
      throw new Error(`Source evidence is not a regular contained file for ${blob.id}`);
    }
  } catch (error) {
    throw new Error(`Retained source evidence unavailable for ${blob.id}: ${(error as Error).message}`);
  }
  return { ...row, absolutePath };
}

function verifyDigest(blob: CapturedBlob, capture: SourceCapture, size: number, sha256: string, sha1: string): void {
  const checksum = blob.checksum.trim().toLowerCase();
  if (size !== capture.size_bytes || size !== blob.size_bytes || sha256 !== capture.sha256 ||
    (checksum && checksum !== (checksum.length === 40 ? sha1 : sha256))) {
    throw new Error(`Retained source evidence integrity mismatch for ${blob.id}`);
  }
}

export function readVerifiedSourceCapture(db: DatabaseSync, assetDir: string | undefined, blob: CapturedBlob):
  (SourceCapture & { bytes: Buffer }) | undefined {
  const capture = locateSourceCapture(db, assetDir, blob);
  if (!capture) return undefined;
  const bytes = readFileSync(capture.absolutePath);
  verifyDigest(blob, capture, bytes.length, createHash("sha256").update(bytes).digest("hex"), createHash("sha1").update(bytes).digest("hex"));
  return { ...capture, bytes };
}

// Large captures are verified as a stream rather than another whole-file allocation.
export async function verifiedSourceCapturePath(db: DatabaseSync, assetDir: string | undefined, blob: CapturedBlob): Promise<string | undefined> {
  const capture = locateSourceCapture(db, assetDir, blob);
  if (!capture) return undefined;
  const sha256 = createHash("sha256");
  const sha1 = createHash("sha1");
  let size = 0;
  for await (const chunk of createReadStream(capture.absolutePath)) {
    sha256.update(chunk); sha1.update(chunk); size += chunk.length;
  }
  verifyDigest(blob, capture, size, sha256.digest("hex"), sha1.digest("hex"));
  return capture.absolutePath;
}
