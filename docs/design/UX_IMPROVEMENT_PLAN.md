# UX Improvement Plan

> Status: Draft — 2026-04-05
> Scope: CLI, TUI, positioning clarity

---

## 1. Role Positioning (产品定位)

Current problem: CLI / TUI / WebUI 三个入口的用户画像模糊，CLI 上有大量终端用户不需要的管理命令，TUI 功能缺失，两者定位交叉。

### Proposed positioning

| Surface | Target user | Core purpose | Design metaphor |
|---------|-------------|--------------|-----------------|
| **CLI** | Admin / AI agent / script | Sync, import/export/backup, health check, GC, remote agent ops, scriptable query | `kubectl` / `git` — power commands, `--json` output |
| **TUI** | Developer end-user | Browse, search, drill-down into conversations, view stats | File manager / Midnight Commander — everything keyboard-navigable |
| **WebUI** | Developer end-user | Same as TUI but richer: charts, filters, inbox triage | Dashboard — visual, mouse-first |

**Key principle**: The TUI should be a complete read-side experience. If a user can see it in WebUI, they should be able to see it in TUI (within terminal constraints). The CLI should be the admin/write-side tool.

---

## 2. CLI Issues & Improvements

### 2.1 Help text is a flat wall of commands

**Current state**: `cchistory` with no args dumps 30+ usage lines in a flat list. No grouping, no hierarchy, no visual separation between "sync your data" and "export a backup bundle".

**Proposed**: Group commands into categories with clear headers:

```
CCHistory — AI coding history browser

Browse & Inspect:
  ls projects|sessions|sources    List entities
  tree projects|project|session   Hierarchical view
  show project|session|turn       Detail view of an entity
  search <query>                  Full-text search across turns
  stats [usage --by <dim>]        Token usage statistics

Data Management:
  sync                            Ingest from local AI tool data
  discover                        Scan host for supported tools
  health                          Source health and store integrity

Backup & Transfer:
  export --out <dir>              Export store to portable bundle
  import <bundle-dir>             Import a bundle
  backup --out <dir>              Preview-first export workflow
  merge --from <db> --to <db>     Merge stores via bundle path
  gc                              Clean orphaned raw snapshots

Interactive:
  tui                             Launch terminal UI browser

Advanced (experimental):
  agent pair|upload|schedule|pull  Remote agent synchronization
  query <entity>                  Scriptable JSON-only interface

Global flags: --store, --db, --json, --long, --dry-run, --showall
```

### 2.2 Search snippet shows system prompt, not user intent

**Status**: ✅ Fixed (2026-04-05). `pickSearchSnippet()` now extracts user request from `## My request` section when present.

### 2.3 Search metadata too verbose

**Status**: ✅ Fixed (2026-04-05). Context line condensed to `Codex · gpt-5.4 · cchistory`. Pivots hidden by default, shown with `--long`.

### 2.4 ISO timestamps hard to scan

**Status**: ✅ Fixed (2026-04-05). `formatCompactDate()` renders `Mar 20 23:32` format.

### 2.5 `ls sessions` is unreadable

**Current state**: Table columns are too wide — full session UUID, full workspace path, full source instance ID. On a standard terminal the table wraps horribly.

**Proposed**:
- Default to compact mode: short session ID, truncated title, project name (not ID), source name (not instance ID), relative time
- `--long` for full IDs and paths
- Example compact row:
  ```
  019d5c44  /review this whole project…   cchistory   Codex   gpt-5.4   2h ago
  ```

### 2.6 `show turn` dumps entire system prompt

**Current state**: `show turn <id>` prints the full `canonical_text` which for code review turns is the entire review guidelines template (50+ lines of boilerplate).

**Proposed**:
- Apply same `pickSearchSnippet()` logic: extract meaningful content
- Show user messages and assistant replies separately with headers
- Truncate long content with `... (N more chars, use --full for complete text)`

### 2.7 No color in `ls` / `tree` / `stats` output

**Current state**: Tables use `---` separators but no color highlighting for headers, status badges, or emphasis.

**Proposed**:
- Bold headers in tables
- Color-coded status: green=healthy, yellow=stale, red=error
- Dim less important columns (IDs, hosts)

---

## 3. TUI Issues & Improvements

### 3.1 Core problem: TUI is a view-only 3-pane browser, not a productivity tool

The TUI has the right architecture (Projects → Turns → Detail) but stops short of being useful:

- **No conversation expansion**: Detail pane shows 1 assistant reply and 1 tool call. Users want to read the full conversation like they would in WebUI.
- **No stats view**: CLI has `stats usage --by model|day|project` but TUI has nothing.
- **Search is half-baked**: Works for finding turns, but can't search within a conversation.
- **No session-level navigation**: Users jump between projects and turns, but can't see session grouping (which turns belong to the same session).

### 3.2 Proposed TUI feature roadmap

#### P0 — Must have (blocks usability)

**3.2.1 Conversation drill-down (Detail → Conversation view)**

When pressing `Enter` on a turn in the detail pane, expand into a scrollable conversation view showing:
```
┌─ Conversation: sess:codex:019d5c44 ─────────────────────┐
│                                                          │
│  👤 User                                    Apr 3 23:45  │
│  /review this whole project                              │
│                                                          │
│  🤖 Assistant (gpt-5.4)           tokens: 8.9M in/26K out │
│  I'll review the project structure first, then examine   │
│  each module for potential issues...                     │
│                                                          │
│  🔧 Tool: read_file (src/main.ts)                        │
│  → 245 lines read                                        │
│                                                          │
│  🤖 Assistant                                            │
│  ## Finding 1 (packages/source-adapters/src/probe.ts)    │
│  [P1] The probe timeout is hardcoded to 5s which may...  │
│                                                          │
│  ↓ 3 more messages below                                 │
└──────────────────────────────────────────────────────────┘
```

This is the single most important missing feature. The TUI currently shows a brief preview; users need to read the actual conversation.

**Implementation**: Add a new focus pane `"conversation"` that activates on Enter from detail. Use viewport windowing (already proven with project/turn lists). Data source: `storage.getTurnContext()` which already returns `assistant_replies` and `tool_calls`.

**3.2.2 Session grouping in Turns pane**

Currently turns are listed flat. Group them by session with visual separators:
```
  ▸ Session: /review this whole project (2 turns)
    · 23:59  # Review findings: ## Finding 1...  1 reply
    · 23:45  ## Code review guidelines...        1 reply
  ▸ Session: /fix the search output (3 turns)
    · 22:10  Can you also add color...           2 replies
    · 21:45  The search output is unreadable     1 reply
    · 21:30  cchistory search review             0 replies
```

This maps to the user's mental model: they worked on tasks in sessions, not individual turns.

#### P1 — Should have (significant UX improvement)

**3.2.3 Stats overlay (`i` for info/stats)**

Add a stats overlay (like the existing `s` source-health overlay) showing:
```
┌─ Statistics ──────────────────────────────────────────┐
│  Total: 574 turns · 252 sessions · 32 projects       │
│                                                       │
│  By Model            Turns  Tokens                    │
│  gpt-5.4              264   653M                      │
│  gpt-5.3-codex         79   126M                      │
│  gpt-5.2               47    28M                      │
│  claude-opus-4-6       11     6M                      │
│                                                       │
│  This Week              12 turns · 48M tokens         │
│  This Month             89 turns · 320M tokens        │
└───────────────────────────────────────────────────────┘
```

**3.2.4 In-project search**

When browsing a project, pressing `/` should search within that project's turns only (not global). Global search should be accessible via a different shortcut or from the projects pane.

**3.2.5 Page up/down and Home/End**

Currently only j/k move one item at a time. For 189 turns, this is painful. Add:
- `PgUp` / `PgDn` — move by viewport size (15)
- `g` / `G` — jump to first/last (vim-style)

#### P2 — Nice to have

**3.2.6 Relative timestamps**

Show "2h ago", "yesterday", "Mar 20" instead of ISO timestamps in the turns pane.

**3.2.7 Token usage per turn in turns list**

Add token count to turn list items: `· /review this whole project  11 replies · 8.9M tokens`

**3.2.8 Fuzzy project filter**

Typing in the projects pane should filter projects by name (like fzf), not require entering search mode.

---

## 4. Cross-cutting Improvements

### 4.1 Consistent date formatting

All surfaces (CLI, TUI, WebUI) should use the same human-friendly date format:
- **Recent** (< 24h): "2h ago", "45m ago"
- **This week**: "Mon 23:45"
- **This year**: "Mar 20 23:45"
- **Older**: "2025-12-17"

### 4.2 Consistent snippet strategy

The `pickSearchSnippet()` logic should be shared across CLI search, TUI turns list, and any other surface that needs to show a turn preview. Currently the TUI uses `tameBrowseMarkup(canonical_text)` directly.

### 4.3 Token formatting

Large numbers should always use human-readable format: `8.9M` not `8,936,867` (or provide both).

---

## 5. Implementation Priority

| # | Item | Effort | Impact | Surface |
|---|------|--------|--------|---------|
| 1 | CLI help grouping | S | High | CLI |
| 2 | TUI conversation drill-down | L | Critical | TUI |
| 3 | TUI session grouping | M | High | TUI |
| 4 | `ls sessions` compact mode | S | Medium | CLI |
| 5 | TUI stats overlay | M | Medium | TUI |
| 6 | TUI PgUp/PgDn/G | S | Medium | TUI |
| 7 | `show turn` smart truncation | S | Medium | CLI |
| 8 | Color in CLI tables | M | Medium | CLI |
| 9 | TUI in-project search | M | Medium | TUI |
| 10 | Relative timestamps | S | Low | All |

S = < 1 day, M = 1-2 days, L = 3-5 days
