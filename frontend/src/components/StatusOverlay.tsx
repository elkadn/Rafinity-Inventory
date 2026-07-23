import { AlertIcon, CheckCircleIcon, InfoIcon, SearchIcon } from "./icons";
import { ROI } from "../lib/roi";
import type { ScannerStatus } from "../types";

interface Props {
  status: ScannerStatus;
}

interface StatusStyle {
  frameColor: string;
  pillBg: string;
  pillText: string;
  icon: (props: { size?: number }) => JSX.Element;
  label: (s: ScannerStatus) => string;
}

const NEUTRAL: StatusStyle = {
  frameColor: "#d1d5db",
  pillBg: "#ffffff",
  pillText: "#4b5563",
  icon: SearchIcon,
  label: () => "Recherche du ticket…",
};

const STYLES: Record<ScannerStatus["kind"], StatusStyle> = {
  idle: NEUTRAL,
  scanning: NEUTRAL,
  too_far_or_blurry: {
    frameColor: "#d97706",
    pillBg: "#fffbeb",
    pillText: "#92400e",
    icon: AlertIcon,
    label: () => "Rapprochez-vous du ticket",
  },
  success: {
    frameColor: "#16a34a",
    pillBg: "#f0fdf4",
    pillText: "#166534",
    icon: CheckCircleIcon,
    label: (s) => (s.kind === "success" ? `Code lu : ${s.code}` : ""),
  },
  already_scanned: {
    frameColor: "#2563eb",
    pillBg: "#eff6ff",
    pillText: "#1e40af",
    icon: InfoIcon,
    label: (s) => (s.kind === "already_scanned" ? `Déjà scanné : ${s.code}` : ""),
  },
  camera_error: {
    frameColor: "#dc2626",
    pillBg: "#fef2f2",
    pillText: "#991b1b",
    icon: AlertIcon,
    label: (s) => (s.kind === "camera_error" ? s.message : "Erreur caméra"),
  },
};

export function StatusOverlay({ status }: Props) {
  if (status.kind === "idle") return null;
  const style = STYLES[status.kind];
  const Icon = style.icon;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {/* Viewfinder guide frame - tells the user where to align the ticket */}
      <div
        style={{
          position: "absolute",
          top: `${ROI.yFrac * 100}%`,
          left: `${ROI.xFrac * 100}%`,
          width: `${ROI.wFrac * 100}%`,
          height: `${ROI.hFrac * 100}%`,
          border: `3px solid ${style.frameColor}`,
          borderRadius: 20,
          boxShadow: `0 0 0 4000px rgba(0,0,0,0.18)`,
          transition: "border-color 150ms ease",
        }}
      />

      {/* Status pill just below the frame */}
      <div
        style={{
          position: "absolute",
          top: `calc(${(ROI.yFrac + ROI.hFrac) * 100}% + 16px)`,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: style.pillBg,
          color: style.pillText,
          padding: "10px 18px",
          borderRadius: 999,
          fontSize: 15,
          fontWeight: 600,
          whiteSpace: "nowrap",
          boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
        }}
      >
        <Icon size={18} />
        {style.label(status)}
      </div>
    </div>
  );
}
