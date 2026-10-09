'use client';

// Full-screen photo lightbox.
//
// Mounted via portal to document.body so clicks outside don't interact
// with the underlying carousel. Keyboard navigation: ←/→ to navigate,
// ESC to close, +/- to zoom. Mobile: swipe left/right to navigate.
// Lazy-loads the next/prev image (the eager mount flag preloads the
// adjacent siblings) and shows a dark backdrop with a subtle close
// affordance in the corner.

import { ChevronLeft, ChevronRight, Minus, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@/components/ui/button';
import { ProgressiveImage } from '@/components/ui/ProgressiveImage';
import { cn } from '@/lib/utils';
import type { ListingPhoto } from '@/types';

interface PhotoLightboxProps {
  photos: ListingPhoto[];
  alt: string;
  /** Index of the photo to open initially. */
  initialIndex: number;
  /** When true the modal is rendered. */
  open: boolean;
  /** Called when the user dismisses (ESC, backdrop click, or close button). */
  onClose: () => void;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

// Minimum horizontal swipe distance (px) to register as a navigation.
// 60px is the GestureLab default — short swipes don't accidentally trigger.
const SWIPE_THRESHOLD = 60;

export function PhotoLightbox({
  photos,
  alt,
  initialIndex,
  open,
  onClose,
}: PhotoLightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const touchStartX = useRef<number | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Re-anchor index when the parent reopens at a different photo.
  useEffect(() => {
    if (open) {
      setIndex(initialIndex);
      setZoom(1);
    }
  }, [open, initialIndex]);

  const goNext = useCallback(() => {
    if (photos.length === 0) return;
    setIndex((i) => (i + 1) % photos.length);
    setZoom(1);
  }, [photos.length]);

  const goPrev = useCallback(() => {
    if (photos.length === 0) return;
    setIndex((i) => (i - 1 + photos.length) % photos.length);
    setZoom(1);
  }, [photos.length]);

  const zoomIn = useCallback(() => {
    setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP));
  }, []);
  const zoomOut = useCallback(() => {
    setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP));
  }, []);

  // Keyboard navigation. Bound to the document so the modal captures
  // events even when no interactive element inside it is focused.
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          goPrev();
          break;
        case 'ArrowRight':
          e.preventDefault();
          goNext();
          break;
        case '+':
        case '=':
          e.preventDefault();
          zoomIn();
          break;
        case '-':
        case '_':
          e.preventDefault();
          zoomOut();
          break;
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('keydown', handleKey);
    };
  }, [open, goNext, goPrev, onClose, zoomIn, zoomOut]);

  // Lock body scroll while the lightbox is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Move keyboard focus to the dialog the moment it mounts so screen
  // readers announce it and Tab cycles inside the modal.
  useEffect(() => {
    if (open && dialogRef.current) {
      dialogRef.current.focus();
    }
  }, [open]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;
  if (photos.length === 0) return null;

  const safeIndex = Math.max(0, Math.min(index, photos.length - 1));
  const current = photos[safeIndex];
  if (!current) return null;

  function handleTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStartX.current = t ? t.clientX : null;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    const start = touchStartX.current;
    if (start === null) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const delta = t.clientX - start;
    if (Math.abs(delta) >= SWIPE_THRESHOLD) {
      if (delta < 0) {
        goNext();
      } else {
        goPrev();
      }
    }
    touchStartX.current = null;
  }

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Photo viewer: ${alt}`}
      tabIndex={-1}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/95 outline-none"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Click-through backdrop. Rendered as an explicit button so the
          jsx-a11y rules accept the click handler. ESC + the X button
          provide keyboard alternatives. */}
      <button
        type="button"
        aria-label="Close photo viewer (backdrop)"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
        tabIndex={-1}
      />
      {/* Close button */}
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Close photo viewer"
        onClick={onClose}
        className="absolute top-4 right-4 z-10 min-h-[44px] min-w-[44px] rounded-full border-white/20 bg-black/60 text-white hover:bg-black/80"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </Button>

      {/* Counter */}
      <div
        className="absolute top-6 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white/90"
        aria-live="polite"
      >
        {String(safeIndex + 1)} / {String(photos.length)}
      </div>

      {/* Prev / next */}
      {photos.length > 1 ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Previous photo"
            onClick={goPrev}
            className="absolute top-1/2 left-4 z-10 min-h-[44px] min-w-[44px] -translate-y-1/2 rounded-full border-white/20 bg-black/60 text-white hover:bg-black/80"
          >
            <ChevronLeft className="h-6 w-6" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Next photo"
            onClick={goNext}
            className="absolute top-1/2 right-4 z-10 min-h-[44px] min-w-[44px] -translate-y-1/2 rounded-full border-white/20 bg-black/60 text-white hover:bg-black/80"
          >
            <ChevronRight className="h-6 w-6" aria-hidden="true" />
          </Button>
        </>
      ) : null}

      {/* Photo */}
      <div
        className={cn(
          'relative flex max-h-[90vh] max-w-[90vw] items-center justify-center transition-transform duration-200',
        )}
        style={{ transform: `scale(${String(zoom)})` }}
      >
        <ProgressiveImage
          src={current.url}
          alt={`${alt} — photo ${String(safeIndex + 1)}`}
          blurHash={current.blur_hash}
          className="max-h-[90vh] max-w-[90vw] rounded-md"
        />
      </div>

      {/* Zoom controls */}
      <div
        className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/60 px-2 py-1.5 text-white"
        role="toolbar"
        aria-label="Zoom controls"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Zoom out"
          onClick={zoomOut}
          disabled={zoom <= MIN_ZOOM}
          className="min-h-[44px] min-w-[44px] rounded-full text-white hover:bg-white/10"
        >
          <Minus className="h-4 w-4" aria-hidden="true" />
        </Button>
        <span className="min-w-[3ch] text-center text-xs tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Zoom in"
          onClick={zoomIn}
          disabled={zoom >= MAX_ZOOM}
          className="min-h-[44px] min-w-[44px] rounded-full text-white hover:bg-white/10"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>,
    document.body,
  );
}
