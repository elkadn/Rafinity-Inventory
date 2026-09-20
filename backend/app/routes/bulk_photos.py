from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import shutil
import time
import uuid
from pathlib import PurePosixPath

import cv2
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field

from app.auth import require_admin
from app.db import get_db
from app.routes.scans import _get_active_inventory, _today, register_code_for_user
from app.routes.video import _decode_frame
from app.schemas import UserPublic, new_id

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"])

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BULK_JOB_ROOT = os.path.join(PROJECT_ROOT, "photo_jobs")
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
MAX_PHOTOS = 10000
MAX_PHOTOS_PER_JOB = 1000
MAX_PHOTO_SIZE_BYTES = 25 * 1024 * 1024
PHOTO_WORKERS = max(4, min(8, os.cpu_count() or 4))
JOB_CHECKPOINT_INTERVAL = 100


class UserPhotoResult(BaseModel):
    user_id: str
    username: str
    total_photos: int
    processed_photos: int
    codes_found: int
    added: int
    duplicates: int
    skipped: int
    codes: list[str] = Field(default_factory=list)


class BulkPhotoJobResponse(BaseModel):
    id: str
    status: str
    progress: str
    created_at: float
    started_at: float | None = None
    finished_at: float | None = None
    total_photos: int
    processed_photos: int
    codes_found: int
    added: int
    duplicates: int
    skipped: int
    inventory_date: str
    error: str | None = None
    user_results: list[UserPhotoResult] = Field(default_factory=list)


def _ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def _job_path(job_id: str) -> str:
    return os.path.join(BULK_JOB_ROOT, f"{job_id}.json")


def _write_job(job: dict) -> None:
    _ensure_dir(BULK_JOB_ROOT)
    temporary_path = f"{_job_path(job['id'])}.tmp"
    with open(temporary_path, "w", encoding="utf-8") as handle:
        json.dump(job, handle)
    os.replace(temporary_path, _job_path(job["id"]))


def _read_job(job_id: str) -> dict | None:
    try:
        with open(_job_path(job_id), encoding="utf-8") as handle:
            return json.load(handle)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def _delete_job_file(job_id: str) -> None:
    try:
        os.unlink(_job_path(job_id))
    except FileNotFoundError:
        pass
    except OSError:
        logger.warning("Unable to remove completed photo job %s", job_id, exc_info=True)


def _public_job(job: dict) -> BulkPhotoJobResponse:
    return BulkPhotoJobResponse(
        **{
            key: value
            for key, value in job.items()
            if key in BulkPhotoJobResponse.model_fields
        }
    )


def _file_parts(filename: str) -> tuple[str, ...]:
    normalized = filename.replace("\\", "/")
    path = PurePosixPath(normalized)
    if path.is_absolute() or ".." in path.parts:
        return ()
    return path.parts


def _folder_name(filename: str) -> str | None:
    parts = _file_parts(filename)
    if len(parts) < 2:
        return None
    # webkitdirectory sends parent/user/photo; also accept user/photo.
    return parts[1] if len(parts) >= 3 else parts[0]


def _decode_photo(path: str) -> set[str]:
    data = np.fromfile(path, dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_GRAYSCALE)
    if image is None:
        return set()
    return _decode_frame(image)


async def _run_job(job: dict, job_dir: str) -> None:
    job["status"] = "processing"
    job["started_at"] = time.time()
    job["progress"] = "Traitement des photos…"
    _write_job(job)
    try:
        batch_timing: list[dict] = []
        user_results = {
            result["user_id"]: result for result in job.get("user_results", [])
        }
        for result in user_results.values():
            result.setdefault("codes", [])
        processed_files = set(job.get("processed_files", []))
        if not processed_files and job.get("processed_photos", 0):
            processed_files.update(
                item["stored_name"] for item in job["files"][: job["processed_photos"]]
            )
        job["processed_files"] = list(processed_files)

        def split_batches(items: list[dict]) -> list[list[dict]]:
            return [
                items[index : index + MAX_PHOTOS_PER_JOB]
                for index in range(0, len(items), MAX_PHOTOS_PER_JOB)
            ]

        pending_items = [
            item for item in job["files"] if item["stored_name"] not in processed_files
        ]
        batches = split_batches(pending_items)
        for batch_index, batch_items in enumerate(batches, start=1):
            batch_started = time.time()
            queue: asyncio.Queue[dict] = asyncio.Queue()
            for item in batch_items:
                queue.put_nowait(item)
            state_lock = asyncio.Lock()
            checkpoint_counter = 0

            async def mark_skipped(item: dict) -> None:
                nonlocal checkpoint_counter
                async with state_lock:
                    job["skipped"] += 1
                    user_result = user_results.get(item["user_id"])
                    if user_result:
                        user_result["skipped"] += 1
                        user_result["processed_photos"] += 1
                    processed_files.add(item["stored_name"])
                    job["processed_files"] = list(processed_files)
                    job["processed_photos"] = len(processed_files)
                    job["progress"] = (
                        f"{job['processed_photos']} / {job['total_photos']} photos"
                    )
                    checkpoint_counter += 1
                    if checkpoint_counter >= JOB_CHECKPOINT_INTERVAL:
                        _write_job(job)
                        checkpoint_counter = 0

            async def process_item(item: dict) -> None:
                nonlocal checkpoint_counter
                try:
                    codes = await asyncio.to_thread(
                        _decode_photo, os.path.join(job_dir, item["stored_name"])
                    )
                except Exception:
                    logger.exception("Unable to decode photo %s", item["stored_name"])
                    await mark_skipped(item)
                    return

                added = 0
                duplicates = 0
                try:
                    for code in codes:
                        result = await register_code_for_user(
                            user_id=item["user_id"],
                            username=item["username"],
                            code=code,
                            method="barcode",
                            inventory_date=job["inventory_date"],
                        )
                        if result.added:
                            added += 1
                        else:
                            duplicates += 1
                except Exception:
                    logger.exception(
                        "Unable to register codes from %s", item["stored_name"]
                    )
                    await mark_skipped(item)
                    return

                async with state_lock:
                    user_result = user_results.get(item["user_id"])
                    job["codes_found"] += len(codes)
                    job["added"] += added
                    job["duplicates"] += duplicates
                    if user_result:
                        user_result["processed_photos"] += 1
                        user_result["codes_found"] += len(codes)
                        user_result["added"] += added
                        user_result["duplicates"] += duplicates
                        for code in codes:
                            if code not in user_result["codes"]:
                                user_result["codes"].append(code)
                    processed_files.add(item["stored_name"])
                    job["processed_files"] = list(processed_files)
                    job["processed_photos"] = len(processed_files)
                    job["progress"] = (
                        f"{job['processed_photos']} / {job['total_photos']} photos"
                    )
                    checkpoint_counter += 1
                    if checkpoint_counter >= JOB_CHECKPOINT_INTERVAL:
                        _write_job(job)
                        checkpoint_counter = 0

            async def worker() -> None:
                while True:
                    try:
                        item = queue.get_nowait()
                    except asyncio.QueueEmpty:
                        return
                    try:
                        await process_item(item)
                    except Exception:
                        logger.exception(
                            "Unexpected error processing %s", item["stored_name"]
                        )
                        await mark_skipped(item)
                    finally:
                        queue.task_done()

            await asyncio.gather(*(worker() for _ in range(PHOTO_WORKERS)))
            batch_elapsed = time.time() - batch_started
            batch_timing.append(
                {
                    "batch": batch_index,
                    "count": len(batch_items),
                    "elapsed_seconds": round(batch_elapsed, 2),
                    "processed_photos": job["processed_photos"],
                    "codes_found": job["codes_found"],
                    "added": job["added"],
                }
            )
            logger.info(
                "Photo batch %s/%s finished in %.2fs for %s images; total processed=%s; codes_found=%s; added=%s",
                batch_index,
                len(batches),
                batch_elapsed,
                len(batch_items),
                job["processed_photos"],
                job["codes_found"],
                job["added"],
            )
            _write_job(job)
            if batch_index < len(batches):
                job["progress"] = (
                    f"Lot {batch_index} / {len(batches)} · "
                    f"{job['processed_photos']} / {job['total_photos']} photos"
                )
                _write_job(job)

        job["batch_timing"] = batch_timing
        job["status"] = "completed"
        job["progress"] = "Traitement terminé"
        job["finished_at"] = time.time()
        await _persist_completed_job(job)
    except Exception as error:
        logger.exception("Bulk photo job %s failed", job["id"])
        job["status"] = "failed"
        job["progress"] = "Traitement interrompu"
        job["finished_at"] = time.time()
        job["error"] = str(error)
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)
        if job["status"] == "completed":
            _delete_job_file(job["id"])
        else:
            _write_job(job)


async def resume_pending_jobs() -> None:
    """Requeue jobs left unfinished after an API process restart."""
    _ensure_dir(BULK_JOB_ROOT)
    for filename in os.listdir(BULK_JOB_ROOT):
        if not filename.endswith(".json"):
            continue
        job = _read_job(filename[:-5])
        job_dir = os.path.join(BULK_JOB_ROOT, job["id"]) if job else ""
        if job and job.get("status") == "completed":
            _delete_job_file(job["id"])
            continue
        if job and job.get("status") in {"queued", "processing"}:
            existing_history = await get_db().photo_jobs.find_one({"_id": job["id"]})
            if existing_history:
                _delete_job_file(job["id"])
                continue
        if (
            job
            and job.get("status") in {"queued", "processing"}
            and os.path.isdir(job_dir)
        ):
            asyncio.create_task(_run_job(job, job_dir))


@router.post(
    "/photo-jobs",
    response_model=BulkPhotoJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_photo_job(
    request: Request,
    admin: UserPublic = Depends(require_admin),
) -> BulkPhotoJobResponse:
    form = await request.form(max_files=MAX_PHOTOS, max_fields=MAX_PHOTOS)
    files = [
        item
        for item in form.getlist("files")
        if hasattr(item, "filename") and hasattr(item, "read")
    ]
    image_files = [
        file
        for file in files
        if os.path.splitext(file.filename or "")[1].lower() in IMAGE_EXTENSIONS
    ]
    if not image_files:
        raise HTTPException(
            status_code=400, detail="Le dossier ne contient aucune photo supportée."
        )
    if len(image_files) > MAX_PHOTOS:
        raise HTTPException(
            status_code=413, detail=f"Trop de photos (maximum {MAX_PHOTOS})."
        )

    db = get_db()
    users = await db.users.find({}).to_list(length=10000)
    users_by_name = {str(user["username"]).casefold(): user for user in users}
    assignments: list[tuple[UploadFile, dict]] = []
    for upload in image_files:
        folder = _folder_name(upload.filename or "")
        user = users_by_name.get(folder.casefold() if folder else "")
        if not user:
            raise HTTPException(
                status_code=400,
                detail=f"Aucun utilisateur trouvé pour le dossier '{folder or '?'}'.",
            )
        assignments.append((upload, user))

    inventory = await _get_active_inventory()
    job_id = uuid.uuid4().hex
    job_dir = os.path.join(BULK_JOB_ROOT, job_id)
    _ensure_dir(job_dir)
    job_files = []
    try:
        for index, (upload, user) in enumerate(assignments):
            data = await upload.read()
            if len(data) > MAX_PHOTO_SIZE_BYTES:
                raise HTTPException(
                    status_code=413, detail=f"Photo trop volumineuse: {upload.filename}"
                )
            stored_name = (
                f"{index:06d}{os.path.splitext(upload.filename or '')[1].lower()}"
            )
            with open(os.path.join(job_dir, stored_name), "wb") as handle:
                handle.write(data)
            job_files.append(
                {
                    "stored_name": stored_name,
                    "user_id": user["_id"],
                    "username": user["username"],
                }
            )
    except Exception:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise

    total_batches = max(1, math.ceil(len(job_files) / MAX_PHOTOS_PER_JOB))
    if total_batches > 1:
        logger.info(
            "Photo import %s split into %s batches of max %s images each.",
            job_id,
            total_batches,
            MAX_PHOTOS_PER_JOB,
        )

    user_results: list[dict] = []
    results_by_user: dict[str, dict] = {}
    for item in job_files:
        result = results_by_user.get(item["user_id"])
        if result is None:
            result = {
                "user_id": item["user_id"],
                "username": item["username"],
                "total_photos": 0,
                "processed_photos": 0,
                "codes_found": 0,
                "added": 0,
                "duplicates": 0,
                "skipped": 0,
                "codes": [],
            }
            results_by_user[item["user_id"]] = result
            user_results.append(result)
        result["total_photos"] += 1

    job = {
        "id": job_id,
        "admin_id": admin.id,
        "status": "queued",
        "progress": "En attente…",
        "created_at": time.time(),
        "started_at": None,
        "finished_at": None,
        "total_photos": len(job_files),
        "processed_photos": 0,
        "codes_found": 0,
        "added": 0,
        "duplicates": 0,
        "skipped": 0,
        "error": None,
        "inventory_date": inventory.inventory_date if inventory else _today(),
        "user_results": user_results,
        "files": job_files,
    }
    _write_job(job)
    asyncio.create_task(_run_job(job, job_dir))
    return _public_job(job)


async def _persist_completed_job(job: dict) -> None:
    db = get_db()
    if await db.photo_jobs.find_one({"_id": job["id"]}):
        return
    await db.photo_jobs.insert_one(
        {
            "_id": job["id"],
            "admin_id": job["admin_id"],
            "inventory_date": job["inventory_date"],
            "created_at": job["created_at"],
            "finished_at": job["finished_at"],
            "status": job["status"],
            "total_photos": job["total_photos"],
            "processed_photos": job["processed_photos"],
            "codes_found": job["codes_found"],
            "added": job["added"],
            "duplicates": job["duplicates"],
            "skipped": job["skipped"],
            "error": job.get("error"),
        }
    )
    for user_result in job.get("user_results", []):
        await db.photo_job_users.insert_one(
            {
                "_id": new_id(),
                "job_id": job["id"],
                "user_id": user_result["user_id"],
                "username": user_result["username"],
                "total_photos": user_result["total_photos"],
                "processed_photos": user_result["processed_photos"],
                "codes_found": user_result["codes_found"],
                "added": user_result["added"],
                "duplicates": user_result["duplicates"],
                "skipped": user_result["skipped"],
            }
        )
        for code in user_result.get("codes", []):
            await db.photo_job_codes.insert_one(
                {
                    "_id": new_id(),
                    "job_id": job["id"],
                    "user_id": user_result["user_id"],
                    "username": user_result["username"],
                    "code": code,
                }
            )


@router.get("/photo-history", response_model=list[BulkPhotoJobResponse])
async def list_photo_history(
    inventory_date: str | None = None,
    admin: UserPublic = Depends(require_admin),
) -> list[BulkPhotoJobResponse]:
    db = get_db()
    # The admin history is shared: an administrator must be able to consult
    # treatments launched by another administrator as well.
    query: dict = {}
    if inventory_date:
        query["inventory_date"] = inventory_date
    jobs = await db.photo_jobs.find(query).sort("finished_at", -1).to_list(length=100)
    history = []
    for job in jobs:
        user_rows = await db.photo_job_users.find({"job_id": job["_id"]}).to_list(
            length=10000
        )
        code_rows = await db.photo_job_codes.find({"job_id": job["_id"]}).to_list(
            length=100000
        )
        codes_by_user: dict[str, list[str]] = {}
        for code in code_rows:
            codes_by_user.setdefault(code["user_id"], []).append(code["code"])
        history.append(
            _public_job(
                {
                    **job,
                    "id": job["_id"],
                    "progress": "Traitement terminé",
                    "error": job.get("error"),
                    "user_results": [
                        {
                            **row,
                            "codes": codes_by_user.get(row["user_id"], []),
                        }
                        for row in user_rows
                    ],
                }
            )
        )
    return history


@router.get("/photo-jobs", response_model=list[BulkPhotoJobResponse])
async def list_photo_jobs(
    admin: UserPublic = Depends(require_admin),
) -> list[BulkPhotoJobResponse]:
    _ensure_dir(BULK_JOB_ROOT)
    jobs = []
    for filename in os.listdir(BULK_JOB_ROOT):
        if filename.endswith(".json"):
            job = _read_job(filename[:-5])
            if job and job.get("status") == "completed":
                _delete_job_file(job["id"])
                continue
            if job and job.get("admin_id") == admin.id:
                jobs.append(_public_job(job))
    return sorted(jobs, key=lambda job: job.created_at, reverse=True)[:50]


@router.get("/photo-jobs/{job_id}", response_model=BulkPhotoJobResponse)
async def get_photo_job(
    job_id: str, admin: UserPublic = Depends(require_admin)
) -> BulkPhotoJobResponse:
    job = _read_job(job_id)
    if not job or job.get("admin_id") != admin.id:
        raise HTTPException(status_code=404, detail="Traitement photo introuvable.")
    return _public_job(job)
