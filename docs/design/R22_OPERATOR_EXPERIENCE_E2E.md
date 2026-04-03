# R22 Operator Experience And End-To-End Validation

## Status

- Drafted on 2026-04-02.
- Purpose: turn the post-`V1` validation bar into an operator-experience-led,
  test-first contract for CLI, TUI, API, and user-started web review.
- Scope: define what the repository already proves, what is still missing, how
  walkthroughs should be recorded, and which next validation slices should
  become automated harnesses versus manual review checklists.

## Why This Exists

`V1` closed an important gap: the repository now has one repeatable seeded
acceptance verifier, one user-started web review preparation path, and one
repeatable real-archive truthfulness probe. That is materially better than
package-level tests alone, but it is still not the same thing as proving that a
real operator can move through the product's main jobs with low friction.

The user direction for the next slice is stricter:

1. validation should imitate real operator flows rather than isolated package
   checks;
2. walkthroughs should be recorded like a user journey, with friction made
   explicit;
3. backlog-owned improvements must be added before non-trivial corrective work
   fans out;
4. the product should stay truthful about what is automated, what is manual,
   and what still depends on user-started services.

This note makes that contract explicit.

## What `V1` Already Proves

### Implemented verifier and review commands

| Command / path | What it proves today | Important limits |
| --- | --- | --- |
| `pnpm run verify:v1-seeded-acceptance` | builds `@cchistory/api`, `@cchistory/cli`, and `@cchistory/tui`; seeds one canonical store; proves CLI/API/TUI parity for one committed multi-source project recall path; checks one known turn's detail, context, and session readability; verifies CLI/API source summaries; proves `export` → `import` → `restore-check` plus restored API readability | does not exercise real `sync`; does not cover `ls projects`, `tree`, `show`, `search`, `stats`, `health`, or conflict-oriented restore behavior; does not record operator friction |
| `pnpm run prepare:v1-seeded-web-review -- --store <dir>` plus `CCHISTORY_API_DATA_DIR=<dir> pnpm services:start` | materializes the same seeded acceptance store for user-started web inspection through the canonical runtime path without mutating the default store | still manual; no recorded browser checklist or friction log is required yet; agent cannot start services, so this remains user-started review only |
| `pnpm run verify:real-archive-probes` | re-checks real-layout truthfulness for Gemini, Cursor chat-store, CodeBuddy, and OpenCode against the available archive | does not prove operator-facing recall, read-only admin behavior, or sync-to-recall journeys |
| `pnpm run verify:read-only-admin` | proves CLI store-scoped health plus source reads, TUI source-health and missing-store truthfulness, and API read-side admin visibility against a seeded store | does not exercise real `sync`, related-work-heavy browse flows, or manual managed-runtime review |
| `pnpm run verify:fixture-sync-recall` | proves that repo `mock_data/` default-root fixtures can sync into a clean store and then replay one canonical project recall/search/drill-down journey through CLI, API, and TUI | does not focus on delegated child-session or automation-run-heavy browse/search paths |
| `pnpm run verify:bundle-conflict-recovery` | proves populated-target bundle conflict visibility and recovery, including dry-run previews, `skip` / `replace`, `restore-check`, and canonical CLI/API readback | does not exercise broader browse/search related-work traceability after sync |
| `pnpm run verify:real-layout-sync-recall` | proves that the real-layout-backed fixture slice (`gemini`, `opencode`, `openclaw`, `codebuddy`, and Cursor chat-store) can sync into a clean store and stay readable through representative CLI/API/TUI project, session, and turn paths | does not specifically stress delegated child-session or automation-run-heavy browse/search pivots |
| `pnpm run verify:related-work-recall` | proves that delegated child-session and automation-run context stays traceable through CLI search/detail/tree flows, TUI search drill-down, and API read-side related-work inspection after sync | does not replace the blocked managed-runtime web/API diaries or the externally blocked LobeChat real-sample work |

### Concrete covered actions inside the seeded verifier

The current seeded acceptance verifier proves the following repository-visible
flows:

- CLI `query projects`, `query turns`, and `query turn` against the seeded store.
- API `GET /api/projects`, `GET /api/projects/:projectId/turns`, `GET /api/turns/:turnId`, `GET /api/turns/:turnId/context`, `GET /api/sessions/:sessionId`, and `GET /api/sources` parity for the same seeded objects.
- TUI non-interactive snapshot readability for the seeded project, turn detail,
  assistant/tool context, and lightweight source-health summary.
- CLI `export`, `import`, and `restore-check` readability on a clean restored
  target.

### What `V1` does not yet prove

The current repository does **not** yet prove the following at the operator
journey level:

- fresh-store `sync` from source-shaped data into a new indexed store, then
  immediate recall/search/admin verification;
- full read-side CLI command coverage for `ls`, `tree`, `show`, `search`,
  `stats`, and `health` in one realistic operator flow;
- interactive or snapshot-backed TUI search drill-down beyond the one seeded
  browse/detail snapshot;
- API search parity and read-only admin inspection as part of a realistic
  walkthrough rather than endpoint-local tests only;
- restore/import conflict handling such as skip/replace/conflict reporting;
- a recorded operator diary that converts observed friction into backlog-owned
  improvement work;
- user-started manual web walkthroughs recorded with a stable checklist;
- remote-agent pairing/upload/schedule/pull flows as part of the first
  operator-experience validation bar.

## Post-`V1` Gap Matrix

| Operator journey | Surfaces | Current proof | Missing proof | Recommended next mode |
| --- | --- | --- | --- | --- |
| Seeded project recall and traceability | CLI + API + TUI | covered for one canonical seeded recall path by `verify:v1-seeded-acceptance`, with richer related-work-heavy browse/search traceability now also covered by `verify:related-work-recall` | no remaining local-automation blocker for CLI/API/TUI; web-side review for comparable managed-runtime projection still remains manual | keep web as manual checklist/diary when needed |
| Read-only admin and source-health inspection | CLI + API + TUI + web | covered for local CLI/API/TUI proof by `verify:read-only-admin` | one recorded web-side admin/read diary against a user-started runtime is still missing | keep manual for web under `R31` |
| Fresh-store sync to recall | CLI + API + TUI | covered by `verify:fixture-sync-recall`, with real-layout-backed fixture coverage added by `verify:real-layout-sync-recall` | no remaining local-automation blocker; live-source/manual review remains supplementary rather than a missing repository verifier | keep sampled/manual review supplementary |
| Search then drill into detail/context | CLI + API + TUI + web | covered locally by the seeded acceptance/search walkthroughs plus `verify:fixture-sync-recall` and `verify:related-work-recall` | one comparable managed-runtime web diary is still missing | keep web as manual checklist/diary under `R31` |
| Restore/import recovery | CLI + API | covered by `verify:v1-seeded-acceptance` for clean restore and `verify:bundle-conflict-recovery` for populated-target conflict cases | no remaining local-automation blocker for the current operator bar | keep current verifier surface |
| Manual web recall/admin spot-check | web | seeded helper path plus stable checklist contract exist via `prepare:v1-seeded-web-review` and `R27` | a recorded operator diary against a user-started service is still missing | blocked manual diary under `R31` |
| Managed API read journey | API | route availability is already regression-covered, and the stable diary contract now exists in `docs/design/R31_MANAGED_API_READ_DIARY_CONTRACT.md` | one recorded operator diary against a user-started API service is still missing | blocked manual diary under `R31` |
| Real-layout truthfulness | archive probes + fixtures | covered by `verify:real-archive-probes` for archive assumptions and `verify:real-layout-sync-recall` for sync-to-read user journeys; `R36` adds one broader exploratory archive diary | no remaining local-automation blocker for the reviewed fixture/archive-backed slice | keep exploratory or new live-source review supplementary |
| Remote-agent and scheduled upload flows | CLI + API | validation contract exists in `R29`, and mocked CLI/API tests already prove the local control-plane logic | recorded user-started server diaries for pair/upload/schedule and leased pull are still missing | blocked manual review under `R35` |

## Surface Contract For The Next Validation Bar

### CLI

CLI remains the most important operator-validation surface because it owns the
widest direct workflow area without requiring managed services.

The current canonical CLI surface includes:

- `sync`
- `discover`
- `health`
- `ls`
- `tree`
- `show`
- `search`
- `stats`
- `export`
- `backup`
- `restore-check`
- `import`
- `merge`
- `gc`
- `query`
- `templates`
- `agent pair|upload|schedule|pull`

The next bar should treat CLI not as a bag of independent commands, but as the
primary operator workflow surface for:

- store creation and refresh,
- project/session/turn recall,
- search-to-detail traceability,
- read-only admin/source-health inspection,
- bundle export/import and restore verification.

### TUI

The current canonical TUI is intentionally narrower and read-first:

- project → turn → detail browsing,
- search drill-down,
- lightweight source-health summary,
- explicit non-mutating failure for missing `--store` / `--db` inputs.

The next validation bar should prove that TUI remains semantically aligned with
CLI/API for the same canonical objects, while still staying read-only.

### API

API is the machine-readable projection layer for the same canonical store.

The current route surface already includes:

- canonical read routes for projects, turns, sessions, search, and sources;
- read-side admin routes for linking, masks, drift, pipeline lineage, and
  source config visibility;
- write/admin routes for artifacts, linking overrides, source config mutation,
  remote-agent management, and lifecycle actions.

The first post-`V1` operator walkthrough bar prioritized **read parity** over broad mutation coverage. Mutation and remote-agent flows stayed outside that first bar unless a specific journey depended on them.

### Web

Web remains a canonical projection, but because the agent must not start managed
services on this repository, web validation stays user-started.

The repository already has a truthful seeded review path:

1. materialize the seeded store with `pnpm run prepare:v1-seeded-web-review -- --store <dir>`;
2. user-start services with `CCHISTORY_API_DATA_DIR=<dir> pnpm services:start`;
3. review `Projects`, `Search`, and `Sources` against the same seeded objects.

The next bar should improve the **checklist and capture discipline**, not invent
an alternate startup model.

## Operator Diary And Friction-Capture Rubric

Every operator-style walkthrough should record the following sections in the
same design note or a linked review note.

### Required fields

- **Scenario id**: a short stable identifier such as
  `seeded-search-drilldown-cli-tui-api`.
- **Goal**: the operator job being imitated, such as recall, search,
  source-health inspection, or restore verification.
- **Inputs**: store path, seeded fixture, bundle path, or sampled source root.
- **Commands and actions**: exact CLI commands, API calls, TUI launch mode, and
  any user-started web steps.
- **Expected outcome**: what frozen semantics or documented workflow should
  happen.
- **Observed outcome**: what actually happened.
- **Friction notes**: readability, discoverability, navigation, missing cue,
  error clarity, performance, or trust issues.
- **Evidence refs**: stdout excerpts, structured JSON output, API payloads,
  screenshots, or related tests.
- **Backlog action**: bug, UX cleanup, doc correction, verifier expansion, or no
  action needed.

### Friction categories

Use the following categories so diary entries are comparable:

- **Discoverability** — the next action is unclear or hidden.
- **Readability** — the information exists but is hard to parse quickly.
- **Traceability** — the user can find a turn but cannot easily connect it back
  to session, source, or context.
- **Guardrail truthfulness** — missing store, missing data, or partial support is
  presented unclearly.
- **Workflow overhead** — too many steps or too much flag composition for a
  common operator task.
- **Parity drift** — CLI, TUI, API, and web disagree about the same canonical
  object.

### Severity scale

- **S0** — cosmetic or preference-level friction; no backlog item required
  unless repeated.
- **S1** — noticeable friction worth backlog follow-up, but the journey still
  succeeds.
- **S2** — major friction or misleading behavior that should block nearby
  operator-facing changes until tracked.
- **S3** — canonical workflow failure or semantic mismatch; backlog item is
  mandatory before broader corrective work.

### Diary rules

- A diary entry is evidence of operator experience, not a replacement for the
  design freeze or canonical runtime truth.
- If the observation suggests a semantic bug, corroborate it with targeted code,
  tests, or existing docs before changing product semantics.
- Every `S2` or `S3` friction point must become a concrete backlog task, KR, or
  objective before broader CLI/TUI/API/web corrective work begins.
- Manual web review should record the user-started service command explicitly
  instead of pretending the agent launched it.

## Canonical Post-`V1` Walkthrough Set

The delivered post-`V1` validation work was designed around the following ordered walkthroughs.

### Walkthrough 1 — Seeded recall, search, and traceability parity

**Purpose**: extend the existing seeded verifier from one direct known-turn
lookup into a real search-and-drill-down journey.

**Minimum actions**:

- CLI `query projects` and `search` for the seeded phrase;
- CLI `show` for the selected turn plus `show session` or `tree session <session-ref> --long` as the session-level continuation;
- API project, search, turn, and context retrieval for the same canonical turn;
- TUI launch plus search drill-down in snapshot mode;
- optional manual web search/detail spot-check using the same seeded store.

**Target mode**: automated for CLI/API/TUI, manual checklist for web.

### Walkthrough 2 — Read-only admin and missing-store truthfulness

**Purpose**: prove admin/read surfaces tell the truth without mutating state.

**Minimum actions**:

- CLI `health` and source listings against a valid seeded store;
- TUI source-health summary against the same store;
- API `GET /api/sources` plus selected read-only admin endpoints against the
  same store;
- explicit missing-store launch/read attempts for CLI/TUI and any comparable API
  path where applicable.

**Target mode**: automated.

### Walkthrough 3 — Fresh-store sync to canonical recall

**Purpose**: prove a realistic operator can populate a clean store and then read
it immediately through canonical surfaces.

**Minimum actions**:

- start from an empty temp store;
- run CLI `sync` against fixture-backed or sampled source roots;
- inspect resulting projects, turns, and sources via CLI;
- verify at least one project/turn through API;
- optionally open TUI snapshot against the resulting store.

**Target mode**: automated with fixture-backed sources where possible; sampled
real-layout review remains supplementary.

### Walkthrough 4 — Export/import recovery and conflict visibility

**Purpose**: prove bundles remain operator-readable and conflicts are explained.

**Minimum actions**:

- export a known store;
- import into a clean store and verify readability;
- re-import into a populated target to trigger skip/replace/conflict reporting;
- verify resulting project/source counts and one known recall path.

**Target mode**: automated.

### Walkthrough 5 — Manual seeded web spot-check with diary capture

**Purpose**: keep web as a truthful projection without violating the repository's
service-start constraints.

**Minimum actions**:

- materialize the seeded review store;
- record the exact user-started service command;
- inspect seeded `Projects`, `Search`, and `Sources` views;
- record any friction and convert it into backlog work when warranted.

**Target mode**: manual checklist plus operator diary.

## Which Walkthroughs Should Become Harnesses

### Should become automated now

These have stable inputs and do not require managed services:

1. seeded recall/search/traceability parity for CLI/API/TUI;
2. read-only admin and missing-store truthfulness;
3. export/import recovery including conflict cases;
4. fixture-backed fresh-store sync to recall.

### Should stay manual for now

These still depend on user-started services or broader environment truth:

1. seeded web spot-checks through the canonical `pnpm services:*` path;
2. large real-archive exploratory review beyond the scoped archive probes;
3. remote-agent lifecycle validation that depends on real server-side flows.

### Test-first rule for operator-facing changes

Any non-trivial change that alters CLI/TUI/API/web operator workflows should do
one of the following **before** the change lands:

- extend an existing seeded or fixture-backed verifier; or
- add a new walkthrough harness/checklist that covers the changed operator job.

If a workflow change cannot be covered automatically yet, the backlog entry
should state the temporary manual checklist and what automation gap remains.

## Historical Backlog Direction

At the time this note was drafted, it implied that the next ready implementation slices should prioritize:

1. extending seeded acceptance from direct lookup into search/show/stat-style
   parity;
2. adding one dedicated read-only admin and missing-store verifier;
3. adding one fixture-backed sync-to-recall verifier;
4. running at least one recorded operator diary using the rubric above before
   broad UX corrections begin.

Those first-pass slices are now delivered; the remaining current gaps are the blocked managed-runtime and remote-agent diaries recorded in `BACKLOG.md`.


## Executed Walkthrough Record — 2026-04-02

### Scenario id

`seeded-recall-traceability-admin-restore-cli-tui-api`

### Goal

Imitate one realistic operator journey that starts from seeded-store setup,
proves recall and traceability through CLI/TUI/API, inspects read-only admin
surfaces, and then verifies export/import restore readability.

### Inputs

- seeded store: `/tmp/cchistory-r22-walkthrough`
- restored target: `/tmp/cchistory-r22-walkthrough-restore`
- bundle output: `/tmp/cchistory-r22-walkthrough-bundle`

### Commands and actions run

- `node scripts/verify-v1-seeded-acceptance.mjs --materialize-only --store /tmp/cchistory-r22-walkthrough`
- `node apps/cli/dist/index.js query projects --store /tmp/cchistory-r22-walkthrough`
- `node apps/cli/dist/index.js search "Alpha traceability target" --store /tmp/cchistory-r22-walkthrough`
- `node apps/cli/dist/index.js show turn turn-alpha-amp --store /tmp/cchistory-r22-walkthrough`
- `node apps/cli/dist/index.js show session session-alpha-amp --store /tmp/cchistory-r22-walkthrough`
- current-surface note: this recorded baseline used `show session`; the shipped CLI surface now also offers `tree session session-alpha-amp --store /tmp/cchistory-r22-walkthrough --long` when the operator wants nearby-turn and related-work context in one view
- `node apps/cli/dist/index.js health --store /tmp/cchistory-r22-walkthrough`
- `node apps/cli/dist/index.js ls sources --store /tmp/cchistory-r22-walkthrough`
- `node apps/tui/dist/index.js --store /tmp/cchistory-r22-walkthrough --search "Alpha traceability target"`
- API parity via `createApiRuntime({ dataDir: <store>, sources: [] })` plus Fastify `inject()` for `/api/projects`, `/api/turns/search`, `/api/turns/:id`, `/api/turns/:id/context`, `/api/sessions/:id`, and `/api/sources`
- `node apps/cli/dist/index.js export --store /tmp/cchistory-r22-walkthrough --out /tmp/cchistory-r22-walkthrough-bundle`
- `node apps/cli/dist/index.js import /tmp/cchistory-r22-walkthrough-bundle --store /tmp/cchistory-r22-walkthrough-restore`
- `node apps/cli/dist/index.js restore-check --store /tmp/cchistory-r22-walkthrough-restore`

### Expected outcome

- one seeded multi-source project remains readable across CLI/TUI/API;
- search resolves the target turn before detail/context/session drill-down;
- admin/read surfaces report healthy seeded sources truthfully;
- export/import/restore-check preserves the seeded project and source counts.

### Observed outcome

The walkthrough succeeded end-to-end.

- CLI search resolved the seeded traceability turn and the recorded `show turn` / `show session`
  path confirmed the same project/session linkage; the current CLI surface also
  supports `tree session --long` as the richer nearby-turn and related-work
  continuation for the same session.
- TUI non-interactive search snapshot rendered search → result → detail drill-down
  for the same seeded turn.
- API reads returned the same project/turn/session/source counts through inject-based
  requests without starting managed services.
- export/import/restore-check preserved `2` projects, `4` sessions, `4` turns,
  and `4` healthy sources.

### Friction log

| Severity | Category | Observation | Backlog action |
| --- | --- | --- | --- |
| S2 | Guardrail truthfulness / workflow overhead | `cchistory health --store <seeded-dir>` mixed seeded store inspection with ambient host discovery from the real machine (`/root/.codex`, `/root/.claude`, `/root/.gemini`, etc.). For seeded or restored review this makes it harder to tell whether the command is describing the chosen store, the current host, or both. | add a store-scoped health/admin task in `BACKLOG.md` |
| S1 | Readability / workflow overhead | CLI read surfaces mix JSON-first `query` output with human-readable `search`, `show`, `health`, and `restore-check`. The walkthrough remained successful, but the mode switch is jarring when an operator is manually inspecting data rather than scripting. | add a CLI read-surface consistency task in `BACKLOG.md` |
| S1 | Readability | TUI search snapshot preserved the journey, but tool context is still summarized as `Tool: {}` for this seeded case. The turn stays traceable, yet the detail view is thinner than the CLI/API context read. | keep as note for later TUI readability passes; no new task yet because stronger admin/verifier gaps take priority |

### Result

This walkthrough proves that the post-`V1` contract is now partially executable in
practice, not just on paper: one realistic seeded operator flow can be run
through CLI/TUI/API plus restore recovery without starting managed services.
It also surfaced two concrete follow-up tasks that should stay in the backlog
before broader operator-facing cleanup continues.

Follow-up implemented on 2026-04-02: CLI `health` now supports `--store-only`, which suppresses host discovery and sync preview so seeded or restored store review can stay store-scoped when desired.
Follow-up implemented on 2026-04-02: `pnpm run verify:read-only-admin` now proves the read-only admin slice across CLI, TUI, and API, including TUI missing-store truthfulness and API GET-side admin visibility without seeded-store mutation.
Follow-up implemented on 2026-04-02: `pnpm run verify:fixture-sync-recall` now proves the fixture-backed sync path from repo `mock_data/` into a clean store and then replays one canonical recall/search/drill-down journey through CLI, API, and TUI.
Follow-up implemented on 2026-04-03: `pnpm run verify:bundle-conflict-recovery` now proves export/import recovery on a populated target, including default conflict failure, dry-run conflict/replace previews, `--on-conflict skip`, `--on-conflict replace`, `restore-check`, and restored CLI/API readability for the replaced canonical turn.
Follow-up implemented on 2026-04-03: `pnpm run verify:real-layout-sync-recall` now proves the real-layout-backed fixture slice (`gemini`, `opencode`, `openclaw`, `codebuddy`, and Cursor chat-store) can sync into a clean store and stay readable through representative CLI/API/TUI project, session, and turn paths.
Follow-up implemented on 2026-04-03: `pnpm run verify:related-work-recall` now proves that delegated child-session and automation-run context remains traceable through CLI search/detail/tree flows, TUI search drill-down, and API read-side related-work inspection on synced fixture data.
Follow-up implemented on 2026-04-02: the CLI help and guide now state the recall output contract explicitly — `query` is machine-readable by design, while `search` / `show` stay operator-readable by default and accept `--json` when a structured path is needed.
