from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.config import get_settings


class MongoConnection:
    """Singleton-style MongoDB connection holder."""

    client: AsyncIOMotorClient | None = None
    database: AsyncIOMotorDatabase | None = None


def get_client() -> AsyncIOMotorClient:
    if MongoConnection.client is None:
        settings = get_settings()
        MongoConnection.client = AsyncIOMotorClient(settings.mongo_uri)
        MongoConnection.database = MongoConnection.client[settings.mongo_db]
    return MongoConnection.client


def get_database() -> AsyncIOMotorDatabase:
    if MongoConnection.database is None:
        get_client()
    assert MongoConnection.database is not None
    return MongoConnection.database


def close_client() -> None:
    if MongoConnection.client is not None:
        MongoConnection.client.close()
        MongoConnection.client = None
        MongoConnection.database = None
