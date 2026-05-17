# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

No changes yet.

## [0.2.0] — 2026-05-17

Release maintenance for the current self-host support baseline.

### Documentation

- Reorganized README and `docs/` entrypoints around reader tasks: operate,
  understand architecture, validate release/support claims, inspect source data,
  report issues, and track roadmap work.
- Added `docs/README.md` as the top-level documentation map and clarified which
  documents are semantic source-of-truth versus runtime inventory.
- Clarified that `self-host v1` is a support-scope gate while `0.2.0` is the
  package/API/Web release marker.

### Platforms

- Added **Accio Work** as a registered `experimental` adapter for local-runtime session evidence while its support boundary remains under validation.

### Release Metadata

- Bumped workspace package versions, OpenAPI metadata, and the Web UI version
  label to `0.2.0`.

## [0.1.0] — 2026-04-04

First tagged release — self-host v1 for single-user localhost / trusted-LAN deployment.

### Platforms

- **10 stable adapters**: Codex, Claude Code, Cursor, AMP, Factory Droid, Antigravity, Gemini CLI, OpenClaw, OpenCode, CodeBuddy
- **Experimental at release time**: LobeChat (registered, not yet real-world validated)

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
