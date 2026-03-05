from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from cchistory.models import HistoryEntry, SearchQuery


class DataSource(ABC):
    """Abstract base class for all history data sources.

    All datasources operate in read-only mode - they never modify the
    underlying data. This is a core design principle.
    """

    name: str
    source_type: str  # "local_file", "database", "remote"

    @abstractmethod
    async def connect(self, params: Dict[str, Any]) -> None:
        """Initialize connection to the data source."""
        ...

    @abstractmethod
    async def disconnect(self) -> None:
        """Clean up resources."""
        ...

    @abstractmethod
    async def list_entries(
        self,
        limit: int = 50,
        offset: int = 0,
        project: Optional[str] = None,
    ) -> List[HistoryEntry]:
        """List history entries with pagination."""
        ...

    @abstractmethod
    async def get_entry(self, entry_id: str) -> Optional[HistoryEntry]:
        """Get a single entry by its source-specific ID."""
        ...

    @abstractmethod
    async def search(self, query: SearchQuery) -> List[HistoryEntry]:
        """Search entries matching the query."""
        ...

    @abstractmethod
    async def count(self) -> int:
        """Return total number of entries."""
        ...

    @abstractmethod
    async def list_projects(self) -> List[str]:
        """List all available projects/categories."""
        ...
