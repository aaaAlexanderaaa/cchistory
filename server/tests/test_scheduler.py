from __future__ import annotations

import asyncio

import pytest

from cchistory.ingestion import IngestionScheduler


class StubOrchestrator:
    def __init__(self) -> None:
        self.run_count = 0

    async def run_all(self):
        self.run_count += 1
        return {}


class FlakyOrchestrator:
    def __init__(self) -> None:
        self.run_count = 0
        self.success_event = asyncio.Event()

    async def run_all(self):
        self.run_count += 1
        if self.run_count == 1:
            raise RuntimeError("temporary connector failure")
        self.success_event.set()
        return {}


@pytest.mark.asyncio
async def test_scheduler_runs_orchestrator_on_interval():
    orchestrator = StubOrchestrator()
    scheduler = IngestionScheduler(orchestrator, interval_seconds=0.01)

    scheduler.start()
    await asyncio.sleep(0.03)
    await scheduler.stop()

    assert orchestrator.run_count >= 1


@pytest.mark.asyncio
async def test_scheduler_run_once_invokes_orchestrator():
    orchestrator = StubOrchestrator()
    scheduler = IngestionScheduler(orchestrator, interval_seconds=60)

    await scheduler.run_once()

    assert orchestrator.run_count == 1


@pytest.mark.asyncio
async def test_scheduler_continues_after_transient_failures():
    orchestrator = FlakyOrchestrator()
    scheduler = IngestionScheduler(orchestrator, interval_seconds=0.01)

    scheduler.start()
    await asyncio.wait_for(orchestrator.success_event.wait(), timeout=0.2)
    await scheduler.stop()

    assert orchestrator.run_count >= 2
