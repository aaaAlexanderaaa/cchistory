# Repository Guidelines

## Execution Pipeline And Backlog
`PIPELINE.md` defines the operational workflow for executing work: how to discover what to do next, how to decompose objectives into tasks, how to evaluate completion, and how to handle design decisions. `BACKLOG.md` is the living work surface where objectives, KRs, and tasks are tracked. An agent starting a session without a specific user instruction must read `BACKLOG.md` first and follow the decision tree in `PIPELINE.md`.

## Source Of Truth
`HIGH_LEVEL_DESIGN_FREEZE.md` is the authoritative definition of product scope and architecture. Read it before changing docs, code, or data models. Contributions must preserve the frozen invariants there: project-first history, `UserTurn` as the primary object, evidence-preserving ingestion, and UI/API as projections of one canonical model.

## Repository Scope
This repository currently contains seven different classes of material.

- Root docs plus `docs/`: the current project definition, implementation status, and decision surface. `HIGH_LEVEL_DESIGN_FREEZE.md` remains authoritative; `PIPELINE.md` defines the agent execution workflow; `BACKLOG.md` is the living work surface for current objectives and tasks; `docs/design/CURRENT_RUNTIME_SURFACE.md` is the current repository-visible runtime inventory; `docs/design/IMPLEMENTATION_PLAN.md` is the delivered baseline for the 2026-03 local-source slice and may lag newer runtime work; `docs/guide/` contains user-facing guides for CLI, API, Web, TUI, inspection, and bug-reporting workflows; `docs/sources/` contains technical notes for validated source layouts; `docs/templates/` contains reusable issue/report templates; `docs/screenshots/` contains checked-in UI screenshot assets used by repository-facing documentation; `tasks.csv` is a historical KR ledger, not a complete current backlog.
- `apps/`: canonical product entrypoints. `apps/api` is the managed API, `apps/web` is the canonical frontend, `apps/cli` is the canonical local operator CLI, and `apps/tui` is the canonical local TUI. The API runtime now also includes a remote-agent control-plane slice under `/api/agent/*` plus admin inventory and job routes under `/api/admin/agents*` and `/api/admin/agent-jobs`, distinct from the host-local admin probe/config routes.
- `packages/`: canonical shared implementation for domain contracts, source adapters, storage, API DTOs, and presentation mapping.
- `.cchistory/`: local runtime state and persisted evidence-derived data for this workspace. Inspect it when needed, but do not delete, reset, or regenerate it casually.
- `mock_data/`: sanitized, source-shaped fixture corpus used for adapter and CLI validation. Preserve scenario coverage and validate it after edits.
- `frontend_demo/`: an imported UI/UX reference. It is useful for interaction ideas, but it is not the product, not the canonical frontend, and must not define architecture or domain semantics.
- `archive/`: the previous MVP and historical documents. Use it as reference material only, especially for known source parsing and ingestion patterns. Do not treat archived routes, schemas, or UX as the baseline for new work.

## Documentation Status And Drift
- `HIGH_LEVEL_DESIGN_FREEZE.md` freezes product semantics and invariants. It is not a complete inventory of every currently implemented adapter, CLI verb, or UI interaction.
- `docs/design/CURRENT_RUNTIME_SURFACE.md` is the canonical inventory of the current repository-visible entrypoints, adapter roster, and user-facing runtime surfaces.
- `docs/design/IMPLEMENTATION_PLAN.md` should be read as a delivered slice baseline plus status snapshot for the 2026-03 local-source push, not as the live roadmap or exhaustive feature inventory.
- `PIPELINE.md` defines the seven-phase execution workflow and task decomposition standards. It is the operational counterpart to the design freeze.
- `BACKLOG.md` is the living work surface. It replaces `tasks.csv` as the active backlog. Agents must read it at session start.
- `tasks.csv` records work that was explicitly tracked in this repository on this host. It is a historical ledger for the 2026-03 local-source slice, not the active backlog. Missing rows are not evidence that a capability is absent or unimplemented elsewhere.
- When docs and runtime surface disagree, preserve the freeze invariants first, then verify current behavior against `apps/*`, `packages/*`, and targeted tests before editing.
- The currently registered source adapters live in `packages/source-adapters/src/platforms/registry.ts`. The implemented adapter set presently includes `codex`, `claude_code`, `factory_droid`, `amp`, `cursor`, `antigravity`, `gemini`, `openclaw`, `opencode`, `lobechat`, and `codebuddy`.
- Broader platform enums in `packages/domain` or `packages/api-client` are not proof that a live adapter already exists for every value.
- `apps/cli` is a canonical product entrypoint, not just a debug helper. Review `apps/cli/src/index.ts` before changing operator workflows, because the CLI surface now includes sync and discover flows, source/store health inspection, list/tree/show inspection, search, stats, bundle-management and restore flows, raw-snapshot GC, query, template workflows, and the remote-agent `agent pair` / `agent upload` / `agent schedule` / `agent pull` control-plane slice with bounded retry behavior and one-shot leased-job execution.
- `apps/tui` is a canonical product entrypoint, not just a demo shell. Review `apps/tui/src/index.ts` before changing keyboard-first local browse/search workflows, because the TUI now ships project, turn, and detail panes plus global search drill-down, source-health summary behavior, and richer read-side detail cues such as project/session/turn breadcrumbs, related-work summaries, and trail lines.

## Build, Test, And Development Commands
Repository-root aggregate scripts exist, but they are not the default validation path on this host. Prefer the smallest package-scoped command that answers the question.

- `pnpm --filter @cchistory/domain build`: validate canonical domain contracts.
- `pnpm --filter @cchistory/source-adapters build`: validate source parsing and projection compilation.
- `pnpm --filter @cchistory/source-adapters test`: run adapter fixture and parser tests.
- `pnpm --filter @cchistory/storage build`: validate storage compilation.
- `pnpm --filter @cchistory/storage test`: run storage persistence and lineage tests.
- `pnpm --filter @cchistory/api-client build`: validate shared API DTO contracts.
- `pnpm --filter @cchistory/api-client test`: run api-client managed-read contract tests against an in-process API runtime.
- `pnpm --filter @cchistory/presentation build`: validate presentation mapping compilation.
- `pnpm --filter @cchistory/presentation test`: run presentation mapping tests.
- `pnpm --filter @cchistory/cli build`: validate CLI compilation.
- `pnpm --filter @cchistory/cli test`: run CLI tests.
- `pnpm --filter @cchistory/tui build`: validate TUI compilation.
- `pnpm --filter @cchistory/tui test`: run TUI interaction and read-path tests.
- `pnpm --filter @cchistory/api build`: validate API compilation.
- `pnpm --filter @cchistory/api test`: run API tests.
- `NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @cchistory/web build`: validate the canonical web app alone.
- `pnpm run validate:core`: low-memory validation for the core local-source slice.
- `pnpm run verify:clean-install`: verify the documented clean-machine install plus first non-web build path.
- `pnpm run verify:cli-artifact`: verify the standalone CLI artifact install/upgrade path.
- `pnpm run verify:web-build-offline`: verify the canonical web build works without public-network fetches.
- `pnpm run verify:support-status`: verify support-tier docs against the adapter registry.
- `pnpm run verify:v1-seeded-acceptance`: verify one canonical seeded CLI/API/TUI acceptance journey plus restore readability.
- `pnpm run verify:read-only-admin`: verify store-scoped CLI/TUI/API read-only admin and missing-store behavior on the seeded acceptance slice.
- `pnpm run verify:fixture-sync-recall`: verify fixture-backed `sync` to canonical CLI/API/TUI recall on the repo `mock_data/` slice.
- `pnpm run verify:bundle-conflict-recovery`: verify export/import conflict visibility, `skip`/`replace` resolution, `restore-check`, and canonical CLI/API readback on a populated target.
- `pnpm run verify:real-layout-sync-recall`: verify the real-layout-backed fixture slice can sync into a clean store and remain readable through representative CLI/API/TUI project, session, and turn paths.
- `pnpm run verify:related-work-recall`: verify project/session/turn browse-search traceability for delegated child sessions and automation runs through CLI/API/TUI on synced fixture data.
- `pnpm run prepare:v1-seeded-web-review -- --store <dir>`: materialize the seeded acceptance store for user-started web review.
- `pnpm run verify:real-archive-probes`: verify current experimental/real-archive assumptions against the reviewed `.realdata` bundle.
- `pnpm run probe:smoke -- --source-id=src-codex --limit=1`: inspect one local source without starting managed dev services.
- `pnpm run mock-data:validate`: validate the sanitized fixture corpus after editing `mock_data/`.
- `pnpm run build`: aggregate non-web workspace build. It exists, but it is not a default verification step on this host.
- `pnpm run build:all:safe`: aggregate workspace build including `apps/web` with capped Node memory. Use only for explicit full-workspace validation.

- `cd frontend_demo && pnpm dev`: view the reference UI locally.
- `cd frontend_demo && pnpm build`: verify the imported demo still builds.
- `pnpm services:start`: canonical user-operated startup entrypoint for the managed API (`0.0.0.0:8040`) and web (`0.0.0.0:8085`) dev services via `scripts/dev-services.sh`.
- `pnpm services:stop`: canonical user-operated stop entrypoint for the managed dev services.
- `pnpm services:restart`: canonical user-operated restart entrypoint for the managed dev services.
- `pnpm services:status`: canonical status entrypoint for the managed dev services.
- `pnpm restart:api`: compatibility alias for `scripts/dev-services.sh restart api`. It is not a separate startup system.
- `pnpm restart:web`: compatibility alias for `scripts/dev-services.sh restart web`. It is not a separate startup system.
- `cd archive/legacy/server && pytest`: validate legacy parser or ingestion behavior when mining reference code.
- `cd archive/legacy/server && python -m ruff check cchistory tests`: lint archived Python reference code.
- `cd archive/legacy/web && pnpm test`: compare old MVP frontend behavior if needed.

## Web Runtime Workflow
When a user is actively reviewing `apps/web` UI changes, the web dev server should be user-started and reachable on `0.0.0.0:8085`. After meaningful web code changes that need live verification, tell the user which canonical runtime command to run manually; do not run restart or startup commands from the agent environment.

## Dev Service Hard Constraints
> These rules are hard constraints for this repository. Do not change them unless the user explicitly asks to redesign the startup system.
>
> The managed product runtime is `scripts/dev-services.sh` with the `pnpm services:*` wrappers. `pnpm restart:web` and `pnpm restart:api` are aliases only.
>
> The Codex agent environment for this repository cannot perform reliable persistent service lifecycle actions. Even with sandbox escalation, the agent must not attempt to start, stop, restart, daemonize, or otherwise launch long-lived service processes.

- Treat `scripts/dev-services.sh` and `pnpm services:*` as the only canonical startup and lifecycle path for `apps/api` and `apps/web`.
- Do not introduce, document, or normalize alternate default startup flows such as direct `pnpm dev`, `next dev`, `tsx watch`, `nohup`, background shell jobs, `tmux`, or per-app ad hoc launch recipes for the product runtime.
- Do not modify the startup mechanism, wrapper layering, port assignments, supervisor model, PID/log file locations, or alias behavior unless the user explicitly requests a startup-system change.
- Do not treat `pnpm restart:web` or `pnpm restart:api` as independent runtime architectures. They must remain thin compatibility wrappers around `scripts/dev-services.sh`.
- Treat `pnpm restart:web:preview` as a preview-only helper around a production build/start flow, not as part of the canonical dev runtime. The agent must not run it.
- The agent must never run `pnpm services:start`, `pnpm services:stop`, `pnpm services:restart`, `pnpm restart:web`, `pnpm restart:api`, `scripts/dev-services.sh`, direct dev-server commands, or any other persistent process command for this repository.
- If a task needs a running API or web server, stop after code or config changes and ask the user to run the appropriate command manually.
- Non-persistent inspection such as `pnpm services:status`, `lsof`, `curl`, and browser checks is allowed only against services the user has already started.

## Browser Automation Policy
Browser automation for this repository must use the wrapped skill entrypoint or MCP only.

- Always use the Playwright skill wrapper at `/Users/alex_m4/.codex/skills/playwright/scripts/playwright_cli.sh` when driving a browser from the terminal.
- MCP-based browser automation is also allowed when available and appropriate.
- Do not invoke `npx playwright`, `playwright-cli`, `node <cached-playwright-cli>`, or any Playwright binary/script from npm cache, global installs, or ad hoc filesystem locations.
- Do not bypass the wrapper by calling Playwright packages from `~/.npm`, `node_modules/.bin`, `/tmp`, or any non-skill directory.
- If the wrapped skill is broken or blocked, stop and fix the wrapped skill or ask the user; do not work around it with a different Playwright entrypoint.

## Memory And Build Constraints
> This host is memory-constrained. Assume 4 GB RAM and only 3G RAM is usable (avoid OOM) unless a user states otherwise.
>
> Workspace-wide `pnpm install`, workspace-wide `pnpm build`, and parallel multi-package compilation are not acceptable default actions on this machine.

- Never run `pnpm install` at the repository root unless the user explicitly asks for it and the memory tradeoff is acknowledged first.
- Never run `pnpm build` at the repository root as a default verification step.
- Prefer one package at a time with `pnpm --filter <package> ...`.
- Prefer typecheck, targeted tests, or focused probes over full Next.js production builds.
- When a web build is necessary, run it alone and cap Node memory, for example `NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @cchistory/web build`.
- Do not launch multiple TypeScript, Vite, or Next.js build processes in parallel on this host.
- If a dependency install is necessary, keep it scoped to the smallest package set that can answer the question or validate the change.

## Data And Fixture Safety
- `.cchistory/` contains local runtime state, persisted evidence snapshots, and SQLite data for this workspace. Do not delete or reset it unless the user explicitly asks.
- `mock_data/` is a sanitized but source-shaped fixture corpus derived from real local patterns. Keep scenario coverage intact rather than trimming fixtures to make a test pass.
- After changing `mock_data/` or any fixture generator/validator under `scripts/`, run `pnpm run mock-data:validate`.
- Never delete local source capture roots such as `/root/.codex`, `/root/.claude`, `/root/.factory`, `/root/.local/share/amp`, or platform-native Cursor/antigravity user-data directories as part of cleanup or debugging.

## Coding Style & Naming Conventions
When adding new material, keep changes small and map them back to the design freeze. Reuse domain terms exactly as defined there, including `UserTurn`, `ProjectIdentity`, `MaskTemplate`, `KnowledgeArtifact`, `candidate`, `committed`, and `unlinked`. New source work may borrow parser ideas from `archive/`, but source-specific quirks must stop at the capture/parse boundary and must not leak into product semantics.

## Bug Handling And Evidence Preservation
- Treat any parsing, ingestion, masking, or UI rendering bug as a potentially class-wide issue. Do not dismiss a reported item as an isolated bad case without first checking prevalence and root cause in the broader dataset.
- Do not describe captured user interaction data as "dirty" to justify removing it from derived projections. If a projection is hard to render, fix the projection, masking, or presentation layer instead of deleting captured content.
- Preserve raw evidence and evidence-derived message content whenever it exists. When content should be collapsed, redacted, or deemphasized, use `MaskTemplate`/masked display behavior rather than dropping it from evidence-preserving layers.
- Never fix visualization problems by silently stripping real captured content from the underlying evidence model. If a `UserTurn` or context projection is wrong, identify the derivation bug and correct the generic rule.

## Testing Guidelines
Test the layer you actually changed. Design-only edits should cite the affected sections in `HIGH_LEVEL_DESIGN_FREEZE.md`. Reference-code work should run only the relevant legacy tests and clearly state that the result validates historical code, not the future implementation.

## Commit & Pull Request Guidelines
Use short Conventional Commit subjects such as `feat:` and `docs:`. PRs should state whether the change affects the frozen design, the imported UI reference, or archived parser research. List commands run, and for UI exploration changes include screenshots labeled as demo/reference output.

## Cursor Cloud specific instructions

> The Cloud Agent VM has ~16 GB RAM. The 4 GB / 3 GB memory constraints in the sections above apply to the original developer host, not this environment. Root-level `pnpm install` and parallel builds are safe here.

### Two-step dependency install
The workspace uses two separate lockfiles. After pulling latest changes:
1. `pnpm install` at the repository root (covers `apps/api`, `apps/cli`, and all `packages/*`).
2. `cd apps/web && pnpm install` (the web app has its own `pnpm-lock.yaml`).

pnpm may warn about ignored build scripts for `esbuild`, `sharp`, and `unrs-resolver`. These packages work correctly without their postinstall scripts on this platform; no action is needed.

### Building
Build commands and dependency order are documented in the "Build, Test, And Development Commands" section above. The standard sequential build is `pnpm run build` (builds all non-web packages), followed by `NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @cchistory/web build` for the web app.

### Running services
- **API** (Fastify): port 8040. Canonical start: `pnpm services:start` or `bash scripts/dev-services.sh start api`.
- **Web** (Next.js 16 dev): port 8085. Canonical start: `bash scripts/dev-services.sh start web`. The supervisor readiness check may time out even though the service starts successfully; verify with `curl -s -o /dev/null -w '%{http_code}' http://localhost:8085/`.
- **CLI**: `node apps/cli/dist/index.js <command>` (build first with `pnpm --filter @cchistory/cli build`).
- **TUI**: `node apps/tui/dist/index.js [--store <dir> | --db <path>]` (build first with `pnpm --filter @cchistory/tui build`).

### Testing
All test suites use Node.js built-in test runner (`node --test`). Key commands:
- `pnpm --filter @cchistory/source-adapters test` (60 tests)
- `pnpm --filter @cchistory/storage test` (75 tests)
- `pnpm --filter @cchistory/api-client test` (9 tests)
- `pnpm --filter @cchistory/presentation test` (12 tests)
- `pnpm --filter @cchistory/cli test` (48 tests)
- `pnpm --filter @cchistory/tui test` (11 tests)
- `pnpm --filter @cchistory/api test` (15 tests)

### Lint
- `cd apps/web && pnpm lint` runs ESLint with `--max-warnings=0`.

### Notable runtime details
- Storage uses Node.js 22's experimental `node:sqlite` (`DatabaseSync`). No external SQLite library or database server needed.
- FTS5 is unavailable in the built-in SQLite; the storage layer falls back to substring search automatically. The "FTS5 unavailable" warning in test/CLI output is benign.
- No Docker, no external databases, no `.env` files required.
