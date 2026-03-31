# R11 - Installation Channel Expansion

## Status

- Objective source: `docs/ROADMAP.md`
- Backlog status after this note: `done`
- Phase reached: Phase 7 holistic evaluation passed on 2026-03-29
- Scope: expand installation channels starting with the repository-owned CLI
  install and upgrade surface, without redesigning managed API/web runtime
  distribution

## Phase 1 - Domain Understanding

### Problem statement

The roadmap calls for broader installation channels so first use and upgrades are
less dependent on cloning the repository and rebuilding locally. Today the
repository-visible install story is still centered on the source tree itself.
That is workable for contributors and power users, but it is narrower than the
roadmap intent for operators who mainly want the CLI.

### Current repository-visible install channels

The current install surface falls into three practical paths.

#### 1. Canonical clean-machine repository install

This is the primary documented install contract in `README.md` and
`README_CN.md`:

1. `git clone <repo>`
2. `pnpm install` at the repository root
3. `cd apps/web && pnpm install`
4. `pnpm run build`
5. optionally run the separate web build later when needed

What this path provides:

- full repository checkout
- all package dependencies for the non-web workspace plus the separate web app
- a built CLI, API, and shared package set
- the baseline required before using `pnpm cli -- ...` or `node apps/cli/dist/index.js ...`

What verifies it today:

- `scripts/verify-clean-install.mjs`
- `pnpm run verify:clean-install`

What is explicitly *not* included in that verifier today:

- the separate `apps/web` production build
- global CLI installation
- upgrade behavior from an existing clone

#### 2. Global CLI access from a local clone

The current documented global-CLI path is still local-clone dependent:

1. finish the repository install/build path above
2. run `pnpm run cli:link`
3. use `cchistory` from anywhere on that machine

This is a convenience path, not a separate distribution channel. It still
requires the user to own a local clone, build the CLI locally, and keep that
clone updated.

What verifies it today:

- documentation only
- no dedicated install/upgrade verifier exists for the `cli:link` path

#### 3. Non-global CLI use from the local repository

The repository also documents two non-global ways to run the CLI:

- `pnpm cli -- <command>`
- `node apps/cli/dist/index.js <command>`

Both still depend on the repository clone and prior local build.

### Current upgrade reality

The current upgrade contract is implicit rather than first-class.

For a user who already has a local clone, the practical upgrade path is:

1. pull the latest repository state
2. rerun `pnpm install` if the root lockfile changed
3. rerun `cd apps/web && pnpm install` if the web lockfile changed
4. rerun `pnpm run build`
5. rerun `pnpm run cli:link` if the user depends on the globally linked CLI

This flow is inferable from the current install instructions and scripts, but it
is not written down as a dedicated upgrade contract. The repository also has no
verifier that proves upgrade behavior explicitly.

### Observed friction points

The current install surface leaves several user-facing gaps.

#### 1. No repo-distributed CLI install channel exists yet

Every documented path still begins with cloning the repository and building it
locally. That is heavier than necessary for a CLI-first user who does not need
an editable checkout.

#### 2. The upgrade story is implicit

The documentation explains a fresh install, but not a dedicated upgrade flow.
Users must infer that they should repeat the relevant install/build steps and
refresh `cli:link` if they use it.

#### 3. Verification only proves the clone-and-build path

`verify:clean-install` is useful, but it only validates the clean-machine repo
clone contract plus the first non-web build. It does not validate an additional
install channel or upgrade behavior.

#### 4. CLI usability and CLI distribution are currently coupled

The repository already exposes a stable CLI entrypoint (`apps/cli/dist/index.js`
and the `cchistory` bin under `apps/cli/package.json`), but the documented way
to reach that entrypoint globally is still tied to a contributor-style source
checkout.

### Constraints and invariants

Any additional install channel should preserve the following rules.

1. **Canonical CLI semantics stay the same**: new channels must run the same
   repository-owned CLI behavior, not a parallel product surface.
2. **Repo-clone install remains supported**: expanding channels should not
   invalidate the current source-checkout workflow used by contributors and
   self-host operators.
3. **Managed API/web runtime is out of scope for the first slice**: the current
   roadmap gap can be reduced by improving the CLI install/upgrade path first,
   without redesigning how `apps/api` or `apps/web` are shipped.
4. **Verification must cover installation and upgrade**: a new channel is not
   truthfully supported until the repository can verify first install and a
   plausible upgrade path for that channel.
5. **Docs must stay explicit about scope**: if an added channel only installs
   the CLI, the docs must not imply that it also installs or manages the API,
   web app, or self-host service lifecycle.

### Impacted repository surfaces

The current install contract is expressed through these repository-visible
surfaces:

- `README.md`
- `README_CN.md`
- root `package.json` (`cli`, `cli:link`, `verify:clean-install`)
- `apps/cli/package.json` (`bin` entrypoint)
- `scripts/verify-clean-install.mjs`
- `docs/design/CURRENT_RUNTIME_SURFACE.md`
- any future release-gate or verifier documentation that claims a supported
  install channel

### Assumptions for the next decomposition step

- The first additional channel should focus on CLI-first operators, because
  that is the narrowest way to reduce first-use friction without overreaching
  into full product packaging.
- The next design decision should compare a small number of repository-owned
  options rather than assuming a package registry or installer format up front.
- Upgrade ergonomics need to be part of the decision, not an afterthought after
  first-install support lands.

## Phase 2 - Validation Position

This objective is currently about install-contract understanding and channel
selection, not source parsing or data-model semantics. No new fixtures are
needed for this inventory step.

The eventual validation surface should include:

- the existing clean-install verifier
- a verifier or targeted test for any added install channel
- explicit upgrade validation for the chosen channel
- documentation checks so install claims stay consistent across README and
  runtime-surface docs

## Phase 3 - Functional Design Snapshot

Environment note: this is a design decision with trade-offs. This environment
has no sub-agent launcher, so the required multi-perspective protocol is
captured below as separated lenses plus a synthesis.

### Candidate channel evaluation

#### Option A - keep repo clone plus `cli:link` as the only supported path

**Result**: rejected.

Reasoning:

- This does not actually expand installation channels.
- It leaves first-use and upgrade friction unchanged.
- It fails the roadmap goal that motivated `R11`.

#### Option B - ship `apps/cli` directly as a package tarball or registry package

**Result**: rejected for the first slice.

Reasoning:

- `apps/cli/package.json` depends on private workspace packages:
  `@cchistory/domain`, `@cchistory/source-adapters`, and `@cchistory/storage`.
- Packing or publishing `apps/cli` alone would not yield a truthful standalone
  install channel unless those internal packages were also published or bundled.
- That would either widen scope into multi-package publication or produce an
  incomplete channel.

#### Option C - ship a repository-owned standalone CLI artifact that bundles internal workspace dependencies

**Result**: recommended.

Reasoning:

- It preserves the existing CLI semantics while decoupling CLI installation from
  a full editable repo clone.
- It avoids assuming an external package-registry publication workflow in the
  first slice.
- It can be verified locally from repository-owned build outputs and later
  attached to releases or other distribution surfaces without changing the
  canonical CLI contract.

### Multi-perspective design lenses

#### Agent A - System consistency

**Recommendation**: pursue a standalone bundled CLI artifact.

Why:

- The CLI already has one canonical entrypoint and `bin` identity.
- Bundling dependencies into one repository-owned artifact preserves that
  command surface better than splitting publication across multiple internal
  workspace packages.
- The repo-clone path can remain unchanged for contributors and full self-host
  operators.

#### Agent B - Operator experience

**Recommendation**: choose a channel that makes first install and upgrade look
like replacing one versioned CLI artifact with another.

Why:

- Users who only need the CLI should not need a full source checkout.
- The docs can clearly explain that the channel installs the CLI only, while
  API/web runtime still follows the repo-clone path.
- Upgrade instructions become concrete if the installed unit is one explicit
  artifact rather than a mutable local clone plus `npm link` state.

#### Agent C - Engineering cost and verification

**Recommendation**: avoid registry publication first; ship a bundled artifact
with a repository-owned verifier.

Why:

- Registry publication introduces release and auth concerns that are not yet in
  the current repository contract.
- A bundled artifact can be produced and tested entirely within the repository.
- The verifier can focus on first install, one real command invocation, and an
  explicit upgrade/replacement path before broader channel expansion.

### Synthesis and decision

The first additional installation channel should be:

- a **repository-owned standalone CLI artifact** that bundles the internal
  workspace dependencies required by `apps/cli`
- distributed as a **versioned installable artifact** rather than as a bare
  `apps/cli` workspace package
- documented as a **CLI-only** channel, not as a full API/web/self-host
  distribution path

This keeps the first slice narrow while still satisfying the roadmap goal of a
real additional channel.

### Non-goals for the first channel

- publishing the full workspace as separately installable packages
- redesigning managed API/web runtime startup or service lifecycle
- claiming that the new channel installs the canonical web app or API
- introducing multiple new channels at once before one is verified end to end

### Verification contract for the chosen channel

Before the new channel is documented as supported, the repository should prove:

1. **artifact creation** from a clean repository copy using repository-owned
   build steps
2. **first install** of that artifact without relying on an editable source
   checkout in the invocation directory
3. **command execution** of the installed CLI on at least one storeless command
   (for example `cchistory templates` or `cchistory --help`) plus one
   repository-controlled command path that exercises real CLI behavior
4. **upgrade or replacement behavior** for a newer artifact over an older
   installed artifact, expressed through a repository-owned verifier rather than
   doc-only instructions
5. **scope clarity** in docs, so users know when to use the repo-clone path
   versus the bundled CLI artifact path

### Implemented surfaces on 2026-03-29

The repository now exposes these concrete installation-channel surfaces:

- `pnpm run cli:artifact`: builds `@cchistory/cli`, vendors the internal
  workspace runtime packages into one standalone directory artifact, and writes
  both an extracted directory and `.tgz` archive under `dist/cli-artifacts/`
- `pnpm run verify:cli-artifact`: builds two version-stamped standalone
  artifacts, unpacks them into a temp install root, runs the installed
  `cchistory templates` command, and verifies replacement-style upgrade from
  the first extracted artifact to the second

This means the first additional installation channel is no longer just a design
choice; it is now a repository-owned generated artifact plus a repository-owned
verification path.

### Resulting backlog slices

The design above has now resolved all three execution slices:

1. implement the standalone bundled CLI artifact channel
2. add installation and upgrade verification for that channel
3. update docs and runtime/install surfaces to explain repo-clone versus
   CLI-artifact usage truthfully

## Phase 7 - Holistic Evaluation

The delivered slice passes the objective-level acceptance bar on 2026-03-29:

- the repo-clone install path remains the canonical full-product contract
- the repository now generates a standalone bundled CLI artifact via `pnpm run cli:artifact`
- the repository verifies first install plus replacement-style upgrade via `pnpm run verify:cli-artifact`
- install and runtime docs now distinguish the repo-clone path from the CLI-only artifact path without implying API/web packaging
