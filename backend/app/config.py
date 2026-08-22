import os
from pathlib import Path

from dotenv import load_dotenv


load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)


class Settings:
    APP_NAME = "Ticket Scanner API"
    APP_VERSION = "2.0.0"

    # CORS: with Caddy fronting both frontend + backend under one HTTPS
    # origin (see /caddy/Caddyfile), this often isn't even needed in
    # production - but kept for local dev where the frontend runs on a
    # different port than the backend.
    ALLOWED_ORIGINS = os.environ.get(
        "ALLOWED_ORIGINS",
    ).split(",")

    # ---- Oracle ----
    ORACLE_USER = os.environ.get("ORACLE_USER")
    ORACLE_PASSWORD = os.environ.get("ORACLE_PASSWORD")
    ORACLE_DSN = os.environ.get("ORACLE_DSN")
    ORACLE_POOL_MIN = int(os.environ.get("ORACLE_POOL_MIN"))
    ORACLE_POOL_MAX = int(os.environ.get("ORACLE_POOL_MAX"))

    # ---- Auth / JWT ----
    # IMPORTANT: override JWT_SECRET via environment variable in production -
    # this default is only here so the app doesn't crash on first run.
    JWT_SECRET = os.environ.get("JWT_SECRET")
    JWT_ALGORITHM = "HS256"
    JWT_EXPIRE_MINUTES = int(os.environ.get("JWT_EXPIRE_MINUTES"))

    # ---- OCR fallback tuning ----
    OCR_ROTATION_RANGE_DEG = 18
    OCR_ROTATION_STEP_DEG = 9
    CODE_MIN_DIGITS = 4
    CODE_MAX_DIGITS = 10


settings = Settings()
