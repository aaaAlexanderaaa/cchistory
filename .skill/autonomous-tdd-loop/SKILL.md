---
name: autonomous-tdd-loop
description: >
  Autonomous TDD-driven development loop for complex projects. Use when a project
  needs structured long-term automated development where an AI agent can "continue"
  through a loop to discover, decompose, implement, test, and verify work autonomously.
  Activate when the user says "continue", "next task", "keep going", or starts a new
  session without a specific instruction on any project that has adopted this methodology.
  Also use when the user wants to bootstrap this methodology onto a new or existing project.
---

# Autonomous TDD Development Loop

This skill defines a methodology for AI-agent-driven, TDD-first autonomous
development of complex software projects. It enables a workflow where the user
defines high-level objectives and the agent loops through structured phases to
deliver them incrementally, one "continue" at a time.

## Core Idea

The methodology separates concerns into four layers, each owned by one
document. Together they form a closed loop: the user defines intent, the agent
discovers work, executes it through a TDD pipeline, updates tracking, and waits.
The user says "continue" and the loop repeats.

```
┌─────────────────────────────────────────────────────────┐
│                    User says "continue"                  │
│                           │                             │
│                           ▼                             │
│                  ┌─────────────────┐                    │
│                  │  Read BACKLOG   │                    │
│                  └────────┬────────┘                    │
│                           │                             │
│              ┌────────────▼─────────────┐               │
│              │  Decision Tree (PIPELINE) │               │
│              └────────────┬─────────────┘               │
│                           │                             │
│         ┌─────────────────▼──────────────────┐          │
│         │  Execute next task through phases   │          │
│         │  (constrained by DESIGN_FREEZE      │          │
│         │   and AGENTS guidelines)            │          │
│         └─────────────────┬──────────────────┘          │
│                           │                             │
│                  ┌────────▼────────┐                    │
│                  │ Update BACKLOG  │                    │
│                  └────────┬────────┘                    │
│                           │                             │
│                  Report to user, stop.                  │
│                  Wait for next "continue".              │
└─────────────────────────────────────────────────────────┘
```

## The Four Documents

Every project that adopts this methodology maintains four documents at the
repository root. Each document owns one concern and must not duplicate the
others.

| Document | Owns | Analogy |
|---|---|---|
| `DESIGN_FREEZE.md` | What to build, invariants, boundaries | Constitution |
| `AGENTS.md` | How agents interact with this codebase | Employee handbook |
| `PIPELINE.md` | How work flows from discovery to delivery | Standard operating procedure |
| `BACKLOG.md` | What work exists and its current state | Kanban board |

### 1. DESIGN_FREEZE.md -- The Constraint Layer

This is the authoritative, frozen definition of the product. It answers "what
are we building and what must never change?"

It must contain:

- **Product essence**: one-paragraph definition of the core value.
- **Design philosophy**: principles that guide all decisions.
- **Core domain objects**: the canonical data model with stable terms.
- **System invariants**: properties that must always hold, no matter what.
- **Canonical pipeline**: how data or work flows through the system.
- **Operational envelope**: scale assumptions, deployment model, user model.
- **MVP boundaries**: what is in scope and what is explicitly excluded.
- **Complexity budget**: what complexity is allowed now vs deferred.

Rules:

- All work must be traceable to this document.
- If a task would require changing this document, the agent must stop and
  consult the user.
- New features extend the system within frozen boundaries; they do not redefine
  the product.
- When any other document conflicts with the design freeze, the freeze wins.

See `references/design-freeze-template.md` for a starter template.

### 2. AGENTS.md -- The Convention Layer

This is the operational handbook for agents working in this repository. It
answers "how do I interact with this codebase?"

It must contain:

- **Repository structure**: what each directory contains and its role.
- **Build, test, and lint commands**: exact commands, scoped to packages where
  possible.
- **Coding conventions**: style, naming, import patterns, forbidden patterns.
- **Safety rules**: what not to delete, what not to run, what needs user
  approval.
- **Document hierarchy**: which documents are authoritative for what.
- **Environment constraints**: memory limits, tool availability, service
  management rules.

Rules:

- The agent must read AGENTS.md before making any code change.
- AGENTS.md is project-specific and may evolve as the project grows.
- It must not duplicate design decisions (those belong in DESIGN_FREEZE.md) or
  workflow process (those belong in PIPELINE.md).

### 3. PIPELINE.md -- The Process Layer

This defines the TDD-first execution workflow. It answers "how does work flow
from idea to verified delivery?"

It must define:

- **Entry decision tree**: how an agent discovers what to do next when it
  starts a session with no specific instruction.
- **Objective lifecycle**: `proposed -> decomposing -> active -> verifying -> done`.
- **The seven phases** (see `references/pipeline-phases.md` for full detail):
  1. Domain Understanding
  2. Test Data Preparation
  3. Functional Design
  4. Test Case Design (TDD: write failing tests first)
  5. Implementation (make tests pass)
  6. Testing and Regression
  7. Holistic Evaluation
- **Task decomposition standard**: what makes a task ready for execution.
- **Completion evaluation**: when a task, KR, objective, or release gate is
  truly done.
- **Agent decision points**: when to proceed autonomously vs when to stop and
  ask the user.

The TDD core principle: tests are written in Phase 4 and must fail. Code is
written in Phase 5 to make them pass. This order is never reversed.

### 4. BACKLOG.md -- The Work Surface

This is the living tracking document. It answers "what work exists and what is
its state?"

Structure:

```markdown
## Objective: [ID] [Title]
Status: proposed | decomposing | active | verifying | done
Priority: P0 | P1 | P2 | P3
Source: where this objective came from

### KR: [ID] [Title]
Status: open | active | done
Acceptance: one-sentence verifiable criterion

- [ ] Task: [description]
  Status: pending | ready | in_progress | blocked | done
  Acceptance: how to verify
  Artifact: file or command that proves completion
```

Rules:

- The agent reads BACKLOG.md at the start of every session.
- Only one task may be `in_progress` per agent session.
- Task status is updated in real time.
- Completed objectives move to a `## Completed` section at the bottom.
- New findings from review sweeps are recorded here before implementation.

## The "Continue" Loop

When the user says "continue" (or starts a session without a specific task),
the agent executes this decision tree:

1. Read `BACKLOG.md`.
2. If tasks are `in_progress` or `blocked` -- resume or unblock them.
3. If tasks are `ready` -- pick the highest-priority one and execute.
4. If no task is executable but open KRs exist -- run a KR review sweep to
   discover missing tasks.
5. If all tasks under a KR are done -- verify the KR acceptance criterion.
6. If all KRs under an objective are done -- run Phase 7 holistic evaluation.
7. If undecomposed objectives exist -- decompose them (Phases 1-3).
8. If all objectives are done -- check for new priorities or report completion.

The agent completes one meaningful unit of work per "continue", updates the
backlog, and stops. This gives the user a natural checkpoint to review, adjust
priorities, or change direction.

## Bootstrapping This Methodology

To adopt this methodology on a new or existing project:

### Step 1: Create DESIGN_FREEZE.md

Use the template in `references/design-freeze-template.md`. Fill in:

- What is the product?
- What are the invariants that must never break?
- What domain objects exist?
- What is in scope for MVP and what is deferred?

This document should be written with the user, not generated autonomously.
Once frozen, it rarely changes.

### Step 2: Create AGENTS.md

Survey the repository and document:

- Directory structure and purpose of each area.
- All build, test, lint, and dev commands.
- Coding conventions visible in the existing code.
- Safety constraints specific to this environment.

This document evolves as the project grows. The agent should update it when
new commands, packages, or conventions are introduced.

### Step 3: Create PIPELINE.md

Copy the seven-phase structure from `references/pipeline-phases.md` and
customize:

- Adjust phase depth for the project's complexity.
- Define project-specific escalation triggers.
- Set the task decomposition granularity that fits the team.

### Step 4: Create BACKLOG.md

Start with a few `proposed` objectives derived from the project's goals or
roadmap. The agent will decompose them through the pipeline.

### Step 5: Loop

The user says "continue". The agent reads the backlog, finds work, executes
it through the pipeline, updates tracking, and reports. Repeat.

## Key Principles

### TDD Is Not Optional

Every non-trivial feature must go through:

1. Write acceptance criteria (Phase 3).
2. Write failing tests that encode those criteria (Phase 4).
3. Write code to make the tests pass (Phase 5).
4. Verify no regressions (Phase 6).

This order ensures that tests define behavior, not the other way around.

### Design Freeze Prevents Drift

Without a frozen design document, autonomous agents will gradually redefine the
product through incremental scope creep. The design freeze is the single most
important document because it tells the agent what NOT to do.

### Small Tasks, Verifiable Completion

Every task must be:

- **Singular**: does one thing.
- **Verifiable**: has a concrete acceptance criterion checkable by running a
  command.
- **Bounded**: completable in one agent session.
- **Independent**: dependencies are resolved.
- **Traceable**: maps back to a KR -> objective -> design freeze.

### The Agent Must Know When To Stop

The pipeline defines explicit decision points where the agent must stop and
consult the user:

- Any change to DESIGN_FREEZE.md.
- Unresolved design disagreements.
- Tasks requiring user action (running services, providing data).
- Security concerns.
- Scope that exceeds the operational envelope.

### Evidence Over Claims

- Work is not "done" because the agent says so. It is done because a command
  passes or an artifact exists.
- Acceptance criteria are verified, not assumed.
- Backlog status reflects reality, not intent.

## Multi-Perspective Design Protocol

For non-trivial design decisions, launch independent evaluation from at least
three lenses:

1. **System Consistency**: does this preserve invariants and reuse patterns?
2. **User Experience**: how does the user encounter and recover from this?
3. **Engineering Cost**: what is the simplest approach? What debt does it create?

Synthesize the perspectives. Where they agree, proceed. Where they disagree on
invariants or UX fundamentals, stop and consult the user.

## KR Review Sweep

When the backlog stalls (no ready tasks but open work exists), run a
project-wide review sweep:

1. Does the current implementation satisfy what the user actually cares about?
2. Are outputs usable at realistic scale?
3. Are there obvious edge cases not accounted for?
4. Is regression coverage missing for implicitly depended-on behavior?
5. Does the feature need better UX, warnings, or error handling?

Record findings in BACKLOG.md before implementing fixes.
