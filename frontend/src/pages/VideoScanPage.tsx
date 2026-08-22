import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  createVideoJobs,
  listVideoJobs,
  type VideoExtractionResponse,
  type VideoJob,
} from "../lib/api";
import { useCamera } from "../hooks/useCamera";
import {
  BarcodeIcon,
  CameraIcon,
  DownloadIcon,
  StopIcon,
} from "../components/icons";
import { ArrowLeft } from "lucide-react";

const MAX_RECORDING_SECONDS = 60;

type Phase =
  | { kind: "idle" }
  | { kind: "selected"; file: File }
  | { kind: "uploading"; phase: string }
  | { kind: "done"; result: VideoExtractionResponse }
  | { kind: "error"; message: string };

function toCsv(result: VideoExtractionResponse): string {
  const header = "code,frames_detectes,statut,date_inventaire\n";
  const rows = result.codes_found.map((c) =>
    [
      c.code,
      c.frame_hits,
      c.added ? "ajoute" : "deja_existant",
      result.inventory_date,
    ].join(","),
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

async function saveVideoToPhone(file: File): Promise<void> {
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: "Vidéo des articles" });
    return;
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function VideoScanPage() {
  const { token, user } = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [cameraOpen, setCameraOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchJobs, setBatchJobs] = useState<VideoJob[]>([]);
  const [batchSending, setBatchSending] = useState(false);
  const [batchUploadPercent, setBatchUploadPercent] = useState<number | null>(
    null,
  );
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const batchInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const {
    videoRef,
    isRunning,
    error: cameraError,
    permissionState,
    start: startCamera,
    stop: stopCamera,
  } = useCamera();

  useEffect(
    () => () => {
      if (recordingTimerRef.current !== null)
        window.clearInterval(recordingTimerRef.current);
      recorderRef.current?.stop();
      stopCamera();
    },
    [stopCamera],
  );

  useEffect(() => {
    if (cameraOpen && !isRunning) void startCamera();
  }, [cameraOpen, isRunning, startCamera]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const jobs = await listVideoJobs(token);
        if (!cancelled) setBatchJobs(jobs);
      } catch {
        // The batch panel remains optional if the API is temporarily unavailable.
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [token]);

  const handleOpenCamera = () => {
    setCameraOpen(true);
  };

  const handleCloseCamera = () => {
    if (isRecording) stopRecording();
    stopCamera();
    setCameraOpen(false);
  };

  const startRecording = () => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    if (!stream || !isRunning || !window.MediaRecorder) return;

    const mimeType =
      ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(
        (type) => MediaRecorder.isTypeSupported(type),
      ) ?? "";
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 2_500_000,
    });
    recordingChunksRef.current = [];
    recorderRef.current = recorder;
    setRecordingSeconds(0);
    setIsRecording(true);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordingChunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(recordingChunksRef.current, {
        type: recorder.mimeType || "video/webm",
      });
      const extension = recorder.mimeType.includes("mp4") ? "mp4" : "webm";
      const file = new File([blob], `capture-${Date.now()}.${extension}`, {
        type: blob.type,
      });
      setIsRecording(false);
      setRecordingSeconds(0);
      addBatchFiles([file]);
      stopCamera();
      setCameraOpen(false);
      if (
        window.confirm(
          "Voulez-vous enregistrer cette vidéo sur votre téléphone ?",
        )
      ) {
        void saveVideoToPhone(file).catch(() => {
          // The video remains available for analysis if saving is cancelled.
        });
      }
    };
    recorder.start(1000);
    recordingTimerRef.current = window.setInterval(() => {
      setRecordingSeconds((seconds) => {
        if (seconds + 1 >= MAX_RECORDING_SECONDS) {
          recorder.stop();
          if (recordingTimerRef.current !== null)
            window.clearInterval(recordingTimerRef.current);
        }
        return seconds + 1;
      });
    }, 1000);
  };

  function stopRecording() {
    if (recordingTimerRef.current !== null)
      window.clearInterval(recordingTimerRef.current);
    recordingTimerRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  const handleReset = () => {
    if (isRecording) stopRecording();
    stopCamera();
    setCameraOpen(false);
    setPhase({ kind: "idle" });
  };

  const fileKey = (file: File) =>
    `${file.name}:${file.size}:${file.lastModified}`;

  const addBatchFiles = (files: File[]) => {
    setBatchFiles((current) => {
      const keys = new Set(current.map(fileKey));
      return [
        ...current,
        ...files.filter((file) => {
          const key = fileKey(file);
          if (keys.has(key)) return false;
          keys.add(key);
          return true;
        }),
      ].slice(0, 10);
    });
  };

  const handleBatchUpload = async () => {
    if (!token || batchFiles.length === 0) return;
    setBatchSending(true);
    try {
      const jobs = await createVideoJobs(
        token,
        batchFiles,
        setBatchUploadPercent,
      );
      setBatchJobs((current) => [...jobs, ...current]);
      setBatchFiles([]);
      setBatchUploadPercent(null);
      if (batchInputRef.current) batchInputRef.current.value = "";
    } catch (error) {
      setPhase({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible d'envoyer les vidéos.",
      });
    } finally {
      setBatchSending(false);
      setBatchUploadPercent(null);
    }
  };

  const removeBatchFile = (file: File) => {
    const key = fileKey(file);
    setBatchFiles((current) => current.filter((item) => fileKey(item) !== key));
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--color-bg)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <header
        style={{
          background: "var(--color-surface)",
          borderBottom: "1px solid var(--color-border)",
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BarcodeIcon size={22} />
          <strong>Scan vidéo</strong>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 13.5 }}>
          <Link
            to="/"
            style={{
              color: "var(--color-info)",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "14px",
              fontWeight: 500,
            }}
          >
            <ArrowLeft size={17} strokeWidth={1.8} />
            Retour à l’accueil
          </Link>
          {user?.role === "admin" && (
            <Link to="/admin" style={{ color: "var(--color-info)" }}>
              Admin
            </Link>
          )}
        </div>
      </header>

      <main
        style={{
          flex: 1,
          padding: "20px 16px",
          maxWidth: 620,
          margin: "0 auto",
          width: "100%",
        }}
      >
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ margin: "0 0 6px", fontSize: 22 }}>
            Analyser une vidéo
          </h1>
          <p
            style={{
              margin: 0,
              color: "var(--color-text-muted)",
              fontSize: 14,
            }}
          >
            Importez une vidéo ou filmez directement vos articles.
          </p>
        </div>

        {phase.kind === "idle" && !cameraOpen && (
          <div
            style={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 14,
              padding: 14,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                marginBottom: 10,
              }}
            >
              <strong style={{ fontSize: 14 }}>
                Traitement en arrière-plan
              </strong>
              <span style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
                Jusqu'à 10 vidéos
              </span>
            </div>
            <input
              ref={batchInputRef}
              type="file"
              multiple
              accept="video/mp4,video/quicktime,video/x-msvideo,video/webm,video/x-matroska,video/x-m4v"
              onChange={(event) =>
                addBatchFiles(Array.from(event.target.files ?? []))
              }
              style={{ display: "none" }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                type="button"
                onClick={() => batchInputRef.current?.click()}
                style={{ ...secondaryBtnStyle, width: "100%" }}
              >
                Choisir plusieurs vidéos
              </button>
              {batchFiles.length > 0 && (
                <button
                  type="button"
                  onClick={() => void handleBatchUpload()}
                  disabled={batchSending}
                  style={{ ...primaryBtnStyle, width: "100%" }}
                >
                  {batchSending
                    ? `Envoi ${batchUploadPercent ?? 0}%…`
                    : `Envoyer ${batchFiles.length} vidéo${batchFiles.length > 1 ? "s" : ""}`}
                </button>
              )}
              {phase.kind === "idle" && !cameraOpen && (
                <button
                  type="button"
                  onClick={handleOpenCamera}
                  style={{ ...modeBtnStyle, width: "100%", marginBottom: 16 }}
                >
                  <CameraIcon size={19} /> Filmer une vidéo
                </button>
              )}
            </div>

            {batchFiles.length > 0 && (
              <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
                {batchFiles.map((file) => (
                  <div
                    key={fileKey(file)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      fontSize: 12.5,
                    }}
                  >
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {file.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeBatchFile(file)}
                      style={removeFileBtnStyle}
                    >
                      Retirer
                    </button>
                  </div>
                ))}
              </div>
            )}
            {batchJobs.length > 0 && (
              <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
                {batchJobs.slice(0, 5).map((job) => (
                  <div
                    key={job.id}
                    role={job.status === "completed" ? "button" : undefined}
                    tabIndex={job.status === "completed" ? 0 : undefined}
                    onClick={() =>
                      job.status === "completed" &&
                      setExpandedJobId((current) =>
                        current === job.id ? null : job.id,
                      )
                    }
                    onKeyDown={(event) => {
                      if (
                        job.status === "completed" &&
                        (event.key === "Enter" || event.key === " ")
                      ) {
                        event.preventDefault();
                        setExpandedJobId((current) =>
                          current === job.id ? null : job.id,
                        );
                      }
                    }}
                    style={{
                      padding: "7px 0",
                      borderTop: "1px solid var(--color-border)",
                      fontSize: 12.5,
                      cursor:
                        job.status === "completed" ? "pointer" : "default",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                      }}
                    >
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {job.filename}
                      </span>
                      <strong
                        style={{
                          color:
                            job.status === "failed"
                              ? "var(--color-danger)"
                              : job.status === "completed"
                                ? "var(--color-primary-dark)"
                                : "var(--color-info)",
                        }}
                      >
                        {job.status === "completed"
                          ? "Terminé"
                          : job.status === "failed"
                            ? "Erreur"
                            : "En cours"}
                      </strong>
                    </div>
                    {job.status === "completed" && job.result && (
                      <div
                        style={{
                          color: "var(--color-text-muted)",
                          marginTop: 3,
                        }}
                      >
                        {job.result.codes_found.length} code
                        {job.result.codes_found.length > 1 ? "s" : ""} détecté
                        {job.result.codes_found.length > 1 ? "s" : ""}
                      </div>
                    )}
                    {expandedJobId === job.id && job.result && (
                      <div
                        style={{
                          marginTop: 8,
                          padding: "8px 10px",
                          background: "var(--color-bg)",
                          borderRadius: 8,
                          cursor: "default",
                        }}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {job.result.codes_found.length === 0 ? (
                          <span style={{ color: "var(--color-text-muted)" }}>
                            Aucun code détecté.
                          </span>
                        ) : (
                          <div style={{ display: "grid", gap: 5 }}>
                            {job.result.codes_found.map((code) => (
                              <div
                                key={code.code}
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  gap: 10,
                                }}
                              >
                                <strong>{code.code}</strong>
                                <span
                                  style={{
                                    color: code.added
                                      ? "var(--color-primary-dark)"
                                      : "var(--color-warning)",
                                  }}
                                >
                                  {code.added ? "Ajouté" : "Existant"}
                                </span>
                              </div>
                            ))}
                            <div
                              style={{
                                borderTop: "1px solid var(--color-border)",
                                paddingTop: 5,
                                color: "var(--color-text-muted)",
                              }}
                            >
                              {job.result.total_added} ajouté
                              {job.result.total_added > 1 ? "s" : ""} ·{" "}
                              {job.result.total_duplicates} déjà existant
                              {job.result.total_duplicates > 1 ? "s" : ""}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {cameraOpen && (phase.kind === "idle" || phase.kind === "selected") && (
          <div
            style={{
              background: "#101418",
              borderRadius: 16,
              overflow: "hidden",
              marginBottom: 16,
            }}
          >
            <div
              style={{
                position: "relative",
                aspectRatio: "16 / 10",
                background: "#050607",
              }}
            >
              <video
                ref={videoRef}
                muted
                playsInline
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              {isRecording && (
                <div
                  style={{
                    position: "absolute",
                    top: 12,
                    left: 12,
                    color: "white",
                    background: "rgba(180,30,30,.88)",
                    borderRadius: 999,
                    padding: "6px 10px",
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  REC {recordingSeconds}s / {MAX_RECORDING_SECONDS}s
                </div>
              )}
            </div>
            <div style={{ padding: 14, color: "white" }}>
              {cameraError || permissionState === "denied" ? (
                <div
                  style={{ color: "#fecaca", fontSize: 13, marginBottom: 10 }}
                >
                  {cameraError ??
                    "Autorisez la caméra dans votre navigateur puis réessayez."}
                </div>
              ) : (
                <div
                  style={{ color: "#cbd5e1", fontSize: 13, marginBottom: 10 }}
                >
                  Filmez lentement les codes-barres à 20–40 cm.
                </div>
              )}
              <div style={{ display: "flex", gap: 10 }}>
                {!isRecording ? (
                  <button
                    type="button"
                    onClick={startRecording}
                    disabled={!isRunning}
                    style={recordBtnStyle}
                  >
                    <CameraIcon size={18} /> Démarrer la capture
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopRecording}
                    style={recordBtnStyle}
                  >
                    <StopIcon size={18} /> Arrêter et utiliser la vidéo
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCloseCamera}
                  style={cameraCancelBtnStyle}
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Processing spinner */}
        {phase.kind === "uploading" && (
          <div
            style={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 16,
              padding: "36px 20px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                border: "4px solid var(--color-border)",
                borderTopColor: "var(--color-primary)",
                borderRadius: "50%",
                margin: "0 auto 16px",
                animation: "spin 1s linear infinite",
              }}
            />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{phase.phase}</div>
            <div
              style={{
                fontSize: 13,
                color: "var(--color-text-muted)",
                marginTop: 6,
              }}
            >
              Analyse en cours — cela peut prendre quelques secondes…
            </div>
          </div>
        )}

        {/* Error */}
        {phase.kind === "error" && (
          <div
            style={{
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 14,
              padding: 20,
            }}
          >
            <div
              style={{
                fontWeight: 700,
                color: "var(--color-danger)",
                marginBottom: 8,
              }}
            >
              Erreur
            </div>
            <div style={{ fontSize: 14, color: "#991b1b", marginBottom: 14 }}>
              {phase.message}
            </div>
            <button onClick={handleReset} style={primaryBtnStyle}>
              Réessayer
            </button>
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
function ResultsView({
  result,
  onReset,
}: {
  result: VideoExtractionResponse;
  onReset: () => void;
}) {
  const [showDuplicates, setShowDuplicates] = useState(true);
  const added = result.codes_found.filter((c) => c.added);
  const duplicates = result.codes_found.filter((c) => !c.added);
  const displayed = showDuplicates ? result.codes_found : added;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 5px", fontSize: 20 }}>
          Résultat de l'analyse
        </h2>
        <p
          style={{ margin: 0, color: "var(--color-text-muted)", fontSize: 14 }}
        >
          {result.codes_found.length} code
          {result.codes_found.length > 1 ? "s" : ""} détecté
          {result.codes_found.length > 1 ? "s" : ""}.
        </p>
      </div>

      {/* Actions */}
      <div
        style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}
      >
        <button
          onClick={() =>
            download(`video-scans-${Date.now()}.csv`, toCsv(result), "text/csv")
          }
          disabled={result.codes_found.length === 0}
          style={primaryBtnStyle}
        >
          <DownloadIcon size={16} /> Export CSV
        </button>
        {duplicates.length > 0 && (
          <button
            onClick={() => setShowDuplicates((v) => !v)}
            style={secondaryBtnStyle}
          >
            {showDuplicates
              ? "Masquer les doublons"
              : `Afficher tout (${result.codes_found.length})`}
          </button>
        )}
        <button onClick={onReset} style={secondaryBtnStyle}>
          Nouvelle vidéo
        </button>
      </div>

      {/* No results guidance */}
      {result.codes_found.length === 0 && (
        <div
          style={{
            background: "#fef3c7",
            border: "1px solid #fde68a",
            borderRadius: 14,
            padding: 16,
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            Aucun code détecté
          </div>
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
        <div
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 60px 90px",
              padding: "10px 16px",
              fontSize: 12,
              color: "var(--color-text-muted)",
              fontWeight: 600,
              borderBottom: "1px solid var(--color-border)",
              background: "var(--color-bg)",
            }}
          >
            <div>Code</div>
            <div style={{ textAlign: "center" }}>Frames</div>
            <div style={{ textAlign: "center" }}>Statut</div>
          </div>
          {displayed.map((c, i) => (
            <div
              key={c.code}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 60px 90px",
                padding: "11px 16px",
                fontSize: 14,
                borderBottom:
                  i < displayed.length - 1
                    ? "1px solid var(--color-border)"
                    : "none",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  fontWeight: 600,
                }}
              >
                {c.code}
              </div>
              <div
                style={{
                  textAlign: "center",
                  fontSize: 12.5,
                  color: "var(--color-text-muted)",
                }}
              >
                {c.frame_hits}×
              </div>
              <div style={{ textAlign: "center" }}>
                {c.added ? (
                  <span
                    style={{
                      fontSize: 12,
                      background: "#dcfce7",
                      color: "#166534",
                      padding: "3px 8px",
                      borderRadius: 999,
                      fontWeight: 600,
                    }}
                  >
                    Ajouté
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: 12,
                      background: "#fef3c7",
                      color: "#92400e",
                      padding: "3px 8px",
                      borderRadius: 999,
                    }}
                  >
                    Existant
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {duplicates.length > 0 && !showDuplicates && (
        <div
          style={{
            marginTop: 10,
            fontSize: 13,
            color: "var(--color-text-muted)",
            textAlign: "center",
          }}
        >
          {duplicates.length} code{duplicates.length > 1 ? "s" : ""} déjà dans
          l'inventaire ·{" "}
          <button
            onClick={() => setShowDuplicates(true)}
            style={{
              background: "none",
              border: "none",
              color: "var(--color-info)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Afficher
          </button>
        </div>
      )}
    </div>
  );
}

const primaryBtnStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  background: "var(--color-primary)",
  color: "white",
  border: "none",
  borderRadius: 10,
  padding: "12px 18px",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryBtnStyle: CSSProperties = {
  background: "var(--color-surface)",
  color: "var(--color-text)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  padding: "12px 16px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const modeBtnStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  background: "var(--color-surface)",
  color: "var(--color-text)",
  border: "1px solid var(--color-border)",
  borderRadius: 12,
  padding: "13px 10px",
  fontSize: 13.5,
  fontWeight: 700,
  cursor: "pointer",
};

const recordBtnStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  flex: 1,
  background: "#dc2626",
  color: "white",
  border: "none",
  borderRadius: 10,
  padding: "12px 14px",
  fontSize: 13.5,
  fontWeight: 700,
  cursor: "pointer",
};

const cameraCancelBtnStyle: CSSProperties = {
  background: "transparent",
  color: "#e2e8f0",
  border: "1px solid #475569",
  borderRadius: 10,
  padding: "12px 14px",
  fontSize: 13.5,
  fontWeight: 600,
  cursor: "pointer",
};

const removeFileBtnStyle: CSSProperties = {
  background: "transparent",
  color: "var(--color-danger)",
  border: "none",
  padding: "4px 0",
  fontSize: 12,
  cursor: "pointer",
};
