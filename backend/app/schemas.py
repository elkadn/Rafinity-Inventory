import time
import uuid
from typing import List, Literal, Optional
from pydantic import BaseModel, Field

UserRole = Literal["admin", "scanner"]
ScanMethod = Literal["barcode", "ocr", "manuel"]


def new_id() -> str:
    return uuid.uuid4().hex


def today_str(ts: Optional[float] = None) -> str:
    """YYYY-MM-DD, used as a cheap, index-friendly grouping key - much
    simpler to query in MongoDB than doing date-range aggregation on a raw
    timestamp for every request."""
    import datetime

    dt = datetime.datetime.fromtimestamp(ts if ts is not None else time.time())
    return dt.strftime("%Y-%m-%d")


# --------------------------------------------------------------------- #
# Users
# --------------------------------------------------------------------- #
class UserCreate(BaseModel):
    username: str
    password: str
    nom: str
    prenom: str
    role: UserRole = "scanner"
    ip_poste: Optional[str] = None


class UserUpdate(BaseModel):
    nom: Optional[str] = None
    prenom: Optional[str] = None
    role: Optional[UserRole] = None
    ip_poste: Optional[str] = None
    statut: Optional[Literal["actif", "inactif"]] = None
    password: Optional[str] = None  # set to change the password


class UserPublic(BaseModel):
    id: str
    username: str
    nom: str
    prenom: str
    role: UserRole
    ip_poste: Optional[str] = None
    date_creation: float
    statut: Literal["actif", "inactif"]


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


# --------------------------------------------------------------------- #
# Scans
# --------------------------------------------------------------------- #
class ScanCreate(BaseModel):
    code: str
    method: ScanMethod
    confidence: Optional[float] = None


class ScanRecord(BaseModel):
    id: str = Field(default_factory=new_id)
    user_id: str
    username: str
    code: str
    method: ScanMethod
    confidence: Optional[float] = None
    scanned_at: float = Field(default_factory=time.time)
    scan_date: str = Field(default_factory=today_str)     # real calendar date of the scan
    inventory_date: str = ""                              # admin-defined inventory date


class ScanRegisterResponse(BaseModel):
    added: bool
    reason: Optional[str] = None  # e.g. "duplicate" when added=False
    scan: Optional[ScanRecord] = None


class MyScansResponse(BaseModel):
    scans: List[ScanRecord]
    total: int


# --------------------------------------------------------------------- #
# Admin views
# --------------------------------------------------------------------- #
class DaySummary(BaseModel):
    date: str
    total_scans: int
    users: List[dict]  # [{user_id, username, nom, prenom, count}]


class UserDayScans(BaseModel):
    date: str
    user: UserPublic
    scans: List[ScanRecord]
    deleted_scan_ids: List[str] = Field(default_factory=list)


class MergedCodeEntry(BaseModel):
    code: str
    count: int
    users: List[str]  # usernames that scanned this code that day
    methods: List[str]


class MergedDayResponse(BaseModel):
    date: str
    codes: List[MergedCodeEntry]
    total_unique_codes: int
    conflicts: int  # codes scanned by more than one user that day


class OcrResponse(BaseModel):
    code: Optional[str]
    confidence: Optional[float]
    blob_count: int = 0  # 0=no label found, 1=single ticket (reliable), >1=too many tickets
    error: Optional[str] = None


class HealthResponse(BaseModel):
    status: str
    version: str


# --------------------------------------------------------------------- #
# Active inventory (set by admin, shared by all scanners)
# --------------------------------------------------------------------- #
class InventorySetRequest(BaseModel):
    inventory_date: str  # YYYY-MM-DD  e.g. "2026-06-17"
    label: Optional[str] = None  # optional human label e.g. "Inventaire juin 2026"


class ActiveInventory(BaseModel):
    inventory_date: str
    label: Optional[str] = None
    set_at: float
    set_by_username: str


# --------------------------------------------------------------------- #
# Deletions
# --------------------------------------------------------------------- #
class DeletionRecord(BaseModel):
    id: str = Field(default_factory=new_id)
    scan_id: str
    code: str
    user_id: str
    username: str
    inventory_date: str
    deleted_at: float = Field(default_factory=time.time)
    reason: Optional[str] = None  # optional note from the user


class DeletionResponse(BaseModel):
    deleted: bool
    deletion: DeletionRecord
