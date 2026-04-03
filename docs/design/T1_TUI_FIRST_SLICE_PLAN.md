# T1 TUI First Slice Plan

## Status

- Objective: `T1 - Canonical TUI`
- KR: `T1-KR3 First delivery slice planning`
- Task closed by this note: `define the first TUI slice acceptance, fixture needs, and validation plan`
- Date: 2026-04-01

## First Slice

The first canonical TUI slice should be a **read-first local Ink app** that
supports four user-visible jobs:

1. browse projects,
2. inspect turns inside the selected project,
3. drill into turn/session/context detail,
4. run global search and inspect results without leaving the TUI.

A lightweight source-health panel is included if it can be implemented on top
of the same shared read facade without inventing separate semantics.

## Explicitly In Scope

- canonical local TUI entrypoint
- project list pane
- project turn list pane
- turn detail/context pane
- global search mode with result-to-detail drill-down
- basic status/footer showing read mode and store path
- optional lightweight source-health summary panel

## Explicitly Out Of Scope For The First Slice

- mutation-heavy admin flows
- import/export/backup wizards
- full linking override editing
- mask editing
- drift remediation authoring
- source-specific raw evidence debugging panes
- remote/API-required TUI operation as the default mode

## Acceptance For Slice 1

The slice is acceptable when all of the following are true:

- the TUI launches against the same local store resolution rules as the CLI,
- the user can move across project list, turn list, and detail pane entirely by keyboard,
- the selected turn detail preserves canonical text plus linked session/source cues,
- search results can be browsed and drilled into without dropping the result set,
- the TUI does not require a managed API service for local recall,
- the implementation reuses one shared read/projection pipeline rather than TUI-only mapping logic.

## Fixture Needs

The first implementation slice does not need a brand-new fixture family.
It should start from existing sanitized sources and existing seeded-store test
patterns already used by CLI/API/source-adapter coverage.

### Minimum Fixture Coverage

- one multi-project local store with at least two committed projects,
- turns from more than one source platform,
- one searchable prompt phrase that drills into a real turn,
- one session with inspectable context/assistant/tool detail,
- one source-health case with visible counts/status values.

### Preferred Fixture Strategy

Use a small seeded temporary store in TUI tests, reusing the same canonical
storage objects already exercised by CLI and API tests, instead of introducing
TUI-only semantics into raw source fixtures first.

## Validation Plan

Once the TUI package exists, the first slice should validate with targeted,
package-scoped commands only.

### Expected Commands

- `pnpm --filter @cchistory/tui build`
- `pnpm --filter @cchistory/tui test`

### Expected Test Focus

- project list renders committed projects in recent order,
- keyboard focus changes panes predictably,
- selecting a turn updates the detail pane,
- search mode returns results and preserves drill-down state,
- the TUI can open in index mode and full-scan mode using shared store rules.

## Recommended Implementation Order

1. extract shared read facade from current CLI/API read-side logic,
2. scaffold canonical TUI entrypoint and store opening path,
3. implement project list + turn list + detail pane,
4. add search mode,
5. add lightweight source-health summary,
6. add focused TUI tests.

## Backlog Consequence

This note is enough to move TUI work from planning into implementation. The
next KR should own the first canonical TUI build slice directly rather than
re-opening scope decisions.

## Phase 7 - Holistic Evaluation

- Date: 2026-04-01
- Scope evaluated: `T1 - Canonical TUI`
- Environment note: `PIPELINE.md` recommends a fresh agent context for Phase 7. This pass was recorded in the same implementation session because the repository currently has a single active agent context.

### Boundary Evaluation

- The TUI remains a projection of the canonical local read pipeline.
- Search drill-down and source-health summary reuse `packages/storage` read-side helpers instead of adding TUI-only persistence or derivation semantics.
- Source-specific detail stays behind storage/domain projections; the TUI renders `UserTurn`, session, context, and source status summaries only.

### Stability Assessment

- Empty-store behavior remains explicit through snapshot rendering and test coverage.
- Search mode clamps empty and shrinking result sets instead of leaving stale selections.
- Source-health summary is read-only and uses stored source status snapshots, so it does not mutate service or sync state.

### Scalability Evaluation

- Search delegates to the storage layer's existing search path instead of scanning TUI-local state with divergent logic.
- Pane rendering stays text-compact and list-based, which is acceptable for the current terminal slice, but very large result sets may still need future windowing or pagination.

### Compatibility Assessment

- No schema migration or stored-data rewrite is introduced.
- The change compiles through the existing `@cchistory/storage` and `@cchistory/tui` package boundaries.

### Security Evaluation

- The new interactive search input remains local-only and is rendered as plain terminal text.
- No new network path, credential surface, or long-lived service dependency is introduced.

### Maintainability Assessment

- Browser state transitions stay centralized in `apps/tui/src/browser.ts`.
- Shared search and source-health projection lives in `packages/storage/src/tui-browser.ts`, keeping read-side semantics in one place.
- Focused regression tests cover pane navigation, detail rendering, search drill-down, and source-health summary behavior.

### Known Limitations Accepted

- Search mode is intentionally lightweight and does not yet add pagination, raw-evidence expansion, or inline snippet highlighting.
- Source health is summary-only in TUI v1; deeper remediation and linking review remain better served by CLI/web for now.

## Result

Phase 7 evaluation passes for the repository-visible `T1` scope. The canonical TUI now supports project browsing, turn drill-down, search drill-down, lightweight source-health review, and richer read-side detail cues such as project/session/turn breadcrumbs plus related-work trail lines on top of the shared local read pipeline.
