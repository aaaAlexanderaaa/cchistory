from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

from cchistory.schema import (
    Artifact,
    CANONICAL_SCHEMA_SERIES,
    CANONICAL_SCHEMA_VERSION,
    Chunk,
    DistillArtifact,
    EntryType,
    HistoryEntry,
    HistoryEntryDetail,
    HistoryEntrySummary,
    Message,
    MessageRole,
    SourceInfo,
    is_schema_version_compatible,
)


class SearchQuery(BaseModel):
    query: str
    sources: Optional[List[str]] = None
    types: Optional[List[EntryType]] = None
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    project: Optional[str] = None
    limit: int = 50
    offset: int = 0


class SearchHit(HistoryEntrySummary):
    highlights: List[str] = Field(default_factory=list)


class SearchResult(BaseModel):
    entries: List[SearchHit]
    total: int
    query: str


class IngestRunRequest(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "source_id": "claude_code",
            }
        }
    )

    source_id: Optional[str] = None


class IngestRunResult(BaseModel):
    source_id: str
    connector_type: str
    status: str
    scanned_count: int = 0
    written_count: int = 0
    next_cursor: Optional[str] = None
    has_more: bool = False
    error: Optional[str] = None


class IngestRunResponse(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "runs": [
                    {
                        "source_id": "claude_code",
                        "connector_type": "claude_code",
                        "status": "ok",
                        "scanned_count": 12,
                        "written_count": 12,
                        "next_cursor": "1709713440.123456",
                        "has_more": False,
                        "error": None,
                    }
                ]
            }
        }
    )

    runs: List[IngestRunResult]


class Chat2HistoryQuery(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "query": "Where did we debug the auth cookie parser?",
                "top_k": 3,
                "token_budget": 1200,
                "sources": ["claude_code"],
                "types": ["conversation"],
                "project": "acme/dashboard",
            }
        }
    )

    query: str = Field(min_length=1)
    top_k: int = Field(default=5, ge=1, le=25)
    token_budget: int = Field(default=1200, ge=128, le=8000)
    sources: Optional[List[str]] = None
    types: Optional[List[EntryType]] = None
    project: Optional[str] = None


class Chat2HistoryCitation(BaseModel):
    entry_id: str
    source: str
    title: str
    timestamp: datetime


class Chat2HistoryContextItem(BaseModel):
    entry_id: str
    source: str
    title: str
    timestamp: datetime
    score: Optional[float] = None
    snippet: Optional[str] = None
    content: str
    token_count: int
    citation: Chat2HistoryCitation


class Chat2HistoryResponse(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "query": "Where did we debug the auth cookie parser?",
                "used_tokens": 482,
                "token_budget": 1200,
                "truncated": False,
                "items": [
                    {
                        "entry_id": "claude_code:claude_code:095c3f13e4fe8f47",
                        "source": "Claude Code",
                        "title": "Fix login redirect loop in dashboard",
                        "timestamp": "2026-03-06T08:15:00Z",
                        "score": 0.92,
                        "snippet": "Investigate the middleware sequence around the auth cookie.",
                        "content": "Investigate the middleware sequence around the auth cookie.",
                        "token_count": 116,
                        "citation": {
                            "entry_id": "claude_code:claude_code:095c3f13e4fe8f47",
                            "source": "Claude Code",
                            "title": "Fix login redirect loop in dashboard",
                            "timestamp": "2026-03-06T08:15:00Z",
                        },
                    }
                ],
            }
        }
    )

    query: str
    items: List[Chat2HistoryContextItem]
    used_tokens: int
    token_budget: int
    truncated: bool = False


class DistillSessionRequest(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "source": "claude_code",
                "project": "acme/dashboard",
                "limit": 10,
            }
        }
    )

    source: Optional[str] = None
    project: Optional[str] = None
    limit: int = Field(default=10, ge=1, le=100)
    entry_ids: Optional[List[str]] = None
