---
doc_type: plan
status: completed
authority: planning
last_reconciled: 2026-07-26
implements: docs/contracts/repository-governance.md
supersedes: []
---

# Repository governance migration plan

## Cold-start summary

CCHistory already has strong frozen product semantics, a seven-phase agent
pipeline, an active backlog, product-specific drift verifiers, evidence-safe
storage rules, and cross-surface validation journeys. Its governance documents
do not yet have a uniform machine-readable lifecycle, explicit structural
ownership map, contract/plan/evidence routing, or a generic documentation
fitness gate.

The operator approved a paradigm-level change and required all CCHistory work
to occur on an independent branch. The branch is
`governance/contract-lifecycle-harness`.

## Authority and prerequisites

- Product semantics: `HIGH_LEVEL_DESIGN_FREEZE.md`
- Current execution rules: `PIPELINE.md`
- Active work: `BACKLOG.md`
- Runtime inventory: `docs/design/CURRENT_RUNTIME_SURFACE.md`
- Target contract: `docs/contracts/repository-governance.md`
- Confirmed constraint: product semantics remain unchanged

## Complete end state

CCHistory retains its existing product and AI execution semantics while gaining
an explicit architecture ownership map, typed document lifecycle, reusable
frontend/backend/cross-stack/review templates, active-versus-archive routing,
and lightweight Node-based document and architecture verification integrated
with CI. Historical docs remain readable without a flag-day rewrite.

The implementation may finish technically in this branch, but governance
completion remains pending until independent review is real or explicitly
waived by the operator.

## Current state and gap

| Concern | Current verified fact | Contract requirement | Gap/evidence |
|---|---|---|---|
| Product authority | Design freeze and docs map are explicit | Preserve unchanged | No semantic gap |
| Structural ownership | Repository map names package roles | Owner/consumer/must-not-know/enforcement matrix | Missing |
| Document lifecycle | Roles described in prose | Typed status/authority/reconciliation/supersession | Missing |
| Drift checks | Support/runtime/profile/Lite checks exist | Generic lifecycle plus architecture manifest | Missing generic layer |
| Frontend governance | Projection rules and review diaries exist | Current surface contract and cross-stack template | Missing reusable contract form |
| Backlog history | Active and completed evidence share one large file | Active portfolio plus durable archive index | Historical cleanup conflict |
| Independent review | Pipeline requires independent lenses | Real three-lens reports and synthesis | Not available in current context |

## Execution order within one coherent change

### 1. Land governance authority before enforcement

- Create this target contract and plan.
- Record the objective in `BACKLOG.md`.
- Add `ARCHITECTURE.md` and document authority/lifecycle routing.

### 2. Add reusable contracts and lifecycle structure

- Add contract, frontend surface, backend change, cross-stack change,
  implementation plan, verification, independent review, and holistic
  evaluation templates.
- Add contract, plan, issue, evidence, and archive indexes.
- Add metadata to the small initial governed document set.

### 3. Add machine enforcement

- Add a Node document-governance verifier and fixture tests.
- Add a machine-readable architecture manifest and boundary verifier tests.
- Reuse existing domain-specific gates rather than duplicating them.
- Wire lightweight checks into package scripts and CI.

### 4. Reconcile repository guidance

- Update `AGENTS.md`, `PIPELINE.md`, documentation maps, runtime inventory, and
  validation command lists.
- Define active backlog versus archived-history rules.
- Record exact verification evidence and remaining independent-review blocker.

## Risk register

| Risk | Trigger | Impact | Prevention/detection | Recovery |
|---|---|---|---|---|
| Governance contradicts design freeze | New process text changes product semantics | Product drift | Explicit non-goal and design-freeze review | Revert conflicting process clause |
| Flag-day metadata migration | Checker scans every historical design | Large noisy rewrite | Explicit governed-file policy | Narrow policy to current entrypoints |
| Duplicate boundary checks drift | Generic verifier reimplements `verify:lite` | False confidence | Manifest names complementary scope | Remove duplicate rule and keep domain gate |
| Backlog history is lost | Completed work is deleted during cleanup | Audit loss | Archive index and no-silent-delete rule | Restore from Git where available |
| Review evidence is overstated | Same context writes all lenses | Invalid governance closure | Leave objective open and promise unresolved | Obtain independent review or human exception |
| Local host runs heavy gates | Governance change triggers aggregate builds | Resource pressure | Node-only targeted checks | Reserve aggregate gate for explicit review |

## Verification matrix

| Outcome | Unit/class guard | Integration/lifecycle | User-visible/probe | Evidence path |
|---|---|---|---|---|
| Document lifecycle is enforced | verifier fixtures | governed repository check | actionable failures | completion record |
| Package boundaries stay explicit | boundary fixtures | manifest scan + existing profile gates | dependency report | completion record |
| Existing truth checks remain green | existing script tests | support/runtime/profile verifiers | command output | completion record |
| Governance remains product-semantic neutral | source-anchor review | design-freeze diff inspection | independent review pending | contract promise |

## Rollout, migration, and rollback

- The work is isolated on `governance/contract-lifecycle-harness`.
- The first governed document set is incremental; historical documents are not
  bulk-rewritten.
- No storage schema or operator data changes occur.
- Rollback is the branch-level removal of the governance additions; product data
  and runtime code remain untouched.

## Explicit non-goals

- No product redesign.
- No source adapter, storage schema, API, CLI, TUI, or Web behavior change.
- No restoration of unavailable content for previously removed objectives.
- No claim of independent review from the implementation context.

## Progress log

- **2026-07-26 — in progress:** independent branch created; target governance
  contract and coherent migration plan landed before enforcement changes.
- **2026-07-26 — technical implementation completed:** added architecture
  ownership, governed directories and lifecycle metadata, ten templates,
  document/architecture manifests and fixture-backed Node verifiers, package
  scripts, CI wiring, contributor routing, and indexed backlog history policy.
  New governance checks and the existing support/runtime/profile/Lite gates
  passed. Independent review remains a separate blocked R44 task.

## Completion record

- Final revision/commit: the single reviewable governance commit on
  `governance/contract-lifecycle-harness` containing this plan
- Contract implementation status: partial (mechanical migration implemented;
  independent adoption review outstanding)
- Contract verification status: partial
- Issues resolved/superseded: none
- Durable evidence:
  `docs/evidence/2026-07-26-repository-governance-technical-verification.md`
