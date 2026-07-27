import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InstantAvailabilityCard } from '@/components/providers/InstantAvailabilityCard';

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      public body: string,
    ) {
      super(`API ${String(status)}: ${body}`);
      this.name = 'ApiError';
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
    getApiErrorMessage: (err: unknown, fallback: string) =>
      err instanceof Error ? err.message : fallback,
  };
});

const { api } = await import('@/lib/api');

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

const baseProfile = {
  id: 'prof-1',
  user_id: 'u-1',
  business_name: 'Acme',
  bio: null,
  service_address: null,
  service_location: null,
  service_radius_km: 10,
  default_payment_timing: 'upfront' as const,
  default_milestones: [],
  cancellation_policy: null,
  warranty_terms: null,
  instant_enabled: true,
  instant_available: false,
  jobs_completed: 0,
  avg_response_time_minutes: null,
  on_time_rate: null,
  profile_completeness: 50,
  stripe_onboarding_complete: false,
  service_categories: [],
  portfolio: [],
  member_since: '2026-01-01T00:00:00Z',
};

describe('InstantAvailabilityCard', () => {
  let client: QueryClient;

  beforeEach(() => {
    vi.resetAllMocks();
    client = qc();
  });

  afterEach(() => {
    client.clear();
  });

  it('hydrates weekly editor from GET schedule windows', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      ...baseProfile,
      schedule: [{ day: 'wed', start_time: '10:00', end_time: '14:00' }],
    });

    render(createElement(InstantAvailabilityCard), { wrapper: wrap(client) });

    await waitFor(() => {
      expect(screen.getByLabelText('Wednesday available')).toBeDefined();
    });
    const wed = screen.getByLabelText('Wednesday available');
    // Radix Switch uses data-state on the button role.
    expect(wed.getAttribute('data-state') ?? wed.getAttribute('aria-checked')).toMatch(
      /checked|true/,
    );
    expect(screen.getByDisplayValue('10:00')).toBeDefined();
    expect(screen.getByDisplayValue('14:00')).toBeDefined();
  });

  it('re-GETs when schedule key is missing and does not blank after hydrate', async () => {
    // First response is PATCH-shaped (no schedule). Second is full owner GET.
    vi.mocked(api.get)
      .mockResolvedValueOnce({
        ...baseProfile,
        // schedule intentionally omitted
      })
      .mockResolvedValueOnce({
        ...baseProfile,
        schedule: [{ day: 'fri', start_time: '09:00', end_time: '11:00' }],
      });

    render(createElement(InstantAvailabilityCard), { wrapper: wrap(client) });

    await waitFor(() => {
      expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Friday available')).toBeDefined();
    });
    const fri = screen.getByLabelText('Friday available');
    expect(fri.getAttribute('data-state') ?? fri.getAttribute('aria-checked')).toMatch(
      /checked|true/,
    );
    expect(screen.getByDisplayValue('09:00')).toBeDefined();
    expect(screen.getByDisplayValue('11:00')).toBeDefined();
  });

  it('treats empty schedule array as no windows (not missing)', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      ...baseProfile,
      schedule: [],
    });

    render(createElement(InstantAvailabilityCard), { wrapper: wrap(client) });

    await waitFor(() => {
      expect(screen.getByText('No days set')).toBeDefined();
    });
    // Only one GET — empty array must not trigger schedule-missing refetch.
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1);
  });
});
