from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Type

from cchistory.config import SourceConfig
from cchistory.connectors import (
    BraveConnector,
    ClaudeCodeConnector,
    Connector,
    HealthStatus,
    SourceHandle,
    validate_source_config,
)
from cchistory.connectors.config import SourceInstanceConfig
from cchistory.db import IndexRepository, RepositoryEventWriter
from cchistory.ingestion.orchestrator import IngestionOrchestrator

CONNECTOR_FACTORIES: Dict[str, Type[Connector]] = {
    "claude_code": ClaudeCodeConnector,
    "brave": BraveConnector,
    "chrome": BraveConnector,
}


@dataclass
class RegisteredConnector:
    config: SourceInstanceConfig
    connector: Connector
    handle: SourceHandle


@dataclass
class ConnectorRuntime:
    registered: Dict[str, RegisteredConnector] = field(default_factory=dict)

    @classmethod
    def from_source_configs(cls, source_configs: List[SourceConfig]) -> "ConnectorRuntime":
        runtime = cls()
        for source_config in source_configs:
            validated = validate_source_config(source_config)
            factory = CONNECTOR_FACTORIES.get(validated.connector_type)
            if factory is None:
                continue
            runtime.registered[validated.source_id] = RegisteredConnector(
                config=validated,
                connector=factory(validated),
                handle=SourceHandle(
                    source_id=validated.source_id,
                    connector_type=validated.connector_type,
                    name=validated.name,
                    metadata=dict(validated.params),
                ),
            )
        return runtime

    def list_source_ids(self) -> List[str]:
        return sorted(self.registered.keys())

    async def health_all(self) -> Dict[str, HealthStatus]:
        health: Dict[str, HealthStatus] = {}
        for source_id in self.list_source_ids():
            health[source_id] = await self.health(source_id)
        return health

    async def health(self, source_id: str) -> HealthStatus:
        registered = self.registered[source_id]
        return await registered.connector.health(registered.handle)

    def build_orchestrator(self, repository: IndexRepository) -> IngestionOrchestrator:
        orchestrator = IngestionOrchestrator(
            writer=RepositoryEventWriter(repository),
            state_store=repository,
        )
        for source_id in self.list_source_ids():
            registered = self.registered[source_id]
            if getattr(registered.config, "enabled", True):
                orchestrator.register_source(registered.connector, registered.handle)
        return orchestrator
