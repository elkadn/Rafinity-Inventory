import { useCallback, useEffect, useRef, useState } from "react";

export type CameraPermissionState = "unknown" | "granted" | "denied" | "prompt";

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionState, setPermissionState] = useState<CameraPermissionState>("unknown");

  // Proactively check permission state where the browser supports it
  // (mainly Chrome/Android) so the UI can show the "camera blocked" screen
  // even before the user taps "Démarrer" a second time. Safari (iOS) does
  // not support querying the 'camera' permission name - for that case we
  // fall back to detecting the NotAllowedError from getUserMedia itself,
  // in start() below.
  useEffect(() => {
    if (!navigator.permissions?.query) return;
    let status: PermissionStatus | null = null;

    navigator.permissions
      .query({ name: "camera" as PermissionName })
      .then((result) => {
        status = result;
        setPermissionState(result.state as CameraPermissionState);
        result.onchange = () => setPermissionState(result.state as CameraPermissionState);
      })
      .catch(() => {
        // Not supported on this browser - stays "unknown", handled reactively
        // via getUserMedia's own error below.
      });

    return () => {
      if (status) status.onchange = null;
    };
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsRunning(true);
      setPermissionState("granted");
    } catch (err) {
      console.error("Camera access failed:", err);
      setIsRunning(false);
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setPermissionState("denied");
        setError(null); // the dedicated permission screen handles this case
      } else {
        setError("Impossible d'accéder à la caméra sur cet appareil.");
      }
    }
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsRunning(false);
  }, []);

  return { videoRef, isRunning, error, permissionState, start, stop };
}
