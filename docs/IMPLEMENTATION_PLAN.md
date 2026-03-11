# Implementation Plan
**Verdict: the implementation baseline is an inspectable, replayable data kernel that turns local conversational evidence into canonical `UserTurn` projections without inheriting `archive/` semantics.**

> The source of truth remains [`HIGH_LEVEL_DESIGN_FREEZE.md`](/root/cchistory/HIGH_LEVEL_DESIGN_FREEZE.md).
>
> `frontend_demo/` remains a reference UI only.
>
> `archive/` remains parser and historical-reference material only.

# Product Frame
**Verdict: the product is project-first recall over canonical `UserTurn` objects, not a session browser and not a source-native log viewer.**

- The primary recall object is `UserTurn`.
- `Session` remains traceability context, not the primary browsing primitive.
- `ProjectIdentity` is linked from evidence and can be `candidate`, `committed`, or remain `unlinked`.
- UI, search, and API must project one canonical model.
- Every final object must remain traceable back to raw local evidence.

# Runtime Shape
**Verdict: the current runtime target is a two-app TypeScript workspace with domain packages that isolate canonical semantics from source-specific parsing.**

| Layer | Role | Status |
| --- | --- | --- |
| `apps/api` | local API, probe runtime, replay runtime, admin endpoints | scaffolded |
| `apps/web` | formal frontend that will replace `frontend_demo` mock data | integrated for turns, projects, linking, search, masks, sources, and drift |
| `packages/domain` | canonical types, stage contracts, ordering and lifecycle contracts | scaffolded |
| `packages/source-adapters` | source-family capture, parse, atomize, candidate derivation | scaffolded |
| `packages/storage` | SQLite metadata/index store and lineage queries | scaffolded |
| `packages/api-client` | shared client for canonical API route contracts consumed by the web app | scaffolded |

# Data Pipeline
**Verdict: the pipeline is fixed as staged transformations, and no source is allowed to map raw input directly to final product objects.**

The fixed object chain is:

`CapturedBlob -> RawRecord -> SourceFragment -> ConversationAtom -> DerivedCandidate -> CanonicalProjection`

| Stage | Input | Output | Purpose |
| --- | --- | --- | --- |
| `capture` | local source files, import bundles | `CapturedBlob` | preserve byte-level provenance and checksums |
| `extract_records` | `CapturedBlob` | `RawRecord` | isolate raw addressable records with offsets or JSON paths |
| `parse_source_fragments` | `RawRecord` | `SourceFragment` | stop source-specific quirks at the parse boundary |
| `atomize` | `SourceFragment` | `ConversationAtom`, `AtomEdge` | produce source-agnostic typed conversation units |
| `derive_candidates` | `ConversationAtom` | `DerivedCandidate` | keep turn, context, project, and display decisions inspectable |
| `finalize_projections` | atoms plus candidates | canonical objects | emit `Session`, `UserTurn`, `TurnContext`, and later `ProjectIdentity` |
| `apply_masks` | canonical display inputs | masked projections | emit `canonical_text` and `display_segments` deterministically |
| `index_projections` | active final objects | search/index docs | support recall and admin diagnostics |

- Every stage run must be versioned.
- Every stage run must be replayable.
- Every stage run must preserve lineage back to raw evidence.
- Unknown or partially supported source structures must generate `LossAuditRecord` output instead of being silently dropped.

# Turn And Context Logic
**Verdict: turn boundaries are owned by submission grouping, so a `user` message is not automatically a new `UserTurn`.**

- `SubmissionGroupCandidate` is the boundary layer between message atoms and `UserTurn`.
- A fresh `UserTurn` opens only when the parser has evidence for a new user submission boundary.
- User-authored follow-up fragments can stay inside the same turn when they are part of the same submission.
- Injected user-shaped content remains separately tagged through `origin_kind`.
- `TurnContext` starts from the chosen submission anchor and ends immediately before the next submission anchor.
- Assistant, tool, and system atoms are part of `TurnContext`; they are not promoted to primary recall objects.

# Time, Priority, And Organization
**Verdict: the system uses one canonical temporal model with view-specific sort policies for session replay, recall, project review, and admin triage.**

| View | Primary sort key | Direction | Purpose |
| --- | --- | --- | --- |
| raw/session debug | `event_time + seq_no` | ascending | physical replay and parser debugging |
| global turn recall | `submission_started_at` | descending | user-facing recall of recent intent |
| project feed | `last_committed_turn_activity_at` | descending | current project memory surface |
| project list | `project_last_activity_at` | descending | entry ranking across projects |
| linking inbox | `review_priority`, then recency | descending | force resolution of ambiguous evidence first |
| source/admin diagnostics | health severity, then recency | descending | operational triage |

- Ordering must be explicit in the canonical model, not invented in each UI.
- Project views may include only committed turns by default.
- Candidate and unlinked material must remain opt-in review surfaces.

# Ordering Key Normalization
**Verdict: all source families now converge on the same atom ordering pair, `time_key + seq_no`, before any turn or context projection is built.**

- Source-local timestamps are normalized into `time_key`.
- Fragment-to-atom conversion assigns one monotonic `seq_no` within each session.
- Session replay, submission grouping, and context spans consume the normalized ordering pair rather than source-native offsets.

# Identity And Revisions
**Verdict: logical IDs are now separated from revision IDs at the domain edge, and current project details resolve through persisted current revisions instead of raw source grouping.**

- `project_id`, `turn_id`, and `artifact_id` remain the stable logical identifiers.
- `project_revision_id`, `turn_revision_id`, and `artifact_revision_id` represent the current derived revision.
- Project re-derivation now persists revision rows and lineage events, including supersession and manual-override transitions.
- Detail queries resolve through current derived projections first, then lineage/tombstone fallbacks when needed.

# Live Probe, Replay, And Compatibility
**Verdict: local read-only probing and forward-compatible parsing are first-class product requirements, not debugging extras.**

- The runtime must be able to probe real local source roots on demand.
- Probe mode must support read-only inspection without committing final objects.
- Replay mode must re-run selected stages against an existing scope and produce diffs.
- Parsers must tolerate source evolution by preserving unknown structures as fragments or loss audits.
- Compatibility decisions must be driven by `source_format_profile` and parser versioning, not only by the newest observed shape.

Current live source targets:

1. `Codex`: `/root/.codex/sessions`
2. `Claude Code`: `/root/.claude/projects`
3. `Factory Droid`: `/root/.factory/sessions`
4. `AMP`: `/root/.local/share/amp/threads`

# Delivery Order
**Verdict: the delivery sequence optimizes for inspectability and real-source confidence before web polish or deep admin breadth.**

1. Establish stage contracts, live probe, and replay scaffolding.
2. Bring all four local source families to `ConversationAtom`.
3. Stabilize submission grouping, `UserTurn`, `TurnContext`, and `Session`.
4. Expose global recall and lineage drill-down through the API.
5. Add `ProjectObservation`, linking, and candidate review surfaces.
6. Replace `frontend_demo` mock types with canonical DTOs and real queries.
7. Add masking, search, lifecycle, artifacts, and drift controls.

# Memory Constraints
**Verdict: this host must be treated as a 4 GB machine, so installation and build workflows must stay strictly scoped.**

> Never use repository-root `pnpm install` or repository-root `pnpm build` as a default step on this host.
>
> Run one package build at a time.
>
> Reserve Next.js production builds for focused validation and cap Node memory when doing so.

Preferred commands:

1. `pnpm --filter @cchistory/domain build`
2. `pnpm --filter @cchistory/source-adapters build`
3. `pnpm --filter @cchistory/storage build`
4. `pnpm --filter @cchistory/api build`
5. `NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @cchistory/web build`

# Package Bootstrap
**Verdict: fresh dependency setup must happen one package at a time from the repository root, and installs should be filtered to the smallest package slice that can answer the question.**

> If `/root/cchistory/node_modules` already exists, prefer reusing it and running a build or test before attempting any install.
>
> Do not bootstrap `apps/web` unless the current task is explicitly web-facing; Next.js is the heaviest package on this host.

| Target | When to bootstrap | Scoped install command | First validation command |
| --- | --- | --- | --- |
| `@cchistory/domain` | contract or type-surface work | `pnpm install --filter @cchistory/domain` | `pnpm --filter @cchistory/domain build` |
| `@cchistory/source-adapters` | parser, probe, or atomization work | `pnpm install --filter @cchistory/source-adapters...` | `pnpm --filter @cchistory/source-adapters build` |
| `@cchistory/storage` | persistence or lineage work | `pnpm install --filter @cchistory/storage...` | `pnpm --filter @cchistory/storage build` |
| `@cchistory/api` | API, probe, or replay work | `pnpm install --filter @cchistory/api...` | `pnpm --filter @cchistory/api build` |
| `@cchistory/web` | UI integration work only | `pnpm install --filter @cchistory/web` | `NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @cchistory/web build` |

# Safe Dependency Order
**Verdict: sequential builds must follow the actual workspace dependency graph, with `apps/web` reserved for last because it is the most memory-expensive package.**

| Package | Direct workspace dependencies | Safe build position | Reason |
| --- | --- | --- | --- |
| `@cchistory/domain` | none | 1 | canonical contracts are the base layer |
| `@cchistory/source-adapters` | `@cchistory/domain` | 2 | adapters emit domain-layer evidence, atoms, and projections |
| `@cchistory/storage` | `@cchistory/domain` | 3 | storage persists domain-layer objects and lineage |
| `@cchistory/api` | `@cchistory/domain`, `@cchistory/source-adapters`, `@cchistory/storage` | 4 | API composes the runtime after its dependencies are built |
| `@cchistory/web` | `@cchistory/api-client` | 5 | the Next.js app is still the most memory-expensive package and should stay last |

# Validation Matrix
**Verdict: validation should stay narrow, package-scoped, and probe-driven, with API routes used for source inspection instead of full workspace builds.**

> Probe and replay commands assume `pnpm --filter @cchistory/api dev` is running in a separate terminal.
>
> Keep probe runs small by specifying `source_ids` and `limit_files_per_source`.

| Scope | Goal | Command | Memory profile |
| --- | --- | --- | --- |
| `@cchistory/domain` | validate contract compilation | `pnpm --filter @cchistory/domain build` | low |
| core scaffold | run low-memory core validation | `pnpm run validate:core` | low to medium |
| `@cchistory/source-adapters` | validate parser compilation | `pnpm --filter @cchistory/source-adapters build` | low |
| `@cchistory/source-adapters` | validate adapter tests | `pnpm --filter @cchistory/source-adapters test` | low |
| `@cchistory/storage` | validate storage compilation | `pnpm --filter @cchistory/storage build` | low |
| `@cchistory/storage` | validate replacement semantics and lineage queries | `pnpm --filter @cchistory/storage test` | low |
| `@cchistory/api` | validate API compilation | `pnpm --filter @cchistory/api build` | medium |
| `@cchistory/api` | validate probe persistence semantics | `pnpm --filter @cchistory/api test` | low to medium |
| `@cchistory/api` | run local API runtime | `pnpm --filter @cchistory/api dev` | medium |
| direct smoke probe | inspect one available local source without starting the API | `pnpm run probe:smoke -- --source-id=src-codex --limit=1` | low |
| live probe | inspect one source without persistence | `curl -s -X POST http://127.0.0.1:4040/api/admin/probe/runs -H 'content-type: application/json' -d '{"source_ids":["codex"],"limit_files_per_source":1,"persist":false}'` | low once API is running |
| replay | compare one source through replay path | `curl -s -X POST http://127.0.0.1:4040/api/admin/pipeline/replay -H 'content-type: application/json' -d '{"source_ids":["codex"],"limit_files_per_source":1}'` | low once API is running |
| `@cchistory/web` | verify web after real API integration | `NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @cchistory/web build` | highest; run alone |

# Adapter Conformance
**Verdict: the low-memory harness now checks discovery, parser metadata, source-specific fragments, atomization, projections, and malformed-input handling for all four supported local source families using source-shaped synthetic fixtures.**

| Source family target | Discovery invariant | Parse/atomize invariant | Projection invariant | Malformed-input coverage |
| --- | --- | --- | --- | --- |
| `Codex` | source is selectable through `source_ids` | `session_meta`, `turn_context`, message, tool call, tool result, and unsupported content all remain inspectable | one session and one `UserTurn` are emitted from one submission group | explicit truncated JSON fixture yields an unknown fragment and `LossAuditRecord` |
| `Claude Code` | source is selectable through `source_ids` | text, `tool_use`, `tool_result`, relation hints, and unsupported content items yield traceable fragment output | one session and one `UserTurn` are emitted with assistant context | explicit unsupported-item fixture yields an unknown fragment and `LossAuditRecord` |
| `Factory Droid` | source is selectable through `source_ids` | `session_start`, message items, `.settings.json` model signals, and partial tool-result records are ingested together | one session and one `UserTurn` are emitted with workspace and model evidence | explicit missing-field fixture preserves parse output without crashing the pipeline |
| `AMP` | source is selectable through `source_ids` | root metadata plus message records yield fragments, atoms, and tool edges | one session and one `UserTurn` are emitted with workspace evidence | explicit malformed root JSON fixture preserves a `RawRecord`, unknown fragment, and `LossAuditRecord` |

# Parse Boundary Discipline
**Verdict: source-specific quirks now stop at fragments and inspectable opaque/meta atoms rather than leaking into canonical projections.**

- `Codex` parser quirks stop at `session_meta`, `turn_context`, response-item, and unknown-content fragments.
- `Claude Code` parser quirks stop at content-item, relation-hint, and unsupported-item fragments.
- `Factory Droid` parser quirks stop at `session_start`, sidecar settings, partial tool-result, and unknown fragments.
- `AMP` parser quirks stop at root-thread metadata, message arrays, and malformed-root fragments.
- Forward-compatible unknown content now remains visible as `unknown` fragments plus hidden `meta_signal` atoms with opaque payload markers instead of being dropped.
- Submission-group candidates now carry explicit boundary explanations so replay and lineage views can explain why one `UserTurn` started where it did.

# Preflight Checklist
**Verdict: every install, build, or Next.js run should pass a short preflight check before it is allowed to consume memory on this host.**

> Skip the command if a smaller-scope alternative can answer the same question.

1. Identify the exact package and the exact acceptance criterion being validated.
2. Prefer `build`, `test`, `curl`, or `dev` over any install when existing dependencies are already present.
3. Confirm that no other TypeScript, Next.js, or `pnpm` build is already running.
4. Estimate whether the command touches only `tsc` output or also large dependency trees such as Next.js.
5. For probe and replay runs, set `source_ids` and `limit_files_per_source` before sending the request.
6. For web builds, set `NODE_OPTIONS=--max-old-space-size=1536` and run no other package build in parallel.
7. Check current disk footprint of generated artifacts before risky recovery work, for example `du -sh node_modules apps/*/node_modules packages/*/node_modules 2>/dev/null`.

# Cleanup And Recovery
**Verdict: recovery from a failed install or build must target generated dependency artifacts only, and destructive cleanup requires explicit confirmation.**

> Never delete `.cchistory/`, source capture roots under `/root/.codex`, `/root/.claude`, `/root/.factory`, or `/root/.local/share/amp`, or any user SQLite data as part of dependency cleanup.
>
> Treat deletion of `/root/cchistory/node_modules` as a last resort that requires explicit user confirmation.

1. Record the exact failed command and the package that triggered it.
2. Re-run the smallest non-install validation command that can confirm whether the failure is reproducible.
3. If a stale build output is suspected, remove only the affected package `dist/` directory and rerun that package build.
4. If a filtered install created a package-local `node_modules`, clean only that package-local directory and repeat the same filtered install.
5. If the root `node_modules` tree is suspected to be inconsistent, stop and confirm before deleting anything at the repository root.
6. After any cleanup, rerun only the matching package validation command, not a workspace-wide build.

# Current Status
**Verdict: the current implementation slice is now complete for local-source probe, linking, masked recall, search, lifecycle retention, tombstones, artifact coverage, drift diagnostics, and the main web review surfaces.**

| Area | State | Notes |
| --- | --- | --- |
| workspace scaffold | done | root workspace files and package folders exist |
| canonical domain package | done | core stage and projection interfaces drafted |
| source adapters | done | real local source roots, parser-profile metadata, submission grouping, opaque unknown-content handling, masked projections, and turn/context projection validation are now in place |
| live probe logic | done | direct smoke probing, API probe routes, raw snapshot persistence, read-only replay/probe semantics, and replay diff output are now in place |
| storage | done | SQLite-backed JSON persistence, deterministic replacement, evidence/admin listing, lineage queries, project revision persistence, manual overrides, FTS-backed search indexing, candidate GC, tombstones, and artifact coverage are now validated |
| API | done | probe, recall, search, mask, drift, project-feed, revision, replay-diff, lineage, override, lifecycle, artifact, tombstone, and OpenAPI routes now exist |
| web integration | done | `All Turns`, session drill-down, projects, inbox, linking review, search, masks, sources, and drift now consume canonical API data; `Imports` remains intentionally reference-only for a later import-bundle slice |
| project linking | done | workspace-path normalization plus git-backed repo evidence now flow through a conservative derived linker, and manual overrides plus revision persistence are in place |
| masking and search | done | deterministic built-in mask templates now generate `display_segments`, masked `canonical_text`, FTS search docs, and `/api/turns/search` |
| lifecycle and artifacts | done | lifecycle axes, candidate retention controls, tombstones, `KnowledgeArtifact` revision persistence, and artifact coverage queries are now in place |
| test harness | done | low-memory adapter fixtures plus storage, API, and web build validation now cover parser metadata, malformed inputs, submission grouping, masked projections, persistence semantics, replay diffs, override flows, lifecycle/artifact paths, search, and lineage drill-down |

# Immediate Next Slice
**Verdict: the implementation plan in this repository is now fully delivered for the current frozen local-source slice, and the next slice should be treated as a new scope decision rather than an unfinished tail.**

1. Decide whether the next scope is import-bundle ingestion, Family B sources, or richer artifact/product workflows.
2. Replace the reference-only `Imports` admin surface only when canonical import-bundle semantics are frozen.
3. Expand project lineage from event recording into full merge/split workflows only when curator operations are prioritized.
