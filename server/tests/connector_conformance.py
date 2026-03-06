from __future__ import annotations

from typing import Tuple

from cchistory.connectors import Connector, HealthStatus, RawRecord, ScanBatch, SourceHandle


async def assert_connector_conformance(
    connector: Connector,
) -> Tuple[SourceHandle, HealthStatus, ScanBatch, RawRecord]:
    discovered = await connector.discover()
    assert discovered

    handle = discovered[0]
    health = await connector.health(handle)
    assert health.source_id == handle.source_id
    assert health.connector_type == handle.connector_type

    batch = await connector.scan_since(handle, None)
    assert batch.scanned_count == len(batch.events)
    assert batch.scanned_count >= 1
    assert batch.next_cursor is not None

    event = batch.events[0]
    assert event.source_id == handle.source_id
    assert event.entry.source_id == handle.source_id
    assert event.origin_primary_key

    record = await connector.fetch(handle, event.origin_primary_key)
    assert record.source_id == handle.source_id
    assert record.origin_primary_key == event.origin_primary_key

    return handle, health, batch, record
