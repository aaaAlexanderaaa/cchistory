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
Status: done
Priority: P1
Source: ROADMAP.md

OpenCode and OpenClaw have now both completed the real-world validation slice
needed for `stable`. `R1` therefore closes the current source-specific support-
tier work for these two adapters, while leaving future follow-up conditional on
new real-data drift or newly observed platform-specific edge cases.

KR review sweep on 2026-03-31 incorporated the extracted real archive under
`.realdata/config_dots_20260331_212353/` and the review note in
`docs/design/REAL_SOURCE_ARCHIVE_REVIEW_2026-03-31.md`. Follow-up validation on
2026-04-01 closed the OpenCode fixture, regression, and support-surface slice.
A subsequent user-provided archive at `.realdata/openclaw_backup.tar.gz`,
created from real `~/.openclaw` data, now provides transcript-bearing OpenClaw
session JSONL evidence under `agents/*/sessions/*.jsonl`. `R1` is therefore no
longer blocked on sample acquisition itself; the remaining work is to analyze
that real OpenClaw archive and decompose the resulting parser/fixture/support-
tier follow-up truthfully.

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
Status: done
Acceptance: a real OpenClaw and/or OpenCode sample bundle is collected,
reviewed, and recorded in
`docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md`, including a truthful
decision on whether the remaining stabilization work stays shared or splits by
platform.

- Task: collect real OpenClaw/OpenCode samples on a host with local roots
  Status: done
  Acceptance: a real sample archive is available locally under
  `.realdata/config_dots_20260331_212353/` with OpenCode transcript-bearing
  data suitable for Phase 1 structure review.
  Artifact: `.realdata/config_dots_20260331_212353/`

- Task: analyze collected samples and finish R1 KR decomposition
  Status: done
  Acceptance: `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md` and
  `docs/design/REAL_SOURCE_ARCHIVE_REVIEW_2026-03-31.md` record the real-disk
  findings and refine the remaining R1 work into executable OpenCode tasks plus
  blocked OpenClaw follow-up.
  Artifact: `docs/design/REAL_SOURCE_ARCHIVE_REVIEW_2026-03-31.md`

### KR: R1-KR2 Sample-backed fixture and regression proof
Status: done
Acceptance: `mock_data/`, source-adapter regression suites, and any affected
operator-visible validation cover the real-world layouts, edge cases, and scale
behaviors confirmed during R1 sample review.

- Task: create fully anonymized OpenCode fixtures from reviewed real samples
  Status: done
  Acceptance: `mock_data/` gains only the OpenCode scenarios justified by the
  reviewed real archive, including the observed `storage/session/global` +
  `storage/message` + `storage/part` layout, and `pnpm run mock-data:validate`
  passes.
  Artifact: `mock_data/opencode/`

- Task: add OpenCode discovery and parser regressions for verified real layout
  Status: done
  Acceptance: `pnpm --filter @cchistory/source-adapters test` passes with
  coverage for `storage/project/global.json`,
  `storage/session/global/*.json`, `storage/message/<session-id>/*.json`, and
  `storage/part/<message-id>/*.json`, plus whatever truthful handling is chosen
  for `session_diff` and `todo` companions.
  Artifact: `pnpm --filter @cchistory/source-adapters test`

- Task: add higher-layer regressions when OpenCode parsing changes user-visible flows
  Status: done
  Acceptance: `pnpm --filter @cchistory/cli test` and/or
  `pnpm --filter @cchistory/storage test` pass when sample-driven parser
  changes affect operator-visible behavior.
  Artifact: targeted CLI/storage validation commands

### KR: R1-KR3 OpenClaw unblock and truthful support-tier decisions
Status: done
Acceptance: real OpenClaw samples are recorded truthfully and converted into
explicit next-step parser, fixture, and support-tier work, while OpenCode's
stable-tier promotion stays backed by the R1 evidence checklist, validation
commands, and consistent support-surface updates.

- Task: record the 2026-03-31 shared-vs-split decision after archive review
  Status: done
  Acceptance: `BACKLOG.md` and
  `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md` record that OpenCode now
  has executable stabilization work while OpenClaw remains blocked on sample
  acquisition.
  Artifact: `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md`

- Task: obtain real OpenClaw transcript-bearing samples for Phase 1 analysis
  Status: done
  Acceptance: a real OpenClaw archive exists locally under
  `.realdata/openclaw_backup.tar.gz`, created from `~/.openclaw`, and it
  contains transcript-bearing `agents/*/sessions/*.jsonl` evidence suitable for
  Phase 1 structure review.
  Artifact: `.realdata/openclaw_backup.tar.gz`

- Task: document the OpenClaw sample handoff and unblock contract
  Status: done
  Acceptance: `docs/guide/inspection.md` and
  `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md` tell the operator and the
  next agent exactly which OpenClaw collection command to run, what transcript-
  bearing roots and manifest evidence must appear, and that further OpenClaw
  stabilization work remains blocked until that bundle exists.
  Artifact: `docs/guide/inspection.md`, `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md`

- Task: analyze the real OpenClaw archive and finish OpenClaw-specific R1 decomposition
  Status: done
  Acceptance: `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md` and `BACKLOG.md` record that `.realdata/openclaw_backup.tar.gz` contains real OpenClaw typed-event session transcripts under `agents/main/sessions/*.jsonl`, config/model companions under `agents/*/agent/*.json`, lifecycle variants under `.reset.*` / `.deleted.*`, and the resulting next-step parser/fixture/support-tier tasks.
  Artifact: `.realdata/openclaw_backup.tar.gz`, `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md`, `BACKLOG.md`

- Task: evaluate OpenClaw promotion readiness after the sample-backed validation slice
  Status: done
  Acceptance: `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md` and `BACKLOG.md` record whether OpenClaw satisfies the R1 promotion checklist after the real-archive-backed fixture/parser/regression work or which exact checklist items still keep it `experimental`.
  Artifact: `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md`, `BACKLOG.md`

- Task: capture OpenClaw lifecycle variants and agent companion metadata as evidence-only artifacts
  Status: done
  Acceptance: OpenClaw discovery/intake preserves `.reset.*` / `.deleted.*` lifecycle files plus `agents/*/agent/{auth-profiles,models}.json` as evidence-bearing blobs or equivalent evidence records without treating them as active transcript sessions, and `pnpm --filter @cchistory/source-adapters test` passes.
  Artifact: `pnpm --filter @cchistory/source-adapters test`

- Task: update OpenClaw support claims after the completed sample-backed validation slice
  Status: done
  Acceptance: OpenClaw moves to `stable` only if the registry, `mock_data/stable-adapter-validation.json`, runtime surface, release gate, README surfaces, and `docs/sources/` all agree on that tier, with `pnpm run verify:support-status` passing.
  Artifact: `pnpm run verify:support-status`

- Task: evaluate OpenCode promotion readiness after the completed real-data slice
  Status: done
  Acceptance: `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md` and
  `BACKLOG.md` record whether OpenCode now satisfies the R1 promotion checklist
  or which specific checklist items still keep it `experimental`, so the next
  support-tier move is explicit instead of implied by stale pre-fixture notes.
  Artifact: `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md`, `BACKLOG.md`

- Task: update OpenCode support claims after the completed platform-specific validation slice
  Status: done
  Acceptance: OpenCode moves to `stable` only if the registry,
  `mock_data/stable-adapter-validation.json`, runtime surface, release gate,
  README surfaces, and `docs/sources/` all agree on that tier, with
  `pnpm run verify:support-status` passing.
  Artifact: `pnpm run verify:support-status`

- Task: sync roadmap wording after the OpenCode stable promotion
  Status: done
  Acceptance: `docs/ROADMAP.md` no longer describes OpenCode as an unfinished
  experimental hardening target when the backlog, registry, and support-status
  surfaces already mark it `stable`; the remaining roadmap-owned source gap is
  stated truthfully as OpenClaw plus the other still-experimental adapters.
  Artifact: `docs/ROADMAP.md`

- Task: sync inspection-guide wording after the OpenCode stable promotion
  Status: done
  Acceptance: `docs/guide/inspection.md` no longer describes OpenCode sample
  collection as an experimental-source-only validation path once OpenCode is
  `stable`; the guide should instead describe it as source research / evidence
  collection that still applies to stable or experimental sources.
  Artifact: `docs/guide/inspection.md`

### KR: R1-KR4 OpenClaw sample-backed fixture and parser proof
Status: done
Acceptance: the real `.realdata/openclaw_backup.tar.gz` archive is represented
by anonymized OpenClaw fixtures and sample-backed parser/discovery regressions,
including truthful handling of typed event streams, workspace/model signals, and
a documented active-session rule for lifecycle variants.

- Task: create anonymized OpenClaw fixtures from the reviewed real archive
  Status: done
  Acceptance: `mock_data/.openclaw/` gains only the scenarios justified by
  `.realdata/openclaw_backup.tar.gz`, including a typed event-stream session, a
  lifecycle-variant (`.reset.*` or `.deleted.*`) policy case, and
  prompt-error/toolResult coverage, and `pnpm run mock-data:validate` passes.
  Artifact: `mock_data/.openclaw/`

- Task: add OpenClaw discovery and parser regressions for the real archive event mix
  Status: done
  Acceptance: `pnpm --filter @cchistory/source-adapters test` passes with
  coverage for `session`, `model_change`, `thinking_level_change`, `custom`,
  and `message` event streams, `session.cwd` workspace signals, `toolResult`
  role handling, and the current truthful rule that only active `sessions/*.jsonl`
  files participate in transcript ingestion while `.reset.*` / `.deleted.*`
  remain out of active-session parsing.
  Artifact: `pnpm --filter @cchistory/source-adapters test`

- Task: add higher-layer regressions when OpenClaw parsing changes user-visible flows
  Status: done
  Acceptance: `pnpm --filter @cchistory/cli test` and/or
  `pnpm --filter @cchistory/storage test` pass if sample-backed OpenClaw
  parsing changes affect project linking, source summaries, search, or
  export/import readability.
  Artifact: targeted CLI/storage validation commands

---

## Objective: B11 - Post-OpenCode-Promotion Historical Doc Parity
Status: done
Priority: P1
Source: KR review sweep on 2026-04-01
Completed: 2026-04-01

A repository-wide KR sweep after the OpenCode stable promotion found that some
historical design notes still describe the old support roster, including six
stable adapters and nine total adapters. Those notes are not checked by
`pnpm run verify:support-status`, but they still guide future agents and can
misstate the validation history if left stale.

### KR: B11-KR1 Historical release-gate notes reflect the current support roster
Status: done
Acceptance: the historical design notes that explain Gate 5 and Gate 6 no
longer describe the pre-OpenCode-promotion adapter counts or tier split, and
their wording remains truthful about what the verifier does and does not check.

- Task: sync G5 and G6 historical design notes after the OpenCode promotion
  Status: done
  Acceptance: `docs/design/G5_REAL_WORLD_ADAPTER_VALIDATION.md` and
  `docs/design/G6_DOCUMENTATION_CONSISTENCY_VERIFICATION.md` reflect the current
  adapter roster and support-tier counts without pretending those notes are the
  live source of truth; any remaining limitations about verifier scope stay
  explicit.
  Artifact: `docs/design/G5_REAL_WORLD_ADAPTER_VALIDATION.md`, `docs/design/G6_DOCUMENTATION_CONSISTENCY_VERIFICATION.md`

---

## Objective: B12 - Post-OpenCode-Promotion Windows Guide Parity
Status: done
Priority: P1
Source: KR review sweep on 2026-04-01
Completed: 2026-04-01

A repository-wide sweep after the OpenCode stable promotion found that some
operator-facing Windows notes still refer to "all experimental adapters" in a
way that accidentally includes OpenCode. Those notes should match the current
support surface: OpenCode is stable but still requires explicit Windows source
root confirmation.

### KR: B12-KR1 Windows operator guides match the current OpenCode tier
Status: done
Acceptance: the CLI and web Windows notes no longer imply that OpenCode is part
of the experimental-adapter bucket, while still warning operators not to trust
Windows auto-discovery for OpenCode without an explicit override.

- Task: sync CLI and web Windows guidance after the OpenCode stable promotion
  Status: done
  Acceptance: `docs/guide/cli.md` and `docs/guide/web.md` describe Windows
  guidance in a way that keeps OpenCode stable-but-manual, instead of lumping it
  into the generic experimental-adapter wording.
  Artifact: `docs/guide/cli.md`, `docs/guide/web.md`

---

## Objective: B13 - R1 Design Note Internal Consistency After OpenCode Promotion
Status: done
Priority: P1
Source: KR review sweep on 2026-04-01
Completed: 2026-04-01

A follow-up sweep found that `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md`
still contains pre-promotion OpenCode instructions in the middle of the note,
even though the same note now concludes that OpenCode is stable and no longer
the active problem under `R1`.

### KR: B13-KR1 R1 design note tells one consistent story
Status: done
Acceptance: the R1 design note preserves useful historical context, but it no
longer instructs future agents to treat OpenCode as the active stabilization
slice when the note's current-state sections already say the remaining work is
only OpenClaw sample acquisition.

- Task: reconcile pre-promotion OpenCode guidance inside the R1 design note
  Status: done
  Acceptance: `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md` keeps the
  archive-review history and checklist value, while removing or reframing the
  outdated lines that still tell future agents to unblock or continue R1 through
  OpenCode-specific collection and stabilization work.
  Artifact: `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md`

---

## Objective: B14 - R1 Support-Claim Section Parity After OpenCode Promotion
Status: done
Priority: P1
Source: KR review sweep on 2026-04-01
Completed: 2026-04-01

A follow-up sweep found that the support-claims subsection inside
`docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md` still instructs agents to
keep both OpenClaw and OpenCode experimental, even though the same note and the
current support surfaces already mark OpenCode stable.

### KR: B14-KR1 R1 support-claim guidance matches current tiers
Status: done
Acceptance: the R1 design note's support-claims subsection no longer tells
future agents to keep OpenCode experimental, while it still preserves the rule
that OpenClaw stays experimental until real samples exist and future tier
changes must follow the evidence checklist.

- Task: sync the R1 support-claims subsection after the OpenCode promotion
  Status: done
  Acceptance: `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md` states the
  current support-tier rule truthfully in the support-claims subsection instead
  of repeating the pre-promotion OpenClaw/OpenCode pairing.
  Artifact: `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md`

---

## Objective: B15 - Roadmap Gemini Adapter Status Parity
Status: done
Priority: P1
Source: KR review sweep on 2026-04-01
Completed: 2026-04-01

A full-project KR review sweep found that `docs/ROADMAP.md` still said "新增 `gemini cli` 适配" even though the Gemini adapter already exists in the registry, runtime surface, CLI surfaces, and backlog as an implemented but still `experimental` source. The roadmap now describes the remaining Gemini work truthfully as hardening and real-world validation, not first-time adapter delivery.

### KR: B15-KR1 Roadmap wording matches the implemented Gemini slice
Status: done
Acceptance: `docs/ROADMAP.md` no longer describes Gemini CLI as a not-yet-implemented adapter; it instead states the truthful remaining work for Gemini as experimental-source hardening and/or real-world validation.

- Task: sync roadmap wording for the implemented Gemini adapter
  Status: done
  Acceptance: the "适配更多的源" section in `docs/ROADMAP.md` describes Gemini as an existing experimental adapter whose next work is validation/hardening, rather than saying CCHistory still needs to add Gemini CLI support from scratch.
  Artifact: `docs/ROADMAP.md`

---

## Objective: B16 - R5 Gemini Design Note Historical Framing Parity
Status: done
Priority: P1
Source: KR review sweep on 2026-04-01
Completed: 2026-04-01

A full-project KR review sweep found that `docs/design/R5_GEMINI_CLI_ADAPTER.md` still opened with present-tense statements from the pre-implementation design phase, including claims that the registry did not yet include a sync-supported Gemini adapter and that the CLI only documented Gemini as discovery-only. Those lines were misleading because the same note later recorded KR completion and post-completion corrections. The note now preserves its historical design/decomposition value while framing those early statements explicitly as past-state context.

### KR: B16-KR1 R5 Gemini design note tells one time-consistent story
Status: done
Acceptance: the opening sections of `docs/design/R5_GEMINI_CLI_ADAPTER.md` no longer read as current repository state when they actually describe the original 2026-03-27 decomposition point; the note should remain useful historical evidence without misleading future agents about current Gemini support.

- Task: reframe stale present-tense R5 Gemini design note sections as historical context
  Status: done
  Acceptance: `docs/design/R5_GEMINI_CLI_ADAPTER.md` explicitly marks its pre-implementation problem statement, existing-state bullets, and fixture-gap wording as historical context from the original decomposition point instead of current repo state.
  Artifact: `docs/design/R5_GEMINI_CLI_ADAPTER.md`

---

## Objective: B17 - R7 Skill Packaging Design Note Historical Framing Parity
Status: done
Priority: P1
Source: KR review sweep on 2026-04-01
Completed: 2026-04-01

A full-project KR review sweep found that `docs/design/R7_AI_FRIENDLY_SKILL_PACKAGING.md` still contained present-tense decomposition-phase statements claiming there is no product-owned `skills/` inventory and no repo-owned workflow packaging, even though the same note later records `R7-KR1` through `R7-KR3` as implemented and the repository now contains the top-level `skills/` directory plus four packaged skills. The note now preserves its original design reasoning while marking those early statements as historical context instead of current repository state.

### KR: B17-KR1 R7 design note tells one time-consistent story
Status: done
Acceptance: the opening sections of `docs/design/R7_AI_FRIENDLY_SKILL_PACKAGING.md` no longer read as current repository state when they are actually describing the pre-implementation 2026-03-27 decomposition point.

- Task: reframe stale present-tense R7 skill-packaging design note sections as historical context
  Status: done
  Acceptance: `docs/design/R7_AI_FRIENDLY_SKILL_PACKAGING.md` explicitly marks its early "already implemented" and "gaps found" statements as decomposition-time context so they do not contradict the later implementation record.
  Artifact: `docs/design/R7_AI_FRIENDLY_SKILL_PACKAGING.md`

---

## Objective: B18 - R10 Workflow Design Note Status Parity
Status: done
Priority: P1
Source: KR review sweep on 2026-04-01
Completed: 2026-04-01

A full-project KR review sweep found that `docs/design/R10_SINGLE_COMMAND_OPERATOR_WORKFLOWS.md` still opened with stale status text saying the note was `active` and that `R10-KR3` remained pending, even though `BACKLOG.md` records `R10` as done on 2026-03-29 with `health`, `backup`, and `restore-check` all implemented. The note now preserves its design and contract history while presenting its top-level status and early gap statements as either current truth or explicit historical context.

### KR: B18-KR1 R10 design note matches delivered workflow status
Status: done
Acceptance: the opening status and decomposition-phase wording in `docs/design/R10_SINGLE_COMMAND_OPERATOR_WORKFLOWS.md` no longer contradict the completed `R10` backlog record; future agents can read the note without thinking backup and restore workflow commands are still pending.

- Task: reframe stale R10 workflow-note status and early gap wording
  Status: done
  Acceptance: `docs/design/R10_SINGLE_COMMAND_OPERATOR_WORKFLOWS.md` shows the objective as completed, and its early problem/gap statements are marked as decomposition-time context where needed instead of current repository state.
  Artifact: `docs/design/R10_SINGLE_COMMAND_OPERATOR_WORKFLOWS.md`

---

## Objective: B19 - R6 Parser Design Note Status Parity
Status: done
Priority: P1
Source: KR review sweep on 2026-04-01
Completed: 2026-04-01

A full-project KR review sweep found that `docs/design/R6_GENERIC_PARSER_ABSTRACTION.md` still opened with stale status text saying the note was `active` and that only the first executable slice had been identified, even though the same note later records KR1-KR3 implementation and Phase 7 completion while `BACKLOG.md` marks `R6` done. The note now preserves its decomposition and execution history while aligning its top-level status and early framing with the delivered objective state.

### KR: B19-KR1 R6 design note matches completed parser-family work
Status: done
Acceptance: the opening status and early decomposition wording in `docs/design/R6_GENERIC_PARSER_ABSTRACTION.md` no longer contradict the completed `R6` backlog record; future agents can read the note without thinking the parser-family extraction is still only at the first-slice stage.

- Task: reframe stale R6 parser-note status and early decomposition wording
  Status: done
  Acceptance: `docs/design/R6_GENERIC_PARSER_ABSTRACTION.md` shows the objective as completed, and its early problem/gap statements are marked as decomposition-time context where needed instead of current repository state.
  Artifact: `docs/design/R6_GENERIC_PARSER_ABSTRACTION.md`

---

## Objective: B20 - R8 Windows Design Note Closure Parity
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A full-project KR review sweep on 2026-04-02 found that `docs/design/R8_WINDOWS_COMPATIBILITY.md` still opened and concluded as if the UNC file-URI authority fix were an unresolved follow-up, even though the same note records the corrective closure on 2026-03-28 and `BACKLOG.md` marks `R8` done. The note now preserves the historical review sequence while making its top-level status and conclusion truthful for the current repository-visible state.

### KR: B20-KR1 R8 design note reflects the post-correction closed state
Status: done
Acceptance: `docs/design/R8_WINDOWS_COMPATIBILITY.md` no longer tells future agents that `R8` still requires corrective follow-up when the corrective work is already recorded as landed and the backlog marks the objective done.

- Task: sync R8 top-level status and conclusion after the UNC corrective closure
  Status: done
  Acceptance: `docs/design/R8_WINDOWS_COMPATIBILITY.md` states the current objective state truthfully at the top and in the conclusion, while retaining the historical note that UNC was once a blocking follow-up before the 2026-03-28 correction landed.
  Artifact: `docs/design/R8_WINDOWS_COMPATIBILITY.md`

---

## Objective: B21 - R1 Design Note Support-Claim Parity After OpenClaw Promotion
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A post-promotion KR sweep found one remaining stale support-claim section in
`docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md`: the note's later
operator-facing inventory still told future agents to keep OpenClaw marked
`experimental` and below the stable-doc bar even though the same note, the
registry, the support-status surfaces, and `BACKLOG.md` now record OpenClaw as
`stable`. The note should preserve its historical review trail while keeping its
current support-claim guidance internally consistent.

### KR: B21-KR1 R1 support-claim guidance matches the OpenClaw stable promotion
Status: done
Acceptance: the late support-claim subsection in
`docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md` no longer instructs future
agents to keep OpenClaw `experimental` once the note's own promotion record and
repository support surfaces mark it `stable`.

- Task: reconcile stale late-section OpenClaw support guidance inside the R1 note
  Status: done
  Acceptance: the R1 note keeps its historical review context, but its later
  support-claim inventory now reflects that both OpenCode and OpenClaw have
  completed the current stable-promotion slice.
  Artifact: `docs/design/R1_OPENCODE_OPENCLAW_STABILIZATION.md`

---

## Objective: B22 - T1 Scope Note Status Parity
Status: done
Priority: P2
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR sweep found that `docs/design/T1_TUI_SCOPE_AND_WORKFLOW_INVENTORY.md`
still labeled its top-level backlog status as `decomposing` even though the
canonical TUI objective is already delivered and `BACKLOG.md` marks `T1` done.
The note should preserve its Phase 1 workflow inventory while making its
current-state framing truthful for the repository-visible status.

### KR: B22-KR1 T1 scope note matches delivered objective state
Status: done
Acceptance: `docs/design/T1_TUI_SCOPE_AND_WORKFLOW_INVENTORY.md` keeps its
workflow inventory intact, but its top-level status and phase summary align with
`BACKLOG.md` now that `T1` is complete.

- Task: sync T1 scope note top-level status after TUI delivery
  Status: done
  Acceptance: the note states `T1` is done and frames itself as historical
  scope/decomposition context for the delivered first slice rather than an
  still-active decomposition note.
  Artifact: `docs/design/T1_TUI_SCOPE_AND_WORKFLOW_INVENTORY.md`

---

## Objective: B23 - Roadmap Delivered-Objective Parity
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR sweep found that `docs/ROADMAP.md` still described several
already-delivered objectives as if they were upcoming roadmap work, including
CLI fuzzy search and direct session access, bug-intake setup, the Windows
compatibility baseline, export/import improvements, single-command operator
workflows, installation-channel expansion, the first tree-view slice, the
shared parser abstraction, and the initial AI-friendly skill packaging
baseline. The roadmap should remain directional, but
its wording must distinguish shipped baseline slices from future follow-up.

### KR: B23-KR1 Roadmap wording matches delivered baseline slices
Status: done
Acceptance: `docs/ROADMAP.md` no longer presents completed objectives as wholly
unfinished roadmap items; it instead records the delivered baseline and reserves
future wording for genuine remaining follow-up.

- Task: reframe delivered roadmap bullets as baseline-complete follow-up areas
  Status: done
  Acceptance: roadmap bullets for CLI fuzzy search/session access, bug intake,
  Windows compatibility, export/import, single-command workflows, installation
  channels, tree view, parser abstraction, and AI-friendly skills reflect the
  shipped baseline while preserving any truthful future direction.
  Artifact: `docs/ROADMAP.md`

---

## Objective: R15 - Gemini Stable Promotion Review
Status: done
Priority: P1
Source: ROADMAP.md
Completed: 2026-04-02

Gemini CLI has now completed the support-surface closure needed to move from `experimental` to `stable`. The promotion review confirmed that the existing local-host review, 2026-03-31 real archive review, companion-evidence capture, sanitized fixtures, and parser regressions satisfy the current stable-adapter bar on this host review path.

### KR: R15-KR1 Gemini promotion-readiness evaluation and gap decomposition
Status: done
Acceptance: `docs/design/R5_GEMINI_CLI_ADAPTER.md` and `BACKLOG.md` record
whether Gemini now satisfies the current stable-promotion checklist after the
existing evidence-backed slice, or which exact checklist items still keep it
`experimental`.

- Task: review current Gemini evidence, fixture, and regression coverage against the stable-adapter checklist
  Status: done
  Acceptance: `docs/design/R5_GEMINI_CLI_ADAPTER.md` and `BACKLOG.md` state whether the existing local-host review, 2026-03-31 real archive review, sanitized fixture set, companion-evidence capture, and parser regressions are enough for stable promotion, with any remaining gap stated as explicit checklist items instead of generic caution.
  Artifact: `docs/design/R5_GEMINI_CLI_ADAPTER.md`, `BACKLOG.md`

- Task: add Gemini stable-promotion follow-up tasks if the review finds uncovered gaps
  Status: done
  Acceptance: any remaining Gemini blockers become truthful `ready`/`pending` backlog tasks for missing evidence, parser coverage, source docs, or support-surface closure instead of lingering as vague “needs more validation” wording.
  Artifact: `BACKLOG.md`, `apps/cli/src/index.test.ts`, `packages/source-adapters/src/core/legacy.ts`, `packages/storage/src/internal/storage.ts`

### KR: R15-KR2 Gemini support-surface closure if the promotion review passes
Status: done
Acceptance: Gemini moves to `stable` only if the registry, `mock_data/stable-adapter-validation.json`, runtime surface, release gate, README surfaces, and `docs/sources/` all agree on that tier, with verification commands passing.

- Task: update Gemini support claims after a successful promotion review
  Status: done
  Acceptance: Gemini moves to `stable` only if the registry, `mock_data/stable-adapter-validation.json`, runtime surface, release gate, README surfaces, and `docs/sources/` all agree on that tier, with `pnpm run verify:support-status` and `pnpm --filter @cchistory/source-adapters test` passing.
  Artifact: `pnpm run verify:support-status`

- Task: sync roadmap wording after the Gemini stable promotion
  Status: done
  Acceptance: `docs/ROADMAP.md` no longer lists Gemini among the remaining experimental hardening targets once the registry and support surfaces mark it `stable`; any remaining source gap is stated truthfully as Lobechat, CodeBuddy, or future Gemini drift follow-up.
  Artifact: `docs/ROADMAP.md`

---

## Objective: B24 - R5 Design Note Stable-Tier Parity After Gemini Promotion
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A post-promotion KR sweep found that `docs/design/R5_GEMINI_CLI_ADAPTER.md`
still preserved several 2026-03 execution-stage statements in present tense,
including results text that said Gemini was `experimental` and a compatibility
assessment that treated the experimental tier as the current support surface.
Those statements are useful historical execution evidence, but the note now
needs explicit framing so they do not contradict Gemini's 2026-04-02 stable
promotion record.

### KR: B24-KR1 R5 historical execution text no longer contradicts current tier
Status: done
Acceptance: `docs/design/R5_GEMINI_CLI_ADAPTER.md` keeps its historical KR2/KR3
and Phase 7 narrative, but those sections no longer read as the current support
state once Gemini has moved to `stable`.

- Task: reframe stale present-tense Gemini support-tier statements inside the R5 note
  Status: done
  Acceptance: the R5 note preserves its execution history, but the current tier
  and support-surface guidance now read consistently from top to bottom after
  the Gemini stable promotion.
  Artifact: `docs/design/R5_GEMINI_CLI_ADAPTER.md`

---

## Objective: R16 - CodeBuddy Stable Promotion Review
Status: done
Priority: P1
Source: ROADMAP.md
Completed: 2026-04-02

CodeBuddy has now completed the support-surface closure needed to move from `experimental` to `stable`. The promotion review confirmed that the existing local-host archive under `.realdata/config_dots_20260331_212353/.codebuddy`, the 2026-03-31 archive review note, companion-evidence capture, sanitized fixtures, collector support, and parser regressions satisfy the current stable-adapter bar on this host review path.

### KR: R16-KR1 CodeBuddy promotion-readiness evaluation and gap decomposition
Status: done
Acceptance: `docs/design/R14_CODEBUDDY_TRANSCRIPT_INTAKE.md` and `BACKLOG.md` record whether CodeBuddy now satisfies the current stable-promotion checklist after the existing local-host review, 2026-03-31 archive review, sanitized fixtures, companion-evidence capture, and parser regressions, or which exact checklist items still keep it `experimental`.

- Task: review current CodeBuddy evidence, fixture, and regression coverage against the stable-adapter checklist
  Status: done
  Acceptance: `docs/design/R14_CODEBUDDY_TRANSCRIPT_INTAKE.md` and `BACKLOG.md` state whether the existing real local archive, 2026-03-31 archive review, sanitized fixture set, companion-evidence capture, and parser regressions are enough for stable promotion, with any remaining gap stated as explicit checklist items instead of generic caution.
  Artifact: `docs/design/R14_CODEBUDDY_TRANSCRIPT_INTAKE.md`, `BACKLOG.md`

- Task: add CodeBuddy stable-promotion follow-up tasks if the review finds uncovered gaps
  Status: done
  Acceptance: any remaining CodeBuddy blockers become truthful `ready`/`pending` backlog tasks for missing evidence, parser coverage, source docs, or support-surface closure instead of lingering as vague “needs more validation” wording.
  Artifact: `BACKLOG.md`

### KR: R16-KR2 CodeBuddy support-surface closure if the promotion review passes
Status: done
Acceptance: CodeBuddy moves to `stable` only if the registry, `mock_data/stable-adapter-validation.json`, runtime surface, release gate, README surfaces, and `docs/sources/` all agree on that tier, with verification commands passing.

- Task: update CodeBuddy support claims after a successful promotion review
  Status: done
  Acceptance: CodeBuddy moves to `stable` only if the registry, `mock_data/stable-adapter-validation.json`, runtime surface, release gate, README surfaces, and `docs/sources/` all agree on that tier, with `pnpm run verify:support-status` and `pnpm --filter @cchistory/source-adapters test` passing.
  Artifact: `pnpm run verify:support-status`

- Task: sync roadmap wording after the CodeBuddy stable promotion
  Status: done
  Acceptance: `docs/ROADMAP.md` no longer lists CodeBuddy among the remaining experimental hardening targets once the registry and support surfaces mark it `stable`; any remaining source gap is stated truthfully as LobeChat or future CodeBuddy drift follow-up.
  Artifact: `docs/ROADMAP.md`

---

## Objective: B25 - R12 Design Note Stable-Tier Parity After CodeBuddy Promotion
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A post-promotion KR sweep found that `docs/design/R12_COLLECTOR_SLOT_DECISION_2026-04-01.md` still described CodeBuddy as if it were currently a new experimental platform candidate. That line is useful historical context for the collector-slot decision, but it now needs explicit past-tense framing so it does not contradict the 2026-04-02 stable promotion record.

### KR: B25-KR1 R12 historical collector note no longer contradicts current tier
Status: done
Acceptance: the R12 note keeps its historical collector-slot reasoning, but its CodeBuddy language no longer reads as the current support state once CodeBuddy is `stable`.

- Task: reframe stale present-tense CodeBuddy tier wording inside the R12 note
  Status: done
  Acceptance: `docs/design/R12_COLLECTOR_SLOT_DECISION_2026-04-01.md` preserves the historical collector-slot decision while making it explicit that CodeBuddy was experimental at the time of the note and is no longer the current tier statement.
  Artifact: `docs/design/R12_COLLECTOR_SLOT_DECISION_2026-04-01.md`

---

## Objective: R17 - LobeChat Real-Sample Validation And Promotion Decision
Status: active
Priority: P2
Source: ROADMAP.md, user direction on 2026-04-02

With CodeBuddy now promoted to `stable`, the remaining roadmap-owned source gap is `lobechat`. The repository still exposes a truthful experimental LobeChat export parser surface, but no active objective currently owns the missing real-sample review, collection contract, or stable-promotion decision.

User note on 2026-04-02: keep this objective non-blocking for now and prioritize other roadmap-owned gaps until new real LobeChat evidence is provided.

User directive on 2026-04-03: LobeChat is explicitly out of scope unless the user later provides real local data for review. Agents must not spend additional KR-sweep or corrective-work time on `R17` beyond preserving the already-recorded experimental boundary and blocker note. Missing real LobeChat data is not a blocker for continuing broader project work.

### KR: R17-KR1 LobeChat current-slice evaluation and blocker decomposition
Status: done
Acceptance: `docs/design/R17_LOBECHAT_EXPORT_VALIDATION.md` and `BACKLOG.md` record the current LobeChat parser boundary, fixture/probe baseline, and the exact missing evidence that still blocks any move beyond `experimental`.

- Task: review current LobeChat adapter, fixture, and parser assumptions against the stable-adapter checklist
  Status: done
  Acceptance: `docs/design/R17_LOBECHAT_EXPORT_VALIDATION.md` and `BACKLOG.md` state whether the current `~/.config/lobehub-storage` root assumption, generic export parser path, and synthetic test fixture are enough for anything beyond the present experimental claim, with every blocker named explicitly.
  Artifact: `docs/design/R17_LOBECHAT_EXPORT_VALIDATION.md`, `BACKLOG.md`

- Task: add truthful follow-up tasks for the missing LobeChat evidence path
  Status: done
  Acceptance: the backlog names the remaining LobeChat gaps as concrete sample-collection, structure-review, fixture/regression, and support-surface tasks instead of leaving the roadmap gap unowned.
  Artifact: `BACKLOG.md`

### KR: R17-KR2 LobeChat real-sample collection and structure review
Status: open
Acceptance: a real LobeHub/LobeChat sample bundle is collected and reviewed so the repository can verify whether the current root candidate, export shape, and parser boundary are truthful.

- Task: collect a real LobeHub/LobeChat export or local-root sample bundle on a host with actual data
  Status: blocked
  Acceptance: a reviewed evidence bundle exists for the current LobeChat source family, including the transcript-bearing export files and any nearby config/index JSON needed to understand root layout and collection boundaries.
  Artifact: operator-provided sample bundle or archive path

- Task: extend the sample-collection helper to stage candidate LobeChat evidence for operator review
  Status: done
  Acceptance: `scripts/inspect/collect-source-samples.mjs` and its tests can collect candidate `lobechat` JSON evidence from the current unverified local-root assumption without over-claiming transcript boundaries, so operators can hand over a review bundle before parser/promotion work starts.
  Artifact: future `scripts/inspect/collect-source-samples.mjs`, `scripts/inspect/collect-source-samples.test.mjs`

- Task: analyze the collected LobeChat sample and finish structure/backlog decomposition
  Status: pending
  Acceptance: `docs/design/R17_LOBECHAT_EXPORT_VALIDATION.md` and `BACKLOG.md` record which files are transcript-bearing, whether `~/.config/lobehub-storage` is the truthful default root on the reviewed host, whether the generic export parser is sufficient, and which fixture/parser changes become executable next.
  Artifact: `docs/design/R17_LOBECHAT_EXPORT_VALIDATION.md`, `BACKLOG.md`

### KR: R17-KR3 LobeChat fixture, regression, and support-tier closure if real-data review passes
Status: open
Acceptance: LobeChat moves beyond the current experimental slice only if sanitized sample-backed fixtures, parser regressions, and support surfaces all align with the reviewed real-data layout.

- Task: add sanitized LobeChat fixtures and parser regressions after real-data review
  Status: pending
  Acceptance: `mock_data/` and `pnpm --filter @cchistory/source-adapters test` gain only the LobeChat scenarios justified by reviewed real samples, including any export-bundle edge cases or companion/index files that affect truthful parsing.
  Artifact: `mock_data/`, `pnpm --filter @cchistory/source-adapters test`

- Task: update LobeChat support claims after any future promotion decision
  Status: pending
  Acceptance: LobeChat changes tier only if the registry, `mock_data/stable-adapter-validation.json`, runtime surface, release gate, README surfaces, and `docs/sources/` all agree on the reviewed evidence basis, with `pnpm run verify:support-status` passing.
  Artifact: `pnpm run verify:support-status`

---

## Objective: B26 - Sources Summary Count Parity After CodeBuddy Promotion
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR sweep found that `docs/sources/README.md` still summarized the support roster as 9 `stable` adapters and 2 `experimental` adapters even though CodeBuddy moved to `stable` on 2026-04-02. The per-source tables below were already correct, but the top-level summary line contradicted the current support surface. That summary now matches the current 11-adapter roster.

### KR: B26-KR1 Sources README summary matches the current support roster
Status: done
Acceptance: the top-level summary in `docs/sources/README.md` matches the current 11-adapter roster with 10 `stable` sources documented here and only 1 remaining `experimental` source excluded.

- Task: sync the `docs/sources/README.md` top-level support-count summary after the CodeBuddy promotion
  Status: done
  Acceptance: the opening summary line in `docs/sources/README.md` states the current 11-adapter roster truthfully as 10 `stable` and 1 `experimental`, consistent with the stable-source table and exclusion list below.
  Artifact: `docs/sources/README.md`

---

## Objective: B27 - Runtime Surface Header Date Parity After CodeBuddy Promotion
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR sweep found that `docs/design/CURRENT_RUNTIME_SURFACE.md` still said the runtime inventory was recorded "as of 2026-04-01" even though the same document already included the 2026-04-02 CodeBuddy stable-promotion state. The header date now matches the latest repository-visible support roster in that document.

### KR: B27-KR1 Runtime surface header date matches the documented support roster
Status: done
Acceptance: the opening date in `docs/design/CURRENT_RUNTIME_SURFACE.md` truthfully reflects the latest repository-visible support roster already recorded in that document.

- Task: sync the `docs/design/CURRENT_RUNTIME_SURFACE.md` header date after the CodeBuddy promotion
  Status: done
  Acceptance: the runtime-surface intro no longer claims an `as of 2026-04-01` snapshot once the same document includes the 2026-04-02 CodeBuddy stable-support state.
  Artifact: `docs/design/CURRENT_RUNTIME_SURFACE.md`

---

## Objective: B28 - CLI And Web Windows Guide Parity After Later Stable Promotions
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR sweep found that `docs/guide/web.md` and `docs/guide/cli.md` still described Windows manual-root guidance using the older wording "the still-experimental adapters, and OpenCode". After the Gemini, OpenClaw, and CodeBuddy promotions, that wording was no longer truthful because several `stable` adapters still require explicit Windows confirmation. The operator guides now match the current manual-root roster.

### KR: B28-KR1 Operator-facing Windows notes match the current manual-root roster
Status: done
Acceptance: the Windows notes in the CLI and web guides distinguish verified-auto-discovery adapters (`cursor`, `antigravity`) from all adapters that still require explicit Windows source-root confirmation, without using stale experimental-vs-stable grouping language.

- Task: sync CLI and web Windows guidance after the Gemini, OpenClaw, and CodeBuddy promotions
  Status: done
  Acceptance: `docs/guide/web.md` and `docs/guide/cli.md` tell operators to confirm or override `base_dir` on Windows for `codex`, `claude_code`, `factory_droid`, `amp`, `gemini`, `openclaw`, `opencode`, `codebuddy`, and `lobechat`, rather than referring generically to the older experimental bucket plus OpenCode.
  Artifact: `docs/guide/web.md`, `docs/guide/cli.md`

---

## Objective: B29 - Historical Backlog Tier Parity After Gemini And CodeBuddy Promotions
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR sweep found that the completed objective summaries for `R5 - Gemini CLI Adapter` and `R14 - CodeBuddy Transcript Intake` still used present-tense wording that said those adapters were `experimental`. Those statements were accurate at the time those objectives closed, but they contradicted the current support roster elsewhere in the same backlog. The summaries now preserve their execution history while making the later stable promotions explicit.

### KR: B29-KR1 Historical backlog objective summaries no longer contradict current tiers
Status: done
Acceptance: the completed `R5` and `R14` objective summaries preserve their historical execution story while making it explicit that Gemini and CodeBuddy were experimental at that point in time and are no longer the current tier statement.

- Task: reframe stale present-tense tier wording inside the completed R5 and R14 backlog summaries
  Status: done
  Acceptance: `BACKLOG.md` keeps the historical purpose and boundaries of `R5` and `R14`, but those summaries no longer read as the current support state once Gemini and CodeBuddy have separate stable-promotion review objectives recorded later in the same file.
  Artifact: `BACKLOG.md`

---

## Objective: B30 - Historical CodeBuddy Support-Surface Objective Parity After Stable Promotion
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR sweep found that the completed `B3 - CodeBuddy Support-Surface Parity Follow-Up` summary still read as if CodeBuddy's support surfaces currently described it as `experimental`. That was accurate on 2026-04-01, but it contradicted the later 2026-04-02 stable-promotion records. The summary now preserves the support-surface cleanup history while making the later stable move explicit.

### KR: B30-KR1 Historical B3 summary no longer contradicts the current CodeBuddy tier
Status: done
Acceptance: the completed `B3` summary keeps its execution history but makes it explicit that the `experimental` support-surface closure was the state at that time, not the current support roster.

- Task: reframe stale present-tense CodeBuddy tier wording inside the completed B3 backlog summary
  Status: done
  Acceptance: `BACKLOG.md` preserves the purpose of `B3`, but its summary no longer reads as the current support state once the later `R16` stable-promotion record exists in the same backlog.
  Artifact: `BACKLOG.md`

---

## Objective: B31 - Archive Review Note CodeBuddy Tier Parity After Stable Promotion
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR sweep found that `docs/design/REAL_SOURCE_ARCHIVE_REVIEW_2026-03-31.md` still described CodeBuddy as a current candidate for future intake work. That was truthful at the time of the archive review, but it contradicted the later `R14` intake and `R16` stable-promotion records unless the note was framed explicitly as historical state. The note now preserves the archive evidence while making the later progression explicit.

### KR: B31-KR1 Historical archive-review wording no longer contradicts the current CodeBuddy tier
Status: done
Acceptance: the 2026-03-31 archive review note preserves its original evidence findings while making it explicit that CodeBuddy was a candidate at review time and has since progressed to a delivered adapter and later stable promotion.

- Task: reframe stale present-tense CodeBuddy candidate wording inside the archive review note
  Status: done
  Acceptance: `docs/design/REAL_SOURCE_ARCHIVE_REVIEW_2026-03-31.md` keeps its archive-specific evidence claims, but its CodeBuddy wording no longer reads as the current repository state once later intake and promotion work exists elsewhere.
  Artifact: `docs/design/REAL_SOURCE_ARCHIVE_REVIEW_2026-03-31.md`

---

## Objective: B32 - Historical B3 Task Acceptance Parity After CodeBuddy Stable Promotion
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR sweep found that the completed task acceptance lines inside `B3 - CodeBuddy Support-Surface Parity Follow-Up` still read as if the repository should currently reflect CodeBuddy's `experimental` tier. Those acceptance lines were correct for the 2026-04-01 closure point, but they contradicted the later `R16` stable-promotion record unless they were framed explicitly as historical state. The B3 task acceptances now preserve what was verified then without contradicting the current tier.

### KR: B32-KR1 Historical B3 task acceptances no longer contradict the current CodeBuddy tier
Status: done
Acceptance: the completed task acceptance lines under `B3` preserve what was verified on 2026-04-01 while making it explicit that the checked support surfaces matched the then-current experimental tier rather than the present repository state.

- Task: reframe stale present-tense CodeBuddy tier wording inside the completed B3 task acceptances
  Status: done
  Acceptance: `BACKLOG.md` keeps the original B3 verification criteria, but the acceptance text no longer reads as a current requirement that support surfaces should reflect CodeBuddy as `experimental`.
  Artifact: `BACKLOG.md`

---

## Objective: B33 - Backlog Completion-Date Hygiene For Early Delivered Objectives
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR sweep found that several completed objectives still carried duplicate `Completed:` lines in their headers, leaving conflicting completion dates inside one objective record. This was a backlog hygiene issue rather than a product-semantic gap, but it could mislead future agents about when those objectives actually closed. The duplicate dates are now removed.

### KR: B33-KR1 Completed objective headers have one truthful completion date
Status: done
Acceptance: each completed objective header in `BACKLOG.md` has at most one `Completed:` line, and the retained date matches the objective's actual closure record instead of leaving duplicate date drift in place.

- Task: remove duplicate `Completed:` lines from the affected early delivered objectives
  Status: done
  Acceptance: the headers for `R2`, `R3`, `R4`, `R6`, `R9`, and `R8` no longer contain duplicate `Completed:` lines, and each objective keeps exactly one truthful completion date.
  Artifact: `BACKLOG.md`

---

## Objective: B34 - AGENTS Runtime-Surface Parity After TUI Delivery And Stable Promotions
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR sweep found that `AGENTS.md` no longer matched the current repository-visible runtime surface. It still described `apps/` as if the canonical entrypoints stopped at API/Web/CLI, omitted the shipped `apps/tui` validation/runtime guidance, and listed the implemented adapter set without the later delivered `gemini` and `codebuddy` adapters. Because `AGENTS.md` governs future agent behavior in this repository, this drift was corrected immediately so operational guidance stays truthful.

### KR: B34-KR1 AGENTS runtime inventory matches the current shipped surface
Status: done
Acceptance: `AGENTS.md` matches the current runtime surface for canonical entrypoints, package-scoped validation commands, and the implemented adapter roster reflected by `packages/source-adapters/src/platforms/registry.ts` and `docs/design/CURRENT_RUNTIME_SURFACE.md`.

- Task: sync TUI runtime guidance in `AGENTS.md`
  Status: done
  Acceptance: `AGENTS.md` names `apps/tui` as a canonical product entrypoint and includes the truthful package-scoped build/test and local launch guidance already used elsewhere in the repository.
  Artifact: `AGENTS.md`

- Task: sync the implemented-adapter roster in `AGENTS.md`
  Status: done
  Acceptance: `AGENTS.md` no longer omits `gemini` or `codebuddy` from the implemented adapter set, while still preserving that `lobechat` is implemented but remains `experimental`.
  Artifact: `AGENTS.md`

---

## Objective: B35 - Package Test Count Parity In Current Operator Docs
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR sweep re-ran the current package-scoped test suites and found that several current-facing docs still advertised stale test counts from an earlier repository state. `README.md`, `README_CN.md`, and `AGENTS.md` had said the CLI/API/storage/source-adapters suites were much smaller than the suites that actually run today. Those current validation surfaces now match the package-scoped commands that passed during this sweep.

### KR: B35-KR1 Current validation docs reflect the real package test counts
Status: done
Acceptance: `README.md`, `README_CN.md`, and `AGENTS.md` list the current package-scoped test counts truthfully for the suites they enumerate, matching the passing command outputs observed during this sweep.

- Task: sync README test-count examples with the current package suites
  Status: done
  Acceptance: `README.md` and `README_CN.md` no longer claim the old source-adapters, storage, CLI, or API test counts; the listed numbers match the current suite outputs or the wording becomes intentionally count-free where a fixed number would be misleading.
  Artifact: `README.md`, `README_CN.md`

- Task: sync AGENTS validation count hints with the current package suites
  Status: done
  Acceptance: the `### Testing` section in `AGENTS.md` matches the current package-scoped test counts for the suites it enumerates, keeping future-agent guidance aligned with the repository's actual validation surface.
  Artifact: `AGENTS.md`

---

## Objective: B36 - CLI Discovery And GC Surface Parity In Current Runtime Docs
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR sweep found that the current CLI surface is broader than some of the repository's current-facing runtime docs said. `apps/cli/src/index.ts` and `docs/guide/cli.md` already exposed `discover` and `gc`, but `docs/design/CURRENT_RUNTIME_SURFACE.md` had omitted those command families from the canonical CLI inventory, and `AGENTS.md` had still summarized the CLI as if the newer discovery, health, backup/restore, and raw-snapshot maintenance flows were not part of the current operator surface. Those current runtime docs now state the shipped CLI inventory truthfully.

### KR: B36-KR1 Current runtime docs match the shipped CLI command surface
Status: done
Acceptance: `docs/design/CURRENT_RUNTIME_SURFACE.md` and `AGENTS.md` describe the current CLI command surface in a way that matches `apps/cli/src/index.ts` and `docs/guide/cli.md`, including `discover` and `gc` plus the broader operator workflow framing already present in the implementation.

- Task: sync the canonical runtime-surface CLI command-family list
  Status: done
  Acceptance: the `Current command families` list in `docs/design/CURRENT_RUNTIME_SURFACE.md` includes the shipped `discover` and `gc` families in addition to the existing read/query/bundle flows.
  Artifact: `docs/design/CURRENT_RUNTIME_SURFACE.md`

- Task: sync AGENTS CLI and guide-inventory summaries with the current surface
  Status: done
  Acceptance: `AGENTS.md` no longer omits the inspection guide from `docs/guide/`, and its CLI entrypoint summary reflects the current discovery, health, bundle-management, raw-snapshot maintenance, query, and template workflows rather than the older narrower description.
  Artifact: `AGENTS.md`

---

## Objective: B37 - Bug Reporting Guide Index Parity In Current Docs
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR sweep found that `docs/guide/bug-reporting.md` is now a shipped canonical user guide, but the main guide indexes in `README.md`, `README_CN.md`, and `AGENTS.md` still described `docs/guide/` as if it only contained CLI, API, Web, TUI, and inspection material. Because the bug-reporting guide is part of the current user-facing documentation surface delivered by `R9`, omitting it from the guide indexes made the repository's current doc inventory untruthful. The guide indexes now include it.

### KR: B37-KR1 Main guide indexes include the shipped bug-reporting guide
Status: done
Acceptance: `README.md`, `README_CN.md`, and `AGENTS.md` acknowledge `docs/guide/bug-reporting.md` as part of the current user-facing guide set, without changing the bug-reporting contract itself.

- Task: add the bug-reporting guide to the README guide indexes
  Status: done
  Acceptance: `README.md` and `README_CN.md` link to `docs/guide/bug-reporting.md` in their guide lists so users can discover the shipped bug-reporting workflow from the main repository entrypoints.
  Artifact: `README.md`, `README_CN.md`

- Task: sync AGENTS guide-inventory wording with the current guide set
  Status: done
  Acceptance: `AGENTS.md` no longer describes `docs/guide/` as if the bug-reporting guide did not exist, keeping future-agent repository guidance aligned with the actual guide directory.
  Artifact: `AGENTS.md`

---

## Objective: B38 - Runtime Verification Surface Parity After V1 Acceptance Delivery
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR sweep found that the repository's current verification surface was broader than `docs/design/CURRENT_RUNTIME_SURFACE.md` said. The runtime inventory still listed clean-install and CLI artifact verification, but later delivered verifier surfaces from `V1` — including seeded CLI/API/TUI acceptance, seeded web-review preparation, and repeatable real-archive truthfulness probes — were only described in deeper design notes and the web guide. Because `CURRENT_RUNTIME_SURFACE.md` is the canonical current runtime inventory, it now names the shipped verifier commands that materially define the present validation surface.

### KR: B38-KR1 Current runtime inventory reflects shipped verification commands
Status: done
Acceptance: `docs/design/CURRENT_RUNTIME_SURFACE.md` truthfully lists the currently shipped install/verification surfaces that are part of the present repository runtime, including the later V1 verifier commands already implemented in `package.json` and referenced by V1 design docs.

- Task: extend the runtime-surface verification inventory for V1 verifier commands
  Status: done
  Acceptance: the `Current install and verification surfaces` section in `docs/design/CURRENT_RUNTIME_SURFACE.md` includes `pnpm run verify:v1-seeded-acceptance`, `pnpm run prepare:v1-seeded-web-review -- --store <dir>`, and `pnpm run verify:real-archive-probes` alongside the earlier clean-install / CLI-artifact entries.
  Artifact: `docs/design/CURRENT_RUNTIME_SURFACE.md`

- Task: sync AGENTS command guidance with the shipped verifier surface
  Status: done
  Acceptance: `AGENTS.md` lists the key repository verification commands future agents may need for release-gate and V1 validation work, rather than stopping at package tests plus `validate:core` / `probe:smoke`.
  Artifact: `AGENTS.md`

---

## Objective: B39 - Docs Directory Inventory Parity In Repository Summaries
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR sweep found that the repository's top-level doc-directory summaries still lagged the actual `docs/` tree. `README.md` and `README_CN.md` linked to bug-reporting guidance and source notes, but their `Project Structure` comments still described `docs/guide/` as if it stopped at CLI/API/TUI/Web/inspection, and they omitted `docs/sources/` and `docs/templates/` from the visible tree summary. `AGENTS.md` likewise summarized `docs/` around design plus guides, but omitted the shipped source-reference and template material from the high-level docs inventory. Those summaries now match the actual docs tree.

### KR: B39-KR1 Repository doc-directory summaries match the current docs tree
Status: done
Acceptance: `README.md`, `README_CN.md`, and `AGENTS.md` describe the current `docs/` inventory truthfully, including bug-reporting guidance in `docs/guide/`, the shipped `docs/sources/` technical references, and the presence of reusable `docs/templates/` material.

- Task: sync README project-structure doc comments with the current docs tree
  Status: done
  Acceptance: `README.md` and `README_CN.md` no longer describe `docs/guide/` with the older narrower guide set, and their `docs/` tree comments acknowledge the shipped source-note and template directories where appropriate.
  Artifact: `README.md`, `README_CN.md`

- Task: sync AGENTS high-level docs inventory with the current docs tree
  Status: done
  Acceptance: `AGENTS.md` no longer summarizes `docs/` as if only design and guides mattered; it also names `docs/sources/` and `docs/templates/` as part of the current repository documentation surface.
  Artifact: `AGENTS.md`

---

## Objective: B40 - Release-Gate Verifier Parity In Current Runtime Inventory
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR sweep found that `docs/design/CURRENT_RUNTIME_SURFACE.md` still omitted two shipped verification commands that are already part of the repository's current release-gate surface: `pnpm run verify:web-build-offline` and `pnpm run verify:support-status`. Both commands are present in `package.json`, `AGENTS.md`, and `docs/design/SELF_HOST_V1_RELEASE_GATE.md`, but the canonical current runtime inventory had still listed only clean-install, CLI-artifact, and later V1-specific verifiers. The runtime inventory now includes these release-gate commands too.

### KR: B40-KR1 Current runtime inventory includes shipped release-gate verifiers
Status: done
Acceptance: `docs/design/CURRENT_RUNTIME_SURFACE.md` includes `pnpm run verify:web-build-offline` and `pnpm run verify:support-status` alongside the other already-shipped verification commands, matching the release-gate doc and command surface.

- Task: add missing release-gate verifier commands to the runtime inventory
  Status: done
  Acceptance: the `Current install and verification surfaces` section in `docs/design/CURRENT_RUNTIME_SURFACE.md` explicitly lists both the offline web-build verifier and the support-status verifier as current shipped repository verification commands.
  Artifact: `docs/design/CURRENT_RUNTIME_SURFACE.md`

---

## Objective: B41 - Document Roles Table Parity For Guide And Template Surfaces
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR sweep found that `docs/design/CURRENT_RUNTIME_SURFACE.md` still described repository document roles through a narrower table that omitted two now-shipped documentation surfaces: `docs/guide/*.md` and `docs/templates/*.md`. The repository no longer only maintains semantic/runtime/source-reference/roadmap/historical-plan docs; it also ships user-facing operational guides and reusable reporting templates. The canonical current inventory now reflects those surfaces too.

### KR: B41-KR1 Current document-role inventory includes guide and template surfaces
Status: done
Acceptance: the `Document Roles` table in `docs/design/CURRENT_RUNTIME_SURFACE.md` includes the current user-guide and reusable-template surfaces, keeping the runtime inventory aligned with the shipped `docs/` tree.

- Task: add guide and template roles to the runtime-surface document-role table
  Status: done
  Acceptance: `docs/design/CURRENT_RUNTIME_SURFACE.md` explicitly lists `docs/guide/*.md` as user-facing operational guides and `docs/templates/*.md` as reusable issue/report templates, with update policies that match their current purpose.
  Artifact: `docs/design/CURRENT_RUNTIME_SURFACE.md`

---

## Objective: B42 - Document Roles Table Parity For The Self-Host Release Gate
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR sweep found that `docs/design/CURRENT_RUNTIME_SURFACE.md` now listed semantic, runtime, guide, source-reference, template, roadmap, and historical-plan document roles, but still omitted the shipped `docs/design/SELF_HOST_V1_RELEASE_GATE.md` as a first-class current document role. That omission was misleading because the release gate now governs self-host v1 support claims and repository verification expectations, and it is linked from the main README surfaces. The current runtime inventory now describes that document explicitly.

### KR: B42-KR1 Current document-role inventory includes the self-host release gate
Status: done
Acceptance: the `Document Roles` section in `docs/design/CURRENT_RUNTIME_SURFACE.md` explicitly includes `docs/design/SELF_HOST_V1_RELEASE_GATE.md` as the current self-host release-gate policy document, with a truthful update policy.

- Task: add the self-host release-gate document to the document-role table
  Status: done
  Acceptance: `docs/design/CURRENT_RUNTIME_SURFACE.md` lists `docs/design/SELF_HOST_V1_RELEASE_GATE.md` as the current self-host release-gate policy and explains when that document should be updated.
  Artifact: `docs/design/CURRENT_RUNTIME_SURFACE.md`

---

## Objective: B43 - Screenshot Asset Inventory Parity In AGENTS Docs Summary
Status: done
Priority: P2
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR sweep found that `AGENTS.md` now summarized `docs/guide/`, `docs/sources/`, and `docs/templates/` as part of the current `docs/` surface, but still omitted the shipped `docs/screenshots/` directory even though the main READMEs reference those assets directly. This was a smaller drift than the earlier source/template omissions, but it still left the high-level docs inventory slightly behind the actual repository tree. The AGENTS docs summary now mentions that asset surface too.

### KR: B43-KR1 AGENTS docs summary includes the shipped screenshots asset surface
Status: done
Acceptance: `AGENTS.md` acknowledges `docs/screenshots/` as part of the current repository docs surface in a way that matches the checked-in tree and README usage.

- Task: mention `docs/screenshots/` in the AGENTS high-level docs inventory
  Status: done
  Acceptance: the `Root docs plus docs/` summary in `AGENTS.md` no longer implies that only design, guide, source, and template material live under `docs/`; it also mentions the shipped screenshot assets used by repository-facing documentation.
  Artifact: `AGENTS.md`

---

## Objective: B44 - Scripts Directory Summary Parity In README Structure Notes
Status: done
Priority: P2
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR sweep found that the `Project Structure` sections in `README.md` and `README_CN.md` still described `scripts/` as if it only contained dev-service lifecycle helpers. The checked-in `scripts/` directory now also contains verification commands, CLI artifact helpers, source inspection collectors, and probe utilities. Those README tree notes now reflect the broader shipped helper surface.

### KR: B44-KR1 README structure notes describe the current scripts surface
Status: done
Acceptance: `README.md` and `README_CN.md` describe `scripts/` in a way that matches the actual repository contents, without implying that the directory only holds dev-service lifecycle wrappers.

- Task: widen the README scripts-directory comment to the current helper surface
  Status: done
  Acceptance: the `scripts/` comment in `README.md` and `README_CN.md` mentions the current mix of dev-service, verification, and inspection/helper scripts rather than the old narrower description.
  Artifact: `README.md`, `README_CN.md`

---

## Objective: B45 - Top-Level Directory Parity For README Project Structure Trees
Status: done
Priority: P2
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR sweep found that the `Project Structure` sections in `README.md` and `README_CN.md` still omitted two checked-in top-level directories that the repository guidance explicitly distinguishes elsewhere: `frontend_demo/` and `archive/`. Those trees already included other non-runtime/reference directories such as `mock_data/`, so omitting the imported UI reference and historical archive left the top-level repository summary slightly behind the actual checked-in layout and the semantics already described in `AGENTS.md`. The README trees now include both reference directories.

### KR: B45-KR1 README project trees include the shipped top-level reference directories
Status: done
Acceptance: `README.md` and `README_CN.md` show `frontend_demo/` and `archive/` in their top-level project-structure trees with brief descriptions that match the repository scope guidance.

- Task: add `frontend_demo/` and `archive/` to the README project-structure trees
  Status: done
  Acceptance: both main READMEs acknowledge the imported UI reference and historical archive directories in their tree summaries without overstating them as canonical product surfaces.
  Artifact: `README.md`, `README_CN.md`

---

## Objective: R18 - Remote Agent Collection Control Plane
Status: done
Priority: P2
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

`docs/design/REMOTE_AGENT_COLLECTION_DESIGN.md` already defines a concrete remote-host direction: agent-local capture, central canonical import, upload-first rollout, stable host identity, and typed collection jobs instead of arbitrary remote execution. But no backlog objective currently owns that design note, its phased rollout, or the decision about whether and when it should become implementation work. This objective brings that future feature into the living work surface without treating it as remote live federation or a generic host-management system.

### KR: R18-KR1 Remote collection design ownership and phase decomposition
Status: done
Acceptance: `BACKLOG.md` and `docs/design/REMOTE_AGENT_COLLECTION_DESIGN.md` together define the owned scope, preserved invariants, rollout phases, and non-goals for remote collection, so future agents do not treat the design note as an orphan or silently widen it into remote live federation.

- Task: adopt the existing remote collection design note into the backlog-owned objective
  Status: done
  Acceptance: `BACKLOG.md` cites `docs/design/REMOTE_AGENT_COLLECTION_DESIGN.md` as the current design baseline and makes explicit that the feature remains agent-local capture plus central canonical import, not remote live federation or arbitrary shell execution.
  Artifact: `BACKLOG.md`, `docs/design/REMOTE_AGENT_COLLECTION_DESIGN.md`

- Task: decompose remote collection into upload, heartbeat/schedule, and leased-pull slices
  Status: done
  Acceptance: `BACKLOG.md` names separate KRs for upload-first pairing/import, liveness plus local scheduling, and server-requested leased collection, consistent with the rollout phases already documented in `docs/design/REMOTE_AGENT_COLLECTION_DESIGN.md`.
  Artifact: `BACKLOG.md`, `docs/design/REMOTE_AGENT_COLLECTION_DESIGN.md`

### KR: R18-KR2 Upload-first paired remote collection
Status: done
Acceptance: one paired remote host can upload dirty source-scoped bundles into the existing canonical import pipeline with stale-write rejection and source-manifest reporting, without introducing a parallel semantic model.

- Task: validate current reusable upload/import surfaces against remote-agent needs
  Status: done
  Acceptance: `docs/design/REMOTE_AGENT_COLLECTION_DESIGN.md` records exactly which existing CLI bundle helpers, storage import paths, and API contracts can be reused for the remote upload phase, and what minimal new control-plane state is still required.
  Artifact: `docs/design/REMOTE_AGENT_COLLECTION_DESIGN.md`

- Task: implement the upload-first remote pair/collect/upload slice
  Status: done
  Acceptance: `apps/api` exposes pairing plus upload endpoints, `apps/cli` exposes `agent pair` and `agent upload`, and targeted API/CLI regression coverage proves dirty-source uploads, source-manifest reporting, and stale-generation rejection through the existing source-replacement ingest flow.
  Artifact: `apps/api/src/app.ts`, `apps/api/src/remote-agent.ts`, `apps/api/src/app.test.ts`, `apps/cli/src/index.ts`, `apps/cli/src/remote-agent.ts`, `apps/cli/src/index.test.ts`

### KR: R18-KR3 Keepalive, inventory, and host-local schedule
Status: done
Acceptance: the main service tracks paired-agent liveness, labels, source-manifest summaries, and scheduled local reporting without adding arbitrary remote execution.

- Task: add paired-agent heartbeat and inventory surfaces
  Status: done
  Acceptance: `apps/api` persists paired-agent last-seen state, labels/display names, and source-manifest summaries across `/api/agent/heartbeat`, `/api/admin/agents`, and `/api/admin/agents/:agentId/labels`, with targeted API regression coverage proving the persisted behavior.
  Artifact: `apps/api/src/app.ts`, `apps/api/src/remote-agent.ts`, `apps/api/src/app.test.ts`

- Task: add host-local scheduling and retry behavior
  Status: done
  Acceptance: `apps/cli` exposes `agent schedule` plus bounded retry/backoff flags on the remote-agent upload path, and targeted CLI regression coverage proves scheduled multi-cycle execution and retry-on-failure while preserving the same canonical bundle/upload contract as manual runs.
  Artifact: `apps/cli/src/index.ts`, `apps/cli/src/index.test.ts`, `apps/cli/src/remote-agent.ts`

### KR: R18-KR4 Server-requested collection by leased jobs
Status: done
Acceptance: the main service can request targeted collection for selected agents or labels via leased collection jobs, and the remote side executes only typed collection jobs rather than arbitrary commands.

- Task: add collection-job persistence and lease APIs
  Status: done
  Acceptance: the repository persists typed collection jobs plus lease/result metadata and exposes API routes for job creation, leasing, and completion/failure reporting.
  Artifact: `apps/api/src/app.ts`, `apps/api/src/remote-agent.ts`, `apps/api/src/app.test.ts`, `packages/domain/src/index.ts`

- Task: add agent-side job claim and completion flow
  Status: done
  Acceptance: a paired remote agent can claim a job, run the requested typed collection scope, upload results, and report success or failure without requiring inbound remote shell access.
  Artifact: `apps/cli/src/index.ts`, `apps/cli/src/remote-agent.ts`, `apps/cli/src/index.test.ts`

---

## Objective: B46 - Remote Agent Runtime-Surface Parity After Upload-First Slice
Status: done
Priority: P2
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A post-implementation KR sweep found that the current runtime inventory docs still described the pre-remote-agent surface even after the upload-first slice landed in `apps/api` and `apps/cli`. The new pairing/upload routes and CLI command family are real shipped runtime surfaces, so leaving them out of `CURRENT_RUNTIME_SURFACE.md` and `AGENTS.md` would immediately recreate the same current-state drift this repository has been cleaning up elsewhere.

### KR: B46-KR1 Current runtime docs include the upload-first remote-agent surface
Status: done
Acceptance: `docs/design/CURRENT_RUNTIME_SURFACE.md` and `AGENTS.md` describe the shipped `agent pair` / `agent upload` CLI surface plus the new `/api/agent/pair` and `/api/agent/uploads` API routes without overstating later keepalive or leased-pull phases as already delivered.

- Task: sync runtime inventory docs after the upload-first remote-agent slice
  Status: done
  Acceptance: the canonical current-state docs explicitly mention the upload-first remote-agent control-plane slice, including its CLI command family and API route group, while keeping later heartbeat/schedule/pull phases clearly out of the shipped-surface claim.
  Artifact: `docs/design/CURRENT_RUNTIME_SURFACE.md`, `AGENTS.md`

---

## Objective: B47 - Remote Agent Inventory Runtime-Surface Parity After Heartbeat Slice
Status: done
Priority: P2
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A follow-up KR sweep after landing the paired-agent heartbeat and admin inventory slice found that the current runtime inventory still only mentioned the earlier pairing/upload routes. That was immediately stale because the shipped API surface now also includes heartbeat plus admin agent inventory/label-update routes, while scheduling and leased pull still remain future work.

### KR: B47-KR1 Current runtime docs include the heartbeat and admin-agent inventory routes
Status: done
Acceptance: `docs/design/CURRENT_RUNTIME_SURFACE.md` and `AGENTS.md` describe the shipped `/api/agent/heartbeat`, `/api/admin/agents`, and `/api/admin/agents/:agentId/labels` routes without overstating scheduling or leased-pull phases as already delivered.

- Task: sync runtime inventory docs after the heartbeat and admin-agent inventory slice
  Status: done
  Acceptance: the canonical current-state docs explicitly mention the new heartbeat and admin inventory routes while still describing later scheduling and pull work as pending.
  Artifact: `docs/design/CURRENT_RUNTIME_SURFACE.md`, `AGENTS.md`

---

## Objective: B48 - Remote Agent Scheduling Runtime-Surface Parity After Host-Local Schedule Slice
Status: done
Priority: P2
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A follow-up KR sweep after landing host-local remote-agent scheduling found that the current runtime inventory still described the CLI remote-agent surface as pair/upload only and still treated scheduling as future work. That became stale as soon as `agent schedule` and bounded retry flags shipped, even though leased pull remains future work.

### KR: B48-KR1 Current runtime docs include the shipped host-local scheduling slice
Status: done
Acceptance: `docs/design/CURRENT_RUNTIME_SURFACE.md` and `AGENTS.md` describe the shipped `agent schedule` CLI surface and bounded retry behavior without overstating leased pull or server-requested jobs as already delivered.

- Task: sync runtime inventory docs after the host-local scheduling slice
  Status: done
  Acceptance: the canonical current-state docs explicitly mention `agent schedule` and its bounded retry behavior while keeping leased-pull collection clearly in the future backlog.
  Artifact: `docs/design/CURRENT_RUNTIME_SURFACE.md`, `AGENTS.md`

---

## Objective: B49 - Remote Agent Leased-Job Runtime-Surface Parity After Server-Requested Slice
Status: done
Priority: P2
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A follow-up KR sweep after landing leased remote-agent collection jobs found that the current runtime inventory still described leased pull as future work. That became stale as soon as the API gained job creation, leasing, and completion routes and the CLI shipped `agent pull` for one-shot leased execution.

### KR: B49-KR1 Current runtime docs include the shipped leased-job slice
Status: done
Acceptance: `docs/design/CURRENT_RUNTIME_SURFACE.md`, `AGENTS.md`, and `docs/guide/cli.md` describe the shipped `agent pull` CLI surface plus the new `/api/agent/jobs/lease`, `/api/agent/jobs/{jobId}/complete`, and `/api/admin/agent-jobs` API routes without overstating any broader remote-execution model.

- Task: sync runtime inventory docs after the leased-job remote-agent slice
  Status: done
  Acceptance: the canonical current-state docs explicitly mention leased remote-agent job creation, leasing, completion, and one-shot CLI execution while preserving the design boundary that only typed collection jobs are supported.
  Artifact: `docs/design/CURRENT_RUNTIME_SURFACE.md`, `AGENTS.md`, `docs/guide/cli.md`

---

## Objective: R19 - Workflow Skill Coverage Expansion
Status: done
Priority: P2
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR review sweep found that `R7` shipped the first repo-owned skills around project history, turn context, export bundles, and source health, but later canonical operator workflows from `R10` were still missing from the skill inventory. The repository now ships `cchistory backup` and `cchistory restore-check` as stable workflow commands, yet agent callers still had no repo-owned skill packaging for those same journeys. This objective closes that gap without inventing a parallel semantic layer.

### KR: R19-KR1 Backup and restore-verification workflows are skill-packaged
Status: done
Acceptance: repo-owned skills package the canonical `cchistory backup` and `cchistory restore-check` workflows with CLI-first transport, preview/read-only safety rules, and UI metadata aligned to the current skill inventory.

- Task: package the preview-first backup workflow as a repo-owned skill
  Status: done
  Acceptance: `skills/` includes a dedicated backup skill that prefers `cchistory backup` preview mode first, names `--write` as the explicit mutating step, and preserves canonical CLI JSON.
  Artifact: `skills/cchistory-backup-workflow/`

- Task: package post-restore verification as a repo-owned skill
  Status: done
  Acceptance: `skills/` includes a dedicated restore-verification skill that wraps `cchistory restore-check` as a read-only indexed inspection workflow with explicit required-target guidance.
  Artifact: `skills/cchistory-restore-check/`

- Task: sync the shipped skill inventory docs after workflow-skill expansion
  Status: done
  Acceptance: the canonical `skills/README.md` inventory includes the newly packaged backup and restore-check skills without implying any skill-specific semantic model.
  Artifact: `skills/README.md`, `docs/design/R19_WORKFLOW_SKILL_COVERAGE_EXPANSION.md`

---

## Objective: R20 - Automation, Cron, And Subagent Secondary-Evidence Semantics
Status: done
Priority: P1
Source: roadmap extension and real-archive review on 2026-04-02

A project-wide KR review plus fresh real-data inspection found that the current
canonical model still lacks an owned decision for automation-shaped and
subagent-shaped activity that is not a true human-authored `UserTurn` but is
also too important to discard. The concrete evidence is already present in the
user-provided OpenClaw archive: `./agents/main/sessions/*.jsonl` includes
`[cron:...]` prompts and `[Subagent Context]` prompts that currently look like
ordinary `role:user` messages, while standalone cron-run records live outside
`agents/main/sessions/` under `./cron/runs/*.jsonl` and are not in the current
OpenClaw adapter capture scope at all. The current Claude Code intake preserves
sidechain/session-relation metadata only as low-level fragments, not as a
first-class cross-session subagent model. This objective exists to decide which
of these artifacts should remain canonical `UserTurn` inputs, which should be
stored as secondary evidence or task/session metadata, and how parent-task
linkage should work without violating the frozen `UserTurn`-first model.

### KR: R20-KR1 Automation/subagent evidence inventory and invariant mapping
Status: done
Acceptance: a design note and backlog decomposition record the real evidence
classes for automation, cron, subagent, and sidechain activity across the
currently available real-data agent roots, and map each class against the
frozen `UserTurn` invariants without guessing.

- Task: audit real automation and subagent evidence across all available local agent JSONL roots
  Status: done
  Acceptance: `docs/design/R20_AUTOMATION_CRON_SUBAGENT_SEMANTICS.md` records a host-wide `jsonl` survey across the currently available local agent roots and reviewed archives, including at minimum Claude main/subagent sessions, Codex session/history JSONL, AMP history JSONL, and OpenClaw main-session plus `cron/runs/*.jsonl` evidence when present via reviewed archives or local roots, then states which patterns are family-wide versus source-specific.
  Artifact: `docs/design/R20_AUTOMATION_CRON_SUBAGENT_SEMANTICS.md`

- Task: classify automation evidence against frozen canonical objects
  Status: done
  Acceptance: the same note and `BACKLOG.md` state which reviewed artifacts are eligible `UserTurn` anchors, which belong in `TurnContext`/source meta, which should be stored as secondary evidence-only records, and where parent-task/session linkage is available or absent.
  Artifact: `docs/design/R20_AUTOMATION_CRON_SUBAGENT_SEMANTICS.md`, `BACKLOG.md`

### KR: R20-KR2 Automation/subagent fixture and capture-scope preparation
Status: done
Acceptance: sanitized fixtures and capture-scope expectations exist for the
reviewed automation evidence classes, including standalone OpenClaw cron runs,
subagent-shaped prompts, and evidence-only root history JSONL where justified,
and `pnpm run mock-data:validate` passes once the slice lands.

- Task: define the fixture matrix for cron-run, subagent, and parent-link scenarios
  Status: done
  Acceptance: the design/backlog work names the exact anonymized scenarios needed for OpenClaw main-session cron prompts, OpenClaw `cron/runs/*.jsonl`, Claude sidechain/session-relation metadata, and evidence-only root `history.jsonl` cases for Claude, Codex, and AMP, including which ones are transcript-bearing versus secondary evidence.
  Artifact: `docs/design/R20_AUTOMATION_CRON_SUBAGENT_SEMANTICS.md`, `BACKLOG.md`

- Task: stage sanitized automation fixtures and validate scenario coverage
  Status: done
  Acceptance: `mock_data/` gains only the automation/subagent fixtures justified by reviewed real evidence, including Claude sidechain sessions, OpenClaw cron-run evidence, and evidence-only root-history scenarios for Claude, Codex, and AMP; `mock_data/scenarios.json` records the new coverage intent; and `pnpm run mock-data:validate` passes.
  Artifact: `mock_data/`, `mock_data/scenarios.json`

### KR: R20-KR3 Secondary-evidence and parent-link semantics design
Status: done
Acceptance: a design decision defines how cron, delegated subagent work, and
related task/session metadata are represented without flattening them into
ordinary human-authored turns or violating the frozen one-session-per-turn
rule.

- Task: design parent linkage for subagent and cron evidence
  Status: done
  Acceptance: the design note states how subagent activity links back to a main agent/session/task when that evidence exists, how cron records link to the main task when only partial lineage is available, and which relationship fields must remain explicit instead of inferred.
  Artifact: `docs/design/R20_AUTOMATION_CRON_SUBAGENT_SEMANTICS.md`

- Task: define implementation and regression surfaces before parser changes
  Status: done
  Acceptance: the design note names the exact capture, parser, storage, presentation, CLI/API, and regression surfaces that must change if automation evidence treatment is updated, including OpenClaw adapter scope, shared turn-building logic, and cross-surface traceability checks.
  Artifact: `docs/design/R20_AUTOMATION_CRON_SUBAGENT_SEMANTICS.md`

### KR: R20-KR4 Parser/projection implementation and regression proof
Status: done
Acceptance: canonical projections preserve automation evidence truthfully,
store secondary records, and stop misclassifying delegated or triggered
activity as plain human-authored turns.

- Task: add explicit delegated and automation origin kinds plus shared turn-anchor exclusion rules
  Status: done
  Acceptance: the shared domain and builder layers distinguish delegated or automation-triggered user-shaped text from `user_authored` anchors, and turn building excludes those origins from canonical `UserTurn` creation while preserving traceability.
  Artifact: `packages/domain/src/index.ts`, `packages/source-adapters/src/core/legacy.ts`

- Task: extend OpenClaw capture and parsing for standalone cron evidence and automation classification
  Status: done
  Acceptance: OpenClaw intake captures `cron/runs/*.jsonl` as reviewed secondary evidence, distinguishes standalone cron records from transcript-bearing session JSONL, and preserves any available parent-session/task linkage without inventing user-authored text.
  Artifact: `packages/source-adapters/src/platforms/openclaw.ts`, `packages/source-adapters/src/index.test.ts`

- Task: decide and implement evidence-only intake policy for root history JSONL across Claude, Codex, and AMP
  Status: done
  Acceptance: the repository either truthfully keeps root `history.jsonl` files out of default capture or ingests them as explicit secondary evidence only, with tests proving they do not create duplicate canonical turns.
  Artifact: `packages/source-adapters/src/platforms/claude-code.ts`, `packages/source-adapters/src/platforms/codex.ts`, `packages/source-adapters/src/platforms/amp.ts`, `packages/source-adapters/src/index.test.ts`

- Task: surface and regress secondary-evidence traceability across storage and read surfaces
  Status: done
  Acceptance: targeted source-adapter, storage, CLI, and/or API tests prove that automation evidence stays traceable, that delegated prompts are not flattened into ordinary human turns when the new rule says otherwise, and that parent-link or evidence-only surfaces remain inspectable.
  Artifact: `packages/presentation/src/index.test.ts`, `pnpm --filter @cchistory/presentation test`, `NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @cchistory/web build`

## Objective: R21 - Loop And Automation Flood Control For Recall Quality
Status: done
Priority: P1
Source: roadmap extension on 2026-04-02
Completed: 2026-04-02

Current projections preserve repeated automation-shaped turns as separate
retrievable `UserTurn` objects, and the current turn builder only merges
consecutive user/injected fragments within one submission boundary before an
assistant reply. It does not yet detect the higher-level pattern where one
session or project emits 3+ consecutive automation-triggered user-like turns
that mostly restate the same loop task. This objective exists to define and
validate an evidence-preserving way to mark, collapse, or deprioritize such loop
behavior in derived projections so repeated cron or `/loop` traffic does not
wash out higher-value human intent in recall, search, and project feeds.

### KR: R21-KR1 Loop prevalence review and canonical rule design
Status: done
Acceptance: the repository has a written rule for identifying loop-like
repetition in one session or project, grounded in reviewed real samples rather
than guesswork, and explicit about what remains a retrievable `UserTurn`.

- Task: audit repeated cron and `/loop` patterns across all available real-data agent roots and mock data
  Status: done
  Acceptance: a design note or backlog-linked research summary records how repeated automation turns currently appear across the available evidence set, including Claude, Codex, AMP, OpenClaw, and any other local real-data roots with relevant traces, then evaluates whether the proposed `>=3` contiguous-turn threshold is sufficient or needs extra guards such as same-session, same-project, same automation family, or near-identical canonical text checks.
  Artifact: future `docs/design/R21_LOOP_FLOOD_CONTROL.md`

- Task: define how secondary-evidence-only loop traces influence prevalence without becoming canonical turns
  Status: done
  Acceptance: the same note explicitly distinguishes transcript-primary repeated turns from root-history or other secondary-evidence loop traces, and states whether those traces influence diagnostics, ranking, or prevalence thresholds without creating new canonical `UserTurn` records.
  Artifact: future `docs/design/R21_LOOP_FLOOD_CONTROL.md`

- Task: define evidence-preserving outputs for loop-detected spans
  Status: done
  Acceptance: the same note states whether loop handling should materialize as masks, ranking demotion, grouped display metadata, or another projection-layer mechanism, while preserving raw evidence and drill-down traceability.
  Artifact: future `docs/design/R21_LOOP_FLOOD_CONTROL.md`

### KR: R21-KR2 Loop-heavy fixture and regression preparation
Status: done
Acceptance: sanitized fixtures and regression targets exist for repeated
automation traffic without reducing the reviewed problem to toy duplicates.

- Task: define the loop-heavy fixture matrix for repeated automation scenarios
  Status: done
  Acceptance: the backlog/design work names the required anonymized scenarios for repeated cron prompts, repeated `/loop` prompts, and mixed human-plus-automation sequences so later parser or presentation work can prove it does not hide genuine human intent.
  Artifact: `BACKLOG.md`, future `docs/design/R21_LOOP_FLOOD_CONTROL.md`

- Task: stage sanitized loop fixtures and validate coverage
  Status: done
  Acceptance: `mock_data/` gains only the loop-heavy scenarios justified by reviewed samples, `mock_data/scenarios.json` records the coverage intent, and `pnpm run mock-data:validate` passes.
  Artifact: `mock_data/`, `mock_data/scenarios.json`

### KR: R21-KR3 Projection and ranking implementation proof
Status: done
Acceptance: repeat automation traffic remains inspectable but no longer dominates
project recall or search by default when the reviewed loop rule applies.

- Task: implement loop detection and projection metadata in the presentation mapping layer
  Status: done
  Acceptance: the selected builder, mask, storage, or presentation layer exposes a stable loop marker or grouping signal that can de-emphasize repeated automation traffic without deleting underlying turns or cross-session evidence.
  Artifact: `packages/presentation/src/index.ts`, `apps/web/lib/api.ts`

- Task: add regressions for loop-aware recall, search, and drill-down behavior
  Status: done
  Acceptance: targeted tests prove that loop-heavy sessions remain traceable, but default project feeds or search flows do not let repeated automation traffic drown out nearby human-authored turns.
  Artifact: `packages/presentation/src/index.test.ts`, `pnpm --filter @cchistory/presentation test`, `NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @cchistory/web build`

## Objective: R22 - Operator-Experience-Led End-To-End Validation Expansion
Status: done
Priority: P1
Source: roadmap extension on 2026-04-02

`V1` delivered the seeded acceptance verifier, the web review preparation path,
and a repeatable real-archive probe command, but it did not yet formalize the
next bar the user now asks for: test-first workflow changes plus recorded
operator-experience walkthroughs that intentionally imitate real CLI/TUI/API
usage and convert friction into backlog-owned improvements. This objective owns
a stronger e2e validation layer where an agent follows the product like a real
operator, records the journey and pain points, and uses those findings to drive
interface and workflow refinements rather than treating package-level or seeded
acceptance coverage as the whole story.

### KR: R22-KR1 Post-V1 coverage matrix and operator-journey contract
Status: done
Acceptance: the repository truthfully records what `V1` already validates,
which operator journeys still lack test-first coverage, and how CLI, TUI, API,
and user-started web review fit together in the next validation bar.

- Task: record the post-V1 gap matrix for CLI, TUI, API, and manual web review
  Status: done
  Acceptance: a design note compares the shipped `pnpm run verify:v1-seeded-acceptance`, web-review helper path, and real-archive probe command against the still-missing operator journeys such as real sync flows, read-only admin inspection, export/import recovery checks, and walkthrough-based friction capture.
  Artifact: `docs/design/R22_OPERATOR_EXPERIENCE_E2E.md`

- Task: define the operator diary and friction-capture rubric
  Status: done
  Acceptance: the same note defines how an agent records commands run, expected versus observed behavior, usability pain points, and backlog-worthy improvements without confusing anecdotal notes for canonical product semantics.
  Artifact: `docs/design/R22_OPERATOR_EXPERIENCE_E2E.md`

### KR: R22-KR2 Test-first operator walkthrough design and harness expansion
Status: done
Acceptance: repeatable validation paths exist for the main CLI/TUI/API operator
journeys, and those paths are designed before implementation work depends on
them.

- Task: specify canonical operator journeys beyond the seeded acceptance slice
  Status: done
  Acceptance: the design note enumerates the CLI/TUI/API workflows that must be imitated end-to-end, including sync, list/tree/show/query/search drill-down, export/import, restore-check, and source-health inspection, plus the user-started web spot-checks that remain manual because the agent cannot start services.
  Artifact: `docs/design/R22_OPERATOR_EXPERIENCE_E2E.md`

- Task: define which walkthroughs should become repeatable harnesses or verifier commands
  Status: done
  Acceptance: the design note states which journeys belong in seeded or real-store verifiers, which remain manual review scripts, and how test-first changes should be required before non-trivial operator-facing workflow changes land.
  Artifact: `docs/design/R22_OPERATOR_EXPERIENCE_E2E.md`

- Task: extend the seeded acceptance verifier into a search-and-drill-down walkthrough
  Status: done
  Acceptance: the canonical seeded verifier proves CLI/API/TUI search parity for the seeded traceability phrase, then drills into the same turn detail/context/session without requiring direct known-turn lookup first.
  Artifact: future `scripts/verify-v1-seeded-acceptance.mjs`

- Task: add a read-only admin and missing-store verifier
  Status: done
  Acceptance: one automated path compares CLI `health` plus source reads, TUI source-health and missing-store behavior, and API read-side source/admin visibility without mutating state.
  Artifact: `scripts/verify-read-only-admin.mjs`, `package.json`

- Task: add a fixture-backed sync-to-recall verifier
  Status: done
  Acceptance: one automated path starts from a clean temp store, runs `sync` against fixture-backed sources, and then proves resulting project/turn/source readability through CLI and API, with optional TUI snapshot parity.
  Artifact: `scripts/verify-fixture-sync-to-recall.mjs`, `package.json`

### KR: R22-KR3 Agent-run walkthrough execution and backlog intake
Status: done
Acceptance: at least one operator-style CLI/TUI/API journey is executed and
recorded with a friction log, and the resulting improvements are converted into
backlog-owned work before broad corrective changes begin.

- Task: run a full CLI/TUI/API operator walkthrough and record the experience
  Status: done
  Acceptance: an agent follows one realistic workflow from sync or seeded-store setup through recall, traceability, admin inspection, and export/import verification, then records the exact commands, observations, and friction points in a review note.
  Artifact: `docs/design/R22_OPERATOR_EXPERIENCE_E2E.md`

- Task: convert walkthrough findings into backlog-owned improvements before non-trivial fixes
  Status: done
  Acceptance: every meaningful friction point from the recorded walkthrough becomes a concrete task, KR, or objective in `BACKLOG.md` before wider CLI/TUI/API or web corrective work begins.
  Artifact: `BACKLOG.md`, `docs/design/R22_OPERATOR_EXPERIENCE_E2E.md`

### KR: R22-KR4 Walkthrough-derived operator read-surface cleanup
Status: done
Acceptance: the first recorded operator walkthrough feeds concrete follow-up work for store-scoped admin truthfulness and smoother human-readable recall workflows before broader UX cleanup proceeds.

- Task: separate store-scoped health inspection from ambient host discovery noise
  Status: done
  Acceptance: seeded or restored operator review can inspect the selected indexed store without unrelated host discovery dominating the output by default, or the command makes the distinction explicit enough not to mislead read-only admin workflows.
  Artifact: future CLI/admin implementation

- Task: align operator-readable CLI recall flow across `query`, `search`, and `show`
  Status: done
  Acceptance: the repository either resolves the JSON-versus-text inconsistency exposed by the walkthrough or documents a clearer operator contract so manual recall and drill-down do not require abrupt mode switching.
  Artifact: `apps/cli/src/index.ts`, `docs/guide/cli.md`

## Objective: R23 - Canonical Delegation Graph For Subagent And Automation Sessions
Status: done
Priority: P1
Source: ROADMAP.md, user direction on 2026-04-02, KR review sweep on 2026-04-02

The roadmap and reviewed real-data samples now make a broader cross-agent gap
explicit: delegated/subagent prompts and scheduled automation runs are not the
same thing as human-authored input, but they also are not identical to each
other. Today the repository can preserve some secondary evidence and parent-link
hints, yet it still lacks one canonical, cross-platform way to represent parent
agent tasks, delegated subagent sessions, scheduled triggers, and their shared
or divergent lineage back to the main operator workflow. This objective exists
to convert that gap into a truthful canonical-model plan before more adapters or
UX surfaces entrench ad hoc semantics.

### KR: R23-KR1 Cross-platform delegation evidence survey and gap inventory
Status: done
Acceptance: a written review compares how supported agents encode delegated or
automated work, identifies which artifacts are transcript-primary versus
secondary evidence, and names the canonical-model gaps that still prevent
truthful parent-task/session relationships.

- Task: audit delegation, subagent, and scheduled-run evidence across available real-data agent roots
  Status: done
  Acceptance: a review note inspects the available real-data roots and records how Codex, Claude Code, OpenClaw, OpenCode, and any other relevant supported agents expose subagent or automation relationships, including which identifiers link child work back to a parent task or session and which traces remain evidence-only.
  Artifact: `docs/design/R23_CANONICAL_DELEGATION_GRAPH.md`

- Task: map current canonical-model coverage and semantic gaps for parent task versus child session relationships
  Status: done
  Acceptance: the same note states which existing objects (`UserTurn`, session projections, secondary evidence, lineage, or future task-like artifacts) can already encode the reviewed relationships and which gaps still require new semantics.
  Artifact: `docs/design/R23_CANONICAL_DELEGATION_GRAPH.md`

### KR: R23-KR2 Canonical-model design and regression plan for delegated work
Status: done
Acceptance: the repository has a design-backed plan for storing or projecting delegated/subagent and scheduled automation relationships without flattening them into ordinary human `UserTurn` traffic.

- Task: design the canonical representation for delegated work, scheduled triggers, and parent linkage
  Status: done
  Acceptance: a design note chooses how parent tasks, child sessions, automation triggers, and evidence-only companions should be represented across domain, storage, and presentation layers while preserving the design freeze invariants.
  Artifact: `docs/design/R23_CANONICAL_DELEGATION_GRAPH.md`

- Task: define operator-visible navigation from parent work to child sessions and automation runs
  Status: done
  Acceptance: the design note chooses which related-work links appear in recall, session drill-down, search, and admin surfaces, and explicitly distinguishes transcript-primary child sessions from evidence-only automation runs.
  Artifact: `docs/design/R23_CANONICAL_DELEGATION_GRAPH.md`

- Task: define fixture and regression scope for delegated-session lineage and UX surfaces
  Status: done
  Acceptance: the backlog or design note names the sanitized fixture scenarios and regression surfaces needed to prove delegated work remains traceable in recall, search, admin, and drill-down views without being mislabeled as direct user input.
  Artifact: `BACKLOG.md`, future `docs/design/R23_CANONICAL_DELEGATION_GRAPH.md`

### KR: R23-KR3 Typed relation and related-work implementation slice
Status: done
Acceptance: the repository implements a typed related-work layer that preserves transcript-primary child sessions and evidence-only automation runs as distinct but navigable canonical projections, without flattening them into ordinary `UserTurn` traffic.

- Task: add typed relation and automation-companion contracts in domain, storage, and API layers
  Status: done
  Acceptance: the workspace has typed derived contracts for child-session relations and automation-run companions, plus storage/API plumbing that no longer depends on ad hoc payload-map inspection for the core normalized fields.
  Artifact: future `packages/domain`, `packages/storage`, `packages/api-client`, `apps/api`

- Task: project related-work summaries into session drill-down and admin/read surfaces
  Status: done
  Acceptance: session/admin/read surfaces can distinguish `child session` versus `automation run`, show compact summaries, and retain raw identifier drill-down without polluting default history/search rows.
  Artifact: future `packages/presentation`, `apps/web`, `apps/cli`, `apps/tui`

- Task: add fixture-backed regressions for Claude, Factory, OpenCode, OpenClaw, Codex, and AMP relation handling
  Status: done
  Acceptance: targeted regressions prove transcript-primary child sessions, evidence-only automation runs, and hint-only history evidence all retain the intended canonical behavior across parse, storage, and read layers.
  Artifact: future targeted package-scoped validation commands

---

## Objective: R24 - LS-Like Rich Browse And Search Expansion For CLI And TUI
Status: done
Priority: P1
Source: user direction on 2026-04-02
Completed: 2026-04-02

The current CLI and TUI already expose `ls`, `tree`, `show`, search, and
related-work summaries, but the operator experience is still flatter than
terminal-native discovery patterns such as `ls -la` or `ls --tree`. The next
gap is richer expansion modes for project, session, turn, and subagent-related
browsing: denser metadata, clearer hierarchy, more rewarding drill-down, and
stronger search-to-context transitions that stay faithful to the design
freeze. This objective owns those operator-facing read-surface improvements
without turning default recall into a session-first browser or polluting
`UserTurn`-first search semantics.

### KR: R24-KR1 LS-like browse contract and information architecture
Status: done
Acceptance: the repository defines how compact/default, detailed/long,
"show-hidden-or-extra-context", and tree/hierarchy metaphors map onto
project, session, turn, and delegated child-session browsing in CLI and TUI
while preserving project-first, `UserTurn`-first semantics.

- Task: define the CLI/TUI browse-mode contract for compact, long, and tree-style views
  Status: done
  Acceptance: a design note or backlog-linked spec states which existing or future commands and modes correspond to compact listing, richer metadata expansion, and hierarchy-first browsing for projects, sessions, turns, and delegated child work, including which metaphors intentionally do not map one-to-one from Unix `ls`.
  Artifact: `docs/design/R24_RICH_BROWSE_AND_SEARCH_SURFACES.md`

- Task: define which metadata makes project, session, turn, and subagent drill-down genuinely more valuable
  Status: done
  Acceptance: the same note names the exact row/detail metadata to surface by default versus on expansion, such as project and session recency, source mix, workspace hints, related child-session counts, automation-run counts, linkage state, and search-context cues.
  Artifact: `docs/design/R24_RICH_BROWSE_AND_SEARCH_SURFACES.md`

- Task: define search-to-browse transitions that keep default results turn-first
  Status: done
  Acceptance: the same note states how CLI and TUI search results can expand into project, session, and subagent context, tree views, or related-work summaries without making delegated child sessions or automation runs appear as ordinary turn hits.
  Artifact: `docs/design/R24_RICH_BROWSE_AND_SEARCH_SURFACES.md`

### KR: R24-KR2 CLI rich browse and drill-down implementation
Status: done
Acceptance: CLI operators can move through project, session, turn, and
delegated child-session context using denser `ls`/`tree`/`show`-style read
surfaces that expose more useful metadata and hierarchy without sacrificing
concise defaults.

- Task: add richer long-format and hierarchy options for CLI project/session/turn browsing
  Status: done
  Acceptance: `apps/cli` exposes one truthful, reusable read surface for compact versus expanded browsing so operators can inspect project, session, and turn inventories with higher information density and a clearer parent/child hierarchy than today's flat defaults.
  Artifact: `apps/cli/src/index.ts`, `apps/cli/src/index.test.ts`, `docs/guide/cli.md`

- Task: enrich CLI search drill-down with project, session, and related-work pivots
  Status: done
  Acceptance: search output can lead directly into the surrounding project and session context plus any delegated child-session or automation summary relevant to the selected turn, without mislabeling those relations as canonical turn hits.
  Artifact: `apps/cli/src/index.ts`, `apps/cli/src/index.test.ts`, `docs/guide/cli.md`

### KR: R24-KR3 TUI browse/search expansion and regression proof
Status: done
Acceptance: the TUI presents more detailed, more playful, and more useful
browse/search expansion states for projects, turns, sessions, and related work
while remaining keyboard-first and compatible with non-interactive snapshot
output.

- Task: add richer TUI browse panes and related-work expansion states
  Status: done
  Acceptance: `apps/tui` can reveal more context per selected project or turn, including stronger session breadcrumbs, delegated child-session summaries, and tree-like expansion cues, without abandoning the existing three-pane keyboard workflow.
  Artifact: `apps/tui/src/browser.ts`, `apps/tui/src/index.test.ts`

- Task: add CLI/TUI regressions and guide updates for the new rich browse contract
  Status: done
  Acceptance: targeted tests and guide updates prove the expanded browse/search contract for project, session, turn, and subagent navigation remains stable, operator-readable, and truthful to the canonical model.
  Artifact: `apps/cli/src/index.test.ts`, `apps/tui/src/index.test.ts`, `docs/guide/cli.md`, `docs/guide/tui.md`

## Objective: B50 - Inspection Guide LobeChat Sample-Collection Parity
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR sweep found that `docs/guide/inspection.md` still described
`inspect:collect-source-samples` as if the supported slots stopped at
`openclaw`, `opencode`, `gemini`, `cursor-chat-store`, and `codebuddy`, even
though the collector and its regression suite already support `lobechat`.
Operators using the inspection guide for real-sample handoff could therefore
miss the only currently documented pre-review collection path for LobeChat.

### KR: B50-KR1 Inspection guide matches the shipped sample-collector slots
Status: done
Acceptance: `docs/guide/inspection.md` lists `lobechat` wherever it documents
current `inspect:collect-source-samples` support, including the chooser table
and concrete command examples, so operator-facing collection guidance matches
`scripts/inspect/collect-source-samples.mjs`.

- Task: add LobeChat to the inspection-guide collector slots and examples
  Status: done
  Acceptance: the inspection guide's supported-slot summary and example
  commands include `lobechat` truthfully as an experimental-source sample
  collection path without implying stable support.
  Artifact: `docs/guide/inspection.md`

---

## Objective: B51 - Runtime Surface Browse/Search Parity After R24 Delivery
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR review sweep after `R24` found that
`docs/design/CURRENT_RUNTIME_SURFACE.md` still described the CLI and TUI browse
surface only in broad pre-expansion terms. The runtime inventory named `ls`,
`tree`, `show`, `search`, and pane-based TUI browse/search generically, but it
omitted the newly shipped rich-browse elements: CLI `--long` expansion,
`tree session <ref>`, search pivots into session/project context, and the TUI's
related-work summaries plus breadcrumb/trail detail cues.

### KR: B51-KR1 Runtime inventory reflects the shipped R24 read surfaces
Status: done
Acceptance: `docs/design/CURRENT_RUNTIME_SURFACE.md` describes the current
repository-visible CLI/TUI browse/search contract truthfully after `R24`,
including long-format expansion, hierarchy/session-tree drill-down, search
pivot cues, and richer TUI related-work detail signals.

- Task: update the current runtime inventory for CLI/TUI rich browse and search surfaces
  Status: done
  Acceptance: the CLI and TUI sections of `docs/design/CURRENT_RUNTIME_SURFACE.md`
  mention the shipped `--long` browse expansion, `tree session` hierarchy path,
  search-to-context pivots, and TUI breadcrumb/related-work detail cues without
  overstating any unsupported workflow.
  Artifact: `docs/design/CURRENT_RUNTIME_SURFACE.md`

---

## Objective: B52 - R17 Sample-Collection Note Parity After LobeChat Collector Support
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR review sweep found that `docs/design/R17_LOBECHAT_EXPORT_VALIDATION.md`
still said no canonical sample-collection contract names a LobeChat collector
slot, even though the repository now ships `lobechat` support in
`scripts/inspect/collect-source-samples.mjs`, its regression suite, and the
inspection guide. The note should keep its blocker analysis truthful, but it
must no longer imply that the collection slot itself is absent.

### KR: B52-KR1 R17 note matches the shipped LobeChat collector path
Status: done
Acceptance: `docs/design/R17_LOBECHAT_EXPORT_VALIDATION.md` explains that a
candidate-evidence collection path now exists for `lobechat`, while preserving
that the root assumption, transcript boundary, and promotion basis remain
unverified until a reviewed real sample bundle exists.

- Task: reframe the R17 note's missing-collector statement after LobeChat collector support landed
  Status: done
  Acceptance: the R17 note no longer claims the collector slot is absent; instead it states that the collector can stage candidate evidence from an unverified root, but that this does not satisfy the missing real-sample review on its own.
  Artifact: `docs/design/R17_LOBECHAT_EXPORT_VALIDATION.md`

---

## Objective: B53 - Operator Docs Parity After R24 And CLI/TUI Regression Growth
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR review sweep found two operator-facing doc drifts after the
recent CLI/TUI browse/search expansion and regression additions. First,
`docs/guide/bug-reporting.md` still suggested only the older `ls` / `show` /
`search` proving commands and omitted the newly shipped `tree session --long`
path that now gives the smallest truthful proof for some browse, hierarchy, and
related-work read-surface bugs. Second, the top-level operator docs in
`README.md` and `AGENTS.md` still listed the pre-expansion CLI/TUI test counts,
even though the package suites have grown.

### KR: B53-KR1 Operator-facing browse proving commands reflect the shipped read surface
Status: done
Acceptance: `docs/guide/bug-reporting.md` includes the current smallest proving
command for CLI/TUI browse, session-hierarchy, and related-work issues after
`R24`, without overstating any unsupported workflow.

- Task: add `tree session --long` to the bug-reporting proving-command contract
  Status: done
  Acceptance: the bug-reporting guide tells operators they may use
  `cchistory tree session <session-ref> --store <store-dir> --long` when a bug
  involves session drill-down, nearby turns, or related-work context, alongside
  the older `ls` / `show` / `search` commands.
  Artifact: `docs/guide/bug-reporting.md`

### KR: B53-KR2 Top-level operator docs keep current CLI/TUI test counts
Status: done
Acceptance: `README.md` and `AGENTS.md` reflect the current package-scoped CLI
and TUI test counts after the recent browse/search regression additions.

- Task: update README and AGENTS test-count examples after the CLI/TUI regression expansion
  Status: done
  Acceptance: the top-level operator docs no longer say the CLI suite has 44
  tests or the TUI suite has 9 tests once the shipped package suites have grown
  beyond those counts.
  Artifact: `README.md`, `AGENTS.md`

---

## Objective: B54 - E2E-2 Search-Journey Parity After R24 Browse Expansion
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR review sweep found that
`docs/design/E2E_2_HLD_USER_JOURNEY_COVERAGE.md` still recorded the
search-result traceability journey only through the pre-`R24` `show turn` →
`show session` path. That baseline remains valid, but the repository now also
ships `tree session <session-ref> --long` as the richer hierarchy-first drill-
down path for nearby turns and related-work context. The journey note should no
longer read as if `show session` were the only current operator path from a
search hit into session-level traceability.

### KR: B54-KR1 E2E-2 journey note reflects the shipped search drill-down surface
Status: done
Acceptance: `docs/design/E2E_2_HLD_USER_JOURNEY_COVERAGE.md` keeps the original
search-result journey and acceptance bar, but it now mentions the shipped
`tree session --long` continuation as part of the current operator surface
without pretending the historical baseline was wrong.

- Task: reframe the E2E-2 search journey after the R24 browse expansion
  Status: done
  Acceptance: the E2E-2 journey matrix and/or explanatory text state that the
  baseline shown-id drill-down still uses `show turn` and `show session`, while
  the current CLI surface additionally supports `tree session <session-ref> --long`
  when the operator wants nearby-turn and related-work context in one view.
  Artifact: `docs/design/E2E_2_HLD_USER_JOURNEY_COVERAGE.md`

---

## Objective: B55 - E2E-2 Repeated-Turn Traceability Parity After R24 Browse Expansion
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR review sweep found that
`docs/design/E2E_2_HLD_USER_JOURNEY_COVERAGE.md` still described the repeated or
automation-shaped turn traceability journey only through the pre-`R24`
`show turn` → `show session` path. That historical acceptance chain remains
truthful, but the current CLI surface now also supports `tree session --long`
as the richer nearby-turn / related-work continuation for the same operator job.

### KR: B55-KR1 E2E-2 repeated-turn journey reflects the shipped browse surface
Status: done
Acceptance: the `J3` row and nearby current-execution evidence in
`docs/design/E2E_2_HLD_USER_JOURNEY_COVERAGE.md` mention the shipped
`tree session <session-ref> --long` continuation while preserving the original
`show session` baseline.

- Task: reframe the E2E-2 repeated-turn traceability journey after the R24 browse expansion
  Status: done
  Acceptance: the E2E-2 note states that repeated or automation-shaped turn
  inspection can still use `show turn` and `show session` as the baseline proof,
  while the current CLI browse surface additionally supports `tree session --long`
  when the operator wants richer nearby-turn and related-work context.
  Artifact: `docs/design/E2E_2_HLD_USER_JOURNEY_COVERAGE.md`

---

## Objective: B56 - T1 Current-Surface Mapping Parity After R24 Browse Expansion
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR review sweep found that
`docs/design/T1_TUI_SCOPE_AND_WORKFLOW_INVENTORY.md` still used pre-`R24`
current-surface examples in its present-tense mapping table and workflow notes.
The note still framed search/traceability primarily through `show session` and
older result/detail cues, even though the shipped CLI/TUI surface now also
includes `tree session --long`, related-work summaries in browse/search rows,
and breadcrumb/trail detail signals.

### KR: B56-KR1 T1 current-surface inventory matches shipped browse/search behavior
Status: done
Acceptance: `docs/design/T1_TUI_SCOPE_AND_WORKFLOW_INVENTORY.md` keeps its
historical decomposition value, but its current-surface mapping and workflow
inventory now mention the shipped post-`R24` CLI/TUI browse/search cues
truthfully.

- Task: reframe T1 current-surface mappings after the R24 browse expansion
  Status: done
  Acceptance: the T1 scope note's present-tense mapping table and workflow
  descriptions mention `tree session <session-ref> --long`, richer result cues,
  and detail breadcrumb/related-work continuation where those are now part of
  the current repository-visible surface.
  Artifact: `docs/design/T1_TUI_SCOPE_AND_WORKFLOW_INVENTORY.md`

---

## Objective: B57 - R22 Walkthrough Parity After R24 Browse Expansion
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR review sweep found that
`docs/design/R22_OPERATOR_EXPERIENCE_E2E.md` still described the executed
seeded recall and traceability walkthrough only through the older
`show turn` → `show session` path. That baseline remains truthful for the
recorded run, but the repository now also ships `tree session <session-ref>
--long` as the richer hierarchy-first continuation when an operator wants
nearby-turn and related-work context in one view.

### KR: B57-KR1 R22 walkthrough note reflects the shipped browse continuation
Status: done
Acceptance: `docs/design/R22_OPERATOR_EXPERIENCE_E2E.md` preserves the actual
recorded `show session` baseline while also making clear that the current CLI
browse surface includes `tree session <session-ref> --long` for richer nearby-
turn and related-work traceability.

- Task: reframe the R22 walkthrough note after the R24 browse expansion
  Status: done
  Acceptance: the Walkthrough 1 contract and the executed walkthrough record
  both say that the baseline proof still uses `show turn` and `show session`,
  while the current CLI surface additionally supports `tree session
  <session-ref> --long` when the operator wants nearby-turn and related-work
  context in one continuation.
  Artifact: `docs/design/R22_OPERATOR_EXPERIENCE_E2E.md`

---

## Objective: B58 - E2E-1 Traceability Note Parity After R24 Browse Expansion
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR review sweep found that
`docs/design/E2E_1_PRIMARY_USER_STORY_ACCEPTANCE.md` still described the
acceptance drill-down only through the original `show turn` → `show session`
baseline. That remains the truthful historical acceptance path, but the
repository now also ships `tree session <session-ref> --long` as the richer
hierarchy-first continuation when an operator wants nearby-turn and related-
work context in one view.

### KR: B58-KR1 E2E-1 acceptance note reflects the shipped browse continuation
Status: done
Acceptance: `docs/design/E2E_1_PRIMARY_USER_STORY_ACCEPTANCE.md` preserves the
actual acceptance-test baseline while also making clear that the current CLI
browse surface includes `tree session <session-ref> --long` as the richer
continuation from the recovered turn into session context.

- Task: reframe the E2E-1 acceptance note after the R24 browse expansion
  Status: done
  Acceptance: the E2E-1 decided approach and current execution evidence both say
  that the acceptance proof still uses `show turn` and `show session`, while
  the current CLI surface additionally supports `tree session <session-ref>
  --long` when the operator wants nearby-turn and related-work context in one
  continuation.
  Artifact: `docs/design/E2E_1_PRIMARY_USER_STORY_ACCEPTANCE.md`

---

## Objective: B59 - V1 Search-Traceability Note Parity After R24 Browse Expansion
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR review sweep found that
`docs/design/V1_GOAL_LEVEL_E2E_VALIDATION.md` still described the seeded
search-to-traceability journey in generic session/context terms without naming
the richer `tree session <session-ref> --long` continuation now shipped by the
CLI browse surface. The existing wording remained broadly truthful, but the
current validation note should make that continuation visible where it describes
Journey B and the implemented verifier.

### KR: B59-KR1 V1 validation note reflects the shipped browse continuation
Status: done
Acceptance: `docs/design/V1_GOAL_LEVEL_E2E_VALIDATION.md` keeps the existing
search-to-traceability journey and verifier scope, while also making clear that
the current CLI surface supports `tree session <session-ref> --long` as the
richer nearby-turn and related-work continuation from a search hit.

- Task: reframe the V1 search-traceability note after the R24 browse expansion
  Status: done
  Acceptance: Journey B and the current implemented-verifier summary both say
  that search still drills into turn/session context as before, while the
  current CLI browse surface additionally supports `tree session <session-ref>
  --long` when the operator wants nearby-turn and related-work context in one
  continuation.
  Artifact: `docs/design/V1_GOAL_LEVEL_E2E_VALIDATION.md`

---

## Objective: B60 - T1 First-Slice Evaluation Result Parity After R24 Browse Expansion
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR review sweep found that
`docs/design/T1_TUI_FIRST_SLICE_PLAN.md` still ended with a present-tense result
summary that mentioned project browsing, turn drill-down, search drill-down,
and source-health review, but not the richer breadcrumb and related-work detail
cues now shipped in the current TUI surface. The note remains a historical
closure record, yet its present-tense Phase 7 result should not undersell the
repository-visible TUI behavior recorded elsewhere.

### KR: B60-KR1 T1 first-slice closure note reflects the shipped TUI detail cues
Status: done
Acceptance: `docs/design/T1_TUI_FIRST_SLICE_PLAN.md` preserves its historical
closure framing while updating the current-result sentence so it also mentions
the shipped breadcrumb and related-work detail cues now present in the TUI.

- Task: reframe the T1 first-slice result after the R24 browse expansion
  Status: done
  Acceptance: the Phase 7 result still describes the same delivered TUI slice,
  but it now also mentions the shipped breadcrumb / related-work detail cues as
  part of the current repository-visible surface.
  Artifact: `docs/design/T1_TUI_FIRST_SLICE_PLAN.md`

---

## Objective: B61 - CLI Guide Session-Continuation Parity After R24 Browse Expansion
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR review sweep found that `docs/guide/cli.md` already updated
its search section for the shipped `tree session --long` pivot, but its later
`tree` and `show` sections still read mostly like the pre-`R24` session drill-
down surface. Those examples remained valid, yet the operator guide should no
longer imply that compact `tree session` or `show session` are the only natural
continuations once an operator wants nearby-turn or related-work context.

### KR: B61-KR1 CLI guide reflects the shipped richer session continuation
Status: done
Acceptance: `docs/guide/cli.md` keeps the original `tree session` and `show
session` guidance, while also making clear that `tree session <session-ref>
--long` is the richer hierarchy-first continuation when the operator wants
denser nearby-turn and related-work context.

- Task: reframe the CLI guide session drill-down examples after the R24 browse expansion
  Status: done
  Acceptance: the `tree` section examples and/or adjacent explanatory text in
  `docs/guide/cli.md` mention `tree session <session-ref> --long` as the richer
  session continuation, while preserving `show session <ref>` as the compact
  detail path.
  Artifact: `docs/guide/cli.md`

---

## Objective: B62 - README_CN Test-Count Parity After CLI And TUI Growth
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR review sweep found that `README_CN.md` still described the
package test surface with the older `CLI=44` wording and a generic TUI test
label, even though the current repository-facing docs already record `48` CLI
tests and `11` TUI tests. The Chinese top-level README should not lag the
current operator-facing validation surface.

### KR: B62-KR1 Chinese README reflects current package test counts
Status: done
Acceptance: the `开发` section in `README_CN.md` matches the current package-
scoped validation counts already documented in the English README and AGENTS
surface.

- Task: update Chinese README package test counts to the current shipped values
  Status: done
  Acceptance: `README_CN.md` lists `48` CLI tests and `11` TUI tests instead of
  the older CLI count and generic TUI wording.
  Artifact: `README_CN.md`

---

## Objective: B63 - AGENTS TUI Surface Parity After R24 Browse Expansion
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR review sweep found that `AGENTS.md` still described the TUI
runtime surface only in the older broad terms of browse/search panes plus
source-health summary behavior. That remained directionally true, but `AGENTS.md`
is the live agent-facing runtime inventory and should now also mention the
shipped breadcrumb and related-work detail cues so future sessions do not reason
from a flatter pre-`R24` TUI model.

### KR: B63-KR1 AGENTS runtime note reflects the shipped richer TUI detail cues
Status: done
Acceptance: the `apps/tui` inventory bullet in `AGENTS.md` keeps the existing
TUI browse/search/source-health guidance while also mentioning the shipped
breadcrumb and related-work detail cues now visible in browse/search detail
panes.

- Task: refresh the AGENTS TUI runtime bullet after the R24 browse expansion
  Status: done
  Acceptance: `AGENTS.md` states that the current TUI surface includes richer
  browse/search detail cues such as breadcrumbs and related-work summaries or
  trail lines, not only generic panes plus source-health behavior.
  Artifact: `AGENTS.md`

---

## Objective: B64 - Current Runtime Surface Tree-Session Parity After R24 Browse Expansion
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR review sweep found that
`docs/design/CURRENT_RUNTIME_SURFACE.md` already listed `--long` as a general
CLI browse expansion and mentioned `tree session --long` in the `search` bullet,
but its dedicated `tree session <session-ref>` line still read like the older
pre-`R24` compact hierarchy description. The runtime inventory should state more
directly that `tree session <session-ref> --long` is the richer nearby-turn and
related-work continuation of that same read path.

### KR: B64-KR1 Current runtime inventory reflects the shipped tree-session continuation
Status: done
Acceptance: `docs/design/CURRENT_RUNTIME_SURFACE.md` keeps the existing `tree
session <session-ref>` inventory entry while also making clear that `--long` is
the richer hierarchy-first continuation for denser nearby-turn and related-work
context.

- Task: refresh the runtime-surface tree-session bullet after the R24 browse expansion
  Status: done
  Acceptance: the current runtime inventory describes compact `tree session
  <session-ref>` output and the richer `tree session <session-ref> --long`
  continuation without implying they are different command families.
  Artifact: `docs/design/CURRENT_RUNTIME_SURFACE.md`

---

## Objective: B65 - API Guide Remote-Agent Surface Parity
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR review sweep found that `docs/guide/api.md` still documented
the core recall/admin API surface but omitted the already shipped remote-agent
control-plane routes. That left the user-facing API guide behind the current
runtime inventory in `docs/design/CURRENT_RUNTIME_SURFACE.md` and behind the
implemented OpenAPI summary in `apps/api/src/app.ts`.

### KR: B65-KR1 API guide reflects the shipped remote-agent control plane
Status: done
Acceptance: `docs/guide/api.md` lists the current remote-agent pairing,
heartbeat, job lease/completion, upload, admin inventory/label, and admin job
routes without overstating any broader remote-execution model.

- Task: add the remote-agent route group to the API guide
  Status: done
  Acceptance: the API guide includes a concise route table for `/api/agent/*`,
  `/api/admin/agents*`, and `/api/admin/agent-jobs`, aligned with the current
  runtime inventory and OpenAPI summaries.
  Artifact: `docs/guide/api.md`

---

## Objective: B66 - API Guide Startup-Path Parity With Managed Runtime Policy
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR review sweep found that `docs/guide/api.md` still presented
`bash scripts/dev-services.sh run api` alongside the canonical startup paths.
That foreground helper exists in the script, but the repository's managed
runtime policy treats `pnpm services:*` and `scripts/dev-services.sh start ...`
as the canonical user-operated lifecycle surface. The API guide should not
normalize `run api` as part of the default startup contract.

### KR: B66-KR1 API guide startup section matches the managed runtime policy
Status: done
Acceptance: `docs/guide/api.md` documents only the canonical user-operated API
startup path(s) and does not present `run api` as part of the default runtime
contract.

- Task: remove foreground `run api` from the API guide startup examples
  Status: done
  Acceptance: the API guide startup section keeps the canonical `pnpm
  services:start` and `bash scripts/dev-services.sh start api` paths while
  dropping the non-canonical `run api` example.
  Artifact: `docs/guide/api.md`

---

## Objective: B67 - Current Runtime Surface Sessions-List Route Parity
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR review sweep found that `docs/design/CURRENT_RUNTIME_SURFACE.md`
still listed the API recall routes without the shipped `GET /api/sessions`
endpoint, even though `apps/api/src/app.ts` implements it and `docs/guide/api.md`
already documents it. The current runtime inventory should not understate the
read route surface that operators and agents can rely on.

### KR: B67-KR1 Current runtime inventory includes the shipped sessions list route
Status: done
Acceptance: the recall-route inventory in `docs/design/CURRENT_RUNTIME_SURFACE.md`
mentions both `/api/sessions` and `/api/sessions/{sessionId}` alongside the other
current read routes.

- Task: add `/api/sessions` to the current runtime API route inventory
  Status: done
  Acceptance: the recall-route bullet in `docs/design/CURRENT_RUNTIME_SURFACE.md`
  includes the shipped sessions list route without changing any route semantics.
  Artifact: `docs/design/CURRENT_RUNTIME_SURFACE.md`

---

## Objective: B68 - Related-Work Admin Route Parity In Current API Docs
Status: done
Priority: P1
Source: KR review sweep on 2026-04-02
Completed: 2026-04-02

A project-wide KR review sweep found that the shipped
`GET /api/admin/sessions/:sessionId/related-work` route existed in
`apps/api/src/app.ts` and the OpenAPI summary, but it was omitted from both the
current runtime inventory and the user-facing API guide. That left the admin
read surface for typed session related-work less visible than the repository
actually provides.

### KR: B68-KR1 Current API docs include the shipped related-work admin route
Status: done
Acceptance: `docs/design/CURRENT_RUNTIME_SURFACE.md` and `docs/guide/api.md`
mention the shipped `GET /api/admin/sessions/:sessionId/related-work` route in
truthful route-group context without overstating any broader related-work API
surface.

- Task: add the session related-work admin route to current API docs
  Status: done
  Acceptance: the current runtime route inventory and API guide each include the
  shipped session related-work admin endpoint with a concise truthful
  description.
  Artifact: `docs/design/CURRENT_RUNTIME_SURFACE.md`, `docs/guide/api.md`

---

## Objective: B69 - Project-Delete Admin Route Parity In Current API Docs
Status: done
Priority: P1
Source: KR review sweep on 2026-04-03
Completed: 2026-04-03

A project-wide KR review sweep found that the shipped
`POST /api/admin/projects/:projectId/delete` route existed in
`apps/api/src/app.ts` and the OpenAPI summary, but it was omitted from both the
current runtime inventory and the user-facing API guide. That left one concrete
admin lifecycle action invisible in the current docs even though it is part of
the implemented API surface.

### KR: B69-KR1 Current API docs include the shipped project-delete admin route
Status: done
Acceptance: `docs/design/CURRENT_RUNTIME_SURFACE.md` and `docs/guide/api.md`
mention the shipped project-delete admin route in truthful admin-route context
without overstating any broader destructive-workflow guarantees.

- Task: add the project-delete admin route to current API docs
  Status: done
  Acceptance: the current runtime route inventory and API guide each include the
  shipped `POST /api/admin/projects/:projectId/delete` endpoint with a concise
  truthful description.
  Artifact: `docs/design/CURRENT_RUNTIME_SURFACE.md`, `docs/guide/api.md`

---

## Objective: B70 - Source-Config Subroute Parity In Current Runtime Inventory
Status: done
Priority: P1
Source: KR review sweep on 2026-04-03
Completed: 2026-04-03

A project-wide KR review sweep found that `docs/design/CURRENT_RUNTIME_SURFACE.md`
still listed the source-config API surface only as `/api/admin/source-config`,
even though the implemented API and user-facing API guide already include the
shipped override and reset subroutes. The current runtime inventory should not
understate the concrete admin route surface for source configuration.

### KR: B70-KR1 Current runtime inventory includes the shipped source-config subroutes
Status: done
Acceptance: the source-config route-group entry in
`docs/design/CURRENT_RUNTIME_SURFACE.md` mentions `/api/admin/source-config`,
`/api/admin/source-config/{sourceId}`, and
`/api/admin/source-config/{sourceId}/reset` alongside the probe/replay routes.

- Task: add source-config override and reset routes to the runtime inventory
  Status: done
  Acceptance: the runtime-surface route inventory lists the shipped source-config
  override and reset endpoints without changing any semantics or guide wording.
  Artifact: `docs/design/CURRENT_RUNTIME_SURFACE.md`

---

## Objective: R25 - Skeptical Operator Manual Acceptance Sweep
Status: done
Priority: P1
Source: user challenge on 2026-04-03, KR review sweep on 2026-04-03
Completed: 2026-04-03

The repository now has meaningful verifier coverage, but the user explicitly
challenged whether the system has actually been evaluated like a skeptical,
manual operator across commands, backup flows, parameters, and day-to-day usage.
This objective turned that challenge into evidence-backed manual acceptance work
instead of relying only on package tests, seeded verifiers, or doc-level
confidence. The first CLI bundle/restore diary now exists, the routine stderr
warning-noise friction found during that diary was fixed, and the earlier
browse/search richness request is already owned and delivered under `R24`.

### KR: R25-KR1 CLI bundle, conflict, and restore workflows are manually reviewed
Status: done
Acceptance: one explicit operator diary records the real manual behavior of the
CLI bundle workflow, including preview/write backup, conflict handling,
dry-run behavior, restore verification, and missing-store guardrails.

- Task: record a skeptical-operator CLI diary for backup, import conflicts, and restore-check
  Status: done
  Acceptance: `docs/design/R25_SKEPTICAL_OPERATOR_ACCEPTANCE_SWEEP.md` records
  the commands run, expected versus observed behavior, and any friction found in
  one manual CLI bundle/restore journey.
  Artifact: `docs/design/R25_SKEPTICAL_OPERATOR_ACCEPTANCE_SWEEP.md`

### KR: R25-KR2 Skeptical-operator friction becomes backlog-owned follow-up
Status: done
Acceptance: any meaningful friction discovered during skeptical-operator
manual acceptance gets tracked explicitly before broader quality claims are made,
and the first concrete friction slice is either fixed or deliberately carried as
open backlog work before the objective closes.

- Task: reduce routine CLI warning noise during successful or expected-failure workflows
  Status: done
  Acceptance: routine CLI workflows such as `sync`, `backup`, `import --dry-run`,
  and `restore-check` do not emit Node experimental-warning noise or repetitive
  fallback-search warning noise to stderr by default on this host when the
  command itself succeeds or reports an expected operator-facing error.
  Artifact: `apps/cli/src/index.ts`, `apps/cli/src/main.ts`, `packages/storage/src/db/schema.ts`, `apps/cli/src/index.test.ts`, `docs/design/R25_SKEPTICAL_OPERATOR_ACCEPTANCE_SWEEP.md`

---

## Objective: R26 - Dense CLI/TUI Browse And Search Expansion
Status: done
Priority: P2
Source: user request on 2026-04-03, post-R25 project-wide KR review sweep on 2026-04-03
Completed: 2026-04-03

A follow-up project-wide KR review sweep found that this objective duplicated
already-delivered work under `R24 - LS-Like Rich Browse And Search Expansion For
CLI And TUI`. The user request that triggered `R26` was real, but it was not an
unowned gap: the repository already had a completed objective, design note,
implementation slice, regressions, and guides for richer `ls`/`tree`-style CLI
and TUI browsing. `R26` therefore closes as a backlog-hygiene correction rather
than a separate execution stream.

### KR: R26-KR1 Duplicate-objective review and ownership correction
Status: done
Acceptance: `BACKLOG.md` truthfully records that the browse/search richness
request is already owned by `R24`, and future agents are not misled into
starting a redundant decomposition or implementation pass.

- Task: reconcile the duplicate browse/search objective with the completed `R24` record
  Status: done
  Acceptance: the duplicate objective either points clearly at `R24` or closes as already owned, with no conflicting implication that a separate browse/search program still needs to be decomposed.
  Artifact: `BACKLOG.md`, `docs/design/R24_RICH_BROWSE_AND_SEARCH_SURFACES.md`

---

## Objective: R27 - User-Started Web Review Checklist And Diary Contract
Status: done
Priority: P2
Source: post-R25 project-wide KR review sweep on 2026-04-03
Completed: 2026-04-03

A project-wide KR review sweep found that the repository already ships a
truthful user-started seeded web review path, but still did not give operators
one stable checklist or one explicit diary/friction-capture contract for that
manual review. `R22_OPERATOR_EXPERIENCE_E2E.md` called out this exact gap, and
`docs/guide/web.md` contained useful review steps without formalizing what
evidence to capture, what observations are required, or how to turn web-review
friction into backlog-owned follow-up work. The stable checklist and guide hook
now exist.

### KR: R27-KR1 Seeded web review checklist becomes a stable operator artifact
Status: done
Acceptance: the repository exposes one stable manual web-review checklist for
the canonical seeded review path, including startup preconditions, required
checks across `Projects`, `Search`, and `Sources`, and the evidence/friction
fields operators should record.

- Task: define the seeded manual web-review checklist and diary fields
  Status: done
  Acceptance: a design note defines the canonical seeded web-review scenario,
  exact operator steps, expected observations, evidence fields, and friction
  categories, grounded in the existing seeded review flow and `R22` diary rubric.
  Artifact: `docs/design/R27_USER_STARTED_WEB_REVIEW_CHECKLIST.md`

### KR: R27-KR2 Web guide exposes the checklist without changing runtime rules
Status: done
Acceptance: `docs/guide/web.md` points operators at the stable checklist and
uses the canonical user-started service flow without inventing alternate startup
instructions.

- Task: update the web guide to reference and summarize the stable review checklist
  Status: done
  Acceptance: the web guide's seeded-review section clearly distinguishes setup,
  review checks, evidence capture, and manual shutdown, while preserving the
  repository's canonical service lifecycle guidance.
  Artifact: `docs/guide/web.md`

---

## Objective: R28 - CLI Recall Regression Repair After Rich Browse Growth
Status: done
Priority: P1
Source: project-wide KR review sweep on 2026-04-03 after full CLI test run
Completed: 2026-04-03

A project-wide KR review sweep found that the canonical `@cchistory/cli` test
suite was not green: `pnpm --filter @cchistory/cli test` failed on two
user-facing recall regressions. The failures affected (1) repeated
automation-shaped Claude review turns staying separately retrievable and
explainable across session drill-down, and (2) session/title-oriented CLI
recall paths such as human-friendly `show session`/`query session` references
and search pivots over related OpenCode fixture context. The repaired slice now
keeps command/local-command noise out of derived session titles and lets
turn-first search use session title/workspace cues without changing canonical
turn semantics.

### KR: R28-KR1 Failing CLI recall regressions are reproduced and root-caused
Status: done
Acceptance: the repository records which exact CLI behaviors currently fail,
which tests prove the failure, and whether the breakage belongs to session
reference matching, search/drill-down projection, or fixture/parser drift.

- Task: reproduce the failing CLI recall tests and map the broken code paths
  Status: done
  Acceptance: one work note or backlog update states the failing test names,
  the observed symptom, and the likely code paths or fixture assumptions that
  need correction before broader CLI quality claims continue.
  Artifact: `BACKLOG.md`, `apps/cli/src/index.test.ts`, `packages/source-adapters/src/core/legacy.ts`, `packages/storage/src/internal/storage.ts`

### KR: R28-KR2 Human-friendly session resolution and repeated-turn drill-down work again
Status: done
Acceptance: the failing CLI tests for repeated automation-shaped review turns
and human-friendly session references pass again without weakening the richer
browse/search contract delivered by `R24`.

- Task: repair the repeated-turn and session-reference CLI regressions with targeted validation
  Status: done
  Acceptance: the affected CLI tests pass, the operator-facing output remains
  truthful, and package-scoped validation confirms the repaired recall path.
  Artifact: `apps/cli/src/main.ts`, `apps/cli/src/index.test.ts`, `packages/source-adapters/src/core/legacy.ts`, `packages/storage/src/internal/storage.ts`

---

## Objective: R29 - Remote-Agent Operator Validation Contract
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03
Completed: 2026-04-03

A project-wide KR review sweep found that the remote-agent control plane now has
real CLI, API, and domain surfaces plus targeted mocked CLI regressions, but no
single repository-owned validation contract yet explains what is already proven,
what still needs a user-started server or manual review, and how operators
should record remote-agent workflow friction. `R22` explicitly left remote-agent
flows outside the first operator E2E contract; now that the core local-operator
journeys are covered, the remaining truthful next step is to define that second-
wave validation contract instead of letting the surface remain validation-orphaned.

### KR: R29-KR1 Remote-agent validation matrix and manual-review contract exist
Status: done
Acceptance: one design note records the current proof surface for `agent pair`,
`agent upload`, `agent schedule`, `agent pull`, and the paired API routes,
separating mocked regression coverage from user-started server review and manual
operator checks.

- Task: define the remote-agent validation matrix, proof boundaries, and manual checklist
  Status: done
  Acceptance: a design note explains which remote-agent behaviors are already proven by package-scoped CLI/API tests, which flows still require a user-started server, what evidence to capture during manual review, and which failures should become backlog work.
  Artifact: `docs/design/R29_REMOTE_AGENT_VALIDATION_CONTRACT.md`

### KR: R29-KR2 Operator docs point at the validation contract without inventing a new runtime path
Status: done
Acceptance: the CLI guide's remote-agent section points operators at the stable
validation contract while preserving the repository's existing runtime and
service-lifecycle rules.

- Task: update the CLI guide to reference the remote-agent validation contract
  Status: done
  Acceptance: the `agent` workflow docs mention the validation note and clarify that server-backed validation remains user-started/manual rather than an agent-started runtime path.
  Artifact: `docs/guide/cli.md`

---

## Objective: R30 - Validation Warning-Noise Cleanup For SQLite-Backed Test Suites
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03
Completed: 2026-04-03

A project-wide KR review sweep found that package-scoped validation is now more
truthful than before, but the repository's SQLite-backed test suites still emit
Node's `ExperimentalWarning` for `node:sqlite` at test-run startup on this host.
This does not break correctness, but it pollutes otherwise healthy validation
output and weakens the signal of real failures. No current objective owns that
validation-surface friction yet.

### KR: R30-KR1 SQLite-backed package tests run without routine experimental-warning noise
Status: done
Acceptance: package-scoped test commands that rely on the built-in SQLite module
run without routine `ExperimentalWarning` noise by default on this host, while
still surfacing genuine test failures and without replacing the repository's
runtime model.

- Task: add one reusable test-runtime warning filter for SQLite-backed package suites
  Status: done
  Acceptance: the repository has one reusable test-only filter or bootstrap path
  that suppresses the known SQLite experimental warning without hiding unrelated
  warnings, and the affected package test scripts use it.
  Artifact: `scripts/install-node-sqlite-warning-filter.mjs`, `packages/storage/package.json`, `packages/source-adapters/package.json`, `apps/cli/package.json`, `apps/api/package.json`

---

## Objective: R31 - Managed-Runtime Manual Review Diaries For Web And API
Status: active
Priority: P2
Source: project-wide KR review sweep on 2026-04-03

A project-wide KR review sweep found that the repository now has stable manual
review contracts for the seeded web slice (`R27`) and remote-agent workflows
(`R29`), but it still does not have backlog-owned execution records for the two
highest-value managed-runtime journeys that remain outside the current automated
bar: (1) the seeded web spot-check with diary capture from `R22`, and (2) the
managed API read journey `J7` from `E2E_2_HLD_USER_JOURNEY_COVERAGE.md`. These
are not agent-executable in this environment because they depend on user-started
services, but they should still be explicitly owned instead of remaining only as
design-note intent.

### KR: R31-KR1 Seeded web spot-check diary is explicitly owned
Status: open
Acceptance: one backlog-owned task exists for running and recording the seeded
web spot-check using the `R27` checklist once the user has started the canonical
services.

- Task: run the seeded web review checklist and record one operator diary
  Status: blocked
  Acceptance: after the user starts the canonical services against a seeded
  review store, one diary records the exact startup command, required checks
  across `Projects`, `Search`, and `Sources`, observed friction, and resulting
  backlog follow-up if needed.
  Artifact: future web-review diary note using `docs/design/R27_USER_STARTED_WEB_REVIEW_CHECKLIST.md`

### KR: R31-KR2 Managed API read journey is explicitly owned
Status: open
Acceptance: one backlog-owned task exists for the `J7-supply-managed-api-read`
manual validation path once a user-started API service is available.

- Task: run and record the managed API read journey against a user-started service
  Status: blocked
  Acceptance: after the user starts the canonical API service against a known
  indexed store, one diary records the route chain, observable parity with the
  canonical store objects, and any friction or drift that should become backlog
  work.
  Artifact: future managed-runtime API review note aligned with `docs/design/E2E_2_HLD_USER_JOURNEY_COVERAGE.md`

---

## Objective: R12 - Experimental Adapter Hardening From Real Archive
Status: done
Priority: P1
Source: user-provided real archive on 2026-03-31

The 2026-03-31 real archive adds substantial Gemini CLI data plus new
transcript-bearing or likely transcript-bearing layouts for Cursor CLI/chat
stores and CodeBuddy. The goal is to convert those findings into truthful
adapter, fixture, and collection-contract work without guessing or letting
config-only paths leak into product semantics.

- Task: record the 2026-03-31 archive inventory and structural findings
  Status: done
  Acceptance: `docs/design/REAL_SOURCE_ARCHIVE_REVIEW_2026-03-31.md` records
  which roots are transcript-bearing, which are candidate-only, and which known
  sources remain absent from the archive.
  Artifact: `docs/design/REAL_SOURCE_ARCHIVE_REVIEW_2026-03-31.md`

### KR: R12-KR1 Gemini real-data review and fixture expansion
Status: done
Acceptance: Gemini assumptions are re-verified against the real archive,
especially the missing-companion case in this bundle, and the backlog captures
the resulting fixture and regression work truthfully.

- Task: review real Gemini bundle structure and missing-companion cases
  Status: done
  Acceptance: a Gemini design note or the existing archive review records the
  actual `.gemini/tmp/<hash>/chats/*.json` + `logs.json` layout and the fact
  that this archive does not include `.project_root` or `projects.json`
  companions.
  Artifact: `docs/design/REAL_SOURCE_ARCHIVE_REVIEW_2026-03-31.md`

- Task: add fully anonymized Gemini scale and missing-companion fixtures
  Status: done
  Acceptance: `mock_data/gemini/` gains only real-archive-justified scenarios,
  including large session sets and missing-companion cases, and
  `pnpm run mock-data:validate` passes.
  Artifact: `mock_data/gemini/`

- Task: add Gemini parser regressions for missing companions and scale behavior
  Status: done
  Acceptance: `pnpm --filter @cchistory/source-adapters test` passes with
  Gemini coverage for missing companion evidence and large real-layout session
  sets.
  Artifact: `pnpm --filter @cchistory/source-adapters test`

### KR: R12-KR2 Cursor CLI/chat-store classification
Status: done
Acceptance: the backlog records a truthful decision on whether
`.cursor/chats/**/store.db` extends the current `cursor` adapter or requires a
separate source objective, backed by schema review rather than assumption.

Decision: keep `.cursor/chats/**/store.db` under the `cursor` platform because
it is a Cursor-owned local surface, but treat it as a separate experimental
source slice rather than extending the current stable Cursor adapter claim.
The blob/meta SQLite layout is materially different from `state.vscdb` and
`agent-transcripts/*.jsonl`, so ownership stays with `cursor` while parser,
fixture, and support-tier work move into a dedicated follow-up objective.

- Task: inspect Cursor chat-store schema and blob/meta encoding from real samples
  Status: done
  Acceptance: a design note records the observed `meta` + `blobs` schema and
  any evidence about workspace, session, and message identity recoverability.
  Artifact: `docs/design/REAL_SOURCE_ARCHIVE_REVIEW_2026-03-31.md`

- Task: decide whether Cursor CLI stays inside `cursor` or needs a separate source slice
  Status: done
  Acceptance: `BACKLOG.md` records a truthful ownership decision and follow-up
  task/KR structure after schema review.
  Artifact: `docs/design/T1_TUI_FIRST_SLICE_PLAN.md`

### KR: R12-KR3 New-tool intake shortlist and collection contract
Status: done
Acceptance: transcript-bearing new-tool candidates from the archive are
classified truthfully, and any adopted future-source work enters the canonical
collection/anonymization workflow rather than ad hoc parser experiments.

- Task: classify CodeBuddy and other newly observed roots as transcript-bearing vs config-only
  Status: done
  Acceptance: `docs/design/REAL_SOURCE_ARCHIVE_REVIEW_2026-03-31.md` or a
  follow-up note records which of `.codebuddy`, `.kiro`, `.happy`, `.roo`, and
  `.zai` actually justify future adapter work.
  Artifact: `docs/design/REAL_SOURCE_ARCHIVE_REVIEW_2026-03-31.md`

- Task: create follow-up objective entries only for new sources with real transcript evidence
  Status: done
  Acceptance: `BACKLOG.md` gains concrete source objectives only for roots whose
  transcript-bearing evidence and canonical-fit analysis are confirmed.
  Artifact: `BACKLOG.md`

- Task: decide canonical collector slots for adopted Cursor chat-store and CodeBuddy roots
  Status: done
  Acceptance: `BACKLOG.md` or a design note records whether the canonical
  sample collector should expose `cursor-chat-store`, `codebuddy`, or another
  slot naming that preserves truthful ownership without conflating source
  variants.
  Artifact: `docs/design/R12_COLLECTOR_SLOT_DECISION_2026-04-01.md`

- Task: extend canonical sample-collection coverage for any adopted new source roots
  Status: done
  Acceptance: `scripts/inspect/collect-source-samples.mjs` and its tests cover
  any newly adopted source roots without adding KR-specific ad hoc collectors.
  Artifact: `scripts/inspect/collect-source-samples.mjs`

---


## Objective: R13 - Cursor Chat-Store Intake
Status: done
Priority: P1
Source: R12-KR2 ownership decision on 2026-04-01
Completed: 2026-04-01

The 2026-03-31 real archive proved `.cursor/chats/**/store.db` is a
Cursor-owned local history surface, and the repository now ships a truthful
experimental chat-store intake slice under the `cursor` platform with metadata
decode, minimal readable-fragment recovery, and explicit opaque-graph audits.
Phase 7 evaluation passed on 2026-04-01. See
`docs/design/R13_CURSOR_CHAT_STORE_INTAKE.md`.

Boundary: keep platform ownership under `cursor`, but model `.cursor/chats/**/store.db` as a distinct experimental chat-store slice rather than a widening of the existing stable Cursor adapter claim. Until blob decoding and regressions exist, do not describe this layout as covered by the current `workspaceStorage/state.vscdb` or `agent-transcripts/*.jsonl` support surface.

- Task: create fully anonymized Cursor chat-store fixtures from real samples
  Status: done
  Acceptance: `mock_data/` gains only real-archive-justified
  `.cursor/chats/**/store.db` fixtures, and fixture validation preserves the
  blob/meta layout without leaking raw user data.
  Artifact: `mock_data/.cursor/chats/`

- Task: define the Cursor chat-store source-family boundary and naming
  Status: done
  Acceptance: `BACKLOG.md` or a design note records how chat-store ingestion
  stays under `cursor` without changing the current stable Cursor support claim
  or conflating it with `state.vscdb` / `agent-transcripts`.
  Artifact: `BACKLOG.md`

- Task: define the minimal Cursor chat-store decode target before parser work
  Status: done
  Acceptance: a design note records which `meta` fields, blob text fragments,
  and session-level cues are safe to surface first, and which blob-graph
  structures remain explicitly out of scope until validated decoding exists.
  Artifact: `docs/design/R13_CURSOR_CHAT_STORE_DECODING_SCOPE.md`

- Task: implement minimal Cursor chat-store decode and ingestion path
  Status: done
  Acceptance: the `cursor` adapter can discover `.cursor/chats/**/store.db`,
  decode the minimal blob/meta evidence defined in
  `docs/design/R13_CURSOR_CHAT_STORE_DECODING_SCOPE.md`, and emit truthful
  experimental session/turn projections without widening the existing stable
  Cursor support claim.
  Artifact: `packages/source-adapters/src/platforms/cursor/`

- Task: add experimental parser regressions for decoded chat-store recovery
  Status: done
  Acceptance: targeted adapter tests prove whatever session/message recovery
  rule is actually supported by the real fixture corpus.
  Artifact: `pnpm --filter @cchistory/source-adapters test`

- Task: extend canonical sample collection for Cursor chat-store roots if adopted
  Status: done
  Acceptance: `scripts/inspect/collect-source-samples.mjs` covers
  `.cursor/chats/**/store.db` through the canonical collector rather than an ad
  hoc script.
  Artifact: `scripts/inspect/collect-source-samples.mjs`

---

## Objective: B2 - Post-Review Experimental Slice Documentation Corrections
Status: done
Priority: P2
Source: KR review sweep on 2026-04-01
Completed: 2026-04-01

The post-R13/R14 review found stale artifact paths and lagging runtime/inspection wording around the adopted experimental slices. Those references now point at the real sanitized fixture roots and the repository-visible docs now describe Cursor chat-store as an experimental intake slice with the `cursor-chat-store` collector slot. Phase 7 evaluation passed on 2026-04-01. See `docs/design/B2_POST_REVIEW_EXPERIMENTAL_SLICE_DOC_CORRECTIONS.md`.

- Task: correct experimental-slice artifact path references in backlog surfaces
  Status: done
  Acceptance: `BACKLOG.md` artifact references for Cursor chat-store and CodeBuddy fixture work point at the actual sanitized fixture roots under `mock_data/.cursor` and `mock_data/.codebuddy`.
  Artifact: `BACKLOG.md`

- Task: update runtime and inspection docs for post-R13 experimental slice status
  Status: done
  Acceptance: the current runtime surface, inspection guide, and any stale archive-review note reflect that Cursor chat-store now has an experimental intake slice and that the canonical collector slot is `cursor-chat-store`.
  Artifact: `docs/design/CURRENT_RUNTIME_SURFACE.md`

---

## Objective: B3 - CodeBuddy Support-Surface Parity Follow-Up
Status: done
Priority: P1
Source: KR review sweep on 2026-04-01
Completed: 2026-04-01

At the time `B3` closed on 2026-04-01, the post-R14 project-wide review had found that `codebuddy` was present in the adapter registry and runtime surface, but the support-status verifier and several support-facing docs still reflected the older ten-adapter / four-experimental state. That cleanup brought the repository back into sync with the then-current `experimental` CodeBuddy tier, and `pnpm run verify:support-status` passed again. A later promotion review moved CodeBuddy to `stable`.

- Task: teach support-status verification and support-tier docs about CodeBuddy
  Status: done
  Acceptance: at the time `B3` closed, `scripts/verify-support-status.mjs`, `README.md`, `README_CN.md`, `docs/design/SELF_HOST_V1_RELEASE_GATE.md`, and `docs/sources/README.md` all reflected the then-registered `codebuddy` experimental tier and `pnpm run verify:support-status` passed.
  Artifact: `pnpm run verify:support-status`

- Task: fix remaining operator-facing platform enumerations after CodeBuddy adoption
  Status: done
  Acceptance: at the time `B3` closed, `docs/ROADMAP.md` and `docs/guide/web.md` no longer omitted `codebuddy` from the then-current registry or manual-addition platform lists.
  Artifact: `docs/guide/web.md`

---

## Objective: B4 - CodeBuddy Manual-Add Web Parity
Status: done
Priority: P1
Source: KR review sweep on 2026-04-01
Completed: 2026-04-01

The post-B3 project-wide review found a remaining runtime-surface gap: support docs already listed CodeBuddy as a manually addable source, but the canonical web `Sources` view still omitted it from the manual-add selector. The web operator flow now truthfully exposes CodeBuddy in that selector, preserving parity between product docs and the actual source-config UI. Phase 7 evaluation passed on 2026-04-01.

- Task: expose CodeBuddy in the canonical web manual-source selector
  Status: done
  Acceptance: `apps/web/components/views/sources-view.tsx` includes `codebuddy` in `MANUAL_SOURCE_OPTIONS`, so operators can add or override CodeBuddy sources through the canonical `Sources` view.
  Artifact: `apps/web/components/views/sources-view.tsx`

---

## Objective: B5 - CodeBuddy Project Summary DTO Parity
Status: done
Priority: P1
Source: KR review sweep on 2026-04-01
Completed: 2026-04-01

The post-B4 project-wide review found that the shared API client still omitted `codebuddy` from `ProjectSummaryDto.source_platforms`, even though the registry, domain model, and sibling DTO unions already treated CodeBuddy as a valid source platform. The DTO contract and generated declarations now include CodeBuddy consistently, keeping read-side project summaries aligned with the canonical adapter set. Phase 7 evaluation passed on 2026-04-01.

- Task: add CodeBuddy to project-summary source-platform DTO unions
  Status: done
  Acceptance: `packages/api-client/src/index.ts` and generated declaration output include `codebuddy` in `ProjectSummaryDto.source_platforms`, and `pnpm --filter @cchistory/api-client build` passes.
  Artifact: `pnpm --filter @cchistory/api-client build`

---

## Objective: B6 - README TUI Runtime Surface Parity
Status: done
Priority: P2
Source: KR review sweep on 2026-04-01
Completed: 2026-04-01

The post-B5 project-wide review found that the canonical TUI entrypoint was already shipped, but `README.md` and `README_CN.md` still presented the runtime as CLI/API/Web only and omitted `apps/tui` from the top-level structure view. The main READMEs now describe the repository as a four-entrypoint runtime, include truthful TUI launch guidance, and list `apps/tui` in the project structure. Phase 7 evaluation passed on 2026-04-01.

- Task: update README runtime diagrams and project structure for TUI
  Status: done
  Acceptance: `README.md` and `README_CN.md` mention the canonical TUI entrypoint in the architecture/runtime overview and list `apps/tui` under `apps/`.
  Artifact: `README.md`

- Task: add README-level TUI launch guidance without inventing a new startup system
  Status: done
  Acceptance: `README.md` and `README_CN.md` document the truthful TUI launch path via the built `apps/tui` entrypoint and do not imply any managed service dependency.
  Artifact: `README_CN.md`

---

## Objective: B7 - Canonical TUI User Guide Surface
Status: done
Priority: P2
Source: KR review sweep on 2026-04-01
Completed: 2026-04-01

The post-B6 project-wide review found that `apps/tui` is now a canonical product entrypoint, but `docs/guide/` still had no dedicated TUI guide and the main READMEs only linked to raw help invocation text. The repository now ships a user-facing TUI guide that covers launch modes, store selection, pane navigation, search mode, overlays, and non-interactive snapshot behavior, and the READMEs link to it as part of the main guide set. Phase 7 evaluation passed on 2026-04-01.

- Task: add a canonical TUI guide under `docs/guide/`
  Status: done
  Acceptance: `docs/guide/tui.md` documents the shipped TUI launch path, keyboard model, and snapshot behavior without inventing API-dependent semantics.
  Artifact: `docs/guide/tui.md`

- Task: include the TUI guide in README guide indexes and structure notes
  Status: done
  Acceptance: `README.md` and `README_CN.md` link to the TUI guide and describe `docs/guide/` as including TUI guidance.
  Artifact: `README.md`

---

## Objective: B8 - Aggregate Non-Web Build Parity For TUI
Status: done
Priority: P1
Source: KR review sweep on 2026-04-01
Completed: 2026-04-01

The post-B7 project-wide review found that the repository described `pnpm run build` as the aggregate non-web workspace build, but the root build script still omitted `@cchistory/tui` even though TUI is now a canonical non-web entrypoint. The aggregate build now includes TUI, and the README development sections list the TUI build/test commands alongside the other package-scoped validations. Phase 7 evaluation passed on 2026-04-01.

- Task: include `@cchistory/tui` in the aggregate non-web root build
  Status: done
  Acceptance: the root `package.json` `build` script includes `pnpm --filter @cchistory/tui build`, keeping the aggregate non-web build truthful for the current runtime surface.
  Artifact: `package.json`

- Task: update README development command examples for the canonical TUI package
  Status: done
  Acceptance: `README.md` and `README_CN.md` list the TUI build/test commands in the development command section so operator-visible guidance matches the shipped package set.
  Artifact: `README.md`

---

## Objective: B9 - Presentation SourcePlatform Parity For CodeBuddy
Status: done
Priority: P1
Source: KR review sweep follow-up on 2026-04-01
Completed: 2026-04-01

Validation of the aggregate non-web build surfaced a remaining type-surface gap: `@cchistory/presentation` still defined `SourcePlatform` without `codebuddy`, even though the adapter registry, domain model, and API DTO layer already allowed it. The presentation-layer platform union and generated declarations now include CodeBuddy, keeping the shared read-side mapping layer compatible with the canonical adapter set and restoring aggregate build correctness. Phase 7 evaluation passed on 2026-04-01.

- Task: add CodeBuddy to the presentation-layer source-platform union
  Status: done
  Acceptance: `packages/presentation/src/index.ts` and generated declaration output include `codebuddy` in `SourcePlatform`, and `pnpm --filter @cchistory/presentation build` passes.
  Artifact: `pnpm --filter @cchistory/presentation build`

---

## Objective: B10 - API Client Checked-In Declaration Parity
Status: done
Priority: P2
Source: KR review sweep on 2026-04-01
Completed: 2026-04-01

The post-B9 project-wide review found a remaining checked-in artifact drift: `packages/api-client/src/index.d.ts` still omitted `codebuddy` in several DTO unions even though the TypeScript source and generated `dist/index.d.ts` already allowed it. The checked-in source declaration file now matches the shipped API contract for session, source-status, and linking-observation DTOs. Phase 7 evaluation passed on 2026-04-01.

- Task: sync checked-in api-client source declarations with the shipped CodeBuddy DTO surface
  Status: done
  Acceptance: `packages/api-client/src/index.d.ts` includes `codebuddy` anywhere the corresponding `dist/index.d.ts` source-platform unions already include it, and `pnpm --filter @cchistory/api-client build` still passes.
  Artifact: `packages/api-client/src/index.d.ts`

---

## Objective: R14 - CodeBuddy Transcript Intake
Status: done
Priority: P1
Source: R12-KR3 transcript-bearing classification on 2026-04-01
Completed: 2026-04-01

The 2026-03-31 real archive confirmed `.codebuddy/projects/**/*.jsonl` as a
transcript-bearing surface. At the time `R14` closed on 2026-04-01, the
repository therefore shipped a truthful `experimental` `codebuddy` adapter with
companion-evidence capture and regression proof. A later promotion review moved
CodeBuddy to `stable`; see `docs/design/R14_CODEBUDDY_TRANSCRIPT_INTAKE.md` and
`R16` below.

Boundary: treat non-empty `.codebuddy/projects/**/*.jsonl` rows as the transcript-bearing surface, while `.codebuddy/settings.json` and `.codebuddy/local_storage/*.info` remain companion evidence. Zero-byte project JSONL files stay fixture-covered as empty sibling captures rather than proof of standalone sessions until parser work demonstrates a better rule.

Decision at the time of `R14`: CodeBuddy should enter as a **new experimental platform** rather than being folded into an existing platform such as `cursor`, `claude_code`, or `codex`. The root path, JSONL message shape, and `providerData` semantics were specific enough to justify separate ownership, and the smallest truthful parser entry slice was: non-empty `.codebuddy/projects/**/*.jsonl` transcript ingestion first, companion capture for `settings.json` and `local_storage/*.info`, and explicit non-promotion of zero-byte JSONL siblings into standalone sessions.

- Task: create fully anonymized CodeBuddy transcript fixtures from real samples
  Status: done
  Acceptance: `mock_data/` gains only real-archive-justified CodeBuddy
  transcript fixtures and `pnpm run mock-data:validate` passes.
  Artifact: `mock_data/.codebuddy/`

- Task: document CodeBuddy session/message shape and companion-file boundary
  Status: done
  Acceptance: `BACKLOG.md` or a design note records which archive-observed files
  belong to transcript ingestion versus companion evidence for CodeBuddy.
  Artifact: `BACKLOG.md`

- Task: decide CodeBuddy platform ownership and parser entry strategy
  Status: done
  Acceptance: `BACKLOG.md` records whether CodeBuddy enters as a new platform
  or another ownership shape, plus the smallest truthful parser entry slice
  consistent with current registry and API/domain enums.
  Artifact: `BACKLOG.md`

- Task: register the experimental CodeBuddy adapter and transcript parser slice
  Status: done
  Acceptance: a new experimental `codebuddy` platform can ingest non-empty
  `.codebuddy/projects/**/*.jsonl` transcript rows plus companion evidence from
  `settings.json` and `local_storage/*.info` without promoting zero-byte JSONL
  siblings into standalone sessions.
  Artifact: `packages/source-adapters/src/platforms/`

- Task: add experimental CodeBuddy parser regressions for transcript extraction
  Status: done
  Acceptance: targeted adapter tests prove the supported CodeBuddy transcript
  projection on top of the sanitized fixture corpus.
  Artifact: `pnpm --filter @cchistory/source-adapters test`

- Task: extend canonical sample collection for adopted CodeBuddy roots
  Status: done
  Acceptance: `scripts/inspect/collect-source-samples.mjs` covers the adopted
  CodeBuddy roots without source-specific one-off collectors.
  Artifact: `scripts/inspect/collect-source-samples.mjs`

---

## Objective: T1 - Canonical TUI
Status: done
Priority: P2
Source: user request on 2026-03-31
Completed: 2026-04-01

CCHistory now exposes a canonical local TUI alongside the CLI, API, and web
entrypoints. The first slice stays on the same canonical read model and ships
project browsing, turn/detail drill-down, global search drill-down, and a
lightweight source-health summary. Phase 7 evaluation passed on 2026-04-01. See
`docs/design/T1_TUI_FIRST_SLICE_PLAN.md`.

### KR: T1-KR1 Scope and workflow inventory
Status: done
Acceptance: a design note records which recall, drill-down, search, and admin
flows belong in the first TUI slice and which remain out of scope, without
inventing parallel product semantics.

- Task: map current CLI/web user journeys into terminal-native recall/admin workflows
  Status: done
  Acceptance: a design note maps the highest-value terminal workflows back to
  current canonical CLI/web surfaces and HLD jobs to be done.
  Artifact: `docs/design/T1_TUI_SCOPE_AND_WORKFLOW_INVENTORY.md`

- Task: define minimal TUI v1 scope and explicit non-goals
  Status: done
  Acceptance: the first TUI slice has explicit in-scope flows, out-of-scope
  flows, and success criteria recorded before implementation.
  Artifact: `docs/design/T1_TUI_SCOPE_AND_WORKFLOW_INVENTORY.md`

### KR: T1-KR2 Architecture and toolkit decision
Status: done
Acceptance: the TUI implementation path chooses one truthful semantic pipeline
and one toolkit strategy after explicit trade-off review.

- Task: evaluate TUI runtime path across direct store, API client, and shared presentation options
  Status: done
  Acceptance: a design note chooses the TUI data path that best preserves one
  semantic pipeline across CLI, API, web, and TUI.
  Artifact: `docs/design/T1_TUI_RUNTIME_PATH_DECISION.md`

- Task: choose the TUI toolkit and interaction primitives after design review
  Status: done
  Acceptance: the chosen toolkit and interaction model are documented with
  trade-offs, risks, and validation impact before implementation begins.
  Artifact: `docs/design/T1_TUI_TOOLKIT_DECISION.md`

### KR: T1-KR3 First delivery slice planning
Status: done
Acceptance: the backlog records the first implementation slice, fixture needs,
and targeted validation commands for a canonical TUI entrypoint.

- Task: define the first TUI slice acceptance, fixture needs, and validation plan
  Status: done
  Acceptance: `docs/design/T1_TUI_FIRST_SLICE_PLAN.md` records the first
  slice, required fixtures, and targeted validation commands before coding.
  Artifact: `docs/design/T1_TUI_FIRST_SLICE_PLAN.md`

---

### KR: T1-KR4 First implementation slice
Status: done
Acceptance: a canonical TUI entrypoint exists and supports project browsing,
turn drill-down, and search on top of the shared local read pipeline.

- Task: scaffold the canonical TUI package and entrypoint
  Status: done
  Acceptance: a new canonical TUI package exists with a buildable entrypoint,
  local store opening path, and no dependency on a managed API service.
  Artifact: `apps/tui/`

- Task: extract a shared read facade for TUI/CLI/API read-side reuse
  Status: done
  Acceptance: the TUI can consume shared read/projection helpers instead of
  duplicating CLI-only or API-route-local mapping logic.
  Artifact: shared read-side module under `packages/` or `apps/`

- Task: implement the first project/turn/detail panes with keyboard focus
  Status: done
  Acceptance: the first TUI slice supports project browsing and turn detail
  inspection with the planned keyboard model.
  Artifact: `apps/tui/`

- Task: add TUI search mode with result-to-detail drill-down
  Status: done
  Acceptance: the first TUI slice lets the operator search turns, keep the
  result list visible, and inspect the selected hit in the existing detail pane
  without leaving the TUI.
  Artifact: `apps/tui/`

- Task: add lightweight TUI source-health summary panel
  Status: done
  Acceptance: the first TUI slice exposes indexed-source counts and lightweight
  health status inside the TUI without inventing a separate admin semantic path.
  Artifact: `apps/tui/`

- Task: add targeted TUI build and interaction tests
  Status: done
  Acceptance: the planned package-scoped TUI validation commands exist and pass.
  Artifact: `pnpm --filter @cchistory/tui test`

---

## Objective: R2 - CLI Search And Session Access Improvements
Status: done
Priority: P1
Source: ROADMAP.md
Completed: 2026-03-28

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

At the time `R5` closed on 2026-03-27, Gemini CLI had reached a sync-supported
`experimental` adapter baseline with real local-sample analysis, a repeatable
sample collector, sanitized fixture coverage, canonical session/turn parsing,
and support-surface docs that agreed with the then-current registry state. A
later promotion review moved Gemini to `stable`; see
`docs/design/R5_GEMINI_CLI_ADAPTER.md` and the later `R15` backlog record.

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

## Objective: V1 - Goal-Level End-To-End Validation And Review-Gap Cleanup
Status: done
Priority: P0
Source: post-implementation review on 2026-04-01
Completed: 2026-04-01

The current repository has strong package-scoped regression coverage, but that
is not yet the same thing as proving the product satisfies the frozen goals in
`HIGH_LEVEL_DESIGN_FREEZE.md`. Another session must not treat passing local unit
or package tests as sufficient evidence that CCHistory is delivering
project-first recall, traceability, administration, and supply correctly across
the canonical entrypoints. That validation slice was completed on 2026-04-01
through the seeded acceptance verifier, the user-started web review path, and a
repeatable real-archive probe command; Phase 7 evaluation passed the same day.

This objective also captures two concrete review findings from the 2026-04-01
review so the follow-up stays visible while broader e2e validation is designed:

- the `buildLocalReadOverview` regression in `packages/storage` was restored to
  green by aligning the fixture with the real workspace-based linking semantics
  under `V1-KR3`, rather than changing the helper to fit a stale expectation.
- the `apps/tui` missing-store mutation bug was fixed under `V1-KR3` so missing
  `--store` / `--db` targets now fail explicitly instead of creating an empty
  SQLite store implicitly.

### KR: V1-KR1 Canonical end-to-end validation design
Status: done
Acceptance: a design note defines the canonical end-to-end validation matrix for
the frozen product jobs, the entrypoints that must be exercised, the fixtures or
real-data-derived stores required, and the exact pass/fail rules that determine
whether the product matches its goals rather than merely compiling.

- Task: define goal-level journeys anchored in the design freeze
  Status: done
  Acceptance: a design note enumerates at least the minimum end-to-end journeys
  for (1) project-scoped recall across multiple sources, (2) traceability from a
  recovered `UserTurn` back to session/context evidence, (3) source/admin health
  inspection without hidden mutation, and (4) supply/restore readability of the
  same canonical objects.
  Artifact: `docs/design/V1_GOAL_LEVEL_E2E_VALIDATION.md`

- Task: define canonical e2e fixture and real-data validation inputs
  Status: done
  Acceptance: the validation design names which sanitized fixtures, seeded local
  stores, and `.realdata/config_dots_20260331_212353/`-backed review probes are
  required to evaluate stable surfaces plus the experimental Cursor chat-store,
  CodeBuddy, Gemini, and OpenCode slices without reducing the problem to toy
  unit cases.
  Artifact: `docs/design/V1_GOAL_LEVEL_E2E_VALIDATION.md`

- Task: define the canonical validation surfaces and command boundaries
  Status: done
  Acceptance: the design records which workflows must be validated through CLI,
  API, web, and TUI entrypoints, which checks remain package-scoped, and which
  verifiers should become canonical repository commands.
  Artifact: `docs/design/V1_GOAL_LEVEL_E2E_VALIDATION.md`

### KR: V1-KR2 End-to-end validation implementation
Status: done
Acceptance: the repository contains executable end-to-end or acceptance-style
validation that exercises the canonical workflows defined in `V1-KR1`, and the
results are strong enough to evaluate whether the product meets the frozen goals
instead of only checking local implementation details.

- Task: add a seeded-store CLI/API/TUI recall-and-traceability verifier
  Status: done
  Acceptance: `pnpm run verify:v1-seeded-acceptance` seeds a canonical store and
  proves that CLI, API, and TUI agree on (1) the recalled committed target
  project, (2) the multi-source turn set under that project, and (3) a known
  turn's linked session/context readability.
  Artifact: `scripts/verify-v1-seeded-acceptance.mjs`, `package.json`

- Task: extend the seeded verifier to source summaries and restored-store readability
  Status: done
  Acceptance: the canonical seeded verifier proves that (1) CLI and API agree on
  source-summary counts for the seeded store, and (2) after export/import into a
  clean target, `restore-check` plus API reads can still recover the same
  project/turn objects without inventing new store state.
  Artifact: `scripts/verify-v1-seeded-acceptance.mjs`, `package.json`

- Task: add a seeded web-review helper and canonical user-started review note
  Status: done
  Acceptance: the repository provides (1) a helper that materializes the seeded
  V1 acceptance store at an explicit path, (2) an API runtime override that lets
  the canonical user-started service flow read that store without changing the
  startup architecture, and (3) exact web review steps plus expected observations
  for the same project/turn journey already covered by CLI/API/TUI verification.
  Artifact: `apps/api/src/app.ts`, `docs/guide/web.md`, `scripts/verify-v1-seeded-acceptance.mjs`, `package.json`

- Task: add a repeatable real-archive probe verifier for adopted experimental slices
  Status: done
  Acceptance: one repository verification command checks the available archive at
  `.realdata/config_dots_20260331_212353/` for the specific Gemini, Cursor
  chat-store, CodeBuddy, and OpenCode structures the experimental claims now
  depend on, and the command fails if those review assumptions drift.
  Artifact: `scripts/verify-real-archive-probes.mjs`, `package.json`, `docs/design/REAL_SOURCE_ARCHIVE_REVIEW_2026-03-31.md`

### KR: V1-KR3 Immediate review-gap cleanup
Status: done
Acceptance: the known regressions found during the 2026-04-01 review are fixed
in a way that strengthens the product semantics and validation story instead of
merely changing tests to fit current output.

- Task: fix the failing `buildLocalReadOverview` regression without test-fitting
  Status: done
  Acceptance: `pnpm --filter @cchistory/storage test` passes again, and the fix
  either aligns the test fixture with the real project-linking semantics or
  corrects the helper behavior if the helper is actually wrong.
  Artifact: `packages/storage/src/index.test.ts`

- Task: make the TUI missing-store path read-only and explicit
  Status: done
  Acceptance: launching the TUI against a missing `--store` or `--db` path does
  not create a fresh SQLite store implicitly; it instead reports the missing
  indexed store clearly, and focused TUI regression coverage proves the
  non-mutating behavior.
  Artifact: `apps/tui/`

---

## Objective: R32 - Skeptical Manual Review For CLI And TUI Rich Browse/Search
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03
Completed: 2026-04-03

A project-wide KR review sweep found that `R24` and `R28` delivered the rich
CLI/TUI browse-search surface plus regression repair, and `R25` added one
skeptical manual diary for bundle/restore workflows, but the repository still
has no backlog-owned skeptical operator review for the newly shipped `ls`/`tree`
/ `show` / `search` browse ergonomics themselves. The current automated tests
prove semantics and regressions, but they do not answer the more demanding user
question: whether a picky operator can actually use project/session/turn/
related-work browsing, `--long` expansion, search pivots, and TUI drill-down in
ways that feel coherent, discoverable, and worth the extra surface area. Unlike
managed-runtime review, this gap is agent-executable on this host and should be
owned explicitly.

### KR: R32-KR1 CLI rich browse/search workflow gets a skeptical operator diary
Status: done
Acceptance: one manual diary records the real operator experience of using the
shipped CLI read surface for project, session, turn, and related-work browsing,
including compact versus `--long` output, `tree session --long`, search pivots,
and flag/error-path readability.

- Task: run and record a skeptical CLI browse/search diary across long, tree, and pivot flows
  Status: done
  Acceptance: one review note records exact commands, expected versus observed
  behavior, friction notes, and backlog action for at least `ls projects`, `ls
  sessions --long`, `tree project`, `tree session --long`, `search`, `show
  turn`, and the session/project pivots suggested by search output.
  Artifact: `docs/design/R32_SKEPTICAL_BROWSE_SEARCH_REVIEW.md`

### KR: R32-KR2 TUI browse/search workflow gets a skeptical operator diary
Status: done
Acceptance: one manual diary records whether the current TUI browse/search
surface feels coherent and information-dense enough for the same skeptical
operator job, including browse panes, search-mode drill-down, related-work
cues, and read-only guardrail clarity.

- Task: run and record a skeptical TUI browse/search diary across browse and search modes
  Status: done
  Acceptance: one review note records exact launch modes, search inputs,
  observed browse/search/detail behavior, friction notes, and backlog action for
  both the default browse view and at least one `--search` drill-down snapshot
  against the same indexed store.
  Artifact: `docs/design/R32_SKEPTICAL_BROWSE_SEARCH_REVIEW.md`

### KR: R32-KR3 Skeptical browse/search friction becomes backlog-owned follow-up
Status: done
Acceptance: any meaningful friction discovered during the skeptical CLI/TUI
browse-search review becomes explicit backlog work before broader corrective
changes begin.

- Task: convert skeptical browse/search findings into backlog-owned corrections before non-trivial fixes
  Status: done
  Acceptance: every `S2` or `S3` friction point from the CLI/TUI browse-search
  diary becomes a concrete task, KR, or objective in `BACKLOG.md` before
  non-trivial browse-search corrective work proceeds.
  Artifact: `BACKLOG.md`, `docs/design/R32_SKEPTICAL_BROWSE_SEARCH_REVIEW.md`

---

## Objective: R33 - Skeptical Browse/Search Friction Cleanup
Status: done
Priority: P1
Source: `R32` skeptical manual review on 2026-04-03
Completed: 2026-04-03

The `R32` diary proved that the shipped CLI/TUI rich browse/search slice is
useful, but it also found three operator-facing issues that should be corrected
before this surface is described as polished under skeptical manual use: (1)
routine TUI runtime warning noise, (2) duplicated delegated-session rows in
session detail/tree related-work output, and (3) TUI search ordering/default
selection that feels less trustworthy than the CLI for the same query.

### KR: R33-KR1 TUI runtime output no longer looks unstable during ordinary read flows
Status: done
Acceptance: the built TUI no longer emits routine SQLite experimental-warning
noise during ordinary help, snapshot, search-snapshot, or missing-store flows on
this host unless the operator explicitly opts into runtime warnings.

- Task: suppress routine SQLite experimental-warning noise in TUI runtime entry flows
  Status: done
  Acceptance: `node apps/tui/dist/index.js --help`, `node apps/tui/dist/index.js --store <store>`, `node apps/tui/dist/index.js --store <store> --search <query>`, and missing-store failure paths no longer prepend SQLite experimental-warning noise by default, while preserving an explicit opt-in escape hatch for diagnostics.
  Artifact: `apps/tui/src/index.ts`, `apps/tui/src/index.test.ts`

### KR: R33-KR2 Related-work session detail output stays evidence-preserving without duplicate operator rows
Status: done
Acceptance: CLI/TUI session detail and hierarchy views do not inflate delegated-session related-work output with duplicate operator rows when multiple fragments describe the same child session relationship.

- Task: deduplicate repeated delegated-session rows in operator-facing session detail/tree surfaces
  Status: done
  Acceptance: the relevant storage or presentation path collapses duplicate delegated-session entries when they point at the same operator-visible child relationship, while preserving raw evidence references and keeping automation-run handling truthful.
  Artifact: `packages/storage`, `apps/cli`, `apps/tui`

### KR: R33-KR3 TUI search drill-down ordering feels aligned with the stronger CLI recall experience
Status: done
Acceptance: for the same query and store, TUI search snapshot drill-down does not foreground obviously weaker fallback matches ahead of the more relevant turn hits that already feel primary in the CLI search flow.

- Task: align TUI search ordering and default selection with stronger operator expectations
  Status: done
  Acceptance: a skeptical query such as the reviewed `code reviewer` case produces a TUI result ordering/default selection that better matches the operator trust established by the CLI search surface, without weakening turn-first semantics or hiding fallback matches.
  Artifact: `apps/tui/src/browser.ts`, `apps/tui/src/index.test.ts`

---

## Objective: R34 - Human-Readable CLI Turn Detail Labels
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `R33` completion
Completed: 2026-04-03

A fresh KR review sweep after closing `R33` found one remaining operator-facing
readability gap from the `R32` skeptical diary that is still unowned: `show turn`
continues to print raw internal `project-...` and `srcinst-...` identifiers in
its primary detail header, even though nearby browse/search surfaces already use
friendlier project display names and source platform labels. The command is
truthful today, but the detail view still feels more internal than the rest of
the operator surface.

### KR: R34-KR1 `show turn` exposes friendlier project and source labels without hiding canonical refs
Status: done
Acceptance: the default human-readable `show turn` output uses friendlier
project/source labels consistent with nearby browse/search surfaces while still
keeping the canonical turn/session identity explicit and preserving `--json` for
full machine-readable IDs.

- Task: replace raw project and source header labels in CLI `show turn` text output with operator-friendly detail labels
  Status: done
  Acceptance: `cchistory show turn <ref>` no longer leads with only raw
  `project-...` / `srcinst-...` identifiers when a friendlier project display
  name or source platform label is available, and targeted CLI validation proves
  the revised detail view stays truthful and drill-down friendly.
  Artifact: `apps/cli/src/main.ts`, `apps/cli/src/index.test.ts`

---

## Objective: R35 - Managed Remote-Agent Manual Review Diaries
Status: active
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `R34` completion

A fresh project-wide KR review sweep found that `R29` now gives the repository a
truthful remote-agent validation contract, but it still does not give that
contract backlog-owned execution records. The contract explicitly says the
remote-agent surface is not yet proven as a real operator workflow against a
user-started API service, and it names concrete manual scenarios for `agent
pair`, `agent upload`, `agent schedule`, and `agent pull`. Those server-backed
journeys remain unowned execution work today even though the local mocked test
surface is already in place.

### KR: R35-KR1 Pair/upload/schedule remote-agent workflow is explicitly owned as a manual diary
Status: open
Acceptance: one backlog-owned task exists for running and recording a real
remote-agent pair/upload/schedule workflow against a user-started API service,
using the contract fields from `R29`.

- Task: run and record a remote-agent pair/upload/schedule manual diary against a user-started API service
  Status: blocked
  Acceptance: after the user starts the canonical API service, one diary records
  server URL, state-file path, exact `agent pair` / `agent upload` /
  `agent schedule` commands, expected versus observed behavior, and any trust or
  readability friction using the evidence fields from
  `docs/design/R29_REMOTE_AGENT_VALIDATION_CONTRACT.md`.
  Artifact: future remote-agent manual review note aligned with `docs/design/R29_REMOTE_AGENT_VALIDATION_CONTRACT.md`

### KR: R35-KR2 Leased pull and admin job workflow is explicitly owned as a manual diary
Status: open
Acceptance: one backlog-owned task exists for the server-backed leased-job path,
including admin job creation and one `agent pull` execution against a
user-started API service.

- Task: run and record a remote-agent leased-pull manual diary against a user-started API service
  Status: blocked
  Acceptance: after the user starts the canonical API service, one diary records
  job creation input, `agent pull` lease/completion behavior, admin inventory or
  job visibility, expected versus observed results, and any friction or drift
  that should become backlog work.
  Artifact: future remote-agent manual review note aligned with `docs/design/R29_REMOTE_AGENT_VALIDATION_CONTRACT.md`

---

## Objective: R36 - Exploratory Real-Archive Review Diary Beyond Scoped Probes
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `R35` completion

A fresh project-wide KR review sweep found that `R22_OPERATOR_EXPERIENCE_E2E.md`
still explicitly classifies one remaining manual validation mode that is not yet
backlog-owned: large real-archive exploratory review beyond the scoped
`verify:real-archive-probes` command. The repository already has reviewed
archive probes for Gemini, Cursor chat-store, CodeBuddy, and OpenCode structure
assumptions, plus source-specific backlog for LobeChat and OpenClaw evidence.
What is still missing is one explicit diary-style exploratory sweep over the
currently available `.realdata/` review bundles to capture any broader drift,
operator surprises, or cross-source intake assumptions that the narrow probes do
not cover.

### KR: R36-KR1 Current `.realdata/` review bundles get one exploratory diary
Status: done
Acceptance: one diary records the current repository-local `.realdata/` review
bundles, the archive paths inspected, what was checked beyond the scoped probe
command, and whether any additional backlog-owned work is required.

- Task: run and record an exploratory review of the current `.realdata/` bundles beyond scoped probe assertions
  Status: done
  Acceptance: one review note records the archive inputs, commands run, observed
  transcript-bearing and companion-bearing roots, any drift or notable absences
  beyond `verify:real-archive-probes`, and concrete backlog follow-up if the
  exploratory sweep finds unowned issues.
  Artifact: `docs/design/R36_EXPLORATORY_REAL_ARCHIVE_REVIEW.md`


---

## Objective: R37 - Automated Bundle Conflict Recovery Verification
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `R36` completion
Completed: 2026-04-03

A fresh project-wide KR review sweep found one still-unowned post-`V1`
validation gap in `docs/design/R22_OPERATOR_EXPERIENCE_E2E.md`: walkthrough 4
(`export` / `import` recovery and conflict visibility) is explicitly classified
as something that should already be automated, but the repository currently only
proved (1) clean restore readability in `verify:v1-seeded-acceptance` and (2)
one manual skeptical CLI diary in `R25`. That gap is now closed by a dedicated,
repeatable verifier for populated-target conflict recovery plus runtime-surface
doc updates.

### KR: R37-KR1 Export/import conflict recovery becomes a repeatable verifier
Status: done
Acceptance: one repository-owned verifier proves bundle recovery on a populated
target, including default conflict failure, dry-run conflict previews,
`--on-conflict skip`, `--on-conflict replace`, and post-resolution readability
through `restore-check` plus API or CLI readback of the same canonical object.

- Task: implement a repeatable bundle-conflict recovery verifier and wire it into the documented runtime command surface
  Status: done
  Acceptance: one repository command exercises export to a clean target,
  re-import conflict failure, dry-run conflict and replace previews,
  `--on-conflict skip`, `--on-conflict replace`, `restore-check`, and one
  canonical readback after replacement; runtime-inventory docs mention the new
  verifier if it adds a user-visible command.
  Artifact: `scripts/verify-bundle-conflict-recovery.mjs`, `package.json`, `docs/design/CURRENT_RUNTIME_SURFACE.md`, `AGENTS.md`, `docs/design/R22_OPERATOR_EXPERIENCE_E2E.md`


---

## Objective: R38 - Real-Layout Fixture Sync-To-Read Verification
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `R37` completion
Completed: 2026-04-03

A fresh project-wide KR review sweep found one still-unowned gap in the
post-`V1` operator-validation matrix from `docs/design/R22_OPERATOR_EXPERIENCE_E2E.md`:
`verify:real-archive-probes` re-checks archive structure assumptions for
Gemini, Cursor chat-store, CodeBuddy, and OpenCode, but the repository still
lacked a repeatable user-journey-style verifier showing that real-layout-backed
fixture slices can actually sync into a clean store and remain readable through
canonical browse/search/session paths. That gap is now closed by a dedicated
verifier plus runtime-surface doc updates.

### KR: R38-KR1 Real-layout-backed fixture sources get one sync-to-read verifier
Status: done
Acceptance: one repository-owned verifier proves that a clean store can sync a
real-layout-backed fixture slice and then expose truthful project/session/turn
readability across the canonical read surfaces for the platforms justified by
repo fixtures.

- Task: implement a real-layout fixture sync-to-read verifier and wire it into the documented verification surface
  Status: done
  Acceptance: one repository command seeds temp HOME roots for the available
  real-layout-backed fixture platforms, runs `sync` into a clean store, proves
  source inventory plus representative project/session/turn readability through
  CLI/API/TUI for the fixture-backed slice, and updates runtime docs if the
  command becomes part of the canonical verifier surface.
  Artifact: `scripts/verify-real-layout-sync-recall.mjs`, `package.json`, `docs/design/CURRENT_RUNTIME_SURFACE.md`, `AGENTS.md`, `docs/design/R22_OPERATOR_EXPERIENCE_E2E.md`


---

## Objective: R39 - Related-Work Browse/Search Verification
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `R38` completion
Completed: 2026-04-03

A fresh project-wide KR review sweep found one still-unowned operator-validation
gap after `R38`: the repository already had strong point proofs for delegated
child-session and automation-run semantics (`R20`, `R21`, package tests, and
`R24`/`R32` browse work), but it still lacked one repeatable multi-surface
verifier that treats those richer related-work cases like a real browse/search
job across project, session, turn, and subagent-adjacent context. That gap is
now closed by a dedicated verifier plus runtime-surface doc updates.

### KR: R39-KR1 Delegated and automation related-work recall becomes a repeatable verifier
Status: done
Acceptance: one repository-owned verifier proves that delegated child-session
and automation-run context stays traceable through synced-store CLI search, turn
detail, session tree, TUI search drill-down, and API read-side related-work
inspection for the same canonical fixture-backed objects.

- Task: implement a related-work recall verifier and wire it into the documented verification surface
  Status: done
  Acceptance: one repository command syncs the fixture sources needed for
  delegated child-session and automation-run evidence, proves project/session/
  turn browse-search traceability through CLI and TUI, verifies API read-side
  related-work visibility for both delegated and automation contexts, and updates
  runtime docs if the command becomes part of the canonical verifier surface.
  Artifact: `scripts/verify-related-work-recall.mjs`, `package.json`, `docs/design/CURRENT_RUNTIME_SURFACE.md`, `AGENTS.md`, `docs/design/R22_OPERATOR_EXPERIENCE_E2E.md`


---

## Objective: B71 - README Verification Surface Parity After Validation Expansion
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `R39` completion
Completed: 2026-04-03

A fresh project-wide KR review sweep found that the main repository entrypoints
(`README.md` and `README_CN.md`) still surfaced only the early clean-install and
CLI-artifact verifier paths even though the shipped validation surface now also
includes seeded acceptance, read-only admin, fixture sync-to-recall, bundle
conflict recovery, real-layout sync-to-read, related-work recall, user-started
web-review preparation, and real-archive truthfulness probes. Because the main
READMEs are where operators first look for repository-level verification hooks,
that omission made the current validation surface harder to discover than the
canonical runtime inventory said it was. The READMEs now expose the broader
current verifier surface directly while still pointing deeper details to the
canonical runtime inventory.

### KR: B71-KR1 Main READMEs expose the broader shipped verifier surface
Status: done
Acceptance: `README.md` and `README_CN.md` list the current repository-level
verification entrypoints truthfully enough for operator discovery, without
claiming that every verifier replaces blocked manual-review work.

- Task: add the current verifier inventory to the main README quick-start sections
  Status: done
  Acceptance: the main READMEs mention the shipped release-gate verifiers, the
  local operator-style verifier set, and the user-started/archive review helper
  commands, while pointing detailed semantics back to
  `docs/design/CURRENT_RUNTIME_SURFACE.md`.
  Artifact: `README.md`, `README_CN.md`, `BACKLOG.md`


---

## Objective: B72 - Web Checklist Validation-Relationship Parity After Verifier Expansion
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `B71` completion
Completed: 2026-04-03

A follow-up project-wide KR review sweep found that the active user-started web
review artifact in `docs/design/R27_USER_STARTED_WEB_REVIEW_CHECKLIST.md` still
framed its relationship to existing validation in terms of only the earliest
three local verifiers. That wording was no longer fully truthful once bundle
conflict recovery, real-layout sync-to-read, related-work recall, and
real-archive probe verification became part of the shipped current validation
surface. The checklist now references the broader verifier set while still
preserving its original boundary: web review remains the manual user-started
projection contract rather than a replacement for local automated proof.

### KR: B72-KR1 Web review checklist names the broader current verifier surface
Status: done
Acceptance: `docs/design/R27_USER_STARTED_WEB_REVIEW_CHECKLIST.md` no longer
implies that only the earliest local verifiers exist, and it points readers at
`docs/design/CURRENT_RUNTIME_SURFACE.md` for the canonical verifier inventory.

- Task: widen the web checklist's validation-relationship note to the current verifier set
  Status: done
  Acceptance: the checklist's `Relationship To Existing Validation` section
  mentions the later shipped verifier commands relevant to local operator proof
  and clarifies that the canonical current-state inventory lives in
  `docs/design/CURRENT_RUNTIME_SURFACE.md`.
  Artifact: `docs/design/R27_USER_STARTED_WEB_REVIEW_CHECKLIST.md`, `BACKLOG.md`


---

## Objective: B73 - V1 Validation Note Current-Surface Parity After Verifier Expansion
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `B72` completion
Completed: 2026-04-03

A follow-up project-wide KR review sweep found that
`docs/design/V1_GOAL_LEVEL_E2E_VALIDATION.md` still summarized the repository's
validation surface as if only the earliest seeded acceptance, web-review helper,
and real-archive probe paths existed. That note is still an active current-state
reference for how validation is supposed to map onto the frozen product goals,
so leaving it at the first-pass closure point understated the later shipped
verifier surface from `R22`, `R37`, `R38`, and `R39`. The note now keeps its
original `V1` framing while acknowledging the broader current local verifier set
and pointing the canonical inventory back to `docs/design/CURRENT_RUNTIME_SURFACE.md`.

### KR: B73-KR1 V1 validation note acknowledges the broader shipped verifier surface
Status: done
Acceptance: `docs/design/V1_GOAL_LEVEL_E2E_VALIDATION.md` no longer implies that
only the earliest three validation commands exist, and it references the current
runtime inventory for the detailed verifier contract.

- Task: widen the V1 validation note's current-verifier summary after later validation delivery
  Status: done
  Acceptance: the V1 note's CLI/current-verifier summary and closing result
  paragraph mention the later shipped verifier commands truthfully without
  pretending that blocked managed-runtime/manual work has become automated.
  Artifact: `docs/design/V1_GOAL_LEVEL_E2E_VALIDATION.md`, `BACKLOG.md`


---

## Objective: B74 - R22 Gap-Matrix Parity After Validation Follow-Through
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `B73` completion
Completed: 2026-04-03

A further project-wide KR review sweep found that `docs/design/R22_OPERATOR_EXPERIENCE_E2E.md` still contained its original post-`V1` gap matrix even after later objectives closed many of the listed local verifier gaps. The note's command table and follow-up log had been updated, but the matrix rows still said work such as read-only admin, fresh-store sync-to-recall, restore conflict recovery, and real-layout sync-to-read were missing. That made the design note internally inconsistent and understated how much of the local operator-validation bar is now already covered. The matrix now distinguishes between closed local-automation gaps and the still-blocked managed-runtime/manual diary work under `R31` and `R35`.

### KR: B74-KR1 R22 gap matrix matches the current validation surface
Status: done
Acceptance: the `Post-\`V1\` Gap Matrix` in `docs/design/R22_OPERATOR_EXPERIENCE_E2E.md` no longer lists already delivered verifier slices as missing proof, and it points the remaining gaps at the correct manual/blocking objectives.

- Task: update the R22 post-V1 gap matrix after later verifier delivery
  Status: done
  Acceptance: the matrix rows for seeded recall, read-only admin, fresh-store sync, search drill-down, restore/import recovery, real-layout truthfulness, and remote-agent validation reflect the current verifier surface truthfully while preserving the blocked manual-review boundary for web and remote-agent diaries.
  Artifact: `docs/design/R22_OPERATOR_EXPERIENCE_E2E.md`, `BACKLOG.md`


---

## Objective: B75 - V1 Note Historical-Planning Framing Parity After Delivery
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `B74` completion
Completed: 2026-04-03

A further project-wide KR review sweep found that
`docs/design/V1_GOAL_LEVEL_E2E_VALIDATION.md` still contained future-tense
sections titled `Recommended Implementation Order` and `Expected Deliverables For
The Next Session`, even though the note's own result section and the later
backlog history now show that those steps were already executed. That wording
was misleading because it made one historical planning note look like a live
open worklist. The note now keeps those sections as historical context and
points readers at the current-state inventory documents for any remaining work.

### KR: B75-KR1 V1 note no longer presents delivered planning steps as live work
Status: done
Acceptance: `docs/design/V1_GOAL_LEVEL_E2E_VALIDATION.md` preserves the original
planning sequence as historical context, but no longer frames it as the next
session's still-open implementation order.

- Task: reframe the V1 note's implementation-order and next-session sections as historical context
  Status: done
  Acceptance: the note's planning sections clearly read as historical first-pass
  guidance, and they point current readers at `CURRENT_RUNTIME_SURFACE.md`,
  `R22_OPERATOR_EXPERIENCE_E2E.md`, and `BACKLOG.md` for the live validation
  surface and remaining gaps.
  Artifact: `docs/design/V1_GOAL_LEVEL_E2E_VALIDATION.md`, `BACKLOG.md`


---

## Objective: B76 - Validation Notes Historical-Framing Parity After Delivery
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `B75` completion
Completed: 2026-04-03

A subsequent project-wide KR review sweep found that `docs/design/V1_GOAL_LEVEL_E2E_VALIDATION.md` and `docs/design/R22_OPERATOR_EXPERIENCE_E2E.md` still retained a few planning-time phrases such as `the next session should` and `the next slice should` even after the corresponding local validation slices had already landed. The command inventories, gap matrices, and follow-up logs were now current, but these residual future-tense lines still made the notes read like partially open plans rather than historical design context plus current-state references. Both notes now keep their original design intent while framing the delivered planning sections historically and pointing readers at the current runtime inventory and backlog for live work.

### KR: B76-KR1 Validation design notes no longer present delivered planning steps as open future work
Status: done
Acceptance: `docs/design/V1_GOAL_LEVEL_E2E_VALIDATION.md` and `docs/design/R22_OPERATOR_EXPERIENCE_E2E.md` preserve their original planning rationale, but no longer describe already delivered local validation slices as if they were still the next session's open implementation plan.

- Task: reframe the remaining future-tense planning language in the V1 and R22 validation notes
  Status: done
  Acceptance: the affected intro, walkthrough-planning, and backlog-direction sections read as historical framing or current-state guidance instead of live next-session instructions, while keeping the still-blocked manual diary work explicit in `BACKLOG.md`.
  Artifact: `docs/design/V1_GOAL_LEVEL_E2E_VALIDATION.md`, `docs/design/R22_OPERATOR_EXPERIENCE_E2E.md`, `BACKLOG.md`


---

## Objective: B77 - R23 Design Note Historical-Framing Parity After Delivery
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `B76` completion
Completed: 2026-04-03

A further project-wide KR review sweep found that `docs/design/R23_CANONICAL_DELEGATION_GRAPH.md` still contained several planning-time phrases such as `next slice`, `next implementation slice`, and `Recommended next execution order` even though `R23` itself is now fully delivered in `BACKLOG.md`. The note's design conclusions were still useful, but that wording made a finished design-and-implementation objective read like an open plan. The note now keeps the same canonical-model reasoning while framing those sections historically so current readers are not misled about whether `R23` is still pending.

### KR: B77-KR1 R23 design note no longer presents delivered planning steps as live future work
Status: done
Acceptance: `docs/design/R23_CANONICAL_DELEGATION_GRAPH.md` preserves its design rationale, but no longer uses `next slice` style wording for steps that were already delivered under `R23-KR2` and `R23-KR3`.

- Task: reframe the remaining planning-time wording in the R23 design note as historical context
  Status: done
  Acceptance: the evidence-survey outcome, canonical-representation decision, implementation-impact summary, fixture scope, and backlog-consequence sections read as historical design context aligned with the now-completed `R23` backlog objective.
  Artifact: `docs/design/R23_CANONICAL_DELEGATION_GRAPH.md`, `BACKLOG.md`


---

## Objective: B78 - R6 Execution-Log Historical Framing Parity
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `B77` completion
Completed: 2026-04-03

A further project-wide KR review sweep found that `docs/design/R6_GENERIC_PARSER_ABSTRACTION.md` still used the phrase `The next slice is ...` inside the completed KR1 and KR2 execution logs even though `R6` is already fully done in `BACKLOG.md`. Those notes were small, but they could still mislead a future agent into reading one completed parser-abstraction log as if KR2/KR3 were pending. The note now keeps the same execution history while framing those transitions as already delivered follow-on slices.

### KR: B78-KR1 R6 execution log no longer presents delivered KR handoffs as pending next slices
Status: done
Acceptance: the completed KR execution notes in `docs/design/R6_GENERIC_PARSER_ABSTRACTION.md` preserve the historical sequencing from KR1 to KR2 to KR3, but no longer describe those later KRs as still-open `next slice` work.

- Task: reframe the completed R6 KR handoff lines as historical follow-on slices
  Status: done
  Acceptance: the affected KR1/KR2 notes say the later parser-abstraction slices were subsequently delivered, aligning the design note with the now-completed `R6` backlog objective.
  Artifact: `docs/design/R6_GENERIC_PARSER_ABSTRACTION.md`, `BACKLOG.md`


---

## Objective: B79 - R4 Tree-Discovery Historical Framing Parity
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `B78` completion
Completed: 2026-04-03

A further project-wide KR review sweep found that `docs/design/R4_UI_UX_IMPROVEMENTS.md` still described the tree-view discovery subsection in terms of `the next tree surface`, `Open design decisions requiring the next slice`, and `Next recommended step` even though `R4` is already completed and the tree slice shipped. The note's discovery content is still useful historical context, but the future-tense phrasing made one delivered UI objective read like an open tree-view plan. The tree-discovery section now keeps the same design considerations while framing them historically.

### KR: B79-KR1 R4 tree-view discovery note no longer presents the shipped tree slice as pending next work
Status: done
Acceptance: `docs/design/R4_UI_UX_IMPROVEMENTS.md` preserves the tree-view discovery rationale, but no longer uses `next slice` or `next recommended step` wording for the already delivered `R4-KR3` tree slice.

- Task: reframe the R4 tree-view discovery handoff as historical context
  Status: done
  Acceptance: the tree-view constraint and discovery section clearly reads as historical design context for the delivered tree mode, aligned with the now-completed `R4` backlog objective.
  Artifact: `docs/design/R4_UI_UX_IMPROVEMENTS.md`, `BACKLOG.md`


---

## Objective: B80 - R8 Windows-Compatibility Historical Framing Parity
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `B79` completion
Completed: 2026-04-03

A further project-wide KR review sweep found that `docs/design/R8_WINDOWS_COMPATIBILITY.md` still used the heading `Recommended next step` and described the Windows slice as work that should proceed to Phase 2 and Phase 3, even though `R8` is already completed in `BACKLOG.md`. The design note's decomposition logic is still useful, but that wording made one delivered compatibility objective read like pending execution. The note now keeps the same Windows path, discovery, and fixture rationale while framing that handoff historically.

### KR: B80-KR1 R8 design note no longer presents the delivered Windows slice as pending next work
Status: done
Acceptance: `docs/design/R8_WINDOWS_COMPATIBILITY.md` preserves its decomposition rationale, but no longer uses `Recommended next step` wording for the already delivered `R8-KR1` through `R8-KR3` slice.

- Task: reframe the R8 next-step handoff as historical context
  Status: done
  Acceptance: the Windows compatibility note clearly says the Phase 2/3 handoff was the historical next step at decomposition time and that the slice is now delivered, aligning the note with the completed `R8` backlog objective.
  Artifact: `docs/design/R8_WINDOWS_COMPATIBILITY.md`, `BACKLOG.md`


---

## Objective: B81 - V1 Validation-Matrix Historical Framing Parity
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `B80` completion
Completed: 2026-04-03

A further project-wide KR review sweep found that `docs/design/V1_GOAL_LEVEL_E2E_VALIDATION.md` still introduced its canonical validation matrix with the sentence `The next implementation slice should cover ...` even though `V1` is already completed in `BACKLOG.md` and the note's status section explicitly records that delivery. The matrix itself is still the right baseline, but that one future-tense line made the note read like a partially open implementation plan instead of a delivered validation standard plus historical context. The note now keeps the same journey matrix while framing it as the implemented baseline established by `V1`.

### KR: B81-KR1 V1 validation note no longer presents the delivered journey matrix as a pending next slice
Status: done
Acceptance: `docs/design/V1_GOAL_LEVEL_E2E_VALIDATION.md` preserves the same canonical journey matrix, but no longer introduces it as a still-pending `next implementation slice`.

- Task: reframe the V1 validation-matrix lead-in as historical/current baseline context
  Status: done
  Acceptance: the canonical validation matrix is introduced as the baseline defined and delivered by `V1`, while keeping the same journey content and pass/fail expectations.
  Artifact: `docs/design/V1_GOAL_LEVEL_E2E_VALIDATION.md`, `BACKLOG.md`



---

## Objective: B82 - R20 Secondary-Evidence Historical Framing Parity
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `B81` completion
Completed: 2026-04-03

A further project-wide KR review sweep found that `docs/design/R20_AUTOMATION_CRON_SUBAGENT_SEMANTICS.md` still summarized its outcome as work to classify evidence `before parser changes begin` and still introduced its acceptance gate as `The next implementation slice under R20 should only pass ...` even though `R20` is already completed in `BACKLOG.md`, including parser/projection work under `R20-KR4`. The note's design reasoning remains correct, but those phrases made one delivered secondary-evidence objective read like a still-open pre-implementation plan. The note now keeps the same evidence taxonomy and pass conditions while framing them as the delivered baseline for `R20`.

### KR: B82-KR1 R20 design note no longer presents delivered secondary-evidence work as a pending implementation slice
Status: done
Acceptance: `docs/design/R20_AUTOMATION_CRON_SUBAGENT_SEMANTICS.md` preserves the same automation/subagent evidence taxonomy and pass conditions, but no longer describes them as pre-parser or next-slice work after `R20` completion.

- Task: reframe the R20 outcome and acceptance-gate wording as delivered baseline context
  Status: done
  Acceptance: the `R20` note states that its evidence classification was established and then implemented under the completed objective, and its acceptance section reads as the delivered gate for `R20` rather than an open next-slice instruction.
  Artifact: `docs/design/R20_AUTOMATION_CRON_SUBAGENT_SEMANTICS.md`, `BACKLOG.md`



---

## Objective: B83 - R25 Skeptical Diary Historical-Framing Parity
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `B82` completion
Completed: 2026-04-03

A further project-wide KR review sweep found that `docs/design/R25_SKEPTICAL_OPERATOR_ACCEPTANCE_SWEEP.md` now includes an explicit follow-up verification section showing that the CLI warning-noise issue was fixed, but its earlier `Conclusion` section still reads like the warning cleanup is an open next step. The diary remains valuable, yet that unresolved wording could still mislead a future reader into thinking the skeptical CLI bundle/restore slice is still blocked on the already-delivered stderr cleanup. The note now preserves the original diary outcome while framing that first conclusion historically and pointing readers at the resolved follow-up.

### KR: B83-KR1 R25 skeptical diary no longer presents the resolved warning cleanup as still-open follow-up
Status: done
Acceptance: `docs/design/R25_SKEPTICAL_OPERATOR_ACCEPTANCE_SWEEP.md` preserves the original diary observations, but no longer leaves its main conclusion sounding like the warning-noise follow-up is still pending after the recorded fix verification.

- Task: reframe the R25 first-pass conclusion as historical context alongside the resolved follow-up
  Status: done
  Acceptance: the skeptical CLI diary clearly distinguishes the original pre-fix conclusion from the later verified post-fix state, aligning the note with the completed `R25` backlog objective.
  Artifact: `docs/design/R25_SKEPTICAL_OPERATOR_ACCEPTANCE_SWEEP.md`, `BACKLOG.md`


---

## Objective: B84 - R32 Skeptical Diary Follow-Through Parity
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `B83` completion
Completed: 2026-04-03

A further project-wide KR review sweep found that `docs/design/R32_SKEPTICAL_BROWSE_SEARCH_REVIEW.md` still ends by saying its three discovered browse/search friction points `should become explicit backlog-owned follow-up before stronger claims are made`, even though those follow-ups were immediately backlog-owned and completed under `R33` and `R34`. The original manual diary remains useful, but the unresolved ending now makes the shipped skeptical browse/search review look less complete than the actual backlog state. The note now keeps the original diary findings while explicitly recording that the identified follow-up work was subsequently owned and delivered.

### KR: B84-KR1 R32 skeptical browse/search diary no longer ends as if its follow-up is still unowned
Status: done
Acceptance: `docs/design/R32_SKEPTICAL_BROWSE_SEARCH_REVIEW.md` preserves the original friction notes, but also records that the identified follow-up work was subsequently completed under `R33` and `R34` instead of leaving the note on an unresolved handoff sentence.

- Task: add explicit delivered follow-through context to the R32 skeptical diary
  Status: done
  Acceptance: the skeptical browse/search review clearly distinguishes the original diary conclusion from the later delivered cleanup work under `R33` and `R34`, aligning the note with the completed backlog state.
  Artifact: `docs/design/R32_SKEPTICAL_BROWSE_SEARCH_REVIEW.md`, `BACKLOG.md`



---

## Objective: B85 - Managed API Review-Contract Parity For R31
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `B84` completion
Completed: 2026-04-03

A further project-wide KR review sweep found that the blocked managed-runtime API diary under `R31-KR2` was owned only as one future execution task aligned with the `J7-supply-managed-api-read` row in `docs/design/E2E_2_HLD_USER_JOURNEY_COVERAGE.md`. That row truthfully names the route chain and manual/runtime boundary, but unlike the seeded web review path (`R27`) and remote-agent review path (`R29`), it did not yet give operators one stable diary contract covering preconditions, exact evidence fields, friction categories, and review expectations. The remaining blocker is still the user-started API service, but the review contract itself should not stay implicit.

### KR: B85-KR1 Managed API manual review now has a stable contract before the blocked diary executes
Status: done
Acceptance: the repository exposes one stable managed-runtime API review contract for the `J7` supply/read journey, and the API guide points operators at that contract without inventing a new startup path.

- Task: define the managed API read diary contract and link it from the API guide
  Status: done
  Acceptance: `docs/design/R31_MANAGED_API_READ_DIARY_CONTRACT.md` defines the canonical user-started API review scenario, route chain, evidence fields, and friction rubric for `R31-KR2`, and `docs/guide/api.md` points operators at that note while preserving the existing managed-runtime rules.
  Artifact: `docs/design/R31_MANAGED_API_READ_DIARY_CONTRACT.md`, `docs/guide/api.md`, `BACKLOG.md`



---

## Objective: B86 - R22 Managed-API Gap-Matrix Parity
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `B85` completion
Completed: 2026-04-03

A further project-wide KR review sweep found that `docs/design/R22_OPERATOR_EXPERIENCE_E2E.md` already tracked the still-manual web spot-check and remote-agent diary gaps in its post-`V1` gap matrix, but it did not yet include the separately blocked managed API read diary now owned under `R31-KR2`. That omission left the matrix slightly flatter than the actual backlog state after `R31` and the new managed API review contract landed. The note should mention that the managed API route chain is still a blocked manual/runtime gap even though the contract is now stable.

### KR: B86-KR1 R22 gap matrix reflects the managed API diary gap now owned under R31
Status: done
Acceptance: `docs/design/R22_OPERATOR_EXPERIENCE_E2E.md` includes the blocked managed API read journey as its own matrix row, naming the current proof, missing diary, and `R31` ownership without overstating automation.

- Task: add the managed API read row to the post-V1 validation gap matrix
  Status: done
  Acceptance: the `R22` matrix names the managed API route chain as a user-started manual/runtime gap, points to the stable contract, and leaves the remaining missing proof as the blocked diary under `R31`.
  Artifact: `docs/design/R22_OPERATOR_EXPERIENCE_E2E.md`, `BACKLOG.md`



---

## Objective: B87 - Verification-Surface Manual-Gap Honesty Parity
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `B86` completion
Completed: 2026-04-03

A further project-wide KR review sweep found that `README.md`, `README_CN.md`, and `docs/design/CURRENT_RUNTIME_SURFACE.md` now list a broad and useful verifier surface, but that inventory still reads slightly too complete unless the reader also knows the blocked-manual-review state from `BACKLOG.md` and `R22`. The repository does have strong local proof plus user-started review helpers, yet the actual managed-runtime web/API diaries under `R31` and the remote-agent server-backed diaries under `R35` are still blocked on user-started services and remain unrecorded. The verification inventory should say that explicitly where it enumerates the shipped verifier/helper surface so user-facing docs do not feel more closed than the actual review state.

### KR: B87-KR1 Verification inventories explicitly distinguish local proof from still-blocked manual-runtime diaries
Status: done
Acceptance: `README.md`, `README_CN.md`, and `docs/design/CURRENT_RUNTIME_SURFACE.md` keep the current verifier inventory, but also state that managed-runtime web/API and remote-agent manual diaries remain blocked/user-started review work rather than already-completed automated proof.

- Task: add one explicit blocked-manual-review note to the verification inventories
  Status: done
  Acceptance: the user-facing verification inventory sections mention that local verifiers are strong but do not replace the still-blocked user-started web/API and remote-agent diaries tracked in `R31` and `R35`.
  Artifact: `README.md`, `README_CN.md`, `docs/design/CURRENT_RUNTIME_SURFACE.md`, `BACKLOG.md`



---

## Objective: B88 - Release-Gate Manual-Review Boundary Parity
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `B87` completion
Completed: 2026-04-03

A further project-wide KR review sweep found that `docs/design/SELF_HOST_V1_RELEASE_GATE.md` truthfully defines a narrow minimum self-host v1 bar, but after the verifier surface expanded and the remaining blocked managed-runtime/remote-agent diaries were made explicit in `R31` and `R35`, the gate note still did not say that passing this minimum bar is narrower than closing every broader manual review gap in the repository. That omission could mislead a future reader into treating release-gate success as proof that the still-blocked user-started web/API and remote-agent diary work has already been completed. The release-gate note should make that boundary explicit.

### KR: B88-KR1 Release-gate note distinguishes minimum v1 bar from still-blocked broader manual-review work
Status: done
Acceptance: `docs/design/SELF_HOST_V1_RELEASE_GATE.md` keeps the same six release-gate conditions, but also states that broader managed-runtime and remote-agent manual diaries tracked under `R31` and `R35` remain separate review work rather than implied gate completion.

- Task: add one explicit manual-review boundary note to the self-host v1 release gate
  Status: done
  Acceptance: the release-gate doc says that its minimum v1 bar does not by itself close the still-blocked user-started managed-runtime web/API diaries or the server-backed remote-agent diaries tracked elsewhere in the backlog.
  Artifact: `docs/design/SELF_HOST_V1_RELEASE_GATE.md`, `BACKLOG.md`



---

## Objective: B89 - Web Checklist Versus Diary Boundary Parity
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `B88` completion
Completed: 2026-04-03

A further project-wide KR review sweep found that `docs/guide/web.md` and `docs/design/R27_USER_STARTED_WEB_REVIEW_CHECKLIST.md` now do a good job explaining the seeded web review runtime path and the stable checklist contract, but they still stop just short of saying that the actual recorded seeded web diary remains unexecuted and blocked under `R31-KR1`. That distinction is visible in `BACKLOG.md` and `R22`, yet a reader who only opens the web guide or `R27` could still come away thinking the presence of a checklist means the web review itself has already been performed. The docs should make the checklist-versus-diary boundary explicit.

### KR: B89-KR1 Web review docs distinguish the shipped checklist contract from the still-blocked recorded diary
Status: done
Acceptance: `docs/guide/web.md` and `docs/design/R27_USER_STARTED_WEB_REVIEW_CHECKLIST.md` keep the current runtime/checklist guidance, but also say explicitly that the recorded seeded web diary is still blocked under `R31-KR1` until a user starts the services and performs the review.

- Task: add one explicit checklist-versus-diary boundary note to the web review docs
  Status: done
  Acceptance: the web guide and `R27` note say that the checklist/contract exists today, while the actual recorded seeded web diary remains future blocked manual-review work under `R31-KR1`.
  Artifact: `docs/guide/web.md`, `docs/design/R27_USER_STARTED_WEB_REVIEW_CHECKLIST.md`, `BACKLOG.md`



---

## Objective: B90 - Remote-Agent Contract Versus Diary Boundary Parity
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `B89` completion
Completed: 2026-04-03

A further project-wide KR review sweep found that `docs/guide/cli.md` and `docs/design/R29_REMOTE_AGENT_VALIDATION_CONTRACT.md` already explain the remote-agent validation contract and truthfully say that server-backed validation still requires a user-started API service. However, they still stop just short of saying that the actual recorded server-backed remote-agent diaries remain unexecuted and blocked under `R35`. That distinction is visible in `BACKLOG.md` and `R22`, but a reader who opens only the CLI guide or `R29` could still infer that the existence of the contract means the paired/server-backed review has already happened. The docs should make the contract-versus-diary boundary explicit.

### KR: B90-KR1 Remote-agent docs distinguish the shipped validation contract from the still-blocked recorded diaries
Status: done
Acceptance: `docs/guide/cli.md` and `docs/design/R29_REMOTE_AGENT_VALIDATION_CONTRACT.md` keep the current validation-contract guidance, but also say explicitly that the recorded pair/upload/schedule and leased-pull server-backed diaries are still blocked under `R35` until a user starts the API service and performs the review.

- Task: add one explicit contract-versus-diary boundary note to the remote-agent docs
  Status: done
  Acceptance: the CLI guide and `R29` note say that the validation contract exists today, while the actual recorded server-backed remote-agent diaries remain future blocked manual-review work under `R35`.
  Artifact: `docs/guide/cli.md`, `docs/design/R29_REMOTE_AGENT_VALIDATION_CONTRACT.md`, `BACKLOG.md`



---

## Objective: B91 - LobeChat Source-Location Honesty Parity In Top-Level READMEs
Status: done
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `B90` completion
Completed: 2026-04-03

A further project-wide KR review sweep found that `README.md` and `README_CN.md` still list LobeChat's source location as the concrete path `~/.config/lobehub-storage/` inside the top-level support table. LobeChat is still correctly marked `Experimental`, but after `R17` clarified that this root is only the current unreviewed candidate and has not yet been verified against a real sample bundle, that exact path presentation reads a bit too authoritative for the current evidence state. The top-level READMEs should keep the current experimental support statement while making it explicit that the LobeChat root is still a candidate pending the blocked real-sample review under `R17`.

### KR: B91-KR1 Top-level README support tables no longer present the unverified LobeChat root candidate as a confirmed source location
Status: done
Acceptance: `README.md` and `README_CN.md` still identify LobeChat as `Experimental`, but they also make clear that `~/.config/lobehub-storage/` is the current candidate root pending the blocked real-sample validation under `R17` rather than an already-verified canonical location.

- Task: add one explicit LobeChat root-candidate note to the top-level support tables
  Status: done
  Acceptance: the top-level support docs preserve the current support-tier table while clarifying that LobeChat's listed location is still a candidate/assumption until a real sample review confirms it.
  Artifact: `README.md`, `README_CN.md`, `BACKLOG.md`



---

## Objective: R40 - Consolidated E2E And Manual Test Closure Plan
Status: done
Priority: P1
Source: user direction on 2026-04-03 after repeated KR sweeps
Completed: 2026-04-03

The user explicitly redirected the workflow away from further KR review sweeps and back toward concrete testing work. The repository already has multiple verifier commands plus a few recorded manual diaries, but the remaining test closure work is still scattered across `R22`, `R25`, `R31`, `R32`, and `R35`. This objective exists to stop future auto-runs from falling back into generic review loops and instead force the next sessions to (1) inventory the real current test state, (2) plan the remaining automated and manual test closure work in one place, and (3) execute the highest-value locally runnable validation before returning to blocked user-started runtime diaries.

### KR: R40-KR1 Current automated and manual test status is consolidated into one execution-facing plan
Status: done
Acceptance: one repository-owned note lists which automated verifier paths are already available, which manual diaries are already recorded, which manual/runtime tests remain blocked, and what the next highest-value executable test actions are, without reopening LobeChat scope.

- Task: write one consolidated E2E and manual-test status note with a prioritized next-action list
  Status: done
  Acceptance: a single note records the shipped verifier commands, the completed manual diaries, the still-blocked manual/runtime diaries under `R31` and `R35`, the explicit out-of-scope status for `R17`/LobeChat unless the user later provides data, and a prioritized next-action list for testing work.
  Artifact: `docs/design/R40_TEST_CLOSURE_PLAN.md`

### KR: R40-KR2 Highest-value locally runnable validation bundle is executed as a grouped test pass
Status: done
Acceptance: one grouped local validation pass runs the strongest currently available non-blocked verifier commands and records what they prove, what passed, and what still requires blocked manual/runtime review.

- Task: run and record a grouped local verifier bundle for the current non-blocked proof surface
  Status: done
  Acceptance: the repository records one grouped validation pass covering the strongest available local verifiers (at minimum the current seeded acceptance, read-only admin, fixture sync-to-recall, bundle conflict recovery, real-layout sync-to-read, and related-work recall commands), with pass/fail status and any follow-up backlog action if a verifier fails.
  Artifact: `docs/design/R40_TEST_CLOSURE_PLAN.md`

### KR: R40-KR3 Blocked manual/runtime diaries are turned into an explicit execution queue instead of generic future intent
Status: done
Acceptance: the remaining user-started manual diaries are restated as one concrete execution queue with exact prerequisites, so future sessions resume those tasks directly when the user provides services instead of drifting back into review.

- Task: restate the blocked web, managed-API, and remote-agent diaries as one operator-execution queue
  Status: done
  Acceptance: the same plan note names the exact prerequisite for each blocked diary (`R31-KR1`, `R31-KR2`, `R35-KR1`, `R35-KR2`), the concrete command or checklist contract to use, and the evidence artifact expected once the user starts services.
  Artifact: `docs/design/R40_TEST_CLOSURE_PLAN.md`



---

## Objective: R41 - Seeded Acceptance Search-Cardinality Regression
Status: done
Priority: P1
Source: grouped local verifier bundle under `R40` on 2026-04-03
Completed: 2026-04-03

The first grouped local verifier pass under `R40` found that `pnpm run verify:v1-seeded-acceptance` was no longer green even though the other strongest local verifier commands still passed. The failure turned out to be a true operator-facing search broadening bug rather than fixture drift or a stale assertion: storage-layer search was appending turns whose session metadata matched only part of a multi-term query, so `Alpha traceability target` returned the real target turn plus two unrelated `Alpha ...` turns from the same workspace. The search path was corrected, a storage regression test was added, and the seeded acceptance verifier plus the grouped local verifier bundle are now green again.

### KR: R41-KR1 The failing seeded acceptance search step is reproduced and classified
Status: done
Acceptance: the repository records whether the failing seeded acceptance search assertion reflects a true operator-facing search regression, a fixture drift, or a stale verifier expectation, and names the smallest affected code/test surface.

- Task: reproduce the seeded acceptance search over-return and classify the failure boundary
  Status: done
  Acceptance: one work note or backlog update records the exact observed `Alpha traceability target` search output, why the verifier now sees three hits instead of one, and whether the issue belongs to search semantics, seed data drift, or the verifier's expectation.
  Artifact: `docs/design/R40_TEST_CLOSURE_PLAN.md`, `scripts/verify-v1-seeded-acceptance.mjs`, relevant CLI/storage surfaces as needed

### KR: R41-KR2 The seeded acceptance verifier is restored to a truthful green state
Status: done
Acceptance: `pnpm run verify:v1-seeded-acceptance` passes again, and the chosen fix preserves truthful seeded recall/search behavior rather than masking a real operator-facing issue.

- Task: repair the seeded acceptance search/drill-down regression and rerun the verifier
  Status: done
  Acceptance: the fix either restores the expected unique seeded search hit or updates the verifier expectation to match truthful current behavior, with `pnpm run verify:v1-seeded-acceptance` passing and the rationale recorded.
  Artifact: relevant code/test surfaces plus `pnpm run verify:v1-seeded-acceptance`

---

## Objective: R42 - Skeptical Operator Regression Expansion
Status: done
Priority: P1
Source: user challenge on 2026-04-03 after `R40` and `R41`
Completed: 2026-04-03

`R25` and `R32` proved that the repository can already survive meaningful skeptical manual review, and `R40`/`R41` restored the strongest current local verifier bundle to green. This objective turned those skeptical manual workflows into repeatable local regression surfaces instead of leaving them as prose-only evidence: one verifier now covers the CLI bundle/restore journey, one verifier now covers skeptical CLI/TUI browse/search, and one explicit local manual test matrix tells future sessions what can still be exercised by hand on this host before falling back to broader review.

### KR: R42-KR1 Skeptical CLI bundle and restore workflows gain a stronger repeatable regression matrix
Status: done
Acceptance: the repository has one explicit repeatable regression surface for the skeptical CLI bundle/restore journey, covering preview versus write, import conflict behavior, dry-run semantics, conflict policy flags, built-CLI execution, and restore-check guardrails.

- Task: add a skeptical bundle and restore regression matrix derived from the `R25` diary
  Status: done
  Acceptance: the CLI test or verifier surface covers the `R25` manual journey end-to-end, including preview-first `backup`, `backup --write`, conflict default failure, `import --dry-run`, `--on-conflict skip|replace`, built-CLI execution, and `restore-check` missing-store guardrails, with results that are easy to rerun locally.
  Artifact: `scripts/verify-skeptical-cli-bundle-restore.mjs`, `package.json`

### KR: R42-KR2 Skeptical browse/search workflows gain a stronger repeatable regression matrix
Status: done
Acceptance: the repository has one explicit repeatable regression surface for the skeptical browse/search journey across CLI and TUI, covering dense listing modes, tree/session pivots, search-to-show drill-down, missing-ref paths, and TUI search/default-selection trust.

- Task: add a skeptical browse/search regression matrix derived from the `R32` diary
  Status: done
  Acceptance: the CLI/TUI test or verifier surface covers the reviewed skeptical journey for `ls`, `tree`, `show`, `search`, `--long`, missing-ref guardrails, and TUI search snapshot trust/readability, so future sessions can validate the browse/search contract without relying only on prose diaries.
  Artifact: `scripts/verify-skeptical-browse-search.mjs`, `package.json`

### KR: R42-KR3 Local non-service manual testing has one explicit execution queue instead of vague future intent
Status: done
Acceptance: the repository records one concrete manual execution queue for non-service local testing that future sessions can run directly, while preserving the separately blocked user-started service diaries under `R31` and `R35`.

- Task: write one explicit local manual test matrix for CLI/TUI command, parameter, backup, and browse/search flows
  Status: done
  Acceptance: one repository-owned note lists the non-service local manual checks still worth running by hand on this host, including commands, prerequisite fixture/store setup, exact flags to exercise, expected evidence to capture, and the distinction between locally executable checks versus the still-blocked `R31`/`R35` service-backed diaries.
  Artifact: `docs/design/R42_LOCAL_MANUAL_TEST_MATRIX.md`

---

## Objective: R43 - Installed CLI Artifact Skeptical Workflow Parity
Status: done
Priority: P1
Source: holistic local test-surface evaluation on 2026-04-03 after `R42`
Completed: 2026-04-03

The repository had already proved install/upgrade basics for the standalone CLI artifact, but not a realistic operator flow beyond version/help smoke. This objective closed that gap by extending `verify:cli-artifact` so the installed `cchistory` command now completes one skeptical local workflow end-to-end: `sync -> backup preview/write -> import -> restore-check -> search/show` against a temp fixture home, without relying on the workspace `node apps/cli/dist/index.js` entrypoint.

### KR: R43-KR1 Installed CLI artifact survives one skeptical operator workflow beyond version/help smoke
Status: done
Acceptance: the installed standalone CLI artifact is exercised through at least one skeptical local workflow that meaningfully resembles backup/restore or browse/search usage, rather than only install/upgrade/version smoke checks.

- Task: extend CLI artifact verification with one skeptical local workflow smoke
  Status: done
  Acceptance: `verify:cli-artifact` or an adjacent verifier proves that the installed `cchistory` command can complete one realistic skeptical local workflow such as backup preview/write plus restore-check, or search/show/tree browse pivots, without relying on the workspace `node apps/cli/dist/index.js` entrypoint.
  Artifact: `scripts/verify-cli-artifact.mjs`

---

## Objective: R44 - Installed CLI Artifact Conflict-Recovery Parity
Status: done
Priority: P1
Source: holistic local test-surface evaluation on 2026-04-03 after `R43`
Completed: 2026-04-03

The installed CLI artifact previously survived one realistic skeptical smoke workflow, but the stronger workspace-built verifier surface still covered more operator risk than the artifact path did. This objective closed that gap by extending `verify:cli-artifact` so the installed `cchistory` command now reproduces one realistic import conflict and one truthful recovery path (`--dry-run` plus `--on-conflict replace`) without runtime warning noise.

### KR: R44-KR1 Installed CLI artifact proves one conflict-oriented backup/import recovery path
Status: done
Acceptance: the installed standalone `cchistory` command demonstrates at least one conflict-oriented skeptical workflow, including a clear default conflict failure and one explicit recovery path such as `--dry-run`, `--on-conflict skip`, or `--on-conflict replace`.

- Task: extend installed CLI artifact verification with one conflict-recovery workflow
  Status: done
  Acceptance: `verify:cli-artifact` or an adjacent artifact-focused verifier proves that the installed `cchistory` command can reproduce one realistic conflict on bundle import and complete at least one truthful recovery path without runtime warning noise.
  Artifact: `scripts/verify-cli-artifact.mjs`

---

## Objective: R45 - Installed CLI Artifact Browse/Search Parity
Status: done
Priority: P1
Source: holistic local test-surface evaluation on 2026-04-03 after `R44`
Completed: 2026-04-03

The installed CLI artifact path already proved install/upgrade basics plus a realistic skeptical backup/import conflict workflow, but browse/search trust was still only proven for workspace-built entrypoints. This objective closed that gap by extending `verify:cli-artifact` so the installed standalone `cchistory` command now survives one skeptical read-only browse/search journey against a multi-source fixture-backed store, including dense listings, search pivots, detail drill-down, session tree inspection, and quiet missing-ref guardrails.

### KR: R45-KR1 Installed CLI artifact survives one skeptical browse/search workflow
Status: done
Acceptance: the installed standalone `cchistory` command can complete one realistic skeptical read-only browse/search journey against a fixture-backed multi-source store, including dense listings, search pivots, and detail/session drill-down, without runtime warning noise.

- Task: extend CLI artifact verification with one skeptical browse/search workflow
  Status: done
  Acceptance: `verify:cli-artifact` or an adjacent artifact-focused verifier proves that the installed `cchistory` command can `sync` a fixture-backed multi-source store and then execute one browse/search journey such as `ls projects --long`, `ls sessions --long`, `search`, `show turn`, and `tree session --long` with truthful output and quiet stderr.
  Artifact: `scripts/verify-cli-artifact.mjs`

---

## Objective: R46 - Installed CLI Artifact Store-Scoped Admin Parity
Status: done
Priority: P1
Source: holistic local test-surface evaluation on 2026-04-03 after `R45`
Completed: 2026-04-03

The installed CLI artifact path now covers install/upgrade, skeptical restore/conflict behavior, and skeptical browse/search parity. This objective closed the remaining unblocked store-scoped admin gap by extending `verify:cli-artifact` so the installed standalone `cchistory` command now proves `health --store-only`, `ls sources`, and missing-store guardrails with truthful output and quiet stderr.

### KR: R46-KR1 Installed CLI artifact proves one store-scoped health/source inspection workflow
Status: done
Acceptance: the installed standalone `cchistory` command can inspect one selected indexed store with `health --store-only` and `ls sources`, and can report a missing-store case truthfully, without runtime warning noise.

- Task: extend CLI artifact verification with one store-scoped health/source workflow
  Status: done
  Acceptance: `verify:cli-artifact` or an adjacent artifact-focused verifier proves that the installed `cchistory` command can execute `health --store-only`, `ls sources`, and one missing-store guardrail path against a selected store with truthful output and quiet stderr.
  Artifact: `scripts/verify-cli-artifact.mjs`, related docs/tests as needed

---

## Objective: R47 - Installed CLI Artifact Structured Retrieval Parity
Status: done
Priority: P1
Source: holistic local test-surface evaluation on 2026-04-03 after `R46`
Completed: 2026-04-03

The installed CLI artifact path now proves realistic browse/search and store-scoped admin behavior. This objective closed the remaining structured retrieval gap by extending `verify:cli-artifact` so the installed standalone `cchistory` command now proves one readable `stats` pass plus `query session --id` and `query turn --id` on the same populated store, without runtime warning noise.

### KR: R47-KR1 Installed CLI artifact proves one structured query/stats workflow
Status: done
Acceptance: the installed standalone `cchistory` command can retrieve one known session and one known turn via `query`, and can report one truthful `stats` read on the same selected store, without runtime warning noise.

- Task: extend CLI artifact verification with one query/stats workflow
  Status: done
  Acceptance: `verify:cli-artifact` or an adjacent artifact-focused verifier proves that the installed `cchistory` command can execute `stats`, `query session --id`, and `query turn --id` against a populated selected store with truthful structured output and quiet stderr.
  Artifact: `scripts/verify-cli-artifact.mjs`, related docs/tests as needed

---

## Objective: R48 - Skeptical Local Manual CLI/TUI Workflow Diary
Status: done
Priority: P2
Source: holistic local test-surface evaluation on 2026-04-03 after `R46`
Completed: 2026-04-03

Automated verifier coverage is now materially stronger, and this objective converted the local matrix into a real skeptical diary instead of a planning note. The recorded pass exercised local CLI backup/restore/conflict, browse/search/show/tree, non-interactive TUI snapshots, and missing-store/missing-ref guardrails like an impatient operator would, then turned the concrete UX gaps into explicit follow-up backlog work.

### KR: R48-KR1 One fresh skeptical manual local workflow diary is recorded
Status: done
Acceptance: at least one recorded manual test diary covers local CLI/TUI browse, backup/restore, parameter guardrails, and missing-store/missing-ref behavior using the matrix in `docs/design/R42_LOCAL_MANUAL_TEST_MATRIX.md`.

- Task: execute and record one skeptical local manual workflow pass
  Status: done
  Acceptance: a repo doc captures commands run, observed behavior, rough UX verdicts, and follow-up tasks for the local CLI/TUI/manual matrix without requiring managed API/web services.
  Artifact: `docs/design/R48_LOCAL_MANUAL_DIARY_2026-04-03.md` plus linked follow-up backlog tasks

---

## Objective: R49 - CLI Session Detail Friendly Labels
Status: done
Priority: P1
Source: skeptical local manual diary on 2026-04-03 (`R48`)
Completed: 2026-04-03

The manual local pass found that `show turn` already presented friendly project/source labels while `show session` still dropped back to raw ids. This objective closed that inconsistency by upgrading `show session` to show a friendly project label plus a friendly source label, while still preserving canonical raw ids in adjacent fields.

### KR: R49-KR1 `show session` matches `show turn` label friendliness for project/source metadata
Status: done
Acceptance: `show session` presents a friendly project label and friendly source label while preserving the canonical raw ids elsewhere when needed.

- Task: upgrade `show session` detail header to friendly labels
  Status: done
  Acceptance: CLI tests and one local verifier path prove that `show session` renders project/source labels in a way that matches the operator readability level of `show turn`.
  Artifact: `apps/cli/src/main.ts`, `apps/cli/src/index.test.ts`, `scripts/verify-cli-artifact.mjs`

---

## Objective: R50 - CLI Dense Listing Readability Review
Status: done
Priority: P2
Source: skeptical local manual diary on 2026-04-03 (`R48`)
Completed: 2026-04-03

The manual local pass found that `ls sessions --long` was informative but too crowded when long titles, workspaces, models, and related-work counts all competed in one row. The review decision is to tune the existing `--long` surface rather than add a second listing mode for now: collapse source/platform/host into one compact source cell, truncate title/workspace/model for scanability, and keep full-fidelity drill-down in `show session` and `tree session --long`.

### KR: R50-KR1 Dense session listings have a documented readability decision
Status: done
Acceptance: the repository records a concrete decision and follow-up plan for `ls sessions --long` readability after inspecting high-entropy fixture output, instead of leaving the concern as an undocumented vibe.

- Task: evaluate `ls sessions --long` readability and choose a direction
  Status: done
  Acceptance: a design note or backlog update records whether to keep, tune, or extend the current dense session listing surface, with concrete examples from the real local fixture output.
  Artifact: `BACKLOG.md`, `docs/design/R48_LOCAL_MANUAL_DIARY_2026-04-03.md`

---

## Objective: R51 - CLI Session Long Listing Density Tuning
Status: done
Priority: P1
Source: readability decision from `R50` on 2026-04-03
Completed: 2026-04-03

`ls sessions --long` stays as one strong default read surface, but it now uses a more skeptical operator-friendly layout. This objective reduced column entropy without hiding evidence by collapsing source/platform/host into one compact source cell, truncating high-entropy title/workspace/model columns for scanability, and preserving full details in `show session` and `tree session --long`.

### KR: R51-KR1 `ls sessions --long` becomes materially easier to scan at realistic width
Status: done
Acceptance: CLI tests and one skeptical browse path prove that `ls sessions --long` remains truthful while using a more compact, readable column set on high-entropy fixture data.

- Task: tune `ls sessions --long` column density and truncation
  Status: done
  Acceptance: the CLI long session listing renders a compact source cell plus truncated title/workspace/model text that still keeps the key trust cues (`Project`, `Turns`, `Related Work`, `Updated`) visible.
  Artifact: `apps/cli/src/main.ts`, `apps/cli/src/index.test.ts`, `scripts/verify-skeptical-browse-search.mjs`, `scripts/verify-cli-artifact.mjs`

---

## Objective: R52 - CLI Import Conflict Guidance
Status: done
Priority: P1
Source: skeptical local manual diary on 2026-04-03 (`R48`)
Completed: 2026-04-03

The skeptical manual pass found that default import conflict stderr was truthful but too terse for an impatient operator. This objective closed that gap by upgrading the default conflict failure to keep naming the conflicting source while also suggesting the next truthful recovery commands for preview, skip, and replace flows.

### KR: R52-KR1 Default import conflict errors guide the operator toward recovery
Status: done
Acceptance: a default `cchistory import` conflict failure names the conflict and suggests a truthful preview/recovery path without adding runtime noise.

- Task: upgrade default import conflict stderr with actionable next steps
  Status: done
  Acceptance: CLI tests and one installed-artifact or skeptical local verifier prove that a conflict failure suggests `--dry-run` and `--on-conflict skip|replace` commands in stderr.
  Artifact: `apps/cli/src/main.ts`, `apps/cli/src/index.test.ts`, `scripts/verify-cli-artifact.mjs`

---

## Objective: R53 - Search/TUI Markup Readability Review
Status: done
Priority: P2
Source: skeptical local manual diary on 2026-04-03 (`R48`)
Completed: 2026-04-03

The skeptical manual pass found that search and non-interactive TUI snapshots correctly preserved XML-like command markup from captured evidence, but first-scan readability felt harsher than a casual browsing user expects. The review decision is to add a display-only transformation for browse/search snippets first: collapse known command-style XML wrappers into plain readable text in CLI search and TUI snapshot surfaces, while leaving canonical evidence and full-detail views untouched.

### KR: R53-KR1 Search/TUI markup readability has a documented decision
Status: done
Acceptance: the repository records a concrete decision and follow-up plan for how XML-like command markup should appear in CLI search and TUI snapshot surfaces, while preserving evidence semantics.

- Task: evaluate search/TUI markup readability and choose a display strategy
  Status: done
  Acceptance: a design note or backlog update records whether to keep, collapse, or display-transform markup-heavy prompt text in browse surfaces, with examples from the local skeptical manual diary.
  Artifact: `BACKLOG.md`, `docs/design/R48_LOCAL_MANUAL_DIARY_2026-04-03.md`

---

## Objective: R54 - Browse/Search Markup Display Taming
Status: done
Priority: P1
Source: readability decision from `R53` on 2026-04-03
Completed: 2026-04-03

CLI search results and non-interactive TUI browse/search snapshots now remain evidence-derived without forcing operators to read raw command-style XML wrappers on every first scan. This objective added a display-only transformation for known command-style markup in snippet-oriented browse surfaces while keeping canonical full-detail evidence untouched.

### KR: R54-KR1 CLI search and TUI browse snippets show command-style content more readably
Status: done
Acceptance: focused browse/search verification proves that snippet-oriented CLI/TUI surfaces no longer expose raw command-style XML tags for the tested fixture prompts, while full-detail evidence surfaces remain available.

- Task: add display-only markup taming for search and TUI snippets
  Status: done
  Acceptance: CLI tests plus skeptical/artifact browse verification prove that snippet-oriented outputs stop showing raw `<command-...>` wrappers for the exercised fixture prompts.
  Artifact: `apps/cli/src/main.ts`, `apps/tui/src/browser.ts`, `apps/cli/src/index.test.ts`, `apps/tui/src/index.test.ts`, `scripts/verify-skeptical-browse-search.mjs`, `scripts/verify-cli-artifact.mjs`

---

## Objective: R55 - Command-Style Snippet Normalization
Status: done
Priority: P1
Source: post-implementation browse output review on 2026-04-03 after `R54`
Completed: 2026-04-03

Removing raw XML wrappers improved browse readability, but the resulting snippets initially still showed awkward duplicated command fragments such as `/clear clear review /review ...`. This objective normalized command-style snippet display so browse/search surfaces now keep command names visible, drop wrapper-only message noise, and leave the underlying evidence unchanged.

### KR: R55-KR1 Browse snippets summarize command-style preambles more naturally
Status: done
Acceptance: focused CLI/TUI browse verification proves that command-style snippets render concise command prefixes (for example `/clear /review ...`) instead of duplicated wrapper artifacts, while detail surfaces still preserve raw evidence.

- Task: normalize command-style prefixes in browse/search snippets
  Status: done
  Acceptance: CLI/TUI tests and skeptical browse verification prove that the tested fixture snippets no longer show duplicated wrapper artifacts such as `clear review /review` or `<command-...>` tags.
  Artifact: `apps/cli/src/main.ts`, `apps/tui/src/browser.ts`, `apps/cli/src/index.test.ts`, `apps/tui/src/index.test.ts`, `scripts/verify-skeptical-browse-search.mjs`, `scripts/verify-cli-artifact.mjs`

---

## Objective: R56 - TUI Source Label Friendliness
Status: done
Priority: P1
Source: browse output review on 2026-04-03 after `R55`
Completed: 2026-04-03

The TUI browse/search and detail panes no longer stop at raw source platform ids such as `claude_code`. This objective aligned TUI result/detail source labels with the friendlier operator-facing direction already taken by the CLI while still preserving canonical platform identity in the displayed label.

### KR: R56-KR1 TUI browse/search/detail panes present friendlier source labels
Status: done
Acceptance: focused TUI tests or skeptical browse verification prove that TUI source labels become more readable than raw platform ids while still preserving canonical source/platform identity.

- Task: upgrade TUI source labels in result/detail panes
  Status: done
  Acceptance: TUI snapshots and skeptical browse verification prove that source labels in search/detail panes are friendlier than a bare raw platform enum.
  Artifact: `apps/tui/src/browser.ts`, `apps/tui/src/index.test.ts`, `scripts/verify-skeptical-browse-search.mjs`

---

## Objective: R57 - CLI Search Context Friendly Source Labels
Status: done
Priority: P1
Source: browse output review on 2026-04-03 after `R56`

CLI search snippets now read much better, but the metadata context line still exposes raw `source=<platform>` values such as `source=claude_code`. This objective closed that gap by making the CLI search context line use a friendlier source label while preserving canonical platform identity.

### KR: R57-KR1 CLI search context labels sources more readably
Status: done
Acceptance: focused CLI and skeptical browse verification prove that CLI search context lines use a friendlier source label than a bare raw platform enum while still preserving canonical identity.

- Task: upgrade CLI search context source labels
  Status: done
  Acceptance: CLI tests and skeptical/artifact browse verification prove that the CLI search context line no longer renders only raw `source=<platform>` for the exercised fixture results.
  Artifact: `apps/cli/src/main.ts`, `apps/cli/src/index.test.ts`, `scripts/verify-skeptical-browse-search.mjs`, `scripts/verify-cli-artifact.mjs`, related docs updates

---

## Objective: R58 - Skeptical Browse/Search Parameter Sweep
Status: done
Priority: P1
Source: user testing challenge on 2026-04-03 after `R57`

The local skeptical verifier now proves default browse/search readability well, but it still leaves a trust gap around the first parameter pivots a picky operator is likely to try immediately: project scoping, source scoping, result limits, and project-tree continuation. This objective closed that gap by turning those parameterized browse/search expectations into repeatable local proof instead of leaving them as unrecorded intuition.

### KR: R58-KR1 Skeptical browse/search verifier covers parameter pivots
Status: done
Acceptance: focused local verification proves that `search --project`, `search --source`, `search --limit`, and one `tree project --long` continuation path stay truthful, readable, and quiet on the exercised multi-source fixture store.

- Task: extend skeptical browse/search verification with project/source/limit scoped checks
  Status: done
  Acceptance: `pnpm run verify:skeptical-browse-search` plus targeted CLI coverage assert project/source scoping, limit behavior, and project-tree continuation for the exercised skeptical fixture flows.
  Artifact: `scripts/verify-skeptical-browse-search.mjs`, `apps/cli/src/index.test.ts`, `docs/design/R40_TEST_CLOSURE_PLAN.md`, `docs/design/R42_LOCAL_MANUAL_TEST_MATRIX.md`, `docs/design/R48_LOCAL_MANUAL_DIARY_2026-04-03.md`

---

## Objective: R59 - Skeptical Manual Parameter Drill-Down
Status: done
Priority: P1
Source: user testing challenge on 2026-04-03 after `R58`

Automated proof now covers the key browse/search parameter pivots, but a highly picky operator still judges the system by how those flags feel in actual command output and recovery flow. This objective closed that gap by running one second-pass skeptical diary focused on parameter-heavy commands and backup/import recovery options instead of assuming the automated assertions were enough.

### KR: R59-KR1 Parameter-heavy local operator flow is manually reviewed
Status: done
Acceptance: one recorded skeptical local diary covers `search --project`, `search --source`, `search --limit`, `tree project --long`, and bundle conflict recovery commands such as `import --dry-run --on-conflict skip|replace`, with resulting friction or strengths written down explicitly.

- Task: run and record a skeptical manual parameter pass for browse/search and bundle recovery flags
  Status: done
  Acceptance: a new or updated local manual diary records exact commands, observed output strengths/weaknesses, and whether parameter-heavy flows remain readable and trustworthy for a picky operator.
  Artifact: `docs/design/R59_SKEPTICAL_PARAMETER_DIARY_2026-04-03.md`, `docs/design/R40_TEST_CLOSURE_PLAN.md`, `docs/design/R42_LOCAL_MANUAL_TEST_MATRIX.md`, `BACKLOG.md`

---

## Objective: R60 - Tree Browse Snippet Readability Parity
Status: done
Priority: P1
Source: skeptical parameter diary on 2026-04-03 after `R59`

The second manual parameter pass found that `search` already renders command-heavy prompts more readably, but `tree project --long` still falls back to raw XML-like command wrappers inside its turn snippet lines. That inconsistency made the browse surface feel unfinished to a picky operator. This objective closed that gap by bringing `tree project` and adjacent tree turn snippets up to the same display-only readability standard already used by search/TUI browse surfaces.

### KR: R60-KR1 Tree browse snippets stop leaking raw command wrappers
Status: done
Acceptance: focused CLI and skeptical/artifact browse verification prove that command-heavy turn snippets in `tree project` and `tree session` stop showing raw `<command-...>` wrappers while preserving canonical evidence in full-detail views.

- Task: normalize command-heavy tree snippet rendering in CLI project/session trees
  Status: done
  Acceptance: targeted CLI coverage and skeptical/artifact verification prove that `tree project --long` and `tree session --long` render readable display-only snippets for the exercised command-heavy prompts.
  Artifact: `apps/cli/src/main.ts`, `apps/cli/src/index.test.ts`, `scripts/verify-skeptical-browse-search.mjs`, `scripts/verify-cli-artifact.mjs`, related docs updates

---

## Objective: R61 - Installed Artifact Parameter Sweep Parity
Status: done
Priority: P1
Source: local test-closure follow-up on 2026-04-03 after `R60`

The source-tree CLI path now proves parameterized search/tree behavior and tree snippet readability, but the installed artifact path should also prove the same skeptical operator pivots. This objective closed that gap by extending the installed CLI artifact verifier so project/source/limit search flags are not left as source-tree-only confidence.

### KR: R61-KR1 Installed CLI proves skeptical parameter pivots
Status: done
Acceptance: `pnpm run verify:cli-artifact` proves `search --project`, `search --source`, `search --limit`, and the exercised tree browse readability expectations on the installed CLI artifact, not only on the source-tree binary.

- Task: extend installed CLI artifact verification with project/source/limit search checks
  Status: done
  Acceptance: the installed artifact verifier asserts parameter-scoped search results and limit behavior for the skeptical browse fixture store while keeping stderr quiet.
  Artifact: `scripts/verify-cli-artifact.mjs`, `docs/design/R40_TEST_CLOSURE_PLAN.md`, `BACKLOG.md`

---

## Objective: R62 - Tree Source Label Friendliness
Status: done
Priority: P1
Source: skeptical parameter diary on 2026-04-03 after `R61`

The tree browse surfaces now read much better, but their session summary rows still relied on raw source handles such as `claude_code` where adjacent browse surfaces already used friendlier labels like `Claude Code (claude_code)`. This objective closed that gap by bringing `tree project` and `tree session` source summary rows up to the same friendly-label standard while preserving canonical identity.

### KR: R62-KR1 Tree browse source rows become friendlier
Status: done
Acceptance: focused CLI and skeptical/artifact browse verification prove that `tree project` and `tree session` source summary rows show friendlier source labels than bare raw handles while keeping the canonical platform or slot identity visible.

- Task: upgrade CLI tree source summary rows to friendly labels
  Status: done
  Acceptance: targeted CLI coverage plus skeptical/artifact verification prove that tree summary rows no longer show only raw `claude_code`-style handles for the exercised skeptical fixture flows.
  Artifact: `apps/cli/src/main.ts`, `apps/cli/src/index.test.ts`, `scripts/verify-skeptical-browse-search.mjs`, `scripts/verify-cli-artifact.mjs`, related docs updates

---

## Objective: R63 - Installed Artifact Skeptical Manual Parameter Diary
Status: done
Priority: P1
Source: local test-closure follow-up on 2026-04-03 after `R62`

The repository now has strong automated proof for parameter-heavy skeptical browse/search and bundle-recovery flows on both the source-tree CLI and the installed artifact path. This objective closed the remaining trust gap by recording one manual diary for the installed artifact itself instead of inferring operator confidence solely from automated assertions.

### KR: R63-KR1 Installed artifact parameter-heavy workflow is manually reviewed
Status: done
Acceptance: one recorded skeptical diary covers installed-CLI `search --project`, `search --source`, `search --limit`, `tree project --long`, and bundle conflict recovery commands, with resulting strengths or friction documented explicitly.

- Task: run and record an installed-artifact skeptical manual parameter pass
  Status: done
  Acceptance: a new manual diary records exact installed CLI commands, observed output strengths/weaknesses, and whether parameter-heavy artifact flows remain readable and trustworthy for a picky operator.
  Artifact: `docs/design/R63_INSTALLED_ARTIFACT_PARAMETER_DIARY_2026-04-03.md`, `docs/design/R40_TEST_CLOSURE_PLAN.md`, `BACKLOG.md`

---

## Objective: R64 - Installed Artifact Read-Only Admin And Query Manual Diary
Status: done
Priority: P1
Source: installed artifact skeptical manual pass on 2026-04-03 after `R63`

The installed artifact now has strong manual evidence for browse/search and bundle recovery, but its read-only admin and structured query surface was still represented mostly by automated proof. This objective closed that gap by hand-testing the installed artifact path so an operator can trust `health --store-only`, `ls sources`, `stats`, and direct `query` flows without needing the repo checkout.

### KR: R64-KR1 Installed artifact read-only admin/query flow is manually reviewed
Status: done
Acceptance: one recorded skeptical diary covers installed-CLI `health --store-only`, missing-store health, `ls sources`, `stats`, `query session --id`, and `query turn --id`, with any friction or strengths documented explicitly.

- Task: run and record an installed-artifact read-only admin/query manual pass
  Status: done
  Acceptance: a new manual diary records exact installed CLI commands, observed output strengths/weaknesses, and whether the installed artifact admin/query surface remains readable and trustworthy for a picky operator.
  Artifact: `docs/design/R64_INSTALLED_ARTIFACT_ADMIN_QUERY_DIARY_2026-04-03.md`, `docs/design/R40_TEST_CLOSURE_PLAN.md`, `BACKLOG.md`

---

## Objective: R65 - Source-Tree Read-Only Admin And Query Manual Diary
Status: done
Priority: P1
Source: installed artifact admin/query diary on 2026-04-03 after `R64`

The installed artifact now has manual confidence for read-only admin and structured query flows, but the canonical source-tree CLI/TUI path still relied more on automated proof and older broad diaries than on one focused skeptical structured-inspection pass. This objective closed that gap by recording that source-tree manual pass explicitly.

### KR: R65-KR1 Source-tree read-only admin/query flow is manually reviewed
Status: done
Acceptance: one recorded skeptical diary covers source-tree `health --store-only`, missing-store health, `ls sources`, `stats`, `query session --id`, `query turn --id`, and any comparable non-interactive TUI inspection touchpoints, with resulting strengths or friction documented explicitly.

- Task: run and record a source-tree read-only admin/query manual pass
  Status: done
  Acceptance: a new manual diary records exact source-tree CLI/TUI commands, observed output strengths/weaknesses, and whether the local read-only inspection surface remains readable and trustworthy for a picky operator.
  Artifact: `docs/design/R65_SOURCE_TREE_ADMIN_QUERY_DIARY_2026-04-03.md`, `docs/design/R40_TEST_CLOSURE_PLAN.md`, `BACKLOG.md`

---

## Objective: R66 - Focused TUI Search And Drill-Down Manual Diary
Status: done
Priority: P1
Source: source-tree admin/query diary on 2026-04-03 after `R65`

The local manual evidence is now strong for CLI browse/search, backup/import recovery, installed artifact flows, and source-tree admin/query inspection. This objective closed the next local gap by recording a dedicated TUI search and drill-down diary that treats the non-interactive TUI output as a first-class operator surface rather than a side note inside broader diaries.

### KR: R66-KR1 TUI search/drill-down flow is manually reviewed
Status: done
Acceptance: one recorded skeptical diary covers source-tree TUI `--search`, browse snapshot, missing-store behavior, and the readability of project/turn/detail panes under search-driven use.

- Task: run and record a focused TUI search/drill-down manual pass
  Status: done
  Acceptance: a new manual diary records exact TUI commands, observed readability strengths/weaknesses, and whether search-driven TUI inspection feels trustworthy to a picky operator.
  Artifact: `docs/design/R66_TUI_SEARCH_DRILLDOWN_DIARY_2026-04-03.md`, `docs/design/R40_TEST_CLOSURE_PLAN.md`, `BACKLOG.md`

---

## Objective: R67 - TUI Empty-Search Selection Coherence
Status: done
Priority: P1
Source: focused TUI search/drill-down diary on 2026-04-03 after `R66`

The focused TUI manual pass found a small but real UX inconsistency: when search returns zero hits, the detail pane truthfully says no project is selected, but the status line still reported a browse-derived selected project. This objective closed that papercut by making the empty-search state coherent.

### KR: R67-KR1 TUI empty-search status line matches visible selection state
Status: done
Acceptance: focused TUI coverage proves that when search mode has no selected result, the status line reports `SelectedProject=none` and `SelectedTurn=none` instead of leaking stale browse-mode selection.

- Task: normalize TUI empty-search status selection reporting
  Status: done
  Acceptance: TUI tests prove that empty search results keep the detail pane and status line coherent.
  Artifact: `apps/tui/src/browser.ts`, `apps/tui/src/index.test.ts`, related docs updates

---

## Objective: R68 - TUI SQLite Warning-Noise Parity
Status: done
Priority: P1
Source: TUI test validation on 2026-04-03 after `R67`

The TUI package test suite still leaked the routine SQLite `ExperimentalWarning` on this host even though the same warning-noise cleanup already existed for the other SQLite-backed packages. This objective closed that gap by bringing `apps/tui` up to the same quiet-by-default test standard.

### KR: R68-KR1 TUI test suite suppresses routine SQLite experimental-warning noise
Status: done
Acceptance: `pnpm --filter @cchistory/tui test` runs without the routine SQLite `ExperimentalWarning` while still surfacing unrelated warnings and failures normally.

- Task: wire the reusable SQLite warning filter into the TUI test script
  Status: done
  Acceptance: the TUI package test script uses the shared warning filter and focused TUI validation proves the routine warning no longer appears.
  Artifact: `apps/tui/package.json`, related docs updates

---

## Objective: R69 - TUI Non-Interactive Source-Health Snapshot Flag
Status: done
Priority: P1
Source: local TUI test-closure follow-up on 2026-04-03 after `R68`

The TUI already had a useful source-health summary, but non-interactive/manual review still could not open it through the public entrypoint. This objective closed that gap by adding one explicit snapshot flag so source-health review no longer depends on internal reducer tests or interactive keypresses.

### KR: R69-KR1 TUI entrypoint can render source-health summary on demand
Status: done
Acceptance: `cchistory-tui --source-health` renders the source-health section in non-interactive mode, help text documents it, and focused TUI coverage proves the flag works without changing default snapshots.

- Task: add a non-interactive `--source-health` TUI snapshot flag
  Status: done
  Acceptance: TUI tests prove the new flag renders the source-health section while default snapshots remain unchanged.
  Artifact: `apps/tui/src/index.ts`, `apps/tui/src/index.test.ts`, related docs updates

---

## Objective: R70 - Focused TUI Source-Health And Help Manual Diary
Status: done
Priority: P1
Source: local TUI source-health snapshot work on 2026-04-03 after `R69`

The TUI now exposes source-health snapshots on demand, but that new public surface still lacked a focused manual diary. This objective closed that gap by recording one skeptical manual note for `--source-health`, default browse, help output, and missing-store behavior so this entrypoint slice is backed by direct operator evidence.

### KR: R70-KR1 TUI source-health/help flow is manually reviewed
Status: done
Acceptance: one recorded skeptical diary covers TUI `--help`, default browse snapshot, `--source-health`, and missing-store behavior, with resulting strengths or friction documented explicitly.

- Task: run and record a focused TUI source-health/help manual pass
  Status: done
  Acceptance: a new manual diary records exact TUI commands, observed output strengths/weaknesses, and whether the source-health/help snapshot surface feels trustworthy to a picky operator.
  Artifact: `docs/design/R70_TUI_SOURCE_HEALTH_HELP_DIARY_2026-04-03.md`, `docs/design/R40_TEST_CLOSURE_PLAN.md`, `BACKLOG.md`

---

## Objective: R71 - TUI Combined Search And Source-Health Snapshot Coverage
Status: done
Priority: P1
Source: TUI source-health/help manual diary on 2026-04-03 after `R70`

The TUI now supports both search-driven snapshots and source-health snapshots, but the combined `--search` + `--source-health` path was still unowned automated behavior. This objective closed that gap by locking down the combined non-interactive surface explicitly.

### KR: R71-KR1 Combined TUI snapshot path is explicitly covered
Status: done
Acceptance: focused TUI coverage proves that `cchistory-tui --search <query> --source-health` renders both the search drill-down surface and the source-health section together without regressing default snapshot behavior.

- Task: add focused TUI test coverage for combined search plus source-health snapshots
  Status: done
  Acceptance: TUI tests assert one non-interactive snapshot can show search drill-down and source-health together.
  Artifact: `apps/tui/src/index.test.ts`, related docs updates

---

## Objective: R72 - Focused TUI Combined Search And Source-Health Manual Diary
Status: done
Priority: P1
Source: combined TUI snapshot coverage on 2026-04-03 after `R71`

The combined TUI snapshot path now had automated proof, but it was still missing one direct skeptical manual diary. This objective closed that gap by exercising `--search` plus `--source-health` together as a real operator workflow and capturing whether the resulting snapshot still feels readable rather than merely correct.

### KR: R72-KR1 Combined TUI search/source-health flow is manually reviewed
Status: done
Acceptance: one recorded skeptical diary covers `cchistory-tui --search <query> --source-health` for both a hit and a zero-hit case, with resulting readability strengths or friction documented explicitly.

- Task: run and record a focused manual diary for combined TUI search plus source-health snapshots
  Status: done
  Acceptance: a new manual diary records exact TUI commands, observed readability strengths/weaknesses, and whether the combined snapshot feels trustworthy to a picky operator.
  Artifact: `docs/design/R72_TUI_SEARCH_SOURCE_HEALTH_DIARY_2026-04-03.md`, `docs/design/R40_TEST_CLOSURE_PLAN.md`, `BACKLOG.md`

---

## Objective: R73 - TUI Empty Combined Snapshot Coverage
Status: done
Priority: P1
Source: combined TUI search/source-health manual diary on 2026-04-03 after `R72`

The combined `--search` + `--source-health` snapshot path now had one automated hit-path test plus one manual zero-hit review, but the zero-hit combined state still deserved explicit automated ownership. This objective closed that gap by locking down the exact empty-result combination.

### KR: R73-KR1 Empty combined TUI snapshot is explicitly covered
Status: done
Acceptance: focused TUI coverage proves that `cchistory-tui --search <missing-query> --source-health` renders `No search results`, `SelectedProject=none`, `SelectedTurn=none`, and the `Source Health:` section together.

- Task: add focused TUI test coverage for zero-hit search plus source-health snapshots
  Status: done
  Acceptance: TUI tests assert the empty combined snapshot remains coherent and still includes source-health diagnostics.
  Artifact: `apps/tui/src/index.test.ts`, related docs updates

---

## Objective: R74 - Source-Tree CLI Discover And Health Manual Diary
Status: done
Priority: P1
Source: local test-closure follow-up on 2026-04-03 after `R73`

The local test surface now had strong proof for browse/search, backup/import recovery, installed artifacts, and TUI snapshots, but one practical operator path still lacked a focused skeptical manual note: CLI discovery plus `health` / `health --full`. This objective closed that gap by recording the diagnostics-oriented workflow explicitly.

### KR: R74-KR1 CLI discover/health workflow is manually reviewed
Status: done
Acceptance: one recorded skeptical diary covers `discover`, `health`, `health --full`, `health --store-only`, and one missing-store or no-store diagnostic case, with resulting strengths or friction documented explicitly.

- Task: run and record a focused CLI discover/health manual pass
  Status: done
  Acceptance: a new manual diary records exact commands, observed output strengths/weaknesses, and whether the local diagnostics workflow feels trustworthy to a picky operator.
  Artifact: `docs/design/R74_CLI_DISCOVER_HEALTH_DIARY_2026-04-03.md`, `docs/design/R40_TEST_CLOSURE_PLAN.md`, `BACKLOG.md`

---

## Objective: R75 - Installed Artifact Discover And Health Manual Diary
Status: done
Priority: P1
Source: source-tree CLI discover/health diary on 2026-04-03 after `R74`

The source-tree CLI now had a focused manual diagnostics diary, but the installed artifact path still relied more on automation for discovery and health confidence. This objective closed that gap by recording the same skeptical diagnostics workflow for the standalone artifact.

### KR: R75-KR1 Installed artifact discover/health workflow is manually reviewed
Status: done
Acceptance: one recorded skeptical diary covers installed-CLI `discover`, `health`, `health --full`, `health --store-only`, and one missing-store diagnostic case, with resulting strengths or friction documented explicitly.

- Task: run and record an installed-artifact discover/health manual pass
  Status: done
  Acceptance: a new manual diary records exact installed-CLI commands, observed output strengths/weaknesses, and whether the artifact diagnostics workflow feels trustworthy to a picky operator.
  Artifact: `docs/design/R75_INSTALLED_ARTIFACT_DISCOVER_HEALTH_DIARY_2026-04-03.md`, `docs/design/R40_TEST_CLOSURE_PLAN.md`, `BACKLOG.md`

---

## Objective: R76 - CLI Filtered Health Manual Diary
Status: done
Priority: P1
Source: installed artifact discover/health diary on 2026-04-03 after `R75`

Core diagnostics are now manually proven on both the source-tree and installed-artifact CLI paths, but the filtered diagnostics story still lacked a focused skeptical note. This objective closed that gap by hand-testing `health --source` and nearby filtered diagnostics so operators can trust narrowed diagnostics views as much as the broad ones.

### KR: R76-KR1 Filtered CLI health workflow is manually reviewed
Status: done
Acceptance: one recorded skeptical diary covers `health --source <slot>` and at least one nearby filtered diagnostics variant on the local CLI path, with resulting strengths or friction documented explicitly.

- Task: run and record a focused filtered-health manual pass
  Status: done
  Acceptance: a new manual diary records exact commands, observed output strengths/weaknesses, and whether filtered diagnostics stay truthful and readable.
  Artifact: `docs/design/R76_FILTERED_HEALTH_DIARY_2026-04-03.md`, `docs/design/R40_TEST_CLOSURE_PLAN.md`, `BACKLOG.md`

---

## Objective: R77 - Health Source-Filter Store Summary Parity
Status: done
Priority: P1
Source: filtered health manual diary on 2026-04-03 after `R76`

The filtered health manual pass found a real product inconsistency: index-mode `health --source ...` narrowed discovery metrics but still rendered full-store `Indexed Sources` and `Store Overview`. This objective closed that gap by making store-summary sections obey the same selected-source scope so the command is trustworthy end to end.

### KR: R77-KR1 Health store summaries respect selected source scope
Status: done
Acceptance: focused CLI coverage proves that when `health` is called with `--source <slot-or-id>`, the indexed or live source list and store overview counts reflect only the selected source scope instead of the full store.

- Task: align health store summary sections with selected source filters
  Status: done
  Acceptance: targeted CLI tests prove that filtered `health` output no longer mixes scoped discovery with unscoped indexed-store summaries.
  Artifact: `apps/cli/src/main.ts`, `apps/cli/src/index.test.ts`, related docs updates

---

## Objective: R78 - Installed Artifact Filtered Health Coverage
Status: done
Priority: P1
Source: health source-filter parity fix on 2026-04-03 after `R77`

The source-tree CLI now has focused automated proof that filtered `health --source ...` store summaries stay scoped correctly, and the installed artifact verifier now locks down that same path so filtered diagnostics parity is not left to manual confidence alone.

### KR: R78-KR1 Installed artifact proves filtered health parity
Status: done
Acceptance: `pnpm run verify:cli-artifact` proves that installed-CLI `health --store <store> --source <slot>` narrows indexed-store source rows and overview counts to the selected source scope.

- Task: extend installed artifact verification for filtered health output
  Status: done
  Acceptance: installed artifact verification asserts filtered `health` output no longer shows unrelated indexed sources in the selected-source path.
  Artifact: `scripts/verify-cli-artifact.mjs`, `docs/design/R40_TEST_CLOSURE_PLAN.md`, `BACKLOG.md`

---

## Objective: R79 - Installed Artifact Full Health Coverage
Status: done
Priority: P1
Source: skeptical diagnostics follow-through on 2026-04-03 after `R78`

The installed artifact already had manual evidence for `health --full`, and the standalone verifier now locks down that live-scan path so it stays read-only, reports live-scan framing truthfully, and respects selected-source scope.

### KR: R79-KR1 Installed artifact proves full health parity
Status: done
Acceptance: `pnpm run verify:cli-artifact` proves that installed-CLI `health --full` and `health --full --source <slot>` show live-source/live-overview framing, avoid indexed-store wording, and preserve selected-source scoping without creating or depending on an indexed store.

- Task: extend installed artifact verification for full health output
  Status: done
  Acceptance: installed artifact verification asserts live-scan wording, selected-source filtering, and quiet read-only behavior for `health --full` on the standalone CLI.
  Artifact: `scripts/verify-cli-artifact.mjs`, `docs/design/R40_TEST_CLOSURE_PLAN.md`, `BACKLOG.md`

---

## Objective: R80 - Installed Artifact Discover Coverage
Status: done
Priority: P1
Source: skeptical diagnostics automation follow-through on 2026-04-03 after `R79`

The standalone artifact now automatically proves indexed and live `health` flows, and the verifier now also locks down `discover` output so diagnostic trust does not regress outside the repo checkout.

### KR: R80-KR1 Installed artifact proves discover parity
Status: done
Acceptance: `pnpm run verify:cli-artifact` proves that installed-CLI `discover` on fixture-backed temp homes still reports sync-ready sources, supplemental paths, and Gemini discovery-only artifacts with quiet output.

- Task: extend installed artifact verification for discover output
  Status: done
  Acceptance: installed artifact verification asserts standalone `discover` text/JSON output still distinguishes sync-ready roots from supplemental or discovery-only paths.
  Artifact: `scripts/verify-cli-artifact.mjs`, `docs/design/R40_TEST_CLOSURE_PLAN.md`, `BACKLOG.md`

---

## Objective: R81 - Installed Artifact Full Read Coverage
Status: done
Priority: P1
Source: read-only live-scan parity follow-through on 2026-04-03 after `R80`

The installed artifact now proves diagnostics, browse/search, restore/conflict, and structured query flows, and it also locks down one source-tree-only trust slice: read commands with `--full` visibly rescan live sources without mutating the indexed store.

### KR: R81-KR1 Installed artifact proves full read parity
Status: done
Acceptance: `pnpm run verify:cli-artifact` proves that installed-CLI read commands such as `ls sessions --full --source <slot>` can surface newly added live-source sessions without mutating the selected indexed store.

- Task: extend installed artifact verification for read commands with `--full`
  Status: done
  Acceptance: installed artifact verification asserts standalone `--full` read commands rescan live sources, change visible results, and leave the indexed store unchanged.
  Artifact: `scripts/verify-cli-artifact.mjs`, `docs/design/R40_TEST_CLOSURE_PLAN.md`, `BACKLOG.md`

---

## Objective: R82 - Installed Artifact Full Search Coverage
Status: done
Priority: P1
Source: live-read parity follow-through on 2026-04-03 after `R81`

The standalone artifact now proves one listing-based `--full` live rescan, and it also proves that `search --full` can surface live-source recall changes without mutating the indexed store.

### KR: R82-KR1 Installed artifact proves full search parity
Status: done
Acceptance: `pnpm run verify:cli-artifact` proves that installed-CLI `search --full --source <slot>` can surface newly added live-source content while the selected indexed store remains unchanged.

- Task: extend installed artifact verification for search with `--full`
  Status: done
  Acceptance: installed artifact verification asserts standalone `search --full` sees newly added live content, keeps stderr quiet, and leaves indexed results unchanged afterwards.
  Artifact: `scripts/verify-cli-artifact.mjs`, `docs/design/R40_TEST_CLOSURE_PLAN.md`, `BACKLOG.md`

---

## Objective: R83 - Installed Artifact Full Drilldown Coverage
Status: done
Priority: P1
Source: live-read recall parity follow-through on 2026-04-03 after `R82`

The standalone artifact now proves `--full` listing and search recall, and it also proves direct drill-down surfaces can expose live-only content without mutating the indexed store.

### KR: R83-KR1 Installed artifact proves full drilldown parity
Status: done
Acceptance: `pnpm run verify:cli-artifact` proves that one standalone drill-down command in `--full` mode can read newly added live content while indexed drill-down remains unchanged.

- Task: extend installed artifact verification for drill-down commands with `--full`
  Status: done
  Acceptance: installed artifact verification asserts standalone `show` or `query` in `--full` mode exposes live-only content, keeps stderr quiet, and leaves indexed drill-down results unchanged afterwards.
  Artifact: `scripts/verify-cli-artifact.mjs`, `docs/design/R40_TEST_CLOSURE_PLAN.md`, `BACKLOG.md`

---

## Objective: R84 - Installed Artifact Full Tree Coverage
Status: done
Priority: P1
Source: live-read tree parity follow-through on 2026-04-03 after `R83`

The standalone artifact now proves full-mode drill-down through `show`, and it also proves that tree-oriented session drill-down honors the same live-read semantics without mutating indexed results.

### KR: R84-KR1 Installed artifact proves full tree parity
Status: done
Acceptance: `pnpm run verify:cli-artifact` proves that installed-CLI `tree session --full` can expose a live-only session while indexed tree drill-down remains unchanged.

- Task: extend installed artifact verification for tree drill-down commands with `--full`
  Status: done
  Acceptance: installed artifact verification asserts standalone `tree session --full` exposes live-only content, keeps stderr quiet, and leaves indexed tree drill-down unchanged afterwards.
  Artifact: `scripts/verify-cli-artifact.mjs`, `docs/design/R40_TEST_CLOSURE_PLAN.md`, `BACKLOG.md`

---

## Objective: R85 - Installed Artifact Full Project Coverage
Status: done
Priority: P1
Source: live-read project parity follow-through on 2026-04-03 after `R84`

The standalone artifact now proves live-only reads at listing, search, show, and session-tree levels, and it also proves that project views in `--full` mode reflect live-only session growth without mutating indexed project summaries.

### KR: R85-KR1 Installed artifact proves full project parity
Status: done
Acceptance: `pnpm run verify:cli-artifact` proves that one installed-CLI project-oriented command such as `show project --full` or `tree project --full` can expose live-only growth while indexed project output remains unchanged.

- Task: extend installed artifact verification for project commands with `--full`
  Status: done
  Acceptance: installed artifact verification asserts one standalone project-level `--full` read exposes live-only growth, keeps stderr quiet, and leaves indexed project output unchanged afterwards.
  Artifact: `scripts/verify-cli-artifact.mjs`, `docs/design/R40_TEST_CLOSURE_PLAN.md`, `BACKLOG.md`

---

## Objective: R86 - Installed Artifact Full Read Manual Diary
Status: done
Priority: P1
Source: skeptical operator trust follow-through on 2026-04-03 after `R85`

The installed artifact now has strong automated proof for live-read behavior. This objective closes the immediate manual gap by recording one focused skeptical diary for `--full` operator flows so trust does not rest on automation alone.

### KR: R86-KR1 Installed artifact records skeptical `--full` operator evidence
Status: done
Acceptance: one manual diary records how indexed and `--full` live-read surfaces diverge across listing, search, drill-down, and project views, including what felt trustworthy and what still felt easy to misread.

- Task: record installed artifact full-read manual diary
  Status: done
  Acceptance: one new diary captures exact commands, observed indexed-vs-full differences, and explicit operator trust notes for the standalone artifact path.
  Artifact: `docs/design/R86_INSTALLED_ARTIFACT_FULL_READ_DIARY_2026-04-03.md`, `BACKLOG.md`

---

## Objective: R87 - Installed Artifact Full Stats Coverage
Status: done
Priority: P1
Source: summary-surface parity follow-through on 2026-04-03 after `R86`

The standalone artifact now proves live-read behavior for list, search, drill-down, tree, and project surfaces, and it also proves that `stats --full` reflects live-only growth without mutating indexed statistics.

### KR: R87-KR1 Installed artifact proves full stats parity
Status: done
Acceptance: `pnpm run verify:cli-artifact` proves that installed-CLI `stats --full` can expose live-only growth while indexed `stats` remains unchanged.

- Task: extend installed artifact verification for stats with `--full`
  Status: done
  Acceptance: installed artifact verification asserts standalone `stats --full` changes visible counts for live-only growth, keeps stderr quiet, and leaves indexed stats unchanged afterwards.
  Artifact: `scripts/verify-cli-artifact.mjs`, `docs/design/R40_TEST_CLOSURE_PLAN.md`, `BACKLOG.md`

---

## Objective: R88 - Source-Tree Full Read Manual Diary
Status: done
Priority: P1
Source: manual parity follow-through on 2026-04-03 after `R87`

The standalone artifact now has both automated and manual evidence for live-read `--full` behavior, and the source-tree CLI path now has one equally focused manual diary for the same indexed-vs-live trust question.

### KR: R88-KR1 Source-tree records skeptical `--full` operator evidence
Status: done
Acceptance: one manual diary records how source-tree CLI indexed and `--full` live-read surfaces diverge across listing, search, drill-down, tree, project, and stats views, including trust notes and any friction.

- Task: record source-tree full-read manual diary
  Status: done
  Acceptance: one new diary captures exact source-tree CLI commands, observed indexed-vs-full differences, and explicit operator trust notes for the non-artifact path.
  Artifact: `docs/design/R88_SOURCE_TREE_FULL_READ_DIARY_2026-04-03.md`, `BACKLOG.md`

---

## Objective: R89 - Source-Tree Full Read Regression Coverage
Status: done
Priority: P1
Source: source-tree parity follow-through on 2026-04-03 after `R88`

The source-tree CLI already had one narrow `--full` regression around session listings, but the broader live-only trust surface still depended too much on manual confidence. This objective closes that gap by adding focused automated proof for full-read search, drill-down, tree, project, and stats behavior without indexed mutation.

### KR: R89-KR1 Source-tree proves full-read parity
Status: done
Acceptance: `pnpm --filter @cchistory/cli test` proves one full-read regression path where live-only search, show, tree, project, and stats results diverge truthfully from indexed results while the indexed store remains unchanged.

- Task: extend CLI tests for full-read drilldown and summary parity
  Status: done
  Acceptance: one targeted CLI test asserts full-read search/show/tree/project/stats paths expose live-only content without mutating indexed state.
  Artifact: `apps/cli/src/index.test.ts`, `BACKLOG.md`

---

## Objective: R90 - TUI Indexed-vs-Live Evaluation
Status: done
Priority: P1
Source: holistic local operator parity follow-through on 2026-04-03 after `R89`

CLI paths now have stronger automated and manual confidence for indexed-vs-live `--full` behavior, and the TUI indexed-vs-live gap is now made explicit instead of being left implicit.

### KR: R90-KR1 TUI indexed-vs-live gap is made explicit
Status: done
Acceptance: one focused TUI evaluation note or manual diary states whether the TUI already has a truthful indexed-vs-live operator story, what is missing if not, and what concrete next task(s) should follow.

- Task: evaluate TUI indexed-vs-live operator story
  Status: done
  Acceptance: one new note inspects current TUI behavior against the CLI `--full` trust bar and records concrete follow-up tasks instead of leaving the gap implicit.
  Artifact: `docs/design/R90_TUI_INDEXED_VS_LIVE_EVALUATION_2026-04-03.md`, `BACKLOG.md`

---

## Objective: R91 - TUI Indexed-Only Disclosure
Status: done
Priority: P1
Source: TUI indexed-vs-live evaluation on 2026-04-03 after `R90`

The current TUI is indexed-only in practice, and the operator-facing surface now states that clearly in help text, snapshot output, and status-line rendering.

### KR: R91-KR1 TUI explicitly discloses indexed-only reads
Status: done
Acceptance: TUI help, snapshot output, and status-line rendering explicitly tell operators that the current TUI is reading the indexed store only, without falsely implying CLI-style live `--full` support.

- Task: add indexed-only disclosure to TUI surfaces
  Status: done
  Acceptance: targeted TUI tests prove the help text, snapshot header, and status line now disclose indexed-only semantics clearly.
  Artifact: `apps/tui/src/index.ts`, `apps/tui/src/browser.ts`, `apps/tui/src/index.test.ts`, `BACKLOG.md`

### KR: R91-KR2 TUI live-read product decision is queued explicitly
Status: done
Acceptance: backlog contains one explicit follow-up task that decides whether TUI should gain a live-read mode analogous to CLI `--full`, rather than leaving that question implicit.

- Task: queue TUI live-read decision note
  Status: done
  Acceptance: backlog contains one explicit next-step objective for deciding and possibly prototyping TUI live-read support.
  Artifact: `BACKLOG.md`

---

## Objective: R92 - TUI Live-Read Decision
Status: done
Priority: P1
Source: TUI indexed-vs-live evaluation on 2026-04-03 after `R90`

After disclosure is fixed, the project now has an explicit product decision: accept a bounded non-interactive TUI live-read slice first, and defer interactive live-read mode until that smaller surface proves out.

### KR: R92-KR1 TUI live-read scope is decided explicitly
Status: done
Acceptance: one design note states whether TUI live-read support is accepted, deferred, or rejected, and if accepted identifies the smallest first implementation slice.

- Task: document TUI live-read scope decision
  Status: done
  Acceptance: one note records the product decision and, if accepted, names the first bounded implementation slice.
  Artifact: `docs/design/R92_TUI_LIVE_READ_SCOPE_DECISION_2026-04-03.md`, `BACKLOG.md`

---

## Objective: R93 - TUI Non-Interactive Full Snapshot
Status: done
Priority: P1
Source: TUI live-read scope decision on 2026-04-03 after `R92`

The chosen first TUI live-read slice is a bounded non-interactive snapshot mode analogous to CLI `--full`, and that truthful live in-memory snapshot path now exists without mutating the indexed store.

### KR: R93-KR1 TUI snapshot can perform a truthful live read
Status: done
Acceptance: targeted TUI tests prove one non-interactive `--full` snapshot path can surface live-only differences, labels itself as a live in-memory scan, and does not mutate the indexed store.

- Task: add non-interactive TUI `--full` snapshot support
  Status: done
  Acceptance: targeted TUI tests prove snapshot output changes under live-only data, discloses live-read semantics, and leaves indexed reads unchanged afterwards.
  Artifact: `apps/tui/src/index.ts`, `apps/tui/src/store.ts`, `apps/tui/src/index.test.ts`, `BACKLOG.md`

---

## Objective: R94 - TUI Full Snapshot Combined Overlay Coverage
Status: done
Priority: P1
Source: TUI non-interactive full snapshot on 2026-04-03 after `R93`

The TUI now supports a truthful non-interactive `--full` snapshot, and the combined overlay path (`--full` + `--search` + `--source-health`) is now locked down too.

### KR: R94-KR1 TUI combined full snapshot stays coherent
Status: done
Acceptance: targeted TUI tests prove that non-interactive `--full --search ... --source-health` snapshots surface live-only hits, label the read mode truthfully, include source-health output, and leave the indexed store untouched.

- Task: add combined full snapshot TUI coverage
  Status: done
  Acceptance: one targeted TUI test proves the combined live-read search + source-health snapshot stays coherent and read-only.
  Artifact: `apps/tui/src/index.test.ts`, `BACKLOG.md`

---

## Objective: R95 - TUI Full Snapshot Manual Diary
Status: done
Priority: P1
Source: skeptical operator follow-through on 2026-04-03 after `R94`

The TUI now has strong automated proof for its non-interactive live-read snapshot path. This objective closes the immediate manual gap by recording one focused skeptical diary for indexed-vs-live TUI snapshot behavior.

### KR: R95-KR1 TUI full snapshot operator evidence is recorded
Status: done
Acceptance: one manual diary records indexed-vs-live TUI snapshot behavior across baseline indexed search, live full search, and combined live full search plus source-health output.

- Task: record TUI full snapshot manual diary
  Status: done
  Acceptance: one diary captures exact TUI commands, observed indexed-vs-live differences, and operator trust notes for the new full snapshot path.
  Artifact: `docs/design/R95_TUI_FULL_SNAPSHOT_DIARY_2026-04-03.md`, `BACKLOG.md`

---

## Objective: R96 - TUI Interactive Full Guard Coverage
Status: done
Priority: P1
Source: TUI full snapshot rollout on 2026-04-03 after `R95`

The TUI intentionally supports `--full` only in non-interactive mode for now, and that guardrail is now locked down by tests so unsupported interactive usage fails clearly.

### KR: R96-KR1 TUI rejects unsupported interactive full mode clearly
Status: done
Acceptance: targeted TUI tests prove that when `--full` is requested in interactive mode, the TUI exits with a clear error that directs the operator to non-interactive snapshot usage.

- Task: add interactive `--full` guard coverage
  Status: done
  Acceptance: one targeted TUI test proves interactive `--full` mode is rejected clearly and quietly.
  Artifact: `apps/tui/src/index.test.ts`, `BACKLOG.md`

---

## Objective: R97 - TUI Guide Full Snapshot Documentation
Status: done
Priority: P1
Source: TUI full snapshot rollout on 2026-04-03 after `R96`

The TUI now supports a bounded non-interactive `--full` live snapshot, and the user-facing TUI guide now explains that path and its current limits instead of leaving operators to infer them from code or tests.

### KR: R97-KR1 TUI guide explains full snapshot truthfully
Status: done
Acceptance: `docs/guide/tui.md` explains the new non-interactive `--full` snapshot path, clarifies that interactive `--full` is not supported, and states that the default TUI remains indexed-only.

- Task: update TUI guide for full snapshot mode
  Status: done
  Acceptance: user-facing TUI guide includes concrete `--full` examples, explains indexed-vs-live semantics, and documents the current non-interactive-only constraint.
  Artifact: `docs/guide/tui.md`, `BACKLOG.md`

---

## Objective: R98 - TUI Help Full Snapshot Coverage
Status: done
Priority: P1
Source: TUI guide and help parity follow-through on 2026-04-03 after `R97`

The TUI now documents `--full` in the guide and help output, and tests now lock down those help cues so usage text cannot silently drift.

### KR: R98-KR1 TUI help preserves full-snapshot guidance
Status: done
Acceptance: targeted TUI tests prove help output mentions `--full`, explains the live in-memory scan semantics, and notes the current non-interactive-only constraint.

- Task: extend TUI help coverage for `--full`
  Status: done
  Acceptance: one targeted TUI test proves help output continues to document `--full` and its current limits.
  Artifact: `apps/tui/src/index.test.ts`, `BACKLOG.md`

---

## Objective: R99 - TUI Full Snapshot Missing-Store Coverage
Status: done
Priority: P1
Source: TUI full snapshot edge-case follow-through on 2026-04-03 after `R98`
Completed: 2026-04-03

The TUI `--full` snapshot path is designed to be a read-only live scan, so it should not depend on an existing indexed store. Targeted TUI coverage now proves that `--full` can render a truthful snapshot when the selected store path does not exist, without creating that store on disk.

### KR: R99-KR1 TUI `--full` works without an indexed store
Status: done
Acceptance: targeted TUI tests prove that non-interactive `--full` snapshots can succeed against a missing store path, label themselves as live in-memory scans, and do not create the missing indexed store on disk.

- Task: add missing-store coverage for TUI `--full`
  Status: done
  Acceptance: one targeted TUI test proves `--full` works against a missing store path and remains read-only.
  Artifact: `apps/tui/src/index.test.ts`, `BACKLOG.md`

---

## Objective: R100 - Skeptical TUI Full Snapshot Verifier
Status: done
Priority: P1
Source: local test-closure follow-through on 2026-04-03 after `R99`
Completed: 2026-04-03

The TUI now has strong package-level `--full` coverage, and the skeptical local verifier bundle now also has one reusable end-to-end style command that exercises the built TUI entrypoint itself for live full-snapshot behavior.

### KR: R100-KR1 Built TUI full-snapshot behavior is verifier-backed
Status: done
Acceptance: one repository-owned verifier command proves the built TUI entrypoint can render default and combined `--full` snapshots, can succeed against a missing indexed store, labels live-read semantics truthfully, and does not create or mutate the indexed store.

- Task: add skeptical verifier for TUI `--full` snapshots
  Status: done
  Acceptance: `pnpm run verify:skeptical-tui-full-snapshot` passes and asserts built-TUI `--full` browse/search/source-health plus missing-store behavior with quiet stderr and read-only guarantees.
  Artifact: `scripts/verify-skeptical-tui-full-snapshot.mjs`, `package.json`, `BACKLOG.md`

---

## Objective: R101 - TUI Full Snapshot Missing-Store Manual Diary
Status: done
Priority: P1
Source: skeptical local operator follow-through on 2026-04-03 after `R99`
Completed: 2026-04-03

Automated proof for TUI `--full` missing-store behavior is now in place, and one focused skeptical hand-test now also records how the feature feels under direct use: whether the live-full wording makes sense, whether combined overlays stay readable, and whether the missing-store path really feels non-magical.

### KR: R101-KR1 TUI full snapshot edge cases have direct operator evidence
Status: done
Acceptance: one manual diary records exact non-interactive TUI `--full` commands for indexed-store, combined overlay, and missing-store scenarios, including whether the wording, readability, and read-only behavior feel trustworthy.

- Task: record skeptical manual diary for TUI `--full` edge cases
  Status: done
  Acceptance: one new diary captures exact commands, key output cues, and whether a missing-store `--full` path remains readable and non-mutating under manual use.
  Artifact: `docs/design/R101_TUI_FULL_EDGE_DIARY_2026-04-03.md`, `BACKLOG.md`

---

## Objective: R102 - Local Full Snapshot Test Matrix Expansion
Status: done
Priority: P1
Source: local test-closure follow-through on 2026-04-03 after `R101`
Completed: 2026-04-03

The repository now has both automated and manual proof for TUI `--full`, so the standing local test plan should name those commands explicitly instead of leaving them buried in recent diary history.

### KR: R102-KR1 Standing local test docs surface TUI `--full`
Status: done
Acceptance: the local closure plan and manual matrix explicitly include the new built-TUI `--full` verifier plus the corresponding indexed-store, combined-overlay, and missing-store hand-test commands.

- Task: extend the local test closure plan and manual matrix for TUI `--full`
  Status: done
  Acceptance: `docs/design/R40_TEST_CLOSURE_PLAN.md` and `docs/design/R42_LOCAL_MANUAL_TEST_MATRIX.md` both call out the new verifier and hand-test scenarios directly.
  Artifact: `docs/design/R40_TEST_CLOSURE_PLAN.md`, `docs/design/R42_LOCAL_MANUAL_TEST_MATRIX.md`, `BACKLOG.md`

---

## Objective: R103 - Grouped Local Full-Read Bundle Run
Status: done
Priority: P1
Source: local test-closure follow-through on 2026-04-03 after `R102`
Completed: 2026-04-03

The local full-read trust surface now spans both the installed CLI artifact and the built TUI `--full` verifier, and one backlog-owned grouped run now proves they can be treated as a single local confidence pass instead of two isolated commands.

### KR: R103-KR1 Grouped local full-read verifier bundle is explicitly owned
Status: done
Acceptance: one backlog-owned task exists for running `pnpm run verify:cli-artifact` plus `pnpm run verify:skeptical-tui-full-snapshot` as one grouped local full-read confidence pass and recording any runtime or readability friction.

- Task: run and record the grouped local full-read verifier bundle
  Status: done
  Acceptance: one execution note records the grouped run commands, whether both passes stay practical on this host, and any follow-up work if the bundle proves too slow or noisy.
  Artifact: `docs/design/R103_GROUPED_LOCAL_FULL_READ_BUNDLE_NOTE_2026-04-03.md`, `BACKLOG.md`

---

## Objective: R104 - Local Full-Read Bundle Alias
Status: done
Priority: P1
Source: grouped local full-read bundle note on 2026-04-03 after `R103`
Completed: 2026-04-03

The grouped local full-read pass is now exposed as one stable command, so future sessions no longer need to remember two separate commands for this recurring confidence pass.

### KR: R104-KR1 Grouped local full-read pass is one command away
Status: done
Acceptance: one backlog-owned task exists for adding a stable grouped verifier alias if it satisfies the repository command-surface rules and materially simplifies future execution.

- Task: add one stable grouped verifier alias for the local full-read pass
  Status: done
  Acceptance: the repository exposes one documented command such as `pnpm run verify:local-full-read-bundle` that runs the installed CLI artifact verifier and the TUI `--full` verifier sequentially, or a note records why the docs-only bundle remains the better choice.
  Artifact: `package.json`, `docs/design/R40_TEST_CLOSURE_PLAN.md`, `BACKLOG.md`

---

## Objective: R105 - Local Full-Read Alias Runtime Note
Status: done
Priority: P1
Source: local full-read alias execution on 2026-04-03 after `R104`
Completed: 2026-04-03

The new local full-read alias is now backed by one direct runtime note that records whether the command is practical enough to recommend as the default non-service confidence pass on this host.

### KR: R105-KR1 Local full-read alias practicality is recorded
Status: done
Acceptance: one note records the command, pass/fail result, and whether its runtime/behavior make it practical enough to recommend as the default local full-read confidence command.

- Task: record runtime note for the local full-read alias
  Status: done
  Acceptance: one note states whether `pnpm run verify:local-full-read-bundle` stays practical on this host and whether it should be treated as the default local confidence entrypoint.
  Artifact: `docs/design/R105_LOCAL_FULL_READ_ALIAS_NOTE_2026-04-03.md`, `BACKLOG.md`

---

## Objective: R106 - Local Full-Read Alias Surface Sync
Status: done
Priority: P1
Source: local full-read alias rollout on 2026-04-03 after `R105`
Completed: 2026-04-03

The new alias should be discoverable in the operator-facing docs and current runtime inventory instead of remaining only in one note or the root package manifest.

### KR: R106-KR1 Alias is surfaced in operator docs
Status: done
Acceptance: README-facing verification command lists and the current runtime inventory explicitly mention `pnpm run verify:local-full-read-bundle` and describe what it covers.

- Task: surface the local full-read alias in repository docs
  Status: done
  Acceptance: `README.md`, `README_CN.md`, and `docs/design/CURRENT_RUNTIME_SURFACE.md` all mention the new alias and its purpose truthfully.
  Artifact: `README.md`, `README_CN.md`, `docs/design/CURRENT_RUNTIME_SURFACE.md`, `BACKLOG.md`

---

## Objective: R107 - Local Full-Read Bundle Wrapper Script
Status: done
Priority: P1
Source: local full-read alias polish on 2026-04-03 after `R106`
Completed: 2026-04-03

The new alias now uses a repository-owned Node wrapper instead of a long shell chain, which makes the command surface more stable, easier to summarize, and less dependent on shell composition details.

### KR: R107-KR1 Local full-read alias uses a stable wrapper
Status: done
Acceptance: the alias resolves to one repository-owned wrapper script that performs the shared build step, runs the underlying verifiers in sequence, and prints one concise pass summary.

- Task: replace the shell-chain alias with a repository-owned wrapper script
  Status: done
  Acceptance: `pnpm run verify:local-full-read-bundle` resolves to one wrapper script with a concise summary line, while still running the underlying artifact and TUI verifiers truthfully.
  Artifact: `scripts/verify-local-full-read-bundle.mjs`, `package.json`, `BACKLOG.md`

---

## Objective: R108 - Skip-Build Verifier Guard
Status: done
Priority: P1
Source: local full-read bundle wrapper rollout on 2026-04-03 after `R107`
Completed: 2026-04-03

The optimized wrapper now depends on `verify-cli-artifact.mjs --skip-build`, and that path now has explicit guard evidence instead of being covered only indirectly by manual reruns.

### KR: R108-KR1 Skip-build artifact verification stays trustworthy
Status: done
Acceptance: one targeted test or note explicitly covers the `--skip-build` path used by `verify:local-full-read-bundle`, including the expectation that prebuilt CLI/package dist output must already exist.

- Task: add focused guard coverage for `verify-cli-artifact --skip-build`
  Status: done
  Acceptance: one targeted automated check or narrow design/runtime note proves the skip-build path behaves truthfully when required build output exists and fails clearly when it does not.
  Artifact: `docs/design/R108_SKIP_BUILD_GUARD_NOTE_2026-04-03.md`, `BACKLOG.md`

---

## Objective: R109 - Local Full-Read Wrapper Drift Guard
Status: done
Priority: P1
Source: skip-build guard follow-through on 2026-04-03 after `R108`
Completed: 2026-04-03

The local full-read wrapper is now practical and guarded by lightweight automated drift coverage around the wrapper command itself instead of relying only on repeated manual reruns and notes.

### KR: R109-KR1 Local full-read wrapper stays wired to the intended verifier chain
Status: done
Acceptance: one targeted automated check or script-level regression proves `verify-local-full-read-bundle` still performs the shared build step and still invokes both underlying verifiers in the intended order.

- Task: add lightweight regression coverage for the local full-read wrapper script
  Status: done
  Acceptance: one narrow automated check proves the wrapper still runs shared builds plus both downstream verifiers, or a focused note records why that level of regression is intentionally deferred.
  Artifact: `scripts/verify-local-full-read-bundle.test.mjs`, `scripts/verify-local-full-read-bundle.mjs`, `BACKLOG.md`

---

## Objective: R110 - Skip-Build Failure Regression
Status: done
Priority: P1
Source: local full-read wrapper hardening on 2026-04-03 after `R109`
Completed: 2026-04-03

The optimized local full-read path now depends on `verify-cli-artifact.mjs --skip-build`, and the clear-failure precondition for that mode is now enforced by an automated regression instead of notes alone.

### KR: R110-KR1 Skip-build clear-failure path stays guarded
Status: done
Acceptance: one targeted automated check proves `verify-cli-artifact.mjs --skip-build` fails clearly when required build output is absent.

- Task: add automated regression for `verify-cli-artifact --skip-build` missing-dist behavior
  Status: done
  Acceptance: one narrow automated test proves the skip-build path exits non-zero with an explicit prebuild instruction when required dist output is absent.
  Artifact: `scripts/verify-cli-artifact.test.mjs`, `BACKLOG.md`

---

## Objective: R111 - Local Full-Read Test Entry Documentation Sweep
Status: done
Priority: P1
Source: wrapper and skip-build regression follow-through on 2026-04-03 after `R110`
Completed: 2026-04-03

The local full-read verification surface is now materially stronger, and the active test-closure docs now group the current local-test entrypoints and their intended use order cleanly enough that future sessions do not need to stitch them together from multiple notes.

### KR: R111-KR1 Local full-read test entrypoints stay easy to find
Status: done
Acceptance: one focused documentation pass verifies that the current local-test entrypoints and their intended use order are grouped cleanly in the active test-closure docs, without forcing future sessions to stitch them together from multiple notes.

- Task: tighten the local full-read entrypoint grouping in active test-closure docs
  Status: done
  Acceptance: the active test-closure docs present `verify:local-full-read-bundle`, the targeted wrapper/skip-build regressions, and the remaining blocked managed-runtime diaries in one obvious sequence for future sessions.
  Artifact: `docs/design/R40_TEST_CLOSURE_PLAN.md`, `docs/design/R42_LOCAL_MANUAL_TEST_MATRIX.md`, `BACKLOG.md`

---

## Objective: R112 - Local Full-Read Release-Gate Positioning Note
Status: done
Priority: P1
Source: local full-read doc sweep on 2026-04-03 after `R111`
Completed: 2026-04-03

The local full-read bundle is now discoverable and practical, and its positioning is no longer implicit: it remains a local confidence helper rather than a required self-host release-gate verifier.

### KR: R112-KR1 Local full-read bundle positioning stays explicit
Status: done
Acceptance: one narrow note or doc update makes it explicit whether `verify:local-full-read-bundle` is intentionally a local confidence helper rather than a release-gate requirement.

- Task: record the release-gate positioning decision for the local full-read bundle
  Status: done
  Acceptance: one focused note or release-gate/runtime-doc update states whether the bundle is local-confidence-only or part of the required self-host release gate.
  Artifact: `docs/design/SELF_HOST_V1_RELEASE_GATE.md`, `BACKLOG.md`

---

## Objective: R113 - Local Full-Read Entry Surface Consistency Sweep
Status: done
Priority: P1
Source: release-gate positioning follow-through on 2026-04-03 after `R112`
Completed: 2026-04-03

The local full-read entrypoints are now stronger and more explicit, and one focused consistency sweep has now verified that the active doc surfaces describe the same default execution order and positioning without material drift.

### KR: R113-KR1 Local full-read entry surfaces stay mutually consistent
Status: done
Acceptance: one focused consistency pass verifies that `R40`, `R42`, `CURRENT_RUNTIME_SURFACE`, `README.md`, `README_CN.md`, and `SELF_HOST_V1_RELEASE_GATE.md` tell a compatible story about the local full-read bundle and its non-release-gate positioning.

- Task: run one focused consistency sweep across local full-read doc surfaces
  Status: done
  Acceptance: one targeted doc sweep confirms the active surfaces agree on command name, purpose, default use order, and non-release-gate status, or records any resulting corrective work.
  Artifact: `docs/design/R113_LOCAL_FULL_READ_SURFACE_CONSISTENCY_2026-04-03.md`, `BACKLOG.md`

---

## Objective: R114 - Local Full-Read Summary Output Guard
Status: done
Priority: P1
Source: local full-read consistency sweep on 2026-04-03 after `R113`
Completed: 2026-04-03

The local full-read wrapper now has a concise summary line, and a lightweight regression now proves that this operator-facing summary remains present and informative after future edits.

### KR: R114-KR1 Local full-read wrapper summary stays explicit
Status: done
Acceptance: one lightweight automated check proves the wrapper continues to emit a concise success summary that includes total runtime and sub-step timing cues.

- Task: add a narrow regression for the local full-read wrapper success summary
  Status: done
  Acceptance: one targeted automated check proves the wrapper still prints a concise pass summary such as `local full-read bundle passed in ...` with sub-step timings.
  Artifact: `scripts/verify-local-full-read-bundle.test.mjs`, `scripts/verify-local-full-read-bundle.mjs`, `BACKLOG.md`

---

## Objective: R115 - E2E J4 Admin Journey Coverage Reclassification
Status: done
Priority: P1
Source: holistic KR review sweep on 2026-04-03 after `R114`
Completed: 2026-04-03

`E2E-2` no longer understates `J4-admin-source-health-review`. The current verifier-plus-diary surface is now strong enough that the journey can be classified as covered today instead of partial.

### KR: R115-KR1 J4 admin/source-health journey is classified truthfully
Status: done
Acceptance: one focused note or direct doc update records whether `J4-admin-source-health-review` is now covered by the current verifier + diary surface, and updates the active validation docs if the older `partial` label is no longer truthful.

- Task: re-evaluate and update the J4 admin/source-health journey classification
  Status: done
  Acceptance: `docs/design/E2E_2_HLD_USER_JOURNEY_COVERAGE.md` and any directly dependent validation note(s) truthfully describe the current proof state for the admin/source-health journey.
  Artifact: `docs/design/E2E_2_HLD_USER_JOURNEY_COVERAGE.md`, `docs/design/V1_GOAL_LEVEL_E2E_VALIDATION.md`, `BACKLOG.md`

---

## Objective: R116 - Dedicated J4 Admin Journey Verifier Decision
Status: done
Priority: P1
Source: holistic KR review sweep on 2026-04-03 after `R115`
Completed: 2026-04-03

`J4-admin-source-health-review` is now truthfully covered, and the repository now has an explicit decision to keep the current verifier-plus-diary split instead of adding one more top-level dedicated admin-journey verifier right now.

### KR: R116-KR1 J4 verifier strategy is explicit
Status: done
Acceptance: one focused decision note or implementation slice makes it explicit whether the project accepts the current verifier-plus-diary split for `J4`, or proceeds with one dedicated admin-journey verifier.

- Task: decide whether to add a dedicated admin discover/health verifier for J4
  Status: done
  Acceptance: one focused note or implementation task records whether a new verifier is worth the command-surface and maintenance cost, with concrete reasoning tied to `J4` proof needs.
  Artifact: `docs/design/R116_J4_VERIFIER_DECISION_2026-04-03.md`, `BACKLOG.md`

---

## Objective: R117 - Managed-Runtime Diary Prep Surface Consistency
Status: done
Priority: P1
Source: holistic KR review sweep on 2026-04-03 after `R116`
Completed: 2026-04-03

The remaining highest-value gaps are still the blocked managed-runtime diaries under `R31` and `R35`, and one focused consistency sweep has now confirmed that their prep contracts and blockers are already presented consistently across the active local proof surfaces.

### KR: R117-KR1 Blocked managed-runtime diary prep stays explicit
Status: done
Acceptance: one focused consistency pass verifies that the active local-test docs and validation summaries consistently present `R31` and `R35` as blocked managed-runtime follow-up rather than implied missing automation bugs.

- Task: run a focused consistency sweep for blocked managed-runtime diary prep surfaces
  Status: done
  Acceptance: one narrow note or doc sweep confirms the active local proof docs present `R31` and `R35` consistently as blocked service-dependent review work, or records any resulting corrective edits.
  Artifact: `docs/design/R117_MANAGED_RUNTIME_PREP_CONSISTENCY_2026-04-03.md`, `BACKLOG.md`

---

## Objective: R118 - Support-Status Reverification After Surface Updates
Status: done
Priority: P1
Source: holistic KR review sweep on 2026-04-03 after `R117`
Completed: 2026-04-03

The repository changed multiple support-surface documents (`README`, `README_CN`, `CURRENT_RUNTIME_SURFACE`, and `SELF_HOST_V1_RELEASE_GATE`), and the support-tier verifier has now been rerun successfully against those updated claims.

### KR: R118-KR1 Support-surface claims still match the adapter registry
Status: done
Acceptance: `pnpm run verify:support-status` passes after the latest documentation and runtime-surface updates, or any resulting drift is converted into backlog work before further corrective edits.

- Task: rerun support-status verification after local proof-surface doc changes
  Status: done
  Acceptance: `pnpm run verify:support-status` passes against the current support-tier docs, or the failure is classified and owned in the backlog.
  Artifact: `pnpm run verify:support-status`, `BACKLOG.md`

---

## Objective: R119 - Clean-Install Reverification After Local Surface Expansion
Status: done
Priority: P1
Source: holistic KR review sweep on 2026-04-03 after `R118`
Completed: 2026-04-03

The repository gained new verifier entrypoints, wrapper scripts, and user-facing verification guidance, and the clean-install verifier has now been rerun successfully so the documented first-install path remains truthful after the recent surface expansion.

### KR: R119-KR1 Clean-install path still matches the documented repository surface
Status: done
Acceptance: `pnpm run verify:clean-install` passes after the current CLI/runtime/doc-surface changes, or any resulting drift is classified and owned in the backlog before more corrective work.

- Task: rerun clean-install verification after local proof-surface expansion
  Status: done
  Acceptance: `pnpm run verify:clean-install` passes on the current repository state, or the failure is classified into backlog work.
  Artifact: `pnpm run verify:clean-install`, `BACKLOG.md`

---

## Objective: R120 - Offline Web-Build Reverification After Surface Expansion
Status: done
Priority: P1
Source: holistic KR review sweep on 2026-04-03 after `R119`
Completed: 2026-04-03

The current release-gate docs and verification guidance were refreshed, and the remaining minimum self-host gate command has now been rechecked successfully too: the offline web build verifier still passes on the current repository state.

### KR: R120-KR1 Offline web-build gate still holds after current surface changes
Status: done
Acceptance: `pnpm run verify:web-build-offline` passes on the current repository state, or any resulting drift is classified and owned in the backlog before further corrective work.

- Task: rerun offline web-build verification after current surface updates
  Status: done
  Acceptance: `pnpm run verify:web-build-offline` passes on the current repository state, or the failure is classified into backlog work.
  Artifact: `pnpm run verify:web-build-offline`, `BACKLOG.md`



---

## Objective: R121 - Consolidated Skeptical Local Operator Flow Diary
Status: done
Priority: P1
Source: holistic KR review sweep on 2026-04-03 after `R120`
Completed: 2026-04-03

All currently executable local proof exists, but it is still fragmented across narrow verifiers and focused manual diaries. A project-wide KR sweep found one remaining non-service confidence gap: there is not yet one contiguous skeptical-user diary that exercises source-tree CLI, installed-artifact CLI, and TUI browse/read flows together across command discovery, project/session/turn drill-down, parameterized search, backup/restore, and live-read trust checks. That gap matters because it is the most direct local answer to the user question "have you actually used this like a picky operator?"

The executed diary did not surface any new non-trivial local corrective work beyond already-owned readability caveats; the remaining highest-value unfinished evidence is still the blocked managed-runtime diary queue under `R31` and `R35`.

### KR: R121-KR1 One contiguous local skeptical-user flow is directly evidenced
Status: done
Acceptance: one new local diary records a contiguous skeptical-user workflow spanning source-tree CLI, installed-artifact CLI, and TUI, covering command discovery, browse/search drill-down, parameterized variants, backup/restore confidence, and indexed-vs-live trust notes, with any newly observed non-trivial friction converted into backlog work before corrective implementation.

- Task: run and record one consolidated skeptical local operator flow diary
  Status: done
  Acceptance: one diary records exact local commands, observed outcomes, trust/readability notes, and whether the current local proof genuinely feels sufficient for a picky operator across source-tree CLI, installed-artifact CLI, and TUI.
  Artifact: `docs/design/R121_CONSOLIDATED_SKEPTICAL_LOCAL_FLOW_DIARY_2026-04-03.md`

- Task: classify any newly observed non-trivial local gaps from the consolidated diary
  Status: done
  Acceptance: if the diary surfaces any new non-trivial local gap not already owned elsewhere, the gap is converted into explicit backlog work before non-trivial corrective implementation starts.
  Artifact: `BACKLOG.md`

- Task: surface the consolidated skeptical-flow diary in the active local test-closure docs
  Status: done
  Acceptance: the current local test-closure docs mention the consolidated skeptical-flow diary as the direct answer to the "have we really hand-tested this as a picky operator?" question, alongside the existing verifier bundle and focused diaries.
  Artifact: `docs/design/R40_TEST_CLOSURE_PLAN.md`, `docs/design/R42_LOCAL_MANUAL_TEST_MATRIX.md`


---

## Objective: R122 - API Client Canonical Read-Path Regression Coverage
Status: done
Priority: P1
Source: holistic KR review sweep on 2026-04-03 after `R121`
Completed: 2026-04-03

The remaining open objectives are service-blocked, but a whole-project KR sweep found one still-executable confidence gap in the canonical read pipeline: the managed API routes are tested directly in `apps/api`, and the future service-started diary under `R31-KR2` is already owned, yet `@cchistory/api-client` still has no independent regression proving that the shipped client can traverse the same canonical `J7` read path (`projects` → `turn search` → `turn context`) against an in-process runtime. That gap matters because the design freeze requires CLI, API, web, and other clients to remain projections of one semantic model, not just route-by-route availability.

The new regression keeps `J7` truthfully classified as managed-runtime/manual for user-started service review, but it removes the narrower local blind spot where the shipped client itself had no direct route-chain proof at all.

### KR: R122-KR1 API client proves the canonical managed-read route chain locally
Status: done
Acceptance: `@cchistory/api-client` has direct regression coverage for the canonical read chain and one representative error path against an in-process API runtime, and the repository docs truthfully expose the new package-scoped test command if one is added.

- Task: add api-client regression for the canonical project-search-context route chain
  Status: done
  Acceptance: `packages/api-client` proves one in-process client journey that fetches projects, searches turns by phrase, and retrieves turn context through `createCCHistoryApiClient(...)`, using the same canonical objects the API runtime exposes.
  Artifact: `packages/api-client/src/index.test.ts`

- Task: add api-client regression for representative read-path error propagation
  Status: done
  Acceptance: one targeted regression proves the client surfaces a non-OK read-path failure as `CCHistoryApiError` with the requested path and status details, rather than flattening the managed API error boundary.
  Artifact: `packages/api-client/src/index.test.ts`

- Task: expose the api-client package test command in current operator docs
  Status: done
  Acceptance: if `packages/api-client` gains a stable `test` script, the current repo instructions mention `pnpm --filter @cchistory/api-client test` in the relevant build/test command inventory.
  Artifact: `AGENTS.md`


---

## Objective: R123 - API Client Source-Config Admin Coverage
Status: done
Priority: P1
Source: holistic KR review sweep on 2026-04-03 after `R122`
Completed: 2026-04-03

The API client now proves the canonical read chain, but another still-executable gap remains in the same shared client surface: the web admin source-management flow depends on `getSources`, `createSourceConfig`, `updateSourceConfig`, and `resetSourceConfig`, yet the shipped `@cchistory/api-client` still has no direct regression proving those calls behave correctly against an in-process runtime. That leaves one important non-service blind spot in the canonical admin pipeline even though the underlying API routes are already tested.

### KR: R123-KR1 API client proves one representative source-config admin roundtrip locally
Status: done
Acceptance: `@cchistory/api-client` directly proves one source-config admin roundtrip against an in-process API runtime, including source listing, manual-source creation, editable base-dir update, and reset behavior for a default source.

- Task: add api-client regression for source-config list-create-update-reset flow
  Status: done
  Acceptance: `packages/api-client/src/index.test.ts` proves `getSources`, `createSourceConfig`, `updateSourceConfig`, and `resetSourceConfig` behave correctly against an in-process runtime, using fixture-backed Codex source roots and explicit readback assertions.
  Artifact: `packages/api-client/src/index.test.ts`


---

## Objective: R124 - API Client Session Related-Work Coverage
Status: done
Priority: P1
Source: holistic KR review sweep on 2026-04-03 after `R123`
Completed: 2026-04-03

The shared API client now covers the canonical read chain and the source-config admin roundtrip, but one still-executable gap remains on a web-visible drill-down path: `apps/web/lib/api.ts` relies on `getSessions()` and `getSessionRelatedWork(sessionId)` to surface child-session and automation-run context, yet `@cchistory/api-client` still has no direct regression proving that route pair against real fixture-backed runtime data.

### KR: R124-KR1 API client proves one related-work drill-down path locally
Status: done
Acceptance: `@cchistory/api-client` directly proves one fixture-backed `sessions -> related-work` drill-down path against an in-process API runtime, covering both transcript-primary delegated work and evidence-only automation work where the fixture corpus supports it.

- Task: add api-client regression for fixture-backed session related-work drill-down
  Status: done
  Acceptance: `packages/api-client/src/index.test.ts` proves `getSessions()` plus `getSessionRelatedWork(sessionId)` can retrieve at least one delegated-session and one automation-run related-work path from the existing sanitized fixture corpus through an in-process API runtime.
  Artifact: `packages/api-client/src/index.test.ts`


---

## Objective: R125 - API Client Linking Review Coverage
Status: done
Priority: P1
Source: holistic KR review sweep on 2026-04-03 after `R124`
Completed: 2026-04-03

The web admin linking surface depends on `getLinkingReview`, `upsertLinkingOverride`, `getLinkingOverrides`, and the resulting project drill-down calls, yet the shipped `@cchistory/api-client` still has no direct regression proving that workflow against an in-process runtime. The underlying API routes are tested, but the shared client path that the web actually calls is still missing direct proof.

### KR: R125-KR1 API client proves one representative linking-review workflow locally
Status: done
Acceptance: `@cchistory/api-client` directly proves one linking-review workflow against an in-process API runtime, including reading the review queue, creating a manual override, listing overrides, and reading the resulting project turns/revisions.

- Task: add api-client regression for linking review and manual override workflow
  Status: done
  Acceptance: `packages/api-client/src/index.test.ts` proves `getLinkingReview`, `upsertLinkingOverride`, `getLinkingOverrides`, `getProjectTurns`, and `getProjectRevisions` behave coherently through one fixture-backed runtime flow.
  Artifact: `packages/api-client/src/index.test.ts`


---

## Objective: R126 - API Client Admin Diagnostics And Lifecycle Coverage
Status: done
Priority: P1
Source: holistic KR review sweep on 2026-04-03 after `R125`
Completed: 2026-04-03

The shared API client now covers the main browse, linking, related-work, and source-config flows, but another still-executable gap remains in the web/admin-facing surface: `getMasks`, `getDriftReport`, `getTurnLineage`, `upsertArtifact`, `getArtifacts`, `getArtifactCoverage`, `runCandidateGc`, and `getTombstone` still lack direct client regressions even though the backing API routes are already tested.

### KR: R126-KR1 API client proves one representative admin diagnostics and lifecycle path locally
Status: done
Acceptance: `@cchistory/api-client` directly proves one diagnostics path (`masks` / `drift` / `turn lineage`) and one artifact-lifecycle path (`upsert artifact` / `coverage` / `candidate GC` / `tombstone`) against an in-process API runtime.

- Task: add api-client regression for masks, drift, and turn-lineage reads
  Status: done
  Acceptance: `packages/api-client/src/index.test.ts` proves `getMasks`, `getDriftReport`, and `getTurnLineage(turnId)` behave coherently against an in-process runtime with one synced turn.
  Artifact: `packages/api-client/src/index.test.ts`

- Task: add api-client regression for artifact coverage and candidate lifecycle flow
  Status: done
  Acceptance: `packages/api-client/src/index.test.ts` proves `upsertArtifact`, `getArtifacts`, `getArtifactCoverage`, `runCandidateGc`, and `getTombstone` behave coherently through one in-process runtime flow.
  Artifact: `packages/api-client/src/index.test.ts`


---

## Objective: R127 - API Client Detail And Project-Delete Coverage
Status: done
Priority: P1
Source: holistic KR review sweep on 2026-04-03 after `R126`
Completed: 2026-04-03

The shared API client now covers most high-value browse, admin, and lifecycle surfaces, but one still-executable gap remains around direct detail retrieval and destructive admin workflow: `getTurn`, `getSession`, and `deleteProject` are still missing direct client regressions even though the web detail panes and project-admin surfaces depend on them.

### KR: R127-KR1 API client proves one turn/session detail read and one project-delete admin flow locally
Status: done
Acceptance: `@cchistory/api-client` directly proves `getTurn` and `getSession` on one fixture-backed runtime flow, then proves `deleteProject` on one manually linked project, including explicit deleted object IDs and tombstone evidence.

- Task: add api-client regression for direct turn/session detail reads and project delete workflow
  Status: done
  Acceptance: `packages/api-client/src/index.test.ts` proves `getTurn`, `getSession`, and `deleteProject` behave coherently through one in-process runtime flow with explicit readback and deletion assertions.
  Artifact: `packages/api-client/src/index.test.ts`


---

## Objective: R128 - README Test Matrix Parity After API Client Test Coverage Expansion
Status: done
Priority: P1
Source: holistic KR review sweep on 2026-04-03 after `R127`
Completed: 2026-04-03

The repository now ships a real `pnpm --filter @cchistory/api-client test` entrypoint with 8 direct regressions, but the current top-level README development matrices still list only the older package test commands. That leaves a small but real operator-doc drift right after the new shared-client test surface landed.

### KR: R128-KR1 Top-level README test matrices include the shipped api-client test command
Status: done
Acceptance: `README.md` and `README_CN.md` include `pnpm --filter @cchistory/api-client test` with the current package test count, alongside the existing package-scoped test inventory.

- Task: add api-client test command to the English and Chinese README development matrices
  Status: done
  Acceptance: the top-level README command lists mention `pnpm --filter @cchistory/api-client test` with the current test count instead of implying that the shared client has no package-scoped regression command.
  Artifact: `README.md`, `README_CN.md`


---

## Objective: R129 - Presentation Admin Mapping Coverage
Status: done
Priority: P1
Source: holistic KR review sweep on 2026-04-03 after `R128`
Completed: 2026-04-03

The shared API client now has strong direct regression coverage, but another still-executable gap remains between DTO delivery and web-facing semantics: `@cchistory/presentation` still lacks direct tests for several admin and project mapping functions that the web relies on, including `mapSession`, `mapProject`, `mapLinkingReview`, `mapProjectRevision`, `mapProjectLineageEvent`, `mapProjectManualOverride`, `mapSourceStatus`, and `mapMaskTemplate`.

### KR: R129-KR1 Presentation layer proves representative admin/project mapping semantics
Status: done
Acceptance: `packages/presentation/src/index.test.ts` directly proves the current admin/project mapping helpers convert timestamps, preserve identifiers and platform/status fields, and compose nested linking-review structures correctly for the web-facing layer.

- Task: add presentation regression for session, project, linking review, source status, mask, and project admin mappings
  Status: done
  Acceptance: `packages/presentation/src/index.test.ts` includes direct coverage for the current admin/project mapping helpers used by `apps/web/lib/api.ts`, with focused assertions on date conversion and field preservation.
  Artifact: `packages/presentation/src/index.test.ts`


---

## Objective: R130 - Presentation Test Count Parity After Mapping Coverage Expansion
Status: done
Priority: P1
Source: holistic KR review sweep on 2026-04-03 after `R129`
Completed: 2026-04-03

The presentation mapping suite now has 11 tests after the new admin/project mapping coverage landed, but the current top-level docs still describe `@cchistory/presentation test` as a 5-test package. That is a small but real operator-doc drift introduced by the latest executable work.

### KR: R130-KR1 Current operator docs report the real presentation package test count
Status: done
Acceptance: `README.md`, `README_CN.md`, and any current AGENTS test-count inventory no longer describe `@cchistory/presentation test` as a 5-test suite once the package now ships 11 tests.

- Task: update top-level docs to the current presentation test count
  Status: done
  Acceptance: the top-level command inventories and AGENTS test-count examples show the current `@cchistory/presentation` test count instead of the stale 5-test wording.
  Artifact: `README.md`, `README_CN.md`, `AGENTS.md`


---

## Objective: R131 - Shared Web Read-Surface Regression Closure
Status: done
Priority: P1
Source: holistic KR review sweep on 2026-04-03 after `R130`
Completed: 2026-04-03

The repository's local verifier and diary surface was already strong, but one still-executable shared read-chain gap remained in the exact stack the managed web UI uses: `@cchistory/api-client` lacked a direct regression for paginated and filtered read-helper serialization, and `@cchistory/presentation` lacked a direct regression for `mapTurnContext(...)` detail mapping. This objective closed that gap with direct shared-package tests plus doc-count parity so the current project/session/turn drill-down stack is more explicitly proven before the still-blocked managed-runtime diaries resume.

### KR: R131-KR1 Shared web-facing read helpers prove pagination, filtering, and detail semantics locally
Status: done
Acceptance: direct regressions prove `@cchistory/api-client` correctly exercises paginated and filtered managed-read helpers used by `apps/web/lib/api.ts`, and `@cchistory/presentation` directly proves `mapTurnContext(...)` preserves nested temporal fields and detail metadata for the same read path.

- Task: add api-client regression for paginated and filtered managed-read helpers
  Status: done
  Acceptance: `packages/api-client/src/index.test.ts` proves at least one in-process runtime flow covering paginated `getTurns(...)`, filtered `searchTurns(...)`, committed-project retrieval, and project-scoped `getArtifacts(projectId)` readback.
  Artifact: `packages/api-client/src/index.test.ts`

- Task: add presentation regression for turn-context detail mapping helpers
  Status: done
  Acceptance: `packages/presentation/src/index.test.ts` proves `mapTurnContext(...)` converts nested temporal fields, preserves system/reply/tool ordering, and keeps key metadata used by `apps/web/lib/api.ts` intact.
  Artifact: `packages/presentation/src/index.test.ts`

- Task: refresh shared-package test-count docs after regression growth
  Status: done
  Acceptance: if the shared package test counts grow, `README.md`, `README_CN.md`, and the current `AGENTS.md` test inventory reflect the new totals.
  Artifact: `README.md`, `README_CN.md`, `AGENTS.md`


---

## Objective: R132 - Post-Regression Local Full-Read Confidence Recheck
Status: done
Priority: P1
Source: local test-closure follow-through on 2026-04-03 after `R131`
Completed: 2026-04-03

`R131` strengthened the shared read path that the managed web UI uses, and the active local execution rule in `docs/design/R40_TEST_CLOSURE_PLAN.md` said the next no-services move should be the grouped local full-read confidence pass rather than another review sweep. That follow-through is now complete: the grouped built-CLI-artifact plus TUI live-read verifier passed again, and the wrapper drift guards also stayed green, so the repository keeps doing real local testing while the remaining managed-runtime diaries under `R31` and `R35` stay blocked on user-started services.

### KR: R132-KR1 Grouped local full-read confidence is rechecked after shared regression growth
Status: done
Acceptance: `pnpm run verify:local-full-read-bundle` passes on the current repository state after `R131`, and the wrapper drift guards also pass if the grouped run stays green, or any failure is classified into backlog work before more corrective implementation.

- Task: rerun the grouped local full-read verifier bundle after `R131`
  Status: done
  Acceptance: `pnpm run verify:local-full-read-bundle` passes, or the failing layer/step is recorded in `BACKLOG.md` before more corrective work starts.
  Artifact: `pnpm run verify:local-full-read-bundle`, `BACKLOG.md`

- Task: rerun the local full-read wrapper drift guards after the grouped pass
  Status: done
  Acceptance: `node --test scripts/verify-cli-artifact.test.mjs scripts/verify-local-full-read-bundle.test.mjs` passes, proving the wrapper and skip-build guard surface still matches the executed bundle chain.
  Artifact: `node --test scripts/verify-cli-artifact.test.mjs scripts/verify-local-full-read-bundle.test.mjs`, `BACKLOG.md`
