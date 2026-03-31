# R1 OpenCode And OpenClaw Stabilization

## Status

- Objective: `R1 - OpenCode And OpenClaw Stabilization`
- Backlog status after this note: `decomposing`
- Phase reached: `Phase 1 - Domain Understanding`
- Current blocker: awaiting user-run real-sample collection

## Phase 1: Domain Understanding

### What exists today

- `openclaw` and `opencode` are registered as `experimental` in the adapter
  registry and already have parser/discovery coverage plus fixture-backed tests.
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

### Host findings on 2026-03-27 and 2026-03-28

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

That means this host cannot complete the required real-world structure analysis
from local evidence alone.

### Unknowns still blocking stabilization

- Whether real OpenClaw session logs include additional event kinds, sidecars,
  or per-agent metadata beyond the current JSONL fixture shape.
- Whether real OpenCode deployments favor the newer `project/.../storage/*`
  layout, the legacy `storage/session` layout, or a mix of both in practice.
- Whether either source has edge cases around truncated files, token usage,
  workspace signals, or cross-session project continuity that are absent from
  the current fixtures.

### Collection path prepared

Canonical operator guidance for inspection helpers now lives in
`docs/guide/inspection.md`. This section records the specific R1 unblock path
prepared for future real-sample review.

To unblock Phase 1 on a machine that actually has OpenClaw or OpenCode data, the
repository now provides a one-click collection script:

- `pnpm run inspect:collect-source-samples -- --platform openclaw --platform opencode`
- optional custom output directory: `pnpm run inspect:collect-source-samples -- --platform openclaw --platform opencode --output /tmp/r1-open-source-collection`

The script writes a manifest plus copied sample files under either the supplied
output path or `.cchistory/inspections/source-samples-<timestamp>/`. The
manifest explicitly records the requested platforms, checked transcript roots,
and notes about config-only paths so future analysis does not confuse
`.opencode` artifacts with transcript-bearing evidence. For this R1 slice, run
it with both requested platforms so the bundle currently collects:

- OpenClaw `sessions/*.jsonl` files under `~/.openclaw/agents`
- OpenCode session JSON files under both official and legacy transcript roots
- matching OpenCode `storage/message/<session-id>/*.json` message files


### Sample review checklist once real samples arrive

When a real collection bundle exists, the next agent should answer the following
questions before creating fixtures or proposing promotion-to-stable work.

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
- **OpenCode official-layout session**: `project/.../storage/session` plus
  matching `storage/message/<session-id>/` files with cwd/workspace signals.
- **OpenCode legacy-layout session**: `storage/session` plus matching
  `storage/message/<session-id>/` files so the legacy path remains regression
  covered while the official layout is preferred.
- **OpenCode malformed/missing-message case**: real evidence of absent or
  mismatched message files, incomplete session JSON, or usage-field drift.
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

- `docs/design/CURRENT_RUNTIME_SURFACE.md`: keep OpenClaw/OpenCode marked
  `experimental` until the real-world validation gap is actually closed.
- `docs/design/SELF_HOST_V1_RELEASE_GATE.md` and `docs/sources/README.md`: do
  not promote support claims or add stable reference docs until the objective’s
  real-sample evidence, fixtures, and regressions are complete.
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

#### Resume validation sequence after samples arrive

1. Run `pnpm run inspect:collect-source-samples -- --platform openclaw --platform opencode` on the host with real data (see `docs/guide/inspection.md` for the stable command contract).
2. Review the manifest and copied files against the checklist above.
3. Create anonymized fixtures and run `pnpm run mock-data:validate`.
4. Run `pnpm --filter @cchistory/source-adapters test`.
5. Run `pnpm --filter @cchistory/cli test` if parsing behavior changes affect
   operator-visible flows.
6. Update `BACKLOG.md` with truthful KRs/tasks before starting non-trivial
   parser or support-tier changes.

### Promotion-to-stable evidence checklist

Neither `openclaw` nor `opencode` should move out of `experimental` until every
item below is satisfied for the platform being promoted.

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

Run the collection script on a machine where OpenClaw and/or OpenCode history is
present, then resume this objective with the generated manifest and copied
sample set. Use the checklist above to turn the real evidence into Phase 2
fixture tasks and truthful KR decomposition. Until that happens, R1 cannot
proceed into fixture design or stabilization work without guessing about
real-world structure.
