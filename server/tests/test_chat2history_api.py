from __future__ import annotations

import tempfile
from datetime import datetime, timezone
from pathlib import Path

import pytest

from cchistory.connectors import NormalizedEvent
from cchistory.db import IndexRepository
from cchistory.models import Chat2HistoryQuery, HistoryEntry, Message, MessageRole
from cchistory.routers.chat2history import query_chat2history


def make_event(entry_id: str, title: str, content: str) -> NormalizedEvent:
    entry = HistoryEntry(
        id=entry_id,
        source="Claude Code",
        source_id="claude_code",
        type="conversation",
        title=title,
        timestamp=datetime(2026, 3, 6, tzinfo=timezone.utc),
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
def repository_with_search_data():
    with tempfile.TemporaryDirectory() as tmpdir:
        repository = IndexRepository(f"sqlite:///{Path(tmpdir) / 'index.sqlite3'}")
        repository.upsert_event_batch(
            [
                make_event(
                    "claude_code:claude_code:entry-1",
                    "Debug the auth cookie parser",
                    "Investigate the auth cookie parser and the redirect middleware sequence.",
                ),
                make_event(
                    "claude_code:claude_code:entry-2",
                    "Refactor sidebar filters",
                    "The sidebar filters should read from the indexed search API.",
                ),
            ]
        )
        yield repository


@pytest.mark.asyncio
async def test_chat2history_returns_ranked_context(repository_with_search_data):
    response = await query_chat2history(
        payload=Chat2HistoryQuery(query="auth cookie parser", top_k=1, token_budget=512),
        repository=repository_with_search_data,
    )

    assert len(response.items) == 1
    assert response.items[0].entry_id == "claude_code:claude_code:entry-1"
    assert response.items[0].citation.entry_id == response.items[0].entry_id
    assert response.used_tokens <= response.token_budget


@pytest.mark.asyncio
async def test_chat2history_respects_token_budget(repository_with_search_data):
    response = await query_chat2history(
        payload=Chat2HistoryQuery(
            query="indexed search api",
            top_k=2,
            token_budget=128,
        ),
        repository=repository_with_search_data,
    )

    assert response.used_tokens <= 128
    assert len(response.items) >= 1
