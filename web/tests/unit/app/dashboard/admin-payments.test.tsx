// Smoke test for the admin payments page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/payments',
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

vi.mock('@/hooks/useAdmin', () => ({
  useAdminPayments: () => ({ data: undefined, isLoading: false, isError: false }),
  useRevenueReport: () => ({ data: undefined, isLoading: false }),
  useUpdateFeeConfig: () => ({ mutate: vi.fn(), isPending: false }),
}));

import AdminPaymentsPage from '@/app/(dashboard)/admin/payments/page';

describe('AdminPaymentsPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(AdminPaymentsPage)));
    expect(container).toBeTruthy();
  });
});
