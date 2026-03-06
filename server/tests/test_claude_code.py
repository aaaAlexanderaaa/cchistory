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


@pytest.mark.asyncio
async def test_malformed_records_are_skipped():
    with tempfile.TemporaryDirectory() as tmpdir:
        project_dir = Path(tmpdir) / "bad-project"
        project_dir.mkdir(parents=True)
        session_file = project_dir / "session1.jsonl"
        session_file.write_text(
            "\n".join(
                [
                    '{"type":"human","content":"Trace malformed session","timestamp":1700000000}',
                    '{"type":"assistant","content":"Good line","timestamp":1700000010}',
                    '{"type":"assistant","content":"Broken json"',
                    '{"role":"tool","name":"grep","content":"tool output","timestamp":1700000020}',
                ]
            ),
            encoding="utf-8",
        )

        source = ClaudeCodeSource()
        await source.connect({"base_dir": tmpdir})
        entries = await source.list_entries()

        assert len(entries) == 1
        assert entries[0].messages is not None
        assert len(entries[0].messages) == 2
        assert entries[0].messages[-1].role.value == "assistant"
        assert entries[0].messages[-1].content == "Good line"
        await source.disconnect()


@pytest.mark.asyncio
async def test_nested_claude_message_payloads_are_parsed():
    with tempfile.TemporaryDirectory() as tmpdir:
        project_dir = Path(tmpdir) / "nested-project"
        project_dir.mkdir(parents=True)
        session_file = project_dir / "session1.jsonl"
        records = [
            {
                "type": "user",
                "timestamp": "2026-03-06T08:00:00Z",
                "message": {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "Investigate why the auth cookie parser drops secure cookies.",
                        }
                    ],
                },
            },
            {
                "type": "assistant",
                "timestamp": "2026-03-06T08:00:03Z",
                "message": {
                    "role": "assistant",
                    "content": [
                        {"type": "text", "text": "I will inspect the middleware chain."},
                        {
                            "type": "tool_use",
                            "id": "toolu_bash_1",
                            "name": "Bash",
                            "input": {
                                "description": "Search for cookie parsing logic",
                                "command": "rg \"secure cookies\" src",
                            },
                        },
                    ],
                },
            },
            {
                "type": "user",
                "timestamp": "2026-03-06T08:00:06Z",
                "message": {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": "toolu_bash_1",
                            "content": "src/auth/cookies.ts:42: secure flag",
                        },
                    ],
                },
            },
        ]
        with open(session_file, "w", encoding="utf-8") as f:
            for record in records:
                f.write(json.dumps(record) + "\n")

        source = ClaudeCodeSource()
        await source.connect({"base_dir": tmpdir})
        entries = await source.list_entries()

        assert len(entries) == 1
        entry = entries[0]
        assert "auth cookie parser" in entry.title.lower()
        assert "auth cookie parser" in entry.content.lower()
        assert entry.messages is not None
        assert len(entry.messages) == 2
        assert entry.messages[0].content.startswith("Investigate why the auth cookie parser")
        assert entry.messages[1].role.value == "assistant"
        assert entry.messages[1].content == "I will inspect the middleware chain."

        results = await source.search(SearchQuery(query="middleware chain"))
        assert len(results) == 1
        await source.disconnect()


@pytest.mark.asyncio
async def test_subagent_sessions_merge_into_parent_entry():
    with tempfile.TemporaryDirectory() as tmpdir:
        project_dir = Path(tmpdir) / "merged-project"
        project_dir.mkdir(parents=True)

        parent_file = project_dir / "session1.jsonl"
        parent_records = [
            {
                "type": "user",
                "timestamp": "2026-03-06T08:00:00Z",
                "message": {
                    "role": "user",
                    "content": [{"type": "text", "text": "Plan the migration rollout."}],
                },
            },
            {
                "type": "assistant",
                "timestamp": "2026-03-06T08:00:05Z",
                "message": {
                    "role": "assistant",
                    "content": [{"type": "text", "text": "I will break this into phases."}],
                },
            },
        ]
        with open(parent_file, "w", encoding="utf-8") as f:
            for record in parent_records:
                f.write(json.dumps(record) + "\n")

        subagent_dir = project_dir / "session1" / "subagents"
        subagent_dir.mkdir(parents=True)
        subagent_file = subagent_dir / "agent-a123.jsonl"
        subagent_records = [
            {
                "type": "user",
                "timestamp": "2026-03-06T08:00:06Z",
                "message": {
                    "role": "user",
                    "content": [{"type": "text", "text": "Draft rollback steps."}],
                },
            },
            {
                "type": "assistant",
                "timestamp": "2026-03-06T08:00:09Z",
                "message": {
                    "role": "assistant",
                    "content": [{"type": "text", "text": "Rollback requires restoring the previous release tag."}],
                },
            },
        ]
        with open(subagent_file, "w", encoding="utf-8") as f:
            for record in subagent_records:
                f.write(json.dumps(record) + "\n")

        source = ClaudeCodeSource()
        await source.connect({"base_dir": tmpdir})

        entries = await source.list_entries()
        assert len(entries) == 1

        entry = entries[0]
        assert entry.messages is not None
        assert len(entry.messages) == 2
        assert entry.messages[0].role.value == "user"
        assert entry.messages[0].content == "Plan the migration rollout."
        assert entry.messages[1].role.value == "assistant"
        assert "I will break this into phases." in entry.messages[1].content
        assert "Subagent agent-a123:" in entry.messages[1].content
        assert "Rollback requires restoring the previous release tag." in entry.messages[1].content
        assert entry.metadata["subagent_count"] == 1

        results = await source.search(SearchQuery(query="previous release tag"))
        assert len(results) == 1
        await source.disconnect()


@pytest.mark.asyncio
async def test_injected_wrapper_is_split_and_retyped():
    with tempfile.TemporaryDirectory() as tmpdir:
        project_dir = Path(tmpdir) / "wrapped-project"
        project_dir.mkdir(parents=True)
        session_file = project_dir / "session1.jsonl"
        session_file.write_text(
            "\n".join(
                [
                    json.dumps(
                        {
                            "type": "user",
                            "timestamp": "2026-03-06T08:00:00Z",
                            "permissionMode": "plan",
                            "message": {
                                "role": "user",
                                "content": [
                                    {
                                        "type": "text",
                                        "text": (
                                            "[Assistant Rules - You MUST follow these instructions]\n"
                                            "[Available Skills]\n- cron\n\n"
                                            "[User Request]\n"
                                            "深入分析一下2026年3月份以来的全球政治经济局势"
                                        ),
                                    }
                                ],
                            },
                        }
                    ),
                    json.dumps(
                        {
                            "type": "assistant",
                            "timestamp": "2026-03-06T08:00:03Z",
                            "message": {
                                "role": "assistant",
                                "model": "claude-opus-4-6",
                                "stop_reason": "tool_use",
                                "content": [{"type": "text", "text": "我先整理研究框架。"}],
                            },
                        }
                    ),
                ]
            ),
            encoding="utf-8",
        )

        source = ClaudeCodeSource()
        await source.connect({"base_dir": tmpdir})
        entries = await source.list_entries()

        assert len(entries) == 1
        entry = entries[0]
        assert entry.title == "深入分析一下2026年3月份以来的全球政治经济局势"
        assert entry.metadata["termination_reason"] == "tool_use"
        assert entry.metadata["prompt_injection_count"] == 1
        assert entry.messages is not None
        assert entry.messages[0].role.value == "system"
        assert entry.messages[0].metadata["block_type"] == "prompt_injection"
        assert entry.messages[1].role.value == "user"
        assert entry.messages[1].content == "深入分析一下2026年3月份以来的全球政治经济局势"
        assert entry.messages[2].role.value == "assistant"
        assert entry.messages[2].metadata["stop_reason"] == "tool_use"

        results = await source.search(SearchQuery(query="Assistant Rules"))
        assert len(results) == 0
        results = await source.search(SearchQuery(query="全球政治经济"))
        assert len(results) == 1
        await source.disconnect()


@pytest.mark.asyncio
async def test_continuation_and_interruption_are_system_messages():
    with tempfile.TemporaryDirectory() as tmpdir:
        project_dir = Path(tmpdir) / "continued-project"
        project_dir.mkdir(parents=True)
        session_file = project_dir / "session1.jsonl"
        session_file.write_text(
            "\n".join(
                [
                    json.dumps(
                        {
                            "type": "user",
                            "timestamp": "2026-03-06T08:00:00Z",
                            "isCompactSummary": True,
                            "isVisibleInTranscriptOnly": True,
                            "message": {
                                "role": "user",
                                "content": (
                                    "This session is being continued from a previous conversation "
                                    "that ran out of context. The summary below covers the earlier portion."
                                ),
                            },
                        }
                    ),
                    json.dumps(
                        {
                            "type": "system",
                            "timestamp": "2026-03-06T08:00:01Z",
                            "subtype": "compact_boundary",
                            "content": "Conversation compacted",
                            "compactMetadata": {"trigger": "auto", "preTokens": 12345},
                            "level": "info",
                        }
                    ),
                    json.dumps(
                        {
                            "type": "user",
                            "timestamp": "2026-03-06T08:00:02Z",
                            "message": {
                                "role": "user",
                                "content": [{"type": "text", "text": "[Request interrupted by user for tool use]"}],
                            },
                        }
                    ),
                    json.dumps(
                        {
                            "type": "assistant",
                            "timestamp": "2026-03-06T08:00:03Z",
                            "message": {
                                "role": "assistant",
                                "model": "claude-opus-4-6",
                                "stop_reason": "stop_sequence",
                                "stop_sequence": "",
                                "content": [{"type": "text", "text": "继续完成剩余任务。"}],
                            },
                        }
                    ),
                ]
            ),
            encoding="utf-8",
        )

        source = ClaudeCodeSource()
        await source.connect({"base_dir": tmpdir})
        entries = await source.list_entries()

        assert len(entries) == 1
        entry = entries[0]
        assert entry.metadata["compaction_count"] == 2
        assert entry.metadata["termination_reason"] == "stop_sequence"
        assert entry.messages is not None
        assert entry.messages[0].metadata["block_type"] == "continuation_summary"
        assert entry.messages[0].role.value == "system"
        assert entry.messages[1].metadata["system_subtype"] == "compact_boundary"
        assert entry.messages[1].role.value == "system"
        assert entry.messages[2].metadata["block_type"] == "request_interruption"
        assert entry.messages[2].metadata["termination_reason"] == "user_interrupted_for_tool_use"
        await source.disconnect()
