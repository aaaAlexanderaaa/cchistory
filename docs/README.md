# CCHistory Documentation

This directory is organized by reader task. The root [`README.md`](../README.md)
is the product overview and install entrypoint; this page is the map for deeper
operator, source-adapter, and design material.

## Source Of Truth

| Document | Use it for |
| --- | --- |
| [`HIGH_LEVEL_DESIGN_FREEZE.md`](../HIGH_LEVEL_DESIGN_FREEZE.md) | Product semantics, frozen architecture, and canonical terms such as `UserTurn`, `ProjectIdentity`, `candidate`, `committed`, and `unlinked` |
| [`design/CURRENT_RUNTIME_SURFACE.md`](design/CURRENT_RUNTIME_SURFACE.md) | Current repo-visible runtime inventory: entrypoints, registered adapters, routes, and verification surfaces |
| [`ROADMAP.md`](ROADMAP.md) | Current milestone priorities and non-blocking future work |
| [`../PIPELINE.md`](../PIPELINE.md) | Backlog and completion workflow for repository agents |

When documents disagree, prefer the design freeze for semantics, the runtime
surface for implemented inventory, and the adapter registry for support tiers.
Broader enums in domain or DTO packages are schema allowance, not proof that a
live adapter exists.

## User And Operator Guides

| Guide | Audience |
| --- | --- |
| [`guide/cli.md`](guide/cli.md) | Local operators and AI agents using `cchistory` for sync, browse, search, backup, import, remote-agent upload, and JSON queries |
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

`lobechat` and `accio` remain registered `experimental` adapters until their
support boundary is validated enough for a stable source reference.

## Design And Validation

Start with [`design/README.md`](design/README.md) for the design-document index.
The most commonly referenced validation documents are:

- [`design/SELF_HOST_V1_RELEASE_GATE.md`](design/SELF_HOST_V1_RELEASE_GATE.md)
- [`design/V1_VALIDATION_STRATEGY.md`](design/V1_VALIDATION_STRATEGY.md)
- [`design/OPERATOR_REVIEW_RUBRIC.md`](design/OPERATOR_REVIEW_RUBRIC.md)

The `self-host v1` phrase is a support and deployment-scope gate. It is not the
same thing as the repository package version. The current package/API/Web
release marker is `0.2.0`.

## Maintenance Rules

- Keep support claims in `README.md`, `README_CN.md`,
  `design/CURRENT_RUNTIME_SURFACE.md`, `design/SELF_HOST_V1_RELEASE_GATE.md`,
  and `sources/README.md` aligned with
  `packages/source-adapters/src/platforms/registry.ts`.
- Run `pnpm run verify:support-status` after changing adapter support tables or
  platform lists.
- Put product semantics in the design freeze, runtime inventory in
  `design/CURRENT_RUNTIME_SURFACE.md`, and source-layout details in
  `sources/`.
- Do not fix parsing or rendering bugs by stripping captured content from the
  evidence model; use masking or projection behavior when content should be
  collapsed, redacted, or deemphasized.
