# R10 - Single-Command Operator Workflows

## Status

- Objective source: `docs/ROADMAP.md`
- Backlog status after this note: `done`
- Phase reached: `R10-KR1` through `R10-KR3` completed on 2026-03-29, with Phase 7 evaluation passing the same day
- Scope: package the most common operator journeys as dedicated CLI workflow
  commands that wrap existing canonical commands without inventing parallel
  semantics or requiring managed services

## Phase 1 - Domain Understanding

### Problem statement

At the original 2026-03-28 decomposition point, the roadmap called for single-command operator workflows, and the CLI was
still shaped around granular building blocks. Those building blocks were useful
and should remain available, yet common operator journeys still required the user
or agent to remember and compose multiple commands.

The clearest examples at that point were:

1. source health review, which then meant combining `discover`,
   `sync --dry-run`, `ls sources`, and `stats`
2. portable backup creation, which then meant remembering the export dry-run
   step plus the write step and the most useful scoping flags
3. post-restore verification, which then meant manually combining `stats`
   and `ls sources` after an import

The user-facing goal is not to replace the granular commands. It is to package
high-frequency journeys into clearer top-level workflow commands.

### What is already implemented

The repository already exposes the low-level pieces needed for this objective:

- `apps/cli/src/index.ts` already has canonical commands for source discovery,
  sync preview, indexed reads, export, import, and stats.
- `docs/guide/cli.md` already documents the multi-command source health and
  backup/restore journeys, which makes the current friction visible.
- `skills/cchistory-source-health/SKILL.md` and
  `skills/cchistory-export-bundle/SKILL.md` already package two operator
  journeys for agents, proving that the underlying workflows are stable enough
  to deserve higher-level packaging.

### Relevant constraints

- `HIGH_LEVEL_DESIGN_FREEZE.md` forbids parallel semantics. Workflow commands
  must remain thin packaging around the same canonical objects and store
  behavior already used by the CLI, API, web, and skills.
- `AGENTS.md` forbids relying on managed service startup from the agent
  environment, so initial workflow commands should be CLI-local and safe without
  API/web services.
- Mutating workflows must stay preview-first where the underlying commands
  already provide a dry-run or read-only path.
- The current granular commands must remain available. Workflow commands are an
  operator simplification layer, not a replacement transport.

### Gaps found at decomposition time

#### 1. No dedicated source-health workflow command existed yet

At that point, the highest-frequency operator diagnostic path required multiple
commands and manual interpretation. That made both human use and agent use more
error-prone than necessary.

#### 2. Bundle workflows were still expressed as low-level command sequences

`export` and `import` were canonical and should stay that way, but the most
common operator journeys around backup creation and post-restore verification were
still documented as stitched sequences rather than named workflows.

#### 3. Existing skills already knew the workflow, but the CLI did not yet expose it directly

The repo-owned operator skills already encoded dry-run-first source health and
bundle export. That was useful evidence that the CLI could expose the same journeys
more directly without changing product semantics.

### Assumptions

- The first workflow command should be read-only, because it gives the highest
  operator value with the least safety risk.
- Workflow commands should call existing CLI handlers or equivalent storage
  reads, not shell out to nested CLI invocations.
- JSON output for workflow commands should embed or reuse existing canonical CLI
  JSON shapes instead of inventing a separate workflow-only DTO family.
- The first workflow inventory should stay small: source health first, then
  backup and restore-verification shortcuts.

## Phase 2 - Test Data Preparation

### Validation position

This objective packages existing CLI behavior rather than introducing new source
semantics. The relevant fixture and regression surface is already the CLI test
suite.

### Required scenarios

The initial workflow-command validation should cover:

- existing indexed store present
- no indexed store present
- full live read via `--full` without mutating the indexed store
- source discovery and sync-preview visibility from current fixtures
- command help and guide text that explains the workflow surface truthfully

### Fixture strategy

- Reuse the existing CLI fixture seed helpers in `apps/cli/src/index.test.ts`.
- Prefer tests that prove the workflow command is a thin wrapper over canonical
  discovery, sync preview, and stats/listing behavior.
- Do not create a new mock-data corpus unless a later workflow needs one.

## Phase 3 - Functional Design

Environment note: this objective benefits from the multi-perspective design
protocol. This environment has no sub-agent launcher, so the protocol is
recorded as separated lenses plus a synthesis.

### Agent A - System Consistency

**Recommendation**: add dedicated workflow commands that aggregate existing CLI
handlers and preserve existing JSON shapes under named sections.

**Reasoning**:

- This preserves the design-freeze rule that all surfaces remain projections of
  one canonical model.
- Existing commands such as `discover`, `sync --dry-run`, `ls sources`, and
  `stats` already encode the correct semantics.
- Embedding those results is safer than inventing a new health or backup model.

### Agent B - Operator Safety

**Recommendation**: ship a read-only workflow first, then keep mutating
workflow commands explicitly preview-first.

**Reasoning**:

- Source health is the most frequent low-risk operator question.
- Backup creation should still preserve a preview/write boundary even if both
  steps later share a dedicated workflow command name.
- Post-restore verification should stay read-only and should not silently modify
  stores.

### Agent C - Engineering Cost

**Recommendation**: decompose into one completed design KR plus two execution
KRs: source health first, bundle workflows second.

**Reasoning**:

- The source-health slice is bounded and can reuse existing command handlers
  immediately.
- Bundle workflow commands are useful, but they need narrower flag and naming
  decisions after the first workflow command lands.
- Sequencing the work this way delivers value early without overcommitting to a
  large new command family.

### Synthesis

The recommended initial workflow inventory is:

- `cchistory health` for one-command source discovery, sync-readiness preview,
  and store summary
- a later preview-first backup workflow command built on `export`
- a later post-restore verification workflow command built on `stats` and
  `ls sources`

Design rules:

1. Workflow commands must preserve existing granular commands.
2. Read-only workflows may be true one-command operations.
3. Mutating workflows must remain preview-first.
4. JSON output should embed canonical subcommand JSON rather than inventing new
   health/backup status taxonomies.
5. Workflow commands must not require managed services.

### Decided KRs

#### KR: R10-KR1 Workflow inventory and command contract

Acceptance: the repository records the initial single-command workflow
inventory, naming, safety rules, and output contract without replacing existing
canonical commands.

#### KR: R10-KR2 Source health workflow command

Acceptance: `cchistory health` provides one read-only report that combines host
source discovery, sync dry-run readiness, and indexed/full store summary
without starting managed services or mutating the store.

#### KR: R10-KR3 Backup and restore workflow shortcuts

Acceptance: dedicated workflow commands reduce friction for canonical backup
creation and post-restore verification while preserving preview-first export
behavior and existing import guarantees.

### Impacted areas

- `BACKLOG.md`
- `docs/design/` for decomposition and later validation records
- `apps/cli/src/index.ts`
- `apps/cli/src/index.test.ts`
- `docs/guide/cli.md`
- `docs/design/CURRENT_RUNTIME_SURFACE.md`
- repo-owned operator skills that currently describe the same workflows in a
  more manual sequence

### First executable slice

Implement `R10-KR2` first by adding `cchistory health` as a read-only workflow
command. After that lands, define the narrower backup and post-restore workflow
contracts on top of the same CLI-first operator model.


## KR3 Contract Addendum (2026-03-29)

The remaining workflow surface should stay intentionally narrow: one mutating
backup shortcut and one read-only restored-store verification shortcut.

### Decided command pair

- `cchistory backup`: preview-first wrapper around the canonical export-bundle
  workflow.
- `cchistory restore-check`: read-only wrapper around the post-restore
  verification steps that operators currently perform manually with `stats` and
  `ls sources`.

### `cchistory backup` contract

Purpose: reduce operator friction for the canonical portable backup workflow
without inventing a second backup format.

Rules:

1. `--out <bundle-dir>` remains required, matching `export`.
2. Default behavior is preview-only. Running `cchistory backup --out <dir>`
   must show the same plan an operator would otherwise obtain via
   `cchistory export --out <dir> --dry-run`.
3. `--write` is required for the mutating step. Running
   `cchistory backup --out <dir> --write` must produce the same bundle as the
   canonical `export` command with the same scope flags.
4. Scope flags are passed through unchanged: `--store`, `--db`, repeated
   `--source`, and `--no-raw`.
5. `--dry-run` may remain accepted as an explicit preview alias, but preview is
   already the default. `--write` always wins over preview-only mode.
6. JSON output should wrap the canonical export JSON instead of inventing a new
   bundle DTO family, e.g. `kind: "backup"`, `mode: "preview" | "write"`,
   plus an `export` payload using the existing export/export-dry-run shape.

Rejected alternatives:

- Reusing `export` directly as the workflow command name was rejected because
  this KR is about a clearer operator entrypoint, not renaming the existing
  canonical primitive.
- A second backup format was rejected because Gate 3 already establishes the
  export bundle as the canonical backup unit.
- A write-by-default `backup` command was rejected because the workflow must
  remain preview-first.

### `cchistory restore-check` contract

Purpose: make post-restore verification one explicit read-only command without
re-running import or relying on managed services.

Rules:

1. The command is verification-only; it must never import, merge, or mutate a
   store.
2. Operators should target a specific restored store explicitly with `--store`
   or `--db`. This avoids accidentally inspecting an ambient default store when
   the user intends to validate a clean restore target.
3. The command should stay indexed-read-only and must not support `--full`,
   because restore verification is about the restored store contents, not a live
   rescan of host roots.
4. Output should combine the canonical stats overview with canonical source
   listing presence in one report.
5. JSON output should wrap the existing read payloads instead of inventing a
   workflow-only verification schema, e.g. `kind: "restore-check"` plus
   embedded `stats` and `sources` payloads.

Rejected alternatives:

- Naming the command `restore` was rejected because `import` remains the
  canonical restore action and the workflow shortcut must not imply that it
  performs the import itself.
- A generic `verify` command family was rejected for this slice because the
  current need is narrower and does not yet justify a broader repository-wide
  verification namespace.

### Validation targets for KR3

Implementation should add CLI regression coverage for:

- `backup` preview mode versus `backup --write`
- flag passthrough for `--source`, `--no-raw`, and explicit store/db targeting
- `restore-check` against a restored store directory, proving summary counts and
  source presence in one read-only command
- CLI guide and runtime-surface updates that document the workflow commands
  truthfully

### Next executable slice

Implement `cchistory backup` first, then `cchistory restore-check`, reusing the
existing export/stats/source-list building blocks rather than shelling out to
nested CLI commands.
