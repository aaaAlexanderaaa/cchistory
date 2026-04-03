# TUI Guide

The canonical CCHistory TUI is a local, read-side terminal interface built on `apps/tui`. It is designed for keyboard-first browsing of projects, turns, and detail views, plus global search drill-down and a lightweight source-health summary.

## Launch

Build the TUI entrypoint first:

```bash
pnpm --filter @cchistory/tui build
```

Then run one of the canonical entry commands:

```bash
# Show help
node apps/tui/dist/index.js --help

# Launch against the default local store
node apps/tui/dist/index.js

# Launch against an explicit store directory
node apps/tui/dist/index.js --store /path/to/.cchistory

# Launch against an explicit SQLite file
node apps/tui/dist/index.js --db /path/to/cchistory.sqlite

# Render a non-interactive search drill-down snapshot
node apps/tui/dist/index.js --store /path/to/.cchistory --search "Alpha traceability target"

# Render a non-interactive live snapshot analogous to CLI --full
node apps/tui/dist/index.js --store /path/to/.cchistory --full --source codex --search "Alpha traceability target"

# Combine live snapshot search with source-health output
node apps/tui/dist/index.js --store /path/to/.cchistory --full --source codex --search "Alpha traceability target" --source-health
```

The TUI does not require the managed API service. It opens the same local storage layout used by the CLI and remains read-first: if the resolved SQLite store does not exist yet, it exits with a clear indexed-store error instead of creating an empty database implicitly. By default the TUI reads the indexed store only; non-interactive `--full` is the current bounded exception that performs a live in-memory scan without mutating the indexed store.

## Launch Modes

### Interactive mode

When stdout and stdin are attached to a TTY, the TUI starts the full Ink interface. Interactive `--full` is not supported yet; if requested, the command fails clearly and directs the operator back to non-interactive snapshot mode.

### Non-interactive mode

When launched without an interactive terminal, the same entrypoint prints a textual snapshot instead of opening the full UI. This is useful for quick inspection in scripts, logs, or remote command output. Passing `--search <query>` renders the snapshot in search mode and drills into the first matching result when one exists. Passing `--full` switches that snapshot into a live in-memory scan analogous to CLI `--full`, and the snapshot explicitly labels that read mode so operators can distinguish indexed versus live output.

## Store Resolution

Unless `--store` or `--db` is provided, the TUI follows the same local store resolution rules as the CLI and API:

- reuse the nearest existing `.cchistory/` under the current directory or its ancestors
- otherwise fall back to `~/.cchistory/`

## Layout

The TUI uses three main panes:

- `Projects` — project list in browse mode, or the active search query in search mode
- `Turns` — turns for the selected project, or matching search results in search mode; rows now surface lightweight related-work summaries so delegated child-session activity is easier to spot
- `Detail` — detail for the selected turn or search result, including project/session/turn breadcrumbs, workspace cues, and related-work trail lines when child sessions or automation runs exist

It can also show two overlays:

- `Source Health` — lightweight source count and health summary
- `Help` — keyboard summary

## Keyboard Controls

Core controls:

- `Tab` or `→` — move focus to the next pane
- `Shift+Tab` or `←` — move focus to the previous pane
- `↑` / `↓` or `j` / `k` — move selection within the active list
- `Enter` — drill deeper into the focused pane
- `Esc` — step back, close overlays, or exit search mode
- `q` — quit

Direct focus controls:

- `p` — focus `Projects`
- `t` — focus `Turns`
- `d` — focus `Detail`

Search and overlays:

- `/` — enter search mode
- printable characters — append to the active search query
- `Backspace` / `Delete` — remove the previous search character while editing
- `s` — toggle the source-health summary
- `?` — toggle help

## Search Mode

Search mode keeps the same three-pane shape:

- the left pane becomes the active search query
- the middle pane shows search results, including compact project/session/source and related-work cues
- the right pane shows detail for the selected result, with the same breadcrumb and related-work trail signals used in browse mode

Press `Esc` while the query pane is active to exit search mode and return to browse mode.

## What The TUI Does Not Do

The current canonical TUI is intentionally read-first. It does not introduce a separate admin runtime, does not require the managed API, and does not replace the richer remediation flows still better served by the CLI and web surfaces.
