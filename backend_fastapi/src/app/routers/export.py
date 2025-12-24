from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, Field

from app.dependencies import get_db
from app.utils import generate_id

router = APIRouter()


class ExportRequest(BaseModel):
    project_ids: List[str] = Field(..., min_length=1)
    format: Literal["json", "csv", "yaml"]


@router.post("/export")
async def export_data(request: ExportRequest, db: AsyncIOMotorDatabase = Depends(get_db)):
    projects = []
    for project_id in request.project_ids:
        project = await db.projects.find_one({"_id": project_id})
        if not project:
            continue
        prompts = [prompt async for prompt in db.prompts.find({"project_id": project_id}).sort("created_at", -1)]
        for prompt in prompts:
            tag_docs = [tag async for tag in db.tags.find({"_id": {"$in": prompt.get("tag_ids", [])}})]
            prompt["tags"] = tag_docs
        project_copy = {**project, "prompts": prompts}
        projects.append(project_copy)

    if request.format == "json":
        payload = {
            "export_time": datetime.now(timezone.utc).isoformat(),
            "projects": projects,
        }
        return JSONResponse(payload)

    if request.format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["项目ID", "项目名称", "项目描述", "版本ID", "版本号", "提示词内容", "版本描述", "标签", "创建时间"])
        for project in projects:
            prompts = project.get("prompts", [])
            if not prompts:
                writer.writerow([project["_id"], project.get("name"), project.get("description", ""), "", "", "", "", "", ""])
            else:
                for prompt in prompts:
                    tag_names = ";".join(tag.get("name") for tag in prompt.get("tags", []))
                    writer.writerow(
                        [
                            project["_id"],
                            project.get("name"),
                            project.get("description", ""),
                            prompt.get("_id"),
                            prompt.get("version"),
                            prompt.get("content", ""),
                            prompt.get("description", ""),
                            tag_names,
                            (prompt.get("created_at") or datetime.now(timezone.utc)).isoformat(),
                        ]
                    )
        output.seek(0)
        return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=prompts_export.csv"})

    if request.format == "yaml":
        yaml_builder = []
        for project in projects:
            latest_prompts: Dict[str, Dict[str, Any]] = {}
            for prompt in project.get("prompts", []):
                key = prompt.get("name", "")
                existing = latest_prompts.get(key)
                if not existing or prompt.get("version") > existing.get("version", ""):
                    latest_prompts[key] = prompt
            for name, prompt in sorted(latest_prompts.items(), key=lambda item: item[0]):
                content = (prompt.get("content", "") or "").replace("\n", "\n  ")
                yaml_builder.append(f"{name}: |\n  {content}\n")
        yaml_text = "".join(yaml_builder)
        return StreamingResponse(iter([yaml_text]), media_type="application/x-yaml", headers={"Content-Disposition": "attachment; filename=prompts_export.yaml"})

    raise HTTPException(status_code=400, detail="Unsupported format")


def _parse_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            pass
    return datetime.now(timezone.utc)


@router.post("/import")
async def import_data(
    file: UploadFile = File(...),
    format: Optional[str] = Form(default=None),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    content = await file.read()
    fmt = format or file.filename.split(".")[-1].lower()

    if fmt == "json":
        data = json.loads(content)
        projects = data.get("projects", [])
        imported = 0
        skipped = 0
        errors: List[str] = []
        for project in projects:
            project_id = project.get("_id") or project.get("id")
            if not project_id:
                skipped += 1
                errors.append("Missing project id")
                continue
            await db.projects.update_one(
                {"_id": project_id},
                {
                    "$set": {
                        "name": project.get("name"),
                        "description": project.get("description", ""),
                        "created_at": _parse_datetime(project.get("created_at")),
                        "updated_at": _parse_datetime(project.get("updated_at")),
                    }
                },
                upsert=True,
            )
            prompts = project.get("prompts", [])
            for prompt in prompts:
                prompt_id = prompt.get("_id") or prompt.get("id") or generate_id()
                tag_ids = []
                for tag in prompt.get("tags", []):
                    tag_id = tag.get("_id") or tag.get("id") or generate_id()
                    await db.tags.update_one(
                        {"_id": tag_id},
                        {
                            "$set": {
                                "name": tag.get("name"),
                                "color": tag.get("color", "#3b82f6"),
                                "created_at": _parse_datetime(tag.get("created_at")),
                            }
                        },
                        upsert=True,
                    )
                    tag_ids.append(tag_id)
                await db.prompts.update_one(
                    {"_id": prompt_id},
                    {
                        "$set": {
                            "project_id": project_id,
                            "name": prompt.get("name", ""),
                            "version": prompt.get("version", "1.0.0"),
                            "content": prompt.get("content", ""),
                            "description": prompt.get("description", ""),
                            "category": prompt.get("category"),
                            "tag_ids": tag_ids,
                            "created_at": _parse_datetime(prompt.get("created_at")),
                        }
                    },
                    upsert=True,
                )
            imported += 1
        return {"success": True, "imported": imported, "skipped": skipped, "errors": errors}

    if fmt == "csv":
        reader = csv.reader(io.StringIO(content.decode("utf-8")))
        try:
            next(reader)
        except StopIteration:
            raise HTTPException(status_code=400, detail="Empty CSV file")
        imported = 0
        skipped = 0
        errors: List[str] = []
        for row in reader:
            if len(row) < 9:
                skipped += 1
                errors.append("Invalid row format")
                continue
            project_id, project_name, project_desc, prompt_id, version, prompt_content, prompt_desc, tag_names, created_at = row
            await db.projects.update_one(
                {"_id": project_id},
                {
                    "$set": {
                        "name": project_name,
                        "description": project_desc,
                        "updated_at": datetime.now(timezone.utc),
                    },
                    "$setOnInsert": {"created_at": datetime.now(timezone.utc)},
                },
                upsert=True,
            )
            if prompt_id:
                tags = []
                for name in filter(None, [s.strip() for s in tag_names.split(";")]):
                    tag_doc = await db.tags.find_one({"name": name})
                    if not tag_doc:
                        tag_doc = {
                            "_id": generate_id(),
                            "name": name,
                            "color": "#3b82f6",
                            "created_at": datetime.now(timezone.utc),
                        }
                        await db.tags.insert_one(tag_doc)
                    tags.append(tag_doc["_id"])
                await db.prompts.update_one(
                    {"_id": prompt_id},
                    {
                        "$set": {
                            "project_id": project_id,
                            "name": project_name,
                            "version": version or "1.0.0",
                            "content": prompt_content,
                            "description": prompt_desc,
                            "tag_ids": tags,
                            "created_at": _parse_datetime(created_at) if created_at else datetime.now(timezone.utc),
                        }
                    },
                    upsert=True,
                )
            imported += 1
        return {"success": True, "imported": imported, "skipped": skipped, "errors": errors}

    raise HTTPException(status_code=400, detail="Unsupported import format")
