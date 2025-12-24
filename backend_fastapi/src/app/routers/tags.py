from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, Field

from app.dependencies import get_db
from app.utils import generate_id

router = APIRouter()


class TagCreateRequest(BaseModel):
    name: str = Field(..., max_length=50)
    color: str | None = Field(default="#3b82f6")


class TagUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=50)
    color: str | None = Field(default=None)


@router.get("/tags")
async def list_tags(db: AsyncIOMotorDatabase = Depends(get_db)) -> Dict[str, Any]:
    tags: List[Dict[str, Any]] = []
    async for doc in db.tags.find({}).sort("created_at", -1):
        tags.append(_serialize_tag(doc))
    return {"data": tags, "total": len(tags)}


@router.get("/tags/{tag_id}")
async def get_tag(tag_id: str, db: AsyncIOMotorDatabase = Depends(get_db)) -> Dict[str, Any]:
    doc = await db.tags.find_one({"_id": tag_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Tag not found")
    return _serialize_tag(doc)


@router.post("/tags", status_code=201)
async def create_tag(request: TagCreateRequest, db: AsyncIOMotorDatabase = Depends(get_db)) -> Dict[str, Any]:
    existing = await db.tags.find_one({"name": request.name})
    if existing:
        raise HTTPException(status_code=400, detail="Tag already exists")

    doc = {
        "_id": generate_id(),
        "name": request.name,
        "color": request.color or "#3b82f6",
        "created_at": datetime.now(timezone.utc),
    }
    await db.tags.insert_one(doc)
    return _serialize_tag(doc)


@router.put("/tags/{tag_id}")
async def update_tag(tag_id: str, request: TagUpdateRequest, db: AsyncIOMotorDatabase = Depends(get_db)) -> Dict[str, Any]:
    doc = await db.tags.find_one({"_id": tag_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Tag not found")

    update_fields: Dict[str, Any] = {}
    if request.name is not None:
        update_fields["name"] = request.name
    if request.color is not None:
        update_fields["color"] = request.color
    if update_fields:
        await db.tags.update_one({"_id": tag_id}, {"$set": update_fields})
    updated = await db.tags.find_one({"_id": tag_id})
    return _serialize_tag(updated)


@router.delete("/tags/{tag_id}")
async def delete_tag(tag_id: str, db: AsyncIOMotorDatabase = Depends(get_db)) -> Dict[str, str]:
    await db.tags.delete_one({"_id": tag_id})
    await db.prompts.update_many({}, {"$pull": {"tag_ids": tag_id}})
    return {"message": "Tag deleted successfully"}


def _serialize_tag(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": doc["_id"],
        "name": doc["name"],
        "color": doc.get("color", "#3b82f6"),
        "created_at": doc.get("created_at"),
    }
