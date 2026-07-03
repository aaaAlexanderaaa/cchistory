<p align="center">
  <strong>CCHistory</strong><br>
  <em>Evidence-preserving history for AI coding assistants</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22-brightgreen" alt="Node.js >=22" />
  <img src="https://img.shields.io/badge/pnpm-10.x-orange" alt="pnpm 10.x" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-blue" alt="TypeScript 5.9" />
  <img src="https://img.shields.io/badge/Version-0.3.0-blue" alt="Version 0.3.0" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License" />
</p>

<p align="center">
  English | <a href="README_CN.md">简体中文</a>
</p>

---

CCHistory `0.3.0` is a local-first, evidence-preserving memory layer for AI coding assistant history. It collects local session data from **13 AI coding assistant platforms including Claude Code, Cursor, Codex, AMP, Gemini CLI, Accio Work, ZCode, and more** (see [Supported Platforms](#supported-platforms)), then organizes it by project identity so you can search, review, and analyze what you asked across tools.

The primary recall object is the project-scoped `UserTurn`: a user-authored ask,
linked to its project, session context, source evidence, and derived lifecycle
state. CLI, TUI, Web, and API surfaces are projections of the same canonical
store rather than separate interpretations.

<p align="center">
  <img src="docs/screenshots/web-all-turns.webp" alt="CCHistory Web — All Turns view" width="800" />
</p>

## Start Here

| Goal | Use |
|------|-----|
| Sync local AI-tool history and inspect health | [`cchistory sync`](docs/guide/cli.md#sync), [`cchistory health`](docs/guide/cli.md#health) |
| Find an old ask and inspect the surrounding session | [`cchistory search`](docs/guide/cli.md#search), [`cchistory show`](docs/guide/cli.md#show), [`cchistory tree`](docs/guide/cli.md#tree) |
| Give an AI agent project context before it continues work | [`cchistory context project <ref>`](docs/guide/cli.md#context) |
| Browse history interactively | [TUI guide](docs/guide/tui.md) or [Web guide](docs/guide/web.md) |
| Backup, restore, or move a store | [CLI backup/import/restore guide](docs/guide/cli.md#backup-and-restore) |
| Understand support status and parser coverage | [Documentation map](docs/README.md), [runtime surface](docs/design/CURRENT_RUNTIME_SURFACE.md), [source notes](docs/sources/README.md) |

## Key Features

- **Multi-platform ingestion** — Collects conversations from registered local source adapters via local file parsing and app-local live probes where required
- **Evidence-preserving** — Raw evidence is retained and traceable; every `UserTurn` is derived, never authored directly
- **Project-based linking** — Turns are linked to projects via repo fingerprints, workspace paths, and manual overrides
- **AI-ready project context** — `cchistory context project <ref>` gives an agent recent asks, session threads, and next inspection commands across sessions
- **Full-text search** — Search across all canonical turn text with project and source filters
- **Four aligned surfaces** — TUI and Web are end-user read surfaces; CLI and API are admin, automation, and integration surfaces
- **Token usage analytics** — Track tokens across models, projects, sources, and time periods
- **Export / Import / Merge** — Portable bundles for backup, migration, and multi-host merging
- **Data health monitoring** — Drift and consistency metrics with source-level health matrix

## Release Scope

`0.3.0` is the current repository package, API, and Web UI release marker. The
`self-host v1` wording in design documents describes the supported deployment
scope: a single-user, local-first, localhost-or-trusted-LAN installation backed
by SQLite. It is not a package version.

The support tier for each source adapter is defined in
[`packages/source-adapters/src/platforms/registry.ts`](packages/source-adapters/src/platforms/registry.ts)
and checked by `pnpm run verify:support-status`.

## Supported Platforms

| Platform | Self-host v1 Tier | Source Location |
|----------|-------------------|-----------------|
| Codex | **Stable** | `~/.codex/sessions/` |
| Claude Code | **Stable** | `~/.claude/projects/` |
| Cursor | **Stable** | Platform user-data + project history |
| AMP | **Stable** | `~/.local/share/amp/threads/` |
| Factory Droid | **Stable** | `~/.factory/sessions/` |
| Antigravity | **Stable** | Platform user-data `User/` + `~/.gemini/antigravity/{conversations,brain}` |
| OpenClaw | **Stable** | `~/.openclaw/agents/` |
| OpenCode | **Stable** | `~/.local/share/opencode/{project,storage}` |
| Gemini CLI | **Stable** | `~/.gemini/` |
| LobeChat | Experimental | `~/.config/lobehub-storage/` |
| CodeBuddy | **Stable** | `~/.codebuddy/` |
| Accio Work | Experimental | `~/.accio/accounts/` |
| ZCode | Experimental | `~/.zcode/` |

> `Stable` means real-world validated for the self-host v1 support bar. `Experimental` means the adapter is registered in code but is not yet validated enough for self-host v1 support claims.
> For `lobechat`, the listed `~/.config/lobehub-storage/` path is still the current root candidate from the experimental slice, not a real-sample-verified canonical location; that review remains blocked under `R17`.
> For `accio`, the adapter is registered as an experimental local-runtime session source while its real-world support boundary is still being validated.
> For `zcode`, the adapter reads the local CLI SQLite store under `~/.zcode/cli/db/db.sqlite`; it remains experimental until sanitized fixture and real-world validation coverage catch up.
> Run `pnpm run verify:support-status` to verify these documentation claims against the adapter registry.

> Antigravity note: CCHistory uses two complementary paths for Antigravity. The running desktop app's local language-server trajectory API provides actual conversation content (user inputs, assistant replies, tool calls). Offline files (`workspaceStorage`, `History`, `brain`) are always scanned for project paths and workspace signals. If the desktop app is not running, only the offline path executes, which means no raw conversation content will be recovered — only project metadata and evidence artifacts.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Local Source Files                            │
│  ~/.codex  ~/.claude  ~/.cursor  ~/.factory  ~/.local/share/amp ...  │
└──────────────┬───────────────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Source Adapters (packages/source-adapters)        │
│  Platform-specific parsers: capture → extract → parse → atomize      │
│  Blobs → Records → Fragments → Atoms → Candidates                   │
└──────────────┬───────────────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Storage (packages/storage)                       │
│  SQLite via Node.js built-in node:sqlite (DatabaseSync)              │
│  Ingestion, linking, projection, search index, lineage tracking      │
└──────────┬──────────────────────┬───────────────────┬────────────────┘
           │                      │                   │
           ▼                      ▼                   ▼
                         End-user surfaces
           ┌───────────────────┐  ┌─────────────────────┐
           │  TUI (apps/tui)   │  │   Web (apps/web)    │
           │  Terminal browser  │  │   Next.js 16        │
           │  Browse, search,  │  │   React 19 on :8085 │
           │  drill into full  │  │   SWR, Tailwind,    │
           │  conversations    │  │   Recharts           │
           └───────────────────┘  └─────────────────────┘
                    Admin / AI agent surfaces
┌──────────────────┐  ┌───────────────────┐
│  CLI (apps/cli)  │  │  API (apps/api)   │
│  Sync, health,   │  │  Fastify REST     │
│  export/import,  │  │  server on :8040  │
│  backup, GC,     │  │  CORS, auth,      │
│  agent ops       │  │  probe, replay    │
└──────────────────┘  └───────────────────┘
```

### Surface Roles

| Surface | Target | Purpose |
|---------|--------|---------|
| **TUI** | End-user (developer) | Browse conversation history like a file manager — projects, sessions, full conversations, search, stats |
| **Web** | End-user (developer) | Same as TUI but richer — charts, filters, inbox triage, mouse-first |
| **CLI** | Admin / AI agent | Data management — sync, export/import, backup, health check, GC, remote agent ops, scriptable `--json` output |
| **API** | Programmatic access | REST endpoints powering Web UI and external integrations |

## Quick Start

### Prerequisites

- **Node.js >= 22** (machine-readable via the root `engines.node` field; uses built-in `node:sqlite`)
- **pnpm 10.x** (pinned via `packageManager`, with supported range declared in `engines.pnpm`)

### Install & Build

This is the canonical clean-machine install path for the repository. It installs
both lockfiles and performs the first non-web workspace build.

```bash
# Clone and install
git clone https://github.com/aaaAlexanderaaa/cchistory.git
cd cchistory
pnpm install

# Install web app dependencies (separate lockfile)
cd apps/web && pnpm install && cd ../..

# First build (non-web workspace)
pnpm run build
```

The `apps/web` production build is validated separately from this install path.
When you need it, run:

```bash
NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @cchistory/web build
```

To verify the clean-machine install contract in a temporary copy without
touching your working tree, run:

```bash
pnpm run verify:clean-install
```

For the broader current verification surface, these repository commands are the
main shortcuts:

| Need | Command |
|------|---------|
| Support/runtime drift check | `pnpm run verify:support-status` and `pnpm run verify:runtime-inventory` |
| CLI/TUI read-side quality gate | `pnpm run verify:cli-tui-read-side` |
| Clean install / artifact distribution | `pnpm run verify:clean-install` and `pnpm run verify:cli-artifact` |
| Web production build | `pnpm run verify:web-build-offline` |

See [`docs/design/CURRENT_RUNTIME_SURFACE.md`](docs/design/CURRENT_RUNTIME_SURFACE.md)
for the full verifier inventory and what each command proves. For development
work, keep these validation surfaces distinct:

- Runtime-critical ingestion flows through `packages/source-adapters` and
  `runSourceProbe`, then lands in storage through `sync` or
  `replaceSourcePayload`.
- Projection fixtures built with `replaceSourcePayload` are useful for focused
  storage, CLI, TUI, and API assertions, but they do not prove parser truth.
- `mock_data/` contains redacted source-shaped layouts for stable adapters;
  generated verifiers such as `scripts/verify-scale-recall.mjs` cover temporary
  high-volume stores without expanding the default package-test path.
- Managed Web/API and remote-agent service reviews remain user-started manual
  slices; local automated checks must not start persistent dev services.

These local verifiers and review helpers do **not** mean every manual review gap
is already closed: the user-started managed-runtime web/API diaries tracked under
`R31` and the server-backed remote-agent diaries tracked under `R35` are still
blocked manual review work until a user provides the required running services.

### Use the standalone CLI artifact

The repository now also supports a CLI-only artifact channel for cases where the
receiving machine should not need a full source checkout.

Generate the artifact from a repository clone:

```bash
pnpm run cli:artifact
```

This writes a versioned extracted directory plus a `.tgz` artifact under
`dist/cli-artifacts/`.

On another machine, unpack the generated tarball and run:

```bash
# POSIX shells
./bin/cchistory --help

# Windows CMD
bin\cchistory.cmd --help
```

Upgrade by replacing the extracted artifact directory with a newer generated
artifact version. To verify the artifact channel locally, run:

```bash
pnpm run verify:cli-artifact
```

If you want one higher-level local full-read confidence pass that also covers the built TUI `--full` path, run:

```bash
pnpm run verify:local-full-read-bundle
```

This grouped alias runs the installed-artifact verifier and the skeptical built-TUI `--full` verifier in sequence.

This verifies first install plus replacement-style upgrade by unpacking two
versioned artifacts, checking the installed `cchistory templates` command, and
running skeptical installed-path workflows across restore/conflict,
browse/search, store-scoped admin, and structured retrieval: `sync -> backup
preview/write -> import -> restore-check -> search/show -> conflict
dry-run/replace`, plus `health --store-only`, `ls sources`, `stats`, `query
session --id`, and `query turn --id`.

### Install the CLI globally

```bash
# Build and link the cchistory command globally
pnpm run cli:link

# Now you can use `cchistory` from anywhere
cchistory sync
cchistory ls projects
cchistory context project <project-ref>
cchistory search "refactor"
cchistory stats
```

Or run without global install:

```bash
# Via pnpm script
pnpm cli -- sync
pnpm cli -- ls projects

# Or directly via node
node apps/cli/dist/index.js sync
```

### Start the TUI

```bash
# Build the TUI entrypoint
pnpm --filter @cchistory/tui build

# Show help or launch the local TUI
node apps/tui/dist/index.js --help
node apps/tui/dist/index.js
```

The TUI is a local read-side entrypoint and does not require the managed API service. In a non-interactive terminal it prints a snapshot instead of opening the full Ink UI.

### Start the Web UI & API

```bash
# Start both services (API on :8040, Web on :8085)
pnpm services:start

# Open the dashboard
open http://localhost:8085
```

### First sync

```bash
# Sync all auto-detected local sources
cchistory sync

# Check what was found
cchistory ls sources
cchistory ls projects
cchistory stats
```

> To sync Antigravity with full turn coverage, start the Antigravity desktop app on the same machine before running `cchistory sync`.

## Screenshots

<table>
<tr>
<td width="50%">
<strong>All Turns — Turn Stream</strong><br>
<img src="docs/screenshots/web-all-turns.webp" alt="All Turns view" width="100%" />
Browse every turn across all coding sessions with filters for project, link state, and value axis.
</td>
<td width="50%">
<strong>Turn Detail Panel</strong><br>
<img src="docs/screenshots/web-turn-detail.webp" alt="Turn detail panel" width="100%" />
Full user input, assistant replies, tool calls, token usage, and pipeline lineage.
</td>
</tr>
<tr>
<td width="50%">
<strong>Projects</strong><br>
<img src="docs/screenshots/web-projects.webp" alt="Projects view" width="100%" />
Project cards with committed/candidate counts, token usage, sessions, and workspace paths.
</td>
<td width="50%">
<strong>Inbox</strong><br>
<img src="docs/screenshots/web-inbox.webp" alt="Inbox view" width="100%" />
Triage unlinked and candidate turns. Link to projects, create new ones, or dismiss.
</td>
</tr>
<tr>
<td width="50%">
<strong>Sources Admin</strong><br>
<img src="docs/screenshots/web-sources.webp" alt="Sources admin" width="100%" />
Configure sources, view sync status, add manual sources, override directories.
</td>
<td width="50%">
<strong>Data Health</strong><br>
<img src="docs/screenshots/web-data-health.webp" alt="Data health" width="100%" />
Drift timeline, consistency metrics, and per-source health diagnostics.
</td>
</tr>
</table>

## Documentation

Start with **[Documentation Map](docs/README.md)** for the organized docs tree.

Core reading paths:

- **Operate locally** — [CLI](docs/guide/cli.md), [TUI](docs/guide/tui.md), [Web](docs/guide/web.md), [API](docs/guide/api.md)
- **Understand architecture** — [High-Level Design Freeze](HIGH_LEVEL_DESIGN_FREEZE.md), [Current Runtime Surface](docs/design/CURRENT_RUNTIME_SURFACE.md)
- **Validate a release or support claim** — [Self-Host V1 Release Gate](docs/design/SELF_HOST_V1_RELEASE_GATE.md), [Validation Strategy](docs/design/V1_VALIDATION_STRATEGY.md)
- **Inspect source data** — [Source Notes](docs/sources/README.md), [Inspection Guide](docs/guide/inspection.md)
- **Report issues** — [Bug Reporting Guide](docs/guide/bug-reporting.md), [Bug Report Template](docs/templates/bug-report.md)
- **Track future work** — [Roadmap](docs/ROADMAP.md)

## Project Structure

```
cchistory/
├── apps/
│   ├── api/                    # Fastify REST API server (:8040)
│   ├── cli/                    # Command-line tool (cchistory)
│   ├── tui/                    # Ink-based local TUI browser
│   └── web/                    # Next.js 16 web frontend (:8085)
├── packages/
│   ├── domain/                 # Core domain contracts and types
│   ├── source-adapters/        # Platform-specific parsers
│   ├── storage/                # SQLite persistence and linking
│   ├── api-client/             # Shared API DTO contracts
│   └── presentation/           # DTO → UI type mapping
├── scripts/                    # Dev-service, verification, and inspection helpers
├── mock_data/                  # Sanitized fixture corpus
├── skills/                     # AI agent skill definitions and shared contracts
├── docs/
│   ├── README.md               # Documentation map and maintenance rules
│   ├── guide/                  # User-facing guides (CLI, API, Web, TUI, inspection, bug reporting)
│   ├── sources/                # Technical notes for validated source layouts
│   ├── templates/              # Reusable report/templates for operators and maintainers
│   ├── design/                 # Internal design documents
│   └── screenshots/            # Web UI screenshots
└── LICENSE                     # MIT License
```

## Development

```bash
# Build all non-web packages
pnpm run build

# Build web app
NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @cchistory/web build

# Run tests
pnpm --filter @cchistory/source-adapters test
pnpm --filter @cchistory/storage test
pnpm --filter @cchistory/api-client test
pnpm --filter @cchistory/presentation test
pnpm --filter @cchistory/cli test
pnpm --filter @cchistory/tui test
pnpm --filter @cchistory/api test

# Lint
cd apps/web && pnpm lint

# Dev services
pnpm services:start       # Start API + Web
pnpm services:stop        # Stop all
pnpm services:status      # Check status
```

## License

[MIT](LICENSE)
