---
doc_type: plan
status: active
authority: planning
last_reconciled: 2026-07-26
implements: docs/contracts/source-absence-retention.md
supersedes: []
---

# Source absence retention implementation plan

## Cold-start summary

Current Full sync confuses upstream source absence with authoritative empty
replacement. Codex's streaming path deletes both parser-derived history and
raw evidence references; non-streaming merge deletes the projections. The
contracted end state retains both, records `source_absent`, excludes absent
turns from default recall, and reversibly reactivates them on reappearance.
The technical implementation and category guards are complete. An independent
review supplied six retention, completeness, lifecycle-reporting, health, and
API-scope findings; each now has a focused regression guard. A post-fix
fresh-context confirmation remains pending before objective closure.

## Authority and risk classification

- Design freeze: `HIGH_LEVEL_DESIGN_FREEZE.md` §§ 11 and 17
- Architecture: `ARCHITECTURE.md` § Evidence-preserving storage boundary
- Contract: `docs/contracts/source-absence-retention.md`
- Backlog objective/task: R45 / R45-KR1 and R45-KR2
- Risk: `high-risk` because the repair changes durable lifecycle behavior,
  evidence liveness, default recall, multiple sync paths, and public search
  filtering while correcting an irreversible-data-loss path.

## Complete end state

Every successful Full capture remains durable across source-origin absence
until explicit purge. A complete source inventory may change its relationship
to upstream from `current` to `source_absent`, while retaining the evidence and
all derived projections.
Sessions shared by current and absent files stay current. Reappearing files
reactivate retained history. Partial or failed observations never infer
absence. Default recall/search excludes absent turns, while explicit lifecycle
queries and detail/browse paths can still retrieve them. Streaming Codex and
non-streaming sources share one storage-owned reconciliation rule.

## Current state and gap

| Concern | Verified current fact | Contracted target | Gap/evidence |
|---|---|---|---|
| Codex raw evidence | streaming absence deletes capture, ledger, evidence row, and file | retain until explicit purge | controlled reproduction |
| Derived history | both merge implementations delete absent sessions/turns | retain and mark absent | storage tests currently encode deletion |
| Cross-file session | deletion is session-scoped from one missing blob | current if any current origin contributes | needs category guard |
| Partial/error inventory | completeness is not represented at storage boundary | absence only after complete successful inventory | needs CLI plumbing/guard |
| Reappearance | absent ledger is not consistently reactivated on preserved skips | reversible `source_absent -> current` | needs state-transition guard |
| Recall | storage search has no sync-axis filter | default current/import, explicit absent opt-in | needs storage/API-client contract change |

## Seven-phase execution record

| Phase | Required output | Result/evidence or non-applicability reason |
|---|---|---|
| 1. Domain understanding | authority, terms, affected paths | issue reproduction and current/gap matrix landed |
| 2. Fixtures | sanitized source-shaped evidence/controlled boundary | existing sanitized Codex/Claude fixture helpers plus isolated real files; no new `mock_data` needed |
| 3. Functional design | contract, trade-offs, acceptance | target contract landed; independent review supplied six actionable findings, now reconciled in the contract and implementation |
| 4. Tests first | acceptance checks observed failing | controlled streaming/non-streaming tests reproduced deletion before implementation; lifecycle guards now pass |
| 5. Implementation | smallest coherent change | storage reconciliation, sync completeness routing, failure authority, and search contract implemented |
| 6. Regression | affected and adjacent checks | storage, CLI, API, API client, and TUI suites pass; see verification report |
| 7. Holistic evaluation | fresh-context report/blocked/exception | technical evidence and independent findings are recorded; post-fix fresh-context confirmation remains pending |

## Review topology

- Independent review: completed against the initial implementation; it found
  six concrete P1/P2 issues spanning all three lenses
- Remediation synthesis: completed in this implementation context with focused
  regression coverage for every finding
- Post-fix independent confirmation: pending
- Human decision: the user directed that all findings be fixed and that the
  removed operator SQLite store not be rebuilt
- Governance exception, if any: none

## Risk register

| Risk | Trigger | Impact | Guard | Recovery |
|---|---|---|---|---|
| Accidental retention of replaced current rows | changed file succeeds | duplicate/stale active history | changed-file replacement regression | revert transaction and restore prior merge logic only for successful replacement |
| Cross-file session marked absent too early | one contributor disappears | live session hidden from recall | mixed current/absent session test | recompute axis from every contributing current ledger |
| Partial scan marks unvisited paths absent | `--limit-files` or failed root | broad false absence | completeness-authority test | preserve prior axes and rerun complete sync |
| GC still prunes absent evidence | capture/ref inventory mismatch | irreversible loss | forced-prune physical-file test | abort release; restore backup |
| Retained rows leak into default recall | absent turn stays value-active | stale search/project context | default/explicit sync-axis tests | filter by sync axis without deleting rows |
| Repeated batch work scales with absent history | every Codex batch re-reconciles all rows | sync slowdown | current-ledger-only selection and idempotency test | reconcile once per authoritative source inventory |

## Verification matrix

| Outcome | Evidence class | Command/probe | Negative path | Durable record |
|---|---|---|---|---|
| storage lifecycle parity | unit/integration | `pnpm --filter @cchistory/storage test` | old tests fail before implementation | `docs/evidence/2026-07-26-source-absence-retention-verification.md` |
| Codex command behavior | source-shaped CLI | `pnpm --filter @cchistory/cli test` | removed source file | verification report |
| public search compatibility | API-client/API unit | targeted package tests | absent opt-in versus default | verification report |
| architecture/governance | mechanical | `pnpm run verify:governance` | malformed contract/plan lifecycle | verification report |
| category-level evidence liveness | integration | storage forced-prune test | missing capture/ref | verification report |

## Rollout, migration, and rollback

- Deployment/migration order: contract and tests; storage reconciliation;
  sync completeness plumbing; search/API compatibility; package validation.
- Preflight and backup: no operator-store mutation or schema rewrite during
  development. Release notes must advise backing up the full store before the
  first sync with any unreleased build.
- Abort signal and rollback: any evidence-file deletion, absent-row deletion,
  false absence under partial/error inventory, or cross-file current-session
  demotion fails the change. Code rollback is safe because no schema migration
  occurs; retained rows remain compatible with the old schema.
- Temp-artifact cleanup owner: each test/reproducer owns its `mkdtemp` directory
  in `finally`.

## Progress and completion record

- Current step and truthful blockers: technical implementation and package
  verification are complete. Post-fix independent confirmation is pending and
  is not represented as satisfied.
- Task/KR/objective/release completion layers: implementation tasks complete;
  R45 remains verifying/open; no release or objective-completion claim.
- Contract/plan/issue/evidence updates: this plan,
  `docs/contracts/source-absence-retention.md`, and
  `docs/issues/2026-07-26-source-absence-evidence-loss.md`.
- Final revision and limitations: working tree based on
  `46d43ce997721d6241d48bde6b6eb7702d37b3a4`; isolated fixtures and package
  suites passed, but no operator-store mutation or independent review was
  performed.
