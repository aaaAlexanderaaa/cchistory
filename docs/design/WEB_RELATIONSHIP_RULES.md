# Web Relationship Rules
The UI must treat `ProjectIdentity`, `Session`, and `UserTurn` as different responsibilities, not interchangeable reading targets.

> Source of truth: `HIGH_LEVEL_DESIGN_FREEZE.md`
>
> The frozen model is: `ProjectIdentity` is the context boundary, `UserTurn` is the primary recall object, and `Session` is the provenance container.

# Global Rules
Relationship clarity depends on stable object responsibilities across all views.

1. `UserTurn` is the default reading unit for recall, search, review, and triage.
2. `ProjectIdentity` provides scope, grouping, and linking context.
3. `Session` explains provenance and chronological containment; it does not replace `UserTurn` as the main recall object.
4. A page may elevate one non-default object only if that promotion is explicit in the page title and layout.
5. Context already established by the parent view must not be fully restated in the immediate child surface.

# View Responsibility Matrix
Each primary view has one anchor object and one clear role for the other two objects.

| View | Anchor object | `ProjectIdentity` role | `Session` role | `UserTurn` role |
| --- | --- | --- | --- | --- |
| `All Turns` | `UserTurn` | filter/grouping context | provenance projection and drill-down | primary content |
| `Projects` overview | `ProjectIdentity` | primary content | secondary projection for cross-session shape | canonical history summary only |
| `Projects` detail | `ProjectIdentity` with `UserTurn` feed | page context and linkage summary | secondary projection via `SessionMap` or turn provenance | primary history inside the project |
| `Search` | `UserTurn` results | grouping context | provenance badge and side-panel detail | primary result |
| `Inbox` | `UserTurn` triage | linking target | provenance evidence | primary review object |
| `Linking` | `UserTurn` review | candidate or committed target | evidence source | primary decision object |
| `Sources` | `SourceStatus` | not primary | indirect context only | indirect count only |
| `Masks` | `MaskTemplate` | not primary | not primary | indirect impact only |
| `Drift` | `DriftReport` | indirect quality context | indirect quality context | indirect quality count only |

# Reduction Rules
Relationship clarity becomes visible only when each layer says one thing once.

- Parent views establish scope.
- Cards summarize.
- Detail panels explain.
- Provenance lives in collapsible or lower-priority areas when the parent view already provides scope.
- Session projections show chronology and scale, not another full summary dashboard.

# Implementation Notes
The current repair work encodes these rules directly in the web surface hierarchy.

- `apps/web/components/views/all-turns-view.tsx` keeps `UserTurn` as the headline object and treats `SessionMap` as a secondary view.
- `apps/web/components/views/projects-view.tsx` makes project identity the page context while keeping turns as the main project history.
- `apps/web/components/views/search-view.tsx` keeps results grouped by project without repeating project identity inside each row.
- `apps/web/components/views/inbox-view.tsx` keeps triage anchored on the selected `UserTurn`; project assignment stays actionable context.
- `apps/web/components/turn-detail-panel.tsx` moves project evidence into a collapsible section instead of repeating it in the always-visible header.
