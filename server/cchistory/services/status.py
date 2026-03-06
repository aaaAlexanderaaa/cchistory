from __future__ import annotations

from typing import Any, Dict, List, Optional

from cchistory.db import IndexRepository
from cchistory.ingestion import ConnectorRuntime
from cchistory.ops import collect_index_drift
from cchistory.schema import SourceInfo


def _as_bool(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes"}:
            return True
        if normalized in {"false", "0", "no"}:
            return False
    return None


async def collect_source_info(
    repository: IndexRepository,
    runtime: Optional[ConnectorRuntime],
    registry: Optional[Any] = None,
) -> List[SourceInfo]:
    snapshots = {snapshot["source_id"]: snapshot for snapshot in repository.list_source_snapshots()}
    health_map = await runtime.health_all() if runtime is not None else {}
    drift_rows = {
        row["source_id"]: row for row in await collect_index_drift(repository, registry)
    }

    source_ids = set(snapshots.keys())
    if runtime is not None:
        source_ids.update(runtime.list_source_ids())

    source_info: List[SourceInfo] = []
    for source_id in sorted(source_ids):
        snapshot = snapshots.get(source_id, {})
        registered = runtime.registered.get(source_id) if runtime is not None else None
        health = health_map.get(source_id)

        source_metadata: Dict[str, Any] = dict(snapshot.get("metadata", {}))
        state_metadata: Dict[str, Any] = dict(snapshot.get("state_metadata", {}))
        drift_metadata = drift_rows.get(source_id)
        if health is not None:
            source_metadata.update(health.metadata)
        if drift_metadata:
            source_metadata.update(drift_metadata)

        enabled = snapshot.get("enabled")
        if enabled is None and registered is not None:
            enabled = registered.config.enabled

        has_more = _as_bool(state_metadata.get("has_more"))
        source_info.append(
            SourceInfo(
                source_id=source_id,
                name=snapshot.get("name") or (registered.handle.name if registered else source_id),
                type=snapshot.get("type")
                or (registered.handle.connector_type if registered else "unknown"),
                enabled=bool(enabled) if enabled is not None else True,
                entry_count=snapshot.get("entry_count", 0),
                status=(
                    "disabled"
                    if enabled is False
                    else health.status.value
                    if health is not None
                    else snapshot.get("last_run_status") or "unknown"
                ),
                last_run_status=snapshot.get("last_run_status"),
                last_run_at=snapshot.get("last_run_at"),
                last_success_at=(
                    health.last_success_at
                    if health is not None
                    else state_metadata.get("last_success_at")
                ),
                lag_seconds=(
                    health.lag_seconds
                    if health is not None
                    else state_metadata.get("lag_seconds")
                ),
                cursor=snapshot.get("cursor"),
                has_more=has_more,
                error_message=(
                    health.message if health is not None and health.message else snapshot.get("error_message")
                ),
                metadata=source_metadata,
            )
        )
    return source_info
