# T1 TUI Runtime Path Decision

## Status

- Objective: `T1 - Canonical TUI`
- KR: `T1-KR2 Architecture and toolkit decision`
- Backlog task closed by this note: `evaluate TUI runtime path across direct store, API client, and shared presentation options`
- Date: 2026-04-01

## Decision

Choose a **local direct-store runtime path with shared projection helpers**, not an API-client-only TUI.

The canonical TUI should:

1. open the local CCHistory store using the same default-store and read-mode rules as the CLI,
2. read canonical objects from storage without requiring a managed API process,
3. reuse shared projection and presentation logic wherever possible,
4. extract duplicated read/projection helpers out of CLI and API as implementation begins,
5. avoid inventing terminal-only semantics or a separate local-vs-remote data model.

In short:

- **chosen path for v1:** `storage -> shared projection/presentation helpers -> TUI`
- **not chosen for v1:** `TUI -> local API client -> managed API service`
- **explicitly rejected:** `storage -> TUI-only ad hoc mapping`

## Why This Path Wins

### Lens A: System Consistency

The design freeze requires one semantic pipeline and treats UI/API as projections of the same canonical objects.

A TUI that talks only to the API client would reuse DTO contracts, but it would also make the terminal surface depend on a managed service that the CLI does not require. That adds a runtime boundary that is not part of the local operator workflow today.

A TUI that reads storage directly but builds its own bespoke mappings would be worse: it would preserve local operation, but it would fork read semantics from API and web.

The best fit is therefore:

- keep **storage** as the local source of truth for terminal operation,
- keep **shared projection/presentation** as the semantic reuse layer,
- move any duplicated API/CLI read-side mapping into reusable helpers as the TUI is implemented.

### Lens B: User Workflow

The TUI is justified as a richer terminal-native recall surface for the same users who already use the CLI. Those users should not have to start or maintain a long-lived API service just to browse local history in a terminal.

Direct-store access preserves:

- the CLI's current `--store` / default-store behavior,
- offline local inspection,
- fast read-only startup for project recall, search, and session drill-down,
- compatibility with the repository rule that agents must not manage persistent dev services.

Requiring the API would make the TUI feel like a thin web substitute instead of a native terminal tool.

### Lens C: Implementation Risk

The current repository already has three relevant layers:

- `@cchistory/storage` for canonical persisted projections,
- API route summarizers/read paths in `apps/api`,
- `@cchistory/presentation` for DTO-to-UI mapping used by web-facing clients.

Today, the shared layer is incomplete for a TUI because the reusable read-side facade is not fully extracted yet. But this is still the lowest-risk path:

- extracting shared read/projection helpers is incremental and locally testable,
- the TUI can ship read-only workflows before any remote-runtime story exists,
- the API client remains valuable later for a possible remote/admin TUI mode, without forcing it into v1.

By contrast, starting with API-client-only TUI would front-load service coupling, runtime coordination, and failure modes that do not help the first delivery slice.

## Options Considered

### Option 1: Direct Store Only, TUI-Specific Mapping

**Result:** rejected.

Pros:

- simplest local runtime,
- no service dependency,
- easy to prototype quickly.

Cons:

- duplicates API/CLI read semantics,
- risks drift in turn/session/project presentation,
- violates the spirit of one semantic pipeline.

### Option 2: API Client Only

**Result:** rejected for v1.

Pros:

- reuses HTTP contracts and DTOs,
- naturally aligns with web-facing data shapes,
- could support remote access later.

Cons:

- requires a managed API runtime for basic terminal browsing,
- weak fit for local/offline operator workflows,
- introduces avoidable startup and failure dependencies,
- conflicts with the current product shape where the CLI reads local storage directly.

### Option 3: Direct Store Plus Shared Projection/Presentation Helpers

**Result:** chosen.

Pros:

- preserves local CLI-style operation,
- supports offline/read-only TUI workflows,
- keeps one semantic pipeline by sharing projection logic,
- allows later layering of API-client mode behind the same TUI view model if needed.

Cons:

- requires some refactoring to extract reusable read-side helpers,
- cannot simply drop in the existing web stack unchanged.

## Concrete Runtime Rule For TUI V1

The first canonical TUI should behave like a stateful read-side CLI, not like a browser shell for the managed API.

That means:

- resolve the data dir exactly like the CLI,
- support indexed vs full-scan read modes using the same source/store rules,
- consume canonical turn/session/project data from storage,
- reuse shared presentation models for list/detail rendering,
- treat HTTP/API access as a future compatibility layer, not the default runtime path.

## Consequences For Implementation

Before implementing screens, the codebase should extract a shared read-side adapter layer that can:

- list projects,
- list/search turns,
- resolve session and turn detail,
- summarize source health,
- provide the same projection inputs to CLI, API, and TUI.

This keeps the TUI from importing route-local API summarizers or reimplementing CLI-only formatting logic.

## Follow-On Work

This decision implies the next architecture task should choose a TUI toolkit that works well with:

- persistent panes and list/detail navigation,
- async local queries and search,
- incremental rendering of turn/context detail,
- a read-first operator workflow.

It also implies the first delivery slice should validate:

- one shared read facade,
- one TUI entrypoint,
- targeted tests for project list, search results, and turn/session drill-down.
