---
doc_type: evidence
status: historical
authority: evidence
last_reconciled: 2026-10-11
subject: bounded-full-storage-and-lite-convergence
---

# Full storage cost and Lite convergence assessment

Full should retain complete, verifiable parser input while reducing the amount
of derived content that is stored repeatedly or loaded for an ordinary read.
Current measurements support keeping SQLite for the durable index and user
state. The first optimization targets are unchanged sync, resolved pagination,
long-session append, and repeated tool content. They do not establish a need
for a different database engine.

The assessment also reproduces a recall defect: text retained beyond the
16 KiB canonical scan hint cannot be found by default search. Storage cost
reductions must preserve recall as well as bytes.

## Claim and evidence class

- Completion layer: the requested storage-cost investigation and prioritization.
- Full revision: `36d209e`; Lite comparison revision: `f9d84a5`.
- Authority: `HIGH_LEVEL_DESIGN_FREEZE.md` sections 4.1, 9.3, 9.5, 10.4, 16,
  and 17; `ARCHITECTURE.md` ownership matrix and evidence boundary;
  `docs/contracts/source-absence-retention.md`.
- Evidence class: source-shaped synthetic integration measurements, runtime
  method inspection, and an earlier read-only inventory of the local V1 store.
- Measurement changes are routine: a task-scoped harness and evidence records,
  with no production behavior, schema, retention, or public interface change.
- The storage architecture below is a candidate for contract reconciliation
  and independent review. This report does not accept a target contract or
  close an implementation objective.

## Environment

- Measurement started `2026-10-11T05:37:05.008Z`, Asia/Shanghai UTC+8.
- macOS Darwin `24.6.0`, arm64, Node `22.18.0`, pnpm `10.30.3`.
- Host physical memory: 16 GiB. Each measured worker uses a 768 MiB Node
  old-space ceiling. This is not a 4 GiB host or cgroup capacity test.
- CLI and its dependencies were built from the current source, sequentially.
  Two missing workspace symlinks were restored under ignored `node_modules`;
  no root dependency install or persistent service was run.
- Every profile uses a new `mkdtemp` root and a fresh V2 store. Worker-local
  `os.homedir` isolation selects only generated Codex/Claude roots; `HOME` and
  `CODEX_HOME` are not changed.
- Workers run sequentially. Repeated read and unchanged-sync entries are
  medians of three fresh processes; initial sync and append run once. OS caches
  are not flushed. Peak RSS includes worker startup and is obtained from
  `process.resourceUsage().maxRSS`, not periodic RSS sampling.
- Disk headroom was checked with `df -h /` before the large run: about 23 GiB
  free. The harness also requires twice its conservative profile size estimate.
- Reproduction, after building the CLI:

```sh
pnpm --filter @cchistory/cli build
node scripts/oneoff/measure-storage-cost.mjs --repeats 3 --output /tmp/storage-cost.json
node scripts/oneoff/measure-storage-cost.mjs --profiles longuser --repeats 1 --output /tmp/storage-longuser.json
```

The generated source/store directories are removed automatically. The caller
owns the small JSON output files. Raw measurements are retained in
[storage-cost-results.json](2026-10-11-storage-cost-results.json) and
[storage-longuser-reproduction.json](2026-10-11-storage-longuser-reproduction.json).
The latter adds a project-scoped tail-search check to the main measurement.

## Result matrix

### Fixture coverage and initial footprint

All byte columns below use MiB. Amplification is
`(SQLite main file + evidence files) / native input bytes`, excluding the
native source itself, transient WAL, and SHM. These are workload-specific
ratios, not a production capacity forecast.

| Profile | Sessions and turns | Native input | SQLite | Evidence files | Amplification |
|---|---|---:|---:|---:|---:|
| recall1000 | 20 × 50, Codex and Claude | 0.41 | 16.25 | 1.52 | 43.17× |
| recall4000 | 80 × 50, Codex and Claude | 1.65 | 59.03 | 6.07 | 39.45× |
| oldhistory4000 | same, filesystem mtimes in January | 1.65 | 59.05 | 6.07 | 39.46× |
| toolmany | 20 × 20, Codex, 64 KiB tool output per turn | 25.28 | 86.27 | 76.05 | 6.42× |
| toollong | 1 × 400, otherwise the same tool content | 25.28 | 86.23 | 76.06 | 6.42× |
| longuser | 1 × 2, first user input about 64 KiB | 0.06 | 2.31 | 0.07 | 37.51× |

The tiny user/reply fixtures expose the cost of rich per-event metadata, row
storage, indexes, and the fixed schema. Tool-heavy fixtures expose content
duplication. The three intermediate SQLite tables `raw_records`,
`source_fragments`, and `conversation_atoms` occupy about 26.6 MiB each in
both tool profiles, together about 92% of SQLite's pages. Their removal is
not automatically safe: current incremental reuse, debug/lineage, and bundle
paths still consume these representations.

In `toollong`, evidence roles contain 25.28 MiB of original input, 50.50 MiB
of context cache, and 0.28 MiB of lineage. Context serialization contains both
`toolCall.output` and `output_display_segments` content. One 64 KiB output
produces a 132,375-byte context JSON object. Content addressing deduplicates
identical files; it does not eliminate duplicate fields inside a JSON object.

### Sync time and process memory

Cells are process wall milliseconds / peak RSS MiB. Process wall time includes
startup, imports, dispatch, and close/checkpoint. File creation is outside the
measured process.

| Profile | Initial sync | Unchanged automatic sync | Unchanged with marker bypass | Append 5 turns |
|---|---:|---:|---:|---:|
| recall1000 | 1231 / 140 | 523 / 138 | 508 / 138 | 654 / 140 |
| recall4000 | 3780 / 259 | 1312 / 231 | 1488 / 230 | 2083 / 264 |
| oldhistory4000 | 3965 / 265 | 1163 / 218 | 1331 / 228 | 1580 / 256 |
| toolmany | 2378 / 233 | 975 / 235 | 633 / 274 | 1254 / 245 |
| toollong | 2215 / 303 | 565 / 299 | 599 / 300 | 2218 / 468 |

`--force-full-resync` bypasses the sync-date marker; it still permits parser
reuse. It is not a forced re-derivation command. The automatic and marker-bypass
paths also choose different batch layouts. In `toolmany`, the traced automatic
run merges seven batches versus two with marker bypass; its lower memory and
higher elapsed time are a batching tradeoff, not a general recommendation to
use marker bypass.

Unchanged sync already avoids global linker refresh: no measured unchanged
run called `computeProjectLinkSnapshot` or `refreshDerivedState`. That existing
optimization should be preserved. Remaining work is elsewhere:

- `recall4000` still preloads old parse structures, spends about 568 ms inside
  the non-streaming merge in the first unchanged run, changes 4,386 rows in
  that merge, and produces a sampled WAL peak up to 9.14 MiB.
- Even `oldhistory4000` preloads the Claude payload and changes the same
  4,386 merge rows. The Codex old-file fast path works, but it does not make
  the whole two-source operation cheap.
- `toollong` unchanged sync preloads the prior file's derived structures in
  about 229 ms and retains roughly 299 MiB peak RSS for a 25 MiB file.
- Appending five turns to `recall4000` invokes global linker computation once;
  the traced call takes about 637 ms. Appending to `toollong` spends about
  1721 ms inside the streaming merge and changes 18,584 SQL rows.

Method timings are inclusive and overlap. SQL row changes are from SQLite
`total_changes()` around a method; they are not page writes, byte counts, or
counts of unique user-visible objects.

### Read cost

Cells are operation milliseconds / peak RSS MiB. Operation time includes store
opening and close, but excludes worker startup/imports. The page-method column
isolates the first `listResolvedTurnsPage(0, 20)` call.

| Profile | First page method ms | Page operation | Unscoped rare search | Project-scoped rare search | Resolved detail | Direct detail diagnostic |
|---|---:|---:|---:|---:|---:|---:|
| recall1000 | 82.4 | 98.9 / 82.6 | 50.7 / 72.9 | 120.6 / 84.8 | 109.6 / 82.8 | 18.0 / 58.7 |
| recall4000 | 317.4 | 342.7 / 150.9 | 160.9 / 105.7 | 413.5 / 156.8 | 350.0 / 151.3 | 18.0 / 58.7 |
| toolmany | 35.7 | 52.4 / 66.5 | 33.6 / 63.4 | 66.2 / 68.1 | 63.5 / 68.9 | 18.9 / 60.0 |
| toollong | 35.0 | 51.1 / 66.4 | 33.2 / 63.1 | 65.8 / 67.7 | 54.0 / 67.3 | 18.9 / 60.6 |

Resolved pagination calls `buildProjectLinkSnapshot`, which loads all sessions,
all turns with full lineage, and all candidates before slicing. The almost
fourfold first-page growth from 1,000 to 4,000 turns follows that code path.
Five subsequent calls on the same instance take less than 0.01 ms each because
the entire snapshot is already cached. This helps a warm persistent process
while retaining the whole snapshot; each fresh CLI process pays the cold cost.

`getResolvedTurn` also builds that snapshot before finding one turn.
`getTurn` plus `getTurnContext` reads the requested content directly. The latter
diagnostic verifies complete user/tool content but omits resolved project
decoration, so it is not a compatible replacement by itself. The production
optimization needs durable, versioned resolved-link projections or an equally
correct targeted resolution path.

A native SQL diagnostic selecting 20 index fields takes about 1.1 ms operation
time and 56 MiB RSS for both 1,000 and 4,000 turns. It uses the bounded text
hint and does not implement canonical/lifecycle resolution. It demonstrates
available SQLite headroom, not a finished product read path.

The existing session-scoped read uses a SQL `WHERE session_id = ?` and skips
lineage. Its operation stays about 18–28 ms in these cases, although it still
returns every turn in that session. It provides a useful existing pattern for
targeted reads, with an additional bound needed for very long sessions.

### Append footprint growth

| Profile | Added native bytes MiB | SQLite growth MiB | Evidence growth MiB | Added record snapshot MiB |
|---|---:|---:|---:|---:|
| toolmany | 0.32 | 1.23 | 3.51 | 1.30 |
| toollong | 0.32 | 1.14 | 52.13 | 25.90 |

In the long-session case, about 0.32 MiB of appended input grows retained
storage by 53.27 MiB, roughly 169 times the append size. Its sampled WAL peak
is 86.61 MiB. WAL peak is not cumulative physical write amplification.

Two mechanisms are visible. Complete source versions are archived under
whole-file content hashes, so the new file shares no physical prefix with the
old capture. The append path also materializes a `record_snapshot` for an old
blob whose checksum no longer matches the current native file, despite the
original raw capture still being retained. The latter adds about 25.90 MiB of
derived snapshot to this fixture. Capture reuse should consult retained,
verified evidence before falling back to a record snapshot.

Both old and new raw input hashes remained present and matched their physical
evidence bytes after append and end-of-sync GC. The growth is not a reason to
delete an old capture without preserving that exact input version.

### Recall correctness

The long-user turn retains 65,601 bytes of user text. Direct and resolved detail
both contain `storagecosttailmarker`; original capture bytes pass SHA-256
verification. Prefix-anchor search returns the turn. Tail-anchor search returns
zero results in both unscoped and project-scoped queries, where one is expected.

`packages/storage/src/queries/search.ts::scanSearchCandidateRows` reads
`user_turns_v2.canonical_text`, the 16 KiB scan hint, instead of the retained
`canonical_text_full`. The archived V2 design calls the prefix an optimization
that must not gate recall, but the implementation explicitly accepts missing
tail terms. This conflict is tracked in
[the long canonical text issue](../issues/2026-10-11-long-canonical-text-recall.md).

### Local store and Lite context

The earlier read-only inspection of this workspace's `.cchistory` found a
3,100,536,832-byte V1 SQLite file, 1,471 turns, 210,183 raw records, and no V2
tables. The four largest tables account for about 90% of database pages:
raw records 767 MiB, atoms 736 MiB, fragments 704 MiB, and contexts 469 MiB.
There are no free pages. This supports investigating duplication; it does not
predict V2 performance or justify opening the store with the current mutable
storage constructor. An explicit integrity-checked migration remains necessary.

Lite's September synthetic Linux evidence demonstrates that the maximum
materialization unit matters: at about 254 MiB native input and 2,000 turns,
many sessions peaked at 186.5 MiB RSS in the light profile, while one long
session peaked at 1018.4 MiB. These are a different environment and workload
from the measurements above, so they are mechanism evidence, not a Full/Lite
speed comparison. See sibling
`docs/research/2026-09-08-2000-turn-memory-capacity.md` at `f9d84a5`.

## Failure and recovery checks

| Failure class | Check | Observed | Result |
|---|---|---|---|
| Incorrect source/store selection | Worker source-root assertions; generated store path only | All selected roots isolated | pass |
| Raw-input loss or corruption | SHA-256 check of every generated input before and after append | Current and superseded captures verified | pass |
| Missing turns after append | Exact full-store and session counts; prefix search and detail | Initial turns plus five, complete tool content | pass |
| Long-text recall loss | Unique tail term in full canonical input | 0 matches unscoped and scoped | fail |
| Historical absence, reactivation, prune liveness | Existing storage regression suite | Suite passed; not a new scale/fault campaign | partial |
| Crash/resume, ENOSPC, concurrency, interrupted compaction | Not exercised by this read/write cost benchmark | Remains an implementation gate | open |

## Data and fixture preservation

- Operator store and native capture roots were never passed to the mutable
  storage API, sync, migration, compaction, or GC.
- All benchmark content is generated and contains no private transcripts.
  Existing `mock_data` and user working-tree changes were preserved.
- Current and original superseded source captures were verified from physical
  evidence bytes after append/GC. Hashes and counts are retained in the JSON.
- Every generated source/store directory was removed in `finally`, including
  the small calibration run. Only small, non-sensitive measurement JSON is
  retained in this directory.
- No production implementation, schema, or retention policy changed.

## Anomalies and limitations

- Physical read/write byte counts are unavailable from this macOS Node
  resource-usage interface; its filesystem-operation fields are mostly zero
  and cannot support byte estimates. SQL row changes, retained file growth,
  and sampled WAL peaks are reported separately. Linux `/proc/<pid>/io` or
  equivalent OS tooling is needed for a physical-I/O follow-up.
- Peak RSS is one worker's lifetime high-water mark. It excludes the parent
  collector, OS file cache, and other applications. A heap ceiling is not a
  total memory limit. No tens-of-thousands-turn capacity claim is made.
- Only Codex and Claude source-shaped JSONL were measured. Large SQLite input,
  cross-file sessions, heavy token/event records, very large user input,
  API/Web concurrency, bundle export, and actual operator-store latency need
  additional coverage before a migration or capacity claim.
- Existing `scripts/oneoff/collect-scale-baseline.mjs` has stale relative
  imports/root resolution after relocation and writes an archived baseline.
  It was not used or allowed to overwrite historical evidence. The new helper
  remains task-scoped and adds no package or CLI command.
- Relevant existing checks: current CLI build passed; storage test sources
  compiled and ran with 125 passes, 4 skips, 0 failures; canonical test sources
  compiled and all 6 tests passed. These suites do not contain the newly
  reproduced tail-search guard.
- `pnpm run verify:doc-governance` passes for 22 documents and 10 templates.
  `pnpm run verify:governance` fails with 19 test passes and 3 failures: two
  document tests pin the repository's date to `2026-07-26` and reject the valid
  October metadata; the architecture test matches `apps/tui` in comments in
  three pre-existing, untracked Lite TUI files. There is no forbidden import
  in those comments. The current-date verifier passes, and neither the tests
  nor the user's files were changed to suppress these findings. The tests need
  a stable synthetic date fixture separated from current-repository validation;
  the comment-match behavior needs a separately scoped verifier correction.
- Independent review is not required to collect this routine evidence. This
  is same-context analysis and supplies no independent architecture review.
  Cache eviction, raw representation changes, migrations, and cross-surface
  read contract changes require the contract/plan and fresh-context review
  gates in `PIPELINE.md` before material implementation.

### Recommended implementation order

| Priority | Change | Owner and compatibility work | Evidence required |
|---|---|---|---|
| P0 | Make full canonical user text searchable | Storage search; reconcile prefix-hint conflict; preserve mask and literal-query semantics | Tail terms, Unicode, masks, punctuation, scoped/unscoped parity |
| P0 | Make stable unchanged files cheap before parse-payload preload | CLI orchestration and storage ledger; preserve complete inventory, absent/reappearing transitions, parser-version invalidation | Old and same-day files, no derived-row rewrite, bounded reuse metadata, R45 lifecycle tests |
| P0 | Page and resolve through durable small projections | Storage owns linker truth; canonical owns semantics; API/CLI/TUI agree on count, order, state, revision | Fixed-page scaling, manual overrides, source absence, import, post-mutation invalidation |
| P0 | Bound long-file parsing and append state | Adapters own parse boundaries; storage owns durable append/revision state | Large single session/message, partial last record, open turn, rewrite detection, stable identities |
| P1 | Reuse retained evidence before record-snapshot fallback | Storage capture boundary; raw input must remain independently verified | Repeated append, old-file mutation, source disappearance, GC and bundle round trip |
| P1 | Reduce tool/context duplication and introduce scoped derived-cache retention | Storage; bundle/debug/lineage/replay consumers cut over together | Cold reconstruction parity, version pinning, missing/corrupt cache recovery, reference liveness |
| P2 | Compress or share prefixes between raw capture versions | Storage raw archive; immutable chunks/manifests are a candidate | Exact reconstructed bytes/hashes, backup/import, all prune sites, crash recovery and disk headroom |

The candidate layering is complete raw archive, durable compact read index and
user state, and bounded rebuildable interpretation/context caches. Stable
identities, lifecycle axes, manual project overrides, tombstones, and knowledge
coverage are durable state, not evictable caches. Complete user input and its
canonical masked form retain lossless storage/search behavior.

Current `source-absence-retention` explicitly retains parsed projections, and
bundle export still reads intermediate payload tables. Therefore physical
eviction needs contract reconciliation and a proven reconstruction/export
path. Marking a table "derived" does not authorize deleting it today. Old
record snapshots may be the only surviving evidence for some captures; an
audit must establish original-input coverage before any cleanup.

Raw capture compression or chunk manifests come after the cheaper execution
repairs. They must preserve each logical capture's exact bytes and integrity,
all evidence references, and rollback. Compression ratios from repetitive
synthetic tool output would not be representative production evidence.

### Lite convergence after the storage foundation

Import Lite improvements as a coherent semantic pipeline, with source-shaped
Full/Lite parity, rather than copying whole package directories. The initial
comparison found 98 changed shared files, 60 Lite-only files, and two additional
registered experimental adapters. Key integration boundaries are:

- Canonical interpretation now belongs to `packages/canonical` and is injected
  into probe/projection entrypoints. Full sync, tests, and inspection callers
  must cut over together.
- Assistant canonical text, evidence reads, session activity/order, delegated
  session filtering, token evidence, and projection audit need storage/DTO and
  UI projection compatibility. Parser/canonical/mask changes need explicit
  scoped re-derivation; checksum reuse alone will retain obsolete output.
- Lite's path-backed SQLite identity hashes file metadata rather than raw
  content; blindly importing it causes Full integrity validation to fall back
  to record snapshots. Full needs independently captured, coherent DB/WAL
  input and content checksums.
- Grok's selected-record reading and companion policy are not a Full retention
  policy. Preserve all required parser input, including companion evidence,
  before adopting interpretation changes.
- Keep the union of source-shaped fixtures. Lite's current fixture validator
  misses eight Gemini fixture paths present here. Its light read still eagerly
  constructs some context before discarding it, and SQL `LIMIT` is not a
  general source-scan bound; those limitations should not be imported as
  performance guarantees.

## Verdict

`PARTIAL` for current product correctness and bounded cost; the requested
assessment is complete. Raw preservation and ordinary fixture recall passed,
while long canonical-text recall failed and global read/append costs remain.
The concrete measurements justify the priorities above. They do not close a
storage migration, approve cache eviction, establish an SLO, or replace the
pending independent reviews of existing objectives.
