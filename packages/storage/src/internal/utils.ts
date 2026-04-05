import { nowIso, normalizeLocalPathIdentity } from "@cchistory/domain";

export { nowIso };

export function uniqueStrings<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

export function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

export function toJson(value: object): string {
  return JSON.stringify(value);
}

export function dedupeByKey<T>(items: readonly T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

export function fromJson<T>(value: string, context?: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    const preview = value.length > 120 ? value.slice(0, 120) + "..." : value;
    const message = context
      ? `Failed to parse JSON (${context}): ${preview}`
      : `Failed to parse JSON: ${preview}`;
    throw new Error(message, { cause: error });
  }
}

export function compositeKey(prefix: string, ...parts: string[]): string {
  return `${prefix}-${parts.join("-").replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
}

export function normalizePathKey(value: string | undefined): string | undefined {
  return normalizeLocalPathIdentity(value);
}

export function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function incrementArtifactRevisionId(currentRevisionId: string): string {
  const match = currentRevisionId.match(/^(.*):r(\d+)$/);
  if (!match) {
    return `${currentRevisionId}:r2`;
  }
  return `${match[1]}:r${Number(match[2]) + 1}`;
}
