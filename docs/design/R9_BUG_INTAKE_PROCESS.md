# R9 - Bug Intake Process

## Status

- Objective source: `docs/ROADMAP.md`
- Current phase: `R9-KR1` through `R9-KR3` implemented and evaluated on
  2026-03-27
- Scope: reproducible bug intake, evidence collection, issue entrypoints, and
  the handoff from reported bug to backlog task and regression proof

## Phase 1 - Domain Understanding

### Problem statement

The roadmap asks for an issue-driven bug intake rhythm, but the repository does
not currently define a canonical bug report contract, a reusable template, or a
clear triage path from reported bug to `BACKLOG.md` execution.

Today, bug reports can arrive in ad hoc chat messages with inconsistent detail:

- missing source/platform identity
- missing reproduction steps
- missing expected vs actual behavior
- missing evidence paths, screenshots, or commands
- no explicit rule for when a report becomes a backlog objective, KR, or task

This makes it hard to distinguish a reproducible product bug from an ambiguous
operator question.

### What is already implemented

- `PIPELINE.md` already defines how objectives, KRs, and tasks are executed once
  work is in the backlog.
- `BACKLOG.md` is already the living work surface for tracked objectives.
- The product already exposes strong inspection surfaces that bug intake should
  reuse rather than replace:
  - CLI: `discover`, `sync --dry-run`, `ls`, `show`, `search`, `stats`
  - probe: `pnpm run probe:smoke -- --source-id=<id> --limit=1`
  - web/admin: `Sources`, `Linking`, `Drift`, `Masks`
- `AGENTS.md` already states evidence-preservation rules for parsing,
  ingestion, masking, and UI bugs.

### Gaps found

#### 1. No canonical bug report contract

There is no repository-local definition of the minimum fields a valid bug report
must include.

#### 2. No reusable intake template

The repo currently has no issue template, markdown bug report template, or
operator-facing guide for how to report a bug reproducibly.

#### 3. No explicit triage mapping into the backlog

The pipeline explains how to execute tracked work, but not how a newly reported
bug should be classified, prioritized, deduplicated, or transformed into an
objective/KR/task.

#### 4. Evidence-preserving bug handling is implicit, not operationalized

The design freeze and repo instructions say to preserve evidence and treat
parser/ingestion/rendering bugs as potentially class-wide, but bug reporters are
not yet told which evidence to capture.

### Why this matters to frozen semantics

This objective does not change product semantics. It operationalizes the frozen
rules around evidence preservation, project-first history, and `UserTurn`-
centered debugging by making bug intake reproducible and traceable.

### Assumptions

- The bug intake contract should be tracker-agnostic at its core, so it remains
  useful even if the repository host changes.
- The first slice should focus on reproducibility and evidence capture before
  introducing automation.
- Bug intake should prefer the smallest existing inspection command that can
  prove the problem.
- Source-specific bugs should still be reported in canonical product terms:
  source, session, turn, workspace, projection, or linking behavior.

### Remaining unknowns

- Which remote issue tracker host is preferred long-term.
- Whether maintainers want formal severity labels beyond the backlog priority
  system.
- Whether future bug intake should open directly into GitHub issues, a local bug
  ledger, or both.

## Phase 2 - Test Data Preparation

### Required evidence scenarios

A good bug intake process must support at least these bug classes:

- parser/source-specific bugs with captured raw evidence
- linking/project-identity bugs spanning multiple sessions or platforms
- search/query bugs with CLI reproduction
- API contract bugs with request/response payload evidence
- web rendering bugs with screenshots plus affected record ids
- migration/storage bugs with store path, schema version, and reproducible steps

### Current limitation

The repository has no canonical template that asks for this information in a
consistent way.

### First required artifacts

The first executable slice should add:

1. a user-facing bug reporting guide
2. a reusable markdown bug report template
3. explicit evidence checklists keyed by surface (`CLI`, `API`, `Web`,
   `source-adapter`, `storage/linking`)

## Phase 3 - Functional Design

Environment note: this objective is operational/process-oriented and benefits
from the multi-perspective design protocol. In this environment there is no
sub-agent launcher, so the protocol is recorded as separated lenses plus a
synthesis.

### Agent A - System Consistency

**Recommendation**: define one canonical bug report contract first, then make
all tracker-specific templates project that contract.

**Reasoning**:

- The backlog and pipeline are repository-local.
- A tracker-specific form without a repository-local contract can drift.
- The contract should align with existing evidence-preservation rules.

### Agent B - Reporter Experience

**Recommendation**: optimize for a short form with strong defaults and
copy-pasteable commands.

**Reasoning**:

- Reporters often know symptoms, not architecture.
- They need prompts for expected/actual behavior and the minimum commands needed
  to capture evidence.
- The guide should help them choose the smallest proving command instead of
  asking for broad logs by default.

### Agent C - Engineering Cost

**Recommendation**: ship in three slices.

**Reasoning**:

- Slice 1: canonical contract + markdown template + guide
- Slice 2: repository issue template / intake entrypoint wired to that contract
- Slice 3: triage policy mapping issue intake into `BACKLOG.md` execution and
  regression closure

This sequence delivers immediate value without blocking on tracker-host
assumptions.

### Synthesis

The recommended path is:

1. define a tracker-agnostic bug report contract
2. add a guide and reusable template that operationalize the contract
3. add repository-native issue intake entrypoints that mirror the same fields
4. document how accepted bugs become backlog work and how fixes are verified

### Decided KRs

#### KR: R9-KR1 Canonical bug report contract

Acceptance: reproducible bug reports require consistent fields for affected
surface, source/session context, expected vs actual behavior, and evidence
attachments/commands.

#### KR: R9-KR2 Issue template and intake entrypoints

Acceptance: the repository exposes tracker-ready bug intake entrypoints that map
cleanly to the canonical bug report contract.

#### KR: R9-KR3 Triage-to-backlog workflow and regression closure

Acceptance: accepted bug reports have a documented path into `BACKLOG.md` and a
clear rule for closure only after reproduction and regression verification.

### Impacted areas

- `BACKLOG.md`
- `docs/design/` for the operational design note
- `docs/guide/` for reporter/operator instructions
- repository-level issue template/config if enabled

### First executable slice

Implement `R9-KR1` first by adding:

- `docs/guide/bug-reporting.md`
- `docs/templates/bug-report.md`
- backlog decomposition for the remaining intake and triage slices

## KR1 - Canonical Bug Report Contract

`R9-KR1` was completed on 2026-03-27 with two repository-local artifacts:

- `docs/guide/bug-reporting.md`
- `docs/templates/bug-report.md`

The canonical contract now requires the same core fields everywhere:

- summary
- affected surface
- source/platform and ids when known
- minimal reproduction steps
- expected vs actual behavior
- evidence attachments or proving commands
- scope check
- evidence-preservation checklist

Results:

- reporters now have one tracker-agnostic contract for reproducible bug intake
- the guide points reporters to the smallest proving commands by surface instead
  of broad log collection
- the markdown template preserves the frozen evidence-first handling rules in an
  executable checklist

## KR2 - Issue Template And Intake Entry Points

`R9-KR2` was completed on 2026-03-27 by adding repository-native issue intake
artifacts:

- `.github/ISSUE_TEMPLATE/bug-report.yml`
- `.github/ISSUE_TEMPLATE/config.yml`

The issue form mirrors the same canonical contract used by the markdown
template:

- summary
- surface
- platform/source and ids
- reproduction steps
- expected vs actual behavior
- evidence
- scope check
- evidence-preservation checklist

Results:

- the repository now exposes a tracker-ready bug intake path instead of relying
  on free-form issue text
- blank issues are disabled so the canonical bug report contract remains the
  default intake path
- the form explicitly points reporters back to `docs/guide/bug-reporting.md`
  for evidence-preserving expectations

## KR3 - Triage-To-Backlog Workflow And Regression Closure

`R9-KR3` was completed on 2026-03-27 by extending the user-facing guide and this
design note with one explicit triage rule set.

### Intake and triage gates

Accepted bug reports now move through five gates:

1. **Completeness gate** — if required fields or proving evidence are missing,
   request a better report before opening backlog work.
2. **Reproduction gate** — confirm the symptom using the smallest command,
   payload, request/response pair, or screenshot trail that proves it.
3. **Scope gate** — classify the report as isolated, duplicate, or potentially
   class-wide.
4. **Backlog mapping gate** — translate the accepted report into `BACKLOG.md`
   work:
   - add a task under an existing KR when the fix fits one accepted slice
   - add a KR under an existing objective when the gap is broader than one task
   - add a new objective when no active objective already owns the problem
5. **Regression closure gate** — only close the bug after the fix has both the
   original reproducer and targeted regression proof at the layer that changed.

### Backlog mapping rules

When an accepted bug becomes tracked work:

- prefer the smallest backlog unit that truthfully owns the fix
- preserve the issue link and reproduction evidence inside the backlog item text
  or adjacent design note
- treat parsing, ingestion, masking, linking, and rendering bugs as potentially
  class-wide until evidence narrows scope
- use backlog priority to reflect impact; release-gate or primary user-story
  regressions should be treated as higher priority than cosmetic drift

### Closure rules

A bug is only considered fixed when all of the following are true:

- the original symptom is reproducible from recorded evidence
- the root-cause change has landed
- targeted regression proof exists at the layer that changed
- if the bug looked class-wide, at least one broader representative check also
  passes
- the issue and backlog state cite the exact command, test, screenshot, or view
  used to verify closure

Results:

- bug intake now has an explicit handoff into pipeline-managed work
- closure is tied to reproduction plus regression proof instead of anecdotal
  disappearance
- the documented flow preserves frozen evidence-first semantics and avoids
  silent data mutation as a debugging strategy

## Phase 7 - Holistic Evaluation

Evaluation date: 2026-03-27.

Environment note: `PIPELINE.md` recommends a fresh agent context for Phase 7.
This environment does not provide a separate evaluator launcher, so the review
below is the best available same-context evaluation and should be treated as the
recorded objective evaluation for this host.

### Dimensions evaluated

- **Boundary evaluation**: passes.
  - The objective adds intake and triage documentation only; it does not change
    the canonical model, storage semantics, or source-specific derivation rules.
  - Evidence preservation remains explicit and aligns with the frozen semantics
    around raw evidence, `UserTurn`, and projection explainability.

- **Stability assessment**: passes.
  - The canonical bug report contract now appears in the guide, markdown
    template, and repository issue form without field drift.
  - Triage and closure rules are now explicit instead of depending on tacit
    maintainer memory.

- **Scalability evaluation**: passes for objective scope.
  - The new intake process scales by reusing existing CLI, probe, API, and web
    inspection paths instead of asking reporters for arbitrary dumps.
  - The backlog mapping rule prefers the smallest truthful work unit, which
    keeps bug intake from inflating objective scope unnecessarily.

- **Compatibility assessment**: passes.
  - The tracker-agnostic contract remains usable outside GitHub because the same
    fields exist in `docs/templates/bug-report.md`.
  - No runtime, schema, or startup behavior changed.

- **Security evaluation**: passes.
  - The process encourages minimal proving evidence rather than broad log
    uploads.
  - No new network surface, secret handling rule, or service lifecycle behavior
    was introduced.

- **Maintainability assessment**: passes.
  - The canonical contract now has one obvious repository-local reference set.
  - Future tracker-specific automation can project from the same contract
    instead of redefining fields from scratch.

### Issues found

- **Medium, accepted**: a true fresh-context evaluator was not available in this
  harness.
- **Low, accepted**: issue-form behavior is repository-host specific, so the
  markdown template remains the canonical fallback outside GitHub-backed intake.

### Issues resolved during evaluation

- The initial placeholder contact-link configuration was removed so repository
  issue intake no longer points to an unrelated external URL.

### Accepted known limitations

- Priority and severity assignment still rely on maintainer judgment; this
  objective does not add automated labels or routing.
- Triage remains documentation-driven; no issue-to-backlog automation bot was
  introduced.

### Conclusion

Objective `R9` passes Phase 7 for the current repository-visible scope and can
be marked `done` in `BACKLOG.md`.
