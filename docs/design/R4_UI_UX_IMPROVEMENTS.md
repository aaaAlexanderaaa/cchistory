# R4 - UI And UX Improvements

## Status

- Objective source: `docs/ROADMAP.md`
- Current implementation slices: search-path and navigation coherence; dense-view
  overview and control hierarchy; tree view shipped, but follow-up review found
  a tree-view lint regression that requires corrective follow-up
- Skill input used: `ui-ux-pro-max`
- Multi-perspective design protocol: skipped for this slice because the change is
  a narrow web-shell navigation refinement that does not alter frozen product
  semantics, API contracts, or canonical model behavior.

## Phase 1 - Domain Understanding

### Current behavior

- `docs/design/CURRENT_RUNTIME_SURFACE.md` defines `Search` as a first-class
  history view in the canonical web surface.
- `apps/web/app/page.tsx` routes `search` as a proper `HistoryView`, but
  `apps/web/components/app-shell.tsx` does not present it as a peer in the main
  navigation structure.
- On desktop, search is exposed through a shell button above the nav sections,
  but that control does not show active-location state.
- On mobile, search is opened through the top-right icon, but the bottom nav has
  no `Search` tab, so the active page is not represented in the primary mobile
  navigation.
- Keyboard affordance exists (`/`), but current location cues and navigation
  consistency are weaker than for `All Turns`, `Projects`, and `Inbox`.

### External UX guidance used

From `ui-ux-pro-max`:

- Recommended style: data-dense dashboard with search as a primary CTA.
- Recommended UX emphasis: visible navigation hierarchy, responsive clarity, and
  keyboard/focus affordances.
- Relevant guidance: do not rely on color alone; preserve clear active-location
  cues and accessible navigation semantics.
- Relevant guidance for dense views: use sequential heading/section hierarchy and
  group summary signals separately from filters/actions so users can scan state
  before they operate controls.

### What is known

- This slice belongs entirely to the shell/projection layer.
- It does not require changes to API responses, storage, or canonical objects.
- The clearest low-risk improvement is to make search discoverable and visibly
  active across both desktop and mobile shell chrome.

### What remains deferred

- Larger information-hierarchy work inside individual views.
- Tree visualization for project/session/turn hierarchy.
- Broader admin workflow restructuring.

## Phase 2 - Test Data Preparation

No new `mock_data/` corpus is required for this slice.

- The change is shell-only and can be validated with lint/build instead of new
  evidence fixtures.
- `apps/web` currently has no dedicated test suite; targeted lint/build is the
  smallest repository-consistent verification path.

## Phase 3 - Functional Design

### Problem statement

The roadmap calls for UI/UX improvements in information hierarchy, readability,
search path, and admin coherence. The current shell already treats search as a
real history view in routing logic, but not as a consistent first-class
navigation destination. That creates unnecessary orientation cost, especially on
mobile where the active bottom nav gives no hint that the user is currently in
search.

### Decided approach

Implement a shell-level navigation coherence pass focused on search:

1. Add explicit active-state treatment for the desktop search trigger.
2. Add a first-class `Search` destination to the mobile bottom navigation.
3. Add `aria-current` to active navigation controls so location is not conveyed
   by color alone.
4. Add lightweight current-view labeling in the mobile header to improve
   orientation without redesigning view internals.

### Trade-offs and rejected alternatives

- Rejected: redesign the whole shell navigation in one pass. This objective is
  broader, but the first slice should stay low-risk and verifiable.
- Rejected: move search into a dedicated top-level route architecture. Current
  view-state routing is already canonical for this slice.
- Rejected: make only visual color tweaks. The fix should improve semantics and
  orientation, not just decoration.

### Acceptance criteria

- Search is visibly represented as an active destination in the web shell.
- Mobile primary navigation includes a `Search` entry.
- Active navigation controls expose accessible current-location semantics.
- The shell keeps current behavior for opening search via `/` and button click.

### Impact on existing system

- Affected package: `apps/web`
- Expected files: `apps/web/components/app-shell.tsx`, plus user-facing web docs
  if the visible navigation description changes.
- No impact on canonical domain semantics, API contracts, or storage behavior.

## Phase 3B - Dense View Header Hierarchy

### Problem statement

`All Turns`, `Inbox`, and `Sources` are among the most information-dense web
views in the current runtime. Before this slice, each view exposed title,
summary, filters, and actions in slightly different visual groupings. The data
was already present, but scanning required more interpretation effort because
summary state and controls were blended together.

### Decided approach

Apply a shared, low-risk header hierarchy pattern across the densest history and
admin views:

1. Introduce a shared `SummaryPill` presentation primitive for compact overview
   metrics.
2. Add explicit `OVERVIEW`, `FILTERS`, `QUEUE`, `VIEW`, and `ADD MANUAL SOURCE`
   section labels where they clarify dense control surfaces.
3. Update `All Turns` to show current-view overview metrics separately from its
   filter controls.
4. Update `Inbox` to separate queue state overview from queue selection and view
   controls.
5. Update `Sources` to separate system summary, filtering, and manual-source
   configuration into clearly labeled tiers.

### Trade-offs and rejected alternatives

- Rejected: redesign all history/admin layouts at once. This slice stays within
  existing routing and component semantics.
- Rejected: add new domain concepts or API fields just for UI summary rows. The
  required metrics can be derived from existing query results.
- Rejected: solve readability only with spacing tweaks. Explicit section labels
  and summary grouping produce better orientation for dense views.

### Acceptance criteria

- `All Turns`, `Inbox`, and `Sources` expose compact overview metrics near the
  page heading.
- Dense views separate summary state from filters or action controls using clear
  labeled sections.
- The change remains presentation-only and does not alter canonical domain,
  ingestion, storage, or API semantics.

### Impact on existing system

- Affected package: `apps/web`
- Affected files: `apps/web/components/summary-pill.tsx`,
  `apps/web/components/views/all-turns-view.tsx`,
  `apps/web/components/views/inbox-view.tsx`,
  `apps/web/components/views/sources-view.tsx`, and
  `apps/web/components/views/drift-view.tsx`
- Documentation updated in `docs/guide/web.md` and `BACKLOG.md`

## Phase 1C - Tree View Discovery

### Current runtime facts

- The canonical web shell currently exposes four history views and four admin
  views; no tree view is wired today.
- `session_detail` is handled inside `All Turns`, not as a separate top-level
  route.
- The existing `SessionMap` already derives project/session groupings from the
  canonical turn/session/project model and is used in both `All Turns` and
  `Projects`.
- `ProjectsView` already has two overview modes (`grid` and `sessions`) plus a
  deeper project detail experience.

### Constraints from the design freeze

- A tree experience must remain a projection over canonical `ProjectIdentity`,
  `Session`, and `UserTurn` data.
- It must not introduce alternate project semantics, alternate turn identity, or
  evidence-dropping shortcuts just to make hierarchy easier to render.
- It should preserve project-first history while still allowing direct drill-down
  to session and turn context.

### UX and implementation constraints

- The tree surface for this slice needed to support keyboard-accessible disclosure patterns and
  predictable tab order.
- Dense navigation should avoid forcing users through excessive focus stops or
  rendering every turn node expanded by default.
- Existing runtime assets suggest the best implementation path will reuse
  current `projectRegistry`, `sessionRegistry`, and selected-turn drill-down
  patterns rather than invent a parallel data-fetch path.

### Historical design decisions for the delivered tree slice

- Whether tree view should be a new top-level history destination or a new mode
  within `Projects`.
- Whether initial disclosure should be project → session → turn, or project →
  recent turns with optional session expansion.
- How much virtualization or incremental expansion is needed for large projects
  with many sessions and turns.

### Historical next step

At the time this discovery was recorded, the recommended next step was to run
the Phase 3 design protocol for `R4-KR3` and choose the smallest tree slice
that could ship without changing canonical model semantics. That tree slice is
now delivered, so this section remains as historical design context rather than
an open instruction.

## Phase 3C - Tree View Design Protocol

Environment note: this repository requires a multi-perspective protocol for
non-trivial design decisions. In this agent environment there is no dedicated
sub-agent launcher, so this phase is recorded as three explicitly separated
lenses plus a synthesis decision before implementation.

### Agent A - System Consistency

**Recommended approach**: implement tree view as a third overview mode inside
`Projects`, not as a new top-level history route.

**Why**:

- `Projects` is already the canonical project-first surface.
- The frozen design emphasizes project-first history, with `UserTurn` as the
  drill-down object and UI surfaces acting as projections over one canonical
  model.
- The current `ProjectsView` already owns project overview, project detail, and
  `SessionMap` projection logic, so tree view naturally belongs there.

**Risks**:

- A tree inside `Projects` could become a parallel navigation system if it also
  tries to replace the project detail view.

**Mitigation**:

- Keep the tree as an overview mode only.
- Reuse existing project detail flow for deep project inspection.
- Reuse the existing turn detail side panel for selected leaf nodes.

### Agent B - User Experience

**Recommended approach**: make hierarchy directly explorable as
project → session → turn with disclosure buttons, summary counts, and an
explicit `Open Project` action.

**Why**:

- Users looking for structure are already in `Projects`; adding a `Tree` mode
  there matches expectation better than introducing a new top-level destination.
- Disclosure controls keep dense datasets scannable without rendering every turn
  at once.
- Keyboard-accessible buttons with `aria-expanded` provide predictable
  interaction without requiring a fragile custom tree-widget implementation.

**Risks**:

- Full ARIA tree semantics would require richer arrow-key behavior and could be
  implemented incorrectly.
- Expanding large projects by default could create focus fatigue and visual
  overload.

**Mitigation**:

- Use nested lists plus disclosure buttons rather than a custom `role="tree"`
  widget.
- Start collapsed by default and auto-expand only when a selected turn must be
  revealed.

### Agent C - Engineering Cost

**Recommended approach**: build a dedicated `ProjectTreeView` component that
reuses existing `projects`, `turns`, and `sessions` query results already loaded
by `ProjectsView`.

**Why**:

- No new route, API, or storage schema is required.
- Existing registries (`projectRegistry`, `sessionRegistry`, `turnsByProjectId`)
  already provide the raw material for hierarchy construction.
- The same selected-turn state and `TurnDetailPanel` can be reused for the leaf
  interaction.

**Risks**:

- A naive tree could grow expensive if all nodes render fully at once.
- Rebuilding hierarchy data on every render could be noisy.

**Mitigation**:

- Keep the initial slice collapsed by default so deep leaves render on demand.
- Use memoized grouping and sorting from existing in-memory query data.
- Defer virtualization until a later slice unless profiling shows real need.

### Synthesis

The three lenses converge on the same low-risk path:

1. Add `Tree` as a third overview mode within `Projects`.
2. Implement a purpose-built `ProjectTreeView` using the existing canonical
   project/session/turn data already loaded in the view.
3. Represent hierarchy with nested sections and disclosure buttons rather than a
   bespoke keyboard tree widget.
4. Keep project detail as the deeper project inspection path and use the
   existing turn detail side panel for turn leaves.
5. Treat virtualization, deep bulk expansion, and alternate routing as deferred
   follow-up work unless this slice proves insufficient.

### Decided implementation slice

Ship the minimum tree slice that satisfies KR acceptance without altering
canonical semantics:

- third `Projects` overview mode: `Tree`
- project nodes with summary metadata and `Open Project`
- session child nodes under each project
- turn leaf nodes selectable for detail inspection
- existing turn side panel reused for leaf selection

### KR3 acceptance criteria for this slice

- `Projects` exposes a directly accessible tree overview mode.
- The hierarchy is navigable as project → session → turn.
- Selecting a turn from the tree opens the existing detail inspection flow.
- Opening a project from the tree reuses the existing project detail view.
- The change introduces no new canonical model semantics, API routes, or
  storage behavior.

## Phase 5 - KR3 Implementation Result

Implemented the chosen tree slice inside `Projects`:

- added a third overview mode, `Tree`, in `ProjectsView`
- added `ProjectTreeView` as a purpose-built hierarchy projection component
- rendered project → session → turn disclosure structure from existing query
  results and registries
- reused the existing project detail flow for `Open Project`
- reused the existing turn detail side panel for selected turn leaves

No API, storage, schema, or canonical domain changes were required.

## Phase 6 - KR3 Regression And Verification

Repository-consistent verification for this web slice:

- `cd apps/web && pnpm lint`
- `cd apps/web && NODE_OPTIONS=--max-old-space-size=1536 pnpm build`

Acceptance cross-check:

- `Projects` exposes a directly accessible `Tree` overview mode: passed
- hierarchy is navigable as project → session → turn: passed
- selecting a turn from the tree opens the existing detail flow: passed by
  component wiring and successful web build
- opening a project from the tree reuses the existing project detail view:
  passed by component wiring and successful web build
- no new canonical model/API/storage behavior introduced: passed by inspection

### Post-completion correction on 2026-03-27

A follow-up review found that `ProjectTreeView` currently triggers the web lint
rule `react-hooks/preserve-manual-memoization`. That means the Phase 6
verification claim above is no longer accurate for the current implementation:
successful web build is not sufficient while `cd apps/web && pnpm lint` fails.

Implication:

- the tree-view product behavior and component wiring remain the intended slice
- the slice still needs corrective follow-up before it should be treated as
  fully closed against the web quality gate

## Phase 7 - Objective Evaluation Report

Environment note: `PIPELINE.md` prefers a fresh agent context for holistic
review. In this environment, the evaluation below is recorded as a same-session
best-effort review.

### Boundary evaluation

- Scope remains inside `apps/web` presentation components and user-facing docs.
- No source-adapter, storage, API, or canonical model boundaries were crossed.
- Tree behavior remains a projection over existing project/session/turn data.

### Stability assessment

- Empty states are handled in the tree component when no linked projects exist.
- Selection state remains safe because the tree reuses existing turn-detail
  selection patterns.
- Disclosure-based rendering reduces risk from large projects compared with an
  always-expanded hierarchy.

### Scalability evaluation

- The initial slice derives tree structure from already-fetched in-memory query
  results and renders deep leaves only when expanded.
- This is acceptable for the current web slice, but very large projects may
  still need virtualization or paged expansion in a future refinement.
- Accepted limitation: the first tree slice optimizes discoverability and
  coherence before extreme-scale rendering.

### Compatibility assessment

- No schema migration is required.
- No persisted data shape changes are introduced.
- Existing routes and stored data remain compatible.

### Security evaluation

- No new external input vectors or privileged actions were added.
- The tree renders existing masked/canonical text already used elsewhere in the
  web surface.

### Maintainability assessment

- Tree logic is isolated in `apps/web/components/views/project-tree-view.tsx`
  rather than being inlined into `ProjectsView`.
- Existing interaction patterns are reused instead of creating parallel detail
  components.

### Issues found

- None during the original same-session evaluation. The later follow-up review
  recorded above found a web lint regression that does require corrective
  follow-up.

### Accepted limitations

- The tree uses accessible disclosure buttons and nested sections rather than a
  full ARIA tree widget with arrow-key semantics.
- Virtualization is deferred until real scale pressure justifies it.

### Conclusion

The original same-session Phase 7 review is preserved above as historical
context, but it is superseded for the current repository-visible state by the
post-completion correction note. Treat the tree-view slice as requiring
corrective follow-up until `cd apps/web && pnpm lint` passes again.
