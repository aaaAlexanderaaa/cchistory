from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import List

MIGRATIONS_DIR = Path(__file__).with_name("migrations")


def sqlite_path_from_url(database_url: str) -> Path:
    prefix = "sqlite:///"
    if not database_url.startswith(prefix):
        raise ValueError("Only sqlite:/// URLs are supported by the current index bootstrap")
    return Path(database_url[len(prefix) :])


def apply_migrations(database_url: str) -> List[str]:
    db_path = sqlite_path_from_url(database_url)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    applied_versions: List[str] = []
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        cursor = conn.execute("SELECT version FROM schema_migrations")
        existing_versions = {row[0] for row in cursor.fetchall()}

        for migration_file in sorted(MIGRATIONS_DIR.glob("*.sql")):
            version = migration_file.stem.split("_", 1)[0]
            if version in existing_versions:
                continue
            conn.executescript(migration_file.read_text(encoding="utf-8"))
            conn.execute(
                "INSERT INTO schema_migrations (version) VALUES (?)",
                (version,),
            )
            applied_versions.append(version)

        conn.commit()
        return applied_versions
    finally:
        conn.close()
