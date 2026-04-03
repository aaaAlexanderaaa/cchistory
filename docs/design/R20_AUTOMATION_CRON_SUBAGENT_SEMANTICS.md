# R20 Automation, Cron, And Subagent Secondary-Evidence Semantics

## Status

- Objective: `R20 - Automation, Cron, And Subagent Secondary-Evidence Semantics`
- Date: 2026-04-02
- Scope: host-wide real-data survey plus canonical design decisions for automation-triggered, delegated, and sidechain evidence in Family A local coding-agent logs
- Outcome: this note established the reviewed evidence classes and canonical treatment that were then implemented under `R20`, classifying them into `UserTurn`, `TurnContext` / source-meta, or secondary-evidence-only storage

## Problem Statement

The current system treats too many user-shaped records as if they were ordinary human-authored `UserTurn` anchors.

That is no longer truthful once real local data is reviewed across multiple agent roots. The problem is broader than one adapter:

- OpenClaw can place cron-triggered and subagent-shaped prompts inside main session JSONL while also writing standalone cron-run JSONL outside transcript roots.
- Claude stores dedicated `subagents/*.jsonl` sidechain sessions with explicit linkage fields such as `isSidechain`, `agentId`, `sessionId`, and `parentUuid`.
- Codex and AMP both show loop-like repeated user prompts in real local history, even when they do not expose the same explicit sidechain markers as Claude.
- Claude and Codex also maintain root-level `history.jsonl` files that look user-like but are not the canonical transcript source for the product.

The frozen design requires `UserTurn` to stay user-intent-first, one-session-scoped, and traceable to raw evidence. Delegated subagent work, cron triggers, and loop traffic must therefore be classified explicitly instead of being flattened into ordinary user-authored turns.

## Host-Wide Real-Data Survey

### Survey method

The host-wide survey used `fd -HI -e jsonl ~` and targeted inspection of currently available local agent roots plus the reviewed OpenClaw archive.

### Roots observed on this host

| Root | Observed JSONL evidence | Notes |
| --- | --- | --- |
| `~/.claude` | `262` JSONL files | Includes main session JSONL, root `history.jsonl`, and many `subagents/*.jsonl` sidechain sessions |
| `~/.codex` | `166` JSONL files | Includes root `history.jsonl` and many transcript-bearing `sessions/**/*.jsonl` |
| `~/.local/share/amp` | `1` JSONL file | Root `history.jsonl`; current adapter still reads thread JSON under `threads/` |
| `~/.gemini` | `0` JSONL files on this host | No current JSONL evidence here on this machine |
| `.realdata/openclaw_backup.tar.gz` | reviewed archive | Includes transcript-bearing `agents/*/sessions/*.jsonl` plus standalone `cron/runs/*.jsonl` |

### Cross-agent evidence patterns

| Pattern | Claude | Codex | AMP | OpenClaw | Canonical implication |
| --- | --- | --- | --- | --- | --- |
| Dedicated subagent / sidechain session files | Yes | Not observed in current host data | Not observed | Not observed as separate root; subagent prompt appears inside main session | Delegated work is a family-wide concern, but explicit storage shape is source-specific |
| Root-level history JSONL outside transcript roots | Yes | Yes | Yes | Not observed in reviewed archive | History-like files are real evidence, but not automatically transcript-bearing |
| Repeated continue / loop-like user prompts | Yes in history and session flows | Yes | Yes | Yes via cron-like repeated prompts | Loop de-emphasis must be cross-agent, not OpenClaw-only |
| Explicit cron run records outside session transcript path | Not observed | Not observed | Not observed | Yes | Cron-run capture is source-specific, but automation metadata as a concept is family-wide |
| Explicit parent linkage fields | `parentUuid`, `parentId`, `isSidechain`, `agentId`, `sessionId` | Not observed in current sample | Not observed in current sample | `jobId`, `sessionId`, `sessionKey` in cron runs; subagent prompt text in session | Parent linkage must be explicit when present and partial when absent |

## Reviewed Evidence Inventory

### 1. Claude

#### Main-session evidence

- Real files exist under `~/.claude/projects/.../*.jsonl`.
- Current parser already emits `session_relation` fragments when `parentUuid`, `parentId`, or `isSidechain` appears.
- Root `~/.claude/history.jsonl` records slash commands and prompt history such as `/plugin`, `/plan`, `/resume`, and free-form prompts.

#### Subagent evidence

- Real files exist under `~/.claude/projects/.../subagents/*.jsonl`.
- Sample reviewed on this host contains:
  - `isSidechain: true`
  - `agentId`
  - `sessionId`
  - `parentUuid`
  - `type: "user"` with a delegated task payload
- This is explicit evidence that delegated subagent work is not merely a display convention inside one session; it can be a distinct sidechain session.

### 2. Codex

- Real transcript-bearing files exist under `~/.codex/sessions/**/*.jsonl`.
- Real root `~/.codex/history.jsonl` captures prompt-history records such as repeated `continue`, `follow the tasks.csv, once a task, allow subagents.`, and similar operator instructions.
- Current adapter base candidate is `~/.codex/sessions`, so root `history.jsonl` is not currently part of capture scope.
- The host survey confirms loop-like repeated prompts are not unique to OpenClaw cron flows.

### 3. AMP

- Real root `~/.local/share/amp/history.jsonl` exists on this host.
- Sample includes repeated short prompts such as `continue` and command-like follow-ups.
- Current adapter base candidate is `~/.local/share/amp/threads`, so the root `history.jsonl` is also outside current capture scope.
- This is another example of user-like history evidence that should not be assumed to be transcript-primary.

### 4. OpenClaw

#### Main-session evidence from reviewed archive

- Reviewed archive: `.realdata/openclaw_backup.tar.gz`
- Transcript-bearing files exist under `agents/main/sessions/*.jsonl`.
- Real samples contain:
  - `[cron:...]` prompts currently stored as `role:user` messages in the main session
  - `[Subagent Context] ...` prompts that also look like ordinary user messages if parsed naively

#### Standalone cron evidence from reviewed archive

- Reviewed archive contains `cron/runs/*.jsonl` outside `agents/main/sessions/`.
- Sample records include fields such as `jobId`, `status`, `summary`, `sessionId`, `sessionKey`, and `runAtMs`.
- Current adapter capture scope misses these files because `packages/source-adapters/src/platforms/openclaw.ts` only matches `.jsonl` whose parent directory basename is `sessions`.

## Canonical Classification Decisions

### Decision 1: Human-authored `UserTurn` anchors remain narrow

A canonical `UserTurn` anchor remains limited to human-authored user input.

Implications:

- Records that are merely user-shaped are not automatically `user_authored`.
- Delegated instructions from a main agent to a subagent are not human-authored simply because they appear under `role:user` in upstream logs.
- Cron trigger prompts are not human-authored even when they are written into a transcript as a user-role message.

### Decision 2: Delegated and cron-triggered inputs are not canonical `UserTurn` anchors by default

Delegated subagent prompts and cron-triggered prompts should default to secondary evidence or source-meta classification unless reviewed source semantics prove they contain direct human input.

Implications:

- A dedicated sidechain session can exist without contributing a canonical `UserTurn` if its only anchor is delegated or automated instruction.
- Main-session prompts prefixed by patterns such as `[cron:...]` or `[Subagent Context]` should not stay `user_authored` by default.
- These records remain captured, traceable, and displayable, but not first-class recall anchors.

### Decision 3: History JSONL is evidence, not transcript-primary by default

Root-level `history.jsonl` files in Claude, Codex, and AMP are real evidence, but they should not become canonical turn sources by default.

Implications:

- They can support diagnostics, prevalence review, operator-history inspection, and loop analysis.
- They should not independently create duplicate `UserTurn` objects when transcript-bearing session files already exist.
- Capture-scope expansion for history JSONL should be motivated by explicit admin or analysis use, not by turn derivation needs alone.

### Decision 4: Parent linkage must be explicit, partial, and non-inferential

Parent linkage between delegated work and main-agent work should only use fields the source actually provides.

Implications:

- Claude sidechain sessions can link through `parentUuid`, `parentId`, `sessionId`, and `agentId`.
- OpenClaw cron runs can link through fields such as `jobId`, `sessionId`, and `sessionKey` when present.
- If only partial linkage exists, the system should preserve the partial relation instead of inventing a complete parent graph.
- No cross-session turn merge is allowed.

### Decision 5: Loop control belongs in projections, not evidence deletion

Repeated automation traffic is a cross-agent projection problem, not a reason to delete or rewrite evidence.

Implications:

- Evidence stays in raw blobs, records, fragments, and inspectable context.
- Loop de-emphasis should happen through turn classification, ranking, grouping, masks, or projection metadata.
- `R21` owns the threshold and ranking behavior; `R20` only establishes which reviewed records are automation-like in the first place.

## Proposed Canonical Mapping

| Evidence class | Transcript-bearing | Default canonical treatment | Why |
| --- | --- | --- | --- |
| Human-authored main-session prompt | Yes | `UserTurn` anchor | Matches frozen `UserTurn` model |
| Injected user-shaped submission scaffolding attached to a real human submission | Yes | `injected_user_shaped` inside same `UserTurn` | Already consistent with frozen builder responsibilities |
| Dedicated subagent instruction in sidechain session | Usually yes at raw transcript level | Secondary evidence / delegated instruction, not `UserTurn` anchor by default | Not human-authored; should stay traceable without polluting recall |
| Cron trigger prompt embedded in main session | Yes at raw transcript level | Secondary evidence / automation trigger, not `UserTurn` anchor by default | Trigger metadata, not direct human intent |
| Standalone cron run record outside session transcript root | No user transcript | Secondary evidence companion artifact | Valuable lineage/admin evidence but not a user submission |
| Root history JSONL prompt index | No canonical transcript guarantee | Secondary evidence only | May duplicate turns or record slash-command history rather than session truth |
| Assistant/tool output inside subagent or cron flows | Yes | `TurnContext` or context-side evidence only | Still context, not user intent anchor |

## Domain And Parser Implications

### Current strengths

The current domain already has useful building blocks:

- `FragmentKind` includes `session_relation`.
- `OriginKind` already distinguishes `user_authored`, `injected_user_shaped`, and `source_meta`.
- `TurnContextProjection` keeps `raw_event_refs` for traceability.
- The builder already excludes some source-meta records from user-turn anchors.

### Current gaps

The current model does not yet have a first-class origin for delegated or automation-triggered user-shaped records.

Consequences:

- `isUserTurnAtom()` currently treats any user text atom with origin `user_authored` or `injected_user_shaped` as a valid turn anchor.
- If an upstream parser emits delegated or cron-triggered text as `user_authored`, the builder will incorrectly produce canonical turns from it.
- `session_relation` is present as low-level evidence, but higher-level parent-task semantics are not yet surfaced.

### Recommended additions

The implementation slice should add an explicit origin classification for automation/delegation rather than overloading `user_authored`.

Candidate direction:

- add one or both of:
  - `delegated_instruction`
  - `automation_trigger`
- ensure `isUserTurnAtom()` excludes those origins
- preserve those atoms as traceable evidence with visible but non-anchor display behavior

This keeps frozen semantics intact without inventing a new top-level canonical object too early.

## Parent-Link Semantics

### Rules

1. A relation may connect sessions, tasks, or automation runs, but it must never rewrite turn boundaries.
2. Relation strength depends on source-native fields, not on prompt-text heuristics.
3. Missing lineage remains missing; the system should preserve unresolved links instead of guessing.

### Parent-link treatment by source

| Source | Explicit fields seen | Recommended relation treatment |
| --- | --- | --- |
| Claude | `parentUuid`, `parentId`, `isSidechain`, `agentId`, `sessionId` | Preserve as session/task relation evidence; allow delegated sidechain session to point back to parent session/task explicitly |
| OpenClaw cron runs | `jobId`, `sessionId`, `sessionKey`, `status`, `summary`, `runAtMs` | Preserve as automation-run evidence linked to main task/session when identifiers line up |
| OpenClaw subagent-shaped main-session prompts | Prompt-text marker only in reviewed sample | Preserve as automation/delegation evidence, but do not fabricate a parent graph beyond what source metadata can support |
| Codex history/session samples | No explicit subagent relation observed in current host survey | No parent relation inference from repeated prompt text alone |
| AMP history sample | No explicit relation fields observed | No parent relation inference from history-only prompts |

## Fixture Matrix For Phase 2

| Scenario | Source | Transcript-bearing | Coverage intent |
| --- | --- | --- | --- |
| Human main-session prompt plus injected user-shaped helper text | existing multi-source baselines | Yes | Preserve current valid builder behavior |
| Claude sidechain subagent session with `isSidechain` and `parentUuid` | Claude | Yes | Prove dedicated delegated session is not flattened into ordinary human `UserTurn` |
| Claude root `history.jsonl` slash-command records | Claude | No | Prove history evidence is not treated as transcript-primary |
| Codex repeated `continue` prompts plus root `history.jsonl` duplicate signal | Codex | Mixed | Prove loop prevalence review can use real evidence without duplicate turn creation |
| AMP root `history.jsonl` repeated `continue` prompt | AMP | No | Prove history-only prompts remain secondary evidence |
| OpenClaw main-session `[cron:...]` prompt | OpenClaw | Yes | Prove automation trigger inside transcript does not become ordinary human turn |
| OpenClaw main-session `[Subagent Context]` prompt | OpenClaw | Yes | Prove delegated prompt inside transcript does not become ordinary human turn |
| OpenClaw standalone `cron/runs/*.jsonl` record | OpenClaw | No | Prove companion automation evidence enters capture scope without pretending to be a transcript |

## Implementation Surfaces

### Package and file surfaces most likely to change

- `packages/domain/src/index.ts`
  - origin or fragment classification enums for delegated / automation evidence
- `packages/source-adapters/src/platforms/openclaw.ts`
  - capture scope for `cron/runs/*.jsonl`
- `packages/source-adapters/src/platforms/claude-code/runtime.ts`
  - preserve sidechain fields while reclassifying delegated prompts
- `packages/source-adapters/src/platforms/codex.ts`
  - evaluate whether root `history.jsonl` should remain out of default capture or enter as evidence-only later
- `packages/source-adapters/src/platforms/amp.ts`
  - same evidence-only evaluation for root `history.jsonl`
- `packages/source-adapters/src/core/legacy.ts`
  - turn-anchor eligibility, atom origin mapping, relation handling, and context building
- `packages/storage/*`
  - persist any new origin kinds or relation metadata
- `packages/presentation/*`, `apps/api/*`, `apps/cli/*`, `apps/web/*`
  - expose delegated / automation evidence clearly without presenting it as normal recall-first turns

### Regression surfaces required before rollout

- `packages/source-adapters/src/index.test.ts`
  - source-specific classification and capture-scope tests
- `packages/storage/src/index.test.ts`
  - traceability and persistence of new relation/origin metadata
- `apps/cli/src/index.test.ts`
  - recall/search behavior does not elevate automation-only records into ordinary turns
- `apps/api/src/app.test.ts`
  - API preserves inspectable relations and context evidence
- `pnpm run mock-data:validate`
  - fixture corpus remains structurally valid after new scenarios land

## Acceptance Criteria For The Delivered R20 Slice

The delivered `R20` slice had to satisfy all of the following conditions:

1. Reviewed delegated and cron-triggered records no longer default to `user_authored` turn anchors when they are not human-authored.
2. OpenClaw standalone `cron/runs/*.jsonl` enters capture scope as evidence-only companion data.
3. Claude sidechain linkage remains explicit and inspectable.
4. Root history JSONL does not create duplicate canonical turns by default.
5. Traceability remains intact through raw refs, fragments, relations, and context inspection.
6. `R21` can consume the resulting automation classification for loop/flood control without deleting evidence.

## Non-Goals

- No cross-session turn merge.
- No inferred intent layer for automation prompts.
- No deletion of raw automation evidence to improve UI readability.
- No claim that every agent family exposes subagents or cron in the same on-disk shape.

## Result

The real-data review now supports a family-wide conclusion: automation, delegated subagent work, sidechain sessions, and repeated loop prompts are not OpenClaw-only anomalies. They are recurring evidence classes across the available Family A agent roots, but each source stores them differently.

`R20` should therefore implement one canonical semantic rule set with source-specific capture and relation adapters, not one OpenClaw-only patch. `R21` should build on this classification for loop de-emphasis, and `R22` should validate the resulting operator experience across CLI, API, TUI, and manual web review.
