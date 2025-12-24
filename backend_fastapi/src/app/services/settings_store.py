from __future__ import annotations

from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

async def get_settings_map(db: AsyncIOMotorDatabase) -> dict[str, str]:
    settings: dict[str, str] = {}
    async for doc in db.settings.find({}):
        settings[doc.get("_id") or doc.get("key")] = doc.get("value", "")
    return settings


async def upsert_setting(db: AsyncIOMotorDatabase, key: str, value: str) -> None:
    now = datetime.now(timezone.utc)
    await db.settings.update_one(
        {"_id": key},
        {
            "$set": {"value": value, "updated_at": now},
            "$setOnInsert": {"created_at": now, "description": ""},
        },
        upsert=True,
    )


async def get_setting(db: AsyncIOMotorDatabase, key: str, default: str = "") -> str:
    doc = await db.settings.find_one({"_id": key})
    if doc and doc.get("value"):
        return str(doc.get("value"))
    return default
