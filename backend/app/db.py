"""
MongoDB connection and index setup.

Collections:
  users        - accounts (username, password hash, role, metadata)
  scans        - every scanned code tied to a user + inventory_date
  config       - single-document key/value store (active_inventory, etc.)
  deletions    - audit trail for every scan deletion (never physically deleted)
"""
from __future__ import annotations

import logging
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.config import settings

logger = logging.getLogger(__name__)

_client: AsyncIOMotorClient | None = None
_db: AsyncIOMotorDatabase | None = None


def get_db() -> AsyncIOMotorDatabase:
    if _db is None:
        raise RuntimeError("Database not initialized - did startup run?")
    return _db


async def connect_and_init() -> None:
    global _client, _db
    _client = AsyncIOMotorClient(settings.MONGODB_URI)
    _db = _client[settings.MONGODB_DB_NAME]

    await _client.admin.command("ping")
    logger.info("Connected to MongoDB at %s (db=%s)", settings.MONGODB_URI, settings.MONGODB_DB_NAME)

    # Unique per (user, code, inventory_date) - same code allowed across
    # different inventories, and same code allowed for different users on
    # the same inventory (cross-user duplicates are legitimate).
    await _db.users.create_index("username", unique=True)
    await _db.scans.create_index(
        [("user_id", 1), ("code", 1), ("inventory_date", 1)], unique=True
    )
    await _db.scans.create_index([("inventory_date", 1), ("user_id", 1)])
    await _db.deletions.create_index([("inventory_date", 1), ("user_id", 1)])
    await _db.deletions.create_index("scan_id")
    logger.info("MongoDB indexes ensured.")


async def close() -> None:
    if _client is not None:
        _client.close()
