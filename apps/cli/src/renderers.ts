export function renderTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) {
    return "(no rows)";
  }

  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );
  const headerLine = headers.map((header, index) => header.padEnd(widths[index] ?? header.length)).join("  ");
  const separatorLine = widths.map((width) => "-".repeat(width)).join("  ");
  const rowLines = rows.map((row) => row.map((cell, index) => (cell ?? "").padEnd(widths[index] ?? 0)).join("  "));
  return [headerLine, separatorLine, ...rowLines].join("\n");
}

export function renderKeyValue(entries: Array<[string, string]>): string {
  const width = Math.max(...entries.map(([key]) => key.length), 0);
  return entries.map(([key, value]) => `${key.padEnd(width)} : ${value}`).join("\n");
}

export function renderSection(title: string, body: string): string {
  return `${title}\n${"-".repeat(title.length)}\n${body}`;
}

export function indentBlock(value: string, spaces = 2): string {
  const prefix = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

export function truncateText(value: string, length = 72): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= length) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, length - 3))}...`;
}

export function formatRatio(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function shortId(value: string, length = 12): string {
  return value.length <= length ? value : value.slice(0, length);
}
