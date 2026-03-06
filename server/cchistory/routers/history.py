from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from cchistory.config import AppConfig
from cchistory.db import IndexRepository
from cchistory.models import HistoryEntry

router = APIRouter(prefix="/api/history", tags=["history"])


def get_repository() -> IndexRepository:
    from cchistory.main import app

    repository = getattr(app.state, "index_repository", None)
    if repository is None:
        repository = IndexRepository(AppConfig.default().database_url)
        app.state.index_repository = repository
    return repository


@router.get("", response_model=List[HistoryEntry])
async def list_history(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    source: Optional[str] = Query(None),
    project: Optional[str] = Query(None),
    repository: IndexRepository = Depends(get_repository),
) -> List[HistoryEntry]:
    summaries = repository.list_entry_summaries(
        limit=limit,
        offset=offset,
        source=source,
        project=project,
    )
    return [
        HistoryEntry.model_validate(detail.model_dump())
        for summary in summaries
        if (detail := repository.get_entry_detail(summary.entry_id)) is not None
    ]


@router.get("/{source_name}/{entry_id}", response_model=HistoryEntry)
async def get_entry(
    source_name: str,
    entry_id: str,
    repository: IndexRepository = Depends(get_repository),
) -> HistoryEntry:
    entry = repository.get_entry_detail(entry_id)
    if entry is None or source_name not in {entry.source, entry.source_id}:
        raise HTTPException(status_code=404, detail="Entry not found")
    return HistoryEntry.model_validate(entry.model_dump())
