# E2E Tests

End-to-end journey tests for CCHistory. Each test file exercises a complete user workflow through the CLI and API, using real (or realistically seeded) data.

## Prerequisites

```bash
pnpm run build          # build all packages
```

## Running

```bash
# All E2E tests
pnpm run test:e2e

# Single journey
node --test tests/e2e/journey-a-multi-source-recall.test.mjs
```

## Test Journeys

| File | Journey | What it validates |
|------|---------|-------------------|
| `journey-a-multi-source-recall.test.mjs` | Multi-source project recall | Seeded multi-platform data → project/turn/source listing via CLI and API |
| `journey-b-search-traceability.test.mjs` | Search → traceability drill-down | FTS search → show turn (with context) → show session → API agreement |
| `journey-c-readonly-admin.test.mjs` | Read-only admin / source-health | health, ls, restore-check on existing/missing stores; read-only invariant |
| `journey-d-supply-restore.test.mjs` | Supply / restore readability | export → import → restore-check → search/show on restored store |
| `journey-e-real-layout.test.mjs` | Real-layout truthfulness | Sync from `mock_data/` real layouts (gemini, opencode, openclaw, codebuddy, cursor) → verify sources, sessions, projects, search, API |

## Architecture

- **`helpers.mjs`** — shared utilities: CLI runner (out-of-process), API server lifecycle (programmatic Fastify), temp store setup/teardown, mock data seeding, acceptance payload builder.
- Tests use `node:test` (built-in test runner, Node ≥ 22).
- Each journey creates an isolated temp directory and tears it down after.
- Journey A–D use `seedAcceptanceStore()` (in-process storage seeding).
- Journey E uses `seedRealLayoutHome()` (copies `mock_data/` fixtures into a temp HOME, then runs CLI sync).

## Adding a New Journey

1. Create `journey-f-<name>.test.mjs`
2. Import helpers from `./helpers.mjs`
3. Use `createTempRoot()` / `removeTempRoot()` for isolation
4. Choose seeding strategy: `seedAcceptanceStore()` for controlled data, `seedRealLayoutHome()` for real fixture sync
5. Assert via `runCliJson()` (CLI) and `apiGet()` (API)
