# CCHistory SLO Targets

## Indexed Read Path

- `GET /api/entries` list p95: `<= 60 ms` on the synthetic benchmark dataset.
- `GET /api/search` search p95: `<= 90 ms` on the synthetic benchmark dataset.

## Ingest Path

- Single-source incremental ingest should emit structured duration and lag fields
  for every run.
- Connector health lag should be available in `/api/sources` and
  `/api/ingest/status`.

## Verification

- Local benchmark script:
  `cd server && python scripts/benchmark_index.py --entries 2500 --iterations 25`
- Automated gate:
  `pytest server/tests/test_benchmarks.py`
