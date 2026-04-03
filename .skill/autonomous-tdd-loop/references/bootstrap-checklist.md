# Bootstrap Checklist

Use this checklist when adopting the autonomous TDD loop on a new project.

## Prerequisites

- [ ] A code repository exists (new or existing).
- [ ] The user has a clear idea of what the product should do.
- [ ] The user can describe at least one concrete objective.

## Step 1: Create DESIGN_FREEZE.md

- [ ] Use `references/design-freeze-template.md` as a starting point.
- [ ] Fill in with the user -- do not generate autonomously.
- [ ] Sections to complete: essence, philosophy, domain objects, invariants,
      pipeline, operational envelope, MVP boundaries, complexity budget.
- [ ] Review with the user and freeze.

## Step 2: Create AGENTS.md

- [ ] Survey the repository structure.
- [ ] Document all directories and their purpose.
- [ ] Record every build, test, lint, and dev command.
- [ ] Identify coding conventions from existing code.
- [ ] Document safety rules and environment constraints.
- [ ] Use `references/agents-template.md` as a starting point.

## Step 3: Create PIPELINE.md

- [ ] Copy the seven-phase structure from `references/pipeline-phases.md`.
- [ ] Customize phase depth for the project's complexity.
- [ ] Define the entry decision tree for the "continue" loop.
- [ ] Set project-specific escalation triggers.
- [ ] Define the task decomposition granularity.

## Step 4: Create BACKLOG.md

- [ ] Add a header explaining that this is the living work surface.
- [ ] Create 1-3 `proposed` objectives from the user's initial goals.
- [ ] Do not decompose yet -- that happens in the first loop iteration.

## Step 5: First "Continue"

- [ ] The agent reads BACKLOG.md.
- [ ] Picks the highest-priority `proposed` objective.
- [ ] Begins decomposition (Phases 1-3).
- [ ] Creates KRs and tasks.
- [ ] Updates the backlog.
- [ ] Reports to the user and stops.

## Step 6: Iterate

- [ ] User reviews the decomposition.
- [ ] User says "continue".
- [ ] Agent picks the next ready task and executes through the pipeline.
- [ ] Repeat until the objective is done.

## Maintenance

- DESIGN_FREEZE.md: rarely changes. Only with explicit user approval.
- AGENTS.md: evolves as the project grows. Update when new commands, packages,
  or conventions are introduced.
- PIPELINE.md: stable once set up. Adjust if the team's process changes.
- BACKLOG.md: updated every session. This is the heartbeat of the loop.
