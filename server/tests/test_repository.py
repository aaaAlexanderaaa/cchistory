from __future__ import annotations

import tempfile
from datetime import datetime, timezone
from pathlib import Path

from cchistory.connectors import NormalizedEvent
from cchistory.db import IndexRepository
from cchistory.models import HistoryEntry, Message, MessageRole


def make_event() -> NormalizedEvent:
    entry = HistoryEntry(
        id="claude_code:claude_code:entry-1",
        source="Claude Code",
        source_id="claude_code",
        type="conversation",
        title="Repository smoke test",
        timestamp=datetime(2026, 3, 6, tzinfo=timezone.utc),
        origin_primary_key="project/session-1.jsonl",
        origin_payload_ref="/tmp/session-1.jsonl",
        content="[2 messages] Repository smoke test",
        messages=[
            Message(role=MessageRole.USER, content="Find duplicate write bug"),
            Message(role=MessageRole.ASSISTANT, content="I added an idempotent upsert."),
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


def test_repository_upserts_events_idempotently():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_url = f"sqlite:///{Path(tmpdir) / 'index.sqlite3'}"
        repository = IndexRepository(db_url)
        event = make_event()

        assert repository.upsert_event_batch([event]) == 1
        assert repository.upsert_event_batch([event]) == 1

        assert repository.count_rows("sources") == 1
        assert repository.count_rows("entries") == 1
        assert repository.count_rows("messages") == 2
        assert repository.count_rows("entry_chunks") == 3


def test_repository_persists_connector_state():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_url = f"sqlite:///{Path(tmpdir) / 'index.sqlite3'}"
        repository = IndexRepository(db_url)

        repository.set_connector_state(
            source_id="claude_code",
            cursor="cursor-42",
            status="ok",
            metadata={"has_more": "false"},
        )
        state = repository.get_connector_state("claude_code")

        assert state is not None
        assert state["cursor"] == "cursor-42"
        assert state["status"] == "ok"
        assert state["metadata"]["has_more"] == "false"


def test_repository_returns_summary_and_detail_projections():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_url = f"sqlite:///{Path(tmpdir) / 'index.sqlite3'}"
        repository = IndexRepository(db_url)
        event = make_event()
        repository.upsert_event_batch([event])

        summaries = repository.list_entry_summaries()
        detail = repository.get_entry_detail(event.entry_id)

        assert len(summaries) == 1
        assert summaries[0].entry_id == event.entry_id
        assert detail is not None
        assert detail.entry_id == event.entry_id
        assert detail.messages is not None
        assert len(detail.messages) == 2


def test_repository_indexes_message_bodies_for_search():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_url = f"sqlite:///{Path(tmpdir) / 'index.sqlite3'}"
        repository = IndexRepository(db_url)
        event = make_event()

        repository.upsert_event_batch([event])
        search_results, total = repository.search_entries("idempotent upsert")

        assert total == 1
        assert len(search_results) == 1
        assert search_results[0].entry_id == event.entry_id
        assert any("idempotent" in highlight.lower() for highlight in search_results[0].highlights)


def test_repository_supports_cursor_pagination_and_search():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_url = f"sqlite:///{Path(tmpdir) / 'index.sqlite3'}"
        repository = IndexRepository(db_url)
        event = make_event()
        newer_event = make_event()
        newer_event.entry = newer_event.entry.model_copy(
            update={
                "id": "claude_code:claude_code:entry-2",
                "title": "Repository search coverage",
                "timestamp": datetime(2026, 3, 6, 0, 5, tzinfo=timezone.utc),
                "origin_primary_key": "project/session-2.jsonl",
                "origin_payload_ref": "/tmp/session-2.jsonl",
                "content": "Search the indexed repository for auth middleware coverage.",
            }
        )
        newer_event.entry_id = newer_event.entry.entry_id
        newer_event.occurred_at = newer_event.entry.timestamp
        newer_event.origin_primary_key = newer_event.entry.origin_primary_key
        newer_event.origin_payload_ref = newer_event.entry.origin_payload_ref

        repository.upsert_event_batch([event, newer_event])

        first_page, next_cursor = repository.list_entry_page(limit=1)
        second_page, _ = repository.list_entry_page(limit=1, cursor=next_cursor)
        search_results, total = repository.search_entries("auth middleware")

        assert len(first_page) == 1
        assert next_cursor is not None
        assert len(second_page) == 1
        assert first_page[0].entry_id != second_page[0].entry_id
        assert total == 1
        assert search_results[0].highlights
