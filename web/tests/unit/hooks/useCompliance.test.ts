import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  extractBidBondRequirement,
  hasConsentCookie,
  isBidBondRequirement,
  useAcceptToS,
  useConfirmBidBond,
  useCreateBidBond,
  useCurrentToS,
  useLogCookieConsent,
  useMyAgeStatus,
  useMyToSAcceptance,
  useSetDOB,
  writeConsentCookie,
} from '@/hooks/useCompliance';

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => {
      toastSuccess(...a);
    },
    error: (...a: unknown[]) => {
      toastError(...a);
    },
  },
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    body: string;
    constructor(status: number, body: string) {
      super(`API error ${String(status)}: ${body}`);
      this.status = status;
      this.body = body;
    }
    userMessage(fallback: string) {
      try {
        const parsed = JSON.parse(this.body) as { error?: string };
        if (parsed.error) return parsed.error;
      } catch {
        // not JSON
      }
      return fallback;
    }
  },
}));

const { api, ApiError } = (await import('@/lib/api')) as unknown as {
  api: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  ApiError: new (status: number, body: string) => Error & {
    status: number;
    body: string;
    userMessage: (fallback: string) => string;
  };
};

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function createWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

describe('useCompliance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toastSuccess.mockClear();
    toastError.mockClear();
    // Reset cookies between tests so hasConsentCookie() is deterministic.
    if (typeof document !== 'undefined') {
      document.cookie = 'nm:consent=; Max-Age=0; Path=/';
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('cookie consent', () => {
    it('hasConsentCookie returns false when no cookie set', () => {
      expect(hasConsentCookie()).toBe(false);
    });

    it('hasConsentCookie returns true after writeConsentCookie', () => {
      writeConsentCookie({ necessary: true, analytics: true, marketing: false });
      expect(hasConsentCookie()).toBe(true);
    });

    it('useLogCookieConsent POSTs to the consent endpoint', async () => {
      api.post.mockResolvedValue({ recorded: true });
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useLogCookieConsent(), { wrapper: createWrapper(qc) });
      result.current.mutate({ necessary: true, analytics: true, marketing: false });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(api.post).toHaveBeenCalledWith('/api/v1/cookie-consent', {
        necessary: true,
        analytics: true,
        marketing: false,
      });
    });

    it('useLogCookieConsent silently swallows ApiError (non-blocking)', async () => {
      api.post.mockRejectedValue(new ApiError(500, '{"error":"down"}'));
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useLogCookieConsent(), { wrapper: createWrapper(qc) });
      result.current.mutate({ necessary: true, analytics: false, marketing: false });
      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
      // Banner save errors must NOT toast (non-blocking by design).
      expect(toastError).not.toHaveBeenCalled();
    });
  });

  describe('ToS', () => {
    it('useCurrentToS hits /api/v1/tos/current', async () => {
      api.get.mockResolvedValue({ version: '1.0', effective_at: '2026-01-01', body_url: '/legal/terms' });
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useCurrentToS(), { wrapper: createWrapper(qc) });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(api.get).toHaveBeenCalledWith('/api/v1/tos/current');
      expect(result.current.data?.version).toBe('1.0');
    });

    it('useMyToSAcceptance is gated by enabled', () => {
      const qc = createTestQueryClient();
      renderHook(() => useMyToSAcceptance(false), { wrapper: createWrapper(qc) });
      expect(api.get).not.toHaveBeenCalled();
    });

    it('useMyToSAcceptance fires when enabled=true', async () => {
      api.get.mockResolvedValue({ tos_version: '1.0', accepted_at: '2026-04-01' });
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useMyToSAcceptance(true), { wrapper: createWrapper(qc) });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(api.get).toHaveBeenCalledWith('/api/v1/me/tos-acceptance');
    });

    it('useAcceptToS POSTs the version', async () => {
      api.post.mockResolvedValue({ accepted: true, tos_version: '1.0' });
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useAcceptToS(), { wrapper: createWrapper(qc) });
      result.current.mutate('1.0');
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(api.post).toHaveBeenCalledWith('/api/v1/me/tos-acceptance', { tos_version: '1.0' });
    });

    it('useAcceptToS toasts the API error', async () => {
      api.post.mockRejectedValue(new ApiError(400, '{"error":"unknown tos_version"}'));
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useAcceptToS(), { wrapper: createWrapper(qc) });
      result.current.mutate('typo');
      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
      expect(toastError).toHaveBeenCalledWith('unknown tos_version');
    });
  });

  describe('age gate', () => {
    it('useMyAgeStatus is gated by enabled', () => {
      const qc = createTestQueryClient();
      renderHook(() => useMyAgeStatus(false), { wrapper: createWrapper(qc) });
      expect(api.get).not.toHaveBeenCalled();
    });

    it('useMyAgeStatus fetches when enabled', async () => {
      api.get.mockResolvedValue({ verified: true, verified_at: '2026-04-01' });
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useMyAgeStatus(true), { wrapper: createWrapper(qc) });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(api.get).toHaveBeenCalledWith('/api/v1/me/age-status');
    });

    it('useSetDOB PUTs the date and toasts on success', async () => {
      api.put.mockResolvedValue({ dob_verified: true });
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useSetDOB(), { wrapper: createWrapper(qc) });
      result.current.mutate('1990-01-15');
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(api.put).toHaveBeenCalledWith('/api/v1/me/dob', { dob: '1990-01-15' });
      expect(toastSuccess).toHaveBeenCalledWith('Age verified');
    });

    it('useSetDOB toasts the API error message', async () => {
      api.put.mockRejectedValue(new ApiError(403, '{"error":"must be at least 18 years old"}'));
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useSetDOB(), { wrapper: createWrapper(qc) });
      result.current.mutate('2020-01-01');
      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
      expect(toastError).toHaveBeenCalledWith('must be at least 18 years old');
    });
  });

  describe('bid bond', () => {
    it('useCreateBidBond POSTs to the right endpoint', async () => {
      api.post.mockResolvedValue({
        bond_id: 'bond-1',
        setup_intent_client_secret: 'seti_abc',
        bond_amount_cents: 1000,
      });
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useCreateBidBond(), { wrapper: createWrapper(qc) });
      result.current.mutate({ listingId: 'listing-1', input: { intended_bid_cents: 10000 } });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(api.post).toHaveBeenCalledWith('/api/v1/listings/listing-1/bid-bond', {
        intended_bid_cents: 10000,
      });
    });

    it('useConfirmBidBond POSTs the bond id', async () => {
      api.post.mockResolvedValue({ authorized: true, bond_id: 'bond-1' });
      const qc = createTestQueryClient();
      const { result } = renderHook(() => useConfirmBidBond(), { wrapper: createWrapper(qc) });
      result.current.mutate({ listingId: 'listing-1', bondId: 'bond-1' });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(api.post).toHaveBeenCalledWith('/api/v1/listings/listing-1/bid-bond/confirm', {
        bond_id: 'bond-1',
      });
    });
  });

  describe('402 detection helpers', () => {
    it('isBidBondRequirement returns false for non-ApiError', () => {
      expect(isBidBondRequirement(new Error('plain'))).toBe(false);
      expect(isBidBondRequirement(null)).toBe(false);
    });

    it('isBidBondRequirement returns false for non-402 ApiError', () => {
      const err = new ApiError(400, '{"error":"bad"}');
      expect(isBidBondRequirement(err)).toBe(false);
    });

    it('isBidBondRequirement returns true for a 402 with the flag', () => {
      const err = new ApiError(402, '{"requires_bid_bond":true,"bond_amount_cents":1000}');
      expect(isBidBondRequirement(err)).toBe(true);
    });

    it('extractBidBondRequirement returns the parsed payload', () => {
      const err = new ApiError(402, '{"requires_bid_bond":true,"bond_amount_cents":1000}');
      const req = extractBidBondRequirement(err);
      expect(req).not.toBeNull();
      expect(req?.bond_amount_cents).toBe(1000);
    });

    it('extractBidBondRequirement returns null when JSON is malformed', () => {
      const err = new ApiError(402, 'not json at all');
      expect(extractBidBondRequirement(err)).toBeNull();
    });

    it('extractBidBondRequirement returns null when flag missing', () => {
      const err = new ApiError(402, '{"requires_bid_bond":false,"bond_amount_cents":1000}');
      expect(extractBidBondRequirement(err)).toBeNull();
    });
  });
});
