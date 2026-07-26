---
doc_type: evidence
status: historical
authority: evidence
last_reconciled: 2026-07-26
subject: source-absence-retention
---

# Source absence retention verification report

## Claim and evidence class

- Claim/completion layer: R45 technical implementation and category guards are
  complete; R45 objective closure is not claimed.
- Contract and revision: `docs/contracts/source-absence-retention.md`, working
  tree based on `46d43ce997721d6241d48bde6b6eb7702d37b3a4`.
- Evidence class: unit, integration, source-shaped CLI/API, physical-file GC,
  and public API-client contract tests.
- What this class does not prove: no mutation test ran against the operator
  store, no release artifact was built, and the independent reviewer has not
  rerun against the post-fix working tree.

## Environment

- Timestamp/timezone: 2026-07-26, Asia/Shanghai.
- Runtime/platform/configuration: Linux workspace, Node.js v24.14.0, pnpm
  10.30.3, built-in `node:sqlite`; FTS5 unavailable, so four FTS-specific
  storage cases skipped and fallback search remained active.
- Fixture/source/store identity without secrets: sanitized Codex and Claude
  source-shaped fixtures plus isolated `mkdtemp` stores and source roots.
- Reproduction commands: package commands listed in the result matrix; no
  service process was started.

## Result matrix

| Scenario/state | Expected | Observed evidence | Result |
|---|---|---|---|
| Non-streaming upstream absence | Retain raw rows, Session, UserTurn, context, capture, ledger, evidence row/file | All retained after forced evidence prune; axes became `source_absent` | pass |
| Codex streaming upstream absence | Same retention as non-streaming | Capture, ledger, parsed span, turn/context, evidence row, and physical blob survived forced GC | pass |
| Successful changed-file replacement | Replace current projection but retain superseded raw source bytes | Old and new source captures survived forced GC; only new projection remained current | pass |
| Cross-file Session | One current contributor keeps the Session current | Missing ledger became absent while shared Session and turns stayed current | pass |
| Reappearance | Restore ledger/Session/turn lifecycle without destructive reparse | Unchanged Claude/Codex origins returned to `current`; default search returned them again | pass |
| Partial/failed observation | No absence inference or prior-projection deletion | `--limit-files`, missing root, capture/parser failure, and non-authoritative captured bytes preserved prior lifecycle/projection | pass |
| Cross-file partial failure | A failed contributor prevents session-scoped deletion by a changed sibling | Both prior turns and the shared Session remained current; incomplete replacements stayed unpublished | pass |
| Cross-file absence plus sibling replacement | Retain the absent contributor while replacing only the authoritative origin | Absent raw rows/turn/blob lineage remained; the changed sibling projection replaced cleanly | pass |
| Failed-sibling blob veto | Vetoed shared replacement retains its old captured blob identity | Old turn lineage, captured blob, and raw record stayed resolvable after forced evidence GC | pass |
| Lifecycle-only progress and health | Report projection change; keep empty current inventory stale despite retained totals | One `projection_changed: true` event emitted; source stayed `stale` with retained turn count | pass |
| Multi-root completeness | Missing supplemental root prevents absence authority | OpenClaw inventory reported the missing cron root and became complete only after every root existed | pass |
| Selected API inventory | Traverse only requested source roots | Requested probe inventoried one selected source and skipped the unrelated configured source | pass |
| Default versus explicit recall | Default excludes absent; explicit lifecycle request retrieves it | Storage, API route, and API client returned 0 by default and 1 for `sync_axes=source_absent`; detail remained addressable | pass |
| Full producer routing | Existing CLI, managed API, TUI, and remote generation writes avoid destructive repeat replace | CLI/API source-shaped tests and affected package suites passed | pass |

## Commands and outcomes

| Command | Outcome |
|---|---|
| `pnpm --filter @cchistory/storage test` | 125 passed, 4 FTS5-dependent skipped, 0 failed |
| `pnpm --filter @cchistory/source-adapters test` | 157 passed, 0 failed |
| `pnpm --filter @cchistory/cli test` | 185 passed, 0 failed; latest heap guard peak RSS 1163.7 MiB |
| `pnpm --filter @cchistory/api test` | 26 passed, 0 failed |
| `pnpm --filter @cchistory/api-client test` | 10 passed, 0 failed |
| `pnpm --filter @cchistory/tui test` | 24 passed, 0 failed |
| `pnpm run verify:cli-tui-read-side` | passed: CLI 185/185, TUI state 31/31, TUI layout 26/26, E2E 53/53, skeptical browse/search, and real-layout sync-to-read; heap guard peak RSS about 1.22 GiB |
| `pnpm run verify:governance` | 22 governance tests passed; nested document and architecture verifiers passed |
| `pnpm run verify:doc-governance` | passed: 20 governed documents and 10 templates |
| `pnpm run verify:architecture-boundaries` | passed: 5 rules across 68 rule-file matches |

## Failure and recovery checks

| Failure class | Injection/reproduction | Expected recovery | Observed | Result |
|---|---|---|---|---|
| Complete inventory omits prior path | Delete controlled Codex/Claude file | Mark absent, retain bytes/projection | Retained and hidden only from default search | pass |
| Limited inventory | Sync two-file source with `--limit-files 1` | Leave unvisited origin current | Both ledger rows remained current | pass |
| Missing source root | Remove controlled temporary source root | Preserve last-known state and report error | Ledgers and turns remained current | pass |
| Parser failure after capture | Submit captured bytes with blocking parse diagnostic | Retain new evidence and prior successful projection/ledger | Both source evidence versions survived; prior projection remained current | pass |
| Shared Session with changed and failed origins | Replace one contributor while another has a blocking parse diagnostic | Preserve the last complete Session/turn projection | Both prior turns remained current; neither incomplete incoming turn was published | pass |
| Forced evidence GC | Run `pruneEvidenceBlobsNow` after absence/replacement | Retained captures keep both source blobs live | Database rows and physical content-addressed files remained | pass |

## Data and fixture preservation

- Raw/input evidence retained at: isolated stores under per-test `mkdtemp`
  roots; assertions covered `evidence_captures`, `evidence_blobs`, ledger SHA,
  and physical `evidence/blobs/<prefix>/<sha256>` existence.
- Derived output identity: controlled synthetic source/session/turn ids only.
- Sanitization and integrity method: source-shaped fixtures contain no operator
  content; source bytes were SHA-256 checked through content-addressed storage.
- Temporary artifact cleanup: every new test removes its temporary root in a
  `finally` block. `/root/.cchistory` was not modified.

## Anomalies and limitations

- Antigravity mixes files with an optional live virtual-origin probe. Until the
  adapter exposes explicit live-inventory completeness, repeat sync uses
  non-destructive merge but does not infer absence for that source.
- Whole-source identity retirement/host rekey still follows its pre-existing
  retirement path. It was not part of the same-source origin-rotation
  reproduction and is outside this contract's implemented boundary.
- Existing stores already damaged by an older sync are not reconstructed by
  this prospective repair; replay/rebuild from a retained backup is separate.
- Independent review status: the supplied fresh-context review found six P1/P2
  issues, all now remediated with regression guards. A post-fix independent
  confirmation has not run; no exception is claimed.

## Verdict

`PARTIAL`

The technical implementation and its package/source-shaped verification may be
treated as complete. R45 remains verifying and cannot close until post-fix
independent confirmation passes or the user grants a named governance
exception.
