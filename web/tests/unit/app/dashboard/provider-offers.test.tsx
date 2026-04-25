// Smoke test for the provider instant offers page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

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
  useCountdown: () => ({ minutes: 5, seconds: 0, isExpired: false, formatted: '5:00' }),
}));

vi.mock('@/hooks/useInstantMatch', () => ({
  useAcceptOffer: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeclineOffer: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useProviderOffers: () => ({ data: undefined, isLoading: false, isError: false }),
}));

import ProviderOffersPage from '@/app/(dashboard)/provider/offers/page';

describe('ProviderOffersPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(ProviderOffersPage)));
    expect(container).toBeTruthy();
  });
});
