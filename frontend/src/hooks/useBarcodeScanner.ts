import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { detectBarcodes } from "../lib/barcodeDetector";
import { estimateSharpness } from "../lib/sharpness";
import { beepSuccess, initAudio } from "../lib/beep";
import {
  registerScan,
  ocrFallback,
  myScans,
  deleteScan,
  fetchActiveInventory,
} from "../lib/api";
import type { ActiveInventoryDto } from "../lib/api";
import { todayDateString } from "../lib/date";
import { SeenCodesTracker } from "../lib/scanLock";
import { roiInPixels, centerInsideRoi } from "../lib/roi";
import type { ScanRecord, ScannerStatus, ScanMethod } from "../types";

const TICK_INTERVAL_MS = 150;

const DETECTION_MAX_WIDTH = 720;
const MISS_TICKS_BEFORE_HINT = 5;
const MISS_TICKS_BEFORE_OCR = 18;
const OCR_COOLDOWN_MS = 3000;
const SHARPNESS_BLUR_THRESHOLD = 8;
// Poll the active inventory every 30s so the scanner picks up changes
// made by the admin without requiring a page reload.
const INVENTORY_POLL_INTERVAL_MS = 30_000;
const SUCCESS_FLASH_MS = 2000; // était 900

interface UseBarcodeScannerOptions {
  videoRef: RefObject<HTMLVideoElement>;
  isRunning: boolean;
  token: string | null;
}

export function useBarcodeScanner({
  videoRef,
  isRunning,
  token,
}: UseBarcodeScannerOptions) {
  const [status, setStatus] = useState<ScannerStatus>({ kind: "idle" });
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [activeInventory, setActiveInventory] =
    useState<ActiveInventoryDto | null>(null);
  const [ocrInProgress, setOcrInProgress] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const seenRef = useRef(new SeenCodesTracker());
  const missCountRef = useRef(0);
  const isProcessingRef = useRef(false);
  const lastOcrAttemptRef = useRef(0);
  const ocrInFlightRef = useRef(false);
  const successFlashTimeoutRef = useRef<number | null>(null);
  const activeInventoryRef = useRef<ActiveInventoryDto | null>(null);
  // 1. Augmenter la durée du flash

// 2. Ajouter un ref pour geler le scan pendant le flash
const scanFrozenRef = useRef(false);

  // Keep ref in sync with state so tick() can read without stale closure
  useEffect(() => {
    activeInventoryRef.current = activeInventory;
  }, [activeInventory]);

  // const flashSuccess = useCallback((code: string, method: ScanMethod) => {
  //   beepSuccess();
  //   setStatus({ kind: "success", code, method });
  //   if (successFlashTimeoutRef.current)
  //     window.clearTimeout(successFlashTimeoutRef.current);
  //   successFlashTimeoutRef.current = window.setTimeout(() => {
  //     setStatus({ kind: "scanning" });
  //   }, 900);
  // }, []);

  const flashSuccess = useCallback((code: string, method: ScanMethod) => {
    beepSuccess();
    setStatus({ kind: "success", code, method });
    scanFrozenRef.current = true; // ← geler le scan
    if (successFlashTimeoutRef.current)
      window.clearTimeout(successFlashTimeoutRef.current);
    successFlashTimeoutRef.current = window.setTimeout(() => {
      scanFrozenRef.current = false; // ← reprendre le scan
      setStatus({ kind: "scanning" });
    }, SUCCESS_FLASH_MS);
  }, []);

  const registerNewCode = useCallback(
    async (
      code: string,
      method: ScanMethod,
      confidence: number | null,
    ): Promise<"added" | "duplicate" | "error"> => {
      if (!token) return "error";
      try {
        const result = await registerScan(token, { code, method, confidence });
        if (result.added && result.scan) {
          seenRef.current.markSeen(code);
          setScans((prev) => [
            {
              id: result.scan!.id,
              code: result.scan!.code,
              method: result.scan!.method as ScanMethod,
              confidence: result.scan!.confidence,
              scannedAt: result.scan!.scanned_at * 1000,
            },
            ...prev,
          ]);
          flashSuccess(code, method);
          return "added";
        } else {
          seenRef.current.markSeen(code);
          setStatus({ kind: "already_scanned", code });
          return "duplicate";
        }
      } catch (err) {
        console.error("Failed to register scan:", err);
        return "error";
      }
    },
    [token, flashSuccess],
  );

  const removeLocalScan = useCallback((scanId: string) => {
    setDeletedIds((prev) => new Set([...prev, scanId]));
  }, []);

  const deleteScanById = useCallback(
    async (
      scanId: string,
      code: string,
      reason?: string,
    ): Promise<"deleted" | "error"> => {
      if (!token) return "error";
      try {
        await deleteScan(token, scanId, reason);
        // Remove from seen so the user could theoretically re-scan it
        // (but the backend unique index (user,code,inventory_date) would
        //  block re-adding it unless the admin clears the deletion first)
        removeLocalScan(scanId);
        seenRef.current.unmarkSeen(code);
        return "deleted";
      } catch (err) {
        console.error("Failed to delete scan:", err);
        return "error";
      }
    },
    [token, removeLocalScan],
  );

  const addManualCode = useCallback(
    async (
      rawCode: string,
    ): Promise<"added" | "duplicate" | "error" | "empty"> => {
      const code = rawCode.trim();
      if (!code) return "empty";
      if (seenRef.current.hasSeen(code)) {
        setStatus({ kind: "already_scanned", code });
        return "duplicate";
      }
      return registerNewCode(code, "manuel", null);
    },
    [registerNewCode],
  );
  const hydrate = useCallback(async () => {
    if (!token) return;

    try {
      const inv = await fetchActiveInventory(token);

      setActiveInventory(inv);
      activeInventoryRef.current = inv;
      const date = inv?.inventory_date ?? todayDateString();

      const { scans: existing } = await myScans(token, date);

      seenRef.current.reset();

      existing.forEach((s) => seenRef.current.markSeen(s.code));

      setScans(
        existing.map((s) => ({
          id: s.id,
          code: s.code,
          method: s.method as ScanMethod,
          confidence: s.confidence,
          scannedAt: s.scanned_at * 1000,
        })),
      );
    } catch (e) {
      console.error(e);
    }
  }, [token]);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const runOcrOnImage = useCallback(
    async (blob: Blob): Promise<{ ok: boolean; error?: string }> => {
      if (ocrInFlightRef.current || !token) {
        return { ok: false, error: "Analyse déjà en cours." };
      }
      const now = Date.now();
      if (now - lastOcrAttemptRef.current < OCR_COOLDOWN_MS) {
        return { ok: false, error: "Veuillez patienter un instant." };
      }
      lastOcrAttemptRef.current = now;
      ocrInFlightRef.current = true;
      setStatus({ kind: "ocr" });
      setOcrInProgress(true);
      try {
        const result = await ocrFallback(token, blob);

        if (result.code) {
          if (!seenRef.current.hasSeen(result.code)) {
            missCountRef.current = 0;
            await registerNewCode(result.code, "ocr", result.confidence);
          } else {
            setStatus({ kind: "already_scanned", code: result.code });
          }
          return { ok: true };
        }

        if ((result.blob_count ?? 0) > 1) {
          setStatus({ kind: "too_far_or_blurry" });
          return { ok: true };
        }

        setStatus({ kind: "too_far_or_blurry" });
        return { ok: true };
      } catch (err) {
        console.error("OCR fallback failed:", err);
        setStatus({ kind: "camera_error", message: "Échec de l'analyse OCR" });
        return { ok: false, error: "Échec de l'analyse OCR" };
      } finally {
        ocrInFlightRef.current = false;
        setOcrInProgress(false);
      }
    },
    [token, registerNewCode],
  );

  const captureFrameForOcr = useCallback(async (): Promise<{ blob: Blob | null; previewUrl: string | null }> => {
    const video = videoRef.current;
    if (!video) return { blob: null, previewUrl: null };

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const roi = roiInPixels(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(roi.width);
    canvas.height = Math.round(roi.height);

    const ctx = canvas.getContext("2d");
    if (!ctx) return { blob: null, previewUrl: null };

    ctx.drawImage(video, roi.x, roi.y, roi.width, roi.height, 0, 0, roi.width, roi.height);
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );

    if (!blob) return { blob: null, previewUrl: null };

    return {
      blob,
      previewUrl: URL.createObjectURL(blob),
    };
  }, [videoRef]);

  const tick = useCallback(async () => {
      if (scanFrozenRef.current) return; // ← pause pendant le flash
    const video = videoRef.current;
    if (!video || video.readyState < 2 || isProcessingRef.current) return;
    isProcessingRef.current = true;
    try {
      const canvas = canvasRef.current;
      const scale = Math.min(1, DETECTION_MAX_WIDTH / video.videoWidth);
      const w = Math.round(video.videoWidth * scale);
      const h = Math.round(video.videoHeight * scale);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, w, h);

      const detections = await detectBarcodes(canvas);
      const roi = roiInPixels(w, h);

      let roiHit = false;
      for (const det of detections) {
        if (centerInsideRoi(det.bbox, roi)) roiHit = true;
        if (!seenRef.current.hasSeen(det.value)) {
          await registerNewCode(det.value, "barcode", null);
        } else {
          setStatus({ kind: "already_scanned", code: det.value });
        }
      }

      if (roiHit) {
        missCountRef.current = 0;
        return;
      }

      missCountRef.current += 1;
      if (missCountRef.current >= MISS_TICKS_BEFORE_HINT) {
        const sharpness = estimateSharpness(
          ctx,
          roi.x,
          roi.y,
          roi.width,
          roi.height,
        );
        setStatus({ kind: "too_far_or_blurry" });
      } else {
        setStatus((prev) =>
          prev.kind === "success" ? prev : { kind: "scanning" },
        );
      }
    } finally {
      isProcessingRef.current = false;
    }
  }, [videoRef, registerNewCode]);

  useEffect(() => {
    if (!isRunning || !token) {
      setStatus({ kind: "idle" });
      return;
    }

    initAudio();
    seenRef.current.reset();
    missCountRef.current = 0;
    setDeletedIds(new Set());
    setStatus({ kind: "scanning" });

    // Fetch active inventory + today's scans for this inventory
    (async () => {
      try {
        const inv = await fetchActiveInventory(token);
        setActiveInventory(inv);
        activeInventoryRef.current = inv;
        const date = inv?.inventory_date ?? todayDateString();
        const { scans: existing } = await myScans(token, date);
        setScans(
          existing.map((s) => ({
            id: s.id,
            code: s.code,
            method: s.method as ScanMethod,
            confidence: s.confidence,
            scannedAt: s.scanned_at * 1000,
          })),
        );
        existing.forEach((s) => seenRef.current.markSeen(s.code));
      } catch (err) {
        console.error("Failed to hydrate:", err);
      }
    })();

    // Poll active inventory periodically
    const invPoll = window.setInterval(async () => {
      try {
        const inv = await fetchActiveInventory(token!);
        if (
          inv?.inventory_date !== activeInventoryRef.current?.inventory_date
        ) {
          setActiveInventory(inv);
          activeInventoryRef.current = inv;
          // Reset seen codes for the new inventory
          seenRef.current.reset(); // ← vider les anciens codes
          setScans([]); // ← vider la liste visible
          setDeletedIds(new Set());

          const date = inv?.inventory_date ?? todayDateString();
          const { scans: existing } = await myScans(token!, date);
          setScans(
            existing.map((s) => ({
              id: s.id,
              code: s.code,
              method: s.method as ScanMethod,
              confidence: s.confidence,
              scannedAt: s.scanned_at * 1000,
            })),
          );
          existing.forEach((s) => seenRef.current.markSeen(s.code));
        }
      } catch {
        /* ignore poll errors */
      }
    }, INVENTORY_POLL_INTERVAL_MS);

    const interval = window.setInterval(() => {
      void tick();
    }, TICK_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      window.clearInterval(invPoll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, token]);

  // Filter out deleted scans from the visible list
  const visibleScans = scans.filter((s) => !deletedIds.has(s.id));

  const triggerOcr = useCallback(async () => {
    const { blob } = await captureFrameForOcr();
    if (!blob) return;
    await runOcrOnImage(blob);
  }, [captureFrameForOcr, runOcrOnImage]);

  return {
    status,
    scans: visibleScans,
    addManualCode,
    deleteScanById,
    activeInventory,
    triggerOcr,
    ocrInProgress,
    captureFrameForOcr,
    runOcrOnImage,
  };
}
