---
doc_type: contract
status: target
authority: normative
implementation: not_started
verification_status: pending
last_reconciled: {{YYYY-MM-DD}}
supersedes: []
---

# {{Data boundary}} evidence-preservation contract

## Scope and value hierarchy

- Boundary: {{capture/parse/store/migrate/export/GC}}
- Tier 1 user/source input: {{fields and loss policy}}
- Tier 2 interaction/process evidence: {{fields and policy}}
- Tier 3 derived optimizations: {{fields and rebuild policy}}

## Authoritative input and derived output

- Authoritative bytes/records: {{identity}}
- Integrity mechanism: {{checksum/content address}}
- Derived representations: {{rows/indexes/cache/projection}}
- Rebuild inputs and version identity: {{procedure}}

## Preservation invariants

- {{Lossless rule for tier-1 content.}}
- {{Bounded-field sizing or full-storage rule.}}
- {{Projection/masking behavior that retains evidence.}}

## Evidence reference inventory

| Reference owner/field | Target | Create/update | Export/import | Prune/retire | Guard |
|---|---|---|---|---|---|
| `{{owner.field}}` | {{identity}} | {{path}} | {{path}} | {{all paths}} | {{test}} |

## Migration, capacity, and cleanup

- Disk/headroom preflight: {{check}}
- Snapshot/backup and integrity comparison: {{plan}}
- Idempotency/resume/rollback: {{plan}}
- Point of no return and human authority: {{decision}}
- Temporary artifact cleanup in `finally`: {{owner}}

## Acceptance evidence

| Preservation claim | Category-level guard | Fault/round-trip check | Durable evidence |
|---|---|---|---|
| {{claim}} | {{test}} | {{check}} | {{path}} |

## Reconciliation log

- **{{YYYY-MM-DD}}:** {{requirement, implementation, or evidence change}}
