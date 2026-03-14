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

export function fromJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

export function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${parts.join("-").replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function incrementArtifactRevisionId(currentRevisionId: string): string {
  const match = currentRevisionId.match(/^(.*):r(\d+)$/);
  if (!match) {
    return `${currentRevisionId}:r2`;
  }
  return `${match[1]}:r${Number(match[2]) + 1}`;
}
