/**
 * Cheap sharpness/edge-content estimate for a region of a canvas, used only
 * to decide which hint to show the user when the barcode detector isn't
 * finding anything ("stabilisez" vs "rapprochez-vous"). This is
 * deliberately NOT a full Laplacian convolution (too slow to run every
 * frame on a phone) - it subsamples a grid of pixels and sums absolute
 * differences between horizontal neighbors, which is a good enough proxy
 * for "is there sharp edge content in this region right now".
 */
export function estimateSharpness(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  sampleStep = 4
): number {
  const { data } = ctx.getImageData(x, y, w, h);
  const stride = w * 4;

  let total = 0;
  let count = 0;

  for (let row = 0; row < h; row += sampleStep) {
    for (let col = 0; col < w - sampleStep; col += sampleStep) {
      const i1 = row * stride + col * 4;
      const i2 = row * stride + (col + sampleStep) * 4;

      const g1 = data[i1] * 0.299 + data[i1 + 1] * 0.587 + data[i1 + 2] * 0.114;
      const g2 = data[i2] * 0.299 + data[i2 + 1] * 0.587 + data[i2 + 2] * 0.114;

      total += Math.abs(g1 - g2);
      count += 1;
    }
  }

  return count > 0 ? total / count : 0;
}
