# R22 Operator Experience And End-To-End Validation

## Purpose

Define the operator-experience-led validation contract for CLI, TUI, API, and user-started web review. This note captures what the repository proves, what remains missing, and how walkthroughs should be recorded.

> Detailed verifier inventory and validation journeys are in `V1_VALIDATION_STRATEGY.md`.
> Current runtime surface is in `CURRENT_RUNTIME_SURFACE.md`.

## Operator Diary Rubric

Every operator-style walkthrough should record the following fields:

- **Scenario id**: short stable identifier (e.g. `seeded-search-drilldown-cli-tui-api`)
- **Goal**: the operator job being imitated
- **Inputs**: store path, seeded fixture, bundle path, or sampled source root
- **Commands and actions**: exact CLI commands, API calls, TUI launch mode, web steps
- **Expected outcome**: what should happen per frozen semantics
- **Observed outcome**: what actually happened
- **Friction notes**: using categories below
- **Evidence refs**: stdout excerpts, JSON output, API payloads, screenshots
- **Backlog action**: bug, UX cleanup, doc correction, verifier expansion, or none

### Friction Categories

| Category | Description |
| --- | --- |
| Discoverability | Next action is unclear or hidden |
| Readability | Information exists but hard to parse quickly |
| Traceability | Can find a turn but cannot connect to session/source/context |
| Guardrail truthfulness | Missing store/data/partial support presented unclearly |
| Workflow overhead | Too many steps or flags for a common operator task |
| Parity drift | CLI, TUI, API, and web disagree about the same canonical object |

### Severity Scale

- **S0** — cosmetic; no backlog follow-up unless repeated
- **S1** — noticeable friction, journey still succeeds
- **S2** — major friction or misleading behavior; backlog follow-up required
- **S3** — canonical workflow failure or semantic mismatch; mandatory backlog item

### Diary Rules

- A diary entry is evidence of operator experience, not a replacement for the design freeze.
- Corroborate semantic bugs with targeted code/tests before changing product semantics.
- Every S2/S3 friction point must become a concrete backlog task before broader corrective work.
- Manual web review must record the user-started service command explicitly.

## User-Started Web Review Checklist

### Preconditions

- Seeded review store materialized at an explicit path
- User has started canonical API + web services manually
- Web UI loaded from `http://localhost:8085`

### Setup

```bash
pnpm run prepare:v1-seeded-web-review -- --store <dir>
CCHISTORY_API_DATA_DIR=<dir> pnpm services:start
```

### Required Checks

1. **Setup confirmation** — record store path, service-start command, timestamp
2. **Projects view** — `alpha-history` visible as primary committed project; opening reveals three turns; project identity consistent
3. **Search view** — query `Alpha traceability target`; one match under `alpha-history`; detail shows session `session-alpha-amp`; assistant content includes `Processing.`; one tool call visible
4. **Sources view** — four healthy sources (`amp`, `claude_code`, `codex`, `factory_droid`); each shows one turn; page reads as store-scoped, not ambient host discovery
5. **Shutdown** — record whether operator stopped services with `pnpm services:stop`

### Evidence Fields

Record: scenario id, store path, service-start command, checks completed, pass/fail per check, screenshots/notes for confusing states, friction notes, backlog action.

## Test-First Rule For Operator-Facing Changes

Any non-trivial change that alters CLI/TUI/API/web operator workflows should either:

- extend an existing verifier; or
- add a new walkthrough harness/checklist covering the changed operator job.

If automation is not yet possible, state the temporary manual checklist and the remaining gap.

## Recorded Walkthrough — 2026-04-02

**Scenario**: `seeded-recall-traceability-admin-restore-cli-tui-api`

**Result**: Passed end-to-end. CLI search resolved the seeded turn; TUI snapshot rendered search→detail drill-down; API reads returned matching counts via inject; export/import/restore-check preserved 2 projects, 4 sessions, 4 turns, 4 sources.

**Friction found**:

| Sev | Category | Issue | Resolution |
| --- | --- | --- | --- |
| S2 | Guardrail truthfulness | `health` mixed seeded store with ambient host discovery | Fixed: `--store-only` flag added |
| S1 | Readability | CLI modes mix JSON `query` with human-readable `search`/`show` | Documented: `query` is machine-readable, `search`/`show` accept `--json` |

**Post-walkthrough verifier expansions**: `verify:read-only-admin`, `verify:fixture-sync-recall`, `verify:bundle-conflict-recovery`, `verify:real-layout-sync-recall`, `verify:related-work-recall` — all delivered and passing as of 2026-04-03.
