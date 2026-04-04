---
name: cchistory-cli
description: >
  Operate the CCHistory CLI — discover sources, sync, query projects/turns/sessions,
  export/import/backup bundles, and verify restores. Use when the user wants to
  interact with CCHistory data through the local CLI. Covers all read, preview,
  and mutating workflows with safety-tiered command guidance.
---

# CCHistory CLI

This skill covers the full CCHistory CLI surface. Commands are organized by
safety tier: read-only first, preview-first second, mutating last.

## Transport

Preferred command forms:

- Installed CLI: `cchistory ...`
- Repo checkout fallback: `node apps/cli/dist/index.js ...` (build first with
  `pnpm --filter @cchistory/cli build`)

Always add `--json` for machine-readable output. Read commands should default to
`--index` unless the user explicitly wants `--full` (re-scan from source roots).

Store targeting: `--store <dir>` or `--db <file>`.

## Tier 1 — Read-Only

These commands never mutate the store.

### Source & store inspection

```bash
cchistory discover --json                     # what sources exist on this host
cchistory discover --showall --json            # include missing candidates
cchistory ls sources --index --json            # indexed source inventory
cchistory ls projects --index --json           # project listing
cchistory ls sessions --index --json           # session listing
cchistory stats --index --json                 # store summary counts
cchistory stats usage --by model --index --json  # token usage breakdown (model|project|source|host|day|month)
```

### Project drill-down

```bash
cchistory query projects --index --json                          # project inventory
cchistory query project --id <project-id> --index --json         # one project + linked turns
cchistory query turns --project <id> --limit <n> --index --json  # filtered turn list
cchistory query turns --project <id> --search <q> --index --json # project-scoped search
```

Use `--link-state committed|candidate|unlinked|all` to filter linkage.

### Turn & session drill-down

```bash
cchistory query turn --id <turn-id> --index --json       # one turn + context + lineage
cchistory query session --id <session-ref> --index --json # one session + turns
```

Session refs accept: exact ID, unique ID prefix, exact title, or normalized
workspace path.

### Search

```bash
cchistory search <query> --index --json
cchistory search <query> --project <id> --source <id> --limit <n> --index --json
```

### Tree views (human-readable)

```bash
cchistory tree projects --index --json
cchistory tree project <id-or-slug> --index --json
cchistory tree session <session-ref> --index --json
```

### Post-import verification

```bash
cchistory restore-check --store <dir> --json
cchistory restore-check --db <file> --json
cchistory restore-check --store <dir> --showall --json   # include zero-token turns
```

## Tier 2 — Preview (dry-run)

These commands show what a mutation would do without writing anything.

```bash
cchistory sync --dry-run --json                                    # sync preview
cchistory sync --dry-run --source <slot-or-id> --json              # scoped sync preview
cchistory export --out <dir> --dry-run --json                      # export preview
cchistory export --out <dir> --source <id> --no-raw --dry-run --json
cchistory backup --out <dir> --json                                # backup preview (default is preview)
cchistory backup --out <dir> --source <id> --no-raw --json
cchistory import <bundle-dir> --dry-run --json                     # import preview
cchistory import <bundle-dir> --on-conflict skip --dry-run --json
cchistory gc --dry-run --json                                      # garbage collection preview
```

**Always run the Tier 2 preview before executing the corresponding Tier 3
command.** Show the preview result to the user and get confirmation.

## Tier 3 — Mutating

These commands write to the store or filesystem. Only run after the user has
seen and confirmed the Tier 2 preview.

```bash
cchistory sync --json                               # real sync
cchistory sync --source <slot-or-id> --json
cchistory export --out <dir> --json                  # write export bundle
cchistory backup --out <dir> --write --json           # write backup bundle
cchistory import <bundle-dir> --json                  # execute import
cchistory import <bundle-dir> --on-conflict skip --json
cchistory gc --json                                  # execute garbage collection
```

Carry forward the same scope flags (`--store`, `--db`, `--source`, `--no-raw`,
`--on-conflict`) used in the preview.

## Rules

- Do not start API or web services. This skill uses CLI only.
- Default to `--index` for reads; only use `--full` when user explicitly accepts
  a rescan.
- Always preview before mutating.
- Preserve canonical CLI JSON field names; do not invent skill-local schemas.
- Use domain terms exactly: project, turn, session, source, bundle, blob,
  context, lineage, store.
- Surface CLI errors directly; do not silently retry with a different command.
