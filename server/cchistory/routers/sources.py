from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends

from cchistory.config import AppConfig
from cchistory.db import IndexRepository
from cchistory.ingestion import ConnectorRuntime
from cchistory.models import SourceInfo
from cchistory.services import collect_source_info

router = APIRouter(prefix="/api/sources", tags=["sources"])


def get_repository() -> IndexRepository:
    from cchistory.main import app

    repository = getattr(app.state, "index_repository", None)
    if repository is None:
        repository = IndexRepository(AppConfig.default().database_url)
        app.state.index_repository = repository
    return repository


def get_runtime() -> Optional[ConnectorRuntime]:
    from cchistory.main import app

    return getattr(app.state, "connector_runtime", None)


def get_registry() -> Any:
    from cchistory.main import app

    return getattr(app.state, "registry", None)


@router.get("", response_model=List[SourceInfo])
async def list_sources(
    repository: IndexRepository = Depends(get_repository),
    runtime: Optional[ConnectorRuntime] = Depends(get_runtime),
    registry: Any = Depends(get_registry),
) -> List[SourceInfo]:
    return await collect_source_info(repository, runtime, registry=registry)


@router.get("/projects", response_model=Dict[str, List[str]])
async def list_projects(
    repository: IndexRepository = Depends(get_repository),
) -> Dict[str, List[str]]:
    return repository.list_projects()
