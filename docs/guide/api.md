# API Guide

The CCHistory API (`apps/api`) is a Fastify REST server providing read and admin access to the CCHistory store.

By default the API reuses the nearest existing `.cchistory/` under its current
working directory or ancestor directories; if none exists, it falls back to
`~/.cchistory/`. Under the canonical dev-services runtime this normally resolves
to the repository root `.cchistory/`.

## Starting the Server

```bash
# Via the canonical dev services script (starts both API + Web)
pnpm services:start

# Start API only
bash scripts/dev-services.sh start api    # Port 8040
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `8040` | API listen port |
| `HOST` | `127.0.0.1` | API listen host |
| `CCHISTORY_CORS_ORIGIN` | `http://localhost:8085,http://127.0.0.1:8085` | Allowed CORS origins |
| `CCHISTORY_API_TOKEN` | _(none)_ | Bearer token for auth (all routes except `/health`) |

## Core Endpoints

### Health & Metadata

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check: `{ status, hostname }` |
| `GET` | `/openapi.json` | OpenAPI 3.1 document |

### Sources

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/sources` | List all configured sources with sync status |

### Turns

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/turns` | List turns (`?limit=`, `?offset=`) |
| `GET` | `/api/turns/search` | Search turns (`?q=`, `?project_id=`, `?source_ids=`, `?link_states=`, `?value_axes=`, `?limit=`) |
| `GET` | `/api/turns/:turnId` | Full turn projection |
| `GET` | `/api/turns/:turnId/context` | Turn context (assistant replies, tool calls, system messages) |

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/sessions` | List all sessions |
| `GET` | `/api/sessions/:sessionId` | Session with turns |

### Projects

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects` | List projects (`?state=committed\|candidate\|all`) |
| `GET` | `/api/projects/:projectId` | Project detail |
| `GET` | `/api/projects/:projectId/turns` | Project turns (`?state=`) |
| `GET` | `/api/projects/:projectId/revisions` | Revision and lineage history |

### Artifacts

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/artifacts` | List knowledge artifacts (`?project_id=`) |
| `POST` | `/api/artifacts` | Create/update knowledge artifact |
| `GET` | `/api/artifacts/:artifactId/coverage` | Artifact coverage records |

### Tombstones

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/tombstones/:logicalId` | Tombstone for purged logical IDs |

## Admin Endpoints

### Source Configuration

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/source-config` | List source configurations and status |
| `POST` | `/api/admin/source-config` | Add manual source |
| `POST` | `/api/admin/source-config/:sourceId` | Override source base directory |
| `POST` | `/api/admin/source-config/:sourceId/reset` | Reset source to default |

### Probe & Pipeline

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/probe/sources` | List probe sources |
| `POST` | `/api/admin/probe/runs` | Run source probe (optionally persist) |
| `POST` | `/api/admin/pipeline/replay` | Replay pipeline (dry-run diff) |
| `GET` | `/api/admin/pipeline/runs` | List pipeline stage runs |
| `GET` | `/api/admin/pipeline/blobs` | List captured blobs |
| `GET` | `/api/admin/pipeline/records` | List raw records |
| `GET` | `/api/admin/pipeline/fragments` | List source fragments |
| `GET` | `/api/admin/pipeline/atoms` | List conversation atoms |
| `GET` | `/api/admin/pipeline/edges` | List atom edges |
| `GET` | `/api/admin/pipeline/candidates` | List derived candidates |
| `GET` | `/api/admin/pipeline/loss-audits` | List loss audits |
| `GET` | `/api/admin/pipeline/lineage/:turnId` | Turn lineage |

### Linking

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/linking` | Linking review queue |
| `GET` | `/api/admin/linking/overrides` | List linking overrides |
| `POST` | `/api/admin/linking/overrides` | Create/update linking override |

### Lifecycle & Diagnostics

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/sessions/:sessionId/related-work` | Get typed related-work relations for a session |
| `POST` | `/api/admin/projects/lineage-events` | Append lineage events |
| `POST` | `/api/admin/projects/:projectId/delete` | Delete one project and its linked turns |
| `POST` | `/api/admin/lifecycle/candidate-gc` | Archive/purge candidate turns |
| `GET` | `/api/admin/masks` | Built-in mask templates |
| `GET` | `/api/admin/drift` | Drift and consistency report |

### Remote-Agent Control Plane

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/agent/pair` | Pair a remote agent with the host service |
| `POST` | `/api/agent/heartbeat` | Record remote-agent liveness and source-manifest state |
| `POST` | `/api/agent/jobs/lease` | Lease one pending remote-agent collection job |
| `POST` | `/api/agent/uploads` | Upload one remote-agent bundle |
| `POST` | `/api/agent/jobs/:jobId/complete` | Report remote-agent collection job completion or failure |
| `GET` | `/api/admin/agents` | List paired remote agents and their current inventory |
| `POST` | `/api/admin/agents/:agentId/labels` | Update operator-facing remote-agent labels and display name |
| `POST` | `/api/admin/agent-jobs` | Create one typed remote-agent collection job |
| `GET` | `/api/admin/agent-jobs` | List remote-agent collection jobs |

## Managed Review Contract

- The stable manual-review contract for the blocked managed-runtime API read journey lives in `docs/design/R31_MANAGED_API_READ_DIARY_CONTRACT.md`.
- Use that note when you want to record one user-started API review diary for `GET /api/projects` → `GET /api/turns/search` → `GET /api/turns/:turnId/context` without inventing a new startup path.
- This remains a user-started manual review flow, not an agent-started runtime workflow.

## Example

```bash
# Health check
curl http://localhost:8040/health
# => {"status":"ok","hostname":"myhost"}

# List sources
curl http://localhost:8040/api/sources | python3 -m json.tool

# Search turns
curl "http://localhost:8040/api/turns/search?q=refactor&limit=5"

# Add a manual source
curl -X POST http://localhost:8040/api/admin/source-config \
  -H "Content-Type: application/json" \
  -d '{"platform":"codex","base_dir":"/path/to/.codex","sync":true}'
```
