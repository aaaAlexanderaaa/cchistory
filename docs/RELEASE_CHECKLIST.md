# Release Checklist

## Schema and API Migration Checklist

1. Increment schema version or document why the current series remains valid.
2. Update compatibility docs when `/api/history`, `/api/search`, or
   `/api/entries` behavior changes.
3. Add or update OpenAPI examples for any new request/response model.
4. Confirm ID round-trip and pagination tests still pass.
5. Run distill, ingest, and benchmark suites before release.
6. Review `tasks.csv` for any KR still marked `todo` or `blocked`.

## Pre-Release Commands

```bash
pytest server/tests
cd server && python scripts/benchmark_index.py
cd web && npm run build
```
