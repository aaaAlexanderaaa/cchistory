# Journey Tests

Automated journey tests for CCHistory, covering user workflows through CLI and
API surfaces. These are not all equally deep: some seed canonical projections
directly, while others start from source-shaped files or short-lived HTTP.

## Prerequisites

```bash
pnpm run build          # build the non-web workspace packages
```

## Running

```bash
# All journey tests
pnpm run test:e2e

# Single journey
node --test tests/e2e/journey-a-multi-source-recall.test.mjs
```

## Test Classification

These tests live under `tests/e2e/` but have different levels of integration:

### Integration tests (Journey A–D)

Data is seeded **in-process** via `CCHistoryStorage.replaceSourcePayload()`,
bypassing adapter discovery and parsing. CLI commands run **out-of-process**
(real child process). API calls use Fastify's `inject()` unless noted.

**What they verify:** Cross-surface consistency, command output shape,
export/import round-trip, and read-only invariants.

**What they don't cover:** Adapter parsing and file discovery. Those need
source-shaped tests or verifier scripts.

### True E2E test (Journey E)

Data starts as **real files on disk** (from `mock_data/`). The test runs
`cchistory sync` as a child process, exercising discover → parse → link →
resolve → store. All stable adapters with repository fixtures participate
(codex, claude_code, factory_droid, amp, cursor, antigravity, gemini,
openclaw, opencode, codebuddy).

**What it verifies:** The complete pipeline produces expected sources,
sessions, projects, and search results from real file layouts.

### Real HTTP parity (Journey F)

Journey F starts a short-lived Fastify listener on an ephemeral localhost port
inside the test process and calls it with `fetch()`. This is not a persistent
managed API service and does not satisfy the user-started service review work
tracked elsewhere.

**What it verifies:** CLI/API parity through a real TCP HTTP boundary for the
seeded acceptance slice.

### Verifiers Outside `test:e2e`

Some heavier or more operator-shaped checks intentionally live outside the
default E2E glob:

- `scripts/verify-real-layout-sync-recall.mjs` mirrors Journey E with
  additional built CLI/API/TUI assertions.
- `scripts/verify-related-work-recall.mjs` checks delegated-session and
  automation-run related work, including generated Claude parent-to-child and
  child-to-parent fanout.
- `scripts/verify-scale-recall.mjs` generates a temporary Codex/Claude store
  with 2400 turns across 24 sessions and verifies browse/search/detail paths.

## Test Journeys

| File | Type | What it validates |
|------|------|-------------------|
| `journey-a-*` | Integration | Multi-source project recall: CLI and API agree on projects, turns, sources |
| `journey-b-*` | Integration | Search → show turn → show session drill-down chain; context attached |
| `journey-c-*` | Integration | Health/stats/ls are read-only; missing store handled explicitly |
| `journey-d-*` | Integration | Export → import → restore-check → search survives round-trip |
| `journey-e-*` | **E2E** | Real file layouts → sync → verify sources, sessions, projects, search, API |
| `journey-f-*` | Real HTTP | Seeded CLI/API parity through a short-lived TCP listener |

## Architecture

- **`helpers.mjs`** — CLI runner (`execFile`, out-of-process), API server lifecycle (`Fastify.inject`), temp store, mock data seeding, acceptance payload builder.
- Tests use `node:test` (built-in test runner, Node ≥ 22).
- Each journey creates an isolated temp directory and tears it down after.
- SQLite experimental warning is suppressed in the test runner process.

## Future improvements

- [ ] Add more Journey E-style assertions when stable adapter fixture scenarios expand
- [ ] Add Web E2E tests once user-started service review constraints are satisfied

## Adding a New Journey

1. Create `journey-g-<name>.test.mjs` or the next available lettered journey
2. Import helpers from `./helpers.mjs`
3. Use `createTempRoot()` / `removeTempRoot()` for isolation
4. Choose seeding strategy:
   - `seedAcceptanceStore()` — for integration tests with controlled data
   - `seedRealLayoutHome()` — for E2E tests using real file layouts
   - Generated source-shaped temp roots — for heavier verifier scripts that
     should not enter the default E2E glob
5. Assert via `runCliJson()` (CLI) and `apiGet()` (API)
