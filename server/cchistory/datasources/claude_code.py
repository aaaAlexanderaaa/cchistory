from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from cchistory.datasources.base import DataSource
from cchistory.models import (
    EntryType,
    HistoryEntry,
    Message,
    MessageRole,
    SearchQuery,
)

logger = logging.getLogger(__name__)

ROLE_MAP = {
    "human": MessageRole.USER,
    "user": MessageRole.USER,
    "assistant": MessageRole.ASSISTANT,
    "system": MessageRole.SYSTEM,
    "tool": MessageRole.TOOL,
}


class ClaudeCodeSource(DataSource):
    """Reads Claude Code conversation history from ~/.claude/projects/ JSONL files."""

    name = "claude_code"
    source_type = "local_file"

    def __init__(self) -> None:
        self._base_dir: Optional[Path] = None
        self._cache: Dict[str, HistoryEntry] = {}
        self._cache_valid = False

    async def connect(self, params: Dict[str, Any]) -> None:
        base_dir = params.get("base_dir", str(Path.home() / ".claude" / "projects"))
        self._base_dir = Path(base_dir)
        if not self._base_dir.exists():
            logger.warning(f"Claude Code directory not found: {self._base_dir}")

    async def disconnect(self) -> None:
        self._cache.clear()
        self._cache_valid = False

    async def _ensure_cache(self) -> None:
        if self._cache_valid:
            return
        self._cache.clear()
        if self._base_dir is None or not self._base_dir.exists():
            self._cache_valid = True
            return

        for jsonl_file in self._base_dir.rglob("*.jsonl"):
            try:
                entry = await self._parse_session(jsonl_file)
                if entry:
                    self._cache[entry.id] = entry
            except Exception as e:
                logger.debug(f"Failed to parse {jsonl_file}: {e}")
                continue

        self._cache_valid = True

    async def _parse_session(self, path: Path) -> Optional[HistoryEntry]:
        messages: List[Message] = []
        first_ts: Optional[datetime] = None
        last_ts: Optional[datetime] = None
        title = ""

        rel = path.relative_to(self._base_dir)
        parts = list(rel.parts)
        project = "/".join(parts[:-1]) if len(parts) > 1 else "unknown"
        session_id = path.stem

        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue

                msg = self._parse_record(record)
                if msg is None:
                    continue

                messages.append(msg)

                if msg.timestamp:
                    if first_ts is None or msg.timestamp < first_ts:
                        first_ts = msg.timestamp
                    if last_ts is None or msg.timestamp > last_ts:
                        last_ts = msg.timestamp

                if not title and msg.role == MessageRole.USER and msg.content:
                    title = msg.content[:120].replace("\n", " ")

        if not messages:
            return None

        if first_ts is None:
            first_ts = datetime.now(timezone.utc)

        duration = None
        if first_ts and last_ts:
            duration = int((last_ts - first_ts).total_seconds())

        stable_id = hashlib.sha256(f"claude_code:{path}".encode()).hexdigest()[:16]

        return HistoryEntry(
            id=f"cc-{stable_id}",
            source="Claude Code",
            source_id=session_id,
            type=EntryType.CONVERSATION,
            title=title or f"Session {session_id[:8]}",
            project=project,
            timestamp=first_ts,
            end_timestamp=last_ts,
            duration_seconds=duration,
            content=self._build_summary(messages),
            messages=messages,
            metadata={
                "file_path": str(path),
                "message_count": len(messages),
            },
            tags=["claude-code", "coding-agent"],
        )

    def _parse_record(self, record: Dict[str, Any]) -> Optional[Message]:
        rec_type = record.get("type")

        if rec_type in ("human", "user"):
            content = self._extract_content(record)
            ts = self._extract_timestamp(record)
            return Message(role=MessageRole.USER, content=content, timestamp=ts)

        if rec_type == "assistant":
            content = self._extract_content(record)
            ts = self._extract_timestamp(record)
            return Message(role=MessageRole.ASSISTANT, content=content, timestamp=ts)

        role_str = record.get("role", "")
        if role_str in ROLE_MAP:
            content = self._extract_content(record)
            ts = self._extract_timestamp(record)
            tool_name = None
            if role_str == "tool":
                tool_name = record.get("name") or record.get("tool_name")
            return Message(
                role=ROLE_MAP[role_str],
                content=content,
                timestamp=ts,
                tool_name=tool_name,
            )

        msg = record.get("message")
        if isinstance(msg, dict):
            role_str = msg.get("role", "")
            if role_str in ROLE_MAP:
                content = self._extract_content(msg)
                ts = self._extract_timestamp(record)
                return Message(role=ROLE_MAP[role_str], content=content, timestamp=ts)

        return None

    def _extract_content(self, record: Dict[str, Any]) -> str:
        content = record.get("content", "")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, str):
                    parts.append(item)
                elif isinstance(item, dict):
                    text = item.get("text", "")
                    if text:
                        parts.append(text)
            return "\n".join(parts)
        return str(content) if content else ""

    def _extract_timestamp(self, record: Dict[str, Any]) -> Optional[datetime]:
        for key in ("timestamp", "createdAt", "created_at", "ts"):
            val = record.get(key)
            if val is None:
                continue
            if isinstance(val, (int, float)):
                if val > 1e12:
                    val = val / 1000
                return datetime.fromtimestamp(val, tz=timezone.utc)
            if isinstance(val, str):
                try:
                    return datetime.fromisoformat(val.replace("Z", "+00:00"))
                except ValueError:
                    continue
        return None

    def _build_summary(self, messages: List[Message]) -> str:
        user_msgs = [m for m in messages if m.role == MessageRole.USER and m.content]
        if not user_msgs:
            return ""
        first = user_msgs[0].content[:200]
        return f"[{len(messages)} messages] {first}"

    async def list_entries(
        self,
        limit: int = 50,
        offset: int = 0,
        project: Optional[str] = None,
    ) -> List[HistoryEntry]:
        await self._ensure_cache()
        entries = list(self._cache.values())
        if project:
            entries = [e for e in entries if e.project and project in e.project]
        entries.sort(key=lambda e: e.timestamp, reverse=True)
        return entries[offset : offset + limit]

    async def get_entry(self, entry_id: str) -> Optional[HistoryEntry]:
        await self._ensure_cache()
        return self._cache.get(entry_id)

    async def search(self, query: SearchQuery) -> List[HistoryEntry]:
        await self._ensure_cache()
        q = query.query.lower()
        results = []
        for entry in self._cache.values():
            if query.project and entry.project and query.project not in entry.project:
                continue
            if query.date_from and entry.timestamp < query.date_from:
                continue
            if query.date_to and entry.timestamp > query.date_to:
                continue

            if self._matches(entry, q):
                results.append(entry)

        results.sort(key=lambda e: e.timestamp, reverse=True)
        return results[: query.limit]

    def _matches(self, entry: HistoryEntry, query: str) -> bool:
        if query in (entry.title or "").lower():
            return True
        if query in (entry.content or "").lower():
            return True
        if query in (entry.project or "").lower():
            return True
        if entry.messages:
            for msg in entry.messages:
                if query in msg.content.lower():
                    return True
        return False

    async def count(self) -> int:
        await self._ensure_cache()
        return len(self._cache)

    async def list_projects(self) -> List[str]:
        await self._ensure_cache()
        projects = set()
        for entry in self._cache.values():
            if entry.project:
                projects.add(entry.project)
        return sorted(projects)
