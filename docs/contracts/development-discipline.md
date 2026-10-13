---
doc_type: contract
status: current
authority: normative
implementation: implemented
verification_status: partial
last_reconciled: 2026-10-12
supersedes: []
---

# CCHistory development and collaboration discipline

## Purpose

Deliver the owner's observable outcome with truthful evidence and bounded
engineering discretion. This adopts applicable practices from the sibling
engineering template without replacing CCHistory's product or storage authority.
Tests, documents, review records and checker success support delivery; they do
not define completion by themselves.

## Scope

Applies to project collaboration, inquiry, concern activation, implementation
and verification. `PIPELINE.md` owns execution routes, independent review and
work selection; `docs/README.md` owns context and document lifecycle;
`ARCHITECTURE.md` owns structural boundaries. Existing feature contracts own
their behavior and limits. No new product behavior, scheduler, autonomy charter,
private profile, storage migration or Python harness is introduced here.

## Frozen-design anchors

`HIGH_LEVEL_DESIGN_FREEZE.md` §§4.1, 9.3, 9.5, 10.4, 11, 12, 16 and 17 remain
binding: project-first history, `UserTurn`, canonical projections, complete
parser input, masking and explicit lifecycle. The architecture ownership matrix
and current source-absence contract retain their authority.

## Ownership and boundary

### Direction remains with the owner

The user owns purpose, priority, material trade-offs and risk acceptance. The
implementer owns reversible engineering choices inside the authorized outcome,
current contracts and capability boundaries. Investigate technical facts before
asking; ordinary decomposition, names and equivalent implementation choices
proceed without serial approval. Classification selects verification depth and
never grants authority to change behavior or evade a binding boundary.

An explicit request to update a rule authorizes reconciliation at its owner
within that request. Preserve what the user said, the proposal they accepted,
implementation choices and unresolved assumptions as distinct facts. Silence,
an agent summary or a worker's recommendation is not user acceptance.

### Blockers affect a proven path

Classify material findings as fact, risk, recommendation, human decision or
execution blocker. A blocker requires an applicable authority conflict, missing
permission, unavailable required capability/evidence/review, invalid
configuration, or a path that cannot satisfy the agreed end state. State the
evidence, affected scope, recovery option and any decision only the owner can
make. Continue unaffected authorized work. Mere uncertainty, preference,
review ceremony or discovery of a fixable defect does not create an approval
gate. A required user-started service blocks only the observation needing it.

## States and triggers

`PIPELINE.md` selects routine, controlled-experiment, material or high-risk work
from consequences and evidence. Contract reconciliation precedes dependent
material delivery; required design review precedes implementation. A trial
answers a named technical question using disposable, non-production inputs.
Before running, route its own actions through every activated concern's existing
normative owner and safety boundary; a scratch plan creates no missing owner or
permission. Record the disposable path, expiry, abort trigger, containment,
cleanup owner/actions/evidence and escalation for boundary escape or failed
cleanup. Remove scratch implementation at conclusion or expiry; useful findings
may become durable evidence. It cannot become a public interface or authorize
production exposure by surviving its expiry.

## Normative invariants

### Deliver the agreed end

Retain the original request alongside its accepted interpretation. Describe one
coherent end state; transitional states name their owner, entry/exit conditions,
compatibility and removal decision. Once authorized, continue implementation,
integration, verification and corrections through that end. Checkpoints and
independent reviews are execution work. A completed slice does not close a
larger end the owner explicitly asked to reach; later feedback steers that end
unless the owner replaces or stops it. A bounded task grants no continuing
portfolio authorization after completion.

### Research before asserting

Inspect current code, state and primary sources for unfamiliar checkable claims.
Separate observations, inference and recommendation; preserve decisive evidence
identity, acquisition scope, freshness, contrary observations and limits. An
unmatched or rejected input is not evidence of absence. If a tool fails, try a
permitted fallback preserving capability and evidence strength before declaring
the affected claim blocked. Never invent source content or downgrade a claim
silently to fit an available tool.

For consequential disagreement or a credible common blind spot, use a bounded
comparison that could change the judgment: another observation origin, question,
standpoint or authorized available model. Keep the goal and constraints fixed,
record what changed, source dependencies and first results before comparison.
Fresh context, independent acquisition and model variation are different things;
consensus cannot replace evidence. Stop at resolution, diminishing useful
returns or the declared limit and retain inconclusive results. No model choice,
delegation or resource authority is created by this rule.

### One owner, proportionate concern activation

Each invariant has one owner; consumers project its public contract. Use the
table below only when its trait is touched. Link the owning boundary in the
existing task/contract; do not fill every template or create a concern document
for each routine edit. An activated boundary applies on every execution route.
If a necessary owner is missing, establish it before dependent material delivery.

| Change trait | Concern and questions | CCHistory owner/route |
|---|---|---|
| Public interface, schema, events or consumer-visible meaning | Versions, consumers, cutover, rollback and artifact identity | Relevant contract; domain/API DTO owner and cross-stack template |
| Durable state, migration, concurrent mutation or replay | Atomicity, identity, ordering, recovery, evidence liveness and rollback | Storage/current lifecycle contract; backend and evidence-preserving-data templates |
| Permissions, identities, sensitive or untrusted inputs | Trust boundary, least privilege, abuse, audit and retention | Owning API/agent/source contract; backend authorization boundary |
| Hot path, growth, repeated accumulation or material resource cost | Scenario, budget, saturation, backpressure, degradation and recovery | Owning runtime/storage contract and measured evidence |
| Dependency failure, timeouts, retries or operator workflow | Retry eligibility, diagnostics, intervention, rollback and alert/action | Owning backend/operator contract; existing service workflow in AGENTS.md |
| External package, generated artifact, build or delivery path | Existing solution, provenance, reproducibility and unavailable-dependency behavior | Package/profile owner; current artifact/profile verifiers |
| User-visible interface or interaction | Reachable states, focus, accessibility, geometry, input, interruption and recovery | Surface contract; frontend-surface template and presentation owner |
| Date/time, calendar, duration or clock | Instant/calendar/duration distinction, source zone/offset provenance, naive-input policy, injectable clock and declared display policy | Owning adapter/domain/runtime contract; do not infer meaning from host defaults |
| Operator-visible demo/seed/sample | Honest labels/reference date, freshness if promised, repeat safety and production isolation | Owning fixture/demo contract; mock_data validator |
| Metrics, ranking, mining or dataset analysis | Scope, denominator/sample size, reproducible computation, constant origins and limitations | Canonical usage/search or analysis owner; no fabricated measured values |
| Assumption verifiable only after release | Signal, observation window, revisit/rollback threshold and decision owner | Owning feature/operator contract; no production monitoring claim from fixtures |

### Verify promises and actual effects

Derive acceptance from the request and governing owner, then check both:
promised outcomes under their triggers, and actual effects at the affected
boundary. Inspect missing, extra, excessive, wrongly suppressed, stale,
wrong-identity and partial effects when relevant. Declare the identity, allowed
count/frequency, freshness and ordering of writes, requests, notifications or
retries when they affect the result. A helper return value cannot prove a
different boundary's external behavior. For pure document edits, record that
no product/runtime/external effects are involved rather than creating an empty
effect ledger.

Use a failing behavioral guard when it can expose a defect or protect stable
semantics. Use built artifacts, real interactions, rendered structure, fault
injection or review when the claim needs those methods. Missing evidence is
unknown/not run. Preserve simulation and intervention limits. Evaluate failure
and recovery from the user's position and verify reported-environment fixes in
that environment before claiming them resolved. A fresh consumer of an operator
or user deliverable should receive only the context a real consumer has;
discoverability/usability failures belong to the deliverable.

### Fix a mechanism and retain useful experience

Preserve captured input; repair parsing, canonicalization, masking or display
without deleting real evidence. Name the defect category and a plausible sibling
case. Add a proportionate guard, or explain why none is credible. Do not expand
the fix into unrelated cleanup.

Put reusable findings where matching work starts: the existing owner, interface,
script, guide or focused review cue. Retain the mechanism, observed outcome,
conditions, limits and invalidation trigger; remove redundant incident reminders.
Reuse checks only while artifact/dependency identity, method, criteria and
freshness still support them. A changed input or missed defect invalidates the
affected result. A saved lesson proves retention; acceleration requires a later
matching task to retrieve and apply it. Memory and summaries are locators.

### Resources and scale follow a concrete mechanism

For billed, account-bound or rate-limited work, declare expected volume and a
stop bound; track actual expenditure where observable. Quota/rate-limit failures
trigger a circuit break and investigation of caching, identity, retry or
concurrency; no blind retry into the same limit or replay of completed effects.
Concurrency follows task shape and upstream limits, never a fixed preference.

Distinguish larger collections/dependency fan-out, accumulated executions/state,
and higher rate/concurrency. Activate analysis for a credible mechanism that
could change cost, correctness or recovery before harm appears. Use the smallest
discriminating scenario; 100 or 1,000 items is not a universal acceptance gate.
Stable bounded repetition may reuse valid evidence. Existing local build/memory,
service and disk-safety rules remain binding.

## Failure, recovery, and intervention

Unknown material intent, missing authority, or risk acceptance outside the
authorized engineering envelope requires a concrete owner decision after
available investigation. A missing risk-budget declaration alone does not block
locally reversible choices inside current authority and activated boundaries.
Fixable implementation failures remain execution work.
An exception records its exact rule, authority, date, scope, residual risk,
review/expiry trigger and recovery; it cannot manufacture product authorization
or reinterpret missing independence as a pass.

## Compatibility, migration, and rollback

Adoption reconciles live entrypoints, PIPELINE.md, templates, document routing
and boundary-check scope together. Historical evidence keeps its original
phase names and claims. The 2026-07 governance migration remains a separately
tracked target; this update cannot close its outstanding reviews by relabeling
them. No product DTO, storage schema or evidence reference changes.

## Acceptance evidence

Independent design lenses/synthesis and fresh completion review are required for
this governance cutover under the pre-existing PIPELINE.md rule. Acceptance
observes routine, experimental, material, high-risk, bounded-completion and
ongoing-work scenarios through the new entrypoint. Fixture-backed checks must
preserve forbidden imports, vacuous-rule rejection and repository containment
while ignoring comments/ordinary text. Passing governance fixtures proves those
mechanical claims; it does not prove sustained behavior in future agent sessions.

## Promise register

No additional future commitment or autonomous authorization is created.

## Reconciliation log

- **2026-10-11 — adoption requested:** the user asked to update project
  discipline using `../template-project`. The proposal adapts current execution,
  development, governance-boundary and context rules, preserving local product
  authority. The adopted source and scope are recorded in the linked plan.
- **2026-10-12 — cutover complete:** three independent design lenses and
  separate synthesis passed after bounded corrections; fresh completion
  evaluation passed after correcting stale R44 capability provenance. Live
  owners/templates and the module-reference guard are reconciled. Verification
  remains partial for sustained future agent use, which is not claimed by this
  delivery. Mechanical and completion evidence lives in the dated R47 reports.
