import { useCallback, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { API_BASE_URL, MAX_UPLOAD_SIZE_BYTES } from '@/lib/constants';
import type { ConfirmUploadResponse, UploadContext, UploadURLResponse } from '@/types';

const DEFAULT_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type UploadStatus = 'idle' | 'getting_url' | 'uploading' | 'confirming' | 'complete' | 'error';

export interface UploadResult {
  objectKey: string;
  confirmedUrl: string;
}

interface UseImageUploadOptions {
  context: UploadContext;
  maxSizeBytes?: number;
  acceptedTypes?: string[];
  onSuccess?: (result: UploadResult) => void;
  onError?: (error: string) => void;
}

interface UseImageUploadReturn {
  upload: (file: File) => Promise<UploadResult | null>;
  status: UploadStatus;
  progress: number;
  error: string | null;
  reset: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export function useImageUpload(options: UseImageUploadOptions): UseImageUploadReturn {
  const {
    context,
    maxSizeBytes = MAX_UPLOAD_SIZE_BYTES,
    acceptedTypes = DEFAULT_ACCEPTED_TYPES,
    onSuccess,
    onError,
  } = options;

  const [status, setStatus] = useState<UploadStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const reset = useCallback(() => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    setStatus('idle');
    setProgress(0);
    setError(null);
  }, []);

  const upload = useCallback(
    async (file: File): Promise<UploadResult | null> => {
      // Reset previous state
      setError(null);
      setProgress(0);

      // Validate file type
      if (!acceptedTypes.includes(file.type)) {
        const msg = `File type "${file.type}" is not accepted. Allowed: ${acceptedTypes.join(', ')}`;
        setStatus('error');
        setError(msg);
        onError?.(msg);
        return null;
      }

      // Validate file size
      if (file.size > maxSizeBytes) {
        const msg = `File size ${formatBytes(file.size)} exceeds the ${formatBytes(maxSizeBytes)} limit`;
        setStatus('error');
        setError(msg);
        onError?.(msg);
        return null;
      }

      try {
        // Step 1: Get pre-signed upload URL
        setStatus('getting_url');
        const uploadUrlResponse = await api.post<UploadURLResponse>(
          '/api/v1/images/upload-url',
          {
            filename: file.name,
            mime_type: file.type,
            file_size_bytes: file.size,
            context,
          },
        );

        // Step 2: Upload file directly to pre-signed URL with progress tracking
        setStatus('uploading');
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhrRef.current = xhr;

          xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable) {
              const pct = Math.round((event.loaded / event.total) * 100);
              setProgress(pct);
            }
          });

          xhr.addEventListener('load', () => {
            xhrRef.current = null;
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              reject(new Error(`Upload failed with status ${String(xhr.status)}`));
            }
          });

          xhr.addEventListener('error', () => {
            xhrRef.current = null;
            reject(new Error('Network error during upload'));
          });

          xhr.addEventListener('abort', () => {
            xhrRef.current = null;
            reject(new Error('Upload cancelled'));
          });

          // Build the upload URL - if it's a relative path, prepend API_BASE_URL
          const uploadUrl = uploadUrlResponse.upload_url.startsWith('http')
            ? uploadUrlResponse.upload_url
            : `${API_BASE_URL}${uploadUrlResponse.upload_url}`;

          xhr.open('PUT', uploadUrl);
          xhr.setRequestHeader('Content-Type', file.type);

          // Attach auth token if the upload goes through our API
          if (!uploadUrlResponse.upload_url.startsWith('http')) {
            const token = getAccessToken();
            if (token) {
              xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            }
          }

          xhr.send(file);
        });

        // Step 3: Confirm upload
        setStatus('confirming');
        const confirmResponse = await api.post<ConfirmUploadResponse>(
          '/api/v1/images/confirm',
          {
            object_key: uploadUrlResponse.object_key,
            context,
          },
        );

        if (!confirmResponse.content_type_valid) {
          const msg = `Server rejected file: detected content type "${confirmResponse.actual_content_type}"`;
          setStatus('error');
          setError(msg);
          onError?.(msg);
          return null;
        }

        const result: UploadResult = {
          objectKey: uploadUrlResponse.object_key,
          confirmedUrl: confirmResponse.confirmed_url,
        };

        setStatus('complete');
        setProgress(100);
        onSuccess?.(result);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        setStatus('error');
        setError(msg);
        onError?.(msg);
        return null;
      }
    },
    [context, maxSizeBytes, acceptedTypes, onSuccess, onError],
  );

  return { upload, status, progress, error, reset };
}
