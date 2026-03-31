<p align="center">
  <strong>CCHistory</strong><br>
  <em>Evidence-preserving history for AI coding assistants</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22-brightgreen" alt="Node.js >=22" />
  <img src="https://img.shields.io/badge/pnpm-10.x-orange" alt="pnpm 10.x" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-blue" alt="TypeScript 5.9" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License" />
</p>

<p align="center">
  English | <a href="README_CN.md">简体中文</a>
</p>

---

CCHistory ingests, parses, and projects your AI coding assistant conversations into a unified, evidence-preserving model. It collects local session data from **Codex, Claude Code, Cursor, AMP, Factory Droid, Antigravity** and more, then organizes them by project identity — so you can search, review, and analyze everything you've asked across every tool.

<p align="center">
  <img src="docs/screenshots/web-all-turns.webp" alt="CCHistory Web — All Turns view" width="800" />
</p>

## Key Features

- **Multi-platform ingestion** — Collects conversations from multiple AI coding assistant platforms via local file parsing and app-local live probes where required
- **Evidence-preserving** — Raw evidence is retained and traceable; every `UserTurn` is derived, never authored directly
- **Project-based linking** — Turns are linked to projects via repo fingerprints, workspace paths, and manual overrides
- **Full-text search** — Search across all canonical turn text with project and source filters
- **Token usage analytics** — Track tokens across models, projects, sources, and time periods
- **Export / Import / Merge** — Portable bundles for backup, migration, and multi-host merging
- **Data health monitoring** — Drift and consistency metrics with source-level health matrix

## Supported Platforms

| Platform | Self-host v1 Tier | Source Location |
|----------|-------------------|-----------------|
| Codex | **Stable** | `~/.codex/sessions/` |
| Claude Code | **Stable** | `~/.claude/projects/` |
| Cursor | **Stable** | Platform user-data + project history |
| AMP | **Stable** | `~/.local/share/amp/threads/` |
| Factory Droid | **Stable** | `~/.factory/sessions/` |
| Antigravity | **Stable** | Platform user-data `User/` + `~/.gemini/antigravity/{conversations,brain}` |
| OpenClaw | Experimental | `~/.openclaw/agents/` |
| OpenCode | Experimental | `~/.local/share/opencode/{project,storage/session}` |
| Gemini CLI | Experimental | `~/.gemini/` |
| LobeChat | Experimental | `~/.config/lobehub-storage/` |

> `Stable` means real-world validated for the self-host v1 support bar. `Experimental` means the adapter is registered in code but is not yet validated enough for self-host v1 support claims.
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
┌──────────────────┐  ┌───────────────────┐  ┌─────────────────────┐
│  CLI (apps/cli)  │  │  API (apps/api)   │  │   Web (apps/web)    │
│  Local operator  │  │  Fastify REST     │  │   Next.js 16        │
│  tool: sync,     │  │  server on :8040  │  │   React 19 on :8085 │
│  search, stats,  │  │  CORS, auth,      │  │   SWR, Tailwind,    │
│  export/import   │  │  probe, replay    │  │   Recharts           │
└──────────────────┘  └───────────────────┘  └─────────────────────┘
```

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

This verifies first install plus replacement-style upgrade by unpacking two
versioned artifacts and executing the installed `cchistory templates` command.

### Install the CLI globally

```bash
# Build and link the cchistory command globally
pnpm run cli:link

# Now you can use `cchistory` from anywhere
cchistory sync
cchistory ls projects
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

For detailed guides, see the `docs/guide/` directory:

- **[CLI Guide](docs/guide/cli.md)** — All commands, flags, and output examples
- **[API Guide](docs/guide/api.md)** — REST endpoints, configuration, and request/response schemas
- **[Web UI Guide](docs/guide/web.md)** — Features, navigation, views, and configuration
- **[Inspection Guide](docs/guide/inspection.md)** — When to use `probe:*` and `inspect:*` evidence/debugging helpers
- **[Source Notes](docs/sources/README.md)** — Technical notes for validated source storage layouts and ingestion paths
- **[Self-Host V1 Release Gate](docs/design/SELF_HOST_V1_RELEASE_GATE.md)** — Minimum release bar for a single-user self-hosted v1
- **[Roadmap](docs/ROADMAP.md)** — Current milestone-oriented development plan

Design documents are in `docs/design/`.

## Project Structure

```
cchistory/
├── apps/
│   ├── api/                    # Fastify REST API server (:8040)
│   ├── cli/                    # Command-line tool (cchistory)
│   └── web/                    # Next.js 16 web frontend (:8085)
├── packages/
│   ├── domain/                 # Core domain contracts and types
│   ├── source-adapters/        # Platform-specific parsers
│   ├── storage/                # SQLite persistence and linking
│   ├── api-client/             # Shared API DTO contracts
│   └── presentation/           # DTO → UI type mapping
├── scripts/                    # Dev service lifecycle scripts
├── mock_data/                  # Sanitized fixture corpus
├── docs/
│   ├── guide/                  # User-facing guides (CLI, API, Web)
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
pnpm --filter @cchistory/source-adapters test    # 27 tests
pnpm --filter @cchistory/storage test            # 59 tests
pnpm --filter @cchistory/presentation test       # 5 tests
pnpm --filter @cchistory/cli test                # 12 tests
pnpm --filter @cchistory/api test                # 10 tests

# Lint
cd apps/web && pnpm lint

# Dev services
pnpm services:start       # Start API + Web
pnpm services:stop        # Stop all
pnpm services:status      # Check status
```

## License

[MIT](LICENSE)
