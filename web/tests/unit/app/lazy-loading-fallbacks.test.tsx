// Loading placeholders of the code-split boundaries (PERF-08).
//
// The default test setup runs with every `next/dynamic` chunk already loaded
// (tests/setup.ts). This file pins the opposite state — the chunk has NOT
// arrived yet — and asserts what the user sees and what a screen reader is
// told in the meantime, for each boundary:
//   • LazyTerminalGrid        → TerminalGrid (react-grid-layout + widgets)
//   • orders/[id]             → OrderReviewForm (react-hook-form + zod)
//   • profile                 → ProfileForm (react-hook-form + select)
//   • StripeOnboarding        → ConnectEmbeddedOnboarding (Connect.js)
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createElement,
  type ComponentProps,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from 'react';
import { describe, expect, it, vi } from 'vitest';

import { LISTING_ORDER_STATUS } from '@/types';
import type { ListingOrder } from '@/types';

// A chunk that never arrives: render the `loading` option, never the loader.
vi.mock('next/dynamic', () => ({
  __esModule: true,
  default: (_loader: unknown, options?: { loading?: ComponentType }) => {
    const Loading = options?.loading;
    return function PendingDynamic() {
      return Loading ? createElement(Loading) : null;
    };
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: 'o-1' }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement('a', { href }, children),
}));

// ── orders/[id] ──────────────────────────────────────────────────────────────
const completedOrder: ListingOrder = {
  id: 'o-1',
  listing_id: 'l-1',
  listing_title: 'Vintage bike',
  listing_photo_url: null,
  buyer_id: 'me',
  seller_id: 's-1',
  seller_display_name: 'Jane Seller',
  pickup_address: '123 Main St',
  pickup_zip: '94110',
  pickup_city: 'San Francisco',
  pickup_state: 'CA',
  amount_cents: 12000,
  platform_fee_cents: 1200,
  status: LISTING_ORDER_STATUS.COMPLETED,
  channel_id: 'ch-1',
  paid_at: '2026-01-01T00:00:00Z',
  picked_up_at: '2026-01-02T00:00:00Z',
  seller_confirmed_at: '2026-01-02T00:00:00Z',
  completed_at: '2026-01-02T00:00:00Z',
  dispute_window_ends_at: null,
  created_at: '2026-01-01T00:00:00Z',
};

const idleMutation = { mutate: vi.fn(), isPending: false };

vi.mock('@/hooks/useListings', () => ({
  useListingOrder: () => ({
    data: completedOrder,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useConfirmPickup: () => idleMutation,
  useSellerConfirm: () => idleMutation,
  useDisputeOrder: () => idleMutation,
  useReportOrderNoShow: () => idleMutation,
  useCancelUnpaidOrder: () => idleMutation,
}));

vi.mock('@/hooks/useOrderReviews', () => ({
  useListingOrderReviewEligibility: () => ({
    data: { eligible: true, already_reviewed: false, review_window_closes_at: undefined },
    isLoading: false,
  }),
  useListingOrderReviews: () => ({ data: [] }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) =>
    selector({ user: { id: 'me' } }),
}));

// ── profile ──────────────────────────────────────────────────────────────────
vi.mock('@/components/forms/PhoneOtpForm', () => ({
  PhoneOtpForm: () => createElement('div', { 'data-testid': 'phone-otp-form' }),
}));

vi.mock('@/hooks/useProfile', () => ({
  useEnableRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useProfile: () => ({
    data: {
      id: 'u1',
      displayName: 'Tanner Coker',
      email: 'tanner@example.com',
      roles: ['customer'],
      emailVerified: true,
      phoneVerified: false,
      mfaEnabled: false,
      createdAt: '2025-01-15T00:00:00Z',
      avatarUrl: null,
    },
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/hooks/useProviderProfile', () => ({
  useProviderProfile: () => ({ data: undefined }),
}));

// ── StripeOnboarding ─────────────────────────────────────────────────────────
vi.mock('@/lib/stripe', () => ({
  isStripeConfigured: () => true,
  getStripe: () => null,
}));

vi.mock('@/hooks/usePayments', () => ({
  useStripeAccountStatus: () => ({
    data: {
      account_exists: true,
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      transfers_ready: false,
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useCreateStripeAccount: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
  useStripeOnboardingLink: () => ({ refetch: vi.fn(), isFetching: false }),
}));

const { default: OrderDetailPage } = await import('@/app/(dashboard)/orders/[id]/page');
const { default: ProfilePage } = await import('@/app/(dashboard)/profile/page');
const { StripeOnboarding } = await import('@/components/payments/StripeOnboarding');
const { LazyTerminalGrid, preloadTerminalGrid } =
  await import('@/components/terminal/terminal-grid-lazy');

function withQueryClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, ui);
}

describe('code-split loading placeholders', () => {
  it('LazyTerminalGrid announces the terminal is loading and holds its space', () => {
    render(
      createElement(LazyTerminalGrid, {
        sim: {} as ComponentProps<typeof LazyTerminalGrid>['sim'],
        auctionEndsAt: '2026-01-01T00:00:00Z',
        startingPriceCents: 1000,
        marketRange: { low_cents: 0, median_cents: 0, high_cents: 0, sample_size: 0 },
        mockProviders: [],
      }),
    );
    const placeholder = screen.getByRole('status', { name: 'Loading auction terminal' });
    expect(placeholder.className).toContain('min-h-[60vh]');
    expect(screen.getByText('Loading auction terminal…')).toBeDefined();
  });

  it('preloadTerminalGrid can be called repeatedly from a mount effect', () => {
    expect(() => {
      preloadTerminalGrid();
      preloadTerminalGrid();
    }).not.toThrow();
  });

  it('orders/[id] shows a review-form placeholder for an eligible completed order', () => {
    render(withQueryClient(createElement(OrderDetailPage)));
    const placeholder = screen.getByRole('status', { name: 'Loading review form' });
    // Same block the eligibility request shows, so the section keeps its size.
    expect(placeholder.firstElementChild?.className).toContain('h-48');
  });

  it('profile shows a form-shaped placeholder after "Edit Profile" is pressed', () => {
    render(withQueryClient(createElement(ProfilePage)));
    expect(screen.queryByRole('status', { name: 'Loading profile form' })).toBeNull();

    const edit = screen.getByRole('button', { name: 'Edit Profile' });
    // Hover and focus start the chunk download early; neither opens the form.
    fireEvent.pointerEnter(edit);
    fireEvent.focus(edit);
    expect(screen.queryByRole('status', { name: 'Loading profile form' })).toBeNull();

    fireEvent.click(edit);
    expect(screen.getByRole('status', { name: 'Loading profile form' })).toBeDefined();
    expect(screen.getByText('Edit Profile')).toBeDefined();
  });

  it('StripeOnboarding keeps a single loading line while Connect.js is fetched', () => {
    render(createElement(StripeOnboarding));
    fireEvent.click(screen.getByRole('button', { name: 'Continue setup' }));
    expect(screen.getByRole('status').textContent).toBe('Loading secure Stripe setup…');
    // The Stripe-hosted fallback stays reachable while the chunk loads.
    expect(screen.getByRole('button', { name: /Open Stripe-hosted setup instead/ })).toBeDefined();
  });
});
