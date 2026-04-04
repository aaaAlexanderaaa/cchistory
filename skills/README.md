# CCHistory Skills

This directory contains repo-owned skills for CCHistory. Skills are structured
workflow definitions that AI coding agents can use to operate the CCHistory CLI
safely and effectively.

## Inventory

- `cchistory-cli/` — Full CLI surface: source discovery, sync, query, export,
  import, backup, restore-check, and garbage collection. Commands are organized
  by safety tier (read → preview → mutate).

## Conventions

- One skill per distinct tool surface. The CLI is one tool, so it gets one skill.
- Use canonical domain terms from `HIGH_LEVEL_DESIGN_FREEZE.md`.
- Skills should not duplicate knowledge already available via `--help` or project
  docs — they add structure, safety guidance, and workflow ordering.
