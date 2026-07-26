---
doc_type: authority-map
status: current
authority: normative
last_reconciled: 2026-07-26
supersedes: []
---

# CCHistory Documentation

This directory is organized by reader task. The root [`README.md`](../README.md)
is the product overview and install entrypoint; this page is the map for deeper
operator, source-adapter, and design material.

## Source Of Truth

| Document | Use it for |
| --- | --- |
| [`HIGH_LEVEL_DESIGN_FREEZE.md`](../HIGH_LEVEL_DESIGN_FREEZE.md) | Product semantics, frozen architecture, and canonical terms such as `UserTurn`, `ProjectIdentity`, `candidate`, `committed`, and `unlinked` |
| [`ARCHITECTURE.md`](../ARCHITECTURE.md) | Structural owners, public consumers, dependency direction, forbidden knowledge, and enforcement surfaces |
| [`contracts/`](contracts/README.md) | Current and accepted target cross-package/surface behavior, including repository governance |
| [`design/CURRENT_RUNTIME_SURFACE.md`](design/CURRENT_RUNTIME_SURFACE.md) | Current repo-visible runtime inventory: entrypoints, registered adapters, routes, and verification surfaces |
| [`ROADMAP.md`](ROADMAP.md) | Current milestone priorities and non-blocking future work |
| [`../PIPELINE.md`](../PIPELINE.md) | Backlog and completion workflow for repository agents |
| [`../BACKLOG.md`](../BACKLOG.md) | Active portfolio state, priority, task/KR/objective status, and blockers |

When documents disagree, use this authority order:

1. the design freeze for product semantics;
2. `ARCHITECTURE.md` for ownership and dependency direction;
3. current contracts for cross-surface behavior;
4. the runtime surface for implemented inventory, with registries and
   entrypoints as its audited code facts;
5. `PIPELINE.md` and `BACKLOG.md` for execution and active portfolio state;
6. plans for execution order, issues for finding lifecycle, guides for
   procedure, and evidence for reproducible support.

A lower role does not silently override a higher role. Broader enums in domain
or DTO packages are schema allowance, not proof that a live adapter exists.

## Document Lifecycle And Routing

The incremental governance policy lives in [`../docs-policy.json`](../docs-policy.json)
and is checked by `pnpm run verify:doc-governance`.

- `current`: authoritative for present behavior.
- `target`: accepted future behavior; not proof of implementation.
- `active`: plan, backlog, or triage work in progress.
- `completed`: finished plan retained for traceability.
- `historical`: context/evidence only.
- `superseded`: explicitly replaced and linked to its successor.
- `needs_reconciliation`: a known conflict blocks dependent work.

New normative work goes to [`contracts/`](contracts/README.md), execution plans
to [`plans/`](plans/README.md), durable findings to
[`issues/`](issues/README.md), and verification records to
[`evidence/`](evidence/README.md). Reusable forms live in `templates/` and have
no authority until completed and landed in the correct directory. Completed
portfolio history moves only through the indexed
[`archive/backlog/`](archive/backlog/README.md) path.

The first governed set is intentionally small. Historical design/source/guide
documents remain readable without a flag-day frontmatter rewrite; add a
document to `docs-policy.json` when it is materially revised or promoted to
current authority.

## User And Operator Guides

| Guide | Audience |
| --- | --- |
| [`guide/cli.md`](guide/cli.md) | Local operators and AI agents using `cchistory` for sync, browse, search, backup, import, remote-agent upload, and JSON queries |
| [`guide/lite.md`](guide/lite.md) | Single-machine, zero-store CLI/TUI inspection through the shared canonical adapter pipeline, plus one-way export |
| [`guide/tui.md`](guide/tui.md) | Keyboard-first local browsing of projects, turns, search results, and source-health snapshots |
| [`guide/web.md`](guide/web.md) | Mouse-first review and admin workflows through the Next.js web surface |
| [`guide/api.md`](guide/api.md) | Managed Fastify API routes, configuration, and remote-agent control-plane endpoints |
| [`guide/inspection.md`](guide/inspection.md) | Evidence/debugging helpers such as probes and source inspection scripts |
| [`guide/bug-reporting.md`](guide/bug-reporting.md) | Reproducible bug reports that preserve raw evidence and avoid semantic drift |

## Source References

[`sources/README.md`](sources/README.md) explains the shared capture path and
links to stable adapter notes. Source references are implementation-oriented:
they describe where source data lives, how CCHistory reads it, and which fields
are used as evidence. They do not redefine product semantics.

Current stable source references cover:

- Codex
- Claude Code
- Factory Droid
- AMP
- Cursor
- Antigravity
- Gemini CLI
- OpenClaw
- OpenCode
- CodeBuddy

`lobechat`, `accio`, and `zcode` remain registered `experimental` adapters until their
support boundary is validated enough for a stable source reference.

## Design And Validation

Start with [`design/README.md`](design/README.md) for the design-document index.
The most commonly referenced validation documents are:

- [`design/SELF_HOST_V1_RELEASE_GATE.md`](design/SELF_HOST_V1_RELEASE_GATE.md)
- [`design/V1_VALIDATION_STRATEGY.md`](design/V1_VALIDATION_STRATEGY.md)
- [`design/OPERATOR_REVIEW_RUBRIC.md`](design/OPERATOR_REVIEW_RUBRIC.md)

The `self-host v1` phrase is a support and deployment-scope gate. It is not the
same thing as the repository package version. The current package/API/Web
release marker is `0.3.0`.

## Maintenance Rules

- Keep support claims in `README.md`, `README_CN.md`,
  `design/CURRENT_RUNTIME_SURFACE.md`, `design/SELF_HOST_V1_RELEASE_GATE.md`,
  and `sources/README.md` aligned with
  `packages/source-adapters/src/platforms/registry.ts`.
- Run `pnpm run verify:support-status` after changing adapter support tables or
  platform lists.
- Run `pnpm run verify:governance` after changing governed metadata, templates,
  architecture ownership/rules, or the governance checkers.
- Put product semantics in the design freeze, runtime inventory in
  `design/CURRENT_RUNTIME_SURFACE.md`, and source-layout details in
  `sources/`.
- Land a contract and complete-end-state plan before material implementation;
  do not use a plan, issue, evidence record, or backlog note as a substitute for
  normative behavior.
- Do not fix parsing or rendering bugs by stripping captured content from the
  evidence model; use masking or projection behavior when content should be
  collapsed, redacted, or deemphasized.
