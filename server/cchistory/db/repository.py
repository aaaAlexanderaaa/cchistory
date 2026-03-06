from __future__ import annotations

import base64
import binascii
import json
import re
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from cchistory.config import SourceConfig
from cchistory.connectors import NormalizedEvent
from cchistory.connectors.config import SourceInstanceConfig, validate_source_config
from cchistory.db.migrations import apply_migrations, sqlite_path_from_url
from cchistory.models import SearchHit
from cchistory.schema import (
    DistillArtifact,
    HistoryEntryDetail,
    HistoryEntrySummary,
    Message,
    MessageRole,
)

_FTS_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_]+")
_FTS_RESERVED_WORDS = {"AND", "OR", "NOT"}


def encode_pagination_cursor(timestamp: str | datetime, entry_id: str) -> str:
    value = timestamp.isoformat() if isinstance(timestamp, datetime) else timestamp
    payload = json.dumps(
        {"timestamp": value, "entry_id": entry_id},
        separators=(",", ":"),
    ).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii")


def decode_pagination_cursor(cursor: str) -> Tuple[str, str]:
    padding = "=" * (-len(cursor) % 4)
    try:
        payload = json.loads(
            base64.urlsafe_b64decode(f"{cursor}{padding}".encode("ascii")).decode("utf-8")
        )
    except (binascii.Error, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError("invalid pagination cursor") from exc

    timestamp = payload.get("timestamp")
    entry_id = payload.get("entry_id")
    if not isinstance(timestamp, str) or not isinstance(entry_id, str):
        raise ValueError("invalid pagination cursor")
    return timestamp, entry_id


class IndexRepository:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url
        apply_migrations(database_url)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(sqlite_path_from_url(self.database_url))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def ensure_source_configs(
        self, configs: Iterable[SourceConfig | SourceInstanceConfig]
    ) -> int:
        normalized_configs = [
            config if isinstance(config, SourceInstanceConfig) else validate_source_config(config)
            for config in configs
        ]
        if not normalized_configs:
            return 0

        conn = self._connect()
        try:
            for config in normalized_configs:
                conn.execute(
                    """
                    INSERT INTO sources (source_id, connector_type, name, enabled, metadata)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(source_id) DO UPDATE SET
                        connector_type = excluded.connector_type,
                        name = excluded.name,
                        enabled = excluded.enabled,
                        metadata = excluded.metadata
                    """,
                    (
                        config.source_id,
                        config.connector_type,
                        config.name,
                        1 if config.enabled else 0,
                        json.dumps(dict(config.params)),
                    ),
                )
            conn.commit()
            return len(normalized_configs)
        finally:
            conn.close()

    def upsert_event_batch(self, events: Iterable[NormalizedEvent]) -> int:
        events = list(events)
        if not events:
            return 0

        conn = self._connect()
        try:
            for event in events:
                self._upsert_source(conn, event)
                self._upsert_entry(conn, event.entry)
                self._replace_messages(conn, event.entry)
                self._replace_chunks(conn, event.entry)
                self._upsert_search_document(conn, event.entry)
            conn.commit()
            return len(events)
        finally:
            conn.close()

    def get_connector_state(self, source_id: str) -> Optional[Dict[str, Any]]:
        conn = self._connect()
        try:
            row = conn.execute(
                """
                SELECT source_id, cursor, last_run_at, status, error_message, metadata
                FROM connector_state
                WHERE source_id = ?
                """,
                (source_id,),
            ).fetchone()
            if row is None:
                return None
            return {
                "source_id": row["source_id"],
                "cursor": row["cursor"],
                "last_run_at": row["last_run_at"],
                "status": row["status"],
                "error_message": row["error_message"],
                "metadata": json.loads(row["metadata"] or "{}"),
            }
        finally:
            conn.close()

    def get_cursor(self, source_id: str) -> Optional[str]:
        state = self.get_connector_state(source_id)
        return state["cursor"] if state else None

    def set_connector_state(
        self,
        source_id: str,
        cursor: Optional[str],
        status: str,
        error_message: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        conn = self._connect()
        try:
            self._ensure_source_row(conn, source_id)
            conn.execute(
                """
                INSERT INTO connector_state (
                    source_id, cursor, last_run_at, status, error_message, metadata
                ) VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
                ON CONFLICT(source_id) DO UPDATE SET
                    cursor = excluded.cursor,
                    last_run_at = CURRENT_TIMESTAMP,
                    status = excluded.status,
                    error_message = excluded.error_message,
                    metadata = excluded.metadata
                """,
                (
                    source_id,
                    cursor,
                    status,
                    error_message,
                    json.dumps(metadata or {}),
                ),
            )
            conn.commit()
        finally:
            conn.close()

    def record_ingest_run(
        self,
        source_id: str,
        status: str,
        scanned_count: int = 0,
        written_count: int = 0,
        next_cursor: Optional[str] = None,
        error_message: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        run_id = f"{source_id}:{int(datetime.now(timezone.utc).timestamp() * 1_000_000)}"
        conn = self._connect()
        try:
            self._ensure_source_row(conn, source_id)
            conn.execute(
                """
                INSERT INTO ingest_runs (
                    run_id, source_id, status, finished_at, scanned_count, written_count,
                    next_cursor, error_message, metadata
                ) VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    source_id,
                    status,
                    scanned_count,
                    written_count,
                    next_cursor,
                    error_message,
                    json.dumps(metadata or {}),
                ),
            )
            conn.commit()
            return run_id
        finally:
            conn.close()

    def count_rows(self, table_name: str) -> int:
        conn = self._connect()
        try:
            row = conn.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()
            return int(row[0]) if row else 0
        finally:
            conn.close()

    def list_source_snapshots(self) -> List[Dict[str, Any]]:
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                SELECT s.source_id, s.connector_type, s.name, s.enabled, s.metadata,
                       COUNT(e.entry_id) AS entry_count,
                       cs.cursor, cs.last_run_at, cs.status AS last_run_status,
                       cs.error_message, cs.metadata AS state_metadata
                FROM sources s
                LEFT JOIN entries e ON e.source_id = s.source_id
                LEFT JOIN connector_state cs ON cs.source_id = s.source_id
                GROUP BY
                    s.source_id, s.connector_type, s.name, s.enabled, s.metadata,
                    cs.cursor, cs.last_run_at, cs.status, cs.error_message, cs.metadata
                ORDER BY s.name ASC
                """
            ).fetchall()
            return [
                {
                    "source_id": row["source_id"],
                    "type": row["connector_type"],
                    "name": row["name"],
                    "enabled": bool(row["enabled"]),
                    "entry_count": int(row["entry_count"] or 0),
                    "cursor": row["cursor"],
                    "last_run_at": row["last_run_at"],
                    "last_run_status": row["last_run_status"],
                    "error_message": row["error_message"],
                    "metadata": json.loads(row["metadata"] or "{}"),
                    "state_metadata": json.loads(row["state_metadata"] or "{}"),
                }
                for row in rows
            ]
        finally:
            conn.close()

    def list_projects(self) -> Dict[str, List[str]]:
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                SELECT s.name AS source_name, e.project
                FROM entries e
                JOIN sources s ON s.source_id = e.source_id
                WHERE e.project IS NOT NULL
                GROUP BY s.name, e.project
                ORDER BY s.name ASC, e.project ASC
                """
            ).fetchall()
            result: Dict[str, List[str]] = {}
            for row in rows:
                result.setdefault(row["source_name"], []).append(row["project"])
            return result
        finally:
            conn.close()

    def upsert_distill_artifact(self, artifact: DistillArtifact) -> None:
        payload = {
            "title": artifact.title,
            "summary": artifact.summary,
            "patterns": artifact.patterns,
            "decisions": artifact.decisions,
            "open_questions": artifact.open_questions,
            "provenance_entry_ids": artifact.provenance_entry_ids,
            "tags": artifact.tags,
            "schema_version": artifact.schema_version,
        }
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO distill_artifacts (
                    artifact_id, scope, entry_id, artifact_type, content, metadata
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(artifact_id) DO UPDATE SET
                    scope = excluded.scope,
                    entry_id = excluded.entry_id,
                    artifact_type = excluded.artifact_type,
                    content = excluded.content,
                    metadata = excluded.metadata,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    artifact.artifact_id,
                    artifact.scope,
                    artifact.provenance_entry_ids[0] if artifact.provenance_entry_ids else None,
                    artifact.artifact_type,
                    json.dumps(payload),
                    json.dumps(artifact.metadata),
                ),
            )
            conn.commit()
        finally:
            conn.close()

    def get_distill_artifact(self, artifact_id: str) -> Optional[DistillArtifact]:
        conn = self._connect()
        try:
            row = conn.execute(
                """
                SELECT artifact_id, scope, artifact_type, content, metadata, created_at, updated_at
                FROM distill_artifacts
                WHERE artifact_id = ?
                """,
                (artifact_id,),
            ).fetchone()
            if row is None:
                return None
            payload = json.loads(row["content"] or "{}")
            return DistillArtifact(
                schema_version=payload.get("schema_version"),
                artifact_id=row["artifact_id"],
                scope=row["scope"],
                artifact_type=row["artifact_type"],
                title=payload.get("title", ""),
                summary=payload.get("summary", ""),
                patterns=payload.get("patterns", []),
                decisions=payload.get("decisions", []),
                open_questions=payload.get("open_questions", []),
                provenance_entry_ids=payload.get("provenance_entry_ids", []),
                tags=payload.get("tags", []),
                created_at=row["created_at"],
                updated_at=row["updated_at"],
                metadata=json.loads(row["metadata"] or "{}"),
            )
        finally:
            conn.close()

    def list_distill_artifacts(self, artifact_type: Optional[str] = None) -> List[DistillArtifact]:
        conn = self._connect()
        try:
            clauses = []
            params: List[Any] = []
            if artifact_type:
                clauses.append("artifact_type = ?")
                params.append(artifact_type)
            where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
            rows = conn.execute(
                f"""
                SELECT artifact_id
                FROM distill_artifacts
                {where}
                ORDER BY updated_at DESC, artifact_id DESC
                """,
                params,
            ).fetchall()
            return [
                artifact
                for row in rows
                if (artifact := self.get_distill_artifact(row["artifact_id"])) is not None
            ]
        finally:
            conn.close()

    def merge_entry_tags(self, entry_ids: Sequence[str], tags: Sequence[str]) -> None:
        normalized_tags = sorted({tag for tag in tags if tag})
        if not entry_ids or not normalized_tags:
            return

        conn = self._connect()
        try:
            for entry_id in entry_ids:
                row = conn.execute(
                    "SELECT tags_json FROM entries WHERE entry_id = ?",
                    (entry_id,),
                ).fetchone()
                if row is None:
                    continue
                merged_tags = sorted(set(json.loads(row["tags_json"] or "[]")) | set(normalized_tags))
                conn.execute(
                    """
                    UPDATE entries
                    SET tags_json = ?
                    WHERE entry_id = ?
                    """,
                    (
                        json.dumps(merged_tags),
                        entry_id,
                    ),
                )
            conn.commit()
        finally:
            conn.close()

    def list_entry_summaries(
        self,
        limit: int = 50,
        offset: int = 0,
        source: Optional[str] = None,
        project: Optional[str] = None,
    ) -> List[HistoryEntrySummary]:
        conn = self._connect()
        try:
            rows = self._select_entry_summary_rows(
                conn=conn,
                limit=limit,
                offset=offset,
                source=source,
                project=project,
            )
            return [self._summary_from_row(row) for row in rows]
        finally:
            conn.close()

    def list_entry_page(
        self,
        limit: int = 50,
        cursor: Optional[str] = None,
        source: Optional[str] = None,
        project: Optional[str] = None,
    ) -> Tuple[List[HistoryEntrySummary], Optional[str]]:
        conn = self._connect()
        try:
            clauses, params = self._entry_filters(source=source, project=project)
            if cursor:
                cursor_timestamp, cursor_entry_id = decode_pagination_cursor(cursor)
                clauses.append("(e.timestamp < ? OR (e.timestamp = ? AND e.entry_id < ?))")
                params.extend([cursor_timestamp, cursor_timestamp, cursor_entry_id])

            where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
            rows = conn.execute(
                f"""
                SELECT e.entry_id, s.name AS source_name, e.type, e.title, e.timestamp,
                       e.project, e.snippet, e.schema_version, e.tags_json
                FROM entries e
                JOIN sources s ON s.source_id = e.source_id
                {where}
                ORDER BY e.timestamp DESC, e.entry_id DESC
                LIMIT ?
                """,
                (*params, limit + 1),
            ).fetchall()

            page_rows = rows[:limit]
            next_cursor = None
            if len(rows) > limit and page_rows:
                next_cursor = encode_pagination_cursor(
                    page_rows[-1]["timestamp"],
                    page_rows[-1]["entry_id"],
                )
            return [self._summary_from_row(row) for row in page_rows], next_cursor
        finally:
            conn.close()

    def get_entry_detail(self, entry_id: str) -> Optional[HistoryEntryDetail]:
        conn = self._connect()
        try:
            row = conn.execute(
                """
                SELECT e.entry_id, e.source_id, s.name AS source_name, e.type, e.title, e.url,
                       e.project, e.timestamp, e.end_timestamp, e.duration_seconds, e.content,
                       e.metadata, e.tags_json, e.origin_primary_key, e.origin_payload_ref,
                       e.schema_version, e.snippet
                FROM entries e
                JOIN sources s ON s.source_id = e.source_id
                WHERE e.entry_id = ?
                """,
                (entry_id,),
            ).fetchone()
            if row is None:
                return None

            message_rows = conn.execute(
                """
                SELECT role, content, timestamp, tool_name, metadata
                FROM messages
                WHERE entry_id = ?
                ORDER BY position ASC
                """,
                (entry_id,),
            ).fetchall()
            messages = [
                Message(
                    role=MessageRole(message_row["role"]),
                    content=message_row["content"],
                    timestamp=message_row["timestamp"],
                    tool_name=message_row["tool_name"],
                    metadata=json.loads(message_row["metadata"] or "{}"),
                )
                for message_row in message_rows
            ]

            return HistoryEntryDetail(
                schema_version=row["schema_version"],
                id=row["entry_id"],
                source=row["source_name"],
                source_id=row["source_id"],
                type=row["type"],
                title=row["title"],
                timestamp=row["timestamp"],
                project=row["project"],
                snippet=row["snippet"],
                score=None,
                tags=json.loads(row["tags_json"] or "[]"),
                origin_primary_key=row["origin_primary_key"],
                origin_payload_ref=row["origin_payload_ref"],
                url=row["url"],
                end_timestamp=row["end_timestamp"],
                duration_seconds=row["duration_seconds"],
                content=row["content"],
                messages=messages or None,
                metadata=json.loads(row["metadata"] or "{}"),
            )
        finally:
            conn.close()

    def search_entries(
        self,
        query: str,
        limit: int = 50,
        offset: int = 0,
        sources: Optional[Sequence[str]] = None,
        types: Optional[Sequence[str]] = None,
        project: Optional[str] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
    ) -> Tuple[List[SearchHit], int]:
        fts_query = self._build_fts_query(query)
        if not fts_query:
            return [], 0

        conn = self._connect()
        try:
            clauses = ["entry_fts MATCH ?"]
            params: List[Any] = [fts_query]
            entry_clauses, entry_params = self._entry_filters(
                source=sources,
                project=project,
                types=types,
                date_from=date_from,
                date_to=date_to,
            )
            clauses.extend(entry_clauses)
            params.extend(entry_params)
            where = f"WHERE {' AND '.join(clauses)}"

            total_row = conn.execute(
                f"""
                SELECT COUNT(*)
                FROM entry_fts
                JOIN entries e ON e.entry_id = entry_fts.entry_id
                JOIN sources s ON s.source_id = e.source_id
                {where}
                """,
                params,
            ).fetchone()
            total = int(total_row[0]) if total_row else 0

            rows = conn.execute(
                f"""
                WITH ranked AS (
                    SELECT e.entry_id, s.name AS source_name, e.type, e.title, e.timestamp,
                           e.project, e.snippet, e.schema_version, e.tags_json,
                           snippet(entry_fts, 1, '<mark>', '</mark>', ' ... ', 12) AS title_snippet,
                           snippet(entry_fts, 2, '<mark>', '</mark>', ' ... ', 18) AS content_snippet,
                           snippet(entry_fts, 3, '<mark>', '</mark>', ' ... ', 18) AS chunk_snippet,
                           bm25(entry_fts, 10.0, 4.0, 2.0) AS raw_rank,
                           julianday('now') - julianday(e.timestamp) AS age_days
                    FROM entry_fts
                    JOIN entries e ON e.entry_id = entry_fts.entry_id
                    JOIN sources s ON s.source_id = e.source_id
                    {where}
                )
                SELECT *,
                       (
                           (CASE
                               WHEN raw_rank IS NULL THEN 0.0
                               ELSE 1.0 / (1.0 + ABS(raw_rank))
                            END) * 0.85
                           +
                           (CASE
                               WHEN age_days IS NULL OR age_days <= 0 THEN 1.0
                               ELSE 1.0 / (1.0 + (age_days / 30.0))
                            END) * 0.15
                       ) AS score
                FROM ranked
                ORDER BY score DESC, timestamp DESC, entry_id DESC
                LIMIT ? OFFSET ?
                """,
                (*params, limit, offset),
            ).fetchall()

            hits: List[SearchHit] = []
            for row in rows:
                highlights = [
                    value
                    for value in (
                        row["title_snippet"],
                        row["content_snippet"],
                        row["chunk_snippet"],
                    )
                    if value and "<mark>" in value
                ]
                hits.append(
                    SearchHit(
                        schema_version=row["schema_version"],
                        id=row["entry_id"],
                        source=row["source_name"],
                        type=row["type"],
                        title=row["title"],
                        timestamp=row["timestamp"],
                        project=row["project"],
                        snippet=highlights[0] if highlights else row["snippet"],
                        score=round(float(row["score"]), 6),
                        tags=json.loads(row["tags_json"] or "[]"),
                        highlights=highlights,
                    )
                )
            return hits, total
        finally:
            conn.close()

    def _select_entry_summary_rows(
        self,
        conn: sqlite3.Connection,
        limit: int,
        offset: int,
        source: Optional[str] = None,
        project: Optional[str] = None,
    ) -> List[sqlite3.Row]:
        clauses, params = self._entry_filters(source=source, project=project)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        return conn.execute(
            f"""
            SELECT e.entry_id, s.name AS source_name, e.type, e.title, e.timestamp,
                   e.project, e.snippet, e.schema_version, e.tags_json
            FROM entries e
            JOIN sources s ON s.source_id = e.source_id
            {where}
            ORDER BY e.timestamp DESC, e.entry_id DESC
            LIMIT ? OFFSET ?
            """,
            (*params, limit, offset),
        ).fetchall()

    def _entry_filters(
        self,
        source: Optional[str | Sequence[str]] = None,
        project: Optional[str] = None,
        types: Optional[Sequence[str]] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
    ) -> Tuple[List[str], List[Any]]:
        clauses: List[str] = []
        params: List[Any] = []

        source_values: List[str] = []
        if isinstance(source, str):
            if source:
                source_values = [source]
        elif source:
            source_values = [value for value in source if value]
        if source_values:
            source_clauses = []
            for value in source_values:
                source_clauses.append("(e.source_id = ? OR s.name = ?)")
                params.extend([value, value])
            clauses.append(f"({' OR '.join(source_clauses)})")

        if project:
            clauses.append("e.project = ?")
            params.append(project)

        if types:
            normalized_types = [
                entry_type.value if hasattr(entry_type, "value") else str(entry_type)
                for entry_type in types
            ]
            placeholders = ", ".join("?" for _ in normalized_types)
            clauses.append(f"e.type IN ({placeholders})")
            params.extend(normalized_types)

        if date_from:
            clauses.append("e.timestamp >= ?")
            params.append(date_from.isoformat())

        if date_to:
            clauses.append("e.timestamp <= ?")
            params.append(date_to.isoformat())

        return clauses, params

    def _summary_from_row(self, row: sqlite3.Row) -> HistoryEntrySummary:
        return HistoryEntrySummary(
            schema_version=row["schema_version"],
            id=row["entry_id"],
            source=row["source_name"],
            type=row["type"],
            title=row["title"],
            timestamp=row["timestamp"],
            project=row["project"],
            snippet=row["snippet"],
            score=None,
            tags=json.loads(row["tags_json"] or "[]"),
        )

    def _build_fts_query(self, query: str) -> str:
        tokens = _FTS_TOKEN_PATTERN.findall(query.strip())
        if tokens:
            normalized_terms = []
            for token in tokens:
                if token.upper() in _FTS_RESERVED_WORDS:
                    normalized_terms.append(f'"{token}"')
                else:
                    normalized_terms.append(f"{token}*")
            return " AND ".join(normalized_terms)

        escaped = query.strip().replace('"', '""')
        return f'"{escaped}"' if escaped else ""

    def _upsert_source(self, conn: sqlite3.Connection, event: NormalizedEvent) -> None:
        conn.execute(
            """
            INSERT INTO sources (source_id, connector_type, name, enabled, metadata)
            VALUES (?, ?, ?, 1, ?)
            ON CONFLICT(source_id) DO UPDATE SET
                connector_type = excluded.connector_type,
                name = excluded.name,
                enabled = excluded.enabled,
                metadata = excluded.metadata,
                last_seen_at = CURRENT_TIMESTAMP
            """,
            (
                event.source_id,
                event.connector_type,
                event.entry.source,
                json.dumps({}),
            ),
        )

    def _ensure_source_row(
        self,
        conn: sqlite3.Connection,
        source_id: str,
        connector_type: str = "unknown",
        name: Optional[str] = None,
    ) -> None:
        conn.execute(
            """
            INSERT INTO sources (source_id, connector_type, name, enabled, metadata)
            VALUES (?, ?, ?, 1, ?)
            ON CONFLICT(source_id) DO NOTHING
            """,
            (
                source_id,
                connector_type,
                name or source_id,
                json.dumps({}),
            ),
        )

    def _upsert_entry(self, conn: sqlite3.Connection, entry: HistoryEntryDetail) -> None:
        conn.execute(
            """
            INSERT INTO entries (
                entry_id, source_id, origin_primary_key, origin_payload_ref, schema_version,
                type, title, url, project, timestamp, end_timestamp, duration_seconds,
                content, snippet, metadata, tags_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source_id, origin_primary_key) DO UPDATE SET
                entry_id = excluded.entry_id,
                origin_payload_ref = excluded.origin_payload_ref,
                schema_version = excluded.schema_version,
                type = excluded.type,
                title = excluded.title,
                url = excluded.url,
                project = excluded.project,
                timestamp = excluded.timestamp,
                end_timestamp = excluded.end_timestamp,
                duration_seconds = excluded.duration_seconds,
                content = excluded.content,
                snippet = excluded.snippet,
                metadata = excluded.metadata,
                tags_json = excluded.tags_json
            """,
            (
                entry.entry_id,
                entry.source_id,
                entry.origin_primary_key,
                entry.origin_payload_ref,
                entry.schema_version,
                entry.type.value,
                entry.title,
                entry.url,
                entry.project,
                entry.timestamp.isoformat(),
                entry.end_timestamp.isoformat() if entry.end_timestamp else None,
                entry.duration_seconds,
                entry.content,
                entry.to_summary().snippet,
                json.dumps(entry.metadata),
                json.dumps(entry.tags),
            ),
        )

    def _replace_messages(self, conn: sqlite3.Connection, entry: HistoryEntryDetail) -> None:
        conn.execute("DELETE FROM messages WHERE entry_id = ?", (entry.entry_id,))
        if not entry.messages:
            return

        for position, message in enumerate(entry.messages):
            message_id = f"{entry.entry_id}:msg:{position}"
            conn.execute(
                """
                INSERT INTO messages (
                    message_id, entry_id, position, role, content, timestamp, tool_name, metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    message_id,
                    entry.entry_id,
                    position,
                    message.role.value,
                    message.content,
                    message.timestamp.isoformat() if message.timestamp else None,
                    message.tool_name,
                    json.dumps(message.metadata),
                ),
            )

    def _replace_chunks(self, conn: sqlite3.Connection, entry: HistoryEntryDetail) -> None:
        conn.execute("DELETE FROM entry_chunks WHERE entry_id = ?", (entry.entry_id,))

        chunk_payloads = []
        if entry.content:
            chunk_payloads.append(entry.content)
        if entry.messages:
            chunk_payloads.extend(
                message.content
                for message in entry.messages
                if message.content and not message.metadata.get("exclude_from_index")
            )

        for position, text in enumerate(chunk_payloads):
            chunk_id = f"{entry.entry_id}:chunk:{position}"
            conn.execute(
                """
                INSERT INTO entry_chunks (chunk_id, entry_id, position, text, metadata)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    chunk_id,
                    entry.entry_id,
                    position,
                    text,
                    json.dumps({}),
                ),
            )

    def _upsert_search_document(self, conn: sqlite3.Connection, entry: HistoryEntryDetail) -> None:
        chunk_rows = conn.execute(
            """
            SELECT text
            FROM entry_chunks
            WHERE entry_id = ?
            ORDER BY position ASC
            """,
            (entry.entry_id,),
        ).fetchall()
        chunk_text = "\n".join(row["text"] for row in chunk_rows)

        conn.execute("DELETE FROM entry_fts WHERE entry_id = ?", (entry.entry_id,))
        conn.execute(
            """
            INSERT INTO entry_fts (entry_id, title, content, chunks)
            VALUES (?, ?, ?, ?)
            """,
            (
                entry.entry_id,
                entry.title,
                entry.content or "",
                chunk_text,
            ),
        )


class RepositoryEventWriter:
    def __init__(self, repository: IndexRepository) -> None:
        self.repository = repository

    async def write_batch(self, events):
        return self.repository.upsert_event_batch(events)
