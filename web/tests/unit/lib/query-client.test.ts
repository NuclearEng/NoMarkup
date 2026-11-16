// query-client — the shared QueryClient's defaults: a one-minute stale time
// and a retry policy that retries a transport failure once but never retries
// an HTTP error response.
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api';
import { queryClient } from '@/lib/query-client';

function retryPolicy(): (failureCount: number, error: Error) => boolean {
  const retry = queryClient.getDefaultOptions().queries?.retry;
  if (typeof retry !== 'function') throw new Error('expected a retry function');
  return retry;
}

describe('shared queryClient', () => {
  it('treats data as fresh for one minute', () => {
    expect(queryClient.getDefaultOptions().queries?.staleTime).toBe(60_000);
  });

  it.each([400, 401, 404, 409, 429, 500, 503])('never retries an HTTP %d', (status) => {
    expect(retryPolicy()(0, new ApiError(status, 'nope'))).toBe(false);
  });

  it('retries a non-HTTP failure exactly once', () => {
    const networkError = new TypeError('Failed to fetch');
    expect(retryPolicy()(0, networkError)).toBe(true);
    expect(retryPolicy()(1, networkError)).toBe(false);
    expect(retryPolicy()(2, networkError)).toBe(false);
  });

  it('treats an ApiError below 400 like a transport failure', () => {
    const odd = new ApiError(0, '');
    expect(retryPolicy()(0, odd)).toBe(true);
    expect(retryPolicy()(1, odd)).toBe(false);
  });
});
