from __future__ import annotations

import re
from typing import Any, Dict

from pydantic import BaseModel, Field, SecretStr, field_validator

from cchistory.config import SourceConfig

_ID_PATTERN = re.compile(r"^[a-z0-9_]+$")


def slugify_source_id(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return slug or "source"


class SourceInstanceConfig(BaseModel):
    source_id: str
    connector_type: str
    name: str = Field(min_length=1)
    enabled: bool = True
    params: Dict[str, Any] = Field(default_factory=dict)
    secrets: Dict[str, SecretStr] = Field(default_factory=dict)

    @field_validator("source_id", "connector_type")
    @classmethod
    def validate_identifier(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not _ID_PATTERN.fullmatch(normalized):
            raise ValueError("must contain only lowercase letters, digits, and underscores")
        return normalized

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("must not be empty")
        return normalized


def validate_source_config(config: SourceConfig) -> SourceInstanceConfig:
    return SourceInstanceConfig(
        source_id=config.id or slugify_source_id(config.name),
        connector_type=config.type,
        name=config.name,
        enabled=config.enabled,
        params=dict(config.params),
    )
