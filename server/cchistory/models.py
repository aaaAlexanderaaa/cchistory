from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


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
    role: MessageRole
    content: str
    timestamp: Optional[datetime] = None
    tool_name: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class HistoryEntry(BaseModel):
    """Universal history entry that normalizes data from all sources."""

    id: str
    source: str
    source_id: str
    type: EntryType
    title: str
    url: Optional[str] = None
    project: Optional[str] = None
    timestamp: datetime
    end_timestamp: Optional[datetime] = None
    duration_seconds: Optional[int] = None
    content: Optional[str] = None
    messages: Optional[List[Message]] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    tags: List[str] = Field(default_factory=list)


class SourceInfo(BaseModel):
    name: str
    type: str
    enabled: bool
    entry_count: Optional[int] = None
    status: str = "unknown"


class SearchQuery(BaseModel):
    query: str
    sources: Optional[List[str]] = None
    types: Optional[List[EntryType]] = None
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    project: Optional[str] = None
    limit: int = 50
    offset: int = 0


class SearchResult(BaseModel):
    entries: List[HistoryEntry]
    total: int
    query: str
