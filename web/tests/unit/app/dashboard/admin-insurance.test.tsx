// Smoke test for the admin insurance claims page.
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withQueryClient } from './_helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/insurance',
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

vi.mock('@/hooks/useInsurance', () => ({
  useAdminInsuranceClaims: () => ({ data: undefined, isLoading: false, isError: false }),
  useReviewInsuranceClaim: () => ({ mutate: vi.fn(), isPending: false }),
}));

import AdminInsurancePage from '@/app/(dashboard)/admin/insurance/page';

describe('AdminInsurancePage', () => {
  it('renders without throwing', () => {
    const { container } = render(withQueryClient(createElement(AdminInsurancePage)));
    expect(container).toBeTruthy();
  });
});
