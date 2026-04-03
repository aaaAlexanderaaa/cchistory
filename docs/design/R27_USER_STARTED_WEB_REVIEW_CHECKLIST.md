# R27 User-Started Web Review Checklist

## Status

- Objective: `R27 - User-Started Web Review Checklist And Diary Contract`
- Date: 2026-04-03
- Scope: formalize one stable manual checklist for the seeded web review path
  and connect it to the operator-diary rubric already defined in `R22`

## Why This Exists

The repository already supports a truthful manual web review path:

1. materialize a seeded store with
   `pnpm run prepare:v1-seeded-web-review -- --store <dir>`
2. start the canonical user-operated services with
   `CCHISTORY_API_DATA_DIR=<dir> pnpm services:start`
3. review the seeded objects through the canonical web UI

That path is useful, but until now the review discipline lived partly in
`docs/guide/web.md` and partly in `docs/design/R22_OPERATOR_EXPERIENCE_E2E.md`.
Operators had steps, but not one stable checklist saying what to verify, what to
capture, and how to classify friction. This note turns that gap into one stable
artifact.

## Preconditions

- The seeded review store has been materialized at an explicit path.
- The user has started the canonical API + web services manually.
- The web UI is loaded from `http://localhost:8085`.
- The operator treats this as a manual review path, not an automated browser
  test and not an alternate startup architecture.

## Canonical Scenario

- **Scenario id**: `seeded-web-project-search-sources-review`
- **Goal**: confirm that the canonical web projection exposes the same seeded
  project recall, search drill-down, and source-health facts already proven by
  the seeded CLI/API/TUI acceptance slice.
- **Input store**: the explicit path passed to
  `pnpm run prepare:v1-seeded-web-review -- --store <dir>`
- **Runtime path**: `CCHISTORY_API_DATA_DIR=<dir> pnpm services:start`
- **Primary views**: `Projects`, `Search`, `Sources`

## Required Checks

### 1. Setup confirmation

Record the following before reviewing UI content:

- seeded store path
- service-start command used by the operator
- timestamp of the review
- browser or client notes if relevant

### 2. Projects view

Expected checks:

- `alpha-history` appears as the primary committed project in the seeded slice
- opening `alpha-history` reveals three turns for the seeded multi-source
  journey
- project labeling and source cues look internally consistent rather than
  implying a different canonical grouping

Capture:

- whether the project was easy to find
- whether the turn count and project identity looked trustworthy
- any confusion in navigation, hierarchy, or naming

### 3. Search view

Run the query `Alpha traceability target`.

Expected checks:

- one match appears under `alpha-history`
- opening the match reveals the seeded traceability turn
- the detail panel shows session `session-alpha-amp`
- the assistant content includes `Processing.`
- one tool call is visible in the detail context

Capture:

- whether the search result was easy to connect back to project and session
- whether the detail view made assistant/tool context obvious
- whether the search-to-detail transition felt coherent

### 4. Sources view

Expected checks:

- four healthy sources are visible: `amp`, `claude_code`, `codex`, and
  `factory_droid`
- each source shows one turn in the seeded slice
- the page reads as store-scoped seeded review, not ambient host discovery

Capture:

- whether the health/status summary felt truthful
- whether any wording suggested hidden mutation or stale host state
- whether source counts or labels looked harder to verify than they should

### 5. Shutdown confirmation

Record whether the operator stopped services manually with
`pnpm services:stop` after the review.

## Evidence Fields

Every manual web review should record at least:

- scenario id
- seeded store path
- service-start command
- exact checks completed
- observed pass/fail result for each required check
- screenshots or notes for any confusing state
- friction notes
- resulting backlog action or explicit statement that no follow-up was needed

## Friction Categories

Use the same review language already defined in `R22`:

- `Discoverability`
- `Readability`
- `Traceability`
- `Guardrail truthfulness`
- `Workflow overhead`
- `Parity drift`

## Severity Guidance

- `S0`: cosmetic only; no backlog follow-up needed
- `S1`: noticeable friction, but the review goal still succeeds
- `S2`: major friction or misleading behavior worth backlog ownership
- `S3`: canonical review failure or semantic mismatch

## Diary Template

Use this structure when recording a manual web review:

- **Scenario id**
- **Goal**
- **Inputs**
- **Commands/actions**
- **Expected outcome**
- **Observed outcome**
- **Friction notes**
- **Evidence refs**
- **Backlog action**

## Relationship To Existing Validation

This checklist does not replace the shipped local verifier surface, including:

- `pnpm run verify:v1-seeded-acceptance`
- `pnpm run verify:read-only-admin`
- `pnpm run verify:fixture-sync-recall`
- `pnpm run verify:bundle-conflict-recovery`
- `pnpm run verify:real-layout-sync-recall`
- `pnpm run verify:related-work-recall`
- `pnpm run verify:real-archive-probes`

Instead, it gives the user-started web slice one stable review contract so the
manual projection can be inspected with the same discipline already expected of
CLI/TUI/API walkthroughs, while `docs/design/CURRENT_RUNTIME_SURFACE.md`
remains the canonical inventory of what each verifier does and does not prove.

The contract now exists, but the actual recorded seeded web diary is still the
blocked manual-review task under `R31-KR1`; this note should not be read as
evidence that that diary has already been executed.
