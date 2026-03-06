from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from cchistory.schema import EntryType, HistoryEntryDetail


class SourceHandle(BaseModel):
    source_id: str
    connector_type: str
    name: str
    metadata: Dict[str, Any] = Field(default_factory=dict)


class HealthState(str, Enum):
    OK = "ok"
    DEGRADED = "degraded"
    ERROR = "error"


class HealthStatus(BaseModel):
    source_id: str
    connector_type: str
    status: HealthState
    checked_at: datetime
    last_success_at: Optional[datetime] = None
    lag_seconds: Optional[int] = None
    message: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class RawRecord(BaseModel):
    source_id: str
    connector_type: str
    origin_primary_key: str
    origin_payload_ref: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class NormalizedEvent(BaseModel):
    event_id: str
    source_id: str
    connector_type: str
    entry_id: str
    entry_type: EntryType
    occurred_at: datetime
    origin_primary_key: str
    origin_payload_ref: Optional[str] = None
    entry: HistoryEntryDetail
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ScanBatch(BaseModel):
    events: List[NormalizedEvent] = Field(default_factory=list)
    next_cursor: Optional[str] = None
    has_more: bool = False
    scanned_count: int = 0
