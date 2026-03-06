from __future__ import annotations

from fastapi import APIRouter, Depends

from cchistory.config import AppConfig
from cchistory.db import IndexRepository
from cchistory.models import (
    Chat2HistoryCitation,
    Chat2HistoryContextItem,
    Chat2HistoryQuery,
    Chat2HistoryResponse,
)

router = APIRouter(prefix="/api/chat2history", tags=["chat2history"])


def get_repository() -> IndexRepository:
    from cchistory.main import app

    repository = getattr(app.state, "index_repository", None)
    if repository is None:
        repository = IndexRepository(AppConfig.default().database_url)
        app.state.index_repository = repository
    return repository


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def _trim_to_budget(text: str, remaining_tokens: int) -> str:
    if remaining_tokens <= 0:
        return ""
    return text[: remaining_tokens * 4].strip()


def _detail_content(detail) -> str:
    if detail.content:
        return detail.content
    if detail.messages:
        return "\n".join(message.content for message in detail.messages if message.content)
    return detail.snippet or detail.title


@router.post("/query", response_model=Chat2HistoryResponse)
async def query_chat2history(
    payload: Chat2HistoryQuery,
    repository: IndexRepository = Depends(get_repository),
) -> Chat2HistoryResponse:
    hits, _ = repository.search_entries(
        query=payload.query,
        sources=payload.sources,
        types=payload.types,
        project=payload.project,
        limit=max(payload.top_k * 4, payload.top_k),
        offset=0,
    )

    items = []
    used_tokens = 0
    truncated = False

    for hit in hits:
        if len(items) >= payload.top_k:
            break

        detail = repository.get_entry_detail(hit.entry_id)
        if detail is None:
            continue

        content = _detail_content(detail)
        token_count = _estimate_tokens(content)
        if used_tokens + token_count > payload.token_budget:
            remaining_tokens = payload.token_budget - used_tokens
            trimmed_content = _trim_to_budget(content, remaining_tokens)
            if not trimmed_content:
                truncated = True
                break
            content = trimmed_content
            token_count = _estimate_tokens(content)
            truncated = True

        items.append(
            Chat2HistoryContextItem(
                entry_id=detail.entry_id,
                source=detail.source,
                title=detail.title,
                timestamp=detail.timestamp,
                score=hit.score,
                snippet=hit.snippet,
                content=content,
                token_count=token_count,
                citation=Chat2HistoryCitation(
                    entry_id=detail.entry_id,
                    source=detail.source,
                    title=detail.title,
                    timestamp=detail.timestamp,
                ),
            )
        )
        used_tokens += token_count

        if truncated:
            break

    return Chat2HistoryResponse(
        query=payload.query,
        items=items,
        used_tokens=used_tokens,
        token_budget=payload.token_budget,
        truncated=truncated,
    )
