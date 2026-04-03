# R23 - Canonical Delegation Graph For Subagent And Automation Sessions

- Date: 2026-04-02
- Objective: `R23 - Canonical Delegation Graph For Subagent And Automation Sessions`
- Scope: real-data evidence survey plus current canonical-model gap inventory for delegated subagent work and scheduled automation runs

## Problem Statement

The roadmap now explicitly calls out a cross-agent gap: delegated/subagent work and scheduled automation runs are not ordinary human-authored `UserTurn` input, but the repository still lacks one canonical graph for relating parent work, child sessions, scheduled runs, and evidence-only companions. The current host already contains real examples across multiple supported agents, so the next design slice must be grounded in those real storage shapes rather than inferred from one adapter or one fixture family.

## Reviewed Real-Data Inventory

The audit used the current host's real roots and reviewed archive material.

| Platform | Reviewed root | Observed storage | Delegated child session evidence | Scheduled / automation evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `~/.claude` | project JSONL + `subagents/*.jsonl` | Yes, dedicated sidechain JSONL files | Indirect only in repeated prompts / plugin content, not as a dedicated run root in this review | richest explicit sidechain linkage on this host |
| Codex | `~/.codex` | `history.jsonl` + session JSONL | No dedicated child-session file observed in current root | yes as repeated prompt-history evidence (`continue`, delegated instructions), but not as a dedicated run table/root | delegation mostly visible as text/history evidence in this review |
| AMP | `~/.local/share/amp` | `history.jsonl` + JSON sidecars | No dedicated child-session root observed | yes as prompt-history evidence only | extremely thin structure on this host |
| Factory Droid | `~/.factory` | session JSONL + JSON sidecars | Yes, transcript-bearing subagent sessions with parent linkage fields | no dedicated cron-run root observed in this review | explicit child-session lineage via session metadata |
| OpenCode | `~/.local/share/opencode` | SQLite (`session`, `message`, `part`) + empty `session_diff/*.json` snapshots | Yes, first-class child sessions via `session.parent_id` | no dedicated scheduled-run table/root observed in this review | parent linkage is stored structurally, not in JSONL |
| OpenClaw | `.realdata/openclaw_backup.tar.gz` | transcript session JSONL + `cron/runs/*.jsonl` | No dedicated child-subagent root observed in the reviewed archive | Yes, explicit standalone cron-run records with `jobId`, `sessionId`, `sessionKey` | automation evidence is explicit and evidence-only |

Current host scan did not find live real-data roots for Cursor or LobeChat beyond repository mock data, so they are out of scope for this review pass.

## Platform Findings

### Claude Code

Real files exist under `~/.claude/projects/.../subagents/*.jsonl`.

Observed sample fields in a real subagent file:

- `isSidechain: true`
- `agentId`
- `sessionId`
- `parentUuid`
- `cwd`
- `timestamp`

The sampled first user message is an explicit delegated task payload, not an ordinary human turn inside the main transcript. This is transcript-primary child-session evidence. The relation is rich but source-specific:

- `sessionId` ties the sidechain file to the parent Claude session namespace;
- `agentId` identifies the child agent instance;
- `parentUuid` ties child events back to a specific parent event/tool lineage.

Conclusion: Claude exposes a real parent-session plus child-sidechain structure, and any canonical model must preserve both the child session and the linkage fields instead of flattening them into standard `UserTurn` traffic.

### Codex

Real data exists under `~/.codex/history.jsonl` and `~/.codex/sessions/**/*.jsonl`.

Observed history fields:

- `session_id`
- `ts`
- `text`

Real prompt-history lines include examples such as:

- `follow the tasks.csv, once a task, allow subagents.`
- repeated `continue`

The sampled session JSONL uses event envelopes such as `session_meta`, `response_item`, and `event_msg`, but this review did not find an explicit child-session or scheduled-run linkage field comparable to Claude's `parentUuid` or OpenCode's `parent_id`.

Conclusion: on this host, Codex currently provides real delegation/automation evidence mainly through transcript-adjacent prompt-history and repeated control prompts, not through a first-class child-session graph. This is still important evidence, but it is weaker than Claude/OpenCode/Factory in terms of structural lineage.

### AMP

Real data exists under `~/.local/share/amp/history.jsonl`.

Observed fields:

- `text`
- `cwd`

The reviewed root contains prompt-history evidence only. It does not expose dedicated child-session or scheduled-run structures in this pass.

Conclusion: AMP contributes prevalence evidence for delegated or automation-shaped prompts, but not a structural parent/child session graph on this host.

### Factory Droid

Real data exists under `~/.factory/sessions/**/*.jsonl`.

Observed sample fields in a real child session:

- `type: "session_start"`
- `callingSessionId`
- `callingToolUseId`
- `cwd`
- subsequent `message` records with `parentId`

One sampled title is explicitly subagent-shaped:

- `# Task Tool Invocation Subagent type: worker ...`

This is transcript-bearing delegated work, not merely evidence-only prompt history. The real root provides both:

- a child session identity; and
- direct parent linkage back to the invoking session/tool.

Conclusion: Factory Droid belongs in the same structural family as Claude and OpenCode for R23 purposes, even though the exact field names differ.

### OpenCode

Real data exists under `~/.local/share/opencode/opencode.db` plus `storage/session_diff/*.json` snapshots.

Observed schema and sample values:

- `session.parent_id` is a first-class DB column
- child session sample title: `review changes [commit|branch|pr], defaults to uncommitted (@build subagent)`
- child session sample message blob contains `{"role":"user", ..., "agent":"build", ...}`
- sampled `part` blob contains the delegated prompt text payload
- sampled `storage/session_diff/*.json` snapshots are empty arrays in this review

Conclusion: OpenCode stores delegated child sessions structurally in SQLite. The parent-child relation is stronger and more canonical than text-only evidence, but current repository projections still need a cross-source abstraction that can treat this as the same concept as Claude sidechains or Factory subagent sessions.

### OpenClaw

A reviewed real archive exists at `.realdata/openclaw_backup.tar.gz`.

Observed transcript-bearing session path:

- `./agents/main/sessions/*.jsonl`

Observed standalone automation path:

- `./cron/runs/*.jsonl`

Observed cron-run fields:

- `jobId`
- `sessionId`
- `sessionKey`
- `status`
- timing and usage fields

This review did not find a dedicated child-subagent session root in the archive, but it did confirm explicit scheduled automation records outside the main transcript path.

Conclusion: OpenClaw's reviewed automation lineage is explicit but evidence-only. It links a run back to session space with `sessionId`/`sessionKey`, yet it should not be treated as a canonical child user session by default.

## Cross-Platform Evidence Classes

The reviewed roots separate into three real classes.

### 1. Transcript-primary delegated child sessions

These should be modeled as real child work units, not as ordinary human `UserTurn` content:

- Claude Code `subagents/*.jsonl`
- Factory Droid child session JSONL with `callingSessionId` / `callingToolUseId`
- OpenCode child sessions via `session.parent_id`

### 2. Transcript-adjacent delegation or automation prompts without explicit child-session structure

These are still real evidence, but the structure is weaker and may only justify secondary-evidence or prevalence handling unless more source-specific linkage is found:

- Codex `history.jsonl`
- AMP `history.jsonl`

### 3. Evidence-only scheduled automation companions

These are real and linkable, but they are not ordinary user sessions or user turns:

- OpenClaw `cron/runs/*.jsonl`

## Current Canonical-Model Coverage

The repository already has some important building blocks.

### What is already representable

At the capture/parse/evidence layer, the system can already preserve several delegation and automation signals:

- `OriginKind` includes `delegated_instruction` and `automation_trigger` in `packages/domain/src/index.ts`.
- `FragmentKind` includes `session_relation` in `packages/domain/src/index.ts`.
- Claude/generic runtimes preserve `parent_uuid` and `is_sidechain` on `session_relation` fragments.
- OpenClaw runtime preserves `relation_kind: "automation_run"` plus `job_id` / `session_key` on `session_relation` and related source-meta fragments.
- Existing adapter/storage/API tests already assert that delegated and automation evidence remains traceable instead of being promoted to ordinary recall-first turns.

This means R23 does not start from zero. The evidence-preserving substrate exists.

## Current Gaps Blocking A Truthful Canonical Graph

Despite the evidence-layer progress, the current canonical model is still incomplete for parent/child work relationships.

### Gap 1: no first-class delegation graph object

The current repository stores parent/session/run linkage mostly inside untyped fragment payload maps. There is no first-class domain object for:

- parent task or parent session node
- child delegated session node
- scheduled automation run node
- normalized edge semantics between them

### Gap 2: session projections do not surface parent linkage

`SessionProjectionDto` currently exposes only flat session metadata such as `id`, `source_id`, `source_platform`, timestamps, title, and turn count. It does not expose parent session/task linkage, child-session counts, sidechain markers, run ids, or automation relation summaries.

### Gap 3: `UserTurn` remains the only recall-first object

This is correct for the frozen design, but it means transcript-primary child sessions and evidence-only automation runs currently have no canonical operator-facing graph of their own. They can be preserved in lineage/admin evidence, yet they are hard to traverse as related work from the parent operator flow.

### Gap 4: source-specific linkage fields are not normalized

The reviewed roots use incompatible field sets:

- Claude: `parentUuid`, `agentId`, `isSidechain`
- Factory Droid: `callingSessionId`, `callingToolUseId`, `parentId`
- OpenCode: `session.parent_id`, message `agent`
- OpenClaw: `jobId`, `sessionId`, `sessionKey`

The current code preserves many of these as raw payload fields, but there is no typed cross-source contract for concepts such as:

- `parent_session_ref`
- `parent_event_ref` or `parent_tool_ref`
- `child_agent_key`
- `delegation_kind`
- `automation_job_ref`
- `automation_run_ref`
- `relation_confidence`

### Gap 5: transcript-primary child work and evidence-only automation runs need different treatment

The review confirms that these two classes are not the same:

- Claude/Factory/OpenCode child sessions are transcript-primary delegated work.
- OpenClaw cron runs are evidence-only automation companions.

A future canonical graph must preserve both, but it must not force them into one UI or storage behavior. Child sessions can plausibly become navigable related-work nodes; automation runs may remain evidence/admin-first unless explicitly promoted by design.

## Immediate Consequences For R23

The next design slice must answer three concrete questions:

1. What is the typed canonical relation contract that normalizes Claude/Factory/OpenCode/OpenClaw linkage without erasing raw source details?
2. Which related-work nodes deserve first-class projection surfaces (`child session`, `delegated task`, `automation run`) versus remaining evidence-only?
3. How should operator workflows move from a parent turn/session to related child work without violating the design freeze's `UserTurn`-first browsing model?

## Recommended Backlog Outcome

This review was sufficient to close the evidence-survey portion of `R23-KR1` and promote the following design task sequence that was later delivered under the remaining `R23` KRs.

Historical execution order:

1. design the canonical representation for delegated work, scheduled triggers, and parent linkage;
2. decide operator-visible navigation and drill-down behavior for child sessions versus evidence-only automation runs;
3. then define fixture and regression scope around that chosen model.


## KR2 Design Slice - Canonical Representation Decision

### Problem Statement

The reviewed roots prove that delegated work and automation runs are real, but they do not expose one uniform upstream object. Some platforms store transcript-primary child sessions (Claude, Factory Droid, OpenCode), while others provide only weaker prompt-history hints (Codex, AMP) or evidence-only run records (OpenClaw cron). The design problem for this slice was therefore to introduce a canonical representation that preserves real linkage without inventing a fake universal upstream `task` object.

### Multi-Lens Review

#### Lens A - System Consistency

The design freeze requires project-first history, `UserTurn` as the primary browsing/search object, no cross-session turn merging, and evidence-preserving derivation. That rules out flattening child sessions into ordinary `UserTurn` input and also argues against pretending every source exposes a stable task object. The safest consistent move is to keep `UserTurn` primary, keep sessions as real transcript containers where they truly exist, and add a typed secondary relation layer for related work.

#### Lens B - User Experience

Operators want to answer: "what child work did this parent flow spawn?" and "is this thing a real child session or just an automation run record?" A good model therefore needs explicit distinction between transcript-primary child sessions and evidence-only automation runs. If the model hides that distinction, users will either over-trust automation records as if they were conversations or lose the ability to navigate from parent workflow to delegated work.

#### Lens C - Engineering Cost

Inventing a new fully generic `Task` domain object now would be costly and speculative because the reviewed roots expose parent event ids, child session ids, agent ids, and cron job/run ids, but not one stable cross-platform task identity. Reusing existing session storage plus adding a typed relation record and one evidence-only automation companion object is simpler, preserves current ingestion work, and avoids reworking `UserTurn` semantics.

### Synthesis

All three lenses agree on the same path:

1. do **not** introduce a canonical cross-platform `Task` object in this slice;
2. treat transcript-primary delegated work as related child sessions, not as user turns;
3. treat scheduled automation runs as evidence-only companions unless a source truly stores them as transcript-bearing sessions;
4. add a typed secondary relation layer so parent/child links are no longer trapped in ad hoc payload maps.

### Decided Approach

#### 1. Keep `UserTurn` primary

`UserTurn` remains the default history/search object. Delegated and automation relations must not become alternate primary history units.

#### 2. Treat transcript-primary delegated work as child sessions

For sources such as Claude Code, Factory Droid, and OpenCode:

- the child work unit remains a `Session`;
- the parent-child connection becomes a typed derived relation rather than an implicit payload detail;
- delegated prompt text remains evidence and may still derive turns inside the child session, but those turns are not reclassified as parent-session user input.

#### 3. Treat evidence-only automation runs as companion objects, not sessions-by-default

For sources such as OpenClaw `cron/runs/*.jsonl`:

- preserve each run as evidence-derived companion data;
- attach it to the related session/project/source through a typed relation;
- do not require it to masquerade as a zero-turn session in the canonical model.

#### 4. Add a typed relation contract

The implementation that followed this design needed to introduce a typed derived relation layer with enough structure to normalize reviewed sources while retaining raw source details. Concretely, the design called for fields equivalent to:

- `relation_kind`: `delegated_session` | `automation_run` | `history_hint`
- `source_session_ref`
- `target_session_ref?`
- `target_run_ref?`
- `parent_event_ref?`
- `parent_tool_ref?`
- `child_agent_key?`
- `automation_job_ref?`
- `automation_run_key?`
- `transcript_primary`
- `evidence_confidence`
- `source_fragment_refs`
- `raw_detail` for source-specific fields that should remain inspectable

The important constraint is that this contract becomes typed and cross-source, while raw source fields remain preserved alongside it.

#### 5. Bound Codex and AMP to hint-level evidence for now

Codex and AMP should not be forced into fake child-session relations unless a stronger reviewed linkage appears. Their current prompt-history evidence can support:

- prevalence analysis;
- loop/flood control;
- potential hint-level related-work diagnostics.

It should not yet create canonical child-session edges by default.

### Rejected Alternatives

#### Rejected: universal `Task` object now

Rejected because the reviewed roots do not expose one stable cross-platform task identity. Introducing it now would be speculative and would risk violating the freeze's evidence-first rule.

#### Rejected: keep relation data only in untyped fragment payloads

Rejected because the evidence is already rich enough that cross-source parent/child navigation needs a typed layer. Leaving everything in payload maps would keep the most important relation semantics inaccessible to API/presentation layers.

#### Rejected: represent every automation run as a `Session`

Rejected because OpenClaw cron runs are evidence-only companion records in the reviewed archive. Modeling them all as sessions would blur the distinction between transcript-bearing work and non-transcript automation evidence.

### Impact On Existing System

As designed, the resulting implementation slice primarily affected:

- `packages/domain`: add typed relation/companion contracts without changing `UserTurn` primacy;
- `packages/storage`: persist/query derived session relations and automation companions;
- `packages/api-client` and `apps/api`: expose typed related-work summaries or drill-down endpoints;
- `packages/presentation` and read surfaces: project related child-session and automation-run summaries without polluting default history feeds.

### Acceptance Criteria For The Next Implementation Slice

The implementation that follows this design should be considered successful only if:

1. Claude/Factory/OpenCode child sessions remain transcript-primary child work and are navigable as related sessions rather than flattened parent turns.
2. OpenClaw cron runs remain preserved and linkable without being mislabeled as ordinary sessions or user turns.
3. Codex/AMP prompt-history evidence remains available for diagnostics/prevalence without inventing unsupported parent-child edges.
4. API/presentation surfaces can distinguish transcript-primary child sessions from evidence-only automation runs.
5. Raw source identifiers (`parentUuid`, `callingSessionId`, `parent_id`, `jobId`, `sessionKey`, etc.) remain inspectable through lineage/admin evidence paths.


## KR2 Design Slice - Operator Navigation And Regression Scope

### Operator-Visible Navigation Decision

The navigation model should keep default recall/search centered on `UserTurn`, while making related work discoverable at the session and admin layers.

#### History / recall feeds

- Do not inject child-session rows or automation-run rows into default history feeds.
- Allow a compact related-work indicator on parent or child session-owned rows only when typed relation data exists.
- The indicator should summarize counts, not raw source ids, for example: `2 child sessions`, `1 automation run`.

#### Search results

- Do not let related work become separate default search rows unless the matched content itself belongs to that child session's own transcript.
- For a parent-session hit, search may show a compact related-work hint, but the operator must explicitly drill down to inspect related child work.
- Evidence-only automation runs should never appear as if they were ordinary turn hits.

#### Session drill-down

This should be the primary operator surface for related work.

A session detail view should expose a dedicated `Related Work` section with two explicitly separated groups:

1. `Child Sessions` - transcript-primary delegated work
2. `Automation Runs` - evidence-only scheduled companions

Each related entry should surface:

- normalized relation kind
- source platform
- title/label
- timestamps
- relation confidence
- a path to full evidence drill-down

#### Admin / lineage surfaces

Admin and lineage remain the place for full-fidelity identifiers and raw source details. These surfaces should show:

- raw ids such as `parentUuid`, `callingSessionId`, `parent_id`, `jobId`, `sessionKey`
- source fragment refs / record refs
- whether the relation is transcript-primary or evidence-only
- any unresolved ambiguity or confidence downgrade

### Navigation Trade-Offs

- Keeping related work out of default feeds preserves the freeze's `UserTurn`-first UX.
- Using session drill-down as the primary relation surface avoids flooding search/history with child-work metadata.
- Separating `Child Sessions` from `Automation Runs` prevents operators from confusing transcript-bearing delegated work with cron-style evidence.

### Fixture And Regression Scope

The implementation slice that followed this design needed to prove the typed relation layer and surfaces with the following minimum scenarios.

| Scenario | Real source family justified by review | Purpose |
| --- | --- | --- |
| Claude sidechain child session with `parentUuid`, `agentId`, `isSidechain` | Claude Code | prove transcript-primary child sessions project as related sessions, not parent turns |
| Factory child session with `callingSessionId` and `callingToolUseId` | Factory Droid | prove parent tool/session linkage survives normalization |
| OpenCode child session with `session.parent_id` and child `agent` metadata | OpenCode | prove SQLite-backed delegated sessions map into the same canonical relation family |
| OpenClaw cron run with `jobId`, `sessionId`, `sessionKey` | OpenClaw | prove evidence-only automation runs stay linkable without masquerading as sessions/turns |
| Codex prompt-history delegation hints only | Codex | prove hint-level evidence does not invent unsupported child-session edges |
| AMP prompt-history delegation hints only | AMP | prove weak history-only evidence remains diagnostics-only |

### Minimum Regression Surfaces

- `packages/source-adapters`: relation extraction and evidence classification regressions
- `packages/storage`: persistence/query regressions for typed session relations and automation companions
- `apps/api` / `packages/api-client`: DTO and endpoint regressions for related-work summaries and drill-down
- `packages/presentation`: distinction between `child session` and `automation run` in mapped read surfaces
- targeted CLI/TUI/web read-path verification once the projection contract exists

### Backlog Consequence

The design phase was sufficient to open the dedicated implementation KR that later delivered the typed relation layer and related-work read surfaces.
