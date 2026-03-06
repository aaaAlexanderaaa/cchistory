from __future__ import annotations

import hashlib
import re
from collections import Counter
from typing import Iterable, List

from cchistory.db import IndexRepository
from cchistory.models import DistillSessionRequest
from cchistory.schema import DistillArtifact, HistoryEntryDetail

_STOPWORDS = {
    "the",
    "and",
    "for",
    "that",
    "with",
    "from",
    "this",
    "into",
    "when",
    "were",
    "have",
    "need",
    "should",
    "could",
    "would",
    "about",
    "after",
    "before",
    "there",
    "their",
    "where",
    "what",
    "your",
    "here",
    "then",
    "them",
    "they",
    "using",
    "used",
    "over",
    "through",
}
_DECISION_MARKERS = ("decide", "decided", "use ", "switch", "migrate", "added", "keep ")
_QUESTION_MARKERS = ("?", "todo", "follow up", "need to", "remaining", "unresolved", "unknown")


def _entry_text(detail: HistoryEntryDetail) -> str:
    parts = [detail.title]
    if detail.content:
        parts.append(detail.content)
    if detail.messages:
        parts.extend(message.content for message in detail.messages if message.content)
    return "\n".join(part for part in parts if part)


def _extract_keywords(entries: Iterable[HistoryEntryDetail], limit: int = 5) -> List[str]:
    counter: Counter[str] = Counter()
    for entry in entries:
        tokens = re.findall(r"[A-Za-z][A-Za-z0-9_/-]+", _entry_text(entry).lower())
        counter.update(token for token in tokens if token not in _STOPWORDS and len(token) > 3)
    return [token for token, _count in counter.most_common(limit)]


def _extract_marked_sentences(
    entries: Iterable[HistoryEntryDetail],
    markers: tuple[str, ...],
    limit: int = 5,
) -> List[str]:
    results: List[str] = []
    for entry in entries:
        for raw_line in _entry_text(entry).splitlines():
            line = raw_line.strip()
            normalized = line.lower()
            if line and any(marker in normalized for marker in markers):
                if line not in results:
                    results.append(line)
            if len(results) >= limit:
                return results
    return results


def _extract_patterns(entries: List[HistoryEntryDetail], keywords: List[str]) -> List[str]:
    texts = [_entry_text(entry).lower() for entry in entries]
    patterns = []
    for keyword in keywords[:3]:
        mentions = sum(text.count(keyword) for text in texts)
        if mentions > 1:
            patterns.append(f"Recurring topic: {keyword} ({mentions} mentions)")

    tools = sorted(
        {
            message.tool_name
            for entry in entries
            for message in entry.messages or []
            if message.tool_name
        }
    )
    if tools:
        patterns.append(f"Common tools: {', '.join(tools[:3])}")
    return patterns


def _build_summary(entries: List[HistoryEntryDetail], keywords: List[str]) -> str:
    projects = sorted({entry.project for entry in entries if entry.project})
    focus = ", ".join(keywords[:3]) if keywords else "recent indexed activity"
    if projects:
        return (
            f"Recent work across {len(entries)} entries focused on {focus} in "
            f"{', '.join(projects[:2])}."
        )
    return f"Recent work across {len(entries)} entries focused on {focus}."


def _scope_for_request(request: DistillSessionRequest) -> str:
    if request.entry_ids:
        digest = hashlib.sha1("|".join(sorted(request.entry_ids)).encode("utf-8")).hexdigest()[:16]
        return f"entries:{digest}"
    return f"project:{request.project or '*'}|source:{request.source or '*'}|limit:{request.limit}"


def _artifact_id(scope: str) -> str:
    digest = hashlib.sha1(scope.encode("utf-8")).hexdigest()[:16]
    return f"distill:session:{digest}"


def _load_entries(repository: IndexRepository, request: DistillSessionRequest) -> List[HistoryEntryDetail]:
    if request.entry_ids:
        details = [
            detail
            for entry_id in request.entry_ids
            if (detail := repository.get_entry_detail(entry_id)) is not None
        ]
        details.sort(key=lambda item: (item.timestamp, item.entry_id), reverse=True)
        return details

    summaries = repository.list_entry_summaries(
        limit=request.limit,
        offset=0,
        source=request.source,
        project=request.project,
    )
    return [
        detail
        for summary in summaries
        if (detail := repository.get_entry_detail(summary.entry_id)) is not None
    ]


def distill_session(
    repository: IndexRepository,
    request: DistillSessionRequest,
) -> DistillArtifact:
    entries = _load_entries(repository, request)
    if not entries:
        raise ValueError("No entries available for distillation")

    keywords = _extract_keywords(entries)
    patterns = _extract_patterns(entries, keywords)
    decisions = _extract_marked_sentences(entries, _DECISION_MARKERS)
    open_questions = _extract_marked_sentences(entries, _QUESTION_MARKERS)
    tags = sorted(
        set(
            keywords[:5]
            + [project.split("/")[-1] for project in {entry.project for entry in entries if entry.project}]
        )
    )

    scope = _scope_for_request(request)
    artifact = DistillArtifact(
        artifact_id=_artifact_id(scope),
        scope=scope,
        artifact_type="session_distill",
        title=f"Session distill for {request.project or request.source or 'recent history'}",
        summary=_build_summary(entries, keywords),
        patterns=patterns,
        decisions=decisions,
        open_questions=open_questions,
        provenance_entry_ids=[entry.entry_id for entry in entries],
        tags=tags,
        metadata={
            "entry_count": len(entries),
            "sources": sorted({entry.source for entry in entries}),
            "projects": sorted({entry.project for entry in entries if entry.project}),
        },
    )
    repository.upsert_distill_artifact(artifact)
    repository.merge_entry_tags(artifact.provenance_entry_ids, artifact.tags)
    persisted = repository.get_distill_artifact(artifact.artifact_id)
    if persisted is None:
        raise RuntimeError("Persisted distill artifact could not be reloaded")
    return persisted
