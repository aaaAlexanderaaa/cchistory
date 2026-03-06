from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from cchistory.db import IndexRepository
from cchistory.ops import (
    assert_benchmark_thresholds,
    run_index_benchmarks,
    seed_benchmark_dataset,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark list/search latency on the SQLite index.")
    parser.add_argument("--entries", type=int, default=2500)
    parser.add_argument("--iterations", type=int, default=25)
    parser.add_argument("--list-p95-ms", type=float, default=60.0)
    parser.add_argument("--search-p95-ms", type=float, default=90.0)
    args = parser.parse_args()

    with tempfile.TemporaryDirectory() as tmpdir:
        repository = IndexRepository(f"sqlite:///{Path(tmpdir) / 'index.sqlite3'}")
        seed_benchmark_dataset(repository, entry_count=args.entries)
        result = run_index_benchmarks(repository, iterations=args.iterations)
        assert_benchmark_thresholds(
            result,
            list_p95_ms=args.list_p95_ms,
            search_p95_ms=args.search_p95_ms,
        )
        print(json.dumps(result.__dict__, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
