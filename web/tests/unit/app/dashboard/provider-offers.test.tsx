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

// Global override for the countdown mock so individual tests can force a
// specific branch (urgent / expired) without relying on real clock parsing.
const countdownOverride: { mode: 'real' | 'urgent' | 'expired' } = { mode: 'real' };

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
    if (countdownOverride.mode === 'urgent') {
      return { timeLeft: '0:30', isExpired: false, totalSeconds: 30 };
    }
    if (countdownOverride.mode === 'expired') {
      return { timeLeft: 'Expired', isExpired: true, totalSeconds: 0 };
    }
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
  countdownOverride.mode = 'real';
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

  it('disables actions while decline mutation is pending', () => {
    offersState.data = {
      offers: [{ job_id: 'j1', job_title: 'Active Job', expires_at: future, amount_cents: 5000 }],
    };
    declineState.isPending = true;
    render(withQueryClient(createElement(ProviderOffersPage)));
    expect(
      screen.getByRole('button', { name: /decline offer/i }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('hides the amount badge when amount_cents is zero', () => {
    offersState.data = {
      offers: [{ job_id: 'j1', job_title: 'Free Job', expires_at: future, amount_cents: 0 }],
    };
    render(withQueryClient(createElement(ProviderOffersPage)));
    // The job title still renders but no $ badge
    expect(screen.getByText('Free Job')).toBeDefined();
    expect(screen.queryByText(/^\$0\.00$/)).toBeNull();
  });

  it('renders the urgent (orange) countdown style when totalSeconds < 180', () => {
    countdownOverride.mode = 'urgent';
    offersState.data = {
      offers: [{ job_id: 'j1', job_title: 'Soon-Expiring Job', expires_at: future, amount_cents: 5000 }],
    };
    const { container } = render(withQueryClient(createElement(ProviderOffersPage)));
    // OfferCountdown renders the time-left with the urgent class
    expect(container.querySelector('.text-orange-400')).toBeTruthy();
  });

  it('renders the Expired badge and styling when useCountdown reports expired', () => {
    countdownOverride.mode = 'expired';
    offersState.data = {
      offers: [{ job_id: 'j1', job_title: 'Just Expired Job', expires_at: future, amount_cents: 5000 }],
    };
    const { container } = render(withQueryClient(createElement(ProviderOffersPage)));
    // The destructive Expired badge renders in place of accept/decline buttons
    expect(screen.getAllByText(/expired/i).length).toBeGreaterThan(0);
    // Accept button should not render in the expired branch
    expect(screen.queryByRole('button', { name: /accept offer/i })).toBeNull();
    // Destructive countdown class is present
    expect(container.querySelector('.text-destructive')).toBeTruthy();
  });

  it('uses singular "offer" in aria-label when exactly one active offer', () => {
    offersState.data = {
      offers: [{ job_id: 'j1', job_title: 'Solo Job', expires_at: future, amount_cents: 5000 }],
    };
    const { container } = render(withQueryClient(createElement(ProviderOffersPage)));
    const region = container.querySelector('[aria-label="1 pending offer"]');
    expect(region).toBeTruthy();
  });

  it('uses plural "offers" in aria-label when multiple active offers', () => {
    offersState.data = {
      offers: [
        { job_id: 'j1', job_title: 'Job A', expires_at: future, amount_cents: 5000 },
        { job_id: 'j2', job_title: 'Job B', expires_at: future, amount_cents: 5000 },
      ],
    };
    const { container } = render(withQueryClient(createElement(ProviderOffersPage)));
    const region = container.querySelector('[aria-label="2 pending offers"]');
    expect(region).toBeTruthy();
  });

  it('filters out offers with empty/missing expires_at', () => {
    offersState.data = {
      offers: [
        { job_id: 'j1', job_title: 'Active Job', expires_at: future, amount_cents: 5000 },
        { job_id: 'j2', job_title: 'No Expiry Job', expires_at: '', amount_cents: 5000 },
      ],
    };
    render(withQueryClient(createElement(ProviderOffersPage)));
    expect(screen.getByText('Active Job')).toBeDefined();
    expect(screen.queryByText('No Expiry Job')).toBeNull();
  });
});
