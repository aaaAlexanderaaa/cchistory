# Current Runtime Surface

This document records the repository-visible runtime surface as of 2026-04-02. It complements the design freeze and should be consulted when implementation inventory matters more than frozen semantics.

> [`HIGH_LEVEL_DESIGN_FREEZE.md`](../../HIGH_LEVEL_DESIGN_FREEZE.md) remains the source of truth for product semantics and invariants.

# Entry Points

The current product runtime is a four-entrypoint TypeScript workspace with shared packages for domain, storage, DTOs, presentation, and source adapters.

| Path | Role | Current status source |
| --- | --- | --- |
| `apps/api` | managed local API, probe/replay runtime, admin and recall endpoints | `apps/api/src/app.ts` |
| `apps/web` | canonical frontend for history and admin review | `apps/web/app/page.tsx`, `apps/web/components/app-shell.tsx` |
| `apps/cli` | canonical local operator CLI | `apps/cli/src/index.ts` |
| `apps/tui` | canonical local TUI with pane-based browse, search drill-down, and source-health summary | `apps/tui/src/index.ts` |
| `packages/domain` | canonical model, lifecycle, ordering, and stage contracts | `packages/domain/src/index.ts` |
| `packages/source-adapters` | adapter registry, probe pipeline, parser and atomization flow | `packages/source-adapters/src/platforms/registry.ts` |
| `packages/storage` | SQLite persistence, linking, lineage, tombstones, search | `packages/storage/src/index.ts` |
| `packages/api-client` | API DTO surface shared by clients | `packages/api-client/src/index.ts` |
| `packages/presentation` | presentation-layer mapping consumed by web | `packages/presentation/src/index.ts` |

# TUI Status

`apps/tui` now provides a canonical local TUI entrypoint with pane-based project, turn, and detail browsing, global search drill-down, lightweight source-health summary, and richer read-side detail cues such as project/session/turn breadcrumbs, related-work summaries in turn/search rows, and child-session or automation trail lines in the detail pane.

# Registered Source Adapters

The repository currently registers eleven source adapters, spanning both local coding-agent and conversational-export families. For self-host v1 support claims, registration and support are distinct concepts.

| Platform | Family | Self-host v1 tier | Notes |
| --- | --- | --- | --- |
| `codex` | `local_coding_agent` | `stable` | local session files |
| `claude_code` | `local_coding_agent` | `stable` | local project/session logs |
| `factory_droid` | `local_coding_agent` | `stable` | local sessions plus sidecar settings |
| `amp` | `local_coding_agent` | `stable` | thread-style local JSON data |
| `cursor` | `local_coding_agent` | `stable` | transcript plus VS Code state fallback paths; `.cursor/chats/**/store.db` now has a separate experimental metadata/readable-fragment intake slice under the same platform without widening the stable claim |
| `antigravity` | `local_coding_agent` | `stable` | live local trajectory API for conversation content; offline state and brain always scanned for project/workspace signals |
| `gemini` | `local_coding_agent` | `stable` | real-sample-backed Gemini CLI chat JSON intake under `.gemini/tmp`, with `projects.json`, `.project_root`, and `logs.json` preserved across companion and missing-companion variants |
| `openclaw` | `local_coding_agent` | `stable` | real-archive-backed typed-event JSONL intake under `~/.openclaw/agents`, including workspace/model signals plus evidence-only lifecycle/config companions |
| `opencode` | `local_coding_agent` | `stable` | real-archive-backed storage/session/message/part layout is fixture-covered and regression-validated for self-host v1 support claims |
| `lobechat` | `conversational_export` | `experimental` | registered parser and discovery path, but not yet real-world validated enough for self-host v1 support claims |
| `codebuddy` | `local_coding_agent` | `stable` | real-archive-backed `.codebuddy/projects/**/*.jsonl` intake with `settings.json` and `local_storage/*.info` preserved as companion evidence; `providerData.skipRun` noise stays evidence-only and zero-byte sibling JSONL files do not become standalone sessions |
| `accio` | `local_runtime_sessions` | `experimental` | Accio Work agent session JSONL under `~/.accio/accounts/<id>/agents/<did>/sessions/` with subagent sessions from `subagent-sessions/`; meta.jsonc sidecars provide session titles and parent-child linkage |

The adapter registry is defined in [`packages/source-adapters/src/platforms/registry.ts`](../../packages/source-adapters/src/platforms/registry.ts).

The self-host v1 release gate is defined in [`docs/design/SELF_HOST_V1_RELEASE_GATE.md`](./SELF_HOST_V1_RELEASE_GATE.md).

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
| `gemini` | manual configuration required | Stable on validated local layouts, but Windows operators should still confirm or override `base_dir` manually until real-host verification lands. |
| `openclaw` | manual configuration required | Stable on validated local layouts, but do not rely on Windows auto-discovery without an explicit source override. |
| `opencode` | manual configuration required | Stable on validated local-disk layouts, but still do not rely on Windows auto-discovery without an explicit source override. |
| `lobechat` | manual configuration required | Experimental adapter; do not rely on Windows auto-discovery without an explicit source override. |
| `codebuddy` | manual configuration required | Stable adapter for the reviewed local `.codebuddy` layout, but current code still probes `%USERPROFILE%\.codebuddy` without real Windows-host validation; operators should confirm or override `base_dir` manually. |

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

The current web view wiring is visible in [`apps/web/app/page.tsx`](../../apps/web/app/page.tsx) and [`apps/web/components/app-shell.tsx`](../../apps/web/components/app-shell.tsx).

# CLI Surface

`apps/cli` is a real operator entrypoint with sync, read, query, bundle-management, and upload-first remote-agent workflows, not a thin debug wrapper.

Current command families:

- `sync`
- `discover`
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
- `gc`
- `query`
- `templates`
- `agent`

Current read modes and browse expansions:

- `--index`: read the persisted store only
- `--full`: rescan selected default source roots into an in-memory temporary store before reading
- `--long`: enrich CLI browse output with denser metadata for `ls` and `tree` read paths
- `tree session <session-ref>`: render one session as a hierarchy-first drill-down; add `--long` for denser nearby-turn plus related child-session / automation context
- `search`: remains turn-first, but now prints direct pivots into `show session`, `show project`, and `tree session --long` so operators can expand one hit into nearby context without leaving the canonical read surface

Default store resolution:

- reuse the nearest existing `.cchistory/` under the current directory or its ancestors
- otherwise fall back to `~/.cchistory/`

The current remote-agent CLI slice now ships through `cchistory agent pair`, `cchistory agent upload`, `cchistory agent schedule`, and `cchistory agent pull`. The local agent state file persists pairing plus cheap dirty-source fingerprints, `agent upload` supports bounded retry/backoff flags, `agent schedule` runs repeated local upload cycles on a caller-provided interval, and `agent pull` leases one typed collection job from the main service, reuses the same canonical bundle/upload path, and reports success or failure back to the control plane. On the API side, the paired-agent control plane also accepts heartbeat updates, exposes admin inventory/label-management routes, and now persists typed collection jobs plus lease/result metadata through dedicated agent/admin job routes.

The CLI dispatcher and help text live in [`apps/cli/src/index.ts`](../../apps/cli/src/index.ts).

Current install and verification surfaces:

- repo-clone install plus first non-web build: `README.md` and `pnpm run verify:clean-install`
- standalone CLI artifact generation: `pnpm run cli:artifact` writes `dist/cli-artifacts/cchistory-cli-standalone-<version>/` plus a sibling `.tgz`
- standalone CLI artifact verification: `pnpm run verify:cli-artifact` unpacks generated artifacts, verifies first install plus replacement-style upgrade semantics, and now runs the installed `cchistory` command through skeptical local restore/conflict, multi-source browse/search, store-scoped admin, and structured retrieval workflows (`sync -> backup preview/write -> import -> restore-check -> search/show -> conflict dry-run/replace`, plus `ls projects --long`, `ls sessions --long`, `show session`, `tree session --long`, `health --store-only`, `ls sources`, `stats`, `query session --id`, and `query turn --id`)
- grouped local full-read bundle: `pnpm run verify:local-full-read-bundle` performs one higher-level local confidence pass by building the canonical local CLI/TUI entrypoints once, then running standalone artifact verification plus skeptical built-TUI `--full` verification in sequence
- offline web-build verification: `pnpm run verify:web-build-offline` proves the canonical web production build works without public-network fetches during build time
- support-status verification: `pnpm run verify:support-status` checks README/runtime/release-gate/source-reference support claims against the adapter registry
- seeded CLI/API/TUI acceptance verification: `pnpm run verify:v1-seeded-acceptance` proves one canonical multi-source recall, source-summary, and restore-readability journey across the shipped local entrypoints
- read-only admin verification: `pnpm run verify:read-only-admin` proves CLI store-scoped health plus source reads, TUI source-health and missing-store truthfulness, and API read-side admin visibility without mutating the seeded store
- fixture-backed sync-to-recall verification: `pnpm run verify:fixture-sync-recall` proves a clean store can sync from repo `mock_data/` default roots and then expose one canonical project recall/search/drill-down path through CLI, API, and TUI
- bundle conflict-recovery verification: `pnpm run verify:bundle-conflict-recovery` proves export/import conflict visibility on a populated target, including default conflict failure, dry-run previews, `skip`/`replace` resolution, `restore-check`, and canonical readback through CLI/API
- real-layout fixture sync-to-read verification: `pnpm run verify:real-layout-sync-recall` proves that the real-layout-backed fixture slice (`gemini`, `opencode`, `openclaw`, `codebuddy`, and Cursor chat-store) can sync into a clean store and stay readable through representative CLI/API/TUI project, session, and turn paths
- related-work recall verification: `pnpm run verify:related-work-recall` proves that delegated child-session and automation-run context stays traceable through CLI search/detail/tree flows, TUI search drill-down, and API read-side related-work inspection on synced fixture data
- seeded web review preparation: `pnpm run prepare:v1-seeded-web-review -- --store <dir>` materializes the same acceptance store for user-started web review without changing the runtime architecture
- real-archive truthfulness verification: `pnpm run verify:real-archive-probes` checks the reviewed `.realdata/config_dots_20260331_212353/` archive assumptions that current Gemini, Cursor chat-store, CodeBuddy, and OpenCode claims depend on

These verifiers and helpers prove a broad local slice, but they do not replace
the still-blocked user-started managed-runtime diaries tracked under `R31`
(seed-web and managed API read) or the server-backed remote-agent diaries tracked
under `R35`. Those remain explicit manual review work rather than completed
automated proof.

# API Surface

The managed API exposes recall, project, artifact, source-config, probe/replay, remote-agent pairing/upload plus liveness, inventory, and leased-job control-plane surfaces, lineage, lifecycle, mask, drift, and tombstone surfaces.

Default data-dir resolution matches the CLI default-store policy unless `CCHISTORY_API_DATA_DIR` is set for the API process:

- if `CCHISTORY_API_DATA_DIR` is set, use that explicit indexed-store directory
- otherwise reuse the nearest existing `.cchistory/` under the current working directory or its ancestors
- otherwise fall back to `~/.cchistory/`

Current route groups:

- health and OpenAPI: `/health`, `/openapi.json`
- remote-agent control plane: `/api/agent/pair`, `/api/agent/heartbeat`, `/api/agent/jobs/lease`, `/api/agent/uploads`, `/api/agent/jobs/{jobId}/complete`, `/api/admin/agents`, `/api/admin/agents/{agentId}/labels`, `/api/admin/agent-jobs`
- recall: `/api/sources`, `/api/turns`, `/api/turns/search`, `/api/turns/{turnId}`, `/api/turns/{turnId}/context`, `/api/sessions`, `/api/sessions/{sessionId}`
- projects and artifacts: `/api/projects`, `/api/projects/{projectId}`, `/api/projects/{projectId}/turns`, `/api/projects/{projectId}/revisions`, `/api/artifacts`, `/api/artifacts/{artifactId}/coverage`
- linking and lifecycle admin: `/api/admin/linking`, `/api/admin/linking/overrides`, `/api/admin/sessions/{sessionId}/related-work`, `/api/admin/projects/lineage-events`, `/api/admin/projects/{projectId}/delete`, `/api/admin/lifecycle/candidate-gc`
- source config and probe/replay: `/api/admin/source-config`, `/api/admin/source-config/{sourceId}`, `/api/admin/source-config/{sourceId}/reset`, `/api/admin/probe/sources`, `/api/admin/probe/runs`, `/api/admin/pipeline/replay`
- pipeline diagnostics: `/api/admin/pipeline/runs`, `/api/admin/pipeline/blobs`, `/api/admin/pipeline/records`, `/api/admin/pipeline/fragments`, `/api/admin/pipeline/atoms`, `/api/admin/pipeline/edges`, `/api/admin/pipeline/candidates`, `/api/admin/pipeline/loss-audits`, `/api/admin/pipeline/lineage/{turnId}`
- masks, drift, and tombstones: `/api/admin/masks`, `/api/admin/drift`, `/api/tombstones/{logicalId}`

The OpenAPI path summary is generated in [`apps/api/src/app.ts`](../../apps/api/src/app.ts).

# Build, Memory, And Document Constraints

> Build constraints, memory limits, preflight checklists, and document roles are defined in [`AGENTS.md`](../../AGENTS.md#build-test-and-development-commands).
