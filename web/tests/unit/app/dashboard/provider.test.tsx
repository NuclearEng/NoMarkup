// Smoke test for the provider dashboard page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/provider',
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

vi.mock('@/hooks/useAnalytics', () => ({
  useProviderAnalytics: () => ({ data: undefined, isLoading: false }),
  useProviderEarnings: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/hooks/useBids', () => ({
  useMyBids: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/hooks/useProviderProfile', () => ({
  useProviderProfile: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/hooks/useTrustScore', () => ({
  useTierRequirements: () => ({ data: undefined, isLoading: false }),
  useTrustScore: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'u1', displayName: 'Test', roles: ['provider'] }, isHydrating: false }),
}));

import ProviderDashboardPage from '@/app/(dashboard)/provider/page';

describe('ProviderDashboardPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(ProviderDashboardPage)));
    expect(container).toBeTruthy();
  });
});
