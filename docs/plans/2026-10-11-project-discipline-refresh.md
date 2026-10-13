---
doc_type: plan
status: completed
authority: planning
last_reconciled: 2026-10-12
implements: docs/contracts/development-discipline.md
supersedes: []
---

# Project discipline refresh from the engineering template

## Cold-start summary

On 2026-10-11 the user requested an update to CCHistory's project discipline,
referencing `../template-project`. CCHistory is an existing Full/Lite history
product, not the engineering template. Its freeze, architecture, source/retention
contracts, Node/pnpm harness and ongoing changes remain authoritative.

The sibling's inspected rules use outcome-driven, consequence-based routes.
The pre-cutover CCHistory baseline mandated seven phases, fixed scale counts,
automatic portfolio fallback without explicit ongoing authorization, and broad
user escalation. Its architecture checker also flags three harmless Lite
comments as dependencies. Adopt the applicable rules at local owners and repair
that check's mechanism. Do not copy the sibling repository or Python toolchain.

## Authority and risk classification

- Source: user request to update project discipline; this is adoption authority
  for governance and its checks, not authorization for new product behavior.
- Design freeze: §§4.1, 9.3, 9.5, 10.4, 11, 12, 16, 17.
- Architecture: ownership matrix, dependency direction and architecture enforcement.
- Contract: `docs/contracts/development-discipline.md`.
- Existing lifecycle authority: `docs/contracts/repository-governance.md`.
- Risk: high-risk under the pre-cutover PIPELINE.md governance classification;
  wrong authority/work-selection rules could authorize broad unintended work,
  and a weakened dependency guard could miss Full access from Lite.
- Original request and accepted scope: update project discipline against the
  supplied local template. Implementation structure is the implementer's choice.
  No further human-owned decision is known; required reviews are execution work.

## Complete end state

1. AGENTS.md routes to current task context, collaboration and execution owners.
2. PIPELINE.md chooses the smallest consequence-based route; seven phases remain
   usable techniques/history, not mandatory serial deliverables.
3. Authorized work continues to its named end without repeated phase approval;
   bounded completion does not start unsolicited portfolio work.
4. Templates and the authority map preserve original intent, actual effects,
   independent-context limits, reusable evidence and conditional scale concerns.
5. The architecture guard checks declared module references, including static,
   export, type, require and dynamic literal forms. It ignores comments/ordinary
   content; explicit forbidden names and repository-relative paths remain
   prohibited. Vacuous rules, bad modes, escapes and unsupported dynamic forms
   fail explicitly rather than passing as understood dependencies.
6. Relevant governance checks and a fresh consumer review pass. Historical
   evidence, existing user edits, frozen semantics and real stores remain intact.

## Current state and gap

This is the inspected pre-cutover baseline; closure is recorded below.

| Rule/owner | Current repository result | Change |
|---|---|---|
| Truth/ownership and evidence preservation | Already satisfied by freeze, architecture, storage and absence contracts | Preserve; route to existing owners |
| Authorization and bounded stopping | PIPELINE fallback/escalation is too broad | Reconcile entry and decision rules |
| Consequence-based execution | Fixed phases and noun-based high-risk classification | Update PIPELINE; retain required review for actual high risk and this cutover |
| Concern activation and inquiry | Distributed templates, no shared trigger owner or fallback/comparison rule | Adopt development-discipline contract and concise entry routes |
| Effect verification and reuse | Evidence classes exist; actual effect/reuse conditions mostly absent | Extend existing templates and closure rules |
| Documentation stock/context | Incremental adoption exists; context mostly startup lists | Add task context, current/history distinction and ownership-based subtraction |
| Dependency guard | Plain text comments cause aggregate governance failure | Explicit module-reference mode, syntax-aware checks and negative fixtures |
| Standing unattended autonomy | No charter/cadence requested | Not adopted as a new runtime or ongoing authorization |
| Private personal context | No separate profile supplied | No private/context copy; keep rules audience-safe |
| Analytical/time/demo disciplines | Relevant when corresponding product work activates them | Local concern routing; no current runtime redesign or fabricated capacity proof |

## Seven-phase execution record

This cutover satisfies the existing pre-update review rule. Later work uses the
new route; historical phase names remain readable.

| Phase | Output/evidence | State |
|---|---|---|
| Understanding | Template/current-owner comparison and scoped plan | done |
| Fixtures | Existing cases plus 31 architecture guards | done |
| Design | Three lenses PASS after bounded corrections; separate synthesis PASS | done |
| Verification design | Expanded architecture baseline: 18 pass, 13 fail; fresh consumer scenarios selected | done |
| Implementation | Reconcile owners/entrypoints/templates and checker | done |
| Regression | Governance 49/49; support/runtime/profile and node-only Lite boundary checks; 35 links | done |
| Completion | Fresh consumer evaluation PASS after bounded R44 provenance correction; lifecycle reconciled | done |

## Review topology

Required by the current AGENTS.md/PIPELINE.md governance gate: independent
system/authority, user/operator and engineering/cost lenses; separate synthesis;
fresh completion evaluation. Reviewers read the original request and local
template as well as this proposal. No governance exception.

## Risk register

| Risk | Guard/recovery |
|---|---|
| Loosen rules to avoid review | Actual consequences select risk; no downgrade for unavailable evidence; this cutover uses old mandatory independent review |
| New route silently licenses portfolio work | Bounded and ongoing scenarios, explicit authorization and priority source |
| AST filter misses real dependency | Static/export/type/require/dynamic/escaped and relative-path fixtures; nonliteral fail-closed; domain graph verifier remains owner |
| Double owners or broken references | Routing/heading review and document checker; current owners updated together |
| Rewrite unrelated product/user changes | Only governance/docs/checker scope; record baseline and inspect scoped diff |
| Claim sustained adoption from checker pass | Fresh consumer scenarios with limitations; no sustained-runtime claim |

## Verification matrix

| Outcome | Evidence | Method |
|---|---|---|
| Entry chooses routine/experiment/material/high-risk | Fresh-context consumer scenarios | Independent evaluator reads only entrypoint and routed owners |
| Named end and bounded completion preserved | Positive/negative decision scenarios | Compare original request, instructions and route outcome |
| Imports blocked; comments accepted | Meaningful Node fixtures | Architecture suite, including existing failing repository check |
| Templates protect effects/identity and optional review | Template negative guards | Governance suite and document policy |
| Existing domain checks remain intact | Current node-only verifiers | support-status, runtime-inventory, product-profiles, `node scripts/verify-lite-boundaries.mjs` (not full Lite test profile) |
| Frozen semantics/stores/user changes preserved | Scoped diff review | No product code, store/schema mutation or fixture trimming |

## Rollout, migration, and rollback

Land target contract and plan before material edits; review before implementation.
Update current owners/templates together, then promote the new discipline only
after fresh evaluation. Keep existing Node commands/CI entrypoints and manifest
version with an explicit per-rule matching mode; no dependency installation.
Historical governance targets and storage review blockers retain their states.
Rollback restores these governance files; no durable product migration occurs.

Dependency-check design: keep manifest version 1 with explicit per-rule `match`
values `literal` (legacy text scope) and `module-specifier` (selected for the five
current dependency rules). Use the existing TypeScript SourceFile parser, not a
compiler Program or build. Decode module literals, cover import/export,
ImportEquals/ImportType, literal import()/require(), and normalize relative paths
against the importing file. Add package-path patterns beside package names.
Reject invalid mode, syntax and recognized nonliteral loaders. Preserve scan
containment, symlink and vacuity guards. Arbitrary loader aliases/eval, compiler
path aliases and transitive runtime dependency graphs remain outside this static
guard; the owning domain verifiers and builds still cover their stated scopes.

## Progress and completion record

- Current step: complete. Independent design, live cutover, focused guards,
  fresh completion review and final document lifecycle checks pass.
- Work scope: root AGENTS.md/PIPELINE.md/ARCHITECTURE.md/BACKLOG.md, docs authority,
  discipline/governance contracts, templates/policy and architecture checker/tests.
  No worker edits product code. Shared changes are announced in this plan.
- Source checkout: `../template-project`, HEAD
  `1099ddc6568af5bb2e4a1d080dfc315653cbff58`; working-tree source identities are
  recorded in final verification (HEAD alone does not identify dirty sources).
- Local comparison: rules for development, agent execution, governance boundary,
  documentation/context, project adoption and activated time/data concerns.
- Design evidence: `docs/evidence/2026-10-11-discipline-system-review.md`,
  `2026-10-11-discipline-operator-review.md`, `2026-10-11-discipline-cost-review.md`
  and `2026-10-11-discipline-design-synthesis.md` in the same directory. The
  synthesis resumed after a credit interruption; no repeated quota retry and no
  substitute for independence. User resumed on October 12.
- Mechanical evidence: `docs/evidence/2026-10-12-project-discipline-verification.md`;
  completion: `docs/evidence/2026-10-12-discipline-completion-evaluation.md`.
- Fresh review found stale July capability wording in R44's current backlog;
  the bounded recheck passed after attributing that restriction historically
  and retaining R44's own missing review/synthesis closure gate. No R44 state,
  July acceptance, branch promise or remaining storage delivery was closed.
- Closure: R47-KR1 and R47 complete on October 12; development discipline is
  current/implemented with partial verification for unobserved sustained use.
