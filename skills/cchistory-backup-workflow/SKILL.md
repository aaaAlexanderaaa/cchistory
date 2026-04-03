---
name: cchistory-backup-workflow
description: Preview and create canonical CCHistory backup bundles through the dedicated CLI workflow command. Use when the user wants the repo-owned preview-first backup journey rather than the lower-level export primitive.
---

# CCHistory Backup Workflow

Use this skill to create a portable CCHistory backup through the dedicated local
CLI workflow. Always keep the preview step first and treat `--write` as the
explicit mutating step.

## When To Use

Use this skill when the user wants to:

- create a portable backup bundle for a store
- preview the backup plan before writing files
- run the canonical operator backup journey instead of the lower-level `export`
  primitive
- control whether raw blobs are included in the written backup bundle

Do not use this skill for bundle import or post-restore inspection. Use the
appropriate operator skill instead.

## Transport

Read `../_shared/CLI_TRANSPORT.md` before running commands.

Default transport order:

1. `cchistory ...`
2. `node apps/cli/dist/index.js ...` after `pnpm --filter @cchistory/cli build`

Always add `--json`. This skill is preview-first.

## Workflow

### 1. Preview the backup plan first

Run the preview form before any write:

```bash
cchistory backup --out <bundle-dir> --json
```

Optional scope controls:

- `--store <dir>` or `--db <file>`
- `--source <id>` repeated to limit exported sources
- `--no-raw` when the user explicitly wants a lighter backup bundle
- `--dry-run` only if the user specifically wants the explicit alias; preview is
  already the default

Use the preview result to confirm:

- which sources are selected
- how many sessions, turns, and blobs are included
- whether raw snapshots are included
- the output directory the write step will target

### 2. Write the backup only after confirmation

When the user confirms the preview, run:

```bash
cchistory backup --out <bundle-dir> --write --json
```

Carry forward the same scope flags used in the preview step.

## Output Rules

- Preserve canonical CLI JSON field names exactly.
- Keep the preview JSON available when summarizing the backup plan.
- Refer to canonical units as `source`, `session`, `turn`, `blob`, and `bundle`.
- Do not invent skill-local backup status categories.

## Safety Rules

- Never skip the preview step.
- Do not start managed services.
- Name `--write` explicitly as the mutating step; without it, `backup` remains
  preview-only.
- Do not silently change `--no-raw`; call that choice out explicitly.
