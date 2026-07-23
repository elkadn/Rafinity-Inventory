/**
 * Single source of truth for the "aiming zone" (the guide frame the user
 * sees on screen). Used both by StatusOverlay (visual frame) and
 * useBarcodeScanner (sharpness sampling, OCR crop, and deciding whether a
 * detection "counts" as targeting what the user is aiming at) - keeping
 * these in sync means what the user sees IS what gets analyzed.
 */
export const ROI = {
  xFrac: 0.08,
  yFrac: 0.26,
  wFrac: 0.84,
  hFrac: 0.3,
};

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** ROI in pixel coordinates for a canvas/frame of the given size. */
export function roiInPixels(frameWidth: number, frameHeight: number): Box {
  return {
    x: frameWidth * ROI.xFrac,
    y: frameHeight * ROI.yFrac,
    width: frameWidth * ROI.wFrac,
    height: frameHeight * ROI.hFrac,
  };
}

/** True if the center of `box` falls inside `roi` - used to decide whether
 * a detected barcode is "the one the user is aiming at" rather than some
 * other ticket elsewhere in frame. */
export function centerInsideRoi(box: Box, roi: Box): boolean {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return cx >= roi.x && cx <= roi.x + roi.width && cy >= roi.y && cy <= roi.y + roi.height;
}
