---
doc_type: contract
status: target
authority: normative
implementation: partial
verification_status: partial
last_reconciled: 2026-10-12
review_due: 2026-10-24
supersedes: []
---

# Repository governance and contract lifecycle

## Purpose

This contract evolves CCHistory's repository governance from a primarily
prose-driven agent pipeline into a combined system of:

- frozen product semantics;
- explicit structural ownership;
- typed document authority and lifecycle;
- contract-first material changes;
- risk-based AI execution and independent review;
- machine-checkable documentation and architecture boundaries;
- durable, honestly scoped verification evidence.

The change governs how the project evolves. It does not redesign CCHistory's
product semantics or weaken evidence-preserving ingestion.

## Scope

In scope:

- authority and lifecycle metadata for the repository's current governance
  documents;
- a structural architecture ownership map;
- contracts, plans, issues, evidence, and reusable change templates;
- an incremental document-governance verifier;
- an architecture-boundary manifest that complements existing product-specific
  verifiers;
- active-backlog versus archived-history rules;
- integration of the existing AI execution pipeline with the new contract
  lifecycle.

Out of scope:

- changing `UserTurn`, `ProjectIdentity`, linking, masking, lifecycle, or source
  semantics;
- rewriting every historical design document in one migration;
- replacing domain-specific verifiers with a generic text checker;
- treating same-context review as independent evidence;
- making heavyweight review mandatory for routine, mechanically bounded work.

## Source anchors

### source[1] — 2026-07-26

> The operator approved a paradigm-level governance change across CCHistory and
> the reusable engineering-discipline template, and required CCHistory work to
> occur on an independent branch rather than the current main branch.

### source[2] — 2026-07-26

> The accepted synthesis combines contract-first documentation governance with
> CCHistory's AI execution controls: independent lenses, fresh-context
> evaluation, fixture-first implementation, portfolio review, and truthful
> evidence classes.

### source[3] — 2026-10-11

> 项目纪律也更新一下，参考../template-project

This request authorizes the scoped R47 discipline reconciliation. It does not
replace source[1]'s July migration acceptance or authorize unrelated product work.

## Authority model

The authority order is:

1. `HIGH_LEVEL_DESIGN_FREEZE.md` owns product semantics and frozen invariants.
2. `ARCHITECTURE.md` owns structural boundaries, dependency direction, and
   invariant ownership.
3. Current contracts under `docs/contracts/` own material cross-surface
   behavior and repository governance.
4. `docs/design/CURRENT_RUNTIME_SURFACE.md` owns the repository-visible runtime
   inventory; registries and entrypoints remain the code-level facts it audits.
5. `PIPELINE.md` owns work selection, phase execution, and completion rules.
6. `BACKLOG.md` owns active portfolio state and priorities.
7. Plans own execution order only; issues own finding lifecycle; guides explain
   operations; evidence supports claims.

No lower-ranked document silently overrides a higher-ranked authority. A
conflict becomes `needs_reconciliation` or an explicit blocked backlog item.

- from: source[1], source[2]

## Document metadata and lifecycle

Governed Markdown documents declare:

- `doc_type`;
- `status`;
- `authority`;
- `last_reconciled`;
- contracts additionally declare `implementation` and
  `verification_status`;
- replacement relationships use `supersedes` and `superseded_by`.

Lifecycle states are:

- `current`: authoritative for present behavior;
- `target`: accepted future behavior, not yet current;
- `active`: execution or triage in progress;
- `completed`: finished plan retained for history;
- `historical`: context or evidence only;
- `superseded`: replaced with an explicit successor;
- `needs_reconciliation`: known conflict that blocks dependent work.

Only target contracts and target surfaces age mechanically. Current documents
do not become invalid merely because time passed; repeated code-derived facts
must instead be generated or checked against their code owner.

- from: source[2]

## Structural ownership

Every material invariant has one authoritative code or document owner,
declared public consumers, and an enforcement surface. Consumers may project
public contracts but may not reproduce private rules.

At minimum the architecture map preserves these directions:

- source-specific behavior stops in `packages/source-adapters`;
- storage-neutral canonical semantics live in `packages/canonical` and do not
  depend on Full storage;
- durable lifecycle and persistence live in `packages/storage`;
- API DTOs live in `packages/api-client`;
- UI mapping and shared formatting live in `packages/presentation`;
- Web/TUI own local interaction state, not hidden domain truth;
- Lite production graphs never depend on Full storage or Full applications.

Declared module-reference and legacy literal boundary checks complement existing
TypeScript builds, `verify:lite`, `verify:product-profiles`, parity verifiers,
and registry/runtime truth checks. `ARCHITECTURE.md` declares recognized syntax,
normalization, fail-closed forms and unresolved graph limits; checker success
does not claim complete runtime resolution.

- from: source[2], source[3]; selected adoption locators live in the R47 plan/evidence

## Material-change contract gate

`PIPELINE.md`'s Material-Change Contract Gate owns consequence-based routine,
material and high-risk classification. A bounded authorized local change may
reconcile its existing owner without a new standalone plan. Published integration
commitments, durable semantics, new normative owners and coordinated commitments
require material delivery; credible serious harm or isolation/authorization
enforcement requires high-risk review. Category names and file count are not
independent triggers; unavailable evidence cannot downgrade the route.

Before dependent material/high-risk implementation, the delivery must have:

- a current or target contract;
- a complete-end-state implementation plan;
- explicit owner, states/triggers, failures, non-goals, and acceptance outcomes;
- a risk classification and required independent-review depth.

Routine work uses credible focused verification, with a reproducer/category guard
when it can expose the defect. Controlled experiments use existing safety owners,
containment, expiry and cleanup evidence before running. Neither route creates
permission or waives an activated owner's explicit acceptance requirements.

- from: source[2], source[3]

## AI execution and independent review

The development discipline owns inquiry, concern activation and actual-effect
verification; `PIPELINE.md` owns execution routes and completion. Material plans
order actual dependencies toward one end state. Seven historical phase names
remain useful techniques, not compulsory serial deliverables. High-risk work
requires independent preimplementation lenses for:

- frozen semantics and structural consistency;
- user/operator experience;
- engineering cost and long-term maintenance.

A separate synthesis records agreement, disagreement, residual risk, and any
decision requiring human authority. High-risk completion requires a fresh context
outside proposal/implementation, receiving original intent, contract and observed
result. Context independence, acquisition independence and model variation remain
distinct. Review concurrency follows available capability/resource limits.

When independent reviewers are unavailable, technical implementation may be
completed, but the objective remains `verifying` or `blocked` unless the user
grants a named governance exception. Same-context notes are never recorded as
independent evidence. An authorized named end is delivered continuously without
phase approvals; a completed bounded task grants no further portfolio authority.
Work selection consumes the owner's scope and declared priority. Fixable technical
uncertainty is investigated; only a proven missing owner decision blocks its path.

- from: source[1], source[2], source[3]

## Evidence classes and completion truth

Verification records identify the evidence class they provide, including:

- unit or class-level guard;
- projection/seeded integration fixture;
- source-shaped or real-layout fixture;
- generated scale verifier;
- built entrypoint or packaged artifact;
- real HTTP/process/browser/service run;
- operator-started manual diary;
- reviewed real archive or source sample.

Every durable report states limitations and what it does not prove. Task, KR,
objective, and release completion remain separate claims. Passing technical
gates does not close missing independent review or user-started manual work.

- from: source[2]

## Active work and history

`BACKLOG.md` remains the compact active work surface. Completed work may move to
a dated repository archive with a stable index and source objective identifiers.
Completed objectives and their acceptance evidence must not be silently
deleted. The existing note about 231 previously removed objectives remains a
historical exception; this migration does not fabricate unavailable records.

Plans, issues, and evidence remain separate from portfolio status so the active
backlog does not become the only historical ledger.

- from: source[1], source[2]

## Incremental adoption

The first enforcement scope covers the repository's governing entrypoints, new
contracts/plans/evidence, and reusable templates. Historical feature documents
remain readable without a bulk metadata rewrite. When a historical document is
materially revised or promoted back to current authority, it enters the governed
set and receives lifecycle metadata.

This avoids a flag-day documentation migration while preventing new untyped
authority from accumulating.

- from: source[2]

## Required machine enforcement

Repository commands must verify:

- governed document metadata and role-specific lifecycle;
- replacement and implementation relationships remain repository-contained and
  resolve;
- target review deadlines and structured promises;
- required governance templates and sections;
- declared architecture rules are non-vacuous and contain no forbidden
  dependency reference;
- existing support, runtime, product-profile, and Lite boundary verifiers
  remain the authoritative domain-specific checks.

The checker reports its mechanical scope honestly and does not pretend to judge
semantic prose or visual quality.

- from: source[2]

## Acceptance evidence

This contract may become current only when:

- CCHistory is on the operator-required independent branch;
- `ARCHITECTURE.md` and the authority/lifecycle map exist;
- governance templates and active/archive routing exist;
- document and architecture verifiers have fixture tests and pass;
- CI runs the new lightweight governance gates;
- existing support-status, runtime-inventory, product-profile, and Lite boundary
  gates remain compatible;
- an independent three-lens review and synthesis is recorded, or a human grants
  an explicit governance exception.

Mechanical implementation evidence is recorded in
`docs/evidence/2026-07-26-repository-governance-technical-verification.md`.
That dated record reports the document lifecycle and architecture fixture suites,
support-status, runtime-inventory, product-profile and Lite gates passing. The final
independent-review condition is still open, so this contract remains `target`
and must not be treated as fully current governance.

## Promise register

- promise[independent-governance-review]: due=2026-10-24; status=open; owner=repository-maintainer; description=complete independent consistency UX and engineering-cost reviews plus synthesis for this governance migration

## Reconciliation log

- **2026-07-26 — target created:** recorded the operator-approved governance
  paradigm migration before implementing structural or checker changes.
- **2026-07-26 — mechanical migration verified:** added the structural
  architecture map, incremental lifecycle, templates, archive routing, Node
  verifiers, fixture tests, scripts, and CI gate. Technical evidence passed;
  independent three-lens review and synthesis remain explicitly unresolved.
- **2026-10-12 — R47 discipline reconciliation:** updated operative execution,
  collaboration and checker-scope clauses using the selected current sibling
  rules. The July R44 branch/review/synthesis acceptance and October 24 promise
  remain open; R47 review is not substituted for that migration.
