---
doc_type: evidence
status: historical
authority: evidence
last_reconciled: 2026-10-11
subject: docs/contracts/bounded-full-storage.md
---

# Bounded Full storage user/operator independent review

## Scope and independence

- Initial contract/design revision: uncommitted `docs/contracts/bounded-full-storage.md`,
  SHA-256 `5f403ce79b36d4dabc574bf63785d8044d5c6034171784c961dbce0de788c37e`;
  `docs/plans/bounded-full-storage.md`, SHA-256
  `05fb36a7ab46a1663a98e28ef33a3a833b135254276e8dc98efd0e425e11edef`.
- Reviewer/context identity: fresh sub-agent `/root/storage_operator_review`,
  assigned only this review and its shared domain/fixture inputs on 2026-10-11.
- Assigned lens: user recall, operator synchronization, trustworthy read
  projections, failure/recovery, and upgrade/rollback behavior.
- Independence basis: this context did not author the assessment, contract,
  plan, implementation, or tests and did not inspect the initiating conversation
  history or other reviewers' conclusions. It inspected repository authorities,
  proposal files, measurement JSON, fixtures, and current callers directly.
- Required and achieved: **yes** for this Phase 3 user/operator lens under
  `PIPELINE.md`'s Multi-Perspective Design Protocol. This is not the separate
  synthesis or the post-implementation Phase 7 evaluation.
- Evidence class: independent design and source/interface inspection, supported
  by existing generated scale evidence. No new runtime acceptance pass is claimed.

## Inputs

- Frozen semantics and architecture: `HIGH_LEVEL_DESIGN_FREEZE.md` §§ 4.1,
  6.3, 9.3–9.5, 10, 11, 12, 16–17; `ARCHITECTURE.md` ownership matrix and
  evidence-preserving boundary; `docs/README.md`; `PIPELINE.md`; current
  `docs/contracts/source-absence-retention.md`; governance routing and
  `docs/templates/independent-review.md`.
- Shared domain summary and fixtures:
  [storage cost assessment](2026-10-11-storage-cost-assessment.md),
  [measurement JSON](2026-10-11-storage-cost-results.json),
  [long-user reproduction JSON](2026-10-11-storage-longuser-reproduction.json),
  existing `mock_data` scenario inventory, and
  `scripts/oneoff/measure-storage-cost.mjs`'s six generated profiles:
  `recall1000`, `recall4000`, `oldhistory4000`, `toolmany`, `toollong`, `longuser`.
- Proposal: [target contract](../contracts/bounded-full-storage.md) and
  [implementation plan](../plans/bounded-full-storage.md), at the hashes above.
- Interface/caller inspection: storage facade, V2 readers, schema initializer,
  search scanner and metadata writer; canonical linker/search; CLI sync and
  progress/resolvers; API data routes; storage's TUI browser; current search,
  lifecycle, sync-marker, and externally-touched-file test sources.

## Findings

The table records findings against the initial revision; the reconciliation
below records the revised proposal separately. Severity means impact if the design gap ships: P1 requires reconciliation before
the affected material delivery; P2 requires explicit acceptance or a documented
scope boundary. These are proposal findings, not newly reproduced runtime bugs.

| Finding | Severity | Evidence | Required action |
|---|---|---|---|
| UX-01: Exact pagination needs a coherent snapshot for the entire read, not only atomic index preparation. | P1 | The contract specifies a coherent preparation transaction and durable invalidation, but does not state how marker validation, total count, ordered IDs, resolved fields, and turn/lineage hydration share one generation. `apps/api/src/routes/data.ts:37` exposes the total directly; the existing facade has no read transaction around these steps. A second writer can otherwise change or remove a turn between count, selection, and hydration. | Specify a single coherent database snapshot, or an equivalent generation-checked retry protocol, for each bounded page/detail call. Recheck durable validity on every relevant call, including long-lived instances. Add two-instance interleaving tests for override, deletion/import, and lifecycle changes; require self-consistent total, IDs, decoration, revision and content. Do not return an apparently successful partial page after a generation mismatch. |
| UX-02: The assertion that old code ignores additive index state does not establish safe rollback or re-upgrade. | P1 | Plan Rollout says old code ignores the index. Current schema initialization rejects a newer `schema_version` (`packages/storage/src/db/schema.ts:209`), so a version bump can prevent old code from opening it. If old writers do open it, their existing mutation methods do not know a newly introduced validity marker; rolling forward may then trust stale links. | Declare the supported old/new version and schema boundary, plus whether mixed-version writers are supported. Use database-owned invalidation that also observes old writers, or an explicit re-upgrade rebuild/epoch boundary. Verify generated-store downgrade, an old-version override/turn/lifecycle write, and re-upgrade; compare exact resolved results. If rollback is read-only or backup-restoration-only, state that concrete restriction instead of unconditional reversibility. |
| UX-03: “Legacy stores rebuild an additive derived index” must distinguish migrated V2 stores from the user's unmigrated V1 store. | P2 | The contract/plan correctly forbid opening the operator V1 store with the mutable constructor. However, the public-interface compatibility row is broader. The constructor performs schema/pragma writes (`internal/storage.ts:146`); production `listTurns`, `getTurn`, and context reads use V2 only (`:889`, `:1001`, `:1010`). Creating an empty V2/index schema is not a content migration and must not look like an empty history. | Narrow “legacy” to stores that have completed the required V2 write/validation gate. Record a generated V1-only and partially migrated store acceptance case: no automatic content migration, no purge, no successful zero-history claim as an upgrade result, and an actionable migration-required boundary. Retain the separate local V1 rollout/backup gate. The actual operator store must remain untouched. |
| UX-04: Resolved page/detail parity must compare complete projections, including tie order and provenance. | P2 | The canonical linker preserves input turn order (`packages/canonical/src/project-linker.ts:136`); V2 input order is `submission_started_at DESC, created_at DESC, turn_id ASC` (`internal/queries.ts:463`). Decoration includes `project_ref`, both link-state fields, confidence, candidate IDs and `path_text` (`project-linker.ts:649`). Detail readers load full lineage by default (`internal/queries.ts:431`). A project-ID-only index cannot reproduce this contract. | Deep-compare indexed page/detail output against the canonical snapshot, with equal timestamps, overrides at turn/session/observation levels, multiple candidates, unlinked turns, fallback observations requiring blob lineage, source-absent detail, and post-import/reopen state. Preserve unrestricted-call behavior and the existing distinction between all-turn page totals and default search filters. Verify CLI ID/revision resolution and API 404/410/context behavior remain intact. |
| UX-05: Thin unchanged reuse is acceptable only with independently preserved presence, health, version eligibility and visible progress. | P2 | The contract preserves these semantics. The current non-Codex complete-inventory branch intentionally avoids a metadata-only shortcut (`apps/cli/src/commands/sync.ts:759`); Codex reconciles the whole inventory after batch reuse (`:1442`). `ingest/source-payload.ts:524` updates health/stage runs and reports `projection_changed:false`, but does not reconcile presence itself. Existing lifecycle-only tests require stale health and a projection-change event (`storage-boundary-v2.test.ts:993`). | Add source-shaped recent/old Codex and Claude cases where unchanged reuse also observes absence, unchanged reappearance, missing supplemental roots, limited scans and probe/capture/parse errors. Assert historical totals, current health, default/explicit recall, durable index invalidation, refresh versus skip progress, success markers and JSON/text progress. Preserve profile/version mismatch rejection and changed-file append inputs; a stat match alone is not permission to reuse obsolete interpretation. |
| UX-06: Full canonical tail recall needs the complete existing query/filter surface, not only one ASCII benchmark marker. | P2 | Long-user JSON records zero global and scoped tail results where one is expected, while detail retains 65,601 bytes. Current scanner now reads `canonical_text_full`; canonical matching uses canonical/path fields, never raw text. API forwards source/link/sync/value filters; TUI grouped search has its own existing read-surface projection. The six cost profiles do not prove Unicode highlight offsets, masks or filter combinations. | Guard tail terms beyond 16 KiB using Chinese and supplementary-plane text, punctuation/literal queries, complete path/observation fields, and combined project/source/link/sync/value filters. Include empty canonical text with a raw-only marker and masked raw-only content, preserving raw detail while excluding both from canonical recall. Assert highlights refer to full canonical text and that page totals, ordering/ranking and TUI groups retain their existing surface semantics. Do not claim FTS performance from fallback-mode results. |
| UX-07: Cold preparation and remaining unbounded callers need an explicit performance boundary. | P2 | The contract honestly admits whole-history cold derivation. Cost JSON shows first page about 82→317 ms for 1,000→4,000 turns and warm in-instance calls below 0.01 ms because the entire snapshot stays cached. `getSearchLinkedTurnsById` still calls `listResolvedTurns` for scoped/link-filter search (`internal/storage.ts:2227`); sessions, summary, alias scans, stats and some admin routes also remain whole-history consumers. | Report dirty/missing-index preparation, reopened ready-index read and warm repeated read separately, with RSS as well as elapsed time. Specify whether the preparation snapshot is released afterward; retaining all hydrated turns can hide the memory cost. Measure page/detail on the actual indexed callers and identify unaffected full-list/search/stat paths. Failed/corrupt preparation must leave the index dirty and return the existing visible error, with retry coverage; it must not return a zero count or stale success. |

### Supported decisions

The staged approach is appropriate for the user/operator problem. Complete
canonical text must be recalled even when the scan hint is shorter, and empty
canonical text must never fall back to masked raw input. Keeping original
parser input, raw user messages, contexts and lineage makes recovered turns
explainable and allows a later correction to interpretation.

The source-absence state machine is correctly preserved: complete inventories
may change lifecycle; limits/errors may not infer disappearance; historical
counts cannot turn a stale source healthy; unchanged reappearance is a real
projection change. Avoiding parser-row rewrites is a cost improvement, not a
reason to skip those transitions.

The first delivery's archive-reuse direction is also sound. Retained bytes must
be verified before reuse, and an integrity failure needs a visible guarded
error/fallback. No cache budget authorizes deleting source bytes or the only
surviving legacy snapshot. Later cache/archive changes correctly remain gated
by retention reconciliation, reconstruction, reference liveness and bundle
round-trip evidence.

### Reinspection after contract reconciliation

The author reconciled the proposal after receiving this lens's findings. This
reviewer independently reread the files rather than treating the author's
description of changes as verification. Reviewed revised hashes:

- Contract: `aaf92b91ba09104b7e69dbffbaf8a08c99eb407c6194b954ebc52cd2a92ac7fb`.
- Plan: `757614e985be9e2cfbea8b89702867ea9bd6df958a600e849420fcfeb42170b9`.

UX-01 is **resolved at design level**: the revised Concurrency section places
validity, count/order/link reads and body/lineage hydration in one database
snapshot; reserves the writer before preparation; and delays memory publication
until commit while observing external database changes.

UX-02 is **resolved at design level**: Persistence and Rollout now specify an
advanced schema version, rejection of older binaries for writes, and rollback
to a compatible pre-upgrade backup. The plan explicitly covers invalidation
triggers firing for pre-existing older connections. That is a concrete support
boundary, not the original assumption that old code can ignore new state.
Generated-store rejection, pre-existing-connection mutation, backup recovery
and re-upgrade checks remain required implementation evidence. Before operator
rollout, retain the upgraded store/evidence while restoring the old backup so
post-upgrade captures remain recoverable; identify the restored backup's time
boundary and check disk headroom for any large copy.

UX-03 is **resolved at design level**: the revised Persistence section explicitly
limits legacy index preparation to V2-complete stores, requires an actionable
migration failure for unmigrated V1, and forbids an empty bounded success. The
local V1 store remains excluded. Generated partial-migration and V1 tests are
still needed before claiming implementation or migration compatibility.

The revised contract also explicitly protects profile/version eligibility,
mixed thin/full per-origin reuse and non-discard of real probe outputs. UX-04
through UX-07 remain Phase 4–6 acceptance obligations and scope/cost boundaries;
their normative direction is consistent with the revised proposal. They are
not evidence that implementation has passed.

`pnpm run verify:doc-governance` passed after this evidence file was created:
25 governed documents and 10 templates; a second run after reconciliation also
passed with 26 governed documents and 10 templates as another review artifact
landed concurrently. This validates documentation metadata and relationships only.

## Trade-offs and residual risk

- Recommended approach: retain the proposed first reversible delivery, using
  canonical derivation to prepare a versioned small resolved index, followed by
  selected-turn hydration. Use the reconciled coherent-read, versioned rollback
  and V2-complete boundaries; expand Phase 4 guards as specified above.
- Rejected alternative and reason: replacing resolved detail with raw `getTurn`
  would remove the current project decoration; optimizing eligibility through
  the 16 KiB hint would keep the observed recall loss; skipping inventory/health
  work for unchanged files would hide absence/error/reappearance; automatic V1
  content conversion or derived-cache eviction would exceed this delivery's
  safety and reconstruction evidence.
- Residual risk: first preparation remains global and may be slow on a large
  store; a page limit bounds object count, not the byte size of one user's
  retained input. Scoped search and unrestricted session/stat/admin calls need
  separate cost evidence. The six synthetic profiles are mechanism evidence,
  not an operator-store capacity or interactive responsiveness guarantee.
- Compatibility risk: full-text recall deliberately exposes legitimate tail
  matches that were previously missed. Existing canonical matching, masks,
  literal/path rules, filtering and ranking must remain the owners of whether
  those matches appear and where they rank.

## Limitations

- This review inspected source and existing test definitions; it did not run
  their suites or claim that new index/reuse acceptance passes. The target
  index implementation does not yet exist in the reviewed revision.
- Existing scale results were read and checked against the harness phases;
  they were not independently rerun. They cover generated Codex/Claude JSONL
  and one 64 KiB user-input case, not all adapter families or production data.
- No operator store, local source capture root, persistent API/Web service,
  migration, compaction, bundle export or cache eviction was opened or run.
  No private transcripts were needed. Existing working-tree code/test changes
  were inspected as current source and were not authored or modified here.
- No new large temporary artifacts, service processes or package builds were
  created. Document-verifier results, when available, verify metadata/routing
  only and do not approve semantic or implementation correctness.

## Verdict

`PASS` for the revised Phase 3 user/operator design at the hashes recorded above.

The user/operator direction preserves the frozen recall and evidence value
hierarchy. The initial material-read design gaps were reconciled in the reviewed
revision. Full-canonical-text recall repair is supported independently. This
design verdict requires the specified behavioral acceptance evidence before
implementation claims. This document satisfies one independent
Phase 3 lens; it does not close R46, retention/archive migration gates, the
separate synthesis, or final implementation evaluation.
