---
doc_type: contract
status: target
authority: normative
implementation: not_started
verification_status: pending
last_reconciled: {{YYYY-MM-DD}}
supersedes: []
---

# {{Contract title}}

## Purpose

State the durable product, operator, or repository outcome.

## Scope

- In scope: {{behavior, state, interface, or boundary}}
- Out of scope: {{explicit non-goal}}

## Frozen-design anchors

- `HIGH_LEVEL_DESIGN_FREEZE.md` § {{section and invariant}}
- Runtime fact, if relevant: `docs/design/CURRENT_RUNTIME_SURFACE.md` § {{section}}
- Dated source decision: {{date, statement, and context}}

## Ownership and boundary

- Authoritative owner: `{{package/service/document}}`
- Public consumers: {{consumers}}
- Public contract: `{{type/route/event/command}}`
- Private facts consumers must not infer: {{facts}}
- Architecture enforcement: {{rule/test/verifier}}

## States and triggers

| State | Entry trigger | Allowed action | Exit trigger | Invalid transition behavior |
|---|---|---|---|---|
| `{{state}}` | {{trigger}} | {{action}} | {{trigger}} | {{error/recovery}} |

## Normative invariants

- **INV-1 — {{name}}.** {{rule and owner}}
- **INV-2 — Evidence preservation.** {{authoritative input and derived output}}

## Failure, recovery, and intervention

- Retryable/terminal classification: {{contract}}
- Timeout, restart, and duplicate behavior: {{contract}}
- User/operator recovery: {{procedure}}
- Diagnostic identity and observability: {{fields/events}}

## Compatibility, migration, and rollback

- Compatibility decision: {{atomic / versioned window / other}}
- Migration and idempotency: {{plan}}
- Rollback and irreversible boundary: {{plan}}
- Temporary compatibility removal criteria: {{criteria and owner}}

## Acceptance evidence

| Outcome | Evidence class | Guard/probe | Durable record |
|---|---|---|---|
| {{observable outcome}} | {{unit/integration/artifact/real-runtime/manual}} | `{{command}}` | {{path-or-pending}} |

## Promise register

- promise[{{stable-id}}]: due={{YYYY-MM-DD}}; status=open; owner={{owner}}; description={{concrete reconciliation commitment}}

## Reconciliation log

- **{{YYYY-MM-DD}}:** {{source ambiguity, translation error, requirement change,
  implementation regression, or evidence conflict}}
