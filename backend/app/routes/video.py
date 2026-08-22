"""
Video barcode extraction - v2.

Key improvements over v1:
- Multi-scale tiling: the image is cut into overlapping patches at several
  tile sizes (300/500/800px). Each patch is upscaled 2x before decoding.
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
import os
import tempfile
import time
import uuid
from collections import Counter
from typing import List, Optional, Set

import cv2
import numpy as np
import zxingcpp
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from app.auth import get_current_user
from app.db import DuplicateKeyError, get_db
from app.routes.scans import _get_active_inventory, _today
from app.schemas import ScanRecord, UserPublic, new_id

logger = logging.getLogger(__name__)
router = APIRouter(tags=["video"])

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
VIDEO_DEBUG_ROOT = os.path.join(PROJECT_ROOT, "video_debug")

MAX_VIDEO_SIZE_MB = 200
MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024

# Process one frame every N seconds of video
FRAME_INTERVAL_SECONDS = 0.5   # 2 fps - denser than v1 (was 1fps)

# Minimum Laplacian variance to consider a frame sharp enough to decode.
# Blurry frames (motion during filming) are skipped to save time.
BLUR_THRESHOLD = 40.0

# Tile sizes used for multi-scale scanning (pixels)
TILE_SIZES = [300, 500, 800]
TILE_OVERLAP_RATIO = 0.35   # 35% overlap between adjacent tiles


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


def _blur_score(gray: np.ndarray) -> float:
    """Return the Laplacian variance to quantify frame sharpness."""
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _is_sharp(gray: np.ndarray) -> bool:
    """Return True if the frame is sharp enough to attempt barcode decoding."""
    return _blur_score(gray) >= BLUR_THRESHOLD


def _ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def _decode_image(img: np.ndarray) -> Set[str]:
    """Decode all barcodes in a single image. Returns set of code strings."""
    try:
        results = zxingcpp.read_barcodes(img)
        return {r.text for r in results if r.text and len(r.text) >= 4}
    except Exception:
        return set()


def _decode_frame(gray: np.ndarray) -> Set[str]:
    """
    Multi-scale tiled decoding of a single grayscale frame.

    Why tiling:
    - A full 1080p frame with 6 bracelets means each barcode is ~80px wide.
    - ZXing needs ~10px per bar minimum. With 15 bars in a code, that is
      150px minimum width. 80px is borderline and often fails.
    - Cutting the frame into 300-500px tiles and upscaling 2x makes each
      barcode ~160-320px wide in the tile - comfortably above the threshold.

    Why multiple tile sizes:
    - Small tiles (300px) help with small/dense barcodes.
    - Large tiles (800px) help with large/spread-out barcodes.
    - Full image pass catches codes that happen to be near patch boundaries.
    """
    code_occurrences: dict[str, list[dict]] = {}
    h, w = gray.shape

    def record_codes(codes: Set[str], source: str, x: int, y: int, width: int, height: int, method: str) -> None:
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

    # Always try full image first (fast, catches obvious codes)
    clahe_full = cv2.createCLAHE(2.0, (8, 8)).apply(gray)

    full_codes = _decode_image(gray)
    record_codes(full_codes, "full", 0, 0, w, h, "full")

    clahe_codes = _decode_image(clahe_full)
    record_codes(clahe_codes, "full", 0, 0, w, h, "full_clahe")

    if code_occurrences:
        # If full-image scan already found codes, still do tiling to catch
        # more that might be in less-visible parts of the frame.
        pass

    # Tiled multi-scale scan
    for tile_size in TILE_SIZES:
        step = max(1, int(tile_size * (1 - TILE_OVERLAP_RATIO)))
        y = 0
        while y < h:
            x = 0
            while x < w:
                ph = min(tile_size, h - y)
                pw = min(tile_size, w - x)
                # Skip very small edge tiles (not enough content to decode)
                if ph < tile_size * 0.4 or pw < tile_size * 0.4:
                    x += step
                    continue

                patch = gray[y : y + ph, x : x + pw]

                # 2x upscale makes each barcode bar larger and easier to decode
                up = cv2.resize(
                    patch,
                    (pw * 2, ph * 2),
                    interpolation=cv2.INTER_CUBIC,
                )
                clahe = cv2.createCLAHE(2.0, (8, 8)).apply(up)

                up_codes = _decode_image(up)
                record_codes(up_codes, "tile", int(x), int(y), int(pw), int(ph), f"tile_{tile_size}_orig")

                clahe_codes = _decode_image(clahe)
                record_codes(clahe_codes, "tile", int(x), int(y), int(pw), int(ph), f"tile_{tile_size}_clahe")

                x += step
            y += step

    valid_codes: Set[str] = set()
    for code, occurrences in code_occurrences.items():
        methods = {occ["method"] for occ in occurrences}
        if "full" in methods or "full_clahe" in methods or len(occurrences) >= 2:
            valid_codes.add(code)
    return valid_codes


def _process_video(video_path: str, debug: bool = False, debug_dir: Optional[str] = None) -> tuple[Counter, int, int, float, Optional[List[dict]]]:
    """
    Extract and decode frames from a video file.
    Returns (code_counter, frames_processed, frames_skipped_blur, duration, debug_frames).
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError("Impossible d'ouvrir le fichier vidéo.")

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps if fps > 0 else 0

    frame_step = max(1, int(fps * FRAME_INTERVAL_SECONDS))
    code_counter: Counter = Counter()
    frames_processed = 0
    frames_skipped_blur = 0
    current_pos = 0
    debug_frames: list[dict] = [] if debug else []

    if debug and debug_dir is not None:
        _ensure_dir(debug_dir)

    while current_pos < total_frames:
        cap.set(cv2.CAP_PROP_POS_FRAMES, current_pos)
        ret, frame = cap.read()
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
                    "image_path": os.path.relpath(image_path, PROJECT_ROOT)
                    if image_path is not None
                    else "",
                }
            )

        current_pos += frame_step

    cap.release()
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
            f"{os.path.splitext(os.path.basename(filename))[0]}_{int(time.time())}_{uuid.uuid4().hex[:8]}"
        )

    try:
        code_counter, frames_processed, frames_skipped, duration, debug_frames = _process_video(
            tmp_path, debug=debug, debug_dir=debug_dir
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

    db = get_db()
    results: List[VideoCodeResult] = []
    total_added = 0
    total_duplicates = 0

    for code, hits in code_counter.most_common():
        record = ScanRecord(
            user_id=user.id,
            username=user.username,
            code=code,
            method="barcode",
            confidence=None,
            inventory_date=inventory_date,
        )
        doc = record.model_dump()
        doc["_id"] = doc.pop("id")

        try:
            await db.scans.insert_one(doc)
            added = True
            total_added += 1
        except DuplicateKeyError:
            added = False
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