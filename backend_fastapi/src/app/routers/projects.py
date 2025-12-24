from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, Field

from app.dependencies import get_db
from app.schemas.models import Project
from app.utils import generate_id

router = APIRouter()


class ProjectCreateRequest(BaseModel):
    name: str = Field(..., max_length=100)
    description: Optional[str] = None


class ProjectUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = None


@router.get("/projects")
async def list_projects(
    search: str | None = Query(default=None),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> Dict[str, Any]:
    filter_: Dict[str, Any] = {}
    if search:
        regex = {"$regex": search, "$options": "i"}
        filter_["$or"] = [{"name": regex}, {"description": regex}]

    cursor = db.projects.find(filter_).sort("created_at", -1)
    projects: List[Project] = []
    async for doc in cursor:
        projects.append(await _serialize_project(doc, db, include_prompts=True))

    return {"data": [proj.model_dump() for proj in projects], "total": len(projects)}


@router.get("/projects/{project_id}")
async def get_project(project_id: str, db: AsyncIOMotorDatabase = Depends(get_db)) -> Dict[str, Any]:
    doc = await db.projects.find_one({"_id": project_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Project not found")
    project = await _serialize_project(doc, db, include_prompts=True)
    return project.model_dump()


@router.post("/projects", status_code=201)
async def create_project(request: ProjectCreateRequest, db: AsyncIOMotorDatabase = Depends(get_db)) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    project_doc = {
        "_id": generate_id(),
        "name": request.name,
        "description": request.description or "",
        "created_at": now,
        "updated_at": now,
    }
    await db.projects.insert_one(project_doc)
    project = await _serialize_project(project_doc, db)
    return project.model_dump()


@router.put("/projects/{project_id}")
async def update_project(project_id: str, request: ProjectUpdateRequest, db: AsyncIOMotorDatabase = Depends(get_db)) -> Dict[str, Any]:
    doc = await db.projects.find_one({"_id": project_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Project not found")

    update_fields: Dict[str, Any] = {}
    if request.name is not None:
        update_fields["name"] = request.name
    if request.description is not None:
        update_fields["description"] = request.description
    update_fields["updated_at"] = datetime.now(timezone.utc)

    await db.projects.update_one({"_id": project_id}, {"$set": update_fields})
    updated = await db.projects.find_one({"_id": project_id})
    project = await _serialize_project(updated, db)
    return project.model_dump()


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str, db: AsyncIOMotorDatabase = Depends(get_db)) -> Dict[str, str]:
    project = await db.projects.find_one({"_id": project_id})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    prompt_ids = [doc["_id"] async for doc in db.prompts.find({"project_id": project_id}, {"_id": 1})]
    if prompt_ids:
        await db.prompt_histories.delete_many({"prompt_id": {"$in": prompt_ids}})
        await db.prompts.delete_many({"_id": {"$in": prompt_ids}})

    await db.projects.delete_one({"_id": project_id})
    return {"message": "Project deleted successfully"}


async def _serialize_project(doc: Dict[str, Any], db: AsyncIOMotorDatabase, include_prompts: bool = False) -> Project:
    prompts_summary = None
    if include_prompts:
        prompts_summary = []
        prompt_cursor = (
            db.prompts.find({"project_id": doc["_id"]}, {"_id": 1, "project_id": 1, "name": 1, "created_at": 1})
            .sort("created_at", -1)
        )
        async for prompt in prompt_cursor:
            prompts_summary.append(
                {
                    "id": prompt["_id"],
                    "project_id": prompt["project_id"],
                    "name": prompt.get("name", ""),
                    "created_at": prompt.get("created_at"),
                }
            )

    tags = await _collect_project_tags(doc, db)

    return Project(
        id=doc["_id"],
        name=doc["name"],
        description=doc.get("description", ""),
        created_at=doc["created_at"],
        updated_at=doc.get("updated_at", doc["created_at"]),
        prompts=prompts_summary,
        tags=tags,
    )


async def _collect_project_tags(project_doc: Dict[str, Any], db: AsyncIOMotorDatabase) -> List[Dict[str, Any]]:
    tag_ids = set()
    async for prompt in db.prompts.find({"project_id": project_doc["_id"]}, {"tag_ids": 1}):
        for tag_id in prompt.get("tag_ids", []):
            tag_ids.add(tag_id)

    if not tag_ids:
        return []

    tags_cursor = db.tags.find({"_id": {"$in": list(tag_ids)}})
    tags: List[Dict[str, Any]] = []
    async for tag in tags_cursor:
        tags.append(
            {
                "id": tag["_id"],
                "name": tag["name"],
                "color": tag.get("color", "#3b82f6"),
                "created_at": tag.get("created_at"),
            }
        )
    return tags
