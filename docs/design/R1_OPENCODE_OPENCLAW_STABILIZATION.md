# R1 OpenCode And OpenClaw Stabilization

## Status

- Objective: `R1 - OpenCode And OpenClaw Stabilization`
- Backlog status after this note: `done`
- Phase reached: OpenCode and OpenClaw support-tier closure complete on
  2026-04-02 after real-archive-backed fixture, parser/regression, and
  evidence-preserving intake validation
- Current focus: keep both stable claims truthful and reopen source-specific
  follow-up only if newer real samples expose additional edge cases

## Phase 1: Domain Understanding

### What exists today

- `openclaw` and `opencode` are now both `stable` after completing their
  real-archive-backed fixture, regression, and support-surface slices.
- `openclaw` discovery currently assumes `~/.openclaw/agents` and matches
  `.jsonl` files whose parent directory is `sessions`.
- `opencode` discovery currently assumes either
  `~/.local/share/opencode/project` or
  `~/.local/share/opencode/storage/session`, and the parser reconstructs a
  session from session JSON plus sibling `storage/message/<session-id>/*.json`
  files. Project-local `.opencode` directories or user config locations are not
  currently treated as transcript-bearing roots.
- Roadmap scope for this objective is not "register the adapters" but to prove
  real disk structure, error cases, token-usage behavior, and project-signal
  stability well enough to promote them beyond `experimental`.

### Host findings on 2026-03-27, 2026-03-31, and 2026-04-02

The current host does not have the transcript-bearing roots required for either
experimental adapter:

- missing transcript root: `/root/.openclaw/agents`
- missing transcript root: `/root/.local/share/opencode/project`
- missing transcript root: `/root/.local/share/opencode/storage/session`

A follow-up scan on 2026-03-28 found nearby `.opencode` config directories in
`/tmp` workspaces, but they only contained config artifacts such as
`mastra.json`, not transcript-bearing session or message history. Until real
samples prove otherwise, those config-like paths are not treated as R1 sample
collection roots.

On 2026-03-31, the repository received a real dot-file archive extracted under
`.realdata/config_dots_20260331_212353/`. That archive does not include
OpenClaw data, but it does include real OpenCode data under
`.local/share/opencode/storage/`. Review details are recorded in
`docs/design/REAL_SOURCE_ARCHIVE_REVIEW_2026-03-31.md`.

The real OpenCode layout in this archive is centered on:

- `storage/project/global.json`
- `storage/session/global/*.json`
- `storage/message/<session-id>/*.json`
- `storage/part/<message-id>/*.json`
- optional-looking `storage/session_diff/*.json` and `storage/todo/*.json`

This means the objective is no longer uniformly blocked. OpenCode now has
completed Phase 2 fixture work, regression proof, and support-surface closure,
and OpenClaw now has a real archive that enables executable sample-backed
parser/fixture work instead of remaining blocked on acquisition.

### 2026-04-02 real OpenClaw archive review

The repository now has a user-provided real archive at `.realdata/openclaw_backup.tar.gz`,
created from real `~/.openclaw` data. Unlike the earlier handoff-only state,
this archive already contains transcript-bearing OpenClaw evidence and can drive
Phase 1 decomposition directly.

Archive-visible findings:

- transcript-bearing files are present under `agents/main/sessions/*.jsonl`; the
  archive currently contains 183 active session JSONL files plus 172
  `.reset.*` and 25 `.deleted.*` lifecycle variants in the same `sessions/`
  tree
- other agent roots differ by role in this archive: `agents/main/` contains
  session transcripts plus agent-local config, while `agents/kimicoding/agent/`
  and `agents/anyrouter/agent/` currently expose `auth-profiles.json` config
  only and no transcript sessions
- observed companion files under `agents/main/agent/` are
  `auth-profiles.json` and `models.json`; these are evidence-bearing config/model
  metadata, not the primary transcript stream
- active session logs are typed event streams rather than the current simplified
  synthetic fixture shape. Sampled top-level event kinds are `session`,
  `model_change`, `thinking_level_change`, `custom`, and `message`
- sampled `customType` values include `model-snapshot` plus at least one
  `openclaw:prompt-error` event
- sampled `message.message.role` values include `user`, `assistant`, and
  `toolResult`; sampled content item types include `text`, `thinking`, and
  `toolCall`
- session-level workspace signal is carried by `session.cwd`; most sampled
  active sessions point at `/root/.openclaw/workspace`
- sampled model/provider evidence appears both in `model_change` events and
  assistant message metadata; the archive includes multiple provider/model pairs
  rather than one fixed combination
- `.reset.*` and `.deleted.*` files are transcript-shaped historical lifecycle
  artifacts, not generic config noise. They need an explicit capture/derivation
  rule rather than silent omission by default

Implications for decomposition:

- the current synthetic OpenClaw fixture shape in tests (`role` + `content`
  rows only) is not sufficient to represent the real archive
- `packages/source-adapters` now needs sample-backed decisions for typed
  event-stream parsing, `toolResult` / `toolCall` handling, `thinking` content,
  `session.cwd` workspace signals, and lifecycle suffix handling for
  `.reset.*` / `.deleted.*`
- support-tier decisions for OpenClaw can now proceed only through sample-backed
  fixture, parser, and higher-layer validation work rather than remaining
  blocked on acquisition

### 2026-04-01 OpenCode promotion decision

Targeted validation now confirms the OpenCode slice satisfies the promotion
checklist items that are executable on this host:

- real-world structure review exists via `.realdata/config_dots_20260331_212353/`
  and `docs/design/REAL_SOURCE_ARCHIVE_REVIEW_2026-03-31.md`
- sanitized OpenCode fixtures are present in `mock_data/` and
  `pnpm run mock-data:validate` passes
- parser and operator regressions pass via
  `pnpm --filter @cchistory/source-adapters test` and
  `pnpm --filter @cchistory/cli test`
- support-surface closure now passes via `pnpm run verify:support-status`

As of 2026-04-01, OpenCode therefore moves to `stable`. As of 2026-04-02, OpenClaw also moves to `stable` after the real-archive-backed fixture, parser/discovery, CLI, evidence-only companion-capture, and support-surface verification slice all closed on this host review path.

### 2026-03-31 split decision

Based on the real archive review:

- At the 2026-03-31 review point, OpenCode was the executable stabilization slice inside `R1`; that work is now closed by the 2026-04-01 promotion decision above.
- OpenClaw should remain in `R1`, but now as an executable sample-backed
  parser/fixture/support-tier slice informed by the reviewed real archive.
- Gemini, Cursor CLI/chat-store, CodeBuddy, and other newly observed roots are
  broader than `R1` and should be tracked under separate backlog objectives.

### Unknowns still blocking stabilization

- Whether real OpenClaw session logs include additional event kinds, sidecars,
  or per-agent metadata beyond the current JSONL fixture shape.
- Whether OpenCode `storage/session_diff` and `storage/todo` are derivation-
  critical evidence, evidence-only companions, or safely ignorable noise.
- Whether real OpenCode deployments outside this archive favor the observed
  `storage/session/global` layout, the older `storage/session` layout, or a mix
  of both in practice.
- Whether either source has edge cases around truncated files, token usage,
  workspace signals, or cross-session project continuity that are absent from
  the current fixtures.

### Collection path prepared

Canonical operator guidance for inspection helpers now lives in
`docs/guide/inspection.md`. This section keeps the historical collection shape
visible for future recollection on other hosts. OpenCode promotion has already
closed, and additional collection work is only needed if future OpenClaw or
cross-host comparison evidence is required.

The shared collection script remains:

- `pnpm run inspect:collect-source-samples -- --platform openclaw --platform opencode`
- optional custom output directory: `pnpm run inspect:collect-source-samples -- --platform openclaw --platform opencode --output /tmp/r1-open-source-collection`

For future recollection, agents should treat the OpenClaw-only variant as the
default command and use the combined command only if a later real-data review
needs to compare OpenClaw samples against OpenCode again:

- `pnpm run inspect:collect-source-samples -- --platform openclaw --output /tmp/openclaw-samples`

The manifest still records checked transcript roots and config-only exclusions so
future analysis does not confuse `.opencode` artifacts with transcript-bearing
evidence, but OpenCode collection is no longer the active gate for this
objective.


### Sample review checklist and current answers

A real OpenClaw archive now exists, so the next agent should treat the questions
below as partially answered by the 2026-04-02 review and use them to drive the
remaining fixture/parser/support-tier decisions.

#### Both platforms

- Which roots actually contain transcript-bearing evidence, and which nearby
  paths are only config, caches, logs, or user preferences?
- Which files are transcript-bearing, which are evidence-only companions, and
  which can stay out of capture scope without losing derivation-critical data?
- Which identifiers define session identity, message identity, ordering, and
  project/workspace continuity?
- Which fields carry timestamps, token or usage counts, model names, tool-call
  signals, cwd/workspace paths, and agent metadata?
- What malformed, truncated, partial-write, or unknown-item cases appear in real
  data but not in the current fixtures?
- Which artifacts contain information that must be preserved as evidence even if
  the product later collapses or masks it in presentation layers?

#### OpenClaw-specific

- Which JSONL event kinds appear in practice, and which of them correspond to
  user submissions, assistant output, tool context, or autonomous housekeeping?
- Are there sidecars or per-agent metadata files outside `sessions/*.jsonl`
  that influence project identity, title, model labeling, or turn boundaries?
- In high-volume autonomous sessions with relatively few user turns, what is the
  smallest evidence-preserving rule for building `UserTurn` boundaries without
  dropping important agent/tool context?
- Do long-running agents emit heartbeat/no-op/status events that should remain
  captured but be deemphasized in derived projections?

#### OpenCode-specific

- How often do real installations use the official `project/.../storage/*`
  layout versus the legacy `storage/session` + `storage/message` layout?
- Does the session JSON always provide a stable session ID, or do some real
  samples require fallback ID derivation from filenames or companion files?
- Do any real OpenCode installations store derivation-critical metadata in
  project-local `.opencode` directories or user config paths, or are those paths
  consistently config-only?
- Are there message files that are missing, duplicated, out of order, or stored
  under a different directory shape than `storage/message/<session-id>/*.json`?

### Provisional fixture matrix after sample review

These scenarios are the minimum expected Phase 2 fixture targets once real
samples are available. They are provisional until validated against the collected
bundle.

- **OpenClaw minimal session**: one short user-led session that proves baseline
  JSONL parsing, timestamps, and project signals.
- **OpenClaw high-volume autonomous session**: enough events to exercise the
  turn-building strategy for many assistant/tool records around a small number of
  user submissions.
- **OpenClaw malformed/partial session**: truncated JSONL, unknown event kinds,
  or incomplete event payloads observed in real logs.
- **OpenCode official-layout session**: historical Phase 2 target that is now
  satisfied by the delivered fixtures and regression suite.
- **OpenCode legacy-layout session**: historical regression target retained here
  as context for the stable promotion decision.
- **OpenCode malformed/missing-message case**: historical checklist item now
  covered by the real-archive-backed parser review and fixture set.
- **Cross-platform scale case**: at least one session large enough to pressure
  CLI/web readability and reveal whether derived projections need truncation,
  grouping, or pagination safeguards.

### Affected code paths and validation checkpoints

Once real samples arrive, review and update the following surfaces in dependency
order rather than patching ad hoc symptoms.

#### Discovery and source registration

- `packages/source-adapters/src/platforms/openclaw.ts`: default root candidate
  and file matching policy for OpenClaw.
- `packages/source-adapters/src/platforms/opencode.ts`: official vs legacy root
  candidates plus supplemental legacy-session handling when the official project
  root is selected.
- `packages/source-adapters/src/platforms/registry.ts`: adapter registration and
  support-tier participation.
- `packages/source-adapters/src/index.test.ts`: discovery expectations for
  selected paths, candidate roots, and fixture-backed probe behavior.

#### Parsing and canonical projection

- `packages/source-adapters/src/core/legacy.ts`: source slot definitions,
  parser-version metadata, transcript seed extraction, and platform-specific
  conversion into canonical session/turn candidates.
- `packages/domain/src/index.ts`: canonical types that the adapters must still
  project into without inventing source-specific semantics.
- `packages/storage/src/index.test.ts` and `apps/cli/src/index.test.ts`: the
  higher-layer proof that parsed sessions remain queryable, searchable, and
  exportable through canonical product surfaces.

#### Support claims and operator-facing inventory

- `docs/design/CURRENT_RUNTIME_SURFACE.md`: keep both OpenClaw and OpenCode
  aligned with their evidence-backed `stable` tier unless a later real-data
  review reopens either claim.
- `docs/design/SELF_HOST_V1_RELEASE_GATE.md` and `docs/sources/README.md`: the
  current support-surface closure now covers both OpenCode and OpenClaw; future
  edits should narrow or revoke those stable claims only when new evidence
  proves the current validation slice is no longer sufficient.
- `docs/guide/cli.md`: update operator wording only if real samples prove a
  different root shape, warning, or workflow is needed.

#### Collection and fixture prep

- `scripts/inspect/collect-source-samples.mjs`: keep the collection manifest in
  sync with whatever transcript-bearing roots and derivation-critical sidecars
  real samples reveal.
- `scripts/inspect/collect-source-samples.test.mjs`: keep the collector’s
  transcript-vs-config boundary enforced by automated regression coverage.
- `mock_data/` and `mock_data/scenarios.json`: add only the anonymized fixture
  scenarios that are actually justified by the collected evidence.

#### Completed validation sequence after real-sample review

1. Reviewed `.realdata/openclaw_backup.tar.gz` against the checklist above and recorded which OpenClaw artifacts are active transcripts, lifecycle-history variants, or companion-only config.
2. Created anonymized OpenClaw fixtures under `mock_data/.openclaw/` and confirmed `pnpm run mock-data:validate` passes.
3. Updated OpenClaw parser handling for the typed event-stream JSONL shape, `toolResult` / `toolCall` / `thinking` content, `session.cwd` workspace signals, `model_change`/`model-snapshot` model cues, and the current active-session rule for `.reset.*` / `.deleted.*` files.
4. Confirmed `pnpm --filter @cchistory/source-adapters test` passes.
5. Confirmed `pnpm --filter @cchistory/cli test` passes for the user-visible CLI slice affected by the parser change.
6. Reevaluated OpenClaw promotion readiness after the evidence-only intake update: the real-sample, fixture, parser/discovery, CLI, and companion-artifact checklist items are now satisfied on this host review path.
7. Updated `BACKLOG.md` and this note so the next executable step is the support-surface closure pass (`registry` / `stable-adapter-validation.json` / runtime docs / README surfaces / `pnpm run verify:support-status`) rather than more parser work.

### Promotion-to-stable evidence checklist

No platform should move out of `experimental` until every item below is
satisfied for the platform being promoted. OpenCode now meets this checklist on
the current host review path. OpenClaw now also has a real transcript-bearing
sample bundle plus green fixture/parser/CLI validation and evidence-only
companion capture; the remaining unchecked slice is support-surface consistency
for any stable-tier move.

#### Evidence and fixture proof

- A real-world sample bundle exists and the Phase 1 review above has been
  completed against actual transcript-bearing files.
- `mock_data/` contains anonymized fixtures that cover the verified real-world
  layouts, edge cases, and scale cases for the platform.
- `pnpm run mock-data:validate` passes after those fixtures land.
- `mock_data/stable-adapter-validation.json` is updated to record the real-sample
  validation basis for the promoted platform.

#### Parser and operator regression proof

- `pnpm --filter @cchistory/source-adapters test` passes with the new fixtures
  and any added parser/discovery regressions.
- `pnpm --filter @cchistory/cli test` passes if user-visible listing, query,
  export, or source-health behavior changed.
- Any newly discovered derivation-critical companion files are captured as
  evidence rather than silently dropped from the canonical pipeline.

#### Support-surface consistency proof

- `pnpm run verify:support-status` passes after updating support-tier claims.
- `docs/design/CURRENT_RUNTIME_SURFACE.md` describes the platform as `stable`
  only when the real-world validation gap is actually closed.
- `docs/design/SELF_HOST_V1_RELEASE_GATE.md`, `README.md`, and `README_CN.md`
  stay consistent with the adapter registry’s support tier.
- `docs/sources/README.md` and any new per-platform source reference docs should
  only be added once the platform has enough validated real-world detail to act
  as a stable technical reference.

#### Closure expectation for R1

If sample review reveals materially different stabilization needs for OpenClaw
and OpenCode, split them into separate KRs rather than forcing a single shared
closure record. `R1` is complete only when the backlog has truthful KRs/tasks
for the remaining acceptance gap and any promoted support claims are backed by
real evidence plus green validation commands.

## Next required step

OpenCode and OpenClaw are now both closed for the current `R1` support-tier
slice. Reopen this note only if a later real-sample review reveals new evidence
that should narrow or revoke either stable claim, or if a new platform-specific
edge case needs its own follow-up KR.
