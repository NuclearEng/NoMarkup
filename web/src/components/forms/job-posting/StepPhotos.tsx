'use client';

import { ImagePlus, X } from 'lucide-react';
import { useCallback, useRef, useState, type DragEvent } from 'react';

const MAX_PHOTOS = 10;
const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface StepPhotosProps {
  photos: File[];
  onPhotosChange: (photos: File[]) => void;
}

export function StepPhotos({ photos, onPhotosChange }: StepPhotosProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const incoming = Array.from(files).filter((f) => ACCEPTED_PHOTO_TYPES.includes(f.type));
      const slotsRemaining = MAX_PHOTOS - photos.length;
      if (slotsRemaining <= 0) return;
      const toAdd = incoming.slice(0, slotsRemaining);
      onPhotosChange([...photos, ...toAdd]);
    },
    [photos, onPhotosChange],
  );

  const removePhoto = useCallback(
    (index: number) => {
      onPhotosChange(photos.filter((_, i) => i !== index));
    },
    [photos, onPhotosChange],
  );

  const handleDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files);
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [addFiles],
  );

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Drag photos here or click to browse"
        className={`focus-visible:ring-ring flex min-h-[160px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none ${
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50'
        } ${photos.length >= MAX_PHOTOS ? 'pointer-events-none opacity-50' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={openFilePicker}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openFilePicker();
          }
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp"
          multiple
          className="sr-only"
          onChange={handleInputChange}
          aria-hidden="true"
          tabIndex={-1}
        />
        <ImagePlus className="text-muted-foreground mb-2 h-8 w-8" aria-hidden="true" />
        <p className="text-muted-foreground text-sm font-medium">
          Drag photos here or click to browse
        </p>
        <p className="text-muted-foreground/70 mt-1 text-xs">Up to 10 photos (JPG, PNG, WebP)</p>
      </div>

      {/* Photo count */}
      {photos.length > 0 ? (
        <p className="text-muted-foreground text-sm">
          {String(photos.length)} of {String(MAX_PHOTOS)} photos selected
        </p>
      ) : null}

      {/* Preview thumbnails */}
      {photos.length > 0 ? (
        <div className="grid grid-cols-5 gap-3">
          {photos.map((file, index) => (
            <div
              key={`${file.name}-${String(file.lastModified)}-${String(index)}`}
              className="group bg-muted relative aspect-square overflow-hidden rounded-md border"
            >
              {/* Local blob preview — using img intentionally, not next/image */}
              <img
                src={URL.createObjectURL(file)}
                alt={file.name}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => {
                  removePhoto(index);
                }}
                className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/80"
                aria-label={`Remove ${file.name}`}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
