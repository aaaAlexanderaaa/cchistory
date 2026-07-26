---
doc_type: surface-contract
status: target
authority: normative
implementation: not_started
verification_status: pending
last_reconciled: {{YYYY-MM-DD}}
supersedes: []
---

# {{Surface}} frontend contract

## User outcome

Describe what the user can understand or accomplish.

## Raw stakeholder layer

### raw[1] — {{YYYY-MM-DD}}

> “{{Verbatim user, operator, or product statement.}}”

Context: {{source}}

## Translated surface contract

### Outcomes and hierarchy

{{Engineering translation of the raw requirement.}}

- from: raw[{{N}}]

## Reachable states

| State | Trigger/data | Visible content | Available actions | Exit/recovery |
|---|---|---|---|---|
| {{loading/empty/populated/error/stale/unauthorized/etc.}} | {{condition}} | {{projection}} | {{actions}} | {{behavior}} |

## Layout and size contract

- Narrow/intermediate/wide behavior: {{geometry}}
- Repeated-instance and two-axis containment: {{rules}}
- Scrolling, density, truncation, and full-evidence access: {{rules}}

## Interaction, focus, and accessibility

| Trigger/input | State transition | Focus/announcement | Failure feedback |
|---|---|---|---|
| {{mouse/keyboard/touch}} | {{transition}} | {{behavior}} | {{feedback}} |

## Backend projection boundary

- Canonical DTO/state owner: `{{owner}}`
- Presentation-only state owned here: {{state}}
- Business rules the client must not reconstruct: {{rules}}

## Responsive and support targets

- Browsers/devices/input methods: {{targets}}
- Accessibility target: {{target}}
- Intermediate ranges to exercise: {{ranges}}

## Verification matrix

| State/range | Structural evidence | Perceptual evidence | Interaction evidence | Result record |
|---|---|---|---|---|
| {{case}} | {{measurement/test}} | {{screenshot/review}} | {{probe}} | {{path}} |

## Known abnormality classes

- abnormality[{{stable-id}}]: state=pending; evidence=pending:{{YYYY-MM-DD}}; guard=pending; description={{class-wide visual or interaction risk}}

## Reconciliation log

- **{{YYYY-MM-DD}}:** {{raw-to-translated correction or requirement change}}
