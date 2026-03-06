# Operations Runbook

## Connector Failures

1. Check `/api/ingest/status` for `error_message`, `lag_seconds`, and `cursor`.
2. Verify source paths exist and are readable.
3. For browser sources, confirm the history DB is present and not corrupted.
4. Re-run a targeted ingest with `POST /api/ingest/run` and inspect the latest
   structured ingest log line.

## Reindex Flow

1. Stop the app.
2. Back up the current SQLite index.
3. Delete the index file if a full rebuild is required.
4. Restart the app so migrations recreate the schema.
5. Trigger `POST /api/ingest/run` to repopulate the index.
6. Confirm `/api/sources` shows expected `entry_count` and acceptable drift.

## Drift Investigation

1. Compare live source counts with indexed counts in source metadata.
2. If drift is positive, run incremental ingest again.
3. If drift persists, inspect connector logs and source-specific parsing errors.
4. Use distill/source/project filters to sample missing entries and confirm
   whether the issue is scan, normalize, or upsert related.

## Recovery Guardrails

- Do not remove compatibility routes until indexed parity tests pass.
- Do not change schema/API contracts without updating migration docs and the
  release checklist.
- Keep `tasks.csv` synchronized with any operational or schema milestone.
