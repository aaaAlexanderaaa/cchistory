from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from time import perf_counter
from typing import List

from cchistory.db import IndexRepository


@dataclass
class BenchmarkResult:
    dataset_size: int
    iterations: int
    list_p95_ms: float
    search_p95_ms: float


def seed_benchmark_dataset(repository: IndexRepository, entry_count: int = 2000) -> None:
    base = datetime(2026, 3, 6, tzinfo=timezone.utc)
    conn = repository._connect()
    try:
        conn.execute(
            """
            INSERT INTO sources (source_id, connector_type, name, enabled, metadata)
            VALUES (?, ?, ?, 1, ?)
            ON CONFLICT(source_id) DO UPDATE SET
                connector_type = excluded.connector_type,
                name = excluded.name,
                enabled = excluded.enabled,
                metadata = excluded.metadata
            """,
            ("benchmark_source", "benchmark", "Benchmark Source", "{}"),
        )
        for index in range(entry_count):
            timestamp = (base + timedelta(seconds=index)).isoformat()
            topic = "auth" if index % 3 == 0 else "search"
            entry_id = f"benchmark:entry:{index}"
            content = (
                f"Benchmark record {index} tracks {topic} middleware history and indexed retrieval latency."
            )
            tags = ["benchmark", topic]

            conn.execute(
                """
                INSERT INTO entries (
                    entry_id, source_id, origin_primary_key, origin_payload_ref, schema_version,
                    type, title, url, project, timestamp, end_timestamp, duration_seconds,
                    content, snippet, metadata, tags_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    entry_id,
                    "benchmark_source",
                    f"bench/session-{index}.jsonl",
                    f"/tmp/bench/session-{index}.jsonl",
                    "0.2.0",
                    "conversation",
                    f"{topic.title()} regression #{index}",
                    None,
                    f"bench/project-{index % 5}",
                    timestamp,
                    None,
                    None,
                    content,
                    content[:240],
                    "{}",
                    json.dumps(tags),
                ),
            )
            conn.execute(
                """
                INSERT INTO entry_chunks (chunk_id, entry_id, position, text, metadata)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    f"{entry_id}:chunk:0",
                    entry_id,
                    0,
                    content,
                    "{}",
                ),
            )
            conn.execute(
                """
                INSERT INTO entry_fts (entry_id, title, content, chunks)
                VALUES (?, ?, ?, ?)
                """,
                (
                    entry_id,
                    f"{topic.title()} regression #{index}",
                    content,
                    content,
                ),
            )
        conn.commit()
    finally:
        conn.close()


def _p95(samples: List[float]) -> float:
    ordered = sorted(samples)
    index = max(0, int(len(ordered) * 0.95) - 1)
    return ordered[index]


def run_index_benchmarks(
    repository: IndexRepository,
    iterations: int = 25,
) -> BenchmarkResult:
    list_samples: List[float] = []
    search_samples: List[float] = []

    for _ in range(iterations):
        started = perf_counter()
        repository.list_entry_page(limit=50)
        list_samples.append((perf_counter() - started) * 1000)

        started = perf_counter()
        repository.search_entries("auth middleware", limit=20)
        search_samples.append((perf_counter() - started) * 1000)

    return BenchmarkResult(
        dataset_size=repository.count_rows("entries"),
        iterations=iterations,
        list_p95_ms=round(_p95(list_samples), 3),
        search_p95_ms=round(_p95(search_samples), 3),
    )


def assert_benchmark_thresholds(
    result: BenchmarkResult,
    list_p95_ms: float,
    search_p95_ms: float,
) -> None:
    if result.list_p95_ms > list_p95_ms:
        raise AssertionError(
            f"list p95 {result.list_p95_ms}ms exceeded threshold {list_p95_ms}ms"
        )
    if result.search_p95_ms > search_p95_ms:
        raise AssertionError(
            f"search p95 {result.search_p95_ms}ms exceeded threshold {search_p95_ms}ms"
        )
