# The Seven Phases

Every non-trivial objective passes through seven phases. Not every phase
requires the same depth for every objective. Adjust phase depth to match the
complexity and risk of the work.

## Phase 1: Domain Understanding

**Purpose**: ensure the agent understands the problem before making decisions.

**Entry**: an objective or KR has been assigned.

**Exit**: a written domain summary exists that another agent could continue from.

Minimum tasks:

1. Read and summarize relevant existing documentation and code.
2. Identify unknowns and required research.
3. Map affected code paths and contracts across packages.
4. Produce a written summary: what was learned, what assumptions were made,
   what remains uncertain, how this relates to existing system semantics.

**Escalation**: if understanding reveals the need to change the design freeze,
stop and consult the user.

## Phase 2: Test Data Preparation

**Purpose**: ensure realistic test data exists before implementation begins.

**Entry**: Phase 1 is complete.

**Exit**: fixture data exists and passes validation.

Minimum tasks:

1. Identify needed fixture scenarios (happy path, edge cases, errors, scale).
2. Create or adapt anonymized fixture data following existing project patterns.
3. Place fixtures in the project's test data directory.
4. Validate fixtures with the project's validation command.

Minimum scenarios for a new feature:

- Minimal happy-path case.
- Multi-step or complex case.
- Edge case with unusual or boundary inputs.
- Malformed or partial input (error handling).
- Scale-representative case (enough data to exercise realistic behavior).

## Phase 3: Functional Design

**Purpose**: make design decisions explicit and documented before coding.

**Entry**: Phases 1 and 2 are complete.

**Exit**: a design document exists with approach, trade-offs, and acceptance
criteria.

Design document format:

- Problem statement (one paragraph).
- Decided approach (concrete, not abstract).
- Trade-offs considered and rejected alternatives.
- Acceptance criteria (verifiable by running commands or inspecting artifacts).
- Impact on existing system (packages, tests, APIs affected).

For non-trivial decisions, use the multi-perspective design protocol:

1. Evaluate from system consistency lens.
2. Evaluate from user experience lens.
3. Evaluate from engineering cost lens.
4. Synthesize: agree where proposals align, escalate where they disagree.

## Phase 4: Test Case Design (TDD Entry)

**Purpose**: define verification BEFORE implementation. Tests encode
requirements, not implementation details.

**Entry**: Phase 3 is complete with accepted design and acceptance criteria.

**Exit**: test cases exist, can be run, and FAIL (the feature does not exist
yet).

Minimum tasks:

1. For each acceptance criterion, write at least one test case.
2. Tests must be behavioral:
   - Good: "creating a new item makes it appear in the list API"
   - Bad: "parseRecord returns an object with type='message'"
3. Cover: happy path, edge cases from Phase 1, error handling, regression
   guards.
4. Write tests in the project's test framework following existing patterns.
5. Run tests to confirm they fail.

Test naming convention:

```
"[feature] [scenario] [expected outcome]"
```

## Phase 5: Implementation

**Purpose**: write code that makes failing tests pass while preserving all
existing tests.

**Entry**: Phase 4 tests exist and fail.

**Exit**: all new tests pass, all existing tests still pass, code compiles.

Minimum tasks:

1. Implement the minimum code to make tests pass.
2. Follow existing code patterns and conventions (see AGENTS.md).
3. Build affected packages.
4. Run affected package tests.
5. Run adjacent package tests to verify no regressions.

Implementation rules:

- Follow the project's coding conventions exactly.
- No new patterns when existing ones suffice.
- No shortcuts that bypass the project's architecture.

## Phase 6: Testing and Regression

**Purpose**: verify the implementation satisfies the objective, not just
individual test cases.

**Entry**: Phase 5 is complete, all affected tests pass.

**Exit**: full test suite passes, all acceptance criteria verified end-to-end.

Minimum tasks:

1. Run the full test suite for all affected packages.
2. Run build/lint if any shared contracts or APIs changed.
3. Cross-reference each acceptance criterion against test results.
4. If any criterion is not covered by passing tests, return to Phase 4.

Regression checklist:

- All affected package builds succeed.
- All package tests pass.
- Lint passes with zero warnings.
- No regressions in adjacent packages.
- No forbidden patterns introduced (check AGENTS.md).
- Test data validates if changed.

## Phase 7: Holistic Evaluation

**Purpose**: step outside implementation context and evaluate the change from
system-level perspectives.

**Entry**: Phase 6 regression is clean.

**Exit**: evaluation report exists, issues are resolved or documented as
accepted limitations.

This phase should ideally be executed by a fresh context to avoid
implementation bias.

Evaluation dimensions:

1. **Boundary**: does the change stay within its intended scope?
2. **Stability**: could this break under untested conditions?
3. **Scalability**: does this perform at the operational envelope?
4. **Compatibility**: does this break existing stored data or APIs?
5. **Security**: are new input vectors sanitized?
6. **Maintainability**: can a new contributor understand this change?

If issues are found, return to Phase 4 or 5, then re-run Phases 6 and 7.

# Task Decomposition Standard

## What Makes A Task Ready

A task is ready when it meets all five criteria:

1. **Singular**: it does one thing.
2. **Verifiable**: has a concrete acceptance criterion checkable by command.
3. **Bounded**: completable in one agent session.
4. **Independent**: dependencies are resolved.
5. **Traceable**: maps to KR -> objective -> design freeze.

## Decomposition Process

1. Start with objective's acceptance criteria from Phase 3.
2. For each criterion: "what is the minimum set of changes to make this
   verifiable?"
3. Each answer becomes a task.
4. For each task: "can this be done in one session?" If not, split.
5. Order by dependency.
6. Assign priorities from the objective's priority.

## Granularity Guidelines

| Type | Granularity | Example |
|---|---|---|
| Research | one topic | "analyze X's storage structure" |
| Fixture | one scenario set | "create anonymized multi-turn fixture" |
| Design | one decision | "design caching strategy for Y" |
| Test | one acceptance criterion | "write test: creating X returns it via API" |
| Implementation | one coherent change | "implement X parser for format Y" |
| Evaluation | one dimension | "evaluate X boundary compliance" |

# Completion Evaluation

## Task Completion

1. Acceptance criterion is met (verified by command).
2. No regressions introduced.
3. Status updated in BACKLOG.md.

## KR Completion

1. All tasks complete.
2. KR acceptance criterion independently verified.
3. Cross-task integration verified if applicable.

## Objective Completion

1. All KRs complete.
2. Phase 7 evaluation executed and passed.
3. Overall acceptance criteria verified.
4. Status updated in BACKLOG.md.
5. Affected documentation updated.
