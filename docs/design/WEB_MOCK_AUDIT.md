# Web Mock Audit
The `apps/web` data layer now spans three classes of contracts: already-canonical turn detail flows, directly mappable demo shapes, and demo-only admin/history contracts that must not leak into the canonical model.

> Source of truth: [`HIGH_LEVEL_DESIGN_FREEZE.md`](/root/cchistory/HIGH_LEVEL_DESIGN_FREEZE.md)
>
> Scope audited: [`apps/web/lib/mock-data.ts`](/root/cchistory/apps/web/lib/mock-data.ts), [`apps/web/lib/types.ts`](/root/cchistory/apps/web/lib/types.ts), and the current consuming views under [`apps/web/components/views`](/root/cchistory/apps/web/components/views).
>
> Canonical comparison baseline: [`packages/domain/src/index.ts`](/root/cchistory/packages/domain/src/index.ts) and [`packages/api-client/src/index.ts`](/root/cchistory/packages/api-client/src/index.ts).

# Surface Status
Only the `All Turns` and turn-detail drill-down path is substantially rewired to canonical API data; the rest of the web shell still consumes demo exports or demo-only helper selectors.

| Web surface | Current data source | Canonical replacement | Status | Blocking drift |
| --- | --- | --- | --- | --- |
| `All Turns` | `useTurnsQuery`, `useTurnQuery`, `useTurnContextQuery`, `useSessionQuery`, `useProjectsQuery` | `/api/turns`, `/api/turns/:turnId`, `/api/turns/:turnId/context`, `/api/sessions/:sessionId`, `/api/projects` | live | temporary `createProjectStub()` fallback should disappear once project coverage is complete |
| `ProjectsView` | `mockProjects`, `getTurnsByProject()` | `/api/projects` plus `/api/turns` filtered by `project_id` | directly mappable | view expects demo-only `description`, `color`, `health_status`, `is_active` |
| `InboxView` | `mockUserTurns`, `mockProjects` | `/api/admin/linking` plus `/api/turns` | directly mappable | no typed client surface for linking review yet |
| `LinkingView` | `mockUserTurns`, `mockProjects`, `getContextForTurn()` | `/api/admin/linking` plus `/api/turns/:turnId/context` | directly mappable | mock-generated suggestion reasons and action handlers must be replaced |
| `SourcesView` | `mockSources`, `mockHosts` | `/api/sources` plus future host surface | partially mappable | demo type still expects `config_path`; canonical source uses `base_dir` |
| `SearchView` | `mockUserTurns`, `mockProjects` | future search/index API | blocked | no canonical search endpoint yet |
| `MasksView` | `mockMaskTemplates` | future mask CRUD API | blocked | web `MaskTemplate` contract diverges materially from canonical domain type |
| `DriftView` | `mockDriftMetrics`, `mockSources`, `mockUserTurns` | future drift/admin aggregate API | blocked | aggregate metrics do not exist in canonical API yet |
| `turn-inspector` | `getSessionById()`, `getProjectById()`, `getSourceDisplayName()` | canonical session/project/source queries | partially mappable | helper selectors still assume in-memory mock registries |

# Entity Mapping
`UserTurn` and `Session` are close enough to the canonical model to keep as-is. `ProjectIdentity` and `SourceInstance` need controlled remapping, and several admin/demo entities should be treated as temporary view models rather than canonical contracts.

| Demo type/export | Survives | Changes | Disappears |
| --- | --- | --- | --- |
| `UserTurn` | `id`, `revision_id`, `user_messages`, `canonical_text`, `display_segments`, `session_id`, `source_id`, `project_id`, `link_state`, `project_confidence`, `candidate_project_ids`, `sync_axis`, `value_axis`, `retention_axis`, `context_ref`, `context_summary` | `created_at` is currently derived from canonical `submission_started_at`; if the UI needs both, it must carry both explicitly | `tags`, `is_flagged`, `flag_reason`, `covered_by_artifact_id` have no canonical API backing today |
| `Session` | `id`, `source_id`, `source_platform`, `host_id`, `title`, `created_at`, `updated_at`, `turn_count`, `model`, `working_directory`, `primary_project_id`, `sync_axis` | none required beyond DTO-to-`Date` mapping | none |
| `ProjectIdentity` | counts, primary workspace path, primary repo remote, created/last-activity timestamps | `id -> project_id`, `revision_id -> project_revision_id`, `name -> display_name`, `primary_repo_remote -> repo_remote`, `last_activity -> project_last_activity_at` | `description`, `health_status`, `is_active`, `context_paths`, `manual_aliases` are demo-only until explicit project admin endpoints exist |
| `SourceInstance` | `id`, `family`, `platform`, `host_id`, `display_name`, `last_sync`, `sync_status`, `error_message`, `total_sessions`, `total_turns` | `config_path` should be replaced by canonical `base_dir`; canonical source status also carries `total_blobs`, `total_records`, `total_fragments`, `total_atoms` | demo-only `cursor` platform must not be treated as a supported canonical source yet |
| `TurnContext` | `turn_id`, `system_messages`, `assistant_replies`, `tool_calls`, `raw_event_refs` | none beyond DTO-to-`Date` mapping | none |
| `ProjectObservation` | none directly | should be replaced by the richer observation payload from `/api/admin/linking` | the current web-only shape should not become a canonical client contract |
| `MaskTemplate` | none directly | requires a fresh mapping against canonical `MaskTemplate` (`rule_kind`, `pattern`, `replacement_label`, `display_policy`) | demo `match_type`, `action`, `priority`, `applies_to`, `is_builtin`, `is_active` are not current canonical fields |
| `DriftMetrics` | none directly | must come from a future admin aggregate endpoint | current demo aggregate shape is entirely synthetic |

# Critical Drift
Three demo assumptions conflict with the frozen model and should be removed before broader UI rewiring.

| Demo assumption | Why it is wrong | Required correction |
| --- | --- | --- |
| `mockProjects` includes `proj-unlinked` as a project bucket | unlinked material is a review surface, not a committed or candidate `ProjectIdentity` | keep unlinked turns in `/api/admin/linking`, not in `/api/projects` |
| `LinkingView` invents suggestions from `mockProjects.slice(0, 2)` | canonical linking now comes from persisted observation evidence and conservative linker rules | bind the view to `/api/admin/linking` and display server-derived candidate/committed state |
| `SourcePlatform` includes `cursor` in the web type | the canonical domain type and live source adapters do not currently support `cursor` | keep `cursor` as demo-only reference material or remove it from the canonical web type |

# Export Disposition
Most `mock-data.ts` exports should either disappear behind API calls or be narrowed into purely local presentation helpers.

| Export | Disposition |
| --- | --- |
| `mockUserTurns`, `mockSessions`, `mockProjects` | replace with canonical API queries |
| `mockTurnContext1` | replace with `/api/turns/:turnId/context` |
| `getTurnById`, `getSessionById`, `getProjectById`, `getTurnsBySession`, `getTurnsByProject`, `getContextForTurn` | remove after each consuming view switches to API-backed selectors |
| `mockSources`, `mockHosts` | replace with canonical source/host admin routes when available; until then, keep them isolated to source admin views |
| `mockMaskTemplates`, `mockDriftMetrics` | keep as temporary placeholders only until corresponding canonical APIs exist |
| `getSourceDisplayName` | replace with a selector over canonical `/api/sources` data |

# Rewrite Order
The safest rewiring sequence is project surfaces first, linking review second, and only then the blocked admin views that still lack canonical endpoints.

1. Replace `ProjectsView` with `/api/projects` plus `/api/turns` filtering and keep color as a local derived visual property.
2. Replace `InboxView` and `LinkingView` with `/api/admin/linking`, then add typed client coverage for that route.
3. Remove `turn-inspector` mock selectors by threading canonical session/project/source registries through the view tree.
4. Leave `SearchView`, `MasksView`, and `DriftView` on placeholders until canonical search, mask, and drift endpoints exist.
