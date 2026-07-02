import { createHash } from "node:crypto";
import type { SourceFragment } from "@cchistory/domain";

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function safeJsonParse(value: string | undefined): unknown {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}...`;
}

export function compareFragments(left: SourceFragment, right: SourceFragment): number {
  return compareTimeThenSeq(left, right);
}

export function compareTimeThenSeq(
  left: { time_key: string; seq_no: number },
  right: { time_key: string; seq_no: number },
): number {
  if (left.time_key === right.time_key) {
    return left.seq_no - right.seq_no;
  }
  return left.time_key.localeCompare(right.time_key);
}

export function dedupeById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function sumDefinedNumbers(...values: (number | undefined)[]): number {
  return values.reduce((acc: number, val) => acc + (val ?? 0), 0);
}

export function firstDefinedNumber(...values: (number | undefined)[]): number | undefined {
  return values.find((val) => val !== undefined);
}

export function epochMillisToIso(value: number | undefined): string | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return undefined;
  }
  return new Date(value).toISOString();
}

export function coerceIso(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function sha1(value: string | Buffer): string {
  return createHash("sha1").update(value).digest("hex");
}
