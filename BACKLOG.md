# Backlog

This is the living work surface for CCHistory and the active backlog. Agents must read this file at the start of every session.

For the operational workflow that governs how objectives and tasks are executed,
see `PIPELINE.md`.

When there is no executable task, agents must run the KR review sweep defined in
`PIPELINE.md` across the whole project's open work, not only the currently
blocked or pending task, and add any resulting tasks, KRs, or objectives here
before starting non-trivial corrective work.

## Current Status

**3 active objectives, all blocked on user-started services or external data.**
No executable tasks are currently available for autonomous agent work.

| Objective | Status | Blocker |
|-----------|--------|---------|
| R17 - LobeChat Real-Sample Validation | active | Waiting for user-provided real LobeChat data |
| R31 - Managed-Runtime Manual Review Diaries | active | Waiting for user to start canonical services |
| R35 - Managed Remote-Agent Manual Review | active | Waiting for user to start canonical API service |

231 completed objectives were archived and subsequently removed during repository cleanup.

---

## Objective: R17 - LobeChat Real-Sample Validation And Promotion Decision
Status: active
Priority: P2
Source: ROADMAP.md, user direction on 2026-04-02

With CodeBuddy now promoted to `stable`, the remaining roadmap-owned source gap is `lobechat`. The repository still exposes a truthful experimental LobeChat export parser surface, but no active objective currently owns the missing real-sample review, collection contract, or stable-promotion decision.

User note on 2026-04-02: keep this objective non-blocking for now and prioritize other roadmap-owned gaps until new real LobeChat evidence is provided.

User directive on 2026-04-03: LobeChat is explicitly out of scope unless the user later provides real local data for review. Agents must not spend additional KR-sweep or corrective-work time on `R17` beyond preserving the already-recorded experimental boundary and blocker note. Missing real LobeChat data is not a blocker for continuing broader project work.

### KR: R17-KR1 LobeChat current-slice evaluation and blocker decomposition
Status: done
Acceptance: `docs/design/R17_LOBECHAT_EXPORT_VALIDATION.md` and `BACKLOG.md` record the current LobeChat parser boundary, fixture/probe baseline, and the exact missing evidence that still blocks any move beyond `experimental`.

- Task: review current LobeChat adapter, fixture, and parser assumptions against the stable-adapter checklist
  Status: done
  Acceptance: `docs/design/R17_LOBECHAT_EXPORT_VALIDATION.md` and `BACKLOG.md` state whether the current `~/.config/lobehub-storage` root assumption, generic export parser path, and synthetic test fixture are enough for anything beyond the present experimental claim, with every blocker named explicitly.
  Artifact: `docs/design/R17_LOBECHAT_EXPORT_VALIDATION.md`, `BACKLOG.md`

- Task: add truthful follow-up tasks for the missing LobeChat evidence path
  Status: done
  Acceptance: the backlog names the remaining LobeChat gaps as concrete sample-collection, structure-review, fixture/regression, and support-surface tasks instead of leaving the roadmap gap unowned.
  Artifact: `BACKLOG.md`

### KR: R17-KR2 LobeChat real-sample collection and structure review
Status: open
Acceptance: a real LobeHub/LobeChat sample bundle is collected and reviewed so the repository can verify whether the current root candidate, export shape, and parser boundary are truthful.

- Task: collect a real LobeHub/LobeChat export or local-root sample bundle on a host with actual data
  Status: blocked
  Acceptance: a reviewed evidence bundle exists for the current LobeChat source family, including the transcript-bearing export files and any nearby config/index JSON needed to understand root layout and collection boundaries.
  Artifact: operator-provided sample bundle or archive path

- Task: extend the sample-collection helper to stage candidate LobeChat evidence for operator review
  Status: done
  Acceptance: `scripts/inspect/collect-source-samples.mjs` and its tests can collect candidate `lobechat` JSON evidence from the current unverified local-root assumption without over-claiming transcript boundaries, so operators can hand over a review bundle before parser/promotion work starts.
  Artifact: future `scripts/inspect/collect-source-samples.mjs`, `scripts/inspect/collect-source-samples.test.mjs`

- Task: analyze the collected LobeChat sample and finish structure/backlog decomposition
  Status: pending
  Acceptance: `docs/design/R17_LOBECHAT_EXPORT_VALIDATION.md` and `BACKLOG.md` record which files are transcript-bearing, whether `~/.config/lobehub-storage` is the truthful default root on the reviewed host, whether the generic export parser is sufficient, and which fixture/parser changes become executable next.
  Artifact: `docs/design/R17_LOBECHAT_EXPORT_VALIDATION.md`, `BACKLOG.md`

### KR: R17-KR3 LobeChat fixture, regression, and support-tier closure if real-data review passes
Status: open
Acceptance: LobeChat moves beyond the current experimental slice only if sanitized sample-backed fixtures, parser regressions, and support surfaces all align with the reviewed real-data layout.

- Task: add sanitized LobeChat fixtures and parser regressions after real-data review
  Status: pending
  Acceptance: `mock_data/` and `pnpm --filter @cchistory/source-adapters test` gain only the LobeChat scenarios justified by reviewed real samples, including any export-bundle edge cases or companion/index files that affect truthful parsing.
  Artifact: `mock_data/`, `pnpm --filter @cchistory/source-adapters test`

- Task: update LobeChat support claims after any future promotion decision
  Status: pending
  Acceptance: LobeChat changes tier only if the registry, `mock_data/stable-adapter-validation.json`, runtime surface, release gate, README surfaces, and `docs/sources/` all agree on the reviewed evidence basis, with `pnpm run verify:support-status` passing.
  Artifact: `pnpm run verify:support-status`

---

## Objective: R31 - Managed-Runtime Manual Review Diaries For Web And API
Status: active
Priority: P2
Source: project-wide KR review sweep on 2026-04-03

A project-wide KR review sweep found that the repository now has stable manual
review contracts for the seeded web slice (`R27`) and remote-agent workflows
(`R29`), but it still does not have backlog-owned execution records for the two
highest-value managed-runtime journeys that remain outside the current automated
bar: (1) the seeded web spot-check with diary capture from `R22`, and (2) the
managed API read journey `J7` as defined in `docs/design/R31_MANAGED_API_READ_DIARY_CONTRACT.md`. These
are not agent-executable in this environment because they depend on user-started
services, but they should still be explicitly owned instead of remaining only as
design-note intent.

### KR: R31-KR1 Seeded web spot-check diary is explicitly owned
Status: open
Acceptance: one backlog-owned task exists for running and recording the seeded
web spot-check using the `R27` checklist once the user has started the canonical
services.

- Task: run the seeded web review checklist and record one operator diary
  Status: blocked
  Acceptance: after the user starts the canonical services against a seeded
  review store, one diary records the exact startup command, required checks
  across `Projects`, `Search`, and `Sources`, observed friction, and resulting
  backlog follow-up if needed.
  Artifact: future web-review diary note using the seeded web review checklist in `docs/guide/web.md`

### KR: R31-KR2 Managed API read journey is explicitly owned
Status: open
Acceptance: one backlog-owned task exists for the `J7-supply-managed-api-read`
manual validation path once a user-started API service is available.

- Task: run and record the managed API read journey against a user-started service
  Status: blocked
  Acceptance: after the user starts the canonical API service against a known
  indexed store, one diary records the route chain, observable parity with the
  canonical store objects, and any friction or drift that should become backlog
  work.
  Artifact: future managed-runtime API review note aligned with `docs/design/R31_MANAGED_API_READ_DIARY_CONTRACT.md`

---

## Objective: R35 - Managed Remote-Agent Manual Review Diaries
Status: active
Priority: P2
Source: project-wide KR review sweep on 2026-04-03 after `R34` completion

A fresh project-wide KR review sweep found that `R29` now gives the repository a
truthful remote-agent validation contract, but it still does not give that
contract backlog-owned execution records. The contract explicitly says the
remote-agent surface is not yet proven as a real operator workflow against a
user-started API service, and it names concrete manual scenarios for `agent
pair`, `agent upload`, `agent schedule`, and `agent pull`. Those server-backed
journeys remain unowned execution work today even though the local mocked test
surface is already in place.

### KR: R35-KR1 Pair/upload/schedule remote-agent workflow is explicitly owned as a manual diary
Status: open
Acceptance: one backlog-owned task exists for running and recording a real
remote-agent pair/upload/schedule workflow against a user-started API service,
using the contract fields from `R29`.

- Task: run and record a remote-agent pair/upload/schedule manual diary against a user-started API service
  Status: blocked
  Acceptance: after the user starts the canonical API service, one diary records
  server URL, state-file path, exact `agent pair` / `agent upload` /
  `agent schedule` commands, expected versus observed behavior, and any trust or
  readability friction using the evidence fields from
  `docs/design/R29_REMOTE_AGENT_VALIDATION_CONTRACT.md`.
  Artifact: future remote-agent manual review note aligned with `docs/design/R29_REMOTE_AGENT_VALIDATION_CONTRACT.md`

### KR: R35-KR2 Leased pull and admin job workflow is explicitly owned as a manual diary
Status: open
Acceptance: one backlog-owned task exists for the server-backed leased-job path,
including admin job creation and one `agent pull` execution against a
user-started API service.

- Task: run and record a remote-agent leased-pull manual diary against a user-started API service
  Status: blocked
  Acceptance: after the user starts the canonical API service, one diary records
  job creation input, `agent pull` lease/completion behavior, admin inventory or
  job visibility, expected versus observed results, and any friction or drift
  that should become backlog work.
  Artifact: future remote-agent manual review note aligned with `docs/design/R29_REMOTE_AGENT_VALIDATION_CONTRACT.md`

---

