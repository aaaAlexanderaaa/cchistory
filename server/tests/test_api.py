from __future__ import annotations

import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from cchistory.config import SourceConfig
from cchistory.connectors import NormalizedEvent
from cchistory.db import IndexRepository
from cchistory.main import health_check
from cchistory.models import HistoryEntry, Message, MessageRole
from cchistory.routers.history import get_entry, list_history
from cchistory.routers.search import search
from cchistory.routers.sources import list_sources


def make_event(entry_id: str, title: str, content: str, timestamp: datetime) -> NormalizedEvent:
    entry = HistoryEntry(
        id=entry_id,
        source="Test Claude",
        source_id="test_claude",
        type="conversation",
        title=title,
        timestamp=timestamp,
        origin_primary_key=f"project/{entry_id}.jsonl",
        origin_payload_ref=f"/tmp/{entry_id}.jsonl",
        content=content,
        messages=[
            Message(role=MessageRole.USER, content=title),
            Message(role=MessageRole.ASSISTANT, content=content),
        ],
        metadata={"message_count": 2},
        tags=["claude-code"],
    )
    return NormalizedEvent(
        event_id=f"event:{entry_id}",
        source_id=entry.source_id,
        connector_type="claude_code",
        entry_id=entry.entry_id,
        entry_type=entry.type,
        occurred_at=entry.timestamp,
        origin_primary_key=entry.origin_primary_key,
        origin_payload_ref=entry.origin_payload_ref,
        entry=entry,
    )


@pytest.fixture
def repository_with_data():
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

        base_ts = datetime(2026, 3, 6, 8, 0, tzinfo=timezone.utc)
        events = [
            make_event(
                "test_claude:test_claude:entry-1",
                "Write a hello world",
                "Here it is: print('hello world')",
                base_ts,
            ),
            make_event(
                "test_claude:test_claude:entry-2",
                "Refactor the auth middleware",
                "I can split the cookie checks into helpers.",
                base_ts + timedelta(minutes=5),
            ),
        ]
        repository.upsert_event_batch(events)
        repository.set_connector_state(
            source_id="test_claude",
            cursor="cursor-42",
            status="ok",
            metadata={
                "has_more": False,
                "lag_seconds": 30,
                "last_success_at": "2026-03-06T08:05:00+00:00",
            },
        )
        yield repository


@pytest.mark.asyncio
async def test_health(repository_with_data):
    resp = await health_check()
    assert resp["status"] == "ok"


@pytest.mark.asyncio
async def test_list_sources(repository_with_data):
    sources = await list_sources(repository=repository_with_data, runtime=None, registry=None)
    assert len(sources) == 1
    assert sources[0].name == "Test Claude"
    assert sources[0].source_id == "test_claude"
    assert sources[0].last_run_status == "ok"
    assert sources[0].lag_seconds == 30
    assert sources[0].schema_version == "0.2.0"


@pytest.mark.asyncio
async def test_list_history_identity_fields(repository_with_data):
    entries = await list_history(
        limit=50,
        offset=0,
        source=None,
        project=None,
        repository=repository_with_data,
    )
    assert len(entries) == 2
    assert entries[0].source == "Test Claude"
    assert entries[0].source_id == "test_claude"
    assert entries[0].entry_id == entries[0].id
    assert entries[0].origin_primary_key.endswith(".jsonl")
    assert entries[0].origin_payload_ref.endswith(".jsonl")


@pytest.mark.asyncio
async def test_get_entry_round_trip(repository_with_data):
    entries = await list_history(
        limit=50,
        offset=0,
        source=None,
        project=None,
        repository=repository_with_data,
    )
    entry = entries[0]

    detail = await get_entry("Test Claude", entry.id, repository=repository_with_data)
    assert detail.id == entry.id
    assert detail.entry_id == entry.entry_id
    assert detail.origin_primary_key == entry.origin_primary_key


@pytest.mark.asyncio
async def test_source_lookup_accepts_source_id(repository_with_data):
    entries = await list_history(
        limit=50,
        offset=0,
        source="test_claude",
        project=None,
        repository=repository_with_data,
    )

    assert len(entries) == 2
    assert all(entry.source_id == "test_claude" for entry in entries)


@pytest.mark.asyncio
async def test_history_pagination_is_deterministic(repository_with_data):
    first_page = await list_history(
        limit=1, offset=0, source=None, project=None, repository=repository_with_data
    )
    second_page = await list_history(
        limit=1, offset=0, source=None, project=None, repository=repository_with_data
    )
    third_page = await list_history(
        limit=1, offset=1, source=None, project=None, repository=repository_with_data
    )

    assert first_page == second_page
    assert first_page[0].id != third_page[0].id


@pytest.mark.asyncio
async def test_search(repository_with_data):
    result = await search(
        q="hello world",
        sources=None,
        types=None,
        project=None,
        date_from=None,
        date_to=None,
        limit=50,
        offset=0,
        repository=repository_with_data,
    )
    assert result.total == 1
    assert "hello world" in result.query
    assert result.entries[0].highlights


@pytest.mark.asyncio
async def test_search_no_results(repository_with_data):
    result = await search(
        q="zzz_nonexistent_zzz",
        sources=None,
        types=None,
        project=None,
        date_from=None,
        date_to=None,
        limit=50,
        offset=0,
        repository=repository_with_data,
    )
    assert result.total == 0
