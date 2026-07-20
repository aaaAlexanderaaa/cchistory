import { normalizeLocalPathIdentity } from "@cchistory/domain";

export function uniqueStrings<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
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
