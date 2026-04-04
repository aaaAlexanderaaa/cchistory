# V1 Validation Strategy

> Consolidated from R40, R42, and V1_GOAL_LEVEL_E2E_VALIDATION on 2026-04-04.

## Product Goals Under Validation

1. **Recall** — recover what was asked in a project across multiple sessions and source platforms.
2. **Traceability** — from a recovered `UserTurn`, inspect linked session, assistant/tool context, and evidence.
3. **Administration** — inspect source health and system state without silently mutating storage.
4. **Supply** — canonical derived history survives export/import/restore and remains readable.
5. **One semantic pipeline** — CLI, API, web, and TUI behave as projections of one canonical model.

## Validation Principles

- Judge the product by user jobs, not package boundaries.
- Prefer goal-level workflows over shallow snapshots.
- Use real data review where truth depends on real layouts.
- Verify read surfaces do not invent state.
- Fail on semantic mismatch, not just thrown errors.

## Canonical Validation Journeys

| Journey | Goal | Key Pass Conditions |
| --- | --- | --- |
| **A — Multi-source project recall** | Project-first recall across heterogeneous sources | Target project shows turns from multiple sources; unrelated projects don't bleed; ordering is canonical recent-first |
| **B — Search → traceability drill-down** | System is searchable AND traceable | Same `turn_id` across surfaces; detail exposes canonical text + session/source cues; assistant/tool context attached |
| **C — Read-only admin / source-health** | Health is truthful, reads don't mutate | Health counts match store state; missing-store is explicit and non-mutating; no silent DB creation |
| **D — Supply / restore readability** | Canonical objects survive export/import | Sources, sessions, turns readable after restore; known recall path survives intact |
| **E — Real-layout truthfulness** | Truthful about adopted experimental slices | Fixtures reflect observed real layouts; experimental slices clearly bounded |

## Automated Verifier Surface

### Core verifiers

| Command | Coverage |
| --- | --- |
| `pnpm run verify:v1-seeded-acceptance` | Seeded CLI/API/TUI parity for multi-source recall, traceability, source summaries, and export→import→restore-check readability |
| `pnpm run verify:read-only-admin` | Store-scoped CLI/TUI/API read-only admin visibility plus missing-store truthfulness |
| `pnpm run verify:fixture-sync-recall` | Clean-store sync from `mock_data/` default roots into canonical recall/search/drill-down via CLI/API/TUI |
| `pnpm run verify:bundle-conflict-recovery` | Populated-target conflict visibility, dry-run, skip/replace, restore-check, CLI/API readback |
| `pnpm run verify:real-layout-sync-recall` | Real-layout fixture slice (gemini, opencode, openclaw, codebuddy, Cursor chat-store) sync-to-read |
| `pnpm run verify:related-work-recall` | Delegated child-session and automation-run traceability across CLI/API/TUI |
| `pnpm run verify:real-archive-probes` | Archive-truthfulness for Gemini, Cursor chat-store, CodeBuddy, OpenCode review assumptions |

### Skeptical and extended verifiers

| Command | Coverage |
| --- | --- |
| `pnpm run verify:skeptical-cli-bundle-restore` | Skeptical operator backup/restore/conflict behavior |
| `pnpm run verify:skeptical-browse-search` | Skeptical CLI/TUI browse/search readability and parameter-scoped search |
| `pnpm run verify:skeptical-tui-full-snapshot` | TUI `--full` indexed-store, combined-overlay, and missing-store snapshots |
| `pnpm run verify:local-full-read-bundle` | Grouped local full-read confidence pass (CLI artifact + TUI `--full`) |
| `pnpm run verify:cli-artifact` | Installed standalone CLI artifact through skeptical workflows |

### Infrastructure verifiers

| Command | Coverage |
| --- | --- |
| `pnpm run verify:support-status` | README/runtime/release-gate support claims vs adapter registry |
| `pnpm run verify:clean-install` | Documented clean-install path on a fresh repository copy |
| `pnpm run verify:web-build-offline` | Offline web production build gate |

## Local Manual Test Matrix

### CLI bundle / restore workflow

- **Prerequisite**: built CLI via `pnpm --filter @cchistory/cli build`
- **Setup**: temp HOME with local Codex fixture root plus separate source/target stores
- **Core commands**: `sync`, `backup` (preview + write), `import` (default/dry-run/skip/replace), `restore-check`
- **Automated counterpart**: `pnpm run verify:skeptical-cli-bundle-restore`

### CLI/TUI browse / search / full snapshot workflow

- **Prerequisite**: built CLI and TUI
- **Setup**: temp HOME seeded from repo `mock_data/.claude` and `mock_data/.openclaw`
- **Core commands**: `sync`, `ls projects/sessions --long`, `search` (with `--project`, `--source`, `--limit`), `show turn/session`, `tree project/session --long`, TUI browse/search/`--full`
- **Automated counterparts**: `verify:skeptical-browse-search`, `verify:skeptical-tui-full-snapshot`, `verify:local-full-read-bundle`

## Still-Blocked Manual / Runtime Review Queue

| ID | Prerequisite | Contract |
| --- | --- | --- |
| `R31-KR1` — Seeded web review diary | User starts API + web services | `docs/design/R27_USER_STARTED_WEB_REVIEW_CHECKLIST.md` |
| `R31-KR2` — Managed API read diary | User starts API service | `docs/design/R31_MANAGED_API_READ_DIARY_CONTRACT.md` |
| `R35-KR1` — Remote-agent pair/upload/schedule | User starts API service | `docs/design/R29_REMOTE_AGENT_VALIDATION_CONTRACT.md` |
| `R35-KR2` — Remote-agent leased-pull | User starts API + creates admin job | `docs/design/R29_REMOTE_AGENT_VALIDATION_CONTRACT.md` |

## Grouped Verifier Results (2026-04-03)

All core and skeptical local verifiers passed on 2026-04-03:

- **Core bundle (6/6 passed)**: `v1-seeded-acceptance`, `read-only-admin`, `fixture-sync-recall`, `bundle-conflict-recovery`, `real-layout-sync-recall`, `related-work-recall`
- **Skeptical bundle (3/3 passed)**: `skeptical-cli-bundle-restore`, `skeptical-browse-search`, `cli-artifact`
- **Extended (3/3 passed)**: `skeptical-tui-full-snapshot`, `local-full-read-bundle`, `support-status`
- **Infrastructure (2/2 passed)**: `clean-install`, `web-build-offline`

### Notable fix during test closure

`R41` root cause: multi-term search could append extra turns when only part of the query matched session metadata. The storage-layer session match now requires the full query term set.

## Session Execution Rule

When no user-started services are available:

1. Run `pnpm run verify:local-full-read-bundle` as the default local confidence pass.
2. If that surface changed, run drift guards: `node --test scripts/verify-local-full-read-bundle.test.mjs` and `node --test scripts/verify-cli-artifact.test.mjs scripts/verify-local-full-read-bundle.test.mjs`.
3. Use `docs/design/R121_CONSOLIDATED_SKEPTICAL_LOCAL_FLOW_DIARY_2026-04-03.md` for contiguous skeptical-user walkthroughs.
4. Keep `R31` and `R35` blocked until the user provides running services.
5. Do not reopen LobeChat scope without new user-provided real data.

## Completed Manual Review Diaries

- `R25` — Skeptical CLI backup/import conflict/restore-check review
- `R32` — Skeptical CLI/TUI browse/search review
- `R48` — Local manual CLI/TUI diary
- `R59` — Skeptical manual parameter drill-down
- `R63–R65` — Installed-artifact and source-tree parameter/admin/query diaries
- `R70–R75` — TUI source-health/help and CLI discover/health diaries
- `R86–R88` — Installed-artifact and source-tree full-read diaries
- `R95` — TUI full snapshot diary
- `R101` — TUI `--full` edge diary
- `R121` — Consolidated skeptical local flow diary

## Pass/Fail Rules

A validation slice **fails** if:
- A read surface silently creates a missing store and presents empty data
- The same seeded project/turn resolves differently across surfaces
- A surface can search a turn but cannot trace it to linked session/context
- Project-first grouping breaks with multi-source turns
- Restore succeeds mechanically but history is not readable
- Experimental source claims exceed real archive/fixture evidence

A validation slice **passes** only when:
- Canonical journeys succeed on defined inputs
- Cross-surface semantic agreement is explicitly checked
- Real-layout-dependent claims are reviewed against available archive
- Read-only surfaces remain non-mutating
- Supporting package-scoped regressions are green
