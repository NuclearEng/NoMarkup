import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { api, getApiErrorMessage } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

export const WORK_SESSION_STATUS = {
  NOT_STARTED: 'not_started',
  CHECKED_IN: 'checked_in',
  CHECKED_OUT: 'checked_out',
} as const;
export type WorkSessionStatus = (typeof WORK_SESSION_STATUS)[keyof typeof WORK_SESSION_STATUS];

export interface WorkSession {
  status: WorkSessionStatus;
  checked_in_at: string | null;
  checked_out_at: string | null;
  duration_minutes: number | null;
}

export interface CheckInResponse {
  checked_in_at: string;
}

export interface CheckOutResponse {
  checked_out_at: string;
  duration_minutes: number;
}

export interface CompletionPhotoResponse {
  url: string;
  phase: 'before' | 'after';
}

// ----------------------------------------------------------------
// Hooks
// ----------------------------------------------------------------

/**
 * useWorkSession — polls the work-session state every 30 seconds.
 */
export function useWorkSession(contractId: string) {
  return useQuery({
    queryKey: ['work-session', contractId],
    queryFn: () => api.get<WorkSession>(`/api/v1/contracts/${contractId}/work-session`),
    enabled: !!contractId,
    refetchInterval: 30_000,
  });
}

/**
 * useCheckIn — calls geolocation then POSTs to /checkin.
 */
export function useCheckIn(contractId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (): Promise<CheckInResponse> => {
      return new Promise<CheckInResponse>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            api
              .post<CheckInResponse>(`/api/v1/contracts/${contractId}/checkin`, {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
              })
              .then(resolve)
              .catch((err: unknown) => {
                reject(err instanceof Error ? err : new Error(String(err)));
              });
          },
          (err) => {
            // ASR-5.1.5 — GPS is required for check-in (no note-only API).
            reject(
              new Error(
                err.code === err.PERMISSION_DENIED
                  ? 'GPS is required for check-in so we can confirm you arrived at the job site (stored with the contract for dispute protection). Enable location access and try again.'
                  : 'GPS is required for check-in. We could not read your location — check that location services are on, then try again.',
              ),
            );
          },
          { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
        );
      });
    },
    onSuccess: () => {
      toast.success('Checked in successfully');
      void queryClient.invalidateQueries({ queryKey: ['work-session', contractId] });
    },
    onError: (err: unknown) => {
      toast.error(getApiErrorMessage(err, 'Failed to check in. Please try again.'));
    },
  });
}

/**
 * useCheckOut — calls geolocation then POSTs to /checkout.
 */
export function useCheckOut(contractId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (): Promise<CheckOutResponse> => {
      return new Promise<CheckOutResponse>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            api
              .post<CheckOutResponse>(`/api/v1/contracts/${contractId}/checkout`, {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
              })
              .then(resolve)
              .catch((err: unknown) => {
                reject(err instanceof Error ? err : new Error(String(err)));
              });
          },
          (err) => {
            reject(
              new Error(
                err.code === err.PERMISSION_DENIED
                  ? 'Location access was denied. Please enable location in your browser settings.'
                  : 'Unable to determine your location. Please try again.',
              ),
            );
          },
          { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
        );
      });
    },
    onSuccess: (data) => {
      const hours = Math.floor(data.duration_minutes / 60);
      const mins = data.duration_minutes % 60;
      const label =
        hours > 0 ? `${String(hours)}h ${String(mins)}m` : `${String(mins)} min`;
      toast.success(`Checked out — worked ${label}`);
      void queryClient.invalidateQueries({ queryKey: ['work-session', contractId] });
    },
    onError: (err: unknown) => {
      toast.error(getApiErrorMessage(err, 'Failed to check out. Please try again.'));
    },
  });
}

/**
 * useUploadCompletionPhoto — multipart POST to /completion-photos.
 * Uses fetch directly (not api.post) because multipart forms can't use JSON Content-Type.
 */
export function useUploadCompletionPhoto(contractId: string) {
  return useMutation({
    mutationFn: async ({
      file,
      phase,
    }: {
      file: File;
      phase: 'before' | 'after';
    }): Promise<CompletionPhotoResponse> => {
      const token = getAccessToken();
      const form = new FormData();
      form.append('photo', file);
      form.append('phase', phase);

      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      // Relative URL keeps this same-origin through the Next rewrite proxy.
      const response = await fetch(
        `/api/v1/contracts/${contractId}/completion-photos`,
        {
          method: 'POST',
          headers,
          credentials: 'include',
          body: form,
        },
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to upload photo');
      }

      return response.json() as Promise<CompletionPhotoResponse>;
    },
    onSuccess: (data) => {
      toast.success(`${data.phase === 'before' ? 'Before' : 'After'} photo uploaded`);
    },
    onError: (err: unknown) => {
      toast.error(getApiErrorMessage(err, 'Failed to upload photo. Please try again.'));
    },
  });
}
