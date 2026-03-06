from __future__ import annotations

import tempfile
from pathlib import Path

from cchistory.db import IndexRepository
from cchistory.ops import (
    assert_benchmark_thresholds,
    run_index_benchmarks,
    seed_benchmark_dataset,
)


def test_index_benchmarks_stay_within_slo_thresholds():
    with tempfile.TemporaryDirectory() as tmpdir:
        repository = IndexRepository(f"sqlite:///{Path(tmpdir) / 'index.sqlite3'}")
        seed_benchmark_dataset(repository, entry_count=1500)

        result = run_index_benchmarks(repository, iterations=15)

        assert result.dataset_size == 1500
        assert_benchmark_thresholds(result, list_p95_ms=60.0, search_p95_ms=90.0)
