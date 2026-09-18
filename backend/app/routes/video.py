"""
Video barcode extraction - v2.

Key improvements over v1:
- Tiled decoding: the image is cut into overlapping 500px patches. Each
    patch is upscaled 2x before decoding.
  This handles the case where barcodes are small relative to the frame size,
  which is the most common cause of missed detections.
- Both gray and CLAHE variants tried on every patch.
- Sharper frame selection: skip frames that are too blurry to decode
  (Laplacian variance < threshold) instead of wasting time on them.
- Adaptive frame rate: process more frames per second when fewer codes have
  been found recently (aggressive mode) and fewer frames when everything is
  being found easily (fast mode). In practice this means a 30s video of
  6 items filmed slowly gets processed more thoroughly than a 30s video
  of 2 items filmed quickly.
- Dedup within a video run is code-based (same as live scanner).

IMPORTANT for users: barcodes must be at least ~30-40px wide in the video
frame to be readable. This means filming 1-6 items at a time, not the whole
shelf from across the room. The UI shows this guidance.
"""

from __future__ import annotations

import logging
import asyncio
import json
import os
import tempfile
import time
import uuid
from collections import Counter
from typing import List, Optional, Set

import cv2
import numpy as np
import zxingcpp
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from pydantic import BaseModel
from app.auth import get_current_user, require_admin
from app.db import get_db
from app.routes.scans import _get_active_inventory, _today, register_code_for_user
from app.schemas import UserPublic, new_id

logger = logging.getLogger(__name__)
router = APIRouter(tags=["video"])

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
VIDEO_DEBUG_ROOT = os.path.join(PROJECT_ROOT, "video_debug")
VIDEO_JOB_ROOT = os.path.join(PROJECT_ROOT, "video_jobs")

MAX_VIDEO_SIZE_MB = 200
MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024
MAX_BATCH_VIDEOS = 10
MAX_ADMIN_VIDEO_FILES = 10000
ADMIN_VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".webm", ".mkv", ".m4v"}

# Process one frame every N seconds of video
FRAME_INTERVAL_SECONDS = 0.5  # 2 fps - denser than v1 (was 1fps)

# Minimum Laplacian variance to consider a frame sharp enough to decode.
# Blurry frames (motion during filming) are skipped to save time.
BLUR_THRESHOLD = 40.0

# A single overlapping scale gives the best speed/coverage balance. The full
# frame pass handles large codes; this scale handles small codes after 2x upscaling.
TILE_SIZES = [500, 300, 180]
TILE_OVERLAP_RATIO = 0.35  # 35% overlap between adjacent tiles
BARCODE_ROTATIONS = (0, 90, 180, 270)


class VideoCodeResult(BaseModel):
    code: str
    frame_hits: int
    added: bool
    reason: Optional[str] = None


class VideoFrameDebug(BaseModel):
    frame_index: int
    frame_time_seconds: float
    blur_score: float
    skipped_blur: bool
    codes: List[str]
    reason: str
    image_path: str


class VideoExtractionResponse(BaseModel):
    total_frames_processed: int
    total_frames_skipped_blur: int
    duration_seconds: float
    codes_found: List[VideoCodeResult]
    total_added: int
    total_duplicates: int
    processing_time_ms: int
    inventory_date: str
    error: Optional[str] = None
    debug_frames: Optional[List[VideoFrameDebug]] = None


class VideoJobResponse(BaseModel):
    id: str
    user_id: str
    username: str = ""
    admin_id: str | None = None
    filename: str
    status: str
    progress: str
    created_at: float
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    result: Optional[VideoExtractionResponse] = None
    error: Optional[str] = None


class VideoUserHistory(BaseModel):
    user_id: str
    username: str
    videos: int
    codes_found: List[VideoCodeResult]
    total_added: int
    total_duplicates: int


class AdminVideoHistoryResponse(BaseModel):
    id: str
    batch_id: str
    inventory_date: str
    created_at: float
    finished_at: float
    total_videos: int
    users: List[VideoUserHistory]


def _blur_score(gray: np.ndarray) -> float:
    """Return the Laplacian variance to quantify frame sharpness."""
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _is_sharp(gray: np.ndarray) -> bool:
    """Return True if the frame is sharp enough to attempt barcode decoding."""
    return _blur_score(gray) >= BLUR_THRESHOLD


def _ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def _job_path(job_id: str) -> str:
    return os.path.join(VIDEO_JOB_ROOT, f"{job_id}.json")


def _write_job(job: dict) -> None:
    _ensure_dir(VIDEO_JOB_ROOT)
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


def _public_job(job: dict) -> VideoJobResponse:
    return VideoJobResponse(**job)


def _admin_video_folder(filename: str) -> str | None:
    parts = filename.replace("\\", "/").split("/")
    parts = [part for part in parts if part and part not in {".", ".."}]
    return parts[1] if len(parts) >= 3 else (parts[0] if len(parts) >= 2 else None)


async def _run_video_job(job: dict, video_path: str, user: UserPublic) -> None:
    started_processing = time.time()
    job["status"] = "processing"
    job["started_at"] = time.time()
    job["progress"] = "Analyse de la vidéo…"
    _write_job(job)
    try:
        code_counter, frames_processed, frames_skipped, duration, debug_frames = (
            await asyncio.to_thread(_process_video, video_path)
        )
        results: List[VideoCodeResult] = []
        total_added = 0
        total_duplicates = 0
        for code, hits in code_counter.most_common():
            result = await register_code_for_user(
                user_id=user.id,
                username=user.username,
                code=code,
                method="barcode",
                inventory_date=job["inventory_date"],
            )
            added = result.added
            if added:
                total_added += 1
            else:
                total_duplicates += 1
            results.append(
                VideoCodeResult(
                    code=code,
                    frame_hits=hits,
                    added=added,
                    reason=None if added else "duplicate",
                )
            )

        job["status"] = "completed"
        job["progress"] = "Analyse terminée"
        job["finished_at"] = time.time()
        job["result"] = VideoExtractionResponse(
            total_frames_processed=frames_processed,
            total_frames_skipped_blur=frames_skipped,
            duration_seconds=round(duration, 1),
            codes_found=results,
            total_added=total_added,
            total_duplicates=total_duplicates,
            processing_time_ms=int((time.time() - started_processing) * 1000),
            inventory_date=job["inventory_date"],
            debug_frames=debug_frames,
        ).model_dump()
        if job.get("admin_id"):
            await _persist_admin_video_job(job)
    except Exception as error:
        logger.exception("Video job %s failed", job["id"])
        job["status"] = "failed"
        job["progress"] = "Analyse interrompue"
        job["finished_at"] = time.time()
        job["error"] = str(error)
    finally:
        if job["status"] == "completed":
            _delete_job_file(job["id"])
        else:
            _write_job(job)
        try:
            os.unlink(video_path)
        except OSError:
            pass


@router.post(
    "/video/jobs",
    response_model=list[VideoJobResponse],
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_video_jobs(
    files: List[UploadFile] = File(...),
    user: UserPublic = Depends(get_current_user),
) -> list[VideoJobResponse]:
    if not files or len(files) > MAX_BATCH_VIDEOS:
        raise HTTPException(
            status_code=400,
            detail=f"Sélectionnez entre 1 et {MAX_BATCH_VIDEOS} vidéos.",
        )
    inventory = await _get_active_inventory()
    inventory_date = inventory.inventory_date if inventory else _today()
    jobs: list[VideoJobResponse] = []
    for upload in files:
        filename = (upload.filename or "").lower()
        ext = os.path.splitext(filename)[1]
        if ext not in {".mp4", ".mov", ".avi", ".webm", ".mkv", ".m4v"}:
            raise HTTPException(status_code=400, detail=f"Format non supporté: {ext}")
        content = await upload.read()
        if len(content) > MAX_VIDEO_SIZE_BYTES:
            raise HTTPException(
                status_code=413, detail=f"Fichier trop volumineux: {upload.filename}"
            )
        job_id = uuid.uuid4().hex
        video_path = os.path.join(VIDEO_JOB_ROOT, f"{job_id}{ext}")
        _ensure_dir(VIDEO_JOB_ROOT)
        with open(video_path, "wb") as handle:
            handle.write(content)
        job = {
            "id": job_id,
            "user_id": user.id,
            "username": user.username,
            "filename": upload.filename or f"video{ext}",
            "status": "queued",
            "progress": "En attente…",
            "created_at": time.time(),
            "started_at": None,
            "finished_at": None,
            "result": None,
            "error": None,
            "inventory_date": inventory_date,
        }
        _write_job(job)
        asyncio.create_task(_run_video_job(job, video_path, user))
        jobs.append(_public_job(job))
    return jobs


@router.post(
    "/admin/video/jobs",
    response_model=list[VideoJobResponse],
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_admin_video_jobs(
    request: Request,
    admin: UserPublic = Depends(require_admin),
) -> list[VideoJobResponse]:
    """Create one background video job per video in user subfolders."""
    form = await request.form(
        max_files=MAX_ADMIN_VIDEO_FILES, max_fields=MAX_ADMIN_VIDEO_FILES
    )
    uploads = [
        item
        for item in form.getlist("files")
        if hasattr(item, "filename") and hasattr(item, "read")
    ]
    if not uploads:
        raise HTTPException(status_code=400, detail="Aucune vidéo sélectionnée.")

    db = get_db()
    users = await db.users.find({}).to_list(length=10000)
    users_by_name = {str(user["username"]).casefold(): user for user in users}
    inventory = await _get_active_inventory()
    inventory_date = inventory.inventory_date if inventory else _today()
    batch_id = uuid.uuid4().hex
    jobs: list[VideoJobResponse] = []

    for upload in uploads:
        filename = upload.filename or ""
        ext = os.path.splitext(filename.lower())[1]
        if ext not in ADMIN_VIDEO_EXTENSIONS:
            raise HTTPException(
                status_code=400, detail=f"Format vidéo non supporté: {ext}"
            )
        folder = _admin_video_folder(filename)
        target = users_by_name.get(folder.casefold() if folder else "")
        if not target:
            raise HTTPException(
                status_code=400,
                detail=f"Aucun utilisateur trouvé pour le dossier '{folder or '?'}'.",
            )

        content = await upload.read()
        if len(content) > MAX_VIDEO_SIZE_BYTES:
            raise HTTPException(
                status_code=413, detail=f"Vidéo trop volumineuse: {filename}"
            )
        job_id = uuid.uuid4().hex
        _ensure_dir(VIDEO_JOB_ROOT)
        video_path = os.path.join(VIDEO_JOB_ROOT, f"{job_id}{ext}")
        with open(video_path, "wb") as handle:
            handle.write(content)
        job = {
            "id": job_id,
            "user_id": target["_id"],
            "username": target["username"],
            "admin_id": admin.id,
            "batch_id": batch_id,
            "filename": filename,
            "status": "queued",
            "progress": "En attente…",
            "created_at": time.time(),
            "started_at": None,
            "finished_at": None,
            "result": None,
            "error": None,
            "inventory_date": inventory_date,
        }
        _write_job(job)
        asyncio.create_task(_run_video_job(job, video_path, target_public(target)))
        jobs.append(_public_job(job))
    return jobs


def target_public(doc: dict) -> UserPublic:
    return UserPublic(
        id=doc["_id"],
        username=doc["username"],
        nom=doc["nom"],
        prenom=doc["prenom"],
        role=doc["role"],
        ip_poste=doc.get("ip_poste"),
        date_creation=doc["date_creation"],
        statut=doc["statut"],
    )


def _delete_job_file(job_id: str) -> None:
    try:
        os.unlink(_job_path(job_id))
    except FileNotFoundError:
        pass
    except OSError:
        logger.warning("Unable to remove completed video job %s", job_id, exc_info=True)


async def _persist_admin_video_job(job: dict) -> None:
    db = get_db()
    if await db.video_jobs.find_one({"_id": job["id"]}):
        return
    result = job["result"]
    await db.video_jobs.insert_one(
        {
            "_id": job["id"],
            "batch_id": job.get("batch_id", job["id"]),
            "admin_id": job["admin_id"],
            "user_id": job["user_id"],
            "username": job["username"],
            "filename": job["filename"],
            "inventory_date": job["inventory_date"],
            "created_at": job["created_at"],
            "started_at": job["started_at"],
            "finished_at": job["finished_at"],
            "duration_seconds": result["duration_seconds"],
            "total_frames_processed": result["total_frames_processed"],
            "total_frames_skipped_blur": result["total_frames_skipped_blur"],
            "total_added": result["total_added"],
            "total_duplicates": result["total_duplicates"],
        }
    )
    for code in result["codes_found"]:
        await db.video_job_codes.insert_one(
            {
                "_id": new_id(),
                "job_id": job["id"],
                "user_id": job["user_id"],
                "username": job["username"],
                "code": code["code"],
                "frame_hits": code["frame_hits"],
                "added": 1 if code["added"] else 0,
            }
        )


@router.get("/admin/video/jobs", response_model=list[VideoJobResponse])
async def list_admin_video_jobs(
    admin: UserPublic = Depends(require_admin),
) -> list[VideoJobResponse]:
    _ensure_dir(VIDEO_JOB_ROOT)
    jobs = []
    for filename in os.listdir(VIDEO_JOB_ROOT):
        if not filename.endswith(".json"):
            continue
        job = _read_job(filename[:-5])
        if job and job.get("status") == "completed":
            _delete_job_file(job["id"])
            continue
        if job and job.get("admin_id") == admin.id:
            jobs.append(_public_job(job))
    jobs.sort(key=lambda job: job.created_at, reverse=True)
    return jobs[:100]


@router.get("/admin/video/history", response_model=list[AdminVideoHistoryResponse])
async def list_admin_video_history(
    inventory_date: str | None = None,
    admin: UserPublic = Depends(require_admin),
) -> list[AdminVideoHistoryResponse]:
    db = get_db()
    query = {"admin_id": admin.id}
    if inventory_date:
        query["inventory_date"] = inventory_date
    jobs = await db.video_jobs.find(query).sort("finished_at", -1).to_list(length=100)
    batches: dict[str, list[dict]] = {}
    for job in jobs:
        batches.setdefault(job.get("batch_id") or job["_id"], []).append(job)

    history = []
    for batch_id, batch_jobs in batches.items():
        users: dict[str, VideoUserHistory] = {}
        for job in batch_jobs:
            user_codes = await db.video_job_codes.find({"job_id": job["_id"]}).to_list(
                length=10000
            )
            user = users.setdefault(
                job["user_id"],
                VideoUserHistory(
                    user_id=job["user_id"],
                    username=job["username"],
                    videos=0,
                    codes_found=[],
                    total_added=0,
                    total_duplicates=0,
                ),
            )
            user.videos += 1
            user.total_added += job["total_added"]
            user.total_duplicates += job["total_duplicates"]
            user.codes_found.extend(
                VideoCodeResult(
                    code=row["code"],
                    frame_hits=row["frame_hits"],
                    added=bool(row["added"]),
                    reason=None if row["added"] else "duplicate",
                )
                for row in user_codes
            )
        first_job = min(batch_jobs, key=lambda item: item["created_at"])
        last_job = max(batch_jobs, key=lambda item: item["finished_at"])
        history.append(
            AdminVideoHistoryResponse(
                id=batch_id,
                batch_id=batch_id,
                inventory_date=first_job["inventory_date"],
                created_at=first_job["created_at"],
                finished_at=last_job["finished_at"],
                total_videos=len(batch_jobs),
                users=list(users.values()),
            )
        )
    history.sort(key=lambda item: item.finished_at, reverse=True)
    return history


@router.get("/video/jobs/{job_id}", response_model=VideoJobResponse)
async def get_video_job(
    job_id: str, user: UserPublic = Depends(get_current_user)
) -> VideoJobResponse:
    job = _read_job(job_id)
    if not job or job.get("user_id") != user.id:
        raise HTTPException(status_code=404, detail="Traitement vidéo introuvable.")
    return _public_job(job)


def _decode_image(img: np.ndarray) -> Set[str]:
    """Decode all barcodes in a single image. Returns set of code strings."""
    try:
        results = zxingcpp.read_barcodes(img)
        return {r.text for r in results if r.text and len(r.text) >= 4}
    except Exception:
        return set()


def _rotate_quarter_turns(gray: np.ndarray, angle: int) -> np.ndarray:
    """Return a contiguous image rotated in the requested quarter-turn."""
    if angle == 0:
        return gray
    return np.ascontiguousarray(np.rot90(gray, k=angle // 90))


def _decode_frame(gray: np.ndarray) -> Set[str]:
    """
    Multi-scale tiled decoding of a single grayscale frame.

    Why tiling:
    - A full 1080p frame with 6 bracelets means each barcode is ~80px wide.
    - ZXing needs ~10px per bar minimum. With 15 bars in a code, that is
      150px minimum width. 80px is borderline and often fails.
    - Cutting the frame into 300-500px tiles and upscaling 2x makes each
      barcode ~160-320px wide in the tile - comfortably above the threshold.

    The 500px overlapping scale is a compromise between small-code coverage
    and processing time. The full-image pass still catches large codes.
    """
    code_occurrences: dict[str, list[dict]] = {}

    def record_codes(
        codes: Set[str],
        source: str,
        x: int,
        y: int,
        width: int,
        height: int,
        method: str,
    ) -> None:
        for code in codes:
            code_occurrences.setdefault(code, []).append(
                {
                    "source": source,
                    "x": x,
                    "y": y,
                    "width": width,
                    "height": height,
                    "method": method,
                }
            )

    # A ticket can be uploaded in portrait, landscape, or upside down. ZXing
    # does not reliably normalize all of those orientations for every barcode
    # image, so each orientation gets a complete independent barcode pass.
    for angle in BARCODE_ROTATIONS:
        oriented = _rotate_quarter_turns(gray, angle)
        h, w = oriented.shape

        # Always try the complete image first. This catches large barcodes and
        # lets ZXing return more than one barcode from a single photograph.
        clahe_full = cv2.createCLAHE(2.0, (8, 8)).apply(oriented)
        full_codes = _decode_image(oriented)
        record_codes(full_codes, "full", 0, 0, w, h, f"full_{angle}")

        clahe_codes = _decode_image(clahe_full)
        record_codes(clahe_codes, "full", 0, 0, w, h, f"full_{angle}_clahe")

        # Overlapping tiles make small or separated barcodes readable. Every
        # tile is considered independently so two codes in one photo are both
        # retained even when ZXing only sees each one in a single tile.
        for tile_size in TILE_SIZES:
            step = max(1, int(tile_size * (1 - TILE_OVERLAP_RATIO)))
            y = 0
            while y < h:
                x = 0
                while x < w:
                    ph = min(tile_size, h - y)
                    pw = min(tile_size, w - x)
                    if ph < tile_size * 0.4 or pw < tile_size * 0.4:
                        x += step
                        continue

                    patch = oriented[y : y + ph, x : x + pw]
                    up = cv2.resize(
                        patch,
                        (pw * 2, ph * 2),
                        interpolation=cv2.INTER_CUBIC,
                    )
                    clahe = cv2.createCLAHE(2.0, (8, 8)).apply(up)

                    up_codes = _decode_image(up)
                    record_codes(
                        up_codes,
                        "tile",
                        int(x),
                        int(y),
                        int(pw),
                        int(ph),
                        f"tile_{tile_size}_{angle}_orig",
                    )

                    if not up_codes:
                        clahe_codes = _decode_image(clahe)
                        record_codes(
                            clahe_codes,
                            "tile",
                            int(x),
                            int(y),
                            int(pw),
                            int(ph),
                            f"tile_{tile_size}_{angle}_clahe",
                        )

                    x += step
                y += step

    # ZXing has already validated each returned symbol. Do not require a
    # second occurrence: a barcode at a tile boundary may be visible in only
    # one pass, and filtering it made legitimate single detections disappear.
    return set(code_occurrences)


def _process_video(
    video_path: str, debug: bool = False, debug_dir: Optional[str] = None
) -> tuple[Counter, int, int, float, Optional[List[dict]]]:
    """
    Extract and decode frames from a video file.
    Returns (code_counter, frames_processed, frames_skipped_blur, duration, debug_frames).
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError("Impossible d'ouvrir le fichier vidéo.")

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    frame_count_known = total_frames > 0
    duration = total_frames / fps if frame_count_known and fps > 0 else 0

    frame_step = max(1, int(fps * FRAME_INTERVAL_SECONDS))
    code_counter: Counter = Counter()
    frames_processed = 0
    frames_skipped_blur = 0
    current_pos = 0
    debug_frames: list[dict] = [] if debug else []

    if debug and debug_dir is not None:
        _ensure_dir(debug_dir)

    while (frame_count_known and current_pos < total_frames) or not frame_count_known:
        # Grab intermediate frames without decoding them. This keeps the
        # reliable sequential read needed by WebM while preserving the
        # intended two decoded frames per second.
        ret = cap.grab()
        if not ret:
            break
        if current_pos % frame_step != 0:
            current_pos += 1
            continue
        ret, frame = cap.retrieve()
        if not ret:
            break

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        blur_score = _blur_score(gray)
        is_sharp = blur_score >= BLUR_THRESHOLD
        codes: Set[str] = set()

        if not is_sharp:
            frames_skipped_blur += 1
            reason = "too_blurry"
        else:
            codes = _decode_frame(gray)
            for code in codes:
                code_counter[code] += 1
            frames_processed += 1
            reason = "decoded" if codes else "sharp_no_barcode"

        image_path = None
        if debug and debug_dir is not None:
            image_name = f"frame_{int(current_pos):06d}_{reason}.jpg"
            image_path = os.path.join(debug_dir, image_name)
            try:
                cv2.imwrite(image_path, frame)
            except Exception:
                logger.exception("Unable to write debug frame %s", image_path)

        if debug:
            debug_frames.append(
                {
                    "frame_index": int(current_pos),
                    "frame_time_seconds": round(current_pos / fps, 2),
                    "blur_score": blur_score,
                    "skipped_blur": not is_sharp,
                    "codes": sorted(codes),
                    "reason": reason,
                    "image_path": (
                        os.path.relpath(image_path, PROJECT_ROOT)
                        if image_path is not None
                        else ""
                    ),
                }
            )

        current_pos += frame_step

    cap.release()
    if not frame_count_known and fps > 0:
        duration = current_pos / fps
    return code_counter, frames_processed, frames_skipped_blur, duration, debug_frames


@router.post("/video/extract", response_model=VideoExtractionResponse)
async def extract_from_video(
    file: UploadFile = File(...),
    user: UserPublic = Depends(get_current_user),
    debug: bool = False,
) -> VideoExtractionResponse:
    """
    Upload a video, extract all barcodes frame by frame (multi-scale tiled
    decoding), and register found codes into the active inventory.

    For best results: film 1-6 items at a time from 20-40cm away so that
    each barcode is clearly visible. The system processes 2 frames/second
    and skips blurry frames automatically.

    If `debug=true` is provided, the response includes per-frame details
    for each decoded or skipped frame.
    """
    start_time = time.time()

    filename = (file.filename or "").lower()
    allowed = {".mp4", ".mov", ".avi", ".webm", ".mkv", ".m4v"}
    ext = os.path.splitext(filename)[1]
    if ext not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Format non supporté ({ext}). Utilisez: mp4, mov, avi, webm, mkv.",
        )

    content = await file.read()
    if len(content) > MAX_VIDEO_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Fichier trop volumineux (max {MAX_VIDEO_SIZE_MB} MB).",
        )

    inv = await _get_active_inventory()
    inventory_date = inv.inventory_date if inv else _today()

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    debug_dir = None
    if debug:
        debug_dir = os.path.join(
            VIDEO_DEBUG_ROOT,
            f"{os.path.splitext(os.path.basename(filename))[0]}_{int(time.time())}_{uuid.uuid4().hex[:8]}",
        )

    try:
        code_counter, frames_processed, frames_skipped, duration, debug_frames = (
            _process_video(tmp_path, debug=debug, debug_dir=debug_dir)
        )
    except ValueError as e:
        return VideoExtractionResponse(
            total_frames_processed=0,
            total_frames_skipped_blur=0,
            duration_seconds=0,
            codes_found=[],
            total_added=0,
            total_duplicates=0,
            processing_time_ms=int((time.time() - start_time) * 1000),
            inventory_date=inventory_date,
            error=str(e),
            debug_frames=debug_frames if debug else None,
        )
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    results: List[VideoCodeResult] = []
    total_added = 0
    total_duplicates = 0

    for code, hits in code_counter.most_common():
        result = await register_code_for_user(
            user_id=user.id,
            username=user.username,
            code=code,
            method="barcode",
            inventory_date=inventory_date,
        )
        added = result.added
        if added:
            total_added += 1
        else:
            total_duplicates += 1

        results.append(
            VideoCodeResult(
                code=code,
                frame_hits=hits,
                added=added,
                reason=None if added else "duplicate",
            )
        )

    return VideoExtractionResponse(
        total_frames_processed=frames_processed,
        total_frames_skipped_blur=frames_skipped,
        duration_seconds=round(duration, 1),
        codes_found=results,
        total_added=total_added,
        total_duplicates=total_duplicates,
        processing_time_ms=int((time.time() - start_time) * 1000),
        inventory_date=inventory_date,
        debug_frames=debug_frames if debug else None,
    )
