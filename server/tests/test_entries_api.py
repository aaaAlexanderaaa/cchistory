from __future__ import annotations

import tempfile
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi import Response

from cchistory.connectors import NormalizedEvent
from cchistory.db import IndexRepository
from cchistory.db.repository import decode_pagination_cursor
from cchistory.models import HistoryEntry, Message, MessageRole
from cchistory.routers.entries import get_entry, list_entries


def make_event() -> NormalizedEvent:
    entry = HistoryEntry(
        id="claude_code:claude_code:entry-1",
        source="Claude Code",
        source_id="claude_code",
        type="conversation",
        title="Index-backed projection",
        timestamp=datetime(2026, 3, 6, tzinfo=timezone.utc),
        origin_primary_key="project/session-1.jsonl",
        origin_payload_ref="/tmp/session-1.jsonl",
        content="[2 messages] Index-backed projection",
        messages=[
            Message(role=MessageRole.USER, content="Show me index-backed detail"),
            Message(role=MessageRole.ASSISTANT, content="Here is the detail projection."),
        ],
        metadata={"message_count": 2},
        tags=["claude-code"],
    )
    return NormalizedEvent(
        event_id="event-1",
        source_id="claude_code",
        connector_type="claude_code",
        entry_id=entry.entry_id,
        entry_type=entry.type,
        occurred_at=entry.timestamp,
        origin_primary_key=entry.origin_primary_key,
        origin_payload_ref=entry.origin_payload_ref,
        entry=entry,
    )


@pytest.fixture
def repository_with_entry():
    with tempfile.TemporaryDirectory() as tmpdir:
        repository = IndexRepository(f"sqlite:///{Path(tmpdir) / 'index.sqlite3'}")
        repository.upsert_event_batch([make_event()])
        yield repository


@pytest.mark.asyncio
async def test_list_entries_returns_summary_projection(repository_with_entry):
    response = Response()
    entries = await list_entries(
        limit=50,
        offset=0,
        cursor=None,
        source="claude_code",
        project=None,
        response=response,
        repository=repository_with_entry,
    )

    assert len(entries) == 1
    assert entries[0].entry_id == "claude_code:claude_code:entry-1"
    assert entries[0].snippet == "[2 messages] Index-backed projection"
    assert "X-Next-Cursor" not in response.headers


@pytest.mark.asyncio
async def test_list_entries_sets_cursor_header(repository_with_entry):
    extra_event = make_event()
    extra_event.event_id = "event-2"
    extra_event.entry = extra_event.entry.model_copy(
        update={
            "id": "claude_code:claude_code:entry-2",
            "title": "Later timeline item",
            "timestamp": datetime(2026, 3, 6, 0, 5, tzinfo=timezone.utc),
            "origin_primary_key": "project/session-2.jsonl",
            "origin_payload_ref": "/tmp/session-2.jsonl",
        }
    )
    extra_event.entry_id = extra_event.entry.entry_id
    extra_event.occurred_at = extra_event.entry.timestamp
    extra_event.origin_primary_key = extra_event.entry.origin_primary_key
    extra_event.origin_payload_ref = extra_event.entry.origin_payload_ref
    repository_with_entry.upsert_event_batch([extra_event])

    response = Response()
    entries = await list_entries(
        limit=1,
        offset=0,
        cursor=None,
        source=None,
        project=None,
        response=response,
        repository=repository_with_entry,
    )

    assert len(entries) == 1
    assert "X-Next-Cursor" in response.headers
    timestamp, entry_id = decode_pagination_cursor(response.headers["X-Next-Cursor"])
    assert entry_id == entries[-1].entry_id
    assert timestamp


@pytest.mark.asyncio
async def test_get_entry_returns_detail_projection(repository_with_entry):
    entry = await get_entry("claude_code:claude_code:entry-1", repository=repository_with_entry)

    assert entry.entry_id == "claude_code:claude_code:entry-1"
    assert entry.messages is not None
    assert len(entry.messages) == 2
