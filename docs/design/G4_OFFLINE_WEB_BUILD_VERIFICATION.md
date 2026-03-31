# G4 Offline Web Build Verification

## Status

- Objective: `G4 - Offline Web Build Verification`
- Backlog status after this note: `done`
- Scope: decomposition, verifier implementation, validation, and holistic
  evaluation in one execution pass

## Phase 1: Domain Understanding

### What exists today

- The web app builds with `next build` via `apps/web/package.json`.
- Static audit of `apps/web` shows no `next/font/google`, no Google Fonts URLs,
  and no obvious external asset URLs in the web source tree.
- The only direct `fetch()` call in `apps/web` is the internal API proxy route
  under `app/api/cchistory/[...path]/route.ts`, which is runtime behavior rather
  than a build-time asset dependency.
- A normal production build already succeeds with
  `NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @cchistory/web build`.

### Key finding

- A fully isolated network namespace (`unshare -n`) is too strong for this gate
  because Next.js/Turbopack uses local worker processes that still need loopback
  communication. That failure mode does not prove a public-internet dependency.
- The right verifier is therefore: block external network sockets while still
  allowing loopback traffic required by local worker orchestration.

## Phase 3: Functional Design

### Problem statement

The repository needs a reproducible proof that `apps/web` production builds do
not require the public internet. Static code audit suggests the app is already
clean, but Gate 4 needs an executable validation path rather than manual source
inspection alone.

### Decided approach

1. Add a repository-owned verifier script that deletes `apps/web/.next`,
   installs a temporary Node preload hook that blocks external `net` / `tls`
   connections, and runs `pnpm build` inside `apps/web`.
2. Allow loopback hosts (`localhost`, `127.0.0.1`, `::1`, `0.0.0.0`) so local
   build workers continue to function.
3. Document the verifier as the Gate 4 validation command.

### Acceptance criteria

1. A repository command runs the canonical `apps/web` production build while
   blocking public-internet network sockets.
2. The verifier passes on the current web app.
3. Docs identify the verifier as the Gate 4 validation path.

## Current execution evidence

- Static source audit found no external-font or asset-fetch build hooks in
  `apps/web`.
- A normal web production build passed on 2026-03-27.
- An external-network-blocked build also passed on 2026-03-27 using the same
  canonical `next build` path with loopback-only socket access.

## Phase 7 Evaluation Report

### Result

- Pass on 2026-03-27.

### Dimensions evaluated

- **Boundary evaluation**: pass. The change adds only a build verifier script and
  release-gate-facing documentation; it does not alter product UI behavior.
- **Stability assessment**: pass. The verifier removes stale `.next` output
  before each run and blocks external sockets at the Node runtime layer, which
  is more reliable for this gate than code inspection alone.
- **Scalability evaluation**: pass for the gate scope. This is a build-time
  validation path, not a runtime throughput change.
- **Compatibility assessment**: pass. No API, storage, or schema behavior is
  changed.
- **Security evaluation**: pass. The verifier intentionally restricts network
  egress during build and therefore reduces, rather than increases, exposure.
- **Maintainability assessment**: pass. The verifier is self-contained and makes
  the offline-build requirement easy to rerun locally.

### Known limitations accepted

- The verifier blocks external sockets at runtime instead of running in a fully
  air-gapped environment. This is accepted because it preserves required
  loopback worker communication while still detecting public-internet build
  dependencies.

### Conclusion

- `G4 - Offline Web Build Verification` satisfies its current acceptance
  criteria and can be marked `done`.

