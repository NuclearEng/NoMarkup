import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { serverFetch } from '@/lib/server-fetch';

describe('serverFetch', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('attaches X-Request-ID and traceparent', async () => {
    await serverFetch('https://api.example.com/v1/jobs');
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const init = vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('X-Request-ID')).toMatch(/^[0-9a-f]{16}$/i);
    expect(headers.get('traceparent')).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/i,
    );
  });

  it('preserves caller headers and does not override X-Request-ID', async () => {
    await serverFetch('https://api.example.com/v1/jobs', {
      headers: { 'X-Request-ID': 'caller-id-123456', Accept: 'application/json' },
    });
    const init = vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('X-Request-ID')).toBe('caller-id-123456');
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('traceparent')).toBeTruthy();
  });
});
