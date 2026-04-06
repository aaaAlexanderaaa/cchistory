import type { LocalTuiBrowser, LocalTuiBrowserTurn, LocalTuiSearchResult } from "@cchistory/storage";
import { tameBrowseMarkup, compactText as compact } from "@cchistory/presentation";
import {
  bold, dim, cyan, green, yellow, blue, magenta, gray,
  heading, muted, activeItem, selectedItem,
  sectionTitle, activeSectionTitle, cursor, metaLabel,
  stripAnsi,
} from "./colors.js";

// ── Public types ──

export type BrowserFocusPane = "projects" | "turns" | "detail" | "conversation";
export type BrowserMode = "browse" | "search";

export interface BrowserState {
  mode: BrowserMode;
  focusPane: BrowserFocusPane;
  selectedProjectIndex: number;
  selectedTurnIndex: number;
  selectedSearchProjectIndex: number;
  selectedSearchTurnIndex: number;
  searchQuery: string;
  searchCommitted: boolean;
  showHelp: boolean;
  showSourceHealth: boolean;
  showStats: boolean;
  showStatsTimeWindow: StatsTimeWindow;
  conversationScrollOffset: number;
  detailScrollOffset: number;
}

export type StatsTimeWindow = "all" | "7d" | "30d" | "90d" | "1y";

export type BrowserAction =
  | { type: "focus-next" }
  | { type: "focus-previous" }
  | { type: "focus-projects" }
  | { type: "focus-turns" }
  | { type: "focus-detail" }
  | { type: "move-up" }
  | { type: "move-down" }
  | { type: "page-up" }
  | { type: "page-down" }
  | { type: "jump-first" }
  | { type: "jump-last" }
  | { type: "drill" }
  | { type: "retreat" }
  | { type: "enter-search-mode" }
  | { type: "exit-search-mode" }
  | { type: "append-search-char"; value: string }
  | { type: "backspace-search" }
  | { type: "toggle-source-health" }
  | { type: "close-source-health" }
  | { type: "toggle-help" }
  | { type: "close-help" }
  | { type: "toggle-stats" }
  | { type: "close-stats" }
  | { type: "cycle-stats-time-window" }
  | { type: "commit-search" }
  | { type: "scroll-up"; lines: number }
  | { type: "scroll-down"; lines: number };

export interface RenderDimensions {
  width?: number;
  height?: number;
}

// ── Constants ──

const DEFAULT_WIDTH = 120;
const DEFAULT_HEIGHT = 40;
const LEFT_COL_RATIO = 0.28;
const MIN_LEFT_COL = 24;
const MAX_LEFT_COL = 60;

// ── Display width utilities (CJK-aware) ──

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3040 && code <= 0x33bf) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff01 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x2fa1f)
  );
}

function displayWidth(str: string): number {
  const plain = stripAnsi(str);
  let w = 0;
  for (const ch of plain) {
    w += isWide(ch.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return w;
}

/** Clip a (possibly ANSI-colored) line to fit within maxCols terminal columns. */
function clipLine(line: string, maxCols: number): string {
  const plain = stripAnsi(line);
  if (displayWidth(plain) <= maxCols) return line;

  // Walk through original string, tracking ANSI sequences separately
  let col = 0;
  let result = "";
  let i = 0;
  while (i < line.length) {
    // Check for ANSI escape
    if (line[i] === "\x1b" && line[i + 1] === "[") {
      const end = line.indexOf("m", i);
      if (end !== -1) {
        result += line.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    const ch = line[i]!;
    const cw = isWide(ch.codePointAt(0) ?? 0) ? 2 : 1;
    if (col + cw > maxCols - 1) {
      result += "…";
      break;
    }
    result += ch;
    col += cw;
    i++;
  }
  // Reset ANSI at end
  return result + "\x1b[0m";
}

/** Pad a line to exactly targetCols display width (for column alignment). */
function padLine(line: string, targetCols: number): string {
  const w = displayWidth(line);
  if (w >= targetCols) return line;
  return line + " ".repeat(targetCols - w);
}

// ── State management ──

export function createBrowserState(browser: LocalTuiBrowser): BrowserState {
  return clampState(
    {
      mode: "browse",
      focusPane: "projects",
      selectedProjectIndex: 0,
      selectedTurnIndex: 0,
      selectedSearchProjectIndex: 0,
      selectedSearchTurnIndex: 0,
      searchQuery: "",
      searchCommitted: false,
      showHelp: false,
      showSourceHealth: false,
      showStats: false,
      showStatsTimeWindow: "all",
      conversationScrollOffset: 0,
      detailScrollOffset: 0,
    },
    browser,
  );
}

const FOCUS_ORDER_BROWSE: BrowserFocusPane[] = ["projects", "turns", "detail"];
const FOCUS_ORDER_CONVERSATION: BrowserFocusPane[] = ["projects", "turns", "conversation"];

function getFocusOrder(state: BrowserState): BrowserFocusPane[] {
  return state.focusPane === "conversation" ? FOCUS_ORDER_CONVERSATION : FOCUS_ORDER_BROWSE;
}

export function reduceBrowserState(browser: LocalTuiBrowser, state: BrowserState, action: BrowserAction): BrowserState {
  switch (action.type) {
    case "focus-next": {
      const order = getFocusOrder(state);
      return { ...state, focusPane: order[(order.indexOf(state.focusPane) + 1) % order.length] ?? "projects" };
    }
    case "focus-previous": {
      const order = getFocusOrder(state);
      return { ...state, focusPane: order[(order.indexOf(state.focusPane) + order.length - 1) % order.length] ?? "detail" };
    }
    case "focus-projects":
      return { ...state, focusPane: "projects" };
    case "focus-turns":
      return { ...state, focusPane: "turns" };
    case "focus-detail":
      return { ...state, focusPane: state.focusPane === "conversation" ? "conversation" : "detail" };

    case "move-up":
      return handleMove(browser, state, -1);
    case "move-down":
      return handleMove(browser, state, 1);
    case "page-up":
      return handleMove(browser, state, -15);
    case "page-down":
      return handleMove(browser, state, 15);
    case "scroll-up":
      return handleMove(browser, state, -action.lines);
    case "scroll-down":
      return handleMove(browser, state, action.lines);
    case "jump-first":
      return handleJump(browser, state, "first");
    case "jump-last":
      return handleJump(browser, state, "last");

    case "drill":
      if (state.focusPane === "projects") return { ...state, focusPane: "turns" };
      if (state.focusPane === "turns") return { ...state, focusPane: "detail", detailScrollOffset: 0 };
      if (state.focusPane === "detail") return { ...state, focusPane: "conversation", conversationScrollOffset: 0 };
      return state;
    case "retreat":
      if (state.focusPane === "conversation") return { ...state, focusPane: "detail" };
      if (state.focusPane === "detail") return { ...state, focusPane: "turns" };
      if (state.focusPane === "turns") return { ...state, focusPane: "projects" };
      if (state.mode === "search") return clampState({ ...state, mode: "browse", focusPane: "projects" }, browser);
      return state;

    case "enter-search-mode":
      return clampState({ ...state, mode: "search", focusPane: "projects", searchCommitted: false, selectedSearchProjectIndex: 0, selectedSearchTurnIndex: 0 }, browser);
    case "exit-search-mode":
      _searchCache = null;
      return clampState({ ...state, mode: "browse", focusPane: "projects" }, browser);
    case "commit-search":
      return clampState({ ...state, searchCommitted: true, selectedSearchProjectIndex: 0, selectedSearchTurnIndex: 0 }, browser);
    case "append-search-char": {
      const newQuery = `${state.searchQuery}${action.value}`;
      const autoCommit = newQuery.length >= 4;
      return clampState({
        ...state, mode: "search", focusPane: "projects",
        searchQuery: newQuery,
        searchCommitted: autoCommit,
        selectedSearchProjectIndex: 0, selectedSearchTurnIndex: 0,
      }, browser);
    }
    case "backspace-search": {
      const newQuery = state.searchQuery.slice(0, Math.max(state.searchQuery.length - 1, 0));
      const autoCommit = newQuery.length >= 4;
      // Only invalidate cache if backspacing past the anchor query
      if (_searchCache && newQuery.toLowerCase().length < _searchCache.anchorQuery.length) {
        _searchCache = null;
      }
      return clampState({
        ...state,
        searchQuery: newQuery,
        searchCommitted: autoCommit,
        selectedSearchProjectIndex: 0, selectedSearchTurnIndex: 0,
      }, browser);
    }

    case "toggle-source-health":
      return { ...state, showSourceHealth: !state.showSourceHealth, showStats: false };
    case "close-source-health":
      return { ...state, showSourceHealth: false };
    case "toggle-help":
      return { ...state, showHelp: !state.showHelp };
    case "close-help":
      return { ...state, showHelp: false };
    case "toggle-stats":
      return { ...state, showStats: !state.showStats, showSourceHealth: false };
    case "close-stats":
      return { ...state, showStats: false };
    case "cycle-stats-time-window": {
      const order: StatsTimeWindow[] = ["all", "7d", "30d", "90d", "1y"];
      const idx = order.indexOf(state.showStatsTimeWindow);
      return { ...state, showStatsTimeWindow: order[(idx + 1) % order.length]! };
    }
  }
}

function handleMove(browser: LocalTuiBrowser, state: BrowserState, delta: number): BrowserState {
  if (state.focusPane === "conversation") {
    return { ...state, conversationScrollOffset: Math.max(0, state.conversationScrollOffset + delta) };
  }
  if (state.focusPane === "detail") {
    return { ...state, detailScrollOffset: Math.max(0, state.detailScrollOffset + delta) };
  }
  if (state.mode === "search") {
    if (state.focusPane === "projects") {
      return clampState({ ...state, selectedSearchProjectIndex: state.selectedSearchProjectIndex + delta, selectedSearchTurnIndex: 0, detailScrollOffset: 0 }, browser);
    }
    if (state.focusPane === "turns") {
      return clampState({ ...state, selectedSearchTurnIndex: state.selectedSearchTurnIndex + delta, detailScrollOffset: 0 }, browser);
    }
    return state;
  }
  if (state.focusPane === "projects") {
    return clampState({ ...state, selectedProjectIndex: state.selectedProjectIndex + delta, selectedTurnIndex: 0, detailScrollOffset: 0 }, browser);
  }
  if (state.focusPane === "turns") {
    return clampState({ ...state, selectedTurnIndex: state.selectedTurnIndex + delta, detailScrollOffset: 0 }, browser);
  }
  return state;
}

function handleJump(browser: LocalTuiBrowser, state: BrowserState, target: "first" | "last"): BrowserState {
  const v = target === "first" ? 0 : 999999;
  if (state.focusPane === "conversation") {
    return { ...state, conversationScrollOffset: target === "first" ? 0 : 999999 };
  }
  if (state.mode === "search") {
    if (state.focusPane === "projects") return clampState({ ...state, selectedSearchProjectIndex: v, selectedSearchTurnIndex: 0 }, browser);
    if (state.focusPane === "turns") return clampState({ ...state, selectedSearchTurnIndex: v }, browser);
    return state;
  }
  if (state.focusPane === "projects") return clampState({ ...state, selectedProjectIndex: v, selectedTurnIndex: 0 }, browser);
  if (state.focusPane === "turns") return clampState({ ...state, selectedTurnIndex: v }, browser);
  return state;
}

// ── Main render ──

export function renderBrowserSnapshot(browser: LocalTuiBrowser, state: BrowserState, dims?: RenderDimensions): string {
  const width = dims?.width ?? DEFAULT_WIDTH;
  const height = dims?.height ?? DEFAULT_HEIGHT;

  const leftColWidth = Math.max(MIN_LEFT_COL, Math.min(MAX_LEFT_COL, Math.floor(width * LEFT_COL_RATIO)));
  const rightColWidth = Math.max(30, width - leftColWidth - 3); // 3 = " │ "

  // Reserve: title(1) + blank(1) + status(1) + blank(1) = 4 lines chrome
  const contentHeight = Math.max(height - 4, 10);
  const turnsViewportSize = Math.max(Math.floor((contentHeight - 4) / 2), 5);
  const detailMaxLines = Math.max(contentHeight - turnsViewportSize - 4, 4);
  const projectViewportSize = Math.max(contentHeight - 2, 5);
  // Conversation viewport is the full content area
  const conversationViewportSize = Math.max(contentHeight - 2, 10);

  // Conversation mode: full-width
  if (state.focusPane === "conversation") {
    const turn = state.mode === "search"
      ? getSelectedSearchTurn(browser, state)
      : getSelectedTurn(browser, state);
    const sessionTurns = turn ? getSessionTurns(browser, state, turn) : [];
    const convLines = buildSessionConversationLines(sessionTurns, turn, rightColWidth + leftColWidth);
    const total = convLines.length;
    const offset = Math.min(state.conversationScrollOffset, Math.max(0, total - conversationViewportSize));
    const visibleEnd = Math.min(offset + conversationViewportSize, total);
    const rows: string[] = [];
    const posLabel = total > 0 ? dim(` [${offset + 1}-${visibleEnd}/${total}]`) : "";
    const focused = state.focusPane === "conversation";
    rows.push(focused ? activeSectionTitle(`▸ Conversation${posLabel}`) : sectionTitle(`  Conversation${posLabel}`));
    if (offset > 0) rows.push(muted(`  ↑ ${offset} more lines above`));
    for (let i = offset; i < visibleEnd; i++) {
      rows.push(clipLine(`  ${convLines[i]!}`, width));
    }
    const below = total - visibleEnd;
    if (below > 0) rows.push(muted(`  ↓ ${below} more lines below`));

    // Scrollbar on right edge
    const scrollbar = renderScrollbar(total, offset, visibleEnd, visibleEnd - offset);
    const mergedRows = mergeScrollbar(rows, scrollbar, width);

    // Pad to fill contentHeight so status bar stays at bottom
    while (mergedRows.length < contentHeight) mergedRows.push("");

    return [
      heading("CCHistory TUI"),
      "",
      ...mergedRows.slice(0, contentHeight),
      "",
      renderStatusLine(browser, state, width),
    ].join("\n");
  }

  // Full-screen overlays replace main content instead of appending below
  const hasOverlay = state.showSourceHealth || state.showStats || state.showHelp;

  const layoutOpts = { leftColWidth, rightColWidth, projectViewportSize, turnsViewportSize, detailMaxLines, contentHeight, width };

  let bodyLines: string[];
  if (hasOverlay) {
    let overlayLines: string[];
    if (state.showStats) overlayLines = renderStatsOverlay(browser, state, width, contentHeight);
    else if (state.showHelp) overlayLines = renderHelpOverlay(width, contentHeight);
    else overlayLines = renderSourceHealthOverlay(browser, width, contentHeight);
    bodyLines = overlayLines;
  } else {
    const mainContent = state.mode === "search"
      ? renderSearchLayout(browser, state, layoutOpts)
      : renderBrowseLayout(browser, state, layoutOpts);
    bodyLines = mainContent.split("\n");
  }

  // Pad body to fill contentHeight so status bar is always at the bottom
  while (bodyLines.length < contentHeight) bodyLines.push("");

  const parts = [
    heading("CCHistory TUI"),
    "",
    ...bodyLines.slice(0, contentHeight),
    "",
    renderStatusLine(browser, state, width),
  ];
  return parts.join("\n");
}

// ── Layout renderers ──

interface LayoutOpts {
  leftColWidth: number;
  rightColWidth: number;
  projectViewportSize: number;
  turnsViewportSize: number;
  detailMaxLines: number;
  contentHeight: number;
  width: number;
}

function renderBrowseLayout(browser: LocalTuiBrowser, state: BrowserState, opts: LayoutOpts): string {
  const projectLines = renderProjectPane(browser, state, opts.projectViewportSize, opts.leftColWidth);
  // Render turns first, then compute remaining space for detail pane
  const turnLines = renderTurnPane(browser, state, opts.turnsViewportSize, opts.rightColWidth);
  const turnBudget = opts.turnsViewportSize + 3; // title + possible 2 scroll indicators
  const cappedTurnLines = turnLines.slice(0, turnBudget);
  const actualDetailMax = Math.max(opts.contentHeight - cappedTurnLines.length - 1, 4); // -1 for gap line
  const detailLines = renderDetailPane(browser, state, actualDetailMax, opts.rightColWidth);
  const rightLines = [...cappedTurnLines, "", ...detailLines];
  return renderTwoColumnLayout(projectLines, rightLines.slice(0, opts.contentHeight), opts.leftColWidth, opts.rightColWidth);
}

function renderSearchLayout(browser: LocalTuiBrowser, state: BrowserState, opts: LayoutOpts): string {
  const searchProjectLines = renderSearchProjectPane(browser, state, opts.projectViewportSize, opts.leftColWidth);
  const searchTurnLines = renderSearchTurnPane(browser, state, opts.turnsViewportSize, opts.rightColWidth);
  const turnBudget = opts.turnsViewportSize + 3;
  const cappedTurnLines = searchTurnLines.slice(0, turnBudget);
  const actualDetailMax = Math.max(opts.contentHeight - cappedTurnLines.length - 1, 4);
  const detailLines = renderSearchDetailPane(browser, state, actualDetailMax, opts.rightColWidth);
  const rightLines = [...cappedTurnLines, "", ...detailLines];
  return renderTwoColumnLayout(searchProjectLines, rightLines.slice(0, opts.contentHeight), opts.leftColWidth, opts.rightColWidth);
}

function renderTwoColumnLayout(leftLines: string[], rightLines: string[], leftWidth: number, rightWidth: number): string {
  const height = Math.max(leftLines.length, rightLines.length);
  const rows: string[] = [];
  const separator = dim("│");
  for (let i = 0; i < height; i++) {
    const left = clipLine(leftLines[i] ?? "", leftWidth);
    const right = clipLine(rightLines[i] ?? "", rightWidth);
    rows.push(`${padLine(left, leftWidth)} ${separator} ${padLine(right, rightWidth)}`);
  }
  return rows.join("\n");
}

// ── Scrollbar ──

function renderScrollbar(totalLines: number, offset: number, visibleEnd: number, viewportSize: number): string[] {
  if (totalLines <= viewportSize || viewportSize < 3) return [];
  const trackHeight = viewportSize;
  const thumbSize = Math.max(1, Math.round((viewportSize / totalLines) * trackHeight));
  const thumbStart = Math.round((offset / totalLines) * trackHeight);
  const track: string[] = [];
  for (let i = 0; i < trackHeight; i++) {
    track.push(i >= thumbStart && i < thumbStart + thumbSize ? dim("█") : dim("░"));
  }
  return track;
}

function mergeScrollbar(contentLines: string[], scrollbar: string[], totalWidth: number): string[] {
  if (scrollbar.length === 0) return contentLines;
  // Align scrollbar to the right edge. Skip first line (title) for scrollbar
  return contentLines.map((line, i) => {
    const barIdx = i - 1; // offset by 1 to skip section title
    if (barIdx >= 0 && barIdx < scrollbar.length) {
      const clipped = clipLine(line, totalWidth - 2);
      const padded = padLine(clipped, totalWidth - 2);
      return `${padded} ${scrollbar[barIdx]!}`;
    }
    return line;
  });
}

// ── Pane renderers: Browse mode ──

function renderProjectPane(browser: LocalTuiBrowser, state: BrowserState, viewportSize: number, colWidth: number): string[] {
  const titleLine = state.focusPane === "projects" ? activeSectionTitle("▸ Projects") : sectionTitle("  Projects");
  const lines: string[] = [titleLine];
  if (browser.projects.length === 0) {
    lines.push(emptyRow("No projects"));
    return lines;
  }
  const { start, end } = viewportWindow(browser.projects.length, state.selectedProjectIndex, viewportSize);
  if (start > 0) lines.push(muted(` ↑ ${start} more`));
  for (let i = start; i < end; i++) {
    const entry = browser.projects[i]!;
    lines.push(formatProjectRow(entry, state.selectedProjectIndex === i, state.focusPane === "projects", colWidth));
  }
  if (end < browser.projects.length) lines.push(muted(` ↓ ${browser.projects.length - end} more`));
  return lines;
}

function renderTurnPane(browser: LocalTuiBrowser, state: BrowserState, viewportSize: number, colWidth: number): string[] {
  const titleLine = state.focusPane === "turns" ? activeSectionTitle("▸ Turns") : sectionTitle("  Turns");
  const lines: string[] = [titleLine];
  const turns = getSelectedTurns(browser, state);
  if (turns.length === 0) {
    lines.push(emptyRow("No turns"));
    return lines;
  }
  // Build display items with session headers
  const groups = groupTurnsBySession(turns);
  const displayItems = buildDisplayItems(groups, state, "browse", colWidth);
  const selectedIdx = findSelectedDisplayIndex(displayItems, state.selectedTurnIndex);
  const { start, end } = viewportWindow(displayItems.length, selectedIdx, viewportSize);
  if (start > 0) lines.push(muted(` ↑ ${start} more`));
  for (let i = start; i < end; i++) {
    lines.push(displayItems[i]!.text);
  }
  if (end < displayItems.length) lines.push(muted(` ↓ ${displayItems.length - end} more`));
  return lines;
}

function renderDetailPane(browser: LocalTuiBrowser, state: BrowserState, maxLines: number, colWidth: number): string[] {
  const focused = state.focusPane === "detail";
  const titleLine = focused ? activeSectionTitle("▸ Detail") : sectionTitle("  Detail");
  const turn = getSelectedTurn(browser, state);
  const turns = getSelectedTurns(browser, state);
  const turnIdx = state.selectedTurnIndex;
  const project = browser.projects[state.selectedProjectIndex];
  // Build full detail content (no truncation)
  const allRows = formatDetailRows(browser, {
    projectName: project?.project.display_name,
    selectedTurn: turn,
    turnPosition: turns.length > 0 ? `${turnIdx + 1}/${turns.length}` : undefined,
    sessionTitle: turn?.session?.title,
    focused,
    colWidth,
  });
  return renderScrollablePane(allRows, titleLine, maxLines, focused ? state.detailScrollOffset : 0);
}

/** Render a scrollable pane: title + viewport of content + hint bar, always exactly maxLines tall. */
function renderScrollablePane(allRows: string[], titleLine: string, maxLines: number, scrollOffset: number): string[] {
  const lines: string[] = [titleLine];
  const hintLine = renderHintBar();
  // viewport budget: maxLines - title(1) - hint(1) - possible scroll indicators(up to 2)
  const viewportBudget = Math.max(maxLines - 2, 1);

  if (allRows.length <= viewportBudget) {
    // Content fits — no scrolling needed
    lines.push(...allRows);
    const remaining = maxLines - lines.length - 1;
    for (let i = 0; i < remaining; i++) lines.push("");
    lines.push(hintLine);
    return lines;
  }

  // Scrollable: show viewport window of the content
  const maxOffset = Math.max(0, allRows.length - viewportBudget + 2); // +2 for scroll indicators
  const offset = Math.min(scrollOffset, maxOffset);
  const hasAbove = offset > 0;
  const contentSlots = viewportBudget - (hasAbove ? 1 : 0); // reserve 1 line for "↑" if needed
  const visibleEnd = Math.min(offset + contentSlots, allRows.length);
  const hasBelow = visibleEnd < allRows.length;
  const adjustedSlots = contentSlots - (hasBelow ? 1 : 0); // reserve 1 line for "↓" if needed
  const finalEnd = Math.min(offset + adjustedSlots, allRows.length);

  if (hasAbove) lines.push(muted(` ↑ ${offset} more lines`));
  for (let i = offset; i < finalEnd; i++) {
    lines.push(allRows[i]!);
  }
  if (hasBelow) lines.push(muted(` ↓ ${allRows.length - finalEnd} more lines`));

  const remaining = maxLines - lines.length - 1;
  for (let i = 0; i < remaining; i++) lines.push("");
  lines.push(hintLine);
  return lines;
}

function renderHintBar(): string {
  const sep = dim(" │ ");
  return dim(
    `${bold("/")} search${sep}${bold("i")} stats${sep}${bold("s")} sources${sep}${bold("?")} help${sep}${bold("q")} quit`,
  );
}

// ── Pane renderers: Search mode ──

function renderSearchProjectPane(browser: LocalTuiBrowser, state: BrowserState, viewportSize: number, colWidth: number): string[] {
  const searchGroups = getSearchGroups(browser, state);
  const queryDisplay = state.searchQuery || muted("(type to search)");
  const titleLine = state.focusPane === "projects"
    ? activeSectionTitle(`▸ / ${queryDisplay}`)
    : sectionTitle(`  / ${queryDisplay}`);
  const lines: string[] = [titleLine];

  if (searchGroups.length === 0) {
    if (!state.searchQuery) {
      lines.push(emptyRow("Type to search"));
    } else if (!shouldRunSearch(state)) {
      lines.push(emptyRow("Press Enter to search"));
    } else {
      lines.push(emptyRow("No matches"));
    }
    return lines;
  }

  const { start, end } = viewportWindow(searchGroups.length, state.selectedSearchProjectIndex, viewportSize);
  if (start > 0) lines.push(muted(` ↑ ${start} more`));
  for (let i = start; i < end; i++) {
    const group = searchGroups[i]!;
    const selected = state.selectedSearchProjectIndex === i;
    const focused = state.focusPane === "projects";
    const prefix = selectionPrefix(selected, focused);
    const countText = `${group.results.length}`;
    const countW = displayWidth(countText);
    const nameMaxW = Math.max(colWidth - countW - 5, 6);
    const name = compact(group.projectName, nameMaxW);
    const styledName = selected && focused ? activeItem(name) : selected ? selectedItem(name) : name;
    const leftPart = `${prefix} ${styledName}`;
    const gap = Math.max(1, colWidth - displayWidth(leftPart) - countW);
    lines.push(`${leftPart}${" ".repeat(gap)}${metaLabel(countText)}`);
  }
  if (end < searchGroups.length) lines.push(muted(` ↓ ${searchGroups.length - end} more`));
  return lines;
}

function renderSearchTurnPane(browser: LocalTuiBrowser, state: BrowserState, viewportSize: number, colWidth: number): string[] {
  const titleLine = state.focusPane === "turns" ? activeSectionTitle("▸ Results") : sectionTitle("  Results");
  const lines: string[] = [titleLine];
  const searchGroups = getSearchGroups(browser, state);
  const selectedGroup = searchGroups[state.selectedSearchProjectIndex];
  if (!selectedGroup || selectedGroup.results.length === 0) {
    lines.push(emptyRow("No results in this project"));
    return lines;
  }
  // Group search results by session for display
  const results = selectedGroup.results;
  const sessionGroups = groupSearchResultsBySession(results);
  const displayItems = buildSearchDisplayItems(sessionGroups, state, colWidth);
  const selectedIdx = findSelectedDisplayIndex(displayItems, state.selectedSearchTurnIndex);
  const { start, end } = viewportWindow(displayItems.length, selectedIdx, viewportSize);
  if (start > 0) lines.push(muted(` ↑ ${start} more`));
  for (let i = start; i < end; i++) {
    lines.push(displayItems[i]!.text);
  }
  if (end < displayItems.length) lines.push(muted(` ↓ ${displayItems.length - end} more`));
  return lines;
}

interface SearchSessionGroup {
  sessionId: string;
  sessionTitle: string;
  sessionCreatedAt?: string;
  results: Array<{ originalIndex: number; result: LocalTuiSearchResult }>;
}

function groupSearchResultsBySession(results: LocalTuiSearchResult[]): SearchSessionGroup[] {
  const groupMap = new Map<string, SearchSessionGroup>();
  const order: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    const sid = r.turn.session_id;
    if (!groupMap.has(sid)) {
      const title = r.session?.title ? compact(tameBrowseMarkup(r.session.title), 35) : sid.slice(0, 12);
      groupMap.set(sid, { sessionId: sid, sessionTitle: title, sessionCreatedAt: r.session?.created_at, results: [] });
      order.push(sid);
    }
    groupMap.get(sid)!.results.push({ originalIndex: i, result: r });
  }
  // Sort sessions by created_at DESC, turns within each session by time ASC (chronological)
  const groups = order.map(id => groupMap.get(id)!)
    .sort((a, b) => (b.sessionCreatedAt ?? "").localeCompare(a.sessionCreatedAt ?? ""));
  for (const g of groups) {
    g.results.sort((a, b) => a.result.turn.submission_started_at.localeCompare(b.result.turn.submission_started_at));
  }
  // Re-index so originalIndex matches the display order (for selection tracking)
  let idx = 0;
  for (const g of groups) {
    for (const item of g.results) {
      item.originalIndex = idx++;
    }
  }
  return groups;
}

function buildSearchDisplayItems(groups: SearchSessionGroup[], state: BrowserState, colWidth: number): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (const group of groups) {
    const dateStr = group.sessionCreatedAt ? formatShortDate(group.sessionCreatedAt) : "";
    const countStr = `${group.results.length}t`;
    const headerMeta = [countStr, dateStr].filter(Boolean).join(" · ");
    items.push({ turnIndex: -1, text: `${bold(yellow(group.sessionTitle))} ${dim(headerMeta)}` });
    const lastIdx = group.results.length - 1;
    for (let ti = 0; ti < group.results.length; ti++) {
      const { originalIndex, result } = group.results[ti]!;
      const selected = state.selectedSearchTurnIndex === originalIndex;
      const focused = state.focusPane === "turns";
      const connector = ti === lastIdx ? dim("└─") : dim("├─");
      items.push({
        turnIndex: originalIndex,
        text: formatSearchTurnRow(result, selected, focused, colWidth, connector),
      });
    }
  }
  return items;
}

function formatSearchTurnRow(entry: LocalTuiSearchResult, selected: boolean, focused: boolean, colWidth: number, connector: string): string {
  const prefix = `${connector}${selectionPrefix(selected, focused)}`;
  const model = entry.turn.context_summary.primary_model ?? "";
  const date = formatShortDate(entry.turn.submission_started_at);
  const metaText = [model, date].filter(Boolean).join(" · ");
  const metaW = displayWidth(metaText);
  const prefixW = displayWidth(prefix);
  const snippetMax = Math.max(colWidth - metaW - prefixW - 2, 8);
  const snippet = pickUserSnippet(entry.turn, snippetMax);
  const styledSnippet = selected && focused ? activeItem(snippet) : selected ? selectedItem(snippet) : snippet;
  const leftPart = `${prefix} ${styledSnippet}`;
  const gap = Math.max(1, colWidth - displayWidth(leftPart) - metaW);
  return `${leftPart}${" ".repeat(gap)}${metaLabel(metaText)}`;
}

/** Extract user message snippet — prefer non-injected user message over canonical_text. */
function pickUserSnippet(turn: { canonical_text: string; user_messages?: Array<{ raw_text: string; is_injected: boolean; canonical_text?: string }> }, maxCols: number): string {
  const msg = turn.user_messages?.find(m => !m.is_injected);
  if (msg) {
    const text = msg.canonical_text ?? msg.raw_text;
    const idx = text.lastIndexOf("## My request");
    if (idx >= 0) {
      const after = text.slice(idx).replace(/^##\s*My request[^\n]*\n?/, "").trim();
      if (after.length > 0) return compactByDisplayWidth(tameBrowseMarkup(after), maxCols);
    }
    return compactByDisplayWidth(tameBrowseMarkup(text), maxCols);
  }
  return pickTurnSnippet(turn.canonical_text || "(empty)", maxCols);
}

function renderSearchDetailPane(browser: LocalTuiBrowser, state: BrowserState, maxLines: number, colWidth: number): string[] {
  const focused = state.focusPane === "detail";
  const titleLine = focused ? activeSectionTitle("▸ Detail") : sectionTitle("  Detail");
  const turn = getSelectedSearchTurn(browser, state);
  const searchGroups = getSearchGroups(browser, state);
  const group = searchGroups[state.selectedSearchProjectIndex];
  const allRows = formatDetailRows(browser, {
    projectName: turn?.project?.display_name ?? group?.projectName,
    selectedTurn: turn ? { turn: turn.turn, session: turn.session, context: turn.context, related_work: turn.related_work } : undefined,
    turnPosition: group ? `${state.selectedSearchTurnIndex + 1}/${group.results.length}` : undefined,
    sessionTitle: turn?.session?.title,
    focused,
    colWidth,
  });
  return renderScrollablePane(allRows, titleLine, maxLines, focused ? state.detailScrollOffset : 0);
}

// ── Conversation view (session-level) ──

function buildSessionConversationLines(
  sessionTurns: LocalTuiBrowserTurn[],
  selectedTurn: LocalTuiBrowserTurn | undefined,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  const contentWidth = Math.max(maxWidth - 4, 40);
  for (let ti = 0; ti < sessionTurns.length; ti++) {
    const turn = sessionTurns[ti]!;
    const isSelected = turn.turn.id === selectedTurn?.turn.id;
    const turnLabel = isSelected ? bold(cyan(`── Turn ${ti + 1}/${sessionTurns.length} ──`)) : dim(`── Turn ${ti + 1}/${sessionTurns.length} ──`);
    lines.push(turnLabel);

    // User prompt — full content, no truncation (viewport handles scrolling)
    const userText = pickUserMessageText(turn);
    lines.push(bold(cyan("👤 User")));
    for (const wl of wrapText(userText, contentWidth)) {
      lines.push(`  ${wl}`);
    }

    // Replies + tool calls interleaved
    const ctx = turn.context;
    if (ctx) {
      for (const reply of ctx.assistant_replies) {
        const model = reply.model ?? turn.turn.context_summary.primary_model ?? "";
        const tokenParts: string[] = [];
        if (reply.token_usage?.input_tokens) tokenParts.push(`${formatTokenCountRaw(reply.token_usage.input_tokens)} in`);
        if (reply.token_usage?.output_tokens) tokenParts.push(`${formatTokenCountRaw(reply.token_usage.output_tokens)} out`);
        const tokenLabel = tokenParts.length > 0 ? dim(` · ${tokenParts.join("/")}`) : "";
        lines.push(bold(green(`🤖 ${model}`) + tokenLabel));
        const content = reply.content ?? reply.content_preview ?? "(empty)";
        const contentLines = wrapText(tameDetailMarkup(content), contentWidth);
        for (const cl of contentLines) {
          lines.push(`  ${cl}`);
        }

        // Tool calls for this reply — collapsed to 1 line each
        const replyTools = ctx.tool_calls.filter(tc => tc.reply_id === reply.id);
        if (replyTools.length > 0) {
          for (const tool of replyTools) {
            const status = tool.status === "error" ? bold(" ERR") : "";
            const dur = tool.duration_ms ? dim(` ${tool.duration_ms}ms`) : "";
            const summary = tool.input_summary ? dim(` ${compact(tool.input_summary, 40)}`) : "";
            lines.push(yellow(`  🔧 ${tool.tool_name ?? "?"}${status}${dur}${summary}`));
          }
        }
      }
    }
    if (ti < sessionTurns.length - 1) lines.push(""); // separator between turns
  }
  return lines;
}

// ── Detail pane content ──

interface DetailInput {
  projectName?: string;
  selectedTurn?: LocalTuiBrowserTurn;
  turnPosition?: string;
  sessionTitle?: string;
  focused: boolean;
  colWidth: number;
}

function formatDetailRows(browser: LocalTuiBrowser, input: DetailInput): string[] {
  if (!input.selectedTurn) {
    return [muted(input.projectName ? `Project: ${input.projectName}` : "Select a turn to view details")];
  }
  const t = input.selectedTurn;
  const model = t.turn.context_summary.primary_model ?? "unknown";
  const tokens = formatTokenCount(t.turn.context_summary.total_tokens);
  const source = formatSourceLabel(browser, t.session, t.turn.source_id);
  const date = formatShortDate(t.turn.submission_started_at);
  const contentWidth = Math.max(input.colWidth - 4, 20);

  const rows: string[] = [];
  // Position indicator + Turn ID
  const shortId = t.turn.id.slice(0, 8);
  if (input.turnPosition) {
    rows.push(`${bold("Turn")} ${cyan(input.turnPosition)} ${dim("in")} ${cyan(input.projectName ?? "?")}${input.sessionTitle ? dim(` · ${compact(input.sessionTitle, 30)}`) : ""} ${magenta(shortId)}`);
  } else {
    rows.push(`${bold("Project:")} ${cyan(input.projectName ?? "?")} ${magenta(shortId)}`);
  }
  rows.push(`${metaLabel("Model:")} ${blue(model)}${tokens ? ` ${dim("·")} ${tokens}` : ""} ${dim("·")} ${blue(source)} ${dim("·")} ${date}`);

  // Related work summary
  const children = (t.related_work ?? []).filter(e => e.relation_kind === "delegated_session").length;
  const auto = (t.related_work ?? []).filter(e => e.relation_kind === "automation_run").length;
  if (children > 0 || auto > 0) {
    const parts: string[] = [];
    if (children > 0) parts.push(`${children} child`);
    if (auto > 0) parts.push(`${auto} auto`);
    rows.push(`${metaLabel("Related:")} ${parts.join(", ")}`);
  }

  // Full prompt content — no truncation, scrollable pane handles viewport
  rows.push("");
  const promptText = pickUserPromptText(t);
  const wrappedPrompt = wrapText(promptText, contentWidth);
  rows.push(bold("Prompt:"));
  rows.push(...wrappedPrompt.map(l => `  ${l}`));

  if (input.focused) {
    rows.push("");
    rows.push(dim("↑↓ scroll │ Enter → full session conversation"));
  }
  return rows;
}

function pickUserPromptText(turn: LocalTuiBrowserTurn): string {
  const msg = turn.turn.user_messages?.find(m => !m.is_injected);
  if (msg) {
    const text = msg.canonical_text ?? msg.raw_text;
    const idx = text.lastIndexOf("## My request");
    if (idx >= 0) {
      const after = text.slice(idx).replace(/^##\s*My request[^\n]*\n?/, "").trim();
      if (after.length > 0) return tameDetailMarkup(after);
    }
    return tameDetailMarkup(text);
  }
  return tameDetailMarkup(turn.turn.canonical_text);
}

/** Strip injected XML tags but preserve newlines for detail pane display. */
function tameDetailMarkup(value: string): string {
  return value
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi, " ")
    .replace(/<command-message>[\s\S]*?<\/command-message>/gi, " ")
    .replace(/<command-args>[\s\S]*?<\/command-args>/gi, " ")
    .replace(/<command-name>([\s\S]*?)<\/command-name>/gi, "$1 ")
    .replace(/<\/?(?:command-name|command-message|command-args)>/gi, " ")
    .replace(/[^\S\n]+/g, " ")   // collapse spaces/tabs but NOT newlines
    .replace(/ *\n */g, "\n")    // trim spaces around newlines
    .replace(/\n{3,}/g, "\n\n") // cap consecutive blank lines at 1
    .trim();
}

// ── Stats overlay (full-screen) ──

function timeWindowDays(tw: StatsTimeWindow): number | undefined {
  switch (tw) {
    case "7d": return 7;
    case "30d": return 30;
    case "90d": return 90;
    case "1y": return 365;
    default: return undefined;
  }
}


function computeAfterDate(tw: StatsTimeWindow): string | undefined {
  const days = timeWindowDays(tw);
  if (!days) return undefined;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
}

function renderStatsOverlay(browser: LocalTuiBrowser, state: BrowserState, maxWidth: number, maxHeight: number): string[] {
  const lines: string[] = [];
  const innerW = Math.max(maxWidth - 4, 40);
  const tw = state.showStatsTimeWindow;
  const afterDate = computeAfterDate(tw);

  // Header with time window selector
  const twLabels: StatsTimeWindow[] = ["all", "7d", "30d", "90d", "1y"];
  const twDisplay = twLabels.map(t => t === tw ? bold(cyan(t)) : dim(t)).join(dim(" · "));
  lines.push(activeSectionTitle("▸ Statistics") + "  " + twDisplay + "  " + dim("(Tab cycle · i close)"));
  lines.push(dim("─".repeat(Math.min(innerW, maxWidth))));

  // Overview (filtered by time window)
  const ov = browser.getUsageOverview(afterDate);
  lines.push("");
  lines.push(bold("  Overview"));
  const col1W = Math.floor(innerW / 2) - 2;
  const col2W = innerW - col1W - 4;
  lines.push(`  ${padLine(`Turns: ${cyan(String(ov.total_turns))}`, col1W)}  ${padLine(`Total tokens: ${cyan(formatTokenCountRaw(ov.total_tokens))}`, col2W)}`);
  lines.push(`  ${padLine(`With usage: ${cyan(String(ov.turns_with_token_usage))}`, col1W)}  ${padLine(`Input: ${cyan(formatTokenCountRaw(ov.total_input_tokens))}`, col2W)}`);
  lines.push(`  ${padLine(`With model: ${cyan(String(ov.turns_with_primary_model))}`, col1W)}  ${padLine(`Output: ${cyan(formatTokenCountRaw(ov.total_output_tokens))}`, col2W)}`);
  if (ov.total_cached_input_tokens > 0) {
    lines.push(`  ${padLine("", col1W)}  ${padLine(`Cached: ${cyan(formatTokenCountRaw(ov.total_cached_input_tokens))}`, col2W)}`);
  }

  // Activity heatmap (filtered by time window)
  const dayRollup = browser.getUsageRollup("day", afterDate);
  if (dayRollup.rows.length > 0) {
    const heatmapDays = timeWindowDays(tw) ?? 180;
    lines.push("");
    lines.push(bold("  Activity") + dim(` (${tw === "all" ? "all time" : `last ${tw}`})`));
    lines.push(renderActivityHeatmap(dayRollup.rows, innerW, heatmapDays));
  }

  // Remaining height for rollup tables
  const remainingForTables = Math.max(maxHeight - lines.length - 2, 8);
  const tableMaxRows = Math.min(Math.floor(remainingForTables / 6), 8);

  // All rollup tables filtered by the same time window
  renderRollupTable(lines, browser, "model", "Models", innerW, tableMaxRows, afterDate);
  renderRollupTable(lines, browser, "project", "Projects", innerW, tableMaxRows, afterDate);
  renderRollupTable(lines, browser, "host", "Hosts", innerW, tableMaxRows, afterDate);
  renderRollupTable(lines, browser, "source", "Sources", innerW, tableMaxRows, afterDate);

  return lines;
}

function renderRollupTable(
  lines: string[],
  browser: LocalTuiBrowser,
  dimension: "model" | "project" | "host" | "source",
  title: string,
  innerW: number,
  maxRows: number,
  afterDate?: string,
): void {
  const rollup = browser.getUsageRollup(dimension, afterDate);
  const rows = rollup.rows;
  if (rows.length === 0) return;

  const sorted = rows.slice().sort((a, b) => b.total_tokens - a.total_tokens);
  const totalTokens = sorted.reduce((s, r) => s + r.total_tokens, 0) || 1;
  const nameColW = Math.min(32, Math.max(20, Math.floor(innerW * 0.3)));
  const barMaxW = Math.min(20, Math.max(6, Math.floor((innerW - nameColW - 32) * 0.5)));

  lines.push("");
  lines.push(bold(`  ${title}`));
  lines.push(dim(`  ${"Name".padEnd(nameColW)} ${"Turns".padStart(6)} ${"Tokens".padStart(9)} ${" %".padStart(6)}  Bar`));
  for (const row of sorted.slice(0, maxRows)) {
    const pct = (row.total_tokens / totalTokens) * 100;
    const barLen = Math.max(1, Math.round(pct / 100 * barMaxW));
    const bar = dim("▪".repeat(barLen));
    const label = row.label.length > nameColW ? row.label.slice(0, nameColW - 1) + "…" : row.label;
    lines.push(`  ${cyan(label.padEnd(nameColW))} ${String(row.turn_count).padStart(6)} ${formatTokenCountRaw(row.total_tokens).padStart(9)} ${(pct.toFixed(1) + "%").padStart(6)}  ${bar}`);
  }
  if (sorted.length > maxRows) lines.push(dim(`  … ${sorted.length - maxRows} more`));
}

function renderActivityHeatmap(dayRows: { key: string; total_tokens: number }[], maxWidth: number, totalDays: number): string {
  const now = new Date();
  const dayMap = new Map<string, number>();
  for (const r of dayRows) dayMap.set(r.key, r.total_tokens);

  // Collect days
  const span = Math.min(totalDays, 365);
  const days: { date: Date; tokens: number }[] = [];
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    days.push({ date: d, tokens: dayMap.get(key) ?? 0 });
  }

  // Group into weeks
  const weeks: Array<Array<{ tokens: number; dow: number }>> = [];
  let currentWeek: Array<{ tokens: number; dow: number }> = [];
  for (const day of days) {
    const dow = day.date.getDay();
    if (dow === 0 && currentWeek.length > 0) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    currentWeek.push({ tokens: day.tokens, dow });
  }
  if (currentWeek.length > 0) weeks.push(currentWeek);

  // Determine cell width: use 2-char cells with space if terminal is wide enough
  const labelW = 6; // "  Mon "
  const availW = maxWidth - labelW - 4;
  const cellW = weeks.length * 2 <= availW ? 2 : 1;

  const maxTokens = Math.max(...days.map(d => d.tokens), 1);
  const intensityChar = (tokens: number): string => {
    if (tokens === 0) return dim("·");
    const ratio = tokens / maxTokens;
    if (ratio < 0.25) return dim("░");
    if (ratio < 0.5) return "▒";
    if (ratio < 0.75) return "▓";
    return bold("█");
  };

  const dayLabels = ["", "Mon", "", "Wed", "", "Fri", ""];
  const heatmapLines: string[] = [];
  for (let dow = 0; dow < 7; dow++) {
    const label = dayLabels[dow]!.padStart(4);
    let row = dim(label) + " ";
    for (const week of weeks) {
      const cell = week.find(c => c.dow === dow);
      const ch = cell !== undefined ? intensityChar(cell.tokens) : " ";
      row += cellW === 2 ? ch + " " : ch;
    }
    heatmapLines.push(`  ${row}`);
  }
  heatmapLines.push(`  ${" ".repeat(5)}${dim("Less")} ${dim("░")} ${"▒"} ${"▓"} ${bold("█")} ${dim("More")}`);

  // Month labels
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let monthRow = " ".repeat(labelW);
  let lastMonth = -1;
  for (let wi = 0; wi < weeks.length; wi++) {
    const week = weeks[wi]!;
    const firstDayInWeek = days.find(d => {
      const dow = d.date.getDay();
      return week.some(w => w.dow === dow);
    });
    const m = firstDayInWeek?.date.getMonth() ?? -1;
    if (m !== lastMonth) {
      const mLabel = monthNames[m] ?? "   ";
      monthRow += mLabel;
      lastMonth = m;
      // Pad remaining cell width
      if (cellW === 2) monthRow += " ".repeat(Math.max(0, cellW - mLabel.length + 1));
    } else {
      monthRow += " ".repeat(cellW);
    }
  }
  return [`  ${dim(monthRow.trimEnd())}`, ...heatmapLines].join("\n");
}

// ── Source health overlay (full-screen) ──

function renderSourceHealthOverlay(browser: LocalTuiBrowser, maxWidth: number, maxHeight: number): string[] {
  const { counts, sources } = browser.sourceHealth;
  const lines: string[] = [];
  lines.push(activeSectionTitle("▸ Source Health") + "  " + dim("(s to close)"));
  lines.push(dim("─".repeat(Math.min(maxWidth - 4, maxWidth))));
  lines.push("");
  const summary = [
    green(`Healthy: ${counts.healthy}`),
    yellow(`Stale: ${counts.stale}`),
    counts.error > 0 ? bold(`Error: ${counts.error}`) : dim(`Error: ${counts.error}`),
  ].join("  ·  ");
  lines.push(`  ${summary}`);
  lines.push("");
  for (const s of sources) {
    const sc = s.sync_status === "healthy" ? green : s.sync_status === "stale" ? yellow : bold;
    lines.push(`  ${dim("·")} ${s.display_name} ${dim(`(${s.platform})`)} ${sc(s.sync_status)} ${metaLabel(`${s.total_sessions}s ${s.total_turns}t`)}`);
  }
  return lines;
}

// ── Help overlay (full-screen) ──

function renderHelpOverlay(maxWidth: number, maxHeight: number): string[] {
  const lines: string[] = [];
  lines.push(activeSectionTitle("▸ Help") + "  " + dim("(? to close)"));
  lines.push(dim("─".repeat(Math.min(maxWidth - 4, maxWidth))));
  lines.push("");
  lines.push(bold("  Navigation"));
  lines.push(`    ${bold("↑/↓")} or ${bold("j/k")}  Move cursor      ${bold("PgUp/PgDn")}  Page up/down`);
  lines.push(`    ${bold("g/G")}            First/last        ${bold("Tab/→")}      Next pane`);
  lines.push(`    ${bold("Shift+Tab/←")}    Prev pane         ${bold("Enter")}      Drill in`);
  lines.push(`    ${bold("Esc")}            Back / close      Mouse wheel: scroll`);
  lines.push("");
  lines.push(bold("  Panes"));
  lines.push(`    ${bold("p")} projects   ${bold("t")} turns   ${bold("d")} detail`);
  lines.push("");
  lines.push(bold("  Actions"));
  lines.push(`    ${bold("/")} search    ${bold("s")} sources    ${bold("i")} stats    ${bold("?")} help    ${bold("q")} quit`);
  lines.push("");
  lines.push(bold("  Conversation View"));
  lines.push(`    ${bold("Enter")} on Detail pane → browse all turns in session`);
  lines.push(`    ${bold("j/k")} scroll   ${bold("PgUp/PgDn")} page   ${bold("Esc")} back to detail`);
  return lines;
}

// ── Status line ──

function renderStatusLine(browser: LocalTuiBrowser, state: BrowserState, width: number): string {
  const parts: string[] = [];
  if (state.mode === "search") {
    const groups = getSearchGroups(browser, state);
    const total = groups.reduce((sum, g) => sum + g.results.length, 0);
    parts.push(`Search: ${total} results`);
  }
  parts.push(`${state.focusPane}`);
  parts.push(`${browser.overview.counts.projects}P ${browser.overview.counts.turns}T`);
  if (state.focusPane === "conversation") {
    parts.push(`scroll: j/k PgUp/PgDn`);
  }
  parts.push("? help");
  return dim(parts.join(" │ "));
}

// ── State helpers ──

function clampState(state: BrowserState, browser: LocalTuiBrowser): BrowserState {
  const projectCount = browser.projects.length;
  const selectedProjectIndex = projectCount === 0 ? 0 : clampIndex(state.selectedProjectIndex, projectCount);
  const turnCount = browser.projects[selectedProjectIndex]?.turns.length ?? 0;

  // Search: clamp project and turn indices (only search if committed or query >= 4 chars)
  const searchGroups = state.mode === "search" && shouldRunSearch(state) ? getSearchGroupsFromQuery(browser, state.searchQuery) : [];
  const searchProjectCount = searchGroups.length;
  const searchProjectIdx = searchProjectCount === 0 ? 0 : clampIndex(state.selectedSearchProjectIndex, searchProjectCount);
  const searchTurnCount = searchGroups[searchProjectIdx]?.results.length ?? 0;

  return {
    ...state,
    selectedProjectIndex,
    selectedTurnIndex: turnCount === 0 ? 0 : clampIndex(state.selectedTurnIndex, turnCount),
    selectedSearchProjectIndex: searchProjectIdx,
    selectedSearchTurnIndex: searchTurnCount === 0 ? 0 : clampIndex(state.selectedSearchTurnIndex, searchTurnCount),
  };
}

function clampIndex(value: number, length: number): number {
  return Math.max(0, Math.min(value, Math.max(length - 1, 0)));
}

function getSelectedTurns(browser: LocalTuiBrowser, state: BrowserState) {
  return browser.projects[state.selectedProjectIndex]?.turns ?? [];
}

function getSelectedTurn(browser: LocalTuiBrowser, state: BrowserState): LocalTuiBrowserTurn | undefined {
  return getSelectedTurns(browser, state)[state.selectedTurnIndex];
}

function getSessionTurns(browser: LocalTuiBrowser, state: BrowserState, turn: LocalTuiBrowserTurn): LocalTuiBrowserTurn[] {
  const sessionId = turn.turn.session_id;
  if (state.mode === "search") {
    // Collect all turns from the project that match this session
    for (const proj of browser.projects) {
      const sessionTurns = proj.turns.filter(t => t.turn.session_id === sessionId);
      if (sessionTurns.length > 0) return sessionTurns;
    }
    return [turn];
  }
  const allTurns = getSelectedTurns(browser, state);
  return allTurns.filter(t => t.turn.session_id === sessionId);
}

// ── Search grouping ──

interface SearchGroup {
  projectName: string;
  projectId: string;
  results: LocalTuiSearchResult[];
}

function shouldRunSearch(state: BrowserState): boolean {
  if (!state.searchQuery) return false;
  if (state.searchQuery.length >= 4) return true;
  return state.searchCommitted;
}

// Search cache: store the initial FTS results at the anchor query and filter locally for extensions.
// The cache is never mutated — appending chars filters from the original anchor results.
// Backspace past the anchor or exiting search invalidates the cache.
let _searchCache: { anchorQuery: string; anchorResults: LocalTuiSearchResult[] } | null = null;

function getCachedOrFreshResults(browser: LocalTuiBrowser, query: string): LocalTuiSearchResult[] {
  if (!query) { _searchCache = null; return []; }
  const q = query.toLowerCase();
  // If current query extends the anchor, filter from the immutable anchor results
  if (_searchCache && q.startsWith(_searchCache.anchorQuery.toLowerCase()) && _searchCache.anchorQuery.length > 0) {
    if (q === _searchCache.anchorQuery.toLowerCase()) return _searchCache.anchorResults;
    return _searchCache.anchorResults.filter(r => {
      const text = (r.turn.canonical_text ?? "").toLowerCase();
      return text.includes(q);
    });
  }
  // Full FTS query — store as new anchor (cache is immutable after this)
  const results = browser.search(query);
  _searchCache = { anchorQuery: query, anchorResults: results };
  return results;
}

function getSearchGroupsFromQuery(browser: LocalTuiBrowser, query: string): SearchGroup[] {
  if (!query) return [];
  const allResults = getCachedOrFreshResults(browser, query);
  const groupMap = new Map<string, SearchGroup>();
  for (const r of allResults) {
    const key = r.project?.project_id ?? "__unlinked__";
    const name = r.project?.display_name ?? "Unlinked";
    let group = groupMap.get(key);
    if (!group) {
      group = { projectName: name, projectId: key, results: [] };
      groupMap.set(key, group);
    }
    group.results.push(r);
  }
  // Sort by result count desc
  return [...groupMap.values()].sort((a, b) => b.results.length - a.results.length);
}

function getSearchGroups(browser: LocalTuiBrowser, state: BrowserState): SearchGroup[] {
  if (!shouldRunSearch(state)) return [];
  return getSearchGroupsFromQuery(browser, state.searchQuery);
}

function getSelectedSearchTurn(browser: LocalTuiBrowser, state: BrowserState): LocalTuiSearchResult | undefined {
  const groups = getSearchGroups(browser, state);
  return groups[state.selectedSearchProjectIndex]?.results[state.selectedSearchTurnIndex];
}

function viewportWindow(total: number, selectedIndex: number, size: number): { start: number; end: number } {
  if (total <= size) return { start: 0, end: total };
  const half = Math.floor(size / 2);
  let start = selectedIndex - half;
  if (start < 0) start = 0;
  let end = start + size;
  if (end > total) {
    end = total;
    start = end - size;
  }
  return { start, end };
}

// ── Session grouping ──

interface SessionGroup {
  sessionId: string;
  sessionTitle: string;
  sessionCreatedAt?: string;
  turns: Array<{ originalIndex: number; entry: LocalTuiBrowserTurn }>;
}

function groupTurnsBySession(turns: LocalTuiBrowserTurn[]): SessionGroup[] {
  const groups: SessionGroup[] = [];
  let current: SessionGroup | undefined;
  for (let i = 0; i < turns.length; i++) {
    const entry = turns[i]!;
    const sid = entry.turn.session_id;
    if (!current || current.sessionId !== sid) {
      const title = entry.session?.title ? compact(tameBrowseMarkup(entry.session.title), 40) : sid.slice(0, 12);
      const createdAt = entry.session?.created_at;
      current = { sessionId: sid, sessionTitle: title, sessionCreatedAt: createdAt, turns: [] };
      groups.push(current);
    }
    current.turns.push({ originalIndex: i, entry });
  }
  return groups;
}

interface DisplayItem {
  turnIndex: number; // -1 for headers
  text: string;
}

function buildDisplayItems(groups: SessionGroup[], state: BrowserState, mode: "browse" | "search", colWidth?: number): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (const group of groups) {
    // Session header — always shown, with creation date
    const dateStr = group.sessionCreatedAt ? formatShortDate(group.sessionCreatedAt) : "";
    const countStr = `${group.turns.length}t`;
    const headerMeta = [countStr, dateStr].filter(Boolean).join(" · ");
    items.push({ turnIndex: -1, text: `${bold(yellow(group.sessionTitle))} ${dim(headerMeta)}` });
    // Tree-style turn rows
    const lastIdx = group.turns.length - 1;
    for (let ti = 0; ti < group.turns.length; ti++) {
      const { originalIndex, entry } = group.turns[ti]!;
      const selected = mode === "browse" ? state.selectedTurnIndex === originalIndex : state.selectedSearchTurnIndex === originalIndex;
      const connector = ti === lastIdx ? dim("└─") : dim("├─");
      items.push({
        turnIndex: originalIndex,
        text: formatTurnRow(entry, selected, state.focusPane === "turns", colWidth, connector),
      });
    }
  }
  return items;
}

function findSelectedDisplayIndex(items: DisplayItem[], turnIndex: number): number {
  for (let i = 0; i < items.length; i++) {
    if (items[i]!.turnIndex === turnIndex) return i;
  }
  return 0;
}

// ── Row formatters ──

function formatProjectRow(entry: LocalTuiBrowser["projects"][number], selected: boolean, focused: boolean, maxWidth: number): string {
  const prefix = selectionPrefix(selected, focused);
  const project = entry.project;
  const sessions = project.session_count;
  const turns = project.committed_turn_count + project.candidate_turn_count;
  const dateLabel = formatShortDate(project.project_last_activity_at);
  const metaText = `${sessions}s ${turns}t ${dateLabel}`;
  const metaW = displayWidth(metaText);
  // prefix=2, 1 space after prefix, 2 space gap before meta
  const nameMaxW = Math.max(maxWidth - metaW - 5, 6);
  const name = compact(project.display_name, nameMaxW);
  const styledName = selected && focused ? activeItem(name) : selected ? selectedItem(name) : name;
  const leftPart = `${prefix} ${styledName}`;
  const gap = Math.max(1, maxWidth - displayWidth(leftPart) - metaW);
  return `${leftPart}${" ".repeat(gap)}${metaLabel(metaText)}`;
}

function formatTurnRow(entry: LocalTuiBrowserTurn, selected: boolean, focused: boolean, colWidth?: number, connector?: string): string {
  const prefix = connector ? `${connector}${selectionPrefix(selected, focused)}` : selectionPrefix(selected, focused);
  const model = entry.turn.context_summary.primary_model ?? "";
  const tokenInfo = formatTokenCount(entry.turn.context_summary.total_tokens);
  const date = formatShortDate(entry.turn.submission_started_at);
  const metaText = [model, tokenInfo, date].filter(Boolean).join(" · ");
  const metaW = displayWidth(metaText);
  const prefixW = displayWidth(prefix);
  // Reserve: prefixW + 1 space + 1 gap before meta + metaW
  const maxSnippet = colWidth ? Math.max(colWidth - metaW - prefixW - 2, 8) : 36;
  const snippet = pickUserSnippet(entry.turn, maxSnippet);
  const styledSnippet = selected && focused ? activeItem(snippet) : selected ? selectedItem(snippet) : snippet;
  const leftPart = `${prefix} ${styledSnippet}`;
  if (colWidth) {
    const gap = Math.max(1, colWidth - displayWidth(leftPart) - metaW);
    return `${leftPart}${" ".repeat(gap)}${metaLabel(metaText)}`;
  }
  return `${leftPart}  ${metaLabel(metaText)}`;
}

// ── Text utilities ──

function selectionPrefix(selected: boolean, focused: boolean): string {
  if (selected && focused) return cursor("❯");
  if (selected) return bold("▪");
  return dim("·");
}

function emptyRow(label: string): string {
  return ` ${dim("·")} ${muted(label)}`;
}

function pickTurnSnippet(canonicalText: string, maxCols: number): string {
  const requestIdx = canonicalText.lastIndexOf("## My request");
  let text: string;
  if (requestIdx >= 0) {
    const afterHeading = canonicalText.slice(requestIdx).replace(/^##\s*My request[^\n]*\n?/, "").trim();
    text = afterHeading.length > 0 ? tameBrowseMarkup(afterHeading) : tameBrowseMarkup(canonicalText);
  } else {
    text = tameBrowseMarkup(canonicalText);
  }
  return compactByDisplayWidth(text, maxCols);
}

/** Truncate by terminal display width (CJK-aware), not string length. */
function compactByDisplayWidth(text: string, maxCols: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (displayWidth(cleaned) <= maxCols) return cleaned;
  let w = 0;
  let i = 0;
  for (const ch of cleaned) {
    const cw = isWide(ch.codePointAt(0) ?? 0) ? 2 : 1;
    if (w + cw + 1 > maxCols) break; // +1 for the trailing "…"
    w += cw;
    i += ch.length;
  }
  return cleaned.slice(0, i) + "…";
}

function pickUserMessageText(turn: { turn: { canonical_text: string; user_messages?: Array<{ raw_text: string; is_injected: boolean; canonical_text?: string }> } }): string {
  const msg = turn.turn.user_messages?.find(m => !m.is_injected);
  if (msg) {
    const text = msg.canonical_text ?? msg.raw_text;
    const idx = text.lastIndexOf("## My request");
    if (idx >= 0) {
      const after = text.slice(idx).replace(/^##\s*My request[^\n]*\n?/, "").trim();
      if (after.length > 0) return tameDetailMarkup(after);
    }
    return tameDetailMarkup(text);
  }
  const requestIdx = turn.turn.canonical_text.lastIndexOf("## My request");
  if (requestIdx >= 0) {
    const after = turn.turn.canonical_text.slice(requestIdx).replace(/^##\s*My request[^\n]*\n?/, "").trim();
    if (after.length > 0) return tameDetailMarkup(after);
  }
  return tameDetailMarkup(turn.turn.canonical_text);
}

function formatTokenCount(count: number | undefined): string {
  if (!count) return "";
  return formatTokenCountRaw(count);
}

function formatTokenCountRaw(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}K`;
  return String(count);
}

function formatShortDate(isoDate: string | undefined): string {
  if (!isoDate) return "";
  try {
    const d = new Date(isoDate);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${months[d.getMonth()]} ${d.getDate()} ${hh}:${mm}:${ss}`;
  } catch {
    return "";
  }
}

function wrapText(text: string, width: number): string[] {
  if (text.trim().length === 0) return [];
  const result: string[] = [];
  for (const paragraph of text.split("\n")) {
    const cleaned = paragraph.replace(/[^\S\n]+/g, " ").trim();
    if (cleaned.length === 0) { result.push(""); continue; }
    if (displayWidth(cleaned) <= width) { result.push(cleaned); continue; }
    wrapParagraph(cleaned, width, result);
  }
  return result;
}

/** Word-wrap a single paragraph using display-width (CJK-aware). */
function wrapParagraph(text: string, width: number, out: string[]): void {
  let i = 0;
  while (i < text.length) {
    let col = 0;
    let lineEnd = i;
    let lastSpace = -1;
    // Scan forward to find how many chars fit in `width` columns
    let j = i;
    while (j < text.length) {
      const ch = text[j]!;
      const cw = isWide(ch.codePointAt(0) ?? 0) ? 2 : 1;
      if (col + cw > width) break;
      if (ch === " ") lastSpace = j;
      col += cw;
      j++;
    }
    if (j >= text.length) {
      // Remaining text fits
      out.push(text.slice(i));
      break;
    }
    // Need to break — prefer space boundary
    if (lastSpace > i) {
      out.push(text.slice(i, lastSpace));
      i = lastSpace + 1;
    } else {
      // No space found — hard break at j
      out.push(text.slice(i, j));
      i = j;
    }
  }
}

function formatSourceLabel(
  browser: LocalTuiBrowser,
  session: { source_id?: string; source_platform?: string } | undefined,
  fallbackSourceId: string,
): string {
  const sourceId = session?.source_id ?? fallbackSourceId;
  const source = browser.sourceHealth.sources.find(e => e.id === sourceId);
  if (source) return `${source.display_name} (${source.platform})`;
  return session?.source_platform ?? fallbackSourceId;
}
