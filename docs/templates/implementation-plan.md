---
doc_type: plan
status: active
authority: planning
last_reconciled: {{YYYY-MM-DD}}
implements: docs/contracts/{{contract}}.md
supersedes: []
---

# {{Initiative}} implementation plan

Use for material/high-risk delivery under `PIPELINE.md`; routine work uses its
existing task/owner. Apply only activated concerns from the development discipline.

## Cold-start summary

Record original request/source separately from accepted interpretation, named end,
verified facts, authority/allowed effects, boundaries, evidence and next action.

## Authority and risk classification

- Design freeze: `HIGH_LEVEL_DESIGN_FREEZE.md` § {{section}}
- Architecture: `ARCHITECTURE.md` § {{section}}
- Contract: `docs/contracts/{{contract}}.md`
- Backlog objective/task: {{id}}
- Risk: `{{material / high-risk}}` because {{actual effects, harm and recovery}}
- Activated owners/required proof: {{links; no per-concern duplicate documents}}
- Assumptions and owner-only decisions: {{facts versus inference; none or scope}}

## Complete end state

{{Coherent final behavior; temporary phases are not the target architecture.}}

## Current state and gap

| Concern | Verified current fact | Contracted target | Gap/evidence |
|---|---|---|---|
| {{concern}} | {{fact}} | {{target}} | {{gap}} |

## Execution and verification

Order actual dependencies. Historical phases are optional techniques. Select
failing guards when meaningful; otherwise name credible artifact, observation,
interaction or review evidence. Do not invent tests or fixed scale counts.

| Step | Dependency / observable result | Proof and limits | State / evidence |
|---|---|---|---|
| {{step}} | {{prerequisite/result}} | {{baseline/method}} | {{status/path}} |

## Review topology

Complete when high-risk or an owning contract requires it; otherwise state why
not required. Do not add independent reviews for routine/material ceremony.

- Independent system/design-freeze lens: {{reviewer/result}}
- Independent user/operator lens: {{reviewer/result}}
- Independent engineering/maintenance lens: {{reviewer/result}}
- Separate synthesis and human decisions: {{reviewer/result}}
- Governance exception, if any: {{authority/scope/date/residual risk}}
- Required fresh completion context: {{reviewer/result or not required}}
- Context/source/model independence and actual supplied material: {{limits}}

## Risk register

| Risk | Trigger | Impact | Guard | Recovery |
|---|---|---|---|---|
| {{risk}} | {{trigger}} | {{impact}} | {{guard}} | {{action}} |

## Verification matrix

| Original/contracted outcome and actual effect | Evidence class | Command/probe | Negative path | Durable record |
|---|---|---|---|---|
| {{outcome}} | {{class}} | `{{command}}` | {{failure check}} | {{path}} |

## Rollout, migration, and rollback

- Deployment/migration order: {{plan}}
- Preflight and backup: {{plan}}
- Abort signal and rollback: {{plan}}
- Temp-artifact cleanup owner: {{owner}}
- Trial, if needed: {{question, existing safety owners, disposable path, expiry,
  abort, containment, cleanup evidence and escape/failed-cleanup escalation}}

## Progress and completion record

- Current step and truthful blockers: {{state}}
- Task/KR/objective/release completion layers: {{separate states}}
- Contract/plan/issue/evidence updates: {{paths}}
- Final revision and limitations: {{pending-or-result}}
- Other shared work and integration/handoff state: {{scope/baseline/next action}}
- Bounded end / ongoing authorization and priority source: {{actual authority}}
