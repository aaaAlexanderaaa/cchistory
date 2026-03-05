from __future__ import annotations

from typing import Any, Dict, List, Optional, Type

from cchistory.config import SourceConfig
from cchistory.datasources.base import DataSource
from cchistory.models import HistoryEntry, SearchQuery, SourceInfo


class SourceRegistry:
    """Manages all registered data sources."""

    def __init__(self) -> None:
        self._factories: Dict[str, Type[DataSource]] = {}
        self._instances: Dict[str, DataSource] = {}
        self._configs: Dict[str, SourceConfig] = {}

    def register_type(self, type_name: str, factory: Type[DataSource]) -> None:
        self._factories[type_name] = factory

    async def add_source(self, config: SourceConfig) -> None:
        if config.type not in self._factories:
            raise ValueError(f"Unknown source type: {config.type}")

        source = self._factories[config.type]()
        await source.connect(config.params)
        self._instances[config.name] = source
        self._configs[config.name] = config

    async def remove_source(self, name: str) -> None:
        if name in self._instances:
            await self._instances[name].disconnect()
            del self._instances[name]
            del self._configs[name]

    async def shutdown(self) -> None:
        for source in self._instances.values():
            await source.disconnect()
        self._instances.clear()
        self._configs.clear()

    def get_source(self, name: str) -> Optional[DataSource]:
        return self._instances.get(name)

    def list_sources(self) -> List[str]:
        return list(self._instances.keys())

    async def get_source_info(self) -> List[SourceInfo]:
        result = []
        for name, source in self._instances.items():
            config = self._configs[name]
            try:
                count = await source.count()
                status = "connected"
            except Exception:
                count = None
                status = "error"
            result.append(
                SourceInfo(
                    name=name,
                    type=config.type,
                    enabled=config.enabled,
                    entry_count=count,
                    status=status,
                )
            )
        return result

    async def search_all(self, query: SearchQuery) -> List[HistoryEntry]:
        results: List[HistoryEntry] = []
        target_sources = query.sources or list(self._instances.keys())

        for name in target_sources:
            source = self._instances.get(name)
            if source is None:
                continue
            try:
                entries = await source.search(query)
                results.extend(entries)
            except Exception:
                continue

        results.sort(key=lambda e: e.timestamp, reverse=True)
        start = query.offset
        end = query.offset + query.limit
        return results[start:end]

    async def list_all_entries(
        self,
        limit: int = 50,
        offset: int = 0,
        source_name: Optional[str] = None,
        project: Optional[str] = None,
    ) -> List[HistoryEntry]:
        results: List[HistoryEntry] = []

        if source_name:
            source = self._instances.get(source_name)
            if source:
                return await source.list_entries(limit=limit, offset=offset, project=project)
            return []

        for source in self._instances.values():
            try:
                entries = await source.list_entries(limit=limit + offset, project=project)
                results.extend(entries)
            except Exception:
                continue

        results.sort(key=lambda e: e.timestamp, reverse=True)
        return results[offset : offset + limit]

    async def get_entry(self, source_name: str, entry_id: str) -> Optional[HistoryEntry]:
        source = self._instances.get(source_name)
        if source is None:
            return None
        return await source.get_entry(entry_id)

    async def list_all_projects(self) -> Dict[str, List[str]]:
        result: Dict[str, List[str]] = {}
        for name, source in self._instances.items():
            try:
                projects = await source.list_projects()
                result[name] = projects
            except Exception:
                result[name] = []
        return result
