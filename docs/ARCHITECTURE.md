# CCHistory Architecture & System Design

## Overview

CCHistory is a WebUI server for browsing and managing history from multiple
sources: AI coding agents (Claude Code, Codex), browsers (Brave, Chrome),
and chatbots (LobeChat). It normalizes data from heterogeneous backends into
a universal schema, exposing it through a single search and browse interface.

### Design Principles

1. **Read-only access** -- datasources are never modified; all connections
   are strictly read-only to preserve the integrity of the original data.
2. **Plugin architecture** -- new sources are added by implementing a single
   abstract class (`DataSource`) and registering it with the `SourceRegistry`.
3. **Auto-detection** -- on startup the server probes the filesystem for known
   data locations (e.g. `~/.claude/projects/`, Brave's SQLite DB) and connects
   to every source it finds without manual configuration.
4. **Universal schema** -- every piece of history, regardless of origin, is
   normalized into a single `HistoryEntry` model so the frontend and search
   layer never need to know about source-specific formats.
5. **Monorepo** -- backend and frontend live side-by-side and the backend can
   serve the built frontend as static files for single-binary deployment.

---

## Repository Structure

```
cchistory/
├── server/                         # Python backend (FastAPI)
│   ├── pyproject.toml              # Project metadata and dependencies
│   ├── cchistory/
│   │   ├── __init__.py
│   │   ├── main.py                 # FastAPI app, lifespan, static mount
│   │   ├── config.py               # AppConfig, auto-detection of sources
│   │   ├── models.py               # Pydantic models (universal schema)
│   │   ├── datasources/
│   │   │   ├── base.py             # DataSource ABC (the plugin contract)
│   │   │   ├── registry.py         # SourceRegistry (manages all sources)
│   │   │   ├── claude_code.py      # Claude Code JSONL reader
│   │   │   └── brave.py            # Brave/Chrome SQLite reader
│   │   └── routers/
│   │       ├── history.py          # GET /api/history, /api/history/:source/:id
│   │       ├── search.py           # GET /api/search?q=...
│   │       └── sources.py          # GET /api/sources, /api/sources/projects
│   └── tests/
│       ├── test_claude_code.py     # Unit tests for Claude Code datasource
│       └── test_api.py             # Integration tests for HTTP API
│
├── web/                            # React frontend (Vite + TypeScript)
│   ├── package.json
│   ├── vite.config.ts              # Dev proxy /api -> localhost:8765
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx                # React entry point
│       ├── App.tsx                 # Root component, state management
│       ├── index.css               # Tailwind CSS imports
│       ├── types/index.ts          # TypeScript type definitions
│       ├── api/client.ts           # API client (fetch wrappers)
│       └── components/
│           ├── Sidebar.tsx         # Source/project navigation
│           ├── SearchBar.tsx       # Full-text search input
│           ├── HistoryList.tsx     # Paginated entry list
│           ├── ConversationView.tsx# Message-by-message detail view
│           └── SourceBadge.tsx     # Colored source label
│
└── docs/
    └── ARCHITECTURE.md             # This file
```

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         Browser (WebUI)                          │
│  ┌────────┐  ┌───────────┐  ┌─────────────┐  ┌──────────────┐  │
│  │Sidebar │  │ SearchBar │  │ HistoryList │  │Conversation  │  │
│  │        │  │           │  │             │  │   View       │  │
│  └───┬────┘  └─────┬─────┘  └──────┬──────┘  └──────┬───────┘  │
│      │             │               │                │           │
│      └─────────────┴───────────────┴────────────────┘           │
│                            │  HTTP /api/*                       │
└────────────────────────────┼─────────────────────────────────────┘
                             │
┌────────────────────────────┼─────────────────────────────────────┐
│                    FastAPI Server (:8765)                         │
│                            │                                     │
│  ┌─────────────────────────▼──────────────────────────────────┐  │
│  │                    API Routers                              │  │
│  │  /api/health  /api/sources  /api/history  /api/search      │  │
│  └─────────────────────────┬──────────────────────────────────┘  │
│                            │                                     │
│  ┌─────────────────────────▼──────────────────────────────────┐  │
│  │                  SourceRegistry                             │  │
│  │  - register_type(name, factory)                             │  │
│  │  - add_source(config) / remove_source(name)                 │  │
│  │  - search_all(query) -> merged, sorted results              │  │
│  │  - list_all_entries(limit, offset, source, project)         │  │
│  └──────┬──────────────┬──────────────┬───────────────────────┘  │
│         │              │              │                           │
│  ┌──────▼─────┐ ┌──────▼─────┐ ┌─────▼──────┐                   │
│  │ClaudeCode  │ │  Brave     │ │  (future)  │                   │
│  │ Source     │ │  Source    │ │  sources   │                   │
│  └──────┬─────┘ └──────┬─────┘ └────────────┘                   │
│         │              │                                         │
└─────────┼──────────────┼─────────────────────────────────────────┘
          │              │
    ┌─────▼─────┐  ┌─────▼──────────┐
    │ ~/.claude │  │ Brave History  │
    │ /projects │  │ SQLite DB      │
    │  (JSONL)  │  │ (read-only     │
    │           │  │  temp copy)    │
    └───────────┘  └────────────────┘
```

---

## Core Concepts

### Universal Schema (`HistoryEntry`)

Every piece of history is normalized into a single Pydantic model:

| Field              | Type                | Description                                      |
|--------------------|---------------------|--------------------------------------------------|
| `id`               | `str`               | Globally unique ID (`{source_prefix}-{hash}`)    |
| `source`           | `str`               | Human-readable source name ("Claude Code")       |
| `source_id`        | `str`               | Original ID in the source system                 |
| `type`             | `EntryType`         | `conversation`, `visit`, or `message`            |
| `title`            | `str`               | Entry title (first user message / page title)    |
| `url`              | `str?`              | URL for browser visits                           |
| `project`          | `str?`              | Project or workspace name                        |
| `timestamp`        | `datetime`          | When the entry started                           |
| `end_timestamp`    | `datetime?`         | When the entry ended                             |
| `duration_seconds` | `int?`              | Total duration                                   |
| `content`          | `str?`              | Summary or preview text                          |
| `messages`         | `List[Message]?`    | Full conversation (for conversation-type entries) |
| `metadata`         | `Dict[str, Any]`    | Source-specific extra data                       |
| `tags`             | `List[str]`         | Labels for filtering (e.g. `["brave","browser"]`)|

The `Message` sub-model carries `role` (user/assistant/system/tool), `content`,
optional `timestamp`, optional `tool_name`, and a `metadata` dict.

### DataSource Plugin Contract

To add a new history source, implement the `DataSource` abstract class:

```python
class DataSource(ABC):
    name: str
    source_type: str  # "local_file", "database", "remote"

    async def connect(self, params: Dict[str, Any]) -> None: ...
    async def disconnect(self) -> None: ...
    async def list_entries(self, limit, offset, project) -> List[HistoryEntry]: ...
    async def get_entry(self, entry_id: str) -> Optional[HistoryEntry]: ...
    async def search(self, query: SearchQuery) -> List[HistoryEntry]: ...
    async def count(self) -> int: ...
    async def list_projects(self) -> List[str]: ...
```

Then register it in `main.py`:

```python
registry.register_type("my_source", MySource)
```

And add auto-detection logic in `config.py` so it is picked up on startup.

### SourceRegistry

The registry is the coordination layer between the API and individual sources:

- **Type registration**: maps string type names to `DataSource` subclasses
  (`register_type`).
- **Instance management**: creates, connects, and tracks live source instances
  (`add_source`, `remove_source`, `shutdown`).
- **Cross-source operations**: `search_all` fans out a query to every
  connected source, collects results, deduplicates by timestamp sort, and
  applies pagination. `list_all_entries` does the same for browsing.
- **Metadata**: `get_source_info` returns connection status and entry counts
  for each source.

### ID Generation

Entry IDs are deterministic hashes to ensure stability across restarts:

- Claude Code: `cc-{sha256("claude_code:{file_path}")[:16]}`
- Brave: `brave-{sha256("brave:{visit_id}:{url_id}")[:16]}`

This avoids collisions between sources while keeping IDs short and stable.

---

## Datasource Details

### Claude Code (`ClaudeCodeSource`)

- **Location**: `~/.claude/projects/<project-name>/<session-id>.jsonl`
- **Format**: Newline-delimited JSON; each line is a message record
- **Parsing strategy**: Iterates lines, extracts `type`/`role` to determine
  `MessageRole`, handles both flat records (`{type: "human", content: "..."}`)
  and nested records (`{message: {role: "assistant", ...}}`). Content can be
  a plain string or an array of `{type: "text", text: "..."}` objects.
- **Timestamp extraction**: Checks `timestamp`, `createdAt`, `created_at`,
  `ts` fields; handles both Unix seconds and milliseconds.
- **Caching**: All sessions are parsed into memory on first access and cached.
  The cache is invalidated on `disconnect`.
- **Project derivation**: The directory path relative to the base dir is used
  as the project name.

### Brave / Chrome (`BraveSource`)

- **Location**: Platform-dependent (Linux, macOS, Windows paths are probed).
- **Format**: SQLite database with `visits` and `urls` tables.
- **Read-only strategy**: The browser locks its History DB. The source copies
  the DB (and WAL/SHM files) to a temp file before opening a connection, so
  the browser is never blocked.
- **Timestamp conversion**: Chrome stores timestamps as microseconds since
  1601-01-01. The `chrome_time_to_datetime` function converts these to
  standard UTC `datetime` objects.
- **Shared implementation**: Chrome uses the same `BraveSource` class since
  the SQLite schema is identical.

---

## API Reference

All endpoints are under `/api`. The server also exposes auto-generated
OpenAPI docs at `/docs` (Swagger UI) and `/redoc`.

### `GET /api/health`

Returns server status. Response: `{"status": "ok", "version": "0.1.0"}`.

### `GET /api/sources`

Lists all connected datasources with entry counts and connection status.

Response: `List[SourceInfo]`

### `GET /api/sources/projects`

Lists projects grouped by source name.

Response: `{"Claude Code": ["project-a", "project-b"], "Brave": []}`

### `GET /api/history`

Paginated listing of history entries across all (or a filtered) source.

| Param     | Type   | Default | Description                |
|-----------|--------|---------|----------------------------|
| `limit`   | int    | 50      | Max entries (1-500)        |
| `offset`  | int    | 0       | Pagination offset          |
| `source`  | string | null    | Filter by source name      |
| `project` | string | null    | Filter by project name     |

Response: `List[HistoryEntry]` sorted by timestamp descending.

### `GET /api/history/{source_name}/{entry_id}`

Returns a single entry with full message history. 404 if not found.

### `GET /api/search`

Full-text search across all connected sources.

| Param     | Type   | Default | Description                       |
|-----------|--------|---------|-----------------------------------|
| `q`       | string | (req.)  | Search query                      |
| `sources` | string | null    | Comma-separated source names      |
| `types`   | string | null    | Comma-separated entry types       |
| `project` | string | null    | Filter by project                 |
| `limit`   | int    | 50      | Max results (1-500)               |
| `offset`  | int    | 0       | Pagination offset                 |

Response: `SearchResult` with `entries`, `total`, and `query`.

---

## Frontend Architecture

The frontend is a single-page React application built with Vite, TypeScript,
and Tailwind CSS v4.

### State Management

State is managed via React `useState` hooks in the root `App` component.
There is no external state library; the app is simple enough that prop
drilling through 3-4 components is straightforward.

| State             | Purpose                                      |
|-------------------|----------------------------------------------|
| `sources`         | Connected datasource metadata                |
| `projects`        | Project tree grouped by source               |
| `entries`         | Current page of history entries              |
| `selectedEntry`   | Entry shown in detail panel                  |
| `selectedSource`  | Active source filter (null = all)            |
| `selectedProject` | Active project filter (null = all)           |
| `searchQuery`     | Current search term (empty = browse mode)    |
| `loading`         | Request in-flight indicator                  |
| `error`           | Last error message                           |

### Component Hierarchy

```
App
├── Sidebar          # Source list, project tree, navigation
├── SearchBar        # Search input + submit
├── HistoryList      # Scrollable entry list
│   └── SourceBadge  # Colored source label per entry
└── ConversationView # Detail panel: messages or visit metadata
    └── MessageBubble (internal) # Single message in a conversation
```

### API Client

`src/api/client.ts` provides typed `fetch` wrappers for each backend endpoint.
During development, Vite proxies `/api/*` to `localhost:8765` (configured in
`vite.config.ts`). In production, the backend serves the built frontend
directly from `web/dist/`.

---

## Data Flow

### Browse Mode

```
User clicks source/project in Sidebar
  → App updates selectedSource / selectedProject
  → useEffect triggers loadEntries()
  → GET /api/history?source=X&project=Y&limit=100
  → SourceRegistry.list_all_entries() fans out to relevant source(s)
  → Results merged, sorted by timestamp desc, paginated
  → HistoryList renders entries
  → User clicks entry → ConversationView shows detail
```

### Search Mode

```
User types query in SearchBar, presses Enter
  → App sets searchQuery state
  → useEffect triggers loadEntries()
  → GET /api/search?q=query&sources=X
  → SourceRegistry.search_all() fans out query to all sources
  → Each source does its own matching (substring for Claude Code, SQL LIKE for Brave)
  → Results merged, sorted, paginated
  → HistoryList renders results with source badges
```

---

## Adding a New Datasource

Follow these steps to add support for a new history source:

1. **Create** `server/cchistory/datasources/my_source.py` implementing
   `DataSource`. See `claude_code.py` or `brave.py` as references.

2. **Register** the type in `main.py` lifespan:
   ```python
   registry.register_type("my_source", MySource)
   ```

3. **Auto-detect** in `config.py` by adding filesystem probes in
   `AppConfig.default()` to locate the data.

4. **Add tests** in `server/tests/test_my_source.py` using temp directories
   or fixtures.

5. (Optional) **Add a color** for the source badge in
   `web/src/components/SourceBadge.tsx` in the `SOURCE_COLORS` map.

No changes to the API routers, registry, models, or frontend components are
needed -- the plugin architecture handles everything.

---

## Planned Expansions

These sources are on the roadmap (not yet implemented):

| Source       | Data Format              | Connection Type     |
|--------------|--------------------------|---------------------|
| Codex (OpenAI) | JSONL (local files)   | local_file          |
| LobeChat     | SQLite / PostgreSQL      | database            |
| Firefox      | SQLite (`places.sqlite`) | database            |
| ChatGPT      | JSON export + extension  | local_file / remote |
| Gemini       | JSON export + extension  | local_file / remote |

The browser extension for ChatGPT/Gemini export will produce JSON files in
a standardized format that a `FileImportSource` can ingest.

---

## Running

### Development

```bash
# Terminal 1: Backend
cd server
pip install fastapi uvicorn pydantic aiosqlite aiofiles
python -m cchistory.main
# Server starts on http://localhost:8765

# Terminal 2: Frontend (with hot reload + API proxy)
cd web
pnpm install
pnpm dev
# Opens http://localhost:5173
```

### Production (Single Process)

```bash
cd web && pnpm build        # Builds to web/dist/
cd ../server
python -m cchistory.main    # Serves API + frontend on :8765
```

### Tests

```bash
cd server
pip install pytest pytest-asyncio httpx
python -m pytest tests/ -v
```
