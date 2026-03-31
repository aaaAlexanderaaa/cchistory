# A1 Research Artifact And Command Surface Hygiene

## Status

- Objective: `A1 - Research Artifact And Command Surface Hygiene`
- Objective source: architecture review on 2026-03-28
- Backlog status after this note: `done`
- Phase reached: Phase 7 evaluation passed on 2026-03-28
- Scope: separate canonical root command surfaces from task-scoped research
  helpers without changing frozen product semantics or the managed-service
  runtime contract

## Phase 1 - Domain Understanding

### Problem statement

The repository currently exposes several different kinds of root `pnpm` scripts
through one flat surface. Stable operator/runtime entrypoints, release-gate
verifiers, supported probes, and task-specific research helpers all appear side
by side in `package.json`. That creates two forms of drift:

1. objective- or KR-specific helper names such as `collect:r1-open-sources`
   and `collect:r5-gemini-cli` look like permanent product interfaces even
   though they only exist to unblock a specific research slice
2. design notes and backlog entries start pointing to those temporary helper
   names as if they were canonical user workflows

The design goal is not to remove inspection tooling. It is to classify which
commands deserve stable root visibility, which ones should move behind a neutral
inspection namespace, and which ones should remain task-scoped artifacts that
are referenced only from the owning research note.

### Relevant constraints

- `HIGH_LEVEL_DESIGN_FREEZE.md` forbids inventing parallel product semantics,
  so command-surface cleanup must preserve existing canonical operator flows.
- `AGENTS.md` freezes the managed dev-service lifecycle around
  `scripts/dev-services.sh` and the `pnpm services:*` wrappers.
- Release-gate verification commands should stay cheap and directly runnable
  from the repository root.
- Research or sample-collection helpers may preserve evidence, but they must
  not imply stable support claims or product-level operator guidance by their
  mere presence at the root.

### Current root script inventory and classification

The current root `package.json` script surface can be classified as follows.
Grouped rows list the exact commands that currently share the same role and
retention recommendation.

| Scripts | Class | Recommendation | Reasoning |
| --- | --- | --- | --- |
| `build`, `build:all:safe`, `test`, `validate:core`, `mock-data:validate` | canonical operator/runtime | keep at root | These are stable repository lifecycle and validation entrypoints, even though some are maintainer-oriented rather than end-user runtime commands. |
| `cli`, `cli:link` | canonical operator/runtime | keep at root | They expose the canonical CLI entrypoint and the documented local linking path. |
| `services:start`, `services:stop`, `services:restart`, `services:status`, `services:run:web`, `services:run:api`, `restart:api`, `restart:web`, `restart:web:preview` | canonical operator/runtime | keep at root | They are the repository-owned runtime lifecycle surface, including compatibility aliases and preview-only helpers already documented in repository policy. |
| `verify:clean-install`, `verify:web-build-offline`, `verify:support-status` | release-gate verifier | keep at root | These are explicit gate-verification commands that should remain easy to discover and run from release-facing docs. |
| `probe:smoke` | supported probe | keep at root | This is a reusable, documented probe path for inspecting one source without requiring managed services. |
| `probe:antigravity-live` | task-scoped inspection helper | review for move/demote | It is platform-specific and diagnostic in nature; if retained it should sit behind a neutral inspection namespace rather than look like a broad supported probe. |
| `collect:r1-open-sources`, `collect:r5-gemini-cli` | task-scoped inspection helper | replace at root | These names leak objective/KR IDs into the stable command surface even though they are really sample-collection helpers for specific research slices. |

### Gaps confirmed

1. The repository has no neutral inspection namespace for reusable sample
   collection or platform-specific diagnostics.
2. Sample-collection helpers that may remain useful beyond one objective are
   still named after specific roadmap slices.
3. Objective design notes and backlog records currently enshrine those
   objective-specific command names as if they were the long-lived operator
   contract.
4. Research helper filenames under `scripts/` also embed roadmap IDs, which
   makes it harder to distinguish stable tooling from historical artifacts.

## Phase 2 - Validation Position

This objective is command-surface hygiene rather than a change to source
semantics. Phase 1-3 decomposition therefore depends on repository inspection,
not new fixtures. Once implementation begins, validation should focus on:

- `package.json` root scripts and any moved helper paths
- targeted tests for any retained generic collector behavior
- user-facing docs and backlog records that currently cite KR-specific helper
  names

## Phase 3 - Functional Design

### Decided approach

1. Keep stable root visibility for canonical operator/runtime commands,
   release-gate verifiers, and broadly supported probes.
2. Introduce a neutral `inspect:*` namespace for reusable inspection helpers
   that are intentionally supported but are not part of the main operator
   runtime surface.
3. Replace objective-specific sample-collection root aliases with one generic
   source-sample collection contract when the helper is truly reusable across
   platforms; otherwise keep the helper out of the root namespace entirely.
4. Treat objective design notes as historical phase records. When a collection
   helper becomes reusable guidance, document the stable contract in long-lived
   source/operator docs and have the objective note point there instead of
   acting as the canonical manual.

### Canonical sample-collection contract

The reusable contract for source-sample collection should be:

- root entrypoint: `pnpm run inspect:collect-source-samples -- --platform <slot>`
- script location: `scripts/inspect/collect-source-samples.mjs`
- platform selection: repeatable `--platform <slot>` flags so one run can
  gather OpenClaw, OpenCode, Gemini CLI, or future source-family samples
- output default: `.cchistory/inspections/source-samples-<timestamp>/`
- output override: `--output <dir>`
- manifest minimum fields:
  - collection timestamp
  - requested platforms
  - checked roots per platform
  - copied files per platform
  - notes about config-only or companion-only paths that were intentionally not
    treated as transcript-bearing evidence

Decision rule:

- If a collection need is generic enough to be reused across more than one
  objective or platform family, expose it through the neutral `inspect:*`
  namespace and neutral script naming.
- If a helper remains one-off research, keep it as a direct script path under a
  research/inspection folder and reference it only from the owning objective
  note or backlog task.

### Naming and storage rules

- Do not expose roadmap IDs such as `r1`, `r5`, or `kr3` in canonical root
  command names.
- Do not use objective IDs in generic reusable script filenames.
- Reusable inspection helpers belong under `scripts/inspect/`.
- One-off research helpers should move under a clearly non-canonical location
  such as `scripts/research/` if they remain in the repository.
- Backlog tasks and design notes should reference either the stable
  `inspect:*` contract or the specific non-canonical script path, not present a
  task-scoped root alias as permanent operator guidance.

### Trade-offs and rejected alternatives

- **Keep objective-specific root aliases**: rejected because it permanently
  leaks temporary roadmap decomposition into the user-facing command surface.
- **Hide every inspection helper behind direct file paths only**: rejected
  because some inspection paths, especially generic sample collection, are
  legitimately reusable and deserve a stable, neutral invocation contract.
- **Create one catch-all research mega-command**: rejected because it would
  blur the difference between supported probes and ad hoc research work. A
  small `inspect:*` namespace is clearer.

### Decided KR interpretation

- `A1-KR1` is satisfied by this note: the root command surface is classified,
  and the canonical sample-collection contract is decided.
- `A1-KR2` should implement the contract by replacing the KR-specific
  `collect:*` aliases, reviewing `probe:antigravity-live`, and moving any
  remaining non-canonical helpers.
- `A1-KR3` should clean up docs and backlog references so long-lived guidance
  points to the neutral inspection contract instead of objective history.

### Impacted areas

- `package.json`
- `scripts/`
- `BACKLOG.md`
- `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md`
- `docs/design/R5_GEMINI_CLI_ADAPTER.md`
- any long-lived guide/source docs that should reference reusable inspection
  workflows

### Next executable slice

Implement `A1-KR2` first:

1. add the neutral `inspect:*` source-sample collection entrypoint
2. replace the `collect:r1-open-sources` and `collect:r5-gemini-cli` root aliases
3. review whether `probe:antigravity-live` should move under `inspect:` or lose
   its root alias entirely

## Phase 7 - Holistic Evaluation

Evaluation date: 2026-03-28

Dimensions reviewed:

- **Boundary evaluation**: changes stayed within command-surface, script-path,
  and documentation hygiene. No product semantics, storage schema, or managed
  runtime contracts changed.
- **Stability assessment**: the generic collector now covers success,
  missing-platform, and config-only/no-evidence failure paths through targeted
  tests; inspection helpers remain opt-in and isolated from normal runtime
  flows.
- **Scalability evaluation**: the new inspection surface only affects explicit
  operator invocations and static documentation, so it does not add cost to
  sync, API, web, or storage hot paths.
- **Compatibility assessment**: no migration or stored-data change is needed;
  existing stores and canonical object projections remain untouched.
- **Security evaluation**: no new external service surface was introduced.
  The generic collector remains local-file based, and the Antigravity helper
  keeps its existing live-diagnostic boundary.
- **Maintainability assessment**: stable inspection guidance now lives in one
  long-lived guide, KR-specific root aliases are removed, and obsolete
  objective-specific collector files no longer compete with the canonical
  `inspect:*` contract.

Issues found:

- None requiring corrective KR reopen for this objective.

Accepted known limitations:

- `inspect:collect-source-samples` remains an evidence-collection helper, not a
  support-tier claim for `openclaw`, `opencode`, or `gemini`.
- `inspect:antigravity-live` still depends on a live local Antigravity language
  server and is intentionally documented as a source-specific diagnostic path.
