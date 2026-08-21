const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* ignore - not JSON */
    }
    throw new Error(detail);
  }
  return res.json();
}

// --------------------------------------------------------------------- //
// Auth
// --------------------------------------------------------------------- //
export interface AuthUserDto {
  id: string;
  username: string;
  nom: string;
  prenom: string;
  role: "admin" | "scanner";
  ip_poste: string | null;
  date_creation: number;
  statut: "actif" | "inactif";
}

export interface LoginResult {
  access_token: string;
  token_type: string;
  expires_at: number;
  user: AuthUserDto;
}

export async function login(username: string, password: string): Promise<LoginResult> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return handle<LoginResult>(res);
}

export interface MeResult {
  expires_at: number;
  user: AuthUserDto;
}

export async function fetchMe(token: string): Promise<MeResult> {
  const res = await fetch(`${API_BASE}/auth/me`, { headers: authHeaders(token) });
  return handle<MeResult>(res);
}

// --------------------------------------------------------------------- //
// Scans
// --------------------------------------------------------------------- //
export interface RegisterScanPayload {
  code: string;
  method: "barcode" | "ocr" | "manuel";
  confidence: number | null;
}

export interface ScanDto {
  id: string;
  user_id: string;
  username: string;
  code: string;
  method: "barcode" | "ocr" | "manuel";
  confidence: number | null;
  scanned_at: number;
  scan_date: string;
}

export interface RegisterScanResult {
  added: boolean;
  reason: string | null;
  scan: ScanDto | null;
}

export async function registerScan(
  token: string,
  payload: RegisterScanPayload
): Promise<RegisterScanResult> {
  const res = await fetch(`${API_BASE}/scans`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(payload),
  });
  return handle<RegisterScanResult>(res);
}

export async function myScans(
  token: string,
  date?: string
): Promise<{ scans: ScanDto[]; total: number }> {
  const url = new URL(`${API_BASE}/scans/me`, window.location.href);
  if (date) url.searchParams.set("date", date);
  const res = await fetch(url.toString(), { headers: authHeaders(token) });
  return handle(res);
}

export interface OcrResult {
  code: string | null;
  confidence: number | null;
  error?: string | null;
  blob_count?: number;
}

export async function ocrFallback(token: string, blob: Blob): Promise<OcrResult> {
  const form = new FormData();
  form.append("file", blob, "crop.jpg");
  const res = await fetch(`${API_BASE}/ocr`, {
    method: "POST",
    headers: authHeaders(token),
    body: form,
  });
  return handle(res);
}

// --------------------------------------------------------------------- //
// Admin
// --------------------------------------------------------------------- //
export interface DaySummaryDto {
  date: string;
  total_scans: number;
  users: { user_id: string; username: string; nom: string; prenom: string; count: number }[];
}

export interface UserDayScansDto {
  date: string;
  user: AuthUserDto;
  scans: ScanDto[];
}

export interface MergedCodeEntryDto {
  code: string;
  count: number;
  users: string[];
  methods: string[];
}

export interface MergedDayDto {
  date: string;
  codes: MergedCodeEntryDto[];
  total_unique_codes: number;
  conflicts: number;
}

export async function adminListDays(token: string): Promise<DaySummaryDto[]> {
  const res = await fetch(`${API_BASE}/admin/days`, { headers: authHeaders(token) });
  return handle(res);
}

export async function adminUserDayScans(
  token: string,
  date: string,
  userId: string
): Promise<UserDayScansDto> {
  const res = await fetch(`${API_BASE}/admin/days/${date}/users/${userId}`, {
    headers: authHeaders(token),
  });
  return handle(res);
}

export async function adminMergedDay(token: string, date: string): Promise<MergedDayDto> {
  const res = await fetch(`${API_BASE}/admin/days/${date}/merged`, {
    headers: authHeaders(token),
  });
  return handle(res);
}

export async function adminDownloadDayCsv(
  token: string,
  date: string,
  userId?: string
): Promise<void> {
  const url = new URL(`${API_BASE}/admin/days/${date}/export.xlsx`, window.location.href);
  if (userId) url.searchParams.set("user_id", userId);
  const res = await fetch(url.toString(), { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = userId ? `scans-${date}-${userId}.xlsx` : `scans-${date}-fusion.xlsx`;
  a.click();
  URL.revokeObjectURL(objectUrl);
}

export interface CreateUserPayload {
  username: string;
  password: string;
  nom: string;
  prenom: string;
  role: "admin" | "scanner";
  ip_poste?: string | null;
}

export async function adminListUsers(token: string): Promise<AuthUserDto[]> {
  const res = await fetch(`${API_BASE}/admin/users`, { headers: authHeaders(token) });
  return handle(res);
}

export async function adminCreateUser(
  token: string,
  payload: CreateUserPayload
): Promise<AuthUserDto> {
  const res = await fetch(`${API_BASE}/admin/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function adminUpdateUser(
  token: string,
  userId: string,
  payload: Partial<CreateUserPayload> & { statut?: "actif" | "inactif" }
): Promise<AuthUserDto> {
  const res = await fetch(`${API_BASE}/admin/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(payload),
  });
  return handle(res);
}

// --------------------------------------------------------------------- //
// Inventory
// --------------------------------------------------------------------- //
export interface ActiveInventoryDto {
  inventory_date: string;
  label: string | null;
  set_at: number;
  set_by_username: string;
}

export async function fetchActiveInventory(token: string): Promise<ActiveInventoryDto | null> {
  const res = await fetch(`${API_BASE}/inventory/active`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`fetchActiveInventory failed: ${res.status}`);
  const data = await res.json();
  return data ?? null;
}

export async function adminSetInventory(
  token: string,
  payload: { inventory_date: string; label?: string }
): Promise<ActiveInventoryDto> {
  const res = await fetch(`${API_BASE}/admin/inventory/active`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function adminClearInventory(token: string): Promise<void> {
  await fetch(`${API_BASE}/admin/inventory/active`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

// --------------------------------------------------------------------- //
// Deletions
// --------------------------------------------------------------------- //
export interface DeletionDto {
  id: string;
  scan_id: string;
  code: string;
  user_id: string;
  username: string;
  inventory_date: string;
  deleted_at: number;
  reason: string | null;
}

export async function deleteScan(
  token: string,
  scanId: string,
  reason?: string
): Promise<{ deleted: boolean; deletion: DeletionDto }> {
  const url = new URL(`${API_BASE}/scans/${scanId}`, window.location.href);
  if (reason) url.searchParams.set("reason", reason);
  const res = await fetch(url.toString(), { method: "DELETE", headers: authHeaders(token) });
  return handle(res);
}

export async function adminListDeletions(
  token: string,
  inventory_date?: string,
  user_id?: string
): Promise<DeletionDto[]> {
  const url = new URL(`${API_BASE}/admin/deletions`, window.location.href);
  if (inventory_date) url.searchParams.set("inventory_date", inventory_date);
  if (user_id) url.searchParams.set("user_id", user_id);
  const res = await fetch(url.toString(), { headers: authHeaders(token) });
  return handle(res);
}



// --------------------------------------------------------------------- //
// Video extraction
// --------------------------------------------------------------------- //
export interface VideoCodeResult {
  code: string;
  frame_hits: number;
  added: boolean;
  reason: string | null;
}

export interface VideoExtractionResponse {
  total_frames_processed: number;
  duration_seconds: number;
  total_frames_skipped_blur: number;
  codes_found: VideoCodeResult[];
  total_added: number;
  total_duplicates: number;
  processing_time_ms: number;
  inventory_date: string;
  error: string | null;
}

export async function extractFromVideo(
  token: string,
  file: File,
  onProgress?: (phase: string) => void
): Promise<VideoExtractionResponse> {
  onProgress?.("Envoi de la vidéo…");
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/video/extract`, {
    method: "POST",
    headers: authHeaders(token),
    body: form,
  });
  onProgress?.("Traitement en cours…");
  return handle<VideoExtractionResponse>(res);
}