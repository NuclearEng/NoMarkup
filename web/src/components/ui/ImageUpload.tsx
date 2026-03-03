'use client';

import { ImagePlus, Upload, X } from 'lucide-react';
import Image from 'next/image';
import {
  useCallback,
  useId,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react';

import { Progress } from '@/components/ui/progress';
import { useImageUpload, type UploadResult } from '@/hooks/useImageUpload';
import { MAX_UPLOAD_SIZE_BYTES } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { UploadContext } from '@/types';

const DEFAULT_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface FileUploadState {
  file: File;
  id: string;
  status: 'pending' | 'uploading' | 'complete' | 'error';
  progress: number;
  error: string | null;
  result: UploadResult | null;
}

interface ImageUploadProps {
  context: UploadContext;
  onUploadComplete: (result: UploadResult) => void;
  maxSizeBytes?: number;
  acceptedTypes?: string[];
  multiple?: boolean;
  maxFiles?: number;
  className?: string;
  placeholder?: string;
  existingImages?: string[];
  onRemove?: (url: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export function ImageUpload({
  context,
  onUploadComplete,
  maxSizeBytes = MAX_UPLOAD_SIZE_BYTES,
  acceptedTypes = DEFAULT_ACCEPTED_TYPES,
  multiple = false,
  maxFiles = 10,
  className,
  placeholder,
  existingImages = [],
  onRemove,
}: ImageUploadProps) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [fileStates, setFileStates] = useState<FileUploadState[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);

  const { upload } = useImageUpload({
    context,
    maxSizeBytes,
    acceptedTypes,
  });

  const totalUploaded = existingImages.length + fileStates.filter((s) => s.status === 'complete').length;

  const processFile = useCallback(
    async (fileState: FileUploadState) => {
      setFileStates((prev) =>
        prev.map((s) =>
          s.id === fileState.id ? { ...s, status: 'uploading' as const, progress: 0 } : s,
        ),
      );

      // We use the hook's upload function but track per-file state manually
      const result = await upload(fileState.file);

      if (result) {
        setFileStates((prev) =>
          prev.map((s) =>
            s.id === fileState.id
              ? { ...s, status: 'complete' as const, progress: 100, result }
              : s,
          ),
        );
        onUploadComplete(result);
      } else {
        setFileStates((prev) =>
          prev.map((s) =>
            s.id === fileState.id
              ? { ...s, status: 'error' as const, error: 'Upload failed' }
              : s,
          ),
        );
      }
    },
    [upload, onUploadComplete],
  );

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      setValidationError(null);
      const fileArray = Array.from(files);

      // Enforce max files limit
      const slotsRemaining = maxFiles - totalUploaded;
      if (slotsRemaining <= 0) {
        setValidationError(`Maximum of ${String(maxFiles)} files allowed`);
        return;
      }

      const filesToProcess = multiple ? fileArray.slice(0, slotsRemaining) : [fileArray[0]];
      if (!filesToProcess[0]) return;

      // Client-side validation
      const invalidType = filesToProcess.find((f) => f && !acceptedTypes.includes(f.type));
      if (invalidType) {
        setValidationError(
          `"${invalidType.name}" is not an accepted type. Allowed: ${acceptedTypes.map((t) => t.replace('image/', '')).join(', ')}`,
        );
        return;
      }

      const tooLarge = filesToProcess.find((f) => f && f.size > maxSizeBytes);
      if (tooLarge) {
        setValidationError(
          `"${tooLarge.name}" (${formatBytes(tooLarge.size)}) exceeds the ${formatBytes(maxSizeBytes)} limit`,
        );
        return;
      }

      const newStates: FileUploadState[] = filesToProcess
        .filter((f): f is File => f !== undefined)
        .map((file) => ({
          file,
          id: `${file.name}-${String(Date.now())}-${String(Math.random())}`,
          status: 'pending' as const,
          progress: 0,
          error: null,
          result: null,
        }));

      setFileStates((prev) => [...prev, ...newStates]);

      // Start uploads
      for (const state of newStates) {
        void processFile(state);
      }
    },
    [multiple, maxFiles, totalUploaded, acceptedTypes, maxSizeBytes, processFile],
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
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFiles(e.target.files);
      }
      // Reset input so the same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [handleFiles],
  );

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openFilePicker();
      }
    },
    [openFilePicker],
  );

  const removeUploadedFile = useCallback(
    (fileId: string) => {
      const fileState = fileStates.find((s) => s.id === fileId);
      if (fileState?.result && onRemove) {
        onRemove(fileState.result.confirmedUrl);
      }
      setFileStates((prev) => prev.filter((s) => s.id !== fileId));
    },
    [fileStates, onRemove],
  );

  const acceptString = acceptedTypes.join(',');
  const friendlyTypes = acceptedTypes.map((t) => t.replace('image/', '').toUpperCase()).join(', ');
  const defaultPlaceholder = `Drop ${multiple ? 'images' : 'an image'} here, or click to browse`;

  const activeUploads = fileStates.filter((s) => s.status === 'uploading' || s.status === 'pending');
  const completedUploads = fileStates.filter((s) => s.status === 'complete');
  const failedUploads = fileStates.filter((s) => s.status === 'error');

  return (
    <div className={cn('space-y-3', className)}>
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label={placeholder ?? defaultPlaceholder}
        className={cn(
          'relative flex min-h-[140px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50',
          activeUploads.length > 0 && 'pointer-events-none opacity-60',
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={openFilePicker}
        onKeyDown={handleKeyDown}
      >
        <input
          ref={fileInputRef}
          id={inputId}
          type="file"
          accept={acceptString}
          multiple={multiple}
          className="sr-only"
          onChange={handleInputChange}
          aria-hidden="true"
          tabIndex={-1}
        />

        {isDragging ? (
          <>
            <Upload className="mb-2 h-8 w-8 text-primary" />
            <p className="text-sm font-medium text-primary">Drop to upload</p>
          </>
        ) : (
          <>
            <ImagePlus className="mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-muted-foreground">
              {placeholder ?? defaultPlaceholder}
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              {friendlyTypes} up to {formatBytes(maxSizeBytes)}
            </p>
          </>
        )}
      </div>

      {/* Validation error */}
      {validationError && (
        <p className="text-sm text-destructive" role="alert">
          {validationError}
        </p>
      )}

      {/* Active uploads */}
      {activeUploads.length > 0 && (
        <div className="space-y-2">
          {activeUploads.map((fileState) => (
            <div
              key={fileState.id}
              className="flex items-center gap-3 rounded-md border bg-muted/30 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{fileState.file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(fileState.file.size)}
                  {fileState.status === 'pending' && ' - Waiting...'}
                  {fileState.status === 'uploading' && ` - ${String(fileState.progress)}%`}
                </p>
                <Progress value={fileState.progress} className="mt-1.5 h-1.5" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Failed uploads */}
      {failedUploads.length > 0 && (
        <div className="space-y-2">
          {failedUploads.map((fileState) => (
            <div
              key={fileState.id}
              className="flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{fileState.file.name}</p>
                <p className="text-xs text-destructive">
                  {fileState.error ?? 'Upload failed'}
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setFileStates((prev) => prev.filter((s) => s.id !== fileState.id));
                }}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-destructive hover:bg-destructive/10"
                aria-label={`Dismiss error for ${fileState.file.name}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Preview thumbnails */}
      {(existingImages.length > 0 || completedUploads.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {/* Existing images */}
          {existingImages.map((url) => (
            <div
              key={url}
              className="group relative h-20 w-20 overflow-hidden rounded-md border bg-muted"
            >
              <Image
                src={url}
                alt="Uploaded image"
                fill
                className="object-cover"
                sizes="80px"
              />
              {onRemove && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(url);
                  }}
                  className={cn(
                    'absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full',
                    'bg-black/60 text-white opacity-0 transition-opacity',
                    'hover:bg-black/80 group-hover:opacity-100',
                    'min-h-[44px] min-w-[44px] -translate-x-[calc(50%-10px)] -translate-y-[calc(50%-10px)] scale-[calc(20/44)]',
                  )}
                  aria-label="Remove image"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}

          {/* Newly uploaded images */}
          {completedUploads.map((fileState) => (
            <div
              key={fileState.id}
              className="group relative h-20 w-20 overflow-hidden rounded-md border bg-muted"
            >
              <Image
                src={fileState.result?.confirmedUrl ?? ''}
                alt={fileState.file.name}
                fill
                className="object-cover"
                sizes="80px"
              />
              {onRemove && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeUploadedFile(fileState.id);
                  }}
                  className={cn(
                    'absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full',
                    'bg-black/60 text-white opacity-0 transition-opacity',
                    'hover:bg-black/80 group-hover:opacity-100',
                    'min-h-[44px] min-w-[44px] -translate-x-[calc(50%-10px)] -translate-y-[calc(50%-10px)] scale-[calc(20/44)]',
                  )}
                  aria-label={`Remove ${fileState.file.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
