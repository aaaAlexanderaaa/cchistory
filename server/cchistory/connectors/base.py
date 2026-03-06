from __future__ import annotations

from abc import ABC, abstractmethod

from cchistory.connectors.models import HealthStatus, RawRecord, ScanBatch, SourceHandle


class Connector(ABC):
    connector_type: str

    @abstractmethod
    async def discover(self) -> list[SourceHandle]:
        """Return available source instances for this connector."""
        ...

    @abstractmethod
    async def health(self, source: SourceHandle) -> HealthStatus:
        """Return current health for a specific source instance."""
        ...

    @abstractmethod
    async def scan_since(self, source: SourceHandle, cursor: str | None) -> ScanBatch:
        """Return normalized events newer than the supplied cursor."""
        ...

    @abstractmethod
    async def fetch(self, source: SourceHandle, origin_primary_key: str) -> RawRecord:
        """Fetch the raw upstream payload for a previously discovered record."""
        ...
