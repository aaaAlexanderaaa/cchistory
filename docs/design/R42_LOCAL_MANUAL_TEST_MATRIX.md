# R42 Local Manual Test Matrix

## Status

- Objective: `R42 - Skeptical Operator Regression Expansion`
- Date: 2026-04-03
- Scope: the non-service local command, parameter, backup/restore, and browse/search checks that can be executed directly on this host without user-started managed services

## Why This Exists

The repository already has automated verifier coverage plus two skeptical manual
review diaries, but future sessions still need one compact matrix that makes the
remaining locally executable hand-testing work obvious. This note prevents the
workflow from drifting back into vague review or re-discovering the same manual
checks from scratch.

## Local Non-Service Manual Matrix

### Scenario group: skeptical CLI bundle / restore workflow

- prerequisite: built CLI available via `pnpm --filter @cchistory/cli build`
- setup: temp HOME with a local Codex fixture root plus separate source/target stores
- core commands:
  - `node apps/cli/dist/index.js sync --store <source-store> --source codex`
  - `node apps/cli/dist/index.js backup --store <source-store> --out <bundle-a>`
  - `node apps/cli/dist/index.js backup --store <source-store> --out <bundle-a> --write`
  - `node apps/cli/dist/index.js import <bundle-a> --store <target-store>`
  - mutate one Codex prompt locally, then run `sync` again
  - `node apps/cli/dist/index.js export --store <source-store> --out <bundle-b>`
  - `node apps/cli/dist/index.js import <bundle-b> --store <target-store>`
  - `node apps/cli/dist/index.js import <bundle-b> --store <target-store> --dry-run`
  - `node apps/cli/dist/index.js import <bundle-b> --store <target-store> --dry-run --on-conflict replace`
  - `node apps/cli/dist/index.js import <bundle-b> --store <target-store> --on-conflict skip`
  - `node apps/cli/dist/index.js import <bundle-b> --store <target-store> --on-conflict replace`
  - `node apps/cli/dist/index.js restore-check --store <target-store>`
  - `node apps/cli/dist/index.js restore-check --store <missing-store>`
- expected evidence:
  - preview-first `backup` remains clear and non-mutating by default
  - write-mode `backup` creates a real bundle
  - default conflict import fails clearly without runtime warning noise
  - `--dry-run` and `--on-conflict skip|replace` remain truthful and readable
  - replaced import makes the updated prompt searchable and inspectable
  - `restore-check` stays read-only and missing-store guardrails remain explicit
- automated counterpart:
  - `pnpm run verify:skeptical-cli-bundle-restore`

### Scenario group: skeptical CLI/TUI browse / search / full snapshot workflow

- prerequisite: built CLI and TUI available via `pnpm --filter @cchistory/cli build` and `pnpm --filter @cchistory/tui build`
- setup: temp HOME seeded from repo `mock_data/.claude` and `mock_data/.openclaw`
- core commands:
  - `node apps/cli/dist/index.js sync --store <store> --source claude_code`
  - `node apps/cli/dist/index.js sync --store <store> --source openclaw`
  - `node apps/cli/dist/index.js ls projects --store <store> --long`
  - `node apps/cli/dist/index.js ls sessions --store <store> --long`
  - `node apps/cli/dist/index.js search "expert code reviewer" --store <store>`
  - `node apps/cli/dist/index.js search "expert code reviewer" --store <store> --project <project-id>`
  - `node apps/cli/dist/index.js search "expert code reviewer" --store <store> --source claude_code`
  - `node apps/cli/dist/index.js search "expert code reviewer" --store <store> --source claude_code --limit 1`
  - `node apps/cli/dist/index.js show turn <turn-id> --store <store>`
  - `node apps/cli/dist/index.js show session <session-id> --store <store>`
  - `node apps/cli/dist/index.js tree project <project-id> --store <store> --long`
  - `node apps/cli/dist/index.js tree session <session-id> --store <store> --long`
  - `node apps/cli/dist/index.js tree session missing-session --store <store>`
  - `node apps/cli/dist/index.js show turn missing-turn --store <store>`
  - `node apps/tui/dist/index.js --store <store>`
  - `node apps/tui/dist/index.js --store <store> --search "expert code reviewer"`
  - `node apps/tui/dist/index.js --store <store> --full --source codex --search "<live-only prompt>"`
  - `node apps/tui/dist/index.js --store <store> --full --source codex --search "<live-only prompt>" --source-health`
  - `node apps/tui/dist/index.js --store <missing-store> --full --source codex --search "<missing-store live prompt>"`
  - `node apps/tui/dist/index.js --store <missing-store>`
- expected evidence:
  - long listings feel dense but readable, especially `Source Mix`, `Related Work`, and workspace cues
  - search output exposes turn/session pivots clearly and preserves related-work trust cues across `--project`, `--source`, and `--limit` variants
  - project/session tree snippets stay evidence-preserving while using the same display-only command-markup normalization as search/TUI browse surfaces
  - missing-turn and missing-session paths are explicit and quiet
  - TUI browse/search snapshots stay readable and do not leak runtime warning noise
  - TUI `--full` snapshots tell the truth about indexed-vs-live reads, keep the combined source-health overlay readable, and succeed against a missing store without creating an indexed DB
- automated counterpart:
  - `pnpm run verify:skeptical-browse-search`
  - `pnpm run verify:skeptical-tui-full-snapshot`
  - `pnpm run verify:local-full-read-bundle`

## Still Blocked On User-Started Services

A direct answer to the "have we actually used this like a picky operator?" question now exists in `docs/design/R121_CONSOLIDATED_SKEPTICAL_LOCAL_FLOW_DIARY_2026-04-03.md`, which stitches the source-tree CLI, installed artifact CLI, and TUI portions of this matrix into one contiguous local flow.

The following remain intentionally outside this local manual matrix because they
require user-started managed services:

- `R31-KR1` seeded web review diary
- `R31-KR2` managed API read diary
- `R35-KR1` remote-agent pair/upload/schedule diary
- `R35-KR2` remote-agent leased-pull diary

Use the existing contracts instead of inventing alternate startup paths:

- `docs/design/R27_USER_STARTED_WEB_REVIEW_CHECKLIST.md`
- `docs/design/R31_MANAGED_API_READ_DIARY_CONTRACT.md`
- `docs/design/R29_REMOTE_AGENT_VALIDATION_CONTRACT.md`

## Next Local Execution Rule

If a future session still has no user-started services available, it should use this order before falling back to broader KR review:

1. Run `pnpm run verify:local-full-read-bundle` as the default local full-read confidence pass.
2. If that surface changed, run the lightweight drift guards too: `node --test scripts/verify-local-full-read-bundle.test.mjs` and `node --test scripts/verify-cli-artifact.test.mjs scripts/verify-local-full-read-bundle.test.mjs`.
3. Use `docs/design/R121_CONSOLIDATED_SKEPTICAL_LOCAL_FLOW_DIARY_2026-04-03.md` when one contiguous skeptical-user local walkthrough is needed instead of isolated command checks.
4. Use the manual commands in this matrix when direct operator readability or workflow-trust evidence is still needed for one narrower slice.
5. Keep the managed-runtime diary work under `R31` and `R35` blocked until the user has started the required services.
