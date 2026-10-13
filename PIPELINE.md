---
doc_type: pipeline
status: current
authority: normative
last_reconciled: 2026-10-12
supersedes: []
---

# Agent Execution Pipeline

This document owns work selection, execution routes, independent review and
completion in CCHistory. The [development discipline](docs/contracts/development-discipline.md)
owns collaboration, inquiry, activated concerns and actual-effect verification.
Use the smallest route that can credibly deliver the authorized outcome.

## Relationship To Other Documents

| Document | Defines | Relationship to this pipeline |
|---|---|---|
| `HIGH_LEVEL_DESIGN_FREEZE.md` | product semantics and frozen invariants | preserve or explicitly reconcile before dependent work |
| `ARCHITECTURE.md` | structural owners and dependency direction | owns implementation boundaries |
| `docs/contracts/` | current and accepted target behavior | material delivery reconciles its governing contract first |
| `docs/README.md` | authority, task context and lifecycle | select current context; history is supporting evidence |
| `docs/design/SELF_HOST_V1_RELEASE_GATE.md` | v1 release claims | applies when release completion is in scope |
| `docs/ROADMAP.md` | directional priorities | consume owner priorities within authorized work |
| `BACKLOG.md` | active portfolio state | tasks, priorities and truthful blockers |
| `AGENTS.md` | repository operations and capabilities | constrains every execution route |

## How An Agent Enters The Pipeline

1. Identify the original request, accepted interpretation, named end and current
   authority using [task context](docs/README.md#task-context). Read the relevant
   backlog state and active plan before choosing or resuming work.
2. A specific bounded request selects that work. Continue its implementation,
   integration, verification and corrections through the named end without
   repeated phase approval. A completed slice does not close its unfinished
   parent outcome. Later owner feedback steers the work unless it stops or
   replaces that end.
3. Without a specific new request, first establish whether existing authority
   covers unfinished work or ongoing work against an objective/portfolio.
   Silence, a ready task, an agent recommendation or a roadmap entry does not
   create that authority. Completing a bounded task is a valid stopping point;
   do not turn it into an unsolicited portfolio scan.
4. Within authorized ongoing work:
   - resume truthful in-progress work and diagnose blockers at their affected
     scope, continuing unaffected authorized work;
   - consume the highest-priority ready task from the declared portfolio or
     human owner; discovery does not grant authority to invent priorities;
   - if none is executable, run the read-only KR review sweep below, record
     candidates with facts, risk, dependencies and evidence limits, and consume
     declared priority only within the existing authorized scope;
   - if priority or new material scope is missing, present recommendations and
     request that owner decision before dependent implementation;
   - verify completed groups against their parent outcomes. Check roadmap or
     release claims only when included in this ongoing assignment.
5. Report the reached completion layer, residual limits and narrow blockers.
   If no authorized work remains, stop. These rules create no scheduler,
   standing autonomy charter or background-work authorization.

## Objective Lifecycle

```text
proposed -> decomposing -> active -> verifying -> done
```

- `proposed`: owner direction, without executable decomposition.
- `decomposing`: investigate facts, reconcile authority and derive acceptance.
- `active`: authorized implementation and integration are proceeding.
- `verifying`: evaluate the integrated outcome and required evidence.
- `done`: the named outcome and required evaluation pass, with final lifecycle.

A narrow explicit repair need not create an objective/KR hierarchy. Record its
scope, rationale and evidence in the existing task context. Portfolio and
multi-step material work use the backlog and plan rather than a second register.

## Cross-Cutting Execution Constraints

### Material-Change Contract Gate

Assess actual effects, users, owners, failure impact and recovery cost before
implementation. Apply the highest profile whose conditions hold:

- **routine:** authorized, bounded work within an existing owner, with low-impact
  effects, inexpensive recovery and credible focused verification. It may add
  authorized local behavior. Before new behavior, reconcile its existing
  normative owner with trigger, observable result, failure/boundaries and
  acceptance; unchanged behavior relies on the existing contract. No standalone
  contract, plan or classification record is required.
- **material:** changes a published API/event/schema/integration commitment,
  durable-state semantics or migration; needs a new normative owner,
  coordination across separately owned commitments, or substantial dependency
  or recovery planning. Local presentation behavior, incidental consumer edits
  and file count alone do not select this profile. Investigated delivery that
  cannot meet routine conditions uses this route unless high-risk applies.
- **high-risk:** changes authorization or isolation enforcement, or has a
  credible path to serious confidentiality, integrity, availability, financial,
  safety or critical user/operator harm. Broad exposure, difficult recovery or
  consequential compatibility failure can establish this profile. Architecture,
  governance and semantic changes prompt the assessment; their names alone do
  not establish risk.

Reverting code does not undo disclosure, destructive writes or privilege grants.
A one-line isolation change is high-risk; a bounded local sort can be routine.
Investigate unknown technical impact before declaring it low. Missing evidence
or reviewers never justifies a downgrade. Classification selects execution
depth, not permission; every activated owning boundary remains binding.

Material/high-risk delivery requires a current or target contract and a
complete-end-state plan on disk before dependent implementation. Name the
original request, accepted interpretation, owner, states/triggers, failure and
recovery, non-goals, compatibility, verification and review depth. Current
conflicts block the dependent path until reconciled; an explicit instruction
covering the rule change authorizes reconciliation without asking again.
Required feature-contract evidence/review applies on every route.

### Controlled Experiment

When read-only investigation cannot resolve a named technical question, use a
disposable non-production trial under the [development owner](docs/contracts/development-discipline.md#states-and-triggers).
Before running, identify existing normative owners for every activated action.
The scratch record grants no missing owner, permission, privilege or irreversible
authority. Record question, disposable path, expiry, abort trigger, containment,
cleanup owner/actions/evidence, and escalation for escape or failed cleanup.
Discard scratch implementation at conclusion/expiry. Useful findings may inform
a later delivery contract; survival never turns a trial into public behavior.

### Independent Design And Completion Review

High-risk work requires design review before implementation through independent
system/contract, user/operator and engineering/maintenance lenses, plus appropriate
specialist expertise for activated consequential concerns. Use distinct contexts
that did not produce the proposal. Supply original request/source, accepted
interpretation, contract and relevant baseline, rather than only the executor's
interpretation. Review records identify actual supplied material, context/model
where known, observations, limitations and required corrections.

A separate independent synthesis reconciles agreement/disagreement, residual
risk and any decision requiring human authority. Fix engineering defects inside
scope; escalate only an unresolved owner decision. Review concurrency follows
capability/resource limits, not a requirement to launch every worker at once.

High-risk completion requires a fresh context outside proposal/implementation
to evaluate original intent, accepted contract and observed result. Context
independence, independent evidence acquisition and model variation are distinct;
same-context sections or consensus cannot replace required evidence. If required
independence is unavailable, keep the owning scope `verifying` or `blocked`
with the exact condition unless the user grants a named scoped exception.
Technical checks may finish; they cannot waive the missing review.

### Written Coordination And Bounded Assignments

Check active plans/handoffs for shared work before edits. Record scope and
announce shared contract/fixture/file changes there; re-read shared files before
editing. Preserve other workers' changes and run affected guards after integration.
For delegation that is explicitly authorized or required by this pipeline, carry
parent outcome, delegated result, authority/baseline, allowed writes/effects,
relevant context, verification and stop/cancel condition in the assignment.
Judgment-bearing work also carries decisive assumptions, freedom to revise,
return-to-parent triggers and relevant experience locators. No second registry.

Workers return artifacts/observations, baseline identity, checks actually run,
unresolved assumptions and remaining work. The parent checks stale/conflicting
or late output, integrates it and verifies the parent outcome. Passing worker
tasks alone do not establish integration. Unknown/full context inheritance is
not proof of reduced or independent context. Ordinary delegation remains an
optional strategy subject to the current session's tool/authorization rules.

### Temporary Utilities And Command Surface

Operational convenience for the current task is not enough justification to
expand the repository-wide command surface.

- Do not add repository-wide `pnpm` scripts, CLI commands, or other user-facing
  entrypoints solely to satisfy one KR, one objective, or one temporary
  investigation.
- Before adding any new script or command, evaluate whether the operation is
  likely to be reused across future tasks, sources, hosts, or operator flows.
- If the operation is reusable, implement one stable command surface and express
  task-specific variation through flags, arguments, manifests, or input files.
  Collection is one operator workflow; do not split it into KR-specific or
  objective-specific command names when parameters can carry the difference.
- If the operation is not reusable, keep it task-scoped rather than promoting
  it into the global repository interface. A temporary helper may exist as a
  narrowly scoped script artifact or documented invocation, but it should not
  become a permanent top-level command unless it graduates into a general
  workflow.
- KR IDs, objective IDs, and other backlog-specific labels must not leak into
  canonical operator command names unless those IDs are themselves part of the
  product surface.

## The Seven Phases

The historical phase names below remain useful techniques and evidence locators.
They are not mandatory serial deliverables for every non-trivial objective.
A material plan orders actual dependencies and selects credible evidence; use
a technique only when it helps establish the claim or its owner requires it.

### Phase 1: Domain Understanding

Inspect affected current authority, code/state and primary sources. Record
decisive facts, assumptions and unknowns in existing task context; a separate
research document is needed only when reusable findings justify it. Map affected
owners/consumers. Preserve original user intent alongside its interpretation.

For adapter work, examine real formats, file layouts and all companion/sidecar
artifacts influencing derivation. Name transcript-bearing and evidence-only
inputs and capture/export coverage. Use a permitted existing generic collection
path or task-scoped helper for missing samples. A needed user action blocks that
acquisition, not other authorized work. Frozen-semantic conflicts require explicit
redesign authority before dependent changes.

### Phase 2: Test Data Preparation

Reuse valid sanitized source-shaped fixtures; add cases needed for the affected
claim and preserve existing coverage. Remove secrets and identifying content
without destroying structural fidelity. When changing `mock_data/` or its
generator/validator, run `pnpm run mock-data:validate`.

For a new source platform cover minimal and multi-turn sessions, assistant/tool
context, project/workspace signals, malformed/partial/unknown records and a
representative density or pagination case. Other work can use focused temporary
fixtures instead of inventing a platform dataset.

### Phase 3: Functional Design

Reconcile the behavior at its owner: problem, chosen approach, causal mechanism,
trade-offs, acceptance and affected consumers. Material contracts live in
`docs/contracts/`; execution order in `docs/plans/`. A feature note cannot
silently own both. Apply the independent protocol when high-risk or explicitly
required by the owning contract.

Adapter designs name derivation companions and whether they enter exportable
capture scope. Shared path/file-URI changes name required identity forms,
including UNC/authority-preserving forms when the source family can emit them.

### Phase 4: Test Case Design

Derive verification from acceptance, not implementation structure. Use a failing
behavioral guard first when it can expose the defect or protect stable semantics;
record the relevant baseline. Do not invent tests for ceremony. Artifact,
interaction, structure/perception, fault injection or observation claims require
those methods with their limits.

Cover relevant success, malformed/partial/failure, recovery and a plausible
sibling defect. Companions influencing canonical metadata need capture/export
evidence guards. Path normalization needs applicable UNC/file-URI identity
guards. For credible scale risk, test the concrete collection-growth,
accumulation or rate/concurrency mechanism under the owning budget; no universal
100/1,000-item gate substitutes for that evidence.

### Phase 5: Implementation

Implement the smallest coherent authorized change, integrate all required
producers/consumers and correct within-scope failures through the named end.
Preserve source quirks behind capture/parse, domain vocabulary, established API
patterns and authoritative raw input. Do not introduce production `any`,
hardcoded secrets or logging outside appropriate entrypoints.

Select package builds/typechecks and tests that prove affected claims under
`AGENTS.md` host constraints. Avoid root aggregate builds or adjacent suites
without a changed dependency or unresolved concern requiring them.

### Phase 6: Testing And Regression

Verify both promised behavior and actual effects at the affected boundary using
the [development rule](docs/contracts/development-discipline.md#verify-promises-and-actual-effects).
Check relevant missing/extra/excessive/suppressed/stale/wrong-identity/partial
effects, failure and recovery; helper success cannot prove external behavior.
Cross-reference acceptance to observed evidence and explicitly mark unknown/not
run claims.

Run the relevant package/profile/domain guards. Web layout changes need rendered
structure and perceptual output; meaningful Web changes need lint and appropriate
capped build. DTO/API/presentation changes select affected consumer checks by
actual coupling. Use source smoke probes when they can observe the affected
adapter. Evidence-preservation paths and changed fixture validation stay binding.
Reuse checks only while artifact/dependencies, criteria, method and freshness
remain valid; expand/repeat when changes, failures or unresolved risks justify it.

### Phase 7: Holistic Evaluation

Evaluate the integrated result against original intent and accepted contract,
including activated boundaries, functional outcome, user/operator failure and
recovery, compatibility and maintenance. A high-risk result requires the fresh
completion context above. Other work uses the smallest credible review/evidence
required by its owner, without a mandatory extra agent or report.

Use the real consumer's reachable context for a usability/discoverability claim;
record manual/runtime versus simulation limits. Correct within-scope findings
and rerun affected proof. A later invalidated pass updates/reopens the owning
work immediately; do not leave stale completed claims.

## Task Decomposition Standard

### What Makes A Task Ready For Execution

A ready task has a coherent result, credible acceptance, bounded scope, resolved
dependencies and traceability to the authorized parent outcome/current owner.
Known but non-executable work is `pending`; a proven blocker names evidence,
affected scope and recovery. Work spanning sessions leaves resumable state at
the existing plan/handoff. Routine explicit work needs no artificial KR hierarchy.

### Decomposition Process

Start from the complete acceptance outcome, identify necessary changes and proof,
order actual dependencies and split only where bounded work can proceed and
integrate coherently. A checkpoint is not owner approval and task splitting does
not replace doing the remaining parent work. Consume declared priorities.

### KR Review Sweep

This fallback applies only within authorized ongoing objective/portfolio work
when no truthful executable task covers the next outcome. Survey that authorized
scope read-only, rather than repeatedly revisiting one blocked task. Review
whether the result meets user intent, output usability/density, realistic
boundaries, operator recovery and missing regressions.

Record candidate facts, risk, dependencies, evidence limits and the smallest
truthful task/KR/objective at the existing backlog before material corrective
implementation. Execute only if existing scope and declared priority authorize
it; otherwise recommend candidates for an owner decision. Discovery alone
grants no product direction or invented ranking. A finished bounded task does
not activate this sweep.

### Granularity Guidelines

Keep research to a question, fixtures to a scenario family, implementation to a
coherent behavior and evaluation to an observable claim. Parallelize only when
independent work and integration cost justify it under current capability rules.
Do not split a coupled decision merely to occupy agents.

## Completion Evaluation

### Task Completion

The requested result is observed under functional and activated quality
boundaries, actual-effect checks and required affected guards pass, limitations
are explicit, and the existing task record is updated.

### KR Completion

Verify the integrated acceptance outcome, rather than infer it from task counts.
Complete required independent evidence and cross-task integration. Lower-level
passes do not close a missing parent claim.

### Objective Completion

Check original request and accepted end against the complete result; all required
outcomes/evaluation pass. Update final lifecycle for affected contracts, plans,
issues, guides, evidence and backlog. High-risk independence remains required.
A bounded slice may close its KR while the named larger end remains open.

### Release Gate Completion

Every condition of the claimed release gate has its own reproducible evidence.
Verify the applicable gate itself; do not infer release completion from an
objective, checker pass or an arbitrary fixed number of gate conditions.

## Backlog Format

### Structure

```markdown
## Objective: [ID] [Title]
Status: proposed | decomposing | active | verifying | done
Priority: P0 | P1 | P2 | P3
Source: owner direction | roadmap | release gate | bug report
Contract/Plan: [existing authority and execution locators]

### KR: [ID] [Title]
Status: open | active | done
Acceptance: [observable integrated outcome]

- [ ] Task: [description]
  Status: pending | ready | in_progress | blocked | done
  Acceptance: [credible verification]
  Artifact: [file or command]
```

### Rules

1. `BACKLOG.md` owns current portfolio state and declared priority; it grants
   neither ongoing authority nor product meaning.
2. Track one active coherent task per worker, with scope/coordination in the
   existing plan or handoff. Update truthful status as work changes.
3. Read relevant backlog state on entry; within authorized ongoing work, read
   the portfolio before work selection/review.
4. Record decomposition and material sweep findings at the existing parent;
   routine explicit work can remain in its task context.
5. Completed objectives stay until intentional indexed compaction into a dated
   `docs/archive/backlog/` record with stable IDs and acceptance evidence.
   Silent deletion and invented history are forbidden.
6. Contracts, plans, issues and evidence retain their separate durable roles;
   link them instead of embedding substitutes in the backlog.

## Agent Decision Points

### Must Stop And Consult The User

Pause only the dependent path after available investigation establishes missing
material intent, authority, risk acceptance outside the authorized engineering
envelope, or an unresolved conflict requiring owner judgment. Examples include
an unrequested frozen redesign, a consequential trade-off left unresolved by
review, or privileged/irreversible effects lacking permission. An explicit
instruction already covering that decision does not need renewed approval.

Name the exact source/rule, evidence, affected action, recovery option and
concrete decision. For unavailable required capability/review/owner-started
service, complete unaffected work and report the narrow blocked observation.
A fixable security or implementation defect is execution work inside authority;
uncertainty or a missing risk-budget declaration alone is not a user decision.

### May Proceed Autonomously

Investigate checkable facts, use permitted evidence-preserving fallbacks,
choose reversible engineering methods inside authority, reconcile rules the
user explicitly requested to change, prepare relevant fixtures/guards, integrate,
verify and fix within-scope failures. Preserve disagreement and report risks
truthfully; ordinary choices require no serial interviews. Stop when the bounded
named end is reached unless ongoing work has separately been authorized.
