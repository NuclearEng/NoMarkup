// Smoke test for the customer/provider dashboard page.
// Mocks all hooks + the auth store; verifies the page renders without throwing.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dashboard',
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

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ data: { emailVerified: true }, isLoading: false }),
}));

vi.mock('@/hooks/useAnalytics', () => ({
  useCustomerSpending: () => ({ data: undefined, isLoading: false }),
  useProviderEarnings: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/hooks/useBids', () => ({
  useMyBids: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/hooks/useContracts', () => ({
  useContracts: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/hooks/useJobs', () => ({
  useCustomerJobs: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/hooks/usePayments', () => ({
  usePayments: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      user: { id: 'u1', displayName: 'Test User', roles: ['customer'] },
      isHydrating: false,
    }),
}));

import DashboardPage from '@/app/(dashboard)/dashboard/page';

describe('DashboardPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(DashboardPage)));
    expect(container).toBeTruthy();
  });

  it('renders a greeting heading', () => {
    const { container } = render(withQueryClient(createElement(DashboardPage)));
    const heading = container.querySelector('h1');
    expect(heading?.textContent).toMatch(/Good (morning|afternoon|evening)/);
  });
});
