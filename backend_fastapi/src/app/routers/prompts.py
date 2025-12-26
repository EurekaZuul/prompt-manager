from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.dependencies import get_db
from app.schemas.models import DiffResult, Prompt, PromptTestHistory
from app.services import aliyun_service, provider_service
from app.services.diff_service import DiffService
from app.services.version_service import VersionService
from app.utils import generate_id

router = APIRouter()

version_service = VersionService()
diff_service = DiffService()


class PromptCreateRequest(BaseModel):
    name: str = Field(..., max_length=100)
    content: str
    tag_ids: List[str] | None = None
    category: str
    description: Optional[str] = None


class PromptUpdateRequest(BaseModel):
    content: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    tag_ids: Optional[List[str]] = None
    bump: str | None = Field(default="patch")


class TestPromptRequest(BaseModel):
    messages: List[Dict[str, str]]
    stream: bool = False
    provider_id: Optional[str] = None
    model: Optional[str] = None
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    max_tokens: Optional[int] = None


class PromptTestHistoryCreateRequest(BaseModel):
    messages: List[Dict[str, str]]
    response: Optional[str] = None
    title: Optional[str] = None
    provider_id: Optional[str] = None
    provider_name: Optional[str] = None
    model: Optional[str] = None
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    max_tokens: Optional[int] = None
    variable_values: Dict[str, str] | None = None
    variable_prefix: Optional[str] = None
    variable_suffix: Optional[str] = None
    token_count: Optional[int] = None
    cost: Optional[float] = None
    input_price: Optional[float] = None
    output_price: Optional[float] = None


class PromptTestHistoryUpdateRequest(BaseModel):
    title: Optional[str] = None


@router.get("/projects/{project_id}/prompts")
async def list_prompts(
    project_id: str,
    tag: Optional[str] = Query(default=None),
    version: Optional[str] = Query(default=None),
    name: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> Dict[str, Any]:
    filter_: Dict[str, Any] = {"project_id": project_id}

    if version:
        filter_["version"] = version
    if name:
        filter_["name"] = name
    if category:
        filter_["category"] = category

    date_filter: Dict[str, Any] = {}
    if start_date:
        date_filter["$gte"] = datetime.fromisoformat(start_date)
    if end_date:
        date_filter["$lte"] = datetime.fromisoformat(end_date)
    if date_filter:
        filter_["created_at"] = date_filter

    if tag:
        tag_doc = await db.tags.find_one({"name": tag})
        if not tag_doc:
            return {"data": [], "total": 0}
        filter_["tag_ids"] = tag_doc["_id"]

    cursor = db.prompts.find(filter_).sort("created_at", -1)
    prompts: List[Dict[str, Any]] = []
    async for doc in cursor:
        prompt = await _serialize_prompt(doc, db)
        prompts.append(prompt.model_dump())

    return {"data": prompts, "total": len(prompts)}


@router.get("/prompts/{prompt_id}")
async def get_prompt(prompt_id: str, db: AsyncIOMotorDatabase = Depends(get_db)) -> Dict[str, Any]:
    doc = await db.prompts.find_one({"_id": prompt_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Prompt not found")
    prompt = await _serialize_prompt(doc, db, include_project=True, include_history=True)
    return prompt.model_dump()


@router.post("/projects/{project_id}/prompts", status_code=201)
async def create_prompt(project_id: str, payload: PromptCreateRequest, db: AsyncIOMotorDatabase = Depends(get_db)) -> Dict[str, Any]:
    await _ensure_project_exists(db, project_id)
    await _ensure_category_exists(db, payload.category)
    tags = await _fetch_tags_by_ids(db, payload.tag_ids or [])

    last_prompt = await db.prompts.find_one(
        {"project_id": project_id, "name": payload.name},
        sort=[("created_at", -1)],
    )
    if last_prompt:
        new_version = version_service.generate_next_version(last_prompt.get("version"), "patch")
    else:
        new_version = "1.0.0"

    doc = {
        "_id": generate_id(),
        "project_id": project_id,
        "name": payload.name,
        "version": new_version,
        "content": payload.content,
        "description": payload.description or "",
        "category": payload.category,
        "tag_ids": [tag["_id"] for tag in tags],
        "created_at": datetime.now(timezone.utc),
    }
    await db.prompts.insert_one(doc)

    history = {
        "_id": generate_id(),
        "prompt_id": doc["_id"],
        "project_id": project_id,
        "operation": "create",
        "old_content": "",
        "new_content": payload.content,
        "created_at": datetime.now(timezone.utc),
    }
    await db.prompt_histories.insert_one(history)

    prompt = await _serialize_prompt(doc, db)
    return prompt.model_dump()


@router.put("/prompts/{prompt_id}")
async def update_prompt(prompt_id: str, payload: PromptUpdateRequest, db: AsyncIOMotorDatabase = Depends(get_db)) -> Dict[str, Any]:
    existing = await db.prompts.find_one({"_id": prompt_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Prompt not found")

    await _ensure_project_exists(db, existing["project_id"])

    tags = None
    if payload.tag_ids is not None:
        tags = await _fetch_tags_by_ids(db, payload.tag_ids)

    if payload.category:
        await _ensure_category_exists(db, payload.category)

    content_changed = payload.content is not None and payload.content != existing.get("content")
    bump_type = payload.bump or "patch"

    if content_changed:
        new_version = version_service.generate_next_version(existing.get("version"), bump_type)
        new_doc = {
            "_id": generate_id(),
            "project_id": existing["project_id"],
            "name": existing["name"],
            "version": new_version,
            "content": payload.content,
            "description": payload.description if payload.description is not None else existing.get("description", ""),
            "category": payload.category or existing.get("category"),
            "tag_ids": [tag["_id"] for tag in (tags or [])] or existing.get("tag_ids", []),
            "created_at": datetime.now(timezone.utc),
        }
        await db.prompts.insert_one(new_doc)

        history = {
            "_id": generate_id(),
            "prompt_id": new_doc["_id"],
            "project_id": existing["project_id"],
            "operation": "update",
            "old_content": existing.get("content"),
            "new_content": payload.content,
            "created_at": datetime.now(timezone.utc),
        }
        await db.prompt_histories.insert_one(history)

        prompt = await _serialize_prompt(new_doc, db)
        return prompt.model_dump()

    update_fields: Dict[str, Any] = {}
    if payload.description is not None:
        update_fields["description"] = payload.description
    if payload.category is not None:
        update_fields["category"] = payload.category
    if tags is not None:
        update_fields["tag_ids"] = [tag["_id"] for tag in tags]
    if update_fields:
        await db.prompts.update_one({"_id": prompt_id}, {"$set": update_fields})

    updated = await db.prompts.find_one({"_id": prompt_id})
    prompt = await _serialize_prompt(updated, db)
    return prompt.model_dump()


@router.delete("/prompts/{prompt_id}")
async def delete_prompt(prompt_id: str, db: AsyncIOMotorDatabase = Depends(get_db)) -> Dict[str, str]:
    await db.prompt_histories.delete_many({"prompt_id": prompt_id})
    await db.prompts.delete_one({"_id": prompt_id})
    return {"message": "Prompt deleted successfully"}


@router.get("/prompts/{prompt_id}/diff/{target_id}")
async def get_prompt_diff(prompt_id: str, target_id: str, db: AsyncIOMotorDatabase = Depends(get_db)) -> Dict[str, Any]:
    source = await db.prompts.find_one({"_id": prompt_id})
    target = await db.prompts.find_one({"_id": target_id})
    if not source or not target:
        raise HTTPException(status_code=404, detail="Prompt not found")

    diff: DiffResult = diff_service.compare_texts(source.get("content", ""), target.get("content", ""))

    return {
        "source_version": source.get("version"),
        "target_version": target.get("version"),
        "diff": diff.model_dump(),
    }


@router.post("/prompts/{prompt_id}/rollback")
async def rollback_prompt(prompt_id: str, db: AsyncIOMotorDatabase = Depends(get_db)) -> Dict[str, Any]:
    source = await db.prompts.find_one({"_id": prompt_id})
    if not source:
        raise HTTPException(status_code=404, detail="Source prompt not found")

    last_prompt = await db.prompts.find_one(
        {"project_id": source["project_id"], "name": source["name"]},
        sort=[("created_at", -1)],
    )
    new_version = version_service.generate_next_version(last_prompt.get("version") if last_prompt else "", "patch")

    new_doc = {
        "_id": generate_id(),
        "project_id": source["project_id"],
        "name": source["name"],
        "version": new_version,
        "content": source.get("content", ""),
        "description": f"Rollback to version {source.get('version')}",
        "category": source.get("category"),
        "tag_ids": source.get("tag_ids", []),
        "created_at": datetime.now(timezone.utc),
    }
    await db.prompts.insert_one(new_doc)

    history = {
        "_id": generate_id(),
        "prompt_id": new_doc["_id"],
        "project_id": source["project_id"],
        "operation": "rollback",
        "old_content": "",
        "new_content": source.get("content"),
        "created_at": datetime.now(timezone.utc),
    }
    await db.prompt_histories.insert_one(history)

    prompt = await _serialize_prompt(new_doc, db)
    return prompt.model_dump()


@router.get("/projects/{project_id}/sdk/prompt")
async def get_sdk_prompt(
    project_id: str,
    name: str = Query(...),
    version: Optional[str] = Query(default=None),
    tag: Optional[str] = Query(default=None),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> Dict[str, str]:
    filter_: Dict[str, Any] = {"project_id": project_id, "name": name}
    if version:
        filter_["version"] = version
    if tag:
        tag_doc = await db.tags.find_one({"name": tag})
        if not tag_doc:
            raise HTTPException(status_code=404, detail="Tag not found")
        filter_["tag_ids"] = tag_doc["_id"]

    cursor = db.prompts.find(filter_).sort("created_at", -1)
    prompt = await cursor.to_list(length=1)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")

    return {"content": prompt[0].get("content", "")}


@router.post("/test-prompt")
async def test_prompt(payload: TestPromptRequest, db: AsyncIOMotorDatabase = Depends(get_db)):
    try:
        provider = await provider_service.resolve_provider(db, payload.provider_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    options = aliyun_service.ChatOptions(
        model=payload.model or provider.model,
        temperature=payload.temperature,
        top_p=payload.top_p,
        max_tokens=payload.max_tokens,
    )

    if payload.stream:
        async def event_generator():
            try:
                async for chunk in aliyun_service.call_aliyun_chat_stream(provider.api_key, provider.api_url, options, payload.messages):
                    yield {"event": "message", "data": json.dumps({"text": chunk})}
            except Exception as exc:  # pragma: no cover - streaming path
                yield {"event": "error", "data": str(exc)}

        return EventSourceResponse(event_generator())

    response = await aliyun_service.call_aliyun_chat(provider.api_key, provider.api_url, options, payload.messages)
    return {"response": response}


@router.get("/prompts/{prompt_id}/test-histories")
async def list_prompt_test_histories(
    prompt_id: str,
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> Dict[str, Any]:
    cursor = (
        db.prompt_test_histories.find({"prompt_id": prompt_id})
        .sort("created_at", -1)
        .limit(limit)
    )
    histories: List[Dict[str, Any]] = []
    async for doc in cursor:
        history = _serialize_prompt_test_history(doc)
        histories.append(history.model_dump())
    return {"data": histories, "total": len(histories)}


@router.post("/prompts/{prompt_id}/test-histories", status_code=201)
async def create_prompt_test_history(
    prompt_id: str,
    payload: PromptTestHistoryCreateRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> Dict[str, Any]:
    prompt = await db.prompts.find_one({"_id": prompt_id})
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found")

    doc = {
        "_id": generate_id(),
        "prompt_id": prompt_id,
        "project_id": prompt["project_id"],
        "title": (payload.title or "").strip()
        or _derive_history_title(payload.messages, payload.provider_name, payload.model),
        "messages": payload.messages,
        "response": payload.response or "",
        "provider_id": payload.provider_id,
        "provider_name": payload.provider_name,
        "model": payload.model,
        "temperature": payload.temperature,
        "top_p": payload.top_p,
        "max_tokens": payload.max_tokens,
        "variable_values": payload.variable_values or {},
        "variable_prefix": payload.variable_prefix,
        "variable_suffix": payload.variable_suffix,
        "token_count": payload.token_count,
        "cost": payload.cost,
        "input_price": payload.input_price,
        "output_price": payload.output_price,
        "created_at": datetime.now(timezone.utc),
    }
    await db.prompt_test_histories.insert_one(doc)
    history = _serialize_prompt_test_history(doc)
    return history.model_dump()


@router.get("/test-histories/{history_id}")
async def get_prompt_test_history(history_id: str, db: AsyncIOMotorDatabase = Depends(get_db)) -> Dict[str, Any]:
    doc = await db.prompt_test_histories.find_one({"_id": history_id})
    if not doc:
        raise HTTPException(status_code=404, detail="History not found")
    history = _serialize_prompt_test_history(doc)
    return history.model_dump()


@router.patch("/test-histories/{history_id}")
async def update_prompt_test_history(
    history_id: str,
    payload: PromptTestHistoryUpdateRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> Dict[str, Any]:
    doc = await db.prompt_test_histories.find_one({"_id": history_id})
    if not doc:
        raise HTTPException(status_code=404, detail="History not found")

    update_fields: Dict[str, Any] = {}
    if payload.title is not None:
        sanitized = payload.title.strip()
        update_fields["title"] = sanitized or _derive_history_title(
            doc.get("messages", []),
            doc.get("provider_name"),
            doc.get("model"),
        )

    if update_fields:
        await db.prompt_test_histories.update_one({"_id": history_id}, {"$set": update_fields})

    updated = await db.prompt_test_histories.find_one({"_id": history_id})
    history = _serialize_prompt_test_history(updated)
    return history.model_dump()


@router.delete("/test-histories/{history_id}")
async def delete_prompt_test_history(history_id: str, db: AsyncIOMotorDatabase = Depends(get_db)) -> Dict[str, str]:
    result = await db.prompt_test_histories.delete_one({"_id": history_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="History not found")
    return {"message": "History deleted"}


def _derive_history_title(messages: List[Dict[str, str]], provider_name: Optional[str], model: Optional[str]) -> str:
    for message in messages:
        content = (message.get("content") or "").strip()
        if message.get("role") == "user" and content:
            return content[:30] + ("..." if len(content) > 30 else "")
    base = provider_name or model or "测试记录"
    timestamp = datetime.now(timezone.utc).strftime("%m-%d %H:%M")
    return f"{base} · {timestamp}"


async def _serialize_prompt(
    doc: Dict[str, Any],
    db: AsyncIOMotorDatabase,
    include_project: bool = False,
    include_history: bool = False,
) -> Prompt:
    tags = []
    tag_ids = doc.get("tag_ids", [])
    if tag_ids:
        cursor = db.tags.find({"_id": {"$in": tag_ids}})
        async for tag in cursor:
            tags.append(
                {
                    "id": tag["_id"],
                    "name": tag["name"],
                    "color": tag.get("color", "#3b82f6"),
                    "created_at": tag.get("created_at"),
                }
            )

    project_data = None
    if include_project:
        project = await db.projects.find_one({"_id": doc["project_id"]})
        if project:
            project_data = {
                "id": project["_id"],
                "name": project["name"],
                "description": project.get("description", ""),
                "created_at": project.get("created_at"),
                "updated_at": project.get("updated_at", project.get("created_at")),
            }

    history_data = None
    if include_history:
        history_data = []
        cursor = db.prompt_histories.find({"prompt_id": doc["_id"]}).sort("created_at", -1)
        async for record in cursor:
            history_data.append(
                {
                    "id": record["_id"],
                    "prompt_id": record["prompt_id"],
                    "operation": record.get("operation"),
                    "old_content": record.get("old_content"),
                    "new_content": record.get("new_content"),
                    "created_at": record.get("created_at"),
                }
            )

    return Prompt(
        id=doc["_id"],
        project_id=doc["project_id"],
        name=doc.get("name", ""),
        version=doc.get("version", ""),
        content=doc.get("content", ""),
        description=doc.get("description"),
        category=doc.get("category"),
        created_at=doc.get("created_at"),
        tags=tags,
        history=history_data,
        project=project_data,
    )


def _serialize_prompt_test_history(doc: Dict[str, Any]) -> PromptTestHistory:
    return PromptTestHistory(
        id=doc["_id"],
        prompt_id=doc["prompt_id"],
        project_id=doc.get("project_id", ""),
        title=doc.get("title"),
        messages=doc.get("messages", []),
        response=doc.get("response"),
        provider_id=doc.get("provider_id"),
        provider_name=doc.get("provider_name"),
        model=doc.get("model"),
        temperature=doc.get("temperature"),
        top_p=doc.get("top_p"),
        max_tokens=doc.get("max_tokens"),
        variable_values=doc.get("variable_values"),
        variable_prefix=doc.get("variable_prefix"),
        variable_suffix=doc.get("variable_suffix"),
        token_count=doc.get("token_count"),
        cost=doc.get("cost"),
        input_price=doc.get("input_price"),
        output_price=doc.get("output_price"),
        created_at=doc.get("created_at"),
    )


async def _ensure_project_exists(db: AsyncIOMotorDatabase, project_id: str) -> None:
    project = await db.projects.find_one({"_id": project_id})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")


async def _ensure_category_exists(db: AsyncIOMotorDatabase, category_name: str) -> None:
    if not category_name:
        raise HTTPException(status_code=400, detail="category is required")
    exists = await db.categories.count_documents({"name": category_name})
    if exists == 0:
        raise HTTPException(status_code=400, detail="invalid category")


async def _fetch_tags_by_ids(db: AsyncIOMotorDatabase, tag_ids: List[str]) -> List[Dict[str, Any]]:
    if not tag_ids:
        return []
    cursor = db.tags.find({"_id": {"$in": tag_ids}})
    tags = [tag async for tag in cursor]
    if len(tags) != len(tag_ids):
        raise HTTPException(status_code=400, detail="invalid tag ids")
    return tags
