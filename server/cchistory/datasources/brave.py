from __future__ import annotations

import hashlib
import logging
import shutil
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from cchistory.datasources.base import DataSource
from cchistory.models import EntryType, HistoryEntry, SearchQuery

logger = logging.getLogger(__name__)

# Chrome/Brave timestamps are microseconds since 1601-01-01
CHROME_EPOCH_OFFSET = 11644473600


def chrome_time_to_datetime(chrome_ts: int) -> datetime:
    if chrome_ts == 0:
        return datetime.now(timezone.utc)
    unix_ts = (chrome_ts / 1_000_000) - CHROME_EPOCH_OFFSET
    try:
        return datetime.fromtimestamp(unix_ts, tz=timezone.utc)
    except (ValueError, OSError):
        return datetime.now(timezone.utc)


class BraveSource(DataSource):
    """Reads Brave browser history from its SQLite database (read-only copy)."""

    name = "brave"
    source_type = "database"

    def __init__(self) -> None:
        self._db_path: Optional[str] = None
        self._tmp_copy: Optional[str] = None

    async def connect(self, params: Dict[str, Any]) -> None:
        self._db_path = params.get("history_db", "")
        if not self._db_path or not Path(self._db_path).exists():
            logger.warning(f"Brave history DB not found: {self._db_path}")
            self._db_path = None

    async def disconnect(self) -> None:
        if self._tmp_copy and Path(self._tmp_copy).exists():
            try:
                Path(self._tmp_copy).unlink()
            except OSError:
                pass
        self._tmp_copy = None

    def _get_connection(self) -> sqlite3.Connection:
        """Create a read-only connection using a temporary copy of the DB.

        Browsers lock the history DB, so we copy it first to avoid conflicts.
        """
        if not self._db_path:
            raise RuntimeError("Brave history database not configured")

        tmp = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
        tmp.close()
        shutil.copy2(self._db_path, tmp.name)

        for wal in [self._db_path + "-wal", self._db_path + "-shm"]:
            if Path(wal).exists():
                shutil.copy2(wal, tmp.name + wal[len(self._db_path) :])

        self._tmp_copy = tmp.name
        conn = sqlite3.connect(tmp.name)
        conn.row_factory = sqlite3.Row
        return conn

    def _row_to_entry(self, row: sqlite3.Row) -> HistoryEntry:
        url = row["url"]
        title = row["title"] or url
        visit_time = chrome_time_to_datetime(row["visit_time"])
        visit_duration = row["visit_duration"] if "visit_duration" in row.keys() else 0
        duration_sec = int(visit_duration / 1_000_000) if visit_duration else None

        stable_id = hashlib.sha256(
            f"brave:{row['visit_id']}:{row['url_id']}".encode()
        ).hexdigest()[:16]

        return HistoryEntry(
            id=f"brave-{stable_id}",
            source="Brave",
            source_id=str(row["visit_id"]),
            type=EntryType.VISIT,
            title=title,
            url=url,
            timestamp=visit_time,
            duration_seconds=duration_sec,
            metadata={
                "visit_count": row.get("visit_count", 0),
                "typed_count": row.get("typed_count", 0),
            },
            tags=["brave", "browser"],
        )

    async def list_entries(
        self,
        limit: int = 50,
        offset: int = 0,
        project: Optional[str] = None,
    ) -> List[HistoryEntry]:
        if not self._db_path:
            return []

        conn = self._get_connection()
        try:
            query = """
                SELECT v.id as visit_id, u.id as url_id, u.url, u.title,
                       v.visit_time, v.visit_duration, u.visit_count, u.typed_count
                FROM visits v
                JOIN urls u ON v.url = u.id
                ORDER BY v.visit_time DESC
                LIMIT ? OFFSET ?
            """
            cursor = conn.execute(query, (limit, offset))
            return [self._row_to_entry(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    async def get_entry(self, entry_id: str) -> Optional[HistoryEntry]:
        if not self._db_path:
            return None

        raw_id = entry_id.replace("brave-", "")
        conn = self._get_connection()
        try:
            cursor = conn.execute(
                """
                SELECT v.id as visit_id, u.id as url_id, u.url, u.title,
                       v.visit_time, v.visit_duration, u.visit_count, u.typed_count
                FROM visits v
                JOIN urls u ON v.url = u.id
                WHERE v.id = ?
                """,
                (raw_id,),
            )
            row = cursor.fetchone()
            if row:
                return self._row_to_entry(row)
            return None
        finally:
            conn.close()

    async def search(self, query: SearchQuery) -> List[HistoryEntry]:
        if not self._db_path:
            return []

        conn = self._get_connection()
        try:
            sql = """
                SELECT v.id as visit_id, u.id as url_id, u.url, u.title,
                       v.visit_time, v.visit_duration, u.visit_count, u.typed_count
                FROM visits v
                JOIN urls u ON v.url = u.id
                WHERE (u.url LIKE ? OR u.title LIKE ?)
                ORDER BY v.visit_time DESC
                LIMIT ?
            """
            pattern = f"%{query.query}%"
            cursor = conn.execute(sql, (pattern, pattern, query.limit))
            return [self._row_to_entry(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    async def count(self) -> int:
        if not self._db_path:
            return 0

        conn = self._get_connection()
        try:
            cursor = conn.execute("SELECT COUNT(*) FROM visits")
            row = cursor.fetchone()
            return row[0] if row else 0
        finally:
            conn.close()

    async def list_projects(self) -> List[str]:
        return []
