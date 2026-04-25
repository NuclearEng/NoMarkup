// Smoke test for the payments list page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/payments',
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

vi.mock('@/hooks/usePayments', () => ({
  usePayments: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
}));

import PaymentsPage from '@/app/(dashboard)/payments/page';

describe('PaymentsPage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(PaymentsPage)));
    expect(container).toBeTruthy();
  });
});
