from __future__ import annotations

import sqlite3
import tempfile
from pathlib import Path

import pytest

from cchistory.datasources.brave import BraveSource
from cchistory.models import SearchQuery


def chrome_ts(unix_seconds: int) -> int:
    return int((unix_seconds + 11644473600) * 1_000_000)


@pytest.fixture
def brave_history_db():
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
            "INSERT INTO urls (id, url, title, visit_count, typed_count) VALUES (?, ?, ?, ?, ?)",
            (2, "https://example.com/docs", "Docs", 2, 0),
        )
        conn.execute(
            "INSERT INTO visits (id, url, visit_time, visit_duration) VALUES (?, ?, ?, ?)",
            (10, 1, chrome_ts(1700000100), 4_000_000),
        )
        conn.execute(
            "INSERT INTO visits (id, url, visit_time, visit_duration) VALUES (?, ?, ?, ?)",
            (11, 2, chrome_ts(1700000200), 0),
        )
        conn.commit()
        conn.close()

        yield str(db_path)


@pytest.mark.asyncio
async def test_brave_list_entries_round_trip(brave_history_db):
    source = BraveSource()
    await source.connect(
        {
            "history_db": brave_history_db,
            "source_name": "Brave Personal",
            "source_id": "brave_personal",
        }
    )

    entries = await source.list_entries()
    assert len(entries) == 2
    assert entries[0].source == "Brave Personal"
    assert entries[0].source_id == "brave_personal"
    assert entries[0].entry_id == entries[0].id
    assert entries[0].origin_primary_key == "11"
    assert entries[0].origin_payload_ref == "https://example.com/docs"

    round_trip = await source.get_entry(entries[0].id)
    assert round_trip is not None
    assert round_trip.id == entries[0].id
    assert round_trip.origin_primary_key == entries[0].origin_primary_key

    await source.disconnect()


@pytest.mark.asyncio
async def test_brave_search(brave_history_db):
    source = BraveSource()
    await source.connect({"history_db": brave_history_db})

    results = await source.search(SearchQuery(query="login"))
    assert len(results) == 1
    assert results[0].title == "Login Flow"

    await source.disconnect()


@pytest.mark.asyncio
async def test_brave_handles_open_connection_and_edge_timestamps(brave_history_db):
    hold_conn = sqlite3.connect(brave_history_db)
    hold_conn.execute("BEGIN IMMEDIATE")
    hold_conn.execute(
        "INSERT INTO urls (id, url, title, visit_count, typed_count) VALUES (?, ?, ?, ?, ?)",
        (3, "https://example.com/weird", "Weird", 1, 0),
    )
    hold_conn.execute(
        "INSERT INTO visits (id, url, visit_time, visit_duration) VALUES (?, ?, ?, ?)",
        (12, 3, 999999999999999999, 0),
    )
    hold_conn.commit()

    source = BraveSource()
    await source.connect({"history_db": brave_history_db})

    entries = await source.list_entries(limit=3)
    results = await source.search(SearchQuery(query="weird"))

    assert len(entries) == 3
    assert results[0].title == "Weird"
    assert entries[0].timestamp.tzinfo is not None

    await source.disconnect()
    hold_conn.close()
