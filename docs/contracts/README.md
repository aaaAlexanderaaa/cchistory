---
doc_type: directory-index
status: current
authority: guidance
last_reconciled: 2026-07-26
---

# Contracts

This directory owns long-lived, normative behavior that spans packages,
surfaces, data lifecycles, or repository governance. Current contracts describe
present obligations; target contracts describe an accepted future state and
must not be cited as proof that implementation already exists.

Use the matching file in `docs/templates/`. A material implementation plan
links back with `implements`. Conflicts move the affected contract to
`needs_reconciliation`; plans and evidence cannot override it.

Current inventory:

- `repository-governance.md` — incremental documentation lifecycle,
  architecture ownership, AI review, and mechanical enforcement.
- `source-absence-retention.md` — Full sync must retain raw evidence and
  derived history when an upstream source path disappears, project
  `source_absent`, and reserve deletion of that retained path history for
  explicit purge.
