# G1 Clean Machine Install Verification

## Status

- Objective: `G1 - Clean Machine Install Verification`
- Backlog status after this note: `done`
- Scope: decomposition output for Pipeline Phases 1-3

## Phase 1: Domain Understanding

### What exists today

- The self-host v1 release gate requires one canonical install path, a docs-only
  clean-machine install + first-build flow, and explicit supported Node/pnpm
  versions. See `docs/design/SELF_HOST_V1_RELEASE_GATE.md`.
- Public install guidance already exists in `README.md` and `README_CN.md`.
  Both currently describe a two-step dependency install because the repository
  uses two lockfiles: one at the root and one under `apps/web`.
- The repository root already pins pnpm via `packageManager:
  "pnpm@10.30.3"` in `package.json`.
- The repository does not currently declare supported Node versions in a
  machine-readable way. No `engines.node`, `.nvmrc`, or equivalent root-level
  version file exists.
- No dedicated verification script exists that proves a fresh clone can follow
  the canonical docs path without relying on preexisting `node_modules`.

### Constraints and boundaries

- The repo has two dependency installation steps by design. Any "one canonical
  install path" must preserve that reality rather than pretending the workspace
  has one lockfile.
- Validation must not delete or mutate `.cchistory/`, root `node_modules`, or
  the operator's working tree.
- This objective should not absorb Gate 4. Web production build verification is
  already split into `G4 - Offline Web Build Verification`.
- The canonical runtime includes `apps/web`, so the clean-machine install path
  still needs to install the web app dependencies even if the G1 verification
  harness stops short of a production Next.js build.

### Gaps confirmed

1. The supported Node version is documented in README text but not enforced or
   exposed in machine-readable metadata.
2. The docs describe the install path, but there is no executable harness that
   proves those steps work from a clean copy.
3. The boundary between "clean install + first build" and "offline web
   production build" is not explicit, which risks overlap between G1 and G4.

### Assumptions

- The current public support statement remains the intended contract for now:
  Node.js `>= 22` and pnpm `10.x`.
- For G1, "first build" should mean the first documented non-web workspace
  build (`pnpm run build`) after both lockfiles are installed. The stricter web
  production build remains G4.

## Phase 3: Functional Design

### Problem statement

Operators can read install instructions today, but the repository cannot yet
prove that those instructions succeed on a clean machine. The current docs also
lack machine-readable Node support metadata, which leaves the release gate's
"supported Node and pnpm versions are explicit" criterion only partially
fulfilled.

### Decided approach

1. Define the canonical install path as the existing two-step dependency flow:
   root `pnpm install`, then `cd apps/web && pnpm install && cd ../..`, then
   the first documented non-web build `pnpm run build`.
2. Make the runtime contract machine-readable at the repository root by adding
   explicit Node/pnpm support metadata that matches the canonical docs.
3. Add a clean-install verification command that copies the repository into a
   temporary directory without dependency artifacts or runtime state, then runs
   the canonical install path there.
4. Keep G1 focused on installability and first build. Do not require the
   production web build in the G1 harness; that remains a separate acceptance
   path under G4.

### Trade-offs and rejected alternatives

- Reusing the current working tree for verification was rejected because an
  existing `node_modules/` tree can mask missing dependency or lockfile issues.
- Deleting the repo's current dependency trees before verification was rejected
  because it is destructive and violates repository safety rules.
- Including `apps/web` production build in G1 was rejected because it overlaps
  with Gate 4 and would make the install gate sensitive to an unrelated offline
  asset-fetching concern.
- A CI-only check was rejected because the release gate explicitly concerns what
  an operator can do from repository docs; there should be a local command that
  expresses that contract.

### Acceptance criteria

1. `package.json` exposes supported Node and pnpm versions in machine-readable
   metadata aligned with the public docs.
2. `README.md` and `README_CN.md` describe one canonical install path with no
   conflicting alternatives.
3. A repository command verifies the canonical install path on a temp copy and
   exits successfully without mutating the operator's working tree.
4. The verification command explicitly documents that G1 covers install plus
   first non-web build, while web production build validation remains part of
   G4.

## Current execution evidence

- Implemented root machine-readable runtime metadata in `package.json`.
- Aligned the canonical install path in `README.md` and `README_CN.md`.
- Added `pnpm run verify:clean-install` to exercise the documented install path
  in a temporary clean copy.
- Validation run completed successfully on 2026-03-26 with:
  `pnpm run verify:clean-install`
- Validation rerun completed successfully on 2026-03-27 with:
  `pnpm run verify:clean-install`

## Phase 7 Evaluation Report

### Result

- Pass on 2026-03-27.

### Dimensions evaluated

- **Boundary evaluation**: pass. The change stays inside root runtime metadata,
  install docs, the release-gate doc, and one standalone verification script.
  It does not change storage semantics, source parsing, service lifecycle, or
  the web production build contract.
- **Stability assessment**: pass with accepted limitations. The script fails fast
  on unsupported Node/pnpm versions, copies the repo into a temp directory,
  excludes dependency artifacts and runtime state, and removes the temp copy by
  default after success or failure.
- **Scalability evaluation**: pass for the intended gate scope. The harness is
  proportional to repository size rather than store size because it excludes
  `.cchistory/`, `node_modules/`, `dist/`, and `.next/`. This is sufficient for
  Gate 1, which validates installability rather than runtime history scale.
- **Compatibility assessment**: pass. No schema, persisted-store, or API
  contract changes were introduced.
- **Security evaluation**: pass. The new command only spawns local `pnpm`
  commands against a temporary copy and does not introduce a new network-facing
  service surface or trust unvalidated user input beyond the local runtime
  versions and optional `--keep-temp` flag.
- **Maintainability assessment**: pass. The solution follows the existing repo
  pattern of small root scripts plus user-facing docs and keeps the G1/G4
  boundary explicit instead of encoding web-build concerns into the install
  harness.

### Issues found

- None above low severity.

### Known limitations accepted

- The verification harness proves the documented install path in a clean temp
  copy, but it does not prove offline dependency availability. That remains
  outside Gate 1 and does not replace Gate 4's offline web-build requirement.
- The evaluation was executed as a later-session review pass rather than by a
  guaranteed separate agent instance. No contradictory findings were observed,
  so this is accepted for the current backlog closure.

### Evidence reviewed

- `pnpm run verify:clean-install` passed on 2026-03-27.
- `git status --short` after the verification run showed only intended tracked
  edits and no generated dependency artifacts in the working tree.
- `ls /tmp | rg '^cchistory-clean-install-'` returned no residual temp
  directories after the default cleanup path.

### Conclusion

- `G1 - Clean Machine Install Verification` satisfies its current acceptance
  criteria and can be marked `done`.

### Phase 4 test cases to write next

- `[install] temp clean copy runs canonical docs path successfully`
- `[install] missing supported Node version fails before install begins`
- `[install] verification command leaves source working tree untouched`

### Impacted surfaces

- `package.json`
- `README.md`
- `README_CN.md`
- `scripts/verify-clean-install.*`
- `docs/design/SELF_HOST_V1_RELEASE_GATE.md` if the G1/G4 verification boundary
  needs to be stated more explicitly in release-gate-facing docs
