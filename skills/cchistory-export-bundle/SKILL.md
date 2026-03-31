---
name: cchistory-export-bundle
description: Preview and create canonical CCHistory export bundles through the CLI-first operator contract. Use when the user needs a dry-run-first bundle export workflow without starting managed services.
---

# CCHistory Export Bundle

Use this skill to preview and create a CCHistory export bundle through the local
CLI. Always run the preview step first.

## When To Use

Use this skill when the user wants to:

- export one store into a shareable bundle
- preview which sources, sessions, turns, and blobs would be exported
- choose whether to include raw blobs before writing a bundle
- prepare a migration or backup artifact without starting API or web services

Do not use this skill for import planning or source inspection. Use the
appropriate operator skill instead.

## Transport

Read `../_shared/CLI_TRANSPORT.md` before running commands.

Default transport order:

1. `cchistory ...`
2. `node apps/cli/dist/index.js ...` after `pnpm --filter @cchistory/cli build`

Always add `--json`. This skill is preview-first.

## Workflow

### 1. Preview the export plan first

Run the dry-run form before any write:

```bash
cchistory export --out <bundle-dir> --dry-run --json
```

Optional scope controls:

- `--store <dir>` or `--db <file>`
- `--source <id>` repeated to limit exported sources
- `--no-raw` when the user explicitly wants metadata-only export

Use the preview result to confirm:

- which sources are selected
- how many sessions, turns, and blobs are included
- whether raw snapshots are included

### 2. Write the bundle only after confirmation

When the user confirms the preview, run:

```bash
cchistory export --out <bundle-dir> --json
```

Add the same scope flags used in the preview step.

## Output Rules

- Preserve canonical CLI JSON field names exactly.
- Keep the preview JSON available when summarizing the export plan.
- Refer to exported units as `source`, `session`, `turn`, and `blob`.
- Do not invent skill-local export status categories.

## Safety Rules

- Never skip the dry-run preview.
- Do not start managed services.
- Do not silently change `--no-raw` behavior; call it out explicitly.
- Treat the write step as an explicit second action after preview confirmation.
