---
doc_type: contract
status: target
authority: normative
implementation: not_started
verification_status: pending
last_reconciled: {{YYYY-MM-DD}}
supersedes: []
---

# {{Cross-stack outcome}} contract

## User or operator outcome

{{Complete end-to-end result, not only an endpoint or component.}}

## Frozen-design anchors

- `HIGH_LEVEL_DESIGN_FREEZE.md` § {{section}}
- `ARCHITECTURE.md` § {{owner/boundary}}

## Shared vocabulary and state matrix

| Canonical state | Backend truth | DTO projection | Frontend behavior |
|---|---|---|---|
| {{state}} | {{owner/facts}} | {{fields/error}} | {{visible state/action}} |

Include loading, empty, stale, partial, unauthorized, conflict, retryable, and
terminal states when reachable.

## Ownership boundary

- Backend owns: {{domain truth, mutation, persistence}}
- Frontend owns: {{interaction, presentation, local ephemeral state}}
- Forbidden duplicated rules: {{rules}}

## Interface contract

- Request/response/event and version: {{contract}}
- Error, cursor/count/status consistency: {{contract}}
- Idempotency/concurrency/recovery: {{contract}}

## Frontend surface projection

- Surface contract: `docs/design/{{surface}}.md`
- Layout, focus, accessibility, and responsive behavior: {{summary}}
- Full evidence access versus masked display: {{behavior}}

## Compatibility and cutover

- Producer/consumer order: {{order}}
- Compatibility window and removal criteria: {{policy}}
- Rollback and data limitation: {{plan}}

## End-to-end acceptance matrix

| Scenario | Backend evidence | DTO consistency | User-visible evidence | Result |
|---|---|---|---|---|
| {{scenario}} | {{check}} | {{check}} | {{check}} | {{result}} |

## Failure-category guards

- {{Reported category and sibling variant covered by the guard.}}

## Reconciliation log

- **{{YYYY-MM-DD}}:** {{change and reason}}
