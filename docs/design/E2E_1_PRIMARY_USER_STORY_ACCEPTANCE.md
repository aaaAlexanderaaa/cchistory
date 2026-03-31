# E2E-1 Primary User Story Acceptance

## Status

- Objective: `E2E-1 - Primary User Story Acceptance Test`
- Backlog status after this note: `done`
- Scope: decomposition, acceptance-test implementation, validation, and holistic
  evaluation in one execution pass

## Phase 1: Domain Understanding

### What exists today

- The design freeze defines the primary user job as recovering what the user
  asked in one project even when those turns were spread across multiple
  sessions and multiple coding agents.
- `mock_data/` already contains a sanitized multi-platform corpus where the
  `history-lab` workspace appears across AMP, Antigravity, and Factory Droid.
- CLI tests already provide a full-pipeline harness that can seed the mock-data
  home layout, run `sync`, and query the resulting store through JSON-capable
  read commands.
- Storage and API tests already prove smaller slices of cross-platform project
  linking, but no existing acceptance test follows the main user workflow from
  sync → project recall → search → session-context drill-down.

### Gaps confirmed

1. No acceptance test currently proves that one committed project can collect
   turns from three different coding-agent platforms in the same workspace.
2. No single regression currently walks the user-facing recovery path of:
   sync, find the project, search for a known ask, and inspect session context.
3. Existing cross-platform tests use synthetic fixture payloads or smaller API
   slices rather than the sanitized real-source corpus already available in
   `mock_data/`.

### Constraints and design boundaries

- The proof should stay at the CLI layer because CLI `sync` exercises the full
  local-source pipeline while keeping the test self-contained and lightweight.
- The acceptance test should reuse repository `mock_data/` rather than inventing
  a smaller synthetic fixture that weakens fidelity.
- The objective is about one main user story, not exhaustive coverage of every
  platform pairing or every read surface.

## Phase 3: Functional Design

### Problem statement

The repository already has project-linking and search regressions, but it still
lacks one end-to-end proof of the core job-to-be-done: a user can sync local
history from multiple coding agents, recover the shared project, search for a
known turn inside it, and drill into the session context that produced that
turn.

### Decided approach

1. Reuse the CLI mock-data home fixture so `sync` ingests the sanitized Codex,
   Claude, Factory Droid, AMP, Cursor, and Antigravity roots through the real
   discovery path.
2. Assert that the `history-lab` workspace resolves into one committed project
   with three sessions and three turns spanning AMP, Antigravity, and Factory
   Droid.
3. Use CLI JSON output to search for a known Factory Droid turn under that
   project and verify the result points back to the committed project.
4. Use `show turn` and `show session` to confirm the user can inspect the turn's
   assistant/tool context and the parent session.

### Trade-offs and rejected alternatives

- An API-layer acceptance test was rejected because it would need an extra
  runtime wrapper while offering no stronger proof than the existing CLI full-
  pipeline harness for this user story.
- A synthetic three-source fixture was rejected because `mock_data/` already
  contains a realistic multi-platform same-project scenario.
- Using only storage assertions was rejected because this objective is about the
  user-facing recovery path, not hidden persistence state alone.

### Acceptance criteria

1. A CLI acceptance test syncs at least three source platforms that map to the
   same committed project.
2. The test verifies that the shared project exposes all expected sessions and
   committed turns under one project identity.
3. The test searches for a known turn in that project and verifies the matching
   turn still points at the committed project.
4. The test drills into the matching turn and session to confirm the user can
   inspect context behind the recovered ask.

## Current execution evidence

- Added a CLI acceptance test that syncs the repo mock-data home and validates
  the `history-lab` project across AMP, Antigravity, and Factory Droid.
- The test verifies project recall, project tree membership, project-scoped
  search for a known Factory Droid ask, and session/turn context drill-down via
  CLI JSON output.

## Phase 7 Evaluation Report

### Result

- Pass on 2026-03-27.

### Dimensions evaluated

- **Boundary evaluation**: pass. The change adds one CLI acceptance test and
  backlog/design documentation without altering canonical semantics or runtime
  behavior.
- **Stability assessment**: pass. The test uses the repository's sanitized
  multi-platform corpus and follows the real CLI sync/read path.
- **Scalability evaluation**: pass for the acceptance scope. The scenario uses
  a focused same-project sample across three platforms, which is sufficient for
  the core user job without over-expanding runtime cost.
- **Compatibility assessment**: pass. No API, storage, or source-adapter
  contract changed.
- **Security evaluation**: pass. The test operates only on sanitized fixture
  data in a temporary HOME/store.
- **Maintainability assessment**: pass. The acceptance path is readable and
  anchored to reusable CLI helpers rather than bespoke harness code.

### Known limitations accepted

- The acceptance test proves one representative three-platform same-project
  scenario (`history-lab`), not every possible cross-platform combination. That
  is acceptable because the objective is to encode the primary user story, not
  exhaustively enumerate all linking permutations.

### Conclusion

- `E2E-1 - Primary User Story Acceptance Test` satisfies its current
  acceptance criteria and can be marked `done`.
