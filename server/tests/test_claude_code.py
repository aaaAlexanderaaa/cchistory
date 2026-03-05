from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from cchistory.datasources.claude_code import ClaudeCodeSource
from cchistory.models import SearchQuery


@pytest.fixture
def sample_session_dir():
    with tempfile.TemporaryDirectory() as tmpdir:
        project_dir = Path(tmpdir) / "my-project"
        project_dir.mkdir(parents=True)

        session_file = project_dir / "session1.jsonl"
        records = [
            {
                "type": "human",
                "content": "Help me fix the login bug",
                "timestamp": 1700000000,
            },
            {
                "type": "assistant",
                "content": [{"type": "text", "text": "I'll look at the login code."}],
                "timestamp": 1700000010,
            },
            {
                "type": "human",
                "content": "Can you also add error handling?",
                "timestamp": 1700000020,
            },
            {
                "type": "assistant",
                "content": "Sure, I'll add try-catch blocks.",
                "timestamp": 1700000030,
            },
        ]
        with open(session_file, "w") as f:
            for r in records:
                f.write(json.dumps(r) + "\n")

        yield tmpdir


@pytest.mark.asyncio
async def test_connect_and_count(sample_session_dir):
    source = ClaudeCodeSource()
    await source.connect({"base_dir": sample_session_dir})
    count = await source.count()
    assert count == 1
    await source.disconnect()


@pytest.mark.asyncio
async def test_list_entries(sample_session_dir):
    source = ClaudeCodeSource()
    await source.connect({"base_dir": sample_session_dir})
    entries = await source.list_entries()
    assert len(entries) == 1
    entry = entries[0]
    assert entry.source == "Claude Code"
    assert entry.type.value == "conversation"
    assert entry.messages is not None
    assert len(entry.messages) == 4
    assert "login bug" in entry.title.lower()
    await source.disconnect()


@pytest.mark.asyncio
async def test_search(sample_session_dir):
    source = ClaudeCodeSource()
    await source.connect({"base_dir": sample_session_dir})

    query = SearchQuery(query="error handling")
    results = await source.search(query)
    assert len(results) == 1

    query = SearchQuery(query="nonexistent_term_xyz")
    results = await source.search(query)
    assert len(results) == 0

    await source.disconnect()


@pytest.mark.asyncio
async def test_list_projects(sample_session_dir):
    source = ClaudeCodeSource()
    await source.connect({"base_dir": sample_session_dir})
    projects = await source.list_projects()
    assert len(projects) == 1
    assert "my-project" in projects[0]
    await source.disconnect()
