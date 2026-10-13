/**
 * Pure frame renderer for the Lite TUI.
 *
 * `renderLiteFrame` returns one complete screen: exactly `height` lines, each
 * at most `width` columns. The runtime paints it by homing the cursor and
 * rewriting every line, so there is no incremental diffing to get wrong and
 * the same function serves the non-interactive snapshot path.
 */

import type { SessionRelatedWorkProjection, SourceStatus, ToolCallProjection, TurnSearchResult } from "@cchistory/domain";
import {
  activeItem,
  activeSectionTitle,
  bold,
  cursor as cursorColor,
  cyan,
  danger,
  dim,
  green,
  heading,
  magenta,
  metaLabel,
  muted,
  platform as platformColor,
  sectionTitle,
  selectedItem,
  success,
  warning,
  yellow,
} from "./colors.js";
import type { LiteBrowserModel, LiteSessionEntry, LiteTurnEntry } from "./model.js";
import {
  STATS_DIMENSIONS,
  getSearchGroups,
  getSearchTotal,
  getSelectedProject,
  getSelectedSession,
  getSelectedSessionTurns,
  getSelectedTurn,
  getVisibleTurns,
  shouldRunSearch,
  type LiteBrowserState,
  type LiteFocusPane,
  type LiteSearchGroup,
  type LiteScrollLimits,
} from "./state.js";
import {
  clipLine,
  compact,
  displayWidth,
  formatCompactCount,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatShortDate,
  padLine,
  tameBrowseMarkup,
  tameDetailMarkup,
  wrapText,
} from "./text.js";
import { VERSION } from "./version.js";

/** Byte-identical to the pre-rewrite banner: release verifiers grep for both. */
export const BANNER_TITLE = `CC History Lite TUI ${VERSION}`;
export const BANNER_SUBTITLE = "Ephemeral live snapshot · single machine · no Full store";

export const DEFAULT_WIDTH = 120;
export const DEFAULT_HEIGHT = 40;

const LEFT_COLUMN_RATIO = 0.28;
const MIN_LEFT_COLUMN = 24;
const MAX_LEFT_COLUMN = 60;
const MIN_RIGHT_COLUMN = 30;
/** title + subtitle + counts + blank, then blank + status. */
const CHROME_LINES = 6;
const MIN_CONTENT_HEIGHT = 8;

export interface LiteRenderDimensions {
  width?: number;
  height?: number;
  /** Milliseconds since epoch, injected so frames are deterministic in tests. */
  now?: number;
}

export function renderLiteFrame(
  model: LiteBrowserModel,
  state: LiteBrowserState,
  dimensions: LiteRenderDimensions = {},
): string {
  return renderLiteFrameLayout(model, state, dimensions).frame;
}

/** Render and report bounds in one pass, without rewrapping long content. */
export function renderLiteFrameLayout(
  model: LiteBrowserModel,
  state: LiteBrowserState,
  dimensions: LiteRenderDimensions = {},
): { frame: string; scrollLimits: LiteScrollLimits } {
  const width = Math.max(40, dimensions.width ?? DEFAULT_WIDTH);
  const height = Math.max(CHROME_LINES + MIN_CONTENT_HEIGHT, dimensions.height ?? DEFAULT_HEIGHT);
  const now = dimensions.now ?? Date.now();
  const contentHeight = height - CHROME_LINES;
  const scrollLimits: LiteScrollLimits = { overlay: 0, detail: 0, conversation: 0 };

  const body = renderBody(model, state, { width, contentHeight, now, scrollLimits });
  while (body.length < contentHeight) body.push("");

  const lines = [
    heading(BANNER_TITLE),
    dim(BANNER_SUBTITLE),
    renderCountsLine(model, state),
    "",
    ...body.slice(0, contentHeight),
    renderStatusMessageLine(state, width),
    renderStatusBar(model, state),
  ];
  return { frame: lines.map((line) => clipLine(line, width)).join("\n"), scrollLimits };
}

interface BodyOptions {
  width: number;
  contentHeight: number;
  now: number;
  scrollLimits: LiteScrollLimits;
}

function renderBody(model: LiteBrowserModel, state: LiteBrowserState, options: BodyOptions): string[] {
  if (state.overlay === "help") return renderHelpOverlay(options.width, options.contentHeight, state.overlayScrollOffset, options.scrollLimits);
  if (state.overlay === "sources") return renderSourcesOverlay(model, options, state);
  if (state.overlay === "stats") return renderStatsOverlay(model, state, options);
  if (state.focusPane === "conversation") return renderConversation(model, state, options);
  // Below the two-pane minimum, give the focused pane the actual screen width.
  // Focus navigation remains the same; wrapping must never use hidden columns.
  if (options.width < MIN_LEFT_COLUMN + MIN_RIGHT_COLUMN + 3) {
    if (state.focusPane === "detail") return renderDetailPane(model, state, options.contentHeight, options.width, options.now, options.scrollLimits);
    const viewport = options.contentHeight - 3; // title and both direction hints
    if (state.focusPane === "turns") return renderTurnPane(model, state, viewport, options.width, options.now);
    if (state.mode === "search") return renderSearchGroupPane(model, state, viewport, options.width);
    return state.browseScope === "sessions"
      ? renderSessionPane(model, state, viewport, options.width, options.now)
      : renderProjectPane(model, state, viewport, options.width, options.now);
  }
  return renderTwoColumn(model, state, options);
}

// ── Header / footer chrome ──

function renderCountsLine(model: LiteBrowserModel, state: LiteBrowserState): string {
  const counts = model.counts;
  const parts = [
    `${counts.sources} sources`,
    `${counts.projects} projects`,
    `${counts.sessions} sessions`,
    `${counts.turns} turns`,
  ];
  const trail = state.mode === "search"
    ? `${dim(" · ")}${cyan(`search "${state.searchQuery}"`)}`
    : "";
  return `${dim(parts.join(" · "))}${trail}`;
}

function renderStatusMessageLine(state: LiteBrowserState, width: number): string {
  const status = state.status;
  if (!status) return "";
  const text = compact(status.text, Math.max(10, width - 2));
  if (status.kind === "error") return danger(`! ${text}`);
  if (status.kind === "busy") return warning(`… ${text}`);
  return muted(`· ${text}`);
}

function renderStatusBar(model: LiteBrowserModel, state: LiteBrowserState): string {
  const parts: string[] = [];
  if (state.overlay !== "none") parts.push(`overlay: ${state.overlay}`);
  else if (state.mode === "browse") parts.push(`${state.browseScope}/${focusPaneLabel(state.focusPane)}`);
  else parts.push(focusPaneLabel(state.focusPane));
  if (state.mode === "search") parts.push(`${getSearchTotal(model, state)} matches`);
  parts.push(`${model.counts.projects}P ${model.counts.turns}A`);
  parts.push("/ search");
  parts.push("r refresh");
  parts.push("? help");
  parts.push("q quit");
  return dim(parts.join(" │ "));
}

function focusPaneLabel(pane: LiteFocusPane): string {
  return pane === "turns" ? "asks" : pane;
}

// ── Two-column browse / search layout ──

function renderTwoColumn(model: LiteBrowserModel, state: LiteBrowserState, options: BodyOptions): string[] {
  const leftWidth = Math.max(
    MIN_LEFT_COLUMN,
    Math.min(MAX_LEFT_COLUMN, Math.floor(options.width * LEFT_COLUMN_RATIO)),
  );
  const rightWidth = Math.max(MIN_RIGHT_COLUMN, options.width - leftWidth - 3);
  const projectViewport = Math.max(options.contentHeight - 2, 4);
  const turnsViewport = Math.max(Math.floor((options.contentHeight - 4) / 2), 4);

  const leftLines = state.mode === "search"
    ? renderSearchGroupPane(model, state, projectViewport, leftWidth)
    : state.browseScope === "sessions"
      ? renderSessionPane(model, state, projectViewport, leftWidth, options.now)
      : renderProjectPane(model, state, projectViewport, leftWidth, options.now);

  // A focused detail pane needs its actual four-row minimum before scrolling;
  // clipping a larger virtual viewport afterward would hide its tail again.
  const turnPaneHeight = state.focusPane === "detail"
    ? Math.min(turnsViewport + 3, options.contentHeight - 5)
    : turnsViewport + 3;
  const turnLines = renderTurnPane(model, state, turnsViewport, rightWidth, options.now)
    .slice(0, turnPaneHeight);
  const detailHeight = Math.max(options.contentHeight - turnLines.length - 1, 4);
  const detailLines = renderDetailPane(model, state, detailHeight, rightWidth, options.now, options.scrollLimits);
  const rightLines = [...turnLines, "", ...detailLines].slice(0, options.contentHeight);

  const rows: string[] = [];
  const separator = dim("│");
  const rowCount = Math.max(leftLines.length, rightLines.length, options.contentHeight);
  for (let index = 0; index < rowCount; index += 1) {
    const left = padLine(clipLine(leftLines[index] ?? "", leftWidth), leftWidth);
    const right = clipLine(rightLines[index] ?? "", rightWidth);
    rows.push(`${left} ${separator} ${right}`);
  }
  return rows;
}

function renderProjectPane(
  model: LiteBrowserModel,
  state: LiteBrowserState,
  viewportSize: number,
  columnWidth: number,
  now: number,
): string[] {
  const focused = state.focusPane === "projects";
  const lines = [paneTitle("Projects", focused)];
  if (model.projects.length === 0) {
    lines.push(emptyRow("No projects"));
    return lines;
  }
  const window = viewportWindow(model.projects.length, state.selectedProjectIndex, viewportSize);
  if (window.start > 0) lines.push(muted(` ↑ ${window.start} more`));
  for (let index = window.start; index < window.end; index += 1) {
    const entry = model.projects[index]!;
    const selected = state.selectedProjectIndex === index;
    const meta = [`${entry.sessionCount}s`, `${entry.turnCount}a`, formatRelativeTime(entry.lastActivityAt, now)]
      .filter(Boolean)
      .join(" ");
    lines.push(alignedRow(selectionPrefix(selected, focused), entry.displayName, meta, columnWidth, selected, focused));
  }
  if (window.end < model.projects.length) {
    lines.push(muted(` ↓ ${model.projects.length - window.end} more`));
  }
  return lines;
}

function renderSessionPane(
  model: LiteBrowserModel,
  state: LiteBrowserState,
  viewportSize: number,
  columnWidth: number,
  now: number,
): string[] {
  const focused = state.focusPane === "projects";
  const lines = [paneTitle("Sessions", focused)];
  if (model.sessions.length === 0) {
    lines.push(emptyRow("No sessions"));
    return lines;
  }
  const window = viewportWindow(model.sessions.length, state.selectedSessionIndex, viewportSize);
  if (window.start > 0) lines.push(muted(` ↑ ${window.start} more`));
  for (let index = window.start; index < window.end; index += 1) {
    const entry = model.sessions[index]!;
    const selected = state.selectedSessionIndex === index;
    const name = entry.session.title
      ? tameBrowseMarkup(entry.session.title)
      : (entry.session.source_session_id ?? entry.session.id);
    const meta = [
      `${entry.turns.length}a`,
      entry.relatedWorkCount > 0 ? `${entry.relatedWorkCount}rel` : "",
      formatRelativeTime(entry.session.updated_at, now),
    ]
      .filter(Boolean)
      .join(" ");
    lines.push(alignedRow(selectionPrefix(selected, focused), name, meta, columnWidth, selected, focused));
  }
  if (window.end < model.sessions.length) {
    lines.push(muted(` ↓ ${model.sessions.length - window.end} more`));
  }
  return lines;
}

function renderSearchGroupPane(
  model: LiteBrowserModel,
  state: LiteBrowserState,
  viewportSize: number,
  columnWidth: number,
): string[] {
  const focused = state.focusPane === "projects";
  const queryDisplay = state.searchQuery.length > 0
    ? `${state.searchQuery}${focused ? cursorColor("▏") : ""}`
    : muted("(type to search)");
  const lines = [focused ? activeSectionTitle(`▸ / ${queryDisplay}`) : sectionTitle(`  / ${queryDisplay}`)];

  const groups = getSearchGroups(model, state);
  if (groups.length === 0) {
    if (state.searchQuery.length === 0) lines.push(emptyRow("Type to search"));
    else if (!shouldRunSearch(state)) lines.push(emptyRow("Press Enter to search"));
    else lines.push(emptyRow("No matches"));
    return lines;
  }

  const window = viewportWindow(groups.length, state.selectedSearchGroupIndex, viewportSize);
  if (window.start > 0) lines.push(muted(` ↑ ${window.start} more`));
  for (let index = window.start; index < window.end; index += 1) {
    const group = groups[index]!;
    const selected = state.selectedSearchGroupIndex === index;
    lines.push(
      alignedRow(
        selectionPrefix(selected, focused),
        group.projectName,
        String(group.results.length),
        columnWidth,
        selected,
        focused,
      ),
    );
  }
  if (window.end < groups.length) lines.push(muted(` ↓ ${groups.length - window.end} more`));
  return lines;
}

function renderTurnPane(
  model: LiteBrowserModel,
  state: LiteBrowserState,
  viewportSize: number,
  columnWidth: number,
  now: number,
): string[] {
  const focused = state.focusPane === "turns";
  const lines = [paneTitle("Turns", focused)];
  const turns = getVisibleTurns(model, state);
  if (turns.length === 0) {
    lines.push(emptyRow(state.mode === "search" ? "No matching turns" : "No turns"));
    return lines;
  }

  const selectedIndex = state.mode === "search" ? state.selectedSearchTurnIndex : state.selectedTurnIndex;
  const items = buildTurnDisplayItems(turns, selectedIndex, focused, columnWidth, now);
  const selectedDisplayIndex = Math.max(0, items.findIndex((item) => item.turnIndex === selectedIndex));
  const window = viewportWindow(items.length, selectedDisplayIndex, viewportSize);
  if (window.start > 0) lines.push(muted(` ↑ ${window.start} more`));
  for (let index = window.start; index < window.end; index += 1) lines.push(items[index]!.text);
  if (window.end < items.length) lines.push(muted(` ↓ ${items.length - window.end} more`));
  return lines;
}

interface TurnDisplayItem {
  turnIndex: number;
  text: string;
}

function buildTurnDisplayItems(
  turns: LiteTurnEntry[],
  selectedIndex: number,
  focused: boolean,
  columnWidth: number,
  now: number,
): TurnDisplayItem[] {
  const items: TurnDisplayItem[] = [];
  let groupStart = 0;
  while (groupStart < turns.length) {
    const sessionId = turns[groupStart]!.turn.session_id;
    let groupEnd = groupStart;
    while (groupEnd < turns.length && turns[groupEnd]!.turn.session_id === sessionId) groupEnd += 1;

    const first = turns[groupStart]!;
    const title = first.session?.title
      ? compact(tameBrowseMarkup(first.session.title), 40)
      : sessionId.slice(0, 20);
    const meta = [`${groupEnd - groupStart}a`, formatRelativeTime(first.session?.created_at, now)]
      .filter(Boolean)
      .join(" · ");
    items.push({ turnIndex: -1, text: `${bold(yellow(title))} ${dim(meta)}` });

    for (let index = groupStart; index < groupEnd; index += 1) {
      const entry = turns[index]!;
      const connector = dim(index === groupEnd - 1 ? "└─" : "├─");
      const selected = index === selectedIndex;
      const metaText = [
        entry.turn.context_summary.primary_model ?? "",
        formatCompactCount(entry.turn.context_summary.total_tokens),
        formatShortDate(entry.turn.submission_started_at),
      ]
        .filter(Boolean)
        .join(" · ");
      const prefix = `${connector}${selectionPrefix(selected, focused)}`;
      items.push({
        turnIndex: index,
        text: alignedRow(prefix, turnSnippet(entry, columnWidth), metaText, columnWidth, selected, focused),
      });
    }
    groupStart = groupEnd;
  }
  return items;
}

function turnSnippet(entry: LiteTurnEntry, columnWidth: number): string {
  const text = pickUserTurnText(entry);
  return tameBrowseMarkup(text) || "(empty ask)";
}

function renderDetailPane(
  model: LiteBrowserModel,
  state: LiteBrowserState,
  maxLines: number,
  columnWidth: number,
  now: number,
  scrollLimits: LiteScrollLimits,
): string[] {
  const focused = state.focusPane === "detail";
  const rows = buildDetailRows(model, state, columnWidth, focused, now);
  return renderScrollablePane(rows, paneTitle("Detail", focused), maxLines, focused ? state.detailScrollOffset : 0, scrollLimits);
}

function buildDetailRows(
  model: LiteBrowserModel,
  state: LiteBrowserState,
  columnWidth: number,
  focused: boolean,
  now: number,
): string[] {
  const entry = getSelectedTurn(model, state);
  if (!entry) {
    if (state.mode === "browse" && state.browseScope === "sessions") {
      const session = getSelectedSession(model, state);
      if (session) return buildSessionDetailRows(model, session, columnWidth, now);
    }
    if (model.counts.turns === 0) return buildEmptySnapshotRows(columnWidth);
    const project = getSelectedProject(model, state);
    return [muted(project ? `Project: ${project.displayName}` : "Select a turn to view details")];
  }

  const turns = getVisibleTurns(model, state);
  const index = state.mode === "search" ? state.selectedSearchTurnIndex : state.selectedTurnIndex;
  const contentWidth = Math.max(columnWidth - 4, 24);
  const summary = entry.turn.context_summary;
  const rows: string[] = [];

  const projectName = state.mode === "search" || state.browseScope === "sessions"
    ? (model.snapshot.getProject(entry.turn.project_id ?? "")?.display_name ?? "Unlinked")
    : (getSelectedProject(model, state)?.displayName ?? "Unlinked");
  const sessionTitle = entry.session?.title ? dim(` · ${compact(tameBrowseMarkup(entry.session.title), 28)}`) : "";
  rows.push(
    `${bold("Ask")} ${cyan(`${index + 1}/${turns.length}`)} ${dim("in")} ${cyan(projectName)}${sessionTitle} ${magenta(entry.turn.id.slice(0, 8))}`,
  );
  rows.push(
    `${metaLabel("Model:")} ${platformColor(summary.primary_model ?? "unknown")}${
      summary.total_tokens ? ` ${dim("·")} ${formatTokenBreakdown(summary)}` : ""
    } ${dim("·")} ${formatShortDate(entry.turn.submission_started_at)} ${dim(`(${formatRelativeTime(entry.turn.submission_started_at, now)})`)}`,
  );
  rows.push(`${metaLabel("Turn:")} ${entry.turn.id}`);
  if (entry.session) {
    rows.push(`${metaLabel("Session:")} ${entry.session.id}`);
    if (entry.session.working_directory) {
      rows.push(`${metaLabel("Workspace:")} ${compact(entry.session.working_directory, contentWidth)}`);
    }
    if (entry.session.resume_command) {
      rows.push(metaLabel("Resume:"));
      for (const line of wrapText(entry.session.resume_command, contentWidth)) rows.push(`  ${line}`);
    }
  }

  const relatedWork = entry.session ? model.getSessionRelatedWork(entry.session.id) : [];
  const relatedSummary = summarizeRelatedWork(relatedWork);
  if (relatedSummary) {
    rows.push(`${metaLabel("Related work:")} ${relatedSummary}`);
    rows.push(...relatedWorkRows(relatedWork, contentWidth));
  }

  rows.push("");
  rows.push(bold("Prompt:"));
  for (const line of wrapText(pickUserTurnText(entry), contentWidth)) rows.push(`  ${line}`);

  if (focused) {
    rows.push("");
    rows.push(dim("↑↓ scroll · Enter → full session conversation"));
  }
  return rows;
}

function buildSessionDetailRows(
  model: LiteBrowserModel,
  entry: LiteSessionEntry,
  columnWidth: number,
  now: number,
): string[] {
  const contentWidth = Math.max(columnWidth - 4, 24);
  const session = entry.session;
  const rows = [
    `${bold("Session")} ${cyan(compact(tameBrowseMarkup(session.title ?? session.source_session_id ?? session.id), 40))}`,
    `${metaLabel("ID:")} ${session.id}`,
    `${metaLabel("Source:")} ${platformColor(entry.sourceName)} ${dim(`(${session.source_platform})`)}`,
    `${metaLabel("Updated:")} ${formatShortDate(session.updated_at)} ${dim(`(${formatRelativeTime(session.updated_at, now)})`)}`,
    `${metaLabel("Turns:")} ${entry.turns.length}`,
  ];
  if (session.working_directory) {
    rows.push(`${metaLabel("Workspace:")} ${compact(session.working_directory, contentWidth)}`);
  }
  if (session.resume_command) {
    rows.push(metaLabel("Resume:"));
    for (const line of wrapText(session.resume_command, contentWidth)) rows.push(`  ${line}`);
  }

  const relatedWork = model.getSessionRelatedWork(session.id);
  rows.push("");
  rows.push(bold(`Related work (${relatedWork.length})`));
  if (relatedWork.length === 0) rows.push(muted("  none"));
  else rows.push(...relatedWorkRows(relatedWork, contentWidth));

  if (entry.turns.length === 0) {
    rows.push("");
    rows.push(muted("This session derived no UserTurn; only session-level evidence exists."));
  }
  return rows;
}

function relatedWorkRows(
  entries: readonly SessionRelatedWorkProjection[],
  contentWidth: number,
): string[] {
  return entries.map((entry) => {
    const kind = entry.relation_kind === "automation_run" ? "automation run" : "delegated session";
    const target = entry.title ?? entry.target_session_ref ?? entry.target_run_ref ?? entry.id;
    return `  ${dim("·")} ${kind} · ${entry.direction ?? "unknown"} · ${compact(target, Math.max(12, contentWidth - 30))}`;
  });
}

function buildEmptySnapshotRows(columnWidth: number): string[] {
  const contentWidth = Math.max(columnWidth - 2, 24);
  const rows = [bold("No AI coding history found on this machine."), ""];
  for (const line of wrapText(
    "Lite reads registered adapters' native roots in place and keeps nothing on disk.",
    contentWidth,
  )) {
    rows.push(line);
  }
  rows.push("");
  rows.push(`${dim("·")} Press ${bold("s")} to see which adapter roots were probed.`);
  rows.push(`${dim("·")} Point Lite elsewhere with ${bold("--source-root <slot-or-id>=<path>")}.`);
  rows.push(`${dim("·")} Re-run with ${bold("--safe")} if a root is partially unreadable.`);
  return rows;
}

function summarizeRelatedWork(entries: readonly SessionRelatedWorkProjection[]): string {
  if (entries.length === 0) return "";
  const inbound = entries.filter((entry) => entry.relation_kind === "delegated_session" && entry.direction === "inbound").length;
  const outbound = entries.filter((entry) => entry.relation_kind === "delegated_session" && entry.direction !== "inbound").length;
  const automation = entries.filter((entry) => entry.relation_kind === "automation_run").length;
  const parts: string[] = [];
  if (inbound > 0) parts.push(`${inbound} parent`);
  if (outbound > 0) parts.push(`${outbound} child`);
  if (automation > 0) parts.push(`${automation} automation run`);
  return parts.join(", ");
}

// ── Conversation view ──

function renderConversation(model: LiteBrowserModel, state: LiteBrowserState, options: BodyOptions): string[] {
  const turns = getSelectedSessionTurns(model, state);
  const selected = getSelectedTurn(model, state);
  const lines = buildConversationLines(model, turns, selected?.turn.id, options.width);
  const total = lines.length;
  // Scrolling needs room for the title and both direction indicators. Their
  // rows must not displace conversation content during the final frame slice.
  const needsScroll = total > options.contentHeight - 1;
  const viewport = Math.max(options.contentHeight - (needsScroll ? 3 : 1), 1);
  options.scrollLimits.conversation = Math.max(0, total - viewport);
  const offset = Math.min(state.conversationScrollOffset, options.scrollLimits.conversation);
  const visibleEnd = Math.min(offset + viewport, total);

  const position = total > 0 ? dim(` [${offset + 1}-${visibleEnd}/${total}]`) : "";
  const rows = [activeSectionTitle(`▸ Conversation${position}`)];
  if (offset > 0) rows.push(muted(`  ↑ ${offset} more lines above`));
  for (let index = offset; index < visibleEnd; index += 1) rows.push(`  ${lines[index]!}`);
  const below = total - visibleEnd;
  if (below > 0) rows.push(muted(`  ↓ ${below} more lines below`));
  return rows;
}

function buildConversationLines(
  model: LiteBrowserModel,
  turns: LiteTurnEntry[],
  selectedTurnId: string | undefined,
  width: number,
): string[] {
  const contentWidth = Math.max(width - 6, 30);
  const lines: string[] = [];
  for (let index = 0; index < turns.length; index += 1) {
    const entry = turns[index]!;
    const label = `── Ask ${index + 1}/${turns.length} ──`;
    lines.push(entry.turn.id === selectedTurnId ? bold(cyan(label)) : dim(label));
    lines.push(bold(cyan("User")));
    for (const line of wrapText(pickUserTurnText(entry), contentWidth)) lines.push(`  ${line}`);

    const context = model.getTurnContext(entry.turn.id);
    if (!context) {
      const summary = entry.turn.context_summary;
      lines.push(
        muted(
          `  (context not loaded · ${summary.assistant_reply_count} assistant replies, ${summary.tool_call_count} tool calls)`,
        ),
      );
    } else {
      lines.push(muted(`  Assistant replies: ${context.assistant_replies.length}`));
      lines.push(muted(`  Tool calls: ${context.tool_calls.length}`));
      const replyIds = new Set(context.assistant_replies.map((reply) => reply.id));
      for (const reply of context.assistant_replies) {
        const model_ = reply.model || entry.turn.context_summary.primary_model || "assistant";
        const usage = reply.token_usage;
        const tokenParts: string[] = [];
        if (usage?.input_tokens) tokenParts.push(`${formatCompactCount(usage.input_tokens)} in`);
        const cached = (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0);
        if (cached > 0) tokenParts.push(`${formatCompactCount(cached)} cache`);
        if (usage?.output_tokens) tokenParts.push(`${formatCompactCount(usage.output_tokens)} out`);
        lines.push(
          bold(green(model_)) + (tokenParts.length > 0 ? dim(` · ${tokenParts.join("/")}`) : ""),
        );
        const content = reply.content || reply.content_preview || "(empty)";
        for (const line of wrapText(tameDetailMarkup(content), contentWidth)) lines.push(`  ${line}`);
        for (const tool of context.tool_calls.filter((call) => call.reply_id === reply.id)) {
          lines.push(renderToolCall(tool));
        }
      }
      // Codex can emit tools under a synthetic reply ID without assistant text.
      for (const tool of context.tool_calls.filter((call) => !replyIds.has(call.reply_id))) {
        lines.push(renderToolCall(tool));
      }
    }
    if (index < turns.length - 1) lines.push("");
  }
  return lines;
}

function renderToolCall(tool: ToolCallProjection): string {
  const status = tool.status === "error" ? danger(" ERR") : "";
  const duration = tool.duration_ms ? dim(` ${tool.duration_ms}ms`) : "";
  const input = tool.input_summary ? dim(` ${compact(tool.input_summary, 40)}`) : "";
  return yellow(`  ${tool.tool_name || "tool"}`) + status + duration + input;
}

// ── Overlays ──

function renderHelpOverlay(width: number, contentHeight: number, scrollOffset: number, scrollLimits: LiteScrollLimits): string[] {
  const lines = [
    `${activeSectionTitle("▸ Help")}  ${dim("(? or Esc to close)")}`,
    dim("─".repeat(Math.max(10, Math.min(width - 2, width)))),
    "",
    bold("  Navigation"),
    `    ${bold("↑/↓")} or ${bold("j/k")}   Move cursor        ${bold("PgUp/PgDn")}   Page up/down`,
    `    ${bold("g/G")}           First/last         ${bold("Tab/→")}       Next pane`,
    `    ${bold("Shift+Tab/←")}   Previous pane      ${bold("Enter")}       Drill in`,
    `    ${bold("Esc")}           Back / close overlay`,
    "",
    bold("  Panes and scope"),
    `    ${bold("p")} browse by project      ${bold("S")} browse by session`,
    `    ${bold("t")} turns pane             ${bold("d")} detail pane`,
    `    ${bold("Enter")} on Detail opens the full session conversation`,
    "",
    bold("  Actions"),
    `    ${bold("/")} search      ${bold("i")} stats    ${bold("s")} sources   ${bold("?")} help`,
    `    ${bold("r")} refresh the snapshot from disk   ${bold("q")} quit`,
    `    ${bold("Tab")} in the stats overlay cycles source/project/model/day`,
    "",
    bold("  Lite guarantees"),
    muted("    Reads native tool history only. Never opens or creates ~/.cchistory."),
    muted("    The snapshot lives in memory for this process and is released on exit."),
    muted("    Refresh is transactional: a failed rescan keeps the previous snapshot."),
  ];
  return scrollWindow(lines, scrollOffset, contentHeight, scrollLimits);
}

function renderSourcesOverlay(
  model: LiteBrowserModel,
  options: BodyOptions,
  state: LiteBrowserState,
): string[] {
  const { counts, sources } = model.sourceHealth;
  const lines = [
    `${activeSectionTitle("▸ Sources")}  ${dim("(s or Esc to close)")}`,
    dim("─".repeat(Math.max(10, Math.min(options.width - 2, options.width)))),
    "",
    `  ${[
      success(`Healthy: ${counts.healthy}`),
      warning(`Stale: ${counts.stale}`),
      counts.error > 0 ? danger(`Error: ${counts.error}`) : dim(`Error: ${counts.error}`),
    ].join("  ·  ")}`,
    "",
  ];
  for (const source of sources) {
    lines.push(...renderSourceRows(source, options.width));
  }
  if (sources.length === 0) {
    lines.push(emptyRow("No adapter roots were found on this machine"));
    lines.push(muted("  Point Lite at one with --source-root <slot-or-id>=<path>."));
  }
  return scrollWindow(lines, state.overlayScrollOffset, options.contentHeight, options.scrollLimits);
}

function renderSourceRows(source: SourceStatus, width: number): string[] {
  const statusColor = source.sync_status === "healthy" ? success : source.sync_status === "stale" ? warning : danger;
  const rows = [
    `  ${bold(source.display_name)} ${dim(`[${source.slot_id}]`)} ${statusColor(source.sync_status)} ${metaLabel(
      `${source.total_sessions} sessions · ${source.total_turns} turns`,
    )}`,
    `    ${muted(compact(source.base_dir, Math.max(20, width - 6)))}`,
  ];
  if (source.error_message) rows.push(`    ${danger(compact(source.error_message, Math.max(20, width - 6)))}`);
  return rows;
}

function renderStatsOverlay(
  model: LiteBrowserModel,
  state: LiteBrowserState,
  options: BodyOptions,
): string[] {
  const innerWidth = Math.max(options.width - 4, 36);
  const dimensionRow = STATS_DIMENSIONS.map((entry) =>
    entry === state.statsDimension ? bold(cyan(entry)) : dim(entry),
  ).join(dim(" · "));
  const overview = model.getUsageOverview();
  const lines = [
    `${activeSectionTitle("▸ Statistics")}  ${dimensionRow}  ${dim("(Tab cycle · i close)")}`,
    dim("─".repeat(Math.max(10, Math.min(innerWidth, options.width)))),
    "",
    bold("  Overview"),
  ];
  const leftWidth = Math.max(20, Math.floor(innerWidth / 2) - 2);
  const rightWidth = Math.max(20, innerWidth - leftWidth - 4);
  const overviewRows: [string, string][] = [
    [`Turns: ${cyan(formatNumber(overview.total_turns))}`, `Total tokens: ${cyan(formatNumber(overview.total_tokens))}`],
    [
      `With usage: ${cyan(formatNumber(overview.turns_with_token_usage))} (${formatPercent(overview.turn_coverage_ratio)})`,
      `Input: ${cyan(formatNumber(overview.total_input_tokens))}`,
    ],
    [
      `Cached input: ${cyan(formatNumber(overview.total_cached_input_tokens))}`,
      `Output: ${cyan(formatNumber(overview.total_output_tokens))}`,
    ],
    ["", `Reasoning: ${cyan(formatNumber(overview.total_reasoning_output_tokens))}`],
  ];
  for (const [left, right] of overviewRows) {
    lines.push(`  ${padLine(left, leftWidth)}  ${padLine(right, rightWidth)}`);
  }

  const rollup = model.getUsageRollup(state.statsDimension);
  lines.push("");
  lines.push(`${bold(`  By ${state.statsDimension}`)} ${dim(`(${rollup.rows.length} rows)`)}`);
  if (rollup.rows.length === 0) {
    lines.push(emptyRow("No usage rows for this dimension"));
    return scrollWindow(lines, state.overlayScrollOffset, options.contentHeight, options.scrollLimits);
  }

  const sorted = [...rollup.rows].sort((left, right) => right.total_tokens - left.total_tokens);
  const totalTokens = sorted.reduce((sum, row) => sum + row.total_tokens, 0) || 1;
  const nameWidth = Math.min(34, Math.max(18, Math.floor(innerWidth * 0.3)));
  const barWidth = Math.min(20, Math.max(6, Math.floor((innerWidth - nameWidth - 32) * 0.5)));
  lines.push(dim(`  ${"Name".padEnd(nameWidth)} ${"Turns".padStart(7)} ${"Tokens".padStart(11)} ${"%".padStart(6)}  Share`));
  for (const row of sorted) {
    const share = (row.total_tokens / totalTokens) * 100;
    const bar = dim("▪".repeat(Math.max(1, Math.round((share / 100) * barWidth))));
    lines.push(
      `  ${cyan(padLine(compact(row.label, nameWidth), nameWidth))} ${formatNumber(row.turn_count).padStart(7)} ${formatNumber(
        row.total_tokens,
      ).padStart(11)} ${`${share.toFixed(1)}%`.padStart(6)}  ${bar}`,
    );
  }
  return scrollWindow(lines, state.overlayScrollOffset, options.contentHeight, options.scrollLimits);
}

/**
 * Window an overlay's full line list, keeping the two heading lines pinned so
 * the close hint never scrolls out of reach.
 */
function scrollWindow(lines: string[], offset: number, contentHeight: number, scrollLimits: LiteScrollLimits): string[] {
  const headerCount = Math.min(2, lines.length);
  const header = lines.slice(0, headerCount);
  const body = lines.slice(headerCount);
  const viewport = Math.max(contentHeight - headerCount - 1, 1);
  if (body.length <= viewport) return [...header, ...body];

  const maxOffset = body.length - viewport + 1;
  scrollLimits.overlay = maxOffset;
  const clamped = Math.min(Math.max(0, offset), maxOffset);
  const visible = body.slice(clamped, clamped + viewport - (clamped > 0 ? 1 : 0));
  const rows = [...header];
  if (clamped > 0) rows.push(muted(`  ↑ ${clamped} more lines`));
  rows.push(...visible);
  const remaining = body.length - clamped - visible.length;
  if (remaining > 0) rows.push(muted(`  ↓ ${remaining} more lines`));
  return rows;
}

// ── Shared pane primitives ──

function paneTitle(label: string, focused: boolean): string {
  return focused ? activeSectionTitle(`▸ ${label}`) : sectionTitle(`  ${label}`);
}

function emptyRow(label: string): string {
  return ` ${dim("·")} ${muted(label)}`;
}

function selectionPrefix(selected: boolean, focused: boolean): string {
  if (selected && focused) return cursorColor("❯");
  if (selected) return bold("▪");
  return dim("·");
}

/** `prefix name        meta` padded so the meta column right-aligns. */
function alignedRow(
  prefix: string,
  name: string,
  meta: string,
  columnWidth: number,
  selected: boolean,
  focused: boolean,
): string {
  const metaWidth = displayWidth(meta);
  const prefixWidth = displayWidth(prefix);
  const nameBudget = Math.max(columnWidth - metaWidth - prefixWidth - 2, 8);
  const compacted = compact(name, nameBudget);
  const styled = selected && focused ? activeItem(compacted) : selected ? selectedItem(compacted) : compacted;
  const left = `${prefix} ${styled}`;
  const gap = Math.max(1, columnWidth - displayWidth(left) - metaWidth);
  return meta.length > 0 ? `${left}${" ".repeat(gap)}${metaLabel(meta)}` : left;
}

/** Title + scrollable viewport, always exactly `maxLines` tall. */
function renderScrollablePane(
  rows: string[],
  titleLine: string,
  maxLines: number,
  scrollOffset: number,
  scrollLimits: LiteScrollLimits,
): string[] {
  const lines = [titleLine];
  const viewport = Math.max(maxLines - 1, 1);

  if (rows.length <= viewport) {
    lines.push(...rows);
    while (lines.length < maxLines) lines.push("");
    return lines.slice(0, maxLines);
  }

  const maxOffset = rows.length - viewport + 1;
  scrollLimits.detail = maxOffset;
  const offset = Math.min(Math.max(0, scrollOffset), maxOffset);
  const hasAbove = offset > 0;
  const available = viewport - (hasAbove ? 1 : 0);
  const slots = available - (rows.length - offset > available ? 1 : 0);
  const end = Math.min(offset + slots, rows.length);

  if (hasAbove) lines.push(muted(` ↑ ${offset} more lines`));
  for (let index = offset; index < end; index += 1) lines.push(rows[index]!);
  const below = rows.length - end;
  if (below > 0) lines.push(muted(` ↓ ${below} more lines`));
  while (lines.length < maxLines) lines.push("");
  return lines.slice(0, maxLines);
}

export function viewportWindow(
  total: number,
  selectedIndex: number,
  size: number,
): { start: number; end: number } {
  if (total <= size) return { start: 0, end: total };
  const half = Math.floor(size / 2);
  let start = Math.max(0, selectedIndex - half);
  let end = start + size;
  if (end > total) {
    end = total;
    start = end - size;
  }
  return { start, end };
}

// ── Field helpers ──

function pickUserTurnText(entry: LiteTurnEntry): string {
  const canonical = entry.turn.canonical_text?.trim();
  if (canonical) return tameDetailMarkup(canonical);
  const fallback = (entry.turn.user_messages ?? [])
    .filter((message) => !message.is_injected)
    .map((message) => (message.canonical_text ?? message.raw_text).trim())
    .filter((value) => value.length > 0)
    .join("\n\n");
  return tameDetailMarkup(fallback);
}

function formatTokenBreakdown(summary: {
  total_tokens?: number;
  token_usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    output_tokens?: number;
  };
}): string {
  const total = summary.total_tokens;
  if (!total) return "";
  const usage = summary.token_usage;
  if (!usage) return formatCompactCount(total);
  const cached =
    usage.cached_input_tokens ??
    (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  return `${formatCompactCount(total)} (in=${formatCompactCount(usage.input_tokens ?? 0) || "0"}, cached=${
    formatCompactCount(cached) || "0"
  }, out=${formatCompactCount(usage.output_tokens ?? 0) || "0"})`;
}

/** Exported for tests that assert on search grouping without a terminal. */
export function describeSearchGroup(group: LiteSearchGroup): string {
  return `${group.projectName} (${group.results.length})`;
}

/** Exported for tests: the first ranked match's turn id, if any. */
export function firstSearchTurnId(results: readonly TurnSearchResult[]): string | undefined {
  return results[0]?.turn.id;
}
