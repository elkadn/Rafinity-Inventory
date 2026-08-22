"""Oracle connection and the small document-shaped adapter used by routes."""
from __future__ import annotations

import logging
from typing import Any

import oracledb

from app.config import settings

logger = logging.getLogger(__name__)

class DuplicateKeyError(Exception):
    """Raised when an Oracle unique constraint rejects an insert."""


_pool: oracledb.AsyncConnectionPool | None = None


def _is_duplicate(error: oracledb.Error) -> bool:
    return "ORA-00001" in str(error)


class _Cursor:
    def __init__(self, database: "OracleDatabase", table: str, query: dict[str, Any]):
        self.database, self.table, self.query = database, table, query
        self.order_by: str | None = None
        self.descending = False

    def sort(self, field: str, direction: int) -> "_Cursor":
        self.order_by, self.descending = field, direction < 0
        return self

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        return await self.database._find(self.table, self.query, self.order_by, self.descending, length)


class _Collection:
    def __init__(self, database: "OracleDatabase", table: str):
        self.database, self.table = database, table

    async def find_one(self, query: dict[str, Any]) -> dict[str, Any] | None:
        rows = await self.database._find(self.table, query, None, False, 1)
        return rows[0] if rows else None

    def find(self, query: dict[str, Any]) -> _Cursor:
        return _Cursor(self.database, self.table, query)

    async def insert_one(self, document: dict[str, Any]) -> None:
        await self.database._insert(self.table, document)

    async def delete_one(self, query: dict[str, Any]) -> None:
        await self.database._delete(self.table, query)

    async def update_one(self, query: dict[str, Any], update: dict[str, Any]) -> Any:
        return await self.database._update(self.table, query, update.get("$set", {}))

    async def replace_one(self, query: dict[str, Any], document: dict[str, Any], upsert: bool = False) -> None:
        await self.database._replace(self.table, query, document, upsert)

    async def distinct(self, field: str) -> list[Any]:
        return await self.database._distinct(self.table, field)

    def aggregate(self, pipeline: list[dict[str, Any]]) -> _Cursor:
        return _Cursor(self.database, self.table, {"__pipeline__": pipeline})


class OracleDatabase:
    def __init__(self, pool: oracledb.AsyncConnectionPool):
        self.pool = pool
        self.users = _Collection(self, "users")
        self.scans = _Collection(self, "scans")
        self.deletions = _Collection(self, "deletions")
        self.config = _Collection(self, "config")

    async def _execute(self, sql: str, binds: dict[str, Any] | None = None, *, many: bool = False) -> list[dict[str, Any]]:
        async with self.pool.acquire() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(sql, binds or {})
                if cursor.description is None:
                    await connection.commit()
                    return []
                columns = ["_id" if column[0].lower() == "id" else column[0].lower() for column in cursor.description]
                return [dict(zip(columns, row)) for row in await cursor.fetchall()]

    async def _find(self, table: str, query: dict[str, Any], order: str | None, desc: bool, length: int | None) -> list[dict[str, Any]]:
        pipeline = query.get("__pipeline__")
        if pipeline:
            return await self._aggregate(table, pipeline)
        where, binds = self._where(query)
        sql = f"select * from {self._table(table)}{where}"
        if order:
            sql += f" order by {self._column(order)} {'desc' if desc else 'asc'}"
        if length:
            sql = f"select * from ({sql}) where rownum <= {int(length)}"
        return await self._execute(sql, binds)

    def _table(self, table: str) -> str:
        return {"users": "APP_USERS", "scans": "APP_SCANS", "deletions": "APP_DELETIONS", "config": "APP_CONFIG"}[table]

    def _column(self, field: str) -> str:
        return {"_id": "ID", "user_id": "USER_ID", "inventory_date": "INVENTORY_DATE", "scanned_at": "SCANNED_AT", "deleted_at": "DELETED_AT", "scan_id": "SCAN_ID"}.get(field, field.upper())

    def _where(self, query: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        parts, binds = [], {}
        for index, (field, value) in enumerate(query.items()):
            column = self._column(field)
            if isinstance(value, dict) and "$nin" in value:
                names = []
                for item_index, item in enumerate(value["$nin"]):
                    name = f"b{index}_{item_index}"; names.append(f":{name}"); binds[name] = item
                parts.append(f"{column} not in ({','.join(names)})" if names else "1=1")
            else:
                name = f"b{index}"; parts.append(f"{column} = :{name}"); binds[name] = value
        return (" where " + " and ".join(parts)) if parts else "", binds

    async def _insert(self, table: str, document: dict[str, Any]) -> None:
        columns = list(document)
        oracle_columns = [self._column(column) for column in columns]
        binds = dict(zip(oracle_columns, document.values()))
        sql = f"insert into {self._table(table)} ({','.join(oracle_columns)}) values ({','.join(':'+column for column in oracle_columns)})"
        try:
            await self._execute(sql, binds)
        except oracledb.Error as error:
            if _is_duplicate(error): raise DuplicateKeyError from error
            raise

    async def _delete(self, table: str, query: dict[str, Any]) -> None:
        where, binds = self._where(query)
        await self._execute(f"delete from {self._table(table)}{where}", binds)

    async def _update(self, table: str, query: dict[str, Any], values: dict[str, Any]) -> Any:
        where, binds = self._where(query)
        sets = []
        for index, (field, value) in enumerate(values.items()):
            name = f"u{index}"; sets.append(f"{self._column(field)} = :{name}"); binds[name] = value
        await self._execute(f"update {self._table(table)} set {','.join(sets)}{where}", binds)
        return type("UpdateResult", (), {"matched_count": 1})()

    async def _replace(self, table: str, query: dict[str, Any], document: dict[str, Any], upsert: bool) -> None:
        existing = await self._find(table, query, None, False, 1)
        if existing:
            await self._update(table, query, {k: v for k, v in document.items() if k != "_id"})
        elif upsert:
            await self._insert(table, document)

    async def _distinct(self, table: str, field: str) -> list[Any]:
        rows = await self._execute(f"select distinct {self._column(field)} from {self._table(table)}")
        return [next(iter(row.values())) for row in rows]

    async def _aggregate(self, table: str, pipeline: list[dict[str, Any]]) -> list[dict[str, Any]]:
        # The two admin reports are expressed explicitly in SQL for Oracle.
        match = next((stage.get("$match", {}) for stage in pipeline if "$match" in stage), {})
        where, binds = self._where(match)
        if any("$group" in stage and "$push" in str(stage) for stage in pipeline):
            sql = f"select inventory_date, user_id, count(*) as scan_count from APP_SCANS{where} group by inventory_date, user_id order by inventory_date desc"
            rows = await self._execute(sql, binds)
            grouped: dict[str, dict[str, Any]] = {}
            for row in rows:
                day = grouped.setdefault(row["inventory_date"], {"_id": row["inventory_date"], "total_scans": 0, "users": []})
                count = int(row["scan_count"])
                day["total_scans"] += count
                day["users"].append({"user_id": row["user_id"], "count": count})
            return list(grouped.values())
        sql = f"select code, username, method, count(*) as code_count from APP_SCANS{where} group by code, username, method order by code"
        rows = await self._execute(sql, binds)
        grouped = {}
        for row in rows:
            entry = grouped.setdefault(row["code"], {"_id": row["code"], "count": 0, "users": [], "methods": []})
            entry["count"] += int(row["code_count"])
            if row["username"] not in entry["users"]:
                entry["users"].append(row["username"])
            if row["method"] not in entry["methods"]:
                entry["methods"].append(row["method"])
        return list(grouped.values())


_database: OracleDatabase | None = None


def get_db() -> OracleDatabase:
    if _database is None:
        raise RuntimeError("Database not initialized - did startup run?")
    return _database


async def connect_and_init() -> None:
    global _pool, _database
    _pool = oracledb.create_pool_async(user=settings.ORACLE_USER,password=settings.ORACLE_PASSWORD,dsn=settings.ORACLE_DSN,min=settings.ORACLE_POOL_MIN,max=settings.ORACLE_POOL_MAX)
    _database = OracleDatabase(_pool)
    async with _pool.acquire() as connection:
        await connection.ping()
    logger.info("Connected to Oracle at %s", settings.ORACLE_DSN)


async def close() -> None:
    global _pool, _database
    if _pool is not None:
        await _pool.close()
    _pool = None
    _database = None
