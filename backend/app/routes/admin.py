from __future__ import annotations

import csv
import io
import time
from typing import Optional

from openpyxl import Workbook
from openpyxl.styles import Font

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from app.auth import hash_password, require_admin, get_current_user
from app.db import DuplicateKeyError, get_db
from app.schemas import (
    ActiveInventory,
    DaySummary,
    DeletionRecord,
    InventorySetRequest,
    MergedCodeEntry,
    MergedDayResponse,
    ScanRecord,
    UserCreate,
    UserDayScans,
    UserPublic,
    UserUpdate,
    new_id,
)

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


async def _users_by_id() -> dict:
    db = get_db()
    docs = await db.users.find({}).to_list(length=1000)
    return {d["_id"]: d for d in docs}


# ------------------------------------------------------------------ #
# Inventory management
# ------------------------------------------------------------------ #
@router.get("/inventory/active", response_model=ActiveInventory | None)
async def get_active_inventory() -> ActiveInventory | None:
    db = get_db()
    doc = await db.config.find_one({"_id": "active_inventory"})
    if not doc:
        return None
    return ActiveInventory(
        inventory_date=doc["inventory_date"],
        label=doc.get("label"),
        set_at=doc["set_at"],
        set_by_username=doc["set_by_username"],
    )


@router.put("/inventory/active", response_model=ActiveInventory)
async def set_active_inventory(
    payload: InventorySetRequest,
    admin: UserPublic = Depends(require_admin),
) -> ActiveInventory:
    """
    Define the active inventory date. All scanners will immediately start
    registering their scans under this inventory_date (the endpoint
    GET /inventory/active is polled by the frontend every ~30s).
    Setting this does NOT affect previously scanned codes.
    """
    db = get_db()
    doc = {
        "_id": "active_inventory",
        "inventory_date": payload.inventory_date,
        "label": payload.label,
        "set_at": time.time(),
        "set_by_username": admin.username,
    }
    await db.config.replace_one({"_id": "active_inventory"}, doc, upsert=True)
    return ActiveInventory(**{k: v for k, v in doc.items() if k != "_id"})


@router.delete("/inventory/active", status_code=200)
async def clear_active_inventory() -> None:
    """Remove the active inventory setting (scanners fall back to today's date)."""
    db = get_db()
    await db.config.delete_one({"_id": "active_inventory"})


@router.get("/inventories", response_model=list[str])
async def list_inventory_dates() -> list[str]:
    """All distinct inventory_date values that have at least one scan."""
    db = get_db()
    dates = await db.scans.distinct("inventory_date")
    return sorted(dates, reverse=True)


# ------------------------------------------------------------------ #
# Scans - browsing by inventory_date then by user
# ------------------------------------------------------------------ #
@router.get("/days", response_model=list[DaySummary])
async def list_days() -> list[DaySummary]:
    """
    One entry per inventory_date that has at least one scan.
    The 'date' field here is the inventory_date set by the admin, NOT the
    real calendar date the scan happened on (that's scan_date/scanned_at).
    """
    db = get_db()
    users = await _users_by_id()
    pipeline = [
        {"$group": {"_id": {"date": "$inventory_date", "user_id": "$user_id"}, "count": {"$sum": 1}}},
        {"$group": {"_id": "$_id.date", "total_scans": {"$sum": "$count"}, "users": {"$push": {"user_id": "$_id.user_id", "count": "$count"}}}},
        {"$sort": {"_id": -1}},
    ]
    results = await db.scans.aggregate(pipeline).to_list(length=1000)
    days = []
    for r in results:
        enriched = []
        for u in r["users"]:
            info = users.get(u["user_id"], {})
            enriched.append({"user_id": u["user_id"], "username": info.get("username", "?"), "nom": info.get("nom", "?"), "prenom": info.get("prenom", "?"), "count": u["count"]})
        enriched.sort(key=lambda u: u["username"])
        days.append(DaySummary(date=r["_id"], total_scans=r["total_scans"], users=enriched))
    return days


@router.get("/days/{inventory_date}/users/{user_id}", response_model=UserDayScans)
async def user_scans_for_day(inventory_date: str, user_id: str) -> UserDayScans:
    db = get_db()
    user_doc = await db.users.find_one({"_id": user_id})
    if not user_doc:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    # Get deleted scan IDs so we can flag them in the admin view
    del_docs = await db.deletions.find({"user_id": user_id, "inventory_date": inventory_date}).to_list(length=10000)
    deleted_ids = {d["scan_id"] for d in del_docs}

    docs = await db.scans.find({"inventory_date": inventory_date, "user_id": user_id}).sort("scanned_at", -1).to_list(length=10000)
    scans = [ScanRecord(**{**d, "id": d["_id"]}) for d in docs]

    return UserDayScans(
        date=inventory_date,
        user=UserPublic(id=user_doc["_id"], username=user_doc["username"], nom=user_doc["nom"], prenom=user_doc["prenom"], role=user_doc["role"], ip_poste=user_doc.get("ip_poste"), date_creation=user_doc["date_creation"], statut=user_doc["statut"]),
        scans=scans,
        deleted_scan_ids=list(deleted_ids),
    )


@router.get("/days/{inventory_date}/merged", response_model=MergedDayResponse)
async def merged_day(inventory_date: str) -> MergedDayResponse:
    """All unique codes for this inventory_date, across every user. Excludes deleted scans."""
    db = get_db()
    # Get all deleted scan IDs for this inventory
    del_docs = await db.deletions.find({"inventory_date": inventory_date}).to_list(length=100000)
    deleted_ids = {d["scan_id"] for d in del_docs}

    pipeline = [
        {"$match": {"inventory_date": inventory_date, "_id": {"$nin": list(deleted_ids)}}},
        {"$group": {"_id": "$code", "count": {"$sum": 1}, "users": {"$addToSet": "$username"}, "methods": {"$addToSet": "$method"}}},
        {"$sort": {"_id": 1}},
    ]
    results = await db.scans.aggregate(pipeline).to_list(length=100000)
    codes = [MergedCodeEntry(code=r["_id"], count=r["count"], users=r["users"], methods=r["methods"]) for r in results]
    conflicts = sum(1 for c in codes if len(c.users) > 1)
    return MergedDayResponse(date=inventory_date, codes=codes, total_unique_codes=len(codes), conflicts=conflicts)


def _xlsx_response(headers: list[str], rows: list[list[object]], filename: str) -> StreamingResponse:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Export"
    sheet.append(headers)
    for row in rows:
        sheet.append(row)

    for cell in sheet[1]:
        cell.font = Font(bold=True)

    buffer = io.BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/days/{inventory_date}/export.xlsx")
async def export_day_excel(inventory_date: str, user_id: Optional[str] = None):
    db = get_db()

    if user_id:
        del_docs = await db.deletions.find({"user_id": user_id, "inventory_date": inventory_date}).to_list(length=10000)
        deleted_ids = {d["scan_id"] for d in del_docs}
        docs = await db.scans.find({"inventory_date": inventory_date, "user_id": user_id, "_id": {"$nin": list(deleted_ids)}}).sort("scanned_at", 1).to_list(length=10000)
        headers = ["code", "methode", "date_reelle_scan", "date_inventaire"]
        rows = [[d["code"], d["method"] or "", d["scan_date"], d.get("inventory_date", "")] for d in docs]
        filename = f"scans-{inventory_date}-{user_id}.xlsx"
    else:
        del_docs = await db.deletions.find({"inventory_date": inventory_date}).to_list(length=100000)
        deleted_ids = {d["scan_id"] for d in del_docs}
        pipeline = [
            {"$match": {"inventory_date": inventory_date, "_id": {"$nin": list(deleted_ids)}}},
            {"$group": {"_id": "$code", "users": {"$addToSet": "$username"}, "methods": {"$addToSet": "$method"}}},
            {"$sort": {"_id": 1}},
        ]
        results = await db.scans.aggregate(pipeline).to_list(length=100000)
        headers = ["code", "utilisateurs", "methodes"]
        rows = [[r["_id"], ";".join(r["users"]), ";".join(r["methods"])] for r in results]
        filename = f"scans-{inventory_date}-fusion.xlsx"

    return _xlsx_response(headers, rows, filename)


# ------------------------------------------------------------------ #
# Deletion history
# ------------------------------------------------------------------ #
@router.get("/deletions", response_model=list[DeletionRecord])
async def list_deletions(
    inventory_date: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
) -> list[DeletionRecord]:
    """Full deletion audit trail, filterable by inventory_date and/or user."""
    db = get_db()
    query: dict = {}
    if inventory_date:
        query["inventory_date"] = inventory_date
    if user_id:
        query["user_id"] = user_id
    docs = await db.deletions.find(query).sort("deleted_at", -1).to_list(length=10000)
    return [DeletionRecord(**{**d, "id": d["_id"]}) for d in docs]


# ------------------------------------------------------------------ #
# User management (unchanged)
# ------------------------------------------------------------------ #
@router.get("/users", response_model=list[UserPublic])
async def list_users() -> list[UserPublic]:
    db = get_db()
    docs = await db.users.find({}).sort("username", 1).to_list(length=1000)
    return [UserPublic(id=d["_id"], username=d["username"], nom=d["nom"], prenom=d["prenom"], role=d["role"], ip_poste=d.get("ip_poste"), date_creation=d["date_creation"], statut=d["statut"]) for d in docs]


@router.post("/users", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
async def create_user(payload: UserCreate) -> UserPublic:
    db = get_db()
    doc = {"_id": new_id(), "username": payload.username, "password_hash": hash_password(payload.password), "nom": payload.nom, "prenom": payload.prenom, "role": payload.role, "ip_poste": payload.ip_poste, "date_creation": time.time(), "statut": "actif"}
    try:
        await db.users.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Ce nom d'utilisateur existe déjà.")
    return UserPublic(id=doc["_id"], username=doc["username"], nom=doc["nom"], prenom=doc["prenom"], role=doc["role"], ip_poste=doc["ip_poste"], date_creation=doc["date_creation"], statut=doc["statut"])


@router.patch("/users/{user_id}", response_model=UserPublic)
async def update_user(user_id: str, payload: UserUpdate) -> UserPublic:
    db = get_db()
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if "password" in updates:
        updates["password_hash"] = hash_password(updates.pop("password"))
    if updates:
        result = await db.users.update_one({"_id": user_id}, {"$set": updates})
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Utilisateur introuvable.")
    doc = await db.users.find_one({"_id": user_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")
    return UserPublic(id=doc["_id"], username=doc["username"], nom=doc["nom"], prenom=doc["prenom"], role=doc["role"], ip_poste=doc.get("ip_poste"), date_creation=doc["date_creation"], statut=doc["statut"])
