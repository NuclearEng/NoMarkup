/**
 * photo-quality.ts — heuristic scoring for listing photos.
 *
 * Returns a score from 0 to 100 plus human-readable hints sellers can act on.
 * Below 40 → "Photo is small or blurry. Tap to retake." (surfaced by callers).
 *
 * The heuristics are deliberately cheap to compute so we can run them on
 * every uploaded photo client-side. Real ML scoring belongs server-side
 * (see fraud/imaging engines in PLAN §6.1) — this is just a fast triage.
 */

export interface QualityResult {
  score: number;
  hints: string[];
}

export interface ScoreInputDimensions {
  width: number;
  height: number;
  bytes: number;
  laplacianVariance?: number;
}

const MIN_DIMENSION_PX = 800;
const MIN_BYTES_PER_PIXEL = 0.5;
const MIN_ASPECT = 0.75;
const MAX_ASPECT = 2.0;
const MIN_LAPLACIAN_VARIANCE = 100;

const PENALTY_SMALL = 20;
const PENALTY_COMPRESSED = 15;
const PENALTY_ASPECT = 10;
const PENALTY_BLURRY = 25;

const HINT_SMALL = 'Small image — at least 1024px on the long side looks better';
const HINT_COMPRESSED = 'Compressed too aggressively';
const HINT_ASPECT = 'Try a 4:3 or square frame';
const HINT_BLURRY = 'Looks blurry — make sure the camera focused';
const HINT_LOW_OVERALL = 'Photo is small or blurry. Tap to retake.';

/**
 * Pure scoring step — deterministic given the same numerical inputs.
 * Exposed for tests so we can hit each rule without touching the DOM.
 */
export function scoreFromMetrics(input: ScoreInputDimensions): QualityResult {
  const { width, height, bytes, laplacianVariance } = input;
  let score = 100;
  const hints: string[] = [];

  if (width < MIN_DIMENSION_PX || height < MIN_DIMENSION_PX) {
    score -= PENALTY_SMALL;
    hints.push(HINT_SMALL);
  }

  const totalPixels = Math.max(1, width * height);
  const bytesPerPixel = bytes / totalPixels;
  if (bytesPerPixel < MIN_BYTES_PER_PIXEL) {
    score -= PENALTY_COMPRESSED;
    hints.push(HINT_COMPRESSED);
  }

  const aspect = width / Math.max(1, height);
  if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) {
    score -= PENALTY_ASPECT;
    hints.push(HINT_ASPECT);
  }

  if (typeof laplacianVariance === 'number' && laplacianVariance < MIN_LAPLACIAN_VARIANCE) {
    score -= PENALTY_BLURRY;
    hints.push(HINT_BLURRY);
  }

  // Clamp.
  if (score < 0) score = 0;
  if (score > 100) score = 100;

  if (score < 40 && !hints.includes(HINT_LOW_OVERALL)) {
    hints.push(HINT_LOW_OVERALL);
  }

  return { score, hints };
}

/**
 * Minimal canvas surface needed for variance-of-Laplacian. Tests can
 * supply a stub that conforms to this without pulling in jsdom canvas.
 */
export interface CanvasLike {
  width: number;
  height: number;
  getContext: (kind: '2d') => {
    getImageData: (
      sx: number,
      sy: number,
      sw: number,
      sh: number,
    ) => { data: Uint8ClampedArray };
  } | null;
}

/**
 * Variance-of-Laplacian blurriness estimator on a downsampled grayscale plane.
 * Higher variance = sharper edges = less blurry.
 *
 * We downsample to ~256px on the long side so this stays under 5ms even for
 * giant phone photos. The constants matter less than the relative ranking
 * across photos: a clean shot will land in the thousands, a motion-blurred
 * shot under 100.
 */
export function laplacianVariance(canvas: CanvasLike): number {
  const ctx = canvas.getContext('2d');
  if (!ctx) return Number.POSITIVE_INFINITY;
  const w = canvas.width;
  const h = canvas.height;
  const { data } = ctx.getImageData(0, 0, w, h);

  // Convert to single grayscale plane.
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const r = data[i * 4] ?? 0;
    const g = data[i * 4 + 1] ?? 0;
    const b = data[i * 4 + 2] ?? 0;
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // 3x3 Laplacian: -1,-1,-1 / -1,8,-1 / -1,-1,-1
  const lap = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const v =
        8 * (gray[i] ?? 0) -
        (gray[i - 1] ?? 0) -
        (gray[i + 1] ?? 0) -
        (gray[i - w] ?? 0) -
        (gray[i + w] ?? 0) -
        (gray[i - w - 1] ?? 0) -
        (gray[i - w + 1] ?? 0) -
        (gray[i + w - 1] ?? 0) -
        (gray[i + w + 1] ?? 0);
      lap[i] = v;
    }
  }

  // Variance = mean of squared deviations.
  let sum = 0;
  let count = 0;
  for (let i = 0; i < lap.length; i += 1) {
    sum += lap[i] ?? 0;
    count += 1;
  }
  const mean = count > 0 ? sum / count : 0;
  let varSum = 0;
  for (let i = 0; i < lap.length; i += 1) {
    const d = (lap[i] ?? 0) - mean;
    varSum += d * d;
  }
  return count > 0 ? varSum / count : 0;
}

/**
 * Loads the file into an offscreen image, downsamples it, computes the
 * Laplacian variance, and feeds everything into scoreFromMetrics.
 *
 * Returns a baseline score on environments without DOM (jsdom node tests):
 * the scoreFromMetrics result without the blurriness penalty applied.
 */
export async function scorePhotoQuality(file: File): Promise<QualityResult> {
  // No DOM (e.g. server-side or non-DOM jsdom config) — fall back to size only.
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return scoreFromMetrics({ width: 0, height: 0, bytes: file.size });
  }

  const url = URL.createObjectURL(file);
  try {
    const dimensions = await loadImageDimensions(url);
    const downsampled = downsampleToCanvas(dimensions.image, 256);
    const variance =
      downsampled !== null ? laplacianVariance(downsampled) : Number.POSITIVE_INFINITY;
    return scoreFromMetrics({
      width: dimensions.width,
      height: dimensions.height,
      bytes: file.size,
      laplacianVariance: variance,
    });
  } catch {
    // If we can't decode the image, give it the benefit of the doubt
    // rather than blocking the seller — but flag as low-quality so they retake.
    return { score: 35, hints: [HINT_LOW_OVERALL] };
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface LoadedImage {
  image: HTMLImageElement;
  width: number;
  height: number;
}

function loadImageDimensions(url: string): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({ image: img, width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      reject(new Error('failed to decode image'));
    };
    img.src = url;
  });
}

function downsampleToCanvas(img: HTMLImageElement, longSide: number): CanvasLike | null {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (w === 0 || h === 0) return null;
  const scale = Math.min(1, longSide / Math.max(w, h));
  const targetW = Math.max(2, Math.round(w * scale));
  const targetH = Math.max(2, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, targetW, targetH);
  // HTMLCanvasElement.getContext returns CanvasRenderingContext2D which is a
  // superset of our minimal CanvasLike contract — safe cast through unknown.
  return canvas as unknown as CanvasLike;
}

export const __testing = {
  HINT_SMALL,
  HINT_COMPRESSED,
  HINT_ASPECT,
  HINT_BLURRY,
  HINT_LOW_OVERALL,
};
