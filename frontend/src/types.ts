export type UserRole = "admin" | "scanner";

export interface AuthUser {
  id: string;
  username: string;
  nom: string;
  prenom: string;
  role: UserRole;
  ip_poste: string | null;
  date_creation: number;
  statut: "actif" | "inactif";
}

export type ScanMethod = "barcode" | "ocr" | "manuel";

export interface ActiveInventory {
  inventory_date: string;
  label: string | null;
  set_at: number;
  set_by_username: string;
}

export interface ScanRecord {
  id: string;
  code: string;
  method: ScanMethod;
  confidence: number | null;
  scannedAt: number; // ms epoch, client-side
}

/** Live status shown to the user while the camera is running. */
export type ScannerStatus =
  | { kind: "idle" }
  | { kind: "scanning" } // actively looking, nothing notable right now
  | { kind: "too_far_or_blurry" } // no code found, frame unstable/blurry
  | { kind: "success"; code: string; method: ScanMethod } // just registered
  | { kind: "already_scanned"; code: string } // same physical ticket, still in view
  | { kind: "camera_error"; message: string };
