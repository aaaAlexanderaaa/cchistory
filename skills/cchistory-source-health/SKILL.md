---
name: cchistory-source-health
description: Inspect CCHistory source discovery, availability, and sync-readiness through the CLI-first operator contract. Use when the user needs dry-run-first source health checks without starting managed services.
---

# CCHistory Source Health

Use this skill to inspect source discovery and sync readiness through the local
CLI. Prefer read-only and dry-run paths before any write.

## When To Use

Use this skill when the user wants to:

- see which supported sources are discoverable on the host
- confirm whether configured or default source roots currently exist
- preview sync availability without mutating the store
- review source counts or stored source status from an existing store

Do not use this skill for project or turn retrieval. Use the read-side skills
instead.

## Transport

Read `../_shared/CLI_TRANSPORT.md` before running commands.

Default transport order:

1. `cchistory ...`
2. `node apps/cli/dist/index.js ...` after `pnpm --filter @cchistory/cli build`

Always add `--json`. This skill should stay read-only or dry-run-first unless
an explicit user request requires a real sync.

## Workflow

### 1. Inspect host discovery

Use host discovery when the user asks what the machine can see right now:

```bash
cchistory discover --json
```

Use `--showall` when the user wants to see missing candidates too.

### 2. Preview sync readiness

Use the dry-run sync surface before any real sync:

```bash
cchistory sync --dry-run --json
```

Optional filters:

- `--source <slot-or-id>` repeated to focus on selected sources
- `--store <dir>` or `--db <file>` when the user wants a specific target store

### 3. Inspect current indexed source status

If the user wants the already-indexed source view from a store, use:

```bash
cchistory ls sources --index --json
cchistory stats --index --json
```

Use this path for stored health, counts, and drift-adjacent review after syncs
already exist.

### 4. Only if the user explicitly requests a real sync

Name the mutating command only after the dry-run result is reviewed:

```bash
cchistory sync --json
```

Carry forward the same `--source`, `--store`, or `--db` scope from the preview.

## Output Rules

- Preserve canonical CLI JSON field names exactly.
- Keep dry-run and discovery JSON available when summarizing findings.
- Refer to canonical objects as `source`, `sessions`, `turns`, and `blobs`.
- Do not invent a skill-local health model beyond the CLI's own status fields.

## Safety Rules

- Default to `discover`, `sync --dry-run`, `ls sources`, and `stats`.
- Do not start managed services.
- Do not perform a real sync unless the user explicitly asks for store mutation.
- When recommending a real sync, show the preview command first and the write
  command second.
