import { useEffect, useState } from "react";
import { useCamera } from "../hooks/useCamera";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";
import { useAuth } from "../context/AuthContext";
import { StatusOverlay } from "../components/StatusOverlay";
import { ScanList } from "../components/ScanList";
import { CameraPermissionScreen } from "../components/CameraPermissionScreen";
import { AiIcon, CameraIcon, ListIcon, StopIcon } from "../components/icons";
import { initAudio } from "../lib/beep";
import { Link } from "react-router-dom";

export default function ScannerPage() {
  const { user, token, logout } = useAuth();
  const { videoRef, isRunning, error, permissionState, start, stop } =
    useCamera();
  const [showList, setShowList] = useState(false);

  const {
    status,
    scans,
    addManualCode,
    deleteScanById,
    activeInventory,
    triggerOcr,
    ocrInProgress,
    captureFrameForOcr,
    runOcrOnImage,
  } = useBarcodeScanner({ videoRef, isRunning, token });
  const [ocrPreviewUrl, setOcrPreviewUrl] = useState<string | null>(null);
  const [ocrPreviewBlob, setOcrPreviewBlob] = useState<Blob | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);

  const handleStart = async () => {
    // Must run synchronously inside the click handler, before any `await` -
    // iOS Safari refuses to unlock an AudioContext otherwise.
    initAudio();
    await start();
  };

  useEffect(() => {
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (ocrPreviewUrl) URL.revokeObjectURL(ocrPreviewUrl);
    };
  }, [ocrPreviewUrl]);

  const showPermissionScreen = !isRunning && permissionState === "denied";
  const capitalize = (text?: string) => {
    if (!text) return "";
    return text.toUpperCase();
  };

  const handleCaptureOcr = async () => {
    setOcrError(null);
    const { blob, previewUrl } = await captureFrameForOcr();
    if (!blob || !previewUrl) {
      setOcrError("Impossible de capturer l'image du ticket.");
      return;
    }
    if (ocrPreviewUrl) URL.revokeObjectURL(ocrPreviewUrl);
    setOcrPreviewBlob(blob);
    setOcrPreviewUrl(previewUrl);
  };

  const handleValidateOcr = async () => {
    if (!ocrPreviewBlob) return;
    setOcrError(null);
    const result = await runOcrOnImage(ocrPreviewBlob);
    if (!result.ok) {
      setOcrError(result.error ?? "Échec de l'analyse OCR.");
      return;
    }
    if (ocrPreviewUrl) URL.revokeObjectURL(ocrPreviewUrl);
    setOcrPreviewBlob(null);
    setOcrPreviewUrl(null);
  };

  const handleDismissOcrPreview = () => {
    if (ocrPreviewUrl) URL.revokeObjectURL(ocrPreviewUrl);
    setOcrPreviewBlob(null);
    setOcrPreviewUrl(null);
    setOcrError(null);
  };

  return (
    <div
      className="app-shell"
      style={{
        width: "100vw",
        height: "100dvh",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <style>{`
        @media (max-width: 420px) {
          .scan-idle-card { padding: 28px 20px !important; }
          .scan-action-row { flex-direction: column !important; }
        }
        .scan-start-btn:hover { transform: translateY(-1px); box-shadow: 0 10px 24px rgba(189, 177, 132, 0.4); }
        .scan-list-btn:hover { background: rgba(189, 177, 132, 0.12) !important; }
        .scan-logout-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 24px rgba(220, 53, 69, 0.35);
}
      `}</style>

      <video
        ref={videoRef}
        playsInline
        muted
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: isRunning ? "block" : "none",
        }}
      />

      {isRunning && <StatusOverlay status={status} />}

      {showPermissionScreen && <CameraPermissionScreen onRetry={handleStart} />}

      {!isRunning && !showPermissionScreen && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 28,
            textAlign: "center",
            background:
              "linear-gradient(160deg, #f7f6f1 0%, #f2f0e6 45%, #eeece0 100%)",
          }}
        >
          <div className="scan-idle-card" style={cardStyle}>
            <div style={logoWrapStyle}>
              <img
                src="/rafinity.png"
                alt="Rafinity"
                style={{ height: 44, width: "auto", objectFit: "contain" }}
              />
            </div>

            <div>
              <h1 style={greetingStyle}>
                Bonjour {capitalize(user?.prenom)}
              </h1>{" "}
            </div>

            {activeInventory && (
              <div style={inventoryBadgeStyle}>
                📋 Inventaire actif : {activeInventory.label}{" "}
                {activeInventory.inventory_date}
              </div>
            )}

            <p style={descStyle}>
              Filmez vos tickets un par un. Chaque code s'ajoute à la liste avec
              un bip de confirmation
            </p>

            {error && <p style={errorStyle}>{error}</p>}

            <div
              className="scan-action-row"
              style={{ display: "flex", gap: 10, width: "100%" }}
            >
              <button
                className="scan-start-btn"
                onClick={handleStart}
                style={startBtnStyle}
              >
                <CameraIcon size={19} />
                Démarrer le scan
              </button>
              <Link
                to="/video"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  background: "var(--color-bg)",
                  color: "var(--color-text)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 999,
                  padding: "13px 24px",
                  fontSize: 15,
                  fontWeight: 600,
                  textDecoration: "none",
                  width: "100%",
                }}
              >
                🎬 Scanner une vidéo
              </Link>

              <button
                className="scan-list-btn"
                onClick={() => setShowList(true)}
                style={listSideBtnStyle}
              >
                <ListIcon size={19} />
                Voir la liste
                {scans.length > 0 && (
                  <span style={countBadgeStyle}>{scans.length}</span>
                )}
              </button>
            </div>

            <button
              className="scan-logout-btn"
              onClick={logout}
              style={logoutBtnStyle}
            >
              Se déconnecter
            </button>
          </div>
        </div>
      )}

      {isRunning && (
        <div
          style={{
            position: "absolute",
            top: "calc(var(--safe-top) + 12px)",
            right: 12,
          }}
        >
          <div style={counterPillStyle}>
            {scans.length} scanné{scans.length > 1 ? "s" : ""}
          </div>
        </div>
      )}

      {/* {isRunning && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            paddingBottom: "calc(var(--safe-bottom) + 14px)",
            paddingTop: 14,
            paddingLeft: 16,
            paddingRight: 16,
            background:
              "linear-gradient(to top, rgba(0,0,0,0.58), rgba(0,0,0,0))",
            display: "flex",
            gap: 12,
          }}
        >
          <button onClick={stop} style={{ ...bottomBtnStyle, ...stopBtnStyle }}>
            <StopIcon size={20} />
            Arrêter
          </button>
          <button
            onClick={() => setShowList(true)}
            style={{ ...bottomBtnStyle, ...listBtnStyle }}
          >
            <ListIcon size={20} />
            Voir la liste
          </button>
          {status.kind === "too_far_or_blurry" && (
            <button
              onClick={() => void triggerOcr()}
              disabled={ocrInProgress}
              style={{
                ...bottomBtnStyle,
                background: "#2563eb",
                color: "white",
                border: "1px solid rgba(37, 99, 235, 0.4)",
                opacity: ocrInProgress ? 0.7 : 1,
              }}
            >
              OCR manuel
            </button>
          )}
        </div>
      )} */}
      {isRunning && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            paddingBottom: "calc(var(--safe-bottom) + 14px)",
            paddingTop: 14,
            paddingLeft: 16,
            paddingRight: 16,
            background:
              "linear-gradient(to top, rgba(0,0,0,0.58), rgba(0,0,0,0))",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", gap: 12 }}>
            <button
              onClick={stop}
              style={{ ...bottomBtnStyle, ...stopBtnStyle }}
            >
              <StopIcon size={20} />
              Arrêter
            </button>
            <button
              onClick={() => void handleCaptureOcr()}
              disabled={ocrInProgress}
              style={{
                ...bottomBtnStyle,
                background: "#bf1919",
                color: "white",
                border: "1px solid rgba(37, 99, 235, 0.4)",
                opacity: ocrInProgress ? 0.7 : 1,
              }}
            >
              <AiIcon size={20} />
              {ocrInProgress ? "Analyse..." : "OCR"}
            </button>
          </div>

          <button
            onClick={() => setShowList(true)}
            style={{ ...bottomBtnStyle, ...listBtnStyle, width: "100%" }}
          >
            <ListIcon size={20} />
            Voir la liste
          </button>
        </div>
      )}

      {ocrPreviewUrl && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(7, 12, 23, 0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            zIndex: 30,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              background: "#fff",
              borderRadius: 20,
              padding: 18,
              boxShadow: "0 18px 50px rgba(0,0,0,0.22)",
            }}
          >
            <p style={{ margin: "0 0 6px", fontWeight: 800, color: "#1f2937" }}>
              Prévisualisation du ticket
            </p>
            <p
              style={{
                margin: "0 0 12px",
                color: "#6b7280",
                fontSize: 14,
                lineHeight: 1.5,
              }}
            >
              Vérifiez l’image, puis validez pour lancer l’analyse OCR.
            </p>
            <img
              src={ocrPreviewUrl}
              alt="Prévisualisation OCR"
              style={{
                width: "100%",
                height: "auto",
                maxHeight: 320,
                objectFit: "contain",
                borderRadius: 14,
                background: "#f3f4f6",
              }}
            />
            {ocrError && (
              <p
                style={{
                  margin: "12px 0 0",
                  color: "#b91c1c",
                  fontSize: 13.5,
                  background: "#fef2f2",
                  padding: "8px 10px",
                  borderRadius: 10,
                }}
              >
                {ocrError}
              </p>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button
                onClick={handleDismissOcrPreview}
                style={{
                  flex: 1,
                  padding: "11px 12px",
                  borderRadius: 12,
                  border: "1px solid #d1d5db",
                  background: "#fff",
                  color: "#374151",
                  fontWeight: 700,
                }}
              >
                Reprendre
              </button>
              <button
                onClick={() => void handleValidateOcr()}
                disabled={ocrInProgress}
                style={{
                  flex: 1,
                  padding: "11px 12px",
                  borderRadius: 12,
                  border: "none",
                  background: "#1d4ed8",
                  color: "#fff",
                  fontWeight: 700,
                  opacity: ocrInProgress ? 0.7 : 1,
                }}
              >
                {ocrInProgress ? "Analyse..." : "Valider"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showList && (
        <ScanList
          scans={scans}
          onClose={() => setShowList(false)}
          onManualAdd={addManualCode}
          onDelete={deleteScanById}
          activeInventory={activeInventory}
        />
      )}
    </div>
  );
}

const cardStyle = {
  padding: "36px 32px",
  maxWidth: 420,
  width: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 16,
  background: "#ffffff",
  borderRadius: 24,
  boxShadow:
    "0 20px 50px rgba(80, 74, 45, 0.12), 0 2px 8px rgba(80, 74, 45, 0.06)",
  border: "1px solid rgba(189, 177, 132, 0.18)",
  boxSizing: "border-box",
} as const;

const logoWrapStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
} as const;

const pillStyle = {
  display: "inline-block",
  fontSize: 12.5,
  fontWeight: 700,
  color: "#8a7f52",
  background: "rgba(189, 177, 132, 0.16)",
  padding: "5px 12px",
  borderRadius: 999,
  letterSpacing: 0.2,
} as const;

const greetingStyle = {
  fontSize: 22,
  margin: "10px 0 0",
  fontWeight: 800,
  color: "#2b2a22",
} as const;

const inventoryBadgeStyle = {
  width: "100%",
  boxSizing: "border-box",
  background:
    "linear-gradient(135deg, rgba(189, 177, 132, 0.16), rgba(207, 196, 153, 0.14))",
  border: "1px solid rgba(189, 177, 132, 0.28)",
  borderRadius: 14,
  padding: "10px 12px",
  fontSize: 13.5,
  color: "#6b6242",
  fontWeight: 700,
} as const;

const descStyle = {
  color: "#8b8574",
  fontSize: 14.5,
  lineHeight: 1.6,
  margin: 0,
} as const;

const errorStyle = {
  color: "#c0564f",
  fontSize: 13.5,
  background: "#fdf2f1",
  padding: "10px 14px",
  borderRadius: 12,
  margin: 0,
  border: "1px solid rgba(192, 86, 79, 0.22)",
  width: "100%",
  boxSizing: "border-box",
} as const;

const startBtnStyle = {
  flex: 1.4,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "13px 14px",
  fontSize: 15,
  fontWeight: 700,
  color: "#2b2a22",
  background: "linear-gradient(135deg, #bdb184, #cfc499)",
  border: "none",
  borderRadius: 12,
  cursor: "pointer",
  boxShadow: "0 8px 20px rgba(189, 177, 132, 0.35)",
  transition: "transform 0.15s ease, box-shadow 0.15s ease",
} as const;

const listSideBtnStyle = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  padding: "13px 12px",
  fontSize: 14.5,
  fontWeight: 700,
  color: "#6b6242",
  background: "#ffffff",
  border: "1.5px solid rgba(189, 177, 132, 0.35)",
  borderRadius: 12,
  cursor: "pointer",
  transition: "background 0.15s ease",
  position: "relative",
} as const;

const countBadgeStyle = {
  background: "#bdb184",
  color: "#fff",
  fontSize: 11,
  fontWeight: 800,
  borderRadius: 999,
  minWidth: 18,
  height: 18,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 5px",
} as const;

const logoutBtnStyle = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "13px 18px",
  marginTop: 6,
  fontSize: 15,
  fontWeight: 700,
  color: "#ffffff",
  background: "linear-gradient(135deg, #dc3545, #c82333)",
  border: "none",
  borderRadius: 12,
  cursor: "pointer",
  boxShadow: "0 8px 20px rgba(220, 53, 69, 0.28)",
  transition: "transform 0.15s ease, box-shadow 0.15s ease",
} as const;

const bottomBtnStyle = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  border: "none",
  borderRadius: 999,
  padding: "15px 10px",
  fontSize: 15,
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
} as const;

const stopBtnStyle = {
  background: "rgba(255,255,255,0.94)",
  color: "var(--color-danger)",
} as const;

const listBtnStyle = {
  background: "linear-gradient(135deg, #bdb184 0%, #a89968 100%)",
  color: "white",
} as const;

const counterPillStyle = {
  background: "rgba(255,255,255,0.94)",
  color: "var(--color-text)",
  padding: "8px 14px",
  borderRadius: 999,
  fontSize: 13.5,
  fontWeight: 700,
  boxShadow: "0 10px 28px rgba(0,0,0,0.16)",
} as const;
