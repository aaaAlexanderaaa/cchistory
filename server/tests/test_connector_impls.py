from __future__ import annotations

import json
import sqlite3
import tempfile
from pathlib import Path

import pytest

from cchistory.config import SourceConfig
from cchistory.connectors import BraveConnector, ClaudeCodeConnector, validate_source_config
from tests.connector_conformance import assert_connector_conformance


def chrome_ts(unix_seconds: int) -> int:
    return int((unix_seconds + 11644473600) * 1_000_000)


@pytest.fixture
def claude_source_config():
    with tempfile.TemporaryDirectory() as tmpdir:
        project_dir = Path(tmpdir) / "project-a"
        project_dir.mkdir(parents=True)
        session_path = project_dir / "session1.jsonl"
        with open(session_path, "w", encoding="utf-8") as f:
            f.write(
                json.dumps(
                    {"type": "human", "content": "Trace auth cookie", "timestamp": 1700000000}
                )
                + "\n"
            )
            f.write(
                json.dumps(
                    {
                        "type": "assistant",
                        "content": "I found the parser bug.",
                        "timestamp": 1700000010,
                    }
                )
                + "\n"
            )

        yield validate_source_config(
            SourceConfig(type="claude_code", name="Claude Code", params={"base_dir": tmpdir})
        )


@pytest.fixture
def brave_source_config():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "History"
        conn = sqlite3.connect(db_path)
        conn.executescript(
            """
            CREATE TABLE urls (
                id INTEGER PRIMARY KEY,
                url TEXT NOT NULL,
                title TEXT,
                visit_count INTEGER DEFAULT 0,
                typed_count INTEGER DEFAULT 0
            );
            CREATE TABLE visits (
                id INTEGER PRIMARY KEY,
                url INTEGER NOT NULL,
                visit_time INTEGER NOT NULL,
                visit_duration INTEGER DEFAULT 0
            );
            """
        )
        conn.execute(
            "INSERT INTO urls (id, url, title, visit_count, typed_count) VALUES (?, ?, ?, ?, ?)",
            (1, "https://example.com/login", "Login Flow", 5, 1),
        )
        conn.execute(
            "INSERT INTO visits (id, url, visit_time, visit_duration) VALUES (?, ?, ?, ?)",
            (10, 1, chrome_ts(1700000100), 4_000_000),
        )
        conn.commit()
        conn.close()

        yield validate_source_config(
            SourceConfig(type="brave", name="Brave", params={"history_db": str(db_path)})
        )


@pytest.mark.asyncio
async def test_claude_connector_scan_and_fetch(claude_source_config):
    connector = ClaudeCodeConnector(claude_source_config)

    _handle, health, batch, record = await assert_connector_conformance(connector)

    assert health.status.value == "ok"
    assert batch.scanned_count == 1
    assert batch.events[0].entry.source_id == "claude_code"
    assert record.origin_primary_key.endswith(".jsonl")
    assert len(record.payload["records"]) == 2


@pytest.mark.asyncio
async def test_brave_connector_scan_and_fetch(brave_source_config):
    connector = BraveConnector(brave_source_config)

    _handle, health, batch, record = await assert_connector_conformance(connector)

    assert health.status.value == "ok"
    assert batch.scanned_count == 1
    assert batch.events[0].entry.origin_primary_key == "10"
    assert record.origin_primary_key == "10"
    assert record.payload["url"] == "https://example.com/login"
