# Windows Compatibility Review

> Audit date: 2026-03-17 · Branch: `cursor/windows-b485`
>
> Scope: full repository — `scripts/`, `packages/*`, `apps/*`, root `package.json`, Python tooling.

## Reported Symptoms

```
pnpm services:start
invalid option namesh: line 2: set: pipefail
Command failed with exit code 2.
open不是内部或外部命令，也不是可运行的程序
```

| Symptom | Root cause |
|---------|-----------|
| `set: pipefail — invalid option name` | Windows Git-for-Windows `sh.exe` runs as POSIX `sh`; `pipefail` is bash-only. All 6 `.sh` files fail at line 2. |
| `open` is not a recognized command | A downstream tool (likely Next.js dev server or pnpm lifecycle hook) calls the macOS `open` command to launch a browser. Windows equivalent is `start`; the call is not in this repository's code. |

---

## Layer-by-Layer Audit

### 1. `scripts/*.sh` — Service lifecycle (6 files)

**Verdict: entirely Unix-only. Zero Windows compatibility.**

| File | Lines | Bash-only constructs | Unix-only commands | Unix-only paths |
|------|-------|----------------------|--------------------|-----------------|
| `dev-service-common.sh` | 377 | `set -euo pipefail`, `BASH_SOURCE`, `[[ ]]`, `=~`, `< <(…)`, `$(( ))` | `kill`/`kill -0`/`kill -9`, `lsof`, `fuser`, `pgrep`, `nohup`, `tr`, `sed`, `seq`, `head` | `/dev/null` |
| `dev-services.sh` | 175 | `set -euo pipefail`, `BASH_SOURCE`, `[[ ]]`, `< <(…)`, heredoc | `tr`, `sed`, `lsof`, `nohup` | `/dev/null` |
| `dev-service-supervisor.sh` | 85 | `set -euo pipefail`, `BASH_SOURCE`, `[[ ]]`, `$(( ))` | `rm -f`, `sleep`, `kill` (via helper) | — |
| `restart-web-preview.sh` | 43 | `set -euo pipefail`, `BASH_SOURCE`, `[[ ]]` | `lsof`, `fuser`, `kill`, `setsid`, `cat`, `sleep` | `/dev/null` |
| `restart-api-dev.sh` | 5 | `set -euo pipefail`, `BASH_SOURCE` | `exec bash` | — |
| `restart-web-dev.sh` | 5 | `set -euo pipefail`, `BASH_SOURCE` | `exec bash` | — |

Process management primitives used (`nohup`, `setsid`, `kill -0`, process substitution, PID files, `lsof` port detection, `pgrep -P` process-tree walking) have no direct Windows equivalents in CMD or PowerShell.

### 2. `scripts/*.py` — Mock data tooling (2 files)

**Verdict: portable Python, but hardcoded macOS paths.**

| File | Issue | Severity |
|------|-------|----------|
| `generate_mock_data.py` | `HOME = Path("/Users/alex_m4")`, all source paths under `/Users/alex_m4/`, macOS `Library/Application Support` layout, `/private/var/folders/` regex | Low (fixture generator, not runtime) |
| `validate_mock_data.py` | Validates against `/Users/mock_user/` and `Library/Application Support` patterns | Low (validation, not runtime) |

### 3. `scripts/*.mjs` — Probe script (1 file)

| File | Status |
|------|--------|
| `probe-smoke.mjs` | **Clean.** Uses only portable Node.js APIs. |

### 4. Root `package.json` — Script entry points

**Verdict: 10 of 13 scripts are Windows-incompatible.**

| Script | Command | Issue |
|--------|---------|-------|
| `services:start` | `bash scripts/dev-services.sh start all` | Requires `bash` |
| `services:stop` | `bash scripts/dev-services.sh stop all` | Requires `bash` |
| `services:restart` | `bash scripts/dev-services.sh restart all` | Requires `bash` |
| `services:status` | `bash scripts/dev-services.sh status all` | Requires `bash` |
| `services:run:web` | `bash scripts/dev-services.sh run web` | Requires `bash` |
| `services:run:api` | `bash scripts/dev-services.sh run api` | Requires `bash` |
| `restart:api` | `bash scripts/restart-api-dev.sh` | Requires `bash` |
| `restart:web` | `bash scripts/restart-web-dev.sh` | Requires `bash` |
| `restart:web:preview` | `bash scripts/restart-web-preview.sh` | Requires `bash` |
| `cli` | `NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }…"` | Bash parameter expansion |
| `build:all:safe` | `… && NODE_OPTIONS=… pnpm …` | Inline env var syntax |
| `mock-data:validate` | `python3 scripts/validate_mock_data.py` | `python3` not on Windows PATH (usually `python` or `py`) |
| `build` | `pnpm --filter … && pnpm --filter …` | **OK** (`&&` works in CMD) |

### 5. `apps/web/package.json`

| Script | Command | Issue |
|--------|---------|-------|
| `dev` | `NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=…" next dev …` | Bash parameter expansion; fails in CMD/PowerShell |
| `build` | `next build` | **OK** |
| `start` | `next start …` | **OK** |
| `lint` | `eslint . --max-warnings=0` | **OK** |

### 6. `packages/domain`

**Verdict: Clean.**

- `normalizeSourceBaseDir` explicitly handles Windows drive letters (`C:` → `c:`) and backslash-to-forward-slash conversion.
- No filesystem I/O; pure data contracts.

### 7. `packages/source-adapters`

**Verdict: Moderate — 7 of 9 adapters missing Windows base-dir candidates.**

#### Adapter Windows support matrix

| Adapter | Handles `win32`? | Default path(s) | Windows risk |
|---------|------------------|------------------|-------------|
| `cursor` | **Yes** | darwin: `Library/Application Support/Cursor`; win32: `AppData/Roaming/Cursor`; linux: `.config/Cursor` | None |
| `antigravity` | **Yes** | darwin: `Library/Application Support/Antigravity`; win32: `AppData/Roaming/Antigravity`; linux: `.config/Antigravity` | None |
| `codex` | No | `~/.codex/sessions` | Low — Codex CLI stores under `~/.codex` on all platforms |
| `claude_code` | No | `~/.claude/projects` | Low — Claude Code stores under `~/.claude` on all platforms |
| `factory_droid` | No | `~/.factory/sessions` | Low — Factory stores under `~/.factory` on all platforms |
| `amp` | No | `~/.local/share/amp/threads` | **Medium** — XDG path; AMP on Windows likely uses `AppData` |
| `openclaw` | No | `~/.openclaw/agents` | Low — dotdir under home |
| `opencode` | No | `~/.local/share/opencode/storage/session` | **Medium** — XDG path |
| `lobechat` | No | `~/.config/lobehub-storage` | **Medium** — XDG path |

> The `DefaultSourceResolutionOptions` type already provides `platform` and `appDataDir` fields — the 7 non-Windows adapters simply don't use them.

#### Core parsing engine (`legacy.ts`)

- `normalizeWorkspacePath` handles Windows backslashes and drive letters correctly.
- `walkFiles` uses `fs.readdir` recursively — portable.
- `path.sep`-based matching used in `cursor.ts` and `antigravity.ts` `getSourceFilePriority` — correct for both platforms.

### 8. `packages/storage`

**Verdict: Moderate — weak-path detection is Unix-only.**

| Location | Issue | Severity |
|----------|-------|----------|
| `linker.ts:700-721` `isWeakWorkspacePath` | Only checks `/root`, `/tmp`, `/tmp/…`, `/.config/aionui/…`. Windows temp paths (`C:/Users/…/AppData/Local/Temp/…`) are not treated as weak. | Moderate |
| `linker.ts` path normalization | Uses `normalizeSourceBaseDir` from domain; handles Windows correctly | Clean |
| Tests (`index.test.ts`) | Hardcoded `/tmp/storage-fixture/…`, `/root`, `/workspace` in ~15 fixtures | Low (test-only) |
| `node:sqlite` (`DatabaseSync`) | Built into Node.js 22; cross-platform | Clean |

### 9. `packages/api-client`

**Verdict: Clean.** Pure TypeScript types and URL path constants. No filesystem, no platform logic.

### 10. `packages/presentation`

**Verdict: Clean.** Pure data mapping. Test fixtures use `/workspace/…` strings but these are semantic values, not filesystem operations.

### 11. `apps/cli`

**Verdict: Moderate.**

| Location | Issue | Severity |
|----------|-------|----------|
| `index.ts:1` | `#!/usr/bin/env node` shebang | Low (ignored when run via `node dist/index.js`) |
| `store.ts` | Uses `path.resolve(cwd, ".cchistory")` and `path.join` throughout | Clean |
| `bundle.ts` | `assertSafePathComponent` rejects `/`, `\`, `..`, `\0` | Clean |
| Tests (`index.test.ts`) | `process.env.HOME = tempRoot` for source discovery; `os.homedir()` on Windows uses `USERPROFILE`, not `HOME` | Moderate |
| Tests | Hardcoded `cwd: "/workspace/cchistory"` in ~10 places, `base_dir: "/tmp/cli-legacy-search"` | Low (test-only) |

### 12. `apps/api`

**Verdict: Moderate.**

| Location | Issue | Severity |
|----------|-------|----------|
| `app.ts:79-80` | `path.resolve(process.cwd(), "..", "..", ".cchistory")` — relative path works on both platforms | Clean |
| `app.ts:1296` | `value.replace(/\\/g, "/")` — Windows backslash normalization | Clean |
| `index.ts:27-28` | `process.on("SIGTERM", …)` / `process.on("SIGINT", …)` | Clean (Node.js handles these on Windows) |
| Tests | Hardcoded `/tmp/api-fixture`, `/workspace/…` in ~8 places | Low (test-only) |

### 13. `apps/web`

**Verdict: Low.**

| Location | Issue | Severity |
|----------|-------|----------|
| `next.config.mjs` | `fileURLToPath`, `os.hostname()`, `os.networkInterfaces()` | Clean |
| `package.json` `dev` script | Bash parameter expansion (see §5 above) | Moderate |
| Runtime code | No filesystem operations; pure React/Next.js | Clean |

### 14. Root configuration

| File | Status |
|------|--------|
| `tsconfig.base.json` | Clean — `forceConsistentCasingInFileNames: true` is good for Windows |
| `pnpm-workspace.yaml` | Clean |
| All per-package `tsconfig.json` | Clean |

---

## Severity Summary

| Severity | Count | Areas |
|----------|-------|-------|
| **Critical** | 1 | Service lifecycle scripts — entirely bash/Unix; blocks `pnpm services:*` on Windows |
| **Moderate** | 5 | `package.json` bash env syntax (root `cli`, `build:all:safe`; web `dev`); 7 adapter missing Windows base-dir candidates; `isWeakWorkspacePath` Unix-only; CLI tests using `HOME` env; `python3` command name |
| **Low** | 3 | Test fixtures with hardcoded Unix paths (~30 occurrences across CLI/API/storage tests); Python mock-data scripts with macOS paths; shebang lines |
| **Clean** | 6 | `domain`, `api-client`, `presentation`, `next.config.mjs`, `probe-smoke.mjs`, all `tsconfig.json` |

---

## Remediation Plan

### Phase 1 — Unblock startup (Critical)

**Goal: `pnpm services:start`, `pnpm services:stop`, `pnpm services:status` work on Windows.**

| Task | Approach | Scope |
|------|----------|-------|
| **1a.** Replace bash service scripts with Node.js | Create `scripts/dev-services.mjs` (main), `scripts/dev-service-supervisor.mjs` (daemon loop) using `node:child_process`, `node:net`, `node:fs`, `node:os` | ~500-600 lines new; replaces 3 core `.sh` files |
| **1b.** Update `package.json` wrappers | Change `bash scripts/…` → `node scripts/…` for all `services:*`, `restart:*` scripts | 10 lines changed in root `package.json` |
| **1c.** Platform-conditional process utilities | `kill` → `taskkill /PID /T /F` on win32; `lsof` → `netstat -ano` parsing or `node:net` bind-test; `pgrep -P` → WMI query or recursive `child_process` | Part of 1a |
| **1d.** Fix `cli` and `web dev` scripts | Replace bash parameter expansion with a small Node.js env-wrapper or `cross-env` | 2 scripts in `package.json`, 1 in `apps/web/package.json` |
| **1e.** Fix `python3` → `python` | Use `python` or a shim that tries `python3` then `python` | 1 line |

### Phase 2 — Source discovery (Moderate)

**Goal: all adapters find their data on Windows.**

| Task | Approach | Scope |
|------|----------|-------|
| **2a.** Add Windows base-dir candidates to 7 adapters | Use `options.platform` and `options.appDataDir` following the `cursor.ts` / `antigravity.ts` pattern | ~5-15 lines per adapter file; 7 files |
| **2b.** Extend `isWeakWorkspacePath` | Add Windows temp-path patterns: `appdata/local/temp`, drive-letter `/tmp` equivalents | ~10 lines in `linker.ts` |

### Phase 3 — Test portability (Low)

**Goal: test suite passes on Windows without fixture changes masking real bugs.**

| Task | Approach | Scope |
|------|----------|-------|
| **3a.** Replace hardcoded `/tmp/…` with `os.tmpdir()` + `path.join()` in test setup | Mechanical replacement | ~20 call sites across 4 test files |
| **3b.** Replace `process.env.HOME =` with injected `homeDir` option in CLI tests | Extend test helper to pass `homeDir` | `apps/cli/src/index.test.ts` |
| **3c.** Platform-conditional assertions for path format | Where tests assert `/Users/…` or `/workspace/…` as semantic workspace identity, leave as-is; where tests create real temp paths, use `os.tmpdir()` | Case-by-case |

### Phase 4 — Optional polish

| Task | Notes |
|------|-------|
| Python mock-data scripts with Windows paths | Only needed if mock-data generation is run on Windows |
| `restart-web-preview.sh` PowerShell equivalent | Only needed if preview workflow is used on Windows |

---

## Architectural Notes

1. **The runtime (Node.js + `node:sqlite`) is already cross-platform.** No external database, no Docker, no native modules beyond what Node.js 22 ships. The Windows blocker is purely the shell-script service layer and a few `package.json` bash-isms.

2. **The domain model handles Windows paths.** `normalizeSourceBaseDir` and `normalizeWorkspacePath` both handle drive letters and backslashes. No changes needed in the domain or storage persistence layer.

3. **Two adapters (`cursor`, `antigravity`) already demonstrate the correct pattern** for Windows base-dir resolution. The 7 remaining adapters need the same `if (hostPlatform === "win32")` branch, which the type system already supports via `options.platform` and `options.appDataDir`.

4. **`forceConsistentCasingInFileNames: true`** in `tsconfig.base.json` is already correct for Windows where the filesystem is case-insensitive.
