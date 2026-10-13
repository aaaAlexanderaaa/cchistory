---
doc_type: evidence
status: historical
authority: evidence
last_reconciled: 2026-10-11
subject: docs/contracts/development-discipline.md
---

# Project discipline refresh independent system review

## Scope and independence

- Original request, supplied by the parent: on 2026-10-11 the owner said
  “项目纪律也更新一下，参考../template-project” — update project discipline,
  referring to the sibling template. This permits the scoped governance
  reconciliation; it does not request product, storage, or portfolio work.
- Contract/design revision: `docs/contracts/development-discipline.md`, target,
  SHA-256 `0759ee9c731aa0de363f8cf7309bb7d75eb07e8a282bb87cea7dd56f2eb1ef0a`;
  plan `docs/plans/2026-10-11-project-discipline-refresh.md`, SHA-256
  `d508de061c263b633a7eff41c04d3bd9c3abcf0ee427152e945f22eb12e92fe3`.
- Reviewer/context identity: `/root/discipline_system_review`, a separately
  dispatched Codex review context using the inherited runtime/model settings.
  No model variation or independent source acquisition is claimed.
- Assigned lens: system consistency, authority, permission boundaries, and
  rule ownership.
- Independence basis: this context did not author the proposal or implement
  the refresh. It received the original request, assigned scope and proposal
  locations, and read the governing owners and sibling rules directly. The
  same repository/source material is shared with the other lenses.
- Required and achieved: yes for this independent design lens under the
  pre-cutover `AGENTS.md` and `PIPELINE.md`. This is neither the separate
  synthesis nor a fresh completion evaluation.
- Allowed effects: write this evidence file only. No product code, store,
  fixture, dependency, git, service, or external-system mutation.
- Expected volume: one design review and one bounded corrective recheck. The
  initial review used local read-only probes and this evidence write; no
  network retrieval, dependency install, build, or service operation ran.

## Inputs

- Local baseline: CCHistory HEAD
  `36d209ec878020d80861884a07dfc8217be4461a`. The working tree contains prior
  bounded-storage, Lite and other user changes; HEAD alone does not identify
  this review. The proposal hashes above identify the actual reviewed drafts.
- Frozen semantics: `HIGH_LEVEL_DESIGN_FREEZE.md` §§4.1, 9.3–9.5, 10.4,
  11–12, 16–18. Parser input remains independently preserved and verifiable;
  `UserTurn`, canonical text, explicit lifecycle and Full/Lite boundaries remain
  unchanged.
- Local structural and governance owners: `AGENTS.md`, `ARCHITECTURE.md`,
  `docs/README.md`, `PIPELINE.md`, `docs/contracts/repository-governance.md`,
  `architecture-rules.json`, `docs/templates/contract.md`,
  `docs/templates/implementation-plan.md` and
  `docs/templates/independent-review.md`.
- Work state: `BACKLOG.md` R47 and R44. R47 requests this scoped refresh; R44
  still owns the July migration's independent review, synthesis, branch and
  acceptance conditions.
- Sibling baseline: `../template-project` HEAD
  `1099ddc6568af5bb2e4a1d080dfc315653cbff58`; `git status --short` was empty
  when observed. Read its current `AGENTS.md`, documentation authority map,
  development, agent-execution, governance-decision-boundary and adoption
  owners, including the bounded learning/adoption and historical-debt rules.
- Source class: these are inspectable current normative source documents,
  applied against local owner/code facts. Their source quotations and prior
  adoption narratives are provenance with their stated limits, not independent
  proof that the proposed CCHistory workflow has succeeded in use.

### Baseline identities

| Reviewed local owner | SHA-256 |
|---|---|
| `AGENTS.md` | `bde1dea04bd2db2461b6f8ca930e20086aec123d2042f998fa144797f81fa2ae` |
| `PIPELINE.md` | `189b0a953c378887b5369b68c30c11448f26a749f2a82d06e53071d18f57f7ba` |
| `ARCHITECTURE.md` | `7883fb7952e254b2865850fbcb043a3b3a4a7b7550db1d87f9baee0c0204fbcb` |
| `docs/README.md` | `535d8042f4a497ddb7d267a631f78c216bfaa53e16c0e69815d15a4e0f1b30dc` |
| `docs/contracts/repository-governance.md` | `80726d6e330c66716476a5e6a59cf303999345f3b698ac84d55f71f7fdebc9ec` |

The clean sibling HEAD identifies its read files. SHA-256 for the two decisive
source owners: development
`80f957c44c67407e05c23ad6b5dacf47dba45aad90026ba00e468aaa46f516d4`;
agent execution
`7b28cfb3e78f4f077a8c12c497be6c9e20a92cb0aa53e5f47b37d34d0a6f3590`.

## Findings

| Finding | Severity | Evidence | Required action |
|---|---|---|---|
| S1. The new trial route must preserve an existing safety owner before execution. | Mandatory design correction; blocks promotion of this route, not unrelated authorized work. | Draft development discipline lines 67–72 permits a disposable trial before dependent material delivery, while lines 108–112 only explicitly require a missing owner to be established before material delivery. The sibling development owner, “Contract before material delivery, evidence before certainty” and “Activate concerns instead of expanding ceremony,” requires existing normative owners for the experiment's own activated actions and forbids a scratch record from creating that boundary. | State that every activated experiment action must use an existing normative owner and safety boundary before running; an experiment record creates neither. Require question, disposable path, expiry, abort trigger, containment, cleanup actions/evidence and escalation for boundary escape or failed cleanup. Preserve separate prior authorization for privileged or irreversible actions, and discard scratch implementation at expiry or conclusion. Project that rule through the future PIPELINE trial route. This correction is within the authorized refresh and needs no new owner approval. |
| S2. Bounded execution and priority authority are preserved. | Pass; no design blocker. | Draft “Direction remains with the owner” and “Deliver the agreed end”; plan end states 2–3 and standing-autonomy exclusions. The sibling governance and execution owners distinguish implementation discretion from direction, priority and ongoing authorization. | Keep these conditions in the live work-selection route: completing this request must not trigger a portfolio scan, invent priorities or authorize unrelated product work. Validate the promised bounded/ongoing negative scenarios. |
| S3. The authority split is coherent if the planned cutover reconciles the old clauses together. | Required implementation check; no additional design blocker. | The new development contract owns collaboration, inquiry and concern activation; PIPELINE owns execution/review/work selection; docs authority owns context/lifecycle; architecture owns dependency boundaries. Existing repository-governance target still says seven phases remain the execution contract, and old PIPELINE/templates have mandatory phase and fixed-count language. | Reconcile those operative clauses at their existing owners in the same cutover. Keep entrypoints/templates as routes or projections, without adding competing risk or concern triggers. Retain original historical evidence and source decisions rather than rewriting them. |
| S4. The proposed dependency-check repair preserves the architecture boundary in design. | Pass in design; runtime mechanism unverified. | The manifest's five rules forbid Canonical/source/Lite/DTO access to Full owners. Plan end state 5 covers static/export/type/require/dynamic literals, explicit forbidden names, relative paths, vacuous rules and unsupported dynamic forms, and retains the product-specific verifiers. | Implement and verify the stated negative fixtures; comments/ordinary text must be accepted without admitting a real forbidden reference. Do not promote a generic syntax checker into proof of the complete production graph. |
| S5. R47 does not close R44 or product/storage work. | Pass; no design blocker. | Draft compatibility section explicitly keeps the July governance migration a distinct target; plan rollout and BACKLOG R44 retain its missing review/synthesis. No DTO, schema, evidence-reference or runtime redesign is proposed. | Preserve R44's target/partial states and acceptance until its own evidence is acquired. This review is for R47 and cannot be relabeled to satisfy R44. Do not imply that old unavailable-worker wording proves present tool unavailability. |

### Reversible engineering feedback

The plan already scopes the migration and lists applicability/gaps. Add precise
source-owner/heading locators to its comparison or final verification, and
label retained already-covered practices as corroboration. This will make a
future reader able to distinguish adapted rules from deliberate exclusions
without importing the template's Python harness, personal-context paths,
autonomy charter or formal-adoption machinery. This is maintainability feedback,
not a reason to pause implementation or ask the owner to approve a method.

## Trade-offs and residual risk

- Recommended approach: adapt the selected current source practices at the
  existing CCHistory owners, correct S1, then reconcile entrypoints, templates
  and mechanical enforcement atomically. Keep the independent lenses,
  separate synthesis and completion evaluation required for this cutover.
- Rejected alternative and reason: wholesale template copy would duplicate
  rule owners, import unrelated adoption/runtime obligations and obscure the
  local freeze. Retaining universal seven-phase and numeric scale gates would
  keep the identified ceremony without strengthening evidence for each claim.
- Residual risk: consequence-based classification requires judgment. A fresh
  evaluator must reject an authorization/isolation change labeled routine,
  unavailable evidence used to downgrade risk, and a trial lacking an existing
  safety owner. A checker pass cannot prove future agent behavior.
- Residual risk: all reviewers use shared local normative sources and baseline;
  agreement can still share source errors. No independent empirical adoption,
  model variation or sustained execution evidence is supplied here.

## Limitations

- This is a pre-implementation design review. The live entrypoints, templates,
  architecture scanner and tests have not yet changed, and no test pass or
  implemented workflow is claimed.
- I received the original request via the parent assignment, rather than
  acquiring the owner's conversation independently. This context did not
  author or implement the proposal. It makes no claim of private-context
  reduction or independent source acquisition.
- The exact model identifier is not exposed to this reviewer; the supplied
  system identity is Codex in the GPT-6 family with inherited settings.
- Only activated system/authority owners were examined. I did not review every
  sibling specialist guide or perform a formal template-wide adoption. The
  local plan intentionally selects practices, and excludes unrelated standing
  autonomy/private-profile/Python machinery.
- No real store, source capture, product state, persistent service or external
  effect was exercised. Freeze preservation is a proposal/owner comparison,
  not a storage regression result.
- No governance exception was requested or granted. Missing later synthesis,
  completion review or mechanical evidence remains missing.

## Bounded corrective recheck

After reporting S1, I read the corrected target contract and plan directly.
The rechecked contract SHA-256 is
`357c7611252f139d1c2b665604c7df2ce3690be8832761af76d5a319e4b76238`;
the rechecked plan SHA-256 is
`90f10d0f5c7746a435d41b65d2d6dbd7b3981d20e45c749ff532d9e92e4e76a7`.
The source and local old-owner baselines above were unchanged during this
bounded design recheck.

S1 is resolved. The “States and triggers” section now requires every activated
experiment action to use an existing normative owner and safety boundary before
running, states that a scratch plan creates no owner or permission, and records
expiry, abort, containment, cleanup owner/actions/evidence and escalation.
Scratch implementation is removed at conclusion or expiry. Together with the
unchanged authorized-outcome/current-contract/capability boundary, this grants
no privileged or irreversible authority. The amended failure section also
distinguishes unknown material intent or missing authority from an ordinary
reversible choice lacking a separate risk-budget declaration.

The plan now specifies the existing TypeScript SourceFile parser and preserves
explicit matching modes, containment, symlink and vacuity guards, while naming
loader-alias/eval/path-alias/transitive-graph limitations. This makes S4's
verification scope more explicit without widening product dependencies.
No new design blocker was found. S3–S5 still require the planned implementation
and completion evidence; this recheck does not claim they have run.

## Verdict

`PASS`

The proposed owner split, bounded stopping rule, evidence discipline and
architecture-check scope are consistent with CCHistory's frozen invariants.
The initial verdict was `PARTIAL`; the bounded corrective recheck resolves S1
and passes the corrected design. S3–S5 remain explicit cutover/completion
conditions already within the proposed plan and require no new user decision.
Implementation, separate synthesis, fresh completion evaluation and R44's own
outstanding acceptance are separate claims.
