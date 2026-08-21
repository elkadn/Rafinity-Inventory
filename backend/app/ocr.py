# """
# OCR fallback - v3 final.

# Pragmatic approach:
# - Detect white label regions (OPEN then CLOSE morphology).
# - If blob_count > 1 → tell frontend "get closer" (multiple tickets).
# - If blob_count == 1 → OCR that region.
# - If blob_count == 0 → OCR the whole crop.
# - Rotations: 0, -90, 90, 180 (covers landscape phone orientation).
# - Upscale to 400px min dim.
# - Majority vote across all attempts.
# """
# from __future__ import annotations

# import io
# import re
# from collections import Counter
# from typing import List, Optional, Tuple

# import cv2
# import numpy as np
# import pytesseract
# from PIL import Image

# from app.config import Settings

# _DIGIT_RE = re.compile(r"\d+")
# _ROTATIONS = [0, -90, 90, 180]
# _PSMS = [6, 7, 11]


# def _load_bgr(data: bytes) -> np.ndarray:
#     pil_img = Image.open(io.BytesIO(data)).convert("RGB")
#     return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)


# def _rotate(image: np.ndarray, angle: float) -> np.ndarray:
#     if angle == 0:
#         return image
#     h, w = image.shape[:2]
#     cx, cy = w / 2.0, h / 2.0
#     M = cv2.getRotationMatrix2D((cx, cy), angle, 1.0)
#     cos, sin = abs(M[0, 0]), abs(M[0, 1])
#     nw = int(h * sin + w * cos)
#     nh = int(h * cos + w * sin)
#     M[0, 2] += nw / 2.0 - cx
#     M[1, 2] += nh / 2.0 - cy
#     return cv2.warpAffine(image, M, (nw, nh), borderMode=cv2.BORDER_REPLICATE)


# def _upscale(gray: np.ndarray, min_dim: int = 400) -> np.ndarray:
#     h, w = gray.shape[:2]
#     s = min(h, w)
#     if s == 0 or s >= min_dim:
#         return gray
#     f = min_dim / s
#     return cv2.resize(gray, (int(w * f), int(h * f)), interpolation=cv2.INTER_CUBIC)


# def _ocr_region(gray: np.ndarray, settings: Settings) -> List[str]:
#     up = _upscale(gray, 400)
#     clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(up)
#     _, otsu = cv2.threshold(clahe, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
#     candidates: List[str] = []
#     for angle in _ROTATIONS:
#         for variant in (clahe, otsu):
#             rotated = _rotate(variant, angle)
#             for psm in _PSMS:
#                 cfg = f"--psm {psm} -c tessedit_char_whitelist=0123456789"
#                 try:
#                     text = pytesseract.image_to_string(rotated, config=cfg).strip()
#                 except Exception:
#                     continue
#                 for m in _DIGIT_RE.findall(text):
#                     if settings.CODE_MIN_DIGITS <= len(m) <= settings.CODE_MAX_DIGITS:
#                         candidates.append(m)
#     return candidates


# def _find_label_blobs(gray: np.ndarray) -> List[np.ndarray]:
#     """
#     Detect white rectangular label regions.
#     Uses OPEN (removes noise) then CLOSE (bridges barcode gaps within a label).
#     """
#     img_area = gray.shape[0] * gray.shape[1]
#     _, thresh = cv2.threshold(gray, 175, 255, cv2.THRESH_BINARY)
#     # Open removes tiny noise before closing
#     ok = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
#     opened = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, ok)
#     # Moderate close to bridge barcode bars within one label
#     ck = cv2.getStructuringElement(cv2.MORPH_RECT, (6, 6))
#     closed = cv2.morphologyEx(opened, cv2.MORPH_CLOSE, ck)

#     contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
#     blobs = []
#     for c in contours:
#         x, y, cw, ch = cv2.boundingRect(c)
#         area = cw * ch
#         if area < img_area * 0.008 or area > img_area * 0.75:
#             continue
#         if max(cw, ch) / max(min(cw, ch), 1) > 7:
#             continue
#         region = gray[y : y + ch, x : x + cw]
#         # Must be predominantly white (real labels > 25% white pixels)
#         if (region > 175).mean() < 0.25:
#             continue
#         blobs.append(region)
#     return blobs


# def read_code_from_crop(
#     data: bytes, settings: Settings
# ) -> Tuple[Optional[str], Optional[float], int]:
#     """
#     Returns (code, confidence, blob_count).
#     blob_count > 1 → frontend shows "rapprochez-vous".
#     blob_count == 1 → reliable single-ticket OCR.
#     blob_count == 0 → fallback: OCR whole crop.
#     """
"""
OCR fallback - v4 (EasyOCR).

EasyOCR replaces Tesseract as the recognition engine because:
- handles unusual/condensed fonts (like ticket label fonts) much better
- natively tolerant to moderate rotation without exhaustive manual sweep
- better noise tolerance when barcode smear is adjacent to the number

The model is loaded ONCE at startup (lazy singleton) - first call takes
~3s to load, subsequent calls are fast (~0.5-1s per region on CPU).

Architecture (unchanged from v3):
1. Detect white label regions in the crop (blob detection).
2. blob_count > 1 → return immediately, tell frontend "get closer".
3. blob_count == 1 → OCR that region.
4. blob_count == 0 → OCR the whole crop (fallback).
"""
from __future__ import annotations

import io
import logging
import re
from collections import Counter
from typing import List, Optional, Tuple

import cv2
import numpy as np
from PIL import Image

from app.config import Settings

logger = logging.getLogger(__name__)
_DIGIT_RE = re.compile(r"\d+")

# --------------------------------------------------------------------------- #
# EasyOCR singleton (loaded once, reused for every request)
# --------------------------------------------------------------------------- #
_reader = None


def _get_reader():
    global _reader
    if _reader is None:
        try:
            import easyocr
            logger.info("Loading EasyOCR model (first call, ~3s)…")
            _reader = easyocr.Reader(["en"], gpu=False)
            logger.info("EasyOCR ready.")
        except Exception as e:
            logger.error("EasyOCR not available: %s — falling back to Tesseract", e)
            _reader = "tesseract"  # sentinel: use tesseract fallback
    return _reader


# --------------------------------------------------------------------------- #
# Image helpers
# --------------------------------------------------------------------------- #
def _load_bgr(data: bytes) -> np.ndarray:
    pil_img = Image.open(io.BytesIO(data)).convert("RGB")
    return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)


def _upscale(gray: np.ndarray, min_dim: int = 400) -> np.ndarray:
    h, w = gray.shape[:2]
    s = min(h, w)
    if s == 0 or s >= min_dim:
        return gray
    f = min_dim / s
    return cv2.resize(gray, (int(w * f), int(h * f)), interpolation=cv2.INTER_CUBIC)


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


# --------------------------------------------------------------------------- #
# OCR engines
# --------------------------------------------------------------------------- #
def _ocr_easyocr(
    gray: np.ndarray,
    settings: Settings,
    allowlist: str = "0123456789",
    quick: bool = False,
) -> List[str]:
    """
    EasyOCR strategy:
    - Fast path: one pass at 0° for the common case, which is usually enough.
    - Full path: try 0°, -90°, 90°, 180° only if the fast path fails.
    - EasyOCR handles slight skew (~15°) internally, so we don't need a
      dense rotation sweep like we did with Tesseract.
    """
    reader = _get_reader()
    if reader == "tesseract":
        return _ocr_tesseract(gray, settings)

    up = _upscale(gray, 400)
    candidates: List[str] = []
    angles = [0] if quick else [0, -90, 90, 180]

    for angle in angles:
        rotated = _rotate(up, angle)
        try:
            results = reader.readtext(
                rotated,
                detail=1,
                allowlist=allowlist,
                paragraph=False,
                batch_size=1,
            )
        except Exception as e:
            logger.debug("EasyOCR error at angle %s: %s", angle, e)
            continue

        hits = []
        for _bbox, text, conf in results:
            if not text:
                continue
            for m in _DIGIT_RE.findall(text):
                if settings.CODE_MIN_DIGITS <= len(m) <= settings.CODE_MAX_DIGITS:
                    weight = max(1, int(conf * 5))
                    hits.extend([m] * weight)

        candidates.extend(hits)

        if hits:
            counter = Counter(hits)
            top_value, top_count = counter.most_common(1)[0]
            top_conf = top_count / len(hits)
            if top_conf >= 0.6:
                logger.debug("EasyOCR early exit at angle %s: %s", angle, top_value)
                break

    return candidates


def _codes_match_with_08(a: str, b: str) -> bool:
    if len(a) != len(b):
        return False
    for x, y in zip(a, b):
        if x == y:
            continue
        if {x, y} != {"0", "8"}:
            return False
    return True


def _confirm_code_from_top_bottom(
    gray: np.ndarray, settings: Settings, quick: bool = False
) -> Tuple[Optional[str], Optional[float]]:
    h = gray.shape[0]
    if h < 60:
        return None, None

    top_h = max(1, int(h * 0.35))
    bot_y = min(h, int(h * 0.55))
    top = gray[:top_h, :]
    bottom = gray[bot_y:, :]

    top_codes = list(dict.fromkeys(
        _ocr_easyocr(
            top,
            settings,
            allowlist="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-",
            quick=quick,
        ),
    ))
    bottom_codes = list(dict.fromkeys(
        _ocr_easyocr(bottom, settings, allowlist="0123456789", quick=quick),
    ))

    if not top_codes or not bottom_codes:
        return None, None

    for code in top_codes:
        if code in bottom_codes:
            logger.debug("Top/bottom exact match confirmed: %s", code)
            return code, 0.95

    for top_code in top_codes:
        for bottom_code in bottom_codes:
            if _codes_match_with_08(top_code, bottom_code):
                logger.debug(
                    "Top/bottom 0/8 match resolved: %s / %s -> %s",
                    top_code,
                    bottom_code,
                    bottom_code,
                )
                return bottom_code, 0.75

    return None, None


def _ocr_tesseract(gray: np.ndarray, settings: Settings, quick: bool = False) -> List[str]:
    """Tesseract fallback (used if EasyOCR is not installed)."""
    import pytesseract

    up = _upscale(gray, 400)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(up)
    _, otsu = cv2.threshold(clahe, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    candidates: List[str] = []

    angles = [0] if quick else [0, -90, 90, 180]
    for angle in angles:
        for variant in (clahe, otsu):
            rotated = _rotate(variant, angle)
            for psm in (6, 7) if quick else (6, 7, 11):
                cfg = f"--psm {psm} -c tessedit_char_whitelist=0123456789"
                try:
                    text = pytesseract.image_to_string(rotated, config=cfg).strip()
                except Exception:
                    continue
                for m in _DIGIT_RE.findall(text):
                    if settings.CODE_MIN_DIGITS <= len(m) <= settings.CODE_MAX_DIGITS:
                        candidates.append(m)
    return candidates


# --------------------------------------------------------------------------- #
# Label blob detection
# --------------------------------------------------------------------------- #
def _find_label_blobs(gray: np.ndarray) -> List[np.ndarray]:
    """
    Detect white rectangular label regions.
    OPEN (removes tiny noise) then CLOSE (bridges barcode gaps within a label).
    """
    img_area = gray.shape[0] * gray.shape[1]
    _, thresh = cv2.threshold(gray, 175, 255, cv2.THRESH_BINARY)
    ok = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    opened = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, ok)
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
        if (region > 175).mean() < 0.25:
            continue
        blobs.append(region)
    return blobs


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #
def read_code_from_crop(
    data: bytes, settings: Settings
) -> Tuple[Optional[str], Optional[float], int]:
    """
    Returns (code, confidence, blob_count).
    blob_count > 1 → frontend shows "rapprochez-vous".
    blob_count == 1 → reliable single-ticket OCR result.
    blob_count == 0 → fallback: OCR whole crop.
    """
    img = _load_bgr(data)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blobs = _find_label_blobs(gray)
    blob_count = len(blobs)

    if blob_count <= 1:
        quick_candidates = _ocr_easyocr(gray, settings, quick=True)
        if quick_candidates:
            counter = Counter(quick_candidates)
            best_value, best_count = counter.most_common(1)[0]
            confidence = round(best_count / len(quick_candidates), 3)
            return best_value, confidence, blob_count

        # Try top/bottom label confirmation first for tickets with a BA-xxxxxx
        # label above and a numeric label below. This helps resolve 0/8 ambiguity.
        confirmed_code, confirmed_confidence = _confirm_code_from_top_bottom(
            gray, settings, quick=True
        )
        if confirmed_code:
            return confirmed_code, confirmed_confidence, blob_count

    if blob_count == 1:
        targets = [blobs[0]]
    elif blob_count > 1:
        targets = [*blobs, gray]
    else:
        targets = [gray]

    candidates: List[str] = []
    for target in targets:
        candidates.extend(_ocr_easyocr(target, settings, quick=False))
        if candidates:
            break

    if not candidates:
        return None, None, blob_count

    counter = Counter(candidates)
    best_value, best_count = counter.most_common(1)[0]
    confidence = round(best_count / len(candidates), 3)
    return best_value, confidence, blob_count