from __future__ import annotations

from cchistory.models import HistoryEntry, HistoryEntrySummary
from cchistory.schema import (
    CANONICAL_SCHEMA_SERIES,
    CANONICAL_SCHEMA_VERSION,
    is_schema_version_compatible,
)


def test_history_entry_uses_current_schema_version():
    entry = HistoryEntry(
        id="test-entry",
        source="Test Source",
        source_id="raw-1",
        type="conversation",
        title="Schema version smoke test",
        timestamp="2026-03-06T00:00:00+00:00",
        origin_primary_key="project/session.jsonl",
    )

    assert entry.schema_version == CANONICAL_SCHEMA_VERSION


def test_schema_compatibility_accepts_current_series():
    assert is_schema_version_compatible(CANONICAL_SCHEMA_VERSION)
    assert is_schema_version_compatible(CANONICAL_SCHEMA_SERIES)
    assert is_schema_version_compatible(f"{CANONICAL_SCHEMA_SERIES}.5")


def test_schema_compatibility_rejects_other_series():
    assert not is_schema_version_compatible("0.1.9")
    assert not is_schema_version_compatible("0.3.0")


def test_history_entry_projects_to_summary():
    entry = HistoryEntry(
        id="test-entry",
        source="Test Source",
        source_id="raw-1",
        type="conversation",
        title="Projection smoke test",
        timestamp="2026-03-06T00:00:00+00:00",
        content="This is a detailed entry payload used for summary projection.",
        origin_primary_key="project/session.jsonl",
        tags=["coding-agent"],
    )

    summary = entry.to_summary(score=0.75)

    assert isinstance(summary, HistoryEntrySummary)
    assert summary.schema_version == CANONICAL_SCHEMA_VERSION
    assert summary.score == 0.75
    assert summary.snippet == entry.content
