from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import List

from cchistory.connectors.base import Connector
from cchistory.connectors.config import SourceInstanceConfig
from cchistory.connectors.models import (
    HealthState,
    HealthStatus,
    NormalizedEvent,
    RawRecord,
    ScanBatch,
    SourceHandle,
)
from cchistory.datasources.claude_code import ClaudeCodeSource


class ClaudeCodeConnector(Connector):
    connector_type = "claude_code"

    def __init__(self, config: SourceInstanceConfig) -> None:
        self.config = config

    def _base_dir(self) -> Path:
        return Path(self.config.params.get("base_dir", str(Path.home() / ".claude" / "projects")))

    def _handle(self) -> SourceHandle:
        return SourceHandle(
            source_id=self.config.source_id,
            connector_type=self.connector_type,
            name=self.config.name,
            metadata={"base_dir": str(self._base_dir())},
        )

    async def discover(self) -> List[SourceHandle]:
        if self._base_dir().exists():
            return [self._handle()]
        return []

    async def health(self, source: SourceHandle) -> HealthStatus:
        base_dir = self._base_dir()
        latest_mtime = None
        if base_dir.exists():
            candidates = [path.stat().st_mtime for path in base_dir.rglob("*.jsonl")]
            if candidates:
                latest_mtime = max(candidates)

        lag_seconds = None
        if latest_mtime is not None:
            lag_seconds = int(datetime.now(timezone.utc).timestamp() - latest_mtime)

        status = HealthState.OK if base_dir.exists() else HealthState.ERROR
        return HealthStatus(
            source_id=source.source_id,
            connector_type=source.connector_type,
            status=status,
            checked_at=datetime.now(timezone.utc),
            last_success_at=(
                datetime.fromtimestamp(latest_mtime, tz=timezone.utc) if latest_mtime else None
            ),
            lag_seconds=lag_seconds,
            message=None if base_dir.exists() else f"Claude Code directory not found: {base_dir}",
            metadata={"base_dir": str(base_dir)},
        )

    async def scan_since(self, source: SourceHandle, cursor: str | None) -> ScanBatch:
        cutoff = float(cursor) if cursor is not None else None
        reader = ClaudeCodeSource()
        await reader.connect(
            {
                "base_dir": str(self._base_dir()),
                "source_name": self.config.name,
                "source_id": self.config.source_id,
            }
        )

        events: List[NormalizedEvent] = []
        next_cursor_value = cutoff

        try:
            for path, subagent_files in reader._iter_session_groups():
                group_paths = [path, *subagent_files]
                mtime = max(group_path.stat().st_mtime for group_path in group_paths)
                if cutoff is not None and mtime <= cutoff:
                    continue
                entry = await reader._parse_session(path, subagent_files)
                if entry is None:
                    continue
                events.append(
                    NormalizedEvent(
                        event_id=f"{source.source_id}:{entry.entry_id}",
                        source_id=source.source_id,
                        connector_type=source.connector_type,
                        entry_id=entry.entry_id,
                        entry_type=entry.type,
                        occurred_at=entry.timestamp,
                        origin_primary_key=entry.origin_primary_key,
                        origin_payload_ref=entry.origin_payload_ref,
                        entry=entry,
                    )
                )
                if next_cursor_value is None or mtime > next_cursor_value:
                    next_cursor_value = mtime
        finally:
            await reader.disconnect()

        return ScanBatch(
            events=events,
            next_cursor=(
                f"{next_cursor_value:.6f}" if next_cursor_value is not None else cursor
            ),
            has_more=False,
            scanned_count=len(events),
        )

    async def fetch(self, source: SourceHandle, origin_primary_key: str) -> RawRecord:
        path = self._base_dir() / origin_primary_key
        raw_lines = []
        if path.exists():
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    stripped = line.strip()
                    if stripped:
                        raw_lines.append(json.loads(stripped))

        return RawRecord(
            source_id=source.source_id,
            connector_type=source.connector_type,
            origin_primary_key=origin_primary_key,
            origin_payload_ref=str(path),
            payload={"records": raw_lines},
        )
