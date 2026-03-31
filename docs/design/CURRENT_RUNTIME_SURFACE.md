# Current Runtime Surface

This document records the repository-visible runtime surface as of 2026-03-29. It complements the design freeze and should be consulted when implementation inventory matters more than frozen semantics.

> [`HIGH_LEVEL_DESIGN_FREEZE.md`](/root/cchistory/HIGH_LEVEL_DESIGN_FREEZE.md) remains the source of truth for product semantics and invariants.
>
> [`docs/design/IMPLEMENTATION_PLAN.md`](/root/cchistory/docs/design/IMPLEMENTATION_PLAN.md) is the delivered slice record for the early 2026-03 local-source push, not the complete live roadmap.
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

The repository currently registers ten source adapters, spanning both local coding-agent and conversational-export families. For self-host v1 support claims, registration and support are distinct concepts.

| Platform | Family | Self-host v1 tier | Notes |
| --- | --- | --- | --- |
| `codex` | `local_coding_agent` | `stable` | local session files |
| `claude_code` | `local_coding_agent` | `stable` | local project/session logs |
| `factory_droid` | `local_coding_agent` | `stable` | local sessions plus sidecar settings |
| `amp` | `local_coding_agent` | `stable` | thread-style local JSON data |
| `cursor` | `local_coding_agent` | `stable` | transcript plus VS Code state fallback paths |
| `antigravity` | `local_coding_agent` | `stable` | live local trajectory API for conversation content; offline state and brain always scanned for project/workspace signals |
| `gemini` | `local_coding_agent` | `experimental` | sync-supported Gemini CLI session JSON under `.gemini/tmp` plus companion project metadata from `.project_root` and `projects.json`; still below self-host v1 real-world validation bar |
| `openclaw` | `local_coding_agent` | `experimental` | registered parser and discovery path, but not yet real-world validated enough for self-host v1 support claims |
| `opencode` | `local_coding_agent` | `experimental` | registered parser and discovery path, but not yet real-world validated enough for self-host v1 support claims |
| `lobechat` | `conversational_export` | `experimental` | registered parser and discovery path, but not yet real-world validated enough for self-host v1 support claims |

The adapter registry is defined in [`packages/source-adapters/src/platforms/registry.ts`](/root/cchistory/packages/source-adapters/src/platforms/registry.ts).

The self-host v1 release gate is defined in [`docs/design/SELF_HOST_V1_RELEASE_GATE.md`](/root/cchistory/docs/design/SELF_HOST_V1_RELEASE_GATE.md).

Broader enums in domain or DTO packages may mention additional platforms such as `chatgpt` or `claude_web`. Those enums should be read as schema allowance, not proof that a live adapter is already registered.

## Windows Discovery Status

As of 2026-03-27, Windows default-root policy is intentionally split between verified auto-discovery and manual-configuration guidance.

| Platform | Windows status | Operator guidance |
| --- | --- | --- |
| `cursor` | verified default roots | Auto-discovery is verified for `%APPDATA%\Cursor\User`, `%APPDATA%\Cursor`, and `~/.cursor/projects`. |
| `antigravity` | verified default roots | Auto-discovery is verified for `%APPDATA%\Antigravity\User`, `%APPDATA%\Antigravity`, plus the `~/.gemini/antigravity/*` companion roots. |
| `codex` | manual configuration required | Current code still probes the home-relative candidate `%USERPROFILE%\.codex\sessions`, but Windows operators should confirm or override `base_dir` manually until real-host verification lands. |
| `claude_code` | manual configuration required | Current code still probes the home-relative candidate `%USERPROFILE%\.claude\projects`, but Windows operators should confirm or override `base_dir` manually until real-host verification lands. |
| `factory_droid` | manual configuration required | Current code still probes the home-relative candidate `%USERPROFILE%\.factory\sessions`, but Windows operators should confirm or override `base_dir` manually until real-host verification lands. |
| `amp` | manual configuration required | Current code still probes the home-relative candidate `%USERPROFILE%\.local\share\amp\threads`, but Windows operators should confirm or override `base_dir` manually until real-host verification lands. |
| `gemini` | manual configuration required | Experimental adapter; current code probes `%USERPROFILE%\.gemini`, but Windows operators should confirm or override `base_dir` manually until real-host verification lands. |
| `openclaw` | manual configuration required | Experimental adapter; do not rely on Windows auto-discovery without an explicit source override. |
| `opencode` | manual configuration required | Experimental adapter; do not rely on Windows auto-discovery without an explicit source override. |
| `lobechat` | manual configuration required | Experimental adapter; do not rely on Windows auto-discovery without an explicit source override. |

Manual overrides are managed through the web `Sources` view or the API endpoints under `/api/admin/source-config`.

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
- `Projects` currently supports three internal overview modes: grid, tree, and session map.
- Search is a first-class page-level workflow triggered from the shell.
- `Imports` is not a live canonical admin view in the current web shell.

The current web view wiring is visible in [`apps/web/app/page.tsx`](/root/cchistory/apps/web/app/page.tsx) and [`apps/web/components/app-shell.tsx`](/root/cchistory/apps/web/components/app-shell.tsx).

# CLI Surface

`apps/cli` is a real operator entrypoint with sync, read, query, and bundle-management workflows, not a thin debug wrapper.

Current command families:

- `sync`
- `health`
- `ls`
- `tree`
- `show`
- `search`
- `stats`
- `export`
- `backup`
- `restore-check`
- `import`
- `merge`
- `query`
- `templates`

Current read modes:

- `--index`: read the persisted store only
- `--full`: rescan selected default source roots into an in-memory temporary store before reading

Default store resolution:

- reuse the nearest existing `.cchistory/` under the current directory or its ancestors
- otherwise fall back to `~/.cchistory/`

The CLI dispatcher and help text live in [`apps/cli/src/index.ts`](/root/cchistory/apps/cli/src/index.ts).

Current install and verification surfaces:

- repo-clone install plus first non-web build: `README.md` and `pnpm run verify:clean-install`
- standalone CLI artifact generation: `pnpm run cli:artifact` writes `dist/cli-artifacts/cchistory-cli-standalone-<version>/` plus a sibling `.tgz`
- standalone CLI artifact verification: `pnpm run verify:cli-artifact` unpacks generated artifacts, runs the installed `cchistory templates` command, and verifies replacement-style upgrade semantics

# API Surface

The managed API exposes recall, project, artifact, source-config, probe/replay, lineage, lifecycle, mask, drift, and tombstone surfaces.

Default data-dir resolution matches the CLI default-store policy:

- reuse the nearest existing `.cchistory/` under the current working directory or its ancestors
- otherwise fall back to `~/.cchistory/`

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
| [`docs/design/CURRENT_RUNTIME_SURFACE.md`](/root/cchistory/docs/design/CURRENT_RUNTIME_SURFACE.md) | current repository-visible inventory | refresh when runtime surface materially changes |
| `docs/sources/*.md` | per-source technical reference | refresh when adapter discovery, storage assumptions, or parser entrypoints materially change |
| `docs/ROADMAP.md` | live milestone roadmap | update when milestone priorities or current-status assumptions materially change |
| [`docs/design/IMPLEMENTATION_PLAN.md`](/root/cchistory/docs/design/IMPLEMENTATION_PLAN.md) | delivered slice record and historical baseline | keep as historical context; avoid treating it as the live roadmap |
| `tasks.csv` | historical KR ledger | do not rely on it as the authoritative current backlog |
