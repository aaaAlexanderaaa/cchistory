from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from cchistory.config import SourceConfig
from cchistory.db import IndexRepository
from cchistory.services import collect_source_info


class StubSource:
    def __init__(self, count: int) -> None:
        self._count = count

    async def count(self) -> int:
        return self._count


class StubRegistry:
    def __init__(self, count: int) -> None:
        self._source = StubSource(count)

    def get_source(self, _name_or_id: str):
        return self._source


@pytest.mark.asyncio
async def test_collect_source_info_includes_drift_metadata():
    with tempfile.TemporaryDirectory() as tmpdir:
        repository = IndexRepository(f"sqlite:///{Path(tmpdir) / 'index.sqlite3'}")
        repository.ensure_source_configs(
            [
                SourceConfig(
                    type="claude_code",
                    name="Claude Code",
                    params={"base_dir": tmpdir},
                )
            ]
        )
        registry = StubRegistry(count=3)

        sources = await collect_source_info(repository, runtime=None, registry=registry)

        assert sources[0].metadata["live_entry_count"] == 3
        assert sources[0].metadata["indexed_entry_count"] == 0
        assert sources[0].metadata["drift_count"] == 3
