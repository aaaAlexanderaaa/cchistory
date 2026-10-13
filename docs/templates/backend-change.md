---
doc_type: contract
status: target
authority: normative
implementation: not_started
verification_status: pending
last_reconciled: {{YYYY-MM-DD}}
supersedes: []
---

# {{Backend change}} contract

## Outcome and scope

- Outcome: {{observable system/operator result}}
- Original request/source and accepted interpretation: {{separate facts}}
- In scope: {{state/interface/lifecycle}}
- Out of scope: {{non-goal}}

Apply only activated concerns at their owners under the development discipline.
Routine changes reconcile an existing owner without a new standalone contract.

## Frozen-design and architecture anchors

- Product semantics: `HIGH_LEVEL_DESIGN_FREEZE.md` § {{section}}
- Structural owner: `ARCHITECTURE.md` § {{section}}

## Ownership

- State/invariant owner: `{{package/service}}`
- Consumers: {{consumers}}
- Consumers must not know: {{private implementation}}

## Public interface

| Request/event/command | Version | Success result | Typed errors | Compatibility |
|---|---|---|---|---|
| `{{interface}}` | {{version}} | {{result}} | {{errors}} | {{policy}} |

## State machine

| From | Trigger | To | Persisted facts | Invalid behavior |
|---|---|---|---|---|
| `{{state}}` | {{trigger}} | `{{state}}` | {{facts}} | {{error}} |

## Concurrency, ordering, and idempotency

- Identity/deduplication key: {{key}}
- Concurrent owner/order behavior: {{behavior}}
- Retry and duplicate delivery: {{behavior}}
- Allowed effect count/frequency, freshness and ordering: {{contract when relevant}}

## Failure and recovery

- Timeout and retry eligibility: {{rules}}
- Partial write/restart recovery: {{rules}}
- Operator intervention and diagnostics: {{rules}}

## Persistence, evidence, and migration

- Authoritative input versus derived output: {{boundary}}
- Transaction/integrity behavior: {{rules}}
- Migration/rollback/point of no return: {{plan}}
- Evidence-reference inventory and all prune sites: {{paths}}

## Authorization and capability boundary

- Caller/capability: {{minimum permission}}
- Unauthorized behavior and audit identity: {{contract}}

## Observability

- Logs/events/metrics/audit fields: {{fields}}
- Correlation and replay identity: {{identity}}

## Class-level acceptance tests

| Invariant/failure class | Controlled boundary | Expected result | Evidence |
|---|---|---|---|
| {{class}} | {{fixture/fake/fault}} | {{behavior}} | `{{test}}` |

Observe promises and actual effects at the mutation/integration boundary,
including relevant missing/extra/excessive/stale/wrong-identity/partial effects.
Helper success does not prove external behavior. Name actual versus simulated
evidence and valid reuse identities, dependencies, method, criteria and freshness.

## Reconciliation log

- **{{YYYY-MM-DD}}:** {{change and reason}}
