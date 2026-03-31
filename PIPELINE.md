# Agent Execution Pipeline

This document defines the operational workflow for executing work in the
CCHistory project. It bridges the gap between the design vision
(`HIGH_LEVEL_DESIGN_FREEZE.md`), the quality bar
(`docs/design/SELF_HOST_V1_RELEASE_GATE.md`), and the actual work that needs to
happen.

It answers four questions that other project documents do not:

1. How does an agent discover what to do next?
2. How does an agent break an objective into executable tasks?
3. How does an agent know when a task or objective is complete?
4. How does an agent handle design decisions that require independent evaluation?

## Relationship To Other Documents

| Document | Defines | Relationship to this pipeline |
| --- | --- | --- |
| `HIGH_LEVEL_DESIGN_FREEZE.md` | what to build and what invariants to preserve | all work must be traceable to frozen semantics |
| `docs/design/SELF_HOST_V1_RELEASE_GATE.md` | quality bar for v1 release | the current P0 exit criteria |
| `docs/ROADMAP.md` | directional priorities | source of objectives to decompose |
| `BACKLOG.md` | living work surface | where decomposed objectives, KRs, and tasks live |
| `AGENTS.md` | repository interaction rules and build commands | constrains how pipeline phases execute |
| `tasks.csv` | historical KR ledger | reference only; not the active backlog |

## How An Agent Enters The Pipeline

When an agent starts a session without a specific user instruction, it must
follow this decision tree:

1. Read `BACKLOG.md`.
2. If there are tasks with status `in_progress` or `blocked`:
   - Resume the highest-priority in-progress task.
   - If blocked, diagnose the blocker and either resolve it or escalate to the
     user.
3. If there are tasks with status `ready`:
   - Pick the highest-priority ready task and begin execution at the
     appropriate phase.
4. If there are active or open KRs/objectives but no task is currently
   executable (for example, all known tasks are `pending`, blocked by unmet
   dependencies, or the KR has no task that truthfully covers the remaining
   acceptance gap):
   - Run a project-wide KR review sweep instead of repeatedly reviewing only
     the currently blocked or pending task.
   - Choose the highest-priority active/open KR, objective, or roadmap-owned
     gap whose remaining user-facing goal is not yet covered by a truthful
     executable task.
   - Review that scope against its user-facing goal, edge cases, operator
     workflow, output quality, scale behavior, and missing regression coverage.
   - Convert the findings into backlog work before implementing anything:
     add `ready` or `pending` tasks when the gap fits the current KR, add a new
     KR when the gap is broader than one task, or add a new objective when no
     current objective owns the problem.
5. If all tasks under a KR are `done` but the KR itself is still `open`:
   - Verify the KR acceptance criterion. If it passes, mark the KR `done`. If
     it fails, create new tasks to close the gap.
6. If all KRs under an objective are `done` but the objective is still `open`:
   - Execute Phase 7 (Holistic Evaluation) for the objective. If it passes,
     mark the objective `done`. If it fails, create corrective KRs.
7. If all tasks are `done` and all KRs are `done` but there are objectives with
   status `proposed` or `decomposing`:
   - Pick the highest-priority undecomposed objective and begin the
     decomposition process (Phases 1 through 3).
8. If all objectives are `done`:
   - Check `docs/ROADMAP.md` for new directional priorities not yet in the
     backlog. If new priorities exist, create `proposed` objectives in
     `BACKLOG.md` and begin decomposition.
   - If no new priorities exist, run the release gate verification. If any gate
     fails, create objectives for the failures.
   - If all gates pass, report project completion status to the user.
9. If none of the above yields work:
   - Report to the user that all known work is complete and ask for direction.

## Objective Lifecycle

An objective moves through these states:

```
proposed -> decomposing -> active -> verifying -> done
```

- `proposed`: directional intent from the roadmap, release gate, or user
  request. No KRs yet.
- `decomposing`: agent is executing Phases 1-3 to produce KRs, acceptance
  criteria, and task breakdowns.
- `active`: KRs and tasks exist and work is being executed.
- `verifying`: all tasks done; running Phase 7 holistic evaluation.
- `done`: all acceptance criteria verified and evaluation passed.

## Cross-Cutting Execution Constraints

### Temporary Utilities And Command Surface

Operational convenience for the current task is not enough justification to
expand the repository-wide command surface.

- Do not add repository-wide `pnpm` scripts, CLI commands, or other user-facing
  entrypoints solely to satisfy one KR, one objective, or one temporary
  investigation.
- Before adding any new script or command, evaluate whether the operation is
  likely to be reused across future tasks, sources, hosts, or operator flows.
- If the operation is reusable, implement one stable command surface and express
  task-specific variation through flags, arguments, manifests, or input files.
  Collection is one operator workflow; do not split it into KR-specific or
  objective-specific command names when parameters can carry the difference.
- If the operation is not reusable, keep it task-scoped rather than promoting
  it into the global repository interface. A temporary helper may exist as a
  narrowly scoped script artifact or documented invocation, but it should not
  become a permanent top-level command unless it graduates into a general
  workflow.
- KR IDs, objective IDs, and other backlog-specific labels must not leak into
  canonical operator command names unless those IDs are themselves part of the
  product surface.

## The Seven Phases

Every non-trivial objective passes through seven phases. Not every phase
requires the same depth for every objective. The pipeline specifies minimum
requirements per phase and escalation triggers for when deeper work is needed.

### Phase 1: Domain Understanding

**Purpose**: ensure the agent understands the problem domain, the data
structures involved, and the existing system context before making any design or
implementation decisions.

**Entry condition**: an objective or KR has been assigned.

**Exit condition**: a domain understanding document exists (as a section in
`docs/design/` or as a research note referenced from the backlog) that another
agent could read and continue from.

**Minimum executable tasks**:

1. Read and summarize relevant existing documentation (design freeze sections,
   source docs in `docs/sources/`, existing adapter code if applicable).
2. Identify what is unknown and what research is needed.
3. For source adapter work: locate and analyze real source data structures,
   storage formats, file layouts, and companion or sidecar files whose contents
   affect derived session, turn, or project metadata. Record which artifacts are
   transcript-bearing, which are evidence-only companions, and which must enter
   capture scope. If local data samples are needed but unavailable, prefer
   extending an existing generic collection path or produce a one-click
   collection script for the user to run, then pause and ask the user to
   execute it. Do not introduce KR-specific or objective-specific top-level
   collection commands when a shared command plus parameters, manifest input, or
   scoped helper script can satisfy the need.
4. For system-level work: map affected code paths and contracts across packages.
5. Produce a written summary that captures: what was learned, what assumptions
   were made, what remains uncertain, and how this relates to existing system
   semantics.

**Escalation trigger**: if domain understanding reveals that the objective may
require changes to `HIGH_LEVEL_DESIGN_FREEZE.md`, stop and report to the user
before proceeding.

### Phase 2: Test Data Preparation

**Purpose**: ensure realistic, anonymized test data exists before any
implementation begins.

**Entry condition**: Phase 1 is complete.

**Exit condition**: anonymized fixture data exists in `mock_data/` and passes
`pnpm run mock-data:validate`.

**Minimum executable tasks**:

1. Identify what fixture scenarios are needed (happy path, edge cases, error
   cases, scale-representative cases).
2. If real data samples exist, create anonymization scripts that strip all PII,
   secrets, file paths, and project-specific content while preserving structural
   fidelity.
3. Place anonymized fixtures in `mock_data/{platform}/` following existing
   conventions.
4. Validate with `pnpm run mock-data:validate`.
5. Document fixture scenarios and their coverage intent.

**Minimum fixture scenarios for a new source platform**:

- Minimal single-turn session.
- Multi-turn session with assistant and tool context.
- Session with tool usage and project/workspace signals.
- Malformed or partial data (truncated JSON, missing fields, unknown item
  kinds).
- Scale-representative session (enough turns to exercise pagination or display
  density).

### Phase 3: Functional Design

**Purpose**: make design decisions explicit, evaluated from multiple
perspectives, and documented before implementation.

**Entry condition**: Phases 1 and 2 are complete.

**Exit condition**: a design document exists with decided approach, trade-off
analysis, and acceptance criteria.

**This is the phase where AI limitations are most dangerous.** A single agent in
a single context cannot reliably evaluate its own design from multiple
perspectives. The following multi-perspective protocol is mandatory for
non-trivial design decisions.

#### Multi-Perspective Design Protocol

Required for objectives that involve trade-offs, new semantics, or system-level
changes. May be skipped for simple, well-scoped changes (e.g., adding a field,
fixing a parser edge case).

1. Launch at least three independent sub-agents simultaneously, each given the
   same domain understanding document from Phase 1 and the same fixture data
   from Phase 2, but each assigned a different evaluation lens:

   - **Agent A (System Consistency)**: evaluate from the perspective of
     consistency with existing system semantics and the design freeze. Does the
     proposed approach preserve frozen invariants? Does it reuse existing
     patterns or introduce new ones?
   - **Agent B (User Experience)**: evaluate from the perspective of the end
     user. How does the user encounter this feature? What expectations does the
     user have? What happens when something goes wrong?
   - **Agent C (Engineering Cost)**: evaluate from the perspective of
     implementation cost, maintenance burden, and future extensibility. What is
     the simplest approach that satisfies requirements? What technical debt does
     each option create?

   Each agent produces a written proposal containing: recommended approach,
   trade-offs identified, risks and mitigations, and impact on the existing
   system.

2. A fourth independent agent (or the orchestrating agent after clearing its
   context) evaluates all three proposals and produces a synthesis document
   that:

   - Identifies where proposals agree (high-confidence decisions).
   - Identifies where proposals disagree (decisions requiring human judgment).
   - Recommends a path forward with explicit reasoning.

3. If disagreements exist on frozen invariants or user experience fundamentals,
   pause and present the synthesis to the user for decision.

#### Design Document Format

Regardless of whether the multi-perspective protocol was used, every design
decision must be documented with:

- Problem statement (one paragraph).
- Decided approach (concrete, not abstract).
- Trade-offs considered and rejected alternatives.
- Acceptance criteria (verifiable by running commands or inspecting outputs).
- Impact on existing system (which packages, which tests, which APIs).

For source-adapter design work, the design document must also state:

- which non-transcript companion artifacts influence derivation
- whether each such artifact enters capture scope as exportable evidence
- which path-identity forms must be regression-covered when the change touches
  shared normalization helpers

### Phase 4: Test Case Design

**Purpose**: define verification before implementation, ensuring tests encode
requirements rather than implementation details.

**Entry condition**: Phase 3 is complete with accepted design and acceptance
criteria.

**Exit condition**: test cases exist, can be run (and fail), and cover all
acceptance criteria from the design.

**Minimum executable tasks**:

1. For each acceptance criterion from Phase 3, write at least one test case.
2. Tests must be behavioral, not implementation-focused:
   - Good: `"syncing a new source creates turns viewable through the API"`
   - Bad: `"parseRecord returns a SourceFragment with type='message'"`
3. Tests must cover: happy path, edge cases identified in Phase 1, error
   handling for malformed input, and regression guards if fixing a bug.
4. Write tests in the appropriate package test file following existing patterns
   (Node.js built-in test runner).
5. Run tests to confirm they fail (the feature does not exist yet).

Additional required cases:

- If companion or sidecar files influence canonical metadata, include a test
  that proves those files are captured or exported as evidence rather than only
  read for derivation.
- If a change touches shared path identity or file-URI normalization, include
  UNC and authority-preserving file-URI coverage whenever the source family can
  emit network-share paths.

**Test naming convention**: test names should read as acceptance criteria.

```
"[feature/platform] [scenario] [expected outcome]"
```

Example: `"openclaw adapter multi-session sync creates committed project from
repeated workspace evidence"`

**Scale tests**: if the objective involves data that could grow large, include at
least one test with 100+ items to verify performance does not degrade.

### Phase 5: Implementation

**Purpose**: write code that makes the failing tests pass while preserving all
existing tests.

**Entry condition**: Phase 4 tests exist and fail.

**Exit condition**: all new tests pass, all existing tests still pass, code
compiles across affected packages.

**Minimum executable tasks**:

1. Implement the minimum code to make tests pass.
2. Follow existing code patterns and conventions (see `AGENTS.md`).
3. Build affected packages: `pnpm --filter <package> build`.
4. Run affected package tests: `pnpm --filter <package> test`.
5. Run adjacent package tests to verify no regressions.
6. If the change affects the web surface, run lint: `cd apps/web && pnpm lint`.

**Implementation rules**:

- Source-specific quirks stop at the parse boundary.
- New types must align with `packages/domain` terminology and the design freeze.
- New API routes must mirror existing patterns in `apps/api/src/app.ts`.
- No `any` types in production code.
- No `console.log` except in CLI and server entrypoints.
- No hardcoded secrets or sensitive data, even in test fixtures.

### Phase 6: Testing And Regression

**Purpose**: verify that the implementation satisfies the objective, not just the
individual test cases.

**Entry condition**: Phase 5 is complete, all affected tests pass.

**Exit condition**: full test suite passes, acceptance criteria verified
end-to-end.

**Minimum executable tasks**:

1. Run the full test suite for all affected packages.
2. Run web build if any DTO, presentation, or API changes were made.
3. If the objective involves a source adapter, run the smoke probe:
   `pnpm run probe:smoke -- --source-id={platform} --limit=1`.
4. Cross-reference each acceptance criterion from Phase 3 against test results.
5. If any acceptance criterion is not covered by passing tests, return to
   Phase 4.

Notes:

- A successful web build does not substitute for `cd apps/web && pnpm lint`.
- If a source adapter derives canonical metadata from a file, that file's
  evidence-preservation path must be part of the regression proof before the
  objective is considered clean.

**Regression checklist**:

- All affected package builds succeed.
- All package tests pass (148+ baseline as of 2026-03-26).
- Web lint passes with zero warnings.
- Web build succeeds (if web-affecting changes were made).
- No new `any` types introduced.
- No secrets or sensitive data in committed code.
- `mock_data` validates if changed.

### Phase 7: Holistic Evaluation

**Purpose**: step outside the implementation context and evaluate the change from
system-level perspectives that implementation-focused testing cannot cover.

**Entry condition**: Phase 6 regression is clean.

**Exit condition**: evaluation report exists, issues found are resolved or
documented as accepted known limitations.

**This phase should be executed by a fresh agent context** to avoid the
implementation bias of the agent that wrote the code.

**Evaluation dimensions**:

1. **Boundary evaluation**: does the change stay within its intended scope? Do
   source-specific details stay behind the parse boundary? Do package
   boundaries remain clean?
2. **Stability assessment**: could this change break under conditions not covered
   by tests (empty data, corrupt data, very large data, concurrent access)?
3. **Scalability evaluation**: does this change perform acceptably at the
   operational envelope from the design freeze (tens of thousands of turns,
   hundreds of thousands of events)?
4. **Compatibility assessment**: does this change break existing stored data?
   Does it require schema migration? Is the migration tested?
5. **Security evaluation**: does this change introduce new input vectors? Are
   they sanitized?
6. **Maintainability assessment**: can a new contributor understand this change?
   Does it follow existing patterns?

**Output**: a brief evaluation report listing dimensions evaluated, issues found
with severity, issues resolved during this phase, and known limitations
accepted.

**If issues are found**: return to Phase 5 or Phase 4 as appropriate, then
re-run Phases 6 and 7.

If a follow-up review later invalidates a previously recorded pass, update the
objective note and `BACKLOG.md` immediately and create corrective work or reopen
the owning objective instead of leaving stale "passed" claims in place.

## Task Decomposition Standard

Every objective must be decomposed into tasks before execution. A task is the
minimum executable unit of work.

### What Makes A Task Ready For Execution

A task is ready when it meets all five criteria:

1. **Singular**: it does one thing.
2. **Verifiable**: it has a concrete acceptance criterion that can be checked by
   running a command or inspecting an artifact.
3. **Bounded**: an agent can complete it in a single session without requiring
   intermediate user input (unless the task explicitly involves user
   interaction such as "generate a script for the user to run").
4. **Independent**: its dependencies are resolved (prerequisite tasks are done).
5. **Traceable**: it maps back to a KR, which maps back to an objective, which
   maps back to the design freeze or roadmap.

Tasks that are known but not yet executable should use `pending`, not `ready`.
Typical reasons include unmet prerequisite tasks, an unresolved design decision
already tracked elsewhere, or waiting for a review sweep to decide the right
scope.

### Decomposition Process

1. Start with the objective's acceptance criteria from Phase 3.
2. For each acceptance criterion, ask: "what is the minimum set of changes
   needed to make this criterion verifiable?"
3. Each answer becomes a task.
4. For each task, ask: "can this be done in one agent session?" If not, split
   further.
5. Order tasks by dependency (which tasks must complete before others can
   start).
6. Assign priorities based on the objective's priority.

### KR Review Sweep

Use a KR review sweep when the backlog still has meaningful open work but no
truthful executable task exists for the next step.

The sweep is project-wide. Start by surveying the whole backlog plus any
roadmap or release-gate priorities not yet represented there, then choose the
highest-priority open KR, objective, or uncovered gap that can truthfully yield
new executable work. Do not keep re-reviewing the same blocked task when the
broader project still has other open work that has not yet been decomposed.

Purpose:

- prevent the project from stalling in a "no ready tasks" state
- reassess whether the current KR decomposition still matches the user-facing
  goal
- surface quality, UX, boundary-case, operator-output, and regression gaps that
  are easy to miss when work is driven only by bug reports

Minimum review lenses:

1. Does the current implementation or plan satisfy what the user actually cares
   about?
2. Are outputs usable and legible at realistic scale?
3. Are there obvious edge cases or extreme-but-likely inputs that were not
   accounted for?
4. Is regression coverage missing for a behavior the KR implicitly depends on?
5. Does the feature need clearer CLI/API/web wording, warnings, truncation
   policy, highlighting, pagination, or drill-down affordances?

Example review questions:

- Should a CLI function or formatter have a dedicated regression test?
- Does a CLI command need an explanatory note or output correction?
- Are there missing edge cases around very large time ranges, result counts, or
  unusually long turn content?
- Does the current design force a poor UX for search snippets, stats windows, or
  truncated content?

Output rule:

- Do not silently fix a non-trivial review finding as an ad hoc bug.
- Record the finding in `BACKLOG.md` first as the smallest truthful unit:
  task, KR, or objective.
- Then execute the new work through the normal pipeline phases.

### Granularity Guidelines

| Task type | Typical granularity | Example |
| --- | --- | --- |
| Research | one topic per task | "analyze OpenClaw session storage structure on Linux hosts" |
| Fixture creation | one scenario set per task | "create anonymized multi-turn OpenClaw fixture with tool usage" |
| Design | one decision per task (use multi-agent for complex decisions) | "design turn-building strategy for high-volume automated sessions" |
| Test writing | one acceptance criterion per task | "write test: openclaw sync creates turns viewable through API" |
| Implementation | one coherent change per task | "implement OpenClaw record extraction from session files" |
| Evaluation | one dimension per task (can parallelize) | "evaluate OpenClaw adapter boundary compliance" |

## Completion Evaluation

### Task Completion

A task is complete when:

1. Its acceptance criterion is met (verified by running the specified command or
   check).
2. No regressions were introduced (relevant test suite passes).
3. The task status is updated in `BACKLOG.md`.

### KR Completion

A KR is complete when:

1. All its tasks are complete.
2. The KR acceptance criterion is independently verified (not just "all tasks
   done" but the criterion itself is checked).
3. Cross-task integration is verified if applicable.

### Objective Completion

An objective is complete when:

1. All its KRs are complete.
2. Phase 7 holistic evaluation has been executed and passed.
3. The objective's overall acceptance criteria are verified.
4. The objective status is updated in `BACKLOG.md`.
5. Any affected documentation is updated (`CURRENT_RUNTIME_SURFACE.md`, source
   docs, etc.).

### Release Gate Completion

The release gate is satisfied when:

1. All objectives mapped to release gate conditions are complete.
2. Each gate condition is independently verifiable by running a command or
   inspecting an artifact.
3. A gate verification pass (manual or scripted) confirms all six conditions.

## Backlog Format

The living backlog lives in `BACKLOG.md` at the repository root. It replaces
`tasks.csv` as the active work surface. `tasks.csv` remains as historical
reference for the 2026-03 local-source slice.

### Structure

```markdown
## Objective: [ID] [Title]
Status: proposed | decomposing | active | verifying | done
Priority: P0 | P1 | P2 | P3
Source: ROADMAP.md | RELEASE_GATE.md | user request | bug report
Gate: [which release gate condition, if applicable]

### KR: [ID] [Title]
Status: open | active | done
Acceptance: [one-sentence verifiable criterion]

- [ ] Task: [description]
  Status: pending | ready | in_progress | blocked | done
  Acceptance: [how to verify]
  Artifact: [file or command that proves completion]
```

### Rules

1. `BACKLOG.md` is the single source of truth for current work.
2. Only one task should be `in_progress` per agent session.
3. Task status is updated in real time as work progresses.
4. New objectives are added at the bottom of the active section.
5. Completed objectives are moved to a `## Completed` section at the bottom of
   the file (not deleted).
6. An agent must read `BACKLOG.md` at the start of every session.
7. Decomposition work (Phases 1-3) is itself tracked as tasks in the backlog
   under the objective being decomposed.
8. Findings from a KR review sweep are added to `BACKLOG.md` before any
   non-trivial corrective implementation begins.

## Agent Decision Points

### Must Stop And Consult The User

1. Any change that would modify `HIGH_LEVEL_DESIGN_FREEZE.md`.
2. Design decisions where the multi-perspective protocol produced unresolved
   disagreements on user experience or frozen invariants.
3. Tasks that require the user to run a script, provide data, or start a
   service.
4. Any situation where the agent cannot determine the next step from existing
   documents.
5. Any security concern discovered during evaluation.
6. Any objective that appears to require capabilities outside the current
   operational envelope (e.g., remote network access, multi-user scenarios).

### May Proceed Autonomously

1. Implementation tasks with clear acceptance criteria and no design ambiguity.
2. Test writing based on accepted design documents.
3. Bug fixes where the root cause is identified and the fix is straightforward.
4. Documentation updates that reflect already-implemented changes.
5. Fixture creation following existing patterns.
6. Task decomposition for objectives where the scope is well understood and does
   not involve trade-offs requiring human judgment.
