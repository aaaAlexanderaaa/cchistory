# R19 - Workflow Skill Coverage Expansion

## Status

- Objective source: project-wide KR review sweep on 2026-04-02
- Backlog status after this note: `done`
- Scope: package the later-delivered canonical operator workflows `backup` and `restore-check` as repo-owned skills without changing product semantics

## Problem Statement

`R7` established the top-level `skills/` inventory and the first four repo-owned skills, but those skills predated `R10`'s dedicated workflow commands. The repository now exposes `cchistory backup` and `cchistory restore-check` as canonical CLI workflows, yet agent callers still only have the earlier low-level export and source-health skill packaging.

## Decided Approach

Add two narrow workflow skills:

- `cchistory-backup-workflow` for preview-first portable backup creation via `cchistory backup`
- `cchistory-restore-check` for indexed, explicit-target post-restore verification via `cchistory restore-check`

Both skills remain CLI-first, preserve canonical CLI JSON unchanged, and state the same safety rules already documented in `docs/guide/cli.md`.

## Trade-Offs

- Chosen: package the dedicated workflow commands rather than extending `cchistory-export-bundle`, because `backup` and `restore-check` are now the operator-facing workflows users and agents should prefer.
- Rejected: one combined backup-and-restore skill, because preview-first backup creation and read-only restored-store verification have different safety postures and should stay separately triggerable.
- Rejected: API-backed skills, because these workflows already exist locally through the CLI and should not require managed services.

## Acceptance Criteria

- `skills/` gains one backup workflow skill and one restore-check skill.
- Each skill includes `agents/openai.yaml` metadata aligned with its `SKILL.md`.
- `skills/README.md` lists both new skills in the current inventory.
- The new skills pass `quick_validate.py`.

## Impacted Surfaces

- `skills/README.md`
- `skills/cchistory-backup-workflow/`
- `skills/cchistory-restore-check/`
- `docs/design/R19_WORKFLOW_SKILL_COVERAGE_EXPANSION.md`
