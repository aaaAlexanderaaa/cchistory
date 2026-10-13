---
doc_type: evidence
status: historical
authority: evidence
last_reconciled: {{YYYY-MM-DD}}
subject: {{contract-objective-or-release}}
---

# {{Initiative}} verification report

## Claim and evidence class

- Claim/completion layer: {{claim and task/KR/objective/release}}
- Original request/source and accepted interpretation: {{distinct locators}}
- Contract and revision: `{{path-and-revision}}`
- Evidence class: {{unit/integration/source-shaped/artifact/real-runtime/manual}}
- What this class does not prove: {{limitation}}

## Environment

- Timestamp/timezone: {{value}}
- Runtime/platform/configuration: {{value}}
- Fixture/source/store identity without secrets: {{value}}
- Reproduction command: `{{command}}`

## Result matrix

| Scenario/state | Expected | Observed evidence | Result |
|---|---|---|---|
| {{case}} | {{contract}} | {{result}} | pass/fail/partial |

## Actual effects and evidence reuse

Check promises against observations at the affected boundary in both directions:
missing, extra, excessive, suppressed, stale, wrong-identity and partial effects
when relevant. Name identity, allowed count/frequency, freshness and ordering for
writes/requests/retries/notifications affecting the result. For pure docs, state
that no product/runtime/external effects apply; no empty effect ledger.

- Effect boundary and observed identity/count: {{facts and method, not helper success}}
- Reused proof: {{artifact/dependency identity, criteria, method, freshness}}
- Simulation/intervention and acquisition limits: {{actual versus unknown/not run}}

## Failure and recovery checks

| Failure class | Injection/reproduction | Expected recovery | Observed | Result |
|---|---|---|---|---|
| {{class}} | {{method}} | {{behavior}} | {{result}} | pass/fail |

## Data and fixture preservation

- Raw/input evidence retained at: {{path/identity/not-applicable}}
- Derived output identity: {{path/identity}}
- Sanitization and integrity method: {{method}}
- Temporary artifact cleanup: {{result}}

## Anomalies and limitations

- Anomalies/issues: {{none or links}}
- Uncovered states/environments: {{limitations}}
- Independent review status: {{achieved/not-required/blocked/exception}}

## Verdict

`{{PASS / FAIL / PARTIAL / BLOCKED}}`

State exactly which completion layer may close and which claims remain open.
Check the original named end as well as the accepted contract. Passing a slice
does not close its unfinished parent; sustained adoption requires later evidence.
