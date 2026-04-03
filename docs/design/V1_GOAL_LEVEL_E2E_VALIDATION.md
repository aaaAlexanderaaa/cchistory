# V1 Goal-Level End-To-End Validation

## Status

- Objective: `V1 - Goal-Level End-To-End Validation And Review-Gap Cleanup`
- Date: 2026-04-01
- Scope: define the canonical validation matrix that evaluates whether CCHistory meets the frozen product goals rather than merely passing package-scoped tests
- Delivery: design matrix, review-gap fixes, seeded acceptance verification, user-started web review support, and repeatable real-archive probes were all completed on 2026-04-01

## Why This Exists

The repository now has meaningful package-scoped regression coverage for parsing,
storage, CLI, and the first TUI slice. That is useful, but it is not yet strong
enough to prove the product meets the goals frozen in
`HIGH_LEVEL_DESIGN_FREEZE.md`.

Current risk:

- tests are concentrated around implementation seams instead of complete user jobs
- passing package tests can still hide semantic drift between CLI, API, web, and TUI
- seeded fixtures often prove that one function behaves consistently, not that the
  system actually delivers project-first recall and evidence-backed traceability
- experimental slices can look healthy in fixture-only probes while still failing
  real-layout expectations or cross-surface readability

This note defined the validation standard for the first end-to-end validation push that followed `V1`. Its historical goal was to stop optimizing for “grammatically correct” local tests and start proving that the product behaves correctly for the jobs it claims to solve.

## Product Goals To Validate

Validation must be anchored in the frozen product essence and kernel pattern,
not in whichever tests already exist.

The minimum goals that end-to-end validation must evaluate are:

1. **Recall** — the user can recover what they asked in a project even when the
   relevant turns came from multiple sessions and multiple source platforms.
2. **Traceability** — from a recovered `UserTurn`, the user can inspect the
   linked session, assistant/tool context, and evidence-preserving projections
   behind that turn.
3. **Administration** — the user can inspect source health and system state
   without the read surfaces silently mutating storage or inventing empty data.
4. **Supply** — canonical derived history survives export/import or restore and
   remains readable through the same core product objects.
5. **One semantic pipeline** — CLI, API, web, and TUI must behave as projections
   of one canonical model rather than drifting into surface-specific meanings.

## Validation Principles

### 1. Judge the product by user jobs, not package boundaries

A test is valuable only if it helps prove one of the frozen goals above.
Additional parser or helper tests are fine, but they are not sufficient evidence
for product correctness by themselves.

### 2. Prefer goal-level workflows over shallow snapshots

A validation path should start from a realistic store state or captured source
state and then exercise a complete workflow such as:

- sync or restore
- discover or recall by project / search
- drill into turn / session / context
- compare the same canonical object across surfaces

### 3. Use real data review where truth depends on real layouts

For source intake and support-surface claims, fixture-only optimism is not good
enough. Validation must include review probes against the available real archive
when a claim depends on a real on-disk structure.

### 4. Verify read surfaces do not invent state

Read-only entrypoints must not silently create stores, mutate lifecycle state,
or hide missing-data conditions behind empty fresh databases.

### 5. Fail on semantic mismatch, not just thrown errors

A green validation result must mean:

- the right project was recalled
- the right turn was grouped and linked
- the right context is visible behind it
- the same canonical object is surfaced consistently
- missing or unsupported conditions remain explicit instead of being silently
  flattened

## Canonical Validation Matrix

The first implementation slice defined by this note covered at least the
following journeys. These remain the minimum end-to-end checks required to
evaluate whether the product matches the frozen goals.

### Journey A — Multi-source project recall

**Goal**: prove project-first recall across heterogeneous sources.

**Setup**:

- one local store containing at least two committed projects
- one target project with turns from at least three source platforms
- one comparison project to prove separation is preserved

**Actions**:

- query or browse the target project in CLI
- retrieve the same project through API
- inspect the same project in web and/or TUI

**Pass conditions**:

- the target project shows turns from multiple source platforms under one
  project identity
- unrelated turns from the comparison project do not bleed into the target
- ordering is consistent with canonical recent-first project recall
- displayed project naming and source-platform cues agree across surfaces

### Journey B — Search then drill into traceability

**Goal**: prove the system is not just searchable, but traceable.

**Setup**:

- one turn with a distinctive searchable prompt phrase
- linked session/context data including assistant replies and tool activity

**Actions**:

- search by phrase in CLI
- search by phrase in TUI and/or web
- drill into the selected result
- inspect the linked session/context view for the same turn, with `tree session <session-ref> --long` available in CLI when a richer nearby-turn or related-work continuation is needed

**Pass conditions**:

- the searched turn resolves to the same canonical `turn_id` or equivalent
  logical object across surfaces
- the detail flow exposes canonical text plus session/source cues
- assistant/tool context remains attached to the selected turn
- no surface invents different grouping or context membership for the same turn

### Journey C — Read-only admin / source-health inspection

**Goal**: prove read surfaces expose health truthfully and do not mutate state.

**Setup**:

- one indexed store with at least one healthy source and one non-healthy or
  obviously incomplete source state
- one missing-store case

**Actions**:

- inspect source health through CLI/TUI/web as available
- launch read-only surfaces against a missing store path

**Pass conditions**:

- health/status counts match the underlying store state
- missing-store behavior is explicit and non-mutating
- no read surface silently creates a new empty database while presenting itself
  as recall/admin UI

### Journey D — Supply / restore readability

**Goal**: prove canonical objects survive export/import or restore.

**Setup**:

- one store with multi-source linked history
- exported bundle or restored clean target

**Actions**:

- restore/import into a clean directory
- read the resulting store through CLI and API
- compare project/session/turn counts and one known project drill-down path

**Pass conditions**:

- sources, sessions, and turns remain readable after restore
- at least one known project recall path survives intact
- the restored data does not require hidden local state outside the documented
  bundle/store contract

### Journey E — Real-layout experimental slice truthfulness

**Goal**: prove the repository is truthful about adopted experimental slices.

**Setup**:

- sanitized fixtures for Cursor chat-store, CodeBuddy, Gemini missing-companion
  cases, and OpenCode global storage layout
- available review archive under `.realdata/config_dots_20260331_212353/`

**Actions**:

- run fixture-backed adapter validation
- run review probes against the available real archive or a documented sampled
  subset
- compare repository claims with observed layouts

**Pass conditions**:

- the fixtures reflect the observed real layouts the repo claims to support
- experimental slices remain clearly bounded when reconstruction is partial
- no source is promoted or documented beyond what real review justifies

## Required Validation Inputs

Validation should use three input classes together.

### A. Seeded canonical stores

Use seeded SQLite stores to test end-to-end product behavior against canonical
objects without coupling every workflow to raw parsing.

Required seeded-store scenarios:

- multi-project, multi-source committed recall scenario
- searchable traceability scenario with assistant/tool context
- source-health scenario with visible status differences
- clean restore target scenario
- missing-store scenario

### B. Sanitized source-shaped fixtures

Use `mock_data/` to verify that source intake continues to produce the kinds of
canonical stores and projections the product relies on.

Required fixture-backed scenarios:

- stable adapters named in `mock_data/stable-adapter-validation.json`
- Gemini missing-companion and scale cases
- Cursor chat-store intake slice
- CodeBuddy transcript plus companion-evidence slice
- OpenCode real-layout global storage and part-backed session cases

### C. Real-archive review probes

Use the available archive under `.realdata/config_dots_20260331_212353/` to
re-check claims that depend on real layouts.

These probes do not need to become giant automated suites immediately, but they
must become explicit, repeatable review steps rather than tribal knowledge.

Minimum real-archive review scope:

- confirm the adopted sanitized fixture roots are still faithful to the archive
- confirm the repository’s claimed transcript-bearing boundaries remain true
- confirm experimental-slice limits are still described honestly

Current implemented verifier:

- `pnpm run verify:real-archive-probes` checks the available `.realdata/config_dots_20260331_212353/` archive for the Gemini chat/log layout plus missing-companion absence, Cursor chat-store SQLite roots, CodeBuddy transcript-bearing JSONL presence plus non-empty files, and the adopted OpenCode global session/message/part storage layout.

## Canonical Validation Surfaces

This validation design does not try to validate everything through one surface. Different product jobs need different proof paths.

### CLI

CLI remains the most direct operator-readable validation surface for:

- project recall
- search and drill-down
- restore readability
- source-health/admin summaries

CLI should be the first place to express acceptance-style checks because it is
stable, scriptable, and canonical.

Current implemented verifier surface:

- `pnpm run verify:v1-seeded-acceptance` builds the CLI/API/TUI entrypoints,
  seeds one canonical store, checks committed project recall plus one known
  turn's session/context readability across those three surfaces, verifies CLI/API
  source summaries on the seeded store, and then proves restore readability via
  `export` + `import` + `restore-check` + restored API reads; the current CLI
  browse surface also supports `tree session <session-ref> --long` as the richer
  nearby-turn and related-work continuation from the seeded search hit.
- `pnpm run verify:read-only-admin` proves store-scoped CLI/TUI/API read-only
  admin visibility plus missing-store truthfulness without mutating the seeded
  store.
- Focused operator evidence for the discovery side of Journey C is also recorded in `docs/design/R74_CLI_DISCOVER_HEALTH_DIARY_2026-04-03.md` and `docs/design/R75_INSTALLED_ARTIFACT_DISCOVER_HEALTH_DIARY_2026-04-03.md`, so source availability, sync readiness, `health`, and missing-store admin behavior are no longer only implicit or package-scoped.
- `pnpm run verify:fixture-sync-recall` proves that repo `mock_data/` default-root
  fixtures can sync into a clean store and then replay one canonical project
  recall/search/drill-down journey through CLI, API, and TUI.
- `pnpm run verify:bundle-conflict-recovery` proves populated-target bundle
  conflict visibility and recovery, including dry-run previews, `skip` /
  `replace`, `restore-check`, and canonical CLI/API readback.
- `pnpm run verify:real-layout-sync-recall` proves that the real-layout-backed
  fixture slice can sync into a clean store and stay readable through
  representative CLI/API/TUI project, session, and turn paths.
- `pnpm run verify:related-work-recall` proves that delegated child-session and
  automation-run context stays traceable through CLI search/detail/tree flows,
  TUI search drill-down, and API read-side related-work inspection after sync.
- `pnpm run prepare:v1-seeded-web-review -- --store <dir>` materializes the same
  seeded store for user-started web review, and `CCHISTORY_API_DATA_DIR=<dir>`
  lets the canonical API service read that explicit store without changing the
  managed startup architecture.

`docs/design/CURRENT_RUNTIME_SURFACE.md` remains the canonical current-state
inventory for what each verifier does and does not prove.

### API

API validation must prove that the same canonical objects are exposed through
machine-readable contracts.

Minimum API validation focus:

- project list / project detail parity with CLI
- turn/session/context retrieval parity for one known turn
- count/readability checks after restore

### Web

Web validation should prove that the canonical frontend is a projection of the
same objects, not an isolated visual mock.

Minimum web validation focus:

- project recall view matches canonical project identity and recent ordering
- search result selection reaches the expected turn detail
- sources/admin surfaces do not omit newly adopted platforms or statuses

Because the agent must not start managed services, browser/runtime checks should
assume user-started services and use the canonical service workflow only.

### TUI

TUI validation must prove that the terminal-native surface is genuinely
read-first and semantically aligned with CLI/API/web.

Minimum TUI validation focus:

- project/turn/detail drill-down on the same seeded store used elsewhere
- search result to detail drill-down on the same canonical turn
- source-health summary parity with stored source status
- explicit non-mutating behavior for missing-store inputs

## Pass/Fail Rules

A validation slice should be considered **failing** if any of the following are
true, even when package tests are mostly green:

- a read surface silently creates a missing store and presents it as empty data
- the same seeded project or turn resolves differently across canonical surfaces
- a surface can search a turn but cannot trace it back to linked session/context
- project-first grouping breaks when turns come from multiple source platforms
- restore succeeds mechanically but the restored history is not readable through
  canonical project/turn flows
- experimental source claims exceed what the real archive and fixture corpus
  truthfully justify
- a package-level regression suite that is part of the accepted validation path
  is red

A validation slice should be considered **passing** only when:

- the canonical journeys above succeed on the defined inputs
- cross-surface semantic agreement is explicitly checked
- real-layout-dependent claims are reviewed against the available archive
- read-only surfaces remain non-mutating
- supporting package-scoped regressions are green

## Immediate Review Gaps To Fix Before Claiming Strong Validation

These items are already known and must remain visible until fixed.

### 1. Storage overview regression

Status: fixed on 2026-04-01.

Resolution:

- `pnpm --filter @cchistory/storage test` is green again after aligning the
  failing `buildLocalReadOverview` fixture with the actual workspace-based
  project-linking semantics that the helper already exposed truthfully.

Fix standard that was applied:

- do not paper over the failure by weakening the test blindly
- determine whether the helper or the fixture expectation is wrong
- restore green status in a way that matches real canonical project semantics

### 2. TUI missing-store mutation bug

Status: fixed on 2026-04-01.

Resolution:

- `apps/tui` now rejects a missing resolved `--store` / `--db` path with a
  clear indexed-store error instead of creating a fresh SQLite database.

Fix standard that was applied:

- launching TUI with a missing `--store` or `--db` path must not create a fresh
  store implicitly
- the user should get an explicit, truthful missing-store message instead
- focused regression coverage must prove the non-mutating behavior

## Historical Initial Implementation Order

At the time this note was drafted on 2026-04-01, the recommended order for the
first validation push was:

1. write acceptance-style seeded-store checks for Journey A and Journey B
2. fix the known storage and TUI regressions above
3. add explicit missing-store and read-only admin validations
4. add restore readability parity checks across CLI and API
5. add user-started web validation and browser checks for one canonical journey
6. formalize real-archive review probes for the adopted experimental slices
7. promote the strongest repeatable paths into canonical verifier commands

That first-pass order has now been executed. Current-state validation inventory
and remaining gaps should be read from `docs/design/CURRENT_RUNTIME_SURFACE.md`,
`docs/design/R22_OPERATOR_EXPERIENCE_E2E.md`, and `BACKLOG.md` rather than
treating the list above as still-open work.

## Historical First-Pass Deliverables

The original next-session target for this note was to produce:

- a first implementation of end-to-end or acceptance-style validation covering
  the canonical journeys above
- fixes for the storage overview regression and the TUI missing-store mutation bug
- any new verifier command(s) or targeted suites needed to make these workflows
  repeatable
- updated backlog/doc references if the implemented validation changes the
  accepted repository command surface

Those first-pass deliverables have now landed; later verifier expansion is
tracked separately in the current-state documents listed above.

## Result

The canonical design matrix is now documented, and the two blocking review gaps that would have undermined it were fixed on 2026-04-01. The repository now includes the original seeded acceptance path via `pnpm run verify:v1-seeded-acceptance`, the user-started web review helper path via `pnpm run prepare:v1-seeded-web-review -- --store <dir>` plus `CCHISTORY_API_DATA_DIR=<dir> pnpm services:start`, and the repeatable archive-truthfulness check via `pnpm run verify:real-archive-probes` for Gemini, Cursor chat-store, CodeBuddy, and OpenCode review assumptions. Subsequent post-`V1` validation work also added `pnpm run verify:read-only-admin`, `pnpm run verify:fixture-sync-recall`, `pnpm run verify:bundle-conflict-recovery`, `pnpm run verify:real-layout-sync-recall`, and `pnpm run verify:related-work-recall`, so the repository’s local proof surface is now broader than this note’s original first-pass closure. With those pieces in place, `V1-KR2` acceptance remains executable and the objective’s remaining work shifts from design intent to user-run spot checks when desired.

This note records the minimum truthful validation bar that shaped the delivered post-`V1` validation work. Current sessions should use it as historical design context together with `docs/design/CURRENT_RUNTIME_SURFACE.md`, `docs/design/R22_OPERATOR_EXPERIENCE_E2E.md`, and `BACKLOG.md`, rather than treating it as the sole live worklist.
