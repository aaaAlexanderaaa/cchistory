from __future__ import annotations

from datetime import datetime, timezone
import logging
from pathlib import Path
import tempfile

import pytest

from cchistory.connectors import (
    Connector,
    HealthState,
    HealthStatus,
    NormalizedEvent,
    RawRecord,
    ScanBatch,
    SourceHandle,
)
from cchistory.db import IndexRepository, RepositoryEventWriter
from cchistory.ingestion import InMemoryEventWriter, IngestionOrchestrator
from cchistory.models import HistoryEntry


class StubConnector(Connector):
    connector_type = "stub"

    def __init__(self, events: list[NormalizedEvent], status: HealthState = HealthState.OK) -> None:
        self._events = events
        self._status = status
        self.last_cursor = None

    async def discover(self) -> list[SourceHandle]:
        return [SourceHandle(source_id="stub_source", connector_type="stub", name="Stub Source")]

    async def health(self, source: SourceHandle) -> HealthStatus:
        return HealthStatus(
            source_id=source.source_id,
            connector_type=source.connector_type,
            status=self._status,
            checked_at=datetime(2026, 3, 6, tzinfo=timezone.utc),
            message=None if self._status == HealthState.OK else "connector unavailable",
        )

    async def scan_since(self, source: SourceHandle, cursor: str | None) -> ScanBatch:
        self.last_cursor = cursor
        return ScanBatch(
            events=self._events,
            next_cursor="cursor-2",
            has_more=False,
            scanned_count=len(self._events),
        )

    async def fetch(self, source: SourceHandle, origin_primary_key: str) -> RawRecord:
        return RawRecord(
            source_id=source.source_id,
            connector_type=source.connector_type,
            origin_primary_key=origin_primary_key,
            payload={"key": origin_primary_key},
        )


def make_event() -> NormalizedEvent:
    entry = HistoryEntry(
        id="stub_source:entry-1",
        source="Stub Source",
        source_id="stub_source",
        type="conversation",
        title="Stub Event",
        timestamp=datetime(2026, 3, 6, tzinfo=timezone.utc),
        origin_primary_key="session-1",
        origin_payload_ref="/tmp/session-1.jsonl",
    )
    return NormalizedEvent(
        event_id="evt-1",
        source_id="stub_source",
        connector_type="stub",
        entry_id=entry.entry_id,
        entry_type=entry.type,
        occurred_at=entry.timestamp,
        origin_primary_key=entry.origin_primary_key,
        origin_payload_ref=entry.origin_payload_ref,
        entry=entry,
    )


@pytest.mark.asyncio
async def test_run_source_executes_batch_lifecycle():
    writer = InMemoryEventWriter()
    orchestrator = IngestionOrchestrator(writer=writer)
    handle = SourceHandle(source_id="stub_source", connector_type="stub", name="Stub Source")
    connector = StubConnector(events=[make_event()])
    orchestrator.register_source(connector, handle)

    report = await orchestrator.run_source("stub_source")

    assert report.status == "ok"
    assert report.scanned_count == 1
    assert report.written_count == 1
    assert writer.events[0].entry_id == "stub_source:entry-1"


@pytest.mark.asyncio
async def test_run_all_invokes_registered_sources():
    writer = InMemoryEventWriter()
    orchestrator = IngestionOrchestrator(writer=writer)
    orchestrator.register_source(
        StubConnector(events=[make_event()]),
        SourceHandle(source_id="stub_source", connector_type="stub", name="Stub Source"),
    )
    orchestrator.register_source(
        StubConnector(events=[make_event()]),
        SourceHandle(source_id="stub_source_2", connector_type="stub", name="Stub Source 2"),
    )

    reports = await orchestrator.run_all()

    assert sorted(reports.keys()) == ["stub_source", "stub_source_2"]
    assert all(report.status == "ok" for report in reports.values())
    assert len(writer.events) == 2


@pytest.mark.asyncio
async def test_unhealthy_source_skips_write():
    writer = InMemoryEventWriter()
    orchestrator = IngestionOrchestrator(writer=writer)
    handle = SourceHandle(source_id="stub_source", connector_type="stub", name="Stub Source")
    connector = StubConnector(events=[make_event()], status=HealthState.ERROR)
    orchestrator.register_source(connector, handle)

    report = await orchestrator.run_source("stub_source")

    assert report.status == "error"
    assert report.written_count == 0
    assert writer.events == []


@pytest.mark.asyncio
async def test_state_store_resumes_saved_cursor():
    writer = InMemoryEventWriter()

    class MemoryStateStore:
        def __init__(self) -> None:
            self.state = {"stub_source": {"cursor": "cursor-1"}}

        def get_cursor(self, source_id: str):
            return self.state.get(source_id, {}).get("cursor")

        def set_connector_state(self, source_id, cursor, status, error_message=None, metadata=None):
            self.state[source_id] = {
                "cursor": cursor,
                "status": status,
                "error_message": error_message,
                "metadata": metadata or {},
            }

    state_store = MemoryStateStore()
    orchestrator = IngestionOrchestrator(writer=writer, state_store=state_store)
    handle = SourceHandle(source_id="stub_source", connector_type="stub", name="Stub Source")
    connector = StubConnector(events=[make_event()])
    orchestrator.register_source(connector, handle)

    report = await orchestrator.run_source("stub_source")

    assert connector.last_cursor == "cursor-1"
    assert report.next_cursor == "cursor-2"
    assert state_store.state["stub_source"]["cursor"] == "cursor-2"


@pytest.mark.asyncio
async def test_replay_is_idempotent_with_repository_writer():
    with tempfile.TemporaryDirectory() as tmpdir:
        repository = IndexRepository(f"sqlite:///{Path(tmpdir) / 'index.sqlite3'}")
        writer = RepositoryEventWriter(repository)
        orchestrator = IngestionOrchestrator(writer=writer, state_store=repository)
        handle = SourceHandle(source_id="stub_source", connector_type="stub", name="Stub Source")
        connector = StubConnector(events=[make_event()])
        orchestrator.register_source(connector, handle)

        first = await orchestrator.run_source("stub_source")
        second = await orchestrator.run_source("stub_source", cursor=None)

        assert first.written_count == 1
        assert second.written_count == 1
        assert repository.count_rows("entries") == 1
        assert repository.count_rows("messages") == 0


@pytest.mark.asyncio
async def test_ingestion_logs_metrics(caplog):
    caplog.set_level(logging.INFO)
    writer = InMemoryEventWriter()
    orchestrator = IngestionOrchestrator(writer=writer)
    handle = SourceHandle(source_id="stub_source", connector_type="stub", name="Stub Source")
    connector = StubConnector(events=[make_event()])
    orchestrator.register_source(connector, handle)

    await orchestrator.run_source("stub_source")

    assert "ingest.run.start source_id=stub_source" in caplog.text
    assert "ingest.run.complete source_id=stub_source" in caplog.text
