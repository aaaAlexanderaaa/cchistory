import {
  type ProjectIdentity,
  type SessionProjection,
  type SessionRelatedWorkProjection,
  type SourceStatus,
  type TurnSearchResult,
  type UserTurnProjection,
} from "@cchistory/domain";
import type { CCHistoryStorage } from "@cchistory/storage";
import { tameBrowseMarkup } from "@cchistory/presentation";
import { type ParsedArgs, getFlag, hasFlag } from "./args.js";
import { bold, dim, cyan, green, yellow, magenta, red, blue, heading, muted, id as idColor } from "./colors.js";
import type { StoreLayout } from "./store.js";

export interface RelatedWorkRollup {
  delegated_sessions: number;
  automation_runs: number;
}

/** Column alignment for renderTable. */
export type ColumnAlign = "left" | "right";

export function renderTable(headers: string[], rows: string[][], options?: { align?: ColumnAlign[] }): string {
  if (rows.length === 0) {
    return muted("(no rows)");
  }

  const alignments = options?.align;

  // Strip ANSI escape codes for width calculation
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

  const widths = headers.map((header, index) =>
    Math.max(displayWidth(header), ...rows.map((row) => displayWidth(stripAnsi(row[index] ?? "")))),
  );
  const headerLine = headers
    .map((header, index) => {
      const w = widths[index] ?? displayWidth(header);
      const align = alignments?.[index] ?? "left";
      const pad = Math.max(0, w - displayWidth(header));
      return bold(align === "right" ? " ".repeat(pad) + header : header + " ".repeat(pad));
    })
    .join("  ");
  const separatorLine = dim(widths.map((width) => "-".repeat(width)).join("  "));
  const rowLines = rows.map((row) =>
    row
      .map((cell, index) => {
        const w = widths[index] ?? 0;
        const align = alignments?.[index] ?? "left";
        const stripped = stripAnsi(cell ?? "");
        const pad = Math.max(0, w - displayWidth(stripped));
        if (align === "right") {
          return " ".repeat(pad) + (cell ?? "");
        }
        return (cell ?? "") + " ".repeat(pad);
      })
      .join("  "),
  );
  return [headerLine, separatorLine, ...rowLines].join("\n");
}

export function renderBarChart(
  rows: Array<{ label: string; value: number }>,
  options: {
    width?: number;
    barChar?: string;
  } = {},
): string {
  if (rows.length === 0) {
    return "(no rows)";
  }

  const width = options.width ?? 28;
  const barChar = options.barChar ?? "#";
  const maxValue = Math.max(...rows.map((row) => row.value), 0);
  const labelWidth = Math.max(...rows.map((row) => row.label.length), 0);
  const formattedValues = rows.map((row) => formatNumber(row.value));
  const valueWidth = Math.max(...formattedValues.map((value) => value.length), 1);

  return rows
    .map((row, index) => {
      const barLength =
        maxValue <= 0 ? 0 : Math.max(row.value > 0 ? 1 : 0, Math.round((row.value / maxValue) * width));
      return `${row.label.padEnd(labelWidth)}  ${cyan(formattedValues[index]?.padStart(valueWidth) ?? "0")}  ${green(barChar.repeat(barLength))}`;
    })
    .join("\n");
}

export function renderKeyValue(entries: Array<[string, string]>): string {
  const width = Math.max(...entries.map(([key]) => key.length), 0);
  return entries.map(([key, val]) => `${dim(key.padEnd(width))} ${dim(":")} ${val}`).join("\n");
}

export function renderSection(title: string, body: string): string {
  return `${heading(title)}\n${dim("-".repeat(title.length))}\n${body}`;
}

export function indentBlock(value: string, spaces = 2): string {
  const prefix = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

/** Check if a character code is a full-width (East Asian Wide) character that occupies 2 terminal columns. */
function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2e80 && code <= 0x303e) || // CJK Radicals, Kangxi, CJK Symbols
    (code >= 0x3040 && code <= 0x33bf) || // Hiragana, Katakana, CJK Compat
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Unified Extension A
    (code >= 0x4e00 && code <= 0xa4cf) || // CJK Unified + Yi
    (code >= 0xac00 && code <= 0xd7af) || // Hangul Syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK Compat Ideographs
    (code >= 0xfe30 && code <= 0xfe6f) || // CJK Compat Forms + Small Forms
    (code >= 0xff01 && code <= 0xff60) || // Fullwidth Forms
    (code >= 0xffe0 && code <= 0xffe6) || // Fullwidth Signs
    (code >= 0x20000 && code <= 0x2fa1f)  // CJK Extension B-F, Compat Supplement
  );
}

/** Get the display width of a string in terminal columns (accounts for full-width CJK characters). */
export function displayWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    w += isWide(ch.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return w;
}

/**
 * Truncate a string to fit within `maxWidth` terminal columns.
 * Accounts for full-width characters. Appends "..." when truncated.
 */
export function truncateText(value: string, maxWidth = 72): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (displayWidth(normalized) <= maxWidth) {
    return normalized;
  }
  let w = 0;
  let i = 0;
  const chars = [...normalized]; // iterate by codepoint
  for (; i < chars.length; i++) {
    const cw = isWide(chars[i]!.codePointAt(0) ?? 0) ? 2 : 1;
    if (w + cw + 3 > maxWidth) break; // reserve 3 cols for "..."
    w += cw;
  }
  return chars.slice(0, i).join("") + "...";
}

export function formatRatio(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Format an ISO timestamp as "Mar 20 15:32" — compact and scannable. */
export function formatCompactDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const month = SHORT_MONTHS[d.getMonth()];
  const day = String(d.getDate()).padStart(2, " ");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${month} ${day} ${hh}:${mm}`;
}

/**
 * Format an ISO timestamp as a relative/compact date:
 *  - <1 min ago  → "just now"
 *  - <60 min ago → "12m ago"
 *  - <24h ago    → "3h ago"
 *  - <7d ago     → "2d ago"
 *  - older       → "Mar 20" (no time)
 */
export function formatCompactDateRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = Date.now();
  const diffMs = now - d.getTime();
  if (diffMs < 0) {
    // future date — just show compact
    return formatCompactDate(iso);
  }
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  // Older: show "Mar 20"
  const month = SHORT_MONTHS[d.getMonth()];
  const day = String(d.getDate()).padStart(2, " ");
  return `${month} ${day}`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function shortId(value: string, length = 12): string {
  return value.length <= length ? value : value.slice(0, length);
}

/** Strip the common `sess:<platform>:` prefix from session IDs and show the first 8 chars of the UUID. */
export function smartSessionId(id: string): string {
  const match = id.match(/^sess:[^:]+:(.+)$/);
  const core = match?.[1] ?? id;
  return core.length <= 8 ? core : core.slice(0, 8);
}

export function summarizeLabelCounts(values: string[], maxLabels = 3): string {
  const counts = new Map<string, number>();
  for (const value of values.map((entry) => entry.trim()).filter((entry) => entry.length > 0)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const entries = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  if (entries.length === 0) {
    return "none";
  }
  const labels = entries.slice(0, maxLabels).map(([label, count]) => (count > 1 ? `${label}×${count}` : label));
  if (entries.length > maxLabels) {
    labels.push(`+${entries.length - maxLabels} more`);
  }
  return labels.join(", ");
}

export function rollupRelatedWork(entries: SessionRelatedWorkProjection[]): RelatedWorkRollup {
  return entries.reduce<RelatedWorkRollup>(
    (totals, entry) => {
      if (entry.relation_kind === "automation_run") {
        totals.automation_runs += 1;
      } else {
        totals.delegated_sessions += 1;
      }
      return totals;
    },
    { delegated_sessions: 0, automation_runs: 0 },
  );
}

export function mergeRelatedWorkRollups(left: RelatedWorkRollup, right: RelatedWorkRollup): RelatedWorkRollup {
  return {
    delegated_sessions: left.delegated_sessions + right.delegated_sessions,
    automation_runs: left.automation_runs + right.automation_runs,
  };
}

export function formatRelatedWorkRollup(rollup: RelatedWorkRollup): string {
  const parts: string[] = [];
  if (rollup.delegated_sessions > 0) {
    parts.push(`${rollup.delegated_sessions} delegated`);
  }
  if (rollup.automation_runs > 0) {
    parts.push(`${rollup.automation_runs} automation`);
  }
  return parts.join(", ") || "none";
}

export function relatedWorkTargetRef(entry: SessionRelatedWorkProjection): string {
  return entry.target_session_ref ?? entry.automation_job_ref ?? entry.target_run_ref ?? entry.id;
}

export function formatRelatedWorkEntry(entry: SessionRelatedWorkProjection): string {
  const relationLabel = entry.relation_kind === "automation_run" ? "automation run" : "delegated session";
  const details = [entry.transcript_primary ? "transcript-primary" : "evidence-only"];
  if (entry.child_agent_key) {
    details.push(`agent=${entry.child_agent_key}`);
  }
  if (entry.automation_job_ref) {
    details.push(`job=${entry.automation_job_ref}`);
  }
  if (entry.status) {
    details.push(`status=${entry.status}`);
  }
  if (entry.title) {
    details.push(`title=${truncateText(entry.title, 48)}`);
  }
  return `${relationLabel} ${relatedWorkTargetRef(entry)} (${details.join(", ")})`;
}

export function formatSearchResultContext(
  result: TurnSearchResult,
  relatedWork: RelatedWorkRollup,
  sourcesById: Map<string, SourceStatus>,
  options: { long?: boolean } = {},
): string {
  const session = result.session;
  const source = session?.source_id ? sourcesById.get(session.source_id) : undefined;
  const sourceLabel = source ? source.display_name : session?.source_platform ?? "unknown";
  const model = result.turn.context_summary.primary_model ?? "";
  const workspace = session?.working_directory ? workspaceBasename(session.working_directory) : "";

  const parts = [sourceLabel];
  if (model) parts.push(model);
  if (workspace) parts.push(workspace);
  if (options.long) {
    if (session?.title) parts.push(truncateText(session.title, 32));
    const related = formatRelatedWorkRollup(relatedWork);
    if (related !== "none") parts.push(related);
  }
  return dim(parts.join(" · "));
}

export function formatSearchResultPivots(result: TurnSearchResult, options: { long?: boolean } = {}): string {
  const sessionRef = result.session?.id ?? result.turn.session_id;
  if (!options.long) {
    return `${dim("→")} show turn ${idColor(shortId(result.turn.id))}`;
  }
  const pivots = [
    `show turn ${idColor(shortId(result.turn.id))}`,
    `show session ${idColor(sessionRef)}`,
    `tree session ${idColor(sessionRef)} --long`,
  ];
  if (result.project) {
    pivots.push(`show project ${idColor(result.project.slug)}`);
  }
  return pivots.join(dim(" | "));
}

/**
 * Pick the best snippet text for a search result.
 *
 * Strategy:
 *  1. If canonical_text has a trailing user request section (e.g. "## My request"
 *     at the end of a code review template), extract that.
 *  2. Otherwise fall back to the raw canonical_text with markup stripped.
 */
export function pickSearchSnippet(turn: UserTurnProjection): string {
  const raw = turn.canonical_text ?? "";

  // Codex code-review pattern: the actual request is after the last "## My request" heading
  const requestIdx = raw.lastIndexOf("## My request");
  if (requestIdx >= 0) {
    const afterHeading = raw.slice(requestIdx).replace(/^##\s*My request[^\n]*\n?/, "").trim();
    if (afterHeading.length > 0) {
      return tameBrowseMarkup(afterHeading);
    }
  }

  return tameBrowseMarkup(raw);
}

export function formatBrowseSnippet(value: string | null | undefined, maxLength: number): string {
  return truncateText(tameBrowseMarkup(value ?? ""), maxLength);
}

function workspaceBasename(dir: string): string {
  const segments = dir.replace(/\/+$/, "").split("/");
  return segments[segments.length - 1] ?? dir;
}

export { tameBrowseMarkup } from "@cchistory/presentation";

export function formatSessionListTitle(title: string | null | undefined): string {
  return truncateText(title ?? "", 56);
}

export function formatSessionListWorkspace(workspace: string | null | undefined): string {
  if (!workspace) {
    return "";
  }
  return truncatePathMiddle(workspace, 42);
}

export function formatSessionListSource(source: SourceStatus | undefined, session: SessionProjection): string {
  return `${source?.slot_id ?? session.source_platform}@${shortId(session.host_id)}`;
}

export function formatTreeSourceLabel(source: SourceStatus | undefined, session: SessionProjection): string {
  return source ? `${source.display_name} (${source.platform})` : session.source_platform;
}

export function formatSessionListModel(model: string | null | undefined): string {
  return truncateText(model ?? "unknown", 16);
}

export function decorateImportConflictError(
  error: unknown,
  options: {
    bundleDir: string;
    targetArg: string;
  },
): Error {
  if (!(error instanceof Error) || !error.message.startsWith("Source conflict detected for ")) {
    return error instanceof Error ? error : new Error(String(error));
  }
  const baseCommand = `cchistory import ${quoteCliArg(options.bundleDir)} ${options.targetArg}`;
  return new Error(
    [
      error.message,
      "Next steps:",
      `  Preview conflicts: ${baseCommand} --dry-run`,
      `  Keep existing data: ${baseCommand} --on-conflict skip`,
      `  Replace existing data: ${baseCommand} --on-conflict replace`,
    ].join("\n"),
  );
}

export function renderImportTargetArg(parsed: ParsedArgs, layout: StoreLayout): string {
  const storeArg = getFlag(parsed, "store");
  if (storeArg && storeArg !== "true") {
    return `--store ${quoteCliArg(storeArg)}`;
  }
  const dbArg = getFlag(parsed, "db");
  if (dbArg && dbArg !== "true") {
    return `--db ${quoteCliArg(dbArg)}`;
  }
  return `--db ${quoteCliArg(layout.dbPath)}`;
}

export function quoteCliArg(value: string): string {
  return JSON.stringify(value);
}

export function truncatePathMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 8) {
    return truncateText(value, maxLength);
  }
  const budget = maxLength - 3;
  const tailLength = Math.max(12, Math.floor(budget * 0.65));
  const headLength = Math.max(4, budget - tailLength);
  return `${value.slice(0, headLength)}...${value.slice(-tailLength)}`;
}

export function projectLabel(project: ProjectIdentity | undefined): string {
  if (!project) {
    return "unassigned";
  }
  return project.display_name;
}

export function listVisibleProjects(storage: CCHistoryStorage, parsed: ParsedArgs): ProjectIdentity[] {
  return sortProjectsForDisplay(filterProjectsForDisplay(storage.listProjects(), parsed));
}

export function filterProjectsForDisplay(projects: ProjectIdentity[], parsed: ParsedArgs): ProjectIdentity[] {
  if (hasFlag(parsed, "showall")) {
    return projects;
  }
  return projects.filter((project) => !isEmptyProject(project));
}

export function isEmptyProject(project: ProjectIdentity): boolean {
  return project.session_count === 0 && project.committed_turn_count === 0 && project.candidate_turn_count === 0;
}

export function sortProjectsForDisplay(projects: ProjectIdentity[]): ProjectIdentity[] {
  return [...projects].sort((left, right) => {
    const leftTurns = left.committed_turn_count + left.candidate_turn_count;
    const rightTurns = right.committed_turn_count + right.candidate_turn_count;
    if (leftTurns !== rightTurns) {
      return rightTurns - leftTurns;
    }
    if (left.session_count !== right.session_count) {
      return right.session_count - left.session_count;
    }
    const activityCompare = (right.project_last_activity_at ?? right.updated_at).localeCompare(
      left.project_last_activity_at ?? left.updated_at,
    );
    if (activityCompare !== 0) {
      return activityCompare;
    }
    return left.display_name.localeCompare(right.display_name);
  });
}

/** Colorize a sync status string: green=healthy, yellow=stale, red=error. */
export function colorizeStatus(status: string): string {
  switch (status) {
    case "healthy":
      return green(status);
    case "stale":
      return yellow(status);
    case "error":
      return red(status);
    case "active":
      return green(status);
    case "empty":
      return dim(status);
    default:
      return status;
  }
}

/** Colorize a number value (used by stats renderKeyValue). */
export function colorizeValue(val: string): string {
  return cyan(val);
}

// ── Search clustering ──

export type ClusterOrResult =
  | { clustered: true; snippet: string; results: TurnSearchResult[]; dateRange: string }
  | { clustered: false; result: TurnSearchResult };

/**
 * Cluster search results that share identical snippets.
 * Groups of ≥3 identical-snippet results become a single summary line.
 */
export function clusterSearchResults(
  results: TurnSearchResult[],
  snippetMaxLength: number,
): ClusterOrResult[] {
  const snippets = results.map((r) => truncateText(pickSearchSnippet(r.turn), snippetMaxLength));
  const counts = new Map<string, number>();
  for (const s of snippets) {
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }

  const output: ClusterOrResult[] = [];
  const clustered = new Map<string, TurnSearchResult[]>();

  for (let i = 0; i < results.length; i++) {
    const snippet = snippets[i]!;
    const count = counts.get(snippet) ?? 0;
    if (count >= 3) {
      if (!clustered.has(snippet)) {
        clustered.set(snippet, []);
      }
      clustered.get(snippet)!.push(results[i]!);
    } else {
      output.push({ clustered: false, result: results[i]! });
    }
  }

  for (const [snippet, group] of clustered) {
    const dates = group.map((r) => new Date(r.turn.submission_started_at).getTime()).sort();
    const earliest = formatCompactDate(new Date(dates[0]!).toISOString());
    const latest = formatCompactDate(new Date(dates[dates.length - 1]!).toISOString());
    const dateRange = earliest === latest ? earliest : `${earliest} – ${latest}`;
    output.push({ clustered: true, snippet, results: group, dateRange });
  }

  return output;
}
