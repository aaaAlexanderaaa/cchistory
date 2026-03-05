from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from cchistory.config import SourceConfig
from cchistory.datasources.claude_code import ClaudeCodeSource
from cchistory.datasources.registry import SourceRegistry
from cchistory.main import app


@pytest.fixture
async def client_with_data():
    with tempfile.TemporaryDirectory() as tmpdir:
        project_dir = Path(tmpdir) / "test-project"
        project_dir.mkdir(parents=True)

        session_file = project_dir / "abc123.jsonl"
        records = [
            {"type": "human", "content": "Write a hello world", "timestamp": 1700000000},
            {"type": "assistant", "content": "Here it is: print('hello')", "timestamp": 1700000005},
        ]
        with open(session_file, "w") as f:
            for r in records:
                f.write(json.dumps(r) + "\n")

        registry = SourceRegistry()
        registry.register_type("claude_code", ClaudeCodeSource)
        await registry.add_source(
            SourceConfig(type="claude_code", name="Test Claude", params={"base_dir": tmpdir})
        )
        app.state.registry = registry

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield client

        await registry.shutdown()


@pytest.mark.asyncio
async def test_health(client_with_data):
    resp = await client_with_data.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_list_sources(client_with_data):
    resp = await client_with_data.get("/api/sources")
    assert resp.status_code == 200
    sources = resp.json()
    assert len(sources) >= 1
    assert sources[0]["name"] == "Test Claude"


@pytest.mark.asyncio
async def test_list_history(client_with_data):
    resp = await client_with_data.get("/api/history")
    assert resp.status_code == 200
    entries = resp.json()
    assert len(entries) >= 1
    assert entries[0]["source"] == "Claude Code"


@pytest.mark.asyncio
async def test_search(client_with_data):
    resp = await client_with_data.get("/api/search", params={"q": "hello world"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1
    assert "hello world" in data["query"]


@pytest.mark.asyncio
async def test_search_no_results(client_with_data):
    resp = await client_with_data.get("/api/search", params={"q": "zzz_nonexistent_zzz"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 0
