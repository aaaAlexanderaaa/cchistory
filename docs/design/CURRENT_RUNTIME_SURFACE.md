# Current Runtime Surface

This document records the repository-visible runtime surface as of 2026-03-20. It complements the design freeze and should be consulted when implementation inventory matters more than frozen semantics.

> [`HIGH_LEVEL_DESIGN_FREEZE.md`](/root/cchistory/HIGH_LEVEL_DESIGN_FREEZE.md) remains the source of truth for product semantics and invariants.
>
> [`docs/IMPLEMENTATION_PLAN.md`](/root/cchistory/docs/IMPLEMENTATION_PLAN.md) is the delivered slice record for the early 2026-03 local-source push, not the complete live roadmap.
>
> `tasks.csv` is a historical KR ledger that stops at work explicitly tracked in this repository on this host. It is not the live backlog.

# Entry Points

The current product runtime is a three-entrypoint TypeScript workspace with shared packages for domain, storage, DTOs, presentation, and source adapters.

| Path | Role | Current status source |
| --- | --- | --- |
| `apps/api` | managed local API, probe/replay runtime, admin and recall endpoints | `apps/api/src/app.ts` |
| `apps/web` | canonical frontend for history and admin review | `apps/web/app/page.tsx`, `apps/web/components/app-shell.tsx` |
| `apps/cli` | canonical local operator CLI | `apps/cli/src/index.ts` |
| `packages/domain` | canonical model, lifecycle, ordering, and stage contracts | `packages/domain/src/index.ts` |
| `packages/source-adapters` | adapter registry, probe pipeline, parser and atomization flow | `packages/source-adapters/src/platforms/registry.ts` |
| `packages/storage` | SQLite persistence, linking, lineage, tombstones, search | `packages/storage/src/index.ts` |
| `packages/api-client` | API DTO surface shared by clients | `packages/api-client/src/index.ts` |
| `packages/presentation` | presentation-layer mapping consumed by web | `packages/presentation/src/index.ts` |

# Registered Source Adapters

The repository currently registers nine source adapters, spanning both local coding-agent and conversational-export families. For self-host v1 support claims, registration and support are distinct concepts.

| Platform | Family | Self-host v1 tier | Notes |
| --- | --- | --- | --- |
| `codex` | `local_coding_agent` | `stable` | local session files |
| `claude_code` | `local_coding_agent` | `stable` | local project/session logs |
| `factory_droid` | `local_coding_agent` | `stable` | local sessions plus sidecar settings |
| `amp` | `local_coding_agent` | `stable` | thread-style local JSON data |
| `cursor` | `local_coding_agent` | `stable` | transcript plus VS Code state fallback paths |
| `antigravity` | `local_coding_agent` | `stable` | live local trajectory API for conversation content; offline state and brain always scanned for project/workspace signals |
| `openclaw` | `local_coding_agent` | `experimental` | registered parser and discovery path, but not yet real-world validated enough for self-host v1 support claims |
| `opencode` | `local_coding_agent` | `experimental` | registered parser and discovery path, but not yet real-world validated enough for self-host v1 support claims |
| `lobechat` | `conversational_export` | `experimental` | registered parser and discovery path, but not yet real-world validated enough for self-host v1 support claims |

The adapter registry is defined in [`packages/source-adapters/src/platforms/registry.ts`](/root/cchistory/packages/source-adapters/src/platforms/registry.ts).

The self-host v1 release gate is defined in [`docs/design/SELF_HOST_V1_RELEASE_GATE.md`](/root/cchistory/docs/design/SELF_HOST_V1_RELEASE_GATE.md).

Broader enums in domain or DTO packages may mention additional platforms such as `chatgpt`, `claude_web`, or `gemini`. Those enums should be read as schema allowance, not proof that a live adapter is already registered.

> Antigravity uses two complementary collection paths. The live trajectory API (requires the desktop app to be running) provides actual conversation content. Offline files (`workspaceStorage`, `History`, `brain`) are always scanned regardless of live availability, providing project paths and workspace signals. Without the running app, only the offline path executes, which does not recover raw conversation content.

# Web Surface

The canonical frontend currently exposes four history views and four admin views. Session drill-down is handled inside the turn flow rather than as a separate top-level page.

History views:

- `All Turns`
- `Projects`
- `Inbox`
- `Search`

Admin views:

- `Sources`
- `Linking`
- `Masks`
- `Drift`

Additional current behavior:

- Session detail is routed through the `All Turns` experience rather than a dedicated top-level nav item.
- Search is a first-class page-level workflow triggered from the shell.
- `Imports` is not a live canonical admin view in the current web shell.

The current web view wiring is visible in [`apps/web/app/page.tsx`](/root/cchistory/apps/web/app/page.tsx) and [`apps/web/components/app-shell.tsx`](/root/cchistory/apps/web/components/app-shell.tsx).

# CLI Surface

`apps/cli` is a real operator entrypoint with sync, read, query, and bundle-management workflows, not a thin debug wrapper.

Current command families:

- `sync`
- `ls`
- `tree`
- `show`
- `search`
- `stats`
- `export`
- `import`
- `merge`
- `query`
- `templates`

Current read modes:

- `--index`: read the persisted store only
- `--full`: rescan selected default source roots into an in-memory temporary store before reading

The CLI dispatcher and help text live in [`apps/cli/src/index.ts`](/root/cchistory/apps/cli/src/index.ts).

# API Surface

The managed API exposes recall, project, artifact, source-config, probe/replay, lineage, lifecycle, mask, drift, and tombstone surfaces.

Current route groups:

- health and OpenAPI: `/health`, `/openapi.json`
- recall: `/api/sources`, `/api/turns`, `/api/turns/search`, `/api/turns/{turnId}`, `/api/turns/{turnId}/context`, `/api/sessions/{sessionId}`
- projects and artifacts: `/api/projects`, `/api/projects/{projectId}`, `/api/projects/{projectId}/turns`, `/api/projects/{projectId}/revisions`, `/api/artifacts`, `/api/artifacts/{artifactId}/coverage`
- linking and lifecycle admin: `/api/admin/linking`, `/api/admin/linking/overrides`, `/api/admin/projects/lineage-events`, `/api/admin/lifecycle/candidate-gc`
- source config and probe/replay: `/api/admin/source-config`, `/api/admin/probe/sources`, `/api/admin/probe/runs`, `/api/admin/pipeline/replay`
- pipeline diagnostics: `/api/admin/pipeline/runs`, `/api/admin/pipeline/blobs`, `/api/admin/pipeline/records`, `/api/admin/pipeline/fragments`, `/api/admin/pipeline/atoms`, `/api/admin/pipeline/edges`, `/api/admin/pipeline/candidates`, `/api/admin/pipeline/loss-audits`, `/api/admin/pipeline/lineage/{turnId}`
- masks, drift, and tombstones: `/api/admin/masks`, `/api/admin/drift`, `/api/tombstones/{logicalId}`

The OpenAPI path summary is generated in [`apps/api/src/app.ts`](/root/cchistory/apps/api/src/app.ts).

# Document Roles

The repository now maintains separate semantic, runtime, source-reference, roadmap, and historical-plan documents instead of one overloaded plan document.

| Document | Role | Update policy |
| --- | --- | --- |
| [`HIGH_LEVEL_DESIGN_FREEZE.md`](/root/cchistory/HIGH_LEVEL_DESIGN_FREEZE.md) | semantic source of truth | change only when product invariants actually change |
| [`docs/CURRENT_RUNTIME_SURFACE.md`](/root/cchistory/docs/CURRENT_RUNTIME_SURFACE.md) | current repository-visible inventory | refresh when runtime surface materially changes |
| `docs/sources/*.md` | per-source technical reference | refresh when adapter discovery, storage assumptions, or parser entrypoints materially change |
| `docs/ROADMAP.md` | live milestone roadmap | update when milestone priorities or current-status assumptions materially change |
| [`docs/IMPLEMENTATION_PLAN.md`](/root/cchistory/docs/IMPLEMENTATION_PLAN.md) | delivered slice record and historical baseline | keep as historical context; avoid treating it as the live roadmap |
| `tasks.csv` | historical KR ledger | do not rely on it as the authoritative current backlog |
