from __future__ import annotations

import logging
import time

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pymongo.errors import DuplicateKeyError

from app.auth import get_current_user
from app.config import settings
from app.db import get_db
from app.ocr import read_code_from_crop
from app.schemas import (
    DeletionRecord,
    DeletionResponse,
    MyScansResponse,
    OcrResponse,
    ScanCreate,
    ScanRecord,
    ScanRegisterResponse,
    UserPublic,
    ActiveInventory,
    new_id,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["scans"])


# ------------------------------------------------------------------ #
# Helper: get active inventory (shared state stored in config collection)
# ------------------------------------------------------------------ #
async def _get_active_inventory() -> ActiveInventory | None:
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


@router.get("/inventory/active", response_model=ActiveInventory | None)
async def get_active_inventory(
    user: UserPublic = Depends(get_current_user),
) -> ActiveInventory | None:
    """Returns the currently active inventory set by the admin, or null if none."""
    return await _get_active_inventory()


# ------------------------------------------------------------------ #
# Scans
# ------------------------------------------------------------------ #
@router.post("/scans", response_model=ScanRegisterResponse)
async def register_scan(
    payload: ScanCreate, user: UserPublic = Depends(get_current_user)
) -> ScanRegisterResponse:
    """
    Register one scanned code for the current user, tied to the active
    inventory date. If no inventory is active, uses today's date as fallback.

    Unique constraint: (user_id, code, inventory_date). Same code can be
    registered by different users on the same inventory (legitimate business
    case) and by the same user on different inventories.
    """
    code = payload.code.strip()
    if not code:
        return ScanRegisterResponse(added=False, reason="empty_code")

    inv = await _get_active_inventory()
    inventory_date = inv.inventory_date if inv else _today()

    db = get_db()
    record = ScanRecord(
        user_id=user.id,
        username=user.username,
        code=code,
        method=payload.method,
        confidence=payload.confidence,
        inventory_date=inventory_date,
    )
    doc = record.model_dump()
    doc["_id"] = doc.pop("id")

    try:
        await db.scans.insert_one(doc)
    except DuplicateKeyError:
        return ScanRegisterResponse(added=False, reason="duplicate")

    return ScanRegisterResponse(added=True, scan=record)


@router.get("/scans/me", response_model=MyScansResponse)
async def my_scans(
    inventory_date: str | None = Query(None),
    user: UserPublic = Depends(get_current_user),
) -> MyScansResponse:
    """
    List the current user's scans. If inventory_date is not provided,
    uses the currently active inventory date (so the scanner always sees
    the list for the current inventory automatically).
    """
    if not inventory_date:
        inv = await _get_active_inventory()
        inventory_date = inv.inventory_date if inv else _today()

    db = get_db()
    docs = (
        await db.scans.find({"user_id": user.id, "inventory_date": inventory_date})
        .sort("scanned_at", -1)
        .to_list(length=10000)
    )
    scans = [ScanRecord(**{**d, "id": d["_id"]}) for d in docs]
    return MyScansResponse(scans=scans, total=len(scans))


@router.delete("/scans/{scan_id}", response_model=DeletionResponse)
async def delete_scan(
    scan_id: str,
    reason: str | None = Query(None),
    user: UserPublic = Depends(get_current_user),
) -> DeletionResponse:
    """
    'Delete' a scan from the user's visible list. The scan document is NOT
    physically removed from the database - instead a deletion record is
    created in the deletions collection (full audit trail). The frontend
    filters out deleted scan IDs when displaying the list.
    """
    db = get_db()
    scan_doc = await db.scans.find_one({"_id": scan_id})
    if not scan_doc:
        raise HTTPException(status_code=404, detail="Scan introuvable.")
    if scan_doc["user_id"] != user.id:
        raise HTTPException(status_code=403, detail="Ce scan ne vous appartient pas.")

    # Check if already deleted
    existing = await db.deletions.find_one({"scan_id": scan_id})
    if existing:
        raise HTTPException(status_code=409, detail="Ce scan a déjà été supprimé.")

    deletion = DeletionRecord(
        scan_id=scan_id,
        code=scan_doc["code"],
        user_id=user.id,
        username=user.username,
        inventory_date=scan_doc.get("inventory_date", ""),
        reason=reason,
    )
    del_doc = deletion.model_dump()
    del_doc["_id"] = del_doc.pop("id")
    await db.deletions.insert_one(del_doc)

    return DeletionResponse(deleted=True, deletion=deletion)


@router.post("/ocr", response_model=OcrResponse)
async def ocr_fallback(
    file: UploadFile = File(...), user: UserPublic = Depends(get_current_user)
) -> OcrResponse:
    """
    OCR fallback for a single cropped frame.
    Returns blob_count so the frontend knows whether to show
    'rapprochez-vous' (multiple tickets detected) vs a real OCR result.
    """
    try:
        data = await file.read()
        code, confidence, blob_count = read_code_from_crop(data, settings)
        return OcrResponse(code=code, confidence=confidence, blob_count=blob_count)
    except Exception as e:
        logger.exception("OCR fallback failed")
        return OcrResponse(code=None, confidence=None, blob_count=0, error=str(e))


def _today() -> str:
    import datetime
    return datetime.date.today().isoformat()
