---
doc_type: evidence
status: historical
authority: evidence
last_reconciled: 2026-10-11
subject: bounded-full-storage-first-delivery
---

# Bounded Full storage first-delivery verification

## Claim and evidence class

- Completion layer: R46-KR1 first delivery. Full canonical recall, thin unchanged
  reuse, bounded resolved reads and verified retained-input reuse are implemented.
  Final independent evaluation is recorded separately; this report is the
  implementer's technical evidence, not independent approval.
- Contract: `docs/contracts/bounded-full-storage.md`, SHA-256
  `e27806309f0850e721d908189145eeaf73d9124e5a55d93aaf169992b327b1bf`.
- Base revision: `36d209e`, with uncommitted implementation changes. Sorted
  production-file identity digest:
  `b4d49d72e15e4b887c6979364a1300519f61ba95278eabf89fe97383e3519df5`.
  Compute each file's SHA-256, join `path + NUL + hash` with LF, then SHA-256
  the joined string. The 13 files are CLI `bundle.ts`, `commands/sync.ts`;
  canonical `search.ts`; adapters `core/probe.ts`, `core/types.ts`; storage
  `db/schema.ts`, `db/resolved-read-index.ts`, `evidence-store.ts`,
  `internal/queries.ts`, `internal/storage.ts`, `ingest/source-payload.ts`,
  `queries/search.ts`, `source-evidence.ts`, each under its package's `src/`.
- Schema: `2026-10-11.1`; resolved index: `canonical-links@2026-10-11.1`.
- Evidence classes: canonical unit tests, storage integration/fault injection,
  CLI source-shaped integration, CLI/TUI artifact and temporary HTTP API parity,
  six-profile generated-store measurements, independent small generated probes.
- Does not prove: operator V1 migration, all-product/release readiness, a 4 GiB
  host capacity envelope, tens of thousands of turns, concurrent-writer
  throughput, append checkpoints, cache eviction, archive compression/chunks or
  Lite semantic convergence. R46-KR2–KR4 remain open.

## Environment

- Date/timezone: 2026-10-11, Asia/Shanghai UTC+8. Final benchmark generated at
  `2026-10-11T13:00:17.044Z`.
- macOS Darwin 24.6.0, arm64, Node 22.18.0, pnpm 10.30.3; host has 16 GiB RAM.
  Benchmark workers cap Node old space at 768 MiB. No OS cache flush.
- Source/store identity: task-generated Codex/Claude native layouts inside
  `mkdtemp` roots, independent fresh V2 stores. Worker-local `os.homedir` stubs
  isolate native discovery. The operator `.cchistory` V1 store was never opened
  by a mutable constructor, migrated, or used as a test fixture.
- Benchmark source profiles, timings, RSS, per-method calls/SQL row changes,
  sampled WAL and per-role file sizes are retained in
  [post-change JSON](2026-10-11-storage-cost-after-first-delivery.json).
  Compare with [baseline JSON](2026-10-11-storage-cost-results.json) and
  [assessment](2026-10-11-storage-cost-assessment.md).
- Reproduction after sequential package build:

```sh
pnpm --filter @cchistory/cli build
node scripts/oneoff/measure-storage-cost.mjs --repeats 3 --output /tmp/storage-cost.json
```

The harness cleans every generated source/store in `finally`; the caller owns
the small requested JSON output. No persistent service is launched.

## Result matrix

| Scenario/state | Expected | Observed evidence | Result |
|---|---|---|---|
| Long/Unicode canonical text | Global/project/read-surface recall includes full canonical text; raw-only masked terms excluded | Storage and canonical guards; longuser global/project tail searches both return 1, baseline both 0 | pass |
| Stable recent and old files | No heavy parser preload or derived-row rewrite | CLI mutation-counter guard; recall4000 unchanged workers call thin metadata twice, no old-body load/merge/global refresh | pass |
| Changed independent origin | Other stable origins remain thin; affected input coherent | CLI changed-one test observes only that origin's heavy preload | pass |
| New/reassigned shared session | All available contributors participate before replacement | New-file and changed-session CLI guards retain parent content/context | pass |
| Partial shared inventory and obsolete profile | Preserve unvisited input and last coherent projection; report unapplied update; complete retry recovers | Both profile variants tested; source error gives retry/replay reason; full scan recalls parent and new child | pass |
| Complete shared absence | Confirmed absence is distinct from unvisited; retain absent input while accepting current updates | Same-profile retained session inputs reproject coherently; old and new user input recalled; absent ledger stays source_absent | pass |
| Absent contributor with obsolete profile | Do not reuse obsolete interpretation or claim applied update | Error visible, prior coherent projection retained; replay remains an explicit later boundary | pass within first-delivery boundary |
| Interpretation certification after failed or partial attempts | Repeated/reopened attempts, unrelated partial scans and mixed healthy/failed parses cannot certify retained obsolete output | Durable stage identity and source replay diagnostic remain until complete successful reconstruction | pass |
| Large touched roster with matching checksums | Thin fallback avoids old parser-body preload | CLI threshold=1 controlled case rejects any heavy loader invocation and still recalls both inputs | pass |
| Prepared page/detail after reopen | Exact canonical ordering/decorations/total, selected hydration only | Page/slice/override/session/reopen tests; benchmark ready page makes no computeProjectLinkSnapshot call | pass |
| Direct/external writes and old writer connection | Durable invalidation; coherent ready and cold reads | Dependency/obsolete-index tests, concurrent writer busy guard, pre-upgrade prepared writer guard | pass |
| Same-instance asynchronous stream | Pending rows cannot become visible or join another facade operation | Paused stream rejects reads, mutations, migration access and close; rollback releases old coherent state, commit releases new state | pass |
| Transitional V1→V2 handoff | Full text/messages/lineage parity before handoff; V2 owns later mutations | Missing rows/full fields/counts and same-count changed refs reject; repair, replace, reopen and purge pass | pass |
| Compatible rollback backup | Restore old compatible backup and upgrade again | Generated old-version backup restored with exact page parity; fresh independent old initializer rejects new schema | pass |
| Native append/disappearance | Retained raw bytes remain authoritative and exportable | Historical/65 MiB streaming capture reuse, forced GC, raw bundle export/import exact bytes | pass |
| Materialization integrity/atomicity | Corrupt bytes cannot become accepted new references; prior parser/V2 state survives | Merge/replace/rekey fault guards, same-sized corrupt existing targets, missing/corrupt retained capture | pass |
| Temp writer/containment | No late partial file, no write through symlink outside store | Checksum/iterator failure, corrupt-target recovery and parent/target symlink guards | pass |
| Post-commit file deletion | A SHA reintroduced by same transaction/another writer remains live | Writer-reserved evidence row recheck; host-rekey guard preserves raw/context/lineage files | pass |

## Regression commands

Production and test TypeScript were compiled sequentially. Final results:

| Command/slice | Result |
|---|---|
| Canonical package tests | 6 pass |
| Source-adapters package tests | 157 pass |
| `node --import ./scripts/install-node-sqlite-warning-filter.mjs --test packages/storage/dist/index.test.js` | 144 pass, 4 existing skips, 0 failures |
| `node --import ./scripts/install-node-sqlite-warning-filter.mjs --test --test-concurrency=1 apps/cli/dist/index.test.js` | 194 pass |
| `pnpm run verify:cli-tui-read-side` | pass: CLI 193, TUI state 31/layout 26, API build, HTTP E2E 53, skeptical browse/search and real-layout recall |
| Raw bundle tests after final materializer integrity change | 2 pass |
| `pnpm run mock-data:validate` | 120 pass; fixtures were not changed |
| `pnpm run verify:doc-governance` | pass: 30 governed documents and 10 templates |
| `node --test scripts/verify-doc-governance.test.mjs` | 16 pass |
| `pnpm run verify:governance` | partial: 21/22 tests pass; existing unrelated Lite TUI comments trip architecture rule |
| `git diff --check` | pass |

The sandbox blocks the E2E test's temporary localhost listener. The complete
read-side gate was rerun with auto-reviewed escalation and exited 0. Services
were temporary test-owned instances, not persistent dev services. The last
materializer integrity change was followed by the final storage and bundle
regressions. The final replay-certificate and stream-exclusion corrections
were followed by the complete storage and CLI suites above; no read-side DTO
or surface interaction changed.

The governance test's repository/CRLF integration cases previously used July 26
as their fixed clock, falsely rejecting the new October documents as future
dated. Those two cases now use the current date. Synthetic date-boundary tests
retain their fixed clock; no policy or checker rule was weakened.

## Measured cost and remaining tradeoffs

Read and unchanged-sync values are medians of three fresh processes. Initial
sync and append are one operation per profile, so their deltas are directional
observations, not latency distribution guarantees. `first page` is the measured
storage method; other times below are worker operation times, including their
storage open/close where applicable. They are not complete CLI startup times.

| Profile/operation | Before | After | Interpretation |
|---|---:|---:|---|
| recall4000 unchanged sync | 1176.5 ms / 230.7 MiB RSS | 104.2 ms / 90.3 MiB | Ordinary stable sync reduces work and memory |
| oldhistory4000 unchanged sync | 1019.0 ms / 217.7 MiB | 99.1 ms / 90.3 MiB | Same improvement for old mtimes |
| recall4000 first prepared page, 20 rows | 317.4 ms / 150.9 MiB | 3.8 ms / 62.3 MiB | Durable index avoids whole-history hydration |
| recall4000 detail | 350.0 ms / 151.3 MiB | 18.1 ms / 59.4 MiB | Selected turn/context read |
| recall4000 append | 1934.6 ms / 264.1 MiB | 613.3 ms / 182.3 MiB | Affected-source reuse improves this distributed fixture |
| toollong unchanged sync | 419.6 ms / 299.2 MiB | 53.2 ms / 68.5 MiB | Thin reuse avoids large old input hydration |
| toollong append | 2066.6 ms / 467.6 MiB | 2764.8 ms / 412.3 MiB | Memory lower, latency regresses about 34%; bounded append is not solved |
| toollong append retained growth | 53.27 MiB | 27.37 MiB | About 49% reduction; redundant record snapshot eliminated |
| recall4000 initial sync | 3630.8 ms / 259.4 MiB | 5232.7 ms / 207.6 MiB | About 44% slower in this one run; preparation/integrity work is a material cost |
| recall4000 initial retained files | 65.10 MiB | 66.70 MiB | Thin indexes still add about 1.59 MiB |

Remaining costs and capacity boundaries:

- A deliberately missing/dirty index on recall4000 takes **399.2 ms** and
  **157.3 MiB RSS** for its first page, with about **1.69 MiB sampled WAL**.
  Each cold diagnostic invokes canonical derivation once. This is not physical
  disk-cache-cold latency. The first migration/index build remains O(history).
- Ready page worker wall time is 167.0 ms versus baseline 501.4 ms; the 3.8 ms
  method measurement is not advertised as CLI wall time. Subsequent in-process
  pages take a median 1.24 ms, versus about 0.0007 ms slicing the baseline's
  already-materialized JS array. Selected rehydration trades that hot-array
  speed for much lower initial memory and durable coherence.
- Ready reads reserve the writer while hydrating lineage files. Existing
  5-second busy timeout remains; these probes do not prove concurrent writer
  throughput or eliminate contention.
- Full search still scans canonical text bytes. Recall4000 project search is
  413.5→410.8 ms; longuser search is 22.6→29.1 ms while restoring correct tail
  recall. No bounded-search or general search-speed claim is made.
- recall4000 initial sampled WAL increases 29.53→39.28 MiB; unchanged sync drops
  9.04→0.41 MiB. Sampled peaks are not total SQL write bytes. New index/integrity
  work does not eliminate write amplification.
- The long session's append adds 25.59 MiB of exact source-archive bytes,
  0.63 MiB context cache and 0.003 MiB lineage, with **zero record_snapshot**.
  It still retains a whole new source version. Existing context duplication
  remains; append checkpoints, versioned cache dedup and archive chunks are
  later work rather than a completed capacity solution.

## Failure and recovery checks

| Failure class | Injection/reproduction | Expected recovery | Observed | Result |
|---|---|---|---|---|
| Unvisited/failed shared contributor | Limit one Claude file; stale parser identity combination | Preserve old unit, report incomplete update; full scan recovers where inputs available | CLI variants and retry pass | pass |
| Obsolete retained interpretation | Shared contributor absent + stale parser identity | Fail explicitly, retain old unit, require replay | Error/source health and old recall guard pass | pass |
| Missing/corrupt lineage | Remove/alter file before preparation and after readiness | Fail rather than silently remove fallback links/lineage; exact restore allows read | Both phases tested | pass |
| Incomplete legacy handoff | Missing full fields or same-size different refs | Migration-required rejection, ready stays dirty; exact restore succeeds | SQL mutation/recovery tests pass | pass |
| Corrupt archived input | Alter same-size file; merge/replace and host rekey | Atomic rollback; restore correct bytes and retry | Prior host/text/context/parser rows retained | pass |
| Existing stream target corrupt | Same SHA path with wrong bytes | Reject and clean partial; exact restoration succeeds | Stream test passes | pass |
| Interrupted stream | Checksum mismatch or iterator throw around asynchronous open/write | Wait for close, remove partial | No residual partial files | pass |
| Symlink escape | Existing target or parent points outside asset root | Reject before new publication | Outside original file unchanged, no external partial | pass |
| Concurrent mutation | Writer at ready hydration and cold derivation | Coherent snapshot; injected writer receives busy/locked | Storage test and independent tiny probe | pass |
| Same-instance paused stream | New rows written, iterator paused, then rollback or commit | Other facade operations reject as busy; settle releases committed generation | Package test and two independent tiny recovery probes | pass |

## Data and fixture preservation

- Every benchmark profile checks physical SHA-256 for original input captures
  and for superseded captures after append/end-of-sync GC. All checks pass.
  The output JSON records capture identities, sizes, roles and verification.
- Native source files and the Full archive are separate in generated fixtures;
  `--no-snapshot` does not remove independently retained parser input.
- No evidence-reference column was added. Both existing prune sites continue
  to cover the same six live owners. Cleanup rechecks resurrection before unlink.
- Disk preflight before the final benchmark: about 24 GiB free on `/`.
  The harness checks >=2× its conservative estimate per profile. The 65 MiB
  stream test checks >=400 MiB free before creating its input/archive/partial.
- All generated large roots are removed in `finally`; only small durable JSON
  and Markdown evidence are retained. Temporary logs are removed after final
  reconciliation. No source-shaped fixture scenario was trimmed.
- Existing user edits to Lite surfaces, `.gitignore` and live-runtime were
  preserved; this delivery does not claim to implement their separate work.

## Anomalies and limitations

- The aggregate governance gate remains red because the user's existing
  `apps/lite-tui/src/colors.ts`, `input.ts` and `state.ts` comments at line 4
  mention `apps/tui`, which its textual architecture rule forbids. The affected
  files/rule were not modified by this delivery. This is not an all-green
  repository claim.
- Four storage tests were already skipped; generated measurements are not
  a substitute for real-operator migration or managed Web manual acceptance.
- [Long canonical recall issue](../issues/2026-10-11-long-canonical-text-recall.md)
  is technically repaired. Its durable closure cites these regression and tail
  measurements, with no separate Web rendering claim.
- Independent final review:
  [first-delivery evaluation](2026-10-11-bounded-storage-first-delivery-evaluation.md),
  `/root/storage_first_delivery_evaluation`, PASS for R46-KR1 only. Its final
  SHA-256 is `8edf5cc7fc8e2e7d69a7a1b1878fb93997694dc7c3c8fae6265da6d9093b5060`.
  Three design
  lenses and separate design synthesis are already recorded in the linked plan.

## Verdict

`PASS` for the first delivery, independently confirmed by the fresh final
evaluation. The measured initial-write/long-append costs remain explicit
first-delivery limitations. R46-KR1 is closed; R46 and its later KRs remain
active/open. This evidence does not
close unrelated independent-review blockers or approve an operator migration.
