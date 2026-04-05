#!/usr/bin/env python3

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
MOCK_ROOT = REPO_ROOT / "mock_data"

ALLOWED_FILE_PATTERNS = [
    re.compile(r"README\.md"),
    re.compile(r"scenarios\.json"),
    re.compile(r"stable-adapter-validation\.json"),
    re.compile(r"fixtures/antigravity-live/trajectory-summaries\.json"),
    re.compile(r"fixtures/antigravity-live/steps/[0-9a-f-]+\.json"),
    re.compile(r"\.codex/history\.jsonl"),
    re.compile(r"\.codex/sessions/\d{4}/\d{2}/\d{2}/rollout-[^/]+\.jsonl"),
    re.compile(r"\.codebuddy/settings\.json"),
    re.compile(r"\.codebuddy/local_storage/entry_[0-9a-f]+\.info"),
    re.compile(r"\.codebuddy/projects/[^/]+/[0-9a-f-]+\.jsonl"),
    re.compile(r"host_remote/\.codex/sessions/\d{4}/\d{2}/\d{2}/rollout-[^/]+\.jsonl"),
    re.compile(r"\.claude/history\.jsonl"),
    re.compile(r"\.claude/projects/[^/]+/[0-9a-f-]+\.jsonl"),
    re.compile(r"\.claude/projects/[^/]+/[0-9a-f-]+/subagents/agent-[^.]+\.jsonl"),
    re.compile(r"\.factory/sessions/[^/]+/[0-9a-f-]+(?:\.jsonl|\.settings\.json)"),
    re.compile(r"\.local/share/amp/history\.jsonl"),
    re.compile(r"\.local/share/amp/threads/T-[0-9A-Za-z-]+\.json"),
    re.compile(r"\.cursor/chats/[0-9a-f]+/[0-9a-f-]+/store\.db"),
    re.compile(
        r"Library/Application Support/(Cursor|antigravity)/User/workspaceStorage/[0-9a-z]+/"
        r"(state\.vscdb|state\.vscdb\.backup|workspace\.json|"
        r"ms-python\.python/pythonrc\.py|"
        r"anysphere\.cursor-retrieval/embeddable_files\.txt|"
        r"anysphere\.cursor-retrieval/high_level_folder_description\.txt)"
    ),
    re.compile(
        r"\.gemini/antigravity/brain/[0-9a-f-]+/"
        r"(task|implementation_plan|walkthrough|project_review|research_quality_review|"
        r"SOTA_Agents_Context_Engineering_Research|Conversation_[^/]+_History)\.md"
    ),
    re.compile(
        r"\.gemini/antigravity/brain/[0-9a-f-]+/"
        r"(task|implementation_plan|walkthrough|project_review|research_quality_review|"
        r"SOTA_Agents_Context_Engineering_Research|Conversation_[^/]+_History)\.md\.metadata\.json"
    ),
    re.compile(r"\.gemini/antigravity/brain/[0-9a-f-]+/browser/scratchpad_[^/]+\.md"),
    re.compile(r"\.gemini/projects\.json"),
    re.compile(r"\.gemini/history/[^/]+/\.project_root"),
    re.compile(r"\.gemini/tmp/[^/]+/\.project_root"),
    re.compile(r"\.gemini/tmp/[^/]+/logs\.json"),
    re.compile(r"\.gemini/tmp/[^/]+/chats/session-[^/]+\.json"),
    re.compile(r"\.openclaw/agents/[^/]+/agent/(auth-profiles|models)\.json"),
    re.compile(r"\.openclaw/agents/[^/]+/sessions/[^/]+\.jsonl(?:\.(?:reset|deleted)\.[^/]+)?"),
    re.compile(r"\.openclaw/cron/runs/[0-9a-f-]+\.jsonl"),
    re.compile(r"Library/Application Support/openclaw/[^/]+/agent/(auth-profiles|models)\.json"),
    re.compile(r"Library/Application Support/openclaw/[^/]+/sessions/[^/]+\.jsonl(?:\.(?:reset|deleted)\.[^/]+)?"),
    re.compile(r"Library/Application Support/openclaw/cron/runs/[0-9a-f-]+\.jsonl"),
    re.compile(r"\.local/share/opencode/storage/project/global\.json"),
    re.compile(r"\.local/share/opencode/storage/session/global/ses_[^/]+\.json"),
    re.compile(r"\.local/share/opencode/storage/message/ses_[^/]+/msg_[^/]+\.json"),
    re.compile(r"\.local/share/opencode/storage/part/msg_[^/]+/prt_[^/]+\.json"),
    re.compile(r"\.local/share/opencode/storage/session_diff/ses_[^/]+\.json"),
    re.compile(r"\.local/share/opencode/storage/todo/ses_[^/]+\.json"),
]

FORBIDDEN_CONTENT_PATTERNS = [
    ("unexpected home path", re.compile(r"/Users/(?!mock_user/)[^/\s\"')]+/")),
    ("real username", re.compile(r"alex_m4")),
    ("unsanitized git forge host", re.compile(r"\bgitea\.[A-Za-z0-9.-]+\b")),
    ("real GitHub path", re.compile(r"github\.com/alex_m4")),
    ("unsanitized temp root", re.compile(r"/private/var/folders/(?!mock/)")),
    ("unsanitized temp root", re.compile(r"/var/folders/(?!mock/)")),
    ("unsanitized launchd socket", re.compile(r"/private/tmp/com\.apple\.launchd\.(?!mock/)")),
    ("unsanitized vscode git socket", re.compile(r"vscode-git-(?!mock\.sock)[A-Za-z0-9]+")),
    ("email address", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
    ("GitHub token", re.compile(r"\bghp_[A-Za-z0-9]{20,}\b")),
    ("OpenAI-style token", re.compile(r"\bsk-[A-Za-z0-9]{20,}\b")),
    ("authorization header", re.compile(r"Authorization:\s+Bearer (?!\$\{token\})[A-Za-z0-9._-]{16,}")),
    ("bearer token", re.compile(r"Bearer (?!\$\{token\})[A-Za-z0-9._-]{16,}")),
    (
        "unsanitized shell integration nonce",
        re.compile(
            r'"(?:shellIntegrationNonce|VSCODE_NONCE|nonce)":"'
            r'(?!mock-shell-integration-nonce")'
            r'[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}"'
        ),
    ),
]


def iter_files() -> list[Path]:
    return sorted(path for path in MOCK_ROOT.rglob("*") if path.is_file())


def validate_layout(files: list[Path]) -> list[str]:
    findings: list[str] = []
    for path in files:
        rel = path.relative_to(MOCK_ROOT).as_posix()
        if not any(pattern.fullmatch(rel) for pattern in ALLOWED_FILE_PATTERNS):
            findings.append(f"unexpected file layout: {rel}")
    return findings


def validate_scenarios() -> list[str]:
    findings: list[str] = []
    scenario_path = MOCK_ROOT / "scenarios.json"
    rows = json.loads(scenario_path.read_text(encoding="utf-8"))

    for row in rows:
        scenario_id = row.get("id", "<missing-id>")

        for rel_path in row.get("paths", []):
            if not (MOCK_ROOT / rel_path).exists():
                findings.append(f"{scenario_id}: missing scenario path {rel_path}")

        for visible_root in row.get("visible_roots", []):
            if not isinstance(visible_root, str) or not visible_root.startswith("/Users/mock_user/"):
                findings.append(f"{scenario_id}: visible root is not sanitized: {visible_root!r}")

    return findings


def extract_searchable_text(path: Path) -> str:
    data = path.read_bytes()
    ascii_segments = [segment.decode("ascii", errors="ignore") for segment in re.findall(rb"[ -~]{4,}", data)]
    utf16_segments = [segment.decode("utf-16le", errors="ignore") for segment in re.findall(rb"(?:[ -~]\x00){4,}", data)]
    return "\n".join([*ascii_segments, *utf16_segments])


def validate_content(files: list[Path]) -> list[str]:
    findings: list[str] = []

    for path in files:
        rel = path.relative_to(MOCK_ROOT).as_posix()
        searchable_text = extract_searchable_text(path)
        for label, pattern in FORBIDDEN_CONTENT_PATTERNS:
            if pattern.search(searchable_text):
                findings.append(f"{rel}: found {label}")

    return findings


def main() -> int:
    if not MOCK_ROOT.exists():
        print(f"mock_data directory not found: {MOCK_ROOT}", file=sys.stderr)
        return 1

    files = iter_files()
    findings = [
        *validate_layout(files),
        *validate_scenarios(),
        *validate_content(files),
    ]

    if findings:
        for finding in findings:
            print(f"FAIL: {finding}")
        return 1

    print(f"mock_data validation passed: checked {len(files)} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
