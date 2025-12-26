from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class Tag(BaseModel):
    id: str
    name: str
    color: str = Field(default="#3b82f6")
    created_at: datetime


class Category(BaseModel):
    id: str
    name: str
    color: str = Field(default="#6366f1")
    created_at: datetime


class PromptHistory(BaseModel):
    id: str
    prompt_id: str
    operation: str
    old_content: Optional[str] = None
    new_content: Optional[str] = None
    created_at: datetime


class Prompt(BaseModel):
    id: str
    project_id: str
    name: str
    version: str
    content: str
    description: Optional[str] = None
    category: Optional[str] = None
    created_at: datetime
    tags: List[Tag] | None = None
    history: List[PromptHistory] | None = None
    project: Optional["Project"] = None


class PromptTestHistory(BaseModel):
    id: str
    prompt_id: str
    project_id: str
    title: Optional[str] = None
    messages: List[Dict[str, str]]
    response: Optional[str] = None
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
    created_at: datetime


class ProjectPromptSummary(BaseModel):
    id: str
    project_id: str
    name: str
    created_at: datetime


class Project(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    prompts: List[ProjectPromptSummary] | None = None
    tags: List[Tag] | None = None


class Setting(BaseModel):
    key: str
    value: str
    description: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class DiffResult(BaseModel):
    additions: int
    deletions: int
    change_rate: float
    diff_html: str


class ApiResponse(BaseModel):
    data: list | dict
    total: Optional[int] = None
    error: Optional[str] = None
