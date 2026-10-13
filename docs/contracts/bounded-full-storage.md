---
doc_type: contract
status: target
authority: normative
implementation: partial
verification_status: partial
last_reconciled: 2026-10-13
review_due: 2027-01-09
supersedes: []
---

# Bounded Full storage contract

## Outcome and scope

Full retains complete, verifiable parser input and complete user input while
reducing the work required to synchronize unchanged files and read a page or
one turn. The user approved starting this optimization on 2026-10-11 after
the six-profile storage cost assessment.

The complete target separates an immutable source archive, durable user/domain
state and recall indexes, and rebuildable interpretation/context caches. This
contract authorizes staged implementation; an unimplemented stage is not an
available operator capability. The first delivery repairs full-text recall,
unchanged-sync reuse, resolved page/detail reads, and redundant evidence
materialization. Cache eviction, append checkpoints, archive compression/chunks,
and Lite interpretation convergence remain separate gated deliveries.

No stage may silently purge source input, shorten canonical user input, treat
absence as deletion, or reinterpret a source without recording version identity.
New source platforms and changes to user-facing DTOs are outside the first delivery.

## Frozen-design and architecture anchors

- `HIGH_LEVEL_DESIGN_FREEZE.md` §§ 4.1, 9.3, 9.5, 10.4, 11, 12, 16, 17:
  evidence preservation, canonical recall, raw context, lifecycle, bundle parity.
- `ARCHITECTURE.md` §§ Dependency direction, Ownership matrix,
  Evidence-preserving storage boundary: adapters own source quirks, canonical
  owns interpretation/linking semantics, storage owns durable state.
- `docs/contracts/source-absence-retention.md` remains current authority.
  Its durable parser/context/lineage retention is unchanged by the first delivery.
  Cache eviction cannot ship until that contract, replay, bundle, debugging, and
  explicit purge behavior are reconciled with a verified reconstruction boundary.

## Ownership

`packages/storage` owns archive integrity, indexes, cache validity and mutation
atomicity. `packages/canonical` remains the sole owner of linking, masking,
ordering and recall semantics. `apps/cli` owns probe scheduling and progress;
adapters retain capture/stat/checksum/append decisions. API, CLI, TUI and Web
consume existing storage interfaces and never infer truth from cache presence.

## Public interface

| Request/event/command | Version | Success result | Typed errors | Compatibility |
|---|---|---|---|---|
| Existing storage search methods | existing DTO | Matches complete canonical user text and path text with unchanged ranking/lifecycle rules | existing storage errors | No raw-only masked text enters recall |
| `listResolvedTurnsPage(offset, limit)` | existing DTO | Exact total, canonical order and resolved turn fields; only requested turn bodies hydrated after index preparation | existing storage errors | Legacy stores rebuild an additive derived index; unrestricted calls remain unrestricted |
| `getResolvedTurn(id)` | existing DTO | Same resolved turn and lineage as canonical snapshot, or undefined | existing storage errors | Targeted indexed read after preparation |
| Existing `sync` | existing CLI | Same projections, presence reconciliation and source health; stable files avoid heavy preload/row rewrites | existing probe/store errors | `--force-full-resync` keeps its current marker-bypass meaning |
| Existing evidence capture/write | internal | Reuses verified retained bytes for a previously captured blob | integrity failure follows existing guarded fallback/error rules | No new evidence reference or capture-kind reinterpretation |
| `getSourceSessionContributorOriginPaths(sourceId, sessionRefs, affectedOriginPaths?)` | additive storage method | Indexed origin inventory for incoming sessions and persisted sessions of affected origins, without parser bodies | existing storage errors | CLI orchestration only; existing two-argument calls retain their meaning |
| `hasSourceSessionForOriginPaths(sourceId, originPaths)` | additive storage method | Indexed existence check for a persisted session contributed by a selected origin, without hydrating parser bodies | existing storage errors | Thin-sync health uses verified current reused origins; retained absent sessions alone cannot make a source healthy |
| `getVerifiedSourceBlobPath(blobId)` | additive storage method | Verified retained source capture path, or undefined when no retained source capture exists | integrity/unavailable storage errors | Bundle exporter prefers independently retained input |
| Probe `retained_contributor_origin_paths` | additive internal option | Same-profile retained session inputs participate in a coherent projection when a complete inventory confirms a shared contributor absent | unavailable/profile-mismatch probe errors | Does not capture a native path or count it as observed |

Full CLI/TUI live `--full` reads continue to use an in-memory store without an
archive directory. They retain their existing counts-only lineage projection;
page/detail and fallback linking must not require archive files or create a
durable store. Required archived-lineage integrity checks apply to durable
stores, including missing/corrupt evidence after index preparation.

## State machine

| From | Trigger | To | Persisted facts | Invalid behavior |
|---|---|---|---|---|
| Resolved read index missing/dirty | First bounded read or projection refresh | ready | Canonical resolved link fields and ordering; validity marker | Returning stale links after source, candidate, session, override or turn mutation |
| ready | Canonical dependency mutation | dirty | Invalidation in SQLite mutation boundary | Treating process-memory invalidation alone as crash-safe |
| unchanged source file | Verified stat/checksum reuse | unchanged | Sync timing/health and lifecycle observations | Rewriting retained parser/context rows solely to reuse them |
| current origin absent | Complete authoritative inventory | source_absent | Current absence-retention contract | Deletion or inference from partial/error inventory |
| retained capture | Native file changed/unavailable | retained capture | Original integrity identity | Replacing an original source capture with parser-output snapshot |

## Concurrency, ordering, and idempotency

- Read-index keys are turn/session IDs; order must equal the canonical snapshot,
  including ties. A bounded read does not implement an alternative linker.
- SQLite owns mutation serialization. Read-index preparation uses a coherent
  transaction and publishes rows and validity together. Cross-process writes
  invalidate the durable marker; restart never trusts only a JavaScript cache.
  Transaction joining also supports SQLite runtimes predating Node 22.16's
  `isTransaction` accessor. Only SQLite's explicit nested-transaction diagnostic
  means an existing owner; lock, I/O and other failures still propagate.
- A page/detail operation checks validity, reads count/order/link fields and
  hydrates bodies/lineage within one database snapshot. Preparation takes the
  writer reservation before canonical derivation; memory caches publish only
  after commit and also observe external database changes.
  Ready reads also reserve the writer while hydrating requested lineage files,
  so concurrent GC cannot unlink them during hydration. This serializes these
  reads with writes and retains the existing 5-second database busy timeout;
  concurrent writer throughput is not claimed by the page benchmark.
- A streaming source write exclusively owns its storage facade instance until
  its promise settles. Other facade reads, writes, migration access and close
  fail with a retryable storage-busy error during that interval; they cannot
  join an in-flight transaction and expose rows that may roll back. Completion
  or rollback releases the guard and invalidates process caches. Separate
  instances retain normal SQLite transaction and busy-timeout behavior.
- Repeated unchanged sync may update small operator metadata. It does not
  rewrite all derived rows, global cache refs or contexts. Reappearance and
  absence remain projection changes and trigger normal refresh.
  A same-profile stat/checksum reuse of a current session contributor counts
  toward source health even when the thin probe derives no new session bodies.
  Reused orphan inputs and absent retained sessions alone do not establish health.
- Stable-stat reuse retains the existing adapter's filesystem identity checks.
  Changed files receive previous inputs when append reuse needs them. A shared
  session is one interpretation unit: all available contributing origins must
  participate before replacing its projection. A newly discovered or changed
  session identity expands both previous and incoming session scopes and
  re-probes before writing. The previous scope comes from indexed retained
  origin/session identity even when thin inputs or an obsolete parser profile
  omit previous record bodies. A vetoed origin cannot publish a new-session turn
  or context merely because its incoming session ID differs. If the
  scope keeps changing, a full selected-inventory fallback preserves semantics.
  Partial inventories retain unvisited shared contributors as non-authoritative;
  they do not delete their session contributions or infer source absence.
  This protection applies even when parser profiles prohibit reuse. A partial
  shared-unit update retains its last coherent projection until a complete
  retry and reports a source error explaining the unapplied update and retry.
  Complete inventories distinguish confirmed absence from unvisited
  origins: same-profile retained inputs can join the current contributor before
  projection without reactivating an absent origin. A coherent replacement may
  replace a protected mixed-origin turn only if all unreplaced blob references
  are included. An obsolete profile cannot reuse retained interpretation.
  An absent contributor with an obsolete interpretation requires replay; this
  first delivery reports that limitation and preserves the last coherent unit.
  An unapplied shared-unit attempt retains the prior interpretation stage
  identity. Repeating/reopening an attempt cannot certify old derived inputs as
  current or clear the replay requirement merely by recording a new probe run.
  A partial scan of another origin also retains that source's pending replay
  diagnostic and prior interpretation identity. Only complete successful input
  reconstruction or verified replay can certify a new source interpretation.
  High-roster thin fallback remains available to avoid heavy old-body preload
  when many stat identities change but checksums still match. Roster size alone
  cannot justify omitting a shared-session contributor.
- Existing parser profile/version must agree before reuse; actual probe output
  containing evidence/projections/errors cannot be discarded by an upfront
  metadata classification. Mixed thin/full inputs use per-origin reuse state.

## Failure and recovery

Database busy, capture errors, probe failures and partial inventories retain
existing handling. Non-streaming replacement/merge must commit parser rows and
V2 projections together; a retained-input integrity failure must leave the prior
projection intact. Evidence-file deletion happens only after the owning commit.
Deletion rechecks current evidence liveness under the writer reservation; a
SHA resurrected by host rekey or another writer must not be unlinked. Streaming
failure waits for the temporary writer to close before removing its partial file.
Every materializer verifies size and SHA-256 when a content-addressed target
already exists, including host rekey and streaming writes. File existence alone
cannot authorize a new reference to corrupt bytes; failure rolls back the write.
Failed index preparation rolls back and leaves the index
dirty for retry. Missing/corrupt archived bytes cannot be accepted merely because
a capture row exists; integrity must be verified before reuse. Original captures
and spans remain live through GC even when the native path changes.

No first-delivery timeout or retry interface changes. A cold legacy index build
still requires whole-history canonical derivation and must be identified as a
remaining cost, not advertised as constant-time startup.

## Persistence, evidence, and migration

- Complete `raw_text_full`, `canonical_text_full`, user messages and parser bytes
  remain authoritative retained content. A bounded scan hint never determines
  whether a turn matches. Empty canonical text does not fall back to raw text.
- The first delivery adds only reconstructible resolved-link/order index state.
  Existing tables/evidence are neither rewritten wholesale nor removed. Index
  invalidation must cover every relevant producer, including import, lifecycle
  reconciliation, overrides and direct migration writes.
- Dependency invalidation includes source linker fields, captured blob origins,
  sessions, candidates, overrides, turn state/content/lineage and any persistent
  project projection mutation. The index stores decorations and ordinal, never
  copies user bodies, contexts or lineage. Health-only source updates use an
  UPSERT that does not invalidate stable linker inputs.
- Read-index readiness includes its format/linker rule identity. Preparation
  cannot publish a ready fallback interpretation when required retained lineage
  is missing or corrupt; it fails with the index dirty until evidence recovers.
  Selected full-lineage reads also fail explicitly if that evidence becomes
  unavailable after readiness, instead of returning an incomplete projection.
  Full canonical fallback search remains proportional to scanned text bytes;
  exact counts/deep offsets and first preparation remain proportional to index
  size. Bounded hydration is not a bounded-search or constant-time promise.
- “Legacy index preparation” applies only to V2-complete stores. Unmigrated V1
  rows must produce an actionable migration-required failure instead of an empty
  bounded result. This does not replace the existing write/validation/compact
  migration. Schema version advances; older binaries are rejected for writes.
  Rollback uses the prior compatible store backup, not a mixed-version writer.
  Transitional stores with dormant V1 rows verify complete text, messages and
  full lineage refs at first V2 handoff. A durable legacy generation invalidates
  that handoff only when V1 itself changes; normal V2 replacement/purge does not
  restore dormant V1 authority. Legitimate tombstones/retired source identities
  are excluded from the comparison. Source replacement, including streaming,
  validates handoff inside its owning transaction before mutation or consuming
  incoming chunks. Failure rolls back and releases the facade for repair/retry.
  A derived-index rebuild alone does not migrate incomplete history.
- No evidence-ref column is added. The six existing reference owners remain:
  evidence captures, parsed spans, source-file ledger, context refs, derived
  cache refs, and turn lineage. Both GC and source-retirement prune sites remain
  mandatory for any future new reference.
- Cache deduplication/eviction needs versioned decode/rebuild, exact source
  coverage, operator observability and bundle round-trip checks before cutover.
  Append checkpoints require parser/version/terminal-state identity and partial
  tail recovery. Compressed/chunked archives preserve exact logical bytes and
  checksums; manifests and their references must be added to every liveness,
  export/import, prune, retirement and recovery path before migration.
- Verified archived source captures must also feed raw bundle export after the
  native path changes or disappears. Streaming and V1-sidecar backfill paths
  require the same integrity boundary; existence alone is not checksum proof.
- The user's local V1 store is not opened by a mutable constructor for this work.
  A future operator migration requires separate generated-store validation,
  disk headroom, backup/integrity comparison and explicit rollout instructions.

## Authorization and capability boundary

Full's live `:memory:` scans retain their freshly derived conversation context
in process and must expose it without an archive directory. Durable stores
continue to read verified V2 context caches; retained V1 rows are not a fallback
for a missing or invalid durable cache. This preserves the existing live-read
contract without changing the persistent migration boundary.

Existing admin authorization owns mutations; reads cannot change user lifecycle,
project overrides or knowledge coverage. A derived read-index repair may create
only reconstructible internal state. Purge and irreversible loss of parser
input require their existing explicit human authority, never a cache budget.

## Observability

Reuse and changed/projection-changed events keep existing progress meanings.
Performance evidence records source bytes, retained bytes by role, wall time,
peak RSS and SQL row changes separately. Sampled WAL size is a peak, not total
bytes written. Generated fixtures and exact commands accompany claims; hot
read costs are distinguished from cold index preparation.

## Class-level acceptance tests

| Invariant/failure class | Controlled boundary | Expected result | Evidence |
|---|---|---|---|
| Long/Unicode user input | Canonical marker past 16 KiB; masked raw-only marker | Tail recalled globally/project-scoped; masked raw term absent; highlights/ranking retained | Storage search tests and generated benchmark |
| Stable file reuse | Old and recent files, non-Codex and Codex | No heavy preload for stat-stable files; no retained-row churn; changed append still correct | CLI sync tests and benchmark |
| Origin changes session identity | Complete/thin/limited scans, obsolete profile, absent former sibling | Previous and incoming contributors remain coherent; incomplete attempts retain prior rows without publishing a new-session turn/context; complete retry recovers | CLI `sync-reuse.test.ts` identity-move guards |
| Reuse profile mismatch | Stable file with stale stage-run parser identity | Normal parse/merge persists new outputs | CLI sync negative guard |
| Lifecycle-only sync | Complete missing path, partial/error scan, unchanged reappearance | Current contract preserved; refresh when lifecycle changes | Existing source-absence guards plus metadata-sync tests |
| Bounded resolved reads | Cold reopened store, overrides, candidate/unlinked, ties, deletion/import | Page/detail equals canonical snapshot, page hydrates only selected turns after preparation | Storage read/index invalidation tests |
| Archived capture reuse | Appended/deleted native file, checksum-corrupt archived blob | Verified old capture retained/reused; corrupt bytes never trusted | Evidence tests and long-session append benchmark |
| Future cache/archive transition | Generated migration store and injected failure | Exact user/source content and round-trip, all refs live, resumable recovery | Required before later delivery; pending |

## Reconciliation log

- **2026-10-13:** Commit-preparation review repaired transaction ownership on
  supported SQLite runtimes without `DatabaseSync.isTransaction`. A real SQLite
  connection with only that accessor hidden reproduced the failure before the
  fix and now covers replace/merge, cold and joined resolved reads, injected
  rollback and preservation of a caller-owned transaction. Runtime requirements,
  schema, DTOs and evidence retention are unchanged; the existing plan records
  validation and the simulated-version limit.
- **2026-10-12:** Routine review repair validates streamed legacy handoff before
  mutation/consumption under the owning transaction and bases thin-sync health
  on verified current reused session origins. Generated positive/negative
  handoff and current-versus-absent health guards fail before repair and pass
  afterward. Validation and limits are recorded in the existing plan.
- **2026-10-12:** Second routine review repair extends contributor discovery to
  persisted origin/session identities as well as incoming IDs. Vetoed origins
  cannot publish turns/contexts under a different session ID. Six generated
  complete/thin/partial/profile/absence and retry guards failed before the repair
  and pass afterward. No schema, archive, evidence-reference or DTO change.
- **2026-10-12:** Routine review correction restores the pre-existing Full
  in-memory `--full` read path. Archive-file checks remain strict for durable
  stores; generated in-memory page/detail/fallback guards and a source-shaped
  CLI live-detail guard cover the no-archive boundary. No durable schema,
  evidence reference, parser input or archive-retention behavior changes.
- **2026-10-11:** Recorded the accepted optimization direction and separated the
  first reversible delivery from later retention/archive transitions. Independent
  design review is required before material implementation; results belong to
  the linked plan and evidence, not inferred from this target's existence.
- **2026-10-11:** Three independent lenses and fourth-context design synthesis
  passed the first-delivery design gate. Implementation regression identified
  shared-session contributor expansion and atomic non-streaming writes as
  necessary preservation guards; both are reconciled here. Ready-read writer
  reservation and its concurrency cost are explicit. Final implementation
  evaluation must review these additions and the measured first delivery.
- **2026-10-11:** Fresh implementation review identified partial/profile/absence
  combinations, exact legacy lineage handoff, post-commit SHA resurrection, and
  corrupt existing materialization targets. The first delivery adds their
  preservation/recovery guards. Later checkpoint, eviction, archive-format and
  Lite stages remain unimplemented; target-wide verification is partial.
