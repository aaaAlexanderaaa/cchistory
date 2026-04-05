import {
  type ProjectIdentity,
  type SessionProjection,
  type SessionRelatedWorkProjection,
  type SourceStatus,
  type TurnSearchResult,
} from "@cchistory/domain";
import type { CCHistoryStorage } from "@cchistory/storage";
import { tameBrowseMarkup } from "@cchistory/presentation";
import { type ParsedArgs, getFlag, hasFlag } from "./args.js";
import { bold, dim, cyan, green, yellow, magenta, blue, heading, muted, id as idColor } from "./colors.js";
import type { StoreLayout } from "./store.js";

export interface RelatedWorkRollup {
  delegated_sessions: number;
  automation_runs: number;
}

export function renderTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) {
    return muted("(no rows)");
  }

  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );
  const headerLine = headers.map((header, index) => bold(header.padEnd(widths[index] ?? header.length))).join("  ");
  const separatorLine = dim(widths.map((width) => "-".repeat(width)).join("  "));
  const rowLines = rows.map((row) => row.map((cell, index) => (cell ?? "").padEnd(widths[index] ?? 0)).join("  "));
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
): string {
  const session = result.session;
  const source = session?.source_id ? sourcesById.get(session.source_id) : undefined;
  const sourceLabel = source ? `${source.display_name} (${source.platform})` : session?.source_platform ?? result.turn.source_id;
  const parts = [
    `session=${session?.id ?? result.turn.session_id}`,
    `source=${sourceLabel}`,
  ];
  if (session?.title) {
    parts.push(`title=${truncateText(session.title, 32)}`);
  }
  if (session?.working_directory) {
    parts.push(`workspace=${truncateText(session.working_directory, 40)}`);
  }
  parts.push(`related=${formatRelatedWorkRollup(relatedWork)}`);
  return parts.join(" ");
}

export function formatSearchResultPivots(result: TurnSearchResult): string {
  const sessionRef = result.session?.id ?? result.turn.session_id;
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

export function formatBrowseSnippet(value: string | null | undefined, maxLength: number): string {
  return truncateText(tameBrowseMarkup(value ?? ""), maxLength);
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
  return truncateText(model ?? "unknown", 24);
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
  return `${project.display_name} (${project.project_id})`;
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
