# R29 Remote-Agent Validation Contract

## Status

- Objective: `R29 - Remote-Agent Operator Validation Contract`
- Date: 2026-04-03
- Scope: define what the repository already proves for remote-agent workflows,
  what still depends on a user-started server, and how operators should record
  manual remote-agent review results

## Why This Exists

The remote-agent slice is now real product surface, not speculative design:

- CLI: `agent pair`, `agent upload`, `agent schedule`, `agent pull`
- API: pairing, heartbeat, leasing, upload, completion, inventory, labels, jobs
- tests: targeted mocked CLI/API coverage for pair/upload/schedule/pull behavior

What was still missing was a validation contract that says:

1. which parts are already proven by package-scoped tests,
2. which parts still require a user-started service for truthful review,
3. what to observe during manual remote-agent review, and
4. how to classify friction and feed it back into `BACKLOG.md`.

## Current Proof Surface

### Already proven by repository-local tests

The repository already proves the following without a live remote server:

- `agent pair` stores paired state locally
- `agent upload` sends only dirty source payloads unless forced
- `agent schedule` repeats upload cycles locally and honors retry flags
- `agent pull` leases one typed collection job, uploads one filtered bundle,
  and reports completion
- API route tests cover the shipped remote-agent control-plane route family and
  typed job persistence behavior

These proofs are important, but they are still mostly mocked control-plane
checks rather than a user-run operator workflow against a long-lived service.

### Not yet proven as operator workflows

The repository does **not** yet prove the following as a recorded operator path:

- pairing a real remote agent against a user-started API service
- heartbeat updates and admin inventory review against a running service
- creating a typed collection job through the admin API and then completing it
  through `agent pull`
- operator readability of job, lease, completion, and failure states through a
  real server-backed review
- one manual diary that records trust/friction during remote-agent usage

## Validation Modes

### Mode A — mocked package validation

Use existing package-scoped tests when you want to prove logic such as:

- retry behavior
- dirty-manifest behavior
- one-shot lease/pull flow
- payload selection and completion reporting

This mode is fast and repeatable, but it does not replace a real operator review
against a running server.

### Mode B — user-started manual server review

Use this mode when the goal is to review the complete control-plane experience.

Preconditions:

- the user starts the canonical managed API service manually
- the reviewer uses the shipped CLI against that running service
- the review records exact commands, responses, and any friction

This mode is required for truthful statements about server-backed operator
experience.

## Manual Review Scenarios

### Scenario 1 — Pair and upload

- pair one agent with `agent pair`
- run `agent upload` for one selected source
- verify the API service accepts the upload and the local state file persists
  the paired identity

Capture:

- state-file path used
- server URL
- source selection
- upload result summary
- any friction in command wording, retry behavior, or state-file expectations

### Scenario 2 — Schedule

- run `agent schedule` with a short bounded interval and finite iteration count
- confirm the cycle count, retry behavior, and completion summaries are clear

Capture:

- interval and iteration flags used
- whether repeated cycles were easy to understand
- whether failures and retries were operator-readable

### Scenario 3 — Leased pull

- create one typed collection job through the admin surface
- run `agent pull`
- confirm the job is leased, collected, uploaded, and completed or failed with
  an explicit operator-facing result

Capture:

- job creation input
- lease/completion result
- whether source-scope and sync-mode expectations were clear
- any mismatch between CLI output and API/admin expectations

## Required Evidence Fields

Every manual remote-agent review should record:

- scenario id
- goal
- server URL and startup precondition
- state-file path
- exact commands used
- expected result
- observed result
- friction notes
- evidence refs (stdout, JSON payloads, screenshots, API responses)
- backlog action or explicit statement that no follow-up was needed

## Friction Categories

Use the same categories already established for operator reviews:

- `Discoverability`
- `Readability`
- `Traceability`
- `Guardrail truthfulness`
- `Workflow overhead`
- `Parity drift`

## Severity Guidance

- `S0`: cosmetic only
- `S1`: noticeable friction, workflow still succeeds
- `S2`: misleading or high-friction behavior worth backlog ownership
- `S3`: canonical remote-agent workflow failure or semantic mismatch

## Relationship To Existing Rules

This contract does not change the repository runtime policy:

- agents still must not start long-lived services from the agent environment
- remote-agent server review remains user-started when it depends on a running
  API service
- mocked CLI/API tests remain valuable but are not the whole operator bar

## Recommended Validation Commands

For the currently provable local slice:

- `pnpm --filter @cchistory/cli test`
- `pnpm --filter @cchistory/api test`

For future manual operator review against a user-started service:

- `cchistory agent pair ...`
- `cchistory agent upload ...`
- `cchistory agent schedule ...`
- `cchistory agent pull ...`
- admin API calls against `/api/admin/agents` and `/api/admin/agent-jobs`

The validation contract now exists, but the actual recorded server-backed
remote-agent diaries are still the blocked manual-review tasks under `R35`; this
note should not be read as evidence that those reviews have already been
executed.
