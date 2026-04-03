# [Project Name] Repository Guidelines

## Source Of Truth

`DESIGN_FREEZE.md` is the authoritative definition of product scope and
architecture. Read it before changing docs, code, or data models.

## Repository Structure

[Describe what each top-level directory contains and its role.]

- `src/` or `apps/`: [description]
- `packages/` or `libs/`: [description]
- `tests/` or `__tests__/`: [description]
- `docs/`: [description]
- `scripts/`: [description]
- `mock_data/` or `fixtures/`: [description]

## Build, Test, and Development Commands

[List exact commands. Prefer package-scoped commands over workspace-wide ones.]

- `[build command]`: [what it validates]
- `[test command]`: [what it tests]
- `[lint command]`: [what it checks]
- `[dev command]`: [how to run locally]

## Coding Conventions

[Document conventions visible in the existing code.]

- Language and version: [e.g., TypeScript 5.x, Python 3.11]
- Style: [e.g., no semicolons, 2-space indent, double quotes]
- Naming: [e.g., camelCase for variables, PascalCase for types]
- Imports: [e.g., absolute imports, barrel exports]
- Forbidden patterns: [e.g., no `any` types, no `console.log` in library code]
- Domain terms: reuse terms exactly as defined in DESIGN_FREEZE.md.

## Safety Rules

[Document what the agent must not do.]

- Do not delete [important directories or files].
- Do not run [dangerous commands] without user approval.
- Do not modify DESIGN_FREEZE.md without user approval.
- Do not commit secrets, credentials, or sensitive data.
- Do not start long-lived services from the agent environment (if applicable).

## Environment Constraints

[Document host-specific limitations.]

- Memory: [e.g., 4 GB RAM, avoid parallel builds]
- Dependencies: [e.g., prefer scoped installs]
- Services: [e.g., no Docker required, SQLite only]

## Testing Guidelines

- Test the layer you actually changed.
- Prefer behavioral tests over implementation-detail tests.
- Run adjacent package tests to verify no regressions.

## Document Hierarchy

| Document | Purpose | Authority |
|---|---|---|
| DESIGN_FREEZE.md | Product definition and invariants | Highest -- all work traces to it |
| AGENTS.md | Operational conventions | Governs how agents interact with code |
| PIPELINE.md | Execution workflow | Governs how work flows |
| BACKLOG.md | Work tracking | Living surface, updated per session |
