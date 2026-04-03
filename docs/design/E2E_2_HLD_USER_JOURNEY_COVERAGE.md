# E2E-2 - High-Level-Design User Journey Coverage

## Status

- Objective: `E2E-2 - High-Level-Design User Journey Coverage`
- Backlog status after this note: `done`
- Phase reached: `E2E-2` completed, regression-covered, and evaluated on
  2026-03-29
- Scope: derive a truthful journey matrix from
  `HIGH_LEVEL_DESIGN_FREEZE.md`, classify automation feasibility, and record
  concrete user-visible gap cases before broader acceptance implementation

## Phase 1 - Domain Understanding

### Problem statement

`HIGH_LEVEL_DESIGN_FREEZE.md` defines four user-facing jobs for the product:
recall, traceability, administration, and supply. The repository already has
many focused regressions plus one representative end-to-end story under
`E2E-1`, but those proofs are still scattered by command, layer, or release
gate. The backlog therefore lacked one explicit matrix that answers the user
questions the design freeze actually cares about:

1. what the user starts with
2. what the user is trying to obtain
3. which canonical CLI/API steps form the journey
4. what observable outcome proves success
5. whether that journey is automatable on this host today
6. which fixture or runtime preconditions the journey still needs

Without that matrix, the repository risks overfitting future acceptance work to
the single existing recall story or to whichever bug was reported most recently.

### What already exists

The current repository already provides enough surface area to derive a truthful
journey inventory:

- `docs/design/E2E_1_PRIMARY_USER_STORY_ACCEPTANCE.md` proves one same-project,
  multi-agent recall path through CLI `sync`, project discovery, search, and
  session-context inspection.
- `apps/cli/src/index.test.ts` already covers user-visible slices of search,
  `show turn`, `show session`, session-reference lookup, `health`, export,
  import, and the bundle restore path.
- `apps/api/src/app.test.ts` already proves the managed API exposes search,
  turn context, project-turn listing, linking overrides, drift, masks, and
  replay-related surfaces together.
- `docs/design/CURRENT_RUNTIME_SURFACE.md`, `docs/guide/cli.md`, and
  `docs/guide/api.md` document the currently canonical CLI and API entrypoints.

### Constraints and boundaries

- The design freeze requires UI, CLI, and API to remain projections of the same
  canonical model. Journey definitions therefore must reuse existing canonical
  commands and routes rather than inventing workflow-only semantics.
- The repository rules forbid the agent from starting managed services. Any API
  or web journey that depends on `pnpm services:*` must be classified as
  user-started managed-runtime/manual rather than silently treated as locally
  automatable.
- This objective is about user-observable workflows. Hidden storage assertions
  are supporting evidence, not the primary proof format.
- Sanitized fixtures should be reused where possible. New fixture work should
  only be added when an HLD-owned journey cannot be covered truthfully with the
  current corpus.

### Gaps confirmed

1. No current document inventories all four frozen user jobs as concrete,
   canonical journeys.
2. The search-result-to-drill-down path is only partially encoded today: one
   test proves that search output prints a `show turn` reference, and another
   path drills down through JSON IDs, but no single acceptance story yet proves
   the contiguous user-facing chain from shown search result to full turn and
   parent session.
3. The 2026-03-29 review raised messy histories with repeated or
   automation-shaped user turns, yet no explicit fixture-backed journey records
   how those turns should be retrieved and inspected.
4. Programmatic supply-side retrieval exists through `query` and the managed
   API, but there is not yet a chained acceptance story that treats structured
   retrieval as a first-class user goal.
5. Administration coverage exists in slices (`health`, bundle export/import,
   drift/linking endpoints), but it is not yet organized as a user-journey map
   that distinguishes fully automatable from managed-runtime/manual paths.

## Phase 2 - Test Data And Runtime Preconditions

### Existing reusable inputs

- The repo `mock_data/` home layout already powers the strongest current recall
  fixture, including the same-project `history-lab` scenario across multiple
  coding-agent platforms.
- The CLI test helpers already support temporary HOME/store setup, fixture
  seeding, and JSON-capable command assertions without starting services.
- Existing export/import tests already provide a clean-directory restore harness
  for administration journeys.
- API runtime tests can inject requests against `createApiRuntime(...)` without
  relying on persistent service lifecycle commands.

### Missing or incomplete inputs

- The current `J3` baseline now reuses the documented
  `claude-workspace-path` and `claude-local-command-meta-noise` scenario pair,
  so no new raw fixture capture is required for this objective.
- Managed API and web journeys still depend on user-started services and
  therefore remain classified as manual or managed-runtime-only coverage until
  the user provides that runtime.

## Phase 3 - Functional Design

### Journey matrix

| Journey ID | HLD job | Initial operator state | User intent | Canonical chain | Observable result | Current proof status | Automation class on this host | Fixture / runtime needs | Backlog follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `J1-recall-same-project-cli` | Recall | Temp HOME plus repo `mock_data/` roots; empty temp store | Recover what was asked in one project across multiple coding agents | `cchistory sync` → `cchistory ls projects` / `cchistory tree project <id>` → `cchistory search --project <id>` | One committed project contains the expected sessions/turns across multiple platforms, and project-scoped search returns the known ask | Covered today by `E2E-1` plus existing CLI sync/list/search assertions | Fully automatable | Existing `mock_data/` `history-lab` scenario | Keep as the baseline recall journey for `E2E-2-KR2` |
| `J2-trace-search-to-turn-session` | Traceability | Indexed store with at least one search hit | Move from a shown search result to the full turn and then to its parent session context | `cchistory search <query>` → `cchistory show turn <shown-id>` → `cchistory show session <session-ref>` (baseline) and optionally `cchistory tree session <session-ref> --long` for hierarchy-first nearby-turn / related-work context | The shown search reference is discoverable, the full turn is readable, and the parent session reveals surrounding context, with `tree session --long` available when the operator wants the richer hierarchy view | Covered today by the dedicated CLI shown-id drill-down acceptance test plus the shipped `R24` browse expansion | Fully automatable | Existing CLI fixtures are sufficient; `history-lab` seeds the baseline | Keep as the baseline search-result drill-down journey, now with the richer `tree session --long` continuation recorded explicitly |
| `J3-trace-repeated-or-automation-turns` | Traceability | Indexed store containing repeated or automation-shaped user turns in one project or session family | Inspect similar-looking turns without losing explainability about which turn/session produced each result | `cchistory search <query>` and/or `cchistory query turns --search <query>` → `cchistory show turn <id>` → `cchistory show session <id>` (baseline) and optionally `cchistory tree session <session-ref> --long` for hierarchy-first nearby-turn / related-work context | Repeated or automation-shaped turns remain individually inspectable and traceable back to their sessions instead of becoming confusing duplicates or silent collapse, with `tree session --long` available when the operator wants the richer hierarchy view | Covered today by the CLI acceptance chain over the repeated Claude review-style prompts in distinct sessions plus the shipped `R24` browse expansion | Fully automatable | Existing `claude-workspace-path` + `claude-local-command-meta-noise` scenarios | Keep as the baseline repeated or automation-shaped traceability journey, now with the richer `tree session --long` continuation recorded explicitly |
| `J4-admin-source-health-review` | Administration | Host with source roots discovered or intentionally missing; store may or may not exist | Understand source availability, sync readiness, and whether the indexed store is present before taking action | `cchistory discover` and/or `cchistory health` | The user can see discovered paths, dry-run readiness, and whether indexed data exists without mutating the store | Covered today by `verify:read-only-admin` plus the focused `R74`/`R75` discover-and-health operator diaries, though the proof is still split across one verifier and direct operator evidence rather than one dedicated journey verifier | Fully automatable | Existing CLI seed fixtures are sufficient | Keep covered, but consider a future dedicated admin-journey verifier if one-command proof becomes important |
| `J5-admin-backup-restore-verify` | Administration | Populated source store plus empty restore target | Produce a portable backup and verify a clean restore without hidden storage-only checks | `cchistory export --dry-run` → `cchistory export` → `cchistory import` → `cchistory stats` → `cchistory ls sources` | Backup bundle contents are previewed first, restore succeeds into a clean target, and post-restore reads confirm sources/sessions/turns remain readable | Covered today by Gate `G3` CLI acceptance tests | Fully automatable | Existing CLI export/import fixtures and temp-store harness | Use as the administration baseline if `E2E-2-KR2` needs one already-proven chain |
| `J6-supply-structured-cli-query` | Supply | Indexed store with committed project and searchable turns | Retrieve canonical history as structured JSON for another agent or script without relying on text scraping | `cchistory query projects` → `cchistory query turns --project <id>` → `cchistory query turn --id <id>` and/or `cchistory query session --id <id>` | Structured JSON exposes stable IDs plus turn/session drill-down without requiring the caller to parse human text output | Covered today by the dedicated CLI structured retrieval acceptance chain | Fully automatable | Existing `mock_data/` and CLI JSON harness are sufficient | Keep as the baseline automatable supply-side CLI journey |
| `J7-supply-managed-api-read` | Supply | User-started API service against an indexed store | Retrieve canonical history over the managed API or `@cchistory/api-client` instead of the local CLI | User starts `pnpm services:start` manually → `GET /api/projects` → `GET /api/turns/search` → `GET /api/turns/{turnId}/context` (or equivalent API client calls) | A remote caller sees the same canonical project/turn/context objects through the managed API surface | Partial: route availability is tested, but no canonical managed-runtime acceptance story is automated in this environment | Managed-runtime/manual | Requires user-started API service; optional API-client harness can reuse the same route chain | Keep classified as manual/managed-runtime coverage until the user provides a running service |

### Explicit gap cases from the 2026-03-29 review

The review that created this objective surfaced two cases that must stay visible
in the journey plan instead of disappearing into generic “search coverage”:

1. **Search-result drill-down discoverability**: users must be able to move
   from the shown search reference to a full turn and then to session context
   without already knowing hidden IDs. This is captured by `J2`.
2. **Repeated or automation-shaped turn inspection**: messy histories may
   contain turns that look similar, repetitive, or partially machine-shaped but
   still need explainable retrieval and full-context inspection. This is
   captured by `J3`, which now uses the documented Claude baseline plus a CLI
   acceptance chain.

### Coverage classification summary

- **Covered today**: `J1`, `J2`, `J3`, `J4`, `J5`, and `J6` now have repository-
  visible acceptance proof or release-gate-backed operator proof on this host.
- **Additional expansion, not an objective blocker**: `J4` no longer needs to stay partial, but it is still a reasonable candidate for one future dedicated admin-journey verifier if the project wants one-command proof instead of the current verifier-plus-diary split.
- **Managed-runtime/manual**: `J7` depends on a user-started API runtime and
  remains explicitly classified that way instead of becoming an implicit gap.

## Current execution evidence

- Added a CLI acceptance test that proves the shown search reference drill-down
  path from `search` to `show turn` to `show session`, while the current CLI
  browse surface now also supports `tree session --long` as the richer nearby-
  turn / related-work continuation.
- Added a CLI acceptance test that proves structured supply-side retrieval from
  `query projects` to `query turns` to `query turn`/`query session`.
- Added a CLI acceptance test that proves repeated automation-shaped Claude
  review turns remain separately retrievable and traceable back to distinct
  sessions, with the current CLI browse surface also supporting `tree session
  --long` when the operator wants a richer hierarchy/context continuation.
- Recorded the current sanitized `J3` baseline in `mock_data/README.md` and
  `mock_data/scenarios.json` using the existing `claude-workspace-path` and
  `claude-local-command-meta-noise` scenarios.

## Phase 7 Evaluation Report

### Result

- Pass on 2026-03-29.

### Dimensions evaluated

- **Boundary evaluation**: pass. The objective closes through acceptance tests
  and fixture bookkeeping without changing frozen canonical semantics.
- **Coverage assessment**: pass. Recall, traceability, administration, and
  supply now each have at least one validated or explicitly classified journey
  recorded in one place.
- **Automation assessment**: pass. The highest-value automatable journeys for
  recall, traceability, and supply execute on this host; managed-runtime API
  coverage remains explicitly manual.
- **Maintainability assessment**: pass. The new tests reuse existing CLI
  harnesses and existing sanitized Claude scenarios rather than inventing new
  command surfaces or raw-fixture capture requirements.

### Known limitations accepted

- `J4` source-health review is now covered by the shipped verifier-plus-diary surface rather than remaining only a future expansion, even though the proof is still split across one verifier and focused operator diaries instead of one dedicated journey verifier.
- `J7` remains managed-runtime/manual because repository rules prevent the
  agent from starting persistent services.

## Conclusion

`E2E-2 - High-Level-Design User Journey Coverage` satisfies its current
acceptance criteria and can be marked `done`.
