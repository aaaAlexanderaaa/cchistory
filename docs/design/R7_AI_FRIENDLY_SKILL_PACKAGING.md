# R7 - AI-Friendly Skill Packaging

## Status

- Objective source: `docs/ROADMAP.md`
- Backlog status after this note: `active`
- Phase reached: Phase 1-3 decomposition completed on 2026-03-27; the first
  executable slice is the packaging foundation and transport contract
- Scope: package a small set of stable agent-callable skills for the most common
  local history retrieval and operator workflows without inventing a parallel
  semantic layer

## Phase 1 - Domain Understanding

### Problem statement

The roadmap calls for AI-friendly skills that let agents perform common
CCHistory workflows through stable, reusable interfaces. The target workflows
already exist in the product, but they are currently exposed as a mix of CLI
commands and API routes rather than packaged skills.

The key constraint from the design freeze is that skills must not create a new
semantic model. They must act as thin, reliable workflow packaging around the
same canonical objects already used by the CLI, API, web UI, and storage layer.

### What is already implemented

The repository already exposes the core runtime surfaces needed for a first
skill set:

- `apps/cli/src/index.ts` already supports canonical JSON-producing read paths
  through `cchistory query turns|turn|sessions|session|projects|project`.
- `apps/cli/src/index.ts` already supports safe export flows through
  `cchistory export --dry-run` and `cchistory export`.
- `apps/cli/src/index.ts` already supports source discovery and health-adjacent
  inspection through `discover`, `sync --dry-run`, `ls sources`, and `stats`.
- `apps/api/src/app.ts` already exposes read/admin routes for turns, projects,
  turn context, source config, probes, pipeline replay, and drift diagnostics.

### Repository and runtime constraints

- The product is local-first, so skill workflows should not require managed
  services when equivalent CLI-backed local paths already exist.
- The repository cannot rely on the agent to start persistent services, so
  API-only skill designs would create operational friction.
- Mutating or heavy workflows should default to preview-first behavior when a
  safe dry-run path already exists.
- Skill outputs must align with canonical objects (`UserTurn`, turn context,
  project views, source diagnostics) rather than creating skill-specific DTOs.

### Gaps found

#### 1. No product-owned skill inventory exists yet

There is no canonical `skills/` directory in the live product tree. The only
skill folders in the repository live under `archive/` as historical reference.

#### 2. Existing runtime surfaces are richer than current agent packaging

The CLI and API already expose most of the data needed for the roadmap skill
examples, but there is no repo-owned packaging that tells an agent which
surface to call, how to keep outputs canonical, or when to prefer dry-run.

#### 3. Read and operator workflows have different safety needs

Read workflows such as project history retrieval and turn-context drill-down can
be near-zero-risk wrappers around `query` and existing API reads. Operator
workflows such as bundle export and source health checks need stronger guidance
about preview/default behavior and service assumptions.

### Assumptions

- The first skill set should be CLI-first, because the CLI already exposes
  canonical JSON for read workflows and does not require managed services.
- API-backed skill variants may still be useful later, but they should be an
  optional transport, not the default dependency.
- The initial packaged skills should remain narrowly scoped instead of creating
  one large "do everything" skill.
- Repo-owned skills should live in a top-level `skills/` directory so they can
  be versioned with the product and reviewed alongside runtime changes.

## Phase 2 - Test Data Preparation

### Required validation position

This objective packages existing workflows rather than inventing new source data
semantics. The relevant evidence already exists in current CLI/API behavior and
fixture-backed package tests.

### Fixture strategy

- Reuse existing package-level regression tests for the underlying CLI and
  source-adapter behavior.
- When implementation begins, prefer skill smoke tests that execute against
  ephemeral stores or existing mock-data-backed fixtures instead of adding a new
  parallel source corpus.
- Validate mutating/operator skills with preview-first paths before enabling the
  non-preview path in any skill instructions.

## Phase 3 - Functional Design

Environment note: this objective benefits from the multi-perspective design
protocol. In this environment there is no sub-agent launcher, so the protocol is
recorded as separated lenses plus a synthesis.

### Agent A - System Consistency

**Recommendation**: build skills as thin packaging around existing canonical
CLI/API surfaces.

**Reasoning**:

- This preserves the design-freeze rule that UI, API, and agent workflows are
  projections of one canonical model.
- `cchistory query` already returns canonical JSON for the most important read
  workflows.
- Preview-first operator flows already exist and should remain the source of
  truth for skill behavior.

### Agent B - Operator Safety

**Recommendation**: split read and operator skills, and make operator skills
explicitly dry-run-first.

**Reasoning**:

- Read-side history retrieval is safe and should be easy to trigger.
- Export and source health actions need clearer safety rails and environment
  assumptions.
- Skills should not assume the user has started the API/web services unless the
  skill is explicitly written for an already-running service.

### Agent C - Engineering Cost

**Recommendation**: decompose into one foundation KR plus two workflow KRs.

**Reasoning**:

- KR1 should establish the repo-owned skill layout, metadata conventions, and
  transport contract.
- KR2 should package the high-value read workflows first using existing query
  surfaces.
- KR3 should package the operator workflows once the shared conventions exist.

### Synthesis

The recommended path is:

1. create a repo-owned `skills/` inventory with shared packaging conventions
2. use CLI-first transport for the initial skill set
3. package read workflows separately from operator workflows
4. keep outputs identical to canonical CLI/API JSON or lightly wrapped summaries
5. default operator skills to preview/dry-run guidance before mutating actions

### Decided KRs

#### KR: R7-KR1 Packaging foundation and transport contract

Acceptance: the repository defines a canonical `skills/` layout, naming rules,
metadata expectations, and CLI-first invocation contract for CCHistory skills
without introducing parallel semantics.

#### KR: R7-KR2 Read-side history retrieval skills

Acceptance: agents can retrieve project history and single-turn/session context
through stable repo-owned skills that surface canonical project/turn/session
JSON and explain their query parameters.

#### KR: R7-KR3 Operator workflow skills

Acceptance: agents can perform bundle-export and source-health workflows through
repo-owned skills that prefer dry-run or read-only inspection first and do not
require the agent to manage persistent services.

### Proposed initial skill inventory

- `cchistory-project-history`
- `cchistory-turn-context`
- `cchistory-export-bundle`
- `cchistory-source-health`

### Transport decision

The first implementation should use the CLI as the default execution transport:

- read skills should prefer `cchistory query ...`
- export skills should prefer `cchistory export --dry-run` first, then
  `cchistory export`
- source-health skills should prefer `discover`, `sync --dry-run`, `ls sources`,
  and targeted diagnostics before any heavier action
- API usage should remain optional and only for environments where the user has
  already started the managed services

### Impacted areas

- `BACKLOG.md`
- `docs/design/` for the decomposition and future validation record
- new top-level `skills/` directory for repo-owned skills
- optional shared helper scripts or references under `skills/`
- `README*` or guide docs if/when the first product-owned skills ship

### First executable slice

Implement `R7-KR1` first by creating the repo-owned `skills/` layout and shared
packaging/transport conventions, then package the read-side retrieval skills on
top of that foundation.

## KR1 - Packaging Foundation And Transport Contract

The first executable slice was implemented on 2026-03-28 by adding the
repo-owned skills foundation:

- `skills/README.md`
- `skills/_shared/CLI_TRANSPORT.md`

Results:

- the repository now has a canonical top-level `skills/` inventory for
  product-owned skills
- shared naming and metadata expectations are documented before individual
  workflow skills land
- the CLI-first transport contract is explicit, including `--json`,
  `--store`/`--db`, `--index` defaults for read workflows, and preview-first
  expectations for mutating workflows
- later skills can package existing canonical CLI surfaces without inventing a
  parallel semantic model


## KR2 - Read-Side History Retrieval Skills

The second executable slice was implemented on 2026-03-28 by adding the first
repo-owned read-side skills:

- `skills/cchistory-project-history/SKILL.md`
- `skills/cchistory-project-history/agents/openai.yaml`
- `skills/cchistory-turn-context/SKILL.md`
- `skills/cchistory-turn-context/agents/openai.yaml`

Results:

- project-wide history retrieval is packaged around the canonical `query project`,
  `query projects`, and project-scoped `query turns` CLI surfaces
- turn and session drill-down is packaged around the canonical `query turn`,
  `query session`, and turn-search CLI surfaces
- both skills explicitly reuse the CLI-first transport contract, default to
  `--index`, preserve canonical JSON field names, and avoid managed-service
  assumptions
- both skills ship UI-facing `agents/openai.yaml` metadata generated from the
  repo-owned skill definitions


## KR3 - Operator Workflow Skills

The third executable slice was implemented on 2026-03-28 by adding the first
repo-owned operator workflow skills:

- `skills/cchistory-export-bundle/SKILL.md`
- `skills/cchistory-export-bundle/agents/openai.yaml`
- `skills/cchistory-source-health/SKILL.md`
- `skills/cchistory-source-health/agents/openai.yaml`

Results:

- bundle export is packaged around the canonical `export --dry-run` preview and
  `export` write path
- source health is packaged around `discover`, `sync --dry-run`, `ls sources`,
  and `stats`, with real sync documented only as an explicit second step
- both skills reuse the CLI-first transport contract, preserve canonical JSON,
  and avoid managed-service assumptions
- the initial skill inventory proposed in Phase 3 now exists in the repository

## Phase 7 - Holistic Evaluation

Evaluation date: 2026-03-28.

Environment note: `PIPELINE.md` recommends a fresh agent context for Phase 7.
This environment does not provide a separate evaluator launcher, so the review
below is the recorded same-context evaluation for this host.

### Dimensions evaluated

- **Boundary evaluation**: passes. The work stayed inside the new top-level
  `skills/` inventory and reused existing CLI semantics instead of inventing a
  parallel model.
- **Stability assessment**: passes. The new skills are static packaging files
  plus generated UI metadata, and they rely on already-tested CLI commands.
- **Scalability evaluation**: passes. No runtime cost was added beyond existing
  CLI usage.
- **Compatibility assessment**: passes. No schema or stored-data changes were
  required.
- **Security evaluation**: passes. The packaged workflows remain local-first,
  dry-run-first where appropriate, and do not introduce new service-lifecycle
  assumptions.
- **Maintainability assessment**: passes. The shared transport contract plus four
  small single-purpose skills are easier to extend than a catch-all skill.

### Commands run

- `python /root/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/cchistory-project-history`
- `python /root/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/cchistory-turn-context`
- `python /root/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/cchistory-export-bundle`
- `python /root/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/cchistory-source-health`
- `pnpm --filter @cchistory/cli test`

### Issues found during evaluation

- None remaining at objective scope.
