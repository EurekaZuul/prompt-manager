from __future__ import annotations

import json
from typing import List, Sequence

from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, Field, ValidationError

from app.config import get_settings
from app.services.settings_store import get_setting, get_settings_map, upsert_setting


class LLMProvider(BaseModel):
    """Represents one OpenAI-compatible provider configuration."""

    id: str
    name: str
    provider: str = Field(default="custom")
    api_key: str
    api_url: str | None = None
    model: str
    system_prompt: str | None = None
    is_default: bool = False


async def list_providers(db: AsyncIOMotorDatabase) -> List[LLMProvider]:
    """Return all configured providers or fallback to the legacy Aliyun entry."""

    providers: List[LLMProvider] = []
    raw = await get_setting(db, "llm_providers", "")
    if raw:
        try:
            items = json.loads(raw)
        except json.JSONDecodeError:
            items = []
        for item in items:
            try:
                providers.append(LLMProvider(**item))
            except ValidationError:
                continue
    if providers:
        return providers

    # Fallback to legacy Aliyun configuration stored in settings/env for backwards compatibility.
    settings_map = await get_settings_map(db)
    settings = get_settings()
    api_key = settings_map.get("aliyun_api_key") or settings.aliyun_api_key
    if not api_key:
        return []
    return [
        LLMProvider(
            id="aliyun-default",
            name=settings_map.get("aliyun_display_name") or "Aliyun 默认模型",
            provider="aliyun",
            api_key=api_key,
            api_url=settings_map.get("aliyun_api_url") or settings.aliyun_api_url,
            model=settings_map.get("aliyun_model") or settings.aliyun_model,
            system_prompt=settings_map.get("aliyun_system_prompt") or settings.aliyun_system_prompt,
            is_default=True,
        )
    ]


async def save_providers(db: AsyncIOMotorDatabase, providers: Sequence[LLMProvider]) -> None:
    """Persist the provider collection as a single settings document."""

    providers = _normalize_defaults(list(providers))
    payload = json.dumps([provider.model_dump() for provider in providers], ensure_ascii=False)
    await upsert_setting(db, "llm_providers", payload)


async def resolve_provider(db: AsyncIOMotorDatabase, provider_id: str | None) -> LLMProvider:
    """Resolve a provider by ID or fall back to the configured default."""

    providers = await list_providers(db)
    if not providers:
        raise RuntimeError("No LLM provider configured")

    if provider_id:
        for provider in providers:
            if provider.id == provider_id:
                return provider
        raise RuntimeError("Invalid provider id")

    for provider in providers:
        if provider.is_default:
            return provider
    return providers[0]


def _normalize_defaults(providers: List[LLMProvider]) -> List[LLMProvider]:
    if not providers:
        return providers

    defaults = [idx for idx, provider in enumerate(providers) if provider.is_default]
    if len(defaults) == 0:
        providers[0].is_default = True
    elif len(defaults) > 1:
        keep = defaults[0]
        for idx in defaults[1:]:
            providers[idx].is_default = False

    return providers
