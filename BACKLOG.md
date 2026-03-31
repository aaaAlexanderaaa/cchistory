# Backlog

This is the living work surface for CCHistory. It replaces `tasks.csv` as the
active backlog. Agents must read this file at the start of every session.

For the operational workflow that governs how objectives and tasks are executed,
see `PIPELINE.md`.

When there is no executable task, agents must run the KR review sweep defined in
`PIPELINE.md` across the whole project's open work, not only the currently
blocked or pending task, and add any resulting tasks, KRs, or objectives here
before starting non-trivial corrective work.

---

## Objective: R1 - OpenCode And OpenClaw Stabilization
Status: decomposing
Priority: P1
Source: ROADMAP.md

Both adapters are registered as `experimental`. Stabilization requires real-disk
structure analysis, real-world sample collection, anonymized fixture creation,
and regression test coverage sufficient to promote to `stable`. OpenClaw is a
hosted 7x24 autonomous agent with high message volume and relatively few user
turns, which requires design consideration for turn-building strategy and
project signal extraction.

Phase 1 blocker on 2026-03-27: this host has no local OpenClaw or OpenCode
roots. Run `pnpm run inspect:collect-source-samples -- --platform openclaw --platform opencode`
on a machine that has those data roots, then continue from
`docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md`.

KR review sweep on 2026-03-28 re-verified that this host still lacks the
transcript-bearing roots at `/root/.openclaw/agents`,
`/root/.local/share/opencode/project`, and
`/root/.local/share/opencode/storage/session`. The remaining stabilization gap
falls into three truthful backlog slices: real-sample analysis, sample-backed
fixture/regression proof, and a support-tier decision that stays conditional on
that evidence. The KRs below remain provisional until sample review confirms
whether OpenClaw and OpenCode should stay grouped or split into platform-
specific follow-up work.

- Task: clarify OpenCode transcript-vs-config collection boundaries
  Status: done
  Acceptance: `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md` and
  `scripts/inspect/collect-source-samples.mjs` distinguish transcript-bearing
  OpenCode roots from config-only paths so future collection does not chase
  irrelevant `.opencode` or config artifacts.
  Artifact: `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md`

- Task: prepare R1 sample review checklist and provisional fixture matrix
  Status: done
  Acceptance: `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md` records the
  exact questions to answer from future OpenClaw/OpenCode sample bundles and a
  provisional fixture matrix that must be confirmed before Phase 2 anonymized
  fixtures are created.
  Artifact: `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md`

- Task: map R1 affected code paths and resume validation checkpoints
  Status: done
  Acceptance: `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md` maps the
  discovery, parsing, support-tier, and validation surfaces that will need
  review once real samples arrive.
  Artifact: `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md`

- Task: add regression coverage for R1 sample collector boundaries
  Status: done
  Acceptance: an automated test proves `scripts/inspect/collect-source-samples.mjs`
  collects transcript-bearing OpenClaw/OpenCode artifacts while ignoring
  config-only `.opencode` or user-config paths.
  Artifact: `scripts/inspect/collect-source-samples.test.mjs`

- Task: record R1 promotion-to-stable evidence checklist
  Status: done
  Acceptance: `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md` records the
  exact evidence, validation commands, and support-surface updates required
  before OpenClaw or OpenCode can move from `experimental` to `stable`.
  Artifact: `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md`

### KR: R1-KR1 Real-sample collection and structure analysis
Status: open
Acceptance: a real OpenClaw and/or OpenCode sample bundle is collected,
reviewed, and recorded in
`docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md`, including a truthful
decision on whether the remaining stabilization work stays shared or splits by
platform.

- Task: collect real OpenClaw/OpenCode samples on a host with local roots
  Status: blocked
  Acceptance: `pnpm run inspect:collect-source-samples -- --platform openclaw --platform opencode`
  runs on a machine with OpenClaw and/or OpenCode history and produces a
  manifest plus copied sample set for Phase 1 analysis.
  Artifact: output directory from `pnpm run inspect:collect-source-samples -- --platform openclaw --platform opencode`

- Task: analyze collected samples and finish R1 KR decomposition
  Status: pending
  Acceptance: `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md` records the
  real-disk findings and confirms or refines the provisional KR/task breakdowns
  in `BACKLOG.md` for the remaining stabilization work.
  Artifact: `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md`

### KR: R1-KR2 Sample-backed fixture and regression proof
Status: open
Acceptance: `mock_data/`, source-adapter regression suites, and any affected
operator-visible validation cover the real-world layouts, edge cases, and scale
behaviors confirmed during R1 sample review.

- Task: create anonymized R1 fixtures from reviewed real samples
  Status: pending
  Acceptance: `mock_data/` gains only the OpenClaw/OpenCode scenarios justified
  by reviewed real samples, and `pnpm run mock-data:validate` passes.
  Artifact: `mock_data/`

- Task: add parser and discovery regressions for verified R1 layouts
  Status: pending
  Acceptance: `pnpm --filter @cchistory/source-adapters test` passes with
  coverage for the real-world layouts, malformed cases, and project-signal
  behavior confirmed during sample review.
  Artifact: `pnpm --filter @cchistory/source-adapters test`

- Task: add higher-layer regressions when R1 parsing changes user-visible flows
  Status: pending
  Acceptance: `pnpm --filter @cchistory/cli test` and/or
  `pnpm --filter @cchistory/storage test` pass when sample-driven parser
  changes affect operator-visible behavior.
  Artifact: targeted CLI/storage validation commands

### KR: R1-KR3 Truthful support-tier decision and documentation
Status: open
Acceptance: OpenClaw and OpenCode remain documented with truthful support tiers,
and any promotion beyond `experimental` is backed by the R1 evidence checklist,
validation commands, and consistent support-surface updates.

- Task: decide after sample review whether R1 stays shared or splits by platform
  Status: pending
  Acceptance: `BACKLOG.md` and
  `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md` record a truthful shared-
  vs-split follow-up plan after reviewing real samples.
  Artifact: `BACKLOG.md`

- Task: update support claims only after real-sample validation closes
  Status: pending
  Acceptance: any OpenClaw/OpenCode support-tier change is reflected
  consistently in the registry, runtime surface, release gate, and source docs,
  with `pnpm run verify:support-status` passing.
  Artifact: `pnpm run verify:support-status`

---

## Objective: R2 - CLI Search And Session Access Improvements
Status: done
Priority: P1
Source: ROADMAP.md
Completed: 2026-03-28
Completed: 2026-03-27

CLI search now supports partial multi-token matching, and the CLI exposes a
more direct single-session read workflow through human-friendly session
references. Phase 7 evaluation passed on 2026-03-27. See
`docs/design/R2_CLI_SEARCH_AND_SESSION_ACCESS.md`.

### KR: R2-KR1 Human-friendly session references
Status: done
Acceptance: `show session` and `query session --id` accept unique session ID
prefixes, titles, and workspace labels, and `ls sessions` exposes the title and
workspace fields needed to discover those references.

### KR: R2-KR2 Partial multi-token search semantics
Status: done
Acceptance: `cchistory search` supports partial multi-token matching in both
indexed and fallback search modes without breaking current filtering or
explainability.

---

## Objective: R3 - Export And Import Optimization
Status: done
Priority: P1
Source: ROADMAP.md
Completed: 2026-03-28
Completed: 2026-03-27

Bundle workflows now support dry-run previews on both import and export.
Operators can preview source-level conflict actions before mutating a target
store and can inspect large-bundle contents before writing bundle files. Phase 7
evaluation passed on 2026-03-27. See
`docs/design/R3_EXPORT_IMPORT_OPTIMIZATION.md`.

### KR: R3-KR1 Import preflight planning
Status: done
Acceptance: `cchistory import <bundle> --dry-run` reports source-level actions,
shows whether the chosen conflict mode would fail, and does not mutate the
store or raw snapshot directory.

### KR: R3-KR2 Large-bundle and migration ergonomics
Status: done
Acceptance: bundle workflows reduce operator friction for larger exports and
cross-machine migration through dry-run preview before filesystem writes or
store mutation.

---

## Objective: R4 - UI And UX Improvements
Status: done
Priority: P1
Source: ROADMAP.md
Completed: 2026-03-28
Completed: 2026-03-27

Ongoing information hierarchy, readability, search path, and admin operation
coherence improvements. Tree view development for project/session/turn hierarchy
visualization.

Current slices completed: search-path and navigation coherence in the
canonical web shell, dense-view overview/control hierarchy across
`All Turns`, `Inbox`, and `Sources`, and a project/session/turn hierarchy tree
inside `Projects`. Phase 7 evaluation passed on 2026-03-27. See
`docs/design/R4_UI_UX_IMPROVEMENTS.md`.

Follow-up note: a later review found that the tree-view slice currently fails
web lint; corrective work is tracked under `B1-KR3`.

### KR: R4-KR1 Search navigation coherence
Status: done
Acceptance: the web shell treats `Search` as a first-class destination across
responsive navigation, with explicit active-location cues and accessible current
state semantics.

### KR: R4-KR2 View readability and hierarchy
Status: done
Acceptance: the most data-dense history/admin views improve scanning and section
hierarchy without changing canonical semantics.

### KR: R4-KR3 Tree view development
Status: done
Acceptance: project/session/turn hierarchy becomes directly navigable through a
purpose-built tree experience.

---

## Objective: R6 - Generic Parser Abstraction
Status: done
Priority: P2
Source: ROADMAP.md
Completed: 2026-03-28
Completed: 2026-03-27

Common parsing patterns now land in explicit reusable families for
conversation-seed JSON, JSONL line records with optional sidecars, and VS Code
state databases. `core/vscode-state.ts` now depends on a smaller helper
contract, and the parser-family inventory plus migration rules are documented in
`docs/design/R6_GENERIC_PARSER_ABSTRACTION.md`. Phase 7 evaluation passed on
2026-03-27. See `docs/design/R6_GENERIC_PARSER_ABSTRACTION.md`.

### KR: R6-KR1 Conversation-seed family extraction
Status: done
Acceptance: the message-array/export/session-tree seed builder is implemented as
an explicit reusable module consumed from multiple adapter paths without source
behavior drift.

- Task: extract conversation-seed helpers from `core/legacy.ts`
  Status: done
  Acceptance: a dedicated reusable module owns the shared seed builder used by message-array/export-like sources, and `pnpm --filter @cchistory/source-adapters test` passes.

### KR: R6-KR2 JSONL line-record and sidecar family
Status: done
Acceptance: JSONL-based local sources reuse a narrower line-record collector and
optional sidecar merge path instead of relying on ad hoc per-source branches in
`legacy.ts`.

- Task: extract JSONL record collection and sidecar hooks
  Status: done
  Acceptance: Codex, Claude Code, Factory Droid, and OpenClaw line-record capture stays regression-safe while shared collection logic moves out of monolithic branching.

### KR: R6-KR3 VS Code state family and parser inventory
Status: done
Acceptance: the VS Code state extractor depends on a smaller helper contract,
and the repository documents the parser-family inventory and migration rules.

- Task: narrow VS Code state helper contract and record parser families
  Status: done
  Acceptance: `core/vscode-state.ts` relies on a smaller helper surface, and `docs/design/R6_GENERIC_PARSER_ABSTRACTION.md` records the parser-family inventory and boundaries.

---

## Objective: R7 - AI-Friendly Skill Packaging
Status: done
Priority: P2
Source: ROADMAP.md
Completed: 2026-03-28

Package common workflows as stable agent-callable skills (project history
retrieval, single turn context read, export bundle creation, source health
check). Phase 1-3 decomposition completed on 2026-03-27. See
`docs/design/R7_AI_FRIENDLY_SKILL_PACKAGING.md`.

### KR: R7-KR1 Packaging foundation and transport contract
Status: done
Acceptance: the repository defines a canonical `skills/` layout, naming rules,
metadata expectations, and CLI-first invocation contract for CCHistory skills
without introducing parallel semantics.

- Task: create repo-owned `skills/` layout and shared conventions
  Status: done
  Acceptance: a top-level `skills/` inventory exists with shared packaging rules
  and a documented CLI-first transport contract that later skills can reuse.

### KR: R7-KR2 Read-side history retrieval skills
Status: done
Acceptance: agents can retrieve project history and single-turn/session context
through stable repo-owned skills that surface canonical project/turn/session
JSON and explain their query parameters.

- Task: package project-history and turn-context skills
  Status: done
  Acceptance: repo-owned skills wrap canonical read surfaces for project history
  retrieval and turn/session context drill-down.

### KR: R7-KR3 Operator workflow skills
Status: done
Acceptance: agents can perform bundle-export and source-health workflows through
repo-owned skills that prefer dry-run or read-only inspection first and do not
require the agent to manage persistent services.

- Task: package export-bundle and source-health skills
  Status: done
  Acceptance: repo-owned skills expose dry-run-first bundle export and source
  health workflows without assuming managed services are started by the agent.

---

## Objective: B1 - Post-Review Correctness Corrections
Status: done
Priority: P0
Source: follow-up review on 2026-03-27
Completed: 2026-03-28

Follow-up review invalidated parts of the original closure records for `R4`,
`R5`, and `R8`. The current repository-visible gaps are: Gemini companion
evidence used for derivation without entering capture scope, UNC file-URI
authority loss in the shared path helper, and a tree-view web lint failure.
Phase 7 holistic evaluation passed on 2026-03-28. See
`docs/design/B1_POST_REVIEW_CORRECTNESS_CORRECTIONS.md`.

### KR: B1-KR1 Gemini companion evidence is preserved as captured evidence
Status: done
Acceptance: Gemini CLI `projects.json` and `.project_root` files that influence
derived metadata enter the captured-blob or raw-snapshot path, and regression
proof shows that export, import, and audit surfaces can reproduce that
evidence.

- Task: broaden Gemini capture scope to include derivation-critical companion files
  Status: done
  Acceptance: Gemini sync captures `projects.json` and relevant `.project_root`
  sidecars as evidence whenever they influence derived title, workspace, or
  project observations.

- Task: add regression proof for Gemini companion evidence reproducibility
  Status: done
  Acceptance: targeted source-adapter, storage, or CLI coverage proves Gemini
  companion evidence survives payload reconstruction and is not derivation-only
  metadata.

### KR: B1-KR2 Shared path identity preserves UNC authorities
Status: done
Acceptance: the shared local-path identity helper preserves UNC authorities for
`file://server/share/...` forms and dependent layers continue to match the same
workspace, session, and project identity.

- Task: fix UNC file-URI normalization in the shared helper
  Status: done
  Acceptance: UNC file URIs normalize to `//server/share/...` instead of losing
  the authority component.

- Task: add UNC regressions across dependent layers
  Status: done
  Acceptance: domain, storage, and CLI coverage includes UNC raw paths and UNC
  file-URI forms.

### KR: B1-KR3 Project tree web slice is lint-clean again
Status: done
Acceptance: the current tree-view implementation satisfies the canonical web
validation path, including `cd apps/web && pnpm lint`, without manual
memoization rule violations.

- Task: remove or adapt the manual memoization pattern in `ProjectTreeView`
  Status: done
  Acceptance: the tree-view slice passes web lint with the current React
  Compiler rules.

---

## Objective: A1 - Research Artifact And Command Surface Hygiene
Status: done
Priority: P1
Source: architecture review on 2026-03-28
Completed: 2026-03-28

The repository currently mixes three different concerns in one surface: stable
operator/runtime commands, release-gate verification utilities, and
task-specific research helpers. The clearest current symptoms are KR-specific
top-level `collect:*` commands, objective-ID collector filenames under
`scripts/`, and design/backlog records that present those temporary collection
paths as if they were permanent operator interfaces. This objective should
separate canonical command surfaces from research artifacts, converge reusable
sample collection onto one stable contract when warranted, and keep objective
design notes as historical phase records rather than long-lived operator
manuals. See `docs/design/A1_RESEARCH_ARTIFACT_AND_COMMAND_SURFACE_HYGIENE.md`.

Whole-project KR review sweep on 2026-03-28 found that after replacing the
root `collect:*` aliases and demoting the Antigravity live dump under
`inspect:*`, the next truthful executable work is record cleanup and stable
inspection guidance. Moving the surviving objective-specific collector files
should wait until backlog/design references and long-lived operator guidance no
longer point at the old names.

### KR: A1-KR1 Command-surface classification and collection-contract design
Status: done
Acceptance: the repository has a documented classification for root commands,
and a decided contract for how reusable sample-collection or inspection helpers
are exposed without leaking KR/objective IDs into canonical command names.

- Task: classify the current root command surface by role and retention policy
  Status: done
  Acceptance: a design note inventories root `pnpm` scripts and classifies each
  as canonical operator/runtime, release-gate verifier, supported probe, or
  task-scoped inspection helper, with keep/move/remove recommendations.
  Artifact: `docs/design/A1_RESEARCH_ARTIFACT_AND_COMMAND_SURFACE_HYGIENE.md`

- Task: decide the canonical sample-collection contract
  Status: done
  Acceptance: the design note decides whether sample collection should become
  one generic utility with flags/manifests or remain a non-top-level inspection
  helper pattern, and defines naming, output, and storage rules for future
  collection work.
  Artifact: `docs/design/A1_RESEARCH_ARTIFACT_AND_COMMAND_SURFACE_HYGIENE.md`

### KR: A1-KR2 Collector and diagnostic entrypoint cleanup
Status: done
Acceptance: root-level task-specific aliases are removed or demoted, reusable
collectors no longer embed KR/objective IDs in canonical invocation names, and
platform-specific diagnostics sit behind an appropriate inspection namespace.

- Task: replace `collect:r1-open-sources` and `collect:r5-gemini-cli` with the decided collection surface
  Status: done
  Acceptance: `package.json`, related scripts, and user-facing references stop
  exposing KR-specific `collect:*` command names while preserving a runnable
  real-sample collection path for OpenClaw/OpenCode and Gemini CLI.
  Artifact: `package.json`

- Task: review `probe:antigravity-live` against the same command-surface policy
  Status: done
  Acceptance: the Antigravity live dump path is either retained with an
  explicit inspection classification and documentation or demoted from the root
  command surface.
  Artifact: `package.json`

- Task: move or rename research-only collectors out of the root script namespace if they remain non-canonical
  Status: done
  Acceptance: surviving research helpers use a neutral inspection/research
  location and naming scheme instead of objective-ID filenames under `scripts/`.
  Artifact: `scripts/`

### KR: A1-KR3 Documentation and backlog hygiene for research artifacts
Status: done
Acceptance: reusable guidance lives in stable operator/source docs, while
objective records and backlog entries reference research artifacts truthfully
without presenting them as permanent operator commands.

- Task: rewrite backlog and objective records that currently enshrine KR-specific collector commands
  Status: done
  Acceptance: `BACKLOG.md` and the affected design notes reference the new
  generic collection path or a scoped helper artifact instead of KR-named
  top-level commands.
  Artifact: `BACKLOG.md`

- Task: add stable inspection guidance for source sample collection and live diagnostics
  Status: done
  Acceptance: a long-lived doc surface under `docs/guide/` or `docs/sources/`
  explains when to use `inspect:collect-source-samples`, `inspect:antigravity-live`,
  and `probe:smoke` without relying on objective history.
  Artifact: `docs/`

- Task: trim objective notes so reusable inspection guidance lives outside historical phase records
  Status: done
  Acceptance: `docs/design/R1_*`, `R5_*`, and `R8_*` point to the stable
  inspection guidance where appropriate and remain historical phase records
  rather than canonical operator manuals.
  Artifact: `docs/`

---


## Objective: R10 - Single-Command Operator Workflows
Status: done
Priority: P2
Source: ROADMAP.md
Completed: 2026-03-29

Package the highest-frequency operator journeys into dedicated CLI workflow
commands that wrap existing canonical building blocks without inventing
parallel semantics. Initial focus is one-command source health, then
preview-first backup and restore-verification shortcuts. Phase 1-3
decomposition completed on 2026-03-28, and Phase 7 holistic evaluation passed on
2026-03-29. See `docs/design/R10_SINGLE_COMMAND_OPERATOR_WORKFLOWS.md`.

### KR: R10-KR1 Workflow inventory and command contract
Status: done
Acceptance: the repository records the initial single-command workflow
inventory, naming, safety rules, and output contract without replacing
existing canonical commands.

- Task: map current multi-command operator journeys
  Status: done
  Acceptance: the design note identifies which current CLI/documented operator
  sequences justify dedicated workflow commands and why.
  Artifact: `docs/design/R10_SINGLE_COMMAND_OPERATOR_WORKFLOWS.md`

- Task: decide initial workflow inventory and safety rules
  Status: done
  Acceptance: the design note decides the first dedicated workflow commands,
  their scope, and the preview/write rules they must preserve.
  Artifact: `docs/design/R10_SINGLE_COMMAND_OPERATOR_WORKFLOWS.md`

### KR: R10-KR2 Source health workflow command
Status: done
Acceptance: `cchistory health` provides one read-only report that combines
host source discovery, sync dry-run readiness, and indexed/full store summary
without starting managed services or mutating the store.

- Task: implement `cchistory health` aggregated report and JSON output
  Status: done
  Acceptance: `apps/cli` exposes a `health` command that reuses canonical
  discovery, sync-readiness, and store-summary surfaces and reports when an
  indexed store is missing instead of silently inventing one.
  Artifact: `apps/cli/src/index.ts`

- Task: add `health` regression coverage and CLI documentation
  Status: done
  Acceptance: `apps/cli/src/index.test.ts`, `docs/guide/cli.md`, and the
  current runtime-surface doc cover indexed, missing-store, and `--full`
  `health` behavior truthfully.
  Artifact: `apps/cli/src/index.test.ts`

### KR: R10-KR3 Backup and restore workflow shortcuts
Status: done
Acceptance: dedicated workflow commands reduce friction for canonical backup
creation and post-restore verification while preserving preview-first export
behavior and existing import guarantees.

- Task: design the backup and post-restore workflow command contract
  Status: done
  Acceptance: the design note records scope, flags, and safety rules for the
  backup and restore-verification workflow commands before implementation.
  Artifact: `docs/design/R10_SINGLE_COMMAND_OPERATOR_WORKFLOWS.md`

- Task: implement canonical backup workflow command
  Status: done
  Acceptance: operators can run one dedicated CLI workflow command for
  preview-first portable backup creation without reconstructing the export flag
  sequence from docs.
  Artifact: `apps/cli/src/index.ts`

- Task: implement post-restore verification workflow command
  Status: done
  Acceptance: operators can run one dedicated CLI workflow command that
  summarizes restored-store counts and source presence using existing canonical
  stats/listing behavior.
  Artifact: `apps/cli/src/index.ts`

---

## Objective: R11 - Installation Channel Expansion
Status: done
Priority: P2
Source: ROADMAP.md
Completed: 2026-03-29

Whole-project KR review sweep on 2026-03-29 re-checked the remaining open work
across `BACKLOG.md` after closing `R10`. `R1` remained truthfully blocked on
missing real OpenClaw/OpenCode samples, so the next executable roadmap-owned
gap was installation-channel expansion. The delivered slice keeps scope narrow:
repo-clone install remains canonical for the full product, while the repository
now also exposes a standalone bundled CLI artifact channel plus a repository-
owned verifier for first install and replacement-style upgrade. Phase 1-3 decomposition, KR execution, and Phase 7 holistic evaluation all completed on
2026-03-29. See `docs/design/R11_INSTALLATION_CHANNEL_EXPANSION.md`.

### KR: R11-KR1 Install and upgrade contract inventory
Status: done
Acceptance: a design note records the current repo-clone and `cli:link` flows,
the first-use and upgrade friction points they leave behind, and the invariants
any additional install channel must preserve.

- Task: map current repo-clone, `cli:link`, and upgrade journeys
  Status: done
  Acceptance: `docs/design/R11_INSTALLATION_CHANNEL_EXPANSION.md` captures the
  exact current install and upgrade flows from `README.md`, `README_CN.md`,
  `package.json`, and `scripts/verify-clean-install.mjs`, including where users
  still need a local clone and build.
  Artifact: `docs/design/R11_INSTALLATION_CHANNEL_EXPANSION.md`

- Task: decide the first additional installation channel and verification contract
  Status: done
  Acceptance: the design note names the first repo-distributed install channel
  to pursue, its non-goals, and the verification needed before documenting it
  as supported.
  Artifact: `docs/design/R11_INSTALLATION_CHANNEL_EXPANSION.md`

### KR: R11-KR2 First additional install channel
Status: done
Acceptance: at least one additional repository-owned install channel lets
operators install or upgrade the CLI without depending on a local repo clone,
while preserving canonical CLI/runtime semantics.

- Task: implement the first repo-distributed CLI install channel
  Status: done
  Acceptance: repository scripts and/or artifacts support the chosen channel
  end to end without requiring users to clone and build the whole repo for
  basic CLI use.
  Artifact: install surface chosen in `docs/design/R11_INSTALLATION_CHANNEL_EXPANSION.md`

- Task: add install and upgrade verification for the new channel
  Status: done
  Acceptance: a repository-owned verifier or targeted test coverage proves
  first install and upgrade behavior for the chosen additional channel.
  Artifact: verification surface referenced by `docs/design/R11_INSTALLATION_CHANNEL_EXPANSION.md`

### KR: R11-KR3 Docs and support-surface parity for install channels
Status: done
Acceptance: user-facing install docs and runtime-surface references truthfully
cover the supported install channels, when to use them, and how upgrades work.

- Task: update install docs for the supported channels
  Status: done
  Acceptance: `README.md` and `README_CN.md` explain the canonical repo-clone
  path plus any newly supported additional channel without conflicting upgrade
  guidance.
  Artifact: `README.md`

- Task: extend runtime and verification docs for channel parity
  Status: done
  Acceptance: runtime-surface or release-gate docs point to the verification
  path for each supported install channel and do not overclaim unsupported
  packaging paths.
  Artifact: `docs/design/CURRENT_RUNTIME_SURFACE.md`

---


## Completed

## Objective: E2E-2 - High-Level-Design User Journey Coverage
Status: done
Priority: P1
Source: user feedback on 2026-03-29
Completed: 2026-03-29

A 2026-03-29 user review surfaced that the repository currently has one
representative acceptance path under `E2E-1`, but still lacks a broader
end-to-end test program derived from `HIGH_LEVEL_DESIGN_FREEZE.md`. The design
freeze defines four user-facing jobs: recall, traceability, administration, and
supply. Current regressions prove slices of those jobs, but the repository does
not yet inventory them as user stories that state what the user starts with,
what they want to obtain, which CLI/API commands they run in sequence, and what
observable result proves success.

This objective exists to turn those high-level-design jobs into truthful
scenario coverage. The target shape is chained acceptance tests that exercise
real repository-visible tools, not hidden storage-only assertions, and that
model continuous multi-command usage from initial operator state to final
observable outcome. Most of these workflows should be automatable against
sanitized fixtures and temporary stores; service-dependent or otherwise
non-automatable flows should be classified explicitly instead of remaining
implicit gaps.

The feedback that triggered this objective also exposed two concrete user-
visible cases that future journey coverage must encode or explicitly defer:
search-result drill-down must stay discoverable from the shown reference, and
messy real-world histories may contain repeated or automation-shaped user turns
that still need explainable retrieval and inspection behavior.

Whole-project KR review sweep on 2026-03-29 re-checked the remaining open work
across `BACKLOG.md`. `R1` remains truthfully blocked on real OpenClaw/OpenCode
samples, `R10` remains lower-priority pending workflow work, and `R11` remains
an undecomposed roadmap objective. Within `E2E-2`, the sweep found that the
administration baseline is already proven by existing Gate 3 backup/restore
acceptance coverage, while the remaining executable gaps reduce to three
truthful slices: search-reference drill-down (`J2`), structured CLI supply
retrieval (`J6`), and a repetitive or automation-shaped
traceability path (`J3`) that still lacked a formally recorded sanitized
baseline. A follow-up sweep the same day confirmed that the existing Claude
scenarios `claude-workspace-path` and `claude-local-command-meta-noise` already
contain repeated automation-shaped review prompts across distinct sessions, so
the remaining truthful gap splits into baseline documentation plus chained CLI
acceptance coverage rather than new raw fixture capture.

### KR: E2E-2-KR1 High-level-design journey inventory and scenario matrix
Status: done
Acceptance: a design note maps the frozen user-facing jobs to concrete user
journeys, each recording initial operator state, user intent, canonical command
chain, expected observable result, automation feasibility, and fixture/data
requirements.

- Task: derive the initial HLD-backed journey matrix
  Status: done
  Acceptance: a design note derives at least one candidate journey each for
  recall, traceability, administration, and supply from
  `HIGH_LEVEL_DESIGN_FREEZE.md`, and identifies which parts are already covered
  by existing acceptance tests versus still missing.
  Artifact: `docs/design/E2E_2_HLD_USER_JOURNEY_COVERAGE.md`

- Task: record the user-visible gap cases surfaced by the 2026-03-29 review
  Status: done
  Acceptance: the journey matrix explicitly records the search-result-to-full-
  turn drill-down path and the repeated or automation-shaped turn inspection
  path as scenarios to cover, constrain, or consciously defer.
  Artifact: `docs/design/E2E_2_HLD_USER_JOURNEY_COVERAGE.md`

- Task: classify automatable versus managed-runtime/manual journeys
  Status: done
  Acceptance: each candidate journey is marked as fully automatable on this
  host, blocked on missing fixtures/semantics, or dependent on user-started
  managed services or manual review.
  Artifact: `docs/design/E2E_2_HLD_USER_JOURNEY_COVERAGE.md`

### KR: E2E-2-KR2 Automatable chained acceptance coverage
Status: done
Acceptance: the highest-value automatable journeys execute as contiguous
multi-command acceptance tests against canonical CLI and/or API surfaces and
fail on user-observable regressions.

- Task: add chained CLI acceptance for search-reference drill-down (`J2`)
  Status: done
  Acceptance: one CLI acceptance test proves the contiguous user-facing path
  from `search` output to `show turn <shown-id>` and then to `show session`,
  using a real command chain and fixture-backed observable results.
  Artifact: `apps/cli/src/index.test.ts`

- Task: record the existing administration baseline for `E2E-2`
  Status: done
  Acceptance: at least one end-to-end operator workflow such as backup,
  restore verification, or equivalent command-chain behavior is identified as
  already proven through user-facing commands rather than hidden storage
  assertions alone.
  Artifact: `docs/design/E2E_2_HLD_USER_JOURNEY_COVERAGE.md`

- Task: add chained CLI acceptance for structured supply retrieval (`J6`)
  Status: done
  Acceptance: one structured retrieval workflow chains `query projects` to
  `query turns` and then to `query turn` and/or `query session`, proving a
  machine-readable end-to-end path without managed services.
  Artifact: `apps/cli/src/index.test.ts`

- Task: record the current sanitized J3 fixture baseline
  Status: done
  Acceptance: `docs/design/E2E_2_HLD_USER_JOURNEY_COVERAGE.md` and `mock_data/`
  document that `claude-workspace-path` plus
  `claude-local-command-meta-noise` form the current sanitized baseline for
  repeated or automation-shaped turn inspection.
  Artifact: `mock_data/README.md`

- Task: add chained CLI acceptance for repeated or automation-shaped traceability (`J3`)
  Status: done
  Acceptance: after the J3 baseline is documented, one CLI acceptance test
  proves that repeated or automation-shaped user turns remain explainably
  retrievable and inspectable through search/query plus turn/session
  drill-down.
  Artifact: `apps/cli/src/index.test.ts`

### KR: E2E-2-KR3 Fixture and coverage bookkeeping for journey tests
Status: done
Acceptance: fixture inventory, acceptance coverage, and remaining gaps are
tracked truthfully so user-story coverage can expand without inventing hidden
semantics or overclaiming automation.

- Task: validate and document sanitized fixture coverage for `J3`
  Status: done
  Acceptance: `mock_data/README.md` and/or `mock_data/scenarios.json`
  truthfully identify the existing sanitized Claude scenarios that cover the
  current J3 baseline, and `pnpm run mock-data:validate` passes after those
  metadata updates.
  Artifact: `mock_data/README.md`

- Task: publish a journey coverage map and explicit remaining gaps
  Status: done
  Acceptance: backlog and design records identify which HLD-derived journeys
  are automated today, which are manual-only, and which are blocked by missing
  semantics, fixtures, or runtime constraints.
  Artifact: `BACKLOG.md`


## Objective: R5 - Gemini CLI Adapter
Status: done
Priority: P2
Source: ROADMAP.md
Completed: 2026-03-28

Gemini CLI is now a sync-supported `experimental` adapter with real local-sample
analysis, a repeatable sample collector, sanitized fixture coverage, canonical
session/turn parsing, and support-surface docs that agree with the registry.
Phase 1-3 decomposition, KR execution, and Phase 7 evaluation all completed on
2026-03-27. See `docs/design/R5_GEMINI_CLI_ADAPTER.md`.
Completed: 2026-03-27

Follow-up note: a later review found that Gemini companion files used for
derived metadata do not yet enter the captured-evidence path; corrective work is
tracked under `B1-KR1`.

### KR: R5-KR1 Real-source understanding and fixture preparation
Status: done
Acceptance: Gemini CLI disk structure is documented from real samples, a
repeatable collection path exists, and anonymized fixtures cover transcript plus
project-companion evidence.

- Task: add Gemini CLI sample collection script
  Status: done
  Acceptance: `pnpm run inspect:collect-source-samples -- --platform gemini --output /tmp/r5-gemini-cli-samples` writes a manifest plus Gemini CLI-relevant `.gemini` artifacts.

- Task: add anonymized Gemini CLI fixture corpus
  Status: done
  Acceptance: `mock_data/` includes sanitized Gemini CLI transcript and project-companion scenarios, and `pnpm run mock-data:validate` passes.

### KR: R5-KR2 Adapter registration and canonical parsing
Status: done
Acceptance: the repository exposes a sync-supported `gemini` adapter that parses local Gemini CLI session data into canonical sessions, project observations, and `UserTurn`-compatible fragments.

- Task: register the Gemini adapter and file-matching policy
  Status: done
  Acceptance: `packages/source-adapters` registers `gemini` as a supported adapter with a narrow `.gemini` scanning policy that excludes unrelated Antigravity artifacts.

- Task: parse Gemini session JSON into canonical records
  Status: done
  Acceptance: `pnpm --filter @cchistory/source-adapters test` passes with Gemini CLI parsing coverage for message content, timestamps, and project observation evidence.

### KR: R5-KR3 Docs and regression coverage
Status: done
Acceptance: runtime surface, CLI/user docs, and targeted regression suites accurately reflect Gemini CLI support status and expected behavior.

- Task: document support surface and operator workflow
  Status: done
  Acceptance: runtime-surface and operator docs describe Gemini CLI support tier, default roots, and known limitations without overstating validation.

- Task: add regression coverage and probe validation
  Status: done
  Acceptance: targeted source-adapter tests and a probe flow validate Gemini CLI ingestion against sanitized fixtures and at least one real-sample collection shape.

## Objective: R9 - Bug Intake Process
Status: done
Priority: P1
Source: ROADMAP.md
Completed: 2026-03-28

Establish issue-driven bug intake rhythm. Repository-local bug reporting now has
one canonical contract, one tracker-ready issue form, and one explicit path
from accepted report to `BACKLOG.md` execution and regression-proof closure.
Phase 1-3 decomposition, KR execution, and Phase 7 evaluation all completed on
2026-03-27. See `docs/design/R9_BUG_INTAKE_PROCESS.md`.
Completed: 2026-03-27

### KR: R9-KR1 Canonical bug report contract
Status: done
Acceptance: reproducible bug reports require consistent fields for affected
surface, source/session context, expected vs actual behavior, and evidence
attachments or proving commands.

- Task: add bug reporting guide and markdown template
  Status: done
  Acceptance: `docs/guide/bug-reporting.md` and `docs/templates/bug-report.md`
  define the canonical report fields and evidence-preserving checklist.

### KR: R9-KR2 Issue template and intake entrypoints
Status: done
Acceptance: the repository exposes tracker-ready bug intake entrypoints that map
cleanly to the canonical bug report contract.

- Task: add repository issue template/config
  Status: done
  Acceptance: repository issue intake artifacts mirror the canonical bug report
  contract and point reporters to the bug reporting guide.

### KR: R9-KR3 Triage-to-backlog workflow and regression closure
Status: done
Acceptance: accepted bug reports have a documented path into `BACKLOG.md` and a
clear closure rule based on reproduction plus regression proof.

- Task: document issue-to-backlog triage workflow
  Status: done
  Acceptance: `docs/design/R9_BUG_INTAKE_PROCESS.md` and user-facing docs define
  how accepted bugs become objectives/KRs/tasks and what evidence closes them.

## Objective: R8 - Windows Compatibility
Status: done
Priority: P1
Source: ROADMAP.md
Completed: 2026-03-28

Path parsing, default source root directories, URI/separator normalization, and
SQLite/local file access differences for Windows hosts. Phase 1-3 decomposition
completed on 2026-03-27, and `R8-KR1` through `R8-KR3` were completed the same
day. Phase 7 evaluation passed on 2026-03-27. See
`docs/design/R8_WINDOWS_COMPATIBILITY.md`.
Completed: 2026-03-27

Follow-up note: a later review found that UNC file-URI authorities are not yet
preserved by the shared path helper; corrective work is tracked under `B1-KR2`.

### KR: R8-KR1 Shared path normalization and user-facing matching
Status: done
Acceptance: Windows separators, drive-letter casing, and file URI forms are
normalized consistently in the highest-risk path-identity call sites, including
CLI session reference matching and web workspace comparison.

### KR: R8-KR2 Verified Windows default source roots
Status: done
Acceptance: each supported adapter either has verified Windows default-root
candidates or is explicitly documented as requiring manual configuration on
Windows.

### KR: R8-KR3 Windows fixture and regression coverage
Status: done
Acceptance: Windows-shaped fixtures and tests cover normalization, linking,
source discovery, and user-facing reference behavior.

- Task: add Windows file-URI normalization regressions in source adapters
  Status: done
  Acceptance: `pnpm --filter @cchistory/source-adapters test` passes with
  Windows `file:///C:/...` and `file://localhost/C:/...` coverage.

- Task: add cross-layer Windows path identity regressions
  Status: done
  Acceptance: `pnpm --filter @cchistory/domain build && pnpm --filter @cchistory/storage test && pnpm --filter @cchistory/cli test` passes with mixed-separator and drive-letter variants.

- Task: record KR3 coverage status in R8 docs
  Status: done
  Acceptance: `docs/design/R8_WINDOWS_COMPATIBILITY.md` and `BACKLOG.md` reflect the new regression surface and validation commands.


## Objective: E2E-1 - Primary User Story Acceptance Test
Status: done
Priority: P0
Source: architectural review
Completed: 2026-03-27

The primary user story is now covered by a CLI acceptance test that syncs the
sanitized multi-platform mock-data corpus, proves that `history-lab` becomes one
committed project across AMP, Antigravity, and Factory Droid, searches for a
known turn inside that project, and drills into the recovered turn's session
context. Phase 7 evaluation passed on 2026-03-27.

### KR: E2E-1-KR1 Same-project multi-agent recall is proven
Status: done
Acceptance: one acceptance test syncs 3+ source platforms for the same project and verifies that their turns land under one committed project.

### KR: E2E-1-KR2 Search and context drill-down follow the recovered project
Status: done
Acceptance: the same test searches for a known turn in that project and verifies that turn and session detail remain inspectable through user-facing commands.

## Objective: G6 - Documentation Consistency Verification
Status: done
Priority: P0
Source: RELEASE_GATE.md
Gate: Gate 6 - README, runtime surface, and registry agree on support status
Completed: 2026-03-27

Support-tier documentation is now checked by `pnpm run verify:support-status`,
which compares `README.md`, `README_CN.md`,
`docs/design/CURRENT_RUNTIME_SURFACE.md`,
`docs/design/SELF_HOST_V1_RELEASE_GATE.md`, and `docs/sources/README.md`
against the adapter registry. Phase 7 evaluation passed on 2026-03-27.

### KR: G6-KR1 Support claims are executable
Status: done
Acceptance: a repository command verifies that user-facing support-tier docs match the adapter registry.

### KR: G6-KR2 Main support surfaces stay in sync
Status: done
Acceptance: the verifier fails if README, runtime surface, release gate, or source-reference docs omit a registered adapter or assign the wrong tier.

### KR: G6-KR3 Release-gate docs point to the verifier
Status: done
Acceptance: release-gate-facing docs identify the support-status verifier as the Gate 6 validation path.

## Objective: G5 - Real-World Adapter Validation
Status: done
Priority: P0
Source: RELEASE_GATE.md
Gate: Gate 5 - Stable adapters use real-world validated samples and regression tests
Completed: 2026-03-27

Stable adapter support is now formalized by
`mock_data/stable-adapter-validation.json`, source-adapter regression tests
assert that every `stable` adapter and only `stable` adapters are covered by
real-world validation assets, and the stable adapter mock-data probe test now
follows that manifest instead of a duplicated hardcoded list. Phase 7
evaluation passed on 2026-03-27.

### KR: G5-KR1 Stable support claims are machine-readable
Status: done
Acceptance: a repository-owned manifest ties every stable adapter to sanitized real-world validation scenarios and runtime-only fixtures when needed.

### KR: G5-KR2 Regression tests enforce the stable-vs-experimental boundary
Status: done
Acceptance: source-adapter tests fail if a stable adapter lacks documented real-world validation coverage or if an experimental adapter appears in the stable manifest.

### KR: G5-KR3 Release-gate docs explain the validation basis
Status: done
Acceptance: design and release-gate docs point to the manifest-backed validation path and explain the Antigravity live-fixture exception.

## Objective: G1 - Clean Machine Install Verification
Status: done
Priority: P0
Source: RELEASE_GATE.md
Gate: Gate 1 - A clean machine can install from docs
Completed: 2026-03-27

The canonical install path is now documented in `README.md` and
`README_CN.md`, supported Node/pnpm versions are machine-readable in
`package.json`, and `pnpm run verify:clean-install` validates install plus the
first non-web build on a temporary clean copy. Phase 7 evaluation passed on
2026-03-27.

### KR: G1-KR1 Canonical install contract is explicit
Status: done
Acceptance: one documented install path and one machine-readable Node/pnpm support policy exist and agree.

### KR: G1-KR2 Clean install verification is executable
Status: done
Acceptance: a repo command verifies the canonical install path on a temp copy without mutating the operator's working tree.

### KR: G1-KR3 Fresh-context evaluation closes Gate 1
Status: done
Acceptance: a holistic review confirms the implemented path satisfies Gate 1 and does not hide risk behind existing local state.

## Objective: G2 - Schema Upgrade Safety
Status: done
Priority: P0
Source: RELEASE_GATE.md
Gate: Gate 2 - Upgrades do not damage an existing store
Completed: 2026-03-27

Storage upgrade safety now has an acceptance test that opens a synthesized
legacy store, restores schema metadata, and verifies turn/session/project
readability after upgrade. Operator upgrade guidance in `docs/guide/cli.md`
already matches the validated backup-first workflow. Phase 7 evaluation passed
on 2026-03-27.

### KR: G2-KR1 Legacy store upgrades preserve readability
Status: done
Acceptance: a synthesized legacy store can be opened by the current storage layer and still expose readable turns, sessions, and projects after upgrade.

### KR: G2-KR2 Operator upgrade guidance matches the validated path
Status: done
Acceptance: docs tell operators to take a pre-upgrade backup and how to validate the upgraded store using the same path covered by regression tests.

## Objective: G3 - Backup And Restore
Status: done
Priority: P0
Source: RELEASE_GATE.md
Gate: Gate 3 - Backup and restore work on a clean directory
Completed: 2026-03-27

The export bundle is now validated as the canonical backup unit through a CLI
acceptance test that proves default raw inclusion, restore into a clean target
directory, and post-restore readability for sources, sessions, and turns.
Phase 7 evaluation passed on 2026-03-27.

### KR: G3-KR1 Bundle backup and clean-directory restore are proven
Status: done
Acceptance: the documented export bundle can be restored into a clean store directory and post-restore CLI reads confirm sources, sessions, and turns are readable.

### KR: G3-KR2 Operator documentation matches the validated backup unit
Status: done
Acceptance: docs describe the export bundle as the canonical backup unit, clarify raw inclusion behavior, and match the validated restore workflow.

## Objective: G4 - Offline Web Build Verification
Status: done
Priority: P0
Source: RELEASE_GATE.md
Gate: Gate 4 - Web production builds do not require the public internet
Completed: 2026-03-27

The repository now includes `pnpm run verify:web-build-offline`, which removes
`apps/web/.next`, blocks external network sockets while preserving loopback
worker traffic, and runs the canonical `apps/web` production build. Phase 7
evaluation passed on 2026-03-27.

### KR: G4-KR1 Offline-safe web build is executable
Status: done
Acceptance: a repository command verifies that the canonical `apps/web` production build succeeds without public-internet network access.

### KR: G4-KR2 Release-gate docs point to the verifier
Status: done
Acceptance: release-gate-facing docs identify the offline web-build verifier as the validation path.
