---
doc_type: architecture
status: current
authority: normative
last_reconciled: 2026-10-12
supersedes: []
---

# CCHistory structural architecture

## Purpose and authority boundary

This document owns repository structure: dependency direction, code ownership,
public consumers, forbidden knowledge, and enforcement surfaces. It does not
own product meaning.

- `HIGH_LEVEL_DESIGN_FREEZE.md` remains authoritative for product semantics,
  including project-first history, `UserTurn`, evidence preservation, linking,
  masking, and lifecycle meaning.
- `docs/contracts/` owns current or accepted target behavior that spans
  packages or surfaces.
- This document answers where those semantics may be implemented and which
  boundary owns each invariant.
- `docs/design/CURRENT_RUNTIME_SURFACE.md` inventories what the repository
  currently exposes; registries and entrypoints remain its audited code facts.

If a structural proposal would change frozen semantics, it is a redesign and
must reconcile the design freeze explicitly. A dependency checkpoint or plan
cannot silently make that change.

## Dependency direction

The intended production direction is:

```text
source roots
  -> source-adapters -> domain
  -> canonical ------> domain
  -> storage --------> canonical + domain       (Full materializer)
  -> live-runtime ---> source-adapters + canonical + domain (Lite materializer)

api-client -> domain
presentation -> api-client + domain

Full CLI/TUI/API -> the Full packages they need
Lite CLI/TUI     -> live-runtime + domain
Web              -> api-client + presentation + domain
```

Dependencies point toward semantic owners. Test-only dependencies may compare
two implementations for parity, but they do not authorize the same edge in a
production graph. In particular, `packages/live-runtime` tests may use
`packages/storage` as an oracle while production code may not import it.

## Ownership matrix

| Invariant or boundary | Authoritative owner | Public consumers | Consumers must not know or reproduce | Primary enforcement |
|---|---|---|---|---|
| Canonical vocabulary, identifiers, stages, and DTO-independent domain types | `packages/domain` | all packages and applications | source file layouts, SQLite schema, UI-local state | domain build/tests and downstream typechecks |
| Registered adapter roster, discovery, capture, parsing, and source-specific normalization | `packages/source-adapters` and `packages/source-adapters/src/platforms/registry.ts` | Full and Lite ingestion, probes | product support inferred from broader enums; storage or UI policy | adapter tests and `verify:support-status` |
| Storage-neutral project linking, fallback observation, ordering, search, usage, and related-work projection | `packages/canonical` | Full storage and Lite runtime | SQLite tables, Full store paths, application interaction state | canonical tests, parity checks, architecture rules |
| Durable persistence, lineage, tombstones, migrations, evidence liveness, and Full read projections | `packages/storage` | Full CLI/TUI/API | source quirks or presentation policy | storage tests, migration validators, evidence GC guards |
| Ephemeral, source-root-isolated Lite materialization and lookup | `packages/live-runtime` | Lite CLI/TUI | Full store, Full apps, durable mutation semantics | live-runtime tests, `verify:lite`, architecture rules |
| Managed API DTO vocabulary | `packages/api-client` | Web and compatible programmatic clients | Fastify implementation or storage-private rows | API-client tests and managed profile tests |
| Shared display mapping and formatting | `packages/presentation` | Web and TUI where applicable | durable mutation authorization or hidden storage rules | presentation tests and consumer tests |
| Managed domain operations and authorization | `apps/api` | Web, agents, API clients | client-side reconstruction of private state transitions | API tests and managed/agent-extension profiles |
| Mouse-first interaction and browser-local state | `apps/web` | end users | independent copies of backend domain truth | Web tests, lint, capped build, surface review |
| Keyboard-first terminal interaction | `apps/tui` | local Full users | adapter/storage quirks outside public package APIs | TUI state/layout tests and read-side verifier |
| Full administration and scriptable agent operations | `apps/cli` | operators and agents | alternate canonical semantics | CLI tests and artifact/read-side verifiers |
| Zero-store terminal projections | `apps/lite-cli`, `apps/lite-tui` | single-machine readers | Full storage, Full applications, import/GC/admin behavior | Lite tests, `verify:lite`, artifact verifier |
| Build/test/release profile membership | root `package.json` plus profile verifiers | CI and release operators | presence inferred from workspace membership alone | `verify:product-profiles` and profile commands |

## Evidence-preserving storage boundary

Parser input is authoritative evidence; normalized rows, indexes, caches, and
projections are derived. Structural changes must preserve the design-freeze
value hierarchy and the reference inventory in `AGENTS.md`.

Any new evidence reference site owns all of these changes as one coherent
boundary update:

1. create/update and integrity behavior;
2. export/import or migration behavior where applicable;
3. every liveness and prune path;
4. retirement behavior;
5. a category-level guard that proves live evidence is not pruned.

Projection defects are repaired in parsing, canonicalization, masking, or
presentation. Deleting captured content to make a projection look correct is
not an architectural option.

## Frontend and backend coordination

Backend owners define domain truth, mutation authorization, persistent state,
invalid transitions, errors, idempotency, and recovery. Frontend owners define
how the public contract becomes reachable states, layout, focus, interaction,
accessibility, and responsive behavior.

Cross-stack changes land the shared DTO/state contract before changing either
projection. Clients may format or stage local interaction but may not infer
hidden authorization or lifecycle rules. The backend may not dictate visual
geometry that belongs to a surface contract.

## Architecture enforcement

`architecture-rules.json` and `pnpm run verify:architecture-boundaries` provide
a declared static module-reference guard. Manifest version 1 supports explicit
`match: "module-specifier"` and legacy `literal` whole-text matching (also the
default when omitted). Current dependency rules all select module mode. Owner
patterns match a module/package or repository path plus its slash-delimited
subpaths; comments, ordinary content and similarly prefixed names are ignored.

Using the installed TypeScript SourceFile parser, module mode decodes static
imports, re-exports, import-equals/import-type references and literal `import()`,
`require()`, `module.require()` and `require.resolve()`. Relative paths normalize
from the importer to declared repository owner roots. Recognized nonliteral
loads, malformed syntax, bad modes, scan symlinks and repository escapes fail
explicitly. Every rule must match production files; a vacuous rule cannot pass.
Each source is read/parsed once per invocation, without a compiler Program.

This is syntactic checking, without symbol binding or module resolution. Loader
aliases/computed loader properties, eval, compiler path aliases, symlinked module
targets and transitive runtime resolution are outside its proof. A lexical
`require` may be shadowed; no typechecker is claimed. Include-root containment
does not establish dependency-target resolution.

That generic guard deliberately complements rather than reimplements:

- `pnpm run verify:lite` for Lite package tests and its workspace manifest graph/
  quoted-import boundary check (the node-only boundary entry is
  `node scripts/verify-lite-boundaries.mjs`);
- `pnpm run verify:product-profiles` for build/test/release membership;
- `pnpm run verify:support-status` for registered support truth;
- `pnpm run verify:runtime-inventory` for entrypoint and route inventory.

When a boundary needs semantic graph analysis, extend the owning domain
verifier. Do not encode a misleading substring rule merely to claim coverage.

## Structural change gate

A material dependency or ownership change requires a contract and plan under
`docs/contracts/` and `docs/plans/`. The change must name:

- the invariant owner before and after the change;
- public consumers and compatibility decision;
- knowledge that must remain private;
- migration, failure, and rollback behavior;
- the mechanical and independent evidence required for closure.

Temporary sequencing remains planning detail. It does not amend this current
architecture unless the governing contract and this document are reconciled.
