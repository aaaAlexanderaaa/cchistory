from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List


@dataclass
class SourceConfig:
    type: str
    name: str
    id: str | None = None
    enabled: bool = True
    params: Dict[str, Any] = field(default_factory=dict)


@dataclass
class AppConfig:
    host: str = "0.0.0.0"
    port: int = 8765
    cors_origins: List[str] = field(default_factory=lambda: ["http://localhost:5173"])
    sync_interval_seconds: int | None = field(
        default_factory=lambda: _optional_positive_int(os.getenv("CCHISTORY_SYNC_INTERVAL_SECONDS"))
    )
    database_url: str = field(default_factory=lambda: os.getenv("CCHISTORY_DB_URL", _default_database_url()))
    sources: List[SourceConfig] = field(default_factory=list)

    @classmethod
    def default(cls) -> "AppConfig":
        sources: List[SourceConfig] = []

        claude_dir = Path.home() / ".claude" / "projects"
        if claude_dir.exists():
            sources.append(
                SourceConfig(
                    type="claude_code",
                    name="Claude Code",
                    params={"base_dir": str(claude_dir)},
                )
            )

        for browser_name, profile_subdir in [
            ("brave", _brave_history_path()),
            ("chrome", _chrome_history_path()),
        ]:
            if profile_subdir and Path(profile_subdir).exists():
                sources.append(
                    SourceConfig(
                        type="brave" if browser_name == "brave" else "chrome",
                        name=browser_name.title(),
                        params={"history_db": profile_subdir},
                    )
                )

        return cls(sources=sources)


def _brave_history_path() -> str:
    home = Path.home()
    candidates = [
        home / ".config/BraveSoftware/Brave-Browser/Default/History",
        home / "Library/Application Support/BraveSoftware/Brave-Browser/Default/History",
        home / "AppData/Local/BraveSoftware/Brave-Browser/User Data/Default/History",
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    return ""


def _chrome_history_path() -> str:
    home = Path.home()
    candidates = [
        home / ".config/google-chrome/Default/History",
        home / "Library/Application Support/Google/Chrome/Default/History",
        home / "AppData/Local/Google/Chrome/User Data/Default/History",
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    return ""


def _default_database_url() -> str:
    db_path = Path.home() / ".cchistory" / "index.sqlite3"
    return f"sqlite:///{db_path}"


def _optional_positive_int(value: str | None) -> int | None:
    if value is None or not value.strip():
        return None
    parsed = int(value)
    return parsed if parsed > 0 else None
