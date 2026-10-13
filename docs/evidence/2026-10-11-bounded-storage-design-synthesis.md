---
doc_type: evidence
status: historical
authority: evidence
last_reconciled: 2026-10-11
subject: bounded-full-storage
---

# Bounded Full storage independent design synthesis

## Scope and independence

- Contract/design revision: working-tree
  `docs/contracts/bounded-full-storage.md`, SHA-256
  `e6694d7422d7af11730e901622e741ef41b4a8f94bcd05a4ce858b5b9b31f77e`;
  `docs/plans/bounded-full-storage.md`, SHA-256
  `cb76981384740dd8c1cddb91ea5f7ed5b65c51300f4eb08ffe414bba5938002f`.
  Repository HEAD was `36d209ec878020d80861884a07dfc8217be4461a`.
- Reviewer/context identity: fourth fresh sub-agent
  `/root/storage_design_synthesis`.
- Assigned lens: separate Phase 3 synthesis of system consistency,
  user/operator experience and engineering cost, with a decision on whether
  the reconciled first delivery may enter material implementation.
- Independence basis: this context did not author the assessment, proposal,
  three lens reviews, implementation or tests. It received a bounded synthesis
  assignment, independently read the authorities, proposal, all three completed
  lens documents, shared measurements/fixtures and relevant current source.
  It did not read the initiating conversation or delegate this review. Reading
  the three lens reports is the synthesis task, not authorship of those lenses.
- Required and achieved: **yes** for the separate fresh-context synthesis under
  `PIPELINE.md` Phase 3. The review topology has three independently identified
  lenses and this fourth context. Final Phase 7 implementation evaluation must
  use another fresh context.
- Evidence class: independent design synthesis with read-only source and
  measurement consistency inspection. The proposer reported newly observed
  failing tests and a passing routine recall repair during this assignment;
  these are proposer reports, not independently executed acceptance evidence.
  New test definitions were visible and do not prove implementation.

## Inputs

- Frozen semantics and ownership: `HIGH_LEVEL_DESIGN_FREEZE.md` §§ 4.1,
  9.3, 9.5, 10.4, 11, 12, 16, 17; `ARCHITECTURE.md` dependency direction,
  ownership matrix and evidence-preserving boundary; `docs/README.md`;
  `PIPELINE.md` Phases 3–7; `docs/contracts/repository-governance.md`;
  current `docs/contracts/source-absence-retention.md`.
- Shared domain summary and fixtures:
  `docs/evidence/2026-10-11-storage-cost-assessment.md`,
  `docs/evidence/2026-10-11-storage-cost-results.json`,
  `docs/evidence/2026-10-11-storage-longuser-reproduction.json`,
  `scripts/oneoff/measure-storage-cost.mjs`, and existing `mock_data/` README,
  scenario manifest and source-shaped inventory. Fixture scenarios include
  long/injected instructions, missing project metadata, cross-host/path
  identity, Claude sidechains, Cursor opaque stores and companion evidence.
  The union remains necessary; the six generated profiles do not replace it.
- Generated profiles inspected: `recall1000`, `recall4000`,
  `oldhistory4000`, `toolmany`, `toollong`, `longuser`. The harness uses
  isolated generated source/store roots, sequential workers, input hash checks,
  disk preflight and `finally` cleanup. Results record 1,005/4,005 post-append
  turns and 20-row pages, zero tail matches against one expected, and
  27,155,191 bytes of new record-snapshot evidence for `toollong`. These are
  pre-change mechanism observations, not production capacity guarantees.
- The proposed contract/plan at the hashes above, current canonical
  search/linker/fallback inputs, storage page/detail readers and preparation
  caches, V2 lineage readers, schema compatibility gate, and new generated-store
  read/reuse guard definitions were inspected read-only.

| Independent lens | Reviewed report | Report SHA-256 | Recorded verdict |
|---|---|---|---|
| System consistency | `2026-10-11-bounded-storage-system-review.md` | `5395aef2de75cac909894d17ed2c025779408aa02629afda0d89bd8557eebdae` | PASS for revised first-delivery design; executable defects and guards remain |
| User/operator | `2026-10-11-bounded-storage-operator-review.md` | `3bf6f89614efc1149ee7a8597dab7a797c7d7b4183a4a278200adb8883ef794a` | PASS for revised design; acceptance obligations remain |
| Engineering cost | `2026-10-11-bounded-storage-cost-review.md` | `38246932fc1a89915b681fd2b7c4787895349c6fdcd124abecc9ea798d84bdc0` | PARTIAL; most proposal gaps resolved, C4 detail and C2–C7 behavioral guards remain |

Report paths in the table are under `docs/evidence/`. System review inspected
the same final proposal hashes as this synthesis. Operator/cost reviews record
the earlier reconciled proposal hashes `aaf92b91…` / `757614e9…`; this synthesis
checks their outstanding findings against the later revision directly.

## Findings

| Finding | Severity | Evidence | Required action |
|---|---|---|---|
| S1. All three lenses agree on the first-delivery layering and frozen value hierarchy. | Design pass | Contract Outcome, Ownership and Persistence; each lens's recommendation; freeze §§4.1, 9.3, 10.4, 11, 17; architecture ownership matrix. | Keep SQLite, canonical-owned interpretation/linking and complete retained input. Limit this approval to the first delivery described below. |
| S2. Complete canonical recall is a correctness repair, with explicit remaining search cost. | Existing defect; proposal resolved | System recall finding, UX-06, C1; JSON tail total 0 versus expected 1; latest contract says full text determines eligibility and full fallback scanning costs scanned bytes. | Preserve complete canonical/path matching, masks, ranking, highlights and existing filters. Run category guards. Do not describe fallback search as bounded or infer a speed/capacity pass from correctness. |
| S3. Per-origin reuse and lifecycle remain distinct decisions. | High implementation gate; proposal resolved | System thin/profile findings, UX-05, C2; latest Concurrency requires per-origin thin/full state, profile agreement and non-discard of actual outputs; current absence contract requires complete inventory and lifecycle-change reporting. | Stat-stable origins may avoid heavy preload only with valid interpretation identity and intact complete-inventory reconciliation. Actual records/evidence/projections/errors must take the normal guarded path. Mixed/changed paths retain existing append/full fallback. |
| S4. Health-only source writes must not defeat index/reuse savings. | High implementation gate; proposal resolved | C3 identifies `INSERT OR REPLACE`/INSERT-trigger churn; latest Persistence requires an UPSERT that leaves stable linker inputs valid. | Prove unchanged sync preserves retained rows and ready-index generation, with only small operator metadata writes. Invalidation must be semantic and write the dirty marker once per dirty interval. |
| S5. C4's remaining index identity and evidence-completeness design blockers are now explicit. | High implementation gate; proposal resolved in later revision | Latest Persistence pins format/linker-rule identity, includes captured origins/source fields/lineage and persistent project changes, and forbids ready publication when required retained lineage is missing/corrupt. Canonical fallback consumes source base directory, captured origins and turn blob refs; current readers can substitute empty lineage after failure. | Implement strict preparation for required evidence, preserving optional-legacy distinctions. Test code/version changes, every producer class, direct SQL/backfill/import/retirement and failed preparation/recovery. A trigger roster alone cannot certify physical evidence. |
| S6. Coherence covers preparation, reads and dependent JavaScript caches. | High implementation gate; proposal resolved | System index/read findings, UX-01, C5; latest Concurrency reserves the writer before derivation, publishes after commit, observes external changes and places validity/count/order/links/body/lineage reads in one snapshot. | Exercise concurrent mutation during preparation and hydration, two open instances and direct writes; apply validity checks to all retained linked/project/session/search caches. Never return mixed-generation partial success. |
| S7. Exact decorations/order and compatibility are part of the bounded read contract. | Medium implementation gate; proposal resolved | UX-04, C8; canonical decoration includes project ID/ref, both link states, confidence, candidate IDs and path text; source order is submission descending, creation descending, ID ascending. | Store decorations plus ordinal without copying bodies/context/lineage. Deep-compare whole projections and totals, ties and unrestricted methods; preserve existing optional/null/array and offset/limit semantics. |
| S8. V2 readiness and binary rollback now have a concrete boundary. | High implementation gate; proposal resolved | System compatibility finding, UX-02/03, C6; latest contract limits index preparation to V2-complete stores, requires actionable migration failure, advances schema and rejects old writes; plan uses compatible-backup rollback. | Generated V1/partial-V2 stores must fail visibly instead of appearing empty. Test old fresh connections, pre-existing writers' trigger coverage, backup restore and re-upgrade. The user's V1 store remains excluded. |
| S9. Verified historical archive reuse includes all materializers and raw export. | High implementation gate; proposal resolved | System independently reproduced native-path export of wrong historical bytes and ENOENT after deletion; C7 covers streaming/backfill; latest contract explicitly includes raw bundle export, streaming and V1-sidecar backfill. | Centralize storage-owned lookup by intended source/blob/checksum/size and `source_blob` kind; verify physical SHA-256 and source checksum. Cover missing/corrupt archive, append/delete native, large streaming, backfill and export/import exact-byte/hash parity. Preserve refs and guarded fallback/error behavior. |
| S10. The cost lens's PARTIAL is not converted to an implementation PASS. | Mandatory evidence boundary | C9 and UX-07; six-profile tool inputs are about 25 MiB, below the >64 MiB capture branch; reviews did not verify cutover. Latest contract explicitly bounds claims, not all costs. | Carry every class-level guard forward, add the uncovered failure/concurrency/streaming cases, rerun affected measurements and perform fresh Phase 7 evaluation. Keep contract verification pending until that evidence exists. |

### Agreement, disagreement and implementation decision

High-confidence agreement is to repair canonical recall first, remove avoidable
unchanged-origin preload/rewrite, persist a small canonical-derived resolved
index and reuse verified historical parser bytes before snapshot fallback.
These changes preserve project-first history, `UserTurn` recall, lineage and
existing lifecycle/authorization. They add no alternate linker or user DTO.

The verdict difference is about completion and evidence. The cost lens's
PARTIAL preserves initial C2–C7 findings and outstanding behavioral guards;
its final revision still asked for C4 format/rule identity and rejection of
incomplete fallback-lineage preparation. Both C4 details are now normative in
the latest contract. This synthesis independently verifies that text and keeps
the tests pending. C1, C8 and C9 are also carried as cost/parity/evidence
requirements rather than silently cleared. No lens proposes a conflicting
frozen invariant or fundamental user experience requiring a new human decision.

**The Phase 3 design gate is satisfied for the revised first delivery. Material
implementation may begin against the reviewed contract/plan, through tests
first and the mandatory guards below.** No additional normative design
supplement is required to start that scope. The schema and cross-process
portion retains the high-risk review/evaluation discipline of the full
programme; calling the first delivery material does not waive those gates.

### First-delivery boundary and mandatory guards

Permitted implementation is complete canonical recall, per-origin unchanged
reuse with independent lifecycle work, canonical-derived durable decorations
and ordinal for page/detail reads, and verified retained source-byte reuse
through materialization/backfill/raw bundle export. Storage owns the one
validity/integrity boundary; adapters own filesystem/profile/append eligibility;
canonical continues to derive meaning. Builds/tests stay package-scoped and
sequential on this host.

| Mandatory guard family before affected cutover | Observable result required |
|---|---|
| Recall semantics | Long Chinese/supplementary Unicode tails beyond 16 KiB recalled globally and by project; raw-only masked and empty-canonical markers absent; punctuation/path matching, filters, ranking/highlights and shared canonical consumers retain parity. |
| True unchanged and mixed reuse | Recent/old Codex and Claude stat-stable origins load no old parser bodies and rewrite no retained parser/turn/context/global cache rows; readiness/generation stable across health-only updates. Mixed new/appended origins keep correct old/new turns and existing high-file-count fallback. |
| Interpretation and actual-output eligibility | Stable-old file plus obsolete parser identity persists rebuilt outputs. Genuine records, evidence, projection changes or errors cannot be routed to a metadata-only writer and discarded. |
| Authoritative inventory/lifecycle | Complete absence and unchanged/changed reappearance preserve evidence and update axes, health and progress. Partial/limited/error/missing supplemental-root scans never establish absence. Shared-session contributors and default versus explicit recall remain correct; forced GC retains absent evidence. |
| Producer invalidation and versions | Turn membership/order/lifecycle/link/content/lineage, sessions, candidates, overrides, source linker fields, captured origins, persistent projects, import/remote ingestion, rekey/retirement, purge, backfill and direct migration writes cannot leave ready stale state. Format/linker version changes force rebuilding; publishing derived rows cannot create trigger cycles. |
| Coherent preparation and reads | Writer reservation precedes derivation; committed rows/state precede memory publication. Two connections, direct writes, restart and deliberate mutation during read yield one-generation total/IDs/decorations/content/lineage. All linked caches observe external changes. Failed preparation remains dirty and recovers; missing/corrupt required lineage never becomes a ready fallback. |
| Exact projection/edge parity | Deep equality against canonical snapshot for all seven decorations, provenance, candidate/unlinked/fallback turns, override target kinds, ties, deletion/import, absent detail, missing IDs, zero/deep pages and existing offset/limit edge behavior. No new active-only filter or unrequested full-history hydration on a ready bounded read. |
| Compatibility/rollback | Generated V1-only and partial-V2 content fail with migration guidance; V2-complete/fresh stores work. Older fresh binaries reject upgraded stores; pre-existing connections invalidate through installed SQLite rules. Compatible-backup restore/re-upgrade is checked; retain upgraded evidence when restoring an older backup, with its time boundary and disk headroom explicit. |
| Historical capture/raw bundle integrity | Same intended retained `source_blob` reused after native append/delete without a redundant record snapshot. Missing/corrupt archive never trusted; regular-file/containment/size/SHA-256/source checksum checked. Non-streaming, >64 MiB streaming, backfill and raw export/import preserve exact old/new bytes and hashes. GC/source retirement preserve all live refs. |
| Cost and regression evidence | Report cold dirty/missing preparation, reopened ready reads and repeated warm reads separately, including RSS, retained roles and row changes. Verify release of whole-history preparation bodies, unchanged readiness/churn, long-session append and full-text scan cost. Run scoped storage/CLI/adjacent checks and CLI/TUI read-side gate; document remaining full-list/session/search/stat costs and fresh Phase 7 verdict. |

The existing newly authored read/reuse/archive tests and proposer-reported
failures are useful Phase 4 starting evidence. They cover a subset of this
matrix, not all requirements. A test reaching a whole-snapshot failure, stale
cache assertion or absent index table demonstrates current missing behavior;
it does not establish a safe migration, concurrency or integrity implementation.

## Trade-offs and residual risk

- Recommended approach: one canonical-derived decoration/order index with
  durable SQLite validity and a shared storage-owned historical-capture
  verifier. This removes unnecessary body hydration/capture duplication
  without storing a second full `UserTurn` payload or reproducing linking in SQL.
- Rejected alternative and reason: retaining whole resolved history in memory
  only makes warmed instances cheap and leaves restart/external-write costs;
  blanket heavy preload preserves measured sync cost; native-path capture
  copying loses historical byte identity; truncating canonical text loses recall.
- Residual risk: cold canonical preparation is still whole-history work;
  count/deep OFFSET work grows with index size; fallback recall scans text
  bytes; one lossless user message can dominate page memory. Changed-file
  append and immutable whole-file source versions retain their current costs.
  The six profiles prioritize mechanisms and do not prove tens-of-thousands
  capacity, physical write amplification or operator responsiveness.
- Later-delivery boundary: cache eviction/deduplication policy, terminal append
  checkpoints, archive compression/chunks/manifests, Lite semantic convergence,
  new adapters and public DTO changes are not approved for cutover here. They
  need specific contract reconciliation, tests and independent review. Current
  absence retention continues to retain parser/context/lineage rows; purge
  remains explicit admin/human authority. New evidence refs must update both
  prune sites and every export/import/liveness/retirement path.
- Operator boundary: this review authorizes no mutable open, migration,
  compaction or GC of the real V1 store. Later rollout needs generated-store
  integrity/backup/recovery evidence and explicit instructions. Large artifacts
  require headroom and producer-owned `finally` cleanup.

## Limitations

- This reviewer wrote only this evidence file. Contract, plan, source, tests,
  fixtures, `.cchistory/` and native source roots were not modified. Concurrent
  unrelated working-tree changes were preserved.
- Existing JSON and source were inspected; benchmarks, package tests,
  archive/export probes and binary migrations were not independently rerun.
  The already-cleaned generated input files cannot be rehashed by this review.
- No operator store, private transcript, persistent API/Web service, package
  build, install, large temporary artifact or sub-agent was opened/created.
- Design agreement is not a passing implementation, migration, performance or
  release claim. Implementation verification remains pending, and a new fresh
  Phase 7 context must inspect the final revision/evidence.
- `pnpm run verify:doc-governance` passed after writing this report: 28 governed
  documents and 10 templates. It checks metadata/routing only and cannot
  establish runtime correctness. The contract/plan hashes were rechecked and
  remained the reviewed revisions.

## Verdict

`PASS` **for the revised first-delivery Phase 3 design and permission to begin
its tests-first material implementation**, at the recorded hashes.

All known proposal-level blockers from the three lenses are reconciled for
that scope, including the engineering lens's remaining C4 details. Behavioral
guards and post-change evidence are still mandatory; the cost review remains
a faithfully recorded PARTIAL, not an implementation pass. This synthesis
requires no governance exception or frozen-semantics redesign. It does not
close R46, existing R43/R44/R45 review blockers, later retention/archive/Lite
deliveries, operator migration, or fresh final implementation evaluation.
