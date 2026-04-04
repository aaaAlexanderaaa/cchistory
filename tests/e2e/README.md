# Journey Tests

Automated journey tests for CCHistory, covering the full user workflow through CLI and API surfaces.

## Prerequisites

```bash
pnpm run build          # build all packages
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

Data is seeded **in-process** via `CCHistoryStorage.replaceSourcePayload()`, bypassing the parse → link → resolve pipeline. CLI commands run **out-of-process** (real child process). API calls use Fastify's `inject()` (in-process HTTP simulation, not real TCP).

**What they verify:** Cross-surface consistency (CLI and API agree on the same data), command output shape, export/import round-trip, read-only invariant.

**What they don't cover:** Adapter parsing, file discovery, project linking — the most complex and error-prone parts of the pipeline.

### True E2E test (Journey E)

Data starts as **real files on disk** (from `mock_data/`). The test runs `cchistory sync` as a child process, which exercises the full pipeline: discover → parse → link → resolve → store. Five adapters participate (gemini, opencode, openclaw, codebuddy, cursor).

**What it verifies:** That the complete pipeline produces correct sources, sessions, projects, and search results from real file layouts.

## Test Journeys

| File | Type | What it validates |
|------|------|-------------------|
| `journey-a-*` | Integration | Multi-source project recall: CLI and API agree on projects, turns, sources |
| `journey-b-*` | Integration | Search → show turn → show session drill-down chain; context attached |
| `journey-c-*` | Integration | Health/stats/ls are read-only; missing store handled explicitly |
| `journey-d-*` | Integration | Export → import → restore-check → search survives round-trip |
| `journey-e-*` | **E2E** | Real file layouts → sync → verify sources, sessions, projects, search, API |

## Architecture

- **`helpers.mjs`** — CLI runner (`execFile`, out-of-process), API server lifecycle (`Fastify.inject`), temp store, mock data seeding, acceptance payload builder.
- Tests use `node:test` (built-in test runner, Node ≥ 22).
- Each journey creates an isolated temp directory and tears it down after.
- SQLite experimental warning is suppressed in the test runner process.

## Future improvements

- [ ] Add real HTTP tests (start Fastify on a port, use `fetch()`) for true API E2E
- [ ] Add more Journey E-style tests for remaining adapters (codex, claude_code, amp)
- [ ] Add Web E2E tests (Next.js + Playwright)

## Adding a New Journey

1. Create `journey-f-<name>.test.mjs`
2. Import helpers from `./helpers.mjs`
3. Use `createTempRoot()` / `removeTempRoot()` for isolation
4. Choose seeding strategy:
   - `seedAcceptanceStore()` — for integration tests with controlled data
   - `seedRealLayoutHome()` — for E2E tests using real file layouts
5. Assert via `runCliJson()` (CLI) and `apiGet()` (API)
