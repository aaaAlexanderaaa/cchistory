from __future__ import annotations

import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from cchistory.connectors import NormalizedEvent
from cchistory.db import IndexRepository
from cchistory.models import DistillSessionRequest, HistoryEntry, Message, MessageRole
from cchistory.routers.distill import create_session_distill


def make_event(entry_id: str, title: str, content: str, timestamp: datetime) -> NormalizedEvent:
    entry = HistoryEntry(
        id=entry_id,
        source="Claude Code",
        source_id="claude_code",
        type="conversation",
        title=title,
        timestamp=timestamp,
        origin_primary_key=f"project/{entry_id}.jsonl",
        origin_payload_ref=f"/tmp/{entry_id}.jsonl",
        project="acme/dashboard",
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
def repository_with_distill_data():
    with tempfile.TemporaryDirectory() as tmpdir:
        repository = IndexRepository(f"sqlite:///{Path(tmpdir) / 'index.sqlite3'}")
        base_ts = datetime(2026, 3, 6, 8, 0, tzinfo=timezone.utc)
        repository.upsert_event_batch(
            [
                make_event(
                    "claude_code:claude_code:entry-1",
                    "Auth cookie follow-up",
                    (
                        "Use the indexed entries API as the primary read path.\n"
                        "Do we need to keep the legacy history wrapper after parity validation?"
                    ),
                    base_ts,
                ),
                make_event(
                    "claude_code:claude_code:entry-2",
                    "Dashboard middleware review",
                    (
                        "Need to revisit auth middleware TODO.\n"
                        "Added search snippets to the indexed search API."
                    ),
                    base_ts + timedelta(minutes=5),
                ),
            ]
        )
        yield repository


@pytest.mark.asyncio
async def test_distill_session_creates_idempotent_artifact(repository_with_distill_data):
    request = DistillSessionRequest(project="acme/dashboard", limit=10)

    first = await create_session_distill(request, repository=repository_with_distill_data)
    second = await create_session_distill(request, repository=repository_with_distill_data)

    assert first.artifact_id == second.artifact_id
    assert repository_with_distill_data.count_rows("distill_artifacts") == 1
    assert first.provenance_entry_ids
    assert first.patterns
    assert first.decisions
    assert first.open_questions


@pytest.mark.asyncio
async def test_distill_session_writes_tags_back_to_entries(repository_with_distill_data):
    artifact = await create_session_distill(
        DistillSessionRequest(project="acme/dashboard", limit=10),
        repository=repository_with_distill_data,
    )

    detail = repository_with_distill_data.get_entry_detail(artifact.provenance_entry_ids[0])

    assert detail is not None
    assert set(artifact.tags).issubset(set(detail.tags))
