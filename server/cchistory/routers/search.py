from __future__ import annotations

from typing import Any, List, Optional

from fastapi import APIRouter, Depends, Query

from cchistory.models import EntryType, HistoryEntry, SearchQuery, SearchResult

router = APIRouter(prefix="/api/search", tags=["search"])


def get_registry() -> Any:
    from cchistory.main import app

    return app.state.registry


@router.get("", response_model=SearchResult)
async def search(
    q: str = Query(..., min_length=1),
    sources: Optional[str] = Query(None, description="Comma-separated source names"),
    types: Optional[str] = Query(None, description="Comma-separated entry types"),
    project: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    registry: Any = Depends(get_registry),
) -> SearchResult:
    source_list: Optional[List[str]] = None
    if sources:
        source_list = [s.strip() for s in sources.split(",")]

    type_list: Optional[List[EntryType]] = None
    if types:
        type_list = [EntryType(t.strip()) for t in types.split(",")]

    query = SearchQuery(
        query=q,
        sources=source_list,
        types=type_list,
        project=project,
        limit=limit,
        offset=offset,
    )

    entries = await registry.search_all(query)

    if type_list:
        entries = [e for e in entries if e.type in type_list]

    return SearchResult(
        entries=entries,
        total=len(entries),
        query=q,
    )
