# CC History Lite Guide

CC History Lite is the single-machine, zero-store profile of CCHistory. It
reads registered tools' native history through the same adapters and canonical
derivation pipeline as Full, keeps the resulting snapshot only in process
memory, and releases it on exit.

Lite does not read or create `~/.cchistory`, does not accept `--store` or
`--db`, and has no sync, import, merge, backup, restore, GC, migration, API, or
background-service surface. Upstream tools' own SQLite databases remain valid
source data and are opened by their adapters read-only.

## Build And Run

```bash
pnpm --filter @cchistory/lite-cli build
pnpm --filter @cchistory/lite-tui build

# One-shot CLI
pnpm lite -- sources
pnpm lite -- ls projects
pnpm lite -- search "parser regression"

# Process-lifetime terminal browser
pnpm lite:tui
```

The package binaries are:

- `cchistory-lite`
- `cchistory-lite-tui`

To use them from any directory without the `pnpm lite` wrapper, link them
globally (mirrors `cli:link` for the Full CLI):

```bash
pnpm run lite:link      # installs cchistory-lite
pnpm run lite:tui:link  # installs cchistory-lite-tui (needed for `cchistory-lite tui`)
```

Re-run the link commands after rebuilding to pick up changes; remove them with
`npm unlink -g @cchistory/lite-cli` / `npm unlink -g @cchistory/lite-tui`.

## Source Selection

With no source flags, Lite scans registered adapters whose default roots exist
on the current machine. Override one adapter root with a repeatable qualified
value:

```bash
cchistory-lite sources \
  --source-root codex=/mnt/history/.codex/sessions \
  --source-root claude_code=/mnt/history/.claude/projects
```

An override replaces that adapter's default root while other discovered
defaults remain enabled. To scan only selected adapters, add repeatable
`--source` flags:

```bash
cchistory-lite search "migration" \
  --source-root codex=/mnt/history/.codex/sessions \
  --source codex
```

Lite rejects `.cchistory`, `cchistory.sqlite`, and recognizable Full bundle
roots before probing them.

## CLI Commands

```text
sources
ls [projects|sessions|sources]
tree [projects|project <ref>|session <ref>]
search <query> [--project <ref>] [--source <ref>] [--limit <n>]
show project|session|turn|source <ref>
stats [--by source|project|model|day]
export --format jsonl|json|markdown [--out <file>|-]
tui
```

Use `--json` for structured read output. Each one-shot command performs a fresh
canonical scan; use the TUI when you want to amortize one scan across repeated
browse, search, detail, source, and stats operations.

For large Codex and Claude archives, ordinary read commands materialize one
canonical logical session at a time and release full assistant/tool context
after deriving the turn and session projections. Commands that return complete
context (`show session`, `show turn`, JSON/JSONL export) and the TUI retain that
context for the process lifetime and therefore have a larger memory envelope.

## Lite TUI Commands

```text
p / projects                       list projects
s / sessions                       list sessions
u / turns                          list UserTurns
/<query> or search <query>          search canonical turn text and paths
n / next                            next page of the active list, search, or detail
b / prev                            previous page of the active view
page <n>                            jump to a page of the active view
project|session|turn|source <ref>   inspect detail
t / stats                           usage overview
stats source|project|model|day      usage rollup
r / refresh                         replace snapshot after a successful rescan
q / quit                            release the snapshot
```

Refresh is transactional at the process level: if the replacement scan fails,
the previous complete snapshot remains available.

## One-Way Export

Lite export is normalized output, not a backup:

```bash
cchistory-lite export --format jsonl --out history.jsonl
cchistory-lite export --format json --out history.json
cchistory-lite export --format markdown --out history.md
cchistory-lite export --format jsonl --out -
```

JSON and JSONL output carry the schema marker
`cchistory-lite-export/v1`. Lite has no import command, and Full must not treat
this output as a restorable evidence bundle because it does not contain copied
raw parser input.

## Parity Contract

Full and Lite share adapter registration, logical-session assembly,
`UserTurn`/context derivation, built-in masks, fallback project observations,
project linking, read ordering, search matching/ranking, and usage aggregation.
The fixture matrix verifies final sources, projects, sessions, turns, contexts,
search results, and stats against a clean Full materialization.

Two Full persistence-history fields are materializer-specific: an incremented
`project_revision_id` and the database's first-seen `ProjectIdentity.created_at`
can reflect the order in which Full persisted source payloads. Lite derives one
complete ephemeral snapshot, so those lifecycle values can remain at the clean
snapshot revision. Project identity, membership, link state, confidence,
content, ordering, search, and stats must still match; Lite never simplifies a
parser or turn builder to obtain speed.

Run the focused gate with:

```bash
pnpm run verify:lite
```
