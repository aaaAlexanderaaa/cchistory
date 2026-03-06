# CCHistory Implementation Plan (OKR-Driven)

## Scope

This plan implements the target architecture in `docs/ARCHITECTURE.md` using
incremental milestones. The project tracker is `tasks.csv`, where each row is
a measurable Key Result (KR) represented as a concrete implementation task.

## Roadmap Summary

### Phase 1: Foundation and Contracts

- Define canonical schema and API contracts.
- Introduce summary/detail model split.
- Build connector SDK interfaces and config model.
- Lock ID/provenance and backward-compatible API transition rules.

### Phase 2: Ingestion and Index

- Build ingestion orchestrator with cursor-based incremental sync.
- Create index schema and idempotent upsert flow.
- Implement first production connectors (Claude Code, Brave) on SDK.
- Expose source health and ingest run status.

### Phase 3: Retrieval and Product Workflows

- Move list/search to index-backed retrieval.
- Add ranked lexical search and query operators.
- Build Distill workflows and agent-focused Chat2History endpoints.
- Redesign Web UI around Explore/Search/Distill modes.

### Phase 4: Reliability and Scale

- Add connector conformance suite and regression coverage.
- Add performance/load test harness and SLO checks.
- Add observability, data drift checks, and runbook documentation.

## OKR Structure

Objectives are grouped by architecture domains:

1. O1: Canonical Contracts and Compatibility
2. O2: Connector SDK and Ingestion Runtime
3. O3: History Index and Storage Layer
4. O4: Retrieval and Search Quality
5. O5: Distillation and Pattern Intelligence
6. O6: Agent-Facing Chat2History APIs
7. O7: Web UI Product Experience
8. O8: Reliability, QA, and Operations

Each objective is decomposed into measurable KRs. Each KR is represented as one
task row in `tasks.csv`, with fields for metric, target, priority, dependency,
phase, and implementation status.

## Delivery Rules

1. No connector merges without passing conformance tests.
2. No API contract changes without schema/version update and migration note.
3. No retrieval rollout without SLO baseline and regression benchmark.
4. No UI mode rollout without index-backed API parity validation.

## Tracking Rules

Use `tasks.csv` as the single implementation tracker:

- Update `status` (`todo`, `in_progress`, `blocked`, `done`) per KR.
- Update `dependencies` by KR ID for sequencing.
- Track measurable completion via `metric` and `target`.
- Keep rows atomic; split oversized tasks into additional KR rows.

## Exit Criteria

The implementation plan is complete when:

- all P0/P1 KR rows are `done`
- API/query path is fully index-backed
- Claude Code + Brave connectors are incremental and reliable
- Distill and Chat2History workflows are functional
- SLO, correctness, and drift checks are automated in CI
