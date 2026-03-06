from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from cchistory.config import AppConfig
from cchistory.db import IndexRepository
from cchistory.datasources.brave import BraveSource
from cchistory.datasources.claude_code import ClaudeCodeSource
from cchistory.datasources.registry import SourceRegistry
from cchistory.ingestion import ConnectorRuntime, IngestionScheduler
from cchistory.routers import chat2history, distill, entries, history, ingest, search, sources

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    existing_registry = getattr(app.state, "registry", None)
    if isinstance(existing_registry, SourceRegistry):
        yield
        return

    config = AppConfig.default()
    registry = SourceRegistry()
    repository = IndexRepository(config.database_url)
    repository.ensure_source_configs(config.sources)
    runtime = ConnectorRuntime.from_source_configs(config.sources)
    orchestrator = runtime.build_orchestrator(repository)
    scheduler = None
    if config.sync_interval_seconds:
        scheduler = IngestionScheduler(orchestrator, interval_seconds=config.sync_interval_seconds)
        scheduler.start()

    app.state.app_config = config
    app.state.index_repository = repository
    app.state.connector_runtime = runtime
    app.state.ingestion_orchestrator = orchestrator
    app.state.ingestion_scheduler = scheduler

    registry.register_type("claude_code", ClaudeCodeSource)
    registry.register_type("brave", BraveSource)
    registry.register_type("chrome", BraveSource)  # Same schema as Brave

    for src_config in config.sources:
        if not src_config.enabled:
            continue
        try:
            await registry.add_source(src_config)
            logger.info(f"Connected source: {src_config.name} ({src_config.type})")
        except Exception as e:
            logger.error(f"Failed to connect source {src_config.name}: {e}")

    app.state.registry = registry

    yield

    await registry.shutdown()
    if scheduler is not None:
        await scheduler.stop()
    logger.info("All sources disconnected")


app = FastAPI(
    title="CCHistory",
    description="Universal history browser - manage conversation and browsing history from multiple sources",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8765"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
async def health_check() -> dict:
    return {"status": "ok", "version": "0.1.0"}


app.include_router(sources.router)
app.include_router(entries.router)
app.include_router(history.router)
app.include_router(ingest.router)
app.include_router(search.router)
app.include_router(chat2history.router)
app.include_router(distill.router)

# Serve the built frontend if available (must be last - catches all unmatched routes)
static_dir = Path(__file__).parent.parent.parent / "web" / "dist"
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")


def main() -> None:
    import uvicorn

    config = AppConfig.default()
    uvicorn.run(
        "cchistory.main:app",
        host=config.host,
        port=config.port,
        reload=True,
    )


if __name__ == "__main__":
    main()
