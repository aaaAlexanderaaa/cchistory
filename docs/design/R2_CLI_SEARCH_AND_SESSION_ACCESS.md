# R2 - CLI Search And Session Access Improvements

## Status

- Objective source: `docs/ROADMAP.md`
- Current implementation slices: direct single-session access; partial multi-token search
- Multi-perspective design protocol: skipped for this slice because the change is
  a narrow CLI resolution improvement that does not alter frozen domain
  semantics, storage contracts, or UI/API projections.

## Phase 1 - Domain Understanding

### Current behavior

- `apps/cli/src/index.ts` implements `show session <ref>` by resolving only an
  exact session ID through `storage.getResolvedSession(ref) ??
  storage.getSession(ref)`.
- `query session --id <ref>` has the same exact-ID-only behavior.
- `ls sessions` does not expose session `title` or `working_directory` in the
  human-readable table, so users cannot easily discover alternate handles.
- `packages/storage/src/internal/storage.ts` exposes `SessionProjection` data
  with the fields already needed for a friendlier read workflow: `id`, `title`,
  `working_directory`, `primary_project_id`, and timestamps.
- `searchTurns` is currently exact-phrase / exact-substring oriented:
  FTS-backed mode quotes the entire query as one phrase, and fallback mode uses
  a plain lowercased substring search.

### What is known

- The frozen model remains project-first and `UserTurn`-first. Improving how the
  CLI resolves a session reference does not change canonical semantics.
- The missing usability gap is at the CLI projection layer, not in the evidence
  or derivation layers.
- Session detail is already available once a session ID is known; the friction is
  choosing and typing that ID.

### What remains deferred

- True typo-tolerant edit-distance search is still out of scope. The completed
  search slice improves partial multi-token matching without introducing
  guess-heavy ranking rules.

## Phase 2 - Test Data Preparation

No new `mock_data/` corpus is required for this slice.

- Existing CLI integration fixtures in `apps/cli/src/index.test.ts` already
  cover realistic session shapes with IDs, titles, and working directories.
- Additional ambiguity cases can be created inside package-scoped CLI tests
  without introducing new product fixtures or touching evidence-preserving
  source corpora.

## Phase 3 - Functional Design

### Problem statement

The roadmap calls for a more direct single-session read workflow. Today the CLI
already has session detail commands, but they require the operator to know the
full session ID up front. That creates unnecessary friction because the CLI
already stores human-friendly session signals such as session title and working
workspace.

### Decided approach

Implement a shared CLI-level session reference resolver and wire it into both
`show session` and `query session --id`.

Resolution order for this slice:

1. Exact session ID.
2. Unique session ID prefix.
3. Unique case-insensitive session title.
4. Unique case-insensitive working-directory match by full path or basename.

Also expand `ls sessions` human-readable output to include `Title` and
`Workspace`, so the handles that the resolver accepts are visible in normal
operator output.

### Slice 2 - Partial multi-token search

For `cchistory search`, tokenize the query into case-insensitive word terms and
match all terms without requiring the user to type one exact phrase.

- Indexed mode uses prefix-style FTS matching for each token.
- Fallback mode requires every token to appear as a substring in the turn text.
- Highlights mark the matched token fragments rather than only the full raw
  query string.

### Trade-offs and rejected alternatives

- Rejected: add a brand-new command for session drill-down. The existing
  `show session` and `query session` commands already own this workflow.
- Rejected: implement guess-heavy typo correction or edit-distance ranking in
  this pass. Partial matching solves the roadmap's immediate exact-keyword pain
  without making relevance opaque.
- Rejected: silently pick one session when multiple titles or workspace labels
  match. Ambiguity must be surfaced explicitly so the CLI stays explainable.

### Acceptance criteria

- `show session <ref>` accepts a unique session ID prefix.
- `show session <ref>` accepts a unique session title or workspace label.
- `query session --id <ref>` uses the same reference resolution behavior.
- Ambiguous human-friendly references fail with an explicit error instead of
  guessing.
- `ls sessions` human-readable output shows session title and workspace so those
  references are discoverable.
- `cchistory search` matches partial multi-token queries without requiring one
  exact phrase.
- Indexed and fallback search modes both preserve explainable matching behavior.

### Impact on existing system

- Affected package: `apps/cli`
- Affected files: `apps/cli/src/index.ts`, `apps/cli/src/index.test.ts`, and
  user-facing CLI guide docs.
- No changes to canonical storage schema, linker behavior, source adapters, or
  frozen domain semantics.
