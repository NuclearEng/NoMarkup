import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  indexDocumentsByType,
  isDocumentResubmissionLocked,
  resubmissionLockoutMessage,
  useProviderProfile,
  useProviderVerificationDocuments,
  useSetAvailability,
  useSetGlobalTerms,
  useUpdateCategories,
  useUpdatePortfolio,
  useUpdateProviderProfile,
  useUploadVerificationDocument,
} from '@/hooks/useProviderProfile';

// vi.mock factories are hoisted, so the ApiError class must be defined inline.
vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(public status: number, public body: string) {
      super(`API ${String(status)}: ${body}`);
      this.name = 'ApiError';
    }
    userMessage(fallback: string): string {
      try {
        const parsed = JSON.parse(this.body) as { error?: string; message?: string };
        if (parsed.error) return parsed.error;
        if (parsed.message) return parsed.message;
      } catch {
        // not JSON
      }
      if (this.body && this.body.length < 200) return this.body;
      return fallback;
    }
  }
  return {
    api: {
      get: vi.fn(),
      getPublic: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
    ApiError,
  };
});
const { api, ApiError: FakeApiError } = await import('@/lib/api');

function qc() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}
function wrap(client: QueryClient) {
  return function W({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

describe('useProviderProfile', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('fetches /providers/me and returns the profile', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ id: 'prov-1', user_id: 'u-1' });
    const { result } = renderHook(() => useProviderProfile(), { wrapper: wrap(client) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/providers/me');
    expect(result.current.data?.id).toBe('prov-1');
  });

  it('returns null on 404 (provider role enabled but profile not yet created)', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new FakeApiError(404, 'no profile'));
    const { result } = renderHook(() => useProviderProfile(), { wrapper: wrap(client) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toBeNull();
  });

  it('rethrows non-404 errors', async () => {
    vi.mocked(api.get).mockRejectedValue(new FakeApiError(500, 'down'));
    const { result } = renderHook(() => useProviderProfile(), { wrapper: wrap(client) });
    // Hook retries once on non-404 (failureCount < 1), so allow extra time for the retry delay.
    await waitFor(
      () => {
        expect(result.current.isError).toBe(true);
      },
      { timeout: 5000 },
    );
  });
});

describe('useUpdateProviderProfile', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('patches /providers/me + invalidates the profile cache', async () => {
    vi.mocked(api.patch).mockResolvedValueOnce({ id: 'prov-1', business_name: 'New Co' });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateProviderProfile(), { wrapper: wrap(client) });
    const input = { business_name: 'New Co' };
    result.current.mutate(input);
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.patch)).toHaveBeenCalledWith('/api/v1/providers/me', input);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['providerProfile'] });
  });
});

describe('useSetGlobalTerms', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('puts global terms + invalidates the profile cache', async () => {
    vi.mocked(api.put).mockResolvedValueOnce({ id: 'prov-1' });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useSetGlobalTerms(), { wrapper: wrap(client) });
    const input = {
      payment_timing: 'net30',
      milestones: [],
      cancellation_policy: '',
      warranty_terms: '',
    };
    result.current.mutate(input);
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.put)).toHaveBeenCalledWith('/api/v1/providers/me/terms', input);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['providerProfile'] });
  });
});

describe('useUpdateCategories', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('puts category_ids + unwraps the categories array + invalidates', async () => {
    vi.mocked(api.put).mockResolvedValueOnce({
      categories: [{ id: 'cat-1', name: 'Plumbing' }],
    });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateCategories(), { wrapper: wrap(client) });
    result.current.mutate(['cat-1', 'cat-2']);
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.put)).toHaveBeenCalledWith('/api/v1/providers/me/categories', {
      category_ids: ['cat-1', 'cat-2'],
    });
    expect(result.current.data).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['providerProfile'] });
  });
});

describe('useUpdatePortfolio', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('puts the images payload + unwraps + invalidates', async () => {
    vi.mocked(api.put).mockResolvedValueOnce({
      images: [{ id: 'img-1', image_url: 'https://example.com/a.jpg' }],
    });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useUpdatePortfolio(), { wrapper: wrap(client) });
    const images = [{ image_url: 'https://example.com/a.jpg', caption: null, sort_order: 0 }];
    result.current.mutate(images);
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.put)).toHaveBeenCalledWith('/api/v1/providers/me/portfolio', {
      images,
    });
    expect(result.current.data).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['providerProfile'] });
  });
});

describe('useUploadVerificationDocument', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('posts the document payload + invalidates the profile cache', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ document_id: 'doc-1', status: 'pending' });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useUploadVerificationDocument(), { wrapper: wrap(client) });
    const input = {
      document_type: 'license',
      file_url: 'https://example.com/lic.pdf',
      file_name: 'lic.pdf',
      mime_type: 'application/pdf',
      size_bytes: 1024,
    };
    result.current.mutate(input);
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/api/v1/providers/me/documents', input);
    expect(result.current.data?.document_id).toBe('doc-1');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['providerProfile'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['providerVerificationDocuments'] });
  });
});

describe('useSetAvailability', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('puts enabled/available_now/schedule wire fields + invalidates', async () => {
    vi.mocked(api.put).mockResolvedValueOnce({
      instant_enabled: true,
      instant_available: false,
      schedule: [{ day: 'mon', start_time: '09:00', end_time: '17:00' }],
    });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useSetAvailability(), { wrapper: wrap(client) });
    const input = {
      enabled: true,
      available_now: false,
      schedule: [{ day: 'mon', start_time: '09:00', end_time: '17:00' }],
    };
    result.current.mutate(input);
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(vi.mocked(api.put)).toHaveBeenCalledWith('/api/v1/providers/me/availability', {
      enabled: true,
      available_now: false,
      schedule: [{ day: 'mon', start_time: '09:00', end_time: '17:00' }],
    });
    expect(result.current.data?.instant_enabled).toBe(true);
    expect(result.current.data?.schedule?.[0]?.day).toBe('mon');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['providerProfile'] });
  });

  it('merges PUT schedule echo into providerProfile cache so hydrate does not blank', async () => {
    // Keep inactive cache long enough to observe setQueryData before GC (test qc uses gcTime: 0).
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 60_000 }, mutations: { retry: false } },
    });
    client.setQueryData(['providerProfile'], {
      id: 'prof-1',
      user_id: 'u-1',
      business_name: 'Acme',
      bio: null,
      service_address: null,
      service_location: null,
      service_radius_km: 10,
      default_payment_timing: 'upfront',
      default_milestones: [],
      cancellation_policy: null,
      warranty_terms: null,
      instant_enabled: false,
      instant_available: false,
      // Simulate PATCH-shaped cache (no schedule key) that would wipe the editor.
      jobs_completed: 0,
      avg_response_time_minutes: null,
      on_time_rate: null,
      profile_completeness: 0,
      stripe_onboarding_complete: false,
      service_categories: [],
      portfolio: [],
      member_since: '2026-01-01T00:00:00Z',
    });
    vi.mocked(api.put).mockResolvedValueOnce({
      instant_enabled: true,
      instant_available: true,
      schedule: [{ day: 'tue', start_time: '08:00', end_time: '12:00' }],
    });
    // Block invalidate-driven refetch from overwriting the merge under test.
    vi.mocked(api.get).mockImplementation(
      () => new Promise(() => {
        /* never settles */
      }),
    );

    const { result } = renderHook(() => useSetAvailability(), { wrapper: wrap(client) });
    result.current.mutate({
      enabled: true,
      available_now: true,
      schedule: [{ day: 'tue', start_time: '08:00', end_time: '12:00' }],
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const cached = client.getQueryData<{
      instant_enabled: boolean;
      instant_available: boolean;
      schedule?: { day: string }[];
    }>(['providerProfile']);
    expect(cached?.instant_enabled).toBe(true);
    expect(cached?.instant_available).toBe(true);
    expect(cached?.schedule?.[0]?.day).toBe('tue');
  });
});

describe('useProviderVerificationDocuments + resubmission helpers', () => {
  let client: QueryClient;
  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });
  afterEach(() => {
    client.clear();
  });

  it('lists documents from GET /providers/me/documents', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      documents: [
        { id: 'd1', document_type: 'government_id', status: 'rejected', resubmission_count: 2 },
      ],
    });
    const { result } = renderHook(() => useProviderVerificationDocuments(), { wrapper: wrap(client) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/api/v1/providers/me/documents');
    expect(result.current.data?.[0]?.resubmission_count).toBe(2);
  });

  it('isDocumentResubmissionLocked at >= 3', () => {
    expect(isDocumentResubmissionLocked(undefined)).toBe(false);
    expect(isDocumentResubmissionLocked(2)).toBe(false);
    expect(isDocumentResubmissionLocked(3)).toBe(true);
    expect(isDocumentResubmissionLocked(4)).toBe(true);
  });

  it('indexDocumentsByType prefers higher resubmission_count', () => {
    const map = indexDocumentsByType([
      { document_type: 'government_id', status: 'rejected', resubmission_count: 1 },
      { document_type: 'drivers_license', status: 'rejected', resubmission_count: 3 },
      { document_type: 'business_license', status: 'pending', resubmission_count: 0 },
    ]);
    // Legacy government_id aliases onto drivers_license for lockout UI.
    expect(map.drivers_license?.resubmission_count).toBe(3);
    expect(map.business_license?.status).toBe('pending');
  });

  it('resubmissionLockoutMessage maps 422 to contact-support copy', () => {
    const err = new FakeApiError(
      422,
      JSON.stringify({ error: 'maximum resubmission attempts reached for this document type; contact support' }),
    );
    expect(resubmissionLockoutMessage(err)).toMatch(/contact support/i);
  });
});
