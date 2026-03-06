from __future__ import annotations

import logging
from time import perf_counter
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Protocol

from cchistory.connectors import Connector, HealthState, HealthStatus, NormalizedEvent, SourceHandle

logger = logging.getLogger(__name__)


class EventWriter(Protocol):
    async def write_batch(self, events: List[NormalizedEvent]) -> int:
        ...


class CursorStateStore(Protocol):
    def get_cursor(self, source_id: str) -> Optional[str]:
        ...

    def set_connector_state(
        self,
        source_id: str,
        cursor: Optional[str],
        status: str,
        error_message: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        ...


class InMemoryEventWriter:
    def __init__(self) -> None:
        self.events: List[NormalizedEvent] = []

    async def write_batch(self, events: List[NormalizedEvent]) -> int:
        self.events.extend(events)
        return len(events)


@dataclass
class RegisteredSource:
    connector: Connector
    handle: SourceHandle


@dataclass
class IngestRunReport:
    source_id: str
    connector_type: str
    status: str
    scanned_count: int = 0
    written_count: int = 0
    next_cursor: str | None = None
    has_more: bool = False
    error: str | None = None


@dataclass
class IngestionOrchestrator:
    writer: EventWriter
    state_store: CursorStateStore | None = None
    _sources: Dict[str, RegisteredSource] = field(default_factory=dict)

    def register_source(self, connector: Connector, handle: SourceHandle) -> None:
        self._sources[handle.source_id] = RegisteredSource(connector=connector, handle=handle)

    def list_sources(self) -> List[str]:
        return sorted(self._sources.keys())

    def _health_metadata(self, health: HealthStatus) -> Dict[str, Any]:
        metadata: Dict[str, Any] = dict(health.metadata)
        metadata["health_checked_at"] = health.checked_at.isoformat()
        metadata["last_success_at"] = (
            health.last_success_at.isoformat() if health.last_success_at else None
        )
        metadata["lag_seconds"] = health.lag_seconds
        return metadata

    async def run_source(self, source_id: str, cursor: str | None = None) -> IngestRunReport:
        registered = self._sources[source_id]
        effective_cursor = cursor
        if effective_cursor is None and self.state_store is not None:
            effective_cursor = self.state_store.get_cursor(source_id)

        started = perf_counter()
        logger.info(
            "ingest.run.start source_id=%s connector_type=%s cursor=%s",
            registered.handle.source_id,
            registered.handle.connector_type,
            effective_cursor,
        )

        health = await registered.connector.health(registered.handle)
        health_metadata = self._health_metadata(health)
        if health.status == HealthState.ERROR:
            if self.state_store is not None:
                self.state_store.set_connector_state(
                    source_id=registered.handle.source_id,
                    cursor=effective_cursor,
                    status="error",
                    error_message=health.message or "source health check failed",
                    metadata=health_metadata,
                )
            logger.warning(
                "ingest.run.error source_id=%s connector_type=%s lag_seconds=%s error=%s",
                registered.handle.source_id,
                registered.handle.connector_type,
                health.lag_seconds,
                health.message or "source health check failed",
            )
            return IngestRunReport(
                source_id=registered.handle.source_id,
                connector_type=registered.handle.connector_type,
                status="error",
                error=health.message or "source health check failed",
            )

        batch = await registered.connector.scan_since(registered.handle, effective_cursor)
        validated_events = [NormalizedEvent.model_validate(event) for event in batch.events]
        written_count = await self.writer.write_batch(validated_events)

        if self.state_store is not None:
            health_metadata["has_more"] = batch.has_more
            self.state_store.set_connector_state(
                source_id=registered.handle.source_id,
                cursor=batch.next_cursor,
                status="ok",
                metadata=health_metadata,
            )

        duration_ms = round((perf_counter() - started) * 1000, 3)
        logger.info(
            "ingest.run.complete source_id=%s connector_type=%s scanned=%s written=%s next_cursor=%s lag_seconds=%s duration_ms=%s",
            registered.handle.source_id,
            registered.handle.connector_type,
            batch.scanned_count,
            written_count,
            batch.next_cursor,
            health.lag_seconds,
            duration_ms,
        )

        return IngestRunReport(
            source_id=registered.handle.source_id,
            connector_type=registered.handle.connector_type,
            status="ok",
            scanned_count=batch.scanned_count,
            written_count=written_count,
            next_cursor=batch.next_cursor,
            has_more=batch.has_more,
        )

    async def run_all(
        self, cursors: Mapping[str, str | None] | None = None
    ) -> Dict[str, IngestRunReport]:
        reports: Dict[str, IngestRunReport] = {}
        for source_id in self.list_sources():
            cursor = cursors[source_id] if cursors and source_id in cursors else None
            reports[source_id] = await self.run_source(source_id, cursor)
        logger.info(
            "ingest.run_all.complete source_count=%s sources=%s",
            len(reports),
            ",".join(sorted(reports.keys())),
        )
        return reports
