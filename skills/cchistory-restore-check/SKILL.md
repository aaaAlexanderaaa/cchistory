---
name: cchistory-restore-check
description: Verify a restored CCHistory store through the dedicated read-only CLI workflow command. Use when the user wants post-restore confirmation of source and count readability without mutating the target store.
---

# CCHistory Restore Check

Use this skill to inspect a restored CCHistory store through the dedicated
read-only CLI workflow. This skill never imports or mutates a store.

## When To Use

Use this skill when the user wants to:

- verify that a restored store directory is readable
- confirm source presence and summary counts after `import`
- run the canonical post-restore verification workflow instead of stitching
  together `stats` and `ls sources` manually
- inspect a restored store through either `--store` or `--db`

Do not use this skill to perform the restore itself. Use the bundle-import path
first, then run this verification skill.

## Transport

Read `../_shared/CLI_TRANSPORT.md` before running commands.

Default transport order:

1. `cchistory ...`
2. `node apps/cli/dist/index.js ...` after `pnpm --filter @cchistory/cli build`

Always add `--json`. This skill is read-only.

## Workflow

### 1. Require an explicit restored target

Use one of the explicit target forms:

```bash
cchistory restore-check --store <restored-store-dir> --json
cchistory restore-check --db <restored-sqlite-file> --json
```

Optional scope control:

- `--showall` when the user wants zero-token turns included in the embedded
  stats overview

Use the result to confirm:

- the restored store opens successfully
- source rows are present and readable
- summary counts for sessions and turns match expectations

## Output Rules

- Preserve canonical CLI JSON field names exactly.
- Keep the full restore-check JSON available when summarizing findings.
- Refer to canonical objects as `source`, `session`, `turn`, and `store`.
- Do not invent skill-local restore health categories.

## Safety Rules

- Never omit the explicit `--store` or `--db` target.
- Do not start managed services.
- Do not suggest `--full`; `restore-check` is indexed-only.
- Do not perform import, sync, or other mutation from this skill.
