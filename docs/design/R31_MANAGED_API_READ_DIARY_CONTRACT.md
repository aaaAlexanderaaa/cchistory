# R31 Managed API Read Diary Contract

## Status

- Objective linkage: `R31 - Managed-Runtime Manual Review Diaries For Web And API`
- Date: 2026-04-03
- Scope: give the blocked `J7-supply-managed-api-read` review path one stable manual diary contract before a user-started API review is executed

## Why This Exists

`docs/design/E2E_2_HLD_USER_JOURNEY_COVERAGE.md` already records `J7-supply-managed-api-read` as a truthful managed-runtime/manual journey, and `BACKLOG.md` already owns the future execution of that diary under `R31-KR2`.

What was still missing was the stable review contract that sits between those two things:

- one place that states the exact user-started preconditions,
- one place that names the minimum route chain to review,
- one place that tells the reviewer what evidence to capture, and
- one place that defines how resulting friction should feed back into `BACKLOG.md`.

This note closes that contract gap without pretending the actual managed-runtime diary is already executed.

## Preconditions

- The user starts the canonical API service manually; agents still must not start long-lived services from this environment.
- The API service points at a known indexed store, either through the default store-resolution policy or an explicit `CCHISTORY_API_DATA_DIR=<dir>` override.
- The reviewer knows which store is being inspected and which canonical project/turn will be used for the read-path check.
- This remains a manual managed-runtime review path, not a replacement for the shipped local verifiers.

## Canonical Scenario

- **Scenario id**: `managed-api-project-search-context-diary`
- **Goal**: confirm that the managed API exposes the same canonical project, turn-search, and turn-context objects already proven locally through CLI/API/TUI verifiers, but now through one user-started service path.
- **Primary route chain**:
  1. `GET /api/projects`
  2. `GET /api/turns/search?q=<known phrase>`
  3. `GET /api/turns/:turnId/context`
- **Optional parity extensions**:
  - `GET /api/projects/:projectId`
  - `GET /api/projects/:projectId/turns`
  - equivalent `@cchistory/api-client` calls instead of raw `curl`

## Required Checks

### 1. Runtime confirmation

Record before reviewing API payloads:

- server URL
- store path or `CCHISTORY_API_DATA_DIR` used
- startup command the operator ran
- timestamp of the review

### 2. Project-list readability

Expected checks:

- `GET /api/projects` succeeds against the intended indexed store
- the returned project list exposes canonical IDs and readable project summaries
- the response does not imply a different project grouping than the local read surfaces

Capture:

- whether the target project was easy to identify
- whether project counts/labels felt trustworthy
- any mismatch between expected store content and the API list

### 3. Search-to-turn recall

Use one known searchable phrase from the selected store.

Expected checks:

- `GET /api/turns/search` returns the expected canonical turn hit
- the selected hit is clearly attributable to the intended project and source
- the managed API result feels consistent with the equivalent local recall path

Capture:

- query string used
- returned `turnId`
- whether result ranking/labels felt trustworthy
- any ambiguity in project, session, or source cues

### 4. Context drill-down

Expected checks:

- `GET /api/turns/:turnId/context` succeeds for the selected turn
- assistant/tool/context payload remains attached to the same canonical turn
- the response does not flatten or invent context compared with local read paths

Capture:

- selected `turnId`
- whether assistant/tool context was easy to interpret
- whether any payload shape, naming, or omissions made the managed API feel less trustworthy than nearby local surfaces

### 5. Optional project parity

If time and runtime permit, also check:

- `GET /api/projects/:projectId`
- `GET /api/projects/:projectId/turns`

Expected checks:

- the same project/turn remains identifiable across list, search, and project-detail routes
- no route suggests a conflicting canonical grouping

## Evidence Fields

Every managed API review diary should record at least:

- scenario id
- server URL
- startup command
- store path or `CCHISTORY_API_DATA_DIR` override
- exact routes or client calls used
- expected outcome
- observed outcome
- selected project ID / turn ID when relevant
- friction notes
- evidence refs (JSON snippets, curl output, screenshots, terminal logs)
- backlog action or explicit statement that no follow-up was needed

## Friction Categories

Use the same review language already used elsewhere in repository-owned manual reviews:

- `Discoverability`
- `Readability`
- `Traceability`
- `Guardrail truthfulness`
- `Workflow overhead`
- `Parity drift`

## Severity Guidance

- `S0`: cosmetic only; no backlog follow-up needed
- `S1`: noticeable friction, but the API journey still succeeds
- `S2`: misleading or high-friction behavior worth backlog ownership
- `S3`: canonical managed-runtime read failure or semantic mismatch

## Relationship To Existing Proof

This contract does not replace the current local proof surface, including:

- `pnpm run verify:v1-seeded-acceptance`
- `pnpm run verify:read-only-admin`
- `pnpm run verify:fixture-sync-recall`
- `pnpm run verify:real-layout-sync-recall`
- `pnpm run verify:related-work-recall`

Those commands already prove important local read-side behavior. This note exists only so the still-blocked managed-runtime API diary under `R31` has one stable checklist once the user provides a running service.
