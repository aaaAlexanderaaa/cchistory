from __future__ import annotations

from datetime import datetime, timezone

from cchistory.models import HistoryEntry
from cchistory.main import app
from cchistory.schema import build_core_json_schemas


def test_core_schema_catalog_includes_examples_for_core_entities():
    catalog = build_core_json_schemas()

    for name in (
        "Message",
        "HistoryEntrySummary",
        "HistoryEntryDetail",
        "Artifact",
        "Chunk",
        "DistillArtifact",
        "SourceInfo",
    ):
        assert name in catalog
        assert "example" in catalog[name]


def test_history_entry_identity_fields_are_stable():
    entry = HistoryEntry(
        id="claude_code:claude_code:abc123",
        source="Claude Code",
        source_id="claude_code",
        type="conversation",
        title="Identity smoke test",
        timestamp=datetime(2026, 3, 6, tzinfo=timezone.utc),
        origin_primary_key="acme/project/session.jsonl",
        origin_payload_ref="/tmp/session.jsonl",
    )

    assert entry.entry_id == entry.id
    assert entry.source_id == "claude_code"
    assert entry.origin_primary_key.endswith(".jsonl")


def test_openapi_schema_includes_examples_for_live_contract_models():
    openapi = app.openapi()
    schemas = openapi["components"]["schemas"]

    assert "HistoryEntry" in schemas
    assert "SourceInfo" in schemas
    assert "IngestRunRequest" in schemas
    assert "IngestRunResponse" in schemas
    assert "Chat2HistoryQuery" in schemas
    assert "Chat2HistoryResponse" in schemas
    assert "DistillSessionRequest" in schemas
    assert "DistillArtifact" in schemas
    assert "example" in schemas["HistoryEntry"]
    assert "example" in schemas["SourceInfo"]
    assert "example" in schemas["IngestRunRequest"]
    assert "example" in schemas["IngestRunResponse"]
    assert "example" in schemas["Chat2HistoryQuery"]
    assert "example" in schemas["Chat2HistoryResponse"]
    assert "example" in schemas["DistillSessionRequest"]
    assert "example" in schemas["DistillArtifact"]
