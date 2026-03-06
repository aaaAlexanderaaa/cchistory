from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, Query

from cchistory.config import AppConfig
from cchistory.db import IndexRepository
from cchistory.models import EntryType, SearchResult

router = APIRouter(prefix="/api/search", tags=["search"])


def get_repository() -> IndexRepository:
    from cchistory.main import app

    repository = getattr(app.state, "index_repository", None)
    if repository is None:
        repository = IndexRepository(AppConfig.default().database_url)
        app.state.index_repository = repository
    return repository


@router.get("", response_model=SearchResult)
async def search(
    q: str = Query(..., min_length=1),
    sources: Optional[str] = Query(None, description="Comma-separated source names"),
    types: Optional[str] = Query(None, description="Comma-separated entry types"),
    project: Optional[str] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    repository: IndexRepository = Depends(get_repository),
) -> SearchResult:
    source_list: Optional[List[str]] = None
    if sources:
        source_list = [source.strip() for source in sources.split(",") if source.strip()]

    type_list: Optional[List[EntryType]] = None
    if types:
        type_list = [EntryType(entry_type.strip()) for entry_type in types.split(",")]

    entries, total = repository.search_entries(
        query=q,
        sources=source_list,
        types=type_list,
        project=project,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
    )
    return SearchResult(entries=entries, total=total, query=q)
