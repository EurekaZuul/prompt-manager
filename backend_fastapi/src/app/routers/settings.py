from __future__ import annotations

import json
from typing import Dict

from fastapi import APIRouter, Depends, HTTPException
from sse_starlette.sse import EventSourceResponse
from motor.motor_asyncio import AsyncIOMotorDatabase

from pydantic import BaseModel

from app.config import get_settings
from app.dependencies import get_db
from app.services import aliyun_service
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
    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None


@router.post("/optimize-prompt")
async def optimize_prompt(payload: OptimizePromptRequest, db: AsyncIOMotorDatabase = Depends(get_db)):
    settings = get_settings()
    stored = await get_settings_map(db)

    api_key = stored.get("aliyun_api_key") or settings.aliyun_api_key
    if not api_key:
        raise HTTPException(status_code=400, detail="Aliyun API Key not configured")

    api_url = stored.get("aliyun_api_url") or settings.aliyun_api_url
    model = payload.model or stored.get("aliyun_model") or settings.aliyun_model
    system_prompt = stored.get("aliyun_system_prompt") or settings.aliyun_system_prompt or aliyun_service.DEFAULT_SYSTEM_PROMPT

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
