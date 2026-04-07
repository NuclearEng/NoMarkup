'use client';

import Image from 'next/image';
import { useRef, useState } from 'react';

import { Camera, CheckCircle2, ImagePlus, Loader2, UploadCloud } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useMarkComplete } from '@/hooks/useContracts';
import { useUploadCompletionPhoto } from '@/hooks/useWorkspace';

interface CompletionPhotosProps {
  contractId: string;
  className?: string;
}

interface PhotoSlot {
  phase: 'before' | 'after';
  label: string;
  hint: string;
}

const PHOTO_SLOTS: PhotoSlot[] = [
  {
    phase: 'before',
    label: 'Before',
    hint: 'Photo before work begins',
  },
  {
    phase: 'after',
    label: 'After',
    hint: 'Photo when work is complete',
  },
];

export function CompletionPhotos({ contractId, className }: CompletionPhotosProps) {
  const [photoURLs, setPhotoURLs] = useState<Record<'before' | 'after', string | null>>({
    before: null,
    after: null,
  });
  const [uploadingPhase, setUploadingPhase] = useState<'before' | 'after' | null>(null);

  const beforeInputRef = useRef<HTMLInputElement>(null);
  const afterInputRef = useRef<HTMLInputElement>(null);

  const uploadPhoto = useUploadCompletionPhoto(contractId);
  const markComplete = useMarkComplete();

  const canMarkComplete = photoURLs.after !== null;
  const isMarkingComplete = markComplete.isPending;

  function inputRefForPhase(phase: 'before' | 'after') {
    return phase === 'before' ? beforeInputRef : afterInputRef;
  }

  function handleFileChange(
    event: React.ChangeEvent<HTMLInputElement>,
    phase: 'before' | 'after',
  ) {
    const file = event.target.files?.[0];
    if (!file) return;

    // Show optimistic preview immediately from the local object URL.
    const localPreview = URL.createObjectURL(file);
    setPhotoURLs((prev) => ({ ...prev, [phase]: localPreview }));
    setUploadingPhase(phase);

    uploadPhoto.mutate(
      { file, phase },
      {
        onSuccess: (data) => {
          // Replace the local preview with the server-confirmed URL.
          URL.revokeObjectURL(localPreview);
          setPhotoURLs((prev) => ({ ...prev, [phase]: data.url }));
        },
        onError: () => {
          // Revert on failure.
          URL.revokeObjectURL(localPreview);
          setPhotoURLs((prev) => ({ ...prev, [phase]: null }));
        },
        onSettled: () => {
          setUploadingPhase(null);
          // Clear the input so the same file can be re-selected if needed.
          const input = inputRefForPhase(phase).current;
          if (input) input.value = '';
        },
      },
    );
  }

  return (
    <div className={className}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-zinc-400" aria-hidden="true" />
          <p className="text-sm font-medium text-zinc-300">Completion Photos</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {PHOTO_SLOTS.map((slot) => {
            const url = photoURLs[slot.phase];
            const isUploading = uploadingPhase === slot.phase;

            return (
              <div key={slot.phase}>
                {/* Hidden file input */}
                <input
                  ref={inputRefForPhase(slot.phase)}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  aria-label={`Upload ${slot.label.toLowerCase()} photo`}
                  onChange={(e) => handleFileChange(e, slot.phase)}
                />

                {/* Tap/click target */}
                <button
                  type="button"
                  className="group relative flex min-h-[44px] w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-zinc-700 bg-zinc-900/50 transition-colors hover:border-zinc-500 hover:bg-zinc-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  style={{ aspectRatio: '4/3' }}
                  onClick={() => inputRefForPhase(slot.phase).current?.click()}
                  aria-label={
                    url
                      ? `Replace ${slot.label.toLowerCase()} photo`
                      : `Upload ${slot.label.toLowerCase()} photo — ${slot.hint}`
                  }
                  disabled={isUploading}
                >
                  {isUploading ? (
                    // Uploading state
                    <div className="flex flex-col items-center gap-1.5 p-3 text-center">
                      <Loader2 className="h-6 w-6 animate-spin text-zinc-400" aria-hidden="true" />
                      <p className="text-xs text-zinc-400">Uploading…</p>
                    </div>
                  ) : url ? (
                    // Preview thumbnail
                    <>
                      <Image
                        src={url}
                        alt={`${slot.label} photo preview`}
                        fill
                        sizes="(max-width: 640px) 50vw, 200px"
                        className="object-cover transition-opacity group-hover:opacity-75"
                        unoptimized={url.startsWith('blob:')}
                      />
                      {/* Overlay hint on hover */}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
                        <UploadCloud
                          className="h-6 w-6 text-white opacity-0 transition-opacity group-hover:opacity-100"
                          aria-hidden="true"
                        />
                      </div>
                      {/* Label badge */}
                      <div className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5">
                        <p className="text-xs font-medium text-white">{slot.label}</p>
                      </div>
                    </>
                  ) : (
                    // Empty state
                    <div className="flex flex-col items-center gap-1.5 p-3 text-center">
                      <ImagePlus
                        className="h-6 w-6 text-zinc-500 transition-colors group-hover:text-zinc-300"
                        aria-hidden="true"
                      />
                      <p className="text-xs font-semibold text-zinc-400 transition-colors group-hover:text-zinc-200">
                        {slot.label}
                      </p>
                      <p className="text-[10px] leading-snug text-zinc-600 group-hover:text-zinc-400">
                        {slot.hint}
                      </p>
                    </div>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {/* Skeleton placeholder while uploading — accessibility */}
        {uploadingPhase !== null ? (
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            Uploading {uploadingPhase} photo…
          </p>
        ) : null}

        <Button
          className="min-h-[44px] w-full"
          onClick={() => markComplete.mutate(contractId)}
          disabled={!canMarkComplete || isMarkingComplete}
          aria-label={
            canMarkComplete
              ? 'Mark job as complete'
              : 'Upload an after photo before marking complete'
          }
          aria-describedby={!canMarkComplete ? 'completion-photo-hint' : undefined}
        >
          {isMarkingComplete ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Marking complete…
            </>
          ) : (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
              Mark Complete
            </>
          )}
        </Button>

        {!canMarkComplete ? (
          <p id="completion-photo-hint" className="text-center text-xs text-zinc-500">
            Upload at least one &ldquo;After&rdquo; photo to mark this job complete.
          </p>
        ) : null}
      </div>
    </div>
  );
}
