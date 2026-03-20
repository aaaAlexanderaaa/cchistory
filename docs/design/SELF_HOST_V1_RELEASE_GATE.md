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

### 5. Stable adapters use real-world validated samples and regression tests

- `stable` means the adapter has been validated against real-world source data
  and is covered by regression tests.
- Registered adapters that only have fixtures, parser scaffolding, or
  speculative path assumptions must stay `experimental`.

### 6. README, runtime surface, and registry agree on support status

- User-facing support claims must match code-level support tier metadata.
- `registered` and `supported` must not be used interchangeably.

## Support Tiers

Current self-host v1 support tiers:

| Tier | Platforms | Meaning |
| --- | --- | --- |
| `stable` | `codex`, `claude_code`, `factory_droid`, `amp`, `cursor`, `antigravity` | real-world validated and expected to be covered by regression tests |
| `experimental` | `openclaw`, `opencode`, `lobechat` | registered in code, but not yet validated enough for self-host v1 support claims |

## Out Of Scope For Self-Host V1

The following are intentionally excluded from this gate:

- multi-user auth or RBAC
- tenant isolation
- horizontal scaling
- Kubernetes or distributed orchestration
- SaaS-grade tracing or fleet operations

## Recommended Validation Commands

Use the smallest targeted command that proves the changed layer:

- `pnpm --filter @cchistory/source-adapters test`
- `pnpm --filter @cchistory/storage test`
- `pnpm --filter @cchistory/api test`
- `cd apps/web && pnpm lint`
- `NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @cchistory/web build`
