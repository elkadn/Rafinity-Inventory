import type { CSSProperties } from "react";
import { AlertIcon, CameraIcon } from "./icons";

interface Props {
  onRetry: () => void;
}


export function CameraPermissionScreen({ onRetry }: Props) {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);

  return (
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
        background: "var(--color-bg)",
      }}
    >
      <div
        style={{
          background: "var(--color-surface)",
          borderRadius: 24,
          padding: "32px 26px",
          maxWidth: 380,
          width: "100%",
          boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: 999,
            background: "#fef2f2",
            color: "var(--color-danger)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <AlertIcon size={30} />
        </div>

        <div>
          <h2 style={{ fontSize: 18, margin: "0 0 8px", fontWeight: 700 }}>
            Accès à la caméra bloqué
          </h2>
          <p style={{ color: "var(--color-text-muted)", fontSize: 14, margin: 0, lineHeight: 1.5 }}>
            L'application a besoin de la caméra pour scanner les tickets.
            Autorisez-la depuis les réglages de votre navigateur, puis
            réessayez.
          </p>
        </div>

        <div
          style={{
            background: "var(--color-bg)",
            borderRadius: 14,
            padding: 16,
            textAlign: "left",
            fontSize: 13.5,
            color: "var(--color-text)",
            width: "100%",
          }}
        >
          {isIOS && (
            <>
              <strong>Sur iPhone/iPad (Safari) :</strong>
              <ol style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
                <li>Ouvrez Réglages → Safari → Caméra</li>
                <li>Sélectionnez "Autoriser" pour ce site</li>
                <li>Revenez ici et appuyez sur "Réessayer"</li>
              </ol>
            </>
          )}
          {isAndroid && !isIOS && (
            <>
              <strong>Sur Android (Chrome) :</strong>
              <ol style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
                <li>Appuyez sur l'icône 🔒 ou ⓘ à côté de l'adresse du site</li>
                <li>Ouvrez "Autorisations" → activez "Caméra"</li>
                <li>Revenez ici et appuyez sur "Réessayer"</li>
              </ol>
            </>
          )}
          {!isIOS && !isAndroid && (
            <>
              <strong>Sur ordinateur :</strong>
              <ol style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
                <li>Cliquez sur l'icône 🔒 à côté de l'adresse du site</li>
                <li>Autorisez la caméra pour ce site</li>
                <li>Revenez ici et cliquez sur "Réessayer"</li>
              </ol>
            </>
          )}
        </div>

        <button onClick={onRetry} style={retryBtnStyle}>
          <CameraIcon size={20} />
          Réessayer
        </button>
      </div>
    </div>
  );
}

const retryBtnStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  background: "var(--color-primary)",
  color: "white",
  border: "none",
  borderRadius: 999,
  padding: "14px 26px",
  fontSize: 15,
  fontWeight: 700,
  cursor: "pointer",
  width: "100%",
};
