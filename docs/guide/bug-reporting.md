# Bug Reporting Guide

Use this guide when you want to report a reproducible product bug instead of a
one-off question.

The goal is to capture the **smallest evidence set** that proves the problem
without deleting or mutating raw data.

## What every good bug report includes

Copy the structure from `docs/templates/bug-report.md` and fill in:

- **Summary** — one sentence describing the problem
- **Surface** — `CLI`, `API`, `Web`, `source-adapter`, `storage/linking`, or
  `docs/process`
- **Affected source/platform** — for example `codex`, `claude_code`, `cursor`
- **Reproduction steps** — the minimum sequence needed to trigger the problem
- **Expected behavior** — what should have happened
- **Actual behavior** — what happened instead
- **Evidence** — exact command output, ids, paths, screenshots, or payloads
- **Scope check** — whether this looks isolated or class-wide

## Repository issue entrypoint

If the repository host exposes issue forms, use the bug-report form in
`.github/ISSUE_TEMPLATE/bug-report.yml`.

It mirrors the same contract as `docs/templates/bug-report.md`. If you are
reporting outside the tracker, copy the markdown template directly.

## Evidence rules

- Preserve raw evidence. Do **not** delete or rewrite `.cchistory/`, source
  captures, or raw snapshots to make the symptom disappear.
- Prefer the smallest command that proves the issue.
- Include exact ids when possible: `source_id`, `session_id`, `turn_id`,
  `project_id`.
- If the bug is visual, include a screenshot plus the underlying ids/paths.
- If the bug involves masking, linking, parsing, or rendering, assume it may be
  class-wide until proven otherwise.

## Pick the smallest proving command

### CLI bug

Start with one or more of:

```bash
cchistory discover --showall
cchistory sync --dry-run
cchistory ls sessions --store <store-dir>
cchistory show session <session-ref> --store <store-dir>
cchistory search "<query>" --store <store-dir>
cchistory stats --store <store-dir>
```

Include:

- the exact command
- stdout/stderr
- the store path if relevant
- the ids or paths you expected to see

### Source-adapter / parser bug

Start with:

```bash
pnpm run probe:smoke -- --source-id=<source-id> --limit=1
```

If the problem is source-specific, include:

- `source_id`
- platform name
- source base dir
- one representative file path or captured blob path
- whether the bug appears on one file or many

### Storage / linking bug

Include evidence showing identity or grouping drift, for example:

```bash
cchistory ls projects --store <store-dir>
cchistory show session <session-ref> --store <store-dir>
```

If possible include:

- `project_id`
- `session_id`
- the relevant workspace path(s)
- whether the same host/source/workspace appears in multiple spellings

### API bug

Include:

- request method + path
- request body if any
- response status + body
- whether the same issue is reproducible through CLI or Web

### Web bug

Include:

- the page/view name
- the action taken
- a screenshot
- the related ids/paths behind the view
- whether refresh changes the outcome

Do **not** ask the agent to restart services from this environment. If live UI
verification is needed, note which user-started service command was used.

## Scope check

Every bug report should include one short scope statement:

- **Looks isolated** — one record / one source / one view only
- **Possibly class-wide** — repeated on similar records or similar paths
- **Unknown scope** — not enough evidence yet

## What happens after you submit

Maintainers should move each report through the same triage gates:

1. **Completeness gate** — if required fields or proving evidence are missing,
   request an updated report instead of guessing.
2. **Reproduction gate** — confirm the symptom with the smallest command,
   request, payload, or screenshot trail that proves it.
3. **Scope gate** — determine whether the report is isolated, duplicate, or a
   likely class-wide bug.
4. **Backlog mapping** — once accepted, translate the bug into tracked work in
   `BACKLOG.md`:
   - add a **task** under an existing KR when the bug fits an accepted slice
   - add a **KR** under an existing objective when the gap is broader than one
     task
   - add a new **objective** when no active objective already owns the problem
5. **Regression closure gate** — only mark the work done after the fix has a
   recorded reproducer plus targeted regression proof at the layer that changed.

## When a bug is considered fixed

A bug is not closed only because the symptom disappears once.

Close it only when:

- the original reproduction is recorded
- the root-cause change lands
- targeted regression proof runs at the changed layer
- class-wide bugs get at least one broader representative check, not only the
  original record
- the issue and/or backlog item cites the exact proving command, test, or view
  used to verify the fix

## Before you submit

- Can another person reproduce this from the report?
- Did you include expected vs actual behavior?
- Did you include the minimum proving command or screenshot?
- Did you preserve evidence instead of editing it away?
- Did you name the affected source/platform if relevant?
