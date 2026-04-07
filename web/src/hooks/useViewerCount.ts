import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

interface ViewerCountResponse {
  count: number;
}

/**
 * Tracks how many users are actively viewing a job listing.
 *
 * On mount and every 30 seconds:
 *  - POSTs to /api/v1/jobs/{id}/ping-viewer (fire-and-forget, auth required)
 *  - GETs /api/v1/jobs/{id}/viewer-count to refresh the displayed count
 *
 * If the user is unauthenticated the ping silently fails (401) and the
 * count continues to be fetched — callers may still display counts from
 * other authenticated viewers.
 */
export function useViewerCount(jobId: string): { count: number } {
  const INTERVAL_MS = 30_000;

  // Ping the viewer endpoint — fire and forget, errors are silently swallowed.
  const sendPing = () => {
    void api.post<void>(`/api/v1/jobs/${jobId}/ping-viewer`).catch(() => undefined);
  };

  // Send ping on mount and on every interval tick.
  useEffect(() => {
    if (!jobId) return;

    sendPing();

    const id = setInterval(sendPing, INTERVAL_MS);
    return () => {
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const { data } = useQuery({
    queryKey: ['viewer-count', jobId],
    queryFn: () =>
      api
        .getPublic<ViewerCountResponse>(`/api/v1/jobs/${jobId}/viewer-count`)
        .then((res) => res.count),
    enabled: !!jobId,
    refetchInterval: INTERVAL_MS,
  });

  return { count: data ?? 0 };
}
