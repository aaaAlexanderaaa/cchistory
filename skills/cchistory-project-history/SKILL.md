---
name: cchistory-project-history
description: Retrieve canonical CCHistory project history through the CLI-first read contract. Use when the user needs one project's metadata, linked turns, or project-scoped history JSON without starting managed services.
---

# CCHistory Project History

Use this skill to fetch one project's canonical history through the local CLI.
Prefer indexed reads and preserve the CLI's JSON output as the source of truth.

## When To Use

Use this skill when the user wants to:

- inspect one project's canonical metadata
- retrieve the turns linked to a project
- find the right `project_id` before deeper analysis
- review project history without starting API or web services

Do not use this skill for single-turn drill-down. Use `cchistory-turn-context`
instead.

## Transport

Read `../_shared/CLI_TRANSPORT.md` before running commands.

Default transport order:

1. `cchistory ...`
2. `node apps/cli/dist/index.js ...` after `pnpm --filter @cchistory/cli build`

Always add `--json`. Default to `--index` unless the user explicitly wants a
fresh rescan with `--full`.

## Workflow

### 1. Resolve the project

If the user does not provide a canonical `project_id`, first inspect the project
inventory:

```bash
cchistory query projects --index --json
```

Match the user's name or description against the returned project list, then use
that canonical `project_id` in later commands.

### 2. Read project metadata and linked turns

Use the canonical project read surface:

```bash
cchistory query project --id <project-id> --index --json
```

This returns:

- `project`: canonical project metadata
- `turns`: project-linked `UserTurn` projections

Use `--link-state committed|candidate|unlinked|all` when the user wants a
specific linkage slice.

### 3. Narrow or search within one project

If the user wants a shorter, filtered, or search-like project history view, use:

```bash
cchistory query turns --project <project-id> --limit <n> --index --json
cchistory query turns --project <project-id> --search <query> --limit <n> --index --json
```

Prefer this path when the user asks for:

- the latest N turns in one project
- project-scoped search
- a lightweight list before opening a specific turn

## Output Rules

- Preserve canonical JSON field names exactly.
- If you summarize, keep the raw JSON available to the user.
- Refer to canonical objects as `project`, `turn`, and `UserTurn`.
- Do not invent a skill-local schema or synthetic project identifiers.

## Safety Rules

- Do not start managed services.
- Do not switch to API routes unless the user explicitly wants an already-running
  API transport.
- Do not mutate the store while using this skill.
- Use `--full` only when the user accepts the cost of a temporary rescan.
