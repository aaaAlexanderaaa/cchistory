---
doc_type: issue-tracker
status: historical
authority: evidence
last_reconciled: 2026-10-11
subject: complete-canonical-user-text-recall
---

# Long canonical user text is missing from search

## Summary

Full stores complete canonical user input but searches only its first 16 KiB,
so users cannot recall retained turns by a term appearing after that prefix.

Resolved on 2026-10-11 in the first bounded-storage delivery. The reproduction
and actual behavior below record the pre-repair baseline; current scans use
complete canonical text, with global and project tail searches both returning 1.

## Surface

- [x] CLI
- [x] API
- [x] Web
- [ ] source-adapter
- [x] storage/linking
- [x] docs/process

Storage was exercised directly. CLI/API/Web are affected consumers of this
shared search path; separate UI/runtime reproductions were not performed.

## Affected area

- Platform/source: generated Codex JSONL; shared storage scan applies to all
  sources with long canonical text
- Source id: generated fixture identity
- Session id: `cost-codex-0`
- Turn id: resolved by the fixture's prefix marker
- Project id: generated from `/workspace/storage-cost/project-0`
- Store path: isolated `cchistory-storage-cost-*` temporary directory

## Reproduction steps

1. Build the current CLI with `pnpm --filter @cchistory/cli build`.
2. Run `node scripts/oneoff/measure-storage-cost.mjs --profiles longuser --repeats 1`.
3. Inspect the `detail`/`detail_targeted_diagnostic`, `search`, `search_tail`,
   and `search_tail_project` results. The first input contains a prefix marker,
   about 64 KiB of text, and the unique term `storagecosttailmarker` at its end.

The helper creates and removes its own source/store, verifies physical raw
capture hashes, and records the missed search as a diagnostic outcome. Its
successful exit means evidence collection completed, not that recall passed.

## Expected behavior

Both unscoped and project-scoped exact-term queries find the one current turn
whose full canonical text contains `storagecosttailmarker`. Bounded previews
may reduce display materialization without determining search membership.

## Actual behavior

Prefix search finds one turn. Full raw/canonical text and physical source bytes
retain the tail marker. Both tail searches return zero results.

## Evidence

### Commands / payloads

```text
raw_user_bytes: 65601
prefix search: total=1
unscoped tail search: expected_matches=1, total=0
project-scoped tail search: expected_matches=1, total=0
detail asserts: raw_text and canonical_text both contain the tail marker
input integrity: initial and current capture SHA-256 checks pass after append/GC
```

See [measurement reproduction](../evidence/2026-10-11-storage-longuser-reproduction.json)
and [storage assessment](../evidence/2026-10-11-storage-cost-assessment.md).

### Paths / ids

- `packages/storage/src/queries/search.ts::scanSearchCandidateRows`
- `packages/storage/src/internal/storage.ts::searchTurnsPaginated`
- `packages/storage/src/evidence-store.ts::upsertBoundedUserTurn`
- `docs/design/archive/STORAGE_BOUNDARY/V2_CONTRACT.md`, bounded scan hints

### Screenshot (if UI bug)

Not applicable to the storage-level reproducer.

## Scope check

- [ ] looks isolated
- [x] possibly class-wide
- [ ] unknown

The same scan generator is used across sources and shared read surfaces.
Unscoped and project-scoped tail queries were reproduced. Unicode byte
boundaries, masking, path terms, ranking, and other read surfaces remain
category-guard requirements at assessment time. The repair subsequently verifies
Unicode tails, raw-only masked terms, empty canonical text, path terms and shared
read-surface membership in storage/canonical tests.

## Category and root mechanism

- Category: derived index/read projection.
- Root mechanism: scan SQL selects bounded `user_turns_v2.canonical_text`,
  not `canonical_text_full`; the scan has no fallback verification of the
  remainder. A field intended as a scan hint determines recall membership.
- Sibling variants checked: prefix and tail terms, unscoped and scoped search,
  direct and resolved detail, raw input integrity through append and GC.

## Contract impact

- Governing authority: `HIGH_LEVEL_DESIGN_FREEZE.md` sections 9.3, 10.4,
  14.1, and 17; the archived V2 contract's reconstructable hint semantics.
- Classification: implementation defect and evidence conflict. The code
  comment accepts missed tail terms, while the higher authority defines recall
  over canonical user text and the V2 document says hints must not gate recall.
- A repair must keep shared literal/mask/path query semantics and complete user
  input. A faster prefix-only query cannot be used as its acceptance baseline.

## Decision and resolution

- Decision: prioritize complete canonical-text search in the proposed bounded
  storage work; reconcile the search/index contract before material cutover.
- Class-level guard: long user text with unique tail terms, Unicode, masks,
  literals/punctuation, scoped/unscoped parity, lifecycle eligibility, and
  search result detail consistency.
- Resolution revision: working-tree first delivery over base `36d209e`;
  full production identity and passing regressions are recorded in
  [implementation verification](../evidence/2026-10-11-bounded-storage-first-delivery-verification.md).
  [Fresh independent evaluation](../evidence/2026-10-11-bounded-storage-first-delivery-evaluation.md)
  passes the first-delivery scope. No separate Web rendering validation is claimed.

## Evidence-preservation checklist

- [x] No raw evidence was deleted or rewritten to hide the symptom.
- [x] A small reproducible source-shaped command and payload are included.
- [x] Expected and actual outcomes are distinguished.
- [x] Source/platform and shared storage scope are recorded.
