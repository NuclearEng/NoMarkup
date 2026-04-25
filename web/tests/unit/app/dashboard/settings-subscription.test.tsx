// Smoke test for the subscription settings page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/settings/subscription',
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

vi.mock('@/components/payments/SubscriptionTierCard', () => ({
  SubscriptionTierCard: () => createElement('div', { 'data-testid': 'tier-card' }),
}));

vi.mock('@/components/payments/SubscriptionTierComparison', () => ({
  SubscriptionTierComparison: () => createElement('div', { 'data-testid': 'tier-comparison' }),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useCancelSubscription: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useChangeTier: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useInvoices: () => ({ data: undefined, isLoading: false }),
  useSubscription: () => ({ data: undefined, isLoading: false }),
  useTiers: () => ({ data: undefined, isLoading: false }),
  useUsage: () => ({ data: undefined, isLoading: false }),
}));

import SubscriptionPage from '@/app/(dashboard)/settings/subscription/page';

describe('SubscriptionPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(SubscriptionPage)));
    expect(container).toBeTruthy();
  });
});
