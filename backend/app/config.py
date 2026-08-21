import os


class Settings:
    APP_NAME = "Ticket Scanner API"
    APP_VERSION = "2.0.0"

    # CORS: with Caddy fronting both frontend + backend under one HTTPS
    # origin (see /caddy/Caddyfile), this often isn't even needed in
    # production - but kept for local dev where the frontend runs on a
    # different port than the backend.
    ALLOWED_ORIGINS = os.environ.get(
        "ALLOWED_ORIGINS",
        "https://localhost:5173,https://192.168.1.51:5173",
    ).split(",")

    # ---- MongoDB ----
    MONGODB_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017")
    MONGODB_DB_NAME = os.environ.get("MONGODB_DB_NAME", "ticket_scanner")

    # ---- Auth / JWT ----
    # IMPORTANT: override JWT_SECRET via environment variable in production -
    # this default is only here so the app doesn't crash on first run.
    JWT_SECRET = os.environ.get("JWT_SECRET", "jesuiadnaneelkiheletjesuislpourrafinityprojet")
    JWT_ALGORITHM = "HS256"
    JWT_EXPIRE_MINUTES = int(os.environ.get("JWT_EXPIRE_MINUTES", "480"))

    # ---- OCR fallback tuning ----
    OCR_ROTATION_RANGE_DEG = 18
    OCR_ROTATION_STEP_DEG = 9
    CODE_MIN_DIGITS = 4
    CODE_MAX_DIGITS = 10


settings = Settings()
