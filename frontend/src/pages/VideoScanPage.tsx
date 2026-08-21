import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { extractFromVideo, type VideoExtractionResponse } from "../lib/api";
import { BarcodeIcon, DownloadIcon, TicketIcon } from "../components/icons";

type Phase =
  | { kind: "idle" }
  | { kind: "selected"; file: File }
  | { kind: "uploading"; phase: string }
  | { kind: "done"; result: VideoExtractionResponse }
  | { kind: "error"; message: string };

function toCsv(result: VideoExtractionResponse): string {
  const header = "code,frames_detectes,statut,date_inventaire\n";
  const rows = result.codes_found.map((c) =>
    [c.code, c.frame_hits, c.added ? "ajoute" : "deja_existant", result.inventory_date].join(",")
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function VideoScanPage() {
  const { token, user } = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhase({ kind: "selected", file });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    setPhase({ kind: "selected", file });
  };

  const handleProcess = async () => {
    if (phase.kind !== "selected" || !token) return;
    const file = phase.file;
    setPhase({ kind: "uploading", phase: "Envoi de la vidéo…" });
    try {
      const result = await extractFromVideo(token, file, (msg) =>
        setPhase({ kind: "uploading", phase: msg })
      );
      if (result.error) {
        setPhase({ kind: "error", message: result.error });
      } else {
        setPhase({ kind: "done", result });
      }
    } catch (err) {
      setPhase({
        kind: "error",
        message: err instanceof Error ? err.message : "Erreur inconnue",
      });
    }
  };

  const handleReset = () => {
    setPhase({ kind: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div style={{ minHeight: "100dvh", background: "var(--color-bg)", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <header style={{ background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BarcodeIcon size={22} />
          <strong>Scan vidéo</strong>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 13.5 }}>
          <Link to="/scan" style={{ color: "var(--color-info)" }}>← Scanner en direct</Link>
          {user?.role === "admin" && (
            <Link to="/admin" style={{ color: "var(--color-info)" }}>Admin</Link>
          )}
        </div>
      </header>

      <main style={{ flex: 1, padding: "20px 16px", maxWidth: 620, margin: "0 auto", width: "100%" }}>

        {/* Tips box */}
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 14, padding: "14px 16px", marginBottom: 18, fontSize: 13.5, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>💡 Conseils pour un meilleur résultat</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li><strong>Filmez de près</strong> : 1 à 6 articles max dans le cadre. Le code-barres doit être bien visible.</li>
            <li><strong>Déplacez-vous lentement</strong> : les frames floues sont ignorées automatiquement.</li>
            <li><strong>Durée recommandée</strong> : 15 à 60 secondes selon le nombre d'articles.</li>
            <li>MP4, MOV, AVI, WEBM · Max 200 MB</li>
          </ul>
        </div>

        {/* Upload zone */}
        {(phase.kind === "idle" || phase.kind === "selected") && (
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
            style={{
              border: `2px dashed ${phase.kind === "selected" ? "var(--color-primary)" : "var(--color-border)"}`,
              borderRadius: 16,
              padding: "36px 20px",
              textAlign: "center",
              cursor: "pointer",
              background: phase.kind === "selected" ? "#f0fdf4" : "var(--color-surface)",
              transition: "all 150ms",
              marginBottom: 16,
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/x-msvideo,video/webm,video/x-matroska,video/x-m4v"
              onChange={handleFileChange}
              style={{ display: "none" }}
            />
            <div style={{ width: 52, height: 52, borderRadius: 999, background: phase.kind === "selected" ? "#dcfce7" : "var(--color-bg)", color: phase.kind === "selected" ? "var(--color-primary-dark)" : "var(--color-text-muted)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
              <TicketIcon size={26} />
            </div>
            {phase.kind === "idle" ? (
              <>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Choisir une vidéo</div>
                <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>ou glissez-déposez ici</div>
              </>
            ) : (
              <>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{phase.file.name}</div>
                <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>{(phase.file.size / (1024 * 1024)).toFixed(1)} MB · Cliquez pour changer</div>
              </>
            )}
          </div>
        )}

        {phase.kind === "selected" && (
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <button onClick={handleProcess} style={primaryBtnStyle}>🎬 Lancer l'extraction</button>
            <button onClick={handleReset} style={secondaryBtnStyle}>Annuler</button>
          </div>
        )}

        {/* Processing spinner */}
        {phase.kind === "uploading" && (
          <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 16, padding: "36px 20px", textAlign: "center" }}>
            <div style={{ width: 44, height: 44, border: "4px solid var(--color-border)", borderTopColor: "var(--color-primary)", borderRadius: "50%", margin: "0 auto 16px", animation: "spin 1s linear infinite" }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{phase.phase}</div>
            <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 6 }}>
              Analyse en cours — cela peut prendre quelques secondes…
            </div>
          </div>
        )}

        {/* Error */}
        {phase.kind === "error" && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 14, padding: 20 }}>
            <div style={{ fontWeight: 700, color: "var(--color-danger)", marginBottom: 8 }}>Erreur</div>
            <div style={{ fontSize: 14, color: "#991b1b", marginBottom: 14 }}>{phase.message}</div>
            <button onClick={handleReset} style={primaryBtnStyle}>Réessayer</button>
          </div>
        )}

        {/* Results */}
        {phase.kind === "done" && (
          <ResultsView result={phase.result} onReset={handleReset} />
        )}
      </main>
    </div>
  );
}

// ------------------------------------------------------------------ //
function ResultsView({ result, onReset }: { result: VideoExtractionResponse; onReset: () => void }) {
  const [showDuplicates, setShowDuplicates] = useState(false);
  const added = result.codes_found.filter((c) => c.added);
  const duplicates = result.codes_found.filter((c) => !c.added);
  const displayed = showDuplicates ? result.codes_found : added;

  const sharpPct = result.total_frames_processed + result.total_frames_skipped_blur > 0
    ? Math.round(result.total_frames_processed / (result.total_frames_processed + result.total_frames_skipped_blur) * 100)
    : 0;

  return (
    <div>
      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 18 }}>
        <StatCard label="Ajoutés" value={result.total_added} color="var(--color-primary)" />
        <StatCard label="Déjà existants" value={result.total_duplicates} color="var(--color-warning)" />
        <StatCard label="Frames nettes" value={`${sharpPct}%`} color="var(--color-info)" />
      </div>

      {/* Meta info */}
      <div style={{ fontSize: 12.5, color: "var(--color-text-muted)", marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 12 }}>
        <span>📋 Inventaire : <strong>{result.inventory_date}</strong></span>
        <span>⏱ Vidéo : <strong>{result.duration_seconds}s</strong></span>
        <span>🖼 Frames analysées : <strong>{result.total_frames_processed}</strong></span>
        {result.total_frames_skipped_blur > 0 && (
          <span style={{ color: "var(--color-warning)" }}>
            ⚠️ {result.total_frames_skipped_blur} frames floues ignorées
            {sharpPct < 50 && " — filmez plus lentement pour de meilleurs résultats"}
          </span>
        )}
        <span>🔄 Traitement : <strong>{formatDuration(result.processing_time_ms)}</strong></span>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <button
          onClick={() => download(`video-scans-${Date.now()}.csv`, toCsv(result), "text/csv")}
          disabled={result.codes_found.length === 0}
          style={primaryBtnStyle}
        >
          <DownloadIcon size={16} /> Export CSV
        </button>
        {duplicates.length > 0 && (
          <button onClick={() => setShowDuplicates((v) => !v)} style={secondaryBtnStyle}>
            {showDuplicates ? "Masquer les doublons" : `Afficher tout (${result.codes_found.length})`}
          </button>
        )}
        <button onClick={onReset} style={secondaryBtnStyle}>Nouvelle vidéo</button>
      </div>

      {/* No results guidance */}
      {result.codes_found.length === 0 && (
        <div style={{ background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 14, padding: 16, fontSize: 14, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Aucun code détecté</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>Rapprochez-vous des articles (20-40cm)</li>
            <li>Filmez plus lentement pour éviter le flou</li>
            <li>Assurez-vous que les codes-barres sont bien visibles</li>
            <li>Essayez en meilleure lumière</li>
          </ul>
        </div>
      )}

      {/* Results table */}
      {displayed.length > 0 && (
        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 90px", padding: "10px 16px", fontSize: 12, color: "var(--color-text-muted)", fontWeight: 600, borderBottom: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
            <div>Code</div>
            <div style={{ textAlign: "center" }}>Frames</div>
            <div style={{ textAlign: "center" }}>Statut</div>
          </div>
          {displayed.map((c, i) => (
            <div key={c.code} style={{ display: "grid", gridTemplateColumns: "1fr 60px 90px", padding: "11px 16px", fontSize: 14, borderBottom: i < displayed.length - 1 ? "1px solid var(--color-border)" : "none", alignItems: "center" }}>
              <div style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontWeight: 600 }}>{c.code}</div>
              <div style={{ textAlign: "center", fontSize: 12.5, color: "var(--color-text-muted)" }}>{c.frame_hits}×</div>
              <div style={{ textAlign: "center" }}>
                {c.added ? (
                  <span style={{ fontSize: 12, background: "#dcfce7", color: "#166534", padding: "3px 8px", borderRadius: 999, fontWeight: 600 }}>Ajouté</span>
                ) : (
                  <span style={{ fontSize: 12, background: "#fef3c7", color: "#92400e", padding: "3px 8px", borderRadius: 999 }}>Existant</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {duplicates.length > 0 && !showDuplicates && (
        <div style={{ marginTop: 10, fontSize: 13, color: "var(--color-text-muted)", textAlign: "center" }}>
          {duplicates.length} code{duplicates.length > 1 ? "s" : ""} déjà dans l'inventaire ·{" "}
          <button onClick={() => setShowDuplicates(true)} style={{ background: "none", border: "none", color: "var(--color-info)", cursor: "pointer", fontSize: 13 }}>
            Afficher
          </button>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 12, padding: "12px 10px", textAlign: "center" }}>
      <div style={{ fontSize: 24, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", marginTop: 4 }}>{label}</div>
    </div>
  );
}



const primaryBtnStyle: CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  background: "var(--color-primary)", color: "white",
  border: "none", borderRadius: 10, padding: "12px 18px",
  fontSize: 14, fontWeight: 700, cursor: "pointer",
};

const secondaryBtnStyle: CSSProperties = {
  background: "var(--color-surface)", color: "var(--color-text)",
  border: "1px solid var(--color-border)", borderRadius: 10,
  padding: "12px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer",
};