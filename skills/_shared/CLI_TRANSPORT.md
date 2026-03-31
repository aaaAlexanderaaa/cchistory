# CLI-First Transport Contract

This file defines the default execution contract for repo-owned CCHistory
skills.

## Default transport

Unless a skill explicitly says otherwise, the skill should use the canonical
CLI surface.

Preferred command forms:

- installed CLI: `cchistory ...`
- repo checkout fallback: `node apps/cli/dist/index.js ...`

When using the repo checkout fallback, build the CLI first with:

- `pnpm --filter @cchistory/cli build`

## JSON requirement

Skills should prefer machine-readable CLI output:

- always add `--json` unless the task is explicitly presentation-only
- preserve canonical JSON payloads instead of re-mapping them into a skill-only
  schema

## Read defaults

Read-side skills should default to indexed reads:

- add `--index` unless the user explicitly wants a fresh rescan
- use `--full` only when the user accepts the cost of rescanning default source
  roots into a temporary store

Store targeting must use the existing CLI flags:

- `--store <dir>` for a store directory
- `--db <file>` for an explicit SQLite path

## Canonical command mapping

Read-side skills should package these surfaces before inventing anything new:

- project history: `query project --id <project-id> --json`
- filtered turn history: `query turns --project <project-id> --limit <n> --json`
- single turn with context and lineage: `query turn --id <turn-id> --json`
- single session drill-down: `query session --id <session-ref> --json`
- project inventory: `query projects --json`

Operator skills should package these preview-first surfaces:

- source discovery: `discover --json`
- source health preview: `sync --dry-run --json`
- source inventory: `ls sources --json`
- usage and drift-oriented inspection: `stats --json`
- bundle export preview: `export --out <bundle-dir> --dry-run --json`
- bundle import preview: `import <bundle-dir> --dry-run --json`

## Safety requirements

- Do not assume managed API or web services are running.
- Do not ask the agent to start persistent services.
- Prefer read-only inspection before mutation.
- If a skill offers a mutating step, document the preview command first and the
  write command second.
- If the CLI already returns canonical project/turn/session JSON, the skill must
  treat that JSON as the source of truth.

## Error handling contract

Skills should surface CLI errors directly and preserve the failing command.
Do not silently retry with a different semantic path that could change meaning.

## Scope boundaries

Skills may summarize, filter, or order canonical results for usability, but
must not:

- create new lifecycle states
- redefine project linking semantics
- drop evidence-preserving blob or lineage information when it is part of the
  underlying CLI result
- replace canonical IDs with skill-local identifiers
