---
doc_type: plan
status: active
authority: planning
last_reconciled: 2026-10-13
implements: docs/contracts/bounded-full-storage.md
supersedes: []
---

# Bounded Full storage implementation plan

## Cold-start summary

The user authorized implementation on 2026-10-11. Six controlled profiles in
`docs/evidence/2026-10-11-storage-cost-assessment.md` prove tail recall failure,
whole-history page/detail materialization, heavy unchanged reuse and redundant
long-session evidence snapshots. Complete source/user input must survive.
Start with the contract's first delivery and tests observed failing; the operator
V1 store remains read-only. Later archive/cache changes are not implicitly shipped.

## Authority and risk classification

- Design freeze: §§ 4.1, 9.3, 9.5, 10.4, 11, 12, 16, 17.
- Architecture: dependency direction, ownership, evidence-preserving boundary.
- Contract: `docs/contracts/bounded-full-storage.md`; current absence authority:
  `docs/contracts/source-absence-retention.md`.
- Backlog: R46. Risk: **high-risk** for the complete architecture/retention
  transition. Full-text recall is a routine repair under frozen §10.4; additive
  index/unchanged-sync first delivery is material and receives independent review.

## Complete end state

1. Immutable verified parser-input archive; no user-input loss.
2. Durable identities, lifecycle, overrides, knowledge coverage and complete
   canonical recall; bounded page/detail queries over current resolved indexes.
3. Unchanged sync costs file inventory and small metadata rather than old
   content hydration or full derived rewrite. Append processing uses validated
   terminal checkpoints and produces work proportional to affected sessions/tails.
4. Versioned reconstructible interpretation/context caches with explicit budgets,
   cache-miss recovery and operator diagnostics; archive compression/chunks reduce
   repeated append capture bytes while retaining exact logical capture integrity.
5. Shared corrected Lite canonical interpretation, evidence coverage and source
   semantics with coordinated DTO/version/migration cutover and fixture union.

Delivery order: first repair (recall, reuse, reads, archived capture reuse), then
append/version identity, then cache dedup/rebuild/retention reconciliation, then
archive representation and Lite semantic convergence. Each later unit needs its
specific contract detail, failing acceptance and independent confirmation before
material code. A completed first delivery does not close R46.

## Current state and gap

| Concern | Verified current fact | Contracted target | Gap/evidence |
|---|---|---|---|
| Recall | Full canonical retained but 16 KiB hint scanned | Complete canonical recall | Long-user reproducer |
| Unchanged sync | Claude preloads all selected old content and merges ~4386 rows for 4000 turns | Thin reuse and metadata/lifecycle write | Cost results JSON |
| Page/detail | Canonical whole snapshot built, then sliced/found | Durable resolved fields/order, selected hydration | 82→317 ms page for 1000→4000 turns |
| Long append | 0.32 MiB appended, 53 MiB retained growth | Reuse archived raw capture before derived snapshot fallback | Cost report roles/hashes |
| Derived retention | Current absence contract retains parser/context rows | Explicit verified rebuild boundary and budgets | Not authorized for silent eviction |
| Lite convergence | Source/canonical/DTO/version drift | Coherent shared pipeline cutover | Assessment difference inventory |

## Seven-phase execution record

| Phase | Required output | Result/evidence or non-applicability reason |
|---|---|---|
| 1. Domain understanding | Authorities/owners/cost mechanisms | Dated cost assessment and this contract |
| 2. Fixtures | Sanitized source-shaped boundary | Existing mock_data union and task-scoped generated six-profile fixtures; no private source content needed |
| 3. Functional design | Independent lenses and synthesis | Three fresh design reviews and fourth-context design synthesis PASS; linked below |
| 4. Tests first | Observed acceptance failures | Long-tail, thin reuse, bounded hydration and archived capture guards observed failing; regression exposed shared-session/atomicity gaps, repaired with category guards |
| 5. Implementation | Coherent first delivery | Full canonical scan, per-origin thin reuse/session expansion, retained absent contributors, resolved index/legacy handoff, verified capture/export and atomic source writes implemented; no operator-store mutation |
| 6. Regression | Storage, CLI and adjacent read checks | Storage 144 pass/4 existing skips, CLI 194 pass, adapters 157 pass; full CLI/TUI gate passes; final six-profile benchmark and tradeoffs recorded |
| 7. Holistic evaluation | Fresh context | `/root/storage_first_delivery_evaluation` independently confirmed corrected boundaries with 14 tiny recovery probes and exact final identities; first-delivery evaluation PASS |

## Review topology

- Independent system/design-freeze lens: `/root/storage_system_review`,
  `docs/evidence/2026-10-11-bounded-storage-system-review.md`.
- Independent user/operator lens: `/root/storage_operator_review`,
  `docs/evidence/2026-10-11-bounded-storage-operator-review.md`, design PASS.
- Independent engineering/maintenance lens: `/root/storage_cost_review`,
  `docs/evidence/2026-10-11-bounded-storage-cost-review.md`, PARTIAL with C2–C7
  required implementation guards. Revised contract explicitly adopts per-origin
  reuse, UPSERT/invalidation, coherent reads, complete producer inventory,
  format identity, strict required lineage, rollback gate and capture/export integrity.
- Separate synthesis: `/root/storage_design_synthesis`,
  `docs/evidence/2026-10-11-bounded-storage-design-synthesis.md`, Phase 3 PASS.
- Final first-delivery evaluation: `/root/storage_first_delivery_evaluation`,
  fresh context, implementation corrections independently rechecked; final
  `docs/evidence/2026-10-11-bounded-storage-first-delivery-evaluation.md` PASS
  for R46-KR1 only.
- No governance exception requested. This repository's `PIPELINE.md` explicitly
  requires independent sub-agents for this system-level work.

## Risk register

| Risk | Trigger | Impact | Guard | Recovery |
|---|---|---|---|---|
| Stale resolved links | Missed producer/invalidation or crash | Wrong project recall | Durable invalidation, restart/direct-write tests, transaction publication | Rebuild derived index |
| Lost append optimization | Metadata preload chosen for changed file | Whole reparse/RSS spike | Stat-stable subset thin; changed/available shared-session contributors full | Selected-inventory parse fallback if scope keeps changing |
| Partial source commit | Capture integrity fails after parsed-row deletion | Old projection lost | One transaction across parsed rows/V2/refresh; unlink only after commit | Rollback retains old rows and live files |
| Lost absence semantics | Metadata-only branch skips inventory reconcile | Hidden stale/reactivated history | Lifecycle tests for complete/partial/error inventories | Transaction rollback and normal refresh |
| False raw integrity | Capture row trusted without byte verification | Parser input corruption | Existing SHA-256/source checksum validation before reuse | Fail/fallback without rewriting original capture identity |
| Misleading performance | Cold preparation omitted, environment changes | Wrong capacity expectations | Same six profiles; cold/warm and storage roles separate | Report limitation and repeat affected probe |
| Premature cache purge | Rebuild/old snapshot coverage incomplete | Permanent input/context loss | Later gated contract and migration acceptance | No purge in first delivery |

## Verification matrix

| Outcome | Evidence class | Command/probe | Negative path | Durable record |
|---|---|---|---|---|
| Complete canonical recall | Storage integration | Scoped storage tests | Masked raw term and Unicode tail | First-delivery verification report |
| Sync reuse/lifecycle | CLI source-shaped integration | Scoped CLI diagnostics tests | Changed, absent, partial, reappeared | First-delivery verification report |
| Exact bounded resolved reads | Storage integration | Scoped storage tests | Mutation/reopen/ties/override | First-delivery verification report |
| Capture preservation/growth | Storage integration and benchmark | `node scripts/oneoff/measure-storage-cost.mjs --repeats 3 --output <temp>` | Corrupt/missing native path | Dated post-change cost JSON |
| Adjacent read behavior | Artifact integration | `pnpm run verify:cli-tui-read-side` | Read/admin and fixture parity | First-delivery verification report |
| Governing docs | Doc verifier | `pnpm run verify:doc-governance` | Stale/missing authority | First-delivery verification report |

## Rollout, migration, and rollback

First delivery is additive and retains old storage/evidence; build packages
sequentially. Generated stores are the migration boundary. Prepare the resolved
index atomically on refresh or first read; no opening-time whole-store rewrite.
Schema version advances; older binaries reject writes to upgraded stores.
Rollback restores the compatible pre-upgrade backup; a pre-existing older
connection still fires SQLite invalidation triggers. No irreversible first-delivery step.
Do not run against the local V1 operator store before its separate V1→V2 gate.

Later whole-file rewrites require >=2x free disk, backup, exact input hash and
export/import comparison, interrupted-run/resume validation and a documented
rollback boundary. Each producer owns large temp cleanup in `finally`.

## Progress and completion record

- **2026-10-13 commit preparation (completed):** the user requested thematic
  commits and a push of the reviewed uncommitted work. The review's Node
  compatibility defect was repaired within the existing storage transaction
  owner before publication, without raising the advertised runtime minimum.
  The new guard failed before repair; the storage suite then passed 149 tests
  with 4 existing skips. Its strengthened rollback assertion also passes in a
  focused rerun. The complete CLI/TUI read-side gate passes: CLI 205, TUI
  state/layout 31/26, API build, HTTP E2E 53, browse/search and real-layout
  verifiers. The test-only HTTP listener ran under automatic sandbox approval.
  Governance passes 49 guards, 38 documents, 10 templates and 5 architecture
  rules. The unchanged Lite TUI's 89 passing tests from the immediately preceding
  review remain applicable. Node 22.18 is the actual runtime; hiding only the
  newer accessor on a real SQLite connection simulates the older interface,
  rather than claiming execution of a separate older Node binary. No operator
  store, source fixture, schema, DTO or dependency change accompanies this repair.
  Temporary validation artifacts are cleaned up; unrelated review gates stay open.
- **2026-10-13 fifth review correction (completed):** the user authorized
  fixing the three reviewed defects and closing this bounded correction.
  CLI owns Codex metadata-batch health, including mixed and empty batches;
  Lite owns literal prompt/reply display and Unicode terminal-cell geometry.
  Routine route under freeze §§4.4, 9.3 and 10.4 and the existing sync/surface
  contracts. Six new source-shaped/renderer guards failed before repair.
  Health now accumulates derived or verified reused current session contributors
  across Codex batches; a trailing empty/orphan batch cannot erase health,
  while absent retained sessions alone stay stale. Literal XML remains in
  browse/detail/conversation; the producer retains injection/masking ownership.
  Native Unicode grapheme segmentation and emoji properties drive one shared
  width/wrap/clip/pad mechanism, preserving ANSI styling and complete sequences.
  During regression, one generated append fixture was corrected to include an
  assistant reply between submissions, matching the existing UserTurn boundary.
  CLI passes 205; Lite TUI passes 89, and its subsequently strengthened composed
  emoji long-prompt guard passes independently. Full TUI state/layout pass
  31/26 and API build passes. The read-side aggregate stops only at localhost
  EPERM; its 52 non-listener E2E cases pass, the one temporary HTTP case passes
  after an automatically approved outside-sandbox rerun, and browse/search plus
  real-layout fixture verifiers pass separately. Governance passes 49 guards,
  38 documents, 10 templates and 5 architecture rules; Lite boundaries and
  whitespace pass. Final documentation reconciliation is checked afterward.
  Built-entrypoint PTYs at 80×24 and 46×24 exercise detail tail, context loading,
  literal XML, emoji wrapping and quit/terminal restoration with generated
  native-shaped input. These are automated PTY/output checks, not manual review
  of operator history. Separate lossless wrapping probes take 149 ms for 256 KiB
  ASCII, 49 ms for 128 KiB supplementary CJK and 19 ms for 120 KiB composed emoji.
  Test-owned temporary roots/logs are cleaned up; shared changes are preserved.
  No schema, DTO, source evidence, real operator-store or dependency changes.
  This closes the three-defect correction, not other R43/R45 or later R46 gates.
- **2026-10-12 third review repair (completed):** the user requested fixing
  six reviewed defects: streaming legacy handoff, unchanged-source health,
  quadratic Lite prompt wrapping, tool-only conversations, tail scrolling and
  Unicode search backspace. This routine correction retains existing freeze
  §§4.1, 4.4, 9.3, 9.5 and lifecycle semantics. Storage owns handoff and indexed
  contributor facts; CLI owns sync health; Lite owns geometry, rendering and
  input. Two storage, one CLI and six Lite guards failed on the baseline.
  Streaming handoff now validates under the owning writer reservation before
  consuming chunks; incomplete history rejects without mutation and permits
  repair/retry. Current reused session origins establish health through an
  indexed existence check; an absent retained session plus a reused empty file
  remains stale. Lite reports rendered bounds to keyboard state, renders tools
  without assistant text, wraps unbroken prompts linearly and deletes complete
  code points. Storage passes 148 / 4 existing skips, CLI passes 202 and Lite
  TUI passes 86. Read-side components pass: Full TUI state/layout 31/26, API
  build, HTTP E2E 53 and both browse/search and real-layout fixture verifiers.
  The aggregate gate stopped only at sandbox EPERM on localhost; the HTTP
  slice passed after an auto-approved outside-sandbox rerun and remaining
  verifiers ran separately. A 256 KiB unbroken prompt retains all text and
  wraps in 34 ms in a separate local probe, versus 6.7 s before repair.
  Rendered help frames at 80×14 and 46×24 confirm tail access and upward
  movement after resizing; input evidence is simulated stdin, not a new PTY
  or manual operator review. Governance passes (49 guards, 38 documents,
  10 templates and 5 architecture rules); Lite boundaries and whitespace pass.
  Test-owned stores and logs are cleaned up at completion.
  No operator store, native source, schema, evidence-reference, DTO or mock_data
  changes. Historical independent evidence remains scoped to its original
  snapshot; unrelated R43/R45 review and later R46 gates remain open.
- **2026-10-12 second review repair (completed):** the user requested fixing
  three uncommitted-change findings: an origin moving between sessions drops
  its unchanged former sibling; split UTF-8 stdin chunks corrupt Lite search;
  the scrolling Lite detail pane cannot expose its final row. This is a bounded
  repair of existing preservation and interaction behavior under freeze §§ 4.1,
  4.4, 9.4 and 10.4. Storage owns indexed contributor inventory, CLI owns reuse
  scope, and Lite owns decoding/scroll geometry. Six source-shaped identity-move
  guards (complete/thin/partial/profile/absence and complete retry) and two Lite
  guards failed before implementation and pass afterward. Contributor inventory
  now includes indexed persisted identities even when previous bodies are absent;
  an unavailable former sibling also vetoes new-session turn/context publication.
  A persistent UTF-8 decoder preserves split stdin bytes. Detail scrolling uses
  its real viewport and releases the bottom-indicator row at the tail.
  Storage passes 146 / 4 existing skips; Lite TUI passes 74; CLI passes 201;
  Full TUI state/layout pass 31/26 and API build passes. The aggregate read-side
  command reached an EPERM sandbox rejection at its temporary HTTP listener.
  `pnpm run test:e2e` was auto-approved outside the sandbox and passes all 53;
  both remaining browse/search and real-layout verifiers pass separately.
  Strengthened six-case parser/session/turn/context assertions were recompiled
  and rerun afterward. Rendered 80×14 frames were inspected; geometry and tail
  tests cover widths 80/130 and heights 14/24/34. Input evidence uses simulated
  Buffer chunks; no manual real-TTY, operator-store or independent-review claim.
  No schema, evidence reference, DTO, native source or operator-store changes;
  existing unrelated review blockers remain open. Test-owned roots and logs are
  cleaned up at completion; governance and whitespace checks pass.
- **2026-10-12 review correction (completed):** the user requested fixing the
  five uncommitted-change review findings. Bounded scope: Full in-memory live
  resolved reads; Lite conversation tail containment, pending-context focus,
  canonical session project labels and the turnless-session test expectation.
  Storage owns archive checks; Lite owns presentation/interaction. These are
  routine repairs within existing semantics, with no schema, DTO, parser,
  archive-retention or source-data changes. Before the fixes, the new storage
  guards failed twice and the Lite guards failed four times; the turnless focus
  assertion was reconciled with its existing detail-entry behavior. After the
  fixes, storage has 146 passes / 4 existing skips and Lite TUI has 72 passes.
  The complete CLI/TUI read-side gate passes: CLI 195, TUI state 31/layout 26,
  API build, HTTP E2E 53 and both browse/search and real-layout verifiers.
  Its initial sandbox run rejected the temporary localhost listener with
  EPERM; the auto-approved outside-sandbox gate passed. Governance passes
  (49 guards, 38 documents, 10 templates, 5 architecture rules).
  Rendered frame inspection at 80×14 confirms the final reply line is visible;
  tests also check geometry at heights 14/24/34. Delayed-scan keyboard tests use
  simulated stdin; no manual real-TTY or managed Web acceptance is claimed.
  Missing local workspace dependency links were restored to existing packages,
  without an install, lockfile edit or network fetch. Test-owned roots and logs
  are cleaned up; no real operator store or native capture root was modified.
  Earlier exact-identity review/measurement evidence remains
  historical; this correction does not close other R46 stages or the R43/R45
  independent-review blockers.
- October 11 baseline: R46-KR1 first delivery was independently verified and closed.
  Package regressions, adjacent read-side gate and final measurements are
  recorded in `docs/evidence/2026-10-11-bounded-storage-first-delivery-verification.md`;
  fresh independent evaluation PASS is recorded separately in
  `docs/evidence/2026-10-11-bounded-storage-first-delivery-evaluation.md`.
  Existing R45/R44/R43 independent-review blockers are not closed by R46.
- First-delivery tasks and KR are done. R46
  remains active while append/cache/archive/Lite convergence acceptance is open.
- No all-product, real-operator-store or release readiness claim is made by
  generated measurements. October 11 production identity, before this correction:
  `b4d49d72e15e4b887c6979364a1300519f61ba95278eabf89fe97383e3519df5`.
