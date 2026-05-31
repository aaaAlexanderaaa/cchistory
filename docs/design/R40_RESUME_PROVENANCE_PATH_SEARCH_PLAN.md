# R40 Resume Provenance And Path Search Plan

## Intent

Users want to recover a source-native session UUID that can be used to resume a
conversation in the original tool, even when that session lives in a different
account or provider namespace than the one currently active in the upstream
agent.

The immediate operator workflow is:

- find the historical session by canonical ask or by workspace/project path;
- inspect the source-native resume identifier;
- copy the right command for the source family;
- continue the session in the original tool with an absolute working directory.

This work preserves the frozen model:

- project-first history
- `UserTurn` as the primary recall object
- evidence-preserving ingestion
- UI/API/CLI/TUI as projections of one canonical model

## Verified Local Facts

- Codex CLI supports `codex resume <session-id>` and `codex resume --all`.
- Claude Code CLI supports `claude --resume <session-id>` and `claude -r <session-id>`.
- Current session projections expose `working_directory`, `source_platform`, and
  `source_native_project_ref`, but not a dedicated source-native resume payload.
- Current search indexing uses canonical turn text, not workspace/path evidence.
- Local Codex data is organized under `~/.codex/sessions/...` and is filtered by
  cwd in the interactive resume picker.
- Local Claude data is organized under `~/.claude/projects/<encoded-path>/<uuid>.jsonl`.
- The local machine contains multiple Codex model provider entries, so account /
  provider separation must be preserved as provenance rather than merged into a
  synthetic shared session space.

## Product Decision

The feature is a provenance projection, not a model rewrite.

The canonical session and turn model stay intact. We add a source-native resume
projection that can surface:

- the original source session UUID;
- the resume command for that source family;
- the absolute working directory to run it from;
- enough source/account context to tell the user which namespace the UUID belongs to.

## Scope

### In scope

- Codex source-family support first.
- Claude Code source-family support first.
- Absolute-path search over workspace/project path evidence.
- CLI output, TUI detail panel, and Web detail/search panels.
- Copyable resume command in detail views.
- Search by turn text plus path-bearing evidence.
- TDD and source-shaped E2E coverage.
- Local validation against the operator machine, without writing real private
  content into fixtures.

### Out of scope

- Merging provider namespaces.
- New product-level session identity semantics.
- Browser-history ingestion.
- One-off resume commands for unrelated source families.

## Proposed Domain Additions

- Add an explicit source-native resume payload to session projections.
- Preserve the original source session UUID as source data, not as a derived
  display-only string.
- Keep `working_directory` as the resume cwd signal, but treat it as a path
  projection rather than a command string.

## Search Changes

Search should match more than canonical turn text.

Minimum indexable signals:

- canonical ask text
- session working directory
- project primary workspace path
- source-native project ref when useful for path-like lookup

Search UI should let users find sessions by:

- ask content
- repository name
- absolute path fragments
- basename fragments

## UI Changes

### TUI

- Keep the search flow fast and lightweight.
- Show the resume command in the right-side detail area.
- Keep list rows compact; do not print the full command in every result row.

### Web

- Search should accept paths and asks in the same box.
- Result rows may indicate that resume data exists.
- Detail panels should show the full command and make it easy to copy.
- While touching the search/detail surface, fix any obvious layout issues around
  long absolute paths, cramped metadata rows, and side-panel overflow.

## Validation Plan

### Unit / package tests

- Codex adapter tests: source UUID extraction and resume payload preservation.
- Claude Code adapter tests: source UUID extraction and resume payload preservation.
- Search tests: path fragments and workspace paths match.
- Presentation tests: mapping keeps the new provenance fields.
- Web component tests: detail and search surfaces render resume commands cleanly.
- TUI renderer tests: right-side detail area stays readable with long commands.

### Source-shaped E2E

- Codex fixture: session can be found by path and yields a usable `codex resume`
  command.
- Claude fixture: session can be found by path and yields a usable
  `claude --resume` command.
- Mixed-provider fixture: switching accounts/providers does not collapse or
  misattribute the resume payload.

### Local operator validation

- Use real local Codex and Claude directory layouts to confirm provider/account
  isolation behavior.
- Confirm that the extracted UUID is the one accepted by the native resume CLI.

