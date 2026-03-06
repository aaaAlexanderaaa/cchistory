from __future__ import annotations

from typing import Any, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException

from cchistory.config import AppConfig
from cchistory.db import IndexRepository
from cchistory.ingestion import ConnectorRuntime, IngestRunReport, IngestionOrchestrator
from cchistory.models import IngestRunRequest, IngestRunResponse, IngestRunResult
from cchistory.schema import SourceInfo
from cchistory.services import collect_source_info

router = APIRouter(prefix="/api/ingest", tags=["ingest"])


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


def get_orchestrator() -> Optional[IngestionOrchestrator]:
    from cchistory.main import app

    return getattr(app.state, "ingestion_orchestrator", None)


def get_registry() -> Any:
    from cchistory.main import app

    return getattr(app.state, "registry", None)


def _report_to_model(report: IngestRunReport) -> IngestRunResult:
    return IngestRunResult(
        source_id=report.source_id,
        connector_type=report.connector_type,
        status=report.status,
        scanned_count=report.scanned_count,
        written_count=report.written_count,
        next_cursor=report.next_cursor,
        has_more=report.has_more,
        error=report.error,
    )


@router.get("/status", response_model=List[SourceInfo])
async def get_ingest_status(
    repository: IndexRepository = Depends(get_repository),
    runtime: Optional[ConnectorRuntime] = Depends(get_runtime),
    registry: Any = Depends(get_registry),
) -> List[SourceInfo]:
    return await collect_source_info(repository, runtime, registry=registry)


@router.post("/run", response_model=IngestRunResponse)
async def run_ingest(
    request: Optional[IngestRunRequest] = Body(default=None),
    repository: IndexRepository = Depends(get_repository),
    orchestrator: Optional[IngestionOrchestrator] = Depends(get_orchestrator),
) -> IngestRunResponse:
    if orchestrator is None:
        raise HTTPException(status_code=503, detail="Ingestion runtime is not available")

    source_id = request.source_id if request is not None else None
    if source_id:
        try:
            reports = [await orchestrator.run_source(source_id)]
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=f"Unknown source: {source_id}") from exc
    else:
        reports = list((await orchestrator.run_all()).values())

    for report in reports:
        repository.record_ingest_run(
            source_id=report.source_id,
            status=report.status,
            scanned_count=report.scanned_count,
            written_count=report.written_count,
            next_cursor=report.next_cursor,
            error_message=report.error,
            metadata={"has_more": report.has_more},
        )

    return IngestRunResponse(
        runs=[_report_to_model(report) for report in sorted(reports, key=lambda item: item.source_id)]
    )
