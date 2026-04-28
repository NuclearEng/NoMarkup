import { describe, expect, it } from 'vitest';

import {
  __testing,
  laplacianVariance,
  scoreFromMetrics,
  scorePhotoQuality,
} from '@/lib/photo-quality';

describe('scoreFromMetrics', () => {
  it('returns a perfect score on a clean photo', () => {
    const result = scoreFromMetrics({
      width: 1600,
      height: 1200, // 4:3 aspect
      bytes: 1600 * 1200 * 0.7, // healthy bytes/pixel
      laplacianVariance: 800,
    });
    expect(result.score).toBe(100);
    expect(result.hints).toEqual([]);
  });

  it('penalises small images and surfaces a hint', () => {
    const result = scoreFromMetrics({
      width: 600,
      height: 600,
      bytes: 600 * 600 * 0.7,
    });
    expect(result.score).toBe(80);
    expect(result.hints).toContain(__testing.HINT_SMALL);
  });

  it('penalises overly compressed images', () => {
    const result = scoreFromMetrics({
      width: 1600,
      height: 1200,
      bytes: 100, // way too small
      laplacianVariance: 800,
    });
    expect(result.hints).toContain(__testing.HINT_COMPRESSED);
    expect(result.score).toBe(85);
  });

  it('penalises extreme aspect ratios', () => {
    const result = scoreFromMetrics({
      width: 2400,
      height: 800, // 3:1 — too wide
      bytes: 2400 * 800 * 0.7,
      laplacianVariance: 800,
    });
    expect(result.hints).toContain(__testing.HINT_ASPECT);
    expect(result.score).toBe(90);
  });

  it('penalises blurry photos', () => {
    const result = scoreFromMetrics({
      width: 1600,
      height: 1200,
      bytes: 1600 * 1200 * 0.7,
      laplacianVariance: 50,
    });
    expect(result.hints).toContain(__testing.HINT_BLURRY);
    expect(result.score).toBe(75);
  });

  it('stacks penalties and surfaces the low-overall hint below 40', () => {
    const result = scoreFromMetrics({
      width: 300,
      height: 100, // small + bad aspect (3:1)
      bytes: 1, // compressed
      laplacianVariance: 5, // blurry
    });
    // 100 - 20 - 15 - 10 - 25 = 30, below the 40-low-quality cliff.
    expect(result.score).toBe(30);
    expect(result.hints).toContain(__testing.HINT_LOW_OVERALL);
    expect(result.hints).toContain(__testing.HINT_SMALL);
    expect(result.hints).toContain(__testing.HINT_BLURRY);
    expect(result.hints).toContain(__testing.HINT_COMPRESSED);
    expect(result.hints).toContain(__testing.HINT_ASPECT);
  });

  it('clamps the score floor at zero', () => {
    const result = scoreFromMetrics({
      width: 100,
      height: 50,
      bytes: 1,
      laplacianVariance: 0,
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('skips the blurriness rule when no variance is provided', () => {
    const result = scoreFromMetrics({
      width: 1600,
      height: 1200,
      bytes: 1600 * 1200 * 0.7,
    });
    expect(result.hints).not.toContain(__testing.HINT_BLURRY);
  });
});

describe('laplacianVariance', () => {
  it('returns ~0 on a flat-colour image (no edges)', () => {
    const w = 16;
    const h = 16;
    const data = new Uint8ClampedArray(w * h * 4).fill(128);
    // Reset alpha to 255 for sanity, but it doesn't affect grayscale conversion above.
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    const fakeCanvas = makeFakeCanvas(w, h, data);
    expect(laplacianVariance(fakeCanvas)).toBeLessThan(1);
  });

  it('returns >0 on a checkerboard pattern (high edges)', () => {
    const w = 16;
    const h = 16;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        const dark = (x + y) % 2 === 0;
        const v = dark ? 0 : 255;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    const fakeCanvas = makeFakeCanvas(w, h, data);
    expect(laplacianVariance(fakeCanvas)).toBeGreaterThan(100);
  });

  it('returns +Infinity if the canvas yields no 2d context', () => {
    const broken = {
      width: 4,
      height: 4,
      getContext: () => null,
    };
    expect(laplacianVariance(broken)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('scorePhotoQuality (integration)', () => {
  it('still returns a result when image decoding fails', async () => {
    // Save and stub Image so decoding always fails.
    const OriginalImage = globalThis.Image;
    class FailingImage {
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      set src(_: string) {
        // Simulate async error.
        setTimeout(() => {
          this.onerror?.();
        }, 0);
      }
    }
    // @ts-expect-error — deliberate stub.
    globalThis.Image = FailingImage;
    // jsdom <26 doesn't ship URL.createObjectURL; install a stub if missing.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalCreate = URL.createObjectURL as ((b: Blob) => string) | undefined;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalRevoke = URL.revokeObjectURL as ((u: string) => void) | undefined;
    URL.createObjectURL = () => 'blob:fake';
    URL.revokeObjectURL = () => {};

    try {
      const file = new File(['x'], 'fake.jpg', { type: 'image/jpeg' });
      const result = await scorePhotoQuality(file);
      expect(result.score).toBeLessThan(40);
      expect(result.hints).toContain(__testing.HINT_LOW_OVERALL);
    } finally {
      globalThis.Image = OriginalImage;
      if (originalCreate) URL.createObjectURL = originalCreate;
      else delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
      if (originalRevoke) URL.revokeObjectURL = originalRevoke;
      else delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
    }
  });
});

interface FakeCanvas {
  width: number;
  height: number;
  getContext: (kind: '2d') => {
    getImageData: () => { data: Uint8ClampedArray };
  } | null;
}

function makeFakeCanvas(w: number, h: number, data: Uint8ClampedArray): FakeCanvas {
  return {
    width: w,
    height: h,
    getContext: () => ({
      getImageData: () => ({ data }),
    }),
  };
}
