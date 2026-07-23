"""
OCR fallback - v3 final.

Pragmatic approach:
- Detect white label regions (OPEN then CLOSE morphology).
- If blob_count > 1 → tell frontend "get closer" (multiple tickets).
- If blob_count == 1 → OCR that region.
- If blob_count == 0 → OCR the whole crop.
- Rotations: 0, -90, 90, 180 (covers landscape phone orientation).
- Upscale to 400px min dim.
- Majority vote across all attempts.
"""
from __future__ import annotations

import io
import re
from collections import Counter
from typing import List, Optional, Tuple

import cv2
import numpy as np
import pytesseract
from PIL import Image

from app.config import Settings

_DIGIT_RE = re.compile(r"\d+")
_ROTATIONS = [0, -90, 90, 180]
_PSMS = [6, 7, 11]


def _load_bgr(data: bytes) -> np.ndarray:
    pil_img = Image.open(io.BytesIO(data)).convert("RGB")
    return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)


def _rotate(image: np.ndarray, angle: float) -> np.ndarray:
    if angle == 0:
        return image
    h, w = image.shape[:2]
    cx, cy = w / 2.0, h / 2.0
    M = cv2.getRotationMatrix2D((cx, cy), angle, 1.0)
    cos, sin = abs(M[0, 0]), abs(M[0, 1])
    nw = int(h * sin + w * cos)
    nh = int(h * cos + w * sin)
    M[0, 2] += nw / 2.0 - cx
    M[1, 2] += nh / 2.0 - cy
    return cv2.warpAffine(image, M, (nw, nh), borderMode=cv2.BORDER_REPLICATE)


def _upscale(gray: np.ndarray, min_dim: int = 400) -> np.ndarray:
    h, w = gray.shape[:2]
    s = min(h, w)
    if s == 0 or s >= min_dim:
        return gray
    f = min_dim / s
    return cv2.resize(gray, (int(w * f), int(h * f)), interpolation=cv2.INTER_CUBIC)


def _ocr_region(gray: np.ndarray, settings: Settings) -> List[str]:
    up = _upscale(gray, 400)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(up)
    _, otsu = cv2.threshold(clahe, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    candidates: List[str] = []
    for angle in _ROTATIONS:
        for variant in (clahe, otsu):
            rotated = _rotate(variant, angle)
            for psm in _PSMS:
                cfg = f"--psm {psm} -c tessedit_char_whitelist=0123456789"
                try:
                    text = pytesseract.image_to_string(rotated, config=cfg).strip()
                except Exception:
                    continue
                for m in _DIGIT_RE.findall(text):
                    if settings.CODE_MIN_DIGITS <= len(m) <= settings.CODE_MAX_DIGITS:
                        candidates.append(m)
    return candidates


def _find_label_blobs(gray: np.ndarray) -> List[np.ndarray]:
    """
    Detect white rectangular label regions.
    Uses OPEN (removes noise) then CLOSE (bridges barcode gaps within a label).
    """
    img_area = gray.shape[0] * gray.shape[1]
    _, thresh = cv2.threshold(gray, 175, 255, cv2.THRESH_BINARY)
    # Open removes tiny noise before closing
    ok = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    opened = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, ok)
    # Moderate close to bridge barcode bars within one label
    ck = cv2.getStructuringElement(cv2.MORPH_RECT, (6, 6))
    closed = cv2.morphologyEx(opened, cv2.MORPH_CLOSE, ck)

    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    blobs = []
    for c in contours:
        x, y, cw, ch = cv2.boundingRect(c)
        area = cw * ch
        if area < img_area * 0.008 or area > img_area * 0.75:
            continue
        if max(cw, ch) / max(min(cw, ch), 1) > 7:
            continue
        region = gray[y : y + ch, x : x + cw]
        # Must be predominantly white (real labels > 25% white pixels)
        if (region > 175).mean() < 0.25:
            continue
        blobs.append(region)
    return blobs


def read_code_from_crop(
    data: bytes, settings: Settings
) -> Tuple[Optional[str], Optional[float], int]:
    """
    Returns (code, confidence, blob_count).
    blob_count > 1 → frontend shows "rapprochez-vous".
    blob_count == 1 → reliable single-ticket OCR.
    blob_count == 0 → fallback: OCR whole crop.
    """
    img = _load_bgr(data)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blobs = _find_label_blobs(gray)

    if len(blobs) > 1:
        return None, None, len(blobs)

    target = blobs[0] if blobs else gray
    candidates = _ocr_region(target, settings)

    if not candidates:
        return None, None, len(blobs)

    counter = Counter(candidates)
    best_value, best_count = counter.most_common(1)[0]
    confidence = round(best_count / len(candidates), 3)
    return best_value, confidence, len(blobs)
