---
doc_type: directory-index
status: current
authority: guidance
last_reconciled: 2026-10-12
---

# Contracts

This directory owns long-lived, normative behavior that spans packages,
surfaces, data lifecycles, or repository governance. Current contracts describe
present obligations; target contracts describe an accepted future state and
must not be cited as proof that implementation already exists.

Use the matching file in `docs/templates/`. A material implementation plan
links back with `implements`. Conflicts move the affected contract to
`needs_reconciliation`; plans and evidence cannot override it.

Contract routes (read each record's lifecycle before use):

- `repository-governance.md` — incremental documentation lifecycle,
  architecture ownership, AI review and mechanical enforcement; July migration
  remains a separate target with outstanding acceptance.
- [Development discipline](development-discipline.md) — collaboration, inquiry,
  activated concerns and promises/actual-effect verification; execution routes
  belong to `PIPELINE.md`.
- [Bounded Full storage](bounded-full-storage.md) — accepted optimization scope,
  first delivery and later retention/append/cache boundaries; not proof that all
  target deliveries are implemented.
- `source-absence-retention.md` — Full sync must retain raw evidence and
  derived history when an upstream source path disappears, project
  `source_absent`, and reserve deletion of that retained path history for
  explicit purge.
