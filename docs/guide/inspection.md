# Inspection Guide

Use the inspection commands when you need evidence-preserving diagnostics or
sample collection outside the normal `cchistory` read/write workflow.

These commands are intentionally separate from the managed API/web runtime and
from the `cchistory` CLI itself:

- `probe:*` commands are lightweight supported probes.
- `inspect:*` commands are neutral inspection helpers for research, evidence
  review, and source-specific diagnostics.

Inspection output normally lands under `.cchistory/inspections/` unless you
override the destination with an explicit output flag.

## Choosing the right command

| Need | Command | Use when | Notes |
| --- | --- | --- | --- |
| Check one configured source quickly | `pnpm run probe:smoke -- --source-id=<source-id> --limit=1` | You want a cheap proof that discovery, capture, and parsing still work for a specific source instance | Supported probe; does not require starting managed dev services |
| Collect real sample bundles for source research | `pnpm run inspect:collect-source-samples -- --platform <slot>` | You need a manifest plus copied evidence files for source validation, fixture prep, parser investigation, or follow-up real-data review | Repeat `--platform` for more than one source; supported slots currently include `openclaw`, `opencode`, `gemini`, `cursor-chat-store`, `codebuddy`, and `lobechat` |
| Dump live Antigravity trajectories | `pnpm run inspect:antigravity-live -- --out-dir <dir>` | You need conversation content from a running Antigravity language server for diagnostics or evidence review | Requires a live local Antigravity app/session; this is an inspection helper, not the canonical product runtime |

## `probe:smoke`

Use `probe:smoke` for the smallest proving command when you want to inspect one
source without bringing up the managed API or web services.

```bash
pnpm run probe:smoke -- --source-id=src-codex --limit=1
```

Typical uses:

- reproduce a source-specific parsing issue
- capture a minimal proving command for a bug report
- verify that one configured source can still be discovered and parsed

## `inspect:collect-source-samples`

Use this command when a source needs real-world sample review before non-trivial
fixture, parser, support-tier, or follow-up evidence review work.

```bash
pnpm run inspect:collect-source-samples -- --platform openclaw --platform opencode
pnpm run inspect:collect-source-samples -- --platform gemini --output /tmp/gemini-samples
pnpm run inspect:collect-source-samples -- --platform cursor-chat-store --output /tmp/cursor-chat-samples
pnpm run inspect:collect-source-samples -- --platform codebuddy --output /tmp/codebuddy-samples
pnpm run inspect:collect-source-samples -- --platform lobechat --output /tmp/lobechat-samples
```

What it writes:

- `manifest.json` with requested platforms, checked roots, copied files, and
  notes about intentionally excluded config-only paths
- `files/` with copied evidence files rooted relative to the source host home

Use it when:

- a backlog KR is blocked on real-disk structure analysis
- you need sample-backed fixture planning
- you want a repeatable evidence bundle instead of ad hoc manual copying
- you need to re-check a stable source against newly observed real-data drift

### OpenClaw archive refresh / drift check

OpenClaw is no longer blocked on sample acquisition: the repository already has
real `~/.openclaw` evidence under `.realdata/openclaw_backup.tar.gz`, and the
current stable claim is based on that reviewed archive plus sample-backed
fixtures/regressions. If you need to re-check OpenClaw against newer local
history on another machine, run:

```bash
pnpm run inspect:collect-source-samples -- --platform openclaw --output /tmp/openclaw-samples
```

A useful refresh bundle should still contain all of the following:

- a `manifest.json` whose `sources.openclaw.checked_roots` includes
  `~/.openclaw/agents`
- copied transcript files under `.openclaw/agents/<agent>/sessions/*.jsonl`
- any observed lifecycle variants or companion config that affect evidence
  preservation boundaries

If a future refresh writes only an empty manifest or reports no copied files,
treat it as an incomplete drift-check bundle rather than evidence that the
validated OpenClaw layout never existed.

## `inspect:antigravity-live`

Use this command only for Antigravity-specific live diagnostics.

```bash
pnpm run inspect:antigravity-live -- --out-dir /tmp/antigravity-live
```

It queries the running Antigravity language server, writes trajectory dumps,
summary payloads, and extracted user inputs, then stores a manifest beside the
dumped data.

Use it when:

- live trajectory visibility is the only truthful path to the conversation
  content you need to inspect
- you need to compare live API output against downstream parsing behavior

Do not treat it as a stable product-runtime command. It is a supported
inspection helper for source-specific diagnostics.
