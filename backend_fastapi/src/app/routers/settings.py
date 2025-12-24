from __future__ import annotations

import json
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException
from sse_starlette.sse import EventSourceResponse
from motor.motor_asyncio import AsyncIOMotorDatabase

from pydantic import BaseModel

from app.dependencies import get_db
from app.services import aliyun_service, provider_service
from app.services.settings_store import get_settings_map, upsert_setting

router = APIRouter()


@router.get("/settings")
async def read_settings(db: AsyncIOMotorDatabase = Depends(get_db)) -> Dict[str, str]:
    return await get_settings_map(db)


@router.post("/settings")
async def update_settings(payload: Dict[str, str], db: AsyncIOMotorDatabase = Depends(get_db)) -> Dict[str, str]:
    for key, value in payload.items():
        await upsert_setting(db, key, value)
    return {"status": "success"}


class OptimizePromptRequest(BaseModel):
    prompt: str
    stream: bool = False
    model: str | None = None
    provider_id: str | None = None
    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None


class LLMProviderPayload(BaseModel):
    id: str
    name: str
    provider: str
    api_key: str
    api_url: str | None = None
    model: str
    system_prompt: str | None = None
    is_default: bool = False


class ProviderListPayload(BaseModel):
    providers: List[LLMProviderPayload]


@router.get("/llm-providers")
async def list_llm_providers(db: AsyncIOMotorDatabase = Depends(get_db)) -> List[Dict[str, Any]]:
    providers = await provider_service.list_providers(db)
    return [provider.model_dump() for provider in providers]


@router.post("/llm-providers")
async def save_llm_providers(payload: ProviderListPayload, db: AsyncIOMotorDatabase = Depends(get_db)) -> Dict[str, str]:
    providers = [provider_service.LLMProvider(**provider.model_dump()) for provider in payload.providers]
    await provider_service.save_providers(db, providers)
    return {"status": "success"}


@router.post("/optimize-prompt")
async def optimize_prompt(payload: OptimizePromptRequest, db: AsyncIOMotorDatabase = Depends(get_db)):
    try:
        provider = await provider_service.resolve_provider(db, payload.provider_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    api_key = provider.api_key
    api_url = provider.api_url
    model = payload.model or provider.model
    system_prompt = provider.system_prompt or aliyun_service.DEFAULT_SYSTEM_PROMPT

    if payload.stream:
        async def event_generator():
            try:
                async for chunk in aliyun_service.call_aliyun_stream(api_key, api_url, model, system_prompt, payload.prompt):
                    yield {"event": "message", "data": json.dumps({"text": chunk})}
            except Exception as exc:  # pragma: no cover - stream errors
                yield {"event": "error", "data": str(exc)}

        return EventSourceResponse(event_generator())

    optimized = await aliyun_service.call_aliyun(api_key, api_url, model, system_prompt, payload.prompt)
    return {"optimized_prompt": optimized}
