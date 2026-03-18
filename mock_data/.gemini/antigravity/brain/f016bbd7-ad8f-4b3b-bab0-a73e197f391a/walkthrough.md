# Walkthrough: Startup Script Consolidation

## Root Cause

`launch_service_child` in [dev-service-common.sh](file:///Users/mock_user/workspace/history-lab/scripts/dev-service-common.sh) used `nohup bash -lc` to spawn children. This created a **detached** subprocess that the supervisor's `wait` could not track → exit code 127 → infinite 20-second restart loop.

## Changes

### 1. Fix: remove inner `nohup`

render_diffs(file:///Users/mock_user/workspace/history-lab/scripts/dev-service-common.sh)

The supervisor itself is already launched via `nohup` in `dev-services.sh`, so SIGHUP protection is inherited. The inner `nohup` was unnecessary and harmful.

### 2. Remove redundant scripts from root `package.json`

render_diffs(file:///Users/mock_user/workspace/history-lab/package.json)

`dev:api` and `dev:web` were the old foreground-blocking startup method. Removed in favor of the service system.

### 3. Update `AGENTS.md`

render_diffs(file:///Users/mock_user/workspace/history-lab/AGENTS.md)

Canonical commands are now documented:

| Command | Purpose |
|---|---|
| `pnpm services:start` | Start API + web (background, supervised) |
| `pnpm services:stop` | Stop both |
| `pnpm services:status` | Show status |
| `pnpm restart:api` | Restart API only |
| `pnpm restart:web` | Restart web only |

## Verification

```
pnpm services:start   → api: started supervisor 49676 / web: started supervisor 49710
pnpm services:status  → both "running (managed)"
curl localhost:8040    → HTTP 200
curl localhost:8085    → HTTP 200
supervisor logs        → exactly 1 "started child pid" per service, no crash loop
pnpm services:stop    → both "stopped"
```
