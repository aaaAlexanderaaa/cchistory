# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] — 2026-04-04

First tagged release — self-host v1 for single-user localhost / trusted-LAN deployment.

### Platforms

- **10 stable adapters**: Codex, Claude Code, Cursor, AMP, Factory Droid, Antigravity, Gemini CLI, OpenClaw, OpenCode, CodeBuddy
- **1 experimental adapter**: LobeChat (registered, not yet real-world validated)

### Entry Points

- **CLI** (`cchistory`) — sync, search, stats, export/import, backup/restore, garbage collection, remote-agent workflows
- **TUI** — Ink-based local browser with project/session/turn panes, search drill-down, and source-health summary
- **API** — Fastify REST server (default `:8040`) with recall, project, admin, probe/replay, and remote-agent control-plane routes
- **Web** — Next.js 16 frontend (default `:8085`) with All Turns, Projects, Inbox, Search, Sources, Linking, Masks, and Drift views

### Architecture

- Monorepo: `domain` → `source-adapters` / `storage` → `api-client` → `presentation` → apps
- SQLite via Node.js built-in `node:sqlite` (`DatabaseSync`)
- Evidence-preserving pipeline: Blob → Record → Fragment → Atom → Candidate → UserTurn
- Project linking via repo fingerprints, workspace paths, and manual overrides

### Highlights

- Full-text search with project and source filters
- Token usage analytics across models, projects, sources, and time
- Portable export bundles with conflict-aware import (skip/replace)
- Standalone CLI artifact channel (`pnpm run cli:artifact`)
- Remote agent collection: pair, upload, schedule, pull
- 14 automated verification scripts covering install, recall, admin, bundle, and real-layout workflows
