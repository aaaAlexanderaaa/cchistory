# CCHistory Skills Inventory

This directory is the canonical home for repo-owned CCHistory skills.

These skills must remain thin workflow packaging around the same canonical
objects already exposed by the product: `ProjectIdentity`, `UserTurn`, session
context, source diagnostics, and bundle/source administration. Skills must not
invent a parallel semantic layer or skill-only DTO family.

## Current status

The repository currently ships the packaging foundation plus the first concrete skill inventory.

Current inventory:

- `cchistory-project-history`
- `cchistory-turn-context`
- `cchistory-export-bundle`
- `cchistory-source-health`
- `cchistory-backup-workflow`
- `cchistory-restore-check`

## Layout

Every product-owned skill should live at:

```text
skills/<skill-name>/SKILL.md
```

Optional bundled resources live beside the skill:

```text
skills/<skill-name>/
├── SKILL.md
├── references/
├── scripts/
└── assets/
```

Shared conventions that multiple skills should reuse live under `skills/_shared/`.
The canonical CLI-first transport contract is documented in
`skills/_shared/CLI_TRANSPORT.md`.

## Naming rules

- Use kebab-case skill directory names.
- Prefix product-owned skills with `cchistory-`.
- Package one primary workflow per skill; do not create a single catch-all skill.
- Split read workflows from operator workflows when their safety posture differs.
- Reuse canonical domain terms exactly as defined in `HIGH_LEVEL_DESIGN_FREEZE.md`.

## Metadata expectations

Each skill must provide a `SKILL.md` with frontmatter that includes at least:

- `name`
- `description`

The description should state:

- the user-facing workflow the skill owns
- when to use it instead of another CCHistory skill
- whether it is read-only, preview-first, or potentially mutating
- that it uses the CLI-first contract unless the skill explicitly documents an
  already-running API transport

The body should stay concise and point to bundled references or scripts when the
workflow needs more detail.

## Output contract

- Prefer canonical CLI JSON output unchanged.
- If a skill adds a thin summary, keep the canonical JSON directly available.
- Use project, turn, session, source, and bundle terminology that matches the
  existing CLI/API/runtime surface.
- Preserve evidence-oriented behavior; do not hide raw-blob or lineage concepts
  when the underlying CLI surface exposes them.

## Safety rules

- Prefer local CLI transport over managed services.
- Do not require the agent to start or restart persistent services.
- Read skills should default to `--index` unless the user explicitly asks for a
  fresh rescan.
- Operator skills must default to preview-first or dry-run-first behavior when a
  safe preview path exists.
- Mutating skills must name the exact command that performs the write after the
  preview step.
