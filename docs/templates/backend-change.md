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
- In scope: {{state/interface/lifecycle}}
- Out of scope: {{non-goal}}

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

## Reconciliation log

- **{{YYYY-MM-DD}}:** {{change and reason}}
