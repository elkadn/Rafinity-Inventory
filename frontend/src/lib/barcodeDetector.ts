import { BarcodeDetector } from "barcode-detector/ponyfill";

export interface DetectedCode {
  value: string;
  bbox: { x: number; y: number; width: number; height: number };
  format: string;
}

// The ponyfill always uses its own zxing-wasm implementation rather than
// branching on native browser support. That's a deliberate choice here:
// native BarcodeDetector behavior differs subtly across Chrome/Android
// versions, and for a reliability-first scanning app we want the exact
// same decoding behavior on every device.
//
// Format list: the sample tickets use 1D symbologies (looked like Code128).
// The extra common retail formats are included as a safety net in case some
// tickets use a different symbology - decoding against a few formats has a
// negligible speed cost, unlike OCR.
const FORMATS = [
  "code_128",
  "code_39",
  "code_93",
  "codabar",
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "itf",
] as const;

let detectorInstance: BarcodeDetector | null = null;

function getDetector(): BarcodeDetector {
  if (!detectorInstance) {
    detectorInstance = new BarcodeDetector({ formats: [...FORMATS] });
  }
  return detectorInstance;
}

/**
 * Runs barcode detection on a canvas (or ImageBitmap/HTMLVideoElement).
 * Returns an empty array (never throws) if nothing is found or decoding
 * fails, so callers can treat "no result" uniformly.
 */
export async function detectBarcodes(
  source: HTMLCanvasElement | ImageBitmap
): Promise<DetectedCode[]> {
  try {
    const detector = getDetector();
    const results = await detector.detect(source as any);
    return results.map((r) => ({
      value: r.rawValue,
      bbox: {
        x: r.boundingBox.x,
        y: r.boundingBox.y,
        width: r.boundingBox.width,
        height: r.boundingBox.height,
      },
      format: r.format,
    }));
  } catch (err) {
    // A decode error on one frame should never crash the scanning loop -
    // just treat it as "nothing found" and let the next frame retry.
    console.warn("Barcode detection error (ignored, will retry):", err);
    return [];
  }
}
