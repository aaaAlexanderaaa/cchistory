# `/api/history` to `/api/entries` Migration

This note records the contract migration path from the MVP history endpoints to
the target index-backed entries API.

## Endpoint Mapping

- `GET /api/history` -> `GET /api/entries`
- `GET /api/history/{source_name}/{entry_id}` -> `GET /api/entries/{entry_id}`
- `GET /api/search` remains read-compatible during the transition, then moves
  to index-backed retrieval with summary payloads and snippets.

## Field Mapping

- Keep reading `id` during the compatibility window, but prefer `entry_id`.
- Treat `source_id` as the configured source instance identifier.
- Use `origin_primary_key` for reversible connector fetch keys.
- Use `origin_payload_ref` for source file path or URL provenance.

## Rollout Guardrails

1. Do not remove `/api/history` until `/api/entries` has parity coverage.
2. Do not switch the UI to `/api/entries` until lazy detail loading is ready.
3. Do not remove the direct fan-out path until indexed parity tests pass.
