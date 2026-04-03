# CLI Guide

The CCHistory CLI (`apps/cli`) is the primary local operator tool. By default it reuses the nearest existing `.cchistory/cchistory.sqlite` in the current directory or its ancestors; if none exists, it falls back to `~/.cchistory/cchistory.sqlite`. Use `--store` or `--db` to pin an explicit store location. If you want a repo-local store regardless of where you invoke the CLI, pass `--store ./.cchistory`.

## Global Options

```
Usage: cchistory <command> [options]

Options:
  --store <dir>    Override the default store resolution with <dir>/cchistory.sqlite
  --db <file>      Explicit SQLite file path
  --index          Read from existing store only (default for reads)
  --full           Re-scan sources into a temporary in-memory store
  --store-only     Suppress host discovery and sync preview; focus on the selected store
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
Synced 7 source(s) into /Users/me/.cchistory/cchistory.sqlite

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

> Windows note (2026-03-27): `sync --dry-run` and `discover` only prove that a candidate path is being probed. On Windows, `Cursor` and `Antigravity` have verified default roots; for `Codex`, `Claude Code`, `Factory Droid`, `AMP`, `Gemini CLI`, `OpenClaw`, `OpenCode`, `CodeBuddy`, and `LobeChat`, confirm or override `base_dir` through the web `Sources` view or `/api/admin/source-config` before treating the path as authoritative. Several of these adapters are now `stable`, but their Windows default roots are still not host-verified.

### discover

Inspect host-level source and tool discovery without touching the store.

```bash
cchistory discover                      # Show discovered tool/source paths on this host
cchistory discover --showall            # Include missing default candidates too
```

`discover` is broader than `sync --dry-run`:

- `sync --dry-run` only previews sync-supported source roots.
- `discover` lists sync-supported source roots first, and may also show discovery-only auxiliary tool artifacts when a platform exposes them.

**Example output:**

```text
Discovered 3 item(s) on this host

Name        Kind    Capability     Platform  Path Type             Path                                  Exists  Selected
----------  ------  -------------  --------  --------------------  ------------------------------------  ------  --------
OpenClaw    source  sync           openclaw  default (default 1)   /Users/me/.openclaw/agents           yes     yes
OpenCode    source  sync           opencode  default (default 1)   /Users/me/.local/share/opencode/...  yes     yes
Gemini CLI  source  sync           gemini    default (default 1)   /Users/me/.gemini                    yes     yes
```

### health

Read-only operator overview that combines host discovery, sync preview, and
store summary into one command.

```bash
cchistory health                                 # Discovery + sync preview + indexed summary
cchistory health --source codex                  # Scope to one source
cchistory health --full                          # One live read-only scan instead of the indexed store
cchistory health --store ./.cchistory --full     # Use a pinned local store path
cchistory health --store ./.cchistory --store-only  # Inspect only the selected indexed store
```

Behavior notes:

- `health` defaults to `--index`, so it reads an existing store without mutating it.
- If no indexed store exists, `health` reports that explicitly instead of silently creating one.
- `health --full` performs one live in-memory scan and does not create `cchistory.sqlite`.
- `health --store-only` suppresses ambient host discovery and sync preview when you want store-scoped review of a seeded, restored, or pinned indexed store.

### ls

Browse projects, sessions, and sources.

```bash
cchistory ls projects                   # List projects (hides empty by default)
cchistory ls projects --long            # Add source-mix and related-work summaries
cchistory ls sessions                   # List all sessions with title/workspace hints
cchistory ls sessions --long            # Add platform, turn-count, and related-work columns
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

Full-text search across all turns. Queries now support partial multi-token
matching, so you do not need to type one exact phrase. The text output prints a
turn ID prefix that you can pass directly to `cchistory show turn <shown-id>`,
and it also prints session / project / `tree session --long` pivots so you can
expand one hit into nearby context without leaving the turn-first search model.

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
DB                  : /Users/me/.cchistory/cchistory.sqlite
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

Hierarchical view of the project-session-turn structure. Add `--long` when you want `ls -l`-style metadata expansion instead of the default compact tree.

```bash
cchistory tree projects                             # All projects
cchistory tree project chat-ui-kit                  # One project with turns
cchistory tree project chat-ui-kit --long           # Add session metadata and related-work counts
cchistory tree session <session-ref>                # Compact hierarchy for one session
cchistory tree session <session-ref> --long         # Richer nearby-turn + related-work context
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

**Recall output contract:**

- `query` is the machine-readable path and always prints structured JSON so operators can script project / session / turn retrieval without extra flags.
- `search` and `show` are operator-readable by default so manual drill-down stays compact in the terminal.
- Add `--json` to `search` or `show` when you want one structured pipeline from discovery through drill-down.
- A practical pattern is: use `search` for manual discovery, `show` for human-readable inspection, and `query` when you need stable structured payloads.

```bash
cchistory show project chat-ui-kit          # Project details + usage + recent turns
cchistory show session <ref>                # Session details with turns
cchistory show turn <turn-id-or-prefix>     # Full turn with prompt, context, lineage
cchistory show source codex                 # Source details + resolved sessions
```

For `show session <ref>`, `<ref>` may be a full session ID, a unique session ID
prefix, a unique session title, or a unique workspace path / workspace basename.
When you want a hierarchy-first continuation with denser nearby-turn and
related-work context, prefer `cchistory tree session <session-ref> --long`.
If multiple sessions match the same human-friendly reference, the CLI fails
explicitly instead of guessing.

### export

Export the store to a portable bundle.

```bash
cchistory export --out ./my-backup                              # Export everything
cchistory export --out ./my-backup --dry-run                    # Preview bundle contents first
cchistory export --out ./my-backup --source codex               # Specific source
cchistory export --out ./my-backup --source codex --no-raw      # Without raw blobs
```

| Flag | Description |
|------|-------------|
| `--out <dir>` | Output bundle directory (required) |
| `--source <id>` | Limit to sources (repeatable) |
| `--no-raw` | Omit raw blobs from bundle |
| `--dry-run` | Preview bundle counts and selected sources without writing files |

### backup

Preview-first portable backup shortcut built on the canonical export-bundle
workflow.

```bash
cchistory backup --out ./my-backup                            # Preview the backup plan (default)
cchistory backup --out ./my-backup --write                    # Write the bundle after preview/confirmation
cchistory backup --out ./my-backup --source codex --write     # Scope to one source
cchistory backup --out ./my-backup --source codex --no-raw --write
```

| Flag | Description |
|------|-------------|
| `--out <dir>` | Output bundle directory (required) |
| `--source <id>` | Limit to sources (repeatable) |
| `--no-raw` | Omit raw blobs from the written bundle |
| `--write` | Execute the write step; without this flag `backup` stays preview-only |
| `--dry-run` | Explicit preview alias; `backup` already previews by default |

Behavior notes:

- `backup` is an operator shortcut; `export` remains the canonical primitive.
- `backup --out <dir>` shows the same plan as `export --dry-run`.
- `backup --write` produces the same bundle as `export` with the same scope flags.

### import

Import a bundle into the current store.

```bash
cchistory import ./my-backup                                    # Import bundle
cchistory import ./my-backup --dry-run                          # Preview source actions first
cchistory import ./my-backup --on-conflict skip                 # Skip conflicts
cchistory import ./my-backup --on-conflict replace              # Overwrite conflicts
```

| Flag | Description |
|------|-------------|
| `--on-conflict <mode>` | Behavior on conflict: `error` (default), `skip`, `replace` |
| `--dry-run` | Validate the bundle and preview source-level actions without writing |

### restore-check

Read-only post-restore verification shortcut built on the canonical indexed
`stats` and `ls sources` views.

```bash
cchistory restore-check --store ./restored-store                # Verify a restored store directory
cchistory restore-check --db ./restored-store/cchistory.sqlite  # Verify via explicit sqlite path
```

| Flag | Description |
|------|-------------|
| `--store <dir>` | Restored store directory to inspect (required unless `--db` is used) |
| `--db <file>` | Explicit restored sqlite file to inspect |
| `--showall` | Include zero-token turns in the embedded stats overview |

Behavior notes:

- `restore-check` is verification-only; it never imports or mutates a store.
- `restore-check` requires an explicit `--store` or `--db` target.
- `restore-check` stays indexed-only and does not support `--full`.

### Backup and restore

For self-host operations, the canonical portable backup unit is an export bundle.

```bash
# Preview the backup first
cchistory backup --store ./.cchistory --out ./backup-2026-03-20

# Write the full store backup, including raw blobs
cchistory backup --store ./.cchistory --out ./backup-2026-03-20 --write

# Restore into a clean store directory
cchistory import ./backup-2026-03-20 --store ./restored-store

# Verify the restored store
cchistory restore-check --store ./restored-store
```

Backup notes:

- The bundle always includes `manifest.json`, `checksums.json`, and canonical payloads.
- Raw evidence snapshots are included by default; use `--no-raw` only when you explicitly want a lighter export.
- Restore should target an empty or new store directory for the clearest verification path.

### Upgrade safety

Before upgrading CCHistory on a self-hosted machine:

```bash
# 1. Preview then create a portable pre-upgrade backup
cchistory backup --store ./.cchistory --out ./pre-upgrade-backup
cchistory backup --store ./.cchistory --out ./pre-upgrade-backup --write

# 2. Upgrade CCHistory and open the store normally
cchistory stats --store ./.cchistory
```

Upgrade notes:

- `cchistory stats` now shows the current `Schema Version`, `Schema Migrations`, and `Search Mode`.
- Stores created before schema-ledger support will backfill migration records on first open under the newer build.
- If the upgraded store does not look correct, restore into a clean directory from the pre-upgrade bundle and compare with `restore-check` plus a targeted `search`.

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

`query` is intentionally different from `search` and `show`: it is the canonical machine-readable recall surface and always emits JSON, even without `--json`.

```bash
cchistory query turns --search "refactor" --limit 5
cchistory query turn --id <turn-id-or-prefix>
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

### agent

Remote-agent workflows reuse the same canonical source probe + bundle import path, but run from a paired host instead of the local operator machine.

```bash
cchistory agent pair --server https://history.example --pair-token <token>
cchistory agent upload --state-file ~/.cchistory-agent/agent-state.json --source codex
cchistory agent schedule --state-file ~/.cchistory-agent/agent-state.json --interval-seconds 900 --iterations 4
cchistory agent pull --state-file ~/.cchistory-agent/agent-state.json
```

Behavior notes:

- `agent pair` exchanges a server-side pairing token for a persisted local agent identity and credentials.
- `agent upload` runs one dirty-source collection cycle and uploads only changed source payloads unless `--force` is set.
- `agent schedule` repeats the same upload cycle locally on a caller-provided interval; it does not create server-side jobs.
- `agent pull` asks the server for one leased typed collection job, runs that collection scope locally, uploads through the same bundle path, and reports completion or failure.
- `--retry-attempts` and `--retry-delay-ms` apply to upload/pull network retries; `--no-raw` keeps remote bundles lighter by omitting raw blobs.

Validation note:

- The current remote-agent validation contract lives in `docs/design/R29_REMOTE_AGENT_VALIDATION_CONTRACT.md`.
- Package-scoped CLI/API tests already prove the mocked pair/upload/schedule/pull logic.
- Server-backed remote-agent validation still requires a user-started API service and should be recorded as a manual operator review rather than treated as an agent-started runtime path.
- That contract is not the completed diary: the actual recorded pair/upload/schedule and leased-pull server-backed reviews remain blocked manual work under `R35` until a user starts the API service and performs them.

### templates

List source format profiles (always JSON).

```bash
cchistory templates
```
