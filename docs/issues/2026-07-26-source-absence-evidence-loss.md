---
doc_type: issue-tracker
status: active
authority: evidence
last_reconciled: 2026-07-26
subject: source-absence-retention
---

# Source absence deletes retained history bug report

## Summary

A successful Full sync currently treats a previously captured source file that
is no longer present in the authoritative file inventory as a replacement with
no incoming content. The Codex streaming path deletes both the derived history
and the content-addressed source evidence; non-streaming merge paths preserve
the evidence capture but still delete the derived history. Users therefore
lose durable history merely because an upstream coding agent moved or removed
its native session file.

## Surface

- [x] CLI
- [x] API
- [ ] Web
- [x] source-adapter
- [x] storage/linking
- [x] docs/process

## Affected area

- Platform/source: every Full file-backed sync for derived retention; Codex for
  confirmed raw-evidence deletion
- Source id: controlled fixture source only
- Session id: controlled fixture session only
- Turn id: controlled fixture turn only
- Project id:
- Store path: isolated temporary stores only

## Reproduction steps

1. In an isolated store, sync a source payload backed by a real source file and
   confirm its `UserTurn`, `evidence_capture`, current ledger, evidence row, and
   content-addressed evidence file exist.
2. Remove the source file from the controlled source root, sync a different
   currently observed file, and run the normal end-of-sync evidence prune.
3. Inspect the old turn, capture, ledger, evidence row, and evidence file.

## Expected behavior

The old evidence, capture metadata, parser-derived rows, session, context, and
`UserTurn` remain durable. Their sync relationship becomes `source_absent` only
after a successful complete source inventory proves disappearance. Default
active recall may exclude the turn, but explicit browse/detail and later
reactivation remain possible. Physical deletion requires an explicit
admin-visible purge.

## Actual behavior

The Codex streaming path deletes the old turn, captured blob, parsed span,
evidence capture, and ledger. End-of-sync GC then deletes the unreferenced
`evidence_blobs` row and unlinks its file. The non-streaming path deletes the
turn and parser-derived rows while retaining the evidence capture and marking
the ledger `source_absent`.

## Evidence

### Commands / payloads

```text
controlled streaming reproduction:
  before: turn=1 capture=1 ledger=current evidence_row=1 evidence_file=true
  after:  turn=0 capture=0 ledger=<missing> evidence_row=0 evidence_file=false

controlled non-streaming reproduction:
  before: turn=1 capture=1 ledger=current evidence_row=1 evidence_file=true
  after:  turn=0 capture=1 ledger=source_absent evidence_row=1 evidence_file=true

read-only operator-store audit:
  source_file_ledger: 2,994 current, 0 source_absent
  checked native Codex/Claude/Factory paths: 2,966
  missing checked paths: 0
```

The reproducer used `CCHistoryStorage` against `mkdtemp` stores and deleted only
the controlled source file. Every temporary directory was removed in `finally`.
The operator store was opened read-only.

### Paths / ids

- Relevant file path(s): `packages/storage/src/evidence-store.ts`,
  `packages/storage/src/ingest/source-payload.ts`,
  `packages/storage/src/internal/gc.ts`, `apps/cli/src/commands/sync.ts`
- Relevant source/session/turn/project ids: synthetic fixture identities only

### Screenshot (if UI bug)

Not applicable.

## Scope check

- [ ] looks isolated
- [x] possibly class-wide
- [ ] unknown

Notes: absence reconciliation, partial scans, capture failures, source-root
failures, reappearance, and cross-file sessions are sibling lifecycle cases.
The storage owner must make the preservation decision; adapters must not each
invent retention policy.

## Category and root mechanism

- Suspected category: lifecycle / ingestion
- Root mechanism after investigation: missing origin paths are added to a
  destructive replacement set. The streaming implementation also deletes the
  only raw-evidence references before the mandatory end-of-sync prune. The
  subsequent `source_absent` update cannot mark a ledger row that was already
  deleted.
- Sibling variants checked: Codex streaming merge, Claude/Factory-style
  non-streaming merge, deferred evidence GC, `--safe`, complete versus limited
  file inventory, and current operator-store ledger state.

## Contract impact

- Governing contract/design-freeze section:
  `HIGH_LEVEL_DESIGN_FREEZE.md` §§ 11.1, 11.3, 11.4, and 17;
  `ARCHITECTURE.md` § Evidence-preserving storage boundary;
  `docs/contracts/source-absence-retention.md`
- Classification: implementation regression and evidence conflict

## Decision and resolution

- Decision: repair the class-wide source-absence transition under the target
  contract before implementation.
- Class-level guard: controlled storage tests for streaming/non-streaming
  absence, GC liveness, partial scans, and reappearance, plus a CLI Codex sync
  regression over a real fixture file.
- Resolution revision and evidence: implemented in the working tree based on
  `46d43ce997721d6241d48bde6b6eb7702d37b3a4`; package and source-shaped evidence
  is recorded in
  `docs/evidence/2026-07-26-source-absence-retention-verification.md`.
  Independent review produced six follow-up findings; each is now covered by a
  focused regression, but post-fix independent confirmation remains pending,
  so the issue stays active/verifying.

## Evidence-preservation checklist

- [x] I did not delete or rewrite raw evidence to make the symptom disappear.
- [x] I included the smallest proving command, payload, or screenshot.
- [x] I included expected vs actual behavior.
- [x] I included source/platform context if relevant.
