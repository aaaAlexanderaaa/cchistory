import type { LocalTuiBrowser, LocalTuiSearchResult } from "@cchistory/storage";

export type BrowserFocusPane = "projects" | "turns" | "detail";
export type BrowserMode = "browse" | "search";

export interface BrowserState {
  mode: BrowserMode;
  focusPane: BrowserFocusPane;
  selectedProjectIndex: number;
  selectedTurnIndex: number;
  selectedSearchResultIndex: number;
  searchQuery: string;
  showHelp: boolean;
  showSourceHealth: boolean;
}

export type BrowserAction =
  | { type: "focus-next" }
  | { type: "focus-previous" }
  | { type: "focus-projects" }
  | { type: "focus-turns" }
  | { type: "focus-detail" }
  | { type: "move-up" }
  | { type: "move-down" }
  | { type: "drill" }
  | { type: "retreat" }
  | { type: "enter-search-mode" }
  | { type: "exit-search-mode" }
  | { type: "append-search-char"; value: string }
  | { type: "backspace-search" }
  | { type: "toggle-source-health" }
  | { type: "close-source-health" }
  | { type: "toggle-help" }
  | { type: "close-help" };

const FOCUS_ORDER: BrowserFocusPane[] = ["projects", "turns", "detail"];

export function createBrowserState(browser: LocalTuiBrowser): BrowserState {
  return clampState(
    {
      mode: "browse",
      focusPane: "projects",
      selectedProjectIndex: 0,
      selectedTurnIndex: 0,
      selectedSearchResultIndex: 0,
      searchQuery: "",
      showHelp: false,
      showSourceHealth: false,
    },
    browser,
  );
}

export function reduceBrowserState(browser: LocalTuiBrowser, state: BrowserState, action: BrowserAction): BrowserState {
  switch (action.type) {
    case "focus-next":
      return {
        ...state,
        focusPane: FOCUS_ORDER[(FOCUS_ORDER.indexOf(state.focusPane) + 1) % FOCUS_ORDER.length] ?? "projects",
      };
    case "focus-previous":
      return {
        ...state,
        focusPane: FOCUS_ORDER[(FOCUS_ORDER.indexOf(state.focusPane) + FOCUS_ORDER.length - 1) % FOCUS_ORDER.length] ?? "detail",
      };
    case "focus-projects":
      return { ...state, focusPane: "projects" };
    case "focus-turns":
      return { ...state, focusPane: "turns" };
    case "focus-detail":
      return { ...state, focusPane: "detail" };
    case "move-up":
      return clampState(
        state.mode === "search"
          ? state.focusPane === "turns"
            ? { ...state, selectedSearchResultIndex: state.selectedSearchResultIndex - 1 }
            : state
          : state.focusPane === "projects"
            ? { ...state, selectedProjectIndex: state.selectedProjectIndex - 1, selectedTurnIndex: 0 }
            : state.focusPane === "turns"
              ? { ...state, selectedTurnIndex: state.selectedTurnIndex - 1 }
              : state,
        browser,
      );
    case "move-down":
      return clampState(
        state.mode === "search"
          ? state.focusPane === "turns"
            ? { ...state, selectedSearchResultIndex: state.selectedSearchResultIndex + 1 }
            : state
          : state.focusPane === "projects"
            ? { ...state, selectedProjectIndex: state.selectedProjectIndex + 1, selectedTurnIndex: 0 }
            : state.focusPane === "turns"
              ? { ...state, selectedTurnIndex: state.selectedTurnIndex + 1 }
              : state,
        browser,
      );
    case "drill":
      return state.focusPane === "projects"
        ? { ...state, focusPane: "turns" }
        : state.focusPane === "turns"
          ? { ...state, focusPane: "detail" }
          : state;
    case "retreat":
      return state.focusPane === "detail"
        ? { ...state, focusPane: "turns" }
        : state.focusPane === "turns"
          ? { ...state, focusPane: "projects" }
          : state;
    case "enter-search-mode":
      return clampState({ ...state, mode: "search", focusPane: "projects", selectedSearchResultIndex: 0 }, browser);
    case "exit-search-mode":
      return clampState({ ...state, mode: "browse", focusPane: "projects", selectedSearchResultIndex: 0 }, browser);
    case "append-search-char":
      return clampState(
        {
          ...state,
          mode: "search",
          focusPane: "projects",
          searchQuery: `${state.searchQuery}${action.value}`,
          selectedSearchResultIndex: 0,
        },
        browser,
      );
    case "backspace-search":
      return clampState(
        {
          ...state,
          searchQuery: state.searchQuery.slice(0, Math.max(state.searchQuery.length - 1, 0)),
          selectedSearchResultIndex: 0,
        },
        browser,
      );
    case "toggle-source-health":
      return { ...state, showSourceHealth: !state.showSourceHealth };
    case "close-source-health":
      return { ...state, showSourceHealth: false };
    case "toggle-help":
      return { ...state, showHelp: !state.showHelp };
    case "close-help":
      return { ...state, showHelp: false };
  }
}

export function renderBrowserSnapshot(browser: LocalTuiBrowser, state: BrowserState): string {
  const detailRows = state.mode === "search"
    ? formatSearchDetailRows(browser, getSelectedSearchResult(browser, state), state.focusPane === "detail")
    : formatProjectDetailRows(browser, state);

  const sections = state.mode === "search"
    ? [
        renderSection("Search", formatSearchRows(browser, state), state.focusPane === "projects"),
        "",
        renderSection("Results", formatSearchResultRows(browser, state), state.focusPane === "turns"),
        "",
        renderSection("Detail", detailRows, state.focusPane === "detail"),
      ]
    : [
        renderSection("Projects", formatProjectRows(browser, state), state.focusPane === "projects"),
        "",
        renderSection("Turns", formatTurnRows(browser, state), state.focusPane === "turns"),
        "",
        renderSection("Detail", detailRows, state.focusPane === "detail"),
      ];

  return [
    "CCHistory TUI",
    "",
    ...sections,
    "",
    renderStatusLine(browser, state),
    state.showSourceHealth ? ["", renderSourceHealthSection(browser)].join("\n") : "",
    state.showHelp
      ? [
          "",
          renderSection("Help", [
            "Tab/→: next pane",
            "Shift+Tab/←: previous pane",
            "↑/↓ or j/k: move selection",
            "Enter: drill into selected pane",
            "/: search mode",
            "Esc: step back / close overlays / exit search",
            "p/t/d: focus projects, turns, or detail",
            "s: toggle source health summary",
            "?: toggle help",
            "q: quit",
          ], false),
        ].join("\n")
      : "",
  ].join("\n");
}

function clampState(state: BrowserState, browser: LocalTuiBrowser): BrowserState {
  const projectCount = browser.projects.length;
  const selectedProjectIndex = projectCount === 0 ? 0 : clampIndex(state.selectedProjectIndex, projectCount);
  const turnCount = browser.projects[selectedProjectIndex]?.turns.length ?? 0;
  const searchResultCount = browser.search(state.searchQuery).length;

  return {
    ...state,
    selectedProjectIndex,
    selectedTurnIndex: turnCount === 0 ? 0 : clampIndex(state.selectedTurnIndex, turnCount),
    selectedSearchResultIndex: searchResultCount === 0 ? 0 : clampIndex(state.selectedSearchResultIndex, searchResultCount),
  };
}

function clampIndex(value: number, length: number): number {
  return Math.max(0, Math.min(value, Math.max(length - 1, 0)));
}

function getSelectedTurns(browser: LocalTuiBrowser, state: BrowserState) {
  return browser.projects[state.selectedProjectIndex]?.turns ?? [];
}

function getSelectedTurn(browser: LocalTuiBrowser, state: BrowserState) {
  return getSelectedTurns(browser, state)[state.selectedTurnIndex];
}

function getSearchResults(browser: LocalTuiBrowser, state: BrowserState): LocalTuiSearchResult[] {
  return browser.search(state.searchQuery)
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => compareSearchResults(left.entry, right.entry) || left.index - right.index)
    .map(({ entry }) => entry);
}

function getSelectedSearchResult(browser: LocalTuiBrowser, state: BrowserState): LocalTuiSearchResult | undefined {
  return getSearchResults(browser, state)[state.selectedSearchResultIndex];
}

function renderSection(title: string, rows: string[], focused: boolean): string {
  const titleSuffix = focused ? " [active]:" : ":";
  return [`${title}${titleSuffix}`, ...rows.map((row) => `  ${row}`)].join("\n");
}

function formatProjectRows(browser: LocalTuiBrowser, state: BrowserState): string[] {
  return browser.projects.length > 0
    ? browser.projects.map((entry, index) => formatProjectRow(entry.project, state.selectedProjectIndex === index, state.focusPane === "projects"))
    : [emptyRow("No committed projects yet")];
}

function formatTurnRows(browser: LocalTuiBrowser, state: BrowserState): string[] {
  const turns = getSelectedTurns(browser, state);
  return turns.length > 0
    ? turns.map((entry, index) => formatTurnRow(entry, state.selectedTurnIndex === index, state.focusPane === "turns"))
    : [emptyRow("No turns in selected project")];
}

function formatProjectRow(
  project: LocalTuiBrowser["projects"][number]["project"],
  selected: boolean,
  focused: boolean,
): string {
  return `${selectionPrefix(selected, focused)} ${project.display_name} · ${project.committed_turn_count} committed · ${project.session_count} sessions`;
}

function formatTurnRow(
  entry: LocalTuiBrowser["projects"][number]["turns"][number],
  selected: boolean,
  focused: boolean,
): string {
  const relatedLabel = summarizeRelatedWork(entry.related_work);
  return `${selectionPrefix(selected, focused)} ${compactBrowseSnippet(entry.turn.canonical_text || "(empty)", 56)} · ${entry.turn.context_summary.assistant_reply_count} replies · ${entry.turn.context_summary.tool_call_count} tools · ${relatedLabel}`;
}

function formatProjectDetailRows(browser: LocalTuiBrowser, state: BrowserState): string[] {
  const projectEntry = browser.projects[state.selectedProjectIndex];
  const selectedTurn = getSelectedTurn(browser, state);
  return formatDetailRows(browser, {
    projectName: projectEntry?.project.display_name,
    workingDirectory: selectedTurn?.session?.working_directory ?? projectEntry?.project.primary_workspace_path,
    selectedTurn,
    focusDetail: state.focusPane === "detail",
  });
}

function formatSearchRows(browser: LocalTuiBrowser, state: BrowserState): string[] {
  const searchResults = getSearchResults(browser, state);
  return [
    `${selectionPrefix(true, state.focusPane === "projects")} Query: ${state.searchQuery || "(type to search)"}`,
    `  Results: ${searchResults.length} match(es) · Search mode ${browser.overview.search_mode}`,
  ];
}

function formatSearchResultRows(browser: LocalTuiBrowser, state: BrowserState): string[] {
  const searchResults = getSearchResults(browser, state);
  return searchResults.length > 0
    ? searchResults.map((entry, index) => {
        const projectName = searchResultProjectListLabel(entry);
        const sessionRef = entry.session?.id ?? entry.turn.session_id;
        const sourceLabel = formatSourceLabel(browser, entry.session, entry.turn.source_id);
        return `${selectionPrefix(state.selectedSearchResultIndex === index, state.focusPane === "turns")} ${compactBrowseSnippet(entry.turn.canonical_text || "(empty)", 44)} · ${projectName} · ${sourceLabel} · ${sessionRef} · ${summarizeRelatedWork(entry.related_work)}`;
      })
    : [emptyRow(state.searchQuery ? "No search results" : "Type a query to search all turns")];
}

function formatSearchDetailRows(browser: LocalTuiBrowser, selectedResult: LocalTuiSearchResult | undefined, focused: boolean): string[] {
  return formatDetailRows(browser, {
    projectName: selectedResult ? searchResultProjectDetailLabel(selectedResult) : undefined,
    workingDirectory: selectedResult?.session?.working_directory,
    selectedTurn: selectedResult,
    focusDetail: focused,
  });
}

function formatDetailRows(browser: LocalTuiBrowser, input: {
  projectName?: string;
  workingDirectory?: string;
  selectedTurn?: {
    turn: { id: string; session_id: string; source_id: string; canonical_text: string };
    session?: { source_id?: string; source_platform?: string; working_directory?: string };
    context?: { assistant_replies: { content_preview?: string; content?: string }[]; tool_calls: { input_summary?: string; tool_name?: string }[]; system_messages: unknown[] };
    related_work?: Array<{ relation_kind: string; target_kind: string; transcript_primary: boolean; automation_job_ref?: string; target_session_ref?: string }>;
  };
  focusDetail: boolean;
}): string[] {
  const prefix = selectionPrefix(Boolean(input.selectedTurn), input.focusDetail);

  if (!input.selectedTurn) {
    if (!input.projectName) {
      return ["No project selected."];
    }

    return [
      `${prefix} Project: ${input.projectName}`,
      "  No turn selected.",
    ];
  }

  const session = input.selectedTurn.session;
  const context = input.selectedTurn.context;
  const assistantPreview = context?.assistant_replies[0]?.content_preview ?? context?.assistant_replies[0]?.content ?? "(none)";
  const toolPreview = context?.tool_calls[0]?.input_summary ?? context?.tool_calls[0]?.tool_name ?? "(none)";
  const relatedWork = input.selectedTurn.related_work ?? [];
  const childSessionCount = relatedWork.filter((entry) => entry.relation_kind === "delegated_session").length;
  const automationRunCount = relatedWork.filter((entry) => entry.relation_kind === "automation_run").length;
  const relatedTrailRows = formatRelatedWorkTrailRows(relatedWork);

  return [
    `${prefix} Project: ${input.projectName ?? "(unlinked)"}`,
    `  Breadcrumbs: ${formatBreadcrumbs(input.projectName, input.selectedTurn.turn.session_id, input.selectedTurn.turn.id)}`,
    `  Turn: ${input.selectedTurn.turn.id}`,
    `  Source: ${formatSourceLabel(browser, session, input.selectedTurn.turn.source_id)}`,
    `  Session: ${input.selectedTurn.turn.session_id}`,
    `  Workspace: ${session?.working_directory ?? input.workingDirectory ?? "(unknown)"}`,
    `  Prompt: ${compactBrowseSnippet(input.selectedTurn.turn.canonical_text || "(empty)", 160)}`,
    `  Assistant: ${compact(assistantPreview, 120)}`,
    `  Tool: ${compact(toolPreview, 120)}`,
    `  Related Work: ${childSessionCount} child sessions, ${automationRunCount} automation runs`,
    ...relatedTrailRows,
    `  Context counts: ${context?.assistant_replies.length ?? 0} replies, ${context?.tool_calls.length ?? 0} tools, ${context?.system_messages.length ?? 0} system`,
  ];
}

function renderSourceHealthSection(browser: LocalTuiBrowser): string {
  const { counts, sources } = browser.sourceHealth;
  const rows = [
    `Healthy=${counts.healthy} · Stale=${counts.stale} · Error=${counts.error}`,
    ...sources.map((source) => `- ${source.display_name} (${source.platform}) · ${source.sync_status} · ${source.total_sessions} sessions · ${source.total_turns} turns · last sync ${source.last_sync ?? "never"}`),
  ];
  return renderSection("Source Health", rows, false);
}

function renderStatusLine(browser: LocalTuiBrowser, state: BrowserState): string {
  const overview = browser.overview;
  const selectedSearchResult = state.mode === "search" ? getSelectedSearchResult(browser, state) : undefined;
  const project = state.mode === "search"
    ? selectedSearchResult?.project?.linkage_state === "committed"
      ? selectedSearchResult.project
      : undefined
    : browser.projects[state.selectedProjectIndex]?.project;
  const selectedTurn = state.mode === "search" ? selectedSearchResult?.turn : getSelectedTurn(browser, state)?.turn;
  return [
    `Mode=${state.mode}`,
    `Read=${overview.read_mode === "full" ? "live-full" : "indexed-only"}`,
    `Focus=${state.focusPane}`,
    `Projects=${overview.counts.projects}`,
    `Turns=${overview.counts.turns}`,
    `Sources=${overview.counts.sources}`,
    `Search=${overview.search_mode}`,
    `SelectedProject=${project?.slug || project?.project_id || "none"}`,
    `SelectedTurn=${selectedTurn?.id ?? "none"}`,
    `SourceHealth=${state.showSourceHealth ? "open" : "closed"}`,
  ].join(" | ");
}

function compareSearchResults(left: LocalTuiSearchResult, right: LocalTuiSearchResult): number {
  const leftRank = searchResultProjectRank(left);
  const rightRank = searchResultProjectRank(right);
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  const labelCompare = searchResultProjectListLabel(left).localeCompare(searchResultProjectListLabel(right));
  if (labelCompare !== 0) {
    return labelCompare;
  }

  return 0;
}

function searchResultProjectRank(result: LocalTuiSearchResult): number {
  return result.project?.linkage_state === "committed" ? 0 : 1;
}

function searchResultProjectListLabel(result: LocalTuiSearchResult): string {
  return result.project?.linkage_state === "committed" ? result.project.display_name : "Unlinked";
}

function searchResultProjectDetailLabel(result: LocalTuiSearchResult): string | undefined {
  return result.project?.linkage_state === "committed" ? result.project.display_name : undefined;
}

function formatSourceLabel(
  browser: LocalTuiBrowser,
  session: { source_id?: string; source_platform?: string } | undefined,
  fallbackSourceId: string,
): string {
  const sourceId = session?.source_id ?? fallbackSourceId;
  const source = browser.sourceHealth.sources.find((entry) => entry.id === sourceId);
  if (source) {
    return `${source.display_name} (${source.platform})`;
  }
  return session?.source_platform ?? fallbackSourceId;
}

function summarizeRelatedWork(
  relatedWork: Array<{ relation_kind: string }>,
): string {
  const childSessionCount = relatedWork.filter((entry) => entry.relation_kind === "delegated_session").length;
  const automationRunCount = relatedWork.filter((entry) => entry.relation_kind === "automation_run").length;
  if (childSessionCount === 0 && automationRunCount === 0) {
    return "related: none";
  }
  const parts: string[] = [];
  if (childSessionCount > 0) {
    parts.push(`${childSessionCount} child`);
  }
  if (automationRunCount > 0) {
    parts.push(`${automationRunCount} automation`);
  }
  return `related: ${parts.join(", ")}`;
}

function formatBreadcrumbs(projectName: string | undefined, sessionId: string, turnId: string): string {
  return [projectName ?? "(unlinked)", sessionId, turnId].join(" > ");
}

function formatRelatedWorkTrailRows(
  relatedWork: Array<{ relation_kind: string; transcript_primary: boolean; automation_job_ref?: string; target_session_ref?: string }>,
): string[] {
  if (relatedWork.length === 0) {
    return ["  Related Trail: -> (none)"];
  }
  return relatedWork.slice(0, 3).map((entry, index) => {
    const relationLabel = entry.relation_kind === "delegated_session" ? "child session" : "automation run";
    const target = entry.automation_job_ref ?? entry.target_session_ref ?? entry.relation_kind;
    const mode = entry.transcript_primary ? "transcript-primary" : "evidence-only";
    return `  Related Trail ${index + 1}: -> ${relationLabel} ${target} (${mode})`;
  });
}

function selectionPrefix(selected: boolean, focused: boolean): string {
  if (selected && focused) {
    return ">";
  }
  if (selected) {
    return "*";
  }
  return "-";
}

function emptyRow(label: string): string {
  return `- ${label}`;
}

function compactBrowseSnippet(value: string, maxLength: number): string {
  return compact(tameBrowseMarkup(value), maxLength);
}

function tameBrowseMarkup(value: string): string {
  return value
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi, " ")
    .replace(/<command-message>[\s\S]*?<\/command-message>/gi, " ")
    .replace(/<command-args>[\s\S]*?<\/command-args>/gi, " ")
    .replace(/<command-name>([\s\S]*?)<\/command-name>/gi, "$1 ")
    .replace(/<\/?(?:command-name|command-message|command-args)>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: string, maxLength: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(maxLength - 1, 1))}…`;
}
