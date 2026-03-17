# Web Dedup Matrix
**Verdict: the frontend should remove repeated summaries and repeated containers, not remove canonical product facts.**

> Source of truth: `HIGH_LEVEL_DESIGN_FREEZE.md`
>
> Frozen invariants preserved here: project-first history, `UserTurn` as primary recall object, evidence-preserving provenance, and UI/API as projections of one canonical model.

# Reduction Standard
**Verdict: every surface must keep one anchor object, one summary layer, and one detail layer.**

- Keep facts that change user judgment.
- Remove repeated facts that only restate already-visible context.
- Move provenance and evidence downward when a parent view already establishes the context.
- Let data scale change layout weight before adding more badges or more chrome.

# Surface Matrix
**Verdict: the matrix below defines what stays, what moves, and what should not repeat on each primary surface.**

| Surface | Anchor object | Retain at top layer | Move lower / collapse | Remove as duplicate |
| --- | --- | --- | --- | --- |
| `All Turns` | `UserTurn` feed | turn count, filters, sort, view toggle | session provenance in side panel or `SessionDetailPanel` | extra KPI rows above the feed; repeated session-map overview inside the page |
| `Projects` overview | `ProjectIdentity` summary | project name, linkage state, committed/candidate/session counts, one evidence line | active span and token totals inside compact metrics | separate KPI wall above the grid; repeated workspace + repo blocks on every card |
| `Projects` detail | `ProjectIdentity` context with `UserTurn` history | project name, health, counts in view, tab switch, content-mode switch | workspace/repo/link reason as one compact metadata line; provenance inside `TurnDetailPanel` collapsible section | stacked KPI cards, dedicated meta band, explanatory paragraph that repeats the page model |
| `Search` | `UserTurn` search results | query, filters, grouped result headers, per-result relevance/time/session | project context in result group header and detail panel collapsible section | repeated project badge inside each result row when already grouped by project |
| `Inbox` | `UserTurn` triage queue | triage state, counts by tab, sort, view mode, quick link targets when a turn is selected | project linking targets in the quick-link strip | separate explanatory header band; dedicated desktop drop rail plus detail panel plus list at once |
| `Linking` | `UserTurn` review card | candidate/unlinked split, evidence strip, project candidate if present | full project linkage evidence in detail panel or evidence strip | footer text that repeats the same candidate project already shown in the card body |
| `Sources` | `SourceStatus` row | source name, platform, path, counts, last sync, status | error detail inside the status cell | extra summary rows above the table |
| `Masks` | `MaskTemplate` list | active count, template list, selected template details, masking preview | descriptive masking rationale in the side panel | repeated explanatory banners once the page title already defines the purpose |
| `Drift` | `DriftReport` diagnostics | drift headline, refresh, compact summary pills, chart, source health matrix | source-level detail inside the matrix | full KPI wall above the chart; global warning banner duplicated outside the header |

# Session Projection Rules
**Verdict: `SessionMap` is a projection surface and must not behave like a second dashboard when embedded inside another page.**

- Embedded `SessionMap` instances keep axis controls and visual lanes.
- Embedded `SessionMap` instances drop the global overview summary.
- Single-turn sessions stay compact.
- Dense sessions expand in width and height, but remain one chronological lane.
- Multi-row stacking is not allowed unless rows have explicit semantic meaning.

# Review Outcome
**Verdict: the current repair work should treat duplication as a structural bug, not a styling issue.**

- `apps/web/components/views/all-turns-view.tsx`
- `apps/web/components/views/projects-view.tsx`
- `apps/web/components/views/search-view.tsx`
- `apps/web/components/views/inbox-view.tsx`
- `apps/web/components/views/linking-view.tsx`
- `apps/web/components/turn-detail-panel.tsx`
- `apps/web/components/session-map.tsx`
