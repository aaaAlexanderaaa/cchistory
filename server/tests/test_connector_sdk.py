from __future__ import annotations

from datetime import datetime, timezone

import pytest

from cchistory.config import SourceConfig
from cchistory.connectors.config import SourceInstanceConfig, validate_source_config
from cchistory.connectors.models import (
    HealthState,
    HealthStatus,
    NormalizedEvent,
    RawRecord,
    ScanBatch,
    SourceHandle,
)
from cchistory.models import HistoryEntry


def test_validate_source_config_builds_validated_instance():
    validated = validate_source_config(
        SourceConfig(type="claude_code", name="Claude Code", params={"base_dir": "/tmp"})
    )

    assert validated == SourceInstanceConfig(
        source_id="claude_code",
        connector_type="claude_code",
        name="Claude Code",
        enabled=True,
        params={"base_dir": "/tmp"},
        secrets={},
    )


def test_source_instance_config_rejects_invalid_ids():
    with pytest.raises(ValueError):
        SourceInstanceConfig(source_id="Claude Code", connector_type="claude_code", name="Claude")


def test_connector_contract_models_are_typed():
    entry = HistoryEntry(
        id="claude_code:claude_code:abc123",
        source="Claude Code",
        source_id="claude_code",
        type="conversation",
        title="Fix auth loop",
        timestamp=datetime(2026, 3, 6, tzinfo=timezone.utc),
        origin_primary_key="acme/project/session.jsonl",
        origin_payload_ref="/tmp/session.jsonl",
    )
    source = SourceHandle(source_id="claude_code", connector_type="claude_code", name="Claude Code")
    health = HealthStatus(
        source_id="claude_code",
        connector_type="claude_code",
        status=HealthState.OK,
        checked_at=datetime(2026, 3, 6, tzinfo=timezone.utc),
    )
    record = RawRecord(
        source_id="claude_code",
        connector_type="claude_code",
        origin_primary_key=entry.origin_primary_key,
        origin_payload_ref=entry.origin_payload_ref,
        payload={"path": entry.origin_payload_ref},
    )
    event = NormalizedEvent(
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
    batch = ScanBatch(events=[event], next_cursor="cursor-2", has_more=False, scanned_count=1)

    assert source.source_id == "claude_code"
    assert health.status == HealthState.OK
    assert record.payload["path"] == "/tmp/session.jsonl"
    assert batch.events[0].entry_id == entry.entry_id
