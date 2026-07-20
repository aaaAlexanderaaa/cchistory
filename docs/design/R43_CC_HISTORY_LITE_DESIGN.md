# R43 CC History Lite Design

## Status

- Date: 2026-07-18
- Objective: `R43`
- State: implemented and validated
- User direction: deliver a single-machine, non-persistent Lite product that
  shares Full's canonical adapter and derivation semantics while exposing a
  read-only CLI and TUI plus one-way export.

## Problem Statement

CCHistory Full is an evidence-preserving memory layer. It owns a durable store,
retains parser input, derives canonical objects, manages lifecycle, and serves
multiple read and administration surfaces. That architecture is intentionally
truthful but operationally heavy for a user who only wants to inspect the
history that already exists in local AI-tool data directories.

CC History Lite must provide a smaller operational product without introducing
a second interpretation of any supported source. For the same source snapshot,
adapter versions, mask rules, project-link inputs, and host/source identity,
Lite and a clean Full rebuild must produce the same canonical sessions, turns,
contexts, project observations, project links, and derived read results. Lite
may be slower on a cold scan; it may not be less accurate.

## Relationship To The Full Design Freeze

`HIGH_LEVEL_DESIGN_FREEZE.md` continues to define CCHistory Full. Lite is a
separate product profile and does not weaken Full's evidence-preservation or
lifecycle invariants.

The profiles share these semantics:

- source discovery and parsing
- capture, extract, parse, and atomize behavior
- logical-session assembly
- `UserTurn` and `TurnContext` derivation
- deterministic masking
- project observation and default project linking
- source diagnostics and loss-audit generation
- read-side ordering, search matching, statistics, and tree projection where
  the same input scope is available

They differ only in materialization and operational envelope:

| Concern | Full | Lite |
| --- | --- | --- |
| Runtime scope | self-hosted local/managed surfaces | current machine only |
| Parser input | durably preserved | transiently read and then released |
| Canonical projections | durably stored | held only for the process lifetime |
| Index | durable SQLite/read projections | in-memory snapshot/reducers |
| Import/merge/restore | supported | absent |
| Export | restorable bundle | one-way normalized output |
| API/background service | supported | absent |
| Full store access | owns and reads it | forbidden |

## Frozen Lite Invariants

1. **One adapter implementation.** A platform is captured and parsed by the
   same registered adapter for Full and Lite. No Lite parser forks exist.
2. **One canonical derivation path.** Logical-session assembly, turn building,
   context building, masking, and project linking are shared implementations.
3. **Two materializers only.** Full persists canonical pipeline output. Lite
   reduces it into an ephemeral read snapshot or streams it to explicit export.
4. **No Full-store awareness.** Lite does not depend on `@cchistory/storage`,
   does not resolve `~/.cchistory`, does not accept `--store` or `--db`, and
   rejects the canonical Full database or bundle as a source root.
5. **Native SQLite is source data.** An adapter may open an upstream tool's own
   SQLite database read-only. This does not authorize reading CCHistory Full's
   SQLite schema or creating a Lite database.
6. **No implicit writes.** Normal discovery, browse, search, stats, show, and
   TUI execution create no files. Only an explicit export destination may be
   written.
7. **No accuracy-for-speed trade.** An optimization that cannot prove semantic
   parity must fall back to a complete scan or remain disabled.
8. **Session boundary before projection.** Capture may stream by file, but all
   records and companion evidence belonging to one logical session must be
   assembled exactly as Full assembles them before canonical projection.
9. **Run metadata is not canonical parity.** Scan duration, progress timing,
   and `last_sync`-style execution metadata may differ. Stable canonical IDs and
   content may not.

Full's incremental project persistence history is also materializer-specific:
the same final logical `project_id` can be `:r2` in Full after two source writes
and `:r1` in one clean Lite snapshot, while Full preserves the database's first-
seen `ProjectIdentity.created_at`. Parity therefore normalizes only
`project_revision_id` and that first-seen timestamp. Project identity,
membership, link state/reason/confidence, activity time, sessions, turns,
content, ordering, search, and stats remain strict parity fields. This is
revision-history accounting, not permission for Lite to simplify derivation.

## Decided Architecture

The target is one producer, two materializers, and one shared read semantics
layer:

```text
registered source adapters
          |
capture -> extract -> parse -> atomize
          |
logical-session assembler
          |
turn/context/mask/project derivation
          |
canonical pipeline output
      +---+--------------------+
      |                        |
Full materializer       Lite materializer
durable evidence/store  ephemeral in-memory snapshot
      |                        |
      +-----------+------------+
                  |
        shared read/query semantics
```

Lite reuses `runSourceProbe` as the canonical producer and never instantiates
`CCHistoryStorage`. For adapters that declare a proven logical-session grouping
boundary, `live-runtime` invokes the same producer one complete logical session
at a time, retains only the read projections needed by the active command, and
releases raw records/fragments/atoms before scanning the next session. Codex and
Claude Code currently declare this capability; Claude grouping uses the
canonical source-session ID so parent, subagent, worktree, and repeated-path
files are assembled exactly as the source-level collector assembles them.
Adapters without that declaration continue to use source-at-a-time
materialization.

## Multi-Perspective Review And Synthesis

The repository's independent review workers were invoked for the required
system-consistency, user-experience, and engineering-cost lenses, but the review
service returned rate-limit failures before producing usable reports. Execution
therefore continued with the same three lenses recorded explicitly below rather
than silently skipping the review dimensions.

### System Consistency Lens

- The canonical split must occur after the registered adapter and logical-
  session derivation path, never inside a platform parser.
- Project linking currently lives under `packages/storage` even though its main
  derivation is pure. It must move to a storage-neutral shared package, with
  storage retaining compatibility re-exports.
- Storage's per-file streaming path remains Codex-specific and must not be
  reused as a general Lite contract. Lite instead groups files by canonical
  source-session identity only for adapters that explicitly declare that
  boundary, preserving Claude parent/subagent assembly and falling back to the
  source-level collector for undeclared adapters.
- Full incremental reuse and Lite clean scans are allowed to execute
  differently, but Full reuse must remain equivalent to a clean canonical scan.
- Parity is established in tests by running both materializers against the same
  source payload, not by allowing Lite to read a Full store in production.

### User Experience Lens

- Lite must never expose `--store`, `--db`, sync/import/backup language, or an
  implicit `.cchistory` lookup. Its help and errors must describe source roots,
  live scanning, and ephemeral results.
- Explicit roots use a platform-qualified `slot=path` form so Lite never guesses
  that an arbitrary SQLite database or export bundle belongs to a tool.
- Cold-scan progress and failures must name the source. TUI navigation begins
  only from a complete snapshot in v0; it does not present partial results as
  final.
- TUI is particularly valuable because one scan is amortized across repeated
  browse/search/detail/stats operations. Refresh is explicit and discards the
  previous snapshot only after a replacement scan succeeds.
- Lite export is visibly one-way and uses its own schema marker. No output text
  may imply that it is a backup or can be restored.

### Engineering Cost And Maintainability Lens

- Avoid refactoring the existing Full CLI/TUI in the first slice. They are large
  storage-shaped surfaces, and coupling Lite to them would reintroduce the Full
  dependency that the product explicitly rejects.
- Extract only already-pure shared semantics needed for parity: project linking,
  fallback observations, search matching/ranking, and usage aggregation.
- Add a focused `live-runtime` package that materializes a read-only snapshot
  from the existing canonical `SourceSyncPayload`. The producer remains owned by
  `source-adapters`.
- Implement Lite CLI and TUI as small independent apps over `live-runtime`.
  The TUI uses Node terminal primitives rather than pulling the Full Ink TUI and
  its storage dependency into Lite.
- Use current source-shaped fixtures rather than introduce new source data. The
  change is a new consumer of already-covered adapter output, not a new platform
  parser.

### Synthesis

The agreed v0 package boundary is:

```text
@cchistory/source-adapters  canonical source producer
@cchistory/canonical        shared project/search/stats semantics
@cchistory/live-runtime     ephemeral materializer and reader
@cchistory/lite-cli         one-shot CLI and one-way export
@cchistory/lite-tui         process-lifetime terminal browser
```

`@cchistory/storage` changes only to consume or re-export the shared canonical
helpers. Lite production packages do not depend on storage. This is the minimum
complete architecture that makes future adapter registration automatically
available to both profiles without a second parser or product-specific adapter
hook.

The bounded-memory boundary is storage-neutral logical-session materialization,
not `packages/storage`'s `SourcePayloadStreamingChunk`. It must preserve
cross-file session assembly. An adapter may opt in only when its grouping key is
the same canonical source-session identity used by parsing; source-at-a-time
materialization remains the fallback for every undeclared adapter.

## Source Configuration

Lite uses adapter defaults unless the caller supplies repeatable explicit
roots:

```text
--source-root <slot-or-id>=<directory-or-native-store-path>
```

An explicit root creates a `SourceDefinition` with the same host/source identity
functions used by Full. The platform remains required so arbitrary files are
not guessed as a source format.

Lite may read a user-authored configuration file in a later slice, but v0 does
not create one. Any future configuration may contain source roots, masks, and
link rules only; it may not contain conversation history or derived turns.

## Lite Read Model

The ephemeral snapshot contains:

- host and selected source statuses
- canonical `SessionProjection`, `UserTurnProjection`, and
  `TurnContextProjection` objects
- project observations/candidates needed by the shared project linker
- resolved projects, sessions, and turns
- AskUserQuestion projections
- loss audits for the current scan
- source locators needed for detail and diagnostics

Raw blobs, records, fragments, and atoms are not exposed as a Lite product
surface. The v0 producer may temporarily materialize them because it uses the
same canonical `SourceSyncPayload`; the Lite materializer drops them after
building the snapshot.

## CLI Surface

The v0 binary is `cchistory-lite` and provides:

- `sources`
- `ls [projects|sessions|sources]`
- `tree [projects|project <ref>|session <ref>]`
- `search <query>`
- `show project|session|turn|source <ref>`
- `stats [--by source|project|model|day]`
- `export --format jsonl|json|markdown [--out <file>|-]`
- `tui` as a convenience launcher when the Lite TUI package is installed

It intentionally has no `sync`, `import`, `backup`, `restore-check`, `merge`,
`gc`, `migration`, `agent`, `--store`, or `--db` surface.

## TUI Surface

The Lite TUI is a separate runtime entrypoint so the CLI package need not depend
on Ink/React. It scans once at startup, keeps the ephemeral snapshot in memory,
and supports project/session/turn browse, search, stats, source status, detail,
and explicit refresh. Exiting the process releases the snapshot.

During an active scan, progress may be displayed, but incomplete data must be
labelled as partial. Final browse/search/stats claims are shown only after the
canonical scan completes.

## Export Contract

Lite export is deliberately one-way. It emits canonical read objects for users
and scripts and carries a distinct schema marker such as
`cchistory-lite-export/v1`. It is not a Full bundle, does not contain raw evidence
copies, and is not accepted by a Lite import command because no such command
exists.

Export is the only normal path that writes a file. `--out -` writes to stdout.

## Rejected Alternatives

### Long-Lived Lite Branch

Rejected because every adapter fix would require perpetual branch merging and
would eventually create parser drift.

### Lite Parser Or Simplified Turn Builder

Rejected because it violates semantic parity. Lite may discard intermediate
objects after derivation; it may not omit inputs that change derivation.

### Reusing Full's SQLite Store In Read-Only Mode

Rejected because it makes Lite a second client of Full storage, creates user
confusion around freshness and ownership, and prevents independent zero-store
operation.

### Shipping The Existing `--full` Path As Lite

Rejected as the final architecture because the current CLI still depends on
storage and TUI. It remains a useful parity oracle and implementation bridge.

## Acceptance Criteria

1. Lite production packages have no dependency on `@cchistory/storage`,
   `@cchistory/api-client`, or Full CLI/TUI packages.
2. Running Lite against fixture roots with a missing `~/.cchistory` succeeds and
   does not create it.
3. Lite rejects an explicit `cchistory.sqlite`, `.cchistory` root, or Full bundle
   root before opening it as source data.
4. Native upstream SQLite adapters remain supported through read-only adapter
   access.
5. For every registered fixture source in the v0 parity matrix, normalized Full
   clean-store readback equals the Lite snapshot for sources, sessions, turns,
   contexts, project resolution, and AskUserQuestion projections. Project
   normalization excludes only the materializer-specific revision counter and
   database first-seen timestamp described above.
6. Lite search and stats operate on the same canonical turn/context fields as
   Full and have deterministic tests for ordering and aggregation.
7. CLI commands listed above work with default and explicit source roots.
8. Lite export writes the documented schema and cannot be mistaken for a Full
   bundle.
9. Lite TUI starts from the same ephemeral snapshot, supports browse/search/
   detail/stats/refresh, and creates no persistent store.
10. Existing Full package tests remain green for every shared package changed.

## Initial Known Limitations

- Cold commands rescan selected source roots and can be slower than Full's
  indexed reads.
- Full-context snapshots (notably the TUI, turn/session detail, and JSON/JSONL
  export) can still be large because complete assistant/tool context is retained
  for the process lifetime. Context-light CLI reads (`sources`, `ls`, `tree`,
  `search`, `stats`, project/source detail, and Markdown export) release context
  after each logical session.
- Adapters without a declared logical-session grouping boundary still use
  source-at-a-time materialization; any future opt-in requires parity coverage.
- Full manual project overrides and custom masks affect Lite only when equivalent
  explicit rule inputs are supplied; v0 supports built-in/default rules.
- Lite is single-host and does not merge remote or previously exported history.

## Implemented Packages And Validation

Implemented surface:

- `packages/source-adapters`: shared producer exports only where required
- shared canonical project-link/read helpers extracted from storage-owned code
- new non-persistent live runtime package
- new Lite CLI and Lite TUI apps
- Full storage imports updated to consume the shared canonical helper
- runtime/docs/backlog/build scripts

Validation remained package-scoped and sequential on the local profile.

## Completion Evidence

- `@cchistory/source-adapters` remains the only registered source producer for
  both profiles. Adding or fixing an adapter does not require a Lite-specific
  parser or registration path.
- `@cchistory/canonical` owns shared project linking, fallback observations,
  read ordering, search matching/ranking, and usage aggregation. Full storage
  consumes or compatibility-re-exports these implementations.
- `@cchistory/live-runtime` builds one process-lifetime snapshot without a
  production dependency on storage. It rejects Full store and bundle roots,
  including ancestor and symlink resolutions, while upstream native SQLite
  fixtures remain byte- and mtime-stable with no WAL/SHM creation.
- Codex and Claude Code scans are bounded by one canonical logical session for
  context-light commands. Claude parent/subagent and cross-path files are
  grouped by the source-session ID before projection, with fixture parity
  against the source-level collector.
- `cchistory-lite` implements the documented read commands and one-way
  JSONL/JSON/Markdown export. Export writes are explicit and destination paths
  are resolved before opening so symlinks cannot redirect output into native
  source data or the Full store.
- `cchistory-lite-tui` amortizes one complete scan across browse, search,
  detail, stats, and source-health commands. Refresh replaces the snapshot only
  after a successful scan; failure leaves the previous complete view intact.
- The fixture-backed parity matrix covers Codex, Claude Code, Factory Droid,
  AMP, Cursor, Antigravity, Gemini CLI, OpenClaw, OpenCode, CodeBuddy, and Accio
  Work. It compares normalized projects, deterministic session/turn ordering,
  contexts, AskUserQuestion projections, search results, and usage statistics
  against clean Full materialization.
- Validation passed on 2026-07-18: `pnpm run verify:lite`,
  `pnpm --filter @cchistory/source-adapters test`,
  `pnpm --filter @cchistory/storage test`, `pnpm run test:e2e`,
  `pnpm run verify:cli-tui-read-side`, `pnpm run verify:support-status`, and
  `pnpm run verify:runtime-inventory`.
