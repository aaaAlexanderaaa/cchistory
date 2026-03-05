from __future__ import annotations

from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from cchistory.models import HistoryEntry

router = APIRouter(prefix="/api/history", tags=["history"])


def get_registry() -> Any:
    from cchistory.main import app

    return app.state.registry


@router.get("", response_model=List[HistoryEntry])
async def list_history(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    source: Optional[str] = Query(None),
    project: Optional[str] = Query(None),
    registry: Any = Depends(get_registry),
) -> List[HistoryEntry]:
    return await registry.list_all_entries(
        limit=limit,
        offset=offset,
        source_name=source,
        project=project,
    )


@router.get("/{source_name}/{entry_id}", response_model=HistoryEntry)
async def get_entry(
    source_name: str,
    entry_id: str,
    registry: Any = Depends(get_registry),
) -> HistoryEntry:
    entry = await registry.get_entry(source_name, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    return entry
