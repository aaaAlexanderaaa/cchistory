# R40 Test Closure Plan

## Status

- Objective: `R40 - Consolidated E2E And Manual Test Closure Plan`
- Date: 2026-04-03
- Scope: consolidate the current automated and manual test state, execute the strongest currently available local verifier bundle, and restate the blocked manual-runtime diaries as one explicit execution queue

## Why This Exists

The user explicitly redirected the workflow away from repeated KR review sweeps
and back toward concrete testing work. The repository already has a meaningful
set of automated verifier commands plus a few recorded manual diaries, but the
remaining test closure work is scattered across multiple objectives and notes.

This note exists to make the next action obvious:

1. state what is already proven,
2. state what has already been manually reviewed,
3. state what is still blocked on user-started services, and
4. state which non-blocked test work should run next.

## Current Automated Proof Surface

The repository currently ships these strongest non-blocked verifier paths:

- `pnpm run verify:v1-seeded-acceptance`
- `pnpm run verify:read-only-admin`
- `pnpm run verify:fixture-sync-recall`
- `pnpm run verify:bundle-conflict-recovery`
- `pnpm run verify:real-layout-sync-recall`
- `pnpm run verify:related-work-recall`
- `pnpm run verify:real-archive-probes`
- `pnpm run verify:skeptical-cli-bundle-restore`
- `pnpm run verify:skeptical-browse-search`
- `pnpm run verify:skeptical-tui-full-snapshot`

What those cover, in aggregate:

- seeded CLI/API/TUI parity for one canonical recall / traceability / restore path
- store-scoped read-only admin visibility and missing-store truthfulness
- clean-store sync from fixture-backed default roots into canonical recall/search/drill-down paths
- bundle conflict behavior and restore readability
- real-layout-backed fixture sync-to-read coverage for promoted local-source slices
- delegated child-session and automation-run traceability across CLI/API/TUI
- archive-truthfulness checks for the currently reviewed real-layout assumptions
- skeptical built-CLI backup / conflict / restore behavior through one repeatable local verifier
- skeptical CLI/TUI browse/search readability and missing-ref guardrails through one repeatable local verifier

## Completed Manual Review Diaries

The repository already has these recorded manual diaries and execution aids:

- `docs/design/R25_SKEPTICAL_OPERATOR_ACCEPTANCE_SWEEP.md`
  - skeptical CLI backup / import conflict / restore-check review
- `docs/design/R32_SKEPTICAL_BROWSE_SEARCH_REVIEW.md`
  - skeptical CLI/TUI browse/search review
- `docs/design/R42_LOCAL_MANUAL_TEST_MATRIX.md`
  - explicit non-service local hand-test matrix for CLI/TUI commands, parameters, backup/restore, browse/search flows, and TUI `--full` snapshot edge cases
- `docs/design/R101_TUI_FULL_EDGE_DIARY_2026-04-03.md`
  - focused skeptical hand-test for indexed-store, combined-overlay, and missing-store TUI `--full` behavior
- `docs/design/R121_CONSOLIDATED_SKEPTICAL_LOCAL_FLOW_DIARY_2026-04-03.md`
  - one contiguous picky-operator diary spanning source-tree CLI, installed-artifact CLI, TUI, backup/restore, browse/search drill-down, and live-read trust

These matter because they answer a different question from the verifier bundle:
operator trust, readability, and friction under direct use.

## Still-Blocked Manual / Runtime Review Queue

The following test work remains blocked on user-started services and is not yet
recorded as completed manual review:

### `R31-KR1` Seeded web review diary

- prerequisite: user starts the canonical API + web services against a seeded review store
- contract: `docs/design/R27_USER_STARTED_WEB_REVIEW_CHECKLIST.md`
- expected artifact: one recorded seeded web diary covering `Projects`, `Search`, and `Sources`

### `R31-KR2` Managed API read diary

- prerequisite: user starts the canonical API service against a known indexed store
- contract: `docs/design/R31_MANAGED_API_READ_DIARY_CONTRACT.md`
- expected artifact: one recorded managed-runtime API diary covering `GET /api/projects` → `GET /api/turns/search` → `GET /api/turns/:turnId/context`

### `R35-KR1` Remote-agent pair/upload/schedule diary

- prerequisite: user starts the canonical API service for remote-agent control-plane review
- contract: `docs/design/R29_REMOTE_AGENT_VALIDATION_CONTRACT.md`
- expected artifact: one recorded pair/upload/schedule server-backed remote-agent diary

### `R35-KR2` Remote-agent leased-pull diary

- prerequisite: user starts the canonical API service and creates one admin job
- contract: `docs/design/R29_REMOTE_AGENT_VALIDATION_CONTRACT.md`
- expected artifact: one recorded leased-pull / admin-job server-backed remote-agent diary

## Explicit Out-Of-Scope Note

`R17` / LobeChat is explicitly out of scope for the current testing push unless
the user later provides real local data for review. The repository should keep
its already-recorded experimental boundary, but future sessions should not burn
time on additional LobeChat review or promotion work without new evidence.

## Prioritized Next Actions

1. Minimum self-host release-gate rechecks now also pass for `verify:support-status`, `verify:clean-install`, and `verify:web-build-offline`, and `R121` now adds one contiguous picky-operator local diary; no further non-service corrective work is currently justified from the active test-closure sweep.
2. Keep the blocked `R31`/`R35` diaries queued until the user provides running services.
3. Do not reopen LobeChat scope without new user-provided real data.

## Grouped Local Verifier Bundle

The following commands are the current highest-value non-blocked grouped test pass:

1. `pnpm run verify:v1-seeded-acceptance`
2. `pnpm run verify:local-full-read-bundle`
3. `pnpm run verify:read-only-admin`
4. `pnpm run verify:fixture-sync-recall`
5. `pnpm run verify:bundle-conflict-recovery`
6. `pnpm run verify:real-layout-sync-recall`
7. `pnpm run verify:related-work-recall`

### Recommended Local Order

When no user-started services are available, future sessions should use this order instead of drifting back into review-first behavior:

1. Run `pnpm run verify:local-full-read-bundle` for the strongest current local full-read confidence pass.
2. Run the lightweight drift guards when touching that surface: `node --test scripts/verify-local-full-read-bundle.test.mjs` and `node --test scripts/verify-cli-artifact.test.mjs scripts/verify-local-full-read-bundle.test.mjs`.
3. Use `docs/design/R42_LOCAL_MANUAL_TEST_MATRIX.md` for the corresponding hand-test commands if operator readability or workflow trust still needs direct evidence.
4. Leave `R31` and `R35` as blocked until the user provides running services.

### Execution Results

Initial grouped run on 2026-04-03:

- `pnpm run verify:v1-seeded-acceptance` — **failed**
  - observed failure: `scripts/verify-v1-seeded-acceptance.mjs:174` expected one CLI search hit for `Alpha traceability target`, but the current result count was `3`
  - classification under `R41`: this was a true search-broadening regression in the storage-layer session-match append path, not fixture drift and not a stale verifier expectation
- `pnpm run verify:read-only-admin` — **passed**
- `pnpm run verify:fixture-sync-recall` — **passed**
- `pnpm run verify:bundle-conflict-recovery` — **passed**
- `pnpm run verify:real-layout-sync-recall` — **passed**
- `pnpm run verify:related-work-recall` — **passed**

Post-fix rerun on 2026-04-03 after `R41`:

- `pnpm run verify:v1-seeded-acceptance` — **passed**
- `pnpm run verify:read-only-admin` — **passed**
- `pnpm run verify:fixture-sync-recall` — **passed**
- `pnpm run verify:bundle-conflict-recovery` — **passed**
- `pnpm run verify:real-layout-sync-recall` — **passed**
- `pnpm run verify:related-work-recall` — **passed**

### Result Summary

- grouped local verifier bundle status: **6 passed, 0 failed**
- `R41` root cause: multi-term search could append extra turns when only part of the query matched session metadata; the storage-layer session match now requires the full query term set instead of any single highlighted token
- strongest currently actionable follow-up: execute `R53` and record a concrete readability decision for markup-heavy prompt text in search/TUI browse surfaces
- blocked manual/runtime queue remains unchanged: `R31-KR1`, `R31-KR2`, `R35-KR1`, and `R35-KR2` still require user-started services


## R42 Execution Results

Executed on 2026-04-03:

- `pnpm run verify:skeptical-cli-bundle-restore` — **passed**
- `pnpm run verify:skeptical-browse-search` — **passed**
- `pnpm run verify:cli-artifact` — **passed**
  - now includes installed-artifact skeptical restore/conflict and multi-source browse/search parity workflows

These results mean the repository now has repeatable local proof not only for the seeded and fixture-backed canonical flows, but also for the skeptical operator backup/restore and browse/search slices the user explicitly challenged.


## R44 Execution Results

Executed on 2026-04-03:

- `pnpm run verify:cli-artifact` — **passed** after extension to an installed-artifact conflict flow

This closes the artifact-path gap between simple install/upgrade smoke and one truthful operator-facing backup/import recovery workflow.


## R45 Execution Results

Executed on 2026-04-03:

- `pnpm run verify:cli-artifact` — **passed** after extension to installed-artifact multi-source browse/search parity

This closes the artifact-path gap between backup/import-only proof and one truthful skeptical read-only browse/search journey using `ls`, `search`, `show`, and `tree` pivots.


## R46-R49 Execution Results

Executed on 2026-04-03:

- `pnpm run verify:cli-artifact` — **passed** after extension to installed-artifact store-scoped admin parity (`health --store-only`, `ls sources`, missing-store guardrails)
- `pnpm run verify:cli-artifact` — **passed** after extension to installed-artifact structured retrieval parity (`stats`, `query session --id`, `query turn --id`)
- manual local CLI/TUI diary — **completed** in `docs/design/R48_LOCAL_MANUAL_DIARY_2026-04-03.md`
- `pnpm --filter @cchistory/cli test` — **passed** after polishing `show session` friendly project/source labels
- `pnpm run verify:cli-artifact` — **passed** after extending browse verification to assert the friendlier `show session` labels

These results shift the strongest remaining local gap away from basic confidence in commands and toward a narrower UX/readability question about dense session listings.


## R50-R52 Execution Results

Executed on 2026-04-03:

- backlog decision `R50` — **completed** with a concrete direction to tune `ls sessions --long` instead of adding a second mode first
- `pnpm --filter @cchistory/cli test` — **passed** after tuning `ls sessions --long` to use a denser source cell and truncated high-entropy title/workspace/model columns
- `pnpm run verify:skeptical-browse-search` — **passed** after asserting the more compact session listing surface
- `pnpm run verify:cli-artifact` — **passed** after asserting the installed artifact also exposes the more compact session listing surface
- `pnpm --filter @cchistory/cli test` — **passed** after upgrading default import conflict stderr with actionable next steps
- `pnpm run verify:cli-artifact` — **passed** after asserting installed-artifact conflict failures suggest `--dry-run` and `--on-conflict skip|replace`

These results move the next strongest local browse/search gap from listing density to the remaining readability question around markup-heavy captured prompt text.


## R57-R62 Execution Results

Executed on 2026-04-03:

- `pnpm --filter @cchistory/cli test` — **passed** after `R57` made CLI search context labels friendlier than raw source enums.
- `pnpm run verify:skeptical-browse-search` — **passed** after `R58` extended skeptical browse/search proof to `search --project`, `search --source`, `search --limit`, and `tree project --long`.
- `docs/design/R59_SKEPTICAL_PARAMETER_DIARY_2026-04-03.md` — **recorded** after a second-pass skeptical manual parameter drill-down across filtered search and bundle conflict recovery commands.
- `pnpm --filter @cchistory/cli test` — **passed** after `R60` normalized command-heavy snippets in `tree project` and `tree session` browse output.
- `pnpm run verify:skeptical-browse-search` — **passed** after asserting tree browse snippets no longer leak raw command-wrapper tags.
- `pnpm run verify:cli-artifact` — **passed** after asserting the installed CLI artifact also proves tree browse readability and parameter-scoped skeptical search behavior.

These results materially strengthen the local acceptance bar: the repository now has repeatable proof not only for default browse/search flows, but also for parameter-heavy skeptical operator behavior on both the source-tree CLI and the installed artifact path.

## Updated Next Actions

1. Execute `R113` and run one focused consistency sweep across the local full-read doc surfaces.
2. Keep the blocked `R31`/`R35` managed-runtime diaries queued until the user provides running services.
3. Do not reopen LobeChat scope without new user-provided real data.

- installed-artifact manual parameter diary — **completed** in `docs/design/R63_INSTALLED_ARTIFACT_PARAMETER_DIARY_2026-04-03.md`
- installed-artifact read-only admin/query diary — **completed** in `docs/design/R64_INSTALLED_ARTIFACT_ADMIN_QUERY_DIARY_2026-04-03.md`

- source-tree read-only admin/query diary — **completed** in `docs/design/R65_SOURCE_TREE_ADMIN_QUERY_DIARY_2026-04-03.md`

- `pnpm --filter @cchistory/tui test` — **passed** after `R67` fixed empty-search selection coherence and `R68` wired the SQLite warning filter into TUI tests.
- `pnpm --filter @cchistory/tui test` — **passed** after `R69` added the non-interactive `--source-health` snapshot flag.

- TUI source-health/help manual diary — **completed** in `docs/design/R70_TUI_SOURCE_HEALTH_HELP_DIARY_2026-04-03.md`

- `pnpm --filter @cchistory/tui test` — **passed** after `R71` added focused coverage for the combined `--search` + `--source-health` TUI snapshot path.

- TUI combined search/source-health manual diary — **completed** in `docs/design/R72_TUI_SEARCH_SOURCE_HEALTH_DIARY_2026-04-03.md`

- source-tree CLI discover/health manual diary — **completed** in `docs/design/R74_CLI_DISCOVER_HEALTH_DIARY_2026-04-03.md`
- installed-artifact discover/health manual diary — **completed** in `docs/design/R75_INSTALLED_ARTIFACT_DISCOVER_HEALTH_DIARY_2026-04-03.md`

- `pnpm --filter @cchistory/cli test` — **passed** after `R77` aligned filtered `health --source` store summaries with selected-source scope.
- `pnpm run verify:cli-artifact` — **passed** after `R78` asserted installed-artifact filtered `health --source` output narrows indexed sources and store counts correctly.
- `pnpm run verify:cli-artifact` — **passed** after `R79` asserted installed-artifact `health --full` stays read-only, uses live-scan framing, and preserves selected-source scope.
- `pnpm run verify:cli-artifact` — **passed** after `R80` asserted installed-artifact `discover` output still surfaces sync-ready roots, supplemental paths, and Gemini discovery-only artifacts.
- `pnpm run verify:cli-artifact` — **passed** after `R81` asserted installed-artifact `ls sessions --full --source codex` can see newly added live sessions without mutating indexed results.
- `pnpm run verify:cli-artifact` — **passed** after `R82` asserted installed-artifact `search --full --source codex` can see newly added live content without mutating indexed search results.
- `pnpm run verify:cli-artifact` — **passed** after `R83` asserted installed-artifact `show turn --full` and `show session --full` can expose live-only content without mutating indexed drill-down.
- `pnpm run verify:cli-artifact` — **passed** after `R84` asserted installed-artifact `tree session --full` can expose a live-only session without mutating indexed tree drill-down.
- `pnpm run verify:cli-artifact` — **passed** after `R85` asserted installed-artifact `show project --full` and `tree project --full` can expose live-only growth without mutating indexed project output.
- installed-artifact full-read manual diary — **completed** in `docs/design/R86_INSTALLED_ARTIFACT_FULL_READ_DIARY_2026-04-03.md`
- `pnpm run verify:cli-artifact` — **passed** after `R87` asserted installed-artifact `stats --full` reflects live-only growth without mutating indexed stats.
- source-tree full-read manual diary — **completed** in `docs/design/R88_SOURCE_TREE_FULL_READ_DIARY_2026-04-03.md`
- `pnpm --filter @cchistory/cli test` — **passed** after `R89` added targeted source-tree full-read regression coverage for search/show/tree/project/stats parity.
- `pnpm --filter @cchistory/tui test` — **passed** after `R91` added explicit indexed-only disclosure to TUI help, snapshot headers, and status-line output.
- TUI indexed-vs-live evaluation — **completed** in `docs/design/R90_TUI_INDEXED_VS_LIVE_EVALUATION_2026-04-03.md`
- TUI live-read scope decision — **completed** in `docs/design/R92_TUI_LIVE_READ_SCOPE_DECISION_2026-04-03.md`
- `pnpm --filter @cchistory/tui test` — **passed** after `R93` added a truthful non-interactive TUI `--full` snapshot path without indexed-store mutation.
- `pnpm --filter @cchistory/tui test` — **passed** after `R94` added combined `--full --search --source-health` TUI snapshot coverage.
- TUI full snapshot manual diary — **completed** in `docs/design/R95_TUI_FULL_SNAPSHOT_DIARY_2026-04-03.md`
- `pnpm --filter @cchistory/tui test` — **passed** after `R96` locked interactive `--full` guard coverage.
- TUI guide full snapshot docs — **completed** in `docs/guide/tui.md`
- `pnpm --filter @cchistory/tui test` — **passed** after `R98` locked help coverage for `--full` guidance.
- `pnpm --filter @cchistory/tui test` — **passed** after `R99` proved non-interactive `--full` works against a missing store without creating an indexed DB.
- `pnpm run verify:skeptical-tui-full-snapshot` — **passed** after `R100` added one reusable built-TUI verifier for indexed-store, combined-overlay, and missing-store `--full` snapshots.
- TUI `--full` edge manual diary — **completed** in `docs/design/R101_TUI_FULL_EDGE_DIARY_2026-04-03.md`
- grouped local full-read bundle note — **completed** in `docs/design/R103_GROUPED_LOCAL_FULL_READ_BUNDLE_NOTE_2026-04-03.md`
- local full-read alias runtime note — **completed** in `docs/design/R105_LOCAL_FULL_READ_ALIAS_NOTE_2026-04-03.md`
- `pnpm run verify:local-full-read-bundle` — **passed** after `R107` replaced the shell-chain alias with a repository-owned wrapper and concise pass summary.
- skip-build guard note — **completed** in `docs/design/R108_SKIP_BUILD_GUARD_NOTE_2026-04-03.md`
- `node --test scripts/verify-local-full-read-bundle.test.mjs` — **passed** after `R109` added wrapper drift coverage.
- `node --test scripts/verify-cli-artifact.test.mjs scripts/verify-local-full-read-bundle.test.mjs` — **passed** after `R110` added automated skip-build clear-failure coverage.
- active test-closure doc sweep — **completed** after `R111` grouped the local full-read entrypoints, drift guards, and blocked managed-runtime diaries into one obvious execution order.
- release-gate positioning update — **completed** after `R112` made `verify:local-full-read-bundle` explicit as a local confidence helper rather than a required release-gate verifier.
- local full-read consistency sweep — **completed** in `docs/design/R113_LOCAL_FULL_READ_SURFACE_CONSISTENCY_2026-04-03.md` after fixing one stale `R40` next-action block.
- `node --test scripts/verify-cli-artifact.test.mjs scripts/verify-local-full-read-bundle.test.mjs` — **passed** after `R114` added local full-read summary-output guard coverage.
- `E2E-2` / `V1` admin-journey wording — **updated** after `R115` reclassified `J4-admin-source-health-review` from partial to covered today.
- J4 verifier strategy note — **completed** in `docs/design/R116_J4_VERIFIER_DECISION_2026-04-03.md` with an explicit decision to keep the current verifier-plus-diary split.
- managed-runtime prep consistency sweep — **completed** in `docs/design/R117_MANAGED_RUNTIME_PREP_CONSISTENCY_2026-04-03.md`; no extra non-service corrective edits were needed.
- `pnpm run verify:support-status` — **passed** after `R118` rechecked the updated support-surface docs against the adapter registry.
- `pnpm run verify:clean-install` — **passed** after `R119` revalidated the documented clean-install path on a fresh repository copy.
- `pnpm run verify:web-build-offline` — **passed** after `R120` revalidated the offline web production build gate on the current repository state.
