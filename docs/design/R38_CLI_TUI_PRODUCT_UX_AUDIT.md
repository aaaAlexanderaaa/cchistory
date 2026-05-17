# R38 CLI/TUI Product UX Audit

Status: completed audit for R38-KR2; remaining fix-now items are tracked in `BACKLOG.md`
Date: 2026-05-16

## Scope

This audit covers the default CLI and TUI read surfaces owned by `R38` in
`BACKLOG.md`. It preserves the frozen split: CLI is the admin and AI-agent
surface, while TUI is the keyboard-first local read surface. The audit does not
change canonical storage, source adapters, evidence preservation, or the
`UserTurn`-first model.

The product-language rule used here is narrow: user-facing read views should
lead with projects, asks, and ways to continue. Source, session, host, revision,
and raw identifier vocabulary should remain available for traceability, but
should not dominate default views.

## Evidence Reviewed

- R38 backlog objective and the frozen design sections on project-first history,
  `UserTurn` recall, evidence preservation, and UI/API projection.
- CLI read commands in `apps/cli/src/commands/browse.ts`,
  `apps/cli/src/commands/context.ts`, and help text in
  `apps/cli/src/args.ts`.
- TUI browse/detail/search rendering in `apps/tui/src/browser.ts`.
- Existing CLI/TUI tests under `apps/cli/src/test/` and `apps/tui/src/`.
- R37 quality audit and UX plan notes:
  `docs/design/R37_CLI_TUI_QUALITY_AUDIT.md` and
  `docs/design/UX_IMPROVEMENT_PLAN.md`.

## Findings

| ID | Finding | Classification | Required regression layer |
| --- | --- | --- | --- |
| R38-AUDIT-001 | `show project` is a project read path, but default text exposes `Project ID`, `Hosts`, and `Turns` before the ask-level recall language. | fix-now | CLI package test for human output; JSON must still preserve raw project fields |
| R38-AUDIT-002 | TUI browse/detail defaults still label the primary recall object as `Turns`/`Turn`, even though the product promise is project-scoped asks. | fix-now | TUI renderer/layout tests for browse and detail snapshots |
| R38-AUDIT-003 | `context project <ref>` is aligned with R38: it leads with recent asks, sessions, source mix, and next commands, and its JSON keeps stable IDs without dumping raw internal objects in default text. | defer | Keep existing command tests; revisit only if project context grows too verbose |
| R38-AUDIT-004 | `show turn` default text still ends with `Turn ID` and `Revision ID` under `Context`. That is valuable traceability, but it reads as internal lineage metadata in the default human path. | fix-now | CLI command test; default text should hide lineage IDs while `--long` and JSON preserve them |
| R38-AUDIT-005 | `tree project` remains source/session shaped: `hosts=`, `sessions=`, `turns=`, `source_mix=`, `related=`, source slot labels, and host IDs appear before user ask snippets. | fix-now | CLI package/verifier test for project tree default and `--long` behavior |
| R38-AUDIT-006 | TUI row metadata is dense and cryptic (`s`, `a`, seconds in timestamps). It is compact enough for narrow terminals, but not yet tuned for repeated daily scanning. | needs-more-evidence | Layout tests after deciding compact labels and timestamp policy |
| R38-AUDIT-007 | TUI detail uses available space for full prompt text but not for a short assistant outcome preview. The full conversation view exists, so this is not a correctness gap, but the detail pane can feel underused for short prompts. | defer | Renderer test after deciding what assistant preview belongs in detail |
| R38-AUDIT-008 | CLI help grouping is much better than the old flat wall, but search pagination flags are currently displayed under the `context project` row, which can confuse command ownership. | fix-now | CLI help output test |
| R38-AUDIT-009 | Search output is in the best current shape among default CLI read views: it leads with snippets, keeps pivots behind `--long`, and gives a direct `show turn` command. | defer | Keep existing skeptical browse/search verifier coverage |

## Immediate Fix Order

1. Fix the default project read path first: `show project` should present
   `Asks` and `Recent Asks`, and move raw project identity/host details behind
   `--long`.
2. Fix TUI browse/detail wording so the visible surface says `Asks` and `Ask`
   while retaining `UserTurn`/turn terminology in code and JSON contracts.
3. Move CLI `show turn` lineage IDs behind `--long`.
4. Redesign `tree project` around session threads and latest asks, with raw
   source/host grouping available only in expanded output.
5. Clean up CLI help flag grouping.
6. Revisit TUI compact metadata and detail assistant preview after the first
   wording pass has tests.

## First Redesign Slice

The first code slice should be intentionally small:

- `show project` default text becomes ask-first and hides raw project/host
  identifiers unless `--long` is passed.
- TUI browse/detail labels change from `Turns`/`Turn` to `Asks`/`Ask`.
- Tests assert the new wording so future CLI/TUI read-side changes do not slide
  back into session-first language.

This slice is a projection-only change. It does not alter canonical object
names, command names, JSON fields, storage schema, source parsing, or evidence
lineage.
