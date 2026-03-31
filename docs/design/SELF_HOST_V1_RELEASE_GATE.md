# Self-Host V1 Release Gate

This document freezes the minimum release gate for a `single-user`, `self-host`,
`localhost-or-trusted-LAN` CCHistory v1 release.

It is intentionally narrower than a hosted multi-user SaaS bar. It does not add
requirements for RBAC, tenant isolation, horizontal scaling, or cluster
operations.

## Scope

This gate applies only when all of the following are true:

- One user owns the local store and source roots.
- The default deployment target is `localhost` or a trusted LAN behind an
  operator-managed reverse proxy.
- SQLite remains the canonical store.
- Source ingestion stays local-first or import-bundle-first.

## Release Gate

Call a release `self-host v1` only when all six conditions below are true.

### 1. A clean machine can install from docs

- The repository documents one canonical install path.
- A clean machine can complete install and first build by following the docs
  only.
- Supported Node and pnpm versions are explicit.
- The verification command must stay scoped to install plus the first non-web
  build. Web production build validation remains Gate 4.

### 2. Upgrades do not damage an existing store

- Schema evolution is explicit and versioned.
- Upgrade steps are documented.
- Operators know when a pre-upgrade backup is required.

### 3. Backup and restore work on a clean directory

- The backup unit is documented, including whether raw blobs are included.
- Restore instructions are tested against an empty target directory.
- Post-restore validation confirms turns, sessions, and sources are readable.

### 4. Web production builds do not require the public internet

- The canonical `apps/web` production build succeeds without fetching external
  fonts or other web assets at build time.
- CI and restricted-network operators can produce the same build artifact.
- The gate should be verifiable through a repository command that blocks
  external network access while preserving required loopback worker traffic.

### 5. Stable adapters use real-world validated samples and regression tests

- `stable` means the adapter has been validated against real-world source data
  and is covered by regression tests.
- The repository records that proof in `mock_data/stable-adapter-validation.json`,
  and `pnpm --filter @cchistory/source-adapters test` must keep that proof green.
- Registered adapters that only have fixtures, parser scaffolding, or
  speculative path assumptions must stay `experimental`.

### 6. README, runtime surface, and registry agree on support status

- User-facing support claims must match code-level support tier metadata.
- `pnpm run verify:support-status` validates the support-tier claims in `README.md`, `README_CN.md`, `docs/design/CURRENT_RUNTIME_SURFACE.md`, `docs/design/SELF_HOST_V1_RELEASE_GATE.md`, and `docs/sources/README.md` against the adapter registry.
- `registered` and `supported` must not be used interchangeably.

## Support Tiers

Current self-host v1 support tiers:

| Tier | Platforms | Meaning |
| --- | --- | --- |
| `stable` | `codex`, `claude_code`, `factory_droid`, `amp`, `cursor`, `antigravity` | real-world validated and expected to be covered by regression tests |
| `experimental` | `gemini`, `openclaw`, `opencode`, `lobechat` | registered in code, but not yet validated enough for self-host v1 support claims |

## Out Of Scope For Self-Host V1

The following are intentionally excluded from this gate:

- multi-user auth or RBAC
- tenant isolation
- horizontal scaling
- Kubernetes or distributed orchestration
- SaaS-grade tracing or fleet operations

## Recommended Validation Commands

Use the smallest targeted command that proves the changed layer:

- `pnpm run verify:clean-install`
- `pnpm run verify:web-build-offline`
- `pnpm run verify:support-status`
- `pnpm --filter @cchistory/source-adapters test`
- `pnpm run mock-data:validate`
- `pnpm --filter @cchistory/storage test`
- `pnpm --filter @cchistory/api test`
- `cd apps/web && pnpm lint`
- `NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @cchistory/web build`
