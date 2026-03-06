from __future__ import annotations

from typing import Any, Dict, List, Optional

from cchistory.db import IndexRepository


async def collect_index_drift(
    repository: IndexRepository,
    registry: Optional[Any],
) -> List[Dict[str, int]]:
    if registry is None:
        return []

    drift_rows: List[Dict[str, int]] = []
    for snapshot in repository.list_source_snapshots():
        source = registry.get_source(snapshot["source_id"])
        if source is None:
            continue
        live_count = await source.count()
        indexed_count = snapshot["entry_count"]
        drift_rows.append(
            {
                "source_id": snapshot["source_id"],
                "live_entry_count": live_count,
                "indexed_entry_count": indexed_count,
                "drift_count": live_count - indexed_count,
            }
        )
    return drift_rows
