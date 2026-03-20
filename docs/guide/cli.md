# CLI Guide

The CCHistory CLI (`apps/cli`) is the primary local operator tool. By default it reads from and writes to `./.cchistory/cchistory.sqlite` relative to the current working directory. Use `--store` or `--db` to pin an explicit store location.

## Global Options

```
Usage: cchistory <command> [options]

Options:
  --store <dir>    Store directory (DB at <dir>/cchistory.sqlite)
  --db <file>      Explicit SQLite file path
  --index          Read from existing store only (default for reads)
  --full           Re-scan sources into a temporary in-memory store
  --json           Machine-readable JSON output
  --dry-run        Preview `sync` or `gc` actions without writing
  --showall        Include empty projects in listings and missing discovery candidates
```

## Commands

### sync

Ingest local source files into the store.

```bash
cchistory sync                          # Sync all default sources
cchistory sync --source codex           # Sync only Codex
cchistory sync --source antigravity     # Sync only Antigravity
cchistory sync --limit-files 10         # Limit files per source (for testing)
cchistory sync --dry-run                # Preview discovered sync roots without writing
```

> Antigravity: CCHistory uses two complementary paths. The live trajectory API (requires the desktop app running) provides conversation content. Offline files (`workspaceStorage`, `History`, `brain`) are always scanned for project paths and workspace signals. Without the running app, only offline evidence is collected — no raw conversation content will be recovered.

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
| `--dry-run` | Show which supported sources are currently discoverable and which path each would sync from |

### discover

Inspect host-level source and tool discovery without touching the store.

```bash
cchistory discover                      # Show discovered tool/source paths on this host
cchistory discover --showall            # Include missing default candidates too
```

`discover` is broader than `sync --dry-run`:

- `sync --dry-run` only previews sync-supported source roots.
- `discover` lists both sync-supported sources and discovery-only tools, such as Gemini CLI local state roots.

**Example output:**

```text
Discovered 3 item(s) on this host

Name        Kind    Capability     Platform  Path Type             Path                                  Exists  Selected
----------  ------  -------------  --------  --------------------  ------------------------------------  ------  --------
OpenClaw    source  sync           openclaw  default (default 1)   /Users/me/.openclaw/agents           yes     yes
OpenCode    source  sync           opencode  default (default 1)   /Users/me/.local/share/opencode/...  yes     yes
Gemini CLI  tool    discover-only  gemini    artifact (tmp root)   /Users/me/.gemini/tmp                yes
```

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
Schema Version      : 2026-03-20.1
Schema Migrations   : 2
Search Mode         : fallback
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

### Backup and restore

For self-host operations, the canonical portable backup unit is an export bundle.

```bash
# Backup the full store, including raw blobs
cchistory export --store ./.cchistory --out ./backup-2026-03-20

# Restore into a clean store directory
cchistory import ./backup-2026-03-20 --store ./restored-store

# Verify the restored store
cchistory stats --store ./restored-store
cchistory ls sources --store ./restored-store
```

Backup notes:

- The bundle always includes `manifest.json`, `checksums.json`, and canonical payloads.
- Raw evidence snapshots are included by default; use `--no-raw` only when you explicitly want a lighter export.
- Restore should target an empty or new store directory for the clearest verification path.

### Upgrade safety

Before upgrading CCHistory on a self-hosted machine:

```bash
# 1. Create a portable pre-upgrade backup
cchistory export --store ./.cchistory --out ./pre-upgrade-backup

# 2. Upgrade CCHistory and open the store normally
cchistory stats --store ./.cchistory
```

Upgrade notes:

- `cchistory stats` now shows the current `Schema Version`, `Schema Migrations`, and `Search Mode`.
- Stores created before schema-ledger support will backfill migration records on first open under the newer build.
- If the upgraded store does not look correct, restore into a clean directory from the pre-upgrade bundle and compare with `stats`, `ls sources`, and a targeted `search`.

### gc

Prune raw snapshot files under the store that are no longer referenced by the current SQLite index.

```bash
cchistory gc                                                 # Delete orphan raw snapshots
cchistory gc --dry-run                                       # Preview only
cchistory gc --store /tmp/history-store                      # Explicit store
```

`gc` only removes files under `<store>/raw/` that are not referenced by any current `captured_blobs.captured_path` row. It does not rewrite canonical rows in SQLite.

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
