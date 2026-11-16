import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';

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
 * The ping (which marks *this* viewer present) requires auth by design, so
 * logged-out spectators only GET the public count — they never POST the ping.
 * This matters: api.post routes through the authenticated request path, whose
 * 401 handler runs clearTokens() + window.location='/login' BEFORE any local
 * .catch() can swallow it. So a logged-out visitor pinging would be bounced off
 * the public job-detail page to /login. We skip the ping entirely when there's
 * no access token; the count still refreshes from other authenticated viewers.
 */
export function useViewerCount(jobId: string): { count: number } {
  const INTERVAL_MS = 30_000;

  // Ping the viewer endpoint — auth-only, fire and forget. Skip when logged
  // out: the ping needs a token, and a 401 here would trigger the global
  // redirect-to-/login (see note above), not a silent failure.
  const sendPing = () => {
    if (!getAccessToken()) return;
    void api.post<unknown>(`/api/v1/jobs/${jobId}/ping-viewer`).catch(() => undefined);
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
