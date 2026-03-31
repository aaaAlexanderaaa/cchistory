---
name: cchistory-turn-context
description: Retrieve canonical CCHistory turn, context, lineage, or session drill-down JSON through the CLI-first read contract. Use when the user needs one turn or one session explained without starting managed services.
---

# CCHistory Turn Context

Use this skill to inspect one turn or one session through the local CLI.
Prefer indexed reads and keep the CLI's canonical JSON intact.

## When To Use

Use this skill when the user wants to:

- inspect a single turn with its context and lineage
- explain how a turn maps back to sessions, blobs, and raw pipeline layers
- drill into one session and list the turns inside it
- resolve a human-friendly session reference into canonical session JSON

Do not use this skill for project-wide history retrieval. Use
`cchistory-project-history` instead.

## Transport

Read `../_shared/CLI_TRANSPORT.md` before running commands.

Default transport order:

1. `cchistory ...`
2. `node apps/cli/dist/index.js ...` after `pnpm --filter @cchistory/cli build`

Always add `--json`. Default to `--index` unless the user explicitly wants a
fresh rescan with `--full`.

## Workflow

### 1. If the turn ID is unknown, discover it first

Use canonical turn search before drill-down:

```bash
cchistory query turns --search <query> --limit <n> --index --json
```

Use `--project` or `--source` when the user already knows the scope.

### 2. Read one turn with context and lineage

Use the canonical single-turn surface:

```bash
cchistory query turn --id <turn-id> --index --json
```

This returns:

- `turn`: canonical turn projection
- `context`: turn context projection
- `lineage`: pipeline lineage, including record/blob references when available

Preserve lineage data; do not strip blob, record, or fragment references when
explaining evidence.

### 3. Drill into one session

Use the canonical session surface:

```bash
cchistory query session --id <session-ref> --index --json
```

`<session-ref>` may already be any CLI-supported human-friendly reference, such
as:

- exact session ID
- unique session ID prefix
- exact session title
- normalized workspace path or basename when unique

The response includes:

- `session`: canonical session projection
- `turns`: resolved turns in that session

## Output Rules

- Preserve canonical JSON field names exactly.
- If you summarize, keep the raw JSON available to the user.
- Refer to canonical objects as `turn`, `context`, `lineage`, and `session`.
- Do not invent skill-local identifiers or alternate lineage semantics.

## Safety Rules

- Do not start managed services.
- Do not mutate the store while using this skill.
- Use `--full` only when the user explicitly accepts a rescan.
