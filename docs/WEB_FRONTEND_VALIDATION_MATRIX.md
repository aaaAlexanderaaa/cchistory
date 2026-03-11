# Web Frontend Validation Matrix
**Verdict: the reduced UI now passes code-path validation for small, medium, and large history shapes without reintroducing duplicate summaries or semantically-empty session rows.**

> Validation commands run:
>
> - `cd apps/web && pnpm lint`
> - `NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @cchistory/web build`
>
> Validation basis: code-path review against the current canonical web components plus successful lint and production build. This is not a screenshot test harness.

# Scenario Matrix
**Verdict: each representative data shape now maps to one expected reading pattern.**

| Scenario | Representative shape | Surfaces checked | Expected behavior | Basis | Status |
| --- | --- | --- | --- | --- | --- |
| Single-turn session | `Session.turn_count = 1` | `All Turns`, `Projects`, `Inbox`, `SessionMap` | compact lane, no extra row stacking, no oversized session chrome | `apps/web/components/session-map.tsx` density rules and embedded `showOverview={false}` usage | pass |
| Medium session | one session with 5–10 turns | `All Turns`, `Projects`, `Search` | one chronological lane, readable labels, session remains provenance not page anchor | `buildTurnSegments()` session mode and result/detail split | pass |
| Dense session | one session with 30+ turns | `SessionMap`, project detail | no semantically-empty multi-row stacking; dense sessions receive proportionate footprint | `apps/web/components/session-map.tsx` dense lane sizing and single-lane rendering | pass |
| Small project | one project with 1–2 sessions and limited turns | `Projects` overview and detail | concise card summary, two-band detail header, no KPI wall before history | `apps/web/components/views/projects-view.tsx` | pass |
| Large multi-session project | one project spanning many sessions and many turns | `Projects` detail, `SessionMap`, `TurnDetailPanel` | project stays the context boundary, turns stay the reading unit, session map stays a projection | `apps/web/components/views/projects-view.tsx`; `apps/web/components/turn-detail-panel.tsx` | pass |
| Search workflow | multi-project result set | `Search` | search is a page, not a modal; result rows do not restate group-level project identity | `apps/web/components/app-shell.tsx`; `apps/web/components/views/search-view.tsx` | pass |
| Triage workflow | unlinked/candidate turn mix | `Inbox`, `Linking` | triage uses one main column plus optional detail panel; project targets appear only when needed | `apps/web/components/views/inbox-view.tsx`; `apps/web/components/views/linking-view.tsx` | pass |
| Admin diagnostics | sources + drift snapshots | `Sources`, `Drift` | one primary header band plus one control/summary band; content begins immediately after | `apps/web/components/views/sources-view.tsx`; `apps/web/components/views/drift-view.tsx` | pass |

# Acceptance Mapping
**Verdict: the KR targets are covered end to end by the current changeset.**

| KR | Coverage |
| --- | --- |
| `KR-123` | reduced header stacks in `All Turns`, `Projects`, `Inbox`, and `Drift` |
| `KR-124` | removed repeated project/session summaries across search, project detail, triage, linking, and turn detail |
| `KR-125` | single-turn, medium-turn, and dense-turn session shapes now receive different footprint rules |
| `KR-126` | dense sessions no longer use collision rows without semantic meaning |
| `KR-128` | search no longer nests a modal over a detail panel; inbox no longer combines list, project rail, and detail rail in one workflow |

# Remaining Validation Gap
**Verdict: the only missing layer is a dedicated visual regression harness, not missing frontend behavior.**

- No screenshot diff suite exists for `apps/web`.
- No story-driven fixture harness exists for canonical `UserTurn` / `Session` / `ProjectIdentity` combinations.
- The current build and code-path validation is sufficient for this KR batch, but future polish work would benefit from stable UI fixtures.
