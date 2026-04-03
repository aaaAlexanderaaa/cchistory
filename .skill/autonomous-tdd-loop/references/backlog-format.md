# Backlog Format and Rules

## Structure

The backlog uses a three-level hierarchy:

```
Objective (strategic goal)
  └── KR (key result, measurable milestone)
       └── Task (smallest executable unit of work)
```

## Objective Format

```markdown
## Objective: [ID] [Title]
Status: proposed | decomposing | active | verifying | done
Priority: P0 | P1 | P2 | P3
Source: where this objective came from (roadmap, user request, bug report, etc.)

[One-paragraph description of what this objective achieves and why it matters.]
```

Objective lifecycle:

```
proposed -> decomposing -> active -> verifying -> done
```

- `proposed`: directional intent, no KRs yet.
- `decomposing`: agent is running Phases 1-3 to produce KRs and tasks.
- `active`: KRs and tasks exist, work is being executed.
- `verifying`: all tasks done, running Phase 7 holistic evaluation.
- `done`: all acceptance criteria verified and evaluation passed.

## KR Format

```markdown
### KR: [ID] [Title]
Status: open | active | done
Acceptance: [one-sentence verifiable criterion]
```

A KR is a measurable milestone within an objective. Its acceptance criterion
must be independently verifiable -- not just "all tasks done" but the criterion
itself is checked.

## Task Format

```markdown
- [ ] Task: [description]
  Status: pending | ready | in_progress | blocked | done
  Acceptance: [how to verify -- a command to run or artifact to inspect]
  Artifact: [file path or command that proves completion]
```

Task states:

- `pending`: known but not yet executable (unmet dependencies, unresolved
  design decision).
- `ready`: all dependencies resolved, can be picked up.
- `in_progress`: currently being worked on (max one per agent session).
- `blocked`: cannot proceed, blocker must be stated.
- `done`: acceptance criterion verified.

## Completed Section

When an objective reaches `done`, move it to the bottom of the file under:

```markdown
## Completed
```

Preserve the full objective/KR/task structure for historical reference. Do not
delete completed work.

## Rules

1. BACKLOG.md is the single source of truth for current work.
2. Only one task may be `in_progress` per agent session.
3. Task status is updated in real time as work progresses.
4. New objectives are added at the bottom of the active section.
5. The agent must read BACKLOG.md at the start of every session.
6. Decomposition work (Phases 1-3) is itself tracked as tasks.
7. Findings from KR review sweeps are added to BACKLOG.md before implementing.
8. A task is not marked `done` until its acceptance criterion is verified by
   running the specified command or inspecting the specified artifact.

## ID Conventions

Use short, stable prefixes:

- Objectives: `R1`, `R2`, ... (for roadmap items) or `B1`, `B2`, ... (for
  bugs/improvements) or any scheme that fits the project.
- KRs: `R1-KR1`, `R1-KR2`, ...
- Tasks do not need IDs; they are identified by their parent KR and description.

## Priority Levels

- **P0**: blocks release or breaks a system invariant. Must be addressed
  immediately.
- **P1**: important for the current milestone. Should be addressed in the
  current work cycle.
- **P2**: valuable but not urgent. Can wait for the next cycle.
- **P3**: nice to have. Address when higher priorities are clear.

## Example

```markdown
## Objective: R1 - User Authentication System
Status: active
Priority: P0
Source: ROADMAP.md

Implement the core authentication system including registration, login, and
session management.

### KR: R1-KR1 Registration flow works end-to-end
Status: active
Acceptance: a new user can register via the API and the account appears in the
database with hashed credentials.

- [x] Task: design registration API contract
  Status: done
  Acceptance: design doc exists at docs/design/R1_AUTH.md with endpoint spec
  Artifact: docs/design/R1_AUTH.md

- [x] Task: write failing registration tests
  Status: done
  Acceptance: tests exist and fail when run
  Artifact: pnpm --filter @app/api test

- [ ] Task: implement registration endpoint
  Status: ready
  Acceptance: all registration tests pass
  Artifact: pnpm --filter @app/api test

### KR: R1-KR2 Login flow works end-to-end
Status: open
Acceptance: a registered user can log in and receive a valid session token.

- [ ] Task: write failing login tests
  Status: pending
  Acceptance: tests exist and fail
  Artifact: pnpm --filter @app/api test
```
