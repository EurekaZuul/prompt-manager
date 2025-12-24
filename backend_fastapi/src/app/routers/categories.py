from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, Field

from app.dependencies import get_db
from app.utils import generate_id

router = APIRouter()


class CategoryCreateRequest(BaseModel):
    name: str = Field(..., max_length=50)
    color: str | None = Field(default="#6366f1")


class CategoryUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=50)
    color: str | None = Field(default=None)


@router.get("/categories")
async def list_categories(db: AsyncIOMotorDatabase = Depends(get_db)) -> Dict[str, Any]:
    categories: List[Dict[str, Any]] = []
    async for doc in db.categories.find({}).sort("created_at", -1):
        categories.append(_serialize_category(doc))
    return {"data": categories, "total": len(categories)}


@router.get("/categories/{category_id}")
async def get_category(category_id: str, db: AsyncIOMotorDatabase = Depends(get_db)) -> Dict[str, Any]:
    doc = await db.categories.find_one({"_id": category_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Category not found")
    return _serialize_category(doc)


@router.post("/categories", status_code=201)
async def create_category(request: CategoryCreateRequest, db: AsyncIOMotorDatabase = Depends(get_db)) -> Dict[str, Any]:
    existing = await db.categories.find_one({"name": request.name})
    if existing:
        raise HTTPException(status_code=400, detail="Category already exists")

    doc = {
        "_id": generate_id(),
        "name": request.name,
        "color": request.color or "#6366f1",
        "created_at": datetime.now(timezone.utc),
    }
    await db.categories.insert_one(doc)
    return _serialize_category(doc)


@router.put("/categories/{category_id}")
async def update_category(category_id: str, request: CategoryUpdateRequest, db: AsyncIOMotorDatabase = Depends(get_db)) -> Dict[str, Any]:
    doc = await db.categories.find_one({"_id": category_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Category not found")

    update_fields: Dict[str, Any] = {}
    if request.name is not None:
        update_fields["name"] = request.name
    if request.color is not None:
        update_fields["color"] = request.color
    if update_fields:
        await db.categories.update_one({"_id": category_id}, {"$set": update_fields})

    updated = await db.categories.find_one({"_id": category_id})
    return _serialize_category(updated)


@router.delete("/categories/{category_id}")
async def delete_category(category_id: str, db: AsyncIOMotorDatabase = Depends(get_db)) -> Dict[str, str]:
    await db.categories.delete_one({"_id": category_id})
    return {"message": "Category deleted successfully"}


def _serialize_category(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": doc["_id"],
        "name": doc["name"],
        "color": doc.get("color", "#6366f1"),
        "created_at": doc.get("created_at"),
    }
