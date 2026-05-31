# Backlog

This is the living work surface for CCHistory and the active backlog. Agents must read this file at the start of every session.

For the operational workflow that governs how objectives and tasks are executed,
see `PIPELINE.md`.

When there is no executable task, agents must run the KR review sweep defined in
`PIPELINE.md` across the whole project's open work, not only the currently
blocked or pending task, and add any resulting tasks, KRs, or objectives here
before starting non-trivial corrective work.

## Current Status

**R17, R31, and R35 are blocked on operator-provided data or user-started
services.** R39 completed in-place on 2026-05-17 after the canonical-only
default-search fix, focused local validation, and three successful independent
final reviews. R40 completed in-place on 2026-05-31 after resume provenance,
path-aware search, CLI/TUI/Web projection work, source-shaped E2E coverage, and
the CLI/TUI read-side verification gate passed.

Documentation drift guardrail work from `R36` was completed in-place on
2026-05-14 and is kept below as the current ownership record for support/runtime
inventory drift.

CLI/TUI quality work from `R37` was completed in-place on 2026-05-15 and is
kept below as the current quality-gate ownership record.

CLI/TUI product UX and AI project-context work from `R38` was completed
in-place on 2026-05-16 and is kept below as the current ownership record for
projection-language and code-grounded derivation/session-relation audit work.
The remaining derivation, relation-graph, fixture-realism, and UI visual-matrix
gaps found by that audit were closed under objective `R39`, completed in-place
on 2026-05-17.

| Objective | Status | Blocker |
|-----------|--------|---------|
| R17 - LobeChat Real-Sample Validation | active | Waiting for user-provided real LobeChat data |
| R31 - Managed-Runtime Manual Review Diaries | active | Waiting for user to start canonical services |
| R35 - Managed Remote-Agent Manual Review | active | Waiting for user to start canonical API service |

231 completed objectives were archived and subsequently removed during repository cleanup.

---

## Objective: R40 - Resume Provenance And Path Search
Status: done
Priority: P0
Source: user direction on 2026-05-31
Design: `docs/design/R40_RESUME_PROVENANCE_PATH_SEARCH_PLAN.md`

Users can see sessions in CCHistory that may be invisible to the currently
active upstream agent account/provider namespace. They need to recover the
source-native resume UUID and a ready-to-copy command such as
`cd /absolute/path && codex resume <uuid>` or
`cd /absolute/path && claude --resume <uuid>`. They also need to find those
sessions by absolute workspace path or repo basename, not only by canonical turn
text.

This objective must preserve the frozen model: project-first history,
`UserTurn` as the primary recall object, evidence-preserving ingestion, and
UI/API/CLI/TUI as projections of one canonical model. Source-native resume data
is provenance, not a replacement for canonical session identity.

Implementation priority agreed with the user:

1. Storage/search plus CLI/TUI first, because this is the fastest path to a
   usable resume command.
2. WebUI in the same feature slice, focused on search/detail/resume/long-path
   display rather than a broad redesign.
3. Search result rows may show a compact resume availability hint; full
   copyable commands belong in detail panels.

Completion evidence:

- Source adapters, storage, CLI, TUI, API-client/domain/presentation, and Web
  targeted builds/tests passed.
- `pnpm run verify:cli-tui-read-side` passed, including real-layout fixture
  sync/read checks.
- Journey E now proves Codex and Claude Code fixtures can be found by absolute
  workspace path and expose expected resume commands in built CLI JSON output.

### KR: R40-KR1 Source-native resume provenance is preserved
Status: done
Acceptance: Codex and Claude Code source-shaped ingestion preserve the
source-native session UUID and expose a deterministic resume projection without
deriving it by brittle display-string parsing. The projection distinguishes the
canonical session ID from the source-native resume ID.

- Task: document Codex and Claude Code resume provenance and account/provider
  isolation
  Status: done
  Acceptance: a design note records the local verified resume syntax, UUID
  source fields, path layout, cwd filtering behavior, provider/account isolation
  observations, and privacy boundaries for local validation.
  Artifact: `docs/design/R40_RESUME_PROVENANCE_PATH_SEARCH_PLAN.md`

- Task: extend domain/API/presentation session contracts for resume provenance
  Status: done
  Acceptance: `SessionProjection`, API DTOs, presentation mappings, and tests
  expose source-native resume fields and distinguish them from CCHistory
  session IDs.
  Artifact: `packages/domain/src/`, `packages/api-client/src/`,
  `packages/presentation/src/`

- Task: preserve Codex and Claude Code source-native resume IDs in adapters
  Status: done
  Acceptance: source-shaped adapter tests prove Codex extracts the session UUID
  from `session_meta.payload.id`, Claude Code extracts the source session UUID
  from raw `sessionId` or filename evidence, and delegated/subagent evidence
  does not produce misleading ordinary resume commands.
  Artifact: `packages/source-adapters/src/`

### KR: R40-KR2 Path-aware search finds resume targets
Status: done
Acceptance: search matches canonical ask text plus absolute workspace/project
path evidence, including path fragments and basename fragments, with both FTS5
and fallback substring search behavior covered.

- Task: extend storage search indexing to include path-bearing session/project
  metadata
  Status: done
  Acceptance: storage tests prove queries for absolute path fragments,
  workspace basenames, and canonical ask content return the expected turns and
  preserve existing search filters/pagination behavior.
  Artifact: `packages/storage/src/queries/search.ts`,
  `packages/storage/src/test/search.test.ts`

- Task: add source-shaped E2E coverage for path search to resume provenance
  Status: done
  Acceptance: Codex and Claude Code fixtures sync through the built CLI, can be
  searched by workspace path, and expose the expected resume command in
  machine-readable output.
  Artifact: `mock_data/`, `tests/e2e/` or `scripts/verify-*.mjs`

### KR: R40-KR3 CLI/TUI expose quick resume commands
Status: done
Acceptance: CLI and TUI let an operator quickly recover the source-native
resume command for a search result or session without losing traceability to
the canonical turn/session.

- Task: expose resume provenance in CLI show/search output
  Status: done
  Acceptance: `show turn`, `show session`, and search JSON include resume
  provenance; human long/detail output prints copyable commands such as
  `cd /absolute/path && codex resume <uuid>` and
  `cd /absolute/path && claude --resume <uuid>`.
  Artifact: `apps/cli/src/`, `apps/cli/src/test/`

- Task: expose resume provenance in TUI detail
  Status: done
  Acceptance: the right-side TUI detail area shows a readable resume command
  for supported Codex/Claude Code sessions while result rows remain compact;
  layout tests cover long absolute paths and commands.
  Artifact: `apps/tui/src/`, `apps/tui/src/*test.ts`

### KR: R40-KR4 Web search/detail catches up for this workflow
Status: done
Acceptance: Web search supports ask/path lookup, shows compact resume
availability in result rows, and shows a full copyable command in detail
panels. Long paths and side panels remain usable on desktop and mobile layouts.

- Task: update Web search and detail surfaces for path search and resume
  provenance
  Status: done
  Acceptance: search copy no longer claims only canonical turn text; result
  rows include source/path context and a compact resume availability cue; turn
  and session detail panels show full copyable resume commands.
  Artifact: `apps/web/components/views/search-view.tsx`,
  `apps/web/components/turn-detail-panel.tsx`,
  `apps/web/components/session-detail-panel.tsx`

- Task: fix Web long-path and side-panel display issues touched by the resume
  workflow
  Status: done
  Acceptance: the changed Web surfaces handle long absolute paths, dense
  metadata, and narrow/mobile side panels without text overlap or unusable
  overflow. Use existing Web validation paths and do not start persistent
  services on the local Codex desktop profile.
  Artifact: `apps/web/`

---

## Objective: R38 - CLI/TUI Product UX And AI Project Context
Status: done
Priority: P0
Source: user direction on 2026-05-16

The CLI/TUI surfaces currently prove correctness better than they serve a
person or an AI agent trying to understand prior work. They expose too much
source, session, and implementation vocabulary by default; hide or truncate some
content before the user has enough context; leave some high-value regions sparse
while crowding others; and still lack the design-freeze core workflow of giving
an external AI a project-scoped, cross-session understanding tool.

This objective must preserve the frozen model: project-first history,
`UserTurn` as the primary recall object, evidence preservation, and UI/API/CLI
as projections of one canonical model. The product language can be friendlier
without inventing a second semantic layer.

### KR: R38-KR1 AI project-context tool exists
Status: done
Acceptance: CLI exposes a stable command that gives an AI a concise
project-scoped context packet across sessions and sources. Human output should
lead with what the user asked and how to continue; JSON output should preserve
stable IDs and inspection commands without dumping raw internal objects by
default.

- Task: add a CLI project-context command for AI and operator use
  Status: done
  Acceptance: `cchistory context project <ref>` returns a cross-session project
  context packet with recent asks, session threads, source mix, timestamps, and
  next inspection commands; `--json` returns structured data suitable for an AI
  tool call; package tests cover human output, JSON output, and absence of
  raw/internal field names in default text.
  Artifact: `apps/cli/src/`, `apps/cli/src/test/`, `docs/guide/cli.md`

### KR: R38-KR2 CLI/TUI user-facing language and density are audited
Status: done
Acceptance: a product-UX audit identifies which CLI/TUI default views expose
internal vocabulary, over-truncate useful content, crowd low-value metadata, or
leave high-value areas underused. Each finding is classified as `fix-now`,
`defer`, or `needs-more-evidence`.

- Task: audit CLI/TUI user-facing language, density, and empty-space behavior
  Status: done
  Acceptance: a design note records concrete CLI/TUI views, screenshots or
  command outputs where useful, and a prioritized fix list tied to tests.
  Artifact: `docs/design/R38_CLI_TUI_PRODUCT_UX_AUDIT.md`

### KR: R38-KR3 high-friction CLI/TUI default views are redesigned
Status: done
Acceptance: the highest-impact default views use product language, reveal the
right content before metadata, hide internal details behind explicit expansion,
and include tests that guard against regressions in default information density.

- Task: redesign the first CLI/TUI default views identified by the R38 audit
  Status: done
  Acceptance: at least the project-level CLI read path and the TUI browse/detail
  path receive focused wording/layout fixes with package tests updated.
  Artifact: `apps/cli/src/`, `apps/tui/src/`, tests, and relevant docs

- Task: move CLI turn/session trace metadata behind explicit expansion
  Status: done
  Acceptance: default `show turn` and related session drill-down text hide
  internal lineage or revision IDs while `--long` and JSON preserve
  traceability.
  Artifact: `apps/cli/src/commands/browse.ts`, `apps/cli/src/test/`

- Task: redesign project tree and help ownership wording from the R38 audit
  Status: done
  Acceptance: `tree project <ref>` leads with session threads and latest asks
  before source/host grouping, and CLI help shows search pagination flags under
  the search command rather than the project-context row.
  Artifact: `apps/cli/src/commands/browse.ts`, `apps/cli/src/args.ts`,
  `apps/cli/src/test/`, docs

### KR: R38-KR4 pillar derivation and session-relation semantics are audited
Status: done
Acceptance: before R38 completion is claimed, a code-grounded audit separates
real runtime paths from test-only helpers; reviews raw-source to `UserTurn` and
token-usage derivation assumptions; and checks delegated/subagent/automation
session organization against the frozen design and R20/R23 related-work
decisions.

- Task: classify runtime-critical paths versus test-only or verifier-only paths
  Status: done
  Acceptance: the audit names which helpers and fixtures bypass source adapter
  parsing, which tests exercise `runSourceProbe` or built entrypoints, and which
  low-test-count modules carry pillar behavior.
  Artifact: `docs/design/R38_PILLAR_DERIVATION_SESSION_AUDIT.md`

- Task: audit raw-to-turn and token-usage derivation assumptions
  Status: done
  Acceptance: the audit traces source files through capture, records,
  fragments, atoms, submission groups, `UserTurn`, `TurnContext`, and token
  summary projection; it identifies unrealistic assumptions about ordering,
  field names, cumulative token signals, content size, and synthetic user-shaped
  records.
  Artifact: `docs/design/R38_PILLAR_DERIVATION_SESSION_AUDIT.md`

- Task: audit delegated/subagent and automation session organization
  Status: done
  Acceptance: the audit checks whether current related-work projection supports
  both parent-to-child and child-to-parent navigation for transcript-primary
  child sessions, preserves evidence-only automation runs, and avoids promoting
  delegated or automation-shaped input into ordinary parent `UserTurn` recall.
  Artifact: `docs/design/R38_PILLAR_DERIVATION_SESSION_AUDIT.md`

Follow-up ownership: `R39` owned and closed the remaining graph/query,
token-fixture, scale-fixture, test-inventory, and UI visual-matrix hardening
gaps named by the R38 pillar derivation audit. R38 itself remains a completed
audit and first UX fix slice.

---

## Objective: R39 - Derivation Relation And Realism Hardening
Status: done
Priority: P0
Source: R38-KR4 code-grounded audit and user review on 2026-05-16

R38 confirmed that the visible CLI/TUI projection language is now better
aligned with project-first recall, but it also exposed deeper evidence risks
that should not stay hidden inside an audit note: low-test-count pillar paths,
token-usage derivation assumptions, delegated/subagent session organization,
fixture scale realism, and UI visual/layout verification limits.

This objective must preserve the frozen model: project-first history,
`UserTurn` as the primary recall object, evidence-preserving ingestion, and
UI/API/CLI/TUI as projections of one canonical model. It should not merge child
session turns into parent `UserTurn` recall, should not promote automation
events into ordinary user asks, and should not treat projection-fixture tests as
proof of parser truth.

### KR: R39-KR1 Test coverage inventory and visual-layout proof are explicit
Status: done
Acceptance: the repository has a maintained inventory that distinguishes
parser/source-shaped, projection-fixture, built-entrypoint, verifier-only,
visual/manual, and user-started-service coverage; the TUI/UI read-side has at
least one rendered-layout or visual verification path that can catch region
size, boundary occupancy, overflow, and expected-vs-actual content gaps beyond
text snapshots.

- Task: add a coverage inventory for pillar and projection tests
  Status: done
  Acceptance: a design note or backlog-linked table labels the high-value CLI,
  TUI, storage, source-adapter, verifier, and E2E tests by coverage type and
  names which pillar behaviors still depend on weak proxy coverage.
  Artifact: coverage inventory checkpoint below

- Task: add UI/TUI rendered-layout or visual verification for region boundaries
  Status: done
  Acceptance: a repeatable local check verifies TUI/read-side region sizes,
  clipping, overflow, and expected content placement on representative narrow
  and wide terminal layouts without requiring persistent services.
  Artifact: `apps/tui/src/layout.test.ts`

#### R39-KR1 Coverage Inventory Checkpoint

| Coverage surface | Current artifact | Coverage type | Proves | Residual limitation after R39 |
| --- | --- | --- | --- | --- |
| Adapter parser and source discovery | `packages/source-adapters/src/platforms/*.test.ts`, `packages/source-adapters/src/core/discovery.test.ts` | parser/source-shaped | `runSourceProbe` handles source-specific raw files, sidecars, discovery, malformed records, and some relation fragments | Mostly small synthetic shapes; not a scale corpus and not all relation directions are covered |
| Token derivation | `packages/source-adapters/src/core/tokens.test.ts`, `packages/source-adapters/src/test-helpers.ts` | parser/source-shaped | token usage and stop reasons survive `runSourceProbe`; covers Codex, Claude Code, Factory Droid, AMP, model switches, multi-turn, multi-reply, delayed/interleaved token signals, cache field variants, cumulative deltas, and large assistant replies | Still lacks a broad scale corpus across many source families and very large mixed-source stores |
| Storage projection/linking | `packages/storage/src/test/*.test.ts` | projection-fixture plus storage integration | linking, search, ingest, maintenance, stats, and query-relative inbound/outbound related-work projection over `replaceSourcePayload` stores | Fixture payloads bypass parser truth; source-shaped relation fanout is covered separately by the related-work verifier |
| CLI command surface | `apps/cli/src/test/*.test.ts`, `scripts/verify-cli-artifact.mjs` | package command-path and built-entrypoint | human/JSON output, read/admin command behavior, missing-object errors, store resolution, artifact execution | Mostly seeded or fixture stores; visual density is text-asserted, not screen-diffed |
| TUI state and renderer | `apps/tui/src/state.test.ts`, `apps/tui/src/layout.test.ts`, `apps/tui/src/index.test.ts` | reducer, renderer snapshot, rendered layout matrix, layout text assertions | keyboard flow, overlay exclusivity, browse/search/detail/conversation behavior, CJK-aware clipping, line-width bounds, narrow/wide text layouts, stable two-column search region boundaries, and expected result/detail placement | No bitmap screenshot or terminal-emulator visual diff; perceived whitespace and actual terminal rendering remain partly outside automated proof |
| Seeded journeys | `tests/e2e/journey-a-*` through `journey-d-*` | integration / projection-fixture | CLI/API parity, search-to-traceability, read-only admin behavior, export/import readability | Seeded through `replaceSourcePayload`; bypasses discovery, parser ordering, raw file layouts, and source-specific quirks |
| Real-layout journey | `tests/e2e/journey-e-real-layout.test.mjs`, `scripts/verify-real-layout-sync-recall.mjs` | source-shaped E2E | `mock_data/` file layouts sync through built CLI and read back through CLI/API/TUI across stable adapters | Fixtures are structural/redacted and small; generated scale coverage exists separately but does not replace all stable adapter real-layout breadth |
| Scale recall verifier | `scripts/verify-scale-recall.mjs` | source-shaped generated verifier | Generates temporary Codex and Claude Code JSONL sources with 2400 turns across 24 sessions, syncs through built CLI, and verifies CLI browse/search/detail plus TUI browse/search without entering the default lightweight package-test path | Generated data covers scale and one large tool-output target, but not every stable source family or real-world nested delegation fanout |
| Real HTTP parity | `tests/e2e/journey-f-real-http-api.test.mjs` | short-lived HTTP E2E | API behavior is checked through an ephemeral real listener rather than only `app.inject()` | Does not cover user-started managed services; R31/R35 remain manual-service blocked |
| Related work recall | `scripts/verify-related-work-recall.mjs` | source-shaped verifier plus CLI/API/TUI projection | delegated-session and automation-run related work is visible across CLI/API/TUI from `mock_data/.claude`, `.openclaw`, and generated Claude fanout sessions; parent-to-child and child-to-parent relation directions are explicit | Generated fanout covers multiple child sessions for Claude-shaped data, but does not yet model every source family's native delegation graph |
| Support/runtime drift | `scripts/verify-support-status.mjs`, `scripts/verify-runtime-inventory.mjs` | manifest/drift verifier | docs/runtime support claims and API route inventory stay aligned | Does not prove parser or UI behavior; only guards declared surfaces |

### KR: R39-KR2 Token and source-shaped fixture realism is hardened
Status: done
Acceptance: raw-to-`UserTurn` and token-usage derivation are tested with
source-shaped data that covers delayed or interleaved token signals, multiple
signals between tool events, cache-inclusive versus cache-exclusive upstream
fields, large multi-reply turns, and synthetic user-shaped records.

- Task: add token derivation fixtures for delayed, interleaved, and ambiguous usage signals
  Status: done
  Acceptance: source-adapter tests using `runSourceProbe` prove token
  attribution for delayed signals, multiple signals between tool events, model
  switches, cache field variants, and large multi-reply turns without relying
  only on projection fixtures.
  Artifact: `packages/source-adapters/src/core/tokens.test.ts`,
  `packages/source-adapters/src/test-helpers.ts`

- Task: add a scale-shaped recall fixture or generated test store
  Status: done
  Acceptance: one repeatable test or verifier exercises thousands of turns
  across multiple sessions and sources, proves search/browse/detail behavior,
  and remains separate from the default lightweight package-test path.
  Artifact: `scripts/verify-scale-recall.mjs`

### KR: R39-KR3 Delegated/subagent session relations are queryable both ways
Status: done
Acceptance: transcript-primary child sessions remain separate sessions, child
turns do not pollute parent `UserTurn` recall, automation runs stay
evidence-only unless explicitly user-authored, and parent-to-child plus
child-to-parent navigation is explicit and tested through storage, CLI/TUI/API,
or verifier coverage.

- Task: decide the normalized session-relation query shape
  Status: done
  Acceptance: a short design note or code-adjacent plan decides whether to
  persist normalized relation edges or add storage queries over existing
  relation fragments, with explicit parent, child, automation, and reverse
  lookup semantics.
  Artifact: relation query shape decision below

- Task: implement and test parent-child relation navigation without parent recall pollution
  Status: done
  Acceptance: source-shaped tests cover one parent session spawning multiple
  transcript child sessions, verify parent-to-child navigation,
  child-to-parent traceability, compact default related-work visibility, and no
  delegated child turns merged into parent recall.
  Artifact: `packages/storage/src/internal/storage.ts`,
  `packages/storage/src/test/linking.test.ts`,
  `scripts/verify-related-work-recall.mjs`

#### R39-KR3 Relation Query Shape Decision

Use query-over-existing-fragments first; do not add persisted normalized edge
tables until profiling or cross-surface duplication proves persistence is
needed. The implementation should add storage-level relation queries that scan
typed `session_relation` fragments and normalize them into one derived edge
shape with explicit orientation:

- `evidence_session_ref`: the session that carried the source fragment.
- `parent_session_ref`: explicit parent/calling session when present.
- `child_session_ref`: transcript-primary child session when relation kind is
  `delegated_session`; for current child-carried fragments this is usually the
  evidence session.
- `automation_session_ref` or `automation_owner_session_ref`: the session or
  session namespace that owns an evidence-only automation run.
- `relation_kind`: `delegated_session` or `automation_run`, matching the
  existing domain contract.
- `target_kind`: `session` for transcript-primary child work,
  `automation_run` for evidence-only automation.
- `direction`: query-relative `outbound`, `inbound`, or `self`, so parent
  detail views can discover children and child detail views can trace parents
  from the same normalized semantics.
- raw source identifiers such as `parent_uuid`, `callingSessionId`,
  `parent_tool_ref`, `agent_id`, `job_id`, and `session_key` remain preserved in
  `raw_detail` and fragment refs.

The default recall/search object remains `UserTurn`. Relation queries must
never merge child-session turns into parent-session recall, and automation runs
must remain evidence-only unless future source review proves a human-authored
transcript anchor.

### KR: R39-KR4 Design-doc consistency and newcomer maintenance docs are reviewed
Status: done
Acceptance: `docs/design/` no longer leaves contradictory guidance around
session-first versus project-first recall, support claims, automation/session
organization, fixture realism, or runtime validation boundaries; newcomer docs
explain stable runtime paths, test-only helpers, projection fixtures, and
manual/user-started-service work without requiring oral history.

- Task: audit docs/design against the high-level design freeze
  Status: done
  Acceptance: a design note or backlog section lists any conflicts,
  stale wording, or best-current decision across project-first recall,
  `UserTurn` primacy, evidence preservation, session relations, support tiers,
  and UI/API projection semantics.
  Artifact: design-doc consistency checkpoint below

- Task: update newcomer-facing development and maintenance documentation
  Status: done
  Acceptance: onboarding docs identify the runtime-critical ingestion path,
  projection/test helper paths, mock-data realism limits, quality gates, and
  user-started-service manual validation boundaries with enough specificity for
  a new contributor to start safely.
  Artifact: `README.md`, `README_CN.md`, `tests/e2e/README.md`,
  `docs/design/V1_VALIDATION_STRATEGY.md`, `docs/guide/cli.md`

#### R39-KR4 Design-Doc Consistency Checkpoint

- `HIGH_LEVEL_DESIGN_FREEZE.md` does not need a direction change for R39. The
  remaining work is implementation and validation hardening around the frozen
  invariants: project-first history, `UserTurn` primacy, evidence preservation,
  and one canonical model projected to UI/API/CLI/TUI.
- `R20_AUTOMATION_CRON_SUBAGENT_SEMANTICS.md`,
  `R23_CANONICAL_DELEGATION_GRAPH.md`, and
  `R38_PILLAR_DERIVATION_SESSION_AUDIT.md` agree on the core rule:
  delegated/subagent instructions and automation triggers are secondary
  evidence unless truly human-authored; child work must not be flattened into
  parent `UserTurn` recall.
- The current R39 implementation closes the R38/R23 query-shape gap without
  adding persisted edge tables: typed related-work projections now include
  query-relative `outbound`, `inbound`, and `self` directions plus explicit
  parent, child, evidence, and automation session refs derived from existing
  `session_relation` fragments.
- `R37_CLI_TUI_QUALITY_AUDIT.md` and `R38_CLI_TUI_PRODUCT_UX_AUDIT.md` are
  consistent with the freeze: `Ask` is user-facing language for `UserTurn`, not
  a new canonical object. Remaining polish and visual-matrix work is now owned
  by R39 instead of hidden as deferred audit text.
- `docs/design/FIXTURE_CORPUS_MANIFEST.md` correctly describes shape coverage,
  but it does not yet advertise scale realism. R39-KR2 should avoid treating
  the current redacted fixture corpus as proof for thousands of turns, huge tool
  payloads, nested delegation, or delayed token signals.
- `tests/e2e/README.md` now classifies Journey F as short-lived real HTTP
  parity and keeps seeded integration, real-layout sync, generated scale, and
  verifier-only coverage separate.
- Newcomer docs now separate runtime-critical ingestion (`runSourceProbe`),
  projection fixtures (`replaceSourcePayload`), `mock_data/` realism limits,
  generated scale verification, built-entrypoint verifiers, and
  user-started-service diaries without changing product semantics.

### Phase 7 Holistic Evaluation
Status: done

- Boundary: changes preserve project-first history, `UserTurn` as the primary
  recall/search object, evidence preservation, and one canonical model projected
  through storage, CLI, TUI, API, Web, and presentation contracts. Default
  search now targets canonical ask text only; session metadata, raw-only text,
  assistant replies, and tool output remain drill-down context rather than
  default recall targets. No child session turns are merged into parent
  `UserTurn` recall.
- Relation semantics: `session_relation` fragments are still raw evidence;
  storage derives query-relative `outbound`, `inbound`, and `self` related-work
  projections without introducing persisted edge tables. API, API client,
  presentation, CLI, TUI, and Web now expose or respect direction so inbound
  parent traces are not labeled as child sessions.
- Realism: token derivation now has source-shaped delayed/interleaved/cache
  variant fixtures, and scale recall has a generated source-shaped verifier that
  exercises 2400 turns across 24 sessions and 2 sources without adding a heavy
  default package test.
- Validation passed on 2026-05-16: `pnpm --filter @cchistory/storage test`,
  `pnpm --filter @cchistory/source-adapters test`,
  `pnpm --filter @cchistory/presentation test`,
  `pnpm --filter @cchistory/cli test`,
  `pnpm --filter @cchistory/tui test`,
  `pnpm --filter @cchistory/tui test:state`,
  `pnpm --filter @cchistory/tui test:layout`,
  `pnpm --filter @cchistory/api-client build`,
  `pnpm --filter @cchistory/api build`, `cd apps/web && pnpm lint`,
  `NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @cchistory/web build`,
  `node scripts/verify-scale-recall.mjs`, and
  `node --import ./scripts/install-node-sqlite-warning-filter.mjs scripts/verify-related-work-recall.mjs`.
- Additional validation passed on 2026-05-17 after the canonical-only search
  fix: `pnpm --filter @cchistory/storage test`,
  `pnpm --filter @cchistory/tui test:state`,
  `pnpm --filter @cchistory/tui test`,
  `pnpm --filter @cchistory/tui test:layout`,
  `pnpm --filter @cchistory/cli test`,
  `node scripts/verify-scale-recall.mjs`, and
  `node --import ./scripts/install-node-sqlite-warning-filter.mjs scripts/verify-related-work-recall.mjs`.
- Drift validation passed on 2026-05-17 after final review residual-risk
  closure: `node scripts/verify-support-status.mjs` and
  `node scripts/verify-runtime-inventory.mjs`.
- Independent review status: first review round found stale relation docs and
  direction-blind Web/TUI projection; those blockers were fixed. A later review
  found that default search still included non-`UserTurn.canonical_text` fields;
  storage, TUI fallback refinement, tests, and CLI docs now enforce
  canonical-text-only default search. Three final independent reviews then
  passed after the final search fix:
  `019e32aa-66a5-76a0-ba95-2859ef140240` for design-freeze/search-boundary
  invariants, `019e31a5-0ce3-7e42-9394-a137ee4bae6a` for implementation and
  tests, and `019e32aa-66ca-7f91-8345-0c8fb377dfc6` for documentation and
  validation-surface consistency.

---

## Objective: R37 - CLI/TUI Quality And E2E Expansion
Status: done
Priority: P0
Source: user direction on 2026-05-15

The current backlog overstates project health by treating all open work as
blocked, while CLI/TUI quality and local E2E expansion remain executable. The
test surface has useful package and verifier coverage, but too much of the
goal-level confidence still depends on seeded stores, snapshot assertions, and
historical manual diaries. This objective owns the longer quality push needed
before CLI and TUI can be treated as trustworthy daily-use surfaces.

### Completion Goal

`R37` is complete only when CLI and TUI have a durable quality bar, not when one
or two additional tests are added. Completion requires all of the following:

- known CLI/TUI bugs and UX blockers are inventoried, either fixed or explicitly
  deferred with rationale, and every fixed bug has a regression test at the
  layer where it failed;
- CLI read/admin workflows are covered by skeptical command-path tests that
  exercise real built entrypoints, human-readable output, JSON output, filter
  flags, missing-object errors, and store-resolution behavior;
- TUI browse/search/detail/conversation/source-health/stat/navigation behavior
  is covered by a mix of reducer, renderer, built-entrypoint, and interaction
  tests that can catch state-transition and keyboard-flow bugs;
- true E2E coverage starts from source-shaped files in `mock_data/`, runs
  `sync`, and verifies CLI/API/TUI read parity for the stable adapter families,
  instead of relying mainly on in-process seeded storage;
- a single documented local quality gate exists for the CLI/TUI/read-side slice,
  and it passes together with the relevant package tests and drift guards.

This objective should stay open until the user-facing CLI/TUI read experience is
boringly reliable across representative local datasets.

### KR: R37-KR1 CLI/TUI bug inventory and repro plan is complete
Status: done
Acceptance: `BACKLOG.md` or a linked design note contains a reviewed inventory
of current CLI/TUI defects, skipped tests, known TUI state risks, and
UX-improvement-plan items. Each item is classified as `fix-now`, `defer`, or
`needs-more-evidence`, and every `fix-now` item names the regression layer that
must prove it.

- Task: audit current CLI/TUI quality evidence and known gaps
  Status: done
  Acceptance: the audit references current package tests, `tests/e2e/`,
  verifier scripts, `docs/design/UX_IMPROVEMENT_PLAN.md`, and
  `apps/tui/ARCHITECTURE.md`, then produces a concrete fix/defer list instead
  of another broad health summary.
  Artifact: `docs/design/R37_CLI_TUI_QUALITY_AUDIT.md`

- Task: turn known local defects into reproduction tests before or with fixes
  Status: done
  Acceptance: known local bugs such as TUI jump/scroll state gaps, stale
  keyboard-state risks, unreadable CLI output paths, and skipped local-mockable
  CLI tests are represented by failing or newly passing regression tests.
  Artifact: `apps/cli/src/test/`, `apps/tui/src/`, `tests/e2e/`, or verifier
  scripts as appropriate

### KR: R37-KR2 CLI command-path quality is reliable across read/admin flows
Status: done
Acceptance: CLI package tests and skeptical verifier coverage prove the shipped
entrypoint across the high-value local workflows: `sync`, `discover`, `health`,
`ls projects/sessions/sources`, `search` with filters and limits, `show
turn/session`, `tree project/session`, `stats`, backup/import/restore, and
clear missing-store or missing-object failures. Human-readable output and
`--json` output both have meaningful assertions where they are product
surfaces.

- Task: expand CLI regression coverage around brittle user paths
  Status: done
  Acceptance: tests cover compact vs long output, scoped search, ambiguous or
  missing identifiers, default store resolution, source-health output, and
  relevant admin read paths with real built CLI execution where feasible.
  Artifact: `apps/cli/src/test/`, `scripts/verify-skeptical-browse-search.mjs`,
  `scripts/verify-cli-artifact.mjs`, or new focused verifier scripts

- Task: close or reclassify skipped CLI remote-agent placeholders
  Status: done
  Acceptance: skipped local-mockable agent tests are replaced by a mock server
  or in-process harness, while genuinely user-started service flows remain
  explicitly owned by `R35`.
  Artifact: `apps/cli/src/test/commands-agent.test.ts`,
  `docs/design/R29_REMOTE_AGENT_VALIDATION_CONTRACT.md`, `BACKLOG.md`

### KR: R37-KR3 TUI behavior is covered beyond snapshots
Status: done
Acceptance: TUI tests prove state transitions and user-visible output for
browse, search, detail, full conversation drill-down, source health, stats,
page/jump navigation, focus cycling, overlays, missing-store errors, and narrow
terminal layouts. The suite must include enough interaction-level coverage to
catch keyboard sequencing bugs, not only static renderer snapshots.

- Task: add a TUI interaction harness or equivalent keyboard-flow verifier
  Status: done
  Acceptance: at least one test path drives the built TUI or reducer through
  realistic key sequences for browse -> detail -> conversation -> back, search
  -> result drill-down, overlay toggles, page/jump navigation, and escape
  behavior.
  Artifact: `apps/tui/src/`, `scripts/verify-skeptical-tui-full-snapshot.mjs`,
  or a new TUI verifier

- Task: fix or explicitly defer current TUI state/model risks
  Status: done
  Acceptance: documented risks such as `detailScrollOffset` not resetting on
  jump, conversation scroll reset semantics, overlay mutual exclusion, and
  stale input closure behavior are fixed with tests or moved to a named
  deferred list with rationale.
  Artifact: `apps/tui/src/browser.ts`, `apps/tui/src/app.tsx`,
  `apps/tui/src/state.test.ts`, `apps/tui/ARCHITECTURE.md`

### KR: R37-KR4 True E2E coverage expands beyond the current partial slice
Status: done
Acceptance: the local E2E layer includes source-shaped-file journeys that run
`sync` and then verify CLI/API/TUI parity for the stable adapter roster. Seeded
storage integration journeys remain useful, but they are no longer the dominant
evidence for project recall, search, traceability, and read-side parity.

- Task: extend real-layout E2E to all stable source families with available fixtures
  Status: done
  Acceptance: `tests/e2e/` or verifier scripts ingest representative
  `mock_data/` layouts for the stable adapters, then assert source/session/turn
  counts, project linkage, search hits, turn/session detail, and TUI readback.
  Any stable adapter that cannot be included must have a documented fixture or
  real-layout blocker.
  Artifact: `tests/e2e/`, `scripts/verify-real-layout-sync-recall.mjs`,
  `mock_data/`

- Task: add real HTTP API coverage for CLI/API parity where service lifecycle is local and short-lived
  Status: done
  Acceptance: at least one E2E journey exercises a short-lived Fastify listener
  through HTTP `fetch`, not only `app.inject`, while preserving the repository
  rule that long-lived dev services are user-started.
  Artifact: `tests/e2e/journey-f-real-http-api.test.mjs`,
  `tests/e2e/helpers.mjs`

### KR: R37-KR5 A repeatable CLI/TUI quality gate exists
Status: done
Acceptance: one documented command or command group validates the CLI/TUI/read
slice without requiring user-started services. It should run the relevant
package tests, expanded true E2E/verifier coverage, and drift guards in a
memory-conscious order suitable for the local Codex desktop profile.

- Task: define and document the CLI/TUI/read-side quality gate
  Status: done
  Acceptance: docs explain which commands form the default quality bar, what
  each command proves, which pieces remain manual or service-backed, and how to
  run the gate on the local developer host without starting persistent services.
  Artifact: `package.json`, `AGENTS.md`, `docs/design/V1_VALIDATION_STRATEGY.md`,
  `README.md`, `README_CN.md`

### Phase 7 Holistic Evaluation
Status: passed on 2026-05-15

- Boundary: changes stayed inside CLI/TUI tests, read-side verifiers, E2E
  journeys, and validation documentation. No canonical storage schema, source
  adapter semantics, or `UserTurn`-first recall contracts changed.
- Stability: added regressions cover missing/ambiguous references, default-store
  resolution after sync, long prompt display, TUI latest-state keyboard input,
  scroll reset invariants, overlay exclusivity, all-stable fixture sync/read,
  and a short-lived real HTTP API parity path.
- Scalability: CLI default output is more compact with `--long` preserving full
  detail; the quality gate runs sequentially for the local Codex desktop memory
  profile and avoids persistent dev services.
- Compatibility/security: no migration is required, existing stores remain
  readable, and the only network listener is an ephemeral local Fastify server
  inside E2E tests.
- Accepted limitations: in-project TUI search, fuzzy project filtering,
  cross-surface timestamp polish, token counts in TUI rows, and CLI help
  grouping remain product polish or needs-more-evidence items rather than R37
  blockers. Managed Web/API and remote-agent diaries remain blocked under
  `R31` and `R35`; LobeChat remains blocked under `R17`.

---

## Objective: R36 - Documentation Drift Guardrails
Status: done
Priority: P1
Source: user direction on 2026-05-14

The project had accumulated drift between the adapter registry, support-tier
docs, Web manual source inventory, OpenAPI route inventory, and AI-facing agent
instructions. This objective owns the corrective slice that keeps current
runtime facts machine-checkable instead of relying on hand-synchronized prose.

### KR: R36-KR1 Adapter support surfaces are aligned with Accio
Status: done
Acceptance: README surfaces, runtime surface, release gate, source-reference
docs, fixture manifest, and Web manual source inventory all agree with the
adapter registry: 12 registered adapters, 10 stable, and 2 experimental
(`lobechat`, `accio`), with `pnpm run verify:support-status` passing.

- Task: update adapter/support documentation for Accio and current counts
  Status: done
  Acceptance: user-facing and design docs name Accio as experimental without
  widening stable self-host support claims.
  Artifact: `README.md`, `README_CN.md`, `docs/design/CURRENT_RUNTIME_SURFACE.md`,
  `docs/design/SELF_HOST_V1_RELEASE_GATE.md`, `docs/sources/README.md`,
  `docs/design/FIXTURE_CORPUS_MANIFEST.md`, `docs/guide/web.md`,
  `docs/guide/cli.md`

- Task: extend support-status verification to cover drift-prone counts and Web manual source inventory
  Status: done
  Acceptance: `node scripts/verify-support-status.mjs` passes and checks support
  tables, prose counts, source-reference exclusions, and Web manual-source
  options against the registry.
  Artifact: `scripts/verify-support-status.mjs`,
  `apps/web/components/views/sources-view.tsx`

### KR: R36-KR2 Runtime route inventory is machine-checkable
Status: done
Acceptance: a lightweight verifier compares API route registrations against the
OpenAPI path summary, and the OpenAPI summary includes the previously missing
`/openapi.json`, `/api/turns/summary`, and `/api/sessions` entries.

- Task: add runtime inventory verification
  Status: done
  Acceptance: `node scripts/verify-runtime-inventory.mjs` passes and
  `pnpm run verify:runtime-inventory` is available as the repository command.
  Artifact: `scripts/verify-runtime-inventory.mjs`, `package.json`,
  `apps/api/src/utils/openapi.ts`

### KR: R36-KR3 AI-facing development rules are profile-based and less drift-prone
Status: done
Acceptance: `AGENTS.md` separates always-on repository rules from local Codex
desktop and Cursor Cloud environment profiles, keeps command names without
hard-coded test counts, and records the new drift verifiers.

- Task: refactor AI-facing repository guidelines
  Status: done
  Acceptance: `AGENTS.md` retains source-of-truth, safety, runtime, memory, and
  validation constraints while removing stale count claims and clarifying which
  profile applies on which host.
  Artifact: `AGENTS.md`

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
  Artifact: `scripts/inspect/collect-source-samples.mjs`, `scripts/inspect/collect-source-samples.test.mjs`

- Task: analyze the collected LobeChat sample and finish structure/backlog decomposition
  Status: blocked
  Blocker: no real LobeHub/LobeChat sample bundle has been provided for review.
  Acceptance: `docs/design/R17_LOBECHAT_EXPORT_VALIDATION.md` and `BACKLOG.md` record which files are transcript-bearing, whether `~/.config/lobehub-storage` is the truthful default root on the reviewed host, whether the generic export parser is sufficient, and which fixture/parser changes become executable next.
  Artifact: `docs/design/R17_LOBECHAT_EXPORT_VALIDATION.md`, `BACKLOG.md`

### KR: R17-KR3 LobeChat fixture, regression, and support-tier closure if real-data review passes
Status: open
Acceptance: LobeChat moves beyond the current experimental slice only if sanitized sample-backed fixtures, parser regressions, and support surfaces all align with the reviewed real-data layout.

- Task: add sanitized LobeChat fixtures and parser regressions after real-data review
  Status: blocked
  Blocker: blocked behind a reviewed real LobeChat sample and structure review.
  Acceptance: `mock_data/` and `pnpm --filter @cchistory/source-adapters test` gain only the LobeChat scenarios justified by reviewed real samples, including any export-bundle edge cases or companion/index files that affect truthful parsing.
  Artifact: `mock_data/`, `pnpm --filter @cchistory/source-adapters test`

- Task: update LobeChat support claims after any future promotion decision
  Status: blocked
  Blocker: no evidence-backed promotion decision exists while LobeChat remains
  experimental and out of scope pending user-provided data.
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
