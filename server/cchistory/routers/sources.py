from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Depends

from cchistory.models import SourceInfo

router = APIRouter(prefix="/api/sources", tags=["sources"])


def get_registry() -> Any:
    from cchistory.main import app

    return app.state.registry


@router.get("", response_model=List[SourceInfo])
async def list_sources(registry: Any = Depends(get_registry)) -> List[SourceInfo]:
    return await registry.get_source_info()


@router.get("/projects", response_model=Dict[str, List[str]])
async def list_projects(registry: Any = Depends(get_registry)) -> Dict[str, List[str]]:
    return await registry.list_all_projects()
