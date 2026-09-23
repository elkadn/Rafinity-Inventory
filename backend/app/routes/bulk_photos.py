from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import re
import shutil
import time
import uuid
from pathlib import Path, PurePosixPath

import cv2
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.auth import require_admin
from app.db import get_db
from app.routes.scans import _get_active_inventory, _today, register_code_for_user
from app.routes.video import _decode_frame
from app.schemas import (
    PhotoParentFolderRequest,
    PhotoParentFolderResponse,
    PhotoParentSubfolder,
    UserPublic,
    new_id,
)

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
UNREAD_PHOTO_ROOT = os.path.join(BULK_JOB_ROOT, "unread")
DUPLICATE_PHOTO_ROOT = os.path.join(BULK_JOB_ROOT, "duplicates")
PHOTO_PARENT_CONFIG_ID = "default_photo_parent_folder"


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
    unread_folders: list["UnreadPhotoFolder"] = Field(default_factory=list)
    duplicate_folders: list["DuplicatePhotoFolder"] = Field(default_factory=list)


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
    unread_images: list[dict] = Field(default_factory=list)
    duplicate_images: list[dict] = Field(default_factory=list)
    user_results: list[UserPhotoResult] = Field(default_factory=list)


class UnreadPhotoFolder(BaseModel):
    folder_key: str
    job_id: str
    folder_name: str
    inventory_date: str
    user_id: str
    username: str
    file_count: int
    files: list[str] = Field(default_factory=list)


class DuplicatePhotoFolder(UnreadPhotoFolder):
    pass


class ManualPhotoCodeRequest(BaseModel):
    user_id: str
    code: str
    inventory_date: str | None = None


def _runtime_photo_parent_path(configured_path: str) -> Path:
    """Resolve a Windows host path to the Docker-mounted photo directory."""
    if re.match(r"^[A-Za-z]:[\\/]", configured_path) and os.name != "nt":
        return Path(os.environ.get("PHOTO_PARENT_MOUNT_PATH", "/mnt/photo-parent"))
    return Path(configured_path).expanduser()


def _photo_files_by_subfolder(root: Path) -> dict[str, list[Path]]:
    if not root.is_dir():
        return {}
    result: dict[str, list[Path]] = {}
    for child in sorted(root.iterdir(), key=lambda item: item.name.casefold()):
        if not child.is_dir():
            continue
        files = sorted(
            (
                path
                for path in child.rglob("*")
                if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
            ),
            key=lambda item: str(item).casefold(),
        )
        result[child.name] = files
    return result


async def _get_default_photo_parent() -> str | None:
    doc = await get_db().config.find_one({"_id": PHOTO_PARENT_CONFIG_ID})
    return doc.get("photo_parent_path") if doc else None


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


def _sanitize_folder_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", (value or "inconnu").strip())
    cleaned = cleaned.strip("._")
    return cleaned or "inconnu"


def _save_unread_photo_for_job(
    *,
    root_dir: str,
    job_id: str,
    folder_name: str,
    inventory_date: str,
    user_id: str,
    username: str,
    source_path: str,
    file_name: str,
    review_root_name: str = "unread",
) -> dict:
    unread_root = os.path.join(root_dir, review_root_name)
    _ensure_dir(unread_root)
    safe_folder = _sanitize_folder_name(folder_name)
    folder_key = f"{safe_folder}_{job_id[:8]}"
    folder_path = os.path.join(unread_root, folder_key)
    _ensure_dir(folder_path)
    target_path = os.path.join(folder_path, os.path.basename(file_name))
    if not os.path.exists(target_path):
        shutil.copy2(source_path, target_path)

    manifest_path = os.path.join(folder_path, "manifest.json")
    manifest = {
        "job_id": job_id,
        "folder_name": folder_name,
        "inventory_date": inventory_date,
        "user_id": user_id,
        "username": username,
        "files": [],
    }
    if os.path.exists(manifest_path):
        try:
            with open(manifest_path, "r", encoding="utf-8") as handle:
                manifest = json.load(handle)
        except (FileNotFoundError, json.JSONDecodeError):
            manifest = {
                "job_id": job_id,
                "folder_name": folder_name,
                "inventory_date": inventory_date,
                "user_id": user_id,
                "username": username,
                "files": [],
            }

    file_entries = manifest.setdefault("files", [])
    file_names = {
        entry.get("file_name") for entry in file_entries if isinstance(entry, dict)
    }
    if os.path.basename(file_name) not in file_names:
        file_entries.append(
            {
                "file_name": os.path.basename(file_name),
                "created_at": time.time(),
                "source_path": source_path,
            }
        )
    manifest["job_id"] = job_id
    manifest["folder_name"] = folder_name
    manifest["inventory_date"] = inventory_date
    manifest["user_id"] = user_id
    manifest["username"] = username

    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, sort_keys=True)

    return {
        "job_id": job_id,
        "folder_key": folder_key,
        "folder_name": folder_name,
        "inventory_date": inventory_date,
        "user_id": user_id,
        "username": username,
        "file_name": os.path.basename(file_name),
        "directory_path": folder_path,
        "created_at": time.time(),
    }


def _list_unread_photo_folders(
    root_dir: str = BULK_JOB_ROOT,
    *,
    job_id: str | None = None,
    user_id: str | None = None,
    review_root_name: str = "unread",
) -> list[dict]:
    unread_root = os.path.join(root_dir, review_root_name)
    if not os.path.isdir(unread_root):
        return []

    folders: list[dict] = []
    for entry in sorted(os.listdir(unread_root)):
        folder_path = os.path.join(unread_root, entry)
        if not os.path.isdir(folder_path):
            continue
        manifest_path = os.path.join(folder_path, "manifest.json")
        if not os.path.exists(manifest_path):
            continue
        try:
            with open(manifest_path, "r", encoding="utf-8") as handle:
                manifest = json.load(handle)
        except (FileNotFoundError, json.JSONDecodeError):
            continue
        if job_id and manifest.get("job_id") != job_id:
            continue
        if user_id and manifest.get("user_id") != user_id:
            continue
        file_names = [
            item.get("file_name")
            for item in manifest.get("files", [])
            if isinstance(item, dict) and item.get("file_name")
        ]
        folders.append(
            {
                "folder_key": entry,
                "job_id": manifest.get("job_id", ""),
                "folder_name": manifest.get("folder_name", entry),
                "inventory_date": manifest.get("inventory_date", ""),
                "user_id": manifest.get("user_id", ""),
                "username": manifest.get("username", ""),
                "file_count": len(file_names),
                "files": file_names,
            }
        )
    return folders


def _public_job(job: dict) -> BulkPhotoJobResponse:
    payload = {
        key: value
        for key, value in job.items()
        if key in BulkPhotoJobResponse.model_fields
    }
    payload.setdefault("unread_images", job.get("unread_images", []))
    payload.setdefault("duplicate_images", job.get("duplicate_images", []))
    job_id = job.get("id") or job.get("_id")
    if job_id:
        unread_for_job = _list_unread_photo_folders(job_id=job_id)
        payload["unread_images"] = unread_for_job
        duplicate_for_job = _list_unread_photo_folders(
            job_id=job_id, review_root_name="duplicates"
        )
        payload["duplicate_images"] = duplicate_for_job
        for user_result in payload.get("user_results", []):
            user_result["unread_folders"] = _list_unread_photo_folders(
                job_id=job_id,
                user_id=user_result.get("user_id"),
            )
            user_result["duplicate_folders"] = _list_unread_photo_folders(
                job_id=job_id,
                user_id=user_result.get("user_id"),
                review_root_name="duplicates",
            )
    return BulkPhotoJobResponse(**payload)


def _file_parts(filename: str) -> tuple[str, ...]:
    normalized = filename.replace("\\", "/")
    path = PurePosixPath(normalized)
    if path.is_absolute() or ".." in path.parts:
        return ()
    return path.parts


def _folder_name(filename: str) -> str | None:
    parts = [part for part in _file_parts(filename) if part and part not in {".", ".."}]
    if not parts:
        return None

    directory_parts = parts[:-1]
    if not directory_parts:
        return None

    cleaned = [
        part
        for part in directory_parts
        if part.lower() not in {"fakepath", "c:", "file:"}
    ]
    if not cleaned:
        return None

    # Browser uploads may include a parent folder and/or a synthetic
    # fakepath prefix; the actual user folder is the last meaningful segment
    # before the file itself.
    return cleaned[-1]


def _resolve_upload_folder_name(upload: object, user: dict) -> str:
    filename = getattr(upload, "filename", "") or ""
    return _folder_name(filename) or str(user.get("username") or "inconnu")


def _decode_photo(path: str) -> set[str]:
    data = np.fromfile(path, dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_GRAYSCALE)
    if image is None:
        return set()
    return _decode_frame(image)


async def _run_job(job: dict, job_dir: str) -> None:
    start_time = time.time()
    job.setdefault(
        "timing",
        {
            "summary": {
                "decode_seconds": 0.0,
                "db_write_seconds": 0.0,
                "batch_seconds": 0.0,
                "total_seconds": 0.0,
                "processed_images": 0,
            },
            "batches": [],
            "events": [],
        },
    )
    logger.info(
        "Starting photo job %s: %s images, inventory=%s, users=%s",
        job["id"],
        job["total_photos"],
        job["inventory_date"],
        len(job.get("user_results", [])),
    )
    job["status"] = "processing"
    job["started_at"] = start_time
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
        logger.info(
            "Photo job %s has %s batches to process (max %s images per batch).",
            job["id"],
            len(batches),
            MAX_PHOTOS_PER_JOB,
        )
        for batch_index, batch_items in enumerate(batches, start=1):
            batch_started = time.time()
            logger.info(
                "Photo job %s starting batch %s/%s (%s images)",
                job["id"],
                batch_index,
                len(batches),
                len(batch_items),
            )
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
                decode_started = time.time()
                try:
                    codes = await asyncio.to_thread(
                        _decode_photo, os.path.join(job_dir, item["stored_name"])
                    )
                except Exception:
                    logger.exception("Unable to decode photo %s", item["stored_name"])
                    await mark_skipped(item)
                    return
                decode_elapsed = time.time() - decode_started

                if not codes:
                    unread_entry = _save_unread_photo_for_job(
                        root_dir=BULK_JOB_ROOT,
                        job_id=job["id"],
                        folder_name=item.get("folder_name")
                        or item.get("username")
                        or "inconnu",
                        inventory_date=job["inventory_date"],
                        user_id=item["user_id"],
                        username=item["username"],
                        source_path=os.path.join(job_dir, item["stored_name"]),
                        file_name=item["stored_name"],
                    )
                    job.setdefault("unread_images", []).append(unread_entry)
                    await mark_skipped(item)
                    return

                added = 0
                duplicates = 0
                duplicate_entry = None
                db_started = time.time()
                try:
                    for code in codes:
                        result = await register_code_for_user(
                            user_id=item["user_id"],
                            username=item["username"],
                            code=code,
                            method="barcode",
                            image_name=item.get("original_file_name"),
                            inventory_date=job["inventory_date"],
                        )
                        if result.added:
                            added += 1
                        else:
                            duplicates += 1
                    if duplicates:
                        duplicate_entry = _save_unread_photo_for_job(
                            root_dir=BULK_JOB_ROOT,
                            job_id=job["id"],
                            folder_name=item.get("folder_name")
                            or item.get("username")
                            or "inconnu",
                            inventory_date=job["inventory_date"],
                            user_id=item["user_id"],
                            username=item["username"],
                            source_path=os.path.join(job_dir, item["stored_name"]),
                            file_name=item.get("original_file_name")
                            or item["stored_name"],
                            review_root_name="duplicates",
                        )
                except Exception:
                    logger.exception(
                        "Unable to register codes from %s", item["stored_name"]
                    )
                    await mark_skipped(item)
                    return
                db_elapsed = time.time() - db_started

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
                        if duplicate_entry:
                            user_result.setdefault("duplicate_folders", []).append(
                                duplicate_entry
                            )
                    if duplicate_entry:
                        job.setdefault("duplicate_images", []).append(duplicate_entry)
                    processed_files.add(item["stored_name"])
                    job["processed_files"] = list(processed_files)
                    job["processed_photos"] = len(processed_files)
                    job["progress"] = (
                        f"{job['processed_photos']} / {job['total_photos']} photos"
                    )
                    job["timing"]["summary"]["decode_seconds"] += decode_elapsed
                    job["timing"]["summary"]["db_write_seconds"] += db_elapsed
                    job["timing"]["summary"]["processed_images"] += 1
                    job["timing"]["events"].append(
                        {
                            "image": item["stored_name"],
                            "user_id": item["user_id"],
                            "codes_detected": len(codes),
                            "decode_seconds": round(decode_elapsed, 4),
                            "db_write_seconds": round(db_elapsed, 4),
                            "total_seconds": round(decode_elapsed + db_elapsed, 4),
                        }
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
            batch_summary = {
                "batch": batch_index,
                "count": len(batch_items),
                "elapsed_seconds": round(batch_elapsed, 2),
                "processed_photos": job["processed_photos"],
                "codes_found": job["codes_found"],
                "added": job["added"],
                "decode_seconds": round(job["timing"]["summary"]["decode_seconds"], 4),
                "db_write_seconds": round(
                    job["timing"]["summary"]["db_write_seconds"], 4
                ),
            }
            batch_timing.append(batch_summary)
            job["timing"]["batches"].append(batch_summary)
            job["timing"]["summary"]["batch_seconds"] += batch_elapsed
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
        job["timing"]["summary"]["total_seconds"] = round(
            job["finished_at"] - start_time, 4
        )
        elapsed_total = round(job["finished_at"] - start_time, 2)
        logger.info(
            "Photo job %s completed in %.2fs: processed=%s, codes_found=%s, added=%s, duplicates=%s, skipped=%s",
            job["id"],
            elapsed_total,
            job["processed_photos"],
            job["codes_found"],
            job["added"],
            job["duplicates"],
            job["skipped"],
        )
        logger.info(
            "Timing summary for job %s: decode=%.2fs, db_write=%.2fs, batch_total=%.2fs, total=%.2fs",
            job["id"],
            job["timing"]["summary"]["decode_seconds"],
            job["timing"]["summary"]["db_write_seconds"],
            job["timing"]["summary"]["batch_seconds"],
            job["timing"]["summary"]["total_seconds"],
        )
        await _persist_completed_job(job)
    except Exception as error:
        logger.exception("Bulk photo job %s failed", job["id"])
        job["status"] = "failed"
        job["progress"] = "Traitement interrompu"
        job["finished_at"] = time.time()
        job["error"] = str(error)
        logger.error(
            "Photo job %s failed after %.2fs: %s",
            job["id"],
            round(job["finished_at"] - start_time, 2),
            job["error"],
        )
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
        if not isinstance(job, dict) or "id" not in job:
            logger.warning(
                "Skipping malformed photo job file without valid id: %s", filename
            )
            continue
        job_id = job["id"]
        job_dir = os.path.join(BULK_JOB_ROOT, job_id)
        if job.get("status") == "completed":
            _delete_job_file(job_id)
            continue
        if job.get("status") in {"queued", "processing"}:
            existing_history = await get_db().photo_jobs.find_one({"_id": job_id})
            if existing_history:
                _delete_job_file(job_id)
                continue
        if job.get("status") in {"queued", "processing"} and os.path.isdir(job_dir):
            asyncio.create_task(_run_job(job, job_dir))


@router.get("/photo-parent", response_model=PhotoParentFolderResponse)
async def get_photo_parent(
    admin: UserPublic = Depends(require_admin),
) -> PhotoParentFolderResponse:
    del admin
    configured_path = await _get_default_photo_parent()
    if not configured_path:
        return PhotoParentFolderResponse()

    root = _runtime_photo_parent_path(configured_path)
    folders = _photo_files_by_subfolder(root)
    return PhotoParentFolderResponse(
        path=configured_path,
        exists=root.is_dir(),
        subfolders=[
            PhotoParentSubfolder(name=name, image_count=len(files))
            for name, files in folders.items()
        ],
    )


@router.put("/photo-parent", response_model=PhotoParentFolderResponse)
async def set_photo_parent(
    payload: PhotoParentFolderRequest,
    admin: UserPublic = Depends(require_admin),
) -> PhotoParentFolderResponse:
    del admin
    configured_path = payload.path.strip()
    if not configured_path:
        raise HTTPException(status_code=400, detail="Le chemin ne peut pas être vide.")

    root = _runtime_photo_parent_path(configured_path)
    if not root.is_dir():
        raise HTTPException(
            status_code=400,
            detail=(
                "Le dossier n'est pas accessible par le backend. "
                "Avec Docker, vérifiez que le dossier est monté dans le conteneur."
            ),
        )

    await get_db().config.replace_one(
        {"_id": PHOTO_PARENT_CONFIG_ID},
        {
            "_id": PHOTO_PARENT_CONFIG_ID,
            "photo_parent_path": configured_path,
        },
        upsert=True,
    )
    folders = _photo_files_by_subfolder(root)
    return PhotoParentFolderResponse(
        path=configured_path,
        exists=True,
        subfolders=[
            PhotoParentSubfolder(name=name, image_count=len(files))
            for name, files in folders.items()
        ],
    )


@router.post(
    "/photo-parent/import",
    response_model=BulkPhotoJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def import_photo_parent(
    admin: UserPublic = Depends(require_admin),
) -> BulkPhotoJobResponse:
    configured_path = await _get_default_photo_parent()
    if not configured_path:
        raise HTTPException(
            status_code=400, detail="Aucun dossier parent par défaut n'est configuré."
        )

    root = _runtime_photo_parent_path(configured_path)
    folders = _photo_files_by_subfolder(root)
    if not folders:
        raise HTTPException(
            status_code=400, detail="Aucune image trouvée dans le dossier parent."
        )

    db = get_db()
    users = await db.users.find({}).to_list(length=10000)
    users_by_name = {str(user["username"]).casefold(): user for user in users}
    inventory = await _get_active_inventory()
    inventory_date = inventory.inventory_date if inventory else _today()
    job_id = uuid.uuid4().hex
    job_dir = os.path.join(BULK_JOB_ROOT, job_id)
    _ensure_dir(job_dir)
    job_files: list[dict] = []

    try:
        for folder_name, image_paths in folders.items():
            user = users_by_name.get(folder_name.casefold())
            if not user:
                raise HTTPException(
                    status_code=400,
                    detail=f"Aucun utilisateur trouvé pour le dossier '{folder_name}'.",
                )
            for image_path in image_paths:
                data = image_path.read_bytes()
                if len(data) > MAX_PHOTO_SIZE_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Photo trop volumineuse: {image_path.name}",
                    )
                stored_name = f"{len(job_files):06d}{image_path.suffix.lower()}"
                with open(os.path.join(job_dir, stored_name), "wb") as handle:
                    handle.write(data)
                job_files.append(
                    {
                        "stored_name": stored_name,
                        "original_file_name": image_path.name,
                        "user_id": user["_id"],
                        "username": user["username"],
                        "folder_name": folder_name,
                    }
                )
    except Exception:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise

    if not job_files:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(
            status_code=400, detail="Aucune image trouvée dans le dossier parent."
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
        "duplicate_images": [],
        "inventory_date": inventory_date,
        "user_results": user_results,
        "files": job_files,
    }
    _write_job(job)
    job["timing"] = {
        "summary": {
            "decode_seconds": 0.0,
            "db_write_seconds": 0.0,
            "batch_seconds": 0.0,
            "total_seconds": 0.0,
            "processed_images": 0,
        },
        "batches": [],
        "events": [],
    }
    asyncio.create_task(_run_job(job, job_dir))
    return _public_job(job)


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
        folder_name = _resolve_upload_folder_name(upload, {})
        user = users_by_name.get(folder_name.casefold() if folder_name else "")
        if not user:
            raise HTTPException(
                status_code=400,
                detail=f"Aucun utilisateur trouvé pour le dossier '{folder_name or '?'}'.",
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
            folder_name = _resolve_upload_folder_name(upload, user)
            original_file_name = PurePosixPath(
                (upload.filename or "").replace("\\", "/")
            ).name
            with open(os.path.join(job_dir, stored_name), "wb") as handle:
                handle.write(data)
            job_files.append(
                {
                    "stored_name": stored_name,
                    "original_file_name": original_file_name,
                    "user_id": user["_id"],
                    "username": user["username"],
                    "folder_name": folder_name,
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
        "duplicate_images": [],
        "inventory_date": inventory.inventory_date if inventory else _today(),
        "user_results": user_results,
        "files": job_files,
    }
    _write_job(job)
    job["timing"] = {
        "summary": {
            "decode_seconds": 0.0,
            "db_write_seconds": 0.0,
            "batch_seconds": 0.0,
            "total_seconds": 0.0,
            "processed_images": 0,
        },
        "batches": [],
        "events": [],
    }
    logger.info(
        "Queued photo job %s for %s images (inventory=%s)",
        job_id,
        len(job_files),
        job["inventory_date"],
    )
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
                    "unread_images": [],
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
        if not filename.endswith(".json"):
            continue
        job = _read_job(filename[:-5])
        if not isinstance(job, dict) or "id" not in job:
            logger.warning(
                "Skipping malformed photo job file without valid id: %s", filename
            )
            continue
        if job.get("status") == "completed":
            _delete_job_file(job["id"])
            continue
        if job.get("admin_id") == admin.id:
            jobs.append(_public_job(job))
    return sorted(jobs, key=lambda job: job.created_at, reverse=True)[:50]


@router.get("/photo-jobs/unread", response_model=list[UnreadPhotoFolder])
async def list_unread_photo_folders(
    admin: UserPublic = Depends(require_admin),
) -> list[UnreadPhotoFolder]:
    del admin
    folders = _list_unread_photo_folders()
    return [UnreadPhotoFolder(**folder) for folder in folders]


@router.get("/photo-jobs/duplicates", response_model=list[DuplicatePhotoFolder])
async def list_duplicate_photo_folders(
    admin: UserPublic = Depends(require_admin),
) -> list[DuplicatePhotoFolder]:
    del admin
    folders = _list_unread_photo_folders(review_root_name="duplicates")
    return [DuplicatePhotoFolder(**folder) for folder in folders]


@router.get("/photo-jobs/unread/{folder_key}/files/{filename}")
async def get_unread_photo_file(
    folder_key: str,
    filename: str,
    admin: UserPublic = Depends(require_admin),
):
    del admin
    safe_path = PurePosixPath(filename)
    if ".." in safe_path.parts or safe_path.is_absolute():
        raise HTTPException(status_code=400, detail="Nom de fichier invalide.")
    folder_path = os.path.join(UNREAD_PHOTO_ROOT, folder_key)
    file_path = os.path.join(folder_path, safe_path.name)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="Image non lue introuvable.")
    return FileResponse(file_path)


@router.get("/photo-jobs/duplicates/{folder_key}/files/{filename}")
async def get_duplicate_photo_file(
    folder_key: str,
    filename: str,
    admin: UserPublic = Depends(require_admin),
):
    del admin
    safe_folder = PurePosixPath(folder_key)
    safe_file = PurePosixPath(filename)
    if (
        ".." in safe_folder.parts
        or safe_folder.is_absolute()
        or ".." in safe_file.parts
        or safe_file.is_absolute()
    ):
        raise HTTPException(status_code=400, detail="Chemin d'image invalide.")
    folder_path = os.path.join(DUPLICATE_PHOTO_ROOT, safe_folder.name)
    file_path = os.path.join(folder_path, safe_file.name)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="Image doublon introuvable.")
    return FileResponse(file_path)


@router.delete("/photo-jobs/duplicates/{folder_key}")
async def delete_duplicate_photo_folder(
    folder_key: str,
    admin: UserPublic = Depends(require_admin),
) -> dict:
    del admin
    safe_folder = PurePosixPath(folder_key)
    if ".." in safe_folder.parts or safe_folder.is_absolute():
        raise HTTPException(status_code=400, detail="Nom de dossier invalide.")
    folder_path = os.path.join(DUPLICATE_PHOTO_ROOT, safe_folder.name)
    if not os.path.isdir(folder_path):
        raise HTTPException(status_code=404, detail="Dossier de doublons introuvable.")
    shutil.rmtree(folder_path, ignore_errors=True)
    return {"deleted": True, "folder_key": folder_key}


@router.get("/photo-parent/{username}/files/{filename}")
async def get_photo_parent_file(
    username: str,
    filename: str,
    admin: UserPublic = Depends(require_admin),
):
    del admin
    configured_path = await _get_default_photo_parent()
    if not configured_path:
        raise HTTPException(
            status_code=404, detail="Dossier parent photo non configuré."
        )

    root = _runtime_photo_parent_path(configured_path).resolve()
    user_dir = (root / username).resolve()
    file_path = (user_dir / filename).resolve()
    try:
        user_dir.relative_to(root)
        file_path.relative_to(user_dir)
    except ValueError:
        raise HTTPException(status_code=400, detail="Chemin d'image invalide.")

    if (
        not user_dir.is_dir()
        or not file_path.is_file()
        or file_path.suffix.lower() not in IMAGE_EXTENSIONS
    ):
        raise HTTPException(
            status_code=404, detail="Image introuvable dans le dossier utilisateur."
        )
    return FileResponse(file_path)


@router.delete("/photo-jobs/unread/{folder_key}")
async def delete_unread_photo_folder(
    folder_key: str,
    admin: UserPublic = Depends(require_admin),
) -> dict:
    del admin
    folder_path = os.path.join(UNREAD_PHOTO_ROOT, folder_key)
    if not os.path.isdir(folder_path):
        raise HTTPException(
            status_code=404, detail="Dossier de photos non lues introuvable."
        )
    shutil.rmtree(folder_path, ignore_errors=True)
    return {"deleted": True, "folder_key": folder_key}


@router.post("/photo-jobs/unread/{folder_key}/manual-code", response_model=dict)
async def add_manual_code_to_unread_folder(
    folder_key: str,
    payload: ManualPhotoCodeRequest,
    admin: UserPublic = Depends(require_admin),
) -> dict:
    del admin
    folder_path = os.path.join(UNREAD_PHOTO_ROOT, folder_key)
    if not os.path.isdir(folder_path):
        raise HTTPException(
            status_code=404, detail="Dossier de photos non lues introuvable."
        )

    if not payload.code.strip():
        raise HTTPException(status_code=400, detail="Le code ne peut pas être vide.")

    db = get_db()
    user_doc = await db.users.find_one({"_id": payload.user_id})
    if not user_doc:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    result = await register_code_for_user(
        user_id=payload.user_id,
        username=user_doc["username"],
        code=payload.code,
        method="manuel",
        inventory_date=payload.inventory_date or _today(),
    )
    return {"added": result.added, "reason": result.reason, "folder_key": folder_key}


@router.post("/photo-jobs/unread/{folder_key}/mark-duplicate", response_model=dict)
async def mark_unread_photo_as_duplicate(
    folder_key: str,
    payload: dict,
    admin: UserPublic = Depends(require_admin),
) -> dict:
    del admin
    safe_folder = PurePosixPath(folder_key)
    file_name = str(payload.get("file_name") or "")
    safe_file = PurePosixPath(file_name)
    if (
        ".." in safe_folder.parts
        or safe_folder.is_absolute()
        or ".." in safe_file.parts
        or safe_file.is_absolute()
        or not safe_file.name
    ):
        raise HTTPException(status_code=400, detail="Chemin d'image invalide.")

    source_dir = Path(UNREAD_PHOTO_ROOT) / safe_folder.name
    source_path = source_dir / safe_file.name
    if not source_path.is_file():
        raise HTTPException(status_code=404, detail="Image non lue introuvable.")

    manifest_path = source_dir / "manifest.json"
    try:
        with manifest_path.open("r", encoding="utf-8") as handle:
            manifest = json.load(handle)
    except (FileNotFoundError, json.JSONDecodeError):
        raise HTTPException(status_code=404, detail="Manifest du dossier introuvable.")

    duplicate_dir = Path(DUPLICATE_PHOTO_ROOT) / safe_folder.name
    _ensure_dir(str(duplicate_dir))
    duplicate_path = duplicate_dir / safe_file.name
    shutil.copy2(source_path, duplicate_path)

    duplicate_manifest_path = duplicate_dir / "manifest.json"
    try:
        with duplicate_manifest_path.open("r", encoding="utf-8") as handle:
            duplicate_manifest = json.load(handle)
    except (FileNotFoundError, json.JSONDecodeError):
        duplicate_manifest = {
            "job_id": manifest.get("job_id", ""),
            "folder_name": manifest.get("folder_name", safe_folder.name),
            "inventory_date": manifest.get("inventory_date", ""),
            "user_id": manifest.get("user_id", ""),
            "username": manifest.get("username", ""),
            "files": [],
        }

    file_entries = duplicate_manifest.setdefault("files", [])
    if not any(
        isinstance(entry, dict) and entry.get("file_name") == safe_file.name
        for entry in file_entries
    ):
        file_entries.append(
            {
                "file_name": safe_file.name,
                "created_at": time.time(),
                "source_path": str(source_path),
                "manual": True,
            }
        )
    with duplicate_manifest_path.open("w", encoding="utf-8") as handle:
        json.dump(duplicate_manifest, handle, indent=2, sort_keys=True)

    return {
        "copied": True,
        "folder_key": folder_key,
        "file_name": safe_file.name,
        "source_preserved": source_path.is_file(),
    }


@router.get("/photo-jobs/{job_id}", response_model=BulkPhotoJobResponse)
async def get_photo_job(
    job_id: str, admin: UserPublic = Depends(require_admin)
) -> BulkPhotoJobResponse:
    job = _read_job(job_id)
    if not job or job.get("admin_id") != admin.id:
        raise HTTPException(status_code=404, detail="Traitement photo introuvable.")
    return _public_job(job)
