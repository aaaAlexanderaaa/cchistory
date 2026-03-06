from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Type

from pydantic import BaseModel, ConfigDict, Field, computed_field

CANONICAL_SCHEMA_VERSION = "0.2.0"
CANONICAL_SCHEMA_SERIES = "0.2"


def is_schema_version_compatible(version: str) -> bool:
    """Return True when a version belongs to the active schema series."""
    normalized = version.strip()
    return normalized == CANONICAL_SCHEMA_SERIES or normalized.startswith(
        f"{CANONICAL_SCHEMA_SERIES}."
    )


class CanonicalModel(BaseModel):
    """Base model for versioned canonical records."""

    model_config = ConfigDict(populate_by_name=True)
    schema_version: str = Field(default=CANONICAL_SCHEMA_VERSION)


class EntryType(str, Enum):
    CONVERSATION = "conversation"
    VISIT = "visit"
    MESSAGE = "message"


class MessageRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"
    TOOL = "tool"


class Message(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "role": "assistant",
                "content": "I traced the failing auth flow and the cookie parser is missing.",
                "timestamp": "2026-03-06T08:15:00Z",
                "tool_name": None,
                "metadata": {"token_count": 18},
            }
        }
    )

    role: MessageRole
    content: str
    timestamp: Optional[datetime] = None
    tool_name: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class HistoryEntrySummary(CanonicalModel):
    """Lightweight list/search projection for history entries."""

    model_config = ConfigDict(
        populate_by_name=True,
        json_schema_extra={
            "example": {
                "schema_version": CANONICAL_SCHEMA_VERSION,
                "id": "claude_code:claude_code:095c3f13e4fe8f47",
                "entry_id": "claude_code:claude_code:095c3f13e4fe8f47",
                "source": "Claude Code",
                "type": "conversation",
                "title": "Fix login redirect loop in dashboard",
                "timestamp": "2026-03-06T08:15:00Z",
                "project": "acme/dashboard",
                "snippet": "Investigate the middleware sequence around the auth cookie.",
                "score": 0.92,
                "tags": ["claude-code", "coding-agent"],
            }
        },
    )

    id: str
    source: str
    type: EntryType
    title: str
    timestamp: datetime
    project: Optional[str] = None
    snippet: Optional[str] = None
    score: Optional[float] = None
    tags: List[str] = Field(default_factory=list)

    @computed_field(return_type=str)
    @property
    def entry_id(self) -> str:
        return self.id


class HistoryEntryDetail(HistoryEntrySummary):
    """Full entry payload used for detail views and connector output."""

    model_config = ConfigDict(
        populate_by_name=True,
        json_schema_extra={
            "example": {
                "schema_version": CANONICAL_SCHEMA_VERSION,
                "id": "claude_code:claude_code:095c3f13e4fe8f47",
                "entry_id": "claude_code:claude_code:095c3f13e4fe8f47",
                "source": "Claude Code",
                "source_id": "claude_code",
                "type": "conversation",
                "title": "Fix login redirect loop in dashboard",
                "timestamp": "2026-03-06T08:15:00Z",
                "project": "acme/dashboard",
                "snippet": "Investigate the middleware sequence around the auth cookie.",
                "score": 0.92,
                "tags": ["claude-code", "coding-agent"],
                "origin_primary_key": "acme/dashboard/session-001.jsonl",
                "origin_payload_ref": "/home/user/.claude/projects/acme/dashboard/session-001.jsonl",
                "url": None,
                "end_timestamp": "2026-03-06T08:24:00Z",
                "duration_seconds": 540,
                "content": "[4 messages] Fix login redirect loop in dashboard",
                "messages": [
                    {
                        "role": "user",
                        "content": "Fix login redirect loop in dashboard",
                        "timestamp": "2026-03-06T08:15:00Z",
                        "tool_name": None,
                        "metadata": {},
                    }
                ],
                "metadata": {"message_count": 4},
            }
        },
    )

    source_id: str
    origin_primary_key: str
    origin_payload_ref: Optional[str] = None
    url: Optional[str] = None
    end_timestamp: Optional[datetime] = None
    duration_seconds: Optional[int] = None
    content: Optional[str] = None
    messages: Optional[List[Message]] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

    def to_summary(self, score: Optional[float] = None) -> "HistoryEntrySummary":
        snippet = self.content
        if snippet is None and self.messages:
            snippet = next((msg.content for msg in self.messages if msg.content), None)
        if snippet:
            snippet = snippet[:240]

        return HistoryEntrySummary(
            schema_version=self.schema_version,
            id=self.id,
            source=self.source,
            type=self.type,
            title=self.title,
            timestamp=self.timestamp,
            project=self.project,
            snippet=snippet,
            score=score,
            tags=list(self.tags),
        )


class HistoryEntry(HistoryEntryDetail):
    """Compatibility alias for the legacy full-payload entry model."""


class Artifact(CanonicalModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "schema_version": CANONICAL_SCHEMA_VERSION,
                "artifact_id": "artifact:claude_code:095c3f13e4fe8f47:1",
                "entry_id": "claude_code:claude_code:095c3f13e4fe8f47",
                "artifact_type": "file_reference",
                "label": "middleware/auth.ts",
                "ref": "middleware/auth.ts:41",
                "metadata": {"language": "typescript"},
            }
        }
    )

    artifact_id: str
    entry_id: str
    artifact_type: str
    label: str
    ref: str
    metadata: Dict[str, Any] = Field(default_factory=dict)


class Chunk(CanonicalModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "schema_version": CANONICAL_SCHEMA_VERSION,
                "chunk_id": "chunk:claude_code:095c3f13e4fe8f47:0",
                "entry_id": "claude_code:claude_code:095c3f13e4fe8f47",
                "position": 0,
                "text": "Investigate the middleware sequence around the auth cookie.",
                "metadata": {"token_count": 11},
            }
        }
    )

    chunk_id: str
    entry_id: str
    position: int
    text: str
    metadata: Dict[str, Any] = Field(default_factory=dict)


class SourceInfo(CanonicalModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "schema_version": CANONICAL_SCHEMA_VERSION,
                "source_id": "claude_code",
                "name": "Claude Code",
                "type": "claude_code",
                "enabled": True,
                "entry_count": 128,
                "status": "ok",
                "last_run_status": "ok",
                "last_run_at": "2026-03-06T08:24:00Z",
                "last_success_at": "2026-03-06T08:24:00Z",
                "lag_seconds": 42,
                "cursor": "1709713440.123456",
                "has_more": False,
                "error_message": None,
                "metadata": {"base_dir": "/home/user/.claude/projects"},
            }
        }
    )

    source_id: str
    name: str
    type: str
    enabled: bool
    entry_count: Optional[int] = None
    status: str = "unknown"
    last_run_status: Optional[str] = None
    last_run_at: Optional[datetime] = None
    last_success_at: Optional[datetime] = None
    lag_seconds: Optional[int] = None
    cursor: Optional[str] = None
    has_more: Optional[bool] = None
    error_message: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class DistillArtifact(CanonicalModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "schema_version": CANONICAL_SCHEMA_VERSION,
                "artifact_id": "distill:session:4d8e9bcf90c7ab12",
                "scope": "project:acme/dashboard|source:claude_code|limit:10",
                "artifact_type": "session_distill",
                "title": "Session distill for acme/dashboard",
                "summary": "Recent work concentrated on the auth cookie parser and dashboard middleware.",
                "patterns": [
                    "Recurring topic: auth (4 mentions)",
                    "Common tools: grep, pytest",
                ],
                "decisions": [
                    "Use the indexed entries API as the primary read path.",
                ],
                "open_questions": [
                    "Do we need to keep the legacy history wrapper after parity validation?",
                ],
                "provenance_entry_ids": [
                    "claude_code:claude_code:095c3f13e4fe8f47",
                ],
                "tags": ["auth", "middleware", "dashboard"],
                "created_at": "2026-03-06T08:24:00Z",
                "updated_at": "2026-03-06T08:24:00Z",
                "metadata": {"entry_count": 4, "sources": ["Claude Code"]},
            }
        }
    )

    artifact_id: str
    scope: str
    artifact_type: str
    title: str
    summary: str
    patterns: List[str] = Field(default_factory=list)
    decisions: List[str] = Field(default_factory=list)
    open_questions: List[str] = Field(default_factory=list)
    provenance_entry_ids: List[str] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


CORE_SCHEMA_MODELS: Dict[str, Type[BaseModel]] = {
    "Message": Message,
    "HistoryEntrySummary": HistoryEntrySummary,
    "HistoryEntryDetail": HistoryEntryDetail,
    "Artifact": Artifact,
    "Chunk": Chunk,
    "DistillArtifact": DistillArtifact,
    "SourceInfo": SourceInfo,
}


def build_core_json_schemas() -> Dict[str, Dict[str, Any]]:
    return {name: model.model_json_schema() for name, model in CORE_SCHEMA_MODELS.items()}
