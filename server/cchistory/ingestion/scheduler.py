from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Optional

from cchistory.ingestion.orchestrator import IngestionOrchestrator

logger = logging.getLogger(__name__)


@dataclass
class IngestionScheduler:
    orchestrator: IngestionOrchestrator
    interval_seconds: float
    _task: Optional[asyncio.Task] = field(default=None, init=False)

    async def run_once(self) -> None:
        await self.orchestrator.run_all()

    async def _run_loop(self) -> None:
        while True:
            await asyncio.sleep(self.interval_seconds)
            try:
                await self.run_once()
            except Exception:
                logger.exception("Scheduled ingestion run failed")

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run_loop())

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        finally:
            self._task = None
