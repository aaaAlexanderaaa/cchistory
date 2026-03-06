from __future__ import annotations

from typing import Any, Dict, List, Optional, Type

from cchistory.config import SourceConfig
from cchistory.connectors.config import SourceInstanceConfig, validate_source_config
from cchistory.datasources.base import DataSource
from cchistory.models import HistoryEntry, SearchQuery, SourceInfo


class SourceRegistry:
    """Manages all registered data sources."""

    def __init__(self) -> None:
        self._factories: Dict[str, Type[DataSource]] = {}
        self._instances: Dict[str, DataSource] = {}
        self._configs: Dict[str, SourceInstanceConfig] = {}
        self._names_to_ids: Dict[str, str] = {}

    def register_type(self, type_name: str, factory: Type[DataSource]) -> None:
        self._factories[type_name] = factory

    async def add_source(self, config: SourceConfig) -> None:
        validated = validate_source_config(config)
        if validated.connector_type not in self._factories:
            raise ValueError(f"Unknown source type: {validated.connector_type}")

        source = self._factories[validated.connector_type]()
        params = dict(validated.params)
        params.setdefault("source_name", validated.name)
        params.setdefault("source_id", validated.source_id)
        await source.connect(params)
        self._instances[validated.source_id] = source
        self._configs[validated.source_id] = validated
        self._names_to_ids[validated.name] = validated.source_id

    def _resolve_source_id(self, name_or_id: str) -> Optional[str]:
        if name_or_id in self._instances:
            return name_or_id
        return self._names_to_ids.get(name_or_id)

    async def remove_source(self, name: str) -> None:
        source_id = self._resolve_source_id(name)
        if source_id and source_id in self._instances:
            config = self._configs[source_id]
            await self._instances[source_id].disconnect()
            del self._instances[source_id]
            del self._configs[source_id]
            self._names_to_ids.pop(config.name, None)

    async def shutdown(self) -> None:
        for source in self._instances.values():
            await source.disconnect()
        self._instances.clear()
        self._configs.clear()
        self._names_to_ids.clear()

    def get_source(self, name: str) -> Optional[DataSource]:
        source_id = self._resolve_source_id(name)
        if source_id is None:
            return None
        return self._instances.get(source_id)

    def list_sources(self) -> List[str]:
        return list(self._names_to_ids.keys())

    async def get_source_info(self) -> List[SourceInfo]:
        result = []
        for source_id, source in self._instances.items():
            config = self._configs[source_id]
            try:
                count = await source.count()
                status = "connected"
            except Exception:
                count = None
                status = "error"
            result.append(
                SourceInfo(
                    source_id=config.source_id,
                    name=config.name,
                    type=config.connector_type,
                    enabled=config.enabled,
                    entry_count=count,
                    status=status,
                )
            )
        return result

    async def search_all(self, query: SearchQuery) -> List[HistoryEntry]:
        results: List[HistoryEntry] = []
        target_sources = query.sources or list(self._instances.keys())
        resolved_sources: List[str] = []
        seen = set()

        for source_name in target_sources:
            source_id = self._resolve_source_id(source_name)
            if source_id and source_id not in seen:
                resolved_sources.append(source_id)
                seen.add(source_id)

        for source_id in resolved_sources:
            source = self._instances.get(source_id)
            if source is None:
                continue
            try:
                entries = await source.search(query)
                results.extend(entries)
            except Exception:
                continue

        results.sort(key=lambda e: (e.timestamp, e.id), reverse=True)
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
            source_id = self._resolve_source_id(source_name)
            source = self._instances.get(source_id) if source_id else None
            if source:
                return await source.list_entries(limit=limit, offset=offset, project=project)
            return []

        for source in self._instances.values():
            try:
                entries = await source.list_entries(limit=limit + offset, project=project)
                results.extend(entries)
            except Exception:
                continue

        results.sort(key=lambda e: (e.timestamp, e.id), reverse=True)
        return results[offset : offset + limit]

    async def get_entry(self, source_name: str, entry_id: str) -> Optional[HistoryEntry]:
        source_id = self._resolve_source_id(source_name)
        source = self._instances.get(source_id) if source_id else None
        if source is None:
            return None
        return await source.get_entry(entry_id)

    async def list_all_projects(self) -> Dict[str, List[str]]:
        result: Dict[str, List[str]] = {}
        for source_id, source in self._instances.items():
            name = self._configs[source_id].name
            try:
                projects = await source.list_projects()
                result[name] = projects
            except Exception:
                result[name] = []
        return result
