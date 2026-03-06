from __future__ import annotations

import sqlite3
import tempfile
from pathlib import Path

import pytest

from cchistory.config import AppConfig
from cchistory.db import apply_migrations, sqlite_path_from_url


def test_app_config_uses_sqlite_index_by_default():
    config = AppConfig.default()

    assert config.database_url.startswith("sqlite:///")
    assert config.database_url.endswith("index.sqlite3")


def test_sqlite_path_from_url_rejects_non_sqlite_urls():
    with pytest.raises(ValueError):
        sqlite_path_from_url("postgresql://localhost/cchistory")


def test_apply_migrations_bootstraps_core_tables():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_url = f"sqlite:///{Path(tmpdir) / 'index.sqlite3'}"
        applied = apply_migrations(db_url)

        assert applied == ["0001", "0002"]

        conn = sqlite3.connect(sqlite_path_from_url(db_url))
        try:
            tables = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
        finally:
            conn.close()

        assert {
            "schema_migrations",
            "sources",
            "entries",
            "messages",
            "entry_chunks",
            "entry_fts",
            "distill_artifacts",
            "connector_state",
            "ingest_runs",
        }.issubset(tables)
