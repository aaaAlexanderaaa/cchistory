# Consolidate Dev Startup Scripts

The project has accumulated three overlapping dev-server startup paths that are now inconsistent. The supervisor-based service system (`pnpm services:start`) is broken, so recent work fell back to `node apps/api/dist/index.js` for the API. This plan fixes the service system and removes the redundant paths.

## Diagnosis

### Root Cause: `nohup bash -lc` breaks `wait`

In `dev-service-common.sh` line 236, the child is launched as:

```bash
nohup bash -lc "${command}" >> "${child_log_file}" 2>&1 < /dev/null &
```

`nohup bash -lc` spawns a **new** shell. The `LAUNCHED_CHILD_PID` captured by `$!` refers to that outer `nohup`-wrapped `bash -lc` process, which immediately spawns the real app and exits. When the supervisor later calls `wait "${CHILD_PID}"`, the PID is no longer a child of the supervisor shell, producing:

```
wait: pid XXXXX is not a child of this shell  (exit code 127)
```

The supervisor interprets this as a crash and retries every 20 seconds in an infinite loop.

### Three Startup Paths (before this change)

| Path | Entry Point | What it does | Status |
|---|---|---|---|
| `pnpm dev:api` / `pnpm dev:web` | Root `package.json` | Builds deps, then runs `pnpm --filter ... dev` in foreground | Works but occupies a terminal |
| `pnpm services:start` | `dev-services.sh` → supervisor → common | Background supervisor with auto-restart | **Broken** (wait bug) |
| `node apps/api/dist/index.js` | Manual CLI | Runs pre-built API in foreground, no dep build, no watch | Debug workaround only |

## Proposed Changes

### Dev Service Common (`launch_service_child`)

#### [MODIFY] [dev-service-common.sh](file:///Users/mock_user/workspace/history-lab/scripts/dev-service-common.sh)

Replace the `nohup bash -lc` launch with a direct `bash -lc ... &` without `nohup`. The supervisor already manages the process lifecycle, and `nohup` is counterproductive here because it detaches the child from the supervisor's process tree, preventing `wait` from working.

**Before (line 236)**:
```bash
nohup bash -lc "${command}" >> "${child_log_file}" 2>&1 < /dev/null &
```

**After**:
```bash
bash -lc "${command}" >> "${child_log_file}" 2>&1 < /dev/null &
```

> [!NOTE]
> The supervisor itself is already launched via `nohup` in `dev-services.sh` line 50, so `SIGHUP` protection is inherited by all children. The inner `nohup` is unnecessary.

---

### Root package.json Cleanup

#### [MODIFY] [package.json](file:///Users/mock_user/workspace/history-lab/package.json)

Remove the old standalone `dev:api` and `dev:web` scripts. These are the original "occupies a terminal" method. The service system is the canonical way.

**Remove**:
```json
"dev:api": "pnpm --filter @history-lab/domain build && ...",
"dev:web": "pnpm --filter @history-lab/api-client build && ..."
```

The canonical entry points after this change:

| Command | Purpose |
|---|---|
| `pnpm services:start` | Start both API and web (supervisor, background) |
| `pnpm services:stop` | Stop both |
| `pnpm services:restart` | Restart both |
| `pnpm services:status` | Show status |
| `pnpm restart:api` | Restart API only |
| `pnpm restart:web` | Restart web only |

---

### AGENTS.md Documentation Update

#### [MODIFY] [AGENTS.md](file:///Users/mock_user/workspace/history-lab/AGENTS.md)

Update the `Build, Test, And Development Commands` section to list the service commands as the canonical startup method. Remove references to `dev:api`/`dev:web`. Keep `restart:web` entry for the existing web runtime workflow.

---

### Stale Log Cleanup

Truncate the `.dev-services/*.log` files so they no longer contain hundreds of lines of the old crash loop.

## Verification Plan

### Automated Test

Run the service system end-to-end and verify both services start, respond to HTTP, and stop cleanly:

```bash
# From repo root
pnpm services:stop                            # ensure clean state
pnpm services:start                           # start both
sleep 5
pnpm services:status                          # expect "running (managed)" for both
curl -sf http://localhost:8040/api/sources     # expect HTTP 200 from API
curl -sf http://localhost:8085 -o /dev/null    # expect HTTP 200 from web
pnpm services:stop                            # clean stop
pnpm services:status                          # expect "stopped" for both
```

### Verify No Crash Loop

After `pnpm services:start`, wait 30 seconds, then check the API supervisor log:

```bash
tail -20 .dev-services/api-supervisor.log
```

There should be exactly **one** `started child pid` line (no repeated crash/restart lines).
