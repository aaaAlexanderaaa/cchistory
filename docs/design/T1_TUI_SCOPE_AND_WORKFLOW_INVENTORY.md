# T1 Canonical TUI Scope And Workflow Inventory

## Status

- Objective: `T1 - Canonical TUI`
- Backlog status after this note: `done`
- Phase reached: historical Phase 1 scope/workflow inventory for the delivered first TUI slice, with `T1` completed on 2026-04-01
- Semantic anchors:
  - `HIGH_LEVEL_DESIGN_FREEZE.md` sections 1-4 (`project-scoped user turn`,
    project-first recall, explainable canonical pipeline, UI/API as projections)
  - `docs/design/CURRENT_RUNTIME_SURFACE.md` entrypoint inventory and current
    CLI/web surfaces

## Why A TUI Exists

A canonical TUI is justified when the user wants a richer terminal-native
navigation surface than the current command-per-action CLI, but still needs the
same canonical semantics as web and API.

The TUI is not a new product surface with separate rules. It should provide a
terminal projection of the same core jobs:

1. Recall what the user asked in a project.
2. Trace the full context behind a recovered turn.
3. Perform lightweight administration without leaving the terminal.
4. Reuse canonical data instead of inventing session-viewer semantics.

## Current Surface Mapping

The existing product already has the workflows a TUI should project.

| User job | Current CLI surface | Current web surface | TUI implication |
| --- | --- | --- | --- |
| Recall by project | `ls projects`, `tree`, `show project`, `query` | `Projects`, `All Turns` | TUI needs a project-first browser, not only a session list |
| Search then drill down | `search`, `show turn`, `show session`, `tree session`, `query session` | `Search`, turn detail flows | TUI needs a search results pane with context drill-down plus a hierarchy-first session continuation path |
| Traceability | `show turn`, `show session`, `tree session`, `query` | turn detail and session context flows | TUI needs turn/context inspection with evidence-preserving detail, breadcrumb cues, and related-work continuation |
| Source health/admin overview | `health`, `ls sources`, `stats` | `Sources`, `Drift` | TUI v1 can expose lightweight status summaries before deep admin editing |
| Linking review | read-side `query`/API today | `Inbox`, `Linking` | TUI should plan for candidate/unlinked review, but not necessarily ship full override editing first |
| Supply/export/import | `export`, `import`, `backup`, `restore-check`, `templates` | not a primary web flow | TUI should not start here; these remain command-first until core recall UX is proven |

## Terminal-Native Workflow Inventory

These are the highest-value terminal workflows that map directly to frozen
product jobs.

### Workflow A: Project Recall Browser

Goal: recover prior asks in one project across sessions and source platforms.

Terminal shape:

- left rail or list of projects ordered by recent committed activity
- middle list of `UserTurn` rows for the selected project
- right/detail pane for the selected turn summary and source/session metadata

Canonical dependencies:

- committed project list
- project turn listing
- turn detail projection

### Workflow B: Search To Context Drill-Down

Goal: search globally, then inspect the selected turn without losing the search
result set.

Terminal shape:

- persistent search input
- result list with project, source, session, and related-work cues
- detail pane showing canonical text, assistant replies, linked context, and breadcrumb / related-work continuation

Canonical dependencies:

- search endpoint / read path
- turn detail
- turn context projection

### Workflow C: Session And Turn Inspection

Goal: jump directly from a human-friendly session or turn reference to readable
context.

Terminal shape:

- quick-open prompt for session id/title prefix, turn id, or project filter
- scrollable evidence/context pane
- explicit separation between canonical summary and raw-evidence-oriented detail

Canonical dependencies:

- `show session`
- `show turn`
- `tree session`
- `query session`

### Workflow D: Lightweight Source Health Review

Goal: verify whether sources are present, healthy, stale, or missing before
running heavier operations.

Terminal shape:

- status table for configured/default sources
- counts for sessions/turns/records
- visible sync status and last-seen cues

Canonical dependencies:

- `health`
- `ls sources`
- source status projections already exposed through CLI/API

### Workflow E: Linking Inbox Summary

Goal: see whether candidate/unlinked material exists without making the TUI v1 a
full mutation-heavy admin console.

Terminal shape:

- summary counts for committed/candidate/unlinked
- drill-down list for candidate turns or observations
- read-only first; mutation/editing can follow later

Canonical dependencies:

- linking review API/storage projection

## TUI V1 Scope

The first TUI slice should be read-first, not admin-maximal.

In scope for v1:

- project recall browser
- global search with result-to-context drill-down
- session/turn inspection
- lightweight source health summary
- read-only linking inbox summary if implementation cost stays low

Out of scope for v1:

- service lifecycle management
- import/export/backup wizards
- full linking override editing flows
- mask editing and drift remediation authoring
- complex tree-map visualizations that exceed terminal ergonomics
- source-specific raw-evidence debugging surfaces better served by CLI/API

## Interaction Rules For The First Slice

- The primary object remains the `UserTurn`, not the raw session.
- Project selection should be the default entry path when the user is browsing,
  while search remains the default entry path for known-text retrieval.
- The TUI should reuse canonical summaries first and only expand into deeper
  evidence/context panes on demand.
- The TUI must not invent terminal-only project or session semantics.
- Actions that already work well as explicit commands should stay command-first
  unless a terminal workflow clearly benefits from persistent state.

## Recommended First Delivery Slice

A truthful first slice is:

1. project list
2. project turn list
3. turn detail/context pane
4. search mode
5. source health summary modal or panel

This is the smallest slice that serves recall and traceability without turning
TUI implementation into a second admin application.

## Validation Expectations For Future Implementation

Implementation work should eventually validate at least:

- focused TUI package build/tests
- a fixture-backed navigation path from project -> turn -> context
- a fixture-backed search -> result -> context path
- no semantic drift between TUI read models and existing CLI/API/web outputs

## Backlog Consequence

This note closes the initial workflow-inventory task and also gives the repo a
truthful minimal-v1 scope and non-goal record. The remaining TUI design work is
now architecture/toolkit choice and first-slice implementation planning rather
than open-ended product-definition debate.
