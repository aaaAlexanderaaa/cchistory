# CLI Guide

The CCHistory CLI (`apps/cli`) is the primary local operator tool. It reads from and writes to a local SQLite store at `.cchistory/cchistory.sqlite`.

## Global Options

```
Usage: cchistory <command> [options]

Options:
  --store <dir>    Store directory (DB at <dir>/cchistory.sqlite)
  --db <file>      Explicit SQLite file path
  --index          Read from existing store only (default for reads)
  --full           Re-scan sources into a temporary in-memory store
  --json           Machine-readable JSON output
  --showall        Include empty projects in listings
```

## Commands

### sync

Ingest local source files into the store.

```bash
cchistory sync                          # Sync all default sources
cchistory sync --source codex           # Sync only Codex
cchistory sync --source antigravity     # Sync only Antigravity
cchistory sync --limit-files 10         # Limit files per source (for testing)
```

> Antigravity: full-fidelity sync requires the Antigravity desktop app to be running on the same machine. CCHistory prefers the local trajectory API for raw `USER_INPUT` turns. When the app is unavailable, it can still ingest offline `workspaceStorage`, `History`, and `brain` evidence, but that is not a reliable source of raw conversations.

**Example output:**

```
Synced 7 source(s) into /workspace/.cchistory/cchistory.sqlite

Source           Host          Sessions  Turns  Status
---------------  ------------  --------  -----  -------
Codex (codex)    host-e336320  4         4      healthy
Claude Code      host-e336320  4         4      healthy
Cursor (cursor)  host-e336320  2         1      healthy
...
```

| Flag | Description |
|------|-------------|
| `--source <slot>` | Source slot or ID (repeatable). If omitted, syncs all default sources |
| `--limit-files <n>` | Max files per source |

### ls

Browse projects, sessions, and sources.

```bash
cchistory ls projects                   # List projects (hides empty by default)
cchistory ls sessions                   # List all sessions
cchistory ls sources                    # List configured sources
cchistory ls projects --showall         # Include empty projects
```

**Example output:**

```
Name                   Status     Hosts  Sessions  Turns  Last Activity
---------------------  ---------  -----  --------  -----  ------------------------
chat-ui-kit            tentative  1      3         3      2026-03-13T09:11:15.457Z
history-lab            tentative  1      2         2      2026-03-16T16:42:12.467Z
shared-product-lab     tentative  1      1         1      2026-03-16T16:41:50.982Z
...
```

### search

Full-text search across all turns.

```bash
cchistory search "data security"                        # Global search
cchistory search "refactor" --project chat-ui-kit       # Scoped to project
cchistory search "docker" --source codex --limit 5      # Scoped to source
```

| Flag | Description |
|------|-------------|
| `--project <id>` | Filter by project |
| `--source <id>` | Filter by source (repeatable) |
| `--limit <n>` | Max results (default: 20) |

### stats

Overview and usage analytics.

```bash
cchistory stats                                 # Overview
cchistory stats usage --by model                # Token usage by model
cchistory stats usage --by project              # Token usage by project
cchistory stats usage --by day                  # Daily usage with bar chart
cchistory stats usage --by month                # Monthly usage
```

**Example output:**

```
DB                  : .cchistory/cchistory.sqlite
Sources             : 7
Projects            : 5
Sessions            : 13
Turns               : 11
Turns With Tokens   : 8/8
Coverage            : 100.0%
Input Tokens        : 79,536
Output Tokens       : 5,117
Total Tokens        : 461,890
```

| Flag | Description |
|------|-------------|
| `--by <dimension>` | Rollup dimension: `model`, `project`, `source`, `host`, `day`, `month` |
| `--showall` | Include known zero-token turns |

### tree

Hierarchical view of the project-session-turn structure.

```bash
cchistory tree projects                             # All projects
cchistory tree project chat-ui-kit                  # One project with turns
```

**Example output:**

```
chat-ui-kit [tentative] sessions=3 turns=3
  host-e336320f / claude_code: 2 session(s)
  host-e336320f / codex: 1 session(s)
history-lab [tentative] sessions=2 turns=2
  host-e336320f / amp: 1 session(s)
  host-e336320f / factory_droid: 1 session(s)
Unassigned sessions=4
```

### show

Detailed view of a single entity.

```bash
cchistory show project chat-ui-kit          # Project details + usage + recent turns
cchistory show session <session-id>         # Session details with turns
cchistory show turn <turn-id>               # Full turn with prompt, context, lineage
cchistory show source codex                 # Source details + resolved sessions
```

### export

Export the store to a portable bundle.

```bash
cchistory export --out ./my-backup                              # Export everything
cchistory export --out ./my-backup --source codex               # Specific source
cchistory export --out ./my-backup --source codex --no-raw      # Without raw blobs
```

| Flag | Description |
|------|-------------|
| `--out <dir>` | Output bundle directory (required) |
| `--source <id>` | Limit to sources (repeatable) |
| `--no-raw` | Omit raw blobs from bundle |

### import

Import a bundle into the current store.

```bash
cchistory import ./my-backup                                    # Import bundle
cchistory import ./my-backup --on-conflict skip                 # Skip conflicts
cchistory import ./my-backup --on-conflict replace              # Overwrite conflicts
```

| Flag | Description |
|------|-------------|
| `--on-conflict <mode>` | Behavior on conflict: `error` (default), `skip`, `replace` |

### merge

Directly merge between two stores.

```bash
cchistory merge --from /host-a/.cchistory --to /host-b/.cchistory
cchistory merge --from /host-a/.cchistory --to /host-b/.cchistory --source codex
```

| Flag | Description |
|------|-------------|
| `--from <path>` | Source store/DB (required) |
| `--to <path>` | Target store/DB (required) |
| `--source <id>` | Limit to sources (repeatable) |
| `--on-conflict <mode>` | `skip` or `replace` (default: `replace`) |

### query

Structured JSON output for programmatic consumption (always outputs JSON).

```bash
cchistory query turns --search "refactor" --limit 5
cchistory query turn --id <turn-id>
cchistory query sessions --project <project-id>
cchistory query session --id <session-id>
cchistory query projects
cchistory query project --id <project-id> --link-state committed
```

| Flag | Description |
|------|-------------|
| `--id <id>` | Entity ID (for single-entity queries) |
| `--search <query>` | Full-text search (for `turns`) |
| `--project <id>` | Project filter |
| `--source <id>` | Source filter |
| `--limit <n>` | Max items (default: 20) |
| `--link-state <state>` | Filter: `all`, `committed`, `candidate`, `unlinked` |

### templates

List source format profiles (always JSON).

```bash
cchistory templates
```
