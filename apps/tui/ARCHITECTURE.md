# TUI Architecture

> Last updated: 2026-04-06

## Overview

CCHistory TUI is an interactive terminal browser for AI coding conversation history. It presents a three-pane file-manager-style interface: **Projects → Turns → Detail**, with full-screen conversation view, search, stats overlay, and source health monitoring.

**Design metaphor**: A file manager for AI conversation history — not "a CLI with borders."

```
┌─────────────────────────────────────────────────────────────────┐
│ CCHistory TUI                                                   │
│                                                                 │
│  Projects        │  Turns (session-grouped)                     │
│  ▪ cchistory  259│  SessionTitle            3t · Apr 3 17:39    │
│  · app_ctrl   112│  ├─❯ turn snippet...     gpt-5.4 · Apr 3    │
│  · zzexam       5│  ├─· turn snippet...     Apr 3 17:37         │
│                  │  └─· turn snippet...     Apr 3 17:34         │
│                  │                                               │
│                  │  Detail                                       │
│                  │  Turn 1/259 in cchistory · 137efa99           │
│                  │  Model: gpt-5.4 · Codex · Apr 1              │
│                  │  Prompt: ...                                  │
│                  │                                               │
│                  │  / search │ i stats │ s sources │ ? help      │
│                                                                 │
│ projects │ 5P 376T │ ? help                                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Package Boundary

### Module Graph

```
apps/cli ──dynamic import──→ @cchistory/tui (runTui)
                                   │
                                   ├── @cchistory/storage     (data: projects, turns, search, stats)
                                   ├── @cchistory/presentation (text: tameBrowseMarkup, compactText)
                                   ├── ink + react             (interactive rendering framework)
                                   └── node:sqlite             (via storage, requires Node ≥ 22)
```

### What TUI owns vs. shares

| Concern | TUI owns | Shared / Depends on |
|---------|----------|---------------------|
| **State model** | `BrowserState`, `BrowserAction`, `reduceBrowserState`, `clampState` | — |
| **Rendering** | All pane renderers, two-column layout, overlays, conversation view | — |
| **Color system** | `colors.ts` — own zero-dep ANSI module | Mirrors `apps/cli/src/colors.ts` pattern (copy, not shared) |
| **CJK text utilities** | `displayWidth`, `clipLine`, `padLine`, `compactByDisplayWidth`, `wrapText` | — |
| **Data provider** | — | `LocalTuiBrowser` interface from `@cchistory/storage/tui-browser.ts` |
| **Text normalization** | `tameDetailMarkup` (preserves newlines) | `tameBrowseMarkup`, `compactText` from `@cchistory/presentation` |
| **Storage access** | `store.ts` (resolve paths, open DB, optional full-scan) | `CCHistoryStorage` from `@cchistory/storage` |
| **CLI integration** | — | `apps/cli/src/main.ts` dynamically imports `@cchistory/tui` for `cchistory tui` subcommand |
| **Interactive framework** | `app.tsx` (Ink + React, `useInput`, `useState`) | `ink`, `react` |
| **Terminal management** | `index.ts` (alternate screen `1049h`, alternate scroll `1007h`) | — |

### Boundary decisions & trade-offs

1. **Own `colors.ts` vs. shared package**: TUI has its own zero-dep ANSI color module rather than importing from CLI. This avoids cross-package dependency complexity at the cost of code duplication (~60 lines). The API surface is identical.

2. **`tameBrowseMarkup` vs. `tameDetailMarkup`**: Presentation package's `tameBrowseMarkup` collapses all whitespace (including newlines) for single-line snippet display. TUI's `tameDetailMarkup` preserves newlines for multi-line detail/conversation views. Both strip injected XML tags.

3. **Dynamic import in CLI**: `cchistory tui` dynamically imports `@cchistory/tui` to avoid loading React/Ink for non-TUI commands. This keeps CLI startup fast.

4. **Data eager-loading**: `buildLocalTuiBrowser()` loads all projects + turns + contexts into memory at startup. Acceptable for local stores (typically <10K turns); would need pagination for larger datasets.

---

## Source Files

| File | Lines | Responsibility |
|------|-------|---------------|
| `browser.ts` | ~1504 | State model, reducer, all renderers, text utilities |
| `app.tsx` | ~160 | Ink component, keyboard input dispatch, React rendering bridge |
| `index.ts` | ~285 | Entry point, CLI arg parsing, snapshot/interactive mode, alternate screen |
| `store.ts` | ~192 | Storage resolution, DB opening, full-scan support |
| `colors.ts` | ~62 | Zero-dep ANSI color utilities |
| `index.test.ts` | ~1358 | Existing tests (integration-heavy, snapshot-based) |

**`browser.ts` is the monolith** — it contains state management, all rendering logic, layout computation, text formatting, search grouping, and data access helpers. This is the primary target for future decomposition.

---

## State Model

### BrowserState

```typescript
interface BrowserState {
  // Mode
  mode: "browse" | "search";
  focusPane: "projects" | "turns" | "detail" | "conversation";

  // Browse indices
  selectedProjectIndex: number;    // into browser.projects[]
  selectedTurnIndex: number;       // into browser.projects[N].turns[]

  // Search indices
  selectedSearchProjectIndex: number;  // into getSearchGroups() result
  selectedSearchTurnIndex: number;     // display-order index after session grouping

  // Search input
  searchQuery: string;
  searchCommitted: boolean;   // for queries < 4 chars, requires Enter

  // Overlay toggles
  showHelp: boolean;
  showSourceHealth: boolean;
  showStats: boolean;
  showStatsTimeWindow: "all" | "7d" | "30d" | "90d" | "1y";

  // Scroll offsets
  conversationScrollOffset: number;
  detailScrollOffset: number;
}
```

### State transitions

All state transitions go through `reduceBrowserState(browser, state, action) → BrowserState`.

```
                    ┌──────────────┐
                    │   projects   │◄── Esc (from turns)
       Tab/→  ──►  │  (focus)     │──► / enter search
                    └──────┬───────┘
                     Enter │ drill
                           ▼
                    ┌──────────────┐
                    │    turns     │◄── Esc (from detail)
                    │  (focus)     │
                    └──────┬───────┘
                     Enter │ drill
                           ▼
                    ┌──────────────┐
                    │   detail     │◄── Esc (from conversation)
                    │  (focus)     │
                    └──────┬───────┘
                     Enter │ drill
                           ▼
                    ┌──────────────┐
                    │ conversation │  full-screen session view
                    │  (focus)     │
                    └──────────────┘
```

### Known state invariants

These should hold true at all times but are **not all currently enforced**:

| ID | Invariant | Enforced? |
|----|-----------|-----------|
| INV-1 | `selectedProjectIndex` ∈ [0, projects.length) | ✅ via `clampState` |
| INV-2 | `selectedTurnIndex` ∈ [0, projects[N].turns.length) | ✅ via `clampState` |
| INV-3 | `selectedSearchProjectIndex` ∈ [0, searchGroups.length) | ✅ via `clampState` |
| INV-4 | `selectedSearchTurnIndex` ∈ [0, searchGroup.results.length) | ✅ via `clampState` |
| INV-5 | `detailScrollOffset` resets on selection change | ⚠️ missing in `handleJump` |
| INV-6 | `conversationScrollOffset` resets on turn change | ⚠️ only reset on `drill` |
| INV-7 | Search turn pane & detail pane use same index semantics | ✅ fixed 2026-04-06 |
| INV-8 | Overlay flags mutually exclusive | ⚠️ `toggle-help` doesn't clear others |
| INV-9 | `_searchCache` invalidated on mode exit | ✅ in `exit-search-mode` |

### Module-level mutable state

| Variable | Purpose | Lifecycle |
|----------|---------|-----------|
| `_searchCache` | Caches FTS results for incremental filtering | Created on first query, invalidated on backspace past anchor or `exit-search-mode`. Survives across `enter-search-mode` calls. |

---

## Rendering Pipeline

### Layout computation

```
Terminal dimensions (width × height)
  │
  ├── leftColWidth  = clamp(width × 0.28, 24, 60)
  ├── rightColWidth = width - leftColWidth - 3
  ├── contentHeight = height - 4  (title + blank + status + blank)
  ├── turnsViewportSize = floor((contentHeight - 4) / 2)
  ├── detailMaxLines = contentHeight - turnsViewportSize - 4
  └── projectViewportSize = contentHeight - 2
```

**Dynamic detail sizing**: After rendering turns, remaining space is recalculated:
```
actualDetailMax = contentHeight - cappedTurnLines.length - 1
```
This ensures the hint bar always fits regardless of session headers/scroll indicators.

### Render modes

| Mode | Left column | Right column |
|------|-------------|-------------|
| **Browse** | Project list | Turns pane + Detail pane |
| **Search** | Matched projects + counts | Search results (session-grouped) + Detail |
| **Conversation** | — (full-width) | Session turns with user/assistant/tool content |
| **Overlay** | — (full-width) | Stats / Help / Source Health replaces main content |

### Two-column layout

```
renderTwoColumnLayout(leftLines, rightLines, leftWidth, rightWidth)
  → for each row: padLine(clip(left), leftW) + " │ " + padLine(clip(right), rightW)
```

Both sides are clipped to column width (CJK-aware) and padded to fill full width.

### Session grouping (critical path)

Turns are displayed grouped by session with tree connectors:

```
SessionTitle                                    3t · Apr 3
├─❯ turn snippet...                    gpt-5.4 · Apr 3
├─· turn snippet...                              Apr 3
└─· turn snippet...                              Apr 3
```

**Browse mode**: `groupTurnsBySession()` — preserves original array order (already session-sorted by storage), uses original array indices.

**Search mode**: `groupSearchResultsBySession()` — re-sorts by session `created_at` DESC, re-indexes `originalIndex` to match display order. This re-indexing is what `selectedSearchTurnIndex` refers to.

### CJK text handling

- `displayWidth(str)` — counts terminal columns (CJK chars = 2, ASCII = 1)
- `clipLine(line, maxCols)` — truncates ANSI-colored text to fit terminal width
- `padLine(line, targetCols)` — pads to exact width for column alignment
- `compactByDisplayWidth(text, maxCols)` — truncates by display width with "…"
- `wrapText(text, width)` / `wrapParagraph(text, width)` — word-wrap preserving CJK boundaries

---

## Data Flow

### Data provider: `LocalTuiBrowser`

Defined in `@cchistory/storage/tui-browser.ts`. Built once at startup.

```typescript
interface LocalTuiBrowser {
  overview: LocalReadOverview;
  projects: LocalTuiBrowserProject[];   // sorted by turns DESC, activity DESC
  sourceHealth: LocalTuiSourceHealth;
  search(query: string, limit?: number): LocalTuiSearchResult[];
  getUsageOverview(afterDate?: string): UsageStatsOverview;
  getUsageRollup(dimension, afterDate?): UsageStatsRollup;
}
```

- **Projects**: Pre-sorted, empty projects filtered out
- **Turns within projects**: Grouped by session (created_at DESC), chronological within session
- **Search**: FTS5-based, returns up to 500 results with relevance scoring
- **Stats**: On-demand computation with optional time-window filtering

### Search pipeline

```
User types query
  → append-search-char action
  → if query.length >= 4: auto-commit; else: show "Press Enter to search"
  → getCachedOrFreshResults():
      if extends cached anchor: filter locally (text.includes)
      else: full FTS via browser.search(), cache as new anchor
  → getSearchGroupsFromQuery(): group by project, sort by count DESC
  → groupSearchResultsBySession(): within each project group,
      group by session, sort sessions by created_at DESC, re-index
  → Display in turns pane + detail pane
```

---

## Keyboard Handling

Handled in `app.tsx` via Ink's `useInput` hook.

### Input processing order

1. **Ctrl+C** → exit
2. **Escape** → close overlays → retreat focus → exit search
3. **Search mode + projects pane**: backspace, Enter (commit), printable chars → search actions
4. **Shortcut keys** (not in search edit): q, ?, /, s, i, p, t, d
5. **Tab/arrows**: focus navigation
6. **j/k/PgUp/PgDn/g/G**: movement
7. **Enter**: drill

### Known issue: stale closure

`useInput` callback checks `state` (render-time snapshot) for mode/overlay flags, but `setState(current => ...)` uses latest state. Fast input sequences could cause the wrong branch to execute.

---

## Dual Operation Modes

### Interactive mode

- Enters alternate screen (`\x1b[?1049h`) and alternate scroll mode (`\x1b[?1007h`)
- Ink renders React component tree, `useMemo` computes snapshot string per frame
- Snapshot split into lines, each rendered as `<Text>` element
- Signal handlers ensure alternate screen cleanup on SIGINT/SIGTERM

### Non-interactive (snapshot) mode

- Renders a single frame to stdout
- Supports `--search`, `--source-health` flags
- Used by tests and `cchistory tui --search <query>` scripting

Both modes use the same `renderBrowserSnapshot()` function — identical output.

---

## Design Decisions History

### Why own color module (not shared)
Avoids cross-package build dependency. TUI's `colors.ts` is ~60 lines; sharing would require a separate `@cchistory/colors` package or adding TUI as a CLI dependency.

### Why session grouping re-indexes `originalIndex`
Search results from FTS come in relevance order. Display groups them by session with time-based sort. The re-indexing maps `selectedSearchTurnIndex` (a sequential 0,1,2... counter) to the display-order position. Without this, arrow keys would jump between non-adjacent visual rows.

### Why alternate scroll mode (`1007h`) instead of mouse tracking
Mouse tracking (`1000h`/`1002h`) captures all mouse events and breaks native terminal text selection/copy. Alternate scroll mode converts scroll-wheel into arrow key sequences only inside alternate screen, preserving text selection.

### Why dynamic detail pane sizing
Fixed split between turns and detail panes wastes space when one pane has few items. Dynamic sizing (`actualDetailMax = contentHeight - cappedTurnLines.length - 1`) ensures the hint bar always fits and space is used efficiently.

### Why search debounce at 4 chars
Short queries (1-3 chars) match too many results, making FTS expensive. Requiring Enter for short queries avoids expensive searches on every keystroke while still allowing instant results for longer, more specific queries.

### Why eager data loading
`buildLocalTuiBrowser()` loads everything into memory. For typical local stores (<10K turns), this is fast and simplifies the rendering code (no async data fetching during render). Trade-off: higher memory usage, slower startup for very large stores.
