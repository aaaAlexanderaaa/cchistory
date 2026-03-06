from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from cchistory.config import AppConfig
from cchistory.db import IndexRepository
from cchistory.distill import distill_session
from cchistory.models import DistillSessionRequest
from cchistory.schema import DistillArtifact

router = APIRouter(prefix="/api/distill", tags=["distill"])


def get_repository() -> IndexRepository:
    from cchistory.main import app

    repository = getattr(app.state, "index_repository", None)
    if repository is None:
        repository = IndexRepository(AppConfig.default().database_url)
        app.state.index_repository = repository
    return repository


@router.post("/session", response_model=DistillArtifact)
async def create_session_distill(
    payload: DistillSessionRequest,
    repository: IndexRepository = Depends(get_repository),
) -> DistillArtifact:
    try:
        return distill_session(repository, payload)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
