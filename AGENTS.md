# Repository Guidelines

## Operating Order

When an agent starts without a specific user instruction:

1. Read `BACKLOG.md`.
2. Follow the decision tree in `PIPELINE.md`.
3. Before changing docs, code, data models, or source semantics, read
   `HIGH_LEVEL_DESIGN_FREEZE.md`.

When the user gives a specific instruction, satisfy that instruction while still
preserving the frozen design invariants.

## Source Of Truth

- `HIGH_LEVEL_DESIGN_FREEZE.md` defines product semantics and architecture.
- `docs/design/CURRENT_RUNTIME_SURFACE.md` is the current repository-visible
  runtime inventory.
- `PIPELINE.md` defines work decomposition and completion rules.
- `BACKLOG.md` is the living work surface.

Preserve these invariants unless the user explicitly asks for a redesign:

- project-first history
- `UserTurn` as the primary recall object
- evidence-preserving ingestion
- UI and API as projections of one canonical model

Broader enums in `packages/domain` or `packages/api-client` are schema
allowance, not proof that a live adapter exists. The registered adapter roster
and support tiers live in
`packages/source-adapters/src/platforms/registry.ts` and are checked by
`pnpm run verify:support-status`.

## Repository Map

- Root docs plus `docs/`: design, runtime inventory, guides, source notes,
  templates, screenshots, and backlog workflow.
- `apps/api`: Fastify managed API, admin routes, probe/replay routes, and
  remote-agent control plane under `/api/agent/*` and `/api/admin/agents*`.
- `apps/web`: canonical mouse-first end-user frontend.
- `apps/cli`: admin and AI-agent surface for sync, discover, health,
  export/import/backup, GC, remote-agent ops, and scriptable `query --json`.
- `apps/tui`: canonical keyboard-first local read surface for projects,
  sessions, turns, full conversation drill-down, search, stats, and source
  health.
- `packages/domain`: canonical contracts and terms.
- `packages/source-adapters`: adapter registry, discovery, parsing, atomization,
  and projection.
- `packages/storage`: SQLite persistence, linking, lineage, search, tombstones,
  and read projections.
- `packages/api-client`: shared API DTO contract.
- `packages/presentation`: UI-facing mapping and formatting helpers.
- `.cchistory/`: local runtime state and evidence-derived data for this
  workspace. Inspect when needed; do not delete or regenerate casually.
- `mock_data/`: sanitized source-shaped fixtures. Preserve scenario coverage.

## Surface Roles

- CLI is the admin / AI-agent surface. Browse commands exist, but end-user
  reading should primarily live in TUI and Web.
- TUI is the primary terminal end-user read surface.
- Web is the richer end-user read and admin surface.
- API is the managed programmatic surface.

Review the entrypoint before changing a surface:

- `apps/cli/src/index.ts`
- `apps/tui/src/index.ts`
- `apps/web/app/page.tsx`
- `apps/web/components/app-shell.tsx`
- `apps/api/src/app.ts`

## Validation Commands

Prefer the smallest package-scoped command that proves the changed layer.
Repository-root aggregate scripts exist, but they are not the default path on
the local Codex desktop host.

Package checks:

- `pnpm --filter @cchistory/domain build`
- `pnpm --filter @cchistory/domain test`
- `pnpm --filter @cchistory/source-adapters build`
- `pnpm --filter @cchistory/source-adapters test`
- `pnpm --filter @cchistory/storage build`
- `pnpm --filter @cchistory/storage test`
- `pnpm --filter @cchistory/api-client build`
- `pnpm --filter @cchistory/api-client test`
- `pnpm --filter @cchistory/presentation build`
- `pnpm --filter @cchistory/presentation test`
- `pnpm --filter @cchistory/cli build`
- `pnpm --filter @cchistory/cli test`
- `pnpm --filter @cchistory/tui build`
- `pnpm --filter @cchistory/tui test`
- `pnpm --filter @cchistory/api build`
- `pnpm --filter @cchistory/api test`
- `cd apps/web && pnpm lint`
- `NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @cchistory/web build`

Repository verification:

- `pnpm run validate:core`
- `pnpm run verify:clean-install`
- `pnpm run verify:cli-artifact`
- `pnpm run verify:web-build-offline`
- `pnpm run verify:support-status`
- `pnpm run verify:runtime-inventory`
- `pnpm run verify:cli-tui-read-side`
- `pnpm run verify:v1-seeded-acceptance`
- `pnpm run verify:read-only-admin`
- `pnpm run verify:fixture-sync-recall`
- `pnpm run verify:bundle-conflict-recovery`
- `pnpm run verify:real-layout-sync-recall`
- `pnpm run verify:related-work-recall`
- `pnpm run prepare:v1-seeded-web-review -- --store <dir>`
- `pnpm run verify:real-archive-probes`
- `pnpm run probe:smoke -- --source-id=src-codex --limit=1`
- `pnpm run mock-data:validate`
- `pnpm run build`
- `pnpm run build:all:safe`

Use `pnpm run build` and `pnpm run build:all:safe` only when explicit
full-workspace validation is warranted.

Use `pnpm run verify:cli-tui-read-side` as the repeatable local quality gate
when work affects CLI/TUI read-side behavior, read/admin command paths, or
source-shaped E2E parity. It is sequential and does not start persistent
services.

## Local Codex Desktop Profile

Use this profile on the developer host at
`/Users/alex/Workspace/my_opensource/cchistory`.

Assume the host is memory constrained: about 4 GB RAM, with about 3 GB usable.

- Do not run root `pnpm install` unless the user explicitly asks and accepts the
  memory tradeoff.
- Do not run root `pnpm build` as a default verification step.
- Do not launch multiple TypeScript, Vite, or Next build processes in parallel.
- Prefer targeted package tests, targeted typechecks, node-only verifier
  scripts, or focused probes.
- For web builds, run the web package alone with capped Node memory.

### Dev Services On Local Codex Desktop

The canonical product runtime is `scripts/dev-services.sh` through the
`pnpm services:*` wrappers. `pnpm restart:web` and `pnpm restart:api` are
compatibility aliases only.

The Codex agent environment cannot reliably manage persistent services. On this
profile, agents must not run:

- `pnpm services:start`
- `pnpm services:stop`
- `pnpm services:restart`
- `pnpm restart:web`
- `pnpm restart:api`
- `scripts/dev-services.sh`
- direct long-lived dev-server commands such as `pnpm dev`, `next dev`,
  `tsx watch`, `nohup`, or background service jobs

If a task needs API or Web running, make code/config changes and ask the user to
run the canonical command manually. Non-persistent inspection such as
`pnpm services:status`, `lsof`, `curl`, and browser checks is allowed only
against services the user already started.

## Cursor Cloud Profile

Use this profile only when the environment or the user explicitly says the work
is running in Cursor Cloud.

The Cloud Agent VM has more memory than the local developer host. In that
environment, root-level dependency install and sequential full builds are
acceptable.

Dependency install:

1. `pnpm install`
2. `cd apps/web && pnpm install`

Build:

1. `pnpm run build`
2. `NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @cchistory/web build`

Services:

- API: port `8040`, canonical start `pnpm services:start` or
  `bash scripts/dev-services.sh start api`
- Web: port `8085`, canonical start `bash scripts/dev-services.sh start web`
- If Web readiness times out, verify with
  `curl -s -o /dev/null -w '%{http_code}' http://localhost:8085/`

Runtime notes:

- Storage uses Node.js built-in `node:sqlite` (`DatabaseSync`).
- FTS5 may be unavailable; fallback substring search is expected.
- No Docker, external database, or `.env` file is required by default.

## Web Runtime Workflow

When a user is actively reviewing `apps/web` UI changes on the local Codex
desktop profile, the web dev server should be user-started and reachable on
`0.0.0.0:8085`. After meaningful web code changes that need live review, tell
the user which canonical runtime command to run manually.

## Browser Automation Policy

Browser automation for this repository must use MCP/plugin automation or an
explicitly configured wrapper. Do not hard-code a contributor-specific home
directory into repository instructions.

- Prefer the Browser Use plugin or another available MCP browser tool.
- If terminal Playwright is required, use the wrapper path configured for the
  current environment.
- Do not invoke `npx playwright`, `playwright-cli`, cached Playwright binaries,
  global Playwright installs, or ad hoc Playwright paths.
- If the configured wrapper is missing or broken, fix the wrapper or ask the
  user instead of bypassing it.

## Data And Fixture Safety

- Do not delete, reset, or casually regenerate `.cchistory/`.
- Do not trim `mock_data/` to make tests pass. Preserve scenario coverage.
- After changing `mock_data/` or fixture generator/validator code under
  `scripts/`, run `pnpm run mock-data:validate`.
- Never delete local source capture roots such as `/root/.codex`,
  `/root/.claude`, `/root/.factory`, `/root/.local/share/amp`, or platform
  native Cursor/Antigravity user-data directories as cleanup or debugging.

## Temp File And Disk Hygiene

The operator store at `/root/.cchistory` is multi-gigabyte. Bundle exports,
pre-bundle snapshots, and B.4a validator comparison dirs can each match
that size. `/tmp` is on the same filesystem as the operator store, source
capture roots, and tool caches — large temp artifacts must be managed
explicitly, not abandoned.

- Before creating any temp artifact expected to exceed 100 MiB (bundle
  exports, full-store snapshots, byte-diff comparison dirs), run `df -h /`
  and confirm at least 2x the artifact size is free.
- SQLite VACUUM (in-place rewrite) needs the same 2x headroom — it writes a
  new compacted file alongside the original, then atomically renames. The
  `migration compact` pre-flight gate enforces 1.5x for stores ≤2 GiB and
  2x for stores >2 GiB; the same rule applies to `VACUUM INTO`, schema
  rebuilds, and any "rewrite-the-whole-file" operation.
- Capture pre-bundle snapshots in `mkdtemp` dirs and `rm` them in a
  `finally` block as soon as the consuming validator has finished. The
  CLI migration validator already does this for its post-comparison bundle;
  pre-bundle snapshots captured by hand need the same cleanup.
- Never leave validation artifacts in `/tmp` across turns. A step that
  produces a multi-gigabyte file owns its cleanup — surfacing "done" while
  the artifact sits in `/tmp` is not done.
- If the disk fills mid-task, stop and tell the user. Do not delete user
  data (Codex/Claude/Factory session caches, source capture roots,
  `.local/share`, `.cache/ms-playwright`, etc.) to force the step through.

## Storage And Preservation Invariants

These invariants apply across every storage layer transition (V1→V2 was
one; there will be others). The rules are written at logic level — current
implementation names (V1, V2, payload_json, evidence/blobs, SQLite) appear
only in examples and can be updated independently of the rule.

- **Parser input is authoritative; parser output is derived.** Raw capture
  bytes must be preserved independently of any derived representation, in a
  form whose integrity can be verified (checksummed or content-addressed).
  Derived data can always be rebuilt from input; input cannot be rebuilt
  from output. Any proposal to drop parser input "to save space" is
  rejected by default — the only acceptable path is an explicit,
  human-approved decision to permanently lose reinterpretation capability
  for that data.

- **Product value hierarchy when designing bounded fields.** In order:
  1. User input (`user_messages`, `raw_text`) — inviolable
  2. Session statistics and AI interaction process — secondary
  3. Architectural value props (dedup, page cache hit rate, content-
     addressed integrity) — means, not ends

  Never let architectural elegance (bounded sidecar, predictable row size)
  dictate dropping fields from tier 1. Bounded fields holding tier-1
  content must be functionally lossless for real-world data (e.g. 256 KiB
  to 1 MiB for text), or the field must be stored in full. Tiny metadata
  fields (timestamps, IDs, paths) cost essentially nothing to store —
  never omit them from a sidecar.

- **Evidence blob ref inventory.** `evidence_blobs.sha256` is referenced
  from six columns today (`evidence_captures.evidence_sha256`,
  `parsed_record_spans.evidence_sha256`,
  `source_file_ledger.current_evidence_sha256`,
  `turn_context_refs_v2.context_evidence_sha256`,
  `derived_cache_refs.evidence_sha256`,
  `user_turns_v2.lineage_blob_sha256`). When adding a new ref column,
  update BOTH prune sites: `pruneUnreferencedEvidenceBlobsInTransaction`
  in `packages/storage/src/internal/gc.ts` AND
  `retireStorageBoundaryV2Sources` in `packages/storage/src/evidence-store.ts`.
  Missing one silently prunes live blobs on the next GC pass.

## Coding Style And Naming

Keep changes small and trace them back to the design freeze. Reuse canonical
terms exactly: `UserTurn`, `ProjectIdentity`, `MaskTemplate`,
`KnowledgeArtifact`, `candidate`, `committed`, and `unlinked`.

Source-specific quirks must stop at the capture/parse boundary and must not
leak into product semantics.

## Bug Handling And Evidence Preservation

- Treat parsing, ingestion, masking, and UI rendering bugs as potentially
  class-wide until checked.
- Preserve raw evidence and evidence-derived message content whenever it
  exists.
- Use `MaskTemplate` or masked display behavior when content should be
  collapsed, redacted, or deemphasized.
- Never fix visualization problems by silently stripping real captured content
  from the evidence model.

## Testing Guidelines

Test the layer changed. Design-only edits should cite the affected sections in
`HIGH_LEVEL_DESIGN_FREEZE.md`. Reference-code work should run only relevant
legacy tests and clearly state what slice the result validates.

## Commit And PR Guidelines

Use short Conventional Commit subjects such as `feat:` and `docs:`. PRs should
state whether the change affects frozen design, imported UI reference material,
or archived parser research. List commands run. For UI exploration changes,
include screenshots labeled as demo/reference output.
