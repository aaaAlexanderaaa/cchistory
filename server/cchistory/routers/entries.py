from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from cchistory.config import AppConfig
from cchistory.db import IndexRepository
from cchistory.schema import HistoryEntryDetail, HistoryEntrySummary

router = APIRouter(prefix="/api/entries", tags=["entries"])


def get_repository() -> IndexRepository:
    from cchistory.main import app

    repository = getattr(app.state, "index_repository", None)
    if repository is None:
        repository = IndexRepository(AppConfig.default().database_url)
        app.state.index_repository = repository
    return repository


@router.get("", response_model=list[HistoryEntrySummary])
async def list_entries(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    cursor: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    project: Optional[str] = Query(None),
    response: Response = None,
    repository: IndexRepository = Depends(get_repository),
) -> list[HistoryEntrySummary]:
    if (isinstance(cursor, str) and cursor) or offset == 0:
        try:
            entries, next_cursor = repository.list_entry_page(
                limit=limit,
                cursor=cursor or None,
                source=source,
                project=project,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if response is not None and next_cursor:
            response.headers["X-Next-Cursor"] = next_cursor
        return entries

    return repository.list_entry_summaries(
        limit=limit,
        offset=offset,
        source=source,
        project=project,
    )


@router.get("/{entry_id}", response_model=HistoryEntryDetail)
async def get_entry(
    entry_id: str,
    repository: IndexRepository = Depends(get_repository),
) -> HistoryEntryDetail:
    entry = repository.get_entry_detail(entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    return entry
