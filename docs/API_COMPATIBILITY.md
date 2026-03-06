# API Compatibility Rules

This document defines compatibility rules while CCHistory transitions from the
MVP `/api/history` surface to the target `/api/entries` contract.

## Contract Rules

1. `schema_version` is required on canonical response models and follows the
   active `0.2.x` series.
2. `entry_id` is the stable API identifier and is equal to the legacy `id`
   field during the compatibility window.
3. `source_id` identifies the configured source instance, not the origin
   system's raw primary key.
4. `origin_primary_key` and `origin_payload_ref` preserve reversible upstream
   provenance for detail fetch and audit flows.
5. List and search payloads may continue returning legacy full-entry shapes
   until `/api/entries` replaces `/api/history`, but the identity fields above
   must remain stable.

## Transition Rules

1. Existing `/api/history` consumers keep working until `/api/entries` reaches
   feature parity and regression checks pass.
2. New code should treat `entry_id` as the canonical identifier even if it also
   reads `id` from compatibility payloads.
3. Any contract change requires a `schema_version` update and a migration note.
4. Pagination order must be deterministic for identical requests.
