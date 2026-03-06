# CCHistory Architecture (Target v0.2+)

## 1. Purpose

CCHistory is a focused HistoryOS for coding-agent and browser/chat history.
It standardizes heterogeneous history into one queryable model and exposes a
Chat2History interface for:

- cross-source recall when wording/location is unknown
- pattern review across sessions and projects
- distillation into reusable knowledge
- autonomous retrieval by AI coding agents

Initial connectors remain Claude Code and Brave, but the architecture is built
for Codex, LobeChat, ChatGPT/Gemini exports, and remote data stores.

## 2. Principles

1. Read-only source access: connectors never mutate origin systems.
2. Connector/index separation: ingest once, query many.
3. Incremental sync: cursor-based scans, idempotent writes.
4. Canonical schema: source-specific quirks isolated inside connectors.
5. Summary/detail split: list APIs are lightweight; detail loads on demand.
6. Measurable quality: latency, correctness, and sync drift are first-class.

## 3. System Model

The system is split into two planes.

### 3.1 Connector Plane (Ingestion)

- Connectors read source data in read-only mode.
- Connectors emit `NormalizedEvent` records.
- Ingestion pipeline validates, deduplicates, and writes index tables.
- Connector state tracks cursors/checkpoints per source instance.

### 3.2 Knowledge Plane (Retrieval)

- Internal index DB stores normalized entries/messages/chunks.
- API queries the index store, not live upstream systems.
- Ranking layer combines lexical relevance + recency + field boosts.
- Distillation/pattern jobs run against normalized indexed history.

## 4. High-Level Architecture

```text
             +-------------------------------+
             |            Web UI             |
             | Explore | Search | Distill    |
             +---------------+---------------+
                             |
                      HTTP /api/*
                             |
        +--------------------v--------------------+
        |             API Service                 |
        | entries/search/distill/chat2history     |
        +--------------------+--------------------+
                             |
                     Query + command calls
                             |
      +----------------------+----------------------+
      |               History Index                |
      | entries/messages/chunks/sources/state      |
      +----------------------+----------------------+
                             ^
                 normalized upserts + cursor state
                             |
      +----------------------+----------------------+
      |             Ingestion Orchestrator         |
      | scheduler | replay | dedupe | health       |
      +----------------------+----------------------+
                             |
      +----------+-----------+-----------+----------+
      |          |                       |          |
+-----v----+ +---v-----+            +----v----+ +---v-----+
| Claude   | | Brave   |            | Codex   | | LobeChat|
| connector| |connector|            |connector| |connector|
+----------+ +---------+            +---------+ +---------+
```

## 5. Canonical Data Contracts

### 5.1 Core Entities

- `Source`: configured source instance and metadata.
- `Entry`: canonical history object (conversation, visit, thread, event).
- `Message`: normalized chat message or message-like content.
- `Artifact`: extracted file/tool references.
- `Tag`: derived labels (language/tool/project/topic).
- `Chunk`: retrieval unit for full-text/semantic expansion.

### 5.2 Identity and Provenance

Each entry stores:

- `entry_id`: globally stable ID used by APIs/UI
- `source_id`: source instance identifier
- `origin_primary_key`: reversible key for connector fetch
- `origin_payload_ref`: source path/URL/table reference
- `schema_version`: canonical schema version for migrations

Round-trip guarantee: an `entry_id` returned by list/search must be resolvable
by detail APIs.

### 5.3 Summary vs Detail Models

- `HistoryEntrySummary`: for list/search
  - id, source, type, title, timestamp, project, snippet, score, tags
- `HistoryEntryDetail`: for detail page
  - summary fields + messages/metadata/artifacts

## 6. Connector SDK Contract

Every connector implements:

```python
class Connector(ABC):
    connector_type: str

    async def discover(self) -> list[SourceHandle]: ...
    async def health(self, source: SourceHandle) -> HealthStatus: ...
    async def scan_since(self, source: SourceHandle, cursor: str | None) -> ScanBatch: ...
    async def fetch(self, source: SourceHandle, origin_primary_key: str) -> RawRecord: ...
```

Where `ScanBatch` contains:

- `events`: list of `NormalizedEvent`
- `next_cursor`: opaque cursor/checkpoint
- `has_more`: pagination marker

## 7. Ingestion Lifecycle

1. Load configured source instances.
2. Read connector state (cursor/checkpoint).
3. `scan_since(...)` in batches.
4. Normalize + validate event schema.
5. Idempotent upsert into index tables.
6. Commit new cursor and run metrics.
7. Expose run status and errors via API.

## 8. API Design (Target)

### 8.1 Read APIs

- `GET /api/entries`
  - returns `HistoryEntrySummary[]`, cursor-based pagination
- `GET /api/entries/{entry_id}`
  - returns `HistoryEntryDetail`
- `GET /api/search`
  - lexical search with filters + `total` + snippets
- `GET /api/sources`
  - source status, counts, last sync info
- `GET /api/ingest/status`
  - per-connector health and lag

### 8.2 Command APIs

- `POST /api/ingest/run`
  - run one/all connectors immediately
- `POST /api/distill/session`
  - create/update distilled summary artifact
- `POST /api/chat2history/query`
  - agent-oriented retrieval context endpoint

## 9. Storage Design (Target)

Recommended baseline: PostgreSQL.

Tables:

- `sources`
- `entries`
- `messages`
- `entry_chunks`
- `distill_artifacts`
- `connector_state`
- `ingest_runs`

Indexing strategy:

- btree on timestamps, source, project
- full-text/trigram indexes for title/content/chunks
- uniqueness for idempotent upserts on `(source_id, origin_primary_key)`

## 10. Frontend Architecture (Target)

Primary views:

1. Explore: timeline + source/project filters.
2. Search: ranked results with snippets/highlights.
3. Distill: recurring patterns, decisions, unresolved items.

UI behavior:

- list/search render summary model only
- detail view lazy-fetches full payload
- source health/sync lag shown in sidebar

## 11. Migration Strategy from Current MVP

1. Keep current adapters running while introducing index store.
2. Add ingestion orchestrator and dual-write/index read path.
3. Move list/search APIs to index-backed queries.
4. Deprecate direct fan-out query path after parity tests pass.
5. Introduce new connectors without changing frontend contracts.

## 12. Non-Goals (Current Phase)

- write-back/sync-to-source workflows
- full semantic vector retrieval in initial milestone
- multi-tenant auth and RBAC (single-user local-first first)

## 13. Success Criteria

- Correctness: ID round-trip and pagination contracts are deterministic.
- Performance: list/search p95 stays within target SLOs under large datasets.
- Coverage: connector conformance suite required for new source types.
- Extensibility: new source addition does not require API redesign.
