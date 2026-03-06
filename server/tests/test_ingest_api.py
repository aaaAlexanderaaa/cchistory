from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from cchistory.config import SourceConfig
from cchistory.db import IndexRepository
from cchistory.ingestion import IngestRunReport
from cchistory.models import IngestRunRequest
from cchistory.routers.ingest import get_ingest_status, run_ingest


class StubOrchestrator:
    async def run_all(self):
        return {
            "test_claude": IngestRunReport(
                source_id="test_claude",
                connector_type="claude_code",
                status="ok",
                scanned_count=2,
                written_count=2,
                next_cursor="cursor-2",
                has_more=False,
            )
        }

    async def run_source(self, source_id: str):
        if source_id != "test_claude":
            raise KeyError(source_id)
        return IngestRunReport(
            source_id="test_claude",
            connector_type="claude_code",
            status="ok",
            scanned_count=1,
            written_count=1,
            next_cursor="cursor-1",
            has_more=False,
        )


@pytest.fixture
def repository_with_source():
    with tempfile.TemporaryDirectory() as tmpdir:
        repository = IndexRepository(f"sqlite:///{Path(tmpdir) / 'index.sqlite3'}")
        repository.ensure_source_configs(
            [
                SourceConfig(
                    type="claude_code",
                    name="Test Claude",
                    params={"base_dir": tmpdir},
                )
            ]
        )
        repository.set_connector_state(
            source_id="test_claude",
            cursor="cursor-0",
            status="ok",
            metadata={
                "lag_seconds": 12,
                "last_success_at": "2026-03-06T08:00:00+00:00",
                "has_more": False,
            },
        )
        yield repository


@pytest.mark.asyncio
async def test_get_ingest_status_returns_source_snapshot(repository_with_source):
    statuses = await get_ingest_status(
        repository=repository_with_source,
        runtime=None,
        registry=None,
    )

    assert len(statuses) == 1
    assert statuses[0].source_id == "test_claude"
    assert statuses[0].last_run_status == "ok"
    assert statuses[0].lag_seconds == 12


@pytest.mark.asyncio
async def test_run_ingest_records_runs(repository_with_source):
    response = await run_ingest(
        request=IngestRunRequest(source_id="test_claude"),
        repository=repository_with_source,
        orchestrator=StubOrchestrator(),
    )

    assert len(response.runs) == 1
    assert response.runs[0].source_id == "test_claude"
    assert repository_with_source.count_rows("ingest_runs") == 1
