#!/usr/bin/env python3

from __future__ import annotations

import json
import re
import shutil
import sqlite3
import subprocess
import sys
from collections import OrderedDict
from pathlib import Path
from typing import Any, Callable


REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = REPO_ROOT / "mock_data"
HOME = Path("/Users/alex_m4")
MOCK_HOME = "/Users/mock_user"


def replace_many(text: str, replacements: dict[str, str]) -> str:
    result = text
    for source, target in sorted(replacements.items(), key=lambda item: len(item[0]), reverse=True):
        result = result.replace(source, target)
    return result


def sanitize_text(text: str, replacements: dict[str, str]) -> str:
    result = replace_many(text, replacements)
    result = re.sub(r"/Users/[^/\s\"')]+", MOCK_HOME, result)
    result = result.replace("alex_m4", "mock_user")
    result = result.replace("chatGPTBox", "chat-ui-kit")
    result = result.replace("cchistory", "history-lab")
    result = result.replace("my_spl", "log-query-validator")
    result = result.replace("gitea.whatif.top", "git.example.invalid")
    result = result.replace("github.com/alex_m4", "github.example.invalid/mock-user")
    result = re.sub(
        r"https://git\.example\.invalid/[^\s\"')]+",
        "https://git.example.invalid/acme/log-query-validator.git",
        result,
    )
    result = re.sub(
        r"/private/var/folders/[^\"\\s]+?/T(?=[^A-Za-z0-9]|$)",
        "/private/var/folders/mock/T",
        result,
    )
    result = re.sub(
        r"/var/folders/[^\"\\s]+?/T(?=[^A-Za-z0-9]|$)",
        "/var/folders/mock/T",
        result,
    )
    result = re.sub(
        r"/private/tmp/com\.apple\.launchd\.[^/]+/Listeners",
        "/private/tmp/com.apple.launchd.mock/Listeners",
        result,
    )
    result = re.sub(
        r'/var/folders/[^"\s]+/T/vscode-git-[A-Za-z0-9]+\.sock',
        "/var/folders/mock/T/vscode-git-mock.sock",
        result,
    )
    result = re.sub(
        r'("VSCODE_GIT_IPC_AUTH_TOKEN","value":")([^"]+)(")',
        r'\1mock-git-ipc-auth-token\3',
        result,
    )
    return result


def sanitize_value(value: Any, replacements: dict[str, str]) -> Any:
    if isinstance(value, str):
        return sanitize_text(value, replacements)
    if isinstance(value, list):
        return [sanitize_value(item, replacements) for item in value]
    if isinstance(value, dict):
        return {key: sanitize_value(item, replacements) for key, item in value.items()}
    return value


def extract_text(record: dict[str, Any]) -> str:
    pieces: list[str] = []
    if record.get("type") == "response_item":
        payload = record.get("payload") or {}
        if payload.get("type") == "message":
            for item in payload.get("content", []):
                if isinstance(item, dict):
                    text = item.get("text")
                    if isinstance(text, str):
                        pieces.append(text)
    elif record.get("type") in {"user", "assistant", "developer", "system"}:
        message = record.get("message") or {}
        content = message.get("content")
        if isinstance(content, str):
            pieces.append(content)
        elif isinstance(content, list):
            for item in content:
                if isinstance(item, dict):
                    text = item.get("text")
                    if isinstance(text, str):
                        pieces.append(text)
    return "\n".join(pieces)


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            records.append(json.loads(line))
    return records


def select_records(
    records: list[dict[str, Any]],
    *,
    keep_first: int,
    max_records: int,
    long_text_threshold: int,
    extra_matcher: Callable[[dict[str, Any]], bool] | None = None,
) -> list[dict[str, Any]]:
    selected: "OrderedDict[int, dict[str, Any]]" = OrderedDict()

    for index, record in enumerate(records[:keep_first]):
        selected[index] = record

    for index, record in enumerate(records):
        text = extract_text(record)
        if len(text) >= long_text_threshold:
            selected.setdefault(index, record)
        if extra_matcher and extra_matcher(record):
            selected.setdefault(index, record)

    return [selected[index] for index in list(selected.keys())[:max_records]]


def select_codex_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def matcher(record: dict[str, Any]) -> bool:
        payload = record.get("payload") or {}
        text = extract_text(record)
        if "Review findings" in text or "candidate" in text or "unlink" in text:
            return True
        if record.get("type") == "event_msg" and (payload.get("type") == "token_count" or payload.get("type") == "task_started"):
            return True
        return False

    return select_records(
        records,
        keep_first=12,
        max_records=24,
        long_text_threshold=1800,
        extra_matcher=matcher,
    )


def select_claude_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def matcher(record: dict[str, Any]) -> bool:
        if record.get("type") == "file-history-snapshot":
            return True
        message = record.get("message") or {}
        if record.get("type") == "assistant" and record.get("isApiErrorMessage"):
            return True
        content = message.get("content")
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("type") in {"tool_use", "tool_result"}:
                    return True
        return False

    return select_records(
        records,
        keep_first=12,
        max_records=28,
        long_text_threshold=900,
        extra_matcher=matcher,
    )


def remove_structured_cwd(record: dict[str, Any]) -> dict[str, Any]:
    clone = json.loads(json.dumps(record))
    if clone.get("type") == "session_meta":
        payload = clone.get("payload") or {}
        payload.pop("cwd", None)
        clone["payload"] = payload
    if clone.get("type") == "turn_context":
        payload = clone.get("payload") or {}
        payload.pop("cwd", None)
        clone["payload"] = payload
    return clone


def write_jsonl(
    source_path: Path,
    destination_path: Path,
    records: list[dict[str, Any]],
    replacements: dict[str, str],
    mutator: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
) -> None:
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    with destination_path.open("w", encoding="utf-8") as handle:
        for record in records:
            current = mutator(record) if mutator else record
            sanitized = sanitize_value(current, replacements)
            handle.write(json.dumps(sanitized, ensure_ascii=False))
            handle.write("\n")


def write_json(destination_path: Path, payload: Any) -> None:
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    destination_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_jsonl_records(destination_path: Path, records: list[dict[str, Any]]) -> None:
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    with destination_path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False))
            handle.write("\n")


def sanitize_sqlite_file(path: Path, replacements: dict[str, str]) -> None:
    connection = sqlite3.connect(path)
    try:
        cursor = connection.cursor()
        # Rewrite deleted bytes too so original paths do not survive in free pages.
        cursor.execute("PRAGMA secure_delete = ON")
        table_names = [
            row[0]
            for row in cursor.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            ).fetchall()
        ]
        for table_name in table_names:
            columns = [row[1] for row in cursor.execute(f'PRAGMA table_info("{table_name}")').fetchall()]
            if not {"key", "value"}.issubset(columns):
                continue
            rows = cursor.execute(f'SELECT rowid, key, value FROM "{table_name}"').fetchall()
            for rowid, key, value in rows:
                next_key = sanitize_text(key, replacements) if isinstance(key, str) else key
                next_value = value
                if isinstance(value, str):
                    next_value = sanitize_text(value, replacements)
                elif isinstance(value, (bytes, bytearray, memoryview)):
                    raw = bytes(value)
                    try:
                        decoded = raw.decode("utf-8")
                    except UnicodeDecodeError:
                        decoded = None
                    if decoded is not None:
                        next_value = sanitize_text(decoded, replacements).encode("utf-8")
                if next_key != key or next_value != value:
                    cursor.execute(
                        f'UPDATE "{table_name}" SET key = ?, value = ? WHERE rowid = ?',
                        (next_key, next_value, rowid),
                    )
        connection.commit()
        cursor.execute("VACUUM")
        connection.commit()
    finally:
        connection.close()


def copy_text_file(source_path: Path, destination_path: Path, replacements: dict[str, str]) -> None:
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    text = source_path.read_text(encoding="utf-8")
    destination_path.write_text(sanitize_text(text, replacements), encoding="utf-8")


def copy_workspace_storage_dir(
    source_dir: Path,
    destination_dir: Path,
    replacements: dict[str, str],
    *,
    include_workspace_json: bool = True,
) -> None:
    destination_dir.mkdir(parents=True, exist_ok=True)
    for path in sorted(source_dir.rglob("*")):
        if path.is_dir():
            continue
        relative_path = path.relative_to(source_dir)
        if not include_workspace_json and relative_path.name == "workspace.json":
            continue
        destination_path = destination_dir / relative_path
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        if path.name in {"state.vscdb", "state.vscdb.backup"}:
            shutil.copy2(path, destination_path)
            sanitize_sqlite_file(destination_path, replacements)
            continue
        if path.suffix in {".json", ".txt", ".py"}:
            copy_text_file(path, destination_path, replacements)
            continue
        shutil.copy2(path, destination_path)


def relative_output(path: Path) -> str:
    return path.relative_to(OUTPUT_ROOT).as_posix()


def add_scenario(
    scenario_rows: list[dict[str, Any]],
    *,
    id: str,
    apps: list[str],
    visible_cue: str,
    tricky: str,
    paths: list[Path],
    visible_roots: list[str] | None = None,
) -> None:
    scenario_rows.append(
        {
            "id": id,
            "apps": apps,
            "visible_cue": visible_cue,
            "tricky": tricky,
            "visible_roots": visible_roots or [],
            "paths": [relative_output(path) for path in paths],
        }
    )


def run_validation() -> None:
    subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "validate_mock_data.py")],
        check=True,
    )


def main() -> None:
    if OUTPUT_ROOT.exists():
        shutil.rmtree(OUTPUT_ROOT)
    OUTPUT_ROOT.mkdir(exist_ok=True)

    scenario_rows: list[dict[str, str]] = []

    codex_spl_source = HOME / ".codex/sessions/2026/01/22/rollout-2026-01-22T10-15-23-019be37c-2706-70c0-8e0e-51985de49079.jsonl"
    codex_spl_output = OUTPUT_ROOT / ".codex/sessions/2026/01/22/rollout-2026-01-22T10-15-23-019be37c-2706-70c0-8e0e-51985de49079.jsonl"
    codex_spl_replacements = {
        "/Users/alex_m4/docker/codeserver2/project/antigravity_tmp/spl": f"{MOCK_HOME}/docker/codeserver2/project/antigravity_tmp/log-query-validator",
    }
    write_jsonl(
        codex_spl_source,
        codex_spl_output,
        select_codex_records(load_jsonl(codex_spl_source)),
        codex_spl_replacements,
    )
    add_scenario(
        scenario_rows,
        id="codex-long-instructions",
        apps=["Codex"],
        visible_cue="One Codex session contains a very long AGENTS/instruction block, explicit environment injection, and then real tool-driven work in the same thread.",
        tricky="A parser that only samples the header sees configuration noise; a parser that only samples later turns loses the long injected context that shaped the session.",
        paths=[codex_spl_output],
        visible_roots=[f"{MOCK_HOME}/docker/codeserver2/project/antigravity_tmp/log-query-validator"],
    )

    codex_missing_source = HOME / ".codex/sessions/2026/03/13/rollout-2026-03-13T10-33-37-019ce50a-d285-7a52-b98a-6a3a66a48547.jsonl"
    codex_missing_output = OUTPUT_ROOT / ".codex/sessions/2026/03/13/rollout-2026-03-13T10-33-37-019ce50a-d285-7a52-b98a-6a3a66a48547.jsonl"
    codex_history_replacements = {
        "/Users/alex_m4/workspace/cchistory": f"{MOCK_HOME}/workspace/history-lab",
    }
    write_jsonl(
        codex_missing_source,
        codex_missing_output,
        select_codex_records(load_jsonl(codex_missing_source)),
        codex_history_replacements,
        mutator=remove_structured_cwd,
    )
    add_scenario(
        scenario_rows,
        id="codex-missing-structured-cwd",
        apps=["Codex"],
        visible_cue="The thread still talks about one visible repo path, but the structured cwd field is missing from metadata that usually carries it.",
        tricky="If linking depends too heavily on structured cwd, this session falls out of the right bucket even though the user still sees a concrete repo in the conversation.",
        paths=[codex_missing_output],
        visible_roots=[f"{MOCK_HOME}/workspace/history-lab"],
    )

    codex_remote_source = HOME / ".codex/sessions/2026/03/12/rollout-2026-03-12T22-53-54-019ce28a-35d1-7252-a261-fff510bc6031.jsonl"
    codex_remote_output = OUTPUT_ROOT / "host_remote/.codex/sessions/2026/03/12/rollout-2026-03-12T22-53-54-019ce28a-35d1-7252-a261-fff510bc6031.jsonl"
    write_jsonl(
        codex_remote_source,
        codex_remote_output,
        select_codex_records(load_jsonl(codex_remote_source)),
        codex_history_replacements,
    )
    add_scenario(
        scenario_rows,
        id="codex-cross-host-same-project",
        apps=["Codex"],
        visible_cue="A second host root contains a session that points at the same visible repo path as a local host session.",
        tricky="If host identity is ignored, two machines collapse into one history; if host identity dominates, the user sees one project split apart for no obvious reason.",
        paths=[codex_remote_output],
        visible_roots=[f"{MOCK_HOME}/workspace/history-lab"],
    )

    codex_chat_workspace_source = HOME / ".codex/sessions/2026/03/13/rollout-2026-03-13T10-19-05-019ce4fd-8290-7501-afc4-0e9486733614.jsonl"
    codex_chat_workspace_output = OUTPUT_ROOT / ".codex/sessions/2026/03/13/rollout-2026-03-13T10-19-05-019ce4fd-8290-7501-afc4-0e9486733614.jsonl"
    codex_chat_workspace_replacements = {
        "/Users/alex_m4/workspace/chatGPTBox": f"{MOCK_HOME}/workspace/chat-ui-kit",
    }
    write_jsonl(
        codex_chat_workspace_source,
        codex_chat_workspace_output,
        select_codex_records(load_jsonl(codex_chat_workspace_source)),
        codex_chat_workspace_replacements,
    )

    codex_chat_docker_source = HOME / ".codex/sessions/2026/02/06/rollout-2026-02-06T15-10-27-019c31c9-b046-7f02-a66e-b9a6b0221be9.jsonl"
    codex_chat_docker_output = OUTPUT_ROOT / ".codex/sessions/2026/02/06/rollout-2026-02-06T15-10-27-019c31c9-b046-7f02-a66e-b9a6b0221be9.jsonl"
    codex_chat_docker_replacements = {
        "/Users/alex_m4/docker/codeserver2/project/cursor_temp/my_opensource/chatGPTBox": f"{MOCK_HOME}/docker/codeserver2/project/cursor_temp/chat-ui-kit",
    }
    write_jsonl(
        codex_chat_docker_source,
        codex_chat_docker_output,
        select_codex_records(load_jsonl(codex_chat_docker_source)),
        codex_chat_docker_replacements,
    )
    add_scenario(
        scenario_rows,
        id="codex-same-repo-name-different-paths",
        apps=["Codex"],
        visible_cue="Two Codex sessions look like the same product name, `chat-ui-kit`, but one lives under a direct workspace path and the other under docker/codeserver.",
        tricky="Users often mentally group by visible repo name, while naive path-only linking treats them as different forever and naive basename-only linking may over-merge unrelated copies.",
        paths=[codex_chat_workspace_output, codex_chat_docker_output],
        visible_roots=[
            f"{MOCK_HOME}/workspace/chat-ui-kit",
            f"{MOCK_HOME}/docker/codeserver2/project/cursor_temp/chat-ui-kit",
        ],
    )

    claude_workspace_source = HOME / ".claude/projects/-Users-alex-m4-workspace-chatGPTBox/cc1df109-4282-4321-8248-8bbcd471da78.jsonl"
    claude_workspace_output = OUTPUT_ROOT / ".claude/projects/-Users-mock-user-workspace-chat-ui-kit/cc1df109-4282-4321-8248-8bbcd471da78.jsonl"
    claude_workspace_replacements = {
        "/Users/alex_m4/workspace/chatGPTBox": f"{MOCK_HOME}/workspace/chat-ui-kit",
    }
    write_jsonl(
        claude_workspace_source,
        claude_workspace_output,
        select_claude_records(load_jsonl(claude_workspace_source)),
        claude_workspace_replacements,
    )
    add_scenario(
        scenario_rows,
        id="claude-workspace-path",
        apps=["Claude"],
        visible_cue="Claude stores one project directly under a workspace path, and the thread contains long review instructions plus subagent/tool traffic.",
        tricky="The visible project path is clean, but the file itself mixes user asks, meta review prompts, tool traffic, and subagent progress that should not all be treated as equal turns.",
        paths=[claude_workspace_output],
        visible_roots=[f"{MOCK_HOME}/workspace/chat-ui-kit"],
    )

    claude_docker_source = HOME / ".claude/projects/-Users-alex-m4-docker-codeserver2-project-cursor-temp-my-opensource-chatGPTBox/7364d923-4c8b-4b3f-a9c9-d19fbfff4fac.jsonl"
    claude_docker_output = OUTPUT_ROOT / ".claude/projects/-Users-mock-user-docker-codeserver2-project-cursor-temp-chat-ui-kit/7364d923-4c8b-4b3f-a9c9-d19fbfff4fac.jsonl"
    claude_docker_replacements = {
        "/Users/alex_m4/docker/codeserver2/project/cursor_temp/my_opensource/chatGPTBox": f"{MOCK_HOME}/docker/codeserver2/project/cursor_temp/chat-ui-kit",
    }
    write_jsonl(
        claude_docker_source,
        claude_docker_output,
        select_claude_records(load_jsonl(claude_docker_source)),
        claude_docker_replacements,
    )
    add_scenario(
        scenario_rows,
        id="claude-same-app-different-path",
        apps=["Claude"],
        visible_cue="The same visible app family appears again, but this time under a docker/codeserver path with an API-error retry sequence.",
        tricky="If matching leans on app name alone these threads collapse together; if matching leans on full path alone the user sees one product split into separate silos.",
        paths=[claude_docker_output],
        visible_roots=[f"{MOCK_HOME}/docker/codeserver2/project/cursor_temp/chat-ui-kit"],
    )

    claude_subagent_source = HOME / ".claude/projects/-Users-alex-m4-workspace-chatGPTBox/cc1df109-4282-4321-8248-8bbcd471da78/subagents/agent-a0a2928875cb36a92.jsonl"
    claude_subagent_output = OUTPUT_ROOT / ".claude/projects/-Users-mock-user-workspace-chat-ui-kit/cc1df109-4282-4321-8248-8bbcd471da78/subagents/agent-a0a2928875cb36a92.jsonl"
    write_jsonl(
        claude_subagent_source,
        claude_subagent_output,
        select_claude_records(load_jsonl(claude_subagent_source)),
        claude_workspace_replacements,
    )
    add_scenario(
        scenario_rows,
        id="claude-sidechain-subagent",
        apps=["Claude"],
        visible_cue="A subagent sidechain file sits under the same Claude project tree as the main session.",
        tricky="Users see it as part of the same working area on disk, but parsers that flatten everything into one thread or ignore sidechains entirely both lose information.",
        paths=[claude_subagent_output],
        visible_roots=[f"{MOCK_HOME}/workspace/chat-ui-kit"],
    )

    claude_local_command_source = HOME / ".claude/projects/-Users-alex-m4-workspace-chatGPTBox/b98095d7-b7ee-4d23-9d4c-beb9725d1dc5.jsonl"
    claude_local_command_output = OUTPUT_ROOT / ".claude/projects/-Users-mock-user-workspace-chat-ui-kit/b98095d7-b7ee-4d23-9d4c-beb9725d1dc5.jsonl"
    write_jsonl(
        claude_local_command_source,
        claude_local_command_output,
        select_claude_records(load_jsonl(claude_local_command_source)),
        claude_workspace_replacements,
    )
    add_scenario(
        scenario_rows,
        id="claude-local-command-meta-noise",
        apps=["Claude"],
        visible_cue="The thread begins with a meta caveat explaining that some messages were generated by local commands and should not be treated like normal conversation.",
        tricky="A parser that only sees role=`user` will over-count meta noise as intent, even though the user-visible thread itself is warning that those messages are special.",
        paths=[claude_local_command_output],
        visible_roots=[f"{MOCK_HOME}/workspace/chat-ui-kit"],
    )

    factory_output_dir = OUTPUT_ROOT / ".factory/sessions/-Users-mock-user-workspace-history-lab"
    factory_session_output = factory_output_dir / "11111111-2222-4333-8444-555555555555.jsonl"
    factory_settings_output = factory_output_dir / "11111111-2222-4333-8444-555555555555.settings.json"
    write_jsonl_records(
        factory_session_output,
        [
            {
                "type": "session_start",
                "id": "11111111-2222-4333-8444-555555555555",
                "title": "History lab sidecar fixture",
                "sessionTitle": "History Lab review",
                "owner": "mock_user",
                "version": 2,
                "cwd": f"{MOCK_HOME}/workspace/history-lab",
            },
            {
                "type": "message",
                "id": "factory-msg-1",
                "timestamp": "2026-03-12T10:00:01.000Z",
                "message": {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "Review the Factory Droid sidecar behavior for history-lab.",
                        }
                    ],
                },
            },
            {
                "type": "message",
                "id": "factory-msg-2",
                "timestamp": "2026-03-12T10:00:02.000Z",
                "message": {
                    "role": "assistant",
                    "model": "claude-opus-4-6",
                    "stop_reason": "end_turn",
                    "usage": {
                        "inputTokens": 17,
                        "outputTokens": 9,
                        "cacheCreationTokens": 2,
                        "cacheReadTokens": 4,
                        "thinkingTokens": 3,
                    },
                    "content": [
                        {
                            "type": "text",
                            "text": "The sidecar settings file preserves model and cumulative token evidence.",
                        },
                        {
                            "type": "thinking",
                            "thinking": "Check the session settings and merge token totals.",
                        },
                        {
                            "type": "tool_use",
                            "id": "factory-tool-1",
                            "name": "shell",
                            "input": {"cmd": "pnpm --filter @cchistory/source-adapters test"},
                        },
                        {
                            "type": "tool_result",
                            "tool_use_id": "factory-tool-1",
                            "content": [{"type": "text", "text": "1 real mock_data fixture covered"}],
                        },
                        {
                            "type": "diagram",
                            "title": "unsupported",
                        },
                    ],
                },
            },
        ],
    )
    write_json(
        factory_settings_output,
        {
            "assistantActiveTimeMs": 42000,
            "autonomyLevel": "medium",
            "autonomyMode": "execute",
            "interactionMode": "chat",
            "model": "claude-opus-4-6",
            "providerLock": "anthropic",
            "providerLockTimestamp": "2026-03-12T10:00:00.000Z",
            "reasoningEffort": "high",
            "tokenUsage": {
                "inputTokens": 21,
                "outputTokens": 34,
                "cacheCreationTokens": 5,
                "cacheReadTokens": 89,
                "thinkingTokens": 8,
            },
        },
    )
    add_scenario(
        scenario_rows,
        id="factory-droid-sidecar-settings",
        apps=["Factory Droid"],
        visible_cue="A Factory Droid session stores its transcript as JSONL next to a `.settings.json` sidecar that carries model and cumulative token metadata for the same visible workspace.",
        tricky="If a parser reads only the conversation file it misses sidecar evidence; if it trusts only settings it loses turn boundaries, tool calls, and hidden thinking fragments.",
        paths=[factory_session_output, factory_settings_output],
        visible_roots=[f"{MOCK_HOME}/workspace/history-lab"],
    )

    amp_output = OUTPUT_ROOT / ".local/share/amp/threads/T-019d19fb-1a2b-7345-8cde-0f1a2b3c4d5e.json"
    write_json(
        amp_output,
        {
            "v": 1,
            "id": "T-019d19fb-1a2b-7345-8cde-0f1a2b3c4d5e",
            "created": 1741770900000,
            "messages": [
                {
                    "timestamp": "2026-03-12T09:15:01.000Z",
                    "role": "user",
                    "messageId": "amp-msg-1",
                    "content": [
                        {
                            "type": "text",
                            "text": "Summarize the AMP ingestion gaps for history-lab.",
                        }
                    ],
                    "userState": {"cwd": f"{MOCK_HOME}/workspace/history-lab"},
                    "agentMode": "default",
                    "meta": {"sentAt": 1741770901000},
                },
                {
                    "timestamp": "2026-03-12T09:15:02.000Z",
                    "role": "assistant",
                    "messageId": "amp-msg-2",
                    "content": [
                        {
                            "type": "tool_use",
                            "id": "amp-tool-1",
                            "name": "search_repo",
                            "input": {"query": "history-lab AMP parser"},
                        }
                    ],
                    "state": {"stopReason": "tool_use"},
                },
                {
                    "timestamp": "2026-03-12T09:15:03.000Z",
                    "role": "user",
                    "messageId": "amp-msg-3",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": "amp-tool-1",
                            "content": [
                                {
                                    "type": "text",
                                    "text": "packages/source-adapters/src/platforms/amp/runtime.ts",
                                }
                            ],
                        }
                    ],
                },
                {
                    "timestamp": "2026-03-12T09:15:04.000Z",
                    "role": "assistant",
                    "messageId": "amp-msg-4",
                    "content": [
                        {
                            "type": "text",
                            "text": "AMP relies on the root env trees to recover the visible workspace before projecting turns.",
                        },
                        {
                            "type": "chart",
                            "data": [],
                        },
                    ],
                    "state": {"stopReason": "end_turn"},
                    "usage": {
                        "model": "claude-opus-4-6",
                        "inputTokens": 19,
                        "outputTokens": 11,
                        "cacheCreationInputTokens": 3,
                        "cacheReadInputTokens": 2,
                    },
                },
            ],
            "agentMode": "default",
            "nextMessageId": "amp-msg-5",
            "meta": {"team": "mock-history"},
            "env": {
                "initial": {
                    "trees": [
                        {
                            "uri": f"file://{MOCK_HOME}/workspace/history-lab",
                            "displayName": "history-lab",
                        }
                    ],
                    "platform": "linux",
                    "tags": ["mock", "amp"],
                }
            },
            "title": "History-lab AMP workspace review",
            "~debug": {"selectedMode": "default"},
        },
    )
    add_scenario(
        scenario_rows,
        id="amp-root-env-thread",
        apps=["AMP"],
        visible_cue="An AMP thread keeps the visible workspace only in the root env tree metadata while the actual tool exchange is spread across later message objects in one whole-thread JSON file.",
        tricky="If a parser only samples message text it loses the workspace root; if it only reads the root metadata it misses the user ask, tool roundtrip, and unsupported content that should stay auditable.",
        paths=[amp_output],
        visible_roots=[f"{MOCK_HOME}/workspace/history-lab"],
    )

    cursor_shared_source_dir = HOME / "Library/Application Support/Cursor/User/workspaceStorage/639bf876be3d93dd9e0d506aeb0aaff9"
    cursor_shared_output_dir = OUTPUT_ROOT / "Library/Application Support/Cursor/User/workspaceStorage/639bf876be3d93dd9e0d506aeb0aaff9"
    shared_path_replacements = {
        "/Users/alex_m4/workspace/111": f"{MOCK_HOME}/workspace/shared-product-lab",
    }
    copy_workspace_storage_dir(cursor_shared_source_dir, cursor_shared_output_dir, shared_path_replacements)
    add_scenario(
        scenario_rows,
        id="cursor-shared-path",
        apps=["Cursor", "antigravity"],
        visible_cue="Cursor has one workspaceStorage directory whose visible project path is the same path another antigravity directory points to.",
        tricky="If app identity is ignored, cross-app state for one visible path collapses together; if app identity is absolute, users cannot see one project’s history across tools.",
        paths=[
            cursor_shared_output_dir / "state.vscdb",
            cursor_shared_output_dir / "state.vscdb.backup",
            cursor_shared_output_dir / "workspace.json",
            cursor_shared_output_dir / "anysphere.cursor-retrieval/embeddable_files.txt",
            cursor_shared_output_dir / "anysphere.cursor-retrieval/high_level_folder_description.txt",
        ],
        visible_roots=[f"{MOCK_HOME}/workspace/shared-product-lab"],
    )

    cursor_missing_source_dir = HOME / "Library/Application Support/Cursor/User/workspaceStorage/1772946539891"
    cursor_missing_output_dir = OUTPUT_ROOT / "Library/Application Support/Cursor/User/workspaceStorage/1772946539891"
    copy_workspace_storage_dir(cursor_missing_source_dir, cursor_missing_output_dir, shared_path_replacements, include_workspace_json=False)

    cursor_settings_only_source_dir = HOME / "Library/Application Support/Cursor/User/workspaceStorage/1773234871182"
    cursor_settings_only_output_dir = OUTPUT_ROOT / "Library/Application Support/Cursor/User/workspaceStorage/1773234871182"
    copy_workspace_storage_dir(
        cursor_settings_only_source_dir,
        cursor_settings_only_output_dir,
        shared_path_replacements,
        include_workspace_json=False,
    )
    add_scenario(
        scenario_rows,
        id="cursor-opaque-settings-only-dirs",
        apps=["Cursor"],
        visible_cue="Two opaque Cursor storage IDs look like project session directories, but neither has workspace.json and both only point back to Cursor settings state.",
        tricky="A parser that treats every storage ID as a project invents false projects; a parser that drops them entirely hides uncertainty that a user may want surfaced.",
        paths=[
            cursor_missing_output_dir / "state.vscdb",
            cursor_missing_output_dir / "state.vscdb.backup",
            cursor_settings_only_output_dir / "state.vscdb",
            cursor_settings_only_output_dir / "state.vscdb.backup",
        ],
    )

    antigravity_shared_source_dir = HOME / "Library/Application Support/antigravity/User/workspaceStorage/746eb6d58490dfd6abb72052b7127813"
    antigravity_shared_output_dir = OUTPUT_ROOT / "Library/Application Support/antigravity/User/workspaceStorage/746eb6d58490dfd6abb72052b7127813"
    antigravity_shared_replacements = {
        "/Users/alex_m4/docker/codeserver2/project/antigravity_tmp/Claude_skills": f"{MOCK_HOME}/workspace/shared-product-lab",
        "/Users/alex_m4/.gemini/antigravity/brain": f"{MOCK_HOME}/.gemini/antigravity/brain",
    }
    copy_workspace_storage_dir(antigravity_shared_source_dir, antigravity_shared_output_dir, antigravity_shared_replacements)
    add_scenario(
        scenario_rows,
        id="antigravity-shared-path",
        apps=["antigravity", "Cursor"],
        visible_cue="Antigravity points at the same visible path as the Cursor sample, but keeps different app artifacts and state.",
        tricky="This is the user-facing version of ‘same folder, different app state’: identical visible root, different app-specific storage shape.",
        paths=[
            antigravity_shared_output_dir / "state.vscdb",
            antigravity_shared_output_dir / "state.vscdb.backup",
            antigravity_shared_output_dir / "workspace.json",
        ],
        visible_roots=[f"{MOCK_HOME}/workspace/shared-product-lab"],
    )

    antigravity_noise_source_dir = HOME / "Library/Application Support/antigravity/User/workspaceStorage/185321b35aa000841ea2e2a9193c40f1"
    antigravity_noise_output_dir = OUTPUT_ROOT / "Library/Application Support/antigravity/User/workspaceStorage/185321b35aa000841ea2e2a9193c40f1"
    antigravity_noise_replacements = {
        "/Users/alex_m4/docker/codeserver2/project/antigravity_tmp/spl": f"{MOCK_HOME}/docker/codeserver2/project/antigravity_tmp/log-query-validator",
        "/Users/alex_m4/.gemini/antigravity/brain": f"{MOCK_HOME}/.gemini/antigravity/brain",
    }
    copy_workspace_storage_dir(antigravity_noise_source_dir, antigravity_noise_output_dir, antigravity_noise_replacements)
    add_scenario(
        scenario_rows,
        id="antigravity-noisy-sidecars",
        apps=["antigravity"],
        visible_cue="One antigravity storage directory mixes current DB, backup DB, workspace.json, terminal state, and an unrelated Python startup sidecar in the same folder.",
        tricky="Users see all of these files side-by-side. Parsers that hardcode one ‘main’ file miss useful evidence; parsers that ingest everything equally overfit editor/plugin noise.",
        paths=[
            antigravity_noise_output_dir / "state.vscdb",
            antigravity_noise_output_dir / "state.vscdb.backup",
            antigravity_noise_output_dir / "workspace.json",
            antigravity_noise_output_dir / "ms-python.python/pythonrc.py",
        ],
        visible_roots=[f"{MOCK_HOME}/docker/codeserver2/project/antigravity_tmp/log-query-validator"],
    )

    antigravity_same_name_a_source_dir = HOME / "Library/Application Support/antigravity/User/workspaceStorage/0b4c167cea6b4aae62aa46fe945f284d"
    antigravity_same_name_a_output_dir = OUTPUT_ROOT / "Library/Application Support/antigravity/User/workspaceStorage/0b4c167cea6b4aae62aa46fe945f284d"
    antigravity_same_name_a_replacements = {
        "/Users/alex_m4/docker/codeserver2/project/antigravity_tmp/AI roadmap": f"{MOCK_HOME}/docker/codeserver2/project/antigravity_tmp/AI roadmap",
        "/Users/alex_m4/.gemini/antigravity/brain": f"{MOCK_HOME}/.gemini/antigravity/brain",
    }
    copy_workspace_storage_dir(
        antigravity_same_name_a_source_dir,
        antigravity_same_name_a_output_dir,
        antigravity_same_name_a_replacements,
    )

    antigravity_same_name_b_source_dir = HOME / "Library/Application Support/antigravity/User/workspaceStorage/0bdd31400b2d6b5701ee9152bdca758a"
    antigravity_same_name_b_output_dir = OUTPUT_ROOT / "Library/Application Support/antigravity/User/workspaceStorage/0bdd31400b2d6b5701ee9152bdca758a"
    antigravity_same_name_b_replacements = {
        "/Users/alex_m4/docker/codeserver2/project/final_reports/AI roadmap": f"{MOCK_HOME}/docker/codeserver2/project/final_reports/AI roadmap",
        "/Users/alex_m4/.gemini/antigravity/brain": f"{MOCK_HOME}/.gemini/antigravity/brain",
    }
    copy_workspace_storage_dir(
        antigravity_same_name_b_source_dir,
        antigravity_same_name_b_output_dir,
        antigravity_same_name_b_replacements,
    )
    add_scenario(
        scenario_rows,
        id="antigravity-same-name-different-paths",
        apps=["antigravity"],
        visible_cue="Two antigravity storage directories both look like `AI roadmap`, but they live under different parent paths and carry different recent file histories.",
        tricky="Users often identify projects by the last path segment. Grouping by basename merges unrelated roots; grouping by full path can hide that both folders look like the same project name.",
        paths=[
            antigravity_same_name_a_output_dir / "state.vscdb",
            antigravity_same_name_a_output_dir / "state.vscdb.backup",
            antigravity_same_name_a_output_dir / "workspace.json",
            antigravity_same_name_a_output_dir / "ms-python.python/pythonrc.py",
            antigravity_same_name_b_output_dir / "state.vscdb",
            antigravity_same_name_b_output_dir / "state.vscdb.backup",
            antigravity_same_name_b_output_dir / "workspace.json",
        ],
        visible_roots=[
            f"{MOCK_HOME}/docker/codeserver2/project/antigravity_tmp/AI roadmap",
            f"{MOCK_HOME}/docker/codeserver2/project/final_reports/AI roadmap",
        ],
    )

    antigravity_same_path_a_source_dir = HOME / "Library/Application Support/antigravity/User/workspaceStorage/5b13d64dd42f907e59b5da027b207e7c"
    antigravity_same_path_a_output_dir = OUTPUT_ROOT / "Library/Application Support/antigravity/User/workspaceStorage/5b13d64dd42f907e59b5da027b207e7c"
    antigravity_same_path_b_source_dir = HOME / "Library/Application Support/antigravity/User/workspaceStorage/f4fd25307d8f06ffcfb8fbfe153f7a71"
    antigravity_same_path_b_output_dir = OUTPUT_ROOT / "Library/Application Support/antigravity/User/workspaceStorage/f4fd25307d8f06ffcfb8fbfe153f7a71"
    antigravity_chat_ui_replacements = {
        "/Users/alex_m4/docker/codeserver2/project/cursor_temp/my_opensource/chatGPTBox": f"{MOCK_HOME}/docker/codeserver2/project/cursor_temp/chat-ui-kit",
        "/Users/alex_m4/.gemini/antigravity/brain": f"{MOCK_HOME}/.gemini/antigravity/brain",
    }
    copy_workspace_storage_dir(
        antigravity_same_path_a_source_dir,
        antigravity_same_path_a_output_dir,
        antigravity_chat_ui_replacements,
    )
    copy_workspace_storage_dir(
        antigravity_same_path_b_source_dir,
        antigravity_same_path_b_output_dir,
        antigravity_chat_ui_replacements,
    )
    add_scenario(
        scenario_rows,
        id="antigravity-same-path-different-storage-ids",
        apps=["antigravity"],
        visible_cue="Two different antigravity storage IDs both point at the exact same visible `chat-ui-kit` path, but one directory has backup and terminal state while the other is much thinner.",
        tricky="Treating storage ID as identity splits one visible project into multiple islands; blindly merging by visible path can hide that one directory contains richer or older evidence than the other.",
        paths=[
            antigravity_same_path_a_output_dir / "state.vscdb",
            antigravity_same_path_a_output_dir / "state.vscdb.backup",
            antigravity_same_path_a_output_dir / "workspace.json",
            antigravity_same_path_b_output_dir / "state.vscdb",
            antigravity_same_path_b_output_dir / "workspace.json",
        ],
        visible_roots=[f"{MOCK_HOME}/docker/codeserver2/project/cursor_temp/chat-ui-kit"],
    )

    antigravity_history_source_dir = HOME / "Library/Application Support/antigravity/User/workspaceStorage/6da0015ba5dc048c049cc941f93fd4c2"
    antigravity_history_output_dir = OUTPUT_ROOT / "Library/Application Support/antigravity/User/workspaceStorage/6da0015ba5dc048c049cc941f93fd4c2"
    antigravity_history_replacements = {
        "/Users/alex_m4/workspace/cchistory": f"{MOCK_HOME}/workspace/history-lab",
        "/Users/alex_m4/.gemini/antigravity/brain": f"{MOCK_HOME}/.gemini/antigravity/brain",
    }
    copy_workspace_storage_dir(
        antigravity_history_source_dir,
        antigravity_history_output_dir,
        antigravity_history_replacements,
    )
    add_scenario(
        scenario_rows,
        id="antigravity-current-backup-divergent",
        apps=["antigravity"],
        visible_cue="One antigravity directory points at a single visible repo, but its current DB and backup DB disagree on editor history and restored state.",
        tricky="A parser that only trusts `state.vscdb` or only trusts `.backup` loses real evidence about crash recovery, restore flows, and what the user recently had open.",
        paths=[
            antigravity_history_output_dir / "state.vscdb",
            antigravity_history_output_dir / "state.vscdb.backup",
            antigravity_history_output_dir / "workspace.json",
        ],
        visible_roots=[f"{MOCK_HOME}/workspace/history-lab"],
    )

    readme_lines = [
        "# Mock Data",
        "",
        "This directory is built from local real session/app data, then sanitized and reorganized into a smaller scenario set.",
        "",
        "The scenarios are intentionally framed around what a user actually notices on disk or in local app storage:",
        "",
        "- same app, different visible paths",
        "- same visible path, different apps",
        "- same visible path, different storage IDs inside one app",
        "- same folder name, different parent paths",
        "- very long instructions and injected context blocks",
        "- missing metadata even when files look present",
        "- current and backup state disagreeing about recent activity",
        "- traces from a second host root",
        "- meta/tool noise that looks like normal conversation unless you inspect carefully",
        "",
        "| Scenario | Apps | What A User Would Notice | Why A Naive Parser Gets It Wrong | Paths |",
        "| --- | --- | --- | --- | --- |",
    ]
    for row in scenario_rows:
        apps = ", ".join(row["apps"])
        paths = "<br>".join(f"`{path}`" for path in row["paths"])
        readme_lines.append(
            f"| `{row['id']}` | {apps} | {row['visible_cue']} | {row['tricky']} | {paths} |"
        )
    (OUTPUT_ROOT / "README.md").write_text("\n".join(readme_lines) + "\n", encoding="utf-8")

    (OUTPUT_ROOT / "scenarios.json").write_text(
        json.dumps(scenario_rows, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    run_validation()


if __name__ == "__main__":
    main()
