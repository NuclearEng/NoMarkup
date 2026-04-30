'use client';

import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';
import { useCallback, useState } from 'react';

import { PhotoLightbox } from '@/components/marketplace/PhotoLightbox';
import { ProgressiveImage } from '@/components/ui/ProgressiveImage';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ListingPhoto } from '@/types';

interface ListingPhotoCarouselProps {
  photos: ListingPhoto[];
  alt: string;
  className?: string;
}

export function ListingPhotoCarousel({ photos, alt, className }: ListingPhotoCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const openLightbox = useCallback((idx: number) => {
    setActiveIndex(idx);
    setLightboxOpen(true);
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
  }, []);

  const goPrev = useCallback(() => {
    setActiveIndex((i) => (photos.length === 0 ? 0 : (i - 1 + photos.length) % photos.length));
  }, [photos.length]);

  const goNext = useCallback(() => {
    setActiveIndex((i) => (photos.length === 0 ? 0 : (i + 1) % photos.length));
  }, [photos.length]);

  if (photos.length === 0) {
    return (
      <div
        className={cn(
          'flex aspect-[4/3] w-full items-center justify-center rounded-xl border border-dashed border-white/10 bg-zinc-900/40 text-zinc-500',
          className,
        )}
        role="img"
        aria-label="No photos available"
      >
        <ImageOff className="h-12 w-12" aria-hidden="true" />
      </div>
    );
  }

  const currentPhoto = photos[activeIndex] ?? photos[0];
  if (!currentPhoto) return null;

  return (
    <div className={cn('relative', className)}>
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-white/[0.06] bg-zinc-900">
        <button
          type="button"
          onClick={() => {
            openLightbox(activeIndex);
          }}
          className="absolute inset-0 cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)]"
          aria-label={`View photo ${String(activeIndex + 1)} full screen`}
        >
          <ProgressiveImage
            src={currentPhoto.url}
            alt={`${alt} (photo ${String(activeIndex + 1)} of ${String(photos.length)})`}
            blurHash={currentPhoto.blur_hash}
            className="absolute inset-0"
          />
        </button>

        {photos.length > 1 ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Previous photo"
              onClick={goPrev}
              className="absolute top-1/2 left-2 h-10 w-10 -translate-y-1/2 rounded-full border-white/10 bg-black/60 p-0 text-white backdrop-blur hover:bg-black/80"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Next photo"
              onClick={goNext}
              className="absolute top-1/2 right-2 h-10 w-10 -translate-y-1/2 rounded-full border-white/10 bg-black/60 p-0 text-white backdrop-blur hover:bg-black/80"
            >
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </Button>
          </>
        ) : null}
      </div>

      {photos.length > 1 ? (
        <div
          className="mt-3 flex gap-2 overflow-x-auto pb-1"
          role="tablist"
          aria-label="Listing photo thumbnails"
        >
          {photos.map((p, i) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={i === activeIndex}
              aria-label={`View photo ${String(i + 1)}`}
              onClick={() => {
                setActiveIndex(i);
              }}
              className={cn(
                'relative aspect-[4/3] h-16 shrink-0 overflow-hidden rounded-md border-2 transition',
                i === activeIndex
                  ? 'border-[var(--brand-gold)]'
                  : 'border-transparent opacity-70 hover:opacity-100',
              )}
            >
              <ProgressiveImage
                src={p.url}
                alt=""
                blurHash={p.blur_hash}
                className="absolute inset-0"
              />
            </button>
          ))}
        </div>
      ) : null}

      <PhotoLightbox
        photos={photos}
        alt={alt}
        initialIndex={activeIndex}
        open={lightboxOpen}
        onClose={closeLightbox}
      />
    </div>
  );
}
