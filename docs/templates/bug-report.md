---
doc_type: issue-tracker
status: active
authority: evidence
last_reconciled: {{YYYY-MM-DD}}
subject: {{surface-or-invariant}}
---

# {{Issue title}} bug report

## Summary

One-sentence description of the problem and user-visible impact.

## Surface

- [ ] CLI
- [ ] API
- [ ] Web
- [ ] source-adapter
- [ ] storage/linking
- [ ] docs/process

## Affected area

- Platform/source:
- Source id:
- Session id:
- Turn id:
- Project id:
- Store path:

Leave unknown fields blank rather than guessing.

## Reproduction steps

1.
2.
3.

## Expected behavior

What should have happened?

## Actual behavior

What happened instead?

## Evidence

### Commands / payloads

```text
Paste the smallest command output or request/response here.
```

### Paths / ids

- Relevant file path(s):
- Relevant source/session/turn/project ids:

### Screenshot (if UI bug)

Attach screenshot(s) and describe what they show.

## Scope check

- [ ] looks isolated
- [ ] possibly class-wide
- [ ] unknown

Notes:

## Category and root mechanism

- Suspected category: {{parsing / ingestion / masking / rendering / lifecycle / other}}
- Root mechanism after investigation: {{mechanism-or-pending}}
- Sibling variants checked: {{inputs-or-surfaces}}

## Contract impact

- Governing contract/design-freeze section: {{path-and-section}}
- Classification: {{implementation regression / ambiguity / requirement change / evidence conflict}}

## Decision and resolution

- Decision: {{repair / reconcile / defer with authority}}
- Class-level guard: {{test-or-runtime-check}}
- Resolution revision and evidence: {{pending-or-links}}

## Evidence-preservation checklist

- [ ] I did not delete or rewrite raw evidence to make the symptom disappear.
- [ ] I included the smallest proving command, payload, or screenshot.
- [ ] I included expected vs actual behavior.
- [ ] I included source/platform context if relevant.
