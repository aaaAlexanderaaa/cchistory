# CCHistory Full Project Review — 2026-04-05

**Reviewer:** Accio (automated deep review)
**Scope:** Entire codebase — 8 packages, 4 apps, ~56K lines, 291 unit tests + 48 E2E
**Previous review:** 2026-04-05 (earlier session) — grade B+
**Test results (post-fixes):** 291 total (289 pass, 0 fail, 2 skipped remote-agent)

---

## Executive Summary

CCHistory is a well-architected local-first memory system with strong design discipline. The codebase faithfully implements the design freeze's evidence-preserving pipeline and project-centric model. Code quality is high across the backend stack — zero `any` in production API code, comprehensive adapter test coverage, and thorough E2E journeys.

The main risks are concentrated in three areas: (1) the known `refreshDerivedState()` scalability ceiling, (2) the zero-test web frontend, and (3) accumulated N+1 query patterns in storage that will compound with the scalability issue.

**Overall Grade: B+** (unchanged from prior review — improvements since then were bug fixes, not architectural changes)

---

## Test Results Summary

| Package | Tests | Pass | Fail | Skip |
|---------|------:|-----:|-----:|-----:|
| domain | 100 | 100 | 0 | 0 |
| source-adapters | 74 | 74 | 0 | 0 |
| storage | 38 | 38 | 0 | 0 |
| presentation | 12 | 12 | 0 | 0 |
| api-client | 9 | 9 | 0 | 0 |
| cli | 15 | 13 | 0 | 2 |
| tui | 22 | 22 | 0 | 0 |
| api | 21 | 21 | 0 | 0 |
| **Total** | **291** | **289** | **0** | **2** |

`validate:core` also passes cleanly.

---

## Findings by Severity

### Critical (0)

No critical issues found.

### High (6)

| # | Package | Finding | Details |
|---|---------|---------|---------|
| H-1 | storage | **`refreshDerivedState()` loads ALL data per mutation** | O(T+S+C) per write operation. Deserializes ~150K JSON blobs at 50K turns. Every `replaceSourcePayload`, `upsertProjectOverride`, `deleteProject`, `purgeTurn`, and `garbageCollectCandidateTurns` triggers full recomputation. Estimated 200-500ms per mutation at 50K turns, multi-second at 200K. |
| H-2 | domain | **`UserTurnProjection` has dual, redundant identity fields** | Has `id`/`revision_id` AND `turn_id`/`turn_revision_id` (optional!). Violates design freeze §6.3 requiring stable logical IDs. Creates confusion for downstream consumers about which pair is canonical. |
| H-3 | domain | **`UserTurnProjection` does not extend `TurnIdentity`** | `TurnIdentity` interface exists but `UserTurnProjection` doesn't use it. Inconsistent with how `ProjectIdentity extends ProjectRevisionIdentity` and `KnowledgeArtifact extends ArtifactIdentity`. |
| H-4 | source-adapters | **`cursor/runtime.ts` is unreadable (binary file)** | The Cursor platform runtime parser cannot be read by any tool — reports as binary. May be corrupted or have encoding issues. Cannot review for correctness or security. Needs immediate investigation. |
| H-5 | source-adapters | **No timeout on Antigravity live HTTP requests** | `antigravity/live.ts` uses `node:https` `request()` without timeout/AbortController. A hung local language server would cause the probe to hang indefinitely. |
| H-6 | web | **Zero test coverage on 9,418 lines** | No unit tests, no component tests, no E2E browser tests. Any refactor is high-risk. Combined with unhandled async mutations in inbox/linking views, this creates a fragile surface. |

### Medium (19)

| # | Package | Finding |
|---|---------|---------|
| M-1 | storage | **No foreign key constraints** — 0 FK constraints despite `PRAGMA foreign_keys = ON`. Orphan risk. |
| M-2 | storage | **Missing indexes on `session_ref` columns** — 5 tables queried/deleted by `session_ref` without indexes. |
| M-3 | storage | **N+1 query patterns** — `selectJsonByIds` (loop per ID), `listAtomsEdgesForAtomIds` (2N queries), `listKnowledgeArtifacts` (load all, filter in memory). |
| M-4 | storage | **`deleteProject` loads 6 full tables into memory** for one delete operation. |
| M-5 | storage | **`upsertProjectOverride` not transactional** with its derived state refresh. |
| M-6 | storage | **No runtime type validation** — `fromJson<T>()` trusts stored JSON matches TypeScript type. |
| M-7 | storage | **FTS stale text risk** — FTS5 fallback mode (substring search) has zero test coverage. |
| M-8 | domain | **`Session`/`UserTurn`/`TurnContext` are thin aliases** to projection types, conflating evidence and projection layers. |
| M-9 | domain | **Extra `SourceFamily` values** (`local_runtime_sessions`, `manual_export_bundles`) not in design freeze. |
| M-10 | domain | **Dual `link_state`/`project_link_state` fields** on `UserTurnProjection`. Which is canonical? |
| M-11 | domain | **`Record<string, unknown>` used 9 times** for payloads. No structural guidance for downstream consumers. |
| M-12 | domain | **Lifecycle guard rules not encoded in types** — illegal state combinations are representable. |
| M-13 | domain | **`ImportBundle.manifest` is `Record<string, unknown>`** despite `ImportBundleManifest` type existing. |
| M-14 | domain | **`source_id`/`session_id` naming** doesn't match design freeze's `source_refs`/`session_ref`. |
| M-15 | source-adapters | **`normalizePath` duplicated in 3 files** (openclaw, opencode, codebuddy — dead code in codebuddy). |
| M-16 | source-adapters | **No unit tests for `masks.ts`** (322 lines of mask template matching, regex, region overlap). |
| M-17 | source-adapters | **`parser.ts` god module** (~1,174 lines routing all 11 platforms). |
| M-18 | web | **Hardcoded zh-CN locale** — `date-fns/locale/zhCN` and `zh-Hans-CN` collation in an English UI. |
| M-19 | web | **Full-turn fetch for inbox count** — `useTurnsQuery()` fetches all turns at root level for sidebar count. |

### Low (21)

| # | Package | Finding |
|---|---------|---------|
| L-1 | domain | `Host` ID lacks branded type enforcement |
| L-2 | domain | `SourcePlatform` ambiguity between `gemini` CLI vs web |
| L-3 | domain | `project_ref` duplication with `project_id` on `UserTurnProjection` |
| L-4 | domain | `node:crypto` import at bottom of file (unconventional) |
| L-5 | domain | All types exported — no internal/public API separation |
| L-6 | domain | Remote agent types (~15% of file) not in design freeze |
| L-7 | domain | Single-file monolith (1,160 lines) |
| L-8 | source-adapters | `overlaps()` is O(n²) for mask region checking |
| L-9 | source-adapters | Files read entirely into memory as Buffer |
| L-10 | source-adapters | No unit tests for `atomizer.ts` |
| L-11 | api | Shallow JSON Schema for nested agent bundle objects |
| L-12 | api | OpenAPI doc is summary-only stub |
| L-13 | api | `splitCsv` cast for `link_states` not validated |
| L-14 | api | Error status determined by message prefix matching (fragile) |
| L-15 | cli | `merge` command not in help text |
| L-16 | cli | `--link-state` flag not validated before passing to storage |
| L-17 | cli | Non-long `ls sessions` listing doesn't truncate long titles |
| L-18 | cli | `renderImportPlanTable` uses `any[]` |
| L-19 | tui | **Brittle relative import** `"../../../packages/source-adapters/dist/index.js"` instead of workspace package |
| L-20 | tui | No viewport/scrolling for large datasets |
| L-21 | web | Unused `@dnd-kit` dependencies in package.json |

---

## Package Scorecards

| Package | Type Safety | Test Coverage | Design Alignment | Code Quality | Overall |
|---------|:-----------:|:------------:|:-----------------:|:------------:|:-------:|
| domain | ★★★★☆ | ★★★★★ | ★★★★☆ | ★★★★☆ | **B+** |
| source-adapters | ★★★★★ | ★★★★☆ | ★★★★★ | ★★★★☆ | **A-** |
| storage | ★★★☆☆ | ★★★☆☆ | ★★★★☆ | ★★★☆☆ | **B** |
| api-client | ★★★★★ | ★★★★☆ | ★★★★★ | ★★★★★ | **A** |
| api | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★☆ | **A** |
| presentation | ★★★★★ | ★★★★☆ | ★★★★★ | ★★★★★ | **A** |
| cli | ★★★★☆ | ★★★☆☆ | ★★★★☆ | ★★★★☆ | **B+** |
| tui | ★★★★☆ | ★★★★☆ | ★★★★☆ | ★★★☆☆ | **B** |
| web | ★★★★☆ | ☆☆☆☆☆ | ★★★★☆ | ★★★☆☆ | **C+** |

---

## Test Infrastructure Assessment

| Area | Rating | Notes |
|------|--------|-------|
| E2E Journeys (5) | ★★★★☆ | Well-designed; Journey E is true E2E but covers only 5/10 adapters |
| Verification Scripts (16) | ★★★★☆ | Thorough but `verify-cli-artifact.mjs` is a 985-line monolith |
| Mock Data (32 scenarios) | ★★★★★ | Excellent — real data sanitized, validated, 10 adapters covered |
| Test Naming | ★★★★★ | Behavior-descriptive, consistent |
| Test Isolation | ★★★★☆ | Strong temp dir discipline; minor `process.env.HOME` mutation risk |
| Coverage Gaps | ★★★☆☆ | No web tests, no incremental sync, no schema migration, no perf tests |

### Key Coverage Gaps
1. **Web frontend** — zero automated tests
2. **Incremental sync** — no test for sync→sync delta path
3. **Schema migration** — untested auto-migration on older stores
4. **Performance** — no benchmarks for storage at scale
5. **Error recovery** — no systematic corruption/fuzzing tests

---

## Architectural Strengths

1. **Evidence-preserving pipeline** — Raw evidence is never silently rewritten. Provenance is reversible. The Blob→Record→Fragment→Atom→Candidate→UserTurn pipeline faithfully implements the design freeze.
2. **Type discipline** — Zero `any` in API production code. Consistent use of `unknown` with runtime type guards. Strong adapter interface enforcement.
3. **Parse boundary discipline** — Source-specific quirks stop at the adapter layer. All 11 adapters implement `PlatformAdapter` consistently.
4. **Design freeze alignment** — Code closely follows the design freeze across all packages. Naming mostly consistent. Lifecycle semantics implemented correctly.
5. **Security posture** — Parameterized queries, allowlisted table names, `execFile` for git (no shell interpolation), path traversal checks in bundling, timing-safe token comparison.
6. **Test philosophy** — "Skeptical" black-box testing via out-of-process CLI runs. Rich fixtures derived from real sanitized data. Dual CLI+API+TUI verification in E2E journeys.

---

## Architectural Risks

1. **Storage scaling ceiling** — `refreshDerivedState()` is the single biggest risk. Every mutation loads all turns, sessions, and candidates into memory. At current scale (~few K turns) it's fine. At 50K turns, it will be the bottleneck for every sync operation.

2. **N+1 query compounding** — The N+1 patterns in `selectJsonByIds`, `listAtomsEdgesForAtomIds`, and TUI browser will amplify the scaling problem. These are independent issues but share the same root cause: storage queries were designed for small datasets.

3. **Web frontend fragility** — 9,418 lines with zero tests. Unhandled async mutations in inbox/linking views. Hardcoded Chinese locale. Full-turn fetch on every page. This is the least maintainable package.

4. **Cursor adapter file corruption** — `cursor/runtime.ts` reporting as binary is a potential corruption issue that needs investigation.

---

## Priority Recommendations

### Immediate (do now)

| # | Action | Impact |
|---|--------|--------|
| 1 | **Investigate `cursor/runtime.ts` binary file** — Run `file` and `xxd`, regenerate from git if corrupted | Blocks Cursor adapter review |
| 2 | **Add timeout to Antigravity HTTP requests** — `request.setTimeout(30000)` or `AbortSignal.timeout(30000)` | Prevents probe hangs |
| 3 | **Fix `UserTurnProjection` identity** — Make `turn_id`/`turn_revision_id` required, extend `TurnIdentity` | Type safety for all consumers |

### Short-term (next sprint)

| # | Action | Impact |
|---|--------|--------|
| 4 | **Add indexes on `session_ref` columns** — 5 tables lacking indexes | Performance for session-based queries |
| 5 | **Extract `normalizePath` to shared utils** — Remove duplication + dead code in codebuddy | Code hygiene |
| 6 | **Add try/catch to web mutation handlers** — inbox and linking views have unhandled async errors | Prevents silent failures |
| 7 | **Remove unused `@dnd-kit` dependencies** from web | Bundle size |
| 8 | **Add unit tests for `masks.ts`** — 322 lines of untested regex/region logic | Risk reduction |

### Medium-term (next month)

| # | Action | Impact |
|---|--------|--------|
| 9 | **Incremental derived state refresh** — Dirty-flag approach: track changed sources, only re-derive affected data | Scalability path to 200K+ turns |
| 10 | **Batch N+1 queries** — `selectJsonByIds` should use `WHERE id IN (?)`, `listAtomsEdgesForAtomIds` should batch | Performance at scale |
| 11 | **Add web component tests** — Start with `lib/api.ts`, `lib/mask-utils.ts`, `lib/token-usage.ts` | Risk reduction on most fragile package |
| 12 | **Add foreign key constraints** — Schema already enables `PRAGMA foreign_keys = ON` | Data integrity safety net |
| 13 | **Split `parser.ts`** (1,174 lines) into per-platform modules | Maintainability |

### Long-term (next quarter)

| # | Action | Impact |
|---|--------|--------|
| 14 | **Add Playwright E2E tests for web** | Full-stack confidence |
| 15 | **Add runtime schema validation at storage boundaries** — Zod/valibot for `fromJson<T>()` | Corruption resilience |
| 16 | **Expand Journey E** to cover remaining 5 adapters (codex, claude_code, amp, factory_droid, antigravity) | Adapter regression coverage |
| 17 | **Add performance benchmarks** — Storage ops at 10K/50K/200K turns | Scaling predictability |
| 18 | **Decompose `verify-cli-artifact.mjs`** (985 lines) into composable stages | Test maintainability |

---

## Changes Since Last Review (2026-04-04)

Since the last full review (grade B+), the following improvements were applied:
- Domain package tests expanded from 4 to 100
- DTO consolidation (`SourcePlatformDto`, `SourceFamilyDto`)
- CLI version reads from package.json
- `syncSources` `Promise<any>` fixed
- Stale build artifacts cleaned
- Storage util dedup (`clamp01`, `asOptionalString`)
- CLI util dedup (`isMissingPathError`/`pathExists`)
- `normalizeSourceBaseDir` path normalization fixes
- API `base_dir` normalization
- Value-axis filter fix
- `useTurnSearchQuery.shouldFetch` fix
- Multiple verification script fixes

**These were primarily bug fixes and code hygiene**, not architectural improvements. The grade remains B+ because the core architectural risks (H-1 scaling, H-6 web tests) are unchanged.

---

## Post-Review Fixes Applied (2026-04-05)

All "Immediate" recommendations and several "Short-term" items from this review were fixed in the same session. Status by finding:

### High Findings

| # | Finding | Status |
|---|---------|--------|
| H-1 | `refreshDerivedState()` scalability | **Deferred** — architectural change, not a quick fix |
| H-2 | `UserTurnProjection` dual identity fields | **FIXED** — `turn_id`/`turn_revision_id` now required, extends `TurnIdentity` |
| H-3 | `UserTurnProjection` doesn't extend `TurnIdentity` | **FIXED** — see H-2 |
| H-4 | `cursor/runtime.ts` binary file | **FIXED** — literal NUL/control bytes in regex char class replaced with `\u0000`-style Unicode escapes |
| H-5 | No timeout on Antigravity HTTP requests | **FIXED** — 30s timeout + destroy-on-timeout handler added to `postJson()` |
| H-6 | Zero web test coverage | **Deferred** — user says web is lower priority |

### Medium Findings

| # | Finding | Status |
|---|---------|--------|
| M-2 | Missing `session_ref` indexes | **FIXED** — 5 indexes added to schema.ts |
| M-10 | Dual `link_state`/`project_link_state` | **Not a bug** — intentional: `link_state` includes `unlinked`, `project_link_state` is project-perspective |
| M-15 | `normalizePath` duplicated in 3 files | **FIXED** — extracted to `core/utils.ts`, dead code in codebuddy removed |
| M-18 | Hardcoded zh-CN locale | **FIXED** — removed `zhCN` import + locale options from 3 web files, removed `zh-Hans-CN` collation |

### Low Findings

| # | Finding | Status |
|---|---------|--------|
| L-3 | `project_ref` duplication with `project_id` | **Not a bug** — `project_ref` is slug, `project_id` is stable ID |
| L-19 | Brittle TUI relative import | **FIXED** — changed to `@cchistory/source-adapters` package import |
| L-21 | Unused `@dnd-kit` dependencies | **FIXED** — removed from web package.json |

### Additional Fixes (from external audit, same session)

- **[P1]** `asOptionalString` now trims whitespace before checking — blank `workspace_path` no longer blocks session fallback in linker
- **[P1]** `readSourceConfig` normalizes `file:///` URIs in persisted overrides and extras
- **[P2]** API default log level changed to `warn` (privacy: prevents logging user search terms in URLs)
- **4 regression tests added** for the above fixes

### Test Impact

Tests grew from 287 → 291 unit tests (all passing). 48 E2E tests remain green. Web lint clean.

---

## Conclusion

CCHistory is a well-designed and well-implemented system for its current scale. The evidence-preserving pipeline is faithful to the design freeze, type safety is strong across the backend, and the test infrastructure is thoughtful.

After the post-review fixes, the "Immediate" recommendations are fully addressed: Cursor file is readable, Antigravity has a timeout, and `UserTurnProjection` identity is clean. The main remaining investment areas are: (1) storage scalability before the dataset grows past the current ceiling, and (2) web frontend testing before any refactoring.
