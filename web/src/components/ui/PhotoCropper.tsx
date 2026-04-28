'use client';

import { Check, RotateCcw, X } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCallback, useState, type ComponentType } from 'react';
import type { Area, Point } from 'react-easy-crop';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

// react-easy-crop touches `window` and `Image` at module load,
// so dynamically import it to avoid SSR issues.
type CropperComponent = ComponentType<{
  image: string;
  crop: Point;
  zoom: number;
  rotation: number;
  aspect: number;
  onCropChange: (p: Point) => void;
  onZoomChange: (z: number) => void;
  onRotationChange?: (r: number) => void;
  onCropComplete: (area: Area, areaPixels: Area) => void;
}>;
const Cropper = dynamic(() => import('react-easy-crop'), { ssr: false }) as CropperComponent;

export interface PhotoCropperProps {
  /** Image source (URL or object URL). */
  src: string;
  /** Crop area aspect ratio. Defaults to 4/3 — best for marketplace cards. */
  aspect?: number;
  /** Called with the cropped JPEG blob (quality 0.85). */
  onSave: (blob: Blob) => void;
  /** Called when the user dismisses the modal without saving. */
  onCancel: () => void;
}

const DEFAULT_ASPECT = 4 / 3;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const MIN_ROTATION = -180;
const MAX_ROTATION = 180;
const JPEG_QUALITY = 0.85;

/**
 * Modal cropper for listing photos.
 * - Drag inside the frame to pan, scroll/pinch to zoom.
 * - Sliders adjust rotation (-180°..180°) and zoom (1×..3×).
 * - "Save" exports the cropped region as a JPEG blob.
 *
 * Renders full-screen on small viewports — sellers crop on phones.
 */
export function PhotoCropper({ src, aspect, onSave, onCancel }: PhotoCropperProps) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finalAspect = aspect ?? DEFAULT_ASPECT;

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  function reset() {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
  }

  async function handleSave() {
    if (!croppedAreaPixels) return;
    setSaving(true);
    setError(null);
    try {
      const blob = await renderCroppedJpeg(src, croppedAreaPixels, rotation);
      onSave(blob);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to crop photo';
      setError(message);
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crop photo"
      className="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-sm"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="text-base font-semibold text-zinc-100">Crop photo</h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          aria-label="Close cropper"
          className="text-zinc-300 hover:text-zinc-100"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </Button>
      </div>

      {/* Cropper canvas */}
      <div className="relative flex-1 overflow-hidden">
        <Cropper
          image={src}
          crop={crop}
          zoom={zoom}
          rotation={rotation}
          aspect={finalAspect}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onRotationChange={setRotation}
          onCropComplete={onCropComplete}
        />
      </div>

      {/* Controls */}
      <div className="space-y-4 border-t border-white/10 bg-zinc-950/80 px-4 py-4 sm:px-6">
        <div>
          <div className="mb-1 flex items-center justify-between text-xs font-medium text-zinc-400 uppercase">
            <label htmlFor="cropper-zoom">Zoom</label>
            <span>{zoom.toFixed(2)}×</span>
          </div>
          <Slider
            id="cropper-zoom"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={[zoom]}
            onValueChange={(v) => {
              const next = v[0];
              if (typeof next === 'number') setZoom(next);
            }}
            aria-label="Zoom"
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-xs font-medium text-zinc-400 uppercase">
            <label htmlFor="cropper-rotation">Rotation</label>
            <span>{Math.round(rotation)}°</span>
          </div>
          <Slider
            id="cropper-rotation"
            min={MIN_ROTATION}
            max={MAX_ROTATION}
            step={1}
            value={[rotation]}
            onValueChange={(v) => {
              const next = v[0];
              if (typeof next === 'number') setRotation(next);
            }}
            aria-label="Rotation"
          />
        </div>

        {error ? (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={reset}
            className={cn('min-h-[44px]')}
            aria-label="Reset crop, zoom, and rotation"
          >
            <RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" />
            Reset
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onCancel} className="min-h-[44px]">
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleSave();
              }}
              disabled={saving || !croppedAreaPixels}
              className="min-h-[44px] bg-[var(--brand-gold)] text-black hover:bg-[var(--brand-gold)]/90"
            >
              <Check className="mr-1 h-4 w-4" aria-hidden="true" />
              {saving ? 'Saving…' : 'Save crop'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders the source image into an offscreen canvas at the requested crop
 * + rotation and exports as a JPEG blob.
 *
 * Pulled out of the component so unit tests can stub it without touching
 * the React tree.
 */
export async function renderCroppedJpeg(
  src: string,
  cropPixels: Area,
  rotation: number,
): Promise<Blob> {
  const image = await loadImage(src);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  // We need a square scratch canvas big enough to hold the rotated source.
  const radians = (rotation * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  const safeArea = 2 * Math.max(image.width, image.height);

  canvas.width = safeArea;
  canvas.height = safeArea;
  ctx.translate(safeArea / 2, safeArea / 2);
  ctx.rotate(radians);
  ctx.translate(-image.width / 2, -image.height / 2);
  ctx.drawImage(image, 0, 0);

  const data = ctx.getImageData(0, 0, safeArea, safeArea);
  canvas.width = Math.max(1, Math.round(cropPixels.width));
  canvas.height = Math.max(1, Math.round(cropPixels.height));

  ctx.putImageData(
    data,
    Math.round(0 - safeArea / 2 + image.width * 0.5 - cropPixels.x),
    Math.round(0 - safeArea / 2 + image.height * 0.5 - cropPixels.y),
  );

  // Apply rotated bounding box clamp so we don't crash on extreme angles.
  if (rotation !== 0) {
    canvas.width = Math.ceil(cropPixels.width * (cos + sin));
    canvas.height = Math.ceil(cropPixels.height * (cos + sin));
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to encode JPEG'));
          return;
        }
        resolve(blob);
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      resolve(img);
    };
    img.onerror = () => {
      reject(new Error('Failed to load image'));
    };
    img.src = src;
  });
}
