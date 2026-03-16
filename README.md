<p align="center">
  <strong>CCHistory</strong><br>
  <em>Evidence-preserving history for AI coding assistants</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22-brightgreen" alt="Node.js >=22" />
  <img src="https://img.shields.io/badge/pnpm-10.x-orange" alt="pnpm 10.x" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-blue" alt="TypeScript 5.9" />
  <img src="https://img.shields.io/badge/License-Private-lightgrey" alt="License" />
</p>

<p align="center">
  English | <a href="README_CN.md">简体中文</a>
</p>

---

CCHistory ingests, parses, and projects your AI coding assistant conversations into a unified, evidence-preserving model. It collects local session data from **Codex, Claude Code, Cursor, AMP, Factory Droid, Antigravity, OpenClaw, OpenCode, and LobeChat**, then organizes them by project identity — so you can search, review, and analyze everything you've asked across every tool.

<p align="center">
  <img src="docs/screenshots/web-all-turns.webp" alt="CCHistory Web — All Turns view" width="800" />
</p>

## Table of Contents

- [Key Features](#key-features)
- [Architecture](#architecture)
- [Supported Platforms](#supported-platforms)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Quick Start](#quick-start)
- [CLI](#cli)
  - [Sync](#sync)
  - [List](#list)
  - [Search](#search)
  - [Stats](#stats)
  - [Tree](#tree)
  - [Show](#show)
  - [Export / Import / Merge](#export--import--merge)
  - [Query (JSON)](#query-json)
- [API](#api)
  - [Starting the API Server](#starting-the-api-server)
  - [Core Endpoints](#core-endpoints)
  - [Admin Endpoints](#admin-endpoints)
  - [Configuration](#api-configuration)
- [Web UI](#web-ui)
  - [Starting the Web Server](#starting-the-web-server)
  - [All Turns](#all-turns)
  - [Projects](#projects)
  - [Inbox](#inbox)
  - [Sources Admin](#sources-admin)
  - [Data Health](#data-health)
- [Project Structure](#project-structure)
- [Development](#development)
  - [Build Commands](#build-commands)
  - [Testing](#testing)
  - [Linting](#linting)

---

## Key Features

- **Multi-platform ingestion** — Collects conversations from 9 AI coding assistant platforms via local file parsing.
- **Evidence-preserving** — Raw evidence is retained and traceable; every `UserTurn` is derived from source data, never authored directly.
- **Project-based linking** — Turns are linked to projects via repo fingerprints, workspace paths, and manual overrides. Under-links rather than false-merges.
- **Three link states** — `committed` (confident match), `candidate` (probable match, needs review), `unlinked` (no project signal).
- **Full-text search** — Search across all canonical turn text with project and source filters.
- **Token usage analytics** — Track input, output, cached, and reasoning tokens across models, projects, sources, and time periods.
- **Export / Import / Merge** — Portable bundles for backup, migration, and multi-host merging.
- **Mask templates** — Deterministic rules that collapse repetitive content for display without altering raw evidence.
- **Data health monitoring** — Drift and consistency metrics with source-level health matrix.

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

**Domain model highlights:**

| Concept | Description |
|---------|-------------|
| `UserTurn` | The primary object — a single user submission boundary derived from raw evidence |
| `ProjectIdentity` | A linked project derived through evidence (repo fingerprints, workspace paths) |
| `Session` | A raw conversation container from a source platform |
| `ConversationAtom` | The smallest traceable semantic unit (user, assistant, tool, system) |
| `MaskTemplate` | Deterministic display rule that collapses repetitive content without altering evidence |
| `KnowledgeArtifact` | Higher-level derived object (decision, fact, pattern) covering one or more turns |

## Supported Platforms

| Platform | Family | Source Location |
|----------|--------|-----------------|
| Codex | Local coding agent | `~/.codex/sessions/` |
| Claude Code | Local coding agent | `~/.claude/projects/` |
| Factory Droid | Local coding agent | `~/.factory/sessions/` |
| AMP | Local coding agent | `~/.local/share/amp/threads/` |
| Cursor | Local coding agent | Platform user-data + project history |
| Antigravity | Local coding agent | Platform user-data `workspaceStorage/` |
| OpenClaw | Local coding agent | Platform-specific paths |
| OpenCode | Local coding agent | Platform-specific paths |
| LobeChat | Conversational export | Export bundles or app DB |

## Getting Started

### Prerequisites

- **Node.js >= 22** (uses built-in `node:sqlite`; no external SQLite library needed)
- **pnpm 10.x** (enforced via `packageManager` field)

### Installation

```bash
# Clone the repository
git clone https://github.com/aaaAlexanderaaa/cchistory.git
cd cchistory

# Install workspace dependencies (covers packages/* and apps/api, apps/cli)
pnpm install

# Install web app dependencies (separate lockfile)
cd apps/web && pnpm install && cd ../..
```

### Quick Start

```bash
# 1. Build all core packages
pnpm run build

# 2. Sync local sources into the default store
node apps/cli/dist/index.js sync

# 3. List discovered projects
node apps/cli/dist/index.js ls projects

# 4. Start the API + web dev services
pnpm services:start

# 5. Open http://localhost:8085 in your browser
```

## CLI

The CLI (`apps/cli`) is the primary local operator tool. It reads from and writes to a local SQLite store.

```
Usage: cchistory <command> [options]

Global options:
  --store <dir>    Store directory (DB at <dir>/cchistory.sqlite)
  --db <file>      Explicit SQLite file path
  --index          Read from existing store only (default for reads)
  --full           Re-scan sources into a temporary in-memory store
  --json           Machine-readable JSON output
  --showall        Include empty projects in listings
```

### Sync

Ingest local source files into the store.

```bash
cchistory sync                          # Sync all default sources
cchistory sync --source codex           # Sync only Codex
cchistory sync --limit-files 10         # Limit files per source (for testing)
```

```
Synced 7 source(s) into /workspace/.cchistory/cchistory.sqlite

Source           Host          Sessions  Turns  Status
---------------  ------------  --------  -----  -------
Codex (codex)    host-e336320  4         4      healthy
Claude Code      host-e336320  4         4      healthy
Cursor (cursor)  host-e336320  2         1      healthy
...
```

### List

Browse projects, sessions, and sources.

```bash
cchistory ls projects                   # List projects (hides empty by default)
cchistory ls sessions                   # List all sessions
cchistory ls sources                    # List configured sources
cchistory ls projects --showall         # Include empty projects
```

```
Name                   Status     Hosts  Sessions  Turns  Last Activity
---------------------  ---------  -----  --------  -----  ------------------------
chat-ui-kit            tentative  1      3         3      2026-03-13T09:11:15.457Z
history-lab            tentative  1      2         2      2026-03-16T16:42:12.467Z
shared-product-lab     tentative  1      1         1      2026-03-16T16:41:50.982Z
...
```

### Search

Full-text search across all turns.

```bash
cchistory search "data security"                        # Global search
cchistory search "refactor" --project chat-ui-kit       # Scoped to project
cchistory search "docker" --source codex --limit 5      # Scoped to source
```

```
Unassigned (1)
  2026-03-16 01cee9b87cb2 Do a deep research about data security and document some resources...
```

### Stats

Overview and usage analytics.

```bash
cchistory stats                                 # Overview
cchistory stats usage --by model                # Token usage by model
cchistory stats usage --by project              # Token usage by project
cchistory stats usage --by day                  # Daily usage with bar chart
```

```
DB                  : .cchistory/cchistory.sqlite
Sources             : 7
Projects            : 5
Sessions            : 13
Turns               : 11
Turns With Tokens   : 8/8
Coverage            : 100.0%
Input Tokens        : 79,536
Output Tokens       : 5,117
Total Tokens        : 461,890
```

### Tree

Hierarchical view of the project-session-turn structure.

```bash
cchistory tree projects                             # All projects
cchistory tree project chat-ui-kit                  # One project with turns
```

```
chat-ui-kit [tentative] sessions=3 turns=3
  host-e336320f / claude_code: 2 session(s)
  host-e336320f / codex: 1 session(s)
history-lab [tentative] sessions=2 turns=2
  host-e336320f / amp: 1 session(s)
  host-e336320f / factory_droid: 1 session(s)
Unassigned sessions=4
```

### Show

Detailed view of a single entity.

```bash
cchistory show project chat-ui-kit          # Project details
cchistory show session <session-id>         # Session details with turns
cchistory show turn <turn-id>               # Full turn with context
cchistory show source codex                 # Source details
```

### Export / Import / Merge

Portable bundles for backup and multi-host merging.

```bash
# Export all sources to a bundle
cchistory export --out ./my-backup

# Export specific sources without raw blobs
cchistory export --out ./my-backup --source codex --no-raw

# Import a bundle into the current store
cchistory import ./my-backup

# Import with conflict resolution
cchistory import ./my-backup --on-conflict skip    # skip | replace | error

# Merge directly between two stores
cchistory merge --from /host-a/.cchistory --to /host-b/.cchistory
```

### Query (JSON)

Structured JSON output for programmatic consumption.

```bash
cchistory query turns --search "refactor" --limit 5
cchistory query turn --id <turn-id>
cchistory query sessions --project <project-id>
cchistory query projects
```

## API

The API (`apps/api`) is a Fastify REST server that provides read and admin access to the CCHistory store.

### Starting the API Server

```bash
# Via the canonical dev services script
pnpm services:start                     # Start both API and web

# Or run the API only
bash scripts/dev-services.sh start api  # API on port 8040
```

### Core Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/api/sources` | List all configured sources |
| `GET` | `/api/turns` | List turns (`?limit=`, `?offset=`) |
| `GET` | `/api/turns/search` | Search turns (`?q=`, `?project_id=`, `?source_ids=`) |
| `GET` | `/api/turns/:turnId` | Full turn projection |
| `GET` | `/api/turns/:turnId/context` | Turn context (replies, tool calls) |
| `GET` | `/api/sessions` | List all sessions |
| `GET` | `/api/sessions/:sessionId` | Session with turns |
| `GET` | `/api/projects` | List projects (`?state=committed\|candidate\|all`) |
| `GET` | `/api/projects/:projectId` | Project detail |
| `GET` | `/api/projects/:projectId/turns` | Project turns |
| `GET` | `/api/projects/:projectId/revisions` | Revision and lineage history |
| `GET` | `/api/artifacts` | Knowledge artifacts |
| `POST` | `/api/artifacts` | Create/update knowledge artifact |

### Admin Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/source-config` | List source configurations |
| `POST` | `/api/admin/source-config` | Add manual source |
| `POST` | `/api/admin/source-config/:sourceId` | Override source base directory |
| `POST` | `/api/admin/source-config/:sourceId/reset` | Reset source to default |
| `POST` | `/api/admin/probe/runs` | Run source probe and persist |
| `POST` | `/api/admin/pipeline/replay` | Replay pipeline (dry-run diff) |
| `GET` | `/api/admin/linking` | Linking review queue |
| `POST` | `/api/admin/linking/overrides` | Create/update linking override |
| `GET` | `/api/admin/masks` | Built-in mask templates |
| `GET` | `/api/admin/drift` | Drift and consistency report |
| `POST` | `/api/admin/lifecycle/candidate-gc` | Archive/purge candidate turns |

### API Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `8040` | API listen port |
| `HOST` | `127.0.0.1` | API listen host |
| `CCHISTORY_CORS_ORIGIN` | `http://localhost:8085,http://127.0.0.1:8085` | Allowed CORS origins |
| `CCHISTORY_API_TOKEN` | _(none)_ | Bearer token for auth (all routes except `/health`) |

**Example:**

```bash
curl http://localhost:8040/api/sources | python3 -m json.tool
```

```json
{
  "sources": [
    {
      "id": "srcinst-codex-abc123",
      "platform": "codex",
      "display_name": "Codex",
      "total_sessions": 4,
      "total_turns": 4,
      "sync_status": "healthy"
    }
  ]
}
```

## Web UI

The web frontend (`apps/web`) is a Next.js 16 application with React 19, Tailwind CSS 4, and SWR for data fetching. It proxies API requests through a Next.js route handler to the Fastify backend.

### Starting the Web Server

```bash
# Start both API + web
pnpm services:start

# Open in browser
open http://localhost:8085
```

### All Turns

Browse every turn across all coding sessions. Switch between **Turn Stream** (virtualized list) and **Session Map** (timeline visualization). Filter by project, link state, and value axis.

<p align="center">
  <img src="docs/screenshots/web-turn-detail.webp" alt="All Turns — Turn Stream with detail panel" width="800" />
</p>

Click any turn card to open a detail panel showing the full user input, assistant replies, tool calls, token usage, session metadata, and pipeline lineage.

### Projects

View project cards organized by workspace identity. Each card shows committed and candidate turn counts, token usage, session count, and active time. Switch between **Project Grid** and **Session Map** views.

<p align="center">
  <img src="docs/screenshots/web-projects.webp" alt="Projects — Grid view with project cards" width="800" />
</p>

### Inbox

Triage unlinked and candidate turns. The Inbox surfaces turns that need project linking decisions. Review evidence, link to existing projects, create new projects, or dismiss.

<p align="center">
  <img src="docs/screenshots/web-inbox.webp" alt="Inbox — Triage unlinked turns" width="800" />
</p>

### Sources Admin

Configure and monitor ingestion sources. View sync status, session/turn counts, and directory paths. Add manual sources, override directories, or reset to defaults.

<p align="center">
  <img src="docs/screenshots/web-sources.webp" alt="Sources — Admin configuration" width="800" />
</p>

### Data Health

Monitor system integrity with drift and consistency metrics. The drift timeline shows trends over the last 7 days, and the source health matrix lists per-source diagnostics.

<p align="center">
  <img src="docs/screenshots/web-data-health.webp" alt="Data Health — Drift timeline and source matrix" width="800" />
</p>

## Project Structure

```
cchistory/
├── apps/
│   ├── api/                    # Fastify REST API server
│   ├── cli/                    # Command-line operator tool
│   └── web/                    # Next.js 16 web frontend
├── packages/
│   ├── domain/                 # Core domain contracts and types
│   ├── source-adapters/        # Platform-specific parsers and adapters
│   ├── storage/                # SQLite persistence, ingestion, linking
│   ├── api-client/             # Shared API DTO contracts
│   └── presentation/           # Presentation mapping (DTO → UI types)
├── scripts/                    # Dev service lifecycle scripts
├── mock_data/                  # Sanitized fixture corpus for testing
├── docs/                       # Documentation and design documents
├── HIGH_LEVEL_DESIGN_FREEZE.md # Authoritative product scope definition
└── AGENTS.md                   # Development guidelines
```

### Build Dependency Graph

```
domain (leaf)
├── source-adapters → domain
├── storage → domain
├── api-client (leaf)
│   └── presentation → api-client
├── api → domain, source-adapters, storage
├── cli → domain, source-adapters, storage
└── web → api-client, presentation
```

## Development

### Build Commands

```bash
# Build all non-web packages (sequential dependency order)
pnpm run build

# Build a specific package
pnpm --filter @cchistory/domain build
pnpm --filter @cchistory/source-adapters build
pnpm --filter @cchistory/storage build
pnpm --filter @cchistory/api-client build
pnpm --filter @cchistory/presentation build
pnpm --filter @cchistory/cli build
pnpm --filter @cchistory/api build

# Build web app (capped Node memory for constrained hosts)
NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @cchistory/web build

# Build everything including web
pnpm run build:all:safe

# Validate core local-source slice (domain + adapters test + storage + cli + api)
pnpm run validate:core
```

### Testing

All test suites use the Node.js built-in test runner (`node --test`).

```bash
pnpm --filter @cchistory/source-adapters test    # 27 adapter & parser tests
pnpm --filter @cchistory/storage test            # 59 storage & lineage tests
pnpm --filter @cchistory/presentation test       # 5 presentation mapping tests
pnpm --filter @cchistory/cli test                # 12 CLI integration tests
pnpm --filter @cchistory/api test                # 10 API endpoint tests
```

### Linting

```bash
cd apps/web && pnpm lint                         # ESLint with zero-warning policy
```

### Dev Services

```bash
pnpm services:start          # Start API (8040) + Web (8085) via supervisor
pnpm services:stop           # Stop all managed services
pnpm services:restart        # Restart all services
pnpm services:status         # Check service status
```
