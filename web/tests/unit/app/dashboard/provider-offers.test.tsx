// Tests for the provider instant offers page — exercises loading/error/empty
// branches, accept/decline actions, and expired-offer filtering.
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

const offersState: { data: unknown; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
};

const acceptMutate = vi.fn(() => Promise.resolve({}));
const declineMutate = vi.fn(() => Promise.resolve({}));
const acceptState = { isPending: false };
const declineState = { isPending: false };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/provider/offers',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  useParams: () => ({}),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

vi.mock('@/hooks/useCountdown', () => ({
  useCountdown: (expiresAt: string) => {
    const ms = new Date(expiresAt).getTime() - Date.now();
    const isExpired = ms <= 0;
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    return {
      timeLeft: isExpired ? 'Expired' : `${String(Math.floor(totalSeconds / 60))}:00`,
      isExpired,
      totalSeconds,
    };
  },
}));

vi.mock('@/hooks/useInstantMatch', () => ({
  useAcceptOffer: () => ({
    mutateAsync: acceptMutate,
    isPending: acceptState.isPending,
  }),
  useDeclineOffer: () => ({
    mutateAsync: declineMutate,
    isPending: declineState.isPending,
  }),
  useProviderOffers: () => offersState,
}));

const { default: ProviderOffersPage } = await import(
  '@/app/(dashboard)/provider/offers/page'
);

const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
const past = new Date(Date.now() - 60 * 1000).toISOString();

beforeEach(() => {
  offersState.data = undefined;
  offersState.isLoading = false;
  offersState.isError = false;
  acceptState.isPending = false;
  declineState.isPending = false;
  acceptMutate.mockClear();
  declineMutate.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ProviderOffersPage', () => {
  it('renders loading skeletons while loading', () => {
    offersState.isLoading = true;
    render(withQueryClient(createElement(ProviderOffersPage)));
    expect(screen.queryByText(/no pending offers/i)).toBeNull();
  });

  it('renders error state when offers fail to load', () => {
    offersState.isError = true;
    render(withQueryClient(createElement(ProviderOffersPage)));
    expect(screen.getByText(/failed to load offers/i)).toBeDefined();
  });

  it('renders empty state when no active offers', () => {
    offersState.data = { offers: [] };
    render(withQueryClient(createElement(ProviderOffersPage)));
    expect(screen.getByText(/no pending offers right now/i)).toBeDefined();
  });

  it('filters out expired offers from the active list', () => {
    offersState.data = {
      offers: [
        { job_id: 'j1', job_title: 'Active Job', expires_at: future, amount_cents: 5000 },
        { job_id: 'j2', job_title: 'Expired Job', expires_at: past, amount_cents: 5000 },
      ],
    };
    render(withQueryClient(createElement(ProviderOffersPage)));
    expect(screen.getByText('Active Job')).toBeDefined();
    expect(screen.queryByText('Expired Job')).toBeNull();
  });

  it('renders Accept and Decline buttons for non-expired offers', () => {
    offersState.data = {
      offers: [{ job_id: 'j1', job_title: 'Active Job', expires_at: future, amount_cents: 5000 }],
    };
    render(withQueryClient(createElement(ProviderOffersPage)));
    expect(screen.getByRole('button', { name: /accept offer/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /decline offer/i })).toBeDefined();
  });

  it('falls back to "Untitled Job" when title missing', () => {
    offersState.data = {
      offers: [{ job_id: 'j1', job_title: '', expires_at: future, amount_cents: 5000 }],
    };
    render(withQueryClient(createElement(ProviderOffersPage)));
    expect(screen.getByText(/untitled job/i)).toBeDefined();
  });

  it('triggers accept mutation when Accept clicked', () => {
    offersState.data = {
      offers: [{ job_id: 'j_accept', job_title: 'Accept Me', expires_at: future, amount_cents: 5000 }],
    };
    render(withQueryClient(createElement(ProviderOffersPage)));
    fireEvent.click(screen.getByRole('button', { name: /accept offer/i }));
    expect(acceptMutate).toHaveBeenCalledTimes(1);
  });

  it('triggers decline mutation when Decline clicked', () => {
    offersState.data = {
      offers: [{ job_id: 'j_decline', job_title: 'Decline Me', expires_at: future, amount_cents: 5000 }],
    };
    render(withQueryClient(createElement(ProviderOffersPage)));
    fireEvent.click(screen.getByRole('button', { name: /decline offer/i }));
    expect(declineMutate).toHaveBeenCalledTimes(1);
  });

  it('disables actions while accept mutation is pending', () => {
    offersState.data = {
      offers: [{ job_id: 'j1', job_title: 'Active Job', expires_at: future, amount_cents: 5000 }],
    };
    acceptState.isPending = true;
    render(withQueryClient(createElement(ProviderOffersPage)));
    expect(
      screen.getByRole('button', { name: /accept offer/i }).hasAttribute('disabled'),
    ).toBe(true);
  });
});
