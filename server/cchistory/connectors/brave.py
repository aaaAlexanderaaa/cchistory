from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import List

from cchistory.connectors.base import Connector
from cchistory.connectors.config import SourceInstanceConfig
from cchistory.connectors.models import (
    HealthState,
    HealthStatus,
    NormalizedEvent,
    RawRecord,
    ScanBatch,
    SourceHandle,
)
from cchistory.datasources.brave import BraveSource, chrome_time_to_datetime


class BraveConnector(Connector):
    connector_type = "brave"

    def __init__(self, config: SourceInstanceConfig) -> None:
        self.config = config

    def _db_path(self) -> Path:
        return Path(self.config.params["history_db"])

    def _handle(self) -> SourceHandle:
        return SourceHandle(
            source_id=self.config.source_id,
            connector_type=self.connector_type,
            name=self.config.name,
            metadata={"history_db": str(self._db_path())},
        )

    async def discover(self) -> List[SourceHandle]:
        if self._db_path().exists():
            return [self._handle()]
        return []

    async def health(self, source: SourceHandle) -> HealthStatus:
        status = HealthState.OK if self._db_path().exists() else HealthState.ERROR
        last_success_at = None
        lag_seconds = None

        if self._db_path().exists():
            reader = BraveSource()
            await reader.connect(
                {
                    "history_db": str(self._db_path()),
                    "source_name": self.config.name,
                    "source_id": self.config.source_id,
                }
            )
            conn = reader._get_connection()
            try:
                row = conn.execute("SELECT MAX(visit_time) AS visit_time FROM visits").fetchone()
                if row and row["visit_time"]:
                    last_success_at = chrome_time_to_datetime(row["visit_time"])
                    lag_seconds = int(
                        datetime.now(timezone.utc).timestamp() - last_success_at.timestamp()
                    )
            finally:
                conn.close()
                await reader.disconnect()

        return HealthStatus(
            source_id=source.source_id,
            connector_type=source.connector_type,
            status=status,
            checked_at=datetime.now(timezone.utc),
            last_success_at=last_success_at,
            lag_seconds=lag_seconds,
            message=None if self._db_path().exists() else f"Brave history DB not found: {self._db_path()}",
            metadata={"history_db": str(self._db_path())},
        )

    async def scan_since(self, source: SourceHandle, cursor: str | None) -> ScanBatch:
        cutoff = int(cursor) if cursor is not None else None
        reader = BraveSource()
        await reader.connect(
            {
                "history_db": str(self._db_path()),
                "source_name": self.config.name,
                "source_id": self.config.source_id,
            }
        )
        conn = reader._get_connection()
        events: List[NormalizedEvent] = []
        next_cursor_value = cutoff

        try:
            sql = """
                SELECT v.id as visit_id, u.id as url_id, u.url, u.title,
                       v.visit_time, v.visit_duration, u.visit_count, u.typed_count
                FROM visits v
                JOIN urls u ON v.url = u.id
                WHERE (? IS NULL OR v.visit_time > ?)
                ORDER BY v.visit_time DESC, v.id DESC
            """
            rows = conn.execute(sql, (cutoff, cutoff)).fetchall()
            for row in rows:
                entry = reader._row_to_entry(row)
                events.append(
                    NormalizedEvent(
                        event_id=f"{source.source_id}:{entry.entry_id}",
                        source_id=source.source_id,
                        connector_type=source.connector_type,
                        entry_id=entry.entry_id,
                        entry_type=entry.type,
                        occurred_at=entry.timestamp,
                        origin_primary_key=entry.origin_primary_key,
                        origin_payload_ref=entry.origin_payload_ref,
                        entry=entry,
                    )
                )
                visit_time = row["visit_time"]
                if next_cursor_value is None or visit_time > next_cursor_value:
                    next_cursor_value = visit_time
        finally:
            conn.close()
            await reader.disconnect()

        return ScanBatch(
            events=events,
            next_cursor=str(next_cursor_value) if next_cursor_value is not None else cursor,
            has_more=False,
            scanned_count=len(events),
        )

    async def fetch(self, source: SourceHandle, origin_primary_key: str) -> RawRecord:
        reader = BraveSource()
        await reader.connect(
            {
                "history_db": str(self._db_path()),
                "source_name": self.config.name,
                "source_id": self.config.source_id,
            }
        )
        conn = reader._get_connection()
        try:
            row = conn.execute(
                """
                SELECT v.id as visit_id, u.id as url_id, u.url, u.title,
                       v.visit_time, v.visit_duration, u.visit_count, u.typed_count
                FROM visits v
                JOIN urls u ON v.url = u.id
                WHERE v.id = ?
                """,
                (origin_primary_key,),
            ).fetchone()
            payload = dict(row) if row else {}
            payload_ref = payload.get("url") if payload else None
        finally:
            conn.close()
            await reader.disconnect()

        return RawRecord(
            source_id=source.source_id,
            connector_type=source.connector_type,
            origin_primary_key=origin_primary_key,
            origin_payload_ref=payload_ref,
            payload=payload,
        )
