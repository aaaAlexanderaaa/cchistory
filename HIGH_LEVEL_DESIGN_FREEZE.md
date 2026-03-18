# CCHistory High-Level Design Freeze

## Status

- This document is the design lock for product direction and system
  architecture.
- It supersedes the product-definition portions of
  `archive/docs/ARCHITECTURE.md` and the UX direction in
  `archive/docs/plans/2026-03-06-conversation-ux-overhaul.md`.
- Historical API and operations references remain archived in
  `archive/docs/API_GUIDE.md` and `archive/docs/OPERATIONS.md`.

## 1. Project Essence

CCHistory is an API-first memory layer for user interaction history across
conversational tools.

Its core asset is not the raw session, not the assistant reply, and not the
tool call. Its core asset is the `project-scoped user turn`: the unit that best
captures what the user asked, in the context of the project where that intent
belongs.

The product exists to solve four problems:

1. Recall: recover what the user previously asked in a project.
2. Traceability: recover the full session context behind a turn.
3. Administration: manage source health, imports, masks, project linking, and
   data quality.
4. Supply: expose stable, canonical history to external agents and downstream
   analysis systems.

The product is not a session viewer, not a browser-history bucket, and not a
UI-first distillation tool.

## 2. Design Philosophy

The system is driven by the following principles:

- Less is more: minimize top-level concepts and keep each concept responsible
  for one stable meaning.
- Data first: data quality is more important than UI polish; UI is more
  important than endpoint convenience.
- Project-centric: the primary context boundary is the project, not the source
  and not the session.
- User-turn-first: the main object of recall, search, and review is the
  `UserTurn`.
- Local-first: data enters the system through local access or offline import,
  not remote live federation.
- Explainable: every derived object must be traceable back to raw evidence.
- One semantic pipeline: UI, search, and API consume the same canonical objects.
- Admin-visible: source health and data quality are product requirements, not
  implementation details.
- Source-family-aware: different source families require different capture and
  parsing strategies, but should converge on one canonical model.

## 3. Core Job To Be Done

Primary job:

- Help a user recover what they asked in a project, even when those turns were
  spread across multiple sessions and multiple coding agents.

Secondary jobs:

- Let the user inspect the full context behind a recovered turn.
- Let the user administer their own local history system as a self-hosted data
  owner.
- Let external agents consume stable, canonical history through API contracts.

## 4. Kernel Pattern

The system is built around one kernel pattern:

1. Preserve evidence.
2. Derive stable objects.
3. Govern lifecycle.
4. Project to UI and API.

This pattern is the core reusable design. New sources should plug into this
pattern rather than forcing new product semantics.

### 4.1 Preserve Evidence

- Raw source material is the truth anchor.
- Raw evidence is never silently rewritten to match downstream expectations.
- Provenance must remain reversible.

### 4.2 Derive Stable Objects

- Canonical objects are derived from raw evidence.
- Derived objects exist to stabilize product semantics across heterogeneous
  sources.
- Source-specific quirks stop at the derivation boundary.

### 4.3 Govern Lifecycle

- Existence, value, and retention are separate concerns.
- The system must decide how data changes over time, not only how it is parsed.

### 4.4 Project to UI and API

- UI and API are projections of the same canonical objects.
- Neither layer may invent its own parallel semantics.

## 5. Source Families

The source-family definitions below freeze semantic treatment, not an
exhaustive adapter roster.

The repository may implement additional adapters inside a family without
reopening the design, as long as those adapters converge on the same canonical
objects and lifecycle rules.

### 5.1 Family A: Local Coding-Agent Logs

This family includes examples such as Claude Code, Codex, Factory Droid, AMP,
Cursor, Antigravity, OpenClaw, and OpenCode.

Common traits:

- Local file access.
- Sessions or threads are present in raw data.
- Project/workspace signal exists, but with varying confidence.
- Raw data contains substantial non-user noise.
- `UserTurn` is not a first-class upstream object and must be derived.

### 5.2 Family B: Conversational Export / App-Database Sources

This family includes targets such as LobeChat exports, ChatGPT exports, Gemini
exports, and activity-derived or app-database imports.

Common traits:

- Data enters through export bundles or app/database access.
- Native project semantics may be explicit, weak, or absent.
- Conversation structure is usually cleaner than CLI event logs, but storage and
  import semantics differ substantially.

Minimum usable semantics for Family B:

- Global history is always allowed.
- Weak project signals may produce candidate project observations.
- Only strong evidence or manual linking may place Family B data into committed
  project history.
- When no reliable project signal exists, data remains `unlinked` rather than
  polluting project views.

### 5.3 Excluded From MVP

- Browser history is excluded from the MVP.
- The browser domain should not distort the canonical model for conversational
  memory.

## 6. Canonical Objects

The following objects define the stable domain model.

### 6.1 Evidence Objects

- `Host`: the machine that produced the captured source data.
- `SourceInstance`: one configured or imported source instance.
- `ImportBundle`: one offline capture package with source inventory and
  provenance metadata.
- `Session`: a raw conversation container from a source.
- `RawEvent`: the smallest traceable raw unit inside a session or import.

### 6.2 Derivation Objects

- `ProjectObservation`: source-derived evidence about project identity, such as
  workspace path, repo root, repo remote, or source-native project metadata.
- `ProjectIdentity`: the linked project entity used by the product.
- `UserTurn`: the canonical user-intent unit used for recall, browsing, search,
  and API consumption.
- `TurnContext`: the assistant, tool, and system context attached to a
  `UserTurn`.
- `MaskTemplate`: a deterministic rule that converts repetitive content into a
  masked semantic representation.
- `KnowledgeArtifact`: a higher-level derived object representing extracted
  knowledge or memory that can cover one or more `UserTurn` objects.

### 6.3 Identity Objects

Canonical objects use two identity layers:

- logical identity
- revision identity

Logical identity answers "what stable product object is this?" Revision identity
answers "what current derived version of that object is this?"

Required logical identities:

- `project_id`
- `turn_id`
- `artifact_id`

Required revision identities:

- `project_revision_id`
- `turn_revision_id`
- `artifact_revision_id`

Rules:

- Metadata-only, mask-only, lifecycle-only, or confidence-only changes should
  preserve logical identity and create a new revision.
- Boundary-changing derivation changes create new logical identity and must
  record lineage.
- Split and merge are lineage events, not in-place rewrites.
- Old references must remain resolvable through logical ID or lineage lookup.
- One-to-one supersession may auto-resolve to the current revision.
- One-to-many or many-to-one lineage must remain explicit rather than silently
  redirecting.

### 6.4 Projection Objects

- `History feeds`: project or global views of `UserTurn` objects.
- `Search results`: filtered views of `UserTurn` objects.
- `Session context views`: a projection of `Session` and `TurnContext`.
- `Admin diagnostics`: projections of source, import, linking, and mask states.

## 7. Canonical Pipeline

The canonical pipeline is:

1. Capture
2. Parse
3. Normalize
4. Observe project evidence
5. Link project identity
6. Build user turns
7. Apply semantic masks
8. Index active projections
9. Present through UI and API

Rules:

- Capture and parse can be source-family-specific.
- From project observation onward, the pipeline should converge on the same
  product semantics.
- Parser, project linker, turn builder, and mask logic must each be versioned.

## 8. Project Linking Model

Project identity must be derived through an evidence-based linker.

The system should not define projects by source grouping, and should not rely on
one signal such as path or repo remote alone.

### 8.1 Linking Inputs

- `host_id`
- normalized `workspace_path`
- `repo_root`
- `repo_remote` or repo fingerprint
- source-native project metadata
- manual user alias or merge overrides

### 8.2 Linking Outputs

- stable `project_id`
- `project_revision_id`
- confidence level
- link reason
- linkage state: `candidate` or `committed`
- manual override status

### 8.3 Constraints

- Cross-source project association is required.
- Cross-source session merging is not allowed.
- Low-confidence project linking must remain visible and correctable in admin.
- When evidence conflicts, the linker must prefer under-linking over false merge.

### 8.4 Linking Semantics

The linker must separate candidate association from committed project
membership.

Committed linking rules for MVP:

- Same host and same normalized workspace path is sufficient committed
  continuity on that host when it repeats across sessions.
- A single workspace observation on one host remains candidate-linked until
  that workspace continuity repeats or a manual override is applied.
- Directory migration may preserve project continuity when repo fingerprint is
  continuous.
- Cross-host continuity requires strong repo evidence or manual override.
- Repo remote renames do not split a project when repo continuity remains clear.
- Forks default to a new project unless manually merged.
- Monorepos default to `repo root + workspace subpath`, not the whole repo as
  one project.
- Non-git projects may become committed on one host through repeated stable
  workspace continuity; otherwise they remain candidate-linked unless source
  data carries a stable project identifier or a manual override is applied.

Candidate-only rules for MVP:

- Weak path hints, weak metadata hints, or non-authoritative imported project
  labels may produce candidate associations.
- Candidate associations must not alter committed project history until upgraded
  by stronger evidence or manual action.

## 9. UserTurn Model

`UserTurn` is the main product object.

It is derived through a source-adapted clustered builder with context span
attachment.

`UserTurn` uses the same identity split as the rest of the system:

- `turn_id` identifies the logical turn
- `turn_revision_id` identifies the currently derived revision

Builder or mask changes that preserve the same user-authored anchor set should
preserve `turn_id` and generate a new `turn_revision_id`.

Builder changes that alter turn boundaries or anchor membership must create a
new `turn_id` and record lineage.

### 9.1 Builder Responsibilities

- Identify user-authored raw material.
- Identify injected user-shaped context that belongs to the same submission.
- Cluster contiguous submission-related raw fragments into one turn.
- Attach the resulting assistant/tool/system span as `TurnContext`.
- Preserve raw references for traceability.

### 9.2 Builder Non-Responsibilities

- No semantic intent inference.
- No cross-session turn merging.
- No cross-source turn merging.
- No topic modeling.

### 9.3 Turn Representations

Each `UserTurn` should expose:

- `raw_text`
- `canonical_text`
- `display_segments`
- `source_refs`
- `session_ref`
- `project_ref`: nullable committed project reference
- `project_link_state`
- `candidate_project_refs`
- `context_ref`

Search and default recall operate on `canonical_text`.

### 9.4 Cross-Source Invariants

All source-specific builders must preserve the following invariants:

- A turn belongs to exactly one session.
- A turn has at least one user-authored anchor.
- A turn represents exactly one user submission boundary.
- Injected user-shaped content must remain distinguishable from user-authored
  content.
- Context span ends before the next user-authored anchor.
- All builders must emit the same canonical turn fields.

Builder freedom is allowed only in anchor detection, injected-fragment
classification, and source-specific context extraction.

### 9.5 Context Storage Semantics

`TurnContext` is a logical object with reference-first storage semantics.

Rules:

- Hot-path turn storage should keep bounded context materialization only.
- Full context should be reconstructed from raw evidence or cached derived
  context materialization on demand.
- Large assistant or tool payloads must not be blindly duplicated into primary
  turn storage.
- Purge or tombstone behavior for context follows the retention and provenance
  rules of the underlying turn and raw evidence.

## 10. Semantic Mask Model

Masks are not display-only replacements. They are semantic derivation rules.

Each mask transforms repetitive content into a stable, explainable representation
without modifying raw evidence.

### 10.1 Outputs

- `raw_text`: full original text
- `canonical_text`: deterministic, non-inferential text used for search and
  canonical understanding
- `display_segments`: structured display form with masks or snippets

### 10.2 Rule Sources

- source-default rules
- user-defined override rules

### 10.3 Constraints

- Masking is deterministic.
- Masking is reversible at display time.
- Masking affects derived text, not stored raw evidence.
- UI components must not implement their own independent mask behavior.
- Masking may normalize formatting, remove fixed wrappers, collapse deterministic
  snippets, and produce stable placeholders.
- Masking must not paraphrase, summarize, translate, infer intent, or synthesize
  new user text.

### 10.4 Canonical Text Contract

`canonical_text` is not a semantic embedding and not an inferred intent layer.

It is the deterministic canonical text for exact-string retrieval and default
memory pathways.

Future stronger semantic representations, if needed, must live in separate
fields and separate pipelines rather than expanding the meaning of
`canonical_text`.

## 11. Lifecycle Model

Lifecycle is a first-class part of the design.

The system must manage data along three orthogonal axes.

### 11.1 Sync Axis

Describes relationship to upstream source state.

- `current`
- `superseded`
- `source_absent`
- `import_snapshot`

Rules:

- New upstream data creates new evidence and new derived objects.
- Modified upstream data supersedes prior derived objects.
- Missing upstream data does not immediately hard-delete local evidence; it
  becomes `source_absent` first.
- Imported bundles are snapshots unless explicitly marked complete and
  authoritative for a source instance.
- `superseded` objects do not participate in default recall.

### 11.2 Value Axis

Describes whether data should participate in default memory and default recall.

- `active`
- `covered`
- `archived`
- `suppressed`

Rules:

- `active` participates in default browsing, search, and API recall.
- `covered` indicates that a `KnowledgeArtifact` now carries the higher-value
  memory; source turns remain traceable.
- `archived` remains accessible but is removed from default pathways.
- `suppressed` is explicit user-driven demotion for low-value material.
- `covered` requires at least one live `KnowledgeArtifact` reference.

### 11.3 Retention Axis

Describes what is physically retained.

- `keep_raw_and_derived`
- `keep_raw_only`
- `purged`

Rules:

- Default retention is `keep_raw_and_derived`.
- Physical purge must be explicit and admin-visible.
- Excluding data from default recall does not imply physical deletion.

### 11.4 Legal Combinations And Transitions

Lifecycle is implemented as three guarded axes rather than one monolithic state
machine.

Guard rules:

- Only `current` and `import_snapshot` objects may participate in default recall.
- `active` is the only value state that participates in default recall.
- `covered` and `active` are mutually exclusive.
- `purged` forbids payload delivery and search participation.
- `source_absent` should automatically leave the default-active path.

Transition rules:

- `current -> superseded` occurs when newer authoritative evidence replaces the
  current revision.
- `current -> source_absent` occurs when authoritative source reconciliation can
  prove disappearance.
- `active -> covered` occurs when a live `KnowledgeArtifact` registers
  coverage.
- `covered -> active` or `covered -> archived` occurs when coverage is removed.
- `keep_raw_and_derived -> keep_raw_only` is allowed for index or projection
  removal without destroying evidence.
- Any state -> `purged` requires explicit admin action.

Provenance rules after purge:

- Purged objects should retain a minimal tombstone identity record for reference
  integrity.
- API detail lookups for purged objects should return tombstone semantics rather
  than pretending the object never existed.

## 12. Import Model

Offline import is a product capability, not an implementation convenience.

The import format should be a raw-first hybrid bundle.

### 12.1 Bundle Contents

- bundle version
- capture time
- host identity
- capture tool version
- source inventory
- file manifests and checksums
- scope metadata
- privacy metadata
- optional project observations

### 12.2 Import Rules

- Raw evidence remains the source of truth.
- Canonical objects are always rebuilt from raw evidence on import.
- Full authoritative bundle reconciliation is allowed only when scope and source
  identity are explicit.
- Partial bundles are append-only snapshots and must not trigger deletion
  semantics.

### 12.3 Deduplication And Reconciliation

Deduplication must occur in layers.

Layer 1: bundle deduplication

- A repeated import of the same bundle fingerprint is a no-op.

Layer 2: evidence deduplication

- Evidence is keyed by source family, source instance fingerprint, host
  identity, origin key, and checksum or content fingerprint.
- Same evidence key and same checksum is a no-op.
- Same evidence key with changed checksum creates a new evidence revision and
  supersedes the prior derived revision.

Layer 3: turn deduplication

- Turns deduplicate only within the same logical source/session lineage and
  anchor contract.
- Identical text alone is not sufficient to deduplicate turns across hosts or
  across unrelated provenance.

Reconciliation rules:

- Full authoritative imports may reconcile absence for the covered source scope.
- Partial imports may only append or supersede overlapping evidence; they must
  not imply deletion.
- Cross-host duplicate capture must not auto-collapse raw evidence unless the
  source identity contract proves they are the same evidence stream.

## 13. Knowledge Coverage Model

The system must support higher-level memory without collapsing provenance.

`KnowledgeArtifact` exists for extracted patterns, reusable knowledge, stable
instructions, or decisions that were derived from one or more turns.

`KnowledgeArtifact` is a domain object, not a commitment to a UI-native
authoring workflow. Artifacts may be created by external agents or downstream
systems and then registered back into CCHistory.

Rules:

- A `KnowledgeArtifact` must carry provenance references to the turns it covers.
- Covered turns may be excluded from default recall, but must remain traceable.
- The system must not automatically purge source turns when higher-level
  knowledge exists.

MVP minimum responsibilities:

- External systems must be able to register a `KnowledgeArtifact`.
- Coverage must have visible effect on turn lifecycle state.
- Coverage removal must be reversible.
- UI does not need native authoring, but admin or detail surfaces must expose
  the existence and effect of coverage.

This preserves long-term explainability while allowing lower-value turns to stop
dominating recall pathways.

## 14. Web UI Projection

The UI is split into two areas:

- `History`
- `Admin`

### 14.1 History

History is project-first and turn-first.

It should provide:

- global `UserTurn` history
- project list
- project turn feed
- turn detail
- session context view
- exact-string search over active turn canonical text
- explicit handling of `unlinked` and candidate-linked history where committed
  project identity is not yet available

Committed project history must contain only turns with committed `project_ref`.
Candidate-linked or unlinked turns belong in global history or dedicated review
surfaces until project membership is committed.

Source is a filter or facet, not the main navigation model.

### 14.2 Admin

Admin should provide:

- source health
- import management
- project linking management
- mask management
- diagnostics and drift visibility
- lifecycle and retention controls

Admin exists because this is a self-hosted system where the user is also the
data administrator.

## 15. API Projection

The API must expose stable objects rather than source-specific raw structures.

The API surface should be centered on:

- source and import status
- projects
- turn list and search
- turn detail
- session context
- project- or source-scoped export
- masks
- lifecycle states
- knowledge artifacts

API identity rules:

- Logical IDs should be stable public references.
- Revision IDs should be available for audit and debugging workflows.
- Lineage and tombstone semantics must be machine-readable where applicable.

API query rules:

- Default lookup by logical ID should return the current logical-object view.
- Historical revision lookup must be explicit by revision identifier or revision
  query mode.
- List and search results should expose both logical ID and current revision ID.
- Split and merge lineage should be exposed in machine-readable detail views
  rather than flattened into silent redirects.
- Project filters should match committed `project_ref` only unless an explicit
  query mode opts into candidate-linked or unlinked turns.

The API is not the place where canonical semantics are invented. It is the
delivery surface for the canonical model.

## 16. Operational Envelope

The MVP targets a workstation-grade local archive, not an unbounded distributed
memory platform.

Operational assumptions:

- single-user, self-hosted deployment
- active data in the tens of thousands of turns
- raw evidence in the hundreds of thousands to low millions of events
- occasional manual project and mask correction is acceptable
- frequent per-turn manual repair is not acceptable

Operational rules:

- Full raw evidence may be retained, but hot-path history views should load only
  bounded turn detail by default.
- Full session context should be loaded on demand.
- Archived, covered, suppressed, or superseded objects may leave the hot search
  path while remaining reconstructable.
- Parser, linker, and builder version changes should support scoped rebuilds by
  source family, source instance, project, or affected object set.
- Mask version changes should support scoped re-derivation and re-indexing of
  affected turns without requiring unrelated rebuilds.
- Full rebuild should remain an exceptional maintenance path rather than the
  normal response to routine rule changes.

Performance intent:

- Default history and search interactions should remain interactive on active
  datasets.
- Scoped rebuilds should complete as bounded maintenance jobs rather than
  requiring full-system reprocessing for ordinary mask or linker changes.

## 17. System Invariants

The following invariants are frozen:

- Raw evidence is retained and traceable unless explicitly purged.
- `UserTurn` is always a derived object.
- `ProjectIdentity` is always derived through evidence linking.
- Default search targets `UserTurn.canonical_text`.
- Assistant and tool data exist as context, not as the default main object.
- UI and API cannot bypass the derivation layer to create parallel semantics.
- Upstream disappearance does not trigger immediate hard deletion.
- Covered knowledge does not erase provenance.
- New source integrations extend the capture and parse layer, not the product
  semantics.

## 18. Complexity Budget

The design intentionally allows only bounded complexity in the MVP.

Allowed complexity:

- source-family-specific capture and parse
- evidence-based project linking with visible confidence
- source-adapted turn building
- deterministic semantic masking
- lifecycle state management
- offline import and reconciliation

Deferred complexity:

- semantic search
- fuzzy search
- browser-history integration
- cross-session or cross-source turn merging
- automatic value scoring
- automatic forgetting
- automatic mask learning
- remote live federation
- probabilistic or embedding-based project linking

The rule is simple: the system may grow through new adapters and new derived
objects, but not through ambiguous semantics.

## 19. MVP Boundaries

The MVP boundary is defined by canonical semantics and operator experience, not
by a frozen count of adapters or one exact UI interaction set.

The MVP includes:

- local coding-agent history ingestion
- supported conversational export ingestion
- offline import bundle ingestion
- project-first history browsing
- turn-first search and detail
- session context inspection
- source and lifecycle administration
- deterministic mask support

The MVP excludes:

- browser history
- UI-based distillation workflows or artifact authoring
- semantic recall features
- automatic memory-value inference
- remote network crawling of other hosts
- agent-first or tool-first primary browsing

## 20. Success Criteria

The design should be considered aligned only if the delivered system satisfies
the following conditions:

- Multiple coding agents under the same project are associated through project
  identity rather than isolated by source.
- The default browsing and search experience is centered on `UserTurn`.
- The user can move from a recovered turn to full session context.
- Admin can diagnose source health, linking state, masks, imports, and drift.
- Imported data remains trustworthy and auditable.
- Lower-value data can be archived, suppressed, or covered without destroying
  provenance.
- New conversational sources can be added without redefining the product.
