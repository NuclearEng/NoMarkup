'use client';

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ImagePlus, Pencil, X } from 'lucide-react';
import type { CSSProperties } from 'react';

import { ProgressiveImage } from '@/components/ui/ProgressiveImage';
import { cn } from '@/lib/utils';

export interface PhotoSlot {
  /** Stable identifier — preserved across reorders. */
  id: string;
  /** URL or object URL for the photo preview. */
  url: string;
  /**
   * Latest quality result, if scoring has finished. `undefined` while a
   * background scoring job is still running.
   */
  quality?: { score: number; hints: string[] };
}

export interface SortablePhotoGridProps {
  photos: PhotoSlot[];
  onReorder: (photos: PhotoSlot[]) => void;
  onCropEdit: (index: number) => void;
  onRemove: (index: number) => void;
  /** "+ Add photo" tile click handler. */
  onAdd?: () => void;
  maxPhotos?: number;
  /** Forwarded to the wrapper for layout composition. */
  className?: string;
}

const DEFAULT_MAX = 10;

/**
 * Drag-to-reorder grid of listing photos.
 *
 * - 4 columns on desktop, 2 columns on mobile.
 * - First slot is always the cover photo (badge: "Cover").
 *   Reordering changes the cover automatically.
 * - Each slot exposes Edit (opens cropper), Remove, and a quality pill.
 * - The "+ Add photo" tile appears as the last slot when count < maxPhotos.
 */
export function SortablePhotoGrid({
  photos,
  onReorder,
  onCropEdit,
  onRemove,
  onAdd,
  maxPhotos = DEFAULT_MAX,
  className,
}: SortablePhotoGridProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = photos.findIndex((p) => p.id === active.id);
    const newIndex = photos.findIndex((p) => p.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(photos, oldIndex, newIndex));
  }

  const canAddMore = photos.length < maxPhotos;

  return (
    <div
      className={cn('grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4', className)}
      data-testid="sortable-photo-grid"
    >
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={photos.map((p) => p.id)} strategy={rectSortingStrategy}>
          {photos.map((photo, i) => (
            <SortablePhotoTile
              key={photo.id}
              photo={photo}
              index={i}
              isCover={i === 0}
              onCropEdit={() => {
                onCropEdit(i);
              }}
              onRemove={() => {
                onRemove(i);
              }}
            />
          ))}
        </SortableContext>
      </DndContext>

      {canAddMore && onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          aria-label="Add photo"
          className="flex aspect-square min-h-[44px] flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-white/15 bg-white/[0.02] text-zinc-300 transition hover:border-white/30 hover:bg-white/[0.04]"
          data-testid="add-photo-tile"
        >
          <ImagePlus className="h-6 w-6" aria-hidden="true" />
          <span className="text-xs font-medium">Add photo</span>
        </button>
      ) : null}
    </div>
  );
}

interface SortablePhotoTileProps {
  photo: PhotoSlot;
  index: number;
  isCover: boolean;
  onCropEdit: () => void;
  onRemove: () => void;
}

function SortablePhotoTile({
  photo,
  index,
  isCover,
  onCropEdit,
  onRemove,
}: SortablePhotoTileProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: photo.id,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative aspect-square overflow-hidden rounded-md border border-white/10 bg-zinc-900"
      data-testid={`photo-slot-${String(index)}`}
    >
      {/* Drag handle — covers entire image so drag works anywhere on the tile,
          but action buttons sit above with stopPropagation. */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Drag to reorder photo ${String(index + 1)}`}
        className="absolute inset-0 cursor-grab focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)] active:cursor-grabbing"
        tabIndex={0}
      >
        <ProgressiveImage src={photo.url} alt={`Photo ${String(index + 1)}`} className="absolute inset-0" />
      </button>

      {/* Cover badge */}
      {isCover ? (
        <span className="pointer-events-none absolute top-1 left-1 rounded-full bg-[var(--brand-gold)] px-2 py-0.5 text-[10px] font-semibold text-black">
          Cover
        </span>
      ) : null}

      {/* Quality pill */}
      {photo.quality ? <QualityPill score={photo.quality.score} /> : null}

      {/* Edit button */}
      <button
        type="button"
        aria-label={`Crop photo ${String(index + 1)}`}
        onClick={(e) => {
          e.stopPropagation();
          onCropEdit();
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        className="absolute right-9 bottom-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/90"
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {/* Remove button */}
      <button
        type="button"
        aria-label={`Remove photo ${String(index + 1)}`}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        className="absolute right-1 bottom-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/90"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

function QualityPill({ score }: { score: number }) {
  const tone =
    score >= 75 ? 'bg-emerald-500/90 text-emerald-50'
      : score >= 50 ? 'bg-amber-500/90 text-amber-50'
      : 'bg-red-500/90 text-red-50';
  return (
    <span
      data-testid="quality-pill"
      className={cn(
        'pointer-events-none absolute top-1 right-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
        tone,
      )}
      title={`Quality: ${String(score)}/100`}
    >
      {String(score)}
    </span>
  );
}
