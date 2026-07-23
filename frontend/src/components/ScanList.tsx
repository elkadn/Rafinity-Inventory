import { useState } from "react";
import type { CSSProperties } from "react";
import { BarcodeIcon, CloseIcon, DownloadIcon, TicketIcon } from "./icons";
import type { ScanRecord, ActiveInventory } from "../types";

interface Props {
  scans: ScanRecord[];
  onClose: () => void;
  onManualAdd: (code: string) => Promise<"added" | "duplicate" | "error" | "empty">;
  onDelete: (scanId: string, code: string) => Promise<"deleted" | "error">;
  activeInventory: ActiveInventory | null;
}

function toCsv(scans: ScanRecord[]): string {
  const header = "code,methode,confiance,horodatage\n";
  const rows = scans
    .slice()
    .reverse()
    .map((s) =>
      [
        s.code,
        s.method,
        s.confidence !== null ? s.confidence.toFixed(2) : "",
        new Date(s.scannedAt).toISOString(),
      ].join(",")
    );
  return header + rows.join("\n");
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function methodLabel(method: string): string {
  if (method === "barcode") return "Code-barres";
  if (method === "ocr") return "Lecture OCR";
  return "Ajout manuel";
}

export function ScanList({ scans, onClose, onManualAdd, onDelete, activeInventory }: Props) {
  const [manualCode, setManualCode] = useState("");
  const [manualFeedback, setManualFeedback] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleManualAdd = async () => {
    if (!manualCode.trim()) return;
    setIsAdding(true);
    setManualFeedback(null);
    try {
      const result = await onManualAdd(manualCode);
      if (result === "added") {
        setManualFeedback("✓ Code ajouté.");
        setManualCode("");
      } else if (result === "duplicate") {
        setManualFeedback("Ce code est déjà dans la liste.");
      } else if (result === "empty") {
        setManualFeedback(null);
      } else {
        setManualFeedback("Erreur, réessayez.");
      }
    } finally {
      setIsAdding(false);
    }
  };

  const handleDelete = async (scan: ScanRecord) => {
    if (!window.confirm(`Supprimer le code ${scan.code} de votre liste ?`)) return;
    setDeletingId(scan.id);
    try {
      await onDelete(scan.id, scan.code);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--color-bg)",
        display: "flex",
        flexDirection: "column",
        paddingTop: "var(--safe-top)",
        paddingBottom: "var(--safe-bottom)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 16px 12px",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-surface)",
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Tickets scannés</div>
          <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
            {scans.length} code{scans.length > 1 ? "s" : ""} unique{scans.length > 1 ? "s" : ""}
            {activeInventory && (
              <span style={{ marginLeft: 6, color: "var(--color-primary-dark)", fontWeight: 600 }}>
                · Inventaire : {activeInventory.label ?? activeInventory.inventory_date}
              </span>
            )}
          </div>
        </div>
        <button onClick={onClose} aria-label="Fermer" style={iconBtnStyle}>
          <CloseIcon size={20} />
        </button>
      </div>

      {/* Export buttons */}
      <div
        style={{
          display: "flex",
          gap: 10,
          padding: "12px 16px",
          background: "var(--color-surface)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <button
          onClick={() => download(`scans-${Date.now()}.csv`, toCsv(scans), "text/csv")}
          disabled={scans.length === 0}
          style={exportBtnStyle}
        >
          <DownloadIcon size={18} />
          Exporter CSV
        </button>
      </div>

      {/* Manual add */}
      <div
        style={{
          padding: "12px 16px",
          background: "var(--color-surface)",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleManualAdd()}
            placeholder="Ajouter un code manuellement…"
            style={{
              flex: 1,
              fontSize: 15,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--color-border)",
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
            }}
          />
          <button
            onClick={handleManualAdd}
            disabled={isAdding || !manualCode.trim()}
            style={{
              background: "var(--color-text)",
              color: "white",
              border: "none",
              borderRadius: 10,
              padding: "0 16px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Ajouter
          </button>
        </div>
        {manualFeedback && (
          <div style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>{manualFeedback}</div>
        )}
      </div>

      {/* Scan list */}
      <div style={{ overflowY: "auto", flex: 1, padding: "8px 12px" }}>
        {scans.length === 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "var(--color-text-muted)",
              gap: 10,
              textAlign: "center",
              padding: 24,
            }}
          >
            <TicketIcon size={40} />
            <div style={{ fontSize: 15 }}>Aucun ticket scanné pour l'instant.</div>
          </div>
        )}
        {scans.map((s) => (
          <div
            key={s.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 14,
              padding: "12px 14px",
              marginBottom: 8,
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: "#f0fdf4",
                color: "var(--color-primary-dark)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <BarcodeIcon size={20} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  fontSize: 17,
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {s.code}
              </div>
              <div style={{ color: "var(--color-text-muted)", fontSize: 12.5 }}>
                {methodLabel(s.method)} · {new Date(s.scannedAt).toLocaleTimeString()}
              </div>
            </div>
            {/* Delete button */}
            <button
              onClick={() => handleDelete(s)}
              disabled={deletingId === s.id}
              aria-label={`Supprimer ${s.code}`}
              style={{
                background: "none",
                border: "none",
                color: "var(--color-danger)",
                cursor: "pointer",
                fontSize: 18,
                lineHeight: 1,
                padding: "4px 6px",
                borderRadius: 6,
                flexShrink: 0,
                opacity: deletingId === s.id ? 0.4 : 1,
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const exportBtnStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  background: "var(--color-primary)",
  color: "white",
  border: "none",
  borderRadius: 12,
  padding: "12px 10px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const iconBtnStyle: CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 999,
  border: "none",
  background: "var(--color-bg)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--color-text)",
  cursor: "pointer",
};
