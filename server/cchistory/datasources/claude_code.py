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

AION_ASSISTANT_RULES_MARKER = "[Assistant Rules - You MUST follow these instructions]"
USER_REQUEST_MARKER = "[User Request]"
CONTINUATION_SUMMARY_PREFIX = (
    "This session is being continued from a previous conversation that ran out of context."
)
INTERRUPTION_MARKERS = {
    "[Request interrupted by user]": "user_interrupted",
    "[Request interrupted by user for tool use]": "user_interrupted_for_tool_use",
}


class ClaudeCodeSource(DataSource):
    """Reads Claude Code conversation history from ~/.claude/projects/ JSONL files."""

    name = "claude_code"
    source_type = "local_file"

    def __init__(self) -> None:
        self._base_dir: Optional[Path] = None
        self._cache: Dict[str, HistoryEntry] = {}
        self._cache_valid = False
        self._source_name = "Claude Code"
        self._source_id = "claude_code"

    async def connect(self, params: Dict[str, Any]) -> None:
        base_dir = params.get("base_dir", str(Path.home() / ".claude" / "projects"))
        self._base_dir = Path(base_dir)
        self._source_name = params.get("source_name", self._source_name)
        self._source_id = params.get("source_id", self._source_id)
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

        for jsonl_file, subagent_files in self._iter_session_groups():
            try:
                entry = await self._parse_session(jsonl_file, subagent_files)
                if entry:
                    self._cache[entry.id] = entry
            except Exception as e:
                logger.debug(f"Failed to parse {jsonl_file}: {e}")
                continue

        self._cache_valid = True

    def _iter_session_groups(self) -> List[tuple[Path, List[Path]]]:
        session_groups: List[tuple[Path, List[Path]]] = []
        orphan_subagents: List[Path] = []

        for jsonl_file in sorted(self._base_dir.rglob("*.jsonl")):
            if "subagents" in jsonl_file.parts:
                parent_file = jsonl_file.parents[1].with_suffix(".jsonl")
                if parent_file.exists():
                    continue
                orphan_subagents.append(jsonl_file)
                continue

            subagents_dir = jsonl_file.with_suffix("") / "subagents"
            subagent_files = sorted(subagents_dir.glob("*.jsonl")) if subagents_dir.exists() else []
            session_groups.append((jsonl_file, subagent_files))

        session_groups.extend((orphan, []) for orphan in orphan_subagents)
        return session_groups

    async def _parse_session(self, path: Path, subagent_files: List[Path]) -> Optional[HistoryEntry]:
        raw_messages: List[Message] = []
        first_ts: Optional[datetime] = None
        last_ts: Optional[datetime] = None
        title = ""

        rel = path.relative_to(self._base_dir)
        parts = list(rel.parts)
        project = "/".join(parts[:-1]) if len(parts) > 1 else "unknown"
        session_id = path.stem

        order = 0
        raw_messages.extend(
            self._parse_session_file(path, source_kind="primary", order_start=order)
        )
        order += len(raw_messages)

        for subagent_file in subagent_files:
            parsed_subagent = self._parse_session_file(
                subagent_file,
                source_kind="subagent",
                order_start=order,
                subagent_id=subagent_file.stem,
            )
            raw_messages.extend(parsed_subagent)
            order += len(parsed_subagent)

        raw_messages.sort(
            key=lambda message: (
                message.timestamp or datetime.min.replace(tzinfo=timezone.utc),
                int(message.metadata.get("event_order", 0)),
            )
        )

        messages = self._consolidate_messages(raw_messages)
        if not messages:
            return None

        termination_reason = self._derive_termination_reason(raw_messages)
        prompt_injection_count = sum(
            1 for msg in messages if msg.metadata.get("block_type") == "prompt_injection"
        )
        compaction_count = sum(
            1
            for msg in messages
            if msg.metadata.get("block_type") in {"continuation_summary", "system_event"}
            and (
                msg.metadata.get("system_subtype") == "compact_boundary"
                or msg.metadata.get("termination_reason") == "context_compacted"
            )
        )

        for msg in messages:
            if msg.timestamp:
                if first_ts is None or msg.timestamp < first_ts:
                    first_ts = msg.timestamp
                if last_ts is None or msg.timestamp > last_ts:
                    last_ts = msg.timestamp

            if not title and msg.role == MessageRole.USER and msg.content:
                title = msg.content[:120].replace("\n", " ")

        if first_ts is None:
            first_ts = datetime.now(timezone.utc)

        duration = None
        if first_ts and last_ts:
            duration = int((last_ts - first_ts).total_seconds())

        stable_id = hashlib.sha256(
            f"{self._source_id}:{rel.as_posix()}".encode()
        ).hexdigest()[:16]

        return HistoryEntry(
            id=f"{self._source_id}:{stable_id}",
            source=self._source_name,
            source_id=self._source_id,
            type=EntryType.CONVERSATION,
            title=title or f"Session {session_id[:8]}",
            project=project,
            timestamp=first_ts,
            end_timestamp=last_ts,
            duration_seconds=duration,
            content=self._build_summary(messages),
            messages=messages,
            origin_primary_key=rel.as_posix(),
            origin_payload_ref=str(path),
            metadata={
                "file_path": str(path),
                "session_id": session_id,
                "subagent_count": len(subagent_files),
                "message_count": len(messages),
                "termination_reason": termination_reason,
                "prompt_injection_count": prompt_injection_count,
                "compaction_count": compaction_count,
            },
            tags=["claude-code", "coding-agent"],
        )

    def _parse_session_file(
        self,
        path: Path,
        source_kind: str,
        order_start: int,
        subagent_id: Optional[str] = None,
    ) -> List[Message]:
        messages: List[Message] = []
        tool_names: Dict[str, str] = {}
        order = order_start

        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue

                parsed_messages = self._parse_record(record, tool_names)
                for message in parsed_messages:
                    metadata = dict(message.metadata)
                    metadata["source_kind"] = source_kind
                    metadata["event_order"] = order
                    if subagent_id is not None:
                        metadata["subagent_id"] = subagent_id
                    message.metadata = metadata
                    messages.append(message)
                    order += 1

        return messages

    def _consolidate_messages(self, raw_messages: List[Message]) -> List[Message]:
        messages: List[Message] = []
        pending_outputs: List[str] = []
        pending_timestamp: Optional[datetime] = None
        pending_metadata: Dict[str, Any] = {}

        def flush_pending() -> None:
            nonlocal pending_outputs, pending_timestamp, pending_metadata
            if not pending_outputs:
                return
            metadata = dict(pending_metadata)
            metadata["block_type"] = "consolidated_output"
            messages.append(
                Message(
                    role=MessageRole.ASSISTANT,
                    content="\n\n".join(pending_outputs),
                    timestamp=pending_timestamp,
                    metadata=metadata,
                )
            )
            pending_outputs = []
            pending_timestamp = None
            pending_metadata = {}

        for message in raw_messages:
            if self._is_primary_user_message(message):
                flush_pending()
                messages.append(message)
                continue

            if message.role == MessageRole.SYSTEM:
                flush_pending()
                messages.append(message)
                continue

            if message.role == MessageRole.TOOL and self._should_surface_tool_message(message):
                flush_pending()
                messages.append(message)
                continue

            rendered = self._render_secondary_message(message)
            if not rendered:
                continue
            pending_outputs.append(rendered)
            if pending_timestamp is None and message.timestamp is not None:
                pending_timestamp = message.timestamp
            pending_metadata = self._merge_pending_metadata(pending_metadata, message.metadata)

        flush_pending()
        return messages

    def _is_primary_user_message(self, message: Message) -> bool:
        return (
            message.role == MessageRole.USER
            and message.metadata.get("source_kind") == "primary"
            and message.metadata.get("block_type") in {"text", "extracted_user_request"}
        )

    def _should_surface_tool_message(self, message: Message) -> bool:
        return bool(
            message.metadata.get("is_error")
            or message.metadata.get("interrupted")
            or message.metadata.get("termination_reason")
        )

    def _merge_pending_metadata(
        self, current: Dict[str, Any], incoming: Dict[str, Any]
    ) -> Dict[str, Any]:
        merged = dict(current)
        for key in ("model", "stop_reason", "stop_sequence", "termination_reason"):
            value = incoming.get(key)
            if value not in (None, ""):
                merged[key] = value
        return merged

    def _render_secondary_message(self, message: Message) -> str:
        source_kind = message.metadata.get("source_kind")
        if message.role == MessageRole.TOOL:
            return ""
        if source_kind == "subagent":
            if message.role != MessageRole.ASSISTANT or not message.content:
                return ""
            subagent_id = message.metadata.get("subagent_id")
            if isinstance(subagent_id, str) and subagent_id:
                return f"Subagent {subagent_id}:\n{message.content}"
            return f"Subagent:\n{message.content}"
        if message.role == MessageRole.ASSISTANT and message.content:
            return message.content
        return ""

    def _parse_record(
        self,
        record: Dict[str, Any],
        tool_names: Dict[str, str],
    ) -> List[Message]:
        record_type = record.get("type")
        if record_type == "system":
            system_message = self._parse_system_record(record)
            return [system_message] if system_message is not None else []
        if record_type in {"progress", "queue-operation"}:
            return []

        payload = self._message_payload(record)
        timestamp = self._extract_timestamp(record)
        common_metadata = self._extract_common_metadata(record, payload)
        role = self._extract_role(record, payload)
        if role is None:
            return []

        if role == MessageRole.USER:
            special_messages = self._parse_special_user_message(
                record, payload, timestamp, common_metadata
            )
            if special_messages is not None:
                return special_messages

        content = payload.get("content", "")
        if isinstance(content, list):
            messages: List[Message] = []
            for block in content:
                message = self._parse_content_block(block, role, timestamp, tool_names)
                if message is not None:
                    if message.metadata.get("block_type") == "tool_result":
                        tool_use_result = record.get("toolUseResult")
                        if isinstance(tool_use_result, dict):
                            if tool_use_result.get("interrupted") is True:
                                message.metadata["interrupted"] = True
                                message.metadata["termination_reason"] = "user_interrupted_for_tool_use"
                    message.metadata = {**message.metadata, **common_metadata}
                    messages.append(message)
            return messages

        tool_name = None
        if role == MessageRole.TOOL:
            tool_name = (
                payload.get("name")
                or record.get("name")
                or payload.get("tool_name")
                or record.get("tool_name")
            )

        content_text = self._extract_content(payload)
        if not content_text:
            return []
        return [
            Message(
                role=role,
                content=content_text,
                timestamp=timestamp,
                tool_name=tool_name,
                metadata={"block_type": "text", **common_metadata},
            )
        ]

    def _parse_content_block(
        self,
        block: Any,
        role: MessageRole,
        timestamp: Optional[datetime],
        tool_names: Dict[str, str],
    ) -> Optional[Message]:
        if isinstance(block, str):
            content = block.strip()
            if not content:
                return None
            return Message(
                role=role,
                content=content,
                timestamp=timestamp,
                metadata={"block_type": "text"},
            )

        if not isinstance(block, dict):
            content = self._stringify_value(block).strip()
            if not content:
                return None
            return Message(
                role=role,
                content=content,
                timestamp=timestamp,
                metadata={"block_type": "unknown"},
            )

        block_type = str(block.get("type") or "unknown")
        if block_type == "text":
            content = self._flatten_content(block).strip()
            if not content:
                return None
            return Message(
                role=role,
                content=content,
                timestamp=timestamp,
                metadata={"block_type": "text"},
            )

        if block_type == "tool_use":
            tool_name = block.get("name") or block.get("tool_name") or "tool"
            tool_use_id = block.get("id")
            if isinstance(tool_use_id, str) and tool_use_id:
                tool_names[tool_use_id] = tool_name

            return Message(
                role=MessageRole.TOOL,
                content=self._format_tool_use(block),
                timestamp=timestamp,
                tool_name=tool_name,
                metadata={
                    "block_type": "tool_use",
                    "tool_use_id": tool_use_id,
                    "exclude_from_index": True,
                },
            )

        if block_type == "tool_result":
            tool_use_id = block.get("tool_use_id")
            tool_name = tool_names.get(tool_use_id) if isinstance(tool_use_id, str) else None
            content = self._flatten_content(block.get("content", "")).strip()
            if not content:
                content = "(empty tool result)"
            return Message(
                role=MessageRole.TOOL,
                content=content,
                timestamp=timestamp,
                tool_name=tool_name,
                metadata={
                    "block_type": "tool_result",
                    "tool_use_id": tool_use_id,
                    "is_error": bool(block.get("is_error", False)),
                    "exclude_from_index": True,
                },
            )

        content = self._flatten_content(block).strip()
        if not content:
            return None
        return Message(
            role=role,
            content=content,
            timestamp=timestamp,
            metadata={"block_type": block_type},
        )

    def _message_payload(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload = record.get("message")
        if isinstance(payload, dict) and ("content" in payload or "role" in payload):
            return payload
        return record

    def _extract_common_metadata(
        self, record: Dict[str, Any], payload: Dict[str, Any]
    ) -> Dict[str, Any]:
        metadata: Dict[str, Any] = {}
        for key in ("model", "stop_reason", "stop_sequence"):
            value = payload.get(key)
            if value not in (None, ""):
                metadata[key] = value
        if record.get("isApiErrorMessage"):
            metadata["is_api_error_message"] = True
            metadata["termination_reason"] = "api_error"
        permission_mode = record.get("permissionMode")
        if isinstance(permission_mode, str) and permission_mode:
            metadata["permission_mode"] = permission_mode
        return metadata

    def _parse_special_user_message(
        self,
        record: Dict[str, Any],
        payload: Dict[str, Any],
        timestamp: Optional[datetime],
        common_metadata: Dict[str, Any],
    ) -> Optional[List[Message]]:
        content = self._extract_content(payload)
        if not content:
            return None
        stripped = content.strip()
        if not stripped:
            return None

        if self._looks_like_assistant_rules_wrapper(stripped):
            extracted_request = self._extract_wrapped_user_request(stripped)
            system_message = Message(
                role=MessageRole.SYSTEM,
                content=stripped,
                timestamp=timestamp,
                metadata={
                    **common_metadata,
                    "block_type": "prompt_injection",
                    "prompt_template": "assistant_rules_wrapper",
                    "exclude_from_index": True,
                    "synthetic": True,
                    "raw_role": "user",
                },
            )
            messages = [system_message]
            if extracted_request:
                messages.append(
                    Message(
                        role=MessageRole.USER,
                        content=extracted_request,
                        timestamp=timestamp,
                        metadata={
                            **common_metadata,
                            "block_type": "extracted_user_request",
                            "synthetic": True,
                            "raw_role": "user",
                        },
                    )
                )
            return messages

        if record.get("isCompactSummary") or stripped.startswith(CONTINUATION_SUMMARY_PREFIX):
            return [
                Message(
                    role=MessageRole.SYSTEM,
                    content=stripped,
                    timestamp=timestamp,
                    metadata={
                        **common_metadata,
                        "block_type": "continuation_summary",
                        "exclude_from_index": True,
                        "synthetic": True,
                        "raw_role": "user",
                        "is_compact_summary": bool(record.get("isCompactSummary")),
                        "is_visible_in_transcript_only": bool(
                            record.get("isVisibleInTranscriptOnly")
                        ),
                        "termination_reason": "context_compacted",
                    },
                )
            ]

        interruption_reason = INTERRUPTION_MARKERS.get(stripped)
        if interruption_reason:
            return [
                Message(
                    role=MessageRole.SYSTEM,
                    content=stripped,
                    timestamp=timestamp,
                    metadata={
                        **common_metadata,
                        "block_type": "request_interruption",
                        "exclude_from_index": True,
                        "synthetic": True,
                        "raw_role": "user",
                        "termination_reason": interruption_reason,
                    },
                )
            ]

        return None

    def _looks_like_assistant_rules_wrapper(self, content: str) -> bool:
        return AION_ASSISTANT_RULES_MARKER in content and USER_REQUEST_MARKER in content

    def _extract_wrapped_user_request(self, content: str) -> str:
        if USER_REQUEST_MARKER not in content:
            return ""
        _, request = content.split(USER_REQUEST_MARKER, 1)
        return request.strip()

    def _parse_system_record(self, record: Dict[str, Any]) -> Optional[Message]:
        subtype = str(record.get("subtype") or "system")
        timestamp = self._extract_timestamp(record)
        metadata: Dict[str, Any] = {
            "block_type": "system_event",
            "system_subtype": subtype,
            "exclude_from_index": True,
            "synthetic": True,
        }

        level = record.get("level")
        if isinstance(level, str) and level:
            metadata["level"] = level

        compact_metadata = record.get("compactMetadata")
        if isinstance(compact_metadata, dict):
            metadata["compact_metadata"] = compact_metadata

        if subtype == "compact_boundary":
            metadata["termination_reason"] = "context_compacted"
            content = str(record.get("content") or "Conversation compacted")
            return Message(
                role=MessageRole.SYSTEM,
                content=content,
                timestamp=timestamp,
                metadata=metadata,
            )

        if subtype == "api_error":
            metadata["termination_reason"] = "api_error"
            return Message(
                role=MessageRole.SYSTEM,
                content=self._format_api_error(record),
                timestamp=timestamp,
                metadata=metadata,
            )

        content = record.get("content")
        if isinstance(content, str) and content.strip():
            return Message(
                role=MessageRole.SYSTEM,
                content=content.strip(),
                timestamp=timestamp,
                metadata=metadata,
            )
        return None

    def _format_api_error(self, record: Dict[str, Any]) -> str:
        error = record.get("error")
        if isinstance(error, dict):
            status = error.get("status")
            if status is not None:
                return f"API error ({status})"
        return "API error"

    def _extract_role(self, record: Dict[str, Any], payload: Dict[str, Any]) -> Optional[MessageRole]:
        role_str = payload.get("role")
        if role_str in ROLE_MAP:
            return ROLE_MAP[role_str]

        role_str = record.get("role")
        if role_str in ROLE_MAP:
            return ROLE_MAP[role_str]

        rec_type = record.get("type")
        if rec_type in ("human", "user"):
            return MessageRole.USER
        if rec_type == "assistant":
            return MessageRole.ASSISTANT

        return None

    def _extract_content(self, record: Dict[str, Any]) -> str:
        return self._flatten_content(record.get("content", "")).strip()

    def _flatten_content(self, content: Any) -> str:
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = [self._flatten_content(item) for item in content]
            return "\n".join(part for part in parts if part)
        if isinstance(content, dict):
            text = content.get("text")
            if isinstance(text, str) and text:
                return text

            content_type = content.get("type")
            nested_content = content.get("content")
            if nested_content is not None:
                extracted = self._flatten_content(nested_content)
                if extracted:
                    return extracted

            if content_type == "tool_use":
                tool_name = content.get("name") or content.get("tool_name") or "tool"
                tool_input = content.get("input")
                if isinstance(tool_input, dict):
                    description = tool_input.get("description")
                    command = tool_input.get("command")
                    if isinstance(description, str) and description:
                        if isinstance(command, str) and command:
                            return f"[tool_use:{tool_name}] {description}\n{command}"
                        return f"[tool_use:{tool_name}] {description}"
                    if isinstance(command, str) and command:
                        return f"[tool_use:{tool_name}] {command}"
                return f"[tool_use:{tool_name}]"

            return self._stringify_value(content)

        return str(content) if content else ""

    def _format_tool_use(self, block: Dict[str, Any]) -> str:
        tool_input = block.get("input")
        if isinstance(tool_input, dict) and tool_input:
            lines = []
            for key, value in tool_input.items():
                if value in (None, "", [], {}):
                    continue
                lines.append(f"{key}: {self._stringify_value(value)}")
            if lines:
                return "\n".join(lines)
        return "(tool invoked)"

    def _stringify_value(self, value: Any) -> str:
        if isinstance(value, str):
            return value
        if isinstance(value, (int, float, bool)):
            return str(value)
        if value is None:
            return ""
        return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True)

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

    def _derive_termination_reason(self, messages: List[Message]) -> Optional[str]:
        for message in reversed(messages):
            explicit_reason = message.metadata.get("termination_reason")
            if isinstance(explicit_reason, str) and explicit_reason:
                return explicit_reason
            stop_reason = message.metadata.get("stop_reason")
            if isinstance(stop_reason, str) and stop_reason:
                return stop_reason
        return None

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
        entries.sort(key=lambda e: (e.timestamp, e.id), reverse=True)
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

        results.sort(key=lambda e: (e.timestamp, e.id), reverse=True)
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
                if msg.metadata.get("exclude_from_index"):
                    continue
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
