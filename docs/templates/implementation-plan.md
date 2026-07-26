---
doc_type: plan
status: active
authority: planning
last_reconciled: {{YYYY-MM-DD}}
implements: docs/contracts/{{contract}}.md
supersedes: []
---

# {{Initiative}} implementation plan

## Cold-start summary

Record the outcome, current verified facts, governing authority, risk profile,
and next executable action.

## Authority and risk classification

- Design freeze: `HIGH_LEVEL_DESIGN_FREEZE.md` § {{section}}
- Architecture: `ARCHITECTURE.md` § {{section}}
- Contract: `docs/contracts/{{contract}}.md`
- Backlog objective/task: {{id}}
- Risk: `{{routine / material / high-risk}}` because {{reason}}

## Complete end state

{{Coherent final behavior; temporary phases are not the target architecture.}}

## Current state and gap

| Concern | Verified current fact | Contracted target | Gap/evidence |
|---|---|---|---|
| {{concern}} | {{fact}} | {{target}} | {{gap}} |

## Seven-phase execution record

| Phase | Required output | Result/evidence or non-applicability reason |
|---|---|---|
| 1. Domain understanding | authority, terms, affected paths | {{record}} |
| 2. Fixtures | sanitized source-shaped evidence/controlled boundary | {{record}} |
| 3. Functional design | contract, trade-offs, acceptance | {{record}} |
| 4. Tests first | acceptance checks observed failing | {{record}} |
| 5. Implementation | smallest coherent change | {{record}} |
| 6. Regression | affected and adjacent checks | {{record}} |
| 7. Holistic evaluation | fresh-context report/blocked/exception | {{record}} |

## Review topology

- Independent system/design-freeze lens: {{reviewer/result}}
- Independent user/operator lens: {{reviewer/result}}
- Independent engineering/maintenance lens: {{reviewer/result}}
- Separate synthesis and human decisions: {{reviewer/result}}
- Governance exception, if any: {{authority/scope/date/residual risk}}

## Risk register

| Risk | Trigger | Impact | Guard | Recovery |
|---|---|---|---|---|
| {{risk}} | {{trigger}} | {{impact}} | {{guard}} | {{action}} |

## Verification matrix

| Outcome | Evidence class | Command/probe | Negative path | Durable record |
|---|---|---|---|---|
| {{outcome}} | {{class}} | `{{command}}` | {{failure check}} | {{path}} |

## Rollout, migration, and rollback

- Deployment/migration order: {{plan}}
- Preflight and backup: {{plan}}
- Abort signal and rollback: {{plan}}
- Temp-artifact cleanup owner: {{owner}}

## Progress and completion record

- Current step and truthful blockers: {{state}}
- Task/KR/objective/release completion layers: {{separate states}}
- Contract/plan/issue/evidence updates: {{paths}}
- Final revision and limitations: {{pending-or-result}}
