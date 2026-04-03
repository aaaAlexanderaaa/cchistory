# R21 Loop And Automation Flood Control

## Status

- Objective: `R21 - Loop And Automation Flood Control For Recall Quality`
- Date: 2026-04-02
- Scope: prevalence review and canonical rule design for repeated low-information loop traffic across transcript-bearing turns and secondary-evidence-only traces
- Outcome: define what counts as a loop-like span, which reviewed evidence shapes influence prevalence only, and which projection behaviors should de-emphasize loops without deleting evidence

## Problem Statement

`R20` established that automation-triggered and delegated user-shaped records must not be flattened into ordinary human-authored `UserTurn` anchors. That solves the first truth problem, but not the second one: even when preserved correctly, repeated low-information loop traffic can still dominate project recall and search.

The reviewed evidence shows that this is not one source's quirk:

- Codex root history records repeated `continue` prompts and longer operator loop instructions.
- Claude stores repeated `continue` prompts inside transcript-bearing sessions and also in root-history command logs.
- AMP root history contains short loop-like prompts such as `continue`.
- OpenClaw archive data contains large cron-run populations where the same job or run family emits repeated records far above the proposed `>=3` threshold.

The frozen design still applies:

- preserve evidence;
- keep `UserTurn` as the primary recall object;
- do not create canonical turns from secondary evidence only;
- keep all de-emphasis behavior in projections, ranking, grouping, or display metadata rather than evidence deletion.

## Evidence Review

### Survey basis

This note builds on the host-wide `jsonl` survey already recorded in `docs/design/R20_AUTOMATION_CRON_SUBAGENT_SEMANTICS.md`, plus targeted loop-focused sampling from the currently available local roots and the reviewed OpenClaw archive.

### Reviewed sources

| Source root | Evidence reviewed | Loop-related observation |
| --- | --- | --- |
| `~/.codex/history.jsonl` | repeated prompt-history rows | `continue` appears repeatedly; at least `7` reviewed root-history rows match `continue`, with at least `2` session IDs already repeating twice |
| `~/.claude/projects/**/*.jsonl` | transcript-bearing session files | multiple real sessions contain repeated `continue` prompts; at least `3` session IDs currently show `>=2` such prompts |
| `~/.claude/history.jsonl` | root-history prompt log | root history also contains short `continue`-style prompts, but remains secondary evidence rather than transcript truth |
| `~/.local/share/amp/history.jsonl` | root-history prompt log | contains loop-like short prompts such as `continue`, though current host sample is sparse |
| `.realdata/openclaw_backup.tar.gz` | `cron/runs/*.jsonl` plus transcript-bearing session files | standalone cron evidence is extremely high volume; at least `20` job IDs currently have `>=3` records and at least `7` session keys currently have `>=3` records |

### Representative samples

#### Codex root-history repeats

Reviewed `~/.codex/history.jsonl` includes repeated short operator prompts such as:

- `continue`
- `follow the tasks.csv, once a task, allow subagents.`
- `no need to stop, just continue work to finish all tasks`

These are real evidence about operator flow, but they are not transcript-primary by default.

#### Claude transcript repeats

Reviewed `~/.claude/projects/**/*.jsonl` includes repeated `type:"user"` prompts whose content is simply `continue` inside transcript-bearing sessions.

Observed same-session repetition currently reaches `2` in multiple sessions. That is enough to prove the pattern is real, but not enough by itself to justify collapsing every pair of short follow-ups. A threshold higher than `2` remains warranted.

#### AMP root-history repeats

Reviewed `~/.local/share/amp/history.jsonl` includes a short `continue` prompt plus other operator-history lines. The current host sample is not large, but it confirms that loop-like secondary evidence is not limited to Codex or Claude.

#### OpenClaw standalone cron evidence

Reviewed archive `cron/runs/*.jsonl` contains repeated records keyed by cron job and run session. Representative sample fields include:

- `jobId`
- `sessionId`
- `sessionKey`
- `status`
- `summary`
- `runAtMs`
- `durationMs`

Observed archive prevalence is high enough that any loop-control rule must explicitly handle automation families, not just repeated `continue` strings:

- top reviewed job counts include `4834`, `984`, `974`, `553`, and `382` records for single job IDs;
- at least `20` job IDs currently exceed `>=3` records;
- at least `7` session keys currently exceed `>=3` records.

This is strong evidence that `>=3` is common for automation families and should remain a meaningful lower bound for grouping or ranking demotion.

## Family-Wide Conclusions

### Conclusion 1: loop pressure is cross-agent

Repeated low-information traffic appears in Codex, Claude, AMP, and OpenClaw. The storage shape differs by source, but the product problem is family-wide.

### Conclusion 2: transcript-primary and secondary-evidence loops must stay distinct

Two different evidence classes are involved:

1. transcript-primary repeated turns, which remain real `UserTurn` objects and may need grouping or ranking demotion;
2. secondary-evidence-only loop traces, such as root-history logs or standalone cron-run records, which influence prevalence and diagnostics but must not create new canonical turns.

### Conclusion 3: `>=2` is too aggressive; `>=3` remains the right baseline

The current reviewed transcript-bearing session evidence already shows repeated pairs of `continue`, but not a reliable basis for collapsing every pair.

By contrast, reviewed OpenClaw automation families produce very large repeated spans. The evidence supports keeping `>=3` as the default lower bound for loop-span detection, with extra guards so ordinary short follow-ups do not get demoted accidentally.

## Canonical Rule Proposal

### Definitions

#### Loop-like turn

A loop-like turn is a canonical `UserTurn` that is low-information and operationally repetitive rather than project-substantive.

Initial families justified by reviewed evidence:

- automation-triggered turns (`origin_kind === automation_trigger`)
- delegated subagent instructions (`origin_kind === delegated_instruction`)
- short operator loop prompts whose normalized canonical text is a reviewed low-information control phrase such as `continue` or `/loop`

#### Loop-like span

A loop-like span is a contiguous sequence of `>=3` loop-like turns that satisfies all of the following guards:

1. **same session** by default;
2. **same loop family**, for example cron-trigger, delegated-subagent, or short operator-control prompt;
3. **near-identical normalized text** or an equivalent family key such as cron `jobId`, cron marker prefix, or exact low-information control phrase;
4. **no intervening non-loop human-authored substantive turn**.

#### Secondary-evidence loop trace

A secondary-evidence loop trace is a reviewed repeated pattern found in non-transcript-primary evidence such as root `history.jsonl` or standalone `cron/runs/*.jsonl`.

These traces are real and useful, but they are not canonical turn spans.

### Recommended default rule

Use the following default decision rule for `R21` implementation:

1. Detect loop-like spans only from canonical turn sequences, not from root-history or standalone cron evidence directly.
2. Require `>=3` contiguous loop-like turns within the same session.
3. Require same-family plus near-identical text or explicit automation key.
4. Treat root-history and other secondary-evidence loop traces as prevalence inputs, diagnostics, and future ranking hints only.

### Why same-session is the default boundary

The reviewed evidence currently proves repeated low-information prompts within one session much more reliably than repeated low-information prompts across a whole project.

Project-wide grouping can remain a later refinement, but the default implementation should not merge non-adjacent or cross-session turns into one loop span. Cross-session data may still inform ranking or diagnostics, but not default collapse.

### Why same-family is required

Without a same-family guard, the product could incorrectly collapse:

- a cron-trigger prompt,
- a delegated subagent instruction,
- and a genuine human follow-up,

simply because they all contain short text. That would violate the frozen `UserTurn`-first model.

### Why text similarity is required

The reviewed evidence includes both repeated one-word prompts and longer scheduler instructions. A same-family guard alone is not enough. The grouping key must also consider exact or near-identical normalized text, or an explicit automation key such as cron `jobId` / marker.

## Secondary-Evidence Policy For Loop Review

### Root-history logs

Root-history logs from Claude, Codex, and AMP should:

- contribute to prevalence analysis;
- justify fixture coverage for reviewed loop families;
- optionally feed admin diagnostics or future source-health views;
- never create canonical `UserTurn` records solely for loop grouping.

### Standalone OpenClaw cron runs

Standalone `cron/runs/*.jsonl` records should:

- prove that automation-family repetition is real and high-volume;
- remain inspectable through source payloads, pipeline admin surfaces, and lineage-like evidence views;
- optionally feed per-source or per-project diagnostic summaries later;
- not themselves become grouped `UserTurn` spans.

### Consequence

`R21` must distinguish **prevalence influence** from **canonical grouping eligibility**.

Secondary evidence may help answer whether a loop family is common and whether certain ranking defaults are justified, but the actual grouped span should still come from transcript-primary turns only.

## Projection Output Recommendation

Loop control should be projection-layer behavior, not evidence mutation.

### Recommended output shape

A future implementation should prefer stable metadata such as:

- `loop_group_id`
- `loop_family`
- `loop_position`
- `loop_span_size`
- `loop_confidence`
- `loop_visibility` or equivalent display/ranking hint

### Recommended default behaviors

For default project feeds and search:

- keep the first loop-like turn visible;
- collapse or demote the middle repeated items of the same loop span;
- keep the final or latest item visible when it carries the newest status;
- expose an explicit drill-down affordance to inspect the full span.

For drill-down and lineage:

- keep every underlying `UserTurn`, atom, fragment, record, and blob inspectable;
- do not hide or delete loop members from admin or evidence views.

For secondary evidence:

- surface it through diagnostics, source payload reconstruction, or evidence drill-down;
- do not display it as if it were a collapsed canonical turn group.

## Fixture Matrix For Phase 2

The reviewed evidence justifies the following loop-heavy fixture matrix.

| Scenario | Source | Transcript-primary | Purpose |
| --- | --- | --- | --- |
| same-session repeated `continue` prompts reaching `>=3` | Claude or Codex transcript fixture | Yes | prove `>=3` threshold groups low-information operator turns while leaving real turns intact |
| repeated `/loop`-style operator prompts | transcript fixture | Yes | prove slash-command loop family is handled separately from substantive prompts |
| mixed sequence of two automation-like turns followed by one substantive human prompt | transcript fixture | Yes | prove the system does not over-collapse pairs or mixed spans |
| mixed sequence of `>=3` low-information loop turns followed by one substantive human prompt | transcript fixture | Yes | prove only the loop prefix is de-emphasized |
| OpenClaw main-session repeated cron-trigger prompts keyed by same cron marker | OpenClaw transcript fixture | Yes | prove same-family automation spans can be grouped without inventing human intent |
| OpenClaw standalone `cron/runs/*.jsonl` repeated records for one `jobId` / `sessionKey` | OpenClaw secondary evidence | No | prove prevalence and diagnostics can see automation floods without creating canonical turns |
| Codex root-history repeated `continue` prompts for one session id | Codex secondary evidence | No | prove root-history repetition informs prevalence only |
| Claude root-history repeated `continue` prompts plus transcript session with real human turn nearby | Claude mixed evidence | Mixed | prove secondary evidence does not leak into canonical grouping |
| AMP root-history repeated short prompts | AMP secondary evidence | No | preserve family-wide prevalence coverage even when transcript-primary sample is sparse |

### Fixture-authoring note

Some currently reviewed transcript sessions show repeated pairs more clearly than repeated triples. For those families, a sanitized fixture may extend the reviewed pattern from `2` to `3` repeated low-information prompts, as long as it preserves the reviewed shape and does not invent a different family behavior.

## Recommended Next Tasks

1. stage the loop-heavy fixture matrix in `mock_data/`;
2. validate `mock_data/scenarios.json` coverage for transcript-primary versus secondary-evidence loop cases;
3. implement loop-span metadata in the chosen projection layer;
4. add regressions proving search/feed demotion without evidence loss.


## Implementation-Layer Follow-Up

A project-wide KR sweep on 2026-04-02 selects the presentation/projection layer as the first implementation slice for `R21-KR3`. This keeps loop handling in default recall/search projections without mutating evidence, storage, or canonical turn derivation rules. A later slice can push the same metadata deeper only if profiling or cross-surface duplication proves that the presentation layer is too narrow.


## 2026-04-02 Phase 7 Holistic Evaluation

- **Boundary evaluation**: the first implementation slice stays in `packages/presentation` plus web query wiring, so it does not mutate capture, storage, canonical turn derivation, or evidence-preserving lineage layers.
- **Stability assessment**: loop detection is conservative and linear over the returned projection arrays; non-loop turns, empty arrays, and cross-session repeats remain unchanged because grouping requires `>=3` contiguous turns with the same session, family, and normalized text key.
- **Scalability evaluation**: the slice adds one pass for annotation plus a stable rank sort over already-fetched result sets, which is acceptable for feed/search projection sizes and does not introduce schema work or background recomputation.
- **Compatibility assessment**: no schema migration or stored-data rewrite is required because loop metadata is derived at projection time only.
- **Security evaluation**: the slice does not add new external input vectors; it only derives metadata from already-captured canonical text and injected-message flags.
- **Maintainability assessment**: the implementation follows the existing presentation-mapper pattern by keeping single-item mapping unchanged and adding batch mappers only where multi-turn context is required.

### Accepted limitation

This first slice only detects two conservative loop families with currently available projection data: operator-control phrases (`continue`, `/loop`) and fully injected repeated messages. Richer cross-agent delegated-task semantics, explicit automation keys, and parent-task/session modeling remain future work and are now tracked under `R23`.
