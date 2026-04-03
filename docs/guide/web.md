# Web UI Guide

The CCHistory web frontend (`apps/web`) is a Next.js 16 application with React 19, Tailwind CSS 4, and SWR. It proxies API requests through a Next.js route handler to the Fastify backend.

## Starting the Web Server

```bash
# Start both API + Web via the dev services script
pnpm services:start

# Open in browser
open http://localhost:8085
```

The web server listens on port **8085** and expects the API to be available at port **8040**.

## Seeded V1 Review

Use this flow when you want to inspect the canonical seeded V1 acceptance journey through the web UI without mutating the repository's default `.cchistory/` store.

The stable manual-review checklist now lives in `docs/design/R27_USER_STARTED_WEB_REVIEW_CHECKLIST.md`. Use this guide for the runtime steps, and use the checklist note for required observations, evidence capture, and friction logging.

That checklist is the contract, not the completed diary: the actual recorded seeded web review remains blocked manual work under `R31-KR1` until a user starts the canonical services and performs the review.

### Setup

1. Materialize the seeded review store at an explicit path:

```bash
pnpm run prepare:v1-seeded-web-review -- --store /tmp/cchistory-v1-web-review
```

2. Start the canonical user-operated services while pointing the API at that seeded store:

```bash
CCHISTORY_API_DATA_DIR=/tmp/cchistory-v1-web-review pnpm services:start
```

3. Open `http://localhost:8085` in the browser.

### Review Checks

4. In `Projects`, confirm `alpha-history` appears as the primary committed project for the seeded review slice; opening it should show three turns from the seeded multi-source project journey.
5. In `Search`, query `Alpha traceability target`; expect one match grouped under `alpha-history`. Open it and confirm the detail panel shows the seeded traceability turn with session `session-alpha-amp`, assistant content `Processing.`, and one tool call.
6. In `Sources`, confirm four healthy sources are visible for the seeded slice: `amp`, `claude_code`, `codex`, and `factory_droid`, each with one turn.

### Evidence Capture

Record at least the seeded store path, the service-start command, which checks passed or failed, any screenshots or notes for confusing states, and any friction using the `Discoverability`, `Readability`, `Traceability`, `Guardrail truthfulness`, `Workflow overhead`, or `Parity drift` labels from `docs/design/R27_USER_STARTED_WEB_REVIEW_CHECKLIST.md`.

### Shutdown

7. When finished, stop the services manually with `pnpm services:stop`.

This review path keeps the startup architecture unchanged: the user still starts the canonical services, and only the API data directory is overridden for that session.

## Navigation

The shell navigation provides access to all views, with Search available as a first-class history destination and quick-action entry point:

**History**
- **All Turns** — Browse every turn across all coding sessions
- **Projects** — View and manage project identities
- **Inbox** — Triage unlinked and candidate turns
- **Search** — Search canonical turn text across projects and sessions

**Admin**
- **Sources** — Configure and monitor ingestion sources
- **Linking** — Review and manage project-turn associations
- **Masks** — View and test mask templates
- **Data Health** — Monitor drift, consistency, and source health

## Views

### All Turns

Browse every turn across all coding sessions. Two display modes:

- **Turn Stream** — Virtualized list of turn cards, sorted by newest/oldest/project
- **Session Map** — Timeline visualization of sessions and turns

**Overview:** compact summary pills surface visible turns, linked-state mix, and project count for the current view.

**Filters:** project, link state (committed / candidate / unlinked), value axis (active / archived)

Click any turn card to open a detail panel showing the full user input, assistant replies, tool calls, token usage, session metadata, and pipeline lineage.

![All Turns — Turn Stream with detail panel](../screenshots/web-turn-detail.webp)

### Projects

View project cards organized by workspace identity. Each card displays:

- Committed and candidate turn counts
- Token usage totals
- Session count and active time
- Workspace path

Three display modes: **Project Grid**, **Tree**, and **Session Map**.

**Tree** exposes direct project → session → turn navigation while preserving the existing project detail and turn detail flows.

![Projects — Grid view with project cards](../screenshots/web-projects.webp)

### Inbox

Triage interface for turns needing attention. Three tabs:

- **Unlinked** — Turns with no project signal
- **Candidates** — Turns with probable matches needing review
- **Archive** — Previously dismissed turns

Actions: link to existing project, create new project, dismiss. Grid and list views available.

The header separates **Queue Overview**, **Queue**, and **View** controls so pending work is easier to scan before triage actions.

![Inbox — Triage unlinked turns](../screenshots/web-inbox.webp)

### Sources

Configure and monitor ingestion sources:

- View sync status, session/turn counts, directory paths
- Scan the current filtered set through overview pills for health, manual sources, and overrides
- Add manual sources (select platform + path)
- Override directories or reset to defaults
- Save & Rescan individual sources

Supported platforms for manual addition: Codex, Claude Code, Factory Droid, AMP, Cursor, Antigravity, Gemini CLI, OpenClaw, OpenCode, LobeChat, CodeBuddy.

Windows note (2026-03-27): verified default-root auto-discovery currently exists for `Cursor` and `Antigravity`. For `Codex`, `Claude Code`, `Factory Droid`, `AMP`, `Gemini CLI`, `OpenClaw`, `OpenCode`, `CodeBuddy`, and `LobeChat`, use the `Sources` view to confirm or override `base_dir` explicitly on Windows before treating the path as authoritative. Several of these adapters are now `stable`, but their Windows default roots are still not host-verified.

![Sources — Admin configuration](../screenshots/web-sources.webp)

### Linking

Review and manage project-turn associations:

- **Unlinked:** Create new project or dismiss
- **Candidates:** Accept (link) or dismiss
- **Auto-link:** Bulk-link all eligible candidates
- Session evidence display (repo, workspace, etc.)

### Masks

View and test mask templates:

- List templates sorted by priority, name, or update time
- View pattern, match type, collapse label, applies-to, priority
- **Test panel:** Paste sample text and preview masking result
- Display segments and canonical text after masking

### Data Health

Monitor system integrity:

- **Summary pills:** Global Drift, Consistency, Unlinked Turns, Sources Awaiting Sync
- **Drift Timeline:** 7-day chart of drift and consistency trends
- **Source Health Matrix:** Per-source diagnostics with turns, last sync, and status

![Data Health — Drift timeline and source matrix](../screenshots/web-data-health.webp)

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `CCHISTORY_INTERNAL_API_ORIGIN` | `http://127.0.0.1:8040` | Backend API URL (server-side proxy) |
| `NEXT_PUBLIC_CCHISTORY_API_BASE_URL` | `/api/cchistory` | Client-side API base URL |
| `CCHISTORY_API_TOKEN` | _(none)_ | Bearer token forwarded to API |
| `CCHISTORY_API_DATA_DIR` | _(default store resolution)_ | Optional API-side override for the indexed store path; useful for seeded review stores without changing the canonical service flow |
