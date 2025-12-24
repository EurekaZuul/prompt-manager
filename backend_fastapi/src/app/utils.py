from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict
import uuid


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def generate_id() -> str:
    return str(uuid.uuid4())


def serialize_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.iso8601() if hasattr(value, "iso8601") else value.isoformat()


def replace_id(document: Dict[str, Any]) -> Dict[str, Any]:
    if not document:
        return document
    if "_id" in document:
        document = {**document, "id": document.pop("_id")}
    return document
