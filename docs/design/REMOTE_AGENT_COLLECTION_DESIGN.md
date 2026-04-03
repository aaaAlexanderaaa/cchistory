# Remote Agent Collection Design

The remote-host feature should be implemented as a minimal collection control plane around the existing canonical ingest pipeline, not as remote live federation.

> Source of truth: [HIGH_LEVEL_DESIGN_FREEZE.md](/root/cchistory/HIGH_LEVEL_DESIGN_FREEZE.md)
>
> Preserved invariants:
> - local-first capture
> - evidence-preserving raw ingestion
> - `UserTurn` as the canonical recall object
> - one canonical model consumed by UI and API
>
> Existing reusable implementation:
> - source probing: [packages/source-adapters/src/core/legacy.ts](/root/cchistory/packages/source-adapters/src/core/legacy.ts)
> - bundle export/import: [apps/cli/src/bundle.ts](/root/cchistory/apps/cli/src/bundle.ts)
> - source replacement ingest: [packages/storage/src/ingest/source-payload.ts](/root/cchistory/packages/storage/src/ingest/source-payload.ts)

# Scope
This design covers multi-host reporting, targeted collection, and staged rollout, while explicitly avoiding a general-purpose remote execution system.

Goals:

- let many remote hosts report source data into one main service
- allow per-host, per-label, or full-fleet collection without logging into each host
- keep the remote side simple enough to ship as a packaged CLI-backed agent
- prefer incremental uploads where possible
- stage delivery as upload first, then keepalive, schedule, and main-service-triggered pull

Non-goals:

- remote live query federation across agent nodes
- arbitrary shell execution on remote hosts
- turning CCHistory into a general host-management platform
- introducing new product semantics below `UserTurn`

# Decision Surface
The real design work is choosing where to spend complexity across four axes: transport, incrementality, identity, and consistency. This feature looks like "multi-host reporting", but these four separate design choices carry most of the cost:

| Axis | Simple choice | Powerful choice | What it costs |
| --- | --- | --- | --- |
| transport | push only | lease-based pull or direct pull | control-plane state, auth, liveness |
| incrementality | full source snapshot | file-level or event-level delta | conflict handling, deletion semantics, replay correctness |
| identity | mutable host naming | stable host identity plus mutable presentation | extra inventory data model |
| consistency | last write wins | monotonic version or lease-aware import | job/result ordering logic |

The rest of the design should stay constrained until these choices are explicit.

# Transport Trade-Off
Push-only is too weak for operators, direct pull is too heavy for v1, and lease-based pull is the best default compromise.

Transport options:

| Option | Strengths | Weaknesses | Recommended use |
| --- | --- | --- | --- |
| push only | smallest implementation, no inbound ports, easy security model | no central refresh button, poor operator control, hard to target "update these 7 hosts now" | not sufficient as the product default |
| direct pull from main service | clean operator mental model, low agent autonomy | requires inbound reachability or tunnels, larger attack surface, more network edge cases | optional later for trusted reachable networks |
| lease-based pull over reverse channel | central control without inbound ports, works behind NAT, same model for full-fleet and targeted refresh | requires job queue, heartbeat or long-poll, eventual not instantaneous | default control-plane model |
| dual transport | most flexible | highest complexity, more states to test and debug | later only if a real operator population needs both |

Why not stop at push only:

- the operator cannot reliably force freshness before reviewing data
- bulk operations degrade into "wait until each host decides to report"
- there is no clean central UX for full-fleet or label-targeted refresh

Why not lead with direct pull:

- the problem statement is data collection, not remote network orchestration
- the hardest part becomes reachability, certificates, and exposure policy rather than history correctness
- the same operator requirement can be met by lease-based pull with less system surface

# Incrementality Trade-Off
Source-dirty snapshots are the right v1 approach, because finer-grained delta is materially harder than it first appears.

Incremental options:

| Option | Strengths | Weaknesses | Recommendation |
| --- | --- | --- | --- |
| full host full snapshot every run | easiest correctness model | high bandwidth, repeated raw upload, poor fleet scale | reject as the default |
| dirty source snapshot | simple enough, good bandwidth reduction, preserves current source replacement semantics | one changed file still re-uploads the whole source payload | choose for v1 |
| file-level delta bundle | smaller uploads for large sources | adapters do not all expose stable per-file replacement semantics, deletion is harder | later if source snapshots are too large |
| event-level delta ingest | best theoretical efficiency | requires new storage semantics, lineage for deletions and supersession, cross-source replay risk | reject for early phases |

The hidden complexity in true delta ingest is not transmission. It is correctness:

- how to represent deleted upstream files
- how to remove superseded turns without losing evidence lineage
- how to avoid duplicate atoms and turns across repeated partial uploads
- how to preserve one canonical derivation pipeline when the ingest unit is smaller than today's source payload

For this repository, "incremental" should mean:

- do not contact every host unless requested
- do not upload every source if only some sources changed
- keep import atomic at the source payload boundary

# Identity And Alias Trade-Off
Using a mutable alias as the operator handle is good UX, but using it as canonical identity is not.

Possible identity models:

| Model | Upside | Downside | Decision |
| --- | --- | --- | --- |
| alias-as-id | simple to read and type | renames break references, collisions are inevitable, leaks mutable state into evidence identity | reject |
| hostname-as-id | cheap implementation | hostnames drift, can collide, breaks after reinstall or reprovision | reject |
| stable `host_id` plus `display_name` | audit-safe and rename-safe | requires explicit inventory fields | choose |
| stable `host_id` plus shared `labels` | good for orchestration groups | slightly more concepts for operators | choose |

If operators want "different hosts point to the same human-facing name", that is a group, not a host identity. This should be modeled as a label.

Recommended naming split:

- `display_name`: one host's current operator-facing name
- `labels`: many-to-many grouping such as `office`, `macbook`, `build-fleet`, `alice`
- `host_id`: stable evidence identity

This keeps mutable names out of IDs while still giving you compact orchestration selectors.

# Consistency Trade-Off
v1 must not rely on blind last-write-wins, because overlapping jobs can regress a source to older data.

The current import path replaces a source payload as a unit. That is acceptable only if the main service can reject stale results.

Risk example:

1. Agent uploads source snapshot at `10:00`.
2. A slower earlier job finishes later and uploads an older snapshot at `10:05`.
3. The main store accepts it and silently regresses that source.

Required early protections:

| Protection | Why it matters |
| --- | --- |
| per-source `source_version` or `captured_at` monotonicity | reject stale uploads |
| job lease token bound to upload | prevent unrelated late writes from replacing newer data |
| import receipt recorded on the main service | make stale rejection explainable in admin surfaces |

This is a bigger practical risk than transport direction and should be handled in phase 1.

# Source Absence Trade-Off
Dirty-only upload is not enough unless the system can also express "this source is now absent."

There are three distinct absence cases:

| Case | Meaning | Needed behavior |
| --- | --- | --- |
| host offline | no fresh information | keep prior source state, mark agent stale |
| source temporarily unreadable | local error | keep prior source state, record error |
| source removed or intentionally disabled | upstream absence is now real | record source absence explicitly |

If the agent uploads only dirty changed sources, the main service cannot infer that a previously known source disappeared. So the heartbeat or collection receipt must include a source manifest summary for all configured slots:

- `present`
- `unreadable`
- `disabled`
- `absent`

Without this, "incremental" quietly becomes "never delete anything and never know if a source vanished".

# Global Model
The correct mental model is "agent-local capture, central canonical import." The system has three roles:

1. Agent:
   runs on a remote host, discovers local sources, performs local probe and raw snapshot work, and uploads canonical data.
2. Control plane:
   lives on the main service, tracks agent identity, liveness, labels, source manifests, and collection jobs.
3. Canonical ingest:
   remains the current import path into the central store. UI and API continue to read only the central store.

The main service does not read remote source files directly. Even when the main service "pulls", it does so by asking an agent to collect and upload.

# Identity Model
Mutable operator-facing names must be separated from evidence identity.

Required identities:

| Field | Stability | Purpose |
| --- | --- | --- |
| `agent_id` | stable | control-plane installation identity, generated once and stored locally |
| `host_id` | stable | canonical evidence host identity, derived from `agent_id` rather than hostname |
| `reported_hostname` | mutable | last observed machine hostname from the agent runtime |
| `display_name` | mutable | operator-facing host name for UI |
| `labels` | mutable, non-unique | fleet grouping and job selectors |

Rules:

- `host_id` must not be derived from mutable display values.
- `display_name` must not participate in canonical IDs.
- `labels` may be shared by many hosts and are the right way to express "alias-like" grouping.
- project linking continues to use canonical `host_id`, not labels or display names.

This avoids the current weakness where `host_id` is derived from hostname alone.

# Collection Model
Early incrementality should be source-scoped and dirty-only, with explicit source-manifest reporting rather than true row-level delta ingest.

There are three different meanings of "incremental":

| Kind | Meaning | Early support |
| --- | --- | --- |
| fleet incremental | only contact selected hosts instead of the whole fleet | yes |
| source incremental | only upload changed sources on a host | yes |
| ingest delta | only merge changed records inside one source payload | later |

The recommended early strategy is:

1. The agent keeps local state for each source slot:
   last successful upload time, last payload checksum, and a cheap dirty watermark.
2. A collection run scans configured source slots and marks each source as `unchanged` or `dirty`.
3. The agent emits a source manifest summary for all configured slots so the main service can distinguish unchanged from absent.
4. The agent uploads bundles only for dirty sources unless the job requests `force_snapshot`.
5. The main service imports each uploaded source through the existing source replacement path and rejects stale results.

This is not full-fleet full-snapshot sync. It is incremental at the host and source level, while keeping storage semantics simple.

True delta ingest is intentionally deferred because the current storage path replaces source payloads as a unit.

# Transport Model
One job model should support manual upload, schedule, and main-service-triggered pull. The control plane uses a typed collection job instead of generic remote execution.

Minimal job fields:

| Field | Meaning |
| --- | --- |
| `job_id` | stable job identity |
| `trigger_kind` | `manual`, `scheduled`, or `server_requested` |
| `selector` | `all`, `agent_ids`, or `labels` |
| `source_slots` | `all` or a list such as `codex`, `claude_code` |
| `sync_mode` | `dirty_snapshot` or `force_snapshot` |
| `limit_files_per_source` | optional debug/throttle control |
| `created_at` | job creation time |
| `lease_expires_at` | agent lease timeout |
| `expected_generation` | optional optimistic ordering guard for result acceptance |

Delivery modes by phase:

| Phase | Delivery |
| --- | --- |
| upload | no control channel required; the operator runs the agent manually |
| keepalive and schedule | agent posts heartbeat and runs local schedule |
| pull | agent leases jobs from the main service by long-poll or websocket |
| optional direct pull | same job model, different transport, only for reachable hosts |

This lets the main service trigger full-fleet or partial refresh without operator SSH.

# Bundle And Upload Shape
The wire format should reuse the existing bundle format, with additional lightweight metadata for ordering and absence reporting.

Upload path:

1. The agent probes local sources.
2. The agent materializes one temporary source bundle or one multi-source bundle for dirty sources.
3. The agent uploads the bundle archive plus source-manifest and generation metadata to the main service.
4. The main service rejects stale results, unpacks accepted bundles, and calls the existing import path.

Why bundle reuse is preferred:

- checksums already exist
- raw blobs are already supported
- conflict handling already exists
- offline and online import share one format

Bundle granularity:

- default: one job may upload only dirty sources
- optional later: split one upload per source for better retry isolation

Required upload metadata:

- `agent_id`
- optional `job_id`
- `collected_at`
- per-source `source_id`
- per-source monotonic `generation` or accepted-capture watermark
- source-manifest summary for slots not included in the dirty bundle payload

# Current Reusable Surfaces In This Repository
The upload-first slice can reuse substantial existing code, but the reusable boundary is narrower than the design note alone might imply. The current repository already has a canonical local probe path, bundle format, and source-replacement import path; what is missing is the remote control-plane glue around them.

| Surface | Current reusable behavior | Gap for remote-agent work |
| --- | --- | --- |
| `packages/source-adapters/src/core/legacy.ts` `runSourceProbe(...)` | probes explicit `SourceDefinition[]`, filters by `source_ids`, and returns canonical `SourceSyncPayload[]` plus host metadata | remote-agent work can reuse this as the local collect engine, but it currently derives host identity from the local OS hostname and has no concept of paired-agent identity, manifest-only heartbeats, or job receipts |
| `apps/cli/src/bundle.ts` `exportBundle(...)` | exports source-scoped canonical payloads plus optional raw blobs into one checksummed bundle directory with a stable manifest | good fit for agent-local packaging, but it currently assumes a local filesystem bundle directory rather than a streamed HTTP upload or spool/retry queue |
| `apps/cli/src/bundle.ts` `readBundle(...)` / `importBundleIntoStore(...)` | verifies checksums, plans conflicts, materializes raw blobs, imports by source payload, and records imported bundle receipts | the main service can reuse the same bundle semantics after upload, but current code expects an unpacked bundle on disk and does not enforce per-agent or per-source generation ordering |
| `packages/storage/src/ingest/source-payload.ts` `replaceSourcePayloadWithOptions(...)` | preserves the canonical source-replacement ingest model and already supports optional host rekey handling | this is the right import boundary for accepted remote uploads, but it does not by itself model stale-write rejection, absent-source manifests, agent inventory, or job leases |
| `packages/storage/src/internal/storage.ts` `listSourcePayloads()` / `getImportedBundle()` / `upsertImportedBundle()` | already supports export reconstruction and imported-bundle receipt tracking | there are no storage tables yet for paired agents, labels, liveness, source-manifest summaries, collection jobs, or job results |
| `apps/api/src/app.ts` local admin routes | already exposes host-local probe (`/api/admin/probe/runs`) and replay (`/api/admin/pipeline/replay`) surfaces and persists probed payloads through `storage.replaceSourcePayload(...)` | these routes are intentionally host-local admin surfaces, not remote-agent APIs; the Fastify app is also configured with a 2 MiB body limit, which is too small and too generic for remote bundle uploads |

The practical implication is that the upload-first remote slice should reuse:

1. `runSourceProbe(...)` for agent-local collection
2. bundle manifest + checksum semantics from `apps/cli/src/bundle.ts`
3. source-payload replacement import in `packages/storage`

And it still needs new control-plane pieces for:

- pairing and remote credentials
- upload transport and unpacking flow
- per-agent inventory and liveness
- source-manifest absence reporting
- per-source ordering or generation checks
- leased collection jobs for later pull phases

# Main-Service APIs
Remote-agent APIs must be separate from the existing local-only admin probe APIs.

Proposed minimal agent APIs:

| Route | Purpose |
| --- | --- |
| `POST /api/agent/pair` | exchange a short-lived pairing token for `agent_id` and credentials |
| `POST /api/agent/heartbeat` | update liveness, reported hostname, version, labels, and source manifest summary |
| `POST /api/agent/jobs/lease` | let an online agent claim one pending collection job |
| `POST /api/agent/uploads` | upload one bundle result for a claimed or manual job |
| `POST /api/agent/jobs/:jobId/complete` | mark completion or report failure metadata |

Proposed minimal admin APIs:

| Route | Purpose |
| --- | --- |
| `GET /api/admin/agents` | list paired agents, liveness, labels, and last upload |
| `POST /api/admin/agent-jobs` | create a collection job for all agents, selected agents, or labels |
| `GET /api/admin/agent-jobs` | inspect pending, leased, succeeded, and failed jobs |
| `POST /api/admin/agents/:agentId/labels` | update operator-facing labels and display name |

Existing `/api/admin/source-config` and `/api/admin/probe/*` remain host-local admin surfaces and should not become the remote-agent API.

# Agent Local State
The agent should persist only enough state to pair once, detect dirtiness, and resume safely.

Minimal local files:

| File | Purpose |
| --- | --- |
| `agent.json` | `agent_id`, credentials, main-service URL, pairing metadata |
| `state.sqlite` | source slot state, last checksums, last upload receipts, last leased job |
| `spool/` | temporary bundles waiting for upload or retry |

Minimal per-source state:

- `slot_id`
- `base_dir`
- `last_success_at`
- `last_payload_checksum`
- `last_manifest_checksum`
- `last_generation`
- `last_probe_summary`
- `last_error`
- `last_known_presence`

This is enough for dirty-only source uploads without requiring full local historical storage semantics.

# Rollout Plan
The lowest-risk rollout sequence is upload first, then liveness, then schedule, then pull, with true delta deferred until justified by measured need.

## Phase 1: Upload
The first deliverable should make one paired remote host upload dirty source snapshots safely, with stale-write rejection and source-manifest reporting.

Deliver:

- pairing token flow
- packaged CLI-backed agent command for `collect` and `upload`
- bundle upload endpoint
- central import using existing bundle logic
- source-scoped dirty detection
- stale result rejection using per-source ordering metadata
- source-manifest reporting for unchanged and absent slots

Do not deliver yet:

- heartbeat
- scheduling
- server-triggered pull

## Phase 2: Keepalive And Schedule
The second deliverable adds liveness and host-local periodic reporting without adding remote command complexity.

Deliver:

- heartbeat endpoint
- agent last-seen tracking
- local schedule support
- retry/backoff for uploads
- admin agent inventory view

## Phase 3: Pull
The third deliverable lets the main service trigger collection through job leasing, not direct file reads.

Deliver:

- `CollectJob` persistence
- job leasing endpoint
- targeted selectors by agent and label
- `server_requested` collection mode

Optional:

- websocket delivery for lower latency
- direct pull transport for reachable hosts only

## Phase 4: True Delta
True in-source delta ingest should be postponed until source-scoped dirty snapshots prove too expensive.

A later delta design may add:

- append or merge semantics below source snapshot replacement
- cursor-aware adapters per source platform
- explicit tombstone handling for deleted or superseded remote evidence

This phase should be opened only if bundle size, raw blob cost, or probe latency become a measured problem.

# Guardrails
Remote collection must not weaken evidence preservation or create a second semantic pipeline.

Hard rules:

- raw evidence remains traceable and importable
- remote-agent transport cannot invent a parallel domain model
- labels and display names are never used as canonical evidence IDs
- the main service may request typed collection jobs only, not arbitrary shell commands
- UI and API continue to project the one central canonical store

# Implementation Notes
The repository can reuse existing packages heavily; most new work is control-plane state and transport glue.

Likely first implementation surface:

1. extend `apps/api` with new `agent` and `admin/agent-jobs` routes
2. add a small agent runner under `apps/cli` before considering a separate long-lived app
3. reuse existing bundle export/import helpers
4. keep storage changes limited to agent inventory and job metadata tables in the early phases

This keeps the remote feature framed as "multi-host reporting into one canonical history system", which matches the product direction better than a full remote-management subsystem.
