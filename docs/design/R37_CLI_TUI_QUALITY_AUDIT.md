# R37 CLI/TUI Quality Audit

Status: final audit for completed R37
Date: 2026-05-15

## Scope

This audit covers the CLI/TUI read-side quality push described by `R37` in
`BACKLOG.md`. It preserves the frozen surface split: CLI remains the admin and
AI-agent surface, while TUI remains the keyboard-first local read surface. It
does not change canonical product semantics, storage contracts, source adapter
semantics, or the `UserTurn`-first recall model.

## Evidence Reviewed

- CLI package tests under `apps/cli/src/test/`
- TUI package tests under `apps/tui/src/index.test.ts`,
  `apps/tui/src/layout.test.ts`, and `apps/tui/src/state.test.ts`
- E2E journeys under `tests/e2e/`
- Verifiers under `scripts/verify-*.mjs`, especially
  `verify-skeptical-browse-search.mjs`,
  `verify-skeptical-tui-full-snapshot.mjs`, and
  `verify-real-layout-sync-recall.mjs`
- `docs/design/UX_IMPROVEMENT_PLAN.md`
- `apps/tui/ARCHITECTURE.md`
- Stable adapter roster in
  `packages/source-adapters/src/platforms/registry.ts`

## Inventory

This table preserves the findings as they were classified at the start of R37.
Closure evidence is recorded in Current Progress and Final Quality Gate below.

| ID | Finding | Classification | Required regression layer |
| --- | --- | --- | --- |
| R37-AUDIT-001 | TUI `detailScrollOffset` resets on ordinary selection movement but was documented as not resetting after `g`/`G` jump navigation. | fix-now | TUI reducer regression in `apps/tui/src/state.test.ts` |
| R37-AUDIT-002 | TUI overlay flags were only partly mutually exclusive: stats and source health cleared each other, but help could coexist with either overlay. | fix-now | TUI reducer regression in `apps/tui/src/state.test.ts` plus existing renderer overlay tests |
| R37-AUDIT-003 | TUI `conversationScrollOffset` reset semantics are weaker than the stated invariant. Entering conversation resets it, but selection-changing actions also need explicit coverage. | fix-now | TUI reducer regression in `apps/tui/src/state.test.ts` |
| R37-AUDIT-004 | TUI `useInput` could branch on a render-time state snapshot during fast key sequences, even though state updates used the latest reducer state. | fix-now | Latest-state input resolver plus reducer-level keyboard-flow test; do not treat static snapshot tests as enough |
| R37-AUDIT-005 | `apps/cli/src/test/commands-agent.test.ts` contains two skipped remote-agent placeholders. Pair/pull command paths can be locally mocked; long-lived managed service review stays owned by R35. | fix-now | CLI command tests with a short-lived local HTTP server or in-process harness |
| R37-AUDIT-006 | CLI `show turn` rendered raw `canonical_text` under a generic `Text` section by default. This could expose long boilerplate even though search uses `pickSearchSnippet()`. | fix-now | CLI command-path test for human output plus JSON preservation of full evidence |
| R37-AUDIT-007 | CLI `ls sessions` had compact and long output paths, but package tests did not assert compact-vs-long behavior strongly enough to guard wrapping-prone columns. | fix-now | CLI package test or skeptical verifier using real built CLI |
| R37-AUDIT-008 | CLI command-path coverage was strongest for sync, browse, search, missing turn/session, and bundle restore. It was still thin for ambiguous identifiers, source-health output, default store resolution after sync, and admin read paths. | fix-now | CLI package tests plus focused verifier assertions where built entrypoints matter |
| R37-AUDIT-009 | TUI coverage included reducers, snapshots, layout tests, source health, stats, and full-scan snapshots, but did not yet drive realistic key sequences through browse -> detail -> conversation -> back and search -> drill-down. | fix-now | TUI interaction harness or equivalent reducer-level keyboard-flow verifier |
| R37-AUDIT-010 | True E2E real-layout coverage only exercised five stable adapters: `gemini`, `opencode`, `openclaw`, `codebuddy`, and `cursor`. The stable roster also includes `codex`, `claude_code`, `factory_droid`, `amp`, and `antigravity`. | fix-now | `tests/e2e/` or `verify-real-layout-sync-recall.mjs` expanded to fixture-backed stable adapters, with explicit blockers for missing real layouts |
| R37-AUDIT-011 | E2E API parity uses Fastify `inject()` rather than a real short-lived HTTP listener. | fix-now | E2E journey using `app.listen()` on an ephemeral port and `fetch()` |
| R37-AUDIT-012 | UX plan items for TUI conversation drill-down, session grouping, stats overlay, and page/jump navigation appeared implemented, but needed stronger interaction coverage before being considered durable. | fix-now | TUI reducer/renderer/interaction coverage tied to those paths |
| R37-AUDIT-013 | UX plan items for in-project search, fuzzy project filtering, relative timestamps across all surfaces, and token usage in TUI turn rows are useful feature work but not required before the R37 quality bar can become repeatable. | defer | Documented defer rationale; revisit after R37 quality gate is green |
| R37-AUDIT-014 | CLI help grouping and color coverage are partly product-polish concerns. Color helpers are in use; help grouping still needs a separate UX pass. | needs-more-evidence | CLI snapshot or command-output tests after deciding final help structure |

## Immediate Fix Order

1. Close the local TUI reducer risks first because they already have precise
   state-level reproduction points and low blast radius.
2. Replace locally mockable remote-agent skips with real tests, while leaving
   user-started service review under R35.
3. Add CLI command-path regressions for raw `show turn`, compact `ls sessions`,
   and ambiguous/default-store behavior.
4. Extend true E2E coverage to all stable adapters with available
   `mock_data/` layouts, then document any stable adapter fixture blockers.
5. Add a real short-lived HTTP API parity journey.
6. Document the CLI/TUI/read-side local quality gate once the above evidence is
   represented by repeatable commands.

## Current Progress

- Closed R37-AUDIT-001, R37-AUDIT-002, and R37-AUDIT-003 with reducer fixes
  and state tests in `apps/tui/src/browser.ts` and
  `apps/tui/src/state.test.ts`.
- Closed R37-AUDIT-004 by moving keyboard mapping into
  `apps/tui/src/input.ts` and making `apps/tui/src/app.tsx` dispatch from a
  latest-state ref instead of a render-time snapshot.
- Closed R37-AUDIT-005 by replacing skipped remote-agent placeholders with
  mock-server CLI tests in `apps/cli/src/test/commands-agent.test.ts`.
- Closed R37-AUDIT-006 with default `show turn` prompt summaries, `--long`
  full human output, and JSON preservation of full `canonical_text`.
- Closed the compact-vs-long coverage part of R37-AUDIT-007 with CLI package
  tests for `ls sessions`.
- Tightened skeptical browse/search verifier coverage so default search output
  stays compact while `--long` proves session pivots and related-work context.
- Closed R37-AUDIT-008 with CLI package tests for ambiguous session/turn
  prefixes, default-store sync/read behavior across working directories,
  source-health JSON, and store-only health/admin read output.
- Repaired stale TUI layout assertions so `apps/tui` layout tests now cover the
  current metadata header and clipped project labels.
- Closed R37-AUDIT-009 and R37-AUDIT-012 with reducer/input tests for
  realistic browse, search, conversation drill-down, overlays, escape, page,
  and jump navigation paths.
- Closed R37-AUDIT-010 by expanding
  `tests/e2e/journey-e-real-layout.test.mjs` and
  `scripts/verify-real-layout-sync-recall.mjs` across all ten stable adapters
  that have fixture-backed real layouts.
- Closed R37-AUDIT-011 with `tests/e2e/journey-f-real-http-api.test.mjs`,
  which starts a short-lived Fastify listener on an ephemeral localhost port
  and compares HTTP API reads with built CLI output.
- Closed the repeatable quality-gate requirement with
  `pnpm run verify:cli-tui-read-side`, documented in
  `docs/design/V1_VALIDATION_STRATEGY.md`, `README.md`, and `README_CN.md`.
  The gate passed on 2026-05-15.

## Final Quality Gate

Default local command:

```bash
pnpm run verify:cli-tui-read-side
```

This gate runs the CLI package tests, TUI state and layout tests, API build,
true E2E journeys, skeptical browse/search verifier, and real-layout
sync-to-read verifier sequentially. It does not start persistent API or Web
services; Journey F uses only a short-lived localhost listener for HTTP parity.

## Deferred Items

- In-project TUI search: useful, but it changes search scope semantics and
  should be designed after keyboard-flow coverage exists.
- Fuzzy project filtering: useful productivity work, but not a release-blocking
  reliability defect.
- TUI token counts in turn rows: useful density improvement, but lower risk
  than navigation, detail, and parity regressions.
- Cross-surface relative timestamp alignment: already partially present in CLI
  and TUI; broader alignment belongs in a focused presentation pass.
